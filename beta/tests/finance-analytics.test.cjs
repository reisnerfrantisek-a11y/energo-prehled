const test=require('node:test');
const assert=require('node:assert/strict');
const Finance=require('../core/finance-analytics.js');

function pdf(monthKey,energy,invoice,fixed,variable){
  return {monthKey,energyKwh:energy,finance:{
    invoiceTotal:invoice,source:'pdf',
    tariff:{validated:true,fixedGrossPerMonth:fixed,variableGrossPerKwh:variable,sourceMonthKey:monthKey},
    invoiceMeta:{supplier:'E.ON Energie, a.s.',extractionConfidence:1}
  }};
}

test('invoice economics separates fixed and variable cost',()=>{
  const r=Finance.invoiceEconomics(pdf('2026-08',100,900,300,6));
  assert.equal(r.effectivePrice,9);
  assert.equal(r.fixedGross,300);
  assert.equal(r.variableGross,600);
  assert.equal(r.modeledTotal,900);
  assert.equal(r.residual,0);
  assert.equal(r.fixedShare,1/3);
  assert.equal(r.fixedEquivalentPerKwh,3);
});

test('tariff bridge exactly decomposes modeled cost change',()=>{
  const prev=pdf('2026-07',100,800,200,6);
  const curr=pdf('2026-08',120,1030,250,6.5);
  const b=Finance.tariffBridge(prev,curr);
  assert.equal(b.consumptionEffect,120);
  assert.equal(b.variableRateEffect,60);
  assert.equal(b.fixedEffect,50);
  assert.equal(b.modeledDelta,230);
  assert.equal(b.invoiceDelta,230);
  assert.equal(b.residual,0);
  assert.equal(b.energyDeltaPct,20);
});

test('finance summary uses weighted effective price and latest validated bridge',()=>{
  const s=Finance.financeSummary([pdf('2026-06',50,500,200,6),pdf('2026-07',100,800,200,6),pdf('2026-08',120,1030,250,6.5)]);
  assert.equal(s.count,3);
  assert.equal(s.totalInvoice,2330);
  assert.equal(s.totalEnergy,270);
  assert.ok(Math.abs(s.weightedEffectivePrice-2330/270)<1e-12);
  assert.equal(s.latest.monthKey,'2026-08');
  assert.ok(s.bridge);
});

test('component breakdown groups detailed net components and VAT without double counting legacy fields',()=>{
  const rows=Finance.componentBreakdown({
    invoiceTotal:1210,source:'pdf',
    components:{energy:500,distribution:300,fixed:100,other:10,supplyEnergy:500,distributionEnergy:200,systemServices:50,poze:40,electricityTax:10,supplierFixed:60,breaker:70,distributionFixed:30,vat:240}
  });
  const by=Object.fromEntries(rows.map(r=>[r.id,r.value]));
  assert.equal(by.supply,500);
  assert.equal(by.distribution,250);
  assert.equal(by.taxSupport,50);
  assert.equal(by.fixed,160);
  assert.equal(by.other,10);
  assert.equal(by.vat,240);
  assert.equal(rows[0].total,1210);
});

test('tariff age is calendar-month based',()=>{
  assert.equal(Finance.tariffAgeMonths('2026-09','2026-08'),1);
  assert.equal(Finance.tariffAgeMonths('2027-01','2026-10'),3);
  assert.equal(Finance.tariffAgeMonths('bad','2026-10'),null);
});


test('price uncertainty grows with tariff age and weak regression confidence',()=>{
  const fresh=Finance.priceUncertainty({modelType:'tariff',ageMonths:1,confidence:1});
  const stale=Finance.priceUncertainty({modelType:'tariff',ageMonths:6,confidence:.55});
  const regression=Finance.priceUncertainty({modelType:'regression',confidence:.2});
  assert.equal(fresh,0);
  assert.ok(stale>fresh);
  assert.ok(regression>=.05&&regression<=.22);
});

test('expanded cost band preserves central estimate and widens uncertainty honestly',()=>{
  const fresh=Finance.expandCostBand({central:1000,low:900,high:1100,modelType:'tariff',ageMonths:1,confidence:1});
  assert.equal(fresh.central,1000);
  assert.equal(fresh.low,900);
  assert.equal(fresh.high,1100);
  const stale=Finance.expandCostBand({central:1000,low:900,high:1100,modelType:'tariff',ageMonths:6,confidence:.55});
  assert.equal(stale.central,1000);
  assert.ok(stale.low<900);
  assert.ok(stale.high>1100);
  assert.ok(stale.priceUncertainty>0);
});

test('target cost scenario separates fixed cost from avoidable variable cost',()=>{
  const s=Finance.targetCostScenario({targetEnergy:100,forecastEnergy:120,fixed:300,variableRate:6});
  assert.equal(s.targetCost,900);
  assert.equal(s.forecastCost,1020);
  assert.equal(s.difference,120);
  assert.equal(s.energyDifference,20);
});
