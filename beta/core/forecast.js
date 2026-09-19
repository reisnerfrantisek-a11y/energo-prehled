(function(root,factory){
  let core;
  if(typeof module==='object'&&module.exports)core=require('./model.js');
  else core=root.EnergoCore;
  const api=factory(core);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoForecast=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
  'use strict';
  if(!Core)throw new Error('EnergoCore is required.');

  function allocateRemaining(estimate,weights){
    const actual=Number(estimate?.actualEnergy)||0;
    const central=Math.max(0,(Number(estimate?.predictedEnergy)||0)-actual);
    const low=Math.max(0,(Number(estimate?.lowEnergy)||actual)-actual);
    const high=Math.max(0,(Number(estimate?.highEnergy)||actual)-actual);
    return {
      central:Core.distributeTotal(central,weights),
      low:Core.distributeTotal(low,weights),
      high:Core.distributeTotal(high,weights)
    };
  }

  function toCumulative(data){
    let value=0,low=0,high=0;
    return (Array.isArray(data)?data:[]).map(d=>{
      if(d?.kind==='missing'||!Number.isFinite(Number(d?.value)))return {...d,value:null,low:null,high:null};
      value+=Number(d.value)||0;
      low+=Number.isFinite(Number(d.low))?Number(d.low):Number(d.value)||0;
      high+=Number.isFinite(Number(d.high))?Number(d.high):Number(d.value)||0;
      return {...d,value,low,high};
    });
  }

  function cumulativeNullable(values){
    let acc=0;
    return (Array.isArray(values)?values:[]).map(v=>{
      if(v===null||v===undefined||!Number.isFinite(Number(v)))return null;
      acc+=Number(v)||0;
      return acc;
    });
  }

  function weightedMean(items){
    const rows=(Array.isArray(items)?items:[]).filter(x=>Number.isFinite(Number(x?.value))&&Number(x?.weight)>0);
    const w=rows.reduce((a,x)=>a+Number(x.weight),0);if(!(w>0))return null;
    return rows.reduce((a,x)=>a+Number(x.value)*Number(x.weight),0)/w;
  }

  function ensembleMonthForecast(input={}){
    const observedDays=Math.max(0,Number(input.observedDays)||0),historyMonths=Math.max(0,Number(input.historyMonths)||0);
    const components=[
      {key:'weekday',label:'historie dnů v týdnu',value:Number(input.weekdayProjection),weight:.40*Math.min(1,historyMonths/3)},
      {key:'recent7',label:'posledních 7 dní',value:Number(input.recent7Projection),weight:.25*Math.min(1,observedDays/7)},
      {key:'recent14',label:'posledních 14 dní',value:Number(input.recent14Projection),weight:.20*Math.min(1,observedDays/14)},
      {key:'pace',label:'průběžné tempo',value:Number(input.paceProjection),weight:.15*Math.min(1,observedDays/5)}
    ].filter(x=>Number.isFinite(x.value)&&x.value>=0&&x.weight>0);
    if(!components.length){
      const fallback=Number(input.fallback);
      return {value:Number.isFinite(fallback)?Math.max(0,fallback):0,components:[],weights:{},model:'fallback'};
    }
    const value=weightedMean(components),sumW=components.reduce((a,x)=>a+x.weight,0),weights={};
    for(const c of components)weights[c.key]=c.weight/sumW;
    return {value:Math.max(0,value),components,weights,model:'ensemble-v2'};
  }

  function quantile(values,q=.8){
    const a=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length)return null;if(a.length===1)return a[0];
    const pos=(a.length-1)*Math.max(0,Math.min(1,q)),lo=Math.floor(pos),hi=Math.ceil(pos);
    if(lo===hi)return a[lo];
    return a[lo]+(a[hi]-a[lo])*(pos-lo);
  }

  function calibrateUncertainty(input={}){
    const fallback=Math.max(.04,Math.min(.50,Number(input.fallback)||.15));
    const errors=(Array.isArray(input.absolutePctErrors)?input.absolutePctErrors:[]).map(Number).filter(x=>Number.isFinite(x)&&x>=0).map(x=>x/100);
    if(errors.length<2)return {uncertainty:fallback,source:'heuristic',sampleCount:errors.length,empirical:null};
    const empirical=Math.max(quantile(errors,.80)||0,quantile(errors,.50)||0);
    const reliability=Math.min(1,errors.length/6);
    const calibrated=Math.max(.06,Math.min(.50,empirical*1.10));
    return {uncertainty:fallback*(1-reliability)+calibrated*reliability,source:'backtest',sampleCount:errors.length,empirical};
  }

  function forecastBandTotals(data){
    const rows=(Array.isArray(data)?data:[]).filter(d=>d?.kind==='forecast');
    return {
      central:Core.sumFinite(rows.map(d=>d.value)),
      low:Core.sumFinite(rows.map(d=>d.low)),
      high:Core.sumFinite(rows.map(d=>d.high))
    };
  }

  return {allocateRemaining,toCumulative,cumulativeNullable,weightedMean,ensembleMonthForecast,quantile,calibrateUncertainty,forecastBandTotals};
});
