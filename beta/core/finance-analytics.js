(function(root,factory){
  let Invoice;
  if(typeof module==='object'&&module.exports)Invoice=require('./invoice.js');
  else Invoice=root.EnergoInvoice;
  const api=factory(Invoice);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoFinanceAnalytics=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Invoice){
  'use strict';
  if(!Invoice)throw new Error('EnergoInvoice is required.');

  function finite(v){
    if(v===null||v===undefined||v==='')return null;
    const n=Number(v);return Number.isFinite(n)?n:null;
  }
  function monthIndex(key){
    const m=String(key||'').match(/^(\d{4})-(\d{2})$/);if(!m)return null;
    const y=Number(m[1]),mo=Number(m[2]);return mo>=1&&mo<=12?y*12+mo-1:null;
  }
  function tariffAgeMonths(targetMonthKey,sourceMonthKey){
    const a=monthIndex(targetMonthKey),b=monthIndex(sourceMonthKey);
    return a===null||b===null?null:Math.max(0,a-b);
  }

  function invoiceEconomics(input={}){
    const finance=Invoice.normalizeFinance(input.finance),energy=finite(input.energyKwh),invoice=finite(finance.invoiceTotal),t=finance.tariff;
    const effectivePrice=invoice!==null&&energy!==null&&energy>0?invoice/energy:null;
    const tariffValid=Invoice.hasValidatedTariff(finance)&&energy!==null&&energy>=0;
    const fixedGross=tariffValid?finite(t.fixedGrossPerMonth):null,variableRate=tariffValid?finite(t.variableGrossPerKwh):null;
    const variableGross=fixedGross!==null&&variableRate!==null&&energy!==null?variableRate*energy:null;
    const modeledTotal=fixedGross!==null&&variableGross!==null?fixedGross+variableGross:null;
    const residual=invoice!==null&&modeledTotal!==null?invoice-modeledTotal:null;
    return {
      monthKey:String(input.monthKey||''),
      energyKwh:energy,invoiceTotal:invoice,effectivePrice,
      source:finance.source,tariffValid,
      fixedGross,variableRate,variableGross,modeledTotal,residual,
      fixedShare:invoice!==null&&invoice>0&&fixedGross!==null?fixedGross/invoice:null,
      variableShare:invoice!==null&&invoice>0&&variableGross!==null?variableGross/invoice:null,
      fixedEquivalentPerKwh:energy!==null&&energy>0&&fixedGross!==null?fixedGross/energy:null,
      tariffSourceMonthKey:String(t.sourceMonthKey||input.monthKey||''),
      supplier:String(finance.invoiceMeta.supplier||t.sourceSupplier||''),
      confidence:finite(finance.invoiceMeta.extractionConfidence),
      finance
    };
  }

  function componentBreakdown(financeInput){
    const finance=Invoice.normalizeFinance(financeInput);
    if(!Invoice.hasDetailedBreakdown(finance))return [];
    const c=finance.components,n=v=>finite(v)||0;
    const rows=[
      {id:'supply',label:'Silová elektřina',value:n(c.supplyEnergy)},
      {id:'distribution',label:'Distribuce a služby sítě',value:n(c.distributionEnergy)+n(c.systemServices)},
      {id:'taxSupport',label:'Daň a POZE',value:n(c.electricityTax)+n(c.poze)},
      {id:'fixed',label:'Stálé platby',value:n(c.supplierFixed)+n(c.breaker)+n(c.distributionFixed)},
      {id:'other',label:'Ostatní',value:n(c.other)},
      {id:'vat',label:'DPH',value:n(c.vat)}
    ];
    const total=rows.reduce((s,r)=>s+r.value,0);
    return rows.filter(r=>r.value>0).map(r=>({...r,share:total>0?r.value/total:null,total}));
  }

  function tariffBridge(previousInput,currentInput){
    const prev=invoiceEconomics(previousInput),curr=invoiceEconomics(currentInput);
    if(!prev.tariffValid||!curr.tariffValid||prev.energyKwh===null||curr.energyKwh===null)return null;
    const consumptionEffect=prev.variableRate*(curr.energyKwh-prev.energyKwh);
    const variableRateEffect=(curr.variableRate-prev.variableRate)*curr.energyKwh;
    const fixedEffect=curr.fixedGross-prev.fixedGross;
    const modeledDelta=consumptionEffect+variableRateEffect+fixedEffect;
    const invoiceDelta=prev.invoiceTotal!==null&&curr.invoiceTotal!==null?curr.invoiceTotal-prev.invoiceTotal:null;
    const residual=invoiceDelta!==null?invoiceDelta-modeledDelta:null;
    return {
      previous:prev,current:curr,
      consumptionEffect,variableRateEffect,fixedEffect,modeledDelta,invoiceDelta,residual,
      variableRateDelta:curr.variableRate-prev.variableRate,
      variableRateDeltaPct:prev.variableRate>0?(curr.variableRate-prev.variableRate)/prev.variableRate*100:null,
      fixedDeltaPct:prev.fixedGross>0?(curr.fixedGross-prev.fixedGross)/prev.fixedGross*100:null,
      energyDelta:curr.energyKwh-prev.energyKwh,
      energyDeltaPct:prev.energyKwh>0?(curr.energyKwh-prev.energyKwh)/prev.energyKwh*100:null
    };
  }

  function priceUncertainty(input={}){
    const modelType=String(input.modelType||'regression'),age=finite(input.ageMonths),confidence=finite(input.confidence);
    if(modelType==='tariff'){
      const agePart=age===null||age<=1?0:age===2?.015:age===3?.03:age<=6?.05:.08;
      const qualityPart=confidence===null?0:Math.max(0,Math.min(.08,(1-Math.max(0,Math.min(1,confidence)))*.08));
      return Math.max(0,Math.min(.18,agePart+qualityPart));
    }
    const q=confidence===null?0:Math.max(0,Math.min(1,confidence));
    return Math.max(.05,Math.min(.22,.05+(1-q)*.17));
  }

  function expandCostBand(input={}){
    const central=finite(input.central),low=finite(input.low),high=finite(input.high);
    if(central===null||low===null||high===null)return {central,low,high,priceUncertainty:null};
    const u=priceUncertainty(input),baseLow=Math.min(low,central),baseHigh=Math.max(high,central);
    return {
      central,
      low:Math.max(0,Math.min(central,baseLow*(1-u))),
      high:Math.max(central,baseHigh*(1+u)),
      priceUncertainty:u
    };
  }

  function targetCostScenario(input={}){
    const targetEnergy=finite(input.targetEnergy),forecastEnergy=finite(input.forecastEnergy),fixed=finite(input.fixed),variableRate=finite(input.variableRate);
    if(targetEnergy===null||targetEnergy<0||forecastEnergy===null||forecastEnergy<0||fixed===null||variableRate===null)return null;
    const targetCost=fixed+variableRate*targetEnergy,forecastCost=fixed+variableRate*forecastEnergy;
    return {
      targetEnergy,forecastEnergy,targetCost,forecastCost,
      difference:forecastCost-targetCost,
      energyDifference:forecastEnergy-targetEnergy
    };
  }

  function financeSummary(inputs=[]){
    const rows=(Array.isArray(inputs)?inputs:[]).map(invoiceEconomics).filter(r=>r.invoiceTotal!==null&&r.energyKwh!==null&&r.energyKwh>0).sort((a,b)=>a.monthKey.localeCompare(b.monthKey));
    const totalInvoice=rows.reduce((s,r)=>s+r.invoiceTotal,0),totalEnergy=rows.reduce((s,r)=>s+r.energyKwh,0);
    const latest=rows.at(-1)||null,previous=rows.at(-2)||null;
    const validated=rows.filter(r=>r.tariffValid),latestTariff=validated.at(-1)||null,previousTariff=validated.at(-2)||null;
    return {
      rows,count:rows.length,totalInvoice,totalEnergy,
      weightedEffectivePrice:totalEnergy>0?totalInvoice/totalEnergy:null,
      latest,previous,latestTariff,previousTariff,
      latestEffectivePriceDelta:latest&&previous?latest.effectivePrice-previous.effectivePrice:null,
      latestEffectivePriceDeltaPct:latest&&previous&&previous.effectivePrice>0?(latest.effectivePrice-previous.effectivePrice)/previous.effectivePrice*100:null,
      bridge:previousTariff&&latestTariff?tariffBridge(previousTariff,latestTariff):null
    };
  }

  return {finite,monthIndex,tariffAgeMonths,invoiceEconomics,componentBreakdown,tariffBridge,priceUncertainty,expandCostBand,targetCostScenario,financeSummary};
});
