'use strict';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const fmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 });
const fmt3 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 });
const MONTH_NAMES = ['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const WEEK = ['Ne','Po','Út','St','Čt','Pá','So'];
const WEEK_MON = ['Po','Út','St','Čt','Pá','So','Ne'];

let db;
const APP_VERSION = '1.4.0';
const IS_BETA = location.pathname.includes('/beta/');
const DB_NAME = IS_BETA ? 'energo-prehled-beta' : 'energo-prehled';
const METRIC_KEY = IS_BETA ? 'metric-beta' : 'metric';
const PERIOD_KEY = IS_BETA ? 'period-beta' : 'period';
const ANCHOR_KEY = IS_BETA ? 'anchor-beta' : 'anchor';
const CUSTOM_FROM_KEY = IS_BETA ? 'custom-from-beta' : 'custom-from';
const CUSTOM_TO_KEY = IS_BETA ? 'custom-to-beta' : 'custom-to';
const DAYPART_KEY = IS_BETA ? 'daypart-beta' : 'daypart';
const DASHBOARD_MODE_KEY = IS_BETA ? 'dashboard-mode-beta' : 'dashboard-mode';
const EGD_TOKEN_URL = 'https://idm.distribuce24.cz/oauth/token';
const EGD_DATA_BASE = 'https://data.distribuce24.cz/rest';
const EGD_SCOPE = 'namerena_data_openapi';
const PROFILE_ROLES = ['DCC0','DCC1','DKC0','DKC1','DMC0','DMC1'];
const ROLE_FIELDS = {DCC0:'dcc0',DCC1:'dcc1',DKC0:'dkc0',DKC1:'dkc1',DMC0:'dmc0',DMC1:'dmc1'};
const PRAGUE_DTF = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const savedPeriod=localStorage.getItem(PERIOD_KEY);
let state = {
  records: [],
  months: [],
  metric: localStorage.getItem(METRIC_KEY) || 'dcc1',
  period: ['month','3m','year','custom','all'].includes(savedPeriod)?savedPeriod:'month',
  anchorMonth: localStorage.getItem(ANCHOR_KEY) || '',
  customFrom: localStorage.getItem(CUSTOM_FROM_KEY) || '',
  customTo: localStorage.getItem(CUSTOM_TO_KEY) || '',
  daypartMode: localStorage.getItem(DAYPART_KEY)==='average'?'average':'percent',
  dashboardMode: localStorage.getItem(DASHBOARD_MODE_KEY)==='cost'?'cost':'energy',
  egd: {clientId:'',clientSecret:'',ean:'',profile:'',oms:[],profiles:[],statuses:[],lastSync:null,lastError:null},
  pendingImport: null,
  resetExportRange: false
};

// ---------- IndexedDB ----------
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,2);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains('intervals')){
        const store=d.createObjectStore('intervals',{keyPath:'id'});
        store.createIndex('monthKey','monthKey');
        store.createIndex('dateKey','dateKey');
        store.createIndex('sortKey','sortKey');
      }
      if(!d.objectStoreNames.contains('months')) d.createObjectStore('months',{keyPath:'monthKey'});
      if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)})}
async function getAll(store){return new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function getSetting(key){return new Promise((res,rej)=>{const r=db.transaction('settings','readonly').objectStore('settings').get(key);r.onsuccess=()=>res(r.result?.value??null);r.onerror=()=>rej(r.error)})}
async function setSetting(key,value){return new Promise((res,rej)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({key,value});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)})}
async function deleteSetting(key){return new Promise((res,rej)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)})}
async function loadEgdSettings(){
  const cfg=await getSetting('egd-config');
  if(cfg&&typeof cfg==='object')state.egd={...state.egd,...cfg,oms:[],profiles:[],statuses:[],lastError:null};
}
async function deleteMonth(monthKey){
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['intervals','months'],'readwrite'),s=tx.objectStore('intervals'),months=tx.objectStore('months'),idx=s.index('monthKey');
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    const r=idx.openCursor(IDBKeyRange.only(monthKey));
    r.onerror=()=>{try{tx.abort()}catch{}};
    r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue()}else months.delete(monthKey)};
  });
  state.resetExportRange=true; await reload(); showToast('Měsíc byl odstraněn');
}
async function setMonthEnabled(monthKey,enabled){
  const month=state.months.find(m=>m.monthKey===monthKey);if(!month)return;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('months','readwrite'),store=tx.objectStore('months');
    store.put({...month,enabled:!!enabled});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  state.resetExportRange=true;await reload();
  showToast(`${monthLabel(monthKey)}: ${enabled?'aktivní':'vypnuto'}`);
}
function emptyFinance(){return {invoiceTotal:null,components:{energy:null,distribution:null,fixed:null,other:null}}}
function normalizeFinance(finance){
  const f=finance&&typeof finance==='object'?finance:{},nullable=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null};
  const c=f.components&&typeof f.components==='object'?f.components:{};
  return {invoiceTotal:nullable(f.invoiceTotal),components:{energy:nullable(c.energy),distribution:nullable(c.distribution),fixed:nullable(c.fixed),other:nullable(c.other)}};
}
function parseMoneyInput(raw){
  const text=String(raw??'').replace(/[\s\u00a0]/g,'').replace(',','.').trim();
  if(!text)return null;
  const n=Number(text);if(!Number.isFinite(n)||n<0)throw new Error('Cena faktury musí být nezáporné číslo.');return Math.round(n*100)/100;
}
async function setMonthInvoice(monthKey,rawValue){
  const month=state.months.find(m=>m.monthKey===monthKey);if(!month)return;
  const invoiceTotal=parseMoneyInput(rawValue),finance=normalizeFinance(month.finance);finance.invoiceTotal=invoiceTotal;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('months','readwrite'),store=tx.objectStore('months');
    store.put({...month,finance});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  await reload();showToast(`${monthLabel(monthKey)}: ${invoiceTotal===null?'cena faktury odstraněna':fmt.format(invoiceTotal)+' Kč'}`);
}
async function persistImport(payload, replace=false){
  const previous=replace?state.months.find(m=>m.monthKey===payload.month.monthKey):null;
  const monthToSave={...payload.month,enabled:previous?previous.enabled!==false:payload.month.enabled!==false,finance:previous?normalizeFinance(previous.finance):normalizeFinance(payload.month.finance)};
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['intervals','months'],'readwrite'), s=tx.objectStore('intervals'), months=tx.objectStore('months');
    const write=()=>{payload.records.forEach(r=>s.put(r));months.put(monthToSave)};
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    if(!replace){write();return}
    const cursor=s.index('monthKey').openCursor(IDBKeyRange.only(payload.month.monthKey));
    cursor.onerror=()=>{try{tx.abort()}catch{}};
    cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue()}else{months.delete(payload.month.monthKey);write()}};
  });
}
async function saveImport(payload, replace=false){
  await persistImport(payload,replace);
  state.pendingImport=null; state.resetExportRange=true;
  if(!state.anchorMonth)state.anchorMonth=payload.month.monthKey;
  await reload(); showToast(`${payload.month.label}: importováno ${payload.records.length.toLocaleString('cs-CZ')} intervalů`);
}

// ---------- XLSX ZIP reader ----------
function u16(v,o){return v.getUint16(o,true)} function u32(v,o){return v.getUint32(o,true)}
async function unzipXlsx(buffer){
  const bytes=new Uint8Array(buffer), view=new DataView(buffer); let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(view,i)===0x06054b50){eocd=i;break}}
  if(eocd<0) throw new Error('Soubor není platný XLSX/ZIP.');
  const count=u16(view,eocd+10), cdOffset=u32(view,eocd+16), entries=new Map(); let p=cdOffset;
  for(let n=0;n<count;n++){
    if(u32(view,p)!==0x02014b50) throw new Error('Poškozený ZIP adresář.');
    const method=u16(view,p+10), csize=u32(view,p+20), usize=u32(view,p+24), nlen=u16(view,p+28), xlen=u16(view,p+30), clen=u16(view,p+32), local=u32(view,p+42);
    const name=new TextDecoder().decode(bytes.slice(p+46,p+46+nlen));
    if(u32(view,local)!==0x04034b50) throw new Error('Poškozená ZIP položka.');
    const ln=u16(view,local+26), lx=u16(view,local+28), start=local+30+ln+lx, comp=bytes.slice(start,start+csize); let out;
    if(method===0) out=comp;
    else if(method===8){
      if(typeof DecompressionStream==='undefined') throw new Error('Tento prohlížeč neumí lokálně rozbalit XLSX. Aktualizuj prosím iOS/Safari.');
      const ds=new DecompressionStream('deflate-raw');
      out=new Uint8Array(await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer());
    } else throw new Error(`Nepodporovaná komprese ZIP (${method}).`);
    if(usize && out.length!==usize) throw new Error(`Poškozená ZIP položka: ${name}`);
    entries.set(name,out); p+=46+nlen+xlen+clen;
  }
  return entries;
}
function xml(bytes){
  const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
  if(doc.querySelector('parsererror')) throw new Error('XLSX obsahuje poškozené XML.');
  return doc;
}
function colIndex(ref){const m=String(ref||'').match(/[A-Z]+/);if(!m)return -1;let n=0;for(const c of m[0]) n=n*26+c.charCodeAt(0)-64;return n-1}
function cellText(c, shared){
  const t=c.getAttribute('t');
  if(t==='inlineStr') return [...c.querySelectorAll('t')].map(x=>x.textContent||'').join('');
  const v=c.querySelector('v')?.textContent ?? '';
  if(t==='s') return shared[Number(v)] ?? '';
  return v;
}
function parseCzTimestamp(s){
  const m=String(s).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/); if(!m)return null;
  const [,dd,mm,yyyy,hh,mi,ss='00']=m;
  return {year:+yyyy,month:+mm,day:+dd,hour:+hh,minute:+mi,second:+ss,dateKey:`${yyyy}-${mm}-${dd}`,monthKey:`${yyyy}-${mm}`,display:`${dd}.${mm}.${yyyy} ${hh}:${mi}`,source:String(s).trim()};
}
function weekdayMon(ts){const d=new Date(Date.UTC(ts.year,ts.month-1,ts.day)).getUTCDay();return d===0?6:d-1}
function pragueParts(ms){const out={};for(const p of PRAGUE_DTF.formatToParts(new Date(ms)))if(p.type!=='literal')out[p.type]=Number(p.value);return out}
function pragueUtcCandidates(ts){
  const base=Date.UTC(ts.year,ts.month-1,ts.day,ts.hour,ts.minute,ts.second||0), found=[];
  for(const offset of [0,60,120,180]){const ms=base-offset*60000,p=pragueParts(ms);if(p.year===ts.year&&p.month===ts.month&&p.day===ts.day&&p.hour===ts.hour&&p.minute===ts.minute&&p.second===(ts.second||0))found.push(ms)}
  return [...new Set(found)].sort((a,b)=>a-b);
}
function sourceStamp(y,m,d,h,mi){return `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.${y} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00`}
function expectedTimestampCounts(year,month){
  const out=new Map(),days=new Date(Date.UTC(year,month,0)).getUTCDate();
  for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){const source=sourceStamp(year,month,d,h,mi),ts=parseCzTimestamp(source),count=pragueUtcCandidates(ts).length;if(count)out.set(source,count)}
  return out;
}
function validateMonthTimeline(records,year,month){
  const expected=expectedTimestampCounts(year,month),actual=new Map(),issues=[];
  for(const r of records)actual.set(r.sourceTimestamp,(actual.get(r.sourceTimestamp)||0)+1);
  for(const [stamp,count] of expected){const got=actual.get(stamp)||0;if(got!==count)issues.push(`${stamp}: očekáváno ${count}×, nalezeno ${got}×`)}
  for(const [stamp,count] of actual)if(!expected.has(stamp))issues.push(`${stamp}: neočekávaný čas (${count}×)`);
  return {complete:issues.length===0,issues,expectedCount:[...expected.values()].reduce((a,b)=>a+b,0)};
}
function strictNumber(value,role,row){const raw=String(value??'').trim();if(!raw)throw new Error(`Řádek ${row}: ${role} nemá hodnotu.`);const n=Number(raw.replace(',','.'));if(!Number.isFinite(n))throw new Error(`Řádek ${row}: ${role} obsahuje neplatnou hodnotu „${raw}“.`);return n}
function optionalNumber(value,role,row){const raw=String(value??'').trim();if(!raw)return null;const n=Number(raw.replace(',','.'));if(!Number.isFinite(n))throw new Error(`Řádek ${row}: ${role} obsahuje neplatnou hodnotu „${raw}“.`);return n}
function matrixFromSheet(doc,shared){const matrix=new Map();doc.querySelectorAll('sheetData > row').forEach(row=>{const rn=Number(row.getAttribute('r')),map=new Map();row.querySelectorAll(':scope > c').forEach(c=>{const ci=colIndex(c.getAttribute('r'));if(ci>=0)map.set(ci,cellText(c,shared))});matrix.set(rn,map)});return matrix}
function findRoleRow(matrix){for(const [rn,row] of matrix){const vals=[...row.values()].map(v=>String(v).trim());if(vals.includes('DCC0')&&vals.includes('DCC1'))return rn}return null}
function metadataValue(matrix,label){for(const [,row] of matrix)for(const [c,v] of row)if(String(v).trim()===label)return String(row.get(c+1)||'').trim();return ''}
async function parseReport(file){
  const entries=await unzipXlsx(await file.arrayBuffer()),shared=[];
  if(entries.has('xl/sharedStrings.xml')){const doc=xml(entries.get('xl/sharedStrings.xml'));doc.querySelectorAll('si').forEach(si=>shared.push([...si.querySelectorAll('t')].map(t=>t.textContent||'').join('')))}
  const sheets=[...entries.keys()].filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  let matrix=null,roleRow=null;
  for(const sheet of sheets){const candidate=matrixFromSheet(xml(entries.get(sheet)),shared),rr=findRoleRow(candidate);if(rr!==null){matrix=candidate;roleRow=rr;break}}
  if(!matrix) throw new Error('V XLSX nebyl nalezen datový list s profily DCC0 a DCC1.');
  const roleCols={};for(const [col,val] of matrix.get(roleRow)||[])if(PROFILE_ROLES.includes(String(val).trim()))roleCols[String(val).trim()]=col;
  if(roleCols.DCC0===undefined||roleCols.DCC1===undefined)throw new Error('Report neobsahuje povinné profily DCC0 a DCC1.');
  const ean=metadataValue(matrix,'EAN'),meter=metadataValue(matrix,'Číslo elm.');if(!ean)throw new Error('V reportu nebylo nalezeno EAN odběrného místa.');
  const rawRecords=[];
  for(const [rn,row] of matrix){const ts=parseCzTimestamp(row.get(0));if(!ts)continue;if(ts.minute%15!==0||ts.second!==0)throw new Error(`Řádek ${rn}: čas ${ts.source} není na 15minutové mřížce.`);const profiles={};for(const role of PROFILE_ROLES){const col=roleCols[role];profiles[ROLE_FIELDS[role]]=col===undefined?null:(role==='DCC0'||role==='DCC1'?strictNumber(row.get(col),role,rn):optionalNumber(row.get(col),role,rn))}rawRecords.push({rn,ts,profiles})}
  if(!rawRecords.length) throw new Error('V reportu nebyly nalezeny 15minutové hodnoty.');
  const monthKeys=[...new Set(rawRecords.map(x=>x.ts.monthKey))];if(monthKeys.length!==1)throw new Error(`Report obsahuje více kalendářních měsíců (${monthKeys.join(', ')}). Importuj vždy jeden celý měsíc.`);
  const first=rawRecords[0].ts,{year,month,monthKey}=first,seen=new Map(),records=[];
  for(const x of rawRecords){const candidates=pragueUtcCandidates(x.ts),occ=seen.get(x.ts.source)||0;if(!candidates.length)throw new Error(`Čas ${x.ts.source} není platný místní čas v Europe/Prague.`);if(occ>=candidates.length)throw new Error(`Čas ${x.ts.source} je v reportu neočekávaně duplicitní.`);seen.set(x.ts.source,occ+1);const ambiguous=candidates.length>1;records.push({id:`${ean}|${x.ts.source}|${occ}`,ean,meter,monthKey,dateKey:x.ts.dateKey,sourceTimestamp:x.ts.source,displayTimestamp:x.ts.display+(ambiguous?` [${occ+1}]`:''),occurrenceIndex:occ,sortKey:candidates[occ],year:x.ts.year,month:x.ts.month,day:x.ts.day,hour:x.ts.hour,minute:x.ts.minute,weekday:weekdayMon(x.ts),intervalMinutes:15,...x.profiles})}
  records.sort((a,b)=>a.sortKey-b.sortKey||a.id.localeCompare(b.id));
  const validation=validateMonthTimeline(records,year,month);if(!validation.complete)throw new Error(`Report není kompletní 15minutový měsíc. ${validation.issues.slice(0,4).join(' | ')}${validation.issues.length>4?' …':''}`);
  const label=`${MONTH_NAMES[month-1]} ${year}`;
  return {records,month:{monthKey,label,year,month,ean,meter,count:records.length,expectedCount:validation.expectedCount,complete:true,incompleteDays:0,validationVersion:2,enabled:true,finance:emptyFinance(),first:records[0].sourceTimestamp,last:records[records.length-1].sourceTimestamp,importedAt:new Date().toISOString(),fileName:file.name}};
}

// ---------- EG.D OpenAPI ----------
function egdConnectionConfig(){
  return {clientId:state.egd.clientId,clientSecret:state.egd.clientSecret,ean:state.egd.ean,profile:state.egd.profile,lastSync:state.egd.lastSync||null};
}
async function saveEgdConfig(){await setSetting('egd-config',egdConnectionConfig())}
function egdNetworkError(e){
  if(e instanceof TypeError)return new Error('Přímé spojení s EG.D se z prohlížeče nepodařilo navázat. Může jít o síťovou chybu nebo CORS blokaci na straně EG.D.');
  return e;
}
async function egdToken(clientId=state.egd.clientId,clientSecret=state.egd.clientSecret){
  if(!clientId||!clientSecret)throw new Error('Vyplň Client ID a Client secret.');
  let resp;
  try{
    resp=await fetch(EGD_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},cache:'no-store',body:JSON.stringify({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:EGD_SCOPE})});
  }catch(e){throw egdNetworkError(e)}
  let body=null;try{body=await resp.json()}catch{}
  if(!resp.ok)throw new Error(`EG.D odmítlo přihlášení (HTTP ${resp.status})${body?.error_description?': '+body.error_description:''}.`);
  if(!body?.access_token)throw new Error('EG.D nevrátilo access_token.');
  return body.access_token;
}
async function egdGet(path,token,params=null){
  const url=new URL(EGD_DATA_BASE+path);
  if(params)for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined)url.searchParams.set(k,v);
  let resp;
  try{resp=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store'})}
  catch(e){throw egdNetworkError(e)}
  let body=null;try{body=await resp.json()}catch{}
  if(!resp.ok)throw new Error(`EG.D API ${path} vrátilo HTTP ${resp.status}.`);
  return body;
}
function chooseConsumptionProfile(profiles,typMereni,current=''){
  const electric=profiles.filter(p=>String(p.komodita||'').toUpperCase()==='ELEKTRINA');
  if(current&&electric.some(p=>p.kod===current))return current;
  const type=String(typMereni||'').toUpperCase();
  const preferred=electric.find(p=>/spotřeb|odebran/i.test(String(p.nazev||''))&&(!type||String(p.nazev||'').toUpperCase().includes(type)))
    ||electric.find(p=>/spotřeb|odebran/i.test(String(p.nazev||'')))
    ||electric[0];
  return preferred?.kod||'';
}
async function testEgdConnection(){
  const clientId=$('#egdClientId').value.trim(),clientSecret=$('#egdClientSecret').value.trim();
  state.egd.clientId=clientId;state.egd.clientSecret=clientSecret;state.egd.lastError=null;
  await saveEgdConfig();
  setEgdUiState('warn','Ověřuji…','Získávám token a číselníky EG.D.');
  try{
    const token=await egdToken(clientId,clientSecret);
    const oms=await egdGet('/om',token),profiles=await egdGet('/profily',token),statuses=await egdGet('/statusy',token);
    state.egd.oms=Array.isArray(oms)?oms:[];
    state.egd.profiles=Array.isArray(profiles)?profiles:[];
    state.egd.statuses=Array.isArray(statuses)?statuses:[];
    if(!state.egd.oms.length)throw new Error('EG.D nevrátilo žádné odběrné místo dostupné pro OpenAPI.');
    const localEans=[...new Set(state.records.map(r=>r.ean).filter(Boolean))];
    if(!state.egd.ean||!state.egd.oms.some(x=>x.ean===state.egd.ean)){
      state.egd.ean=state.egd.oms.find(x=>localEans.includes(x.ean))?.ean||state.egd.oms[0].ean;
    }
    const om=state.egd.oms.find(x=>x.ean===state.egd.ean);
    state.egd.profile=chooseConsumptionProfile(state.egd.profiles,om?.typMereni,state.egd.profile);
    if(!state.egd.profile)throw new Error('V číselníku EG.D nebyl nalezen elektrický profil spotřeby.');
    state.egd.verified=true;await saveEgdConfig();renderEgdPanel();
    setEgdUiState('ok','Připojeno',`Ověřeno · ${state.egd.oms.length} odběrných míst · profil ${state.egd.profile}`);
  }catch(e){
    state.egd.verified=false;state.egd.lastError=e.message;renderEgdPanel();setEgdUiState('error','Chyba připojení',e.message);throw e;
  }
}
function setEgdUiState(kind,label,message){
  const status=$('#egdStatus'),result=$('#egdResult');if(!status||!result)return;
  status.className='egd-status'+(kind?' '+kind:'');status.textContent=label;result.textContent=message;
}
async function disconnectEgd(){
  if(!confirm('Odpojit EG.D OpenAPI z tohoto zařízení? Naměřená data už uložená v aplikaci zůstanou zachovaná.'))return;
  await deleteSetting('egd-config');
  state.egd={clientId:'',clientSecret:'',ean:'',profile:'',oms:[],profiles:[],statuses:[],lastSync:null,lastError:null,verified:false};
  renderEgdPanel();showToast('EG.D připojení bylo odstraněno');
}
async function saveEgdSelections(){
  state.egd.ean=$('#egdEanSelect').value||state.egd.ean;
  state.egd.profile=$('#egdProfileSelect').value||state.egd.profile;
  await saveEgdConfig();
}
function renderEgdPanel(){
  const hasCreds=!!(state.egd.clientId&&state.egd.clientSecret),hasSelection=!!(state.egd.ean&&state.egd.profile);
  $('#egdClientId').value=state.egd.clientId||'';
  $('#egdClientSecret').value=state.egd.clientSecret||'';
  $('#egdConfig').classList.toggle('hidden',!state.egd.oms.length);
  $('#egdSyncBtn').classList.toggle('hidden',!(hasCreds&&hasSelection));
  $('#egdDisconnectBtn').classList.toggle('hidden',!hasCreds);
  const eanSel=$('#egdEanSelect'),profSel=$('#egdProfileSelect');
  if(state.egd.oms.length){
    eanSel.innerHTML=state.egd.oms.map(o=>`<option value="${escapeHtml(o.ean)}" ${o.ean===state.egd.ean?'selected':''}>${escapeHtml(o.ean)} · ${escapeHtml(o.typMereni||'')}</option>`).join('');
    const electric=state.egd.profiles.filter(p=>String(p.komodita||'').toUpperCase()==='ELEKTRINA');
    profSel.innerHTML=electric.map(p=>`<option value="${escapeHtml(p.kod)}" ${p.kod===state.egd.profile?'selected':''}>${escapeHtml(p.nazev||p.kod)} · ${escapeHtml(p.kod)}</option>`).join('');
  }
  if(state.egd.verified)setEgdUiState('ok','Připojeno',state.egd.lastSync?`Poslední synchronizace: ${new Date(state.egd.lastSync).toLocaleString('cs-CZ')}`:'Připojení ověřeno. Data lze synchronizovat.');
  else if(state.egd.lastError)setEgdUiState('error','Chyba připojení',state.egd.lastError);
  else if(hasCreds)setEgdUiState('warn','Připraveno','Přístupové údaje jsou uložené lokálně. Ověř připojení nebo spusť synchronizaci.');
  else setEgdUiState('','Nepřipojeno','Po ověření připojení aplikace načte dostupná odběrná místa a profily.');
}
function apiValueToKw(value,units,intervalMinutes=15){
  const n=Number(value);if(!Number.isFinite(n))return null;
  const u=String(units||'').toUpperCase().replace(/\s+/g,'');
  if(u==='KW')return n;if(u==='W')return n/1000;if(u==='MW')return n*1000;
  const hours=intervalMinutes/60;
  if(u==='KWH')return n/hours;if(u==='WH')return n/1000/hours;if(u==='MWH')return n*1000/hours;
  throw new Error(`Nepodporovaná jednotka z EG.D: ${units||'neuvedena'}.`);
}
function pragueMonthQueryBounds(monthKey){
  const [year,month]=monthKey.split('-').map(Number),nextMonth=month===12?1:month+1,nextYear=month===12?year+1:year;
  const start=pragueUtcCandidates(parseCzTimestamp(`01.${String(month).padStart(2,'0')}.${year} 00:00:00`))[0];
  const next=pragueUtcCandidates(parseCzTimestamp(`01.${String(nextMonth).padStart(2,'0')}.${nextYear} 00:00:00`))[0];
  if(!Number.isFinite(start)||!Number.isFinite(next))throw new Error('Nepodařilo se určit UTC hranice měsíce.');
  const fullEnd=next-15*60000,nowRounded=Math.floor(Date.now()/(15*60000))*(15*60000);
  return {from:new Date(start).toISOString(),to:new Date(Math.min(fullEnd,nowRounded)).toISOString(),start,end:fullEnd,isPast:Date.now()>=next};
}
function apiLocalRecord(ean,profile,units,item,seen){
  const ms=Date.parse(item.timestamp);if(!Number.isFinite(ms))return null;
  const p=pragueParts(ms),source=sourceStamp(p.year,p.month,p.day,p.hour,p.minute),occ=seen.get(source)||0;seen.set(source,occ+1);
  const kw=apiValueToKw(item.value,units,15);if(kw===null)return null;
  return {id:`${ean}|egd|${ms}`,ean,meter:'EG.D OpenAPI',monthKey:`${p.year}-${String(p.month).padStart(2,'0')}`,dateKey:`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`,sourceTimestamp:source,displayTimestamp:`${String(p.day).padStart(2,'0')}.${String(p.month).padStart(2,'0')}.${p.year} ${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}${occ?' ['+(occ+1)+']':''}`,occurrenceIndex:occ,sortKey:ms,year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute,weekday:weekdayMon(p),intervalMinutes:15,dcc0:null,dcc1:kw,dkc0:null,dkc1:null,dmc0:null,dmc1:null,apiStatus:String(item.status||''),apiProfile:profile,apiUnits:units,source:'egd-api'};
}
async function fetchEgdMonth(token,monthKey){
  const bounds=pragueMonthQueryBounds(monthKey);
  if(Date.parse(bounds.to)<Date.parse(bounds.from))return null;
  const raw=await egdGet('/spotreby',token,{ean:state.egd.ean,profile:state.egd.profile,from:bounds.from,to:bounds.to});
  const groups=Array.isArray(raw)?raw:[raw],group=groups.find(x=>x?.profile===state.egd.profile)||groups.find(x=>Array.isArray(x?.data));
  if(!group||!Array.isArray(group.data)||!group.data.length)return null;
  const units=String(group.units||''),statusCounts={};for(const x of group.data){const k=String(x.status||'?');statusCounts[k]=(statusCounts[k]||0)+1}
  const seen=new Map(),records=group.data.slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).map(x=>apiLocalRecord(state.egd.ean,state.egd.profile,units,x,seen)).filter(Boolean).filter(r=>r.monthKey===monthKey);
  if(!records.length)return null;
  const [year,month]=monthKey.split('-').map(Number),validation=bounds.isPast?validateMonthTimeline(records,year,month):{complete:false,expectedCount:[...expectedTimestampCounts(year,month).values()].reduce((a,b)=>a+b,0),issues:[]};
  const complete=bounds.isPast&&validation.complete&&(statusCounts.F||0)===0;
  const lastMs=Math.max(...records.map(r=>r.sortKey)),label=`${MONTH_NAMES[month-1]} ${year}`;
  return {records,month:{monthKey,label,year,month,ean:state.egd.ean,meter:'EG.D OpenAPI',count:records.length,expectedCount:validation.expectedCount,complete,incompleteDays:complete?0:1,validationVersion:3,enabled:true,finance:emptyFinance(),first:records[0].sourceTimestamp,last:records.at(-1).sourceTimestamp,importedAt:new Date().toISOString(),fileName:'EG.D OpenAPI',source:'egd-api',apiProfile:state.egd.profile,apiUnits:units,apiStatusCounts:statusCounts,lastAvailableAt:new Date(lastMs).toISOString(),syncedAt:new Date().toISOString()}};
}
async function persistEgdMonth(payload){
  if(!payload)return {saved:false,reason:'no-data'};
  const previous=state.months.find(m=>m.monthKey===payload.month.monthKey);
  if(previous?.complete&&previous.source!=='egd-api')return {saved:false,reason:'kept-xlsx'};
  if(previous?.complete&&payload.month.complete!==true)return {saved:false,reason:'kept-complete'};
  await persistImport(payload,!!previous);return {saved:true,reason:payload.month.complete?'complete':'partial'};
}
function currentAndPreviousMonthKeys(){
  const p=pragueParts(Date.now()),idx=monthIndex(`${p.year}-${String(p.month).padStart(2,'0')}`);
  return [monthKeyFromIndex(idx-1),monthKeyFromIndex(idx)];
}
async function syncEgdData(){
  await saveEgdSelections();
  if(!state.egd.clientId||!state.egd.clientSecret||!state.egd.ean||!state.egd.profile)throw new Error('Nejdřív ověř EG.D připojení a vyber odběrné místo a profil.');
  setEgdUiState('warn','Synchronizuji…','Stahuji předchozí a aktuální měsíc z EG.D.');
  try{
    const token=await egdToken(),results=[];
    for(const key of currentAndPreviousMonthKeys()){
      showToast(`EG.D: načítám ${monthLabel(key)}…`);
      const payload=await fetchEgdMonth(token,key),saved=await persistEgdMonth(payload);results.push({key,payload,saved});
    }
    state.egd.lastSync=new Date().toISOString();state.egd.verified=true;state.egd.lastError=null;await saveEgdConfig();
    state.resetExportRange=true;await reload();
    const saved=results.filter(x=>x.saved.saved).length,noData=results.filter(x=>!x.payload).length,last=results.map(x=>x.payload?.month?.lastAvailableAt).filter(Boolean).sort().at(-1);
    setEgdUiState('ok','Připojeno',`Synchronizováno ${saved} měsíců${noData?' · bez dat: '+noData:''}${last?' · poslední hodnota '+new Date(last).toLocaleString('cs-CZ'):''}`);
    showToast('EG.D data byla synchronizována');
  }catch(e){state.egd.lastError=e.message;setEgdUiState('error','Chyba synchronizace',e.message);throw e}
}

// ---------- Analytics ----------
const val = r => {const n=Number(r[state.metric]);return Number.isFinite(n)?n:0};
const energy = r => val(r)*((Number(r.intervalMinutes)||15)/60);
function monthEnabled(k){const m=state.months.find(x=>x.monthKey===k);return !m||m.enabled!==false}
function sortedRecords(){return state.records.filter(r=>monthEnabled(r.monthKey)).sort((a,b)=>a.sortKey-b.sortKey||a.id.localeCompare(b.id))}
const billingEnergy = r => {const n=Number(r.dcc1);return Number.isFinite(n)?n*((Number(r.intervalMinutes)||15)/60):0};
function monthMeta(k){return state.months.find(m=>m.monthKey===k)||null}
function monthInvoice(k){const m=monthMeta(k),f=normalizeFinance(m?.finance);return f.invoiceTotal}
function monthBillingEnergy(k){return state.records.filter(r=>r.monthKey===k).reduce((sum,r)=>sum+billingEnergy(r),0)}
function monthEffectivePrice(k){const invoice=monthInvoice(k),kwh=monthBillingEnergy(k);return invoice!==null&&kwh>0?invoice/kwh:null}
function costForRecords(rs){
  const groups=new Map();for(const r of rs){if(!groups.has(r.monthKey))groups.set(r.monthKey,[]);groups.get(r.monthKey).push(r)}
  let total=0,coveredEnergy=0,knownMonths=0;const missing=[],unallocatable=[],monthCosts=new Map();
  for(const [k,selected] of groups){
    const invoice=monthInvoice(k);if(invoice===null){missing.push(k);continue}
    const full=state.records.filter(r=>r.monthKey===k),fullEnergy=full.reduce((a,r)=>a+billingEnergy(r),0),selectedEnergy=selected.reduce((a,r)=>a+billingEnergy(r),0),isFull=selected.length===full.length;
    let cost=null;
    if(isFull)cost=invoice;
    else if(fullEnergy>0)cost=invoice*(selectedEnergy/fullEnergy);
    else unallocatable.push(k);
    if(cost!==null){total+=cost;coveredEnergy+=selectedEnergy;knownMonths++;monthCosts.set(k,cost)}
  }
  return {total,coveredEnergy,knownMonths,missing,unallocatable,monthCosts,groupCount:groups.size};
}
function dailyCostData(rs){
  const out=new Map(),groups=new Map();for(const r of rs){if(!groups.has(r.monthKey))groups.set(r.monthKey,[]);groups.get(r.monthKey).push(r)}
  for(const [k,selected] of groups){
    const invoice=monthInvoice(k),fullEnergy=monthBillingEnergy(k);if(invoice===null||fullEnergy<=0)continue;
    const rate=invoice/fullEnergy;
    for(const r of selected)out.set(r.dateKey,(out.get(r.dateKey)||0)+billingEnergy(r)*rate);
  }
  return out;
}
function monthLabel(k){const [y,m]=String(k).split('-').map(Number);return y&&m?`${MONTH_NAMES[m-1]} ${y}`:'—'}
function monthIndex(k){const [y,m]=String(k).split('-').map(Number);return Number.isFinite(y)&&Number.isFinite(m)?y*12+(m-1):null}
function monthKeyFromIndex(idx){const y=Math.floor(idx/12),m=((idx%12)+12)%12+1;return `${y}-${String(m).padStart(2,'0')}`}
function latestMonthKey(){return state.months.length?[...state.months].sort((a,b)=>a.monthKey.localeCompare(b.monthKey)).at(-1).monthKey:(state.records.length?sortedRecords().at(-1).monthKey:'')}
function earliestDateKey(){const all=sortedRecords();return all.length?all[0].dateKey:''}
function latestDateKey(){const all=sortedRecords();return all.length?all.at(-1).dateKey:''}
function formatDateKey(k){if(!k)return '—';const [y,m,d]=k.split('-');return `${d}.${m}.${y}`}
function persistPeriodState(){
  localStorage.setItem(PERIOD_KEY,state.period);
  if(state.anchorMonth)localStorage.setItem(ANCHOR_KEY,state.anchorMonth);
  if(state.customFrom)localStorage.setItem(CUSTOM_FROM_KEY,state.customFrom);
  if(state.customTo)localStorage.setItem(CUSTOM_TO_KEY,state.customTo);
}
function ensurePeriodState(){
  if(!/^\d{4}-\d{2}$/.test(state.anchorMonth))state.anchorMonth=latestMonthKey();
  if(!state.customFrom)state.customFrom=earliestDateKey();
  if(!state.customTo)state.customTo=latestDateKey();
  if(state.customFrom&&state.customTo&&state.customFrom>state.customTo)[state.customFrom,state.customTo]=[state.customTo,state.customFrom];
  persistPeriodState();
}
function anchorIndex(){const i=monthIndex(state.anchorMonth||latestMonthKey());return i===null?0:i}
function currentRange(){
  if(!state.records.length)return [];
  const all=sortedRecords();
  if(state.period==='all')return all;
  if(state.period==='custom')return all.filter(r=>(!state.customFrom||r.dateKey>=state.customFrom)&&(!state.customTo||r.dateKey<=state.customTo));
  const idx=anchorIndex();
  if(state.period==='month'){const k=monthKeyFromIndex(idx);return all.filter(r=>r.monthKey===k)}
  if(state.period==='3m'){const start=idx-2;return all.filter(r=>{const x=monthIndex(r.monthKey);return x>=start&&x<=idx})}
  if(state.period==='year'){const y=Math.floor(idx/12);return all.filter(r=>r.year===y)}
  return all;
}
function sumEnergy(rs){return rs.reduce((s,r)=>s+energy(r),0)}
function group(rs,keyFn,valFn=energy){const m=new Map();rs.forEach(r=>{const k=keyFn(r);m.set(k,(m.get(k)||0)+valFn(r))});return m}
function groupAvg(rs,keyFn,valFn=val){const sum=new Map(),count=new Map();rs.forEach(r=>{const k=keyFn(r);sum.set(k,(sum.get(k)||0)+valFn(r));count.set(k,(count.get(k)||0)+1)});return new Map([...sum].map(([k,v])=>[k,v/count.get(k)]))}
function selectedPeriodLabel(){
  if(state.period==='all')return sortedRecords().length?`${formatDateKey(earliestDateKey())} – ${formatDateKey(latestDateKey())}`:'Žádná aktivní data';
  if(state.period==='custom')return `${formatDateKey(state.customFrom)} – ${formatDateKey(state.customTo)}`;
  const idx=anchorIndex();
  if(state.period==='month')return monthLabel(monthKeyFromIndex(idx));
  if(state.period==='3m')return `${monthLabel(monthKeyFromIndex(idx-2))} – ${monthLabel(monthKeyFromIndex(idx))}`;
  if(state.period==='year')return String(Math.floor(idx/12));
  return '—';
}
function expectedCurrentMonthKeys(){
  if(state.period==='all'||state.period==='custom')return [];
  const idx=anchorIndex();
  if(state.period==='month')return [monthKeyFromIndex(idx)];
  if(state.period==='3m')return [idx-2,idx-1,idx].map(monthKeyFromIndex);
  if(state.period==='year'){const y=Math.floor(idx/12);return Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`)}
  return [];
}
function expectedPreviousMonthKeys(){
  if(state.period==='all'||state.period==='custom')return [];
  const idx=anchorIndex();
  if(state.period==='month')return [monthKeyFromIndex(idx-1)];
  if(state.period==='3m')return [idx-5,idx-4,idx-3].map(monthKeyFromIndex);
  if(state.period==='year'){const y=Math.floor(idx/12)-1;return Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`)}
  return [];
}
function monthIsComplete(k){const m=state.months.find(x=>x.monthKey===k);return !!m&&m.enabled!==false&&(m.complete===true||(m.complete===undefined&&m.incompleteDays===0))}
function monthIsLivePartial(k){const m=state.months.find(x=>x.monthKey===k);return !!m&&m.enabled!==false&&m.source==='egd-api'&&m.complete!==true&&!!m.lastAvailableAt}
function monthIsDisabled(k){const m=state.months.find(x=>x.monthKey===k);return !!m&&m.enabled===false}
function keysContainDisabled(keys){return keys.some(monthIsDisabled)}
function keysComplete(keys){return keys.length>0&&keys.every(monthIsComplete)}
function previousComparable(){
  const keys=expectedPreviousMonthKeys();if(!keys.length)return [];
  const set=new Set(keys);return sortedRecords().filter(r=>set.has(r.monthKey));
}
function navigatePeriod(direction){
  if(!['month','3m','year'].includes(state.period)||!state.months.length)return;
  const jump=state.period==='year'?12:1,current=anchorIndex(),target=current+direction*jump,keys=state.months.map(m=>m.monthKey).sort(),min=monthIndex(keys[0]),max=monthIndex(keys.at(-1));
  if(target<min||target>max)return;
  state.anchorMonth=monthKeyFromIndex(target);
  persistPeriodState();renderPeriodControls();renderOverview();renderAnalysis();
}
function setPeriod(period){
  if(!['month','3m','year','custom','all'].includes(period))return;
  state.period=period;ensurePeriodState();persistPeriodState();renderPeriodControls();renderOverview();renderAnalysis();
}

// ---------- SVG charts ----------
function niceAxisMax(max){
  if(!Number.isFinite(max)||max<=0)return 1;
  const rough=max/4,pow=10**Math.floor(Math.log10(rough)),n=rough/pow;
  const step=(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*pow;
  return Math.ceil(max/step)*step;
}
function chartValue(v,unit=''){
  if(!Number.isFinite(v))return '—';
  if(unit==='Kč')return `${fmt.format(v)} Kč`;
  if(unit==='Kč/kWh')return `${fmt.format(v)} Kč/kWh`;
  if(unit==='kW')return `${fmt.format(v)} kW`;
  if(unit==='kWh/den')return `${fmt3.format(v)} kWh/den`;
  if(unit==='kWh')return `${fmt3.format(v)} kWh`;
  return fmt.format(v);
}
function lineChart(el,data,{hero=false,unit='kWh'}={}){
  if(!data.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=hero?190:220,p={l:58,r:12,t:24,b:30},vals=data.map(d=>Number(d.value)||0),axisMax=niceAxisMax(Math.max(...vals,0.001)),ticks=Array.from({length:5},(_,i)=>axisMax*i/4);
  const x=i=>p.l+(i/(Math.max(1,data.length-1)))*(w-p.l-p.r),y=v=>p.t+(1-v/axisMax)*(h-p.t-p.b);
  const pts=data.map((d,i)=>`${x(i)},${y(Number(d.value)||0)}`).join(' '),area=`${p.l},${h-p.b} ${pts} ${w-p.r},${h-p.b}`;
  const xlabels=data.length<=8?data:data.filter((_,i)=>i===0||i===data.length-1||i%Math.ceil(data.length/5)===0);
  const maxIndex=vals.indexOf(Math.max(...vals)),labelIdx=new Set(data.length<=10?data.map((_,i)=>i):[maxIndex,data.length-1]);
  const grid=hero?'rgba(255,255,255,.13)':'var(--border)',text=hero?'#afbdd0':'var(--muted)';
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="graf">
    <defs><linearGradient id="g${hero?'h':'l'}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hero?'#67a9ff':'var(--accent)'}" stop-opacity=".32"/><stop offset="1" stop-color="${hero?'#67a9ff':'var(--accent)'}" stop-opacity="0"/></linearGradient></defs>
    <text class="chart-y-label" x="${p.l}" y="12" text-anchor="start" fill="${text}">${escapeHtml(unit)}</text>
    ${ticks.map(t=>`<line x1="${p.l}" x2="${w-p.r}" y1="${y(t)}" y2="${y(t)}" stroke="${grid}" stroke-width="1"/><text class="chart-y-label" x="${p.l-7}" y="${y(t)+3}" text-anchor="end" fill="${text}">${escapeHtml(chartValue(t,unit).replace(' '+unit,''))}</text>`).join('')}
    <polygon points="${area}" fill="url(#g${hero?'h':'l'})"/>
    <polyline points="${pts}" fill="none" stroke="${hero?'#8fc1ff':'var(--accent)'}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>
    ${[...labelIdx].filter(i=>i>=0).map(i=>`<circle cx="${x(i)}" cy="${y(vals[i])}" r="3.5" fill="${hero?'#fff':'var(--accent)'}"><title>${escapeHtml(data[i].label)}: ${escapeHtml(chartValue(vals[i],unit))}</title></circle><text class="chart-value-label" x="${x(i)}" y="${Math.max(11,y(vals[i])-8)}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" fill="${text}">${escapeHtml(chartValue(vals[i],unit).replace(' '+unit,''))}</text>`).join('')}
    ${xlabels.map(d=>{const i=data.indexOf(d);return `<text x="${x(i)}" y="${h-7}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" font-size="10" fill="${text}">${escapeHtml(d.label)}</text>`}).join('')}
  </svg>`;
}
function barChart(el,data,{unit='kWh',showValues=true}={}){
  if(!data.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=225,p={l:58,r:10,t:28,b:38},vals=data.map(d=>Number(d.value)||0),axisMax=niceAxisMax(Math.max(...vals,0.001)),ticks=Array.from({length:5},(_,i)=>axisMax*i/4),slot=(w-p.l-p.r)/data.length,bw=Math.max(5,slot*.56),y=v=>p.t+(1-v/axisMax)*(h-p.t-p.b);
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <text class="chart-y-label" x="${p.l}" y="12" text-anchor="start" fill="var(--muted)">${escapeHtml(unit)}</text>
    ${ticks.map(t=>`<line x1="${p.l}" x2="${w-p.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/><text class="chart-y-label" x="${p.l-7}" y="${y(t)+3}" text-anchor="end" fill="var(--muted)">${escapeHtml(chartValue(t,unit).replace(' '+unit,''))}</text>`).join('')}
    ${data.map((d,i)=>{const v=vals[i],bh=(v/axisMax)*(h-p.t-p.b),x=p.l+i*slot+(slot-bw)/2,yy=h-p.b-bh,label=showValues&&data.length<=12?`<text class="chart-value-label" x="${x+bw/2}" y="${Math.max(11,yy-6)}" text-anchor="middle" fill="var(--muted)">${escapeHtml(chartValue(v,unit).replace(' '+unit,''))}</text>`:'';return `<rect x="${x}" y="${yy}" width="${bw}" height="${Math.max(1,bh)}" rx="5" fill="var(--accent)" opacity="${.55+.4*(v/axisMax)}"><title>${escapeHtml(d.label)}: ${escapeHtml(chartValue(v,unit))}</title></rect>${label}<text x="${x+bw/2}" y="${h-13}" text-anchor="middle" font-size="9" fill="var(--muted)">${escapeHtml(d.short||d.label)}</text>`}).join('')}
  </svg>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

// ---------- Rendering ----------
async function reload(){state.records=await getAll('intervals');state.months=await getAll('months');ensurePeriodState();renderAll()}
function renderAll(){
  const has=state.records.length>0;
  $('#emptyState').classList.toggle('hidden',has);$('#overviewContent').classList.toggle('hidden',!has);
  renderPeriodControls();renderOverview();renderAnalysis();renderMonths();renderExportDefaults();renderEgdPanel();
}
function renderPeriodControls(){
  $$('.period-chip').forEach(b=>b.classList.toggle('active',b.dataset.period===state.period));
  const nav=$('#periodNavigator'),custom=$('#customPeriodControls'),allLabel=$('#allPeriodLabel');
  nav.classList.toggle('hidden',!['month','3m','year'].includes(state.period));
  custom.classList.toggle('hidden',state.period!=='custom');
  allLabel.classList.toggle('hidden',state.period!=='all');
  if(state.period==='custom'){
    $('#customFrom').value=state.customFrom||'';
    $('#customTo').value=state.customTo||'';
  }
  if(['month','3m','year'].includes(state.period)){
    $('#periodAnchorLabel').textContent=selectedPeriodLabel();
    $('#anchorMonthInput').value=state.anchorMonth||'';
    const keys=state.months.map(m=>m.monthKey).sort(),first=keys[0],last=keys.at(-1);
    if(first)$('#anchorMonthInput').min=first;if(last)$('#anchorMonthInput').max=last;
    const idx=anchorIndex(),firstIdx=first?monthIndex(first):idx,lastIdx=last?monthIndex(last):idx,jump=state.period==='year'?12:1;
    $('#periodPrev').disabled=idx-jump<firstIdx;
    $('#periodNext').disabled=idx+jump>lastIdx;
  }
  if(state.period==='all')allLabel.textContent=state.records.length?selectedPeriodLabel():'Všechna importovaná data';
}
function renderOverview(){
  const costMode=state.dashboardMode==='cost';
  $$('.dashboard-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.dashboardMode===state.dashboardMode));
  $('#metricToggle').classList.toggle('hidden',costMode);
  $('#effectivePricePanel').classList.toggle('hidden',!costMode);
  $$('.metric-btn').forEach(b=>b.classList.toggle('active',b.dataset.metric===state.metric));

  const activeMonths=state.months.filter(m=>m.enabled!==false).sort((a,b)=>a.monthKey.localeCompare(b.monthKey));
  if(costMode){
    const costMonthly=activeMonths.map(m=>({label:monthLabel(m.monthKey),short:m.monthKey.slice(5,7)+'/'+m.monthKey.slice(2,4),value:monthInvoice(m.monthKey)})).filter(x=>x.value!==null);
    const priceMonthly=activeMonths.map(m=>({label:monthLabel(m.monthKey),short:m.monthKey.slice(5,7)+'/'+m.monthKey.slice(2,4),value:monthEffectivePrice(m.monthKey)})).filter(x=>x.value!==null);
    $('#monthlyChartTitle').textContent='Náklady po měsících';
    $('#monthlyChartSubtitle').textContent='Celkové částky z vyplněných faktur';
    barChart($('#monthlyChart'),costMonthly,{unit:'Kč'});
    lineChart($('#effectivePriceChart'),priceMonthly,{unit:'Kč/kWh'});
  }else{
    const monthly=group(sortedRecords(),r=>r.monthKey),md=[...monthly].sort().map(([k,v])=>({label:monthLabel(k),short:k.slice(5,7)+'/'+k.slice(2,4),value:v}));
    $('#monthlyChartTitle').textContent='Spotřeba po měsících';
    $('#monthlyChartSubtitle').textContent='Dlouhodobý vývoj importovaných dat';
    barChart($('#monthlyChart'),md,{unit:'kWh'});
  }

  const rs=currentRange();
  $('#heroPeriod').textContent=selectedPeriodLabel();

  if(!rs.length){
    const expected=expectedCurrentMonthKeys(),disabled=expected.length&&keysContainDisabled(expected);
    $('#heroKwh').textContent='—';$('#heroUnit').textContent=costMode?'Kč':'kWh';
    $('#heroDelta').textContent=disabled?'Zvolené období obsahuje vypnutá data':'Pro zvolené období nejsou aktivní data';
    lineChart($('#mainChart'),[],{hero:true,unit:costMode?'Kč':'kWh'});
    $('#avgDay').textContent='—';$('#maxPower').textContent='—';$('#bestDay').textContent='—';$('#baseLoad').textContent='—';
    $('#avgDayLabel').textContent=costMode?'Průměr / den':'Denní průměr';$('#avgDayUnit').textContent=costMode?'Kč / den':'kWh / den';
    $('#maxPowerLabel').textContent=costMode?'Efektivní cena':'Maximum';$('#maxPowerSub').textContent=costMode?'Kč / kWh':'kW';
    $('#bestDayLabel').textContent=costMode?'Nejdražší měsíc':'Nejsilnější den';$('#bestDaySub').textContent='—';
    $('#baseLoadLabel').textContent=costMode?'Pokrytí faktur':'Základní odběr';$('#baseLoadUnit').textContent=costMode?'měsíce s cenou':'průměr 00–06 h';
    return;
  }

  if(costMode){
    const cb=costForRecords(rs),daily=dailyCostData(rs),dailyData=[...daily].sort().map(([k,v])=>({label:k.slice(8,10)+'.'+k.slice(5,7)+'.',value:v}));
    $('#heroUnit').textContent='Kč';
    $('#heroKwh').textContent=cb.knownMonths?fmt.format(cb.total):'—';
    if(!cb.knownMonths)$('#heroDelta').textContent='Pro zvolené období není vyplněná žádná faktura';
    else if(cb.missing.length)$('#heroDelta').textContent=`Neúplné náklady · chybí ${cb.missing.length} ${cb.missing.length===1?'faktura':'faktury'}`;
    else if(cb.unallocatable.length)$('#heroDelta').textContent='Část nákladů nelze rozdělit na neúplné nulové období';
    else if(state.period==='custom')$('#heroDelta').textContent='Vlastní období · náklady jsou poměrně přepočtené podle DCC1';
    else if(state.period==='all')$('#heroDelta').textContent='Součet všech vyplněných faktur';
    else{
      const prev=costForRecords(previousComparable()),prevKeys=expectedPreviousMonthKeys();
      const prevReady=prevKeys.length&&prevKeys.every(k=>monthInvoice(k)!==null&&monthIsComplete(k))&&prev.knownMonths===prevKeys.length;
      if(prevReady&&prev.total>0){const delta=(cb.total-prev.total)/prev.total*100;$('#heroDelta').textContent=`${delta>=0?'▲':'▼'} ${fmt.format(Math.abs(delta))} % proti předchozímu období`}
      else $('#heroDelta').textContent='Předchozí období nemá kompletní finanční data';
    }
    lineChart($('#mainChart'),dailyData,{hero:true,unit:'Kč'});
    const dayCount=Math.max(1,new Set(rs.map(r=>r.dateKey)).size);
    $('#avgDayLabel').textContent='Průměr / den';$('#avgDay').textContent=cb.knownMonths?fmt.format(cb.total/dayCount):'—';$('#avgDayUnit').textContent='Kč / den';
    $('#maxPowerLabel').textContent='Efektivní cena';$('#maxPower').textContent=cb.coveredEnergy>0?fmt.format(cb.total/cb.coveredEnergy):'—';$('#maxPowerSub').textContent='Kč / kWh · podle DCC1';
    const expensive=[...cb.monthCosts].sort((a,b)=>b[1]-a[1])[0];
    $('#bestDayLabel').textContent='Nejdražší měsíc';$('#bestDay').textContent=expensive?`${expensive[0].slice(5,7)}/${expensive[0].slice(2,4)}`:'—';$('#bestDaySub').textContent=expensive?`${fmt.format(expensive[1])} Kč`:'—';
    $('#baseLoadLabel').textContent='Pokrytí faktur';$('#baseLoad').textContent=`${cb.knownMonths}/${cb.groupCount}`;$('#baseLoadUnit').textContent='měsíců s cenou';
    return;
  }

  $('#heroUnit').textContent='kWh';
  const total=sumEnergy(rs);$('#heroKwh').textContent=fmt.format(total);
  if(state.period==='all')$('#heroDelta').textContent='Celé dostupné období';
  else if(state.period==='custom')$('#heroDelta').textContent='Vlastní zvolené období';
  else{
    const currentKeys=expectedCurrentMonthKeys(),prevKeys=expectedPreviousMonthKeys(),prev=previousComparable(),prevTotal=sumEnergy(prev);
    if(keysContainDisabled(currentKeys))$('#heroDelta').textContent='Období obsahuje vypnutý měsíc';
    else if(currentKeys.some(monthIsLivePartial)){
      const live=state.months.find(m=>currentKeys.includes(m.monthKey)&&monthIsLivePartial(m.monthKey));
      $('#heroDelta').textContent=live?.lastAvailableAt?`Průběžná data do ${new Date(live.lastAvailableAt).toLocaleString('cs-CZ')}`:'Průběžná data z EG.D';
    }
    else if(!keysComplete(currentKeys))$('#heroDelta').textContent='Neúplné období · chybí importované měsíce';
    else if(!keysComplete(prevKeys))$('#heroDelta').textContent='Předchozí srovnatelné období není kompletní';
    else if(prevTotal===0)$('#heroDelta').textContent='Předchozí období: 0 kWh';
    else{const delta=(total-prevTotal)/prevTotal*100;$('#heroDelta').textContent=`${delta>=0?'▲':'▼'} ${fmt.format(Math.abs(delta))} % proti předchozímu období`}
  }
  const daily=group(rs,r=>r.dateKey),dailyData=[...daily].sort().map(([k,v])=>({label:k.slice(8,10)+'.'+k.slice(5,7)+'.',value:v}));
  lineChart($('#mainChart'),dailyData,{hero:true,unit:'kWh'});
  $('#avgDayLabel').textContent='Denní průměr';$('#avgDay').textContent=fmt3.format(total/Math.max(1,daily.size));$('#avgDayUnit').textContent='kWh / den';
  const peak=rs.reduce((a,b)=>val(b)>val(a)?b:a,rs[0]);$('#maxPowerLabel').textContent='Maximum';$('#maxPower').textContent=fmt.format(val(peak));$('#maxPowerSub').textContent=`kW · ${peak.displayTimestamp}`;
  const best=[...daily].sort((a,b)=>b[1]-a[1])[0];$('#bestDayLabel').textContent='Nejsilnější den';$('#bestDay').textContent=best?`${best[0].slice(8,10)}.${best[0].slice(5,7)}.`:'—';$('#bestDaySub').textContent=best?`${fmt3.format(best[1])} kWh`:'—';
  const night=rs.filter(r=>r.hour<6);$('#baseLoadLabel').textContent='Základní odběr';$('#baseLoad').textContent=night.length?`${fmt.format(night.reduce((sum,r)=>sum+val(r),0)/night.length*1000)} W`:'—';$('#baseLoadUnit').textContent='průměr 00–06 h';
}
function renderAnalysis(){
  const rs=currentRange();
  if(!rs.length){
    const expected=expectedCurrentMonthKeys(),message=expected.length&&keysContainDisabled(expected)?'Zvolené období obsahuje vypnutá data':'Pro zvolené období nejsou aktivní data';
    ['weekdayChart','hourlyChart','heatmap','daypartList','peaksList'].forEach(id=>$('#'+id).innerHTML=`<div class="chart-empty">${message}</div>`);
    $('#daypartSubtitle').textContent=message;
    return;
  }
  const dateTotals=group(rs,r=>r.dateKey),dateWeek={};rs.forEach(r=>dateWeek[r.dateKey]=r.weekday);
  const sums=Array(7).fill(0),counts=Array(7).fill(0);for(const [date,v] of dateTotals){const wd=dateWeek[date];sums[wd]+=v;counts[wd]++}
  barChart($('#weekdayChart'),WEEK_MON.map((d,i)=>({label:d,short:d,value:counts[i]?sums[i]/counts[i]:0})),{unit:'kWh/den'});
  const type=$('#dayTypeSelect').value,filtered=rs.filter(r=>type==='all'||(type==='workday'&&r.weekday<5)||(type==='weekend'&&r.weekday>=5)),havg=groupAvg(filtered,r=>r.hour,val);
  lineChart($('#hourlyChart'),Array.from({length:24},(_,h)=>({label:String(h).padStart(2,'0'),value:havg.get(h)||0})),{unit:'kW'});
  renderHeatmap(rs);renderDayparts(rs);renderPeaks(rs);
}
function renderHeatmap(rs){
  const avg=groupAvg(rs,r=>`${r.weekday}|${r.hour}`,val),max=Math.max(...avg.values(),.001);let html='<div class="heat-grid"><div></div>'+Array.from({length:24},(_,h)=>`<div class="heat-label">${h}</div>`).join('');
  for(let wd=0;wd<7;wd++){html+=`<div class="heat-label">${WEEK_MON[wd]}</div>`;for(let h=0;h<24;h++){const v=avg.get(`${wd}|${h}`)||0,a=.08+.82*(v/max);html+=`<div class="heat-cell" style="background:color-mix(in srgb,var(--accent) ${Math.round(a*100)}%,var(--surface))" title="${WEEK_MON[wd]} ${h}:00 · ${fmt3.format(v)} kW"></div>`}}html+='</div>';$('#heatmap').innerHTML=html;
}
function renderDayparts(rs){
  const parts=[['Noc','0–6',r=>r.hour<6],['Ráno','6–10',r=>r.hour>=6&&r.hour<10],['Den','10–17',r=>r.hour>=10&&r.hour<17],['Večer','17–22',r=>r.hour>=17&&r.hour<22],['Pozdní','22–24',r=>r.hour>=22]],total=sumEnergy(rs)||1,dayCount=Math.max(1,new Set(rs.map(r=>r.dateKey)).size);
  const data=parts.map(([name,time,filter])=>{const kwh=sumEnergy(rs.filter(filter));return {name,time,kwh,pct:kwh/total*100,avg:kwh/dayCount}});
  const maxAvg=Math.max(...data.map(d=>d.avg),.000001),average=state.daypartMode==='average';
  $('#daypartSubtitle').textContent=average?'Průměrná energie za jeden den':'Podíl energie v částech dne';
  $$('.daypart-btn').forEach(b=>b.classList.toggle('active',b.dataset.daypartMode===state.daypartMode));
  $('#daypartList').innerHTML=data.map(d=>{const width=average?d.avg/maxAvg*100:d.pct,value=average?`${fmt3.format(d.avg)} kWh/den`:`${fmt.format(d.pct)} %`;return `<div class="daypart-row"><div><strong>${d.name}</strong><div class="kpi-unit">${d.time}</div></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,width))}%"></div></div><div class="daypart-value">${value}</div></div>`}).join('');
}
function renderPeaks(rs){const peaks=[...rs].sort((a,b)=>val(b)-val(a)).slice(0,20);$('#peaksList').innerHTML=peaks.map((r,i)=>`<div class="peak-row"><div class="peak-main"><strong>${i+1}. ${r.displayTimestamp}</strong><div>${r.monthKey} · 15min interval</div></div><div class="peak-value">${fmt.format(val(r))} kW</div></div>`).join('')}
async function renderMonths(){
  const months=[...state.months].sort((a,b)=>b.monthKey.localeCompare(a.monthKey));
  $('#monthsList').innerHTML=months.length?months.map(m=>{
    const enabled=m.enabled!==false,finance=normalizeFinance(m.finance),invoice=finance.invoiceTotal,kwh=monthBillingEnergy(m.monthKey),effective=invoice!==null&&kwh>0?invoice/kwh:null;
    const isApi=m.source==='egd-api',partial=isApi&&m.complete!==true,quality=m.apiStatusCounts||{},sourceTag=isApi?'<span class="month-source">EG.D</span>':'<span class="month-source">XLSX</span>';
    const qualityText=isApi?`W ${quality.W||0} · G ${quality.G||0} · F ${quality.F||0}`:'';
    const availability=partial&&m.lastAvailableAt?` · do ${new Date(m.lastAvailableAt).toLocaleString('cs-CZ')}`:'';
    const stateText=monthIsComplete(m.monthKey)?'✓ kompletní':partial&&enabled?'● průběžně':enabled?'⚠ zkontrolovat':'—';
    return `<div class="month-row ${enabled?'':'month-disabled'}">
      <div class="month-main">
        <strong>${escapeHtml(m.label)} ${sourceTag}</strong>
        <div>${Number(m.count||0).toLocaleString('cs-CZ')} intervalů · ${escapeHtml(m.fileName||'')}${escapeHtml(availability)}</div>
        ${isApi?`<div class="month-quality">Kvalita EG.D: ${escapeHtml(qualityText)} · profil ${escapeHtml(m.apiProfile||'—')} · ${escapeHtml(m.apiUnits||'—')}</div>`:''}
        <div class="month-finance">
          <label class="invoice-field"><span>Faktura</span><input inputmode="decimal" data-month-invoice="${m.monthKey}" value="${invoice===null?'':String(invoice).replace('.',',')}" placeholder="např. 1842"><b>Kč</b></label>
          <span class="effective-price">${effective===null?(invoice!==null&&kwh===0?'0 kWh · cenu/kWh nelze určit':'Cena/kWh —'):`Efektivně <strong>${fmt.format(effective)} Kč/kWh</strong>`}</span>
        </div>
        <div class="finance-note">Celková částka faktury. Efektivní cena = faktura ÷ spotřeba DCC1.</div>
      </div>
      <div class="month-actions">
        <label class="month-toggle" title="${enabled?'Vypnout měsíc':'Zapnout měsíc'}">
          <input type="checkbox" data-month-toggle="${m.monthKey}" ${enabled?'checked':''} aria-label="${enabled?'Vypnout':'Zapnout'} ${escapeHtml(m.label)}">
          <span class="toggle-track"><span></span></span>
          <em>${enabled?'Aktivní':'Vypnuto'}</em>
        </label>
        <div class="month-value">${stateText}</div>
        <button class="trash-btn" data-delete="${m.monthKey}" aria-label="Smazat">×</button>
      </div>
    </div>`
  }).join(''):'<div class="chart-empty">Žádná uložená data</div>';
  $$('[data-month-toggle]').forEach(x=>x.onchange=()=>setMonthEnabled(x.dataset.monthToggle,x.checked).catch(e=>{console.error(e);alert('Změnu se nepodařilo uložit: '+e.message)}));
  $$('[data-month-invoice]').forEach(x=>x.onchange=()=>setMonthInvoice(x.dataset.monthInvoice,x.value).catch(e=>{console.error(e);alert('Cenu se nepodařilo uložit: '+e.message);renderMonths()}));
  $$('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm(`Opravdu odstranit ${monthLabel(b.dataset.delete)}?`))deleteMonth(b.dataset.delete)});
}
function renderExportDefaults(){const all=sortedRecords();if(!all.length)return;const min=all[0].dateKey,max=all.at(-1).dateKey,from=$('#exportFrom'),to=$('#exportTo');if(state.resetExportRange||!from.value)from.value=min;if(state.resetExportRange||!to.value)to.value=max;state.resetExportRange=false}

// ---------- Import ----------
async function handleFile(file){
  try{
    showToast('Načítám a kontroluji XLSX…');
    const payload=await parseReport(file);
    const existingEans=[...new Set(state.records.map(r=>r.ean).filter(Boolean))];
    if(existingEans.length&&(!existingEans.includes(payload.month.ean)||existingEans.length>1))throw new Error(`Aplikace už obsahuje data pro EAN ${existingEans.join(', ')}. Importovaný report patří EAN ${payload.month.ean}. Data různých odběrných míst nemíchám.`);
    if(state.months.some(m=>m.monthKey===payload.month.monthKey)){
      state.pendingImport=payload;
      $('#replaceText').textContent=`${payload.month.label} už obsahuje uložená data. Nahradit je novým, plně zkontrolovaným reportem?`;
      $('#replaceModal').classList.remove('hidden');
    }else await saveImport(payload,false);
  }catch(e){console.error(e);alert(`Import se nepodařil:\n${e.message}`)}
  finally{$('#fileInput').value=''}
}
async function handleFiles(fileList){
  const files=[...fileList].filter(f=>/\.xlsx$/i.test(f.name));
  if(!files.length)return;
  if(files.length===1){await handleFile(files[0]);return}
  const failed=[],skipped=[],seenMonths=new Set(),existingMonths=new Set(state.months.map(m=>m.monthKey)),existingEans=[...new Set(state.records.map(r=>r.ean).filter(Boolean))];
  if(existingEans.length>1){alert('Databáze obsahuje více EAN a hromadný import byl z bezpečnostních důvodů zastaven.');$('#fileInput').value='';return}
  let targetEan=existingEans[0]||null,replaceExisting=null,imported=0,replaced=0;
  const importedMonthKeys=[],wasEmpty=!state.records.length;
  try{
    for(let i=0;i<files.length;i++){
      const file=files[i];showToast(`Kontroluji ${i+1}/${files.length}: ${file.name}`);
      let payload;
      try{payload=await parseReport(file)}
      catch(e){console.error(file.name,e);failed.push(`${file.name}: ${e.message}`);continue}
      if(!targetEan)targetEan=payload.month.ean;
      if(payload.month.ean!==targetEan){failed.push(`${file.name}: jiné EAN (${payload.month.ean})`);continue}
      if(seenMonths.has(payload.month.monthKey)){failed.push(`${file.name}: duplicitní měsíc ${payload.month.monthKey} ve výběru`);continue}
      seenMonths.add(payload.month.monthKey);
      const exists=existingMonths.has(payload.month.monthKey);
      if(exists&&replaceExisting===null){
        replaceExisting=confirm('Některé vybrané měsíce už v aplikaci existují.\n\nOK = nahradit všechny takové měsíce novými reporty\nZrušit = všechny existující měsíce přeskočit');
      }
      if(exists&&!replaceExisting){skipped.push(`${file.name}: ${payload.month.label} už existuje`);continue}
      showToast(`Ukládám ${i+1}/${files.length}: ${payload.month.label}`);
      try{
        await persistImport(payload,exists);imported++;importedMonthKeys.push(payload.month.monthKey);if(exists)replaced++;
        existingMonths.add(payload.month.monthKey);
      }catch(e){console.error(file.name,e);failed.push(`${file.name}: zápis selhal – ${e.message}`)}
    }
    if(imported){
      if(wasEmpty)state.anchorMonth=importedMonthKeys.sort().at(-1)||state.anchorMonth;
      state.resetExportRange=true;await reload();
    }
    const lines=[`Zpracováno souborů: ${files.length}`,`Importováno: ${imported}`,`Z toho nahrazeno: ${replaced}`,`Přeskočeno: ${skipped.length}`,`Chyby: ${failed.length}`];
    if(failed.length)lines.push(...failed.slice(0,5),failed.length>5?`… a dalších ${failed.length-5}`:'');
    alert(lines.filter(Boolean).join('\n'));
  }finally{$('#fileInput').value=''}
}

// ---------- Export ----------
function selectedExportRecords(){const from=$('#exportFrom').value,to=$('#exportTo').value;if(!from||!to)return [];return sortedRecords().filter(r=>r.dateKey>=from&&r.dateKey<=to)}
function aggregateExport(rs,g){
  if(g==='15m')return rs.map(r=>({period:r.displayTimestamp||r.sourceTimestamp,powerKw:val(r),energyKwh:energy(r)}));
  const keyFn=g==='hour'?r=>`${r.dateKey} ${String(r.hour).padStart(2,'0')}:00`:g==='day'?r=>r.dateKey:r=>r.monthKey;const map=new Map();rs.forEach(r=>{const k=keyFn(r),o=map.get(k)||{period:k,powerSum:0,count:0,energyKwh:0};o.powerSum+=val(r);o.count++;o.energyKwh+=energy(r);map.set(k,o)});return [...map.values()].map(o=>({period:o.period,powerKw:o.powerSum/o.count,energyKwh:o.energyKwh}))
}
function csvEscape(v){const s=String(v??'');return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
function csvNum(n){return Number(n).toFixed(4).replace('.',',')}
function exportCSV(rs,g){const rows=aggregateExport(rs,g),text='Období;Průměrný výkon (kW);Energie (kWh)\n'+rows.map(r=>[r.period,csvNum(r.powerKw),csvNum(r.energyKwh)].map(csvEscape).join(';')).join('\n');downloadBlob(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'}),`energo_${$('#exportFrom').value}_${$('#exportTo').value}.csv`)}
function xmlEscape(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function sheetXml(rows){
  const cols=Math.max(...rows.map(r=>r.length),1);let xmls='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row,ri)=>{xmls+=`<row r="${ri+1}">`;row.forEach((v,ci)=>{const ref=colName(ci)+(ri+1);if(typeof v==='number'&&Number.isFinite(v))xmls+=`<c r="${ref}"><v>${v}</v></c>`;else xmls+=`<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`});xmls+='</row>'});return xmls+'</sheetData></worksheet>';
}
function colName(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
function concat(arrs){const len=arrs.reduce((s,a)=>s+a.length,0),out=new Uint8Array(len);let p=0;for(const a of arrs){out.set(a,p);p+=a.length}return out}
function le16(n){return new Uint8Array([n&255,(n>>>8)&255])}function le32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255])}
function zipStored(files){
  const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
  for(const f of files){const name=enc.encode(f.name),data=typeof f.data==='string'?enc.encode(f.data):f.data,crc=crc32(data);const local=concat([le32(0x04034b50),le16(20),le16(0),le16(0),le16(0),le16(0),le32(crc),le32(data.length),le32(data.length),le16(name.length),le16(0),name,data]);locals.push(local);const central=concat([le32(0x02014b50),le16(20),le16(20),le16(0),le16(0),le16(0),le16(0),le32(crc),le32(data.length),le32(data.length),le16(name.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(offset),name]);centrals.push(central);offset+=local.length}
  const cd=concat(centrals),eocd=concat([le32(0x06054b50),le16(0),le16(0),le16(files.length),le16(files.length),le32(cd.length),le32(offset),le16(0)]);return concat([...locals,cd,eocd]);
}
function exportXLSX(rs,g){
  const agg=aggregateExport(rs,g),daily=aggregateExport(rs,'day');const h=groupAvg(rs,r=>r.hour,val);const dateTotals=group(rs,r=>r.dateKey);const dateWeek={};rs.forEach(r=>dateWeek[r.dateKey]=r.weekday);const sums=Array(7).fill(0),cnt=Array(7).fill(0);for(const [d,v] of dateTotals){sums[dateWeek[d]]+=v;cnt[dateWeek[d]]++}
  const total=sumEnergy(rs),peak=rs.length?rs.reduce((a,b)=>val(b)>val(a)?b:a):null,costs=costForRecords(rs),financeMonths=[...new Set(rs.map(r=>r.monthKey))].sort();
  const sheets=[
    {name:'Souhrn',rows:[['Energo Přehled'],['Od',$('#exportFrom').value],['Do',$('#exportTo').value],['Metrika',state.metric.toUpperCase()],['Celková energie (kWh)',total],['Průměr / den (kWh)',total/Math.max(1,dateTotals.size)],['Maximum výkonu (kW)',peak?val(peak):0],['Čas maxima',peak?(peak.displayTimestamp||peak.sourceTimestamp):''],['Přepočtené náklady (Kč)',costs.knownMonths?costs.total:''],['Efektivní cena (Kč/kWh)',costs.coveredEnergy>0?costs.total/costs.coveredEnergy:''],['Finanční pokrytí',`${costs.knownMonths}/${costs.groupCount} měsíců`]]},
    {name:'Data',rows:[['Období','Průměrný výkon (kW)','Energie (kWh)'],...agg.map(r=>[r.period,r.powerKw,r.energyKwh])]},
    {name:'Zdrojová data',rows:[['Čas','Výskyt','DCC0 (kW)','DCC1 (kW)','DKC0 (kVAr)','DKC1 (kVAr)','DMC0 (kVAr)','DMC1 (kVAr)'],...rs.map(r=>[r.sourceTimestamp,(r.occurrenceIndex||0)+1,r.dcc0,r.dcc1,r.dkc0??'',r.dkc1??'',r.dmc0??'',r.dmc1??''])]},
    {name:'Denní souhrny',rows:[['Datum','Průměrný výkon (kW)','Energie (kWh)'],...daily.map(r=>[r.period,r.powerKw,r.energyKwh])]},
    {name:'Hodinový profil',rows:[['Hodina','Průměrný výkon (kW)'],...Array.from({length:24},(_,i)=>[`${String(i).padStart(2,'0')}:00`,h.get(i)||0])]},
    {name:'Dny v týdnu',rows:[['Den','Průměrná spotřeba dne (kWh)'],...WEEK_MON.map((d,i)=>[d,cnt[i]?sums[i]/cnt[i]:0])]},
    {name:'Finanční přehled',rows:[['Měsíc','Faktura celkem (Kč)','DCC1 spotřeba (kWh)','Efektivní cena (Kč/kWh)'],...financeMonths.map(k=>{const invoice=monthInvoice(k),kwh=monthBillingEnergy(k),price=invoice!==null&&kwh>0?invoice/kwh:'';return [monthLabel(k),invoice??'',kwh,price]})]}
  ];
  const files=[];files.push({name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`});
  files.push({name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`});
  files.push({name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`});
  files.push({name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`});
  sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s.rows)}));const zip=zipStored(files);downloadBlob(new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`energo_${$('#exportFrom').value}_${$('#exportTo').value}.xlsx`)
}

// ---------- Backup / restore ----------
async function backupLocalData(){
  const payload={format:'energo-prehled-backup',version:1,appVersion:APP_VERSION,createdAt:new Date().toISOString(),metric:state.metric,ui:{period:state.period,anchorMonth:state.anchorMonth,customFrom:state.customFrom,customTo:state.customTo,daypartMode:state.daypartMode,dashboardMode:state.dashboardMode},records:await getAll('intervals'),months:await getAll('months')};
  downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),`energo_prehled_zaloha_${new Date().toISOString().slice(0,10)}.json`);
  showToast('Záloha dat byla vytvořena');
}
async function restoreLocalData(file){
  let payload;try{payload=JSON.parse(await file.text())}catch{throw new Error('Soubor není platná JSON záloha.')}
  if(payload?.format!=='energo-prehled-backup'||payload.version!==1||!Array.isArray(payload.records)||!Array.isArray(payload.months))throw new Error('Soubor není kompatibilní záloha Energo Přehled.');
  if(payload.records.some(r=>!r||typeof r.id!=='string'||typeof r.monthKey!=='string'||typeof r.dateKey!=='string'||!Number.isFinite(Number(r.dcc0))||!Number.isFinite(Number(r.dcc1))))throw new Error('Záloha obsahuje neplatné intervalové záznamy.');
  if(payload.months.some(m=>!m||typeof m.monthKey!=='string'||!Number.isFinite(Number(m.count))))throw new Error('Záloha obsahuje neplatná metadata měsíců.');
  if(payload.months.some(m=>{const v=m?.finance?.invoiceTotal;return v!==undefined&&v!==null&&(!Number.isFinite(Number(v))||Number(v)<0)}))throw new Error('Záloha obsahuje neplatnou cenu faktury.');
  if(!confirm(`Obnovit zálohu z ${payload.createdAt?new Date(payload.createdAt).toLocaleString('cs-CZ'):'neznámého data'}? Současná lokální data budou nahrazena.`))return;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['intervals','months'],'readwrite'),s=tx.objectStore('intervals'),m=tx.objectStore('months');
    s.clear();m.clear();payload.records.forEach(r=>s.put(r));payload.months.forEach(x=>m.put(x));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  if(payload.metric==='dcc0'||payload.metric==='dcc1'){state.metric=payload.metric;localStorage.setItem(METRIC_KEY,state.metric)}
  if(payload.ui&&typeof payload.ui==='object'){
    if(['month','3m','year','custom','all'].includes(payload.ui.period))state.period=payload.ui.period;
    if(/^\d{4}-\d{2}$/.test(payload.ui.anchorMonth||''))state.anchorMonth=payload.ui.anchorMonth;
    if(/^\d{4}-\d{2}-\d{2}$/.test(payload.ui.customFrom||''))state.customFrom=payload.ui.customFrom;
    if(/^\d{4}-\d{2}-\d{2}$/.test(payload.ui.customTo||''))state.customTo=payload.ui.customTo;
    if(['percent','average'].includes(payload.ui.daypartMode))state.daypartMode=payload.ui.daypartMode;
    if(['energy','cost'].includes(payload.ui.dashboardMode))state.dashboardMode=payload.ui.dashboardMode;
    localStorage.setItem(DAYPART_KEY,state.daypartMode);localStorage.setItem(DASHBOARD_MODE_KEY,state.dashboardMode);persistPeriodState();
  }
  state.resetExportRange=true;await reload();showToast('Záloha byla obnovena');
}

// ---------- UI events ----------
async function forceUpdateApp(){
  if(!confirm('Vynutit stažení nejnovější verze aplikace? Importovaná data, ceny faktur a nastavení zůstanou zachované.'))return;
  try{
    showToast('Čistím cache aplikace…');
    const base=new URL('./',location.href).href;
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter(r=>r.scope===base).map(r=>r.unregister()));
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('energo-prehled-beta-')||k==='energo-prehled-v1.1.0').map(k=>caches.delete(k)));
    }
    const target=new URL('./',location.href);target.searchParams.set('fresh',Date.now().toString());
    location.replace(target.href);
  }catch(e){console.error(e);alert('Aktualizaci se nepodařilo dokončit: '+e.message)}
}
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
function nav(target){$$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===target));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.target===target));$('#screenTitle').textContent={overview:'Přehled',analysis:'Analýza',data:'Data',export:'Export'}[target];window.scrollTo({top:0,behavior:'smooth'});if(target==='analysis')renderAnalysis();if(target==='data')renderMonths()}
function bind(){
  const choose=()=>$('#fileInput').click();
  $('#importBtn').onclick=choose;$('#emptyImportBtn').onclick=choose;$('#dataImportBtn').onclick=choose;
  $('#fileInput').onchange=e=>e.target.files.length&&handleFiles(e.target.files);
  $$('.nav-btn').forEach(b=>b.onclick=()=>nav(b.dataset.target));
  $$('.period-chip').forEach(b=>b.onclick=()=>setPeriod(b.dataset.period));
  $('#periodPrev').onclick=()=>navigatePeriod(-1);$('#periodNext').onclick=()=>navigatePeriod(1);
  $('#anchorMonthInput').onchange=e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.anchorMonth=e.target.value;persistPeriodState();renderPeriodControls();renderOverview();renderAnalysis()}};
  const updateCustom=()=>{
    state.customFrom=$('#customFrom').value;state.customTo=$('#customTo').value;
    if(state.customFrom&&state.customTo&&state.customFrom>state.customTo)[state.customFrom,state.customTo]=[state.customTo,state.customFrom];
    persistPeriodState();renderPeriodControls();renderOverview();renderAnalysis();
  };
  $('#customFrom').onchange=updateCustom;$('#customTo').onchange=updateCustom;
  $$('.dashboard-mode-btn').forEach(b=>b.onclick=()=>{state.dashboardMode=b.dataset.dashboardMode;localStorage.setItem(DASHBOARD_MODE_KEY,state.dashboardMode);renderOverview()});
  $$('.metric-btn').forEach(b=>b.onclick=()=>{state.metric=b.dataset.metric;localStorage.setItem(METRIC_KEY,state.metric);renderAll()});
  $('#dayTypeSelect').onchange=renderAnalysis;
  $$('.daypart-btn').forEach(b=>b.onclick=()=>{state.daypartMode=b.dataset.daypartMode;localStorage.setItem(DAYPART_KEY,state.daypartMode);renderDayparts(currentRange())});
  $('#cancelReplace').onclick=()=>{$('#replaceModal').classList.add('hidden');state.pendingImport=null};
  $('#confirmReplace').onclick=async()=>{const p=state.pendingImport;$('#replaceModal').classList.add('hidden');if(p)await saveImport(p,true)};
  $('#forceUpdateBtn').onclick=forceUpdateApp;
  $('#appVersionText').textContent=APP_VERSION;
  $('#backupDataBtn').onclick=()=>backupLocalData().catch(e=>alert('Zálohu se nepodařilo vytvořit: '+e.message));
  $('#restoreDataBtn').onclick=()=>$('#backupFileInput').click();
  $('#backupFileInput').onchange=e=>{const file=e.target.files[0];if(file)restoreLocalData(file).catch(err=>alert('Obnova se nepodařila: '+err.message)).finally(()=>e.target.value='')};
  $('#exportBtn').onclick=()=>{const rs=selectedExportRecords();if(!rs.length){alert('Ve zvoleném období nejsou data.');return}const g=$('#exportGranularity').value;if($('#exportFormat').value==='csv')exportCSV(rs,g);else exportXLSX(rs,g);showToast('Export byl vytvořen')};

  let touchStart=null;
  $('#heroCard').addEventListener('touchstart',e=>{if(state.period!=='month'||e.touches.length!==1||e.target.closest('button,input,select'))return;touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
  $('#heroCard').addEventListener('touchend',e=>{if(!touchStart||state.period!=='month'||!e.changedTouches.length){touchStart=null;return}const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)navigatePeriod(dx<0?1:-1)},{passive:true});
}

(async function init(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(console.warn);
  }
  try{db=await openDB();bind();await reload()}catch(e){console.error(e);alert('Aplikaci se nepodařilo inicializovat: '+e.message)}
})();
