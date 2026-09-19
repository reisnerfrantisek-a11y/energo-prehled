(function(root,factory){
  let Invoice;
  if(typeof module==='object'&&module.exports)Invoice=require('./invoice.js');
  else Invoice=root.EnergoInvoice;
  const api=factory(Invoice);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoInvoiceParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Invoice){
  'use strict';
  if(!Invoice)throw new Error('EnergoInvoice is required.');

  const PARSER_VERSION='eon-cz-1.0.0';
  const NUM='[0-9]+(?:\\s[0-9]{3})*(?:[.,][0-9]+)?';

  function normalizeText(text){
    return String(text||'').replace(/\u00ad/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function parseCzNumber(raw){
    if(raw===null||raw===undefined)return null;
    const s=String(raw).replace(/[\u00a0\u202f\s]/g,'').replace(',','.').trim();
    const n=Number(s);return Number.isFinite(n)?n:null;
  }
  function money(v){const n=parseCzNumber(v);return Number.isFinite(n)?Math.round(n*100)/100:null}
  function isoDate(raw){
    const m=String(raw||'').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:'';
  }
  function monthKeyFromPeriod(from,to){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return '';
    return from.slice(0,7)===to.slice(0,7)?from.slice(0,7):'';
  }
  function beforeLabel(text,labelSource,tokenSource='[0-9]{6,20}'){
    const re=new RegExp(`(${tokenSource})\\s+${labelSource}`,'i'),m=text.match(re);return m?String(m[1]).trim():'';
  }
  function first(text,re,group=1){const m=text.match(re);return m?String(m[group]??'').trim():''}
  function collectCharge(text,labelSource){
    const unit='(MWh|kWh|Měsíc|Mesíc|Mesic)';
    const re=new RegExp(`${labelSource}[\\s\\S]{0,190}?${unit}\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})`,'gi'),out=[];
    for(const m of text.matchAll(re)){
      out.push({
        unit:/^mwh$/i.test(m[1])?'MWh':/^kwh$/i.test(m[1])?'kWh':'Měsíc',
        quantity:parseCzNumber(m[2]),
        unitPrice:parseCzNumber(m[3]),
        total:money(m[4])
      });
    }
    return out.filter(x=>Number.isFinite(x.quantity)&&Number.isFinite(x.unitPrice)&&Number.isFinite(x.total));
  }
  function sum(items,key='total'){return items.reduce((a,x)=>a+(Number(x[key])||0),0)}
  function kwhFrom(items){
    return items.reduce((a,x)=>a+(x.unit==='MWh'?x.quantity*1000:x.unit==='kWh'?x.quantity:0),0);
  }
  function monthlyUnits(items){return items.reduce((a,x)=>a+(x.unit==='Měsíc'?x.quantity:0),0)}
  function exactCharge(items){
    return items.reduce((a,x)=>{
      if(x.unit==='MWh'||x.unit==='Měsíc')return a+x.quantity*x.unitPrice;
      if(x.unit==='kWh')return a+(x.quantity*x.unitPrice);
      return a;
    },0);
  }
  function variableRatePerKwh(items){
    const kwh=kwhFrom(items);if(!(kwh>0))return 0;
    return exactCharge(items)/kwh;
  }
  function aggregate(items){
    const total=sum(items),kwh=kwhFrom(items),months=monthlyUnits(items);
    return {total:Math.round(total*100)/100,kwh,months,perKwh:kwh>0?total/kwh:null,perMonth:months>0?total/months:null};
  }
  function round(v,d=6){if(!Number.isFinite(v))return null;const p=10**d;return Math.round(v*p)/p}

  function parseEonInvoiceText(rawText,opts={}){
    const text=normalizeText(rawText),warnings=[],fatal=[];
    if(!/E\.\s*ON\s+Energie\s*,?\s*a\.s\./i.test(text)&&!/EON\s+Energie/i.test(text))fatal.push('Dokument nebyl rozpoznán jako faktura E.ON Energie.');

    const periodMatch=text.match(/Odečtové období:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{4})/i)
      ||text.match(/Vyúčtování bylo provedeno za období od\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\s*do\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i);
    const periodFrom=periodMatch?isoDate(periodMatch[1]):'',periodTo=periodMatch?isoDate(periodMatch[2]):'',invoiceMonthKey=monthKeyFromPeriod(periodFrom,periodTo);
    if(!periodFrom||!periodTo)fatal.push('Nepodařilo se rozpoznat fakturační období.');
    else if(!invoiceMonthKey)warnings.push('Fakturační období přesahuje jeden kalendářní měsíc.');

    const totalsMatch=text.match(new RegExp(`Faktura celkem\\s+(${NUM})\\s+(${NUM})`,'i'));
    const totalExVat=totalsMatch?money(totalsMatch[1]):money(first(text,new RegExp(`Cena celkem\\s+(${NUM})`,'i')));
    const invoiceTotal=totalsMatch?money(totalsMatch[2]):money(first(text,new RegExp(`Nedoplatek\\s+(${NUM})`,'i')));
    if(!Number.isFinite(invoiceTotal))fatal.push('Nepodařilo se rozpoznat celkovou částku faktury.');
    if(!Number.isFinite(totalExVat))fatal.push('Nepodařilo se rozpoznat částku bez DPH.');

    const consumptionMwh=parseCzNumber(first(text,new RegExp(`Celková spotřeba elektřiny\\s+(${NUM})\\s*MWh`,'i')));
    let consumptionKwh=Number.isFinite(consumptionMwh)?consumptionMwh*1000:null;
    const ean=first(text,/\b(\d{18})\s*EAN\b/i)||first(text,/\bEAN\s*(\d{18})\b/i);
    const documentNumber=beforeLabel(text,'Číslo daňového dokladu');
    const variableSymbol=beforeLabel(text,'Variabilní symbol');
    const issuedAt=isoDate(beforeLabel(text,'Datum vystavení faktury','\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{4}'));
    const dueAt=isoDate(beforeLabel(text,'Datum splatnosti faktury','\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{4}'));

    const supply=collectCharge(text,'Dodané množství(?:\\s+jednotarif|\\s+ve vysokém tarifu|\\s+ve nízkém tarifu)?');
    const supplierFixed=collectCharge(text,'Stálý plat');
    const electricityTax=collectCharge(text,'Daň z elektřiny');
    const distributionEnergy=collectCharge(text,'Cena za distrib\\.?\\s*množství elektřiny(?:\\s+ve vysokém tarifu|\\s+ve nízkém tarifu)?');
    const breaker=collectCharge(text,'Cena za příkon podle hodnoty hl\\.?\\s*jističe[^M]{0,45}');
    const systemServices=collectCharge(text,'Pevná cena za systémové služby');
    const distributionFixed=collectCharge(text,'Cena za provoz nesíťové infrastruktury');
    let poze=collectCharge(text,'Složka ceny na podporu el\\.?\\s*z podpor\\.?\\s*zdrojů energie');
    if(!poze.length)poze=collectCharge(text,'Složka ceny na podporu elektřiny z podporovaných zdrojů energie');

    const groups={supply,supplierFixed,electricityTax,distributionEnergy,breaker,systemServices,distributionFixed,poze};
    const ag={};for(const [k,v] of Object.entries(groups))ag[k]=aggregate(v);
    if(!Number.isFinite(consumptionKwh)||consumptionKwh<=0){
      const lineKwh=ag.supply.kwh||ag.distributionEnergy.kwh;
      if(lineKwh>0)consumptionKwh=lineKwh;
    }

    const knownNet=['supply','supplierFixed','electricityTax','distributionEnergy','breaker','systemServices','distributionFixed','poze'].reduce((a,k)=>a+ag[k].total,0);
    const unmatched=Number.isFinite(totalExVat)?Math.round((totalExVat-knownNet)*100)/100:null;
    if(Number.isFinite(unmatched)&&Math.abs(unmatched)>0.05)warnings.push(`Součet rozpoznaných položek se liší od ceny bez DPH o ${unmatched.toFixed(2)} Kč.`);

    const vatAmount=Number.isFinite(invoiceTotal)&&Number.isFinite(totalExVat)?Math.round((invoiceTotal-totalExVat)*100)/100:null;
    const vatRateRaw=Number.isFinite(vatAmount)&&totalExVat>0?vatAmount/totalExVat:null;
    const knownVatRates=[0,0.12,0.21],nearestVat=Number.isFinite(vatRateRaw)?knownVatRates.reduce((a,b)=>Math.abs(b-vatRateRaw)<Math.abs(a-vatRateRaw)?b:a,knownVatRates[0]):null;
    const vatRate=Number.isFinite(vatRateRaw)&&Number.isFinite(nearestVat)&&Math.abs(vatRateRaw-nearestVat)<=0.005?nearestVat:vatRateRaw;
    if(Number.isFinite(vatRate)&&(vatRate<0||vatRate>.5))warnings.push('Neobvyklá sazba DPH.');

    const variableNet=ag.supply.total+ag.electricityTax.total+ag.distributionEnergy.total+ag.systemServices.total
      +(poze.some(x=>x.unit==='MWh'||x.unit==='kWh')?ag.poze.total:0);
    const fixedNet=ag.supplierFixed.total+ag.breaker.total+ag.distributionFixed.total
      +(poze.some(x=>x.unit==='Měsíc')?ag.poze.total:0);
    const knownForTariff=Math.round((variableNet+fixedNet)*100)/100;
    const tariffDifference=Number.isFinite(totalExVat)?Math.round((totalExVat-knownForTariff)*100)/100:null;
    const tariffValidated=Number.isFinite(consumptionKwh)&&consumptionKwh>0&&Number.isFinite(vatRate)&&Math.abs(tariffDifference||0)<=0.05;
    if(!tariffValidated)warnings.push('Tarifní model nebyl plně ověřen; pro predikci zůstane k dispozici statistický model.');

    const grossFactor=Number.isFinite(vatRate)?1+vatRate:null;
    const variableItems=[...supply,...electricityTax,...distributionEnergy,...systemServices,...poze.filter(x=>x.unit==='MWh'||x.unit==='kWh')];
    const variableExVatPerKwh=Number.isFinite(consumptionKwh)&&consumptionKwh>0?exactCharge(variableItems)/consumptionKwh:null;
    const fixedItems=[...supplierFixed,...breaker,...distributionFixed,...poze.filter(x=>x.unit==='Měsíc')];
    const fixedMonths=Math.max(1,monthlyUnits(fixedItems)/Math.max(1,fixedItems.filter(x=>x.unit==='Měsíc').length));
    const fixedExVatPerMonth=fixedMonths>0?exactCharge(fixedItems)/fixedMonths:fixedNet;
    const confidence=fatal.length?0:Math.max(.5,Math.min(1,1-(warnings.length*.12)));

    const finance=Invoice.normalizeFinance({
      invoiceTotal,
      currency:'CZK',
      source:'pdf',
      totals:{exVat:totalExVat,vat:vatAmount,incVat:invoiceTotal},
      components:{
        energy:ag.supply.total,
        distribution:ag.distributionEnergy.total+ag.systemServices.total+ag.distributionFixed.total+ag.breaker.total+ag.poze.total,
        fixed:fixedNet,
        other:Number.isFinite(unmatched)&&Math.abs(unmatched)>0.005?Math.max(0,unmatched):0,
        supplyEnergy:ag.supply.total,
        distributionEnergy:ag.distributionEnergy.total,
        systemServices:ag.systemServices.total,
        poze:ag.poze.total,
        electricityTax:ag.electricityTax.total,
        supplierFixed:ag.supplierFixed.total,
        breaker:ag.breaker.total,
        distributionFixed:ag.distributionFixed.total,
        vat:vatAmount
      },
      metering:{
        ean,
        consumptionKwh:round(consumptionKwh,3),
        tariffCode:first(text,/\b(D\d{2}d)\b/i),
        breaker:first(text,/\b(\d+x\d+)\b\s+Měsíc/i),
        product:first(text,/Produkt dodávky:\s*([^:]{1,50}?)\s+Produktová řada:/i),
        productSeries:first(text,/Produktová řada:\s*([^:]{1,100}?)\s+Dodané množství/i)
      },
      tariff:{
        fixedExVatPerMonth:round(fixedExVatPerMonth,6),
        variableExVatPerKwh:round(variableExVatPerKwh,6),
        fixedGrossPerMonth:round(Number.isFinite(grossFactor)?fixedExVatPerMonth*grossFactor:null,6),
        variableGrossPerKwh:round(Number.isFinite(grossFactor)&&Number.isFinite(variableExVatPerKwh)?variableExVatPerKwh*grossFactor:null,6),
        vatRate:round(vatRate,6),
        validated:tariffValidated,
        sourceMonthKey:invoiceMonthKey,
        sourceDocumentNumber:documentNumber,
        sourceSupplier:'E.ON Energie, a.s.'
      },
      invoiceMeta:{
        supplier:'E.ON Energie, a.s.',
        documentNumber,variableSymbol,periodFrom,periodTo,issuedAt,dueAt,
        fileName:String(opts.fileName||''),importedAt:String(opts.importedAt||new Date().toISOString()),
        parserVersion:PARSER_VERSION,
        extractionStatus:fatal.length?'failed':warnings.length?'review':'verified',
        extractionConfidence:confidence
      }
    });

    const componentSum=Invoice.componentTotal(finance),componentDifference=Number.isFinite(componentSum)&&Number.isFinite(invoiceTotal)?Math.round((invoiceTotal-componentSum)*100)/100:null;
    if(Number.isFinite(componentDifference)&&Math.abs(componentDifference)>0.05)warnings.push(`Rozpad ceny včetně DPH se liší od celkové faktury o ${componentDifference.toFixed(2)} Kč.`);

    return {
      parser:PARSER_VERSION,
      supplier:'E.ON Energie, a.s.',
      invoiceMonthKey,finance,warnings,fatal,
      canSave:fatal.length===0,
      validation:{
        totalExVat,invoiceTotal,vatAmount,componentSum,componentDifference,
        knownNet:Math.round(knownNet*100)/100,netDifference:unmatched,
        tariffDifference,tariffValidated,
        consumptionKwh:round(consumptionKwh,3),ean
      }
    };
  }

  return {PARSER_VERSION,normalizeText,parseCzNumber,parseEonInvoiceText};
});
