const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../core/model.js');
const Invoice=require('../core/invoice.js');
const Time=require('../core/time.js');
const Forecast=require('../core/forecast.js');
const Regime=require('../core/regime.js');
const Power=require('../core/power.js');
const Report=require('../core/report.js');
const FinanceAnalytics=require('../core/finance-analytics.js');
const InvoiceParser=require('../core/invoice-parser.js');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const TARGET='2026-09';
const EAN='859000000000000001';
const HORIZONS=[5,10,15,20,25];

function loadApp(){
  const cut=app.indexOf('\n(async function init(){');
  assert.ok(cut>0);
  const source=app.slice(0,cut)+`
return {state,predictMonthEnergy,estimateRateForMonth,regimeAnalysisForRange};
`;
  const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const document={querySelector:()=>null,querySelectorAll:()=>[]};
  const window={EnergoCore:Core,EnergoInvoice:Invoice,EnergoTime:Time,EnergoForecast:Forecast,EnergoRegime:Regime,EnergoPower:Power,EnergoReport:Report,EnergoFinanceAnalytics:FinanceAnalytics,EnergoInvoiceParser:InvoiceParser,scrollTo:()=>{}};
  return new Function('window','document','location','localStorage',source)(window,document,{pathname:'/beta/'},localStorage);
}
function daysInMonth(key){
  const [y,m]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m,0)).getUTCDate();
}
function weekday(key){
  const d=new Date(key+'T00:00:00Z').getUTCDay();
  return d===0?6:d-1;
}
function dateKey(month,day){return month+'-'+String(day).padStart(2,'0')}
function monthBefore(target,n){
  const [y,m]=target.split('-').map(Number),idx=y*12+(m-1)-n,yy=Math.floor(idx/12),mm=idx%12+1;
  return yy+'-'+String(mm).padStart(2,'0');
}
function deterministicNoise(day,monthOrdinal=0){return 1+0.028*Math.sin(day*1.71+monthOrdinal*.63)+0.012*Math.cos(day*.47+monthOrdinal)}
function weekdayFactor(wd){return wd===5?1.07:wd===6?1.11:1}
function baseDaily(month,day,monthOrdinal=0,multiplier=1){
  return Math.max(.05,multiplier*weekdayFactor(weekday(dateKey(month,day)))*deterministicNoise(day,monthOrdinal));
}
function makeRecords(month,dailyFn,{source='xlsx',throughDay=null,missingSlots=()=>new Set()}={}){
  const [y,m]=month.split('-').map(Number),out=[],days=daysInMonth(month),last=throughDay===null?days:Math.min(days,throughDay);
  for(let d=1;d<=last;d++){
    const key=dateKey(month,d),wd=weekday(key),daily=Math.max(0,dailyFn(d,wd)),omit=missingSlots(d)||new Set();
    for(let slot=0;slot<96;slot++){
      if(omit.has(slot))continue;
      const h=Math.floor(slot/4),mi=(slot%4)*15;
      out.push({
        id:`${month}-${d}-${slot}-${source}`,ean:EAN,monthKey:month,dateKey:key,
        sortKey:Date.UTC(y,m-1,d,h,mi),year:y,month:m,day:d,hour:h,minute:mi,weekday:wd,
        intervalMinutes:15,dcc1:daily/24,source,apiStatus:source==='egd-api'?'W':undefined
      });
    }
  }
  return out;
}
function financeFor(month,energy,{fixed=300,variable=6,confidence=1}={}){
  return {
    invoiceTotal:fixed+variable*energy,source:'pdf',
    metering:{ean:EAN,consumptionKwh:energy},
    tariff:{validated:true,fixedGrossPerMonth:fixed,variableGrossPerKwh:variable,sourceMonthKey:month},
    invoiceMeta:{supplier:'Synthetic',extractionConfidence:confidence}
  };
}
function historicalMultiplier(scenario,historyIndex){
  if(scenario==='seasonal-growth')return [.78,.83,.89,.95,1.01,1.08][historyIndex];
  return 1;
}
function targetDaily(scenario,day,wd){
  const base=baseDaily(TARGET,day,7,1);
  if(scenario==='seasonal-growth')return base*(1.10+(day-1)*(0.15/29));
  if(scenario==='step-plus-40')return base*1.40;
  if(scenario==='vacation')return base*(day>=10&&day<=16?.20:1);
  if(scenario==='isolated-spike')return base*(day===12?4:1);
  if(scenario==='short-spike')return base*(day>=10&&day<=12?2:1);
  return base;
}
function missingPattern(day){
  if(day===7||day===12||day===18||day===23)return new Set([12,13,14,15]);
  if(day===14)return new Set(Array.from({length:32},(_,i)=>32+i));
  return new Set();
}
function truthTotal(scenario){
  let total=0;
  for(let d=1;d<=daysInMonth(TARGET);d++)total+=targetDaily(scenario,d,weekday(dateKey(TARGET,d)));
  return total;
}
function setupScenario(scenario,asOf,{knownTariffChange=false,unknownTariffShock=false,noHistory=false,fullDayGap=false}={}){
  const api=loadApp(),history=[];
  if(!noHistory)for(let n=6;n>=1;n--)history.push(monthBefore(TARGET,n));
  api.state.records=[];api.state.months=[];
  history.forEach((month,i)=>{
    const mult=historicalMultiplier(scenario,i);
    const recs=makeRecords(month,d=>baseDaily(month,d,i,mult));
    const energy=recs.reduce((s,r)=>s+r.dcc1*(r.intervalMinutes/60),0);
    const tariff=knownTariffChange&&month===history.at(-1)?{fixed:360,variable:7.2}:{fixed:300,variable:6};
    api.state.records.push(...recs);
    api.state.months.push({monthKey:month,enabled:true,complete:true,source:'xlsx',finance:financeFor(month,energy,tariff)});
  });
  const targetRecs=makeRecords(TARGET,d=>targetDaily(scenario,d,weekday(dateKey(TARGET,d))),{
    source:'egd-api',throughDay:asOf,missingSlots:scenario==='missing-data'?(d=>fullDayGap&&d===14?new Set(Array.from({length:96},(_,i)=>i)):missingPattern(d)):()=>new Set()
  });
  api.state.records.push(...targetRecs);
  api.state.months.push({
    monthKey:TARGET,enabled:true,complete:false,source:'egd-api',
    lastAvailableAt:`2026-09-${String(asOf).padStart(2,'0')}T21:45:00Z`,finance:{invoiceTotal:null}
  });
  const actualEnergy=truthTotal(scenario==='missing-data'?'stable':scenario);
  const currentTariff=knownTariffChange?{fixed:360,variable:7.2}:unknownTariffShock?{fixed:420,variable:8.5}:{fixed:300,variable:6};
  const actualCost=currentTariff.fixed+currentTariff.variable*actualEnergy;
  return {api,targetRecs,actualEnergy,actualCost,currentTariff};
}
function pctError(pred,actual){return Number.isFinite(pred)&&Number.isFinite(actual)&&actual>0?(pred-actual)/actual*100:null}
function absPctError(pred,actual){const p=pctError(pred,actual);return p===null?null:Math.abs(p)}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function round(v,n=2){return Number.isFinite(v)?Number(v.toFixed(n)):v}

function runEnergyScenario(scenario,opts={}){
  const rows=[];
  for(const day of HORIZONS){
    const saved=Date.now;
    Date.now=()=>Date.parse(`2026-09-${String(day+1).padStart(2,'0')}T10:00:00Z`);
    try{
      const {api,targetRecs,actualEnergy,actualCost}=setupScenario(scenario,day,opts);
      const e=api.predictMonthEnergy(TARGET);
      const c=api.estimateRateForMonth(TARGET);
      const regime=api.regimeAnalysisForRange(targetRecs);
      rows.push({
        scenario,day,
        actualEnergy:round(actualEnergy,3),predictedEnergy:round(e.predictedEnergy,3),
        biasPct:round(pctError(e.predictedEnergy,actualEnergy)),ape:round(absPctError(e.predictedEnergy,actualEnergy)),
        low:round(e.lowEnergy,3),high:round(e.highEnergy,3),energyCovered:actualEnergy>=e.lowEnergy&&actualEnergy<=e.highEnergy,
        uncertaintyPct:round(e.uncertainty*100),regime:regime.status,adaptationPct:round((e.regimeAdaptation||0)*100),
        actualCost:round(actualCost),predictedCost:round(c.projectedCost),costApe:round(absPctError(c.projectedCost,actualCost)),
        costLow:round(c.lowProjectedCost),costHigh:round(c.highProjectedCost),costCovered:Number.isFinite(c.lowProjectedCost)&&Number.isFinite(c.highProjectedCost)?actualCost>=c.lowProjectedCost&&actualCost<=c.highProjectedCost:null
      });
    }finally{Date.now=saved}
  }
  return rows;
}

test('synthetic Forecast 2.0 stress benchmark',()=>{
  const scenarios=[
    ['stable',{}],
    ['seasonal-growth',{}],
    ['step-plus-40',{}],
    ['vacation',{}],
    ['missing-data',{}],
    ['missing-full-day',{fullDayGap:true}],
    ['isolated-spike',{}],
    ['short-spike',{}],
    ['first-month-no-history',{noHistory:true}],
    ['tariff-change-known',{knownTariffChange:true}],
    ['tariff-shock-unknown',{unknownTariffShock:true}]
  ];
  const all=[];
  for(const [scenario,opts] of scenarios){
    const energyScenario=scenario==='first-month-no-history'||scenario.startsWith('tariff-')?'stable':scenario==='missing-full-day'?'missing-data':scenario;
    const rows=runEnergyScenario(energyScenario,opts).map(r=>({...r,scenario}));
    all.push(...rows);
  }
  const summaries=scenarios.map(([scenario])=>{
    const rows=all.filter(r=>r.scenario===scenario);
    return {
      scenario,
      energyMape:round(mean(rows.map(r=>r.ape))),
      maxEnergyApe:round(Math.max(...rows.map(r=>r.ape))),
      energyBandCoverage:round(rows.filter(r=>r.energyCovered).length/rows.length*100),
      meanBias:round(mean(rows.map(r=>r.biasPct).filter(Number.isFinite))),
      costMape:round(mean(rows.map(r=>r.costApe).filter(Number.isFinite))),
      costBandCoverage:round(rows.filter(r=>r.costCovered!==null).length?rows.filter(r=>r.costCovered===true).length/rows.filter(r=>r.costCovered!==null).length*100:null),
      regimes:rows.map(r=>r.regime).join(' → ')
    };
  });
  console.log('SYNTHETIC_STRESS_ROWS '+JSON.stringify(all));
  console.log('SYNTHETIC_STRESS_SUMMARY '+JSON.stringify(summaries));

  for(const r of all){
    assert.ok(Number.isFinite(r.predictedEnergy)&&r.predictedEnergy>0);
    assert.ok(Number.isFinite(r.low)&&Number.isFinite(r.high)&&r.low<=r.predictedEnergy&&r.predictedEnergy<=r.high);
  }
  const by=Object.fromEntries(summaries.map(x=>[x.scenario,x]));
  assert.ok(by.stable.energyMape<8,'stable household should be forecast accurately');
  assert.ok(by['seasonal-growth'].energyMape<15,'gradual seasonal growth should remain bounded');
  assert.ok(by['step-plus-40'].energyMape<18,'persistent step change should adapt');
  assert.ok(by.vacation.energyMape<25,'temporary vacation should not catastrophically distort forecast');
  assert.ok(by['missing-data'].energyMape<12,'closed gaps should be substantially recovered');
  assert.ok(by['missing-full-day'].energyMape<15,'a whole missing day should be imputed from baseline');
  assert.ok(by['isolated-spike'].energyMape<12,'one isolated spike should not destabilize the month');
  assert.ok(by['short-spike'].energyMape<15,'a short spike should remain bounded');
  assert.ok(by['first-month-no-history'].energyMape<12,'first month pace forecast should remain usable');
  assert.ok(by['tariff-change-known'].costMape<12,'latest validated tariff should follow a known tariff change');
  assert.ok(by['tariff-shock-unknown'].costMape>10,'unknown current tariff shock must remain visible as an information limitation');
});
