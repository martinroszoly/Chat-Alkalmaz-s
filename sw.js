const CACHE='uzenetek-shell-v2';
const SHELL=['./','./manifest.json','./icon.svg','./icons/icon-192.png','./icons/icon-512.png','./calls.js','./notifications.js','./mobile-bridge.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  if(e.request.mode==='navigate')e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put('./',r.clone()));return r;}).catch(()=>caches.match('./')));
  else if(SHELL.some(p=>new URL(p,self.registration.scope).href===e.request.url))e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();const d=e.notification.data||{},target=new URL(d.url||'./',self.registration.scope);
  if(target.origin!==self.location.origin)return;
  if(d.chatId)target.searchParams.set('chat',d.chatId);if(d.callId)target.searchParams.set('call',d.callId);
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const client=windows.find(c=>c.url.startsWith(self.registration.scope));
    if(client){client.postMessage({type:'notification-route',chatId:d.chatId,callId:d.callId});return client.focus();}
    return self.clients.openWindow(target.href);
  }));
});
importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js','https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyAX1n-46JJ6a3XnQwd_d0QaDoQbV1QnSYc',projectId:'chat-alkalmazas-578c8',messagingSenderId:'855477495883',appId:'1:855477495883:web:b1ded8145bc6da570c05ce'});
firebase.messaging().onBackgroundMessage(payload=>{
  const d=payload.data||{};if(d.type==='call'&&Number(d.expiresAt)<Date.now())return;
  if(d.type==='call-ended')return self.registration.getNotifications({tag:'call-'+d.callId}).then(items=>items.forEach(n=>n.close()));
  return self.registration.showNotification(d.title||'Üzenetek',{body:(d.isGroup==='true'?d.senderName+'\n':'')+(d.body||'Új üzenet'),icon:d.avatarUrl||'./icons/icon-192.png',badge:'./icons/badge.png',tag:d.tag,requireInteraction:d.type==='call',vibrate:d.type==='call'?[300,100,300,100,300]:[120],data:{chatId:d.chatId,callId:d.callId,url:d.type==='call'?'./?call='+encodeURIComponent(d.callId):'./?chat='+encodeURIComponent(d.chatId)}});
});
