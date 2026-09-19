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

  function nullableMoney(v){
    if(v===null||v===undefined||v==='')return null;
    const n=Number(v);
    return Number.isFinite(n)&&n>=0?Math.round(n*100)/100:null;
  }

  function emptyFinance(){
    const components={};for(const k of COMPONENT_KEYS)components[k]=null;
    return {
      invoiceTotal:null,
      currency:'CZK',
      source:'manual',
      components,
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
    const c=f.components&&typeof f.components==='object'?f.components:{};
    for(const k of COMPONENT_KEYS)base.components[k]=nullableMoney(c[k]);
    const m=f.invoiceMeta&&typeof f.invoiceMeta==='object'?f.invoiceMeta:{};
    for(const k of Object.keys(base.invoiceMeta)){
      if(k==='extractionConfidence'){
        const n=Number(m[k]);base.invoiceMeta[k]=Number.isFinite(n)?Math.max(0,Math.min(1,n)):null;
      }else base.invoiceMeta[k]=String(m[k]??base.invoiceMeta[k]);
    }
    return base;
  }

  function componentTotal(finance){
    const f=normalizeFinance(finance);
    const detailed=['supplyEnergy','distributionEnergy','systemServices','poze','electricityTax','supplierFixed','breaker','distributionFixed','vat','other'];
    const vals=detailed.map(k=>f.components[k]).filter(v=>v!==null);
    if(vals.length)return vals.reduce((a,b)=>a+b,0);
    const legacy=['energy','distribution','fixed','other'].map(k=>f.components[k]).filter(v=>v!==null);
    return legacy.length?legacy.reduce((a,b)=>a+b,0):null;
  }

  function hasDetailedBreakdown(finance){
    const f=normalizeFinance(finance);
    return ['supplyEnergy','distributionEnergy','systemServices','poze','electricityTax','supplierFixed','breaker','distributionFixed','vat']
      .some(k=>f.components[k]!==null);
  }

  return {COMPONENT_KEYS,nullableMoney,emptyFinance,normalizeFinance,componentTotal,hasDetailedBreakdown};
});
