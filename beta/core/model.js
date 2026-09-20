(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function median(values){
    const a=(Array.isArray(values)?values:[]).filter(Number.isFinite).slice().sort((x,y)=>x-y);
    if(!a.length)return null;
    const m=Math.floor(a.length/2);
    return a.length%2?a[m]:(a[m-1]+a[m])/2;
  }

  function mean(values){
    const a=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite);
    return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  }

  function quantile(values,q=.5){
    const a=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length)return null;if(a.length===1)return a[0];
    const pos=(a.length-1)*clamp(Number(q)||0,0,1),lo=Math.floor(pos),hi=Math.ceil(pos);
    return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
  }

  function robustMeanStats(values,{z=3.5,minCount=5}={}){
    const a=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite);
    if(!a.length)return {value:null,rawMean:null,median:null,mad:null,lower:null,upper:null,affected:0,count:0,robust:false};
    const rawMean=mean(a),med=median(a);
    if(a.length<Math.max(3,Number(minCount)||5))return {value:rawMean,rawMean,median:med,mad:null,lower:null,upper:null,affected:0,count:a.length,robust:false};
    const deviations=a.map(v=>Math.abs(v-med)),mad=median(deviations)||0;
    let lower,upper;
    if(mad>1e-12){
      const sigma=1.4826*mad,span=Math.max(0.1,Number(z)||3.5)*sigma;
      lower=med-span;upper=med+span;
    }else{
      const q1=quantile(a,.25),q3=quantile(a,.75),iqr=(q3??0)-(q1??0);
      if(iqr>1e-12){lower=q1-1.5*iqr;upper=q3+1.5*iqr}
      else{lower=med;upper=med}
    }
    const bounded=a.map(v=>clamp(v,lower,upper)),affected=a.reduce((n,v)=>n+(v<lower||v>upper?1:0),0);
    return {value:mean(bounded),rawMean,median:med,mad,lower,upper,affected,count:a.length,robust:true};
  }

  function weekdayFromDateKey(key){
    const [y,m,d]=String(key).split('-').map(Number),wd=new Date(Date.UTC(y,m-1,d)).getUTCDay();
    return wd===0?6:wd-1;
  }

  function monthDateKeys(monthKey){
    const [y,m]=String(monthKey).split('-').map(Number);
    if(!Number.isFinite(y)||!Number.isFinite(m)||m<1||m>12)return [];
    const days=new Date(Date.UTC(y,m,0)).getUTCDate();
    return Array.from({length:days},(_,i)=>`${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);
  }

  function apiValueToKw(value,units,intervalMinutes=15){
    const n=Number(value);if(!Number.isFinite(n))return null;
    const u=String(units||'').toUpperCase().replace(/\s+/g,'');
    if(u==='KW')return n;if(u==='W')return n/1000;if(u==='MW')return n*1000;
    const hours=intervalMinutes/60;
    if(!(hours>0))return null;
    if(u==='KWH')return n/hours;if(u==='WH')return n/1000/hours;if(u==='MWH')return n*1000/hours;
    throw new Error(`Nepodporovaná jednotka: ${units||'neuvedena'}.`);
  }

  function apiValueFromKw(kw,units,intervalMinutes=15){
    const n=Number(kw);if(!Number.isFinite(n))return null;
    const u=String(units||'').toUpperCase().replace(/\s+/g,''),hours=intervalMinutes/60;
    if(u==='KW')return n;if(u==='W')return n*1000;if(u==='MW')return n/1000;
    if(!(hours>0))return null;
    if(u==='KWH')return n*hours;if(u==='WH')return n*1000*hours;if(u==='MWH')return n*hours/1000;
    return null;
  }

  function weightedCostModel(points){
    points=Array.isArray(points)?points:[];
    if(!points.length)return {fixed:0,variableRate:null,fallbackRate:null,r2:0,spreadRatio:1,confidence:0,blend:0,count:0,totalCost:0,totalEnergy:0,weightedCost:0,weightedEnergy:0};
    const sw=points.reduce((a,p)=>a+p.weight,0),sx=points.reduce((a,p)=>a+p.weight*p.energy,0),sy=points.reduce((a,p)=>a+p.weight*p.cost,0);
    const sxx=points.reduce((a,p)=>a+p.weight*p.energy*p.energy,0),sxy=points.reduce((a,p)=>a+p.weight*p.energy*p.cost,0);
    const weightedEnergy=sx,weightedCost=sy,fallbackRate=weightedEnergy>0?weightedCost/weightedEnergy:null;
    let fixed=0,variableRate=fallbackRate;
    if(points.length>=2){
      const den=sw*sxx-sx*sx,candidates=[];
      if(Math.abs(den)>1e-9){
        const v=(sw*sxy-sx*sy)/den,F=(sy-v*sx)/sw;
        if(F>=0&&v>=0)candidates.push({fixed:F,variableRate:v});
      }
      const v0=sxx>0?sxy/sxx:0;if(v0>=0)candidates.push({fixed:0,variableRate:v0});
      const F0=sy/sw;if(F0>=0)candidates.push({fixed:F0,variableRate:0});
      const score=c=>points.reduce((sum,p)=>{const e=p.cost-(c.fixed+c.variableRate*p.energy);return sum+p.weight*e*e},0);
      if(candidates.length){candidates.sort((a,b)=>score(a)-score(b));({fixed,variableRate}=candidates[0])}
    }
    const mean=sy/sw,sse=points.reduce((sum,p)=>{const e=p.cost-(fixed+variableRate*p.energy);return sum+p.weight*e*e},0);
    const sst=points.reduce((sum,p)=>sum+p.weight*(p.cost-mean)**2,0),r2=sst>1e-9?clamp(1-sse/sst,0,1):0;
    const energies=points.map(p=>p.energy),minE=Math.min(...energies),maxE=Math.max(...energies),spreadRatio=minE>0?maxE/minE:1;
    const spreadScore=clamp((spreadRatio-1)/0.5,0,1),fitScore=clamp((r2-0.2)/0.8,0,1),countScore=points.length>=3?1:points.length===2?.35:0;
    const confidence=spreadScore*fitScore*countScore,blend=points.length<2?0:clamp(confidence,0,1);
    return {fixed,variableRate,fallbackRate,r2,spreadRatio,confidence,blend,count:points.length,totalCost:points.reduce((a,p)=>a+p.cost,0),totalEnergy:points.reduce((a,p)=>a+p.energy,0),weightedCost,weightedEnergy};
  }

  function modeledRateAtEnergy(model,energy){
    if(!model||!Number.isFinite(energy)||energy<=0)return null;
    const dynamic=Number.isFinite(model.variableRate)?model.variableRate+(Number(model.fixed)||0)/energy:null;
    if(!Number.isFinite(dynamic))return model.fallbackRate;
    if(!Number.isFinite(model.fallbackRate))return dynamic;
    return model.blend*dynamic+(1-model.blend)*model.fallbackRate;
  }

  function distributeTotal(total,weights){
    const list=(Array.isArray(weights)?weights:[]).map(v=>Math.max(0,Number(v)||0));
    if(!list.length)return [];
    const sum=list.reduce((a,b)=>a+b,0);
    if(!(sum>0))return list.map(()=>Number(total||0)/list.length);
    return list.map(v=>Number(total||0)*v/sum);
  }

  function cumulativeSeries(values,start=0){
    let acc=Number(start)||0;
    return (Array.isArray(values)?values:[]).map(v=>(acc+=Number(v)||0));
  }

  function alignByDay(source,currentLength){
    const out=Array.from({length:Math.max(0,Number(currentLength)||0)},()=>null);
    if(!Array.isArray(source))return out;
    for(let i=0;i<out.length&&i<source.length;i++){
      const v=Number(source[i]);
      out[i]=Number.isFinite(v)?v:null;
    }
    return out;
  }

  function sumFinite(values){return (Array.isArray(values)?values:[]).reduce((a,v)=>a+(Number.isFinite(Number(v))?Number(v):0),0)}

  return {
    clamp,median,mean,quantile,robustMeanStats,weekdayFromDateKey,monthDateKeys,
    apiValueToKw,apiValueFromKw,weightedCostModel,modeledRateAtEnergy,
    distributeTotal,cumulativeSeries,alignByDay,sumFinite
  };
});
