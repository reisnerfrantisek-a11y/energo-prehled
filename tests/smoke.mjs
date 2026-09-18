import fs from 'node:fs';
import assert from 'node:assert/strict';

const app=fs.readFileSync('app.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');

new Function(app);
new Function(sw);

for(const id of [
  'backupDataBtn','restoreDataBtn','backupFileInput','exportBtn','fileInput','replaceModal','monthsList','heroDelta',
  'periodNavigator','periodPrev','periodNext','periodAnchorLabel','anchorMonthInput','customPeriodControls','customFrom','customTo','heroCard','daypartSubtitle'
]){
  assert.ok(index.includes(`id="${id}"`), `Missing UI element #${id}`);
}
assert.ok(/id="fileInput"[^>]*\bmultiple\b/.test(index),'File input must support multiple files');
assert.ok(index.includes('data-period="custom"'),'Custom period option missing');
assert.ok(index.includes('data-daypart-mode="average"'),'Daypart average mode missing');
assert.ok(app.includes('async function handleFiles'),'Batch import handler missing');
assert.ok(app.includes("addEventListener('touchstart'"),'Swipe touchstart handler missing');
assert.ok(app.includes("addEventListener('touchend'"),'Swipe touchend handler missing');
assert.ok(app.includes("APP_VERSION = '1.2.0'"),'App version must be 1.2.0');

const start=app.indexOf('function parseCzTimestamp');
const end=app.indexOf('function strictNumber',start);
assert.ok(start>=0&&end>start,'Time validation block not found');
const timeCode=app.slice(start,end);
const run=new Function(`const PRAGUE_DTF=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}); ${timeCode}
const make=(y,m)=>{const a=[];for(const [stamp,n] of expectedTimestampCounts(y,m))for(let i=0;i<n;i++)a.push({sourceTimestamp:stamp});return a};
return { expectedTimestampCounts,validateMonthTimeline,make,parseCzTimestamp,pragueUtcCandidates };`)();

const sumExpected=(y,m)=>[...run.expectedTimestampCounts(y,m).values()].reduce((a,b)=>a+b,0);
assert.equal(sumExpected(2026,8),2976);
assert.equal(sumExpected(2026,3),2972);
assert.equal(sumExpected(2026,10),2980);
assert.equal(run.pragueUtcCandidates(run.parseCzTimestamp('29.03.2026 02:00:00')).length,0);
assert.equal(run.pragueUtcCandidates(run.parseCzTimestamp('25.10.2026 02:00:00')).length,2);

const aug=run.make(2026,8);
assert.equal(run.validateMonthTimeline(aug,2026,8).complete,true);
const missingDay=aug.filter(r=>!r.sourceTimestamp.startsWith('10.08.2026 '));
assert.equal(run.validateMonthTimeline(missingDay,2026,8).complete,false);
const duplicate=[...aug,{sourceTimestamp:'10.08.2026 10:00:00'}];
assert.equal(run.validateMonthTimeline(duplicate,2026,8).complete,false);
const oct=run.make(2026,10);
assert.equal(run.validateMonthTimeline(oct,2026,10).complete,true);

const mi=app.match(/function monthIndex\(k\)\{[^\n]+\}/)?.[0];
const mk=app.match(/function monthKeyFromIndex\(idx\)\{[^\n]+\}/)?.[0];
assert.ok(mi&&mk,'Month navigation helpers missing');
const monthRun=new Function(`${mi}\n${mk}\nreturn {monthIndex,monthKeyFromIndex};`)();
const augIndex=monthRun.monthIndex('2026-08');
assert.equal(monthRun.monthKeyFromIndex(augIndex),'2026-08');
assert.equal(monthRun.monthKeyFromIndex(augIndex-1),'2026-07');
assert.equal(monthRun.monthKeyFromIndex(augIndex+1),'2026-09');

console.log('Energo Přehled Beta 1.2 smoke tests OK');
