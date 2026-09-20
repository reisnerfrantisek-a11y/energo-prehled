const test=require('node:test');
const assert=require('node:assert/strict');
const Power=require('../core/power.js');

test('breaker reference capacity matches 1f and 3f nominal systems',()=>{
  assert.ok(Math.abs(Power.breakerReferenceKw({phases:3,amperes:25})-17.3205080757)<1e-9);
  assert.ok(Math.abs(Power.breakerReferenceKw({phases:1,amperes:25})-5.75)<1e-12);
  assert.equal(Power.breakerReferenceKw({phases:3,amperes:null}),null);
});

test('power analysis calculates percentiles, utilization and bands',()=>{
  const values=[1,3,5,8,10,13,16,18].map(kw=>({kw,minutes:15}));
  const a=Power.analyzePower(values,{phases:3,amperes:25});
  assert.equal(a.count,8);
  assert.ok(a.capacityKw>17&&a.capacityKw<18);
  assert.equal(a.maxKw,18);
  assert.ok(a.maxUsagePct>100);
  assert.equal(a.above100Count,1);
  assert.ok(Math.abs(a.bands.reduce((s,b)=>s+b.share,0)-1)<1e-12);
  assert.ok(Math.abs(a.bands.reduce((s,b)=>s+b.hours,0)-2)<1e-12);
  assert.ok(a.p99Kw>=a.p95Kw);
});

test('power analysis stays useful without breaker configuration',()=>{
  const a=Power.analyzePower([1,2,3],{phases:3,amperes:null});
  assert.equal(a.maxKw,3);
  assert.equal(a.capacityKw,null);
  assert.deepEqual(a.bands,[]);
});
