const CACHE='play-music-theory';
const CORE=['./','./index.html','./gallery.html','./gallery-data.json','./remux.js','./manifest.webmanifest','./icon.svg',...Array.from({length:9},(_,i)=>`./assets/${i}.jpg`)];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok&&new URL(e.request.url).origin===self.location.origin)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>caches.match('./index.html'))))});
