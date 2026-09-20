(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoReport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
  function pctDelta(predicted,actual){
    const p=finite(predicted),a=finite(actual);
    return p!==null&&a!==null&&a>0?(p-a)/a*100:null;
  }

  function buildMonthlyReport(input={}){
    const rows=(Array.isArray(input.records)?input.records:[]).map(r=>({
      dateKey:String(r?.dateKey||''),
      timestamp:String(r?.timestamp||''),
      kw:finite(r?.kw),
      energy:finite(r?.energy)
    })).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.dateKey)&&r.kw!==null&&r.energy!==null&&r.energy>=0);
    const actualEnergy=rows.reduce((s,r)=>s+r.energy,0),daily=new Map();
    for(const r of rows)daily.set(r.dateKey,(daily.get(r.dateKey)||0)+r.energy);
    const peak=rows.length?rows.reduce((a,b)=>b.kw>a.kw?b:a,rows[0]):null;
    const strongest=[...daily].sort((a,b)=>b[1]-a[1])[0]||null;
    const invoice=finite(input.invoiceTotal),target=finite(input.targetKwh),snap=input.snapshot&&typeof input.snapshot==='object'?input.snapshot:null;
    const predictedEnergy=finite(snap?.predictedEnergy),predictedCost=finite(snap?.projectedCost),lowCost=finite(snap?.lowProjectedCost),highCost=finite(snap?.highProjectedCost);
    const energyError=predictedEnergy===null?null:predictedEnergy-actualEnergy,energyErrorPct=pctDelta(predictedEnergy,actualEnergy);
    const costError=predictedCost!==null&&invoice!==null?predictedCost-invoice:null,costErrorPct=pctDelta(predictedCost,invoice);
    const costInsideBand=invoice!==null&&lowCost!==null&&highCost!==null?invoice>=lowCost&&invoice<=highCost:null;
    return {
      intervalCount:rows.length,dayCount:daily.size,actualEnergy,
      peakKw:peak?.kw??null,peakTimestamp:peak?.timestamp||null,
      strongestDay:strongest?{dateKey:strongest[0],energy:strongest[1]}:null,
      invoiceTotal:invoice,effectivePrice:invoice!==null&&actualEnergy>0?invoice/actualEnergy:null,
      targetKwh:target,targetDelta:target!==null?actualEnergy-target:null,targetDeltaPct:target!==null&&target>0?(actualEnergy-target)/target*100:null,
      snapshot:snap?{asOfDate:snap.asOfDate||null,daysRemaining:finite(snap.daysRemaining),predictedEnergy,predictedCost,lowCost,highCost}:null,
      predictedEnergy,energyError,energyErrorPct,predictedCost,costError,costErrorPct,costInsideBand
    };
  }

  return {finite,pctDelta,buildMonthlyReport};
});
