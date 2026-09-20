const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../core/model.js');
const Invoice=require('../core/invoice.js');
const Time=require('../core/time.js');
const Forecast=require('../core/forecast.js');
const Regime=require('../core/regime.js');
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
  monthDateKeys,weightedCostModel,normalizeFinance,prepareEnergyChartSeries,prepareCostChartSeries,estimateRateForMonth,monthDataHealth,comparisonMonthEnergySeries,comparisonMonthCostSeries,analysisAverageStats,analysisContext,completeDailyRegimeRows,regimeAnalysisForRange,buildEgdMonthPayload,forecastCostSeries
};`;
  const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const document={querySelector:()=>null,querySelectorAll:()=>[]};
  const window={EnergoCore:Core,EnergoInvoice:Invoice,EnergoTime:Time,EnergoForecast:Forecast,EnergoRegime:Regime,EnergoInvoiceParser:InvoiceParser,scrollTo:()=>{}};
  return new Function('window','document','location','localStorage',source)(window,document,{pathname:'/beta/'},localStorage);
}

test('beta 1.8.1 files are version-aligned and syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(app));
  assert.match(app,/APP_VERSION = '1\.8\.1'/);
  assert.match(html,/BETA 1\.8\.1/);
  assert.match(sw,/v1\.8\.1/);
  assert.match(html,/core\/model\.js\?v=1\.8\.1/);
  assert.match(html,/core\/time\.js\?v=1\.8\.1/);
  assert.match(html,/core\/forecast\.js\?v=1\.8\.1/);
  assert.match(html,/core\/regime\.js\?v=1\.8\.1/);
  assert.match(html,/core\/invoice\.js\?v=1\.8\.1/);
  assert.match(html,/core\/invoice-parser\.js\?v=1\.8\.1/);
  assert.match(sw,/core\/model\.js\?v=1\.8\.1/);
  assert.match(sw,/core\/time\.js\?v=1\.8\.1/);
  assert.match(sw,/core\/forecast\.js\?v=1\.8\.1/);
  assert.match(sw,/core\/regime\.js\?v=1\.8\.1/);
  assert.match(sw,/core\/invoice-parser\.js\?v=1\.8\.1/);
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


test('cost overview spans actual blue period, orange forecast and supports previous-month comparison',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  function addMonth(key,complete,source,days,dayKwh,finance){
    const [y,m]=key.split('-').map(Number);
    api.state.months.push({monthKey:key,enabled:true,complete,source,lastAvailableAt:source==='egd-api'?'2026-09-18T21:45:00Z':null,finance});
    for(let d=1;d<=days;d++)for(let hh=0;hh<24;hh++)for(let mi=0;mi<60;mi+=15){
      const dateKey=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
      api.state.records.push({id:`${key}-${d}-${hh}-${mi}`,ean:'859000000000000001',monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,hh,mi),year:y,month:m,day:d,hour:hh,minute:mi,weekday:wd,intervalMinutes:15,dcc1:dayKwh/6,source,apiStatus:source==='egd-api'?'W':undefined});
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
  api.state.compareMode='previous';api.state.chartMode='daily';
  const daily=api.prepareCostChartSeries('2026-09');
  assert.equal(daily.data.length,30);
  assert.equal(daily.data[17].kind,'actual');
  assert.equal(daily.data[18].kind,'forecast');
  assert.ok(daily.data[17].value>0);
  assert.ok(daily.data[18].value>0);
  assert.equal(daily.comparison.monthKey,'2026-08');
  assert.equal(daily.comparison.values.length,30);
  assert.ok(daily.comparison.values.every(Number.isFinite));

  api.state.chartMode='cumulative';
  const cumulative=api.prepareCostChartSeries('2026-09');
  assert.ok(Math.abs(cumulative.data.at(-1).value-cumulative.estimate.projectedCost)<1e-8);
  const dailyComparisonSum=daily.comparison.values.reduce((sum,v)=>sum+(Number(v)||0),0);
  assert.ok(Math.abs(cumulative.comparison.values.at(-1)-dailyComparisonSum)<1e-8);
  assert.ok(cumulative.comparison.values.at(-1)>0);
});

test('cost overview keeps monthly forecast controls visible',()=>{
  assert.match(app,/chartControls\.classList\.toggle\('hidden',state\.period!=='month'\)/);
  assert.match(app,/prepareCostChartSeries/);
  assert.match(app,/unit:'Kč'/);
});


test('Analysis 2.0 exposes selected period and source context',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  api.state.records.push(
    {id:'a',monthKey:'2026-08',dateKey:'2026-08-01',sortKey:1,year:2026,month:8,day:1,hour:0,minute:0,weekday:5,intervalMinutes:15,dcc1:1,source:'xlsx'},
    {id:'b',monthKey:'2026-09',dateKey:'2026-09-18',sortKey:2,year:2026,month:9,day:18,hour:0,minute:0,weekday:4,intervalMinutes:15,dcc1:1,source:'egd-api',apiStatus:'W'}
  );
  api.state.months.push({monthKey:'2026-08',enabled:true,complete:true,source:'xlsx'},{monthKey:'2026-09',enabled:true,complete:false,source:'egd-api'});
  api.state.analysisMode='raw';
  const c=api.analysisContext(api.state.records);
  assert.equal(c.from,'2026-08-01');
  assert.equal(c.to,'2026-09-18');
  assert.equal(c.days,2);
  assert.equal(c.intervals,2);
  assert.equal(c.months,2);
  assert.deepEqual(c.sources,['XLSX','EG.D']);
  assert.equal(c.provisional,1);
});

test('Analysis 2.0 robust averages limit outliers while raw mode keeps arithmetic mean',()=>{
  const api=loadApp(),values=[1,1.1,.9,1.05,.95,1.02,.98,8];
  api.state.analysisMode='raw';
  const raw=api.analysisAverageStats(values);
  api.state.analysisMode='robust';
  const robust=api.analysisAverageStats(values);
  assert.ok(raw.value>1.8);
  assert.ok(robust.value<1.2);
  assert.equal(robust.affected,1);
});

test('Analysis 2.0 controls and subtitles are present in UI',()=>{
  assert.match(html,/id="analysisContext"/);
  assert.match(html,/id="analysisPeriod"/);
  assert.match(html,/data-analysis-mode="robust"/);
  assert.match(html,/data-analysis-mode="raw"/);
  assert.match(html,/id="weekdaySubtitle"/);
  assert.match(html,/id="hourlySubtitle"/);
  assert.match(html,/id="heatmapSubtitle"/);
  assert.match(app,/ANALYSIS_MODE_KEY/);
  assert.match(app,/CORE\.robustMeanStats/);
});


test('Analysis 2.0 uses querySelectorAll helper for multi-element controls',()=>{
  assert.doesNotMatch(app,/(?<!\$)\$\([^;\n]*?\)\.forEach/);
  assert.match(app,/\$\$\('\[data-analysis-mode\]'\)\.forEach/);
  assert.match(app,/\$\$\('\[data-analysis-badge\]'\)\.forEach/);
});


test('Settings tab owns connection, backup, update and privacy controls',()=>{
  const dataStart=html.indexOf('<section class="screen" data-screen="data">');
  const settingsStart=html.indexOf('<section class="screen" data-screen="settings">');
  const exportStart=html.indexOf('<section class="screen" data-screen="export">');
  assert.ok(dataStart>=0&&settingsStart>dataStart&&exportStart>settingsStart);
  const dataHtml=html.slice(dataStart,settingsStart),settingsHtml=html.slice(settingsStart,exportStart);
  assert.match(dataHtml,/id="dataSourceCard"/);
  assert.match(dataHtml,/id="monthsList"/);
  assert.doesNotMatch(dataHtml,/id="egdClientId"/);
  assert.doesNotMatch(dataHtml,/id="backupDataBtn"/);
  assert.doesNotMatch(dataHtml,/id="forceUpdateBtn"/);
  assert.match(settingsHtml,/id="egdClientId"/);
  assert.match(settingsHtml,/id="backupDataBtn"/);
  assert.match(settingsHtml,/id="forceUpdateBtn"/);
  assert.match(settingsHtml,/Soukromí/);
  assert.match(html,/data-target="settings"/);
  assert.match(app,/settings:'Nastavení'/);
});

test('Data tab keeps one-tap EG.D sync and settings shortcut',()=>{
  assert.match(html,/id="dataSyncNowBtn"/);
  assert.match(html,/id="dataSettingsBtn"/);
  assert.match(app,/renderDataSourceCard/);
  assert.match(app,/\$\('#dataSyncNowBtn'\)\.onclick/);
  assert.match(app,/\$\('#dataSettingsBtn'\)\.onclick=.*nav\('settings'\)/);
});


test('Regime analysis card and core module are wired into Analysis',()=>{
  assert.match(html,/id="regimeCard"/);
  assert.match(html,/id="regimeSummary"/);
  assert.match(html,/id="regimeForecastImpact"/);
  assert.match(app,/REGIME\.detectRegimeShift/);
  assert.match(app,/REGIME\.adaptEnsembleWeights/);
  assert.match(app,/renderRegimeShift\(rs\)/);
});

test('persistent recent shift changes Forecast 2.0 weighting',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  function addDay(key,energy,source='xlsx'){
    const [y,m,d]=key.split('-').map(Number),wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
    api.state.months.push({monthKey:key.slice(0,7),enabled:true,complete:key.slice(0,7)!=='2026-09',source});
    for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      api.state.records.push({id:key+'-'+h+'-'+mi,monthKey:key.slice(0,7),dateKey:key,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:energy/6,source,apiStatus:source==='egd-api'?'W':undefined});
    }
  }
  const start=new Date(Date.UTC(2026,5,1));
  for(let i=0;i<70;i++){
    const d=new Date(start.getTime()+i*86400000),key=d.toISOString().slice(0,10);
    addDay(key,i>=63?1.55:1.0,key>='2026-09-01'?'egd-api':'xlsx');
  }
  api.state.months=[...new Map(api.state.months.map(m=>[m.monthKey,m])).values()];
  const rs=api.state.records.filter(r=>r.dateKey>='2026-07-01');
  const regime=api.regimeAnalysisForRange(rs);
  assert.equal(regime.status,'changed');
  assert.equal(regime.direction,'higher');
  assert.ok(regime.strength>0);
});


test('audit 1.8.1 keeps closed-day gap prediction on the affected day',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  function addMonth(key,complete,source,days,dayKwh,invoice){
    const [y,m]=key.split('-').map(Number);
    api.state.months.push({monthKey:key,enabled:true,complete,source,lastAvailableAt:source==='egd-api'?'2026-09-18T21:45:00Z':null,finance:{invoiceTotal:invoice}});
    for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){
      const dateKey=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;
      api.state.records.push({id:`${key}-${d}-${h}-${mi}`,ean:'859000000000000001',monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:dayKwh/6,source,apiStatus:source==='egd-api'?'W':undefined});
    }
  }
  addMonth('2026-03',true,'xlsx',31,.5,330);addMonth('2026-04',true,'xlsx',30,.6,335);addMonth('2026-05',true,'xlsx',31,.7,340);
  addMonth('2026-06',true,'xlsx',30,.8,350);addMonth('2026-07',true,'xlsx',31,.9,365);addMonth('2026-08',true,'xlsx',31,1.0,380);
  addMonth('2026-09',false,'egd-api',18,1.1,null);
  api.state.records=api.state.records.filter(r=>r.id!=='2026-09-10-12-0');
  api.state.compareMode='none';api.state.chartMode='daily';
  const energy=api.prepareEnergyChartSeries('2026-09'),gap=energy.data.find(d=>d.date==='2026-09-10');
  assert.equal(gap.kind,'mixed');assert.ok(gap.forecastValue>0);assert.ok(gap.actualValue<gap.value);
  assert.ok(Math.abs(energy.data.reduce((s,d)=>s+(Number(d.value)||0),0)-energy.estimate.predictedEnergy)<1e-8);
  const cost=api.prepareCostChartSeries('2026-09'),costGap=cost.data.find(d=>d.date==='2026-09-10');
  assert.equal(costGap.kind,'mixed');assert.ok(costGap.forecastValue>0);assert.ok(costGap.actualValue<costGap.value);
  assert.ok(Math.abs(cost.data.reduce((s,d)=>s+(Number(d.value)||0),0)-cost.estimate.projectedCost)<1e-6);
});

test('audit 1.8.1 ignores unusable EG.D tail for availability and cost forecast boundary',()=>{
  const api=loadApp();api.state.months=[];api.state.records=[];
  const key='2026-09',y=2026,m=9;
  for(const hist of ['2026-07','2026-08']){
    const [hy,hm]=hist.split('-').map(Number);api.state.months.push({monthKey:hist,enabled:true,complete:true,source:'xlsx',finance:{invoiceTotal:380}});
    for(let d=1;d<=31;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){const dateKey=`${hy}-${String(hm).padStart(2,'0')}-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(hy,hm-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;api.state.records.push({id:`${hist}-${d}-${h}-${mi}`,monthKey:hist,dateKey,sortKey:Date.UTC(hy,hm-1,d,h,mi),year:hy,month:hm,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:1/6,source:'xlsx'})}
  }
  api.state.months.push({monthKey:key,enabled:true,complete:false,source:'egd-api',finance:{invoiceTotal:null}});
  for(let d=1;d<=18;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=15){const dateKey=`2026-09-${String(d).padStart(2,'0')}`,wd0=new Date(Date.UTC(y,m-1,d)).getUTCDay(),wd=wd0===0?6:wd0-1;api.state.records.push({id:`live-${d}-${h}-${mi}`,monthKey:key,dateKey,sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,intervalMinutes:15,dcc1:1.2/6,source:'egd-api',apiStatus:'W'})}
  const invalidMs=Date.UTC(2026,8,19,8,0),invalid={id:'invalid-tail',monthKey:key,dateKey:'2026-09-19',sourceTimestamp:'19.09.2026 10:00:00',sortKey:invalidMs,year:2026,month:9,day:19,hour:10,minute:0,weekday:5,intervalMinutes:15,dcc1:99,source:'egd-api',apiStatus:'IU014',apiUnits:'kWh'};
  api.state.records.push(invalid);
  const live=api.state.records.filter(r=>r.monthKey===key),payload=api.buildEgdMonthPayload(key,live);
  const lastUsable=Math.max(...live.filter(r=>api.egdStatusInfo(r.apiStatus).usable).map(r=>r.sortKey));
  assert.equal(payload.month.lastAvailableAt,new Date(lastUsable).toISOString());
  api.state.compareMode='none';api.state.chartMode='daily';
  const costForecast=api.forecastCostSeries(key);
  assert.equal(costForecast.lastObserved,'2026-09-18');
});
