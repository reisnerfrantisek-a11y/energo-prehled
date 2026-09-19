'use strict';

const CORE=window.EnergoCore,INVOICE=window.EnergoInvoice,TIME=window.EnergoTime,FORECAST=window.EnergoForecast,INVOICE_PARSER=window.EnergoInvoiceParser;
if(!CORE||!INVOICE||!TIME||!FORECAST||!INVOICE_PARSER)throw new Error('Chybí core moduly Energo aplikace.');

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const fmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 });
const fmt3 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 });
const MONTH_NAMES = ['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const WEEK = ['Ne','Po','Út','St','Čt','Pá','So'];
const WEEK_MON = ['Po','Út','St','Čt','Pá','So','Ne'];

let db;
const APP_VERSION = '1.6.7';
const IS_BETA = location.pathname.includes('/beta/');
const DB_NAME = IS_BETA ? 'energo-prehled-beta' : 'energo-prehled';
const METRIC_KEY = IS_BETA ? 'metric-beta' : 'metric';
const PERIOD_KEY = IS_BETA ? 'period-beta' : 'period';
const ANCHOR_KEY = IS_BETA ? 'anchor-beta' : 'anchor';
const CUSTOM_FROM_KEY = IS_BETA ? 'custom-from-beta' : 'custom-from';
const CUSTOM_TO_KEY = IS_BETA ? 'custom-to-beta' : 'custom-to';
const DAYPART_KEY = IS_BETA ? 'daypart-beta' : 'daypart';
const DASHBOARD_MODE_KEY = IS_BETA ? 'dashboard-mode-beta' : 'dashboard-mode';
const CHART_MODE_KEY = IS_BETA ? 'chart-mode-beta' : 'chart-mode';
const COMPARE_PREVIOUS_KEY = IS_BETA ? 'compare-previous-beta' : 'compare-previous';
const COMPARE_MODE_KEY = IS_BETA ? 'compare-mode-beta' : 'compare-mode';
const EGD_TOKEN_URL = 'https://idm.distribuce24.cz/oauth/token';
const EGD_DATA_BASE = 'https://data.distribuce24.cz/rest';
const EGD_SCOPE = 'namerena_data_openapi';
const PROFILE_ROLES = ['DCC0','DCC1','DKC0','DKC1','DMC0','DMC1'];
const ROLE_FIELDS = {DCC0:'dcc0',DCC1:'dcc1',DKC0:'dkc0',DKC1:'dkc1',DMC0:'dmc0',DMC1:'dmc1'};
const savedPeriod=localStorage.getItem(PERIOD_KEY);
const savedCompareMode=localStorage.getItem(COMPARE_MODE_KEY);
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
  chartMode: localStorage.getItem(CHART_MODE_KEY)==='cumulative'?'cumulative':'daily',
  compareMode: ['none','previous','yearAgo'].includes(savedCompareMode)?savedCompareMode:(localStorage.getItem(COMPARE_PREVIOUS_KEY)==='1'?'previous':'none'),
  egd: {clientId:'',clientSecret:'',proxyUrl:'',ean:'',profile:'',oms:[],profiles:[],statuses:[],lastSync:null,lastError:null,autoSync:false},
  pendingImport: null,
  pendingInvoicePdf: null,
  resetExportRange: false
};

// ---------- IndexedDB ----------
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,3);
    req.onupgradeneeded=()=>{
      const d=req.result,tx=req.transaction;
      let store;
      if(!d.objectStoreNames.contains('intervals')) store=d.createObjectStore('intervals',{keyPath:'id'});
      else store=tx.objectStore('intervals');
      if(!store.indexNames.contains('monthKey'))store.createIndex('monthKey','monthKey');
      if(!store.indexNames.contains('dateKey'))store.createIndex('dateKey','dateKey');
      if(!store.indexNames.contains('sortKey'))store.createIndex('sortKey','sortKey');
      if(!store.indexNames.contains('ean'))store.createIndex('ean','ean');
      if(!store.indexNames.contains('source'))store.createIndex('source','source');
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
function emptyFinance(){return INVOICE.emptyFinance()}
function normalizeFinance(finance){return INVOICE.normalizeFinance(finance)}
function parseMoneyInput(raw){
  const text=String(raw??'').replace(/[\s\u00a0]/g,'').replace(',','.').trim();
  if(!text)return null;
  const n=Number(text);if(!Number.isFinite(n)||n<0)throw new Error('Cena faktury musí být nezáporné číslo.');return Math.round(n*100)/100;
}
async function setMonthInvoice(monthKey,rawValue){
  const month=state.months.find(m=>m.monthKey===monthKey);if(!month)return;
  let finance=normalizeFinance(month.finance);const previousTotal=finance.invoiceTotal,invoiceTotal=parseMoneyInput(rawValue),changed=previousTotal!==invoiceTotal,wasPdf=finance.source==='pdf';
  if(changed&&wasPdf){
    if(!confirm('Tento měsíc obsahuje rozpad z PDF faktury. Ruční změnou celkové částky se rozpad a odvozený tarif odstraní. Pokračovat?')){renderMonths();return}
    const blank=emptyFinance(),meta={...finance.invoiceMeta,extractionStatus:'manual-adjusted',extractionConfidence:1};
    finance={...blank,invoiceMeta:meta,source:'manual'};
  }
  finance.invoiceTotal=invoiceTotal;finance.source='manual';
  finance.invoiceMeta.extractionStatus=invoiceTotal===null?'none':changed&&wasPdf?'manual-adjusted':'manual';finance.invoiceMeta.extractionConfidence=invoiceTotal===null?null:1;
  finance.totals.incVat=invoiceTotal;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('months','readwrite'),store=tx.objectStore('months');
    store.put({...month,finance});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  await reload();showToast(`${monthLabel(monthKey)}: ${invoiceTotal===null?'cena faktury odstraněna':fmt.format(invoiceTotal)+' Kč'}`);
}
const PDFJS_URL='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER_URL='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
let pdfJsPromise=null;
function loadPdfJs(){
  if(window.pdfjsLib){window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;return Promise.resolve(window.pdfjsLib)}
  if(pdfJsPromise)return pdfJsPromise;
  pdfJsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=PDFJS_URL;script.async=true;script.crossOrigin='anonymous';
    script.onload=()=>{
      if(!window.pdfjsLib){reject(new Error('Knihovna PDF.js se nenačetla.'));return}
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;resolve(window.pdfjsLib);
    };
    script.onerror=()=>reject(new Error('Nepodařilo se načíst lokální PDF parser. Zkontroluj připojení k internetu a zkus to znovu.'));
    document.head.appendChild(script);
  }).catch(e=>{pdfJsPromise=null;throw e});
  return pdfJsPromise;
}
async function extractPdfTextCandidates(file){
  if(!file||!/\.pdf$/i.test(file.name||'')&&file.type!=='application/pdf')throw new Error('Vyber PDF fakturu.');
  if(file.size>20*1024*1024)throw new Error('PDF je větší než 20 MB.');
  const pdfjs=await loadPdfJs(),data=new Uint8Array(await file.arrayBuffer());
  const doc=await pdfjs.getDocument({data}).promise;if(doc.numPages>30)throw new Error('PDF má více než 30 stran.');
  const layoutTight=[],layoutLoose=[],hybrid=[],eol=[],native=[],geometryPages=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p),viewport=page.getViewport({scale:1}),content=await page.getTextContent(),items=content.items||[];
    layoutTight.push(INVOICE_PARSER.pdfItemsToLayoutText(items,1.6));
    layoutLoose.push(INVOICE_PARSER.pdfItemsToLayoutText(items,4.5));
    hybrid.push(p===1?INVOICE_PARSER.pdfItemsToColumnFlowText(items,420,2.5):INVOICE_PARSER.pdfItemsToLayoutText(items,3));
    eol.push(INVOICE_PARSER.pdfItemsToEolText(items));
    native.push(items.map(x=>String(x.str||'')).join(' '));
    geometryPages.push({
      width:viewport.width,height:viewport.height,
      items:items.map(x=>({str:String(x.str||''),x:Number(x.transform?.[4]),y:viewport.height-Number(x.transform?.[5])})).filter(x=>x.str&&Number.isFinite(x.x)&&Number.isFinite(x.y))
    });
  }
  const pages=doc.numPages,geometryText=INVOICE_PARSER.pdfGeometryToEonText(geometryPages);try{await doc.destroy()}catch{}
  const candidates=[
    {name:'geometry',text:geometryText},
    {name:'layout-tight',text:layoutTight.join('\n')},
    {name:'layout-loose',text:layoutLoose.join('\n')},
    {name:'page1-columns',text:hybrid.join('\n')},
    {name:'pdf-eol',text:eol.join('\n')},
    {name:'pdf-native-order',text:native.join('\n')}
  ].filter(c=>c.text.trim().length>=20);
  if(!candidates.length)throw new Error('PDF neobsahuje čitelnou textovou vrstvu. Naskenované faktury zatím nejsou podporované.');
  return {candidates,pages};
}
function invoiceComponentRows(finance){
  const f=normalizeFinance(finance),c=f.components;
  const fixedDetail=[c.supplierFixed,c.breaker,c.distributionFixed,c.poze].some(v=>v!==null&&Number.isFinite(Number(v))&&Number(v)!==0);
  const rows=[
    ['Silová elektřina',c.supplyEnergy],['Stálý plat dodavatele',c.supplierFixed],['Daň z elektřiny',c.electricityTax],
    ['Distribuce podle spotřeby',c.distributionEnergy],['Plat za jistič',c.breaker],['Systémové služby',c.systemServices],
    ['Nesíťová infrastruktura',c.distributionFixed],['POZE',c.poze]
  ];
  if(!fixedDetail&&c.fixed!==null)rows.push(['Fixní složky souhrnně',c.fixed]);
  rows.push(['Ostatní',c.other],['DPH',c.vat]);
  return rows.filter(([,v])=>v!==null&&Number.isFinite(Number(v)));
}
function renderInvoiceReview(){
  const pending=state.pendingInvoicePdf,box=$('#invoiceReviewSummary'),components=$('#invoiceReviewComponents'),warnings=$('#invoiceReviewWarnings'),save=$('#confirmInvoicePdf'),cancel=$('#cancelInvoicePdf');
  if(!pending||!box||!components||!warnings||!save||!cancel)return;
  const r=pending.result,f=r.finance,t=f.tariff,m=f.metering,stored=!!pending.stored;
  save.classList.toggle('hidden',stored);save.disabled=!r.canSave;save.textContent=r.canSave?'Uložit fakturu':'Nelze uložit';cancel.textContent=stored?'Zavřít':'Zrušit';
  const title=$('#invoiceReviewTitle');if(title)title.textContent=stored?'Detail faktury':'Kontrola PDF faktury';
  box.innerHTML=[
    ['Měsíc',r.invoiceMonthKey?monthLabel(r.invoiceMonthKey):'—'],
    ['Dodavatel',f.invoiceMeta.supplier||'—'],
    ['Doklad',f.invoiceMeta.documentNumber||'—'],
    ['EAN',m.ean||'—'],
    ['Spotřeba z faktury',Number.isFinite(m.consumptionKwh)?fmt3.format(m.consumptionKwh)+' kWh':'—'],
    ['Celkem bez DPH',Number.isFinite(f.totals.exVat)?fmt.format(f.totals.exVat)+' Kč':'—'],
    ['DPH',Number.isFinite(f.totals.vat)?fmt.format(f.totals.vat)+' Kč':'—'],
    ['Celkem s DPH',Number.isFinite(f.invoiceTotal)?fmt.format(f.invoiceTotal)+' Kč':'—']
  ].map(([k,v])=>`<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('');
  components.innerHTML=invoiceComponentRows(f).map(([k,v])=>`<div><span>${escapeHtml(k)}</span><strong>${fmt.format(v)} Kč</strong></div>`).join('');
  const model=t.validated?`Tarifní model: ${fmt.format(t.fixedGrossPerMonth)} Kč/měs. + ${fmt3.format(t.variableGrossPerKwh)} Kč/kWh vč. DPH`:'Tarifní model nebyl ověřen.';
  const candidateInfo=(r.candidateScores||[]).slice(0,3).map(x=>`${x.name} ${x.score}`).join(' · ');
  const parserInfo=`Parser ${escapeHtml(r.parser||INVOICE_PARSER.PARSER_VERSION)} · ${escapeHtml(r.extractionStrategy||'standard')} · ${Number(r.extractionPages||0)||'—'} str.${candidateInfo?' · '+escapeHtml(candidateInfo):''}`;
  const fatalItems=[...(r.fatal||[])],allWarnings=[...(r.warnings||[])];
  const infoItems=allWarnings.filter(x=>/^Fixní složky .* byly převzaty souhrnně/i.test(String(x)));
  const warningItems=allWarnings.filter(x=>!infoItems.includes(x));
  const statusText=fatalItems.length?'Fakturu nelze bezpečně uložit.':warningItems.length?'Faktura vyžaduje kontrolu.':t.validated?'Faktura je připravena k uložení.':'Faktura byla načtena.';
  warnings.innerHTML=`<strong>${escapeHtml(model)}</strong><span class="invoice-review-status">${escapeHtml(statusText)}</span>${infoItems.map(x=>`<span class="invoice-review-info">${escapeHtml(x)}</span>`).join('')}${[...fatalItems,...warningItems].map(x=>`<span>${escapeHtml(x)}</span>`).join('')}<details class="invoice-tech-details"><summary>Technické detaily</summary><div>${parserInfo}</div></details>`;
  warnings.classList.toggle('has-warning',fatalItems.length>0||warningItems.length>0);
  warnings.classList.toggle('is-valid',t.validated&&fatalItems.length===0&&warningItems.length===0);
}
function showStoredInvoiceDetail(monthKey){
  const month=state.months.find(m=>m.monthKey===monthKey);if(!month)return;
  const finance=normalizeFinance(month.finance);if(finance.source!=='pdf')return;
  state.pendingInvoicePdf={monthKey,stored:true,result:{invoiceMonthKey:monthKey,finance,warnings:[],fatal:[],canSave:false,validation:{}}};
  renderInvoiceReview();$('#invoiceReviewModal').classList.remove('hidden');
}
async function handleInvoicePdfFile(file){
  const pending=state.pendingInvoicePdf;if(!pending?.monthKey)return;
  try{
    showToast('Čtu PDF fakturu lokálně…');
    const extracted=await extractPdfTextCandidates(file),result=INVOICE_PARSER.parseEonInvoiceCandidates(extracted.candidates,{fileName:file.name,importedAt:new Date().toISOString()}),target=pending.monthKey;
    result.extractionPages=extracted.pages;
    if(result.invoiceMonthKey&&result.invoiceMonthKey!==target)result.fatal.push(`Faktura patří do ${monthLabel(result.invoiceMonthKey)}, ale byla vybrána u ${monthLabel(target)}.`);
    const localEans=[...new Set(state.records.filter(r=>r.monthKey===target).map(r=>String(r.ean||'')).filter(Boolean))];
    if(result.validation.ean&&localEans.length&& !localEans.includes(result.validation.ean))result.fatal.push('EAN na faktuře neodpovídá energetickým datům zvoleného měsíce.');
    const appKwh=monthBillingEnergy(target),pdfKwh=Number(result.validation.consumptionKwh);
    if(appKwh>0&&Number.isFinite(pdfKwh)){
      const diff=Math.abs(appKwh-pdfKwh),limit=Math.max(.5,pdfKwh*.05);
      if(diff>limit)result.warnings.push(`Spotřeba faktury ${fmt3.format(pdfKwh)} kWh se liší od intervalových dat aplikace ${fmt3.format(appKwh)} kWh.`);
    }
    result.canSave=result.fatal.length===0;
    state.pendingInvoicePdf={monthKey:target,fileName:file.name,result};
    renderInvoiceReview();$('#invoiceReviewModal').classList.remove('hidden');
  }catch(e){
    console.error(e);state.pendingInvoicePdf=null;alert('Fakturu se nepodařilo načíst:\n'+e.message);
  }finally{$('#invoicePdfInput').value=''}
}
async function saveParsedInvoice(){
  const pending=state.pendingInvoicePdf;if(!pending?.result?.canSave)return;
  const month=state.months.find(m=>m.monthKey===pending.monthKey);if(!month)return;
  const finance=normalizeFinance(pending.result.finance);
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('months','readwrite'),store=tx.objectStore('months');store.put({...month,finance});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  $('#invoiceReviewModal').classList.add('hidden');state.pendingInvoicePdf=null;await reload();showToast(`${monthLabel(month.monthKey)}: PDF faktura uložena`);
}
function cancelInvoicePdf(){state.pendingInvoicePdf=null;$('#invoiceReviewModal').classList.add('hidden');$('#invoicePdfInput').value=''}

async function persistImport(payload, replace=false){
  const previous=replace?state.months.find(m=>m.monthKey===payload.month.monthKey):null;
  const monthToSave={...payload.month,enabled:previous?previous.enabled!==false:payload.month.enabled!==false,finance:previous?normalizeFinance(previous.finance):normalizeFinance(payload.month.finance),forecastHistory:Array.isArray(previous?.forecastHistory)?previous.forecastHistory:(Array.isArray(payload.month.forecastHistory)?payload.month.forecastHistory:[])};
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
function parseCzTimestamp(s){return TIME.parseCzTimestamp(s)}
function weekdayMon(ts){return TIME.weekdayMon(ts)}
function pragueParts(ms){return TIME.pragueParts(ms)}
function pragueUtcCandidates(ts){return TIME.pragueUtcCandidates(ts)}
function sourceStamp(y,m,d,h,mi){return TIME.sourceStamp(y,m,d,h,mi)}
function expectedTimestampCounts(year,month){return TIME.expectedTimestampCounts(year,month,15)}
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
  return {clientId:state.egd.clientId,clientSecret:state.egd.clientSecret,proxyUrl:state.egd.proxyUrl||'',ean:state.egd.ean,profile:state.egd.profile,lastSync:state.egd.lastSync||null,autoSync:state.egd.autoSync===true};
}
async function saveEgdConfig(){await setSetting('egd-config',egdConnectionConfig())}
function egdNetworkError(e){
  if(e instanceof TypeError)return new Error('Přímé spojení s EG.D se z prohlížeče nepodařilo navázat. Může jít o síťovou chybu nebo CORS blokaci na straně EG.D.');
  return e;
}
function normalizeProxyUrl(raw){
  const text=String(raw||'').trim();if(!text)return '';
  let u;try{u=new URL(text)}catch{throw new Error('Proxy URL není platná adresa.')}
  if(u.protocol!=='https:')throw new Error('Proxy URL musí používat HTTPS.');
  u.hash='';return u.href.replace(/\/$/,'');
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function proxyHealth(proxyUrl){
  try{
    const resp=await fetch(proxyUrl,{method:'GET',headers:{Accept:'application/json'},cache:'no-store'});
    let body=null;try{body=await resp.json()}catch{}
    return {reachable:resp.ok, status:resp.status, body};
  }catch(e){return {reachable:false,status:null,body:null,error:e}}
}
async function egdProxyPost(action,payload={}){
  const proxyUrl=normalizeProxyUrl(state.egd.proxyUrl);
  if(!proxyUrl)throw new Error('Vyplň Proxy URL z Vercelu.');
  let lastNetworkError=null;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const resp=await fetch(proxyUrl,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},cache:'no-store',body:JSON.stringify({clientId:state.egd.clientId,clientSecret:state.egd.clientSecret,action,...payload})});
      let body=null;try{body=await resp.json()}catch{}
      if(!resp.ok){
        const parts=[body?.message,body?.details].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
        const source=body?.error==='egd_upstream_error'?'EG.D přes proxy':'Vercel proxy';
        throw new Error(`${source} HTTP ${resp.status}${parts.length?': '+parts.join(' — '):''}`);
      }
      return body;
    }catch(e){
      if(e instanceof TypeError){lastNetworkError=e;if(attempt<2){await sleep(700);continue}}
      else throw e;
    }
  }
  const health=await proxyHealth(proxyUrl);
  if(health.reachable)throw new Error('Vercel proxy odpovídá, ale prohlížeč zablokoval POST požadavek. Zkus znovu tlačítko „Ověřit připojení“; pokud chyba zůstane, jde pravděpodobně o CORS nebo dočasnou síťovou chybu.');
  throw new Error('Vercel proxy není momentálně dosažitelná. Požadavek byl automaticky zopakován, ale endpoint neodpověděl.');
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
function consumptionProfileCandidates(profiles,typMereni,current=''){
  const electric=profiles.filter(p=>String(p.komodita||'').toUpperCase()==='ELEKTRINA');
  const codes=new Set(electric.map(p=>String(p.kod||'').toUpperCase()));
  const out=[],push=code=>{const c=String(code||'').toUpperCase();if(c&&codes.has(c)&&!out.includes(c))out.push(c)};
  if(current)push(current);
  const type=String(typMereni||'').trim().toUpperCase();
  if(type==='B'){
    push('ICQ2');
    push('ICC1');
  }else if(type==='C1'){
    const c1=electric.find(p=>/C1/i.test(String(p.nazev||''))&&/spotřeb|odebran/i.test(String(p.nazev||'')));
    push(c1?.kod);
  }
  for(const p of electric)if(/spotřeb|odebran|činná spotřeba/i.test(String(p.nazev||'')))push(p.kod);
  return out.length?out:electric.map(p=>p.kod).filter(Boolean);
}
function chooseConsumptionProfile(profiles,typMereni,current=''){
  return consumptionProfileCandidates(profiles,typMereni,current)[0]||'';
}
async function testEgdConnection(){
  const clientId=$('#egdClientId').value.trim(),clientSecret=$('#egdClientSecret').value.trim(),proxyUrl=normalizeProxyUrl($('#egdProxyUrl').value);
  state.egd.clientId=clientId;state.egd.clientSecret=clientSecret;state.egd.proxyUrl=proxyUrl;state.egd.lastError=null;
  await saveEgdConfig();
  setEgdUiState('warn','Ověřuji…','Získávám token a číselníky EG.D.');
  try{
    let oms,profiles,statuses,token=null;
    if(state.egd.proxyUrl){
      const out=await egdProxyPost('diagnostics');oms=out.om;profiles=out.profily;statuses=out.statusy;
    }else{
      token=await egdToken(clientId,clientSecret);
      oms=await egdGet('/om',token);profiles=await egdGet('/profily',token);statuses=await egdGet('/statusy',token);
    }
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
    const probe=await probeConsumptionProfiles(token,om?.typMereni);
    if(probe.workingProfile)state.egd.profile=probe.workingProfile;
    state.egd.verified=true;await saveEgdConfig();renderEgdPanel();
    const probeText=probe.workingProfile
      ?` · /spotreby OK: ${probe.workingProfile}`
      :` · přihlášení OK, ale /spotreby selhalo: ${probe.results.map(x=>x.profile+' '+(x.ok?'OK':'CHYBA')).join(', ')}`;
    setEgdUiState(probe.workingProfile?'ok':'warn',probe.workingProfile?'Připojeno':'Připojeno, datový endpoint chybuje',`Ověřeno · ${state.egd.oms.length} odběrných míst · profil ${state.egd.profile}${probeText}`);
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
  state.egd={clientId:'',clientSecret:'',proxyUrl:'',ean:'',profile:'',oms:[],profiles:[],statuses:[],lastSync:null,lastError:null,autoSync:false,verified:false};
  renderEgdPanel();showToast('EG.D připojení bylo odstraněno');
}
async function saveEgdSelections(){
  state.egd.ean=$('#egdEanSelect').value||state.egd.ean;
  state.egd.profile=$('#egdProfileSelect').value||state.egd.profile;
  await saveEgdConfig();
}
function latestEgdAvailability(){
  const dates=state.months.filter(m=>m.source==='egd-api'&&m.lastAvailableAt).map(m=>m.lastAvailableAt).sort();
  return dates.at(-1)||null;
}
function pragueDayKeyFromMs(ms){
  if(!Number.isFinite(ms))return '';
  const p=pragueParts(ms);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
const EGD_VALID_STATUS='IU012';
function egdStatusInfo(status){
  const code=String(status||'').trim().toUpperCase();
  if(code==='IU010')return {code,label:'hodnota neexistuje',usable:false,provisional:false,kind:'missing'};
  if(code==='IU011')return {code,label:'hodnota chybí',usable:false,provisional:false,kind:'missing'};
  if(code==='IU012')return {code,label:'platná hodnota',usable:true,provisional:false,kind:'valid'};
  if(code==='IU013')return {code,label:'odhadnutá hodnota',usable:true,provisional:true,kind:'estimated'};
  if(code==='IU014')return {code,label:'pochybná/nepoužitelná',usable:false,provisional:false,kind:'invalid'};
  if(code==='IU015')return {code,label:'měněná/zadaná manuálně',usable:true,provisional:true,kind:'adjusted'};
  if(code==='IU016')return {code,label:'uvolněná hodnota',usable:true,provisional:false,kind:'released'};
  if(code==='IU017')return {code,label:'blokovaná hodnota',usable:false,provisional:false,kind:'blocked'};
  if(code==='IU018')return {code,label:'chráněná hodnota',usable:true,provisional:true,kind:'protected'};
  if(code==='IU019')return {code,label:'archivovaná hodnota',usable:true,provisional:false,kind:'archived'};
  if(code==='IU020')return {code,label:'extrapolovaná hodnota',usable:true,provisional:true,kind:'estimated'};
  if(code==='IU021')return {code,label:'interpolovaná hodnota',usable:true,provisional:true,kind:'estimated'};
  if(code==='IU022')return {code,label:'externě manuálně změněná',usable:true,provisional:true,kind:'adjusted'};
  if(code==='IU023')return {code,label:'verze mimo platnost',usable:false,provisional:false,kind:'obsolete'};
  if(code==='B'||code==='W')return {code,label:'hodnota vrácená EG.D s nestandardním statusem',usable:true,provisional:true,kind:'api-provisional'};
  return {code,label:code?'neznámý status':'status neuveden',usable:false,provisional:false,kind:'unknown'};
}
function recordUsable(r){
  if(!r)return false;
  if(r.source!=='egd-api')return true;
  return egdStatusInfo(r.apiStatus).usable;
}
function recordProvisional(r){return r?.source==='egd-api'&&egdStatusInfo(r.apiStatus).provisional}
function usableRecords(records){return records.filter(recordUsable)}
function renderEgdPanel(){
  const hasCreds=!!(state.egd.clientId&&state.egd.clientSecret),hasSelection=!!(state.egd.ean&&state.egd.profile),hasProxy=!!state.egd.proxyUrl;
  $('#egdClientId').value=state.egd.clientId||'';
  $('#egdClientSecret').value=state.egd.clientSecret||'';
  $('#egdProxyUrl').value=state.egd.proxyUrl||'';
  $('#egdAutoSync').checked=state.egd.autoSync===true;
  $('#egdConfig').classList.toggle('hidden',!state.egd.oms.length);
  $('#egdSyncBtn').classList.toggle('hidden',!(hasCreds&&hasSelection));
  $('#egdDisconnectBtn').classList.toggle('hidden',!hasCreds);
  const eanSel=$('#egdEanSelect'),profSel=$('#egdProfileSelect');
  if(state.egd.oms.length){
    eanSel.innerHTML=state.egd.oms.map(o=>`<option value="${escapeHtml(o.ean)}" ${o.ean===state.egd.ean?'selected':''}>${escapeHtml(o.ean)} · ${escapeHtml(o.typMereni||'')}</option>`).join('');
    const electric=state.egd.profiles.filter(p=>String(p.komodita||'').toUpperCase()==='ELEKTRINA');
    profSel.innerHTML=electric.map(p=>{const code=String(p.kod||'').toUpperCase(),recommended=code==='ICQ2'?' · doporučeno pro kWh':'';return `<option value="${escapeHtml(p.kod)}" ${p.kod===state.egd.profile?'selected':''}>${escapeHtml(p.nazev||p.kod)} · ${escapeHtml(p.kod)}${recommended}</option>`}).join('');
  }
  const lastAvailable=latestEgdAvailability(),lastSync=state.egd.lastSync;
  if(lastSync){
    const bits=[`Poslední synchronizace: ${new Date(lastSync).toLocaleString('cs-CZ')}`];
    if(lastAvailable)bits.push(`data do: ${new Date(lastAvailable).toLocaleString('cs-CZ')}`);
    setEgdUiState('ok','Připojeno',bits.join(' · '));
  }else if(state.egd.verified)setEgdUiState('ok','Připojeno','Připojení ověřeno. Data lze synchronizovat.');
  else if(state.egd.lastError)setEgdUiState('error','Chyba připojení',state.egd.lastError);
  else if(hasCreds)setEgdUiState('warn','Připraveno',hasProxy?'Proxy je nastavena. Ověř připojení nebo spusť synchronizaci.':'Chybí Proxy URL. Přímé spojení může prohlížeč zablokovat kvůli CORS.');
  else setEgdUiState('','Nepřipojeno','Po ověření připojení aplikace načte dostupná odběrná místa a profily.');
}
function apiValueToKw(value,units,intervalMinutes=15){return CORE.apiValueToKw(value,units,intervalMinutes)}
function apiValueFromKw(kw,units,intervalMinutes=15){return CORE.apiValueFromKw(kw,units,intervalMinutes)}
function pragueMonthQueryBounds(monthKey){
  const [year,month]=monthKey.split('-').map(Number),nextMonth=month===12?1:month+1,nextYear=month===12?year+1:year;
  const start=pragueUtcCandidates(parseCzTimestamp(`01.${String(month).padStart(2,'0')}.${year} 00:00:00`))[0];
  const next=pragueUtcCandidates(parseCzTimestamp(`01.${String(nextMonth).padStart(2,'0')}.${nextYear} 00:00:00`))[0];
  if(!Number.isFinite(start)||!Number.isFinite(next))throw new Error('Nepodařilo se určit UTC hranice měsíce.');
  const fullEnd=next-15*60000,now=Date.now(),nowP=pragueParts(now);
  const todayStart=pragueUtcCandidates(parseCzTimestamp(`${String(nowP.day).padStart(2,'0')}.${String(nowP.month).padStart(2,'0')}.${nowP.year} 00:00:00`))[0];
  const queryStart=start-1000;
  const queryEnd=Math.min(next-1000,todayStart-1000);
  return {from:new Date(queryStart).toISOString(),to:new Date(queryEnd).toISOString(),start,end:fullEnd,isPast:now>=next,egdMaxEnd:todayStart-1000};
}
async function fetchEgdRange(token,from,to,profile=state.egd.profile){
  if(state.egd.proxyUrl)return (await egdProxyPost('spotreby',{ean:state.egd.ean,profile,from,to})).data;
  return egdGet('/spotreby',token,{ean:state.egd.ean,profile,from,to,pageStart:1,pageSize:3000});
}
async function probeConsumptionProfiles(token,typMereni){
  const p=pragueParts(Date.now()),monthKey=`${p.year}-${String(p.month).padStart(2,'0')}`,bounds=pragueMonthQueryBounds(monthKey),end=Date.parse(bounds.to);
  if(!Number.isFinite(end)||end<bounds.start)return {workingProfile:null,results:[]};
  const from=new Date(Math.max(bounds.start,end-45*60000)).toISOString(),to=new Date(end).toISOString();
  const candidates=consumptionProfileCandidates(state.egd.profiles,typMereni,state.egd.profile).filter(p=>['ICQ2','ICC1'].includes(String(p).toUpperCase())).slice(0,2);
  const results=[];
  for(const profile of candidates){
    try{
      const raw=await fetchEgdRange(token,from,to,profile);
      const group=mergeEgdPayloads([raw],profile),count=group?.data?.length||0;
      results.push({profile,ok:true,count});
      return {workingProfile:profile,results,from,to};
    }catch(e){results.push({profile,ok:false,error:e.message})}
  }
  return {workingProfile:null,results,from,to};
}
function egdRangeChunks(fromIso,toIso,chunkDays=7){
  const from=Date.parse(fromIso),to=Date.parse(toIso),span=chunkDays*86400000;
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return [];
  const out=[];let start=from;
  while(start<=to){
    const end=Math.min(to,start+span);
    out.push({from:new Date(start).toISOString(),to:new Date(end).toISOString()});
    if(end>=to)break;
    start=end-1000;
  }
  return out;
}
function mergeEgdPayloads(payloads,profile){
  const groups=[];
  for(const raw of payloads)groups.push(...(Array.isArray(raw)?raw:[raw]).filter(Boolean));
  const matches=groups.filter(x=>x?.profile===profile&&Array.isArray(x?.data));
  const selected=matches.length?matches:groups.filter(x=>Array.isArray(x?.data));
  if(!selected.length)return null;
  const units=String(selected.find(x=>x.units)?.units||''),rows=new Map();
  for(const g of selected)for(const item of g.data||[]){
    const key=String(item?.timestamp||'');
    if(key)rows.set(key,item);
  }
  return {profile,units,data:[...rows.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp))};
}
function existingEgdRecords(monthKey){
  return state.records.filter(r=>r.monthKey===monthKey&&r.source==='egd-api').sort((a,b)=>a.sortKey-b.sortKey);
}
function mergeEgdRecords(existing,fresh){
  const byMs=new Map();
  for(const r of existing)if(Number.isFinite(Number(r.sortKey)))byMs.set(Number(r.sortKey),r);
  for(const r of fresh)if(Number.isFinite(Number(r.sortKey)))byMs.set(Number(r.sortKey),r);
  return [...byMs.values()].sort((a,b)=>a.sortKey-b.sortKey);
}
function incrementalEgdBounds(monthKey,bounds){
  const existing=existingEgdRecords(monthKey);
  if(!existing.length)return {...bounds,incremental:false,existing};
  const lastMs=Math.max(...existing.map(r=>Number(r.sortKey)).filter(Number.isFinite));
  const fromMs=Math.max(bounds.start-1000,lastMs+15*60000-1000);
  return {...bounds,from:new Date(fromMs).toISOString(),incremental:true,existing,lastExistingMs:lastMs};
}
async function repairMissingEgdIntervals(token,monthKey,profile,records,maxGaps=12){
  const gaps=closedIntervalGaps(records,monthKey);
  if(!gaps.length)return {records,attempted:0,recovered:0,remaining:0};
  const targets=gaps.slice(0,maxGaps),rawPayloads=[];
  for(const gap of targets){
    const from=new Date(gap.sortKey-1000).toISOString(),to=new Date(gap.sortKey+1000).toISOString();
    try{rawPayloads.push(await fetchEgdRange(token,from,to,profile))}
    catch(e){console.warn('EG.D oprava chybějícího intervalu selhala',gap.sourceTimestamp,e)}
  }
  const group=mergeEgdPayloads(rawPayloads,profile);
  if(!group?.data?.length)return {records,attempted:targets.length,recovered:0,remaining:gaps.length};
  const seen=new Map(),fresh=group.data.map(x=>apiLocalRecord(state.egd.ean,profile,String(group.units||''),x,seen)).filter(Boolean).filter(r=>r.monthKey===monthKey);
  const merged=mergeEgdRecords(records,fresh),remaining=closedIntervalGaps(merged,monthKey).length;
  return {records:merged,attempted:targets.length,recovered:Math.max(0,gaps.length-remaining),remaining};
}
function apiLocalRecord(ean,profile,units,item,seen){
  const ms=Date.parse(item.timestamp);if(!Number.isFinite(ms))return null;
  const p=pragueParts(ms),source=sourceStamp(p.year,p.month,p.day,p.hour,p.minute),occ=seen.get(source)||0;seen.set(source,occ+1);
  const kw=apiValueToKw(item.value,units,15);if(kw===null)return null;
  const status=String(item.status||'').trim().toUpperCase(),quality=egdStatusInfo(status);
  return {id:`${ean}|egd|${profile}|${ms}`,ean,meter:'EG.D OpenAPI',monthKey:`${p.year}-${String(p.month).padStart(2,'0')}`,dateKey:`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`,sourceTimestamp:source,displayTimestamp:`${String(p.day).padStart(2,'0')}.${String(p.month).padStart(2,'0')}.${p.year} ${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}${occ?' ['+(occ+1)+']':''}`,occurrenceIndex:occ,sortKey:ms,year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute,weekday:weekdayMon(p),intervalMinutes:15,dcc0:null,dcc1:kw,dkc0:null,dkc1:null,dmc0:null,dmc1:null,apiStatus:status,apiQuality:quality.kind,apiUsable:quality.usable,apiProfile:profile,apiUnits:units,apiRawValue:Number.isFinite(Number(item.value))?Number(item.value):null,apiTimestampUtc:String(item.timestamp||new Date(ms).toISOString()),source:'egd-api',dataSchemaVersion:3};
}
async function fetchEgdMonth(token,monthKey,profile=state.egd.profile){
  const fullBounds=pragueMonthQueryBounds(monthKey),bounds=incrementalEgdBounds(monthKey,fullBounds);
  if(Date.parse(bounds.to)<Date.parse(bounds.from)){
    if(bounds.existing.length){
      const repair=await repairMissingEgdIntervals(token,monthKey,profile,bounds.existing);
      return buildEgdMonthPayload(monthKey,repair.records,{incremental:true,noNewRange:true,activeProfile:profile,gapRepairAttempted:repair.attempted,gapRepairRecovered:repair.recovered,gapRepairRemaining:repair.remaining});
    }
    return null;
  }
  let payloads=[],usedChunkFallback=false,usedDailyFallback=false;
  try{
    payloads=[await fetchEgdRange(token,bounds.from,bounds.to,profile)];
  }catch(fullError){
    usedChunkFallback=true;
    const chunkDays=bounds.incremental?1:7,chunks=egdRangeChunks(bounds.from,bounds.to,chunkDays);
    payloads=[];
    for(const chunk of chunks){
      try{payloads.push(await fetchEgdRange(token,chunk.from,chunk.to,profile))}
      catch(chunkError){
        if(bounds.existing.length){
          const last=new Date(bounds.lastExistingMs).toLocaleString('cs-CZ');
          const err=new Error(`${monthLabel(monthKey)}: EG.D nyní vrací chybu /spotreby i pro krátký rozsah ${chunk.from.slice(0,10)}–${chunk.to.slice(0,10)}. Poslední lokálně uložená data do ${last} zůstávají zachována. ${chunkError.message}`);
          err.recoverable=true;err.cachedUntil=bounds.lastExistingMs;throw err;
        }
        usedDailyFallback=chunkDays===1;
        throw new Error(`${monthLabel(monthKey)}: EG.D selhalo i při dílčím načítání ${chunk.from.slice(0,10)}–${chunk.to.slice(0,10)}. ${chunkError.message} (původní chyba celého období: ${fullError.message})`);
      }
    }
  }
  const group=mergeEgdPayloads(payloads,profile);
  if(!group||!Array.isArray(group.data)||!group.data.length){
    if(bounds.existing.length)return buildEgdMonthPayload(monthKey,bounds.existing,{incremental:true,noNewData:true,chunkFallback:usedChunkFallback,activeProfile:profile});
    return null;
  }
  const units=String(group.units||''),seen=new Map(),fresh=group.data.map(x=>apiLocalRecord(state.egd.ean,profile,units,x,seen)).filter(Boolean).filter(r=>r.monthKey===monthKey);
  let records=mergeEgdRecords(bounds.existing,fresh);
  const repair=await repairMissingEgdIntervals(token,monthKey,profile,records);
  records=repair.records;
  return buildEgdMonthPayload(monthKey,records,{incremental:bounds.incremental,chunkFallback:usedChunkFallback,dailyFallback:usedDailyFallback,refreshedFrom:bounds.from,apiUnits:units,activeProfile:profile,gapRepairAttempted:repair.attempted,gapRepairRecovered:repair.recovered,gapRepairRemaining:repair.remaining});
}
function buildEgdMonthPayload(monthKey,records,extra={}){
  if(!records.length)return null;
  const statusCounts={};for(const r of records){const k=String(r.apiStatus||'?').trim().toUpperCase()||'?';statusCounts[k]=(statusCounts[k]||0)+1}
  const usable=usableRecords(records),provisional=records.filter(recordProvisional),[year,month]=monthKey.split('-').map(Number),bounds=pragueMonthQueryBounds(monthKey),validation=bounds.isPast?validateMonthTimeline(usable,year,month):{complete:false,expectedCount:[...expectedTimestampCounts(year,month).values()].reduce((a,b)=>a+b,0),issues:[]};
  const complete=bounds.isPast&&validation.complete,gaps=closedIntervalGaps(records,monthKey),incompleteDays=new Set(gaps.map(g=>g.dateKey)).size,missingClosedIntervals=gaps.length,lastMs=Math.max(...records.map(r=>r.sortKey)),label=`${MONTH_NAMES[month-1]} ${year}`;
  const apiUnits=extra.apiUnits||records.find(r=>r.apiUnits)?.apiUnits||'';
  return {records,month:{monthKey,label,year,month,ean:state.egd.ean,meter:'EG.D OpenAPI',count:records.length,usableCount:usable.length,provisionalCount:provisional.length,excludedQualityCount:records.length-usable.length,expectedCount:validation.expectedCount,complete,incompleteDays,missingClosedIntervals,validationVersion:7,dataSchemaVersion:3,enabled:true,finance:emptyFinance(),first:records[0].sourceTimestamp,last:records.at(-1).sourceTimestamp,importedAt:new Date().toISOString(),fileName:'EG.D OpenAPI',source:'egd-api',apiProfile:extra.activeProfile||state.egd.profile,apiUnits,apiStatusCounts:statusCounts,lastAvailableAt:new Date(lastMs).toISOString(),syncedAt:new Date().toISOString(),...extra}};
}
async function persistEgdMonth(payload){
  if(!payload)return {saved:false,reason:'no-data'};
  const previous=state.months.find(m=>m.monthKey===payload.month.monthKey);
  if(previous?.complete&&previous.source!=='egd-api')return {saved:false,reason:'kept-xlsx'};
  if(previous?.complete&&payload.month.complete!==true)return {saved:false,reason:'kept-complete'};
  if(previous?.source==='egd-api'&&previous.complete!==true&&payload.month.complete!==true){
    const oldUsable=Number(previous.usableCount??state.records.filter(r=>r.monthKey===previous.monthKey&&recordUsable(r)).length),newUsable=Number(payload.month.usableCount||0);
    const oldLast=Date.parse(previous.lastAvailableAt||''),newLast=Date.parse(payload.month.lastAvailableAt||'');
    if(newUsable<oldUsable&&(!Number.isFinite(newLast)||!Number.isFinite(oldLast)||newLast<=oldLast))return {saved:false,reason:'kept-better-partial'};
  }
  await persistImport(payload,!!previous);return {saved:true,reason:payload.month.complete?'complete':'partial'};
}
function currentAndPreviousMonthKeys(){
  const p=pragueParts(Date.now()),idx=monthIndex(`${p.year}-${String(p.month).padStart(2,'0')}`);
  return [monthKeyFromIndex(idx-1),monthKeyFromIndex(idx)];
}
async function syncEgdData({silent=false}={}){
  await saveEgdSelections();
  if(!state.egd.clientId||!state.egd.clientSecret||!state.egd.ean||!state.egd.profile)throw new Error('Nejdřív ověř EG.D připojení a vyber odběrné místo a profil.');
  const localEans=[...new Set(state.records.map(r=>r.ean).filter(Boolean))];
  if(localEans.length&&(!localEans.includes(state.egd.ean)||localEans.length>1))throw new Error(`Lokální databáze patří EAN ${localEans.join(', ')}. Vybrané EG.D odběrné místo ${state.egd.ean} nelze do stejné databáze přimíchat.`);
  setEgdUiState('warn','Synchronizuji…','Aktuální měsíc aktualizuji přírůstkově; existující data zůstávají zachována.');
  try{
    const token=state.egd.proxyUrl?null:await egdToken(),results=[],keys=currentAndPreviousMonthKeys(),currentKey=keys.at(-1);
    for(const key of keys){
      const existing=monthMeta(key);
      if(key!==currentKey&&existing?.complete===true){
        results.push({key,payload:null,saved:{saved:false,reason:'kept-complete'},skipped:true});
        continue;
      }
      if(!silent)showToast(`EG.D: načítám ${monthLabel(key)}…`);
      try{
        let activeProfile=state.egd.profile,payload;
        try{
          payload=await fetchEgdMonth(token,key,activeProfile);
        }catch(primaryError){
          const om=state.egd.oms.find(x=>x.ean===state.egd.ean),alternatives=consumptionProfileCandidates(state.egd.profiles,om?.typMereni,activeProfile).filter(p=>p!==activeProfile);
          let recovered=false,lastError=primaryError;
          if(key===currentKey){
            for(const alternative of alternatives.slice(0,2)){
              try{
                if(!silent)showToast(`EG.D: ${activeProfile} selhalo, zkouším ${alternative}…`);
                payload=await fetchEgdMonth(token,key,alternative);
                activeProfile=alternative;recovered=true;break;
              }catch(e){lastError=e}
            }
          }
          if(!recovered)throw lastError;
          state.egd.profile=activeProfile;
        }
        const saved=await persistEgdMonth(payload);
        results.push({key,payload,saved,profile:activeProfile,profileFallback:activeProfile!==$('#egdProfileSelect').value});
      }catch(error){
        console.error(`EG.D ${key} synchronizace selhala`,error);
        results.push({key,payload:null,saved:{saved:false,reason:'error'},error,recoverable:error?.recoverable===true});
      }
    }
    const currentResult=results.find(x=>x.key===currentKey);
    if(currentResult?.error&&!currentResult.recoverable)throw new Error(`${monthLabel(currentKey)} se nepodařilo synchronizovat: ${currentResult.error.message}`);
    const hardErrors=results.filter(x=>x.error&&!x.recoverable),recoverable=results.filter(x=>x.error&&x.recoverable);
    if(!hardErrors.length){
      state.egd.lastSync=new Date().toISOString();state.egd.verified=true;state.egd.lastError=recoverable[0]?.error?.message||null;await saveEgdConfig();
    }
    state.resetExportRange=true;await reload();
    let overviewMoved=false;
    const currentHasData=state.records.some(r=>r.monthKey===currentKey&&monthEnabled(currentKey)&&recordUsable(r));
    if(!silent&&currentHasData&&state.anchorMonth!==currentKey){
      state.anchorMonth=currentKey;persistPeriodState();overviewMoved=true;
      renderPeriodControls();renderOverview();renderAnalysis();
    }
    await captureLiveForecastSnapshots();
    const saved=results.filter(x=>x.saved?.saved).length,noData=results.filter(x=>!x.payload&&!x.skipped&&!x.error).length,skipped=results.filter(x=>x.skipped).length,last=latestEgdAvailability(),incremental=results.some(x=>x.payload?.month?.incremental),fallback=results.some(x=>x.payload?.month?.chunkFallback),profileFallback=results.find(x=>x.profileFallback),gapRecovered=results.reduce((sum,x)=>sum+Number(x.payload?.month?.gapRepairRecovered||0),0),gapRemaining=results.reduce((sum,x)=>sum+Number(x.payload?.month?.gapRepairRemaining||0),0);
    if(recoverable.length){
      const msg=`${recoverable[0].error.message} Synchronizaci můžeš zkusit později; aplikace dál používá poslední uložená data.`;
      setEgdUiState('warn','EG.D dočasně nedostupné',msg);
      if(!silent)showToast('EG.D nevrátilo nová data; starší data zůstala zachována');
      return {ok:false,recoverable:true,results};
    }
    const message=`Synchronizováno ${saved} měsíců${skipped?' · kompletní přeskočeno: '+skipped:''}${noData?' · bez nových dat: '+noData:''}${last?' · poslední hodnota '+new Date(last).toLocaleString('cs-CZ'):''}${incremental?' · přírůstková aktualizace':''}${fallback?' · načteno po menších blocích':''}${gapRecovered?' · doplněno chybějících intervalů: '+gapRecovered:''}${gapRemaining?' · stále chybí: '+gapRemaining:''}${profileFallback?' · automaticky použit profil '+profileFallback.profile:''}${overviewMoved?' · Přehled přepnut na '+monthLabel(currentKey):''}`;
    setEgdUiState('ok','Připojeno',message);
    if(!silent)showToast('EG.D data byla synchronizována');
    return {ok:true,results};
  }catch(e){state.egd.lastError=e.message;setEgdUiState('error','Chyba synchronizace',e.message);throw e}
}
async function maybeAutoSyncEgd(){
  if(state.egd.autoSync!==true||!state.egd.clientId||!state.egd.clientSecret||!state.egd.proxyUrl||!state.egd.ean||!state.egd.profile)return;
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
  const today=pragueDayKeyFromMs(Date.now()),last=state.egd.lastSync?pragueDayKeyFromMs(Date.parse(state.egd.lastSync)):'';
  if(last&&last===today)return;
  try{await syncEgdData({silent:true})}catch(e){console.error('Automatická EG.D synchronizace selhala',e)}
}

// ---------- Analytics ----------
const val = r => {if(!recordUsable(r))return 0;const n=Number(r[state.metric]);return Number.isFinite(n)?n:0};
const energy = r => val(r)*((Number(r.intervalMinutes)||15)/60);
function monthEnabled(k){const m=state.months.find(x=>x.monthKey===k);return !m||m.enabled!==false}
function sortedRecords(){return state.records.filter(r=>monthEnabled(r.monthKey)&&recordUsable(r)).sort((a,b)=>a.sortKey-b.sortKey||a.id.localeCompare(b.id))}
const billingEnergy = r => {if(!recordUsable(r))return 0;const n=Number(r.dcc1);return Number.isFinite(n)?n*((Number(r.intervalMinutes)||15)/60):0};
function monthMeta(k){return state.months.find(m=>m.monthKey===k)||null}
function monthInvoice(k){const m=monthMeta(k),f=normalizeFinance(m?.finance);return f.invoiceTotal}
function monthBillingEnergy(k){return state.records.filter(r=>r.monthKey===k&&recordUsable(r)).reduce((sum,r)=>sum+billingEnergy(r),0)}
function monthEffectivePrice(k){const invoice=monthInvoice(k),kwh=monthBillingEnergy(k);return invoice!==null&&kwh>0?invoice/kwh:null}
function clamp(v,min,max){return CORE.clamp(v,min,max)}
function historicalCostPoints(monthKey,limit=3){
  const idx=monthIndex(monthKey);if(idx===null)return [];
  const candidates=state.months.filter(m=>{
    const mi=monthIndex(m.monthKey),cost=monthInvoice(m.monthKey),energy=monthBillingEnergy(m.monthKey);
    return mi!==null&&mi<idx&&m.enabled!==false&&monthIsComplete(m.monthKey)&&cost!==null&&energy>0;
  }).sort((a,b)=>b.monthKey.localeCompare(a.monthKey)).slice(0,limit).reverse();
  return candidates.map((m,i)=>{const cost=monthInvoice(m.monthKey),energy=monthBillingEnergy(m.monthKey);return {key:m.monthKey,cost,energy,rate:cost/energy,weight:i+1}});
}
function historicalEnergyPoints(monthKey,limit=6){
  const idx=monthIndex(monthKey);if(idx===null)return [];
  const candidates=state.months.filter(m=>{
    const mi=monthIndex(m.monthKey),energy=monthBillingEnergy(m.monthKey);
    return mi!==null&&mi<idx&&m.enabled!==false&&monthIsComplete(m.monthKey)&&energy>0;
  }).sort((a,b)=>b.monthKey.localeCompare(a.monthKey)).slice(0,limit).reverse();
  return candidates.map((m,i)=>({key:m.monthKey,energy:monthBillingEnergy(m.monthKey),weight:i+1}));
}
function weightedCostModel(points){return CORE.weightedCostModel(points)}
function modeledRateAtEnergy(model,energy){return CORE.modeledRateAtEnergy(model,energy)}
function latestValidatedTariff(monthKey){
  const idx=monthIndex(monthKey);if(idx===null)return null;
  const targetEans=new Set(state.records.filter(r=>r.monthKey===monthKey).map(r=>String(r.ean||'')).filter(Boolean));
  const candidates=state.months.filter(m=>{
    const mi=monthIndex(m.monthKey);if(mi===null||mi>=idx||m.enabled===false)return false;
    const finance=normalizeFinance(m.finance);if(!INVOICE.hasValidatedTariff(finance))return false;
    if(targetEans.size&&finance.metering.ean&&!targetEans.has(finance.metering.ean))return false;
    return true;
  }).sort((a,b)=>b.monthKey.localeCompare(a.monthKey));
  if(!candidates.length)return null;
  const m=candidates[0],finance=normalizeFinance(m.finance),t=finance.tariff;
  return {
    sourceMonthKey:m.monthKey,finance,
    fixed:Number(t.fixedGrossPerMonth),
    variableRate:Number(t.variableGrossPerKwh),
    confidence:Number(finance.invoiceMeta.extractionConfidence)||1
  };
}
function weekdayFromDateKey(key){return CORE.weekdayFromDateKey(key)}
function monthDateKeys(monthKey){return CORE.monthDateKeys(monthKey)}
const EXPECTED_DAY_INTERVAL_CACHE=new Map();
function expectedIntervalsForDate(dateKey){
  if(EXPECTED_DAY_INTERVAL_CACHE.has(dateKey))return EXPECTED_DAY_INTERVAL_CACHE.get(dateKey);
  const count=TIME.expectedIntervalsForDate(dateKey,15);
  EXPECTED_DAY_INTERVAL_CACHE.set(dateKey,count);return count;
}
function totalExpectedIntervals(monthKey){return monthDateKeys(monthKey).reduce((sum,k)=>sum+expectedIntervalsForDate(k),0)}
function elapsedExpectedIntervalsForDate(dateKey,nowMs=Date.now()){
  const [y,m,d]=String(dateKey).split('-').map(Number);let count=0;
  for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
    const candidates=pragueUtcCandidates(parseCzTimestamp(sourceStamp(y,m,d,h,mi)));
    count+=candidates.filter(ms=>ms<=nowMs).length;
  }
  return count;
}
function closedIntervalGaps(records,monthKey){
  const present=new Set(usableRecords(records).map(r=>Number(r.sortKey)).filter(Number.isFinite)),today=pragueDayKeyFromMs(Date.now()),currentMonth=today.slice(0,7),gaps=[];
  for(const dateKey of monthDateKeys(monthKey)){
    if(!(monthKey<currentMonth||dateKey<today))continue;
    const [y,m,d]=dateKey.split('-').map(Number);
    for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      const sourceTimestamp=sourceStamp(y,m,d,h,mi),ts=parseCzTimestamp(sourceTimestamp);
      for(const ms of pragueUtcCandidates(ts))if(!present.has(ms))gaps.push({sortKey:ms,dateKey,sourceTimestamp});
    }
  }
  return gaps.sort((a,b)=>a.sortKey-b.sortKey);
}
function countIncompleteClosedDays(records,monthKey){return new Set(closedIntervalGaps(records,monthKey).map(g=>g.dateKey)).size}
function countMissingClosedIntervals(records,monthKey){return closedIntervalGaps(records,monthKey).length}
function monthDataHealth(monthKey){
  const meta=monthMeta(monthKey),records=state.records.filter(r=>r.monthKey===monthKey);
  if(!meta||!records.length)return null;
  const usable=records.filter(recordUsable),provisional=records.filter(recordProvisional);
  const today=pragueDayKeyFromMs(Date.now()),currentMonth=today.slice(0,7),closedDates=monthDateKeys(monthKey).filter(k=>monthKey<currentMonth||k<today);
  const expectedClosed=closedDates.reduce((a,k)=>a+expectedIntervalsForDate(k),0),gaps=closedIntervalGaps(records,monthKey),closedGapCount=gaps.filter(g=>closedDates.includes(g.dateKey)).length;
  const completeness=expectedClosed>0?clamp(1-closedGapCount/expectedClosed,0,1):1;
  const usability=records.length?clamp(usable.length/records.length,0,1):0;
  let freshness=1,ageHours=0;
  if(monthIsLivePartial(monthKey)&&meta.lastAvailableAt){
    const ms=Date.parse(meta.lastAvailableAt);ageHours=Number.isFinite(ms)?Math.max(0,(Date.now()-ms)/3600000):999;
    freshness=ageHours<=36?1:ageHours<=60?.85:ageHours<=84?.65:ageHours<=132?.45:.2;
  }
  const provisionalShare=usable.length?provisional.length/usable.length:0,provisionalPenalty=Math.min(.03,provisionalShare*.03);
  const score=Math.round(clamp((completeness*.50+usability*.30+freshness*.20-provisionalPenalty)*100,0,100));
  const grade=score>=97?'výborná':score>=90?'dobrá':score>=75?'pozor':score>=55?'slabší':'problém';
  return {score,grade,completeness,usability,freshness,ageHours,expectedClosed,missingClosed:closedGapCount,raw:records.length,usable:usable.length,provisional:provisional.length};
}
function renderDataHealth(monthKey){
  const card=$('#dataHealthCard');if(!card)return;
  const health=monthKey?monthDataHealth(monthKey):null;
  if(!health){card.classList.add('hidden');return}
  card.classList.remove('hidden');
  $('#dataHealthScore').textContent=String(health.score);
  $('#dataHealthGrade').textContent=health.grade;
  $('#dataHealthCompleteness').textContent=`${fmt.format(health.completeness*100)} %`;
  $('#dataHealthUsability').textContent=`${fmt.format(health.usability*100)} %`;
  $('#dataHealthFreshness').textContent=health.freshness>=.99?'aktuální':health.ageHours<999?`${fmt.format(health.ageHours)} h`:'—';
  $('#dataHealthDetail').textContent=health.missingClosed
    ?`Chybí ${health.missingClosed} uzavřených intervalů · použito ${health.usable.toLocaleString('cs-CZ')}/${health.raw.toLocaleString('cs-CZ')}`
    :`Uzavřená data bez mezer · použito ${health.usable.toLocaleString('cs-CZ')}/${health.raw.toLocaleString('cs-CZ')}`;
  card.dataset.grade=health.grade;
}
function calendarFractionForSelected(monthKey,selected){
  if(!selected.length)return 0;
  const dates=[...new Set(selected.map(r=>r.dateKey))],total=totalExpectedIntervals(monthKey);if(!total)return 0;
  const today=pragueDayKeyFromMs(Date.now()),currentMonth=today.slice(0,7);let slots=0;
  for(const d of dates){
    if(monthKey<currentMonth||d<today)slots+=expectedIntervalsForDate(d);
    else if(monthKey===currentMonth&&d===today)slots+=elapsedExpectedIntervalsForDate(d);
  }
  return clamp(slots/total,0,1);
}
function predictMonthEnergy(monthKey,points=historicalEnergyPoints(monthKey)){
  const current=state.records.filter(r=>r.monthKey===monthKey&&recordUsable(r)).sort((a,b)=>a.sortKey-b.sortKey),actualEnergy=current.reduce((a,r)=>a+billingEnergy(r),0);
  const allDates=monthDateKeys(monthKey),observedDates=[...new Set(current.map(r=>r.dateKey))].sort(),expectedSlots=totalExpectedIntervals(monthKey);
  if(!points.length||!observedDates.length)return {actualEnergy,predictedEnergy:actualEnergy,remainingEnergy:0,paceEnergy:actualEnergy,lowEnergy:actualEnergy,highEnergy:actualEnergy,scale:1,observedDays:observedDates.length,totalDays:allDates.length,expectedSlots,observedSlots:current.length,incompleteClosedDays:countIncompleteClosedDays(state.records.filter(r=>r.monthKey===monthKey),monthKey),missingClosedIntervals:countMissingClosedIntervals(state.records.filter(r=>r.monthKey===monthKey),monthKey)};
  const pointWeights=new Map(points.map(p=>[p.key,p.weight])),daily=new Map();
  for(const r of state.records){
    const w=pointWeights.get(r.monthKey);if(!w||!recordUsable(r))continue;
    const k=r.dateKey;if(!daily.has(k))daily.set(k,{energy:0,weekday:r.weekday,weight:w});daily.get(k).energy+=billingEnergy(r);
  }
  const weekdaySum=Array(7).fill(0),weekdayWeight=Array(7).fill(0);let overallSum=0,overallWeight=0;
  for(const d of daily.values()){const wd=Number.isFinite(d.weekday)?d.weekday:0;weekdaySum[wd]+=d.energy*d.weight;weekdayWeight[wd]+=d.weight;overallSum+=d.energy*d.weight;overallWeight+=d.weight}
  const overall=overallWeight>0?overallSum/overallWeight:(actualEnergy/Math.max(1,observedDates.length)),baseline=weekdaySum.map((v,i)=>weekdayWeight[i]>0?v/weekdayWeight[i]:overall);
  const currentDaily=new Map(),currentCounts=new Map();
  for(const r of current){currentDaily.set(r.dateKey,(currentDaily.get(r.dateKey)||0)+billingEnergy(r));currentCounts.set(r.dateKey,(currentCounts.get(r.dateKey)||0)+1)}
  const todayKey=pragueDayKeyFromMs(Date.now()),currentMonth=todayKey.slice(0,7);
  const completeObserved=observedDates.filter(k=>(monthKey<currentMonth||k<todayKey)&&(currentCounts.get(k)||0)===expectedIntervalsForDate(k));
  let ratioSum=0,ratioWeight=0;
  completeObserved.forEach((k,i)=>{const base=baseline[weekdayFromDateKey(k)]||overall,actual=currentDaily.get(k)||0;if(base<=0)return;const age=completeObserved.length-1-i,w=Math.pow(.86,age);ratioSum+=w*(actual/base);ratioWeight+=w});
  const rawScale=ratioWeight>0?ratioSum/ratioWeight:1,reliability=clamp(completeObserved.length/14,0,1),scale=1+(clamp(rawScale,.55,1.6)-1)*reliability;
  let gapEnergy=0,remainderToday=0,futureEnergy=0;
  for(const k of allDates){
    const expectedDay=(baseline[weekdayFromDateKey(k)]||overall)*scale,actualDay=currentDaily.get(k)||0,count=currentCounts.get(k)||0;
    if(monthKey<currentMonth||k<todayKey){
      if(count<expectedIntervalsForDate(k))gapEnergy+=Math.max(0,expectedDay-actualDay);
    }else if(monthKey===currentMonth&&k===todayKey){
      remainderToday=Math.max(0,expectedDay-actualDay);
    }else if(monthKey>currentMonth||k>todayKey)futureEnergy+=expectedDay;
  }
  const baselineProjection=actualEnergy+gapEnergy+remainderToday+futureEnergy,observedSlots=current.length;
  const rawPace=observedSlots>0&&expectedSlots>0?actualEnergy*(expectedSlots/observedSlots):baselineProjection,paceEnergy=clamp(rawPace,baselineProjection*.55,baselineProjection*1.8);
  const completeEnergies=completeObserved.map(k=>currentDaily.get(k)||0),avgRecent=n=>{const a=completeEnergies.slice(-n);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
  const slotsPerDay=allDates.length?expectedSlots/allDates.length:96,remainingDayEquiv=slotsPerDay>0?Math.max(0,(expectedSlots-observedSlots)/slotsPerDay):0;
  const avg7=avgRecent(7),avg14=avgRecent(14),recent7Projection=Number.isFinite(avg7)?actualEnergy+avg7*remainingDayEquiv:null,recent14Projection=Number.isFinite(avg14)?actualEnergy+avg14*remainingDayEquiv:null;
  const ensemble=FORECAST.ensembleMonthForecast({
    weekdayProjection:baselineProjection,
    recent7Projection,recent14Projection,
    paceProjection:paceEnergy,
    observedDays:completeObserved.length,
    historyMonths:points.length,
    fallback:baselineProjection
  });
  const predictedEnergy=Math.max(actualEnergy,ensemble.value),remainingEnergy=Math.max(0,predictedEnergy-actualEnergy);
  const ratios=[];for(const d of daily.values()){const base=baseline[d.weekday]||overall;if(base>0)ratios.push(d.energy/base)}
  const mad=median(ratios.map(r=>Math.abs(r-1)))||0,variability=clamp(1.4826*mad,0,.7),coverage=expectedSlots>0?clamp(observedSlots/expectedSlots,0,1):0;
  const fallbackUncertainty=clamp(.10+variability*.35+(1-coverage)*.18,.10,.42),errors=historicalEnergyForecastErrors(monthKey),calibration=FORECAST.calibrateUncertainty({fallback:fallbackUncertainty,absolutePctErrors:errors,coverage});
  const uncertainty=calibration.uncertainty,lowEnergy=Math.max(actualEnergy,predictedEnergy*(1-uncertainty)),highEnergy=Math.max(lowEnergy,predictedEnergy*(1+uncertainty));
  return {
    actualEnergy,predictedEnergy,remainingEnergy,paceEnergy,baselineProjection,recent7Projection,recent14Projection,
    forecastModel:ensemble.model,forecastWeights:ensemble.weights,forecastComponents:ensemble.components,
    lowEnergy,highEnergy,gapEnergy,remainderToday,futureEnergy,scale,uncertainty,uncertaintySource:calibration.source,uncertaintySamples:calibration.sampleCount,
    observedDays:observedDates.length,completeObservedDays:completeObserved.length,totalDays:allDates.length,expectedSlots,observedSlots,
    incompleteClosedDays:countIncompleteClosedDays(state.records.filter(r=>r.monthKey===monthKey),monthKey),missingClosedIntervals:countMissingClosedIntervals(state.records.filter(r=>r.monthKey===monthKey),monthKey)
  };
}
function estimateRateForMonth(monthKey){
  const costPoints=historicalCostPoints(monthKey),energyPoints=historicalEnergyPoints(monthKey),forecast=predictMonthEnergy(monthKey,energyPoints),tariff=latestValidatedTariff(monthKey);
  if(tariff){
    const fixed=tariff.fixed,variableRate=tariff.variableRate,projectedCost=fixed+variableRate*forecast.predictedEnergy;
    const lowProjectedCost=fixed+variableRate*forecast.lowEnergy,highProjectedCost=fixed+variableRate*forecast.highEnergy;
    const rate=forecast.predictedEnergy>0?projectedCost/forecast.predictedEnergy:variableRate;
    return {
      fixed,variableRate,fallbackRate:variableRate,blend:1,r2:1,spreadRatio:1,confidence:tariff.confidence,count:1,totalCost:0,totalEnergy:0,weightedCost:0,weightedEnergy:0,
      ...forecast,rate,projectedCost,lowProjectedCost,highProjectedCost,months:[tariff.sourceMonthKey],energyMonths:energyPoints.map(p=>p.key),requested:3,
      modelType:'tariff',tariffSourceMonth:tariff.sourceMonthKey,tariffFinance:tariff.finance
    };
  }
  const model=weightedCostModel(costPoints),rate=forecast.predictedEnergy>0?modeledRateAtEnergy(model,forecast.predictedEnergy):model.fallbackRate,projectedCost=Number.isFinite(rate)?forecast.predictedEnergy*rate:null;
  const lowRate=modeledRateAtEnergy(model,forecast.lowEnergy),highRate=modeledRateAtEnergy(model,forecast.highEnergy);
  const lowProjectedCost=Number.isFinite(lowRate)?forecast.lowEnergy*lowRate:null,highProjectedCost=Number.isFinite(highRate)?forecast.highEnergy*highRate:null;
  return {...model,...forecast,rate,projectedCost,lowProjectedCost,highProjectedCost,months:costPoints.map(p=>p.key),energyMonths:energyPoints.map(p=>p.key),requested:3,modelType:'regression'};
}
function estimatedMonthCost(monthKey,rs=null){
  const meta=monthMeta(monthKey);if(!meta||!monthIsLivePartial(monthKey))return null;
  const basis=estimateRateForMonth(monthKey);
  const selected=(Array.isArray(rs)?rs:state.records.filter(r=>r.monthKey===monthKey)).filter(recordUsable),selectedEnergy=selected.reduce((sum,r)=>sum+billingEnergy(r),0),selectedDays=new Set(selected.map(r=>r.dateKey)).size,calendarFraction=calendarFractionForSelected(monthKey,selected);
  if(!Number.isFinite(basis.rate))return {...basis,cost:null,energy:selectedEnergy,selectedDays,calendarFraction};
  const dynamicSelected=(Number(basis.fixed)||0)*calendarFraction+(Number(basis.variableRate)||0)*selectedEnergy,fallbackSelected=Number(basis.fallbackRate)*selectedEnergy;
  const cost=Number.isFinite(fallbackSelected)?basis.blend*dynamicSelected+(1-basis.blend)*fallbackSelected:dynamicSelected;
  return {...basis,cost,energy:selectedEnergy,selectedDays,calendarFraction};
}
function median(values){return CORE.median(values)}
function storedNumber(v){return v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null)}
function forecastHistoryForMonth(month){return Array.isArray(month?.forecastHistory)?month.forecastHistory.filter(x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.asOfDate||'')&&(storedNumber(x.projectedCost)!==null||storedNumber(x.predictedEnergy)!==null)):[]}
function evaluationForecast(monthKey,history){
  const dates=monthDateKeys(monthKey),days=dates.length;if(!history.length||!days)return null;
  const rows=history.map(x=>{const day=Number(String(x.asOfDate).slice(8,10));return {...x,daysRemaining:Math.max(0,days-day)}}).sort((a,b)=>a.asOfDate.localeCompare(b.asOfDate));
  const seven=rows.filter(x=>x.daysRemaining>=7).sort((a,b)=>a.daysRemaining-b.daysRemaining)[0];
  return seven||rows.at(-1);
}
function historicalEnergyForecastErrors(monthKey){
  const idx=monthIndex(monthKey);if(idx===null)return [];const errors=[];
  for(const m of state.months){
    const mi=monthIndex(m.monthKey);if(mi===null||mi>=idx||!monthIsComplete(m.monthKey))continue;
    const actual=monthBillingEnergy(m.monthKey),snap=evaluationForecast(m.monthKey,forecastHistoryForMonth(m)),pred=storedNumber(snap?.predictedEnergy);
    if(actual>0&&pred!==null)errors.push(Math.abs(pred-actual)/actual*100);
  }
  return errors;
}
function historicalEnergyForecastMape(monthKey){
  const errors=historicalEnergyForecastErrors(monthKey);return errors.length>=2?median(errors):null;
}
function forecastAccuracyRows(){
  const rows=[];
  for(const m of state.months){
    if(!monthIsComplete(m.monthKey))continue;
    const history=forecastHistoryForMonth(m);if(!history.length)continue;
    const snap=evaluationForecast(m.monthKey,history);if(!snap)continue;
    const actualEnergy=monthBillingEnergy(m.monthKey),predictedEnergy=storedNumber(snap.predictedEnergy),energyErrorPct=actualEnergy>0&&predictedEnergy!==null?(predictedEnergy-actualEnergy)/actualEnergy*100:null;
    const invoice=monthInvoice(m.monthKey),predicted=storedNumber(snap.projectedCost),hasCost=invoice!==null&&predicted!==null,error=hasCost?predicted-invoice:null,errorPct=hasCost&&invoice>0?error/invoice*100:null;
    const low=storedNumber(snap.lowProjectedCost),high=storedNumber(snap.highProjectedCost),inside=hasCost&&low!==null&&high!==null?invoice>=low&&invoice<=high:null;
    if(energyErrorPct===null&&!hasCost)continue;
    rows.push({monthKey:m.monthKey,invoice,predicted,error,errorPct,inside,actualEnergy,predictedEnergy,energyErrorPct,daysRemaining:snap.daysRemaining,asOfDate:snap.asOfDate,low,high});
  }
  return rows.sort((a,b)=>b.monthKey.localeCompare(a.monthKey));
}
function forecastAccuracySummary(){
  const rows=forecastAccuracyRows(),costPct=rows.map(r=>Math.abs(r.errorPct)).filter(Number.isFinite),energyPct=rows.map(r=>Math.abs(r.energyErrorPct)).filter(Number.isFinite),covered=rows.filter(r=>r.inside!==null),inside=covered.filter(r=>r.inside).length;
  return {rows,count:rows.length,costCount:costPct.length,energyCount:energyPct.length,mape:costPct.length?costPct.reduce((a,b)=>a+b,0)/costPct.length:null,energyMape:energyPct.length?energyPct.reduce((a,b)=>a+b,0)/energyPct.length:null,rangeHit:covered.length?inside/covered.length*100:null};
}
async function captureLiveForecastSnapshots(){
  const updates=[];
  for(const m of state.months){
    if(!monthIsLivePartial(m.monthKey))continue;
    const estimate=estimateRateForMonth(m.monthKey);if(!estimate||!Number.isFinite(estimate.predictedEnergy))continue;
    const asOfDate=m.lastAvailableAt?pragueDayKeyFromMs(Date.parse(m.lastAvailableAt)):pragueDayKeyFromMs(Date.now());if(!asOfDate)continue;
    const snap={asOfDate,createdAt:new Date().toISOString(),projectedCost:Number.isFinite(estimate.projectedCost)?estimate.projectedCost:null,lowProjectedCost:Number.isFinite(estimate.lowProjectedCost)?estimate.lowProjectedCost:null,highProjectedCost:Number.isFinite(estimate.highProjectedCost)?estimate.highProjectedCost:null,predictedEnergy:estimate.predictedEnergy,lowEnergy:estimate.lowEnergy,highEnergy:estimate.highEnergy,modelStability:estimate.confidence,forecastModel:estimate.forecastModel||'legacy',forecastWeights:estimate.forecastWeights||null,uncertainty:estimate.uncertainty,uncertaintySource:estimate.uncertaintySource||'heuristic'};
    const history=forecastHistoryForMonth(m).filter(x=>x.asOfDate!==asOfDate);history.push(snap);history.sort((a,b)=>a.asOfDate.localeCompare(b.asOfDate));
    const updated={...m,forecastHistory:history.slice(-62)};updates.push(updated);
  }
  if(!updates.length)return;
  await new Promise((resolve,reject)=>{const tx=db.transaction('months','readwrite'),store=tx.objectStore('months');updates.forEach(m=>store.put(m));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  for(const updated of updates){const i=state.months.findIndex(m=>m.monthKey===updated.monthKey);if(i>=0)state.months[i]=updated}
}
function forecastWeekdayBaseline(monthKey){
  const points=historicalEnergyPoints(monthKey),weights=new Map(points.map(p=>[p.key,p.weight])),sum=Array(7).fill(0),wgt=Array(7).fill(0);
  const byDay=new Map();
  for(const r of state.records){const w=weights.get(r.monthKey);if(!w)continue;const k=r.dateKey,o=byDay.get(k)||{energy:0,weekday:r.weekday,weight:w};o.energy+=billingEnergy(r);byDay.set(k,o)}
  for(const d of byDay.values()){sum[d.weekday]+=d.energy*d.weight;wgt[d.weekday]+=d.weight}
  const vals=sum.map((v,i)=>wgt[i]?v/wgt[i]:0),overall=vals.filter(v=>v>0);const fallback=overall.length?overall.reduce((a,b)=>a+b,0)/overall.length:1;
  return vals.map(v=>v>0?v:fallback);
}
function forecastEnergyDailySeries(monthKey){
  const estimate=estimateRateForMonth(monthKey);
  if(!estimate||!Number.isFinite(estimate.predictedEnergy))return null;
  const rs=state.records.filter(r=>r.monthKey===monthKey&&recordUsable(r)).sort((a,b)=>a.sortKey-b.sortKey);
  if(!rs.length)return null;
  const dates=monthDateKeys(monthKey),dailyActual=new Map();
  for(const r of rs)dailyActual.set(r.dateKey,(dailyActual.get(r.dateKey)||0)+billingEnergy(r));
  const observed=[...dailyActual.keys()].sort(),lastObserved=observed.at(-1);
  if(!lastObserved)return null;
  const future=dates.filter(d=>d>lastObserved),baseline=forecastWeekdayBaseline(monthKey);
  const weights=future.map(d=>Math.max(.0001,(baseline[weekdayFromDateKey(d)]||1)*(estimate.scale||1)));
  const allocated=FORECAST.allocateRemaining(estimate,weights),central=allocated.central,low=allocated.low,high=allocated.high;
  const index=new Map(future.map((d,i)=>[d,i]));
  const data=dates.map(d=>{
    if(d<=lastObserved){
      const value=dailyActual.get(d)||0;
      return {date:d,label:`${d.slice(8,10)}.${d.slice(5,7)}.`,value,low:value,high:value,kind:'actual'};
    }
    const i=index.get(d),value=central[i]||0;
    return {date:d,label:`${d.slice(8,10)}.${d.slice(5,7)}.`,value,low:low[i]||0,high:high[i]||0,kind:'forecast'};
  });
  return {data,estimate,lastObserved};
}
function comparisonMonthEnergySeries(monthKey,targetLength,mode='previous'){
  const idx=monthIndex(monthKey);if(idx===null)return null;
  const shift=mode==='yearAgo'?12:1,targetKey=monthKeyFromIndex(idx-shift),meta=monthMeta(targetKey);
  if(!meta||meta.enabled===false||!monthIsComplete(targetKey))return null;
  const rs=state.records.filter(r=>r.monthKey===targetKey&&recordUsable(r)),daily=new Map();
  for(const r of rs)daily.set(r.dateKey,(daily.get(r.dateKey)||0)+billingEnergy(r));
  const dates=monthDateKeys(targetKey),values=dates.map(d=>daily.has(d)?daily.get(d):null);
  return {monthKey:targetKey,label:monthLabel(targetKey),mode,values:CORE.alignByDay(values,targetLength)};
}
function prepareEnergyChartSeries(monthKey){
  const live=monthIsLivePartial(monthKey),forecast=live?forecastEnergyDailySeries(monthKey):null,dates=monthDateKeys(monthKey);
  let data;
  if(forecast?.data)data=forecast.data.map(d=>({...d}));
  else{
    const daily=new Map(),rs=state.records.filter(r=>r.monthKey===monthKey&&recordUsable(r));
    for(const r of rs)daily.set(r.dateKey,(daily.get(r.dateKey)||0)+billingEnergy(r));
    data=dates.map(d=>{const value=daily.get(d);return {date:d,label:`${d.slice(8,10)}.${d.slice(5,7)}.`,value:Number.isFinite(value)?value:null,low:null,high:null,kind:Number.isFinite(value)?'actual':'missing'}});
  }
  const prev=state.compareMode!=='none'?comparisonMonthEnergySeries(monthKey,data.length,state.compareMode):null;
  if(state.chartMode==='cumulative'){
    data=FORECAST.toCumulative(data);
    if(prev)prev.values=FORECAST.cumulativeNullable(prev.values);
  }
  return {data,comparison:prev,live,estimate:forecast?.estimate||null};
}
function forecastCostSeries(monthKey){
  const estimate=estimatedMonthCost(monthKey);if(!estimate||!Number.isFinite(estimate.projectedCost))return null;
  const rs=state.records.filter(r=>r.monthKey===monthKey).sort((a,b)=>a.sortKey-b.sortKey),dates=monthDateKeys(monthKey);if(!rs.length)return null;
  const dailyActual=dailyCostData(rs),lastObserved=[...new Set(rs.map(r=>r.dateKey))].sort().at(-1),baseline=forecastWeekdayBaseline(monthKey);
  let actualCum=0;const actualByDate=new Map();for(const d of dates){if(d>lastObserved)break;actualCum+=dailyActual.get(d)||0;actualByDate.set(d,actualCum)}
  const future=dates.filter(d=>d>lastObserved),weights=future.map(d=>{const wd=weekdayFromDateKey(d),e=(baseline[wd]||1)*(estimate.scale||1);return Math.max(.0001,(Number(estimate.fixed)||0)/Math.max(1,estimate.totalDays)+(Number(estimate.variableRate)||0)*e)}),weightSum=weights.reduce((a,b)=>a+b,0)||1;
  const centralRemain=Math.max(0,estimate.projectedCost-actualCum),lowRemain=Math.max(0,estimate.lowProjectedCost-actualCum),highRemain=Math.max(0,estimate.highProjectedCost-actualCum);
  let cw=0;const data=[];
  for(const d of dates){
    if(d<=lastObserved){const v=actualByDate.get(d)||actualCum;data.push({date:d,label:`${d.slice(8,10)}.${d.slice(5,7)}.`,actual:v,central:v,low:v,high:v,forecast:false});continue}
    const i=future.indexOf(d);cw+=weights[i]||0;const f=clamp(cw/weightSum,0,1);data.push({date:d,label:`${d.slice(8,10)}.${d.slice(5,7)}.`,actual:null,central:actualCum+centralRemain*f,low:actualCum+lowRemain*f,high:actualCum+highRemain*f,forecast:true});
  }
  return {data,estimate,lastObserved,actualCost:actualCum};
}
function detectDailyAnomalies(rs){
  const targetDates=new Set(rs.map(r=>r.dateKey)),all=sortedRecords(),daily=new Map();
  for(const r of all){const o=daily.get(r.dateKey)||{energy:0,weekday:r.weekday,dateKey:r.dateKey};o.energy+=energy(r);daily.set(r.dateKey,o)}
  const days=[...daily.values()].sort((a,b)=>a.dateKey.localeCompare(b.dateKey)),out=[];
  for(let i=0;i<days.length;i++){const d=days[i];if(!targetDates.has(d.dateKey))continue;const hist=days.slice(0,i).filter(x=>x.weekday===d.weekday).slice(-10).map(x=>x.energy);if(hist.length<3)continue;const med=median(hist);if(!(med>0))continue;const deviations=hist.map(v=>Math.abs(v-med)),mad=median(deviations)||0,ratio=d.energy/med,z=mad>0?.6745*(d.energy-med)/mad:0;
    if((ratio>=1.7&&d.energy-med>=Math.max(.5,med*.45))||z>=4)out.push({...d,baseline:med,ratio,z});
  }
  return out.sort((a,b)=>b.ratio-a.ratio).slice(0,8);
}
function detectIntervalAnomalies(rs){
  const targets=new Set(rs.map(r=>r.id)),history=new Map(),out=[];
  for(const r of sortedRecords()){const key=`${r.weekday}|${r.hour}|${r.minute}`,hist=history.get(key)||[];
    if(targets.has(r.id)&&hist.length>=4){const med=median(hist),current=val(r);if(med!==null&&current>=1&&current-med>=.8&&current>=Math.max(med*2.5,med+.8))out.push({record:r,current,baseline:med,ratio:med>0?current/med:Infinity})}
    hist.push(val(r));if(hist.length>12)hist.shift();history.set(key,hist);
  }
  return out.sort((a,b)=>(b.current-b.baseline)-(a.current-a.baseline)).slice(0,8);
}
function costForRecords(rs){
  const groups=new Map();for(const r of rs){if(!groups.has(r.monthKey))groups.set(r.monthKey,[]);groups.get(r.monthKey).push(r)}
  let total=0,coveredEnergy=0,knownMonths=0;const missing=[],unallocatable=[],monthCosts=new Map();
  for(const [k,selected] of groups){
    const invoice=monthInvoice(k);if(invoice===null){missing.push(k);continue}
    const meta=monthMeta(k);if(meta&&meta.complete!==true){unallocatable.push(k);continue}
    const full=state.records.filter(r=>r.monthKey===k),fullEnergy=full.reduce((a,r)=>a+billingEnergy(r),0),selectedEnergy=selected.reduce((a,r)=>a+billingEnergy(r),0),isFull=selected.length===full.length;
    let cost=null;
    if(isFull)cost=invoice;
    else if(fullEnergy>0)cost=invoice*(selectedEnergy/fullEnergy);
    else unallocatable.push(k);
    if(cost!==null){total+=cost;coveredEnergy+=selectedEnergy;knownMonths++;monthCosts.set(k,cost)}
  }
  return {total,coveredEnergy,knownMonths,missing,unallocatable,monthCosts,groupCount:groups.size};
}
function costProjectionForRecords(rs){
  const actual=costForRecords(rs),groups=new Map(),estimatedMonths=new Map();let estimateTotal=0,estimateEnergy=0;
  for(const r of rs){if(!groups.has(r.monthKey))groups.set(r.monthKey,[]);groups.get(r.monthKey).push(r)}
  for(const [k,selected] of groups){
    if(!monthIsLivePartial(k))continue;
    const estimate=estimatedMonthCost(k,selected);
    if(estimate&&Number.isFinite(estimate.cost)){estimatedMonths.set(k,estimate);estimateTotal+=estimate.cost;estimateEnergy+=estimate.energy}
  }
  const estimatedKeys=new Set(estimatedMonths.keys());
  return {...actual,estimateTotal,estimateEnergy,estimatedMonths,totalWithEstimate:actual.total+estimateTotal,coveredEnergyWithEstimate:actual.coveredEnergy+estimateEnergy,missingUnresolved:actual.missing.filter(k=>!estimatedKeys.has(k)),unallocatableUnresolved:actual.unallocatable.filter(k=>!estimatedKeys.has(k))};
}
function dailyCostData(rs){
  const out=new Map(),groups=new Map();for(const r of rs){if(!groups.has(r.monthKey))groups.set(r.monthKey,[]);groups.get(r.monthKey).push(r)}
  for(const [k,selectedRaw] of groups){
    const selected=selectedRaw.filter(recordUsable);
    if(monthIsLivePartial(k)){
      const basis=estimateRateForMonth(k);if(!Number.isFinite(basis.rate))continue;
      const byDay=new Map();for(const r of selected){const d=byDay.get(r.dateKey)||{energy:0};d.energy+=billingEnergy(r);byDay.set(r.dateKey,d)}
      const totalSlots=totalExpectedIntervals(k)||1,today=pragueDayKeyFromMs(Date.now()),currentMonth=today.slice(0,7);
      for(const [date,d] of byDay){let daySlots=0;if(k<currentMonth||date<today)daySlots=expectedIntervalsForDate(date);else if(k===currentMonth&&date===today)daySlots=elapsedExpectedIntervalsForDate(date);const dynamic=(Number(basis.variableRate)||0)*d.energy+(Number(basis.fixed)||0)*(daySlots/totalSlots),fallback=Number(basis.fallbackRate)*d.energy,cost=Number.isFinite(fallback)?basis.blend*dynamic+(1-basis.blend)*fallback:dynamic;out.set(date,(out.get(date)||0)+cost)}
      continue;
    }
    const invoice=monthInvoice(k),fullEnergy=monthBillingEnergy(k);if(invoice===null||fullEnergy<=0)continue;const rate=invoice/fullEnergy;
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
function attachChartTooltip(el,data,{w=700,left=64,right=14,htmlForPoint=null}={}){
  if(!el||!Array.isArray(data)||!data.length)return;
  const svg=el.querySelector('svg');if(!svg)return;
  const tip=document.createElement('div');tip.className='chart-tooltip';el.appendChild(tip);
  const show=ev=>{
    if(!Number.isFinite(ev.clientX))return;
    const rect=svg.getBoundingClientRect(),local=((ev.clientX-rect.left)/Math.max(1,rect.width))*w,ratio=clamp((local-left)/Math.max(1,w-left-right),0,1);
    const i=clamp(Math.round(ratio*(data.length-1)),0,data.length-1),d=data[i],host=el.getBoundingClientRect();
    tip.innerHTML=htmlForPoint?htmlForPoint(d,i):`<strong>${escapeHtml(d.label||'')}</strong><span>${escapeHtml(String(d.value??''))}</span>`;
    tip.style.left=`${clamp(ev.clientX-host.left,54,Math.max(54,host.width-54))}px`;tip.classList.add('show');
  };
  svg.addEventListener('pointerdown',show);
  svg.addEventListener('pointermove',ev=>{if(ev.pointerType==='mouse'||tip.classList.contains('show'))show(ev)});
  svg.addEventListener('pointerleave',ev=>{if(ev.pointerType==='mouse')tip.classList.remove('show')});
}
function lineChart(el,data,{hero=false,unit='kWh'}={}){
  if(!data.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=hero?200:230,p={l:64,r:14,t:30,b:38},vals=data.map(d=>Number(d.value)||0),axisMax=niceAxisMax(Math.max(...vals,0.001)),ticks=Array.from({length:5},(_,i)=>axisMax*i/4);
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
    ${xlabels.map(d=>{const i=data.indexOf(d);return `<text class="chart-x-label" x="${x(i)}" y="${h-8}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" fill="${text}">${escapeHtml(d.label)}</text>`}).join('')}
  </svg>`;
  attachChartTooltip(el,data,{w,left:p.l,right:p.r,htmlForPoint:d=>`<strong>${escapeHtml(d.label)}</strong><span>${escapeHtml(chartValue(Number(d.value)||0,unit))}</span>`});
}
function energyForecastLineChart(el,data,{comparison=null,cumulative=false}={}){
  if(!data?.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=210,p={l:64,r:14,t:42,b:38},orange='#f0a23a',blue='#8fc1ff',gray='#8d99aa',text='#afbdd0',grid='rgba(255,255,255,.13)';
  const mainVals=data.flatMap(d=>[d.value,d.low,d.high]).filter(Number.isFinite),compareVals=comparison?.values?.filter(Number.isFinite)||[],axisMax=niceAxisMax(Math.max(...mainVals,...compareVals,.001)),ticks=Array.from({length:5},(_,i)=>axisMax*i/4);
  const x=i=>p.l+(i/(Math.max(1,data.length-1)))*(w-p.l-p.r),y=v=>p.t+(1-v/axisMax)*(h-p.t-p.b);
  const lastActual=data.map(d=>d.kind).lastIndexOf('actual'),forecastStart=data.findIndex(d=>d.kind==='forecast');
  const actualPts=data.map((d,i)=>d.kind==='actual'&&Number.isFinite(d.value)?`${x(i)},${y(d.value)}`:null).filter(Boolean).join(' ');
  const fStart=forecastStart>=0?Math.max(0,forecastStart-1):-1;
  const forecastData=fStart>=0?data.slice(fStart):[];
  const forecastPts=forecastData.map((d,j)=>Number.isFinite(d.value)?`${x(fStart+j)},${y(d.value)}`:null).filter(Boolean).join(' ');
  const band=forecastData.filter((d,j)=>j===0||(Number.isFinite(d.low)&&Number.isFinite(d.high)));
  let bandPolygon='';
  if(band.length>1){
    const indexed=band.map(d=>({d,i:data.indexOf(d)}));
    const upper=indexed.map(o=>`${x(o.i)},${y(Number.isFinite(o.d.high)?o.d.high:o.d.value)}`).join(' ');
    const lower=indexed.slice().reverse().map(o=>`${x(o.i)},${y(Number.isFinite(o.d.low)?o.d.low:o.d.value)}`).join(' ');
    bandPolygon=`<polygon points="${upper} ${lower}" fill="${orange}" opacity=".13"/>`;
  }
  const comparisonPts=comparison?.values?.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:null).filter(Boolean).join(' ')||'';
  const xlabels=data.filter((_,i)=>i===0||i===data.length-1||i%Math.ceil(data.length/5)===0);
  const legend=[
    `<span><i style="background:${blue}"></i>skutečnost</span>`,
    forecastStart>=0?`<span><i style="background:${orange}"></i>predikce</span>`:'',
    forecastStart>=0?`<span><i class="band" style="background:${orange}"></i>pásmo</span>`:'',
    comparisonPts?`<span><i class="dash" style="background:${gray}"></i>${escapeHtml(comparison.label)}</span>`:''
  ].filter(Boolean).join('');
  el.innerHTML=`<div class="energy-chart-legend">${legend}</div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="${cumulative?'Kumulativní':'Denní'} spotřeba a predikce">
    <text class="chart-y-label" x="${p.l}" y="18" text-anchor="start" fill="${text}">kWh</text>
    ${ticks.map(t=>`<line x1="${p.l}" x2="${w-p.r}" y1="${y(t)}" y2="${y(t)}" stroke="${grid}" stroke-width="1"/><text class="chart-y-label" x="${p.l-7}" y="${y(t)+3}" text-anchor="end" fill="${text}">${escapeHtml(chartValue(t,'kWh').replace(' kWh',''))}</text>`).join('')}
    ${bandPolygon}
    ${comparisonPts?`<polyline points="${comparisonPts}" fill="none" stroke="${gray}" stroke-width="2" opacity=".8" vector-effect="non-scaling-stroke" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"/>`:''}
    ${actualPts?`<polyline points="${actualPts}" fill="none" stroke="${blue}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>`:''}
    ${forecastPts?`<polyline points="${forecastPts}" fill="none" stroke="${orange}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>`:''}
    ${forecastStart>=0?`<line x1="${x(Math.max(0,forecastStart-1))}" x2="${x(Math.max(0,forecastStart-1))}" y1="${p.t}" y2="${h-p.b}" stroke="${orange}" opacity=".5" stroke-dasharray="4 5"/>`:''}
    ${lastActual>=0?`<circle cx="${x(lastActual)}" cy="${y(data[lastActual].value)}" r="4" fill="#fff"/>`:''}
    ${xlabels.map(d=>{const i=data.indexOf(d);return `<text class="chart-x-label" x="${x(i)}" y="${h-8}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" fill="${text}">${escapeHtml(d.label)}</text>`}).join('')}
  </svg>`;
  attachChartTooltip(el,data,{w,left:p.l,right:p.r,htmlForPoint:(d,i)=>{
    const lines=[`<strong>${escapeHtml(d.label)}</strong>`];
    if(Number.isFinite(d.value))lines.push(`<span>${d.kind==='forecast'?'Predikce':'Skutečnost'} ${escapeHtml(chartValue(d.value,'kWh'))}</span>`);
    if(d.kind==='forecast'&&Number.isFinite(d.low)&&Number.isFinite(d.high))lines.push(`<span>Pásmo ${escapeHtml(chartValue(d.low,'kWh'))}–${escapeHtml(chartValue(d.high,'kWh'))}</span>`);
    const pv=comparison?.values?.[i];if(Number.isFinite(pv))lines.push(`<span>${escapeHtml(comparison.label)} ${escapeHtml(chartValue(pv,'kWh'))}</span>`);
    return lines.join('');
  }});
}
function forecastBandChart(el,data){
  if(!data?.length){el.innerHTML='<div class="chart-empty">Forecast zatím není k dispozici</div>';return}
  const w=700,h=250,p={l:64,r:14,t:30,b:42},vals=data.flatMap(d=>[d.actual,d.central,d.low,d.high]).filter(Number.isFinite),axisMax=niceAxisMax(Math.max(...vals,1)),ticks=Array.from({length:5},(_,i)=>axisMax*i/4);
  const x=i=>p.l+(i/(Math.max(1,data.length-1)))*(w-p.l-p.r),y=v=>p.t+(1-v/axisMax)*(h-p.t-p.b);
  const forecastIdx=data.findIndex(d=>d.forecast),start=forecastIdx<0?data.length-1:Math.max(0,forecastIdx-1),band=data.slice(start);
  const upper=band.map((d,j)=>`${x(start+j)},${y(d.high)}`).join(' '),lower=band.slice().reverse().map((d,j)=>{const i=start+band.length-1-j;return `${x(i)},${y(d.low)}`}).join(' ');
  const actualPts=data.map((d,i)=>Number.isFinite(d.actual)?`${x(i)},${y(d.actual)}`:null).filter(Boolean).join(' ');
  const forecastPts=data.slice(start).map((d,j)=>`${x(start+j)},${y(d.central)}`).join(' ');
  const labels=data.filter((_,i)=>i===0||i===data.length-1||i%Math.ceil(data.length/5)===0);
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Predikce nákladů do konce měsíce">
    <text class="chart-y-label" x="${p.l}" y="12" text-anchor="start" fill="var(--muted)">Kč</text>
    ${ticks.map(t=>`<line x1="${p.l}" x2="${w-p.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text class="chart-y-label" x="${p.l-7}" y="${y(t)+3}" text-anchor="end" fill="var(--muted)">${escapeHtml(fmt.format(t))}</text>`).join('')}
    ${band.length>1?`<polygon points="${upper} ${lower}" fill="var(--accent)" opacity=".12"/>`:''}
    ${actualPts?`<polyline points="${actualPts}" fill="none" stroke="var(--text)" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>`:''}
    ${forecastPts?`<polyline points="${forecastPts}" fill="none" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7 5"/>`:''}
    ${forecastIdx>=0?`<line x1="${x(start)}" x2="${x(start)}" y1="${p.t}" y2="${h-p.b}" stroke="var(--muted)" opacity=".45" stroke-dasharray="3 5"/>`:''}
    ${labels.map(d=>{const i=data.indexOf(d);return `<text class="chart-x-label" x="${x(i)}" y="${h-10}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" fill="var(--muted)">${escapeHtml(d.label)}</text>`}).join('')}
    <circle cx="${x(data.length-1)}" cy="${y(data.at(-1).central)}" r="4" fill="var(--accent)"><title>Střední predikce: ${escapeHtml(fmt.format(data.at(-1).central))} Kč</title></circle>
  </svg>`;
  attachChartTooltip(el,data,{w,left:p.l,right:p.r,htmlForPoint:d=>Number.isFinite(d.actual)
    ?`<strong>${escapeHtml(d.label)}</strong><span>Skutečnost ${escapeHtml(fmt.format(d.actual))} Kč</span>`
    :`<strong>${escapeHtml(d.label)}</strong><span>Střední ${escapeHtml(fmt.format(d.central))} Kč</span><span>Rozpětí ${escapeHtml(fmt.format(d.low))}–${escapeHtml(fmt.format(d.high))} Kč</span>`});
}
function barChart(el,data,{unit='kWh',showValues=true}={}){
  if(!data.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=235,p={l:64,r:12,t:34,b:44},vals=data.map(d=>Number(d.value)||0),axisMax=niceAxisMax(Math.max(...vals,0.001)),ticks=Array.from({length:5},(_,i)=>axisMax*i/4),slot=(w-p.l-p.r)/data.length,bw=Math.max(5,slot*.56),y=v=>p.t+(1-v/axisMax)*(h-p.t-p.b);
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <text class="chart-y-label" x="${p.l}" y="12" text-anchor="start" fill="var(--muted)">${escapeHtml(unit)}</text>
    ${ticks.map(t=>`<line x1="${p.l}" x2="${w-p.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/><text class="chart-y-label" x="${p.l-7}" y="${y(t)+3}" text-anchor="end" fill="var(--muted)">${escapeHtml(chartValue(t,unit).replace(' '+unit,''))}</text>`).join('')}
    ${data.map((d,i)=>{const v=vals[i],bh=(v/axisMax)*(h-p.t-p.b),x=p.l+i*slot+(slot-bw)/2,yy=h-p.b-bh,label=showValues&&data.length<=12?`<text class="chart-value-label" x="${x+bw/2}" y="${Math.max(11,yy-6)}" text-anchor="middle" fill="var(--muted)">${escapeHtml(chartValue(v,unit).replace(' '+unit,''))}</text>`:'';return `<rect x="${x}" y="${yy}" width="${bw}" height="${Math.max(1,bh)}" rx="5" fill="var(--accent)" opacity="${.55+.4*(v/axisMax)}"><title>${escapeHtml(d.label)}: ${escapeHtml(chartValue(v,unit))}</title></rect>${label}<text class="chart-x-label" x="${x+bw/2}" y="${h-14}" text-anchor="middle" fill="var(--muted)">${escapeHtml(d.short||d.label)}</text>`}).join('')}
  </svg>`;
  attachChartTooltip(el,data,{w,left:p.l,right:p.r,htmlForPoint:d=>`<strong>${escapeHtml(d.label)}</strong><span>${escapeHtml(chartValue(Number(d.value)||0,unit))}</span>`});
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

// ---------- Rendering ----------
function forecastV2Summary(e){
  if(!e||e.forecastModel!=='ensemble-v2')return '';
  const labels={weekday:'historie',recent7:'7 dní',recent14:'14 dní',pace:'tempo'},bits=[];
  for(const key of ['weekday','recent7','recent14','pace']){
    const w=Number(e.forecastWeights?.[key]);if(w>0)bits.push(`${labels[key]} ${Math.round(w*100)} %`);
  }
  const band=e.uncertaintySource==='backtest'
    ?`pásmo kalibrováno backtestem (${e.uncertaintySamples||0})`
    :`pásmo průběžně heuristické`;
  return `Forecast 2.0 · ${bits.join(' · ')} · ${band}`;
}
function renderForecastPanel(rs){
  const panel=$('#forecastPanel'),chart=$('#forecastChart'),meta=$('#forecastMeta');if(!panel||!chart||!meta)return;
  const keys=[...new Set(rs.filter(r=>monthIsLivePartial(r.monthKey)).map(r=>r.monthKey))].sort();if(!keys.length){panel.classList.add('hidden');return}
  const key=keys.at(-1),series=forecastCostSeries(key);if(!series){panel.classList.add('hidden');return}
  panel.classList.remove('hidden');$('#forecastTitle').textContent=`Predikce · ${monthLabel(key)}`;
  const e=series.estimate,rangeWidth=e.highProjectedCost-e.lowProjectedCost;
  const modelText=e.modelType==='tariff'
    ?`Tarif z faktury ${monthLabel(e.tariffSourceMonth)}: ${fmt.format(e.fixed)} Kč/měs. + ${fmt3.format(e.variableRate)} Kč/kWh vč. DPH`
    :`Statistický model: ${fmt.format(e.fixed)} Kč/měs. + ${fmt.format(e.variableRate)} Kč/kWh · stabilita ${Math.round(e.confidence*100)} %`;
  const energyModel=forecastV2Summary(e);
  meta.innerHTML=`<span><strong>${fmt.format(e.cost)} Kč</strong> odhad nákladů dosud</span><span class="scenario-mid"><strong>${fmt.format(e.projectedCost)} Kč</strong> střední scénář</span><span class="scenario-low"><strong>${fmt.format(e.lowProjectedCost)} Kč</strong> nižší scénář</span><span class="scenario-high"><strong>${fmt.format(e.highProjectedCost)} Kč</strong> vyšší scénář</span><span class="forecast-model"><strong>${escapeHtml(modelText)}</strong>${Number.isFinite(rangeWidth)?` · scénářové pásmo ${fmt.format(rangeWidth)} Kč`:''}</span>${energyModel?`<span class="forecast-model">${escapeHtml(energyModel)}</span>`:''}`;
  forecastBandChart(chart,series.data);
}
function renderForecastAccuracy(){
  const summary=$('#forecastAccuracySummary'),list=$('#forecastAccuracyList');if(!summary||!list)return;
  const data=forecastAccuracySummary();
  if(!data.count){summary.innerHTML='<strong>Zatím bez vyhodnoceného měsíce.</strong><span>Od verze 1.5.2 ukládáme predikci spotřeby nezávisle na fakturách. Po uzavření měsíce se zde automaticky vyhodnotí rolling backtest.</span>';list.innerHTML='';return}
  const bits=[];if(Number.isFinite(data.energyMape))bits.push(`spotřeba MAPE ${fmt.format(data.energyMape)} %`);if(Number.isFinite(data.mape))bits.push(`náklady MAPE ${fmt.format(data.mape)} %`);if(Number.isFinite(data.rangeHit))bits.push(`skutečnost v cenovém pásmu ${fmt.format(data.rangeHit)} %`);
  summary.innerHTML=`<strong>${escapeHtml(bits.join(' · ')||'Vyhodnocené predikce')}</strong><span>${data.count} ${data.count===1?'vyhodnocený měsíc':'vyhodnocené měsíce'} · používá se predikce uložená přibližně 7 dní před koncem, pokud existuje</span>`;
  list.innerHTML=data.rows.map(r=>{const energy=Number.isFinite(r.energyErrorPct)?`<small class="${r.energyErrorPct>0?'accuracy-over':'accuracy-under'}">spotřeba ${fmt3.format(r.predictedEnergy)} → ${fmt3.format(r.actualEnergy)} kWh · ${r.energyErrorPct>=0?'+':''}${fmt.format(r.energyErrorPct)} %</small>`:'';const cost=Number.isFinite(r.errorPct)?`<small class="${r.errorPct>0?'accuracy-over':'accuracy-under'}">náklady ${fmt.format(r.predicted)} → ${fmt.format(r.invoice)} Kč · ${r.errorPct>=0?'+':''}${fmt.format(r.errorPct)} %${r.inside===null?'':r.inside?' · v pásmu':' · mimo pásmo'}</small>`:'';return `<div class="accuracy-row"><div><strong>${escapeHtml(monthLabel(r.monthKey))}</strong><small>predikce z ${escapeHtml(formatDateKey(r.asOfDate))} · ${r.daysRemaining} d do konce</small></div><div class="accuracy-values">${energy}${cost}</div></div>`}).join('');
}
function renderAnomalies(rs){
  const summary=$('#anomalySummary'),list=$('#anomalyList');if(!summary||!list)return;
  const days=detectDailyAnomalies(rs),intervals=detectIntervalAnomalies(rs);
  if(!days.length&&!intervals.length){summary.innerHTML='<strong>Bez výrazných anomálií.</strong><span>Vybrané období nevykazuje proti dostupné historii mimořádně vysokou denní spotřebu ani 15minutovou špičku.</span>';list.innerHTML='';return}
  summary.innerHTML=`<strong>${days.length+intervals.length} neobvyklých událostí</strong><span>${days.length} denních · ${intervals.length} intervalových. Porovnání používá pouze dřívější data, takže budoucí hodnoty neovlivňují základ.</span>`;
  const dailyHtml=days.map(d=>`<div class="anomaly-row"><span class="anomaly-badge">DEN</span><div><strong>${escapeHtml(formatDateKey(d.dateKey))} · ${fmt3.format(d.energy)} kWh</strong><small>typický stejný den ${fmt3.format(d.baseline)} kWh · ${fmt.format(d.ratio)}× více</small></div></div>`);
  const intervalHtml=intervals.map(a=>`<div class="anomaly-row"><span class="anomaly-badge peak">15m</span><div><strong>${escapeHtml(a.record.displayTimestamp)} · ${fmt.format(a.current)} kW</strong><small>typicky v tomto čase ${fmt.format(a.baseline)} kW${Number.isFinite(a.ratio)?` · ${fmt.format(a.ratio)}× více`:''}</small></div></div>`);
  list.innerHTML=[...dailyHtml,...intervalHtml].join('');
}
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
  const forecastPanel=$('#forecastPanel');if(forecastPanel)forecastPanel.classList.add('hidden');
  $$('.dashboard-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.dashboardMode===state.dashboardMode));
  $('#metricToggle').classList.toggle('hidden',costMode);
  $('#effectivePricePanel').classList.toggle('hidden',!costMode);
  const chartControls=$('#energyChartControls');if(chartControls)chartControls.classList.toggle('hidden',costMode||state.period!=='month');
  $$('.chart-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.chartMode===state.chartMode));
  const compareSelect=$('#compareMode');if(compareSelect)compareSelect.value=state.compareMode;
  $$('.metric-btn').forEach(b=>b.classList.toggle('active',b.dataset.metric===state.metric));

  const activeMonths=state.months.filter(m=>m.enabled!==false).sort((a,b)=>a.monthKey.localeCompare(b.monthKey));
  if(costMode){
    const costMonthly=activeMonths.map(m=>{
      const invoice=monthInvoice(m.monthKey),estimate=monthIsLivePartial(m.monthKey)?estimatedMonthCost(m.monthKey):null;
      if(invoice!==null&&m.complete===true)return {label:monthLabel(m.monthKey),short:m.monthKey.slice(5,7)+'/'+m.monthKey.slice(2,4),value:invoice};
      if(estimate&&Number.isFinite(estimate.projectedCost))return {label:monthLabel(m.monthKey)+' · predikce',short:m.monthKey.slice(5,7)+'/'+m.monthKey.slice(2,4),value:estimate.projectedCost};
      return null;
    }).filter(Boolean);
    const priceMonthly=activeMonths.map(m=>{
      const actual=monthEffectivePrice(m.monthKey),estimate=monthIsLivePartial(m.monthKey)?estimatedMonthCost(m.monthKey):null;
      if(actual!==null&&m.complete===true)return {label:monthLabel(m.monthKey),short:m.monthKey.slice(5,7)+'/'+m.monthKey.slice(2,4),value:actual};
      if(estimate&&Number.isFinite(estimate.rate))return {label:monthLabel(m.monthKey)+' · odhad',short:m.monthKey.slice(5,7)+'/'+m.monthKey.slice(2,4),value:estimate.rate};
      return null;
    }).filter(Boolean);
    $('#monthlyChartTitle').textContent='Náklady po měsících';
    $('#monthlyChartSubtitle').textContent='Faktury; průběžný měsíc používá predikci celé měsíční faktury';
    barChart($('#monthlyChart'),costMonthly,{unit:'Kč'});
    lineChart($('#effectivePriceChart'),priceMonthly,{unit:'Kč/kWh'});
  }else{
    const monthly=group(sortedRecords(),r=>r.monthKey),md=[...monthly].sort().map(([k,v])=>({label:monthLabel(k),short:k.slice(5,7)+'/'+k.slice(2,4),value:v}));
    $('#monthlyChartTitle').textContent='Spotřeba po měsících';
    $('#monthlyChartSubtitle').textContent='Dlouhodobý vývoj importovaných dat';
    barChart($('#monthlyChart'),md,{unit:'kWh'});
  }

  let rs=currentRange();
  const rangeHasApi=rs.some(r=>r.source==='egd-api');
  const dcc0Btn=$('.metric-btn[data-metric="dcc0"]');if(dcc0Btn)dcc0Btn.disabled=rangeHasApi;
  if(rangeHasApi&&state.metric==='dcc0'){
    state.metric='dcc1';localStorage.setItem(METRIC_KEY,state.metric);rs=currentRange();
    $$('.metric-btn').forEach(b=>b.classList.toggle('active',b.dataset.metric===state.metric));
  }
  $('#heroPeriod').textContent=selectedPeriodLabel();
  renderDataHealth(state.period==='month'?expectedCurrentMonthKeys()[0]:null);

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
    const cb=costProjectionForRecords(rs),daily=dailyCostData(rs),dailyData=[...daily].sort().map(([k,v])=>({label:k.slice(8,10)+'.'+k.slice(5,7)+'.',value:v}));
    const estimatedCount=cb.estimatedMonths.size,hasCost=cb.knownMonths>0||estimatedCount>0,total=cb.totalWithEstimate;
    $('#heroUnit').textContent='Kč';
    $('#heroKwh').textContent=hasCost?(estimatedCount?'≈ '+fmt.format(total):fmt.format(total)):'—';
    const liveKeys=[...new Set(rs.filter(r=>monthIsLivePartial(r.monthKey)).map(r=>r.monthKey))];
    if(cb.missingUnresolved.length)$('#heroDelta').textContent=`Neúplné náklady · chybí ${cb.missingUnresolved.length} ${cb.missingUnresolved.length===1?'faktura':'faktury'}`;
    else if(cb.unallocatableUnresolved.length)$('#heroDelta').textContent='Část nákladů nelze rozdělit na neúplné období';
    else if(estimatedCount){
      const [key,estimate]=[...cb.estimatedMonths].at(-1);
      $('#heroDelta').textContent=`Odhad dosud ${fmt.format(estimate.cost)} Kč · predikce ${fmt.format(estimate.projectedCost)} Kč · rozpětí ${fmt.format(estimate.lowProjectedCost)}–${fmt.format(estimate.highProjectedCost)} Kč`;
    }
    else if(liveKeys.length)$('#heroDelta').textContent='Odhad nelze určit · chybí použitelná faktura v předchozích 3 měsících';
    else if(!cb.knownMonths)$('#heroDelta').textContent='Pro zvolené období není vyplněná žádná faktura';
    else if(state.period==='custom')$('#heroDelta').textContent='Vlastní období · náklady jsou poměrně přepočtené podle DCC1';
    else if(state.period==='all')$('#heroDelta').textContent='Součet všech vyplněných faktur';
    else{
      const prev=costForRecords(previousComparable()),prevKeys=expectedPreviousMonthKeys();
      const prevReady=prevKeys.length&&prevKeys.every(k=>monthInvoice(k)!==null&&monthIsComplete(k))&&prev.knownMonths===prevKeys.length;
      if(prevReady&&prev.total>0){const delta=(cb.total-prev.total)/prev.total*100;$('#heroDelta').textContent=`${delta>=0?'▲':'▼'} ${fmt.format(Math.abs(delta))} % proti předchozímu období`}
      else $('#heroDelta').textContent='Předchozí období nemá kompletní finanční data';
    }
    lineChart($('#mainChart'),dailyData,{hero:true,unit:'Kč'});renderForecastPanel(rs);
    const dayCount=Math.max(1,new Set(rs.map(r=>r.dateKey)).size);
    $('#avgDayLabel').textContent=estimatedCount?'Odhad / den':'Průměr / den';$('#avgDay').textContent=hasCost?fmt.format(total/dayCount):'—';$('#avgDayUnit').textContent='Kč / den';
    $('#maxPowerLabel').textContent=estimatedCount?'Použitá cena':'Efektivní cena';$('#maxPower').textContent=cb.coveredEnergyWithEstimate>0?fmt.format(total/cb.coveredEnergyWithEstimate):'—';$('#maxPowerSub').textContent=estimatedCount?'Kč / kWh · včetně odhadu':'Kč / kWh · podle DCC1';
    const combinedCosts=new Map(cb.monthCosts);for(const [k,e] of cb.estimatedMonths)combinedCosts.set(k,e.cost);
    const expensive=[...combinedCosts].sort((a,b)=>b[1]-a[1])[0],expensiveEstimated=expensive&&cb.estimatedMonths.has(expensive[0]);
    $('#bestDayLabel').textContent='Nejdražší měsíc';$('#bestDay').textContent=expensive?`${expensive[0].slice(5,7)}/${expensive[0].slice(2,4)}`:'—';$('#bestDaySub').textContent=expensive?`${expensiveEstimated?'≈ ':''}${fmt.format(expensive[1])} Kč`:'—';
    $('#baseLoadLabel').textContent='Pokrytí nákladů';$('#baseLoad').textContent=estimatedCount?`${cb.knownMonths} + ${estimatedCount}/${cb.groupCount}`:`${cb.knownMonths}/${cb.groupCount}`;$('#baseLoadUnit').textContent=estimatedCount?'faktury + odhad':'měsíců s cenou';
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
      const estimate=live?estimateRateForMonth(live.monthKey):null;
      const availability=live?.lastAvailableAt?`data do ${new Date(live.lastAvailableAt).toLocaleString('cs-CZ')}`:'průběžná data EG.D';
      if(estimate&&Number.isFinite(estimate.predictedEnergy)){
        $('#heroDelta').textContent=`Spotřeba dosud ${fmt3.format(total)} kWh · predikce celého měsíce ≈ ${fmt3.format(estimate.predictedEnergy)} kWh · tempo ${fmt3.format(estimate.paceEnergy)} kWh · ${availability}`;
      }else $('#heroDelta').textContent=`Spotřeba dosud ${fmt3.format(total)} kWh · ${availability}`;
    }
    else if(!keysComplete(currentKeys))$('#heroDelta').textContent='Neúplné období · chybí importované měsíce';
    else if(!keysComplete(prevKeys))$('#heroDelta').textContent='Předchozí srovnatelné období není kompletní';
    else if(prevTotal===0)$('#heroDelta').textContent='Předchozí období: 0 kWh';
    else{const delta=(total-prevTotal)/prevTotal*100;$('#heroDelta').textContent=`${delta>=0?'▲':'▼'} ${fmt.format(Math.abs(delta))} % proti předchozímu období`}
  }
  const daily=group(rs,r=>r.dateKey),dailyData=[...daily].sort().map(([k,v])=>({label:k.slice(8,10)+'.'+k.slice(5,7)+'.',value:v}));
  const monthKey=state.period==='month'?expectedCurrentMonthKeys()[0]:null,monthSeries=monthKey?prepareEnergyChartSeries(monthKey):null;
  if(monthSeries)energyForecastLineChart($('#mainChart'),monthSeries.data,{comparison:monthSeries.comparison,cumulative:state.chartMode==='cumulative'});
  else lineChart($('#mainChart'),dailyData,{hero:true,unit:'kWh'});
  $('#avgDayLabel').textContent='Denní průměr';$('#avgDay').textContent=fmt3.format(total/Math.max(1,daily.size));$('#avgDayUnit').textContent='kWh / den';
  const peak=rs.reduce((a,b)=>val(b)>val(a)?b:a,rs[0]);$('#maxPowerLabel').textContent='Maximum';$('#maxPower').textContent=fmt.format(val(peak));$('#maxPowerSub').textContent=`kW · ${peak.displayTimestamp}`;
  const best=[...daily].sort((a,b)=>b[1]-a[1])[0];$('#bestDayLabel').textContent='Nejsilnější den';$('#bestDay').textContent=best?`${best[0].slice(8,10)}.${best[0].slice(5,7)}.`:'—';$('#bestDaySub').textContent=best?`${fmt3.format(best[1])} kWh`:'—';
  const night=rs.filter(r=>r.hour<6);$('#baseLoadLabel').textContent='Základní odběr';$('#baseLoad').textContent=night.length?`${fmt.format(night.reduce((sum,r)=>sum+val(r),0)/night.length*1000)} W`:'—';$('#baseLoadUnit').textContent='průměr 00–06 h';
}
function renderAnalysis(){
  const rs=currentRange();renderForecastAccuracy();
  if(!rs.length){
    const expected=expectedCurrentMonthKeys(),message=expected.length&&keysContainDisabled(expected)?'Zvolené období obsahuje vypnutá data':'Pro zvolené období nejsou aktivní data';
    ['weekdayChart','hourlyChart','heatmap','daypartList','peaksList'].forEach(id=>$('#'+id).innerHTML=`<div class="chart-empty">${message}</div>`);
    $('#daypartSubtitle').textContent=message;
    const anomalySummary=$('#anomalySummary'),anomalyList=$('#anomalyList');if(anomalySummary)anomalySummary.innerHTML=`<strong>Bez dat pro analýzu.</strong><span>${escapeHtml(message)}</span>`;if(anomalyList)anomalyList.innerHTML='';
    return;
  }
  const dateTotals=group(rs,r=>r.dateKey),dateWeek={};rs.forEach(r=>dateWeek[r.dateKey]=r.weekday);
  const sums=Array(7).fill(0),counts=Array(7).fill(0);for(const [date,v] of dateTotals){const wd=dateWeek[date];sums[wd]+=v;counts[wd]++}
  barChart($('#weekdayChart'),WEEK_MON.map((d,i)=>({label:d,short:d,value:counts[i]?sums[i]/counts[i]:0})),{unit:'kWh/den'});
  const type=$('#dayTypeSelect').value,filtered=rs.filter(r=>type==='all'||(type==='workday'&&r.weekday<5)||(type==='weekend'&&r.weekday>=5)),havg=groupAvg(filtered,r=>r.hour,val);
  lineChart($('#hourlyChart'),Array.from({length:24},(_,h)=>({label:String(h).padStart(2,'0'),value:havg.get(h)||0})),{unit:'kW'});
  renderHeatmap(rs);renderDayparts(rs);renderPeaks(rs);renderAnomalies(rs);
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
    const enabled=m.enabled!==false,finance=normalizeFinance(m.finance),invoice=finance.invoiceTotal,kwh=monthBillingEnergy(m.monthKey),effective=invoice!==null&&kwh>0?invoice/kwh:null,detailed=INVOICE.hasDetailedBreakdown(finance),tariffOk=INVOICE.hasValidatedTariff(finance);
    const isApi=m.source==='egd-api',partial=isApi&&m.complete!==true,estimate=partial?estimatedMonthCost(m.monthKey):null,quality=m.apiStatusCounts||{},sourceTag=isApi?'<span class="month-source">EG.D</span>':'<span class="month-source">XLSX</span>';
    const liveTag=partial?'<span class="month-live-badge">PRŮBĚŽNÝ</span>':'';
    const qualityText=isApi?Object.entries(quality).sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>`${code} ${count}`).join(' · '):'';
    const monthRecords=state.records.filter(r=>r.monthKey===m.monthKey),usableCount=monthRecords.filter(recordUsable).length,provisionalCount=monthRecords.filter(recordProvisional).length,gaps=isApi?closedIntervalGaps(monthRecords,m.monthKey):[],gapDays=new Set(gaps.map(g=>g.dateKey)).size;
    const qualityUsage=isApi?` · použito ${usableCount.toLocaleString('cs-CZ')}/${Number(m.count||0).toLocaleString('cs-CZ')}${provisionalCount?` · předběžných ${provisionalCount.toLocaleString('cs-CZ')}`:''}${gaps.length?` · chybí ${gaps.length} intervalů ve ${gapDays} dnech`:' · uzavřené dny bez mezer'}`:'';
    const availability=partial&&m.lastAvailableAt?` · do ${new Date(m.lastAvailableAt).toLocaleString('cs-CZ')}`:'';
    const stateText=monthIsComplete(m.monthKey)?'✓ kompletní':partial&&enabled?'● průběžně':enabled?'⚠ zkontrolovat':'—';
    const pdfSummary=finance.source==='pdf'
      ?`<div class="invoice-source-summary"><div><strong>PDF · ${escapeHtml(finance.invoiceMeta.supplier||'faktura')}</strong><span>${detailed?'rozpad ceny načten':''}${tariffOk?` · tarif ${fmt.format(finance.tariff.fixedGrossPerMonth)} Kč/měs. + ${fmt3.format(finance.tariff.variableGrossPerKwh)} Kč/kWh vč. DPH`:''}</span></div><button class="invoice-detail-btn" data-invoice-detail="${m.monthKey}">Detail</button></div>`
      :'';
    let estimateHtml='';
    if(partial){
      estimateHtml=estimate&&Number.isFinite(estimate.cost)
        ?`<div class="month-estimate"><strong>Odhad dosud: ≈ ${fmt.format(estimate.cost)} Kč</strong><span class="estimate-rate">Predikce faktury: ≈ <strong>${fmt.format(estimate.projectedCost)} Kč</strong> · scénářové rozpětí <strong>${fmt.format(estimate.lowProjectedCost)}–${fmt.format(estimate.highProjectedCost)} Kč</strong></span><span class="estimate-rate"><strong>Spotřeba dosud: ${fmt3.format(estimate.actualEnergy)} kWh</strong> · predikce celého měsíce ≈ <strong>${fmt3.format(estimate.predictedEnergy)} kWh</strong></span><span class="estimate-rate">Scénář aktuálního tempa ${fmt3.format(estimate.paceEnergy)} kWh · chybí ${estimate.missingClosedIntervals||0} intervalů · dotčeno dnů ${estimate.incompleteClosedDays||0}</span><span class="estimate-rate">${estimate.modelType==='tariff'?`Tarif z faktury ${monthLabel(estimate.tariffSourceMonth)}: ${fmt.format(estimate.fixed)} Kč/měs. + ${fmt3.format(estimate.variableRate)} Kč/kWh vč. DPH`:`Cena: fixní část ≈ ${fmt.format(estimate.fixed)} Kč/měs. + ${fmt.format(estimate.variableRate)} Kč/kWh · stabilita ${Math.round(estimate.confidence*100)} % · cenový základ ${estimate.count}/3 měsíců${estimate.months.length?' ('+estimate.months.map(k=>k.slice(5,7)+'/'+k.slice(2,4)).join(', ')+')':''}`}</span><span class="estimate-rate">Spotřební základ: ${estimate.energyMonths?.length||0} měsíců${estimate.energyMonths?.length?' ('+estimate.energyMonths.map(k=>k.slice(5,7)+'/'+k.slice(2,4)).join(', ')+')':''}</span>${forecastV2Summary(estimate)?`<span class="estimate-rate">${escapeHtml(forecastV2Summary(estimate))}</span>`:''}</div>`
        :estimate&&Number.isFinite(estimate.predictedEnergy)&&estimate.energyMonths?.length
          ?`<div class="month-estimate"><strong>Spotřeba dosud: ${fmt3.format(estimate.actualEnergy)} kWh</strong><span class="estimate-rate">Predikce celého měsíce: ≈ <strong>${fmt3.format(estimate.predictedEnergy)} kWh</strong> · scénářové rozpětí ${fmt3.format(estimate.lowEnergy)}–${fmt3.format(estimate.highEnergy)} kWh</span><span class="estimate-rate">Scénář aktuálního tempa ${fmt3.format(estimate.paceEnergy)} kWh · chybí ${estimate.missingClosedIntervals||0} intervalů · dotčeno dnů ${estimate.incompleteClosedDays||0}</span><span class="estimate-rate">Spotřební základ: ${estimate.energyMonths.length} měsíců${estimate.energyMonths.length?' ('+estimate.energyMonths.map(k=>k.slice(5,7)+'/'+k.slice(2,4)).join(', ')+')':''}. Náklady zatím nelze odhadnout, protože chybí použitelná historie faktur.</span>${forecastV2Summary(estimate)?`<span class="estimate-rate">${escapeHtml(forecastV2Summary(estimate))}</span>`:''}</div>`
          :`<div class="month-estimate"><strong>Predikci zatím nelze určit</strong><span class="estimate-rate">Je potřeba alespoň jeden kompletní předchozí měsíc spotřeby; pro odhad nákladů navíc historie faktur.</span></div>`;
    }
    return `<div class="month-row ${enabled?'':'month-disabled'}">
      <div class="month-main">
        <strong>${escapeHtml(m.label)} ${sourceTag} ${liveTag}</strong>
        <div>${Number(m.count||0).toLocaleString('cs-CZ')} intervalů · ${escapeHtml(m.fileName||'')}${escapeHtml(availability)}</div>
        ${isApi?`<div class="month-quality">Kvalita EG.D: ${escapeHtml(qualityText||'bez stavových kódů')}${escapeHtml(qualityUsage)} · B/W se zobrazují jako předběžné; explicitně nepoužitelné IU statusy se vyřazují · profil ${escapeHtml(m.apiProfile||'—')} · ${escapeHtml(m.apiUnits||'—')}</div>`:''}
        <div class="month-finance">
          <label class="invoice-field"><span>Faktura</span><input inputmode="decimal" data-month-invoice="${m.monthKey}" value="${invoice===null?'':String(invoice).replace('.',',')}" placeholder="${partial?'po uzavření':'např. 1842'}" ${partial?'disabled':''}><b>Kč</b></label>
          <button class="invoice-pdf-btn" data-invoice-pdf="${m.monthKey}" ${partial?'disabled':''}>Načíst PDF</button>
          <span class="effective-price">${effective===null?(invoice!==null&&kwh===0?'0 kWh · cenu/kWh nelze určit':'Cena/kWh —'):`Efektivně <strong>${fmt.format(effective)} Kč/kWh</strong>`}</span>
        </div>
        ${pdfSummary}
        ${estimateHtml}
        <div class="finance-note">${partial?'Fakturu doplníš po uzavření měsíce. Predikce spotřeby je nezávislá na fakturách; denní snapshot forecastu se ukládá pouze lokálně pro následné vyhodnocení přesnosti.':'Celková částka faktury. Efektivní cena = faktura ÷ spotřeba DCC1.'}</div>
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
  $$('[data-invoice-pdf]').forEach(b=>b.onclick=()=>{state.pendingInvoicePdf={monthKey:b.dataset.invoicePdf};$('#invoicePdfInput').click()});
  $$('[data-invoice-detail]').forEach(b=>b.onclick=()=>showStoredInvoiceDetail(b.dataset.invoiceDetail));
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
    {name:'Finanční přehled',rows:[['Měsíc','Zdroj','Faktura celkem (Kč)','Bez DPH (Kč)','DPH (Kč)','DCC1 spotřeba (kWh)','Spotřeba dle faktury (kWh)','Efektivní cena (Kč/kWh)','Silová elektřina','Stálý plat dodavatele','Daň z elektřiny','Distribuce dle spotřeby','Jistič','Systémové služby','Nesíťová infrastruktura','POZE','Ostatní','Fix vč. DPH (Kč/měs.)','Variabilní vč. DPH (Kč/kWh)','EAN','Doklad'],...financeMonths.map(k=>{const invoice=monthInvoice(k),kwh=monthBillingEnergy(k),price=invoice!==null&&kwh>0?invoice/kwh:'',f=normalizeFinance(monthMeta(k)?.finance),c=f.components,t=f.tariff;return [monthLabel(k),f.source,invoice??'',f.totals.exVat??'',f.totals.vat??'',kwh,f.metering.consumptionKwh??'',price,c.supplyEnergy??'',c.supplierFixed??'',c.electricityTax??'',c.distributionEnergy??'',c.breaker??'',c.systemServices??'',c.distributionFixed??'',c.poze??'',c.other??'',t.validated?t.fixedGrossPerMonth:'',t.validated?t.variableGrossPerKwh:'',f.metering.ean||'',f.invoiceMeta.documentNumber||'']})]}
  ];
  const apiRows=rs.filter(r=>r.source==='egd-api');
  if(apiRows.length)sheets.splice(3,0,{name:'EG.D raw',rows:[['UTC timestamp','Místní čas','Profil','Jednotka','Raw hodnota','Rekonstruovaná hodnota','Původ hodnoty','Normalizovaný výkon (kW)','Energie intervalu (kWh)','Status','Klasifikace','Použitelné','Předběžné'],...apiRows.map(r=>{const q=egdStatusInfo(r.apiStatus),reconstructed=apiValueFromKw(r.dcc1,r.apiUnits,r.intervalMinutes||15),hasRaw=Number.isFinite(Number(r.apiRawValue));return [r.apiTimestampUtc||new Date(r.sortKey).toISOString(),r.displayTimestamp||r.sourceTimestamp,r.apiProfile||'',r.apiUnits||'',hasRaw?Number(r.apiRawValue):'',reconstructed??'',hasRaw?'raw z EG.D':'rekonstrukce ze staršího záznamu',Number(r.dcc1)||0,billingEnergy(r),r.apiStatus||'',q.kind,q.usable?'ano':'ne',q.provisional?'ano':'ne']})]});
  const files=[];files.push({name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`});
  files.push({name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`});
  files.push({name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`});
  files.push({name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`});
  sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s.rows)}));const zip=zipStored(files);downloadBlob(new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`energo_${$('#exportFrom').value}_${$('#exportTo').value}.xlsx`)
}

// ---------- Backup / restore ----------
async function backupLocalData(){
  const payload={format:'energo-prehled-backup',version:1,appVersion:APP_VERSION,createdAt:new Date().toISOString(),metric:state.metric,ui:{period:state.period,anchorMonth:state.anchorMonth,customFrom:state.customFrom,customTo:state.customTo,daypartMode:state.daypartMode,dashboardMode:state.dashboardMode,chartMode:state.chartMode,compareMode:state.compareMode,comparePrevious:state.compareMode==='previous'},records:await getAll('intervals'),months:await getAll('months')};
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
    if(['daily','cumulative'].includes(payload.ui.chartMode))state.chartMode=payload.ui.chartMode;
    if(['none','previous','yearAgo'].includes(payload.ui.compareMode))state.compareMode=payload.ui.compareMode;
    else if(typeof payload.ui.comparePrevious==='boolean')state.compareMode=payload.ui.comparePrevious?'previous':'none';
    localStorage.setItem(DAYPART_KEY,state.daypartMode);localStorage.setItem(DASHBOARD_MODE_KEY,state.dashboardMode);localStorage.setItem(CHART_MODE_KEY,state.chartMode);localStorage.setItem(COMPARE_MODE_KEY,state.compareMode);localStorage.setItem(COMPARE_PREVIOUS_KEY,state.compareMode==='previous'?'1':'0');persistPeriodState();
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
      const betaPath=new URL('./',location.href).pathname;
      await Promise.all(regs.filter(r=>{try{return new URL(r.scope).pathname.startsWith(betaPath)}catch{return false}}).map(r=>r.unregister()));
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
  $('#invoicePdfInput').onchange=e=>{const file=e.target.files?.[0];if(file)handleInvoicePdfFile(file)};
  $('#cancelInvoicePdf').onclick=cancelInvoicePdf;
  $('#confirmInvoicePdf').onclick=()=>saveParsedInvoice().catch(e=>{console.error(e);alert('Fakturu se nepodařilo uložit: '+e.message)});
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
  $$('.chart-mode-btn').forEach(b=>b.onclick=()=>{state.chartMode=b.dataset.chartMode==='cumulative'?'cumulative':'daily';localStorage.setItem(CHART_MODE_KEY,state.chartMode);renderOverview()});
  $('#compareMode').onchange=e=>{state.compareMode=['previous','yearAgo'].includes(e.target.value)?e.target.value:'none';localStorage.setItem(COMPARE_MODE_KEY,state.compareMode);localStorage.setItem(COMPARE_PREVIOUS_KEY,state.compareMode==='previous'?'1':'0');renderOverview()};
  $$('.metric-btn').forEach(b=>b.onclick=()=>{state.metric=b.dataset.metric;localStorage.setItem(METRIC_KEY,state.metric);renderAll()});
  $('#dayTypeSelect').onchange=renderAnalysis;
  $$('.daypart-btn').forEach(b=>b.onclick=()=>{state.daypartMode=b.dataset.daypartMode;localStorage.setItem(DAYPART_KEY,state.daypartMode);renderDayparts(currentRange())});
  $('#cancelReplace').onclick=()=>{$('#replaceModal').classList.add('hidden');state.pendingImport=null};
  $('#confirmReplace').onclick=async()=>{const p=state.pendingImport;$('#replaceModal').classList.add('hidden');if(p)await saveImport(p,true)};
  $('#egdTestBtn').onclick=()=>testEgdConnection().catch(e=>alert('EG.D připojení se nepodařilo: '+e.message));
  $('#egdSyncBtn').onclick=()=>syncEgdData().catch(e=>alert('EG.D synchronizace se nepodařila: '+e.message));
  $('#egdDisconnectBtn').onclick=()=>disconnectEgd().catch(e=>alert('Odpojení EG.D se nepodařilo: '+e.message));
  $('#egdEanSelect').onchange=async()=>{
    state.egd.ean=$('#egdEanSelect').value;
    const om=state.egd.oms.find(x=>x.ean===state.egd.ean);
    state.egd.profile=chooseConsumptionProfile(state.egd.profiles,om?.typMereni,state.egd.profile);
    await saveEgdConfig();renderEgdPanel();
  };
  $('#egdProfileSelect').onchange=()=>saveEgdSelections().catch(console.error);
  $('#egdAutoSync').onchange=async e=>{state.egd.autoSync=e.target.checked;await saveEgdConfig();showToast(state.egd.autoSync?'Automatická synchronizace zapnuta':'Automatická synchronizace vypnuta')};
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
  try{db=await openDB();await loadEgdSettings();bind();await reload();await maybeAutoSyncEgd()}catch(e){console.error(e);alert('Aplikaci se nepodařilo inicializovat: '+e.message)}
})();
