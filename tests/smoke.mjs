import fs from 'node:fs';
import assert from 'node:assert/strict';

const app=fs.readFileSync('app.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');

new Function(app);
new Function(sw);

for(const id of [
  'backupDataBtn','restoreDataBtn','backupFileInput','exportBtn','fileInput','replaceModal','monthsList','heroDelta',
  'periodNavigator','periodPrev','periodNext','periodAnchorLabel','anchorMonthInput','customPeriodControls','customFrom','customTo','heroCard','daypartSubtitle','dashboardModeToggle','heroUnit','metricToggle','effectivePricePanel','effectivePriceChart','forceUpdateBtn','appVersionText'
]){
  assert.ok(index.includes(`id="${id}"`), `Missing UI element #${id}`);
}
assert.ok(/id="fileInput"[^>]*\bmultiple\b/.test(index),'File input must support multiple files');
assert.ok(index.includes('data-period="custom"'),'Custom period option missing');
assert.ok(index.includes('data-daypart-mode="average"'),'Daypart average mode missing');
assert.ok(app.includes('async function handleFiles'),'Batch import handler missing');
assert.ok(app.includes("addEventListener('touchstart'"),'Swipe touchstart handler missing');
assert.ok(app.includes("addEventListener('touchend'"),'Swipe touchend handler missing');
assert.ok(app.includes("APP_VERSION = '1.3.2'"),'App version must be 1.3.2');

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
assert.ok(app.includes("const jump=state.period==='year'?12:1"),'3-month navigation must slide by one month');
assert.ok(app.includes('data-month-toggle'),'Month enable/disable control missing');
assert.ok(app.includes('async function setMonthEnabled'),'Month enable/disable persistence missing');
assert.ok(app.includes('async function setMonthInvoice'),'Invoice persistence missing');
assert.ok(app.includes('data-month-invoice'),'Invoice input missing');
assert.ok(app.includes('function costForRecords'),'Cost allocation missing');
assert.ok(app.includes("data-dashboard-mode=\"cost\"")||index.includes('data-dashboard-mode="cost"'),'Cost dashboard mode missing');
assert.ok(app.includes("unit:'Kč/kWh'"),'Effective price chart unit missing');
assert.ok(app.includes("$('.dashboard-mode-btn').forEach"),'Dashboard mode must bind all toggle buttons');
assert.ok(app.includes("$('.metric-btn').forEach"),'Metric mode must bind all toggle buttons');
assert.ok(!app.includes("\n  $('.dashboard-mode-btn').forEach"),'Dashboard mode incorrectly uses single-element selector');
assert.ok(!app.includes("\n  $('.metric-btn').forEach"),'Metric mode incorrectly uses single-element selector');
assert.ok(app.includes('async function forceUpdateApp'),'Safe force-update function missing');
assert.ok(app.includes("k.startsWith('energo-prehled-beta-')"),'Force update must target beta cache only');
assert.ok(!app.includes('indexedDB.deleteDatabase'),'Force update must not delete IndexedDB');
assert.ok(!app.includes('localStorage.clear()'),'Force update must not clear localStorage');
assert.ok(index.includes('app.js?v=1.3.2'),'App script must be cache-busted');
assert.ok(index.includes('styles.css?v=1.3.2'),'Stylesheet must be cache-busted');
const refresh=fs.readFileSync('refresh.html','utf8');
assert.ok(refresh.includes("energo-prehled-beta-"),'Recovery page must clear beta cache');
assert.ok(!refresh.includes('indexedDB.deleteDatabase'),'Recovery page must preserve IndexedDB');
assert.ok(!refresh.includes('localStorage.clear()'),'Recovery page must preserve localStorage');

const analyticsStart=app.indexOf('const val = r =>');
const analyticsEnd=app.indexOf('// ---------- SVG charts ----------',analyticsStart);
assert.ok(analyticsStart>=0&&analyticsEnd>analyticsStart,'Analytics block not found');
const analyticsCode=app.slice(analyticsStart,analyticsEnd);
const periodTest=new Function(`
const MONTH_NAMES=['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const localStorage={setItem:()=>{}};
const PERIOD_KEY='period',ANCHOR_KEY='anchor',CUSTOM_FROM_KEY='from',CUSTOM_TO_KEY='to';
const normalizeFinance=f=>({invoiceTotal:f?.invoiceTotal===null||f?.invoiceTotal===undefined?null:Number(f.invoiceTotal),components:f?.components||{}});
const renderPeriodControls=()=>{},renderOverview=()=>{},renderAnalysis=()=>{};
const state={metric:'dcc1',period:'month',anchorMonth:'2026-08',customFrom:'2026-07-01',customTo:'2026-08-31',records:[
{id:'jun',sortKey:1,monthKey:'2026-06',dateKey:'2026-06-01',year:2026,month:6,dcc1:4,intervalMinutes:15},
{id:'jul',sortKey:2,monthKey:'2026-07',dateKey:'2026-07-01',year:2026,month:7,dcc1:4,intervalMinutes:15},
{id:'aug',sortKey:3,monthKey:'2026-08',dateKey:'2026-08-01',year:2026,month:8,dcc1:4,intervalMinutes:15}
],months:[
{monthKey:'2026-06',complete:true,finance:{invoiceTotal:100}},{monthKey:'2026-07',complete:true,finance:{invoiceTotal:200}},{monthKey:'2026-08',complete:true,finance:{invoiceTotal:300}}
]};
${analyticsCode}
return {state,currentRange,expectedCurrentMonthKeys,selectedPeriodLabel,costForRecords,monthEffectivePrice};
`)();
periodTest.state.period='month';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-08']);
periodTest.state.period='3m';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-06','2026-07','2026-08']);
assert.deepEqual(periodTest.expectedCurrentMonthKeys(),['2026-06','2026-07','2026-08']);
periodTest.state.period='year';
assert.equal(periodTest.currentRange().length,3);
assert.equal(periodTest.selectedPeriodLabel(),'2026');
periodTest.state.period='custom';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-07','2026-08']);
periodTest.state.period='all';
assert.equal(periodTest.currentRange().length,3);
const fullCosts=periodTest.costForRecords(periodTest.currentRange());
assert.equal(fullCosts.total,600);
assert.equal(fullCosts.coveredEnergy,3);
assert.equal(periodTest.monthEffectivePrice('2026-08'),300);
periodTest.state.months.find(m=>m.monthKey==='2026-07').enabled=false;
periodTest.state.period='3m';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-06','2026-08']);
periodTest.state.period='custom';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-08']);
periodTest.state.period='all';
assert.equal(periodTest.currentRange().length,2);
periodTest.state.months.forEach(m=>m.enabled=false);
assert.equal(periodTest.currentRange().length,0);

console.log('Energo Přehled Beta 1.3.2 smoke tests OK');
