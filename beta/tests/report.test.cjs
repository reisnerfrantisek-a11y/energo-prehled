const test=require('node:test');
const assert=require('node:assert/strict');
const Report=require('../core/report.js');

test('monthly report summarizes energy, peak, strongest day and invoice',()=>{
  const rows=[
    {dateKey:'2026-08-01',timestamp:'01.08.2026 10:00',kw:2,energy:.5},
    {dateKey:'2026-08-01',timestamp:'01.08.2026 10:15',kw:4,energy:1},
    {dateKey:'2026-08-02',timestamp:'02.08.2026 18:00',kw:6,energy:1.5}
  ];
  const r=Report.buildMonthlyReport({records:rows,invoiceTotal:24,targetKwh:3.2});
  assert.equal(r.actualEnergy,3);
  assert.equal(r.peakKw,6);
  assert.equal(r.peakTimestamp,'02.08.2026 18:00');
  assert.equal(r.strongestDay.dateKey,'2026-08-01');
  assert.equal(r.strongestDay.energy,1.5);
  assert.equal(r.effectivePrice,8);
  assert.ok(Math.abs(r.targetDelta+0.2)<1e-12);
});

test('monthly report evaluates the historical snapshot without recomputing it',()=>{
  const r=Report.buildMonthlyReport({
    records:[{dateKey:'2026-08-01',kw:2,energy:10}],
    invoiceTotal:100,
    snapshot:{asOfDate:'2026-08-24',daysRemaining:7,predictedEnergy:12,projectedCost:110,lowProjectedCost:90,highProjectedCost:120}
  });
  assert.equal(r.predictedEnergy,12);
  assert.equal(r.energyError,2);
  assert.equal(r.energyErrorPct,20);
  assert.equal(r.costError,10);
  assert.equal(r.costErrorPct,10);
  assert.equal(r.costInsideBand,true);
  assert.equal(r.snapshot.asOfDate,'2026-08-24');
});

test('monthly report keeps unavailable forecast and invoice explicitly null',()=>{
  const r=Report.buildMonthlyReport({records:[{dateKey:'2026-08-01',kw:1,energy:.25}]});
  assert.equal(r.invoiceTotal,null);
  assert.equal(r.predictedEnergy,null);
  assert.equal(r.energyErrorPct,null);
  assert.equal(r.costErrorPct,null);
});
