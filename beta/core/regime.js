(function(root,factory){
  const Core=typeof module==='object'&&module.exports?require('./model.js'):root.EnergoCore;
  const api=factory(Core);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoRegime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
  'use strict';

  const clamp=Core.clamp,median=Core.median,robustMeanStats=Core.robustMeanStats;
  const PARTS=['night','morning','day','evening','late'];

  function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
  function robustCenter(values){
    const r=robustMeanStats(values,{z:3.5,minCount:5});
    return Number.isFinite(r.value)?r.value:null;
  }
  function baselineFor(days,weekday,field){
    const same=days.filter(d=>d.weekday===weekday).map(d=>field(d)).filter(Number.isFinite);
    if(same.length>=3)return robustCenter(same);
    return robustCenter(days.map(d=>field(d)).filter(Number.isFinite));
  }
  function buildExpectations(baseline,recent,field){
    return recent.map(d=>{
      const expected=baselineFor(baseline,d.weekday,field),actual=field(d);
      return {day:d,actual,expected,delta:Number.isFinite(actual)&&Number.isFinite(expected)?actual-expected:null};
    }).filter(x=>Number.isFinite(x.actual)&&Number.isFinite(x.expected));
  }
  function pct(actual,expected){
    return Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(expected)>1e-9?(actual-expected)/expected:null;
  }
  function residualNoise(baseline){
    const residuals=[];
    for(const d of baseline){
      const pool=baseline.filter(x=>x.dateKey!==d.dateKey);
      const expected=baselineFor(pool,d.weekday,x=>finite(x.energy));
      if(Number.isFinite(expected)&&expected>.05)residuals.push(Math.abs((d.energy-expected)/expected));
    }
    return residuals.length>=5?(median(residuals)||0):null;
  }
  function summarizeWindow(baseline,recent,thresholdPct,absoluteMin){
    const rows=buildExpectations(baseline,recent,d=>finite(d.energy));
    const actual=rows.reduce((a,x)=>a+x.actual,0),expected=rows.reduce((a,x)=>a+x.expected,0);
    const changePct=pct(actual,expected),direction=changePct===null||Math.abs(changePct)<1e-9?'stable':changePct>0?'higher':'lower';
    let matching=0,opposite=0,neutral=0;
    for(const row of rows){
      const threshold=Math.max(absoluteMin,Math.abs(row.expected)*thresholdPct),delta=row.delta||0;
      if(Math.abs(delta)<threshold){neutral++;continue}
      const dir=delta>0?'higher':'lower';
      if(dir===direction)matching++;else opposite++;
    }
    return {
      days:rows.length,actual,expected,changePct,direction,matching,opposite,neutral,
      consistency:rows.length?matching/rows.length:0,
      rows
    };
  }
  function partShift(baseline,recent){
    let best=null;
    for(const key of PARTS){
      const rows=buildExpectations(baseline,recent,d=>finite(d.parts?.[key]));
      if(!rows.length)continue;
      const actual=rows.reduce((a,x)=>a+x.actual,0)/rows.length,expected=rows.reduce((a,x)=>a+x.expected,0)/rows.length;
      const delta=actual-expected,changePct=pct(actual,expected);
      const item={key,actual,expected,delta,changePct,days:rows.length};
      if(!best||Math.abs(item.delta)>Math.abs(best.delta))best=item;
    }
    return best;
  }
  function detectRegimeShift(days,options={}){
    const sorted=(Array.isArray(days)?days:[])
      .filter(d=>d&&typeof d.dateKey==='string'&&Number.isFinite(Number(d.energy))&&Number.isInteger(Number(d.weekday)))
      .map(d=>({...d,energy:Number(d.energy),weekday:Number(d.weekday)}))
      .sort((a,b)=>a.dateKey.localeCompare(b.dateKey));
    const minBaseline=Math.max(14,Number(options.minBaselineDays)||21),baselineMax=Math.max(minBaseline,Number(options.baselineMaxDays)||56);
    const recentWindow=Math.max(5,Number(options.recentWindow)||7),confirmWindow=Math.max(recentWindow,Number(options.confirmWindow)||14);
    const absoluteMin=Math.max(.05,Number(options.absoluteMinKwh)||.15);
    if(sorted.length<minBaseline+recentWindow){
      return {status:'insufficient',direction:'stable',confidence:'low',confidenceScore:0,strength:0,reason:'not-enough-history',availableDays:sorted.length,requiredDays:minBaseline+recentWindow};
    }

    const recent7=sorted.slice(-recentWindow),baselineEnd=Math.max(0,sorted.length-recentWindow),baseline=sorted.slice(Math.max(0,baselineEnd-baselineMax),baselineEnd);
    if(baseline.length<minBaseline){
      return {status:'insufficient',direction:'stable',confidence:'low',confidenceScore:0,strength:0,reason:'not-enough-baseline',availableDays:baseline.length,requiredDays:minBaseline};
    }
    const noise=residualNoise(baseline),thresholdPct=clamp(Math.max(.15,Number.isFinite(noise)?noise*2.5:.18),.15,.45);
    const short=summarizeWindow(baseline,recent7,thresholdPct,absoluteMin);

    const confirmDays=Math.min(confirmWindow,Math.max(recentWindow,sorted.length-minBaseline));
    const recent14=sorted.slice(-confirmDays);
    const baseline14End=Math.max(0,sorted.length-recent14.length);
    const baseline14=sorted.slice(Math.max(0,baseline14End-baselineMax),baseline14End);
    const long=baseline14.length>=minBaseline?summarizeWindow(baseline14,recent14,thresholdPct,absoluteMin):null;

    const minShortMatches=Math.ceil(short.days*.70),directional=short.direction!=='stable'&&short.matching>=minShortMatches;
    const absoluteShift=Math.abs(short.actual-short.expected),meaningful=Number.isFinite(short.changePct)&&Math.abs(short.changePct)>=thresholdPct&&absoluteShift>=absoluteMin*short.days;
    const candidate=directional&&meaningful;
    const longSupports=!!(long&&long.direction===short.direction&&Math.abs(long.changePct||0)>=thresholdPct*.70&&long.consistency>=.60);
    let status=candidate?(longSupports?'changed':'candidate'):'stable';

    const magnitude=Number.isFinite(short.changePct)?clamp((Math.abs(short.changePct)-thresholdPct)/(Math.max(.12,thresholdPct))+0.45,0,1):0;
    const history=clamp(baseline.length/42,0,1),consistency=clamp(short.consistency,0,1),confirmation=longSupports?1:.35;
    const confidenceScore=(status==='changed'||status==='candidate')?clamp(.30*history+.35*consistency+.20*magnitude+.15*confirmation,0,1):clamp(.50*history+.50*(1-Math.abs(short.changePct||0)/Math.max(thresholdPct,1e-9)),0,1);
    const confidence=confidenceScore>=.78?'high':confidenceScore>=.55?'medium':'low';
    const strength=status==='changed'?clamp((confidenceScore-.35)/.65,0,1):0;

    const dominantPart=partShift(baseline,recent7);
    return {
      status,direction:(status==='changed'||status==='candidate')?short.direction:'stable',confidence,confidenceScore,strength,
      recent:{from:recent7[0]?.dateKey||'',to:recent7.at(-1)?.dateKey||'',days:short.days,changePct:short.changePct,actual:short.actual,expected:short.expected,matchingDays:short.matching,neutralDays:short.neutral,oppositeDays:short.opposite},
      confirmation:long?{from:recent14[0]?.dateKey||'',to:recent14.at(-1)?.dateKey||'',days:long.days,changePct:long.changePct,matchingDays:long.matching,supports:longSupports}:null,
      baseline:{from:baseline[0]?.dateKey||'',to:baseline.at(-1)?.dateKey||'',days:baseline.length,noisePct:noise,thresholdPct},
      dominantPart,
      settings:{absoluteMinKwh:absoluteMin,minBaselineDays:minBaseline}
    };
  }

  function adaptEnsembleWeights(weights,strength){
    const s=clamp(Number(strength)||0,0,1),src=weights&&typeof weights==='object'?weights:{};
    const adjusted={
      weekday:(Number(src.weekday)||0)*(1-.45*s),
      recent7:(Number(src.recent7)||0)*(1+1.10*s),
      recent14:(Number(src.recent14)||0)*(1+.70*s),
      pace:(Number(src.pace)||0)*(1+.35*s)
    };
    const total=Object.values(adjusted).reduce((a,b)=>a+b,0);
    if(!(total>0))return {...src};
    for(const k of Object.keys(adjusted))adjusted[k]/=total;
    return adjusted;
  }

  function reblendForecast(components,weights){
    const list=(Array.isArray(components)?components:[]).filter(c=>Number.isFinite(Number(c.value)));
    let total=0,weight=0;
    for(const c of list){const w=Number(weights?.[c.key])||0;if(w<=0)continue;total+=Number(c.value)*w;weight+=w}
    return weight>0?total/weight:null;
  }

  return {detectRegimeShift,adaptEnsembleWeights,reblendForecast};
});
