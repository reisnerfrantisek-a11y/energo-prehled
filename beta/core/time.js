(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoTime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const PRAGUE_DTF=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

  function parseCzTimestamp(s){
    const m=String(s).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if(!m)return null;
    const [,dd,mm,yyyy,hh,mi,ss='00']=m;
    return {year:+yyyy,month:+mm,day:+dd,hour:+hh,minute:+mi,second:+ss,dateKey:`${yyyy}-${mm}-${dd}`,monthKey:`${yyyy}-${mm}`,display:`${dd}.${mm}.${yyyy} ${hh}:${mi}`,source:String(s).trim()};
  }

  function weekdayMon(ts){
    const d=new Date(Date.UTC(ts.year,ts.month-1,ts.day)).getUTCDay();
    return d===0?6:d-1;
  }

  function pragueParts(ms){
    const out={};
    for(const p of PRAGUE_DTF.formatToParts(new Date(ms)))if(p.type!=='literal')out[p.type]=Number(p.value);
    return out;
  }

  function pragueUtcCandidates(ts){
    if(!ts)return [];
    const base=Date.UTC(ts.year,ts.month-1,ts.day,ts.hour,ts.minute,ts.second||0),found=[];
    for(const offset of [0,60,120,180]){
      const ms=base-offset*60000,p=pragueParts(ms);
      if(p.year===ts.year&&p.month===ts.month&&p.day===ts.day&&p.hour===ts.hour&&p.minute===ts.minute&&p.second===(ts.second||0))found.push(ms);
    }
    return [...new Set(found)].sort((a,b)=>a-b);
  }

  function sourceStamp(y,m,d,h,mi){
    return `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.${y} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00`;
  }

  function expectedTimestampCounts(year,month,intervalMinutes=15){
    const out=new Map(),days=new Date(Date.UTC(year,month,0)).getUTCDate();
    for(let d=1;d<=days;d++)for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=intervalMinutes){
      const source=sourceStamp(year,month,d,h,mi),ts=parseCzTimestamp(source),count=pragueUtcCandidates(ts).length;
      if(count)out.set(source,count);
    }
    return out;
  }

  function expectedIntervalsForDate(dateKey,intervalMinutes=15){
    const [y,m,d]=String(dateKey).split('-').map(Number);
    if(!Number.isFinite(y)||!Number.isFinite(m)||!Number.isFinite(d))return 0;
    let count=0;
    for(let h=0;h<24;h++)for(let mi=0;mi<60;mi+=intervalMinutes){
      count+=pragueUtcCandidates(parseCzTimestamp(sourceStamp(y,m,d,h,mi))).length;
    }
    return count;
  }

  return {PRAGUE_DTF,parseCzTimestamp,weekdayMon,pragueParts,pragueUtcCandidates,sourceStamp,expectedTimestampCounts,expectedIntervalsForDate};
});
