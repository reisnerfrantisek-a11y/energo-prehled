const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../core/model.js');
const Invoice=require('../core/invoice.js');
const Time=require('../core/time.js');
const Forecast=require('../core/forecast.js');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');

function loadApp(){
  const cut=app.indexOf('\n(async function init(){');
  assert.ok(cut>0,'init boundary must exist');
  const source=app.slice(0,cut)+`
return {
  state,egdStatusInfo,apiValueToKw,expectedIntervalsForDate,totalExpectedIntervals,
  monthDateKeys,weightedCostModel,normalizeFinance
};`;
  const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const document={querySelector:()=>null,querySelectorAll:()=>[]};
  const window={EnergoCore:Core,EnergoInvoice:Invoice,EnergoTime:Time,EnergoForecast:Forecast,scrollTo:()=>{}};
  return new Function('window','document','location','localStorage',source)(window,document,{pathname:'/beta/'},localStorage);
}

test('beta 1.6 files are version-aligned and syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(app));
  assert.match(app,/APP_VERSION = '1\.6\.0'/);
  assert.match(html,/BETA 1\.6\.0/);
  assert.match(sw,/v1\.6\.0/);
  assert.match(html,/core\/model\.js\?v=1\.6\.0/);
  assert.match(html,/core\/time\.js\?v=1\.6\.0/);
  assert.match(html,/core\/forecast\.js\?v=1\.6\.0/);
  assert.match(html,/core\/invoice\.js\?v=1\.6\.0/);
  assert.match(sw,/core\/model\.js\?v=1\.6\.0/);
  assert.match(sw,/core\/time\.js\?v=1\.6\.0/);
  assert.match(sw,/core\/forecast\.js\?v=1\.6\.0/);
});

test('HTML ids referenced by literal selectors exist and are unique',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  const idSet=new Set(ids);
  const refs=[...app.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)].map(m=>m[1]);
  const missing=[...new Set(refs.filter(id=>!idSet.has(id)))];
  assert.deepEqual(missing,[]);
});

test('DST interval counts stay 92/96/100',()=>{
  const api=loadApp();
  assert.equal(api.expectedIntervalsForDate('2026-03-29'),92);
  assert.equal(api.expectedIntervalsForDate('2026-03-28'),96);
  assert.equal(api.expectedIntervalsForDate('2026-10-25'),100);
  assert.equal(api.totalExpectedIntervals('2026-03'),2972);
  assert.equal(api.totalExpectedIntervals('2026-10'),2980);
});

test('EG.D quality and ICQ2 conversion regression',()=>{
  const api=loadApp();
  assert.equal(api.egdStatusInfo('B').usable,true);
  assert.equal(api.egdStatusInfo('W').usable,true);
  assert.equal(api.egdStatusInfo('IU014').usable,false);
  assert.equal(api.apiValueToKw(0.25,'kWh',15),1);
});

test('old finance records remain backward compatible',()=>{
  const api=loadApp();
  const f=api.normalizeFinance({invoiceTotal:123.45,components:{energy:20,distribution:30,fixed:40,other:33.45}});
  assert.equal(f.invoiceTotal,123.45);
  assert.equal(f.components.fixed,40);
  assert.ok(f.invoiceMeta);
});
