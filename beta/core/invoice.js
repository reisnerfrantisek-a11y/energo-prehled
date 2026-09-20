(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoInvoice=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const COMPONENT_KEYS=[
    'energy','distribution','fixed','other',
    'supplyEnergy','distributionEnergy','systemServices','poze',
    'electricityTax','supplierFixed','breaker','distributionFixed','vat'
  ];

  function nullableNumber(v,digits=6){
    if(v===null||v===undefined||v==='')return null;
    const n=Number(v);if(!Number.isFinite(n)||n<0)return null;
    const p=10**digits;return Math.round(n*p)/p;
  }
  function nullableMoney(v){return nullableNumber(v,2)}

  function emptyFinance(){
    const components={};for(const k of COMPONENT_KEYS)components[k]=null;
    return {
      invoiceTotal:null,
      currency:'CZK',
      source:'manual',
      totals:{exVat:null,vat:null,incVat:null},
      components,
      metering:{ean:'',consumptionKwh:null,tariffCode:'',breaker:'',product:'',productSeries:''},
      tariff:{
        fixedExVatPerMonth:null,variableExVatPerKwh:null,
        fixedGrossPerMonth:null,variableGrossPerKwh:null,
        vatRate:null,validated:false,sourceMonthKey:'',sourceDocumentNumber:'',sourceSupplier:''
      },
      invoiceMeta:{
        supplier:'',
        documentNumber:'',
        variableSymbol:'',
        periodFrom:'',
        periodTo:'',
        issuedAt:'',
        dueAt:'',
        fileName:'',
        importedAt:'',
        parserVersion:'',
        extractionStatus:'none',
        extractionConfidence:null
      }
    };
  }

  function normalizeFinance(finance){
    const base=emptyFinance(),f=finance&&typeof finance==='object'?finance:{};
    base.invoiceTotal=nullableMoney(f.invoiceTotal);
    base.currency=String(f.currency||'CZK').toUpperCase()==='CZK'?'CZK':String(f.currency||'CZK').toUpperCase();
    base.source=['manual','pdf','import'].includes(f.source)?f.source:'manual';
    const totals=f.totals&&typeof f.totals==='object'?f.totals:{};
    base.totals.exVat=nullableMoney(totals.exVat);
    base.totals.vat=nullableMoney(totals.vat);
    base.totals.incVat=nullableMoney(totals.incVat??base.invoiceTotal);
    const c=f.components&&typeof f.components==='object'?f.components:{};
    for(const k of COMPONENT_KEYS)base.components[k]=nullableMoney(c[k]);
    const metering=f.metering&&typeof f.metering==='object'?f.metering:{};
    base.metering.ean=String(metering.ean||'');
    base.metering.consumptionKwh=nullableNumber(metering.consumptionKwh,6);
    base.metering.tariffCode=String(metering.tariffCode||'');
    base.metering.breaker=String(metering.breaker||'');
    base.metering.product=String(metering.product||'');
    base.metering.productSeries=String(metering.productSeries||'');
    const tariff=f.tariff&&typeof f.tariff==='object'?f.tariff:{};
    for(const k of ['fixedExVatPerMonth','variableExVatPerKwh','fixedGrossPerMonth','variableGrossPerKwh'])base.tariff[k]=nullableNumber(tariff[k],6);
    base.tariff.vatRate=nullableNumber(tariff.vatRate,6);
    base.tariff.validated=tariff.validated===true;
    for(const k of ['sourceMonthKey','sourceDocumentNumber','sourceSupplier'])base.tariff[k]=String(tariff[k]||'');
    const m=f.invoiceMeta&&typeof f.invoiceMeta==='object'?f.invoiceMeta:{};
    for(const k of Object.keys(base.invoiceMeta)){
      if(k==='extractionConfidence'){
        const raw=m[k];if(raw===null||raw===undefined||raw==='')base.invoiceMeta[k]=null;
        else{const n=Number(raw);base.invoiceMeta[k]=Number.isFinite(n)?Math.max(0,Math.min(1,n)):null}
      }else base.invoiceMeta[k]=String(m[k]??base.invoiceMeta[k]);
    }
    return base;
  }

  function componentTotal(finance){
    const f=normalizeFinance(finance),c=f.components;
    const variable=['supplyEnergy','distributionEnergy','systemServices','electricityTax'];
    const fixedDetail=['supplierFixed','breaker','distributionFixed'];
    const anyDetailed=[...variable,...fixedDetail,'poze','vat','other'].some(k=>c[k]!==null);
    if(anyDetailed){
      let total=[...variable,...fixedDetail,'poze','vat','other'].reduce((a,k)=>a+(Number(c[k])||0),0);
      const hasFixedDetail=fixedDetail.some(k=>c[k]!==null)||(c.poze!==null&&c.poze>0);
      if(!hasFixedDetail&&c.fixed!==null)total+=Number(c.fixed)||0;
      return total;
    }
    const legacy=['energy','distribution','fixed','other'].map(k=>c[k]).filter(v=>v!==null);
    return legacy.length?legacy.reduce((a,b)=>a+b,0):null;
  }

  function hasDetailedBreakdown(finance){
    const f=normalizeFinance(finance);
    return ['supplyEnergy','distributionEnergy','systemServices','poze','electricityTax','supplierFixed','breaker','distributionFixed','vat']
      .some(k=>f.components[k]!==null);
  }
  function hasValidatedTariff(finance){
    const f=normalizeFinance(finance),t=f.tariff;
    return t.validated===true&&Number.isFinite(t.fixedGrossPerMonth)&&Number.isFinite(t.variableGrossPerKwh);
  }
  function tariffCost(finance,energyKwh,monthFraction=1){
    const f=normalizeFinance(finance),e=Number(energyKwh),fraction=Number(monthFraction);
    if(!hasValidatedTariff(f)||!Number.isFinite(e)||e<0||!Number.isFinite(fraction)||fraction<0)return null;
    return f.tariff.fixedGrossPerMonth*fraction+f.tariff.variableGrossPerKwh*e;
  }

  return {COMPONENT_KEYS,nullableNumber,nullableMoney,emptyFinance,normalizeFinance,componentTotal,hasDetailedBreakdown,hasValidatedTariff,tariffCost};
});
