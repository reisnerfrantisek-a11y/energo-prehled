'use strict';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const fmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 });
const fmt3 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 });
const MONTH_NAMES = ['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const WEEK = ['Ne','Po','Út','St','Čt','Pá','So'];
const WEEK_MON = ['Po','Út','St','Čt','Pá','So','Ne'];

let db;
let state = { records: [], metric: localStorage.getItem('metric') || 'dcc1', period: 'month', pendingImport: null };

// ---------- IndexedDB ----------
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('energo-prehled',1);
    req.onupgradeneeded=()=>{
      const d=req.result;
      const store=d.createObjectStore('intervals',{keyPath:'id'});
      store.createIndex('monthKey','monthKey');
      store.createIndex('dateKey','dateKey');
      store.createIndex('sortKey','sortKey');
      d.createObjectStore('months',{keyPath:'monthKey'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)})}
async function getAll(store){return new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function deleteMonth(monthKey){
  const tx=db.transaction(['intervals','months'],'readwrite'), s=tx.objectStore('intervals'), idx=s.index('monthKey');
  await new Promise((res,rej)=>{const r=idx.openCursor(IDBKeyRange.only(monthKey));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue()}else res()};r.onerror=()=>rej(r.error)});
  tx.objectStore('months').delete(monthKey); await txDone(tx); await reload(); showToast('Měsíc byl odstraněn');
}
async function saveImport(payload, replace=false){
  if(replace){
    const tx0=db.transaction(['intervals','months'],'readwrite'), s0=tx0.objectStore('intervals'), idx=s0.index('monthKey');
    await new Promise((res,rej)=>{const r=idx.openCursor(IDBKeyRange.only(payload.month.monthKey));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue()}else res()};r.onerror=()=>rej(r.error)});
    tx0.objectStore('months').delete(payload.month.monthKey); await txDone(tx0);
  }
  const tx=db.transaction(['intervals','months'],'readwrite'), s=tx.objectStore('intervals');
  payload.records.forEach(r=>s.put(r)); tx.objectStore('months').put(payload.month); await txDone(tx);
  state.pendingImport=null; await reload(); showToast(`${payload.month.label}: importováno ${payload.records.length.toLocaleString('cs-CZ')} intervalů`);
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
      const ds=new DecompressionStream('deflate-raw');
      out=new Uint8Array(await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer());
    } else throw new Error(`Nepodporovaná komprese ZIP (${method}).`);
    if(usize && out.length!==usize) console.warn('ZIP size mismatch',name);
    entries.set(name,out); p+=46+nlen+xlen+clen;
  }
  return entries;
}
function xml(bytes){return new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml')}
function colIndex(ref){let n=0;for(const c of ref.match(/[A-Z]+/)[0]) n=n*26+c.charCodeAt(0)-64;return n-1}
function cellText(c, shared){
  const t=c.getAttribute('t');
  if(t==='inlineStr') return [...c.querySelectorAll('t')].map(x=>x.textContent||'').join('');
  const v=c.querySelector('v')?.textContent ?? '';
  if(t==='s') return shared[Number(v)] ?? '';
  return v;
}
function parseCzTimestamp(s){
  const m=String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/); if(!m)return null;
  const [,dd,mm,yyyy,hh,mi,ss='00']=m; return {year:+yyyy,month:+mm,day:+dd,hour:+hh,minute:+mi,second:+ss,dateKey:`${yyyy}-${mm}-${dd}`,monthKey:`${yyyy}-${mm}`,display:`${dd}.${mm}.${yyyy} ${hh}:${mi}`,source:s,sortKey:Date.UTC(+yyyy,+mm-1,+dd,+hh,+mi,+ss)};
}
function weekdayMon(ts){const d=new Date(Date.UTC(ts.year,ts.month-1,ts.day)).getUTCDay();return d===0?6:d-1}
async function parseReport(file){
  const entries=await unzipXlsx(await file.arrayBuffer());
  const shared=[];
  if(entries.has('xl/sharedStrings.xml')){const doc=xml(entries.get('xl/sharedStrings.xml'));doc.querySelectorAll('si').forEach(si=>shared.push([...si.querySelectorAll('t')].map(t=>t.textContent||'').join('')))}
  const sheetName=[...entries.keys()].filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if(!sheetName) throw new Error('V XLSX nebyl nalezen list s daty.');
  const doc=xml(entries.get(sheetName)), rows=[...doc.querySelectorAll('sheetData > row')];
  const matrix=new Map();
  rows.forEach(row=>{const rn=Number(row.getAttribute('r'));const map=new Map();row.querySelectorAll(':scope > c').forEach(c=>map.set(colIndex(c.getAttribute('r')),cellText(c,shared)));matrix.set(rn,map)});
  const row3=matrix.get(3)||new Map(); let dcc0Col=-1,dcc1Col=-1;
  for(const [col,val] of row3){if(String(val).trim()==='DCC0')dcc0Col=col;if(String(val).trim()==='DCC1')dcc1Col=col}
  if(dcc0Col<0 || dcc1Col<0){dcc0Col=1;dcc1Col=2}
  function meta(label){for(let rn=1;rn<=4;rn++){const r=matrix.get(rn);if(!r)continue;for(const [c,v] of r)if(String(v).trim()===label)return String(r.get(c+1)||'').trim()}return ''}
  const ean=meta('EAN')||'neznámý EAN', meter=meta('Číslo elm.')||'';
  const records=[]; let first=null,last=null;
  for(const [rn,r] of matrix){const ts=parseCzTimestamp(r.get(0));if(!ts)continue;first=first||ts;last=ts;const d0=Number(String(r.get(dcc0Col)??'0').replace(',','.'))||0,d1=Number(String(r.get(dcc1Col)??'0').replace(',','.'))||0;records.push({id:`${ean}|${ts.source}|${rn}`,ean,meter,monthKey:ts.monthKey,dateKey:ts.dateKey,sourceTimestamp:ts.source,displayTimestamp:ts.display,sortKey:ts.sortKey,year:ts.year,month:ts.month,day:ts.day,hour:ts.hour,minute:ts.minute,weekday:weekdayMon(ts),dcc0:d0,dcc1:d1})}
  if(!records.length) throw new Error('V reportu nebyly nalezeny 15minutové hodnoty.');
  records.sort((a,b)=>a.sortKey-b.sortKey || a.id.localeCompare(b.id));
  const counts={};records.forEach(r=>counts[r.dateKey]=(counts[r.dateKey]||0)+1);const incomplete=Object.entries(counts).filter(([,c])=>![92,96,100].includes(c));
  const monthKey=first.monthKey,label=`${MONTH_NAMES[first.month-1]} ${first.year}`;
  return {records,month:{monthKey,label,year:first.year,month:first.month,ean,meter,count:records.length,first:first.source,last:last.source,incompleteDays:incomplete.length,importedAt:new Date().toISOString(),fileName:file.name}};
}

// ---------- Analytics ----------
const val = r => Number(r[state.metric]||0);
const energy = r => val(r)*0.25;
function sortedRecords(){return [...state.records].sort((a,b)=>a.sortKey-b.sortKey)}
function monthLabel(k){const [y,m]=k.split('-').map(Number);return `${MONTH_NAMES[m-1]} ${y}`}
function currentRange(){
  if(!state.records.length)return [];
  const all=sortedRecords(), last=all[all.length-1], endMonth=last.monthKey;
  if(state.period==='all')return all;
  if(state.period==='month')return all.filter(r=>r.monthKey===endMonth);
  if(state.period==='year')return all.filter(r=>r.year===last.year);
  if(state.period==='3m'){
    const end=last.year*12+(last.month-1), start=end-2;return all.filter(r=>{const x=r.year*12+(r.month-1);return x>=start&&x<=end})
  }
  return all;
}
function sumEnergy(rs){return rs.reduce((s,r)=>s+energy(r),0)}
function group(rs,keyFn,valFn=energy){const m=new Map();rs.forEach(r=>{const k=keyFn(r);m.set(k,(m.get(k)||0)+valFn(r))});return m}
function groupAvg(rs,keyFn,valFn=val){const sum=new Map(),count=new Map();rs.forEach(r=>{const k=keyFn(r);sum.set(k,(sum.get(k)||0)+valFn(r));count.set(k,(count.get(k)||0)+1)});return new Map([...sum].map(([k,v])=>[k,v/count.get(k)]))}
function rangeLabel(rs){if(!rs.length)return '—';const first=rs[0],last=rs[rs.length-1];if(first.monthKey===last.monthKey)return monthLabel(first.monthKey);return `${monthLabel(first.monthKey)} – ${monthLabel(last.monthKey)}`}
function previousComparable(rs){
  if(!rs.length)return [];
  const all=sortedRecords(), first=rs[0], last=rs[rs.length-1], months=[...new Set(rs.map(r=>r.monthKey))].length;
  if(state.period==='month'){const idx=first.year*12+first.month-1-1;const y=Math.floor(idx/12),m=idx%12+1,k=`${y}-${String(m).padStart(2,'0')}`;return all.filter(r=>r.monthKey===k)}
  if(state.period==='year')return all.filter(r=>r.year===first.year-1);
  if(state.period==='3m'){const end=first.year*12+first.month-2,start=end-(months-1);return all.filter(r=>{const x=r.year*12+r.month-1;return x>=start&&x<=end})}
  return [];
}

// ---------- SVG charts ----------
function lineChart(el,data,{hero=false,suffix=''}={}){
  if(!data.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=hero?185:210,p={l:8,r:8,t:16,b:28}, vals=data.map(d=>d.value),max=Math.max(...vals,0.001),min=0;
  const x=i=>p.l+(i/(Math.max(1,data.length-1)))*(w-p.l-p.r), y=v=>p.t+(1-(v-min)/(max-min||1))*(h-p.t-p.b);
  const pts=data.map((d,i)=>`${x(i)},${y(d.value)}`).join(' '); const area=`${p.l},${h-p.b} ${pts} ${w-p.r},${h-p.b}`;
  const labels=data.length<=8?data:data.filter((_,i)=>i===0||i===data.length-1||i%Math.ceil(data.length/5)===0);
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="graf">
    <defs><linearGradient id="g${hero?'h':'l'}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hero?'#67a9ff':'var(--accent)'}" stop-opacity=".32"/><stop offset="1" stop-color="${hero?'#67a9ff':'var(--accent)'}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#g${hero?'h':'l'})"/>
    <polyline points="${pts}" fill="none" stroke="${hero?'#8fc1ff':'var(--accent)'}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>
    ${labels.map(d=>{const i=data.indexOf(d);return `<text x="${x(i)}" y="${h-7}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" font-size="10" fill="${hero?'#afbdd0':'var(--muted)'}">${escapeHtml(d.label)}</text>`}).join('')}
  </svg>`;
}
function barChart(el,data){
  if(!data.length){el.innerHTML='<div class="chart-empty">Zatím nejsou data</div>';return}
  const w=700,h=210,p={l:10,r:10,t:15,b:38},max=Math.max(...data.map(d=>d.value),.001),slot=(w-p.l-p.r)/data.length,bw=Math.max(5,slot*.56);
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${data.map((d,i)=>{const bh=(d.value/max)*(h-p.t-p.b),x=p.l+i*slot+(slot-bw)/2,y=h-p.b-bh;return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(1,bh)}" rx="5" fill="var(--accent)" opacity="${.55+.4*(d.value/max)}"><title>${escapeHtml(d.label)}: ${fmt3.format(d.value)} kWh</title></rect><text x="${x+bw/2}" y="${h-13}" text-anchor="middle" font-size="9" fill="var(--muted)">${escapeHtml(d.short||d.label)}</text>`}).join('')}</svg>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

// ---------- Rendering ----------
async function reload(){state.records=await getAll('intervals');renderAll()}
function renderAll(){
  const has=state.records.length>0; $('#emptyState').classList.toggle('hidden',has);$('#overviewContent').classList.toggle('hidden',!has);
  renderOverview();renderAnalysis();renderMonths();renderExportDefaults();
}
function renderOverview(){
  const rs=currentRange(); if(!rs.length)return;
  $('#heroPeriod').textContent=rangeLabel(rs); const total=sumEnergy(rs);$('#heroKwh').textContent=fmt.format(total);
  const prev=previousComparable(rs),delta=prev.length?((total-sumEnergy(prev))/sumEnergy(prev))*100:null;$('#heroDelta').textContent=Number.isFinite(delta)?`${delta>=0?'▲':'▼'} ${fmt.format(Math.abs(delta))} % proti předchozímu období`:'První dostupné období';
  const daily=group(rs,r=>r.dateKey),dailyData=[...daily].sort().map(([k,v])=>({label:k.slice(8,10)+'.'+k.slice(5,7)+'.',value:v}));lineChart($('#mainChart'),dailyData,{hero:true});
  $('#avgDay').textContent=fmt3.format(total/Math.max(1,daily.size));const peak=rs.reduce((a,b)=>val(b)>val(a)?b:a,rs[0]);$('#maxPower').textContent=fmt.format(val(peak));$('#maxPowerSub').textContent=`kW · ${peak.displayTimestamp}`;
  const best=[...daily].sort((a,b)=>b[1]-a[1])[0];$('#bestDay').textContent=best?`${best[0].slice(8,10)}.${best[0].slice(5,7)}.`:'—';$('#bestDaySub').textContent=best?`${fmt3.format(best[1])} kWh`:'—';
  const night=rs.filter(r=>r.hour<5);$('#baseLoad').textContent=night.length?`${fmt.format(night.reduce((s,r)=>s+val(r),0)/night.length*1000)} W`:'—';
  const monthly=group(state.records,r=>r.monthKey),md=[...monthly].sort().map(([k,v])=>({label:monthLabel(k),short:k.slice(5,7)+'/'+k.slice(2,4),value:v}));barChart($('#monthlyChart'),md);
  $$('.metric-btn').forEach(b=>b.classList.toggle('active',b.dataset.metric===state.metric));
}
function renderAnalysis(){
  if(!state.records.length){['weekdayChart','hourlyChart','heatmap','daypartList','peaksList'].forEach(id=>$('#'+id).innerHTML='<div class="chart-empty">Nejdřív importuj data</div>');return}
  const rs=currentRange().length?currentRange():state.records;
  const dateTotals=group(rs,r=>r.dateKey); const dateWeek={};rs.forEach(r=>dateWeek[r.dateKey]=r.weekday);
  const sums=Array(7).fill(0),counts=Array(7).fill(0);for(const [date,v] of dateTotals){const wd=dateWeek[date];sums[wd]+=v;counts[wd]++}
  barChart($('#weekdayChart'),WEEK_MON.map((d,i)=>({label:d,short:d,value:counts[i]?sums[i]/counts[i]:0})));
  const type=$('#dayTypeSelect').value;const filtered=rs.filter(r=>type==='all'||(type==='workday'&&r.weekday<5)||(type==='weekend'&&r.weekday>=5));const havg=groupAvg(filtered,r=>r.hour,val);lineChart($('#hourlyChart'),Array.from({length:24},(_,h)=>({label:String(h).padStart(2,'0'),value:havg.get(h)||0})));
  renderHeatmap(rs);renderDayparts(rs);renderPeaks(rs);
}
function renderHeatmap(rs){
  const avg=groupAvg(rs,r=>`${r.weekday}|${r.hour}`,val),max=Math.max(...avg.values(),.001);let html='<div class="heat-grid"><div></div>'+Array.from({length:24},(_,h)=>`<div class="heat-label">${h}</div>`).join('');
  for(let wd=0;wd<7;wd++){html+=`<div class="heat-label">${WEEK_MON[wd]}</div>`;for(let h=0;h<24;h++){const v=avg.get(`${wd}|${h}`)||0,a=.08+.82*(v/max);html+=`<div class="heat-cell" style="background:color-mix(in srgb,var(--accent) ${Math.round(a*100)}%,var(--surface))" title="${WEEK_MON[wd]} ${h}:00 · ${fmt3.format(v)} kW"></div>`}}html+='</div>';$('#heatmap').innerHTML=html;
}
function renderDayparts(rs){const parts=[['Noc','0–6',r=>r.hour<6],['Ráno','6–10',r=>r.hour>=6&&r.hour<10],['Den','10–17',r=>r.hour>=10&&r.hour<17],['Večer','17–22',r=>r.hour>=17&&r.hour<22],['Pozdní','22–24',r=>r.hour>=22]];const total=sumEnergy(rs)||1;$('#daypartList').innerHTML=parts.map(([n,t,f])=>{const v=sumEnergy(rs.filter(f)),pct=v/total*100;return `<div class="daypart-row"><div><strong>${n}</strong><div class="kpi-unit">${t}</div></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="daypart-pct">${fmt.format(pct)} %</div></div>`}).join('')}
function renderPeaks(rs){const peaks=[...rs].sort((a,b)=>val(b)-val(a)).slice(0,20);$('#peaksList').innerHTML=peaks.map((r,i)=>`<div class="peak-row"><div class="peak-main"><strong>${i+1}. ${r.displayTimestamp}</strong><div>${r.monthKey} · 15min interval</div></div><div class="peak-value">${fmt.format(val(r))} kW</div></div>`).join('')}
async function renderMonths(){const months=(await getAll('months')).sort((a,b)=>b.monthKey.localeCompare(a.monthKey));$('#monthsList').innerHTML=months.length?months.map(m=>`<div class="month-row"><div class="month-main"><strong>${escapeHtml(m.label)}</strong><div>${m.count.toLocaleString('cs-CZ')} intervalů · ${escapeHtml(m.fileName||'')}</div></div><div class="month-actions"><div class="month-value">${m.incompleteDays?`⚠ ${m.incompleteDays} dnů`:'✓ kompletní'}</div><button class="trash-btn" data-delete="${m.monthKey}" aria-label="Smazat">×</button></div></div>`).join(''):'<div class="chart-empty">Žádné importované měsíce</div>';$$('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm(`Opravdu odstranit ${monthLabel(b.dataset.delete)}?`))deleteMonth(b.dataset.delete)})}
function renderExportDefaults(){if(!state.records.length)return;const all=sortedRecords(),min=all[0].dateKey,max=all[all.length-1].dateKey;if(!$('#exportFrom').value)$('#exportFrom').value=min;if(!$('#exportTo').value)$('#exportTo').value=max}

// ---------- Import ----------
async function handleFile(file){
  try{showToast('Načítám XLSX…');const payload=await parseReport(file);const months=await getAll('months');if(months.some(m=>m.monthKey===payload.month.monthKey)){state.pendingImport=payload;$('#replaceText').textContent=`${payload.month.label} už obsahuje uložená data. Nahradit je novým reportem?`;$('#replaceModal').classList.remove('hidden')}else await saveImport(payload,false)}catch(e){console.error(e);alert(`Import se nepodařil:\n${e.message}`)}finally{$('#fileInput').value=''}
}

// ---------- Export ----------
function selectedExportRecords(){const from=$('#exportFrom').value,to=$('#exportTo').value;if(!from||!to)return [];return sortedRecords().filter(r=>r.dateKey>=from&&r.dateKey<=to)}
function aggregateExport(rs,g){
  if(g==='15m')return rs.map(r=>({period:r.sourceTimestamp,powerKw:val(r),energyKwh:energy(r)}));
  const keyFn=g==='hour'?r=>`${r.dateKey} ${String(r.hour).padStart(2,'0')}:00`:g==='day'?r=>r.dateKey:r=>r.monthKey;const map=new Map();rs.forEach(r=>{const k=keyFn(r),o=map.get(k)||{period:k,powerSum:0,count:0,energyKwh:0};o.powerSum+=val(r);o.count++;o.energyKwh+=energy(r);map.set(k,o)});return [...map.values()].map(o=>({period:o.period,powerKw:o.powerSum/o.count,energyKwh:o.energyKwh}))
}
function csvEscape(v){const s=String(v??'');return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
function exportCSV(rs,g){const rows=aggregateExport(rs,g),text='Období;Průměrný výkon (kW);Energie (kWh)\n'+rows.map(r=>[r.period,r.powerKw.toFixed(4),r.energyKwh.toFixed(4)].map(csvEscape).join(';')).join('\n');downloadBlob(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'}),`energo_${$('#exportFrom').value}_${$('#exportTo').value}.csv`)}
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
  const total=sumEnergy(rs),peak=rs.length?rs.reduce((a,b)=>val(b)>val(a)?b:a):null;
  const sheets=[
    {name:'Souhrn',rows:[['Energo Přehled'],['Od',$('#exportFrom').value],['Do',$('#exportTo').value],['Metrika',state.metric.toUpperCase()],['Celková energie (kWh)',total],['Průměr / den (kWh)',total/Math.max(1,dateTotals.size)],['Maximum výkonu (kW)',peak?val(peak):0],['Čas maxima',peak?peak.sourceTimestamp:'']]},
    {name:'Data',rows:[['Období','Průměrný výkon (kW)','Energie (kWh)'],...agg.map(r=>[r.period,r.powerKw,r.energyKwh])]},
    {name:'Denní souhrny',rows:[['Datum','Průměrný výkon (kW)','Energie (kWh)'],...daily.map(r=>[r.period,r.powerKw,r.energyKwh])]},
    {name:'Hodinový profil',rows:[['Hodina','Průměrný výkon (kW)'],...Array.from({length:24},(_,i)=>[`${String(i).padStart(2,'0')}:00`,h.get(i)||0])]},
    {name:'Dny v týdnu',rows:[['Den','Průměrná spotřeba dne (kWh)'],...WEEK_MON.map((d,i)=>[d,cnt[i]?sums[i]/cnt[i]:0])]}
  ];
  const files=[];files.push({name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`});
  files.push({name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`});
  files.push({name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`});
  files.push({name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`});
  sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s.rows)}));const zip=zipStored(files);downloadBlob(new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`energo_${$('#exportFrom').value}_${$('#exportTo').value}.xlsx`)
}

// ---------- UI events ----------
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
function nav(target){$$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===target));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.target===target));$('#screenTitle').textContent={overview:'Přehled',analysis:'Analýza',data:'Data',export:'Export'}[target];window.scrollTo({top:0,behavior:'smooth'});if(target==='analysis')renderAnalysis();if(target==='data')renderMonths()}
function bind(){
  const choose=()=>$('#fileInput').click();$('#importBtn').onclick=choose;$('#emptyImportBtn').onclick=choose;$('#dataImportBtn').onclick=choose;$('#fileInput').onchange=e=>e.target.files[0]&&handleFile(e.target.files[0]);
  $$('.nav-btn').forEach(b=>b.onclick=()=>nav(b.dataset.target));$$('.period-chip').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;$$('.period-chip').forEach(x=>x.classList.toggle('active',x===b));renderOverview();renderAnalysis()});
  $$('.metric-btn').forEach(b=>b.onclick=()=>{state.metric=b.dataset.metric;localStorage.setItem('metric',state.metric);renderAll()});$('#dayTypeSelect').onchange=renderAnalysis;
  $('#cancelReplace').onclick=()=>{$('#replaceModal').classList.add('hidden');state.pendingImport=null};$('#confirmReplace').onclick=async()=>{const p=state.pendingImport;$('#replaceModal').classList.add('hidden');if(p)await saveImport(p,true)};
  $('#exportBtn').onclick=()=>{const rs=selectedExportRecords();if(!rs.length){alert('Ve zvoleném období nejsou data.');return}const g=$('#exportGranularity').value;if($('#exportFormat').value==='csv')exportCSV(rs,g);else exportXLSX(rs,g);showToast('Export byl vytvořen')};
}

(async function init(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  try{db=await openDB();bind();await reload()}catch(e){console.error(e);alert('Aplikaci se nepodařilo inicializovat: '+e.message)}
})();
