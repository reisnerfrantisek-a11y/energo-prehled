const SCOPE_TAG=new URL(self.registration.scope).pathname.includes('/beta/')?'beta':'prod';
const CACHE_PREFIX=`energo-prehled-${SCOPE_TAG}-`;
const CACHE=`${CACHE_PREFIX}v1.11.0`;
const LEGACY_CACHES=SCOPE_TAG==='beta'?['energo-prehled-v1.1.0']:['energo-prehled-v1.0.0'];
const ASSETS=['./','./index.html','./styles.css?v=1.11.0','./core/model.js?v=1.11.0','./core/time.js?v=1.11.0','./core/forecast.js?v=1.11.0','./core/regime.js?v=1.11.0','./core/power.js?v=1.11.0','./core/report.js?v=1.11.0','./core/invoice.js?v=1.11.0','./core/invoice-parser.js?v=1.11.0','./app.js?v=1.11.0','./manifest.webmanifest','../icons/icon-180.png','../icons/icon-192.png','../icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith(CACHE_PREFIX)&&k!==CACHE)||LEGACY_CACHES.includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  const networkFirst=e.request.mode==='navigate'||/\/(?:app\.js|styles\.css|manifest\.webmanifest)$/.test(url.pathname)||/\/core\/[^/]+\.js$/.test(url.pathname);
  if(networkFirst){
    e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
  }else{
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp})));
  }
});
