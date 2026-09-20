(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoPower=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function normalizeBreakerConfig(input={}){
    const phases=Number(input.phases)===1?1:3,amps=Number(input.amperes);
    return {phases,amperes:Number.isFinite(amps)&&amps>0&&amps<=250?amps:null};
  }

  function breakerReferenceKw(input={}){
    const cfg=normalizeBreakerConfig(input);if(!cfg.amperes)return null;
    return cfg.phases===3?Math.sqrt(3)*400*cfg.amperes/1000:230*cfg.amperes/1000;
  }

  function percentile(values,q){
    const a=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length)return null;if(a.length===1)return a[0];
    const p=(a.length-1)*Math.max(0,Math.min(1,Number(q))),lo=Math.floor(p),hi=Math.ceil(p);
    if(lo===hi)return a[lo];
    return a[lo]+(a[hi]-a[lo])*(p-lo);
  }

  function analyzePower(samples,config={},defaultMinutes=15){
    const rows=(Array.isArray(samples)?samples:[]).map(x=>{
      if(typeof x==='number')return {kw:x,minutes:defaultMinutes};
      return {kw:Number(x?.kw),minutes:Number(x?.minutes)||defaultMinutes};
    }).filter(x=>Number.isFinite(x.kw)&&x.kw>=0&&Number.isFinite(x.minutes)&&x.minutes>0);
    const values=rows.map(x=>x.kw),capacityKw=breakerReferenceKw(config),maxKw=values.length?Math.max(...values):null,p95Kw=percentile(values,.95),p99Kw=percentile(values,.99);
    if(!(capacityKw>0))return {count:rows.length,capacityKw:null,maxKw,p95Kw,p99Kw,maxUsagePct:null,headroomKw:null,above90Count:0,above100Count:0,bands:[]};
    const defs=[
      {id:'low',label:'0–25 %',min:0,max:.25},
      {id:'normal',label:'25–50 %',min:.25,max:.50},
      {id:'raised',label:'50–75 %',min:.50,max:.75},
      {id:'high',label:'75–90 %',min:.75,max:.90},
      {id:'near',label:'90–100 %',min:.90,max:1},
      {id:'over',label:'nad 100 %',min:1,max:Infinity}
    ];
    const totalMinutes=rows.reduce((s,r)=>s+r.minutes,0)||1,bands=defs.map(d=>{
      const matched=rows.filter(r=>{const u=r.kw/capacityKw;return u>=d.min&&u<d.max}),minutes=matched.reduce((s,r)=>s+r.minutes,0);
      return {...d,count:matched.length,minutes,hours:minutes/60,share:minutes/totalMinutes};
    });
    return {
      count:rows.length,capacityKw,maxKw,p95Kw,p99Kw,
      maxUsagePct:Number.isFinite(maxKw)?maxKw/capacityKw*100:null,
      headroomKw:Number.isFinite(maxKw)?capacityKw-maxKw:null,
      above90Count:rows.filter(r=>r.kw>=capacityKw*.9).length,
      above100Count:rows.filter(r=>r.kw>=capacityKw).length,
      bands
    };
  }

  return {normalizeBreakerConfig,breakerReferenceKw,percentile,analyzePower};
});
