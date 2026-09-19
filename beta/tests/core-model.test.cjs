const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../core/model.js');
const Invoice=require('../core/invoice.js');

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
