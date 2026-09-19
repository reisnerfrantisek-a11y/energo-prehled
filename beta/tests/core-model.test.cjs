const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../core/model.js');
const Invoice=require('../core/invoice.js');
const Forecast=require('../core/forecast.js');

test('ICQ2 energy conversion is reversible',()=>{
  assert.equal(Core.apiValueToKw(0.25,'kWh',15),1);
  assert.equal(Core.apiValueFromKw(1,'kWh',15),0.25);
});

test('month calendar helpers are deterministic',()=>{
  assert.equal(Core.monthDateKeys('2026-09').length,30);
  assert.equal(Core.monthDateKeys('2028-02').length,29);
  assert.equal(Core.weekdayFromDateKey('2026-09-19'),5);
});

test('forecast distribution preserves totals',()=>{
  const values=Core.distributeTotal(12.5,[1,2,3,4]);
  assert.ok(Math.abs(Core.sumFinite(values)-12.5)<1e-12);
  assert.deepEqual(Core.cumulativeSeries([1,2,3]),[1,3,6]);
});

test('cost regression stays nonnegative',()=>{
  const model=Core.weightedCostModel([
    {energy:4.66,cost:361.29,weight:1},
    {energy:3.46,cost:348.35,weight:2},
    {energy:7.8475,cost:380.69,weight:3}
  ]);
  assert.ok(model.fixed>=0);
  assert.ok(model.variableRate>=0);
  assert.ok(Number.isFinite(Core.modeledRateAtEnergy(model,12.225)));
});

test('legacy finance normalizes into invoice-ready schema',()=>{
  const f=Invoice.normalizeFinance({invoiceTotal:406.55,components:{energy:100,distribution:200,fixed:50,other:56.55}});
  assert.equal(f.invoiceTotal,406.55);
  assert.equal(f.currency,'CZK');
  assert.equal(f.source,'manual');
  assert.equal(f.components.energy,100);
  assert.equal(f.components.distribution,200);
  assert.ok(Object.hasOwn(f.components,'poze'));
  assert.ok(Object.hasOwn(f,'invoiceMeta'));
});


test('forecast allocation and cumulative band preserve totals',()=>{
  const estimate={actualEnergy:10,predictedEnergy:16,lowEnergy:14,highEnergy:19};
  const allocated=Forecast.allocateRemaining(estimate,[1,2,1]);
  assert.ok(Math.abs(Core.sumFinite(allocated.central)-6)<1e-12);
  assert.ok(Math.abs(Core.sumFinite(allocated.low)-4)<1e-12);
  assert.ok(Math.abs(Core.sumFinite(allocated.high)-9)<1e-12);
  const rows=[
    {kind:'actual',value:5,low:5,high:5},
    {kind:'forecast',value:2,low:1,high:3},
    {kind:'forecast',value:4,low:3,high:6}
  ];
  const cum=Forecast.toCumulative(rows);
  assert.deepEqual(cum.map(x=>x.value),[5,7,11]);
  assert.deepEqual(cum.map(x=>x.low),[5,6,9]);
  assert.deepEqual(cum.map(x=>x.high),[5,8,14]);
});


test('Forecast 2.0 ensemble blends weekday, recent windows and pace with normalized weights',()=>{
  const r=Forecast.ensembleMonthForecast({
    weekdayProjection:48,
    recent7Projection:54,
    recent14Projection:51,
    paceProjection:60,
    observedDays:18,
    historyMonths:6,
    fallback:50
  });
  assert.equal(r.model,'ensemble-v2');
  const sum=Object.values(r.weights).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum-1)<1e-12);
  assert.ok(r.value>48&&r.value<60);
  assert.ok(r.weights.weekday>r.weights.pace);
});

test('calibrated forecast band uses backtest errors only after enough samples',()=>{
  const fallback=Forecast.calibrateUncertainty({fallback:.18,absolutePctErrors:[12]});
  assert.equal(fallback.source,'heuristic');
  assert.equal(fallback.uncertainty,.18);

  const calibrated=Forecast.calibrateUncertainty({fallback:.18,absolutePctErrors:[8,10,12,20,15,9]});
  assert.equal(calibrated.source,'backtest');
  assert.equal(calibrated.sampleCount,6);
  assert.ok(calibrated.uncertainty>=.10&&calibrated.uncertainty<=.25);
});


test('robust mean limits a single extreme outlier without deleting the sample',()=>{
  const values=[1,1.1,.9,1.05,.95,1.02,.98,8];
  const raw=Core.mean(values),r=Core.robustMeanStats(values);
  assert.ok(raw>1.8);
  assert.ok(r.value<1.2);
  assert.equal(r.count,values.length);
  assert.equal(r.affected,1);
  assert.equal(r.robust,true);
});

test('robust mean falls back to arithmetic mean for too-small samples',()=>{
  const values=[1,2,9],r=Core.robustMeanStats(values,{minCount:5});
  assert.equal(r.value,4);
  assert.equal(r.affected,0);
  assert.equal(r.robust,false);
});

test('robust mean handles zero-MAD repeated baselines',()=>{
  const r=Core.robustMeanStats([0,0,0,0,0,0,5]);
  assert.equal(r.value,0);
  assert.equal(r.affected,1);
});
