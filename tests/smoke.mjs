import fs from 'node:fs';
import assert from 'node:assert/strict';

const app=fs.readFileSync('app.js','utf8');
new Function(app);
new Function(fs.readFileSync('sw.js','utf8'));

const index=fs.readFileSync('index.html','utf8');
for(const id of ['backupDataBtn','restoreDataBtn','backupFileInput','exportBtn','fileInput','replaceModal','monthsList','heroDelta']){
  assert.ok(index.includes(`id="${id}"`), `Missing UI element #${id}`);
}

const start=app.indexOf('const PRAGUE_DTF');
const end=app.indexOf('function strictNumber',start);
assert.ok(start>=0&&end>start,'Time validation block not found');
const timeCode=app.slice(start,end);
const run=new Function(`const localStorage={getItem:()=>null}; const location={pathname:'/'}; const METRIC_KEY='metric'; ${timeCode}
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

console.log('Energo Přehled smoke tests OK');
