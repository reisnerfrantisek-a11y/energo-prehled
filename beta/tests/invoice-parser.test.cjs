const test=require('node:test');
const assert=require('node:assert/strict');
const Invoice=require('../core/invoice.js');
const Parser=require('../core/invoice-parser.js');

const sample=`
E.ON Energie, a.s.
Řádná faktura za elektřinu
Celková spotřeba elektřiny 0,01200 MWh
Vyúčtování bylo provedeno za období od 1. 8. 2026 do 31. 8. 2026:
Faktura celkem 335,99 406,55
9999999999 Číslo daňového dokladu
4. 9. 2026 Datum vystavení faktury
18. 9. 2026 Datum splatnosti faktury
8888888888 Variabilní symbol
Odečtové období: 01.08.2026 - 31.08.2026
859000000000000001 EAN
Produkt dodávky: Klasik Produktová řada: Variant PRO
Dodané množství jednotarif 01.08.2026 31.08.2026 MWh 0,012 2 440,00 29,28
Stálý plat 01.08.2026 31.08.2026 Měsíc 1,000 139,00 139,00
Daň z elektřiny 01.08.2026 31.08.2026 MWh 0,012 28,30 0,34
Cena za distrib. množství elektřiny ve vysokém tarifu 01.08.2026 31.08.2026 D01d MWh 0,012 2 711,14 32,53
Cena za příkon podle hodnoty hl. jističe před elekt. 01.08.2026 31.08.2026 D01d 3x25 Měsíc 1,000 120,00 120,00
Pevná cena za systémové služby 01.08.2026 31.08.2026 D01d MWh 0,012 164,24 1,97
Cena za provoz nesíťové infrastruktury 01.08.2026 31.08.2026 D01d Měsíc 1,000 12,87 12,87
Složka ceny na podporu el. z podpor. zdrojů energie 01.08.2026 31.08.2026 D01d 3x25 Měsíc 1,000 0,00 0,00
Celkem za dodávku elektřiny a související služby v elektroenergetice v Kč bez DPH 335,99
`;

test('E.ON parser extracts validated August invoice and exact tariff model',()=>{
  const r=Parser.parseEonInvoiceText(sample,{fileName:'invoice.pdf',importedAt:'2026-09-19T00:00:00Z'});
  assert.equal(r.canSave,true);
  assert.deepEqual(r.fatal,[]);
  assert.deepEqual(r.warnings,[]);
  assert.equal(r.invoiceMonthKey,'2026-08');
  assert.equal(r.finance.invoiceTotal,406.55);
  assert.equal(r.finance.totals.exVat,335.99);
  assert.equal(r.finance.totals.vat,70.56);
  assert.equal(r.finance.metering.consumptionKwh,12);
  assert.equal(r.finance.metering.ean,'859000000000000001');
  assert.equal(r.finance.components.supplyEnergy,29.28);
  assert.equal(r.finance.components.supplierFixed,139);
  assert.equal(r.finance.components.electricityTax,0.34);
  assert.equal(r.finance.components.distributionEnergy,32.53);
  assert.equal(r.finance.components.breaker,120);
  assert.equal(r.finance.components.systemServices,1.97);
  assert.equal(r.finance.components.distributionFixed,12.87);
  assert.equal(r.finance.components.poze,0);
  assert.equal(r.finance.tariff.validated,true);
  assert.ok(Math.abs(r.finance.tariff.fixedExVatPerMonth-271.87)<1e-9);
  assert.ok(Math.abs(r.finance.tariff.variableExVatPerKwh-5.34368)<1e-6);
  assert.ok(Math.abs(r.finance.tariff.fixedGrossPerMonth-328.9627)<1e-6);
  assert.ok(Math.abs(r.finance.tariff.variableGrossPerKwh-6.465853)<1e-6);
  assert.equal(r.validation.componentDifference,0);
  assert.equal(r.validation.netDifference,0);
});

test('invoice schema keeps old records compatible and tariff cost works',()=>{
  const old=Invoice.normalizeFinance({invoiceTotal:123.45,components:{energy:20,distribution:30,fixed:40,other:33.45}});
  assert.equal(old.invoiceTotal,123.45);
  assert.equal(old.tariff.validated,false);
  const parsed=Parser.parseEonInvoiceText(sample).finance;
  assert.equal(Invoice.hasValidatedTariff(parsed),true);
  const estimate=Invoice.tariffCost(parsed,36.8,1);
  assert.ok(Math.abs(estimate-(328.9627+6.465853*36.8))<0.01);
});

test('parser blocks a document without E.ON identity and invoice totals',()=>{
  const r=Parser.parseEonInvoiceText('Some document Odečtové období: 01.08.2026 - 31.08.2026');
  assert.equal(r.canSave,false);
  assert.ok(r.fatal.length>=2);
});


test('parser rejects a billing period spanning multiple calendar months',()=>{
  const cross=sample.replace('01.08.2026 - 31.08.2026','20.08.2026 - 20.09.2026')
    .replace('od 1. 8. 2026 do 31. 8. 2026','od 20. 8. 2026 do 20. 9. 2026');
  const r=Parser.parseEonInvoiceText(cross);
  assert.equal(r.canSave,false);
  assert.ok(r.fatal.some(x=>/přesahuje jeden kalendářní měsíc/i.test(x)));
});
