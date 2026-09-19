const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../core/model.js');
const Invoice=require('../core/invoice.js');
const Time=require('../core/time.js');
const Forecast=require('../core/forecast.js');
const InvoiceParser=require('../core/invoice-parser.js');

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
  monthDateKeys,weightedCostModel,normalizeFinance,prepareEnergyChartSeries,estimateRateForMonth,monthDataHealth,comparisonMonthEnergySeries
};`;
  const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const document={querySelector:()=>null,querySelectorAll:()=>[]};
  const window={EnergoCore:Core,EnergoInvoice:Invoice,EnergoTime:Time,EnergoForecast:Forecast,EnergoInvoiceParser:InvoiceParser,scrollTo:()=>{}};
  return new Function('window','document','location','localStorage',source)(window,document,{pathname:'/beta/'},localStorage);
}

test('beta 1.7.0 files are version-aligned and syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(app));
  assert.match(app,/APP_VERSION = '1\.7\.0'/);
  assert.match(html,/BETA 1\.7\.0/);
  assert.match(sw,/v1\.7\.0/);
  assert.match(html,/core\/model\.js\?v=1\.7\.0/);
  assert.match(html,/core\/time\.js\?v=1\.7\.0/);
  assert.match(html,/core\/forecast\.js\?v=1\.7\.0/);
  assert.match(html,/core\/invoice\.js\?v=1\.7\.0/);
  assert.match(html,/core\/invoice-parser\.js\?v=1\.7\.0/);
  assert.match(sw,/core\/model\.js\?v=1\.7\.0/);
  assert.match(sw,/core\/time\.js\?v=1\.7\.0/);
  assert.match(sw,/core\/forecast\.js\?v=1\.7\.0/);
  assert.match(sw,/core\/invoice-parser\.js\?v=1\.7\.0/);
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


test('live-month chart spans actual, forecast band, cumulative mode and previous month',()=>{
  const api=loadApp();
  api.state.months=[];api.state.records=[];
  function addMonth(key,complete,source,days,dayKwh,invoice){
    const [y,m]=key.split('-').map(Number);
    api.state.months.push({monthKey:key,enabled:true,complete,source,lastAvailableAt:source==='egd-api'?'2026-09-18T21:45:00Z':null,finance:{invoiceTotal:invoice}});
    for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      const dateKey=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
      api.state.records.push({id:`${key}-${d}-${h}-${mi}`,monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:dayKwh/6,source,apiStatus:source==='egd-api'?'W':undefined});
    }
  }
  addMonth('2026-03',true,'xlsx',31,.5,330);
  addMonth('2026-04',true,'xlsx',30,.6,335);
  addMonth('2026-05',true,'xlsx',31,.7,340);
  addMonth('2026-06',true,'xlsx',30,.8,350);
  addMonth('2026-07',true,'xlsx',31,.9,365);
  addMonth('2026-08',true,'xlsx',31,1.0,380);
  addMonth('2026-09',false,'egd-api',18,1.1,null);

  api.state.compareMode='previous';api.state.chartMode='daily';
  const daily=api.prepareEnergyChartSeries('2026-09');
  assert.equal(daily.data.length,30);
  assert.equal(daily.data[17].kind,'actual');
  assert.equal(daily.data[18].kind,'forecast');
  assert.equal(daily.data[18].date,'2026-09-19');
  assert.equal(daily.comparison.values.length,30);
  const total=daily.data.reduce((sum,d)=>sum+(Number(d.value)||0),0);
  assert.ok(Math.abs(total-daily.estimate.predictedEnergy)<1e-8);
  assert.ok(daily.data.slice(18).every(d=>Number.isFinite(d.low)&&Number.isFinite(d.high)&&d.low<=d.value&&d.value<=d.high));

  api.state.chartMode='cumulative';
  const cumulative=api.prepareEnergyChartSeries('2026-09');
  assert.ok(Math.abs(cumulative.data.at(-1).value-cumulative.estimate.predictedEnergy)<1e-8);
  assert.ok(cumulative.comparison.values[17]>cumulative.comparison.values[0]);
});


test('verified PDF tariff takes priority over regression for live-month cost forecast',()=>{
  const api=loadApp();
  api.state.months=[];api.state.records=[];
  function addMonth(key,complete,source,days,dayKwh,finance){
    const [y,m]=key.split('-').map(Number);
    api.state.months.push({monthKey:key,enabled:true,complete,source,lastAvailableAt:source==='egd-api'?'2026-09-18T21:45:00Z':null,finance});
    for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      const dateKey=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
      api.state.records.push({id:`${key}-${d}-${h}-${mi}`,ean:'859000000000000001',monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:dayKwh/6,source,apiStatus:source==='egd-api'?'W':undefined});
    }
  }
  addMonth('2026-07',true,'xlsx',31,1,{invoiceTotal:380});
  addMonth('2026-08',true,'xlsx',31,1.2,{
    invoiceTotal:406.55,source:'pdf',
    metering:{ean:'859000000000000001',consumptionKwh:12},
    tariff:{validated:true,fixedGrossPerMonth:328.9627,variableGrossPerKwh:6.465853,sourceMonthKey:'2026-08'},
    invoiceMeta:{extractionConfidence:1}
  });
  addMonth('2026-09',false,'egd-api',18,1.4,{invoiceTotal:null});
  const e=api.estimateRateForMonth('2026-09');
  assert.equal(e.modelType,'tariff');
  assert.equal(e.tariffSourceMonth,'2026-08');
  assert.ok(Math.abs(e.fixed-328.9627)<1e-9);
  assert.ok(Math.abs(e.variableRate-6.465853)<1e-9);
  assert.ok(Math.abs(e.projectedCost-(e.fixed+e.variableRate*e.predictedEnergy))<1e-8);
});


test('invoice parser diagnostics are collapsed behind technical details in UI',()=>{
  assert.match(app,/invoice-tech-details/);
  assert.match(app,/Technické detaily/);
  assert.match(app,/Faktura je připravena k uložení\./);
});


test('year-ago comparison aligns same calendar month when historical data exists',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  function addMonth(key,days,dayKwh){
    const [y,m]=key.split('-').map(Number);
    api.state.months.push({monthKey:key,enabled:true,complete:true,source:'xlsx'});
    for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      const dateKey=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
      api.state.records.push({id:`${key}-${d}-${h}-${mi}`,monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:dayKwh/6,source:'xlsx'});
    }
  }
  addMonth('2025-09',30,.7);
  addMonth('2026-09',30,1.1);
  const c=api.comparisonMonthEnergySeries('2026-09',30,'yearAgo');
  assert.equal(c.monthKey,'2025-09');
  assert.equal(c.values.length,30);
  assert.ok(c.values.every(Number.isFinite));
});

test('data health scores a complete past month at 100',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  const key='2026-08',y=2026,m=8;
  api.state.months.push({monthKey:key,enabled:true,complete:true,source:'xlsx'});
  for(let d=1;d<=31;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
    const dateKey=`${y}-08-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
    const stamp=`${String(d).padStart(2,'0')}.08.2026 ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00`,parsed=Time.parseCzTimestamp(stamp),sortKey=Time.pragueUtcCandidates(parsed)[0];
    api.state.records.push({id:`${key}-${d}-${h}-${mi}`,monthKey:key,dateKey,sourceTimestamp:stamp,sortKey,year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:.1,source:'xlsx'});
  }
  const health=api.monthDataHealth(key);
  assert.equal(health.score,100);
  assert.equal(health.missingClosed,0);
  assert.equal(health.usability,1);
});

test('Forecast 2.0 metadata is exposed for a live month',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  function addMonth(key,complete,source,days,dayKwh){
    const [y,m]=key.split('-').map(Number);
    api.state.months.push({monthKey:key,enabled:true,complete,source,lastAvailableAt:source==='egd-api'?'2026-09-18T21:45:00Z':null,finance:{invoiceTotal:complete?350:null}});
    for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      const dateKey=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
      api.state.records.push({id:`${key}-${d}-${h}-${mi}`,monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:dayKwh/6,source,apiStatus:source==='egd-api'?'W':undefined});
    }
  }
  addMonth('2026-05',true,'xlsx',31,.6);
  addMonth('2026-06',true,'xlsx',30,.8);
  addMonth('2026-07',true,'xlsx',31,.7);
  addMonth('2026-08',true,'xlsx',31,1.0);
  addMonth('2026-09',false,'egd-api',18,1.2);
  const e=api.estimateRateForMonth('2026-09');
  assert.equal(e.forecastModel,'ensemble-v2');
  assert.ok(e.forecastWeights.weekday>0);
  assert.ok(e.forecastWeights.recent7>0);
  assert.ok(Number.isFinite(e.recent7Projection));
  assert.ok(e.lowEnergy<=e.predictedEnergy&&e.predictedEnergy<=e.highEnergy);
});
