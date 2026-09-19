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


test('PDF.js items are reconstructed by visual rows instead of extraction order',()=>{
  const items=[
    {str:'31.08.2026',transform:[1,0,0,1,160,500]},
    {str:'0,012',transform:[1,0,0,1,310,500]},
    {str:'29,28',transform:[1,0,0,1,500,500]},
    {str:'Dodané množství jednotarif',transform:[1,0,0,1,20,500]},
    {str:'MWh',transform:[1,0,0,1,250,500]},
    {str:'2 440,00',transform:[1,0,0,1,390,500]},
    {str:'01.08.2026',transform:[1,0,0,1,90,500]},
    {str:'Odečtové období:',transform:[1,0,0,1,20,700]},
    {str:'01.08.2026',transform:[1,0,0,1,150,700]},
    {str:'-',transform:[1,0,0,1,225,700]},
    {str:'31.08.2026',transform:[1,0,0,1,240,700]}
  ];
  const text=Parser.pdfItemsToLayoutText(items);
  assert.match(text,/Odečtové období: 01\.08\.2026 - 31\.08\.2026/);
  assert.match(text,/Dodané množství jednotarif 01\.08\.2026 31\.08\.2026 MWh 0,012 2 440,00 29,28/);
});


test('candidate parser picks the complete layout over a broken extraction',()=>{
  const broken='E.ON Energie, a.s. Faktura celkem 335,99 406,55 859000000000000001 EAN';
  const r=Parser.parseEonInvoiceCandidates([
    {name:'broken',text:broken},
    {name:'layout-rows',text:sample}
  ],{fileName:'invoice.pdf'});
  assert.equal(r.extractionStrategy,'composite');
  assert.equal(r.canSave,true);
  assert.equal(r.invoiceMonthKey,'2026-08');
  assert.equal(r.finance.metering.consumptionKwh,12);
  assert.equal(r.finance.tariff.validated,true);
  assert.ok(r.candidateScores[0].score>=r.candidateScores[1].score);
});

test('column-flow reconstruction keeps sidebar labels together',()=>{
  const items=[
    {str:'Celková',transform:[1,0,0,1,70,400]},
    {str:'spotřeba',transform:[1,0,0,1,105,400]},
    {str:'0,01200',transform:[1,0,0,1,240,400]},
    {str:'MWh',transform:[1,0,0,1,280,400]},
    {str:'4124160632',transform:[1,0,0,1,448,500]},
    {str:'Číslo daňového dokladu',transform:[1,0,0,1,448,485]}
  ];
  const text=Parser.pdfItemsToColumnFlowText(items,420);
  assert.match(text,/Celková spotřeba 0,01200 MWh/);
  assert.match(text,/4124160632\nČíslo daňového dokladu/);
});


test('composite candidate can combine metadata and line items from different extraction strategies',()=>{
  const meta='E.ON Energie, a.s. Vyúčtování bylo provedeno za období od 1. 8. 2026 do 31. 8. 2026: Faktura celkem 335,99 406,55 4124160632 Číslo daňového dokladu 859000000000000001 EAN Celková spotřeba elektřiny 0,01200 MWh Stálý plat: 271,87 Kč/měsíc, VT: 5,34 Kč/kWh';
  const rows=[
    'Dodané množství jednotarif 01.08.2026 31.08.2026 MWh 0,012 2 440,00 29,28',
    'Stálý plat 01.08.2026 31.08.2026 Měsíc 1,000 139,00 139,00',
    'Daň z elektřiny 01.08.2026 31.08.2026 MWh 0,012 28,30 0,34',
    'Cena za distrib. množství elektřiny ve vysokém tarifu 01.08.2026 31.08.2026 D01d MWh 0,012 2 711,14 32,53',
    'Cena za příkon podle hodnoty hl. jističe před elekt. 01.08.2026 31.08.2026 D01d 3x25 Měsíc 1,000 120,00 120,00',
    'Pevná cena za systémové služby 01.08.2026 31.08.2026 D01d MWh 0,012 164,24 1,97',
    'Cena za provoz nesíťové infrastruktury 01.08.2026 31.08.2026 D01d Měsíc 1,000 12,87 12,87',
    'Složka ceny na podporu el. z podpor. zdrojů energie 01.08.2026 31.08.2026 D01d 3x25 Měsíc 1,000 0,00 0,00'
  ].join('\n');
  const r=Parser.parseEonInvoiceCandidates([{name:'meta',text:meta},{name:'rows',text:rows}]);
  assert.equal(r.extractionStrategy,'composite');
  assert.equal(r.canSave,true);
  assert.equal(r.finance.metering.consumptionKwh,12);
  assert.equal(r.finance.components.breaker,120);
  assert.equal(r.finance.tariff.validated,true);
});

test('missing detailed charges stay null instead of fake zeroes',()=>{
  const r=Parser.parseEonInvoiceText('E.ON Energie, a.s. Faktura celkem 335,99 406,55');
  assert.equal(r.finance.components.supplyEnergy,null);
  assert.equal(r.finance.components.breaker,null);
  assert.equal(r.finance.components.other,null);
});
