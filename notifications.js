(function () {
  let deviceId=localStorage.getItem('pushDeviceId'),registered=false,pendingRoute=null;
  if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem('pushDeviceId',deviceId);}
  function routeFromUrl(){const p=new URL(location.href).searchParams;return{chatId:p.get('chat'),callId:p.get('call')};}
  async function openRoute(data) {
    if(!data?.chatId&&!data?.callId)return;
    if(data.action==='end'&&activePhoneCall?.id===data.callId){await endPhoneCall();return;}
    if(!firebaseUser?.emailVerified){pendingRoute=data;return;}
    try {
      if(data.callId){
        const call=await window.chatFirebase.getCall(data.callId);
        if(!call||call.calleeUid!==firebaseUser.uid||call.status!=='ringing'||(call.expiresAt||call.createdAt+60000)<Date.now()){toast('A hívás már véget ért');return;}
        if(activePhoneCall?.id===data.callId)return;
        if(activePhoneCall){toast('Már van folyamatban lévő hívás');return;}
        pendingPhoneCall={id:data.callId,...call};showIncomingCall(pendingPhoneCall);
        if(data.action==='accept')await acceptPhoneCall();
        else if(data.action==='decline')await declinePhoneCall();
      }else{
        if(!chats.some(c=>c.id===data.chatId)){const chat=await window.chatFirebase.getConversation(data.chatId);if(!chat)throw new Error('Ez a beszélgetés nem érhető el');mergeRemoteChat(chat);attachRemoteConversation(data.chatId);}
        showChats();selectChat(data.chatId);
      }
      pendingRoute=null;
    }catch(e){toast(e.message||'Az értesítés nem nyitható meg');}
  }
  async function pushGatewayRequest(kind,payload){
    const config=await fetch('./push-config.json',{cache:'no-store'}).then(r=>r.json());
    const gateway=String(config.pushGatewayUrl||'').trim();
    if(!gateway)throw new Error('Az értesítési kapu nincs beállítva');
    if(!firebaseUser?.emailVerified)throw new Error('Az értesítéshez jelentkezz be');
    const event={kind,...payload,authToken:await firebaseUser.getIdToken(true)};
    if(config.pushGatewayTransport==='apps-script'&&window.ChatNative?.isNative&&window.ChatNative.http){
      const response=await window.ChatNative.http.post({url:gateway,headers:{'Content-Type':'text/plain;charset=utf-8'},data:JSON.stringify(event),responseType:'json'});
      let result=response.data;if(typeof result==='string')try{result=JSON.parse(result)}catch{}
      if(response.status>=400||result?.ok!==true)throw new Error(result?.error||'Az értesítési szolgáltatás elutasította a kérést');
      return true;
    }
    if(config.pushGatewayTransport==='apps-script'){
      await fetch(gateway,{method:'POST',mode:'no-cors',headers:{'content-type':'text/plain'},body:JSON.stringify(event)});return true;
    }
    const response=await fetch(gateway,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+event.authToken},body:JSON.stringify(event)});
    if(!response.ok)throw new Error('Az értesítési szolgáltatás nem válaszol');
    return true;
  }
  async function registerPushDevice(data){
    const config=await fetch('./push-config.json',{cache:'no-store'}).then(r=>r.json());
    if(config.pushGatewayTransport==='apps-script'&&data.platform!=='ios')return pushGatewayRequest('register',data);
    return window.chatFirebase.registerPushDevice({deviceId,...data});
  }
  async function unregisterPushDevice(){
    if(!firebaseUser?.uid)return;
    const config=await fetch('./push-config.json',{cache:'no-store'}).then(r=>r.json());
    if(config.pushGatewayTransport==='apps-script'&&window.ChatNative?.platform!=='ios')return pushGatewayRequest('unregister',{deviceId});
    return window.chatFirebase.unregisterPushDevice({deviceId});
  }
  async function saveNativeToken(data){
    if(!firebaseUser?.emailVerified)return;
    if(typeof data?.token!=='string'||data.token.length<20)throw new Error('A telefon nem adott érvényes értesítési tokent');
    await registerPushDevice(data);registered=true;window.updateNotificationSetting?.();
  }
  function isIOS(){return /iPhone|iPad|iPod/.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
  function isStandalone(){return navigator.standalone===true||!!window.matchMedia?.('(display-mode: standalone)').matches;}
  function needsIOSHomeScreen(){return isIOS()&&!isStandalone();}
  async function registerWeb(){
    if(needsIOSHomeScreen())throw new Error('iPhone-on az értesítés csak a Főképernyőre telepített Pulze-pro alkalmazásban működik. Safari → Megosztás → Hozzáadás a Főképernyőhöz, majd ott kapcsold be.');
    const config=await fetch('./push-config.json',{cache:'no-store'}).then(r=>r.json());
    if(!config.vapidKey)throw new Error('A háttérértesítéshez még be kell állítani a Firebase webes push-kulcsot');
    const reg=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;
    const token=await window.chatFirebase.enableWebPush(reg,config.vapidKey);
    await saveNativeToken({token,platform:'web'});
  }
  async function enableNotifications(){
    try{
      if(!firebaseUser?.emailVerified)throw new Error('Az értesítésekhez jelentkezz be');
      if(!window.ChatNative?.isNative&&needsIOSHomeScreen())throw new Error('iPhone-on az értesítés csak a Főképernyőre telepített Pulze-pro alkalmazásban működik. Safari → Megosztás → Hozzáadás a Főképernyőhöz, majd a Főképernyőn nyisd meg és kapcsold be.');
      if(window.ChatNative?.isNative){const token=await window.ChatNative.phone.registerPush();await saveNativeToken(token);}
      else{
        if(!('Notification'in window))throw new Error('Ezen a böngészőn nem támogatott az értesítés');
        if(await Notification.requestPermission()!=='granted')throw new Error('Engedélyezd az értesítéseket a telefon beállításaiban');
        await registerWeb();
      }
      localStorage.setItem('messageNotifications','true');updateNotificationSetting();
      if(window.ChatNative?.isNative){document.getElementById('notificationToggle').classList.add('on');document.getElementById('notificationStatus').textContent='Bekapcsolva · telefonos értesítések';}
      toast('Értesítési engedély megadva');
    }catch(e){registered=false;localStorage.removeItem('messageNotifications');updateNotificationSetting();toast(e.message||'Nem sikerült bekapcsolni az értesítéseket');}
  }
  function alertMessage(chat,messages){
    if(localStorage.getItem('messageNotifications')!=='true')return;
    // Do not create WebAudio for a chat alert: on Android this can take audio
    // focus from music apps. Keep foreground alerts visual and silent.
    if(!document.hidden){const m=messages.at(-1);toast((chat?.name?chat.name+': ':'')+(m?.[1]||'Új üzenet'));return;}
    if(registered||window.ChatNative?.isNative)return;
    if('Notification'in window&&Notification.permission==='granted'){
      const m=messages.at(-1);navigator.serviceWorker?.ready.then(reg=>reg.showNotification(chat.name,{body:m?.[1]||'Fényképet küldött',icon:'./icons/icon-192.png',tag:'message-'+(m?.[7]||chat.id),data:{chatId:chat.id,url:'./?chat='+encodeURIComponent(chat.id)}})).catch(console.warn);
    }
  }
  function alertCall(call){
    if(window.ChatNative?.isNative){window.ChatNative.phone.reportIncomingCall({callId:call.id,name:call.callerName||'Ismerős',expiresAt:call.expiresAt||call.createdAt+60000}).catch(console.warn);return;}
    if(document.hidden&&!registered&&'Notification'in window&&Notification.permission==='granted')navigator.serviceWorker?.ready.then(reg=>reg.showNotification((call.callerName||'Ismerős')+' hív',{body:'Bejövő hívás · Koppints a fogadáshoz',icon:'./icons/icon-192.png',tag:'call-'+call.id,requireInteraction:true,data:{callId:call.id,url:'./?call='+encodeURIComponent(call.id)}})).catch(console.warn);
  }
  async function accountReady(user){
    if(!user?.emailVerified)return;
    if(window.ChatNative?.platform==='ios')await window.ChatNative.phone.setSession({idToken:await user.getIdToken()}).catch(console.warn);
    if(window.ChatNative?.isNative)await window.ChatNative.phone.getPendingAction().then(openRoute).catch(console.warn);
    if(pendingRoute)await openRoute(pendingRoute);else await openRoute(routeFromUrl());
    if(window.ChatNative?.isNative){
      try{const token=await window.ChatNative.phone.registerPush();await saveNativeToken(token);localStorage.setItem('messageNotifications','true');updateNotificationSetting();}catch(e){registered=false;localStorage.removeItem('messageNotifications');updateNotificationSetting();console.warn('Push registration pending',e);toast('Android értesítésregisztráció sikertelen: '+(e?.message||'ellenőrizd az értesítési engedélyt'));}
    }else if('Notification'in window&&Notification.permission==='granted'){
      try{await registerWeb();localStorage.setItem('messageNotifications','true');window.updateNotificationSetting?.();}
      catch(e){registered=false;localStorage.removeItem('messageNotifications');window.updateNotificationSetting?.();console.warn('Push registration pending',e);toast(e?.message||'Az iPhone értesítése nincs regisztrálva');}
    }else{registered=false;window.updateNotificationSetting?.();}
  }
  async function beforeSignOut(){
    if(firebaseUser?.uid)await unregisterPushDevice();
    registered=false;await endPhoneCall();if(window.ChatNative?.platform==='ios')await window.ChatNative.phone.setSession({}).catch(console.warn);
  }
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='notification-route')openRoute(e.data);});
  window.addEventListener('chat:native-route',e=>openRoute(e.detail));
  window.addEventListener('chat:native-token',e=>saveNativeToken(e.detail).catch(e=>toast('Az értesítés szerverregisztrációja nem sikerült: '+e.message)));
  window.addEventListener('chat:native-end',e=>{if(activePhoneCall?.id===e.detail.callId||pendingPhoneCall?.id===e.detail.callId)endPhoneCall();else openRoute({...e.detail,action:'decline'});});
  window.addEventListener('chat:native-push-error',e=>toast(e.detail.message||'Az értesítéseket nem sikerült regisztrálni'));
  window.ChatMobile={enableNotifications,accountReady,beforeSignOut,alertMessage,alertCall,openRoute,needsIOSHomeScreen};
  window.ChatMobile.isRegistered=()=>registered;
})();
