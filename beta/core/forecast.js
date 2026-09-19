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

  function forecastBandTotals(data){
    const rows=(Array.isArray(data)?data:[]).filter(d=>d?.kind==='forecast');
    return {
      central:Core.sumFinite(rows.map(d=>d.value)),
      low:Core.sumFinite(rows.map(d=>d.low)),
      high:Core.sumFinite(rows.map(d=>d.high))
    };
  }

  return {allocateRemaining,toCumulative,cumulativeNullable,forecastBandTotals};
});
