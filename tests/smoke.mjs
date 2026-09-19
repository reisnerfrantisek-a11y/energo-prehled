import fs from 'node:fs';
import assert from 'node:assert/strict';

const app=fs.readFileSync('app.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');

new Function(app);
new Function(sw);

for(const id of [
  'backupDataBtn','restoreDataBtn','backupFileInput','exportBtn','fileInput','replaceModal','monthsList','heroDelta',
  'periodNavigator','periodPrev','periodNext','periodAnchorLabel','anchorMonthInput','customPeriodControls','customFrom','customTo','heroCard','daypartSubtitle','dashboardModeToggle','heroUnit','metricToggle','effectivePricePanel','effectivePriceChart','forceUpdateBtn','appVersionText','egdPanel','egdStatus','egdClientId','egdClientSecret','egdProxyUrl','egdAutoSync','egdConfig','egdEanSelect','egdProfileSelect','egdTestBtn','egdSyncBtn','egdDisconnectBtn','egdResult','forecastPanel','forecastTitle','forecastMeta','forecastChart','anomalySummary','anomalyList','forecastAccuracySummary','forecastAccuracyList'
]){
  assert.ok(index.includes(`id="${id}"`), `Missing UI element #${id}`);
}
assert.ok(/id="fileInput"[^>]*\bmultiple\b/.test(index),'File input must support multiple files');
assert.ok(index.includes('data-period="custom"'),'Custom period option missing');
assert.ok(index.includes('data-daypart-mode="average"'),'Daypart average mode missing');
assert.ok(app.includes('async function handleFiles'),'Batch import handler missing');
assert.ok(app.includes("addEventListener('touchstart'"),'Swipe touchstart handler missing');
assert.ok(app.includes("addEventListener('touchend'"),'Swipe touchend handler missing');
assert.ok(app.includes("APP_VERSION = '1.5.0'"),'App version must be 1.5.0');

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

const apiStart=app.indexOf('function apiValueToKw');
const apiEnd=app.indexOf('function pragueMonthQueryBounds',apiStart);
assert.ok(apiStart>=0&&apiEnd>apiStart,'API unit conversion block not found');
const apiUnitCode=app.slice(apiStart,apiEnd);
const apiRun=new Function(`${apiUnitCode}; return {apiValueToKw};`)();
assert.equal(apiRun.apiValueToKw(2,'KW'),2);
assert.equal(apiRun.apiValueToKw(1000,'W'),1);
assert.equal(apiRun.apiValueToKw(1,'KWH'),4);
assert.equal(apiRun.apiValueToKw(250,'WH'),1);

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
assert.ok(app.includes('class="chart-x-label"'),'Readable chart x-axis label class missing');
assert.ok(app.includes("p={l:64,r:14,t:30,b:38}"),'Line chart spacing was not enlarged for labels');
const styles=fs.readFileSync('styles.css','utf8');
assert.ok(styles.includes('.chart-y-label{font-size:13px'),'Chart y-axis labels must be enlarged');
assert.ok(styles.includes('.chart-x-label{font-size:13px'),'Chart x-axis labels must be enlarged');
assert.ok(styles.includes('.chart-value-label{font-size:14px'),'Chart value labels must be enlarged');
assert.ok(styles.includes('.forecast-panel{'),'Forecast panel styles missing');
assert.ok(styles.includes('.anomaly-row,.accuracy-row{'),'Intelligence panel row styles missing');
assert.ok(app.includes("$('.dashboard-mode-btn').forEach"),'Dashboard mode must bind all toggle buttons');
assert.ok(app.includes("$('.metric-btn').forEach"),'Metric mode must bind all toggle buttons');
assert.ok(!app.includes("\n  $('.dashboard-mode-btn').forEach"),'Dashboard mode incorrectly uses single-element selector');
assert.ok(!app.includes("\n  $('.metric-btn').forEach"),'Metric mode incorrectly uses single-element selector');
assert.ok(app.includes('async function forceUpdateApp'),'Safe force-update function missing');
assert.ok(app.includes("k.startsWith('energo-prehled-beta-')"),'Force update must target beta cache only');
assert.ok(!app.includes('indexedDB.deleteDatabase'),'Force update must not delete IndexedDB');
assert.ok(!app.includes('localStorage.clear()'),'Force update must not clear localStorage');
assert.ok(index.includes('app.js?v=1.5.0'),'App script must be cache-busted');
assert.ok(index.includes('styles.css?v=1.5.0'),'Stylesheet must be cache-busted');
const refresh=fs.readFileSync('refresh.html','utf8');
assert.ok(refresh.includes("energo-prehled-beta-"),'Recovery page must clear beta cache');
assert.ok(!refresh.includes('indexedDB.deleteDatabase'),'Recovery page must preserve IndexedDB');
assert.ok(!refresh.includes('localStorage.clear()'),'Recovery page must preserve localStorage');
assert.ok(app.includes("indexedDB.open(DB_NAME,2)"),'IndexedDB schema must migrate to v2');
assert.ok(app.includes("objectStoreNames.contains('settings')"),'EG.D settings store migration missing');
assert.ok(app.includes("https://idm.distribuce24.cz/oauth/token"),'Official EG.D token endpoint missing');
assert.ok(app.includes("https://data.distribuce24.cz/rest"),'Official EG.D data endpoint missing');
assert.ok(app.includes("namerena_data_openapi"),'EG.D OAuth scope missing');
assert.ok(app.includes("async function testEgdConnection"),'EG.D diagnostic missing');
assert.ok(app.includes("async function syncEgdData"),'EG.D sync missing');
assert.ok(app.includes("async function fetchEgdMonth"),'EG.D monthly fetch missing');
assert.ok(app.includes("previous.source!=='egd-api'"),'Completed XLSX months must be protected from API replacement');
assert.ok(app.includes("r.source==='egd-api'"),'API source semantics missing');
assert.ok(!app.slice(app.indexOf('async function backupLocalData'),app.indexOf('async function restoreLocalData')).includes("getAll('settings')"),'Secrets must not be included in backup');
assert.ok(index.includes('Client secret'),'EG.D credential UI missing');
assert.ok(index.includes('Proxy URL'),'Vercel proxy URL UI missing');
assert.ok(app.includes('async function egdProxyPost'),'Proxy transport missing');
assert.ok(app.includes("action==='diagnostics'")||app.includes("egdProxyPost('diagnostics'"),'Proxy diagnostics flow missing');
assert.ok(app.includes("egdProxyPost('spotreby'"),'Proxy consumption flow missing');
assert.ok(app.includes("if(type==='B')"),'Type B profile selection guard missing');
assert.ok(app.includes("toUpperCase()==='ICC1'"),'Type B must prefer ICC1');
assert.ok(app.includes('lastClosedDayEnd=todayStart-15*60000'),'EG.D current-month query must stop at the previous day');
assert.ok(!app.includes('lastClosedQuarterStart'),'EG.D rejects current-day query bounds');
assert.ok(app.includes('function estimateRateForMonth'),'Three-month cost estimate missing');
assert.ok(app.includes('function weightedCostModel'),'Dynamic fixed-variable cost model missing');
assert.ok(app.includes('function modeledRateAtEnergy'),'Dynamic price curve missing');
assert.ok(app.includes('function predictMonthEnergy'),'Month-end consumption forecast missing');
assert.ok(app.includes('paceEnergy'),'Current-pace forecast scenario missing');
assert.ok(app.includes('lowProjectedCost'),'Forecast lower bound missing');
assert.ok(app.includes('highProjectedCost'),'Forecast upper bound missing');
assert.ok(app.includes('partialToday'),'Partial current day handling missing');
assert.ok(app.includes('remainderToday'),'Partial current day must forecast the remaining intervals');
assert.ok(app.includes('fixed+c.variableRate*p.energy'),'Cost model must regress total invoice against consumption');
assert.ok(app.includes('spreadScore'),'Cost model confidence must account for consumption spread');
assert.ok(app.includes('function estimatedMonthCost'),'Live month cost estimate missing');
assert.ok(app.includes('function costProjectionForRecords'),'Estimated cost dashboard projection missing');
assert.ok(app.includes('function forecastCostSeries'),'Forecast cost series missing');
assert.ok(app.includes('function forecastBandChart'),'Forecast band chart missing');
assert.ok(app.includes('function captureLiveForecastSnapshots'),'Daily forecast snapshot persistence missing');
assert.ok(app.includes('forecastHistory'),'Forecast history must be persisted with month metadata');
assert.ok(app.includes('function forecastAccuracyRows'),'Forecast accuracy evaluation missing');
assert.ok(app.includes('function detectDailyAnomalies'),'Daily anomaly detection missing');
assert.ok(app.includes('function detectIntervalAnomalies'),'15-minute anomaly detection missing');
assert.ok(app.includes('slice(0,i).filter'),'Daily anomaly baseline must use only earlier days');
assert.ok(app.includes('async function maybeAutoSyncEgd'),'Daily EG.D auto-sync missing');
assert.ok(app.includes("state.egd.autoSync!==true"),'Auto-sync must be opt-in');
assert.ok(app.includes("last&&last===today"),'Auto-sync must run at most once per day');
assert.ok(!app.includes("\n    $('.metric-btn').forEach"),'API DCC fallback incorrectly uses single-element selector');

const proxy=fs.readFileSync('vercel-egd-proxy/api/egd.js','utf8');
new Function(proxy.replace('export default async function handler','async function handler'));
assert.ok(proxy.includes("ALLOWED_ORIGIN='https://reisnerfrantisek-a11y.github.io'"),'Proxy origin restriction missing');
assert.ok(proxy.includes("body.action==='diagnostics'"),'Proxy diagnostics action missing');
assert.ok(proxy.includes("body.action==='spotreby'"),'Proxy spotreby action missing');
assert.ok(proxy.includes("days>35"),'Proxy date-range limit missing');
assert.ok(proxy.includes("pageSize:3000"),'Proxy page size must be limited to 3000');
assert.ok(!proxy.includes('process.env.EGD_CLIENT_SECRET'),'Proxy should not persist EG.D secret in server env');
assert.ok(!proxy.includes('http://'),'Proxy must not use insecure upstream URLs');
assert.ok(!proxy.includes('targetUrl'),'Proxy must not be a generic arbitrary-target relay');
assert.ok(proxy.includes("EG.D ${path} failed (HTTP ${resp.status})"),'Proxy must return upstream HTTP status');
assert.ok(proxy.includes('body?.message||body?.error_description||body?.error'),'Proxy must surface safe upstream details');

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
const pragueDayKeyFromMs=()=> '2026-09-19';
const state={metric:'dcc1',period:'month',anchorMonth:'2026-08',customFrom:'2026-07-01',customTo:'2026-08-31',records:[
{id:'jun',sortKey:1,monthKey:'2026-06',dateKey:'2026-06-01',year:2026,month:6,dcc1:4,intervalMinutes:15},
{id:'jul',sortKey:2,monthKey:'2026-07',dateKey:'2026-07-01',year:2026,month:7,dcc1:8,intervalMinutes:15},
{id:'aug',sortKey:3,monthKey:'2026-08',dateKey:'2026-08-01',year:2026,month:8,dcc1:12,intervalMinutes:15}
],months:[
{monthKey:'2026-06',complete:true,finance:{invoiceTotal:100}},{monthKey:'2026-07',complete:true,finance:{invoiceTotal:300}},{monthKey:'2026-08',complete:true,finance:{invoiceTotal:600}}
]};
${analyticsCode}
return {state,currentRange,expectedCurrentMonthKeys,selectedPeriodLabel,costForRecords,monthEffectivePrice,estimateRateForMonth,estimatedMonthCost,costProjectionForRecords,weightedCostModel,modeledRateAtEnergy,predictMonthEnergy,forecastCostSeries,forecastAccuracyRows,detectDailyAnomalies,detectIntervalAnomalies};
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
assert.equal(fullCosts.total,1000);
assert.equal(fullCosts.coveredEnergy,6);
assert.equal(periodTest.monthEffectivePrice('2026-08'),200);
periodTest.state.records.push({id:'sep',sortKey:4,monthKey:'2026-09',dateKey:'2026-09-01',year:2026,month:9,dcc1:4,intervalMinutes:15,source:'egd-api'});
periodTest.state.months.push({monthKey:'2026-09',complete:false,source:'egd-api',lastAvailableAt:'2026-09-18T21:45:00.000Z',finance:{invoiceTotal:null}});
const syntheticModel=periodTest.weightedCostModel([
{key:'a',energy:100,cost:900,weight:1},
{key:'b',energy:200,cost:1300,weight:2},
{key:'c',energy:400,cost:2100,weight:3}
]);
assert.ok(Math.abs(syntheticModel.fixed-500)<1e-9,'Dynamic model must recover the fixed monthly component');
assert.ok(Math.abs(syntheticModel.variableRate-4)<1e-9,'Dynamic model must recover the variable Kč/kWh component');
assert.ok(syntheticModel.confidence>.99,'Well-separated exact data should have high model confidence');
assert.equal(syntheticModel.blend,1,'High-confidence cost models must not be diluted by fallback pricing');
const lowUseRate=periodTest.modeledRateAtEnergy(syntheticModel,100);
const highUseRate=periodTest.modeledRateAtEnergy(syntheticModel,500);
assert.ok(highUseRate<lowUseRate,'Effective Kč/kWh must decline as consumption rises');

const sepRate=periodTest.estimateRateForMonth('2026-09');
assert.equal(sepRate.count,3);
assert.ok(Number.isFinite(sepRate.rate),'Live month must produce a finite dynamic rate');
assert.ok(sepRate.predictedEnergy>=sepRate.actualEnergy,'Month-end energy forecast cannot be below already measured energy');
const sepEstimate=periodTest.estimatedMonthCost('2026-09');
assert.ok(Number.isFinite(sepEstimate.cost),'Live month cost estimate must be finite');
assert.ok(Number.isFinite(sepEstimate.projectedCost),'Projected full-month invoice must be finite');
assert.ok(sepEstimate.projectedCost>=sepEstimate.cost,'Projected full-month invoice should not be below accrued estimate');
assert.ok(Number.isFinite(sepEstimate.lowProjectedCost)&&Number.isFinite(sepEstimate.highProjectedCost),'Forecast range must be finite');
assert.ok(sepEstimate.lowProjectedCost<=sepEstimate.projectedCost&&sepEstimate.projectedCost<=sepEstimate.highProjectedCost,'Central forecast must stay inside the scenario range');
assert.ok(sepEstimate.highEnergy>=sepEstimate.lowEnergy,'Energy forecast range must be ordered');
const forecastSeries=periodTest.forecastCostSeries('2026-09');
assert.ok(forecastSeries&&forecastSeries.data.length===30,'September forecast chart must contain one point per calendar day');
assert.ok(forecastSeries.data.at(-1).low<=forecastSeries.data.at(-1).central&&forecastSeries.data.at(-1).central<=forecastSeries.data.at(-1).high,'Forecast chart endpoint must stay inside the range');
const sepProjection=periodTest.costProjectionForRecords(periodTest.state.records.filter(r=>r.monthKey==='2026-09'));
assert.equal(sepProjection.estimatedMonths.size,1);
assert.ok(Math.abs(sepProjection.totalWithEstimate-sepEstimate.cost)<1e-9);
periodTest.state.months.find(m=>m.monthKey==='2026-07').enabled=false;
periodTest.state.period='3m';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-06','2026-08']);
periodTest.state.period='custom';
assert.deepEqual(periodTest.currentRange().map(r=>r.monthKey),['2026-08']);
periodTest.state.period='all';
assert.equal(periodTest.currentRange().length,3);
periodTest.state.months.forEach(m=>m.enabled=false);
assert.equal(periodTest.currentRange().length,0);

console.log('Energo Přehled Beta 1.5.0 smoke tests OK');
