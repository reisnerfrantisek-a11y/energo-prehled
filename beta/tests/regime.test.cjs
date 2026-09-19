const test=require('node:test');
const assert=require('node:assert/strict');
const Regime=require('../core/regime.js');

function dateKeyFromOffset(offset){
  const d=new Date(Date.UTC(2026,5,1+offset));
  return d.toISOString().slice(0,10);
}
function weekday(key){
  const d=new Date(key+'T00:00:00Z').getUTCDay();
  return d===0?6:d-1;
}
function makeDay(i,energy,night=.18){
  const dateKey=dateKeyFromOffset(i);
  return {
    dateKey,weekday:weekday(dateKey),energy,
    parts:{night,morning:.16,day:.28,evening:Math.max(0,energy-night-.16-.28-.08),late:.08}
  };
}

test('persistent higher consumption is detected as a regime change',()=>{
  const days=[];
  for(let i=0;i<56;i++){
    const base=1+(i%7)*.015+((i%5)-2)*.008;
    days.push(makeDay(i,base,.18));
  }
  for(let i=56;i<63;i++){
    const base=1+(i%7)*.015;
    days.push(makeDay(i,base*1.38,.50));
  }
  const r=Regime.detectRegimeShift(days);
  assert.equal(r.status,'changed');
  assert.equal(r.direction,'higher');
  assert.ok(r.recent.changePct>.25);
  assert.ok(r.recent.matchingDays>=5);
  assert.ok(r.strength>0);
  assert.equal(r.dominantPart.key,'night');
  assert.ok(r.dominantPart.delta>.2);
});

test('one isolated spike does not become a persistent regime change',()=>{
  const days=[];
  for(let i=0;i<56;i++)days.push(makeDay(i,1+((i%4)-1.5)*.01,.18));
  for(let i=56;i<63;i++)days.push(makeDay(i,i===60?3.5:1.02,i===60?2.6:.18));
  const r=Regime.detectRegimeShift(days);
  assert.equal(r.status,'stable');
  assert.equal(r.direction,'stable');
  assert.equal(r.strength,0);
});

test('insufficient history is reported explicitly',()=>{
  const days=Array.from({length:12},(_,i)=>makeDay(i,1));
  const r=Regime.detectRegimeShift(days);
  assert.equal(r.status,'insufficient');
  assert.ok(r.requiredDays>r.availableDays);
});

test('forecast adaptation shifts weight from old history toward recent windows',()=>{
  const base={weekday:.4,recent7:.25,recent14:.2,pace:.15};
  const adapted=Regime.adaptEnsembleWeights(base,.8);
  const sum=Object.values(adapted).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum-1)<1e-12);
  assert.ok(adapted.weekday<base.weekday);
  assert.ok(adapted.recent7>base.recent7);
  assert.ok(adapted.recent14>base.recent14);
  const components=[
    {key:'weekday',value:40},{key:'recent7',value:60},{key:'recent14',value:56},{key:'pace',value:58}
  ];
  const normal=Regime.reblendForecast(components,base),changed=Regime.reblendForecast(components,adapted);
  assert.ok(changed>normal);
});
