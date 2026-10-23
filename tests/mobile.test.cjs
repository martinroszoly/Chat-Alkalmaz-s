const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const notifications=fs.readFileSync('notifications.js','utf8');
function fixture(){
 const dom=new JSDOM(html,{url:'https://example.test/Chat-Alkalmaz-s/',runScripts:'outside-only'}),w=dom.window;
 const context=vm.createContext({document:w.document,navigator:{},localStorage:w.localStorage,window:{},console,Image:w.Image,MediaStream:class{},setTimeout,clearTimeout,setInterval,clearInterval,Date,chats:[{id:'one',remote:true,peerUid:'peer',name:'Anna',messages:[]}],current:'one',activePhoneCall:null,pendingPhoneCall:null,firebaseUser:{uid:'me'},markChatRead:()=>{},toast:()=>{}});
 return{context,w,dom};
}
test('inline scripts parse; no conflicting iOS storyboard module',async()=>{
 const {transform}=await import('esbuild');
 for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(match[2].trim())await transform(match[2],{loader:'js',format:match[1].includes('module')?'esm':undefined});}
 const storyboard=fs.readFileSync('ios/App/App/Base.lproj/Main.storyboard','utf8');assert(!storyboard.includes('customModule="App" customModule='));
});
test('group sender is above text and photo; private chat omits sender row',()=>{
 const {context,w,dom}=fixture();
 context.chats=[{id:'one',remote:true,group:true,name:'Barátok',messages:[['received','Szia','12:00',0,'',0,false,'m','peer','https://example.test/p.jpg','Bence']]}];
 Object.assign(context,{expiryTimeout:null,renderList:()=>{},persist:()=>{},getChatTheme:()=> 'dark',isGroupCreator:()=>false,messageAvatarHTML:()=>'',esc:s=>String(s).replaceAll('<','&lt;')});
 const source=html.slice(html.indexOf('function renderMessages(){'),html.indexOf('function selectChat('));vm.runInContext(source,context);vm.runInContext('renderMessages()',context);
 const bubble=w.document.querySelector('.bubble');assert.equal(bubble.firstElementChild.className,'group-sender');assert.equal(bubble.firstElementChild.textContent,'Bence');assert(bubble.innerHTML.indexOf('group-sender')<bubble.innerHTML.indexOf('message-image'));
 context.chats[0].group=false;vm.runInContext('renderMessages()',context);assert.equal(w.document.querySelector('.group-sender'),null);dom.window.close();
});
test('call controls use green accept, red hangup, and speaker state starts off',()=>{
 const {context,w,dom}=fixture();vm.runInContext(fs.readFileSync('calls.js','utf8'),context);vm.runInContext("showCallOverlay('Anna','Bejövő hívás',true)",context);
 assert.equal(w.document.getElementById('callAcceptButton').hidden,false);assert.equal(w.document.getElementById('callHangupButton').hidden,true);assert.equal(w.document.getElementById('callSpeakerButton').getAttribute('aria-pressed'),'false');dom.window.close();
});
test('cancel while microphone permission is pending releases the eventual stream',async()=>{
 const {context,w,dom}=fixture();let resolve,stopped=false,peerCreated=false;
 context.navigator={mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}};context.window.RTCPeerConnection=class{constructor(){peerCreated=true;}};
 context.window.chatFirebase={};vm.runInContext(fs.readFileSync('calls.js','utf8'),context);
 const pending=vm.runInContext('startPhoneCall()',context);await vm.runInContext('endPhoneCall()',context);
 resolve({getTracks:()=>[{stop:()=>stopped=true}]});await pending;
 assert.equal(stopped,true);assert.equal(peerCreated,false);assert.equal(context.activePhoneCall,null);dom.window.close();
});
test('speaker button changes state only after successful native routing',async()=>{
 const {context,w,dom}=fixture();let fail=true;context.window.ChatNative={isNative:true,phone:{setSpeaker:async()=>{if(fail)throw Error('route failed')}}};vm.runInContext(fs.readFileSync('calls.js','utf8'),context);
 await vm.runInContext('toggleCallSpeaker()',context);assert.equal(w.document.getElementById('callSpeakerButton').getAttribute('aria-pressed'),'false');
 fail=false;await vm.runInContext('toggleCallSpeaker()',context);assert.equal(w.document.getElementById('callSpeakerButton').getAttribute('aria-pressed'),'true');dom.window.close();
});
test('an idle call-list refresh never changes native audio routing',()=>{
 const {context,dom}=fixture(),calls=[];context.window.ChatNative={phone:{stopRingtone:async()=>{},setSpeaker:async data=>calls.push(['speaker',data]),endCall:async data=>calls.push(['end',data])}};
 vm.runInContext(fs.readFileSync('calls.js','utf8'),context);vm.runInContext('releasePhoneCall()',context);
 assert.deepEqual(calls,[]);dom.window.close();
});
test('notification opens the requested existing chat without creating a new one',async()=>{
 const {context,w,dom}=fixture();let opened=null,shown=false;context.firebaseUser={uid:'me',emailVerified:true};context.window={addEventListener:()=>{}};context.crypto=require('node:crypto').webcrypto;context.location={href:'https://example.test/'};context.URL=URL;
 Object.assign(context,{selectChat:id=>opened=id,showChats:()=>shown=true});vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);
 await context.window.ChatMobile.openRoute({chatId:'one'});assert.equal(opened,'one');assert.equal(shown,true);dom.window.close();
});
test('foreground chat alerts stay visual and never take audio focus from music',()=>{
 const {context,w,dom}=fixture(),alerts=[];w.localStorage.setItem('messageNotifications','true');Object.defineProperty(w.document,'hidden',{value:false});context.window={addEventListener:()=>{}};context.crypto=require('node:crypto').webcrypto;context.toast=message=>alerts.push(message);context.AudioContext=class{constructor(){throw Error('foreground alert must not start audio')}};
 vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);context.window.ChatMobile.alertMessage({name:'Anna'},[['received','Szia']]);
 assert.deepEqual(alerts,['Anna: Szia']);dom.window.close();
});
test('Android message notification channel is silent and versioned to replace old sound settings',()=>{
 const source=fs.readFileSync('android/app/src/main/java/hu/martinroszoly/chat/ChatNotifications.java','utf8');
 assert(source.includes('chat_messages_v3'));assert(source.includes('messages.setSound(null,null)'));assert(source.includes('messages.enableVibration(false)'));
});
test('ending an Android call restores normal audio mode instead of retaining communication mode',()=>{
 const source=fs.readFileSync('android/app/src/main/java/hu/martinroszoly/chat/ChatPhonePlugin.java','utf8');
 assert(source.includes('getContext().stopService(new Intent(getContext(),ActiveCallService.class));resetAudioRouting()'));
 assert(source.includes('audio.setMode(AudioManager.MODE_NORMAL)'));
});
test('native notifications are not marked enabled until a valid FCM token is saved',async()=>{
 const {context,w,dom}=fixture(),errors=[];context.firebaseUser={uid:'me',emailVerified:true};context.window={addEventListener:()=>{},ChatNative:{isNative:true,platform:'android',phone:{getPendingAction:async()=>({}),registerPush:async()=>undefined}}};context.crypto=require('node:crypto').webcrypto;context.location={href:'https://example.test/'};context.URL=URL;context.window.chatFirebase={registerPushDevice:async()=>true};context.toast=message=>errors.push(message);context.updateNotificationSetting=()=>{};
 vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);await context.window.ChatMobile.accountReady(context.firebaseUser);
 assert.equal(w.localStorage.getItem('messageNotifications'),null);assert.equal(context.window.ChatMobile.isRegistered(),false);assert.match(errors[0],/értesítési tokent/);dom.window.close();
});
test('Android FCM token is registered through Apps Script without requiring a Cloud Function',async()=>{
 const {context,w,dom}=fixture();let request=null,callableUsed=false;const user={uid:'me',emailVerified:true,getIdToken:async()=> 'test-firebase-id-token'};
 context.firebaseUser=user;context.window={addEventListener:()=>{},updateNotificationSetting:()=>{},ChatNative:{isNative:true,platform:'android',phone:{getPendingAction:async()=>({}),registerPush:async()=>({token:'fcm-token-01234567890123456789',platform:'android'})},http:{post:async options=>{request=options;return{status:200,data:{ok:true}}}}},chatFirebase:{registerPushDevice:async()=>{callableUsed=true;throw new Error('Cloud Function must not be required')}}};
 context.crypto=require('node:crypto').webcrypto;context.location={href:'https://example.test/'};context.URL=URL;context.fetch=async()=>({json:async()=>({pushGatewayUrl:'https://script.example/exec',pushGatewayTransport:'apps-script'})});context.updateNotificationSetting=()=>{};
 vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);await context.window.ChatMobile.accountReady(user);
 assert.equal(request?.url,'https://script.example/exec');const event=JSON.parse(request.data);assert.equal(event.kind,'register');assert.equal(event.token,'fcm-token-01234567890123456789');assert.equal(event.platform,'android');assert.equal(event.authToken,'test-firebase-id-token');assert.equal(callableUsed,false);assert.equal(context.window.ChatMobile.isRegistered(),true);assert.equal(w.localStorage.getItem('messageNotifications'),'true');dom.window.close();
});
test('granted web push permission re-registers the device on startup',async()=>{
 const {context,w,dom}=fixture();let saved=null;const registration={};context.firebaseUser={uid:'me',emailVerified:true};context.window={addEventListener:()=>{},updateNotificationSetting:()=>{},chatFirebase:{registerPushDevice:async data=>{saved=data;return true},enableWebPush:async()=> 'fcm-token-01234567890123456789'}};context.crypto=require('node:crypto').webcrypto;context.location={href:'https://example.test/'};context.URL=URL;context.Notification={permission:'granted'};context.window.Notification=context.Notification;context.navigator={serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration),addEventListener:()=>{}}};context.fetch=async()=>({json:async()=>({vapidKey:'public-vapid-key'})});vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);await context.window.ChatMobile.accountReady(context.firebaseUser);assert.equal(saved?.platform,'web');assert.equal(saved?.token,'fcm-token-01234567890123456789');assert.equal(w.localStorage.getItem('messageNotifications'),'true');assert.equal(context.window.ChatMobile.isRegistered(),true);dom.window.close();
});
test('service worker focuses an existing app and sends the exact route',async()=>{
 const handlers={},events=[];const ctx=vm.createContext({self:{addEventListener:(n,f)=>handlers[n]=f,registration:{scope:'https://example.test/Chat-Alkalmaz-s/'},location:{origin:'https://example.test'},clients:{matchAll:async()=>[{url:'https://example.test/Chat-Alkalmaz-s/',postMessage:d=>events.push(d),focus:async()=>events.push('focus')}]}},URL,importScripts:()=>{},firebase:{initializeApp:()=>{},messaging:()=>({onBackgroundMessage:()=>{}})}});
 vm.runInContext(fs.readFileSync('sw.js','utf8'),ctx);let wait;handlers.notificationclick({notification:{close:()=>{},data:{chatId:'one'}},waitUntil:p=>wait=p});await wait;assert.equal(events[0].chatId,'one');assert.equal(events[1],'focus');
});
test('gold-and-black pulsing theme loads app-wide and the push gateway has its RTDB identity scope',()=>{
 const theme=fs.readFileSync('pulze-theme.css','utf8'),manifest=JSON.parse(fs.readFileSync('free-push-apps-script/appsscript.json','utf8'));
 assert(html.indexOf('pulze-theme.css?v=11')<html.indexOf('<body'));
 assert(!html.includes('pulseAqua'));
 assert(fs.readFileSync('sw.js','utf8').includes('pulze-pro-shell-v16'));
 assert(theme.includes('--pulze-gradient'));
 assert(theme.includes('body::before'));
 assert(theme.includes('animation: pulze-glow'));
 assert(theme.includes('#shell .chat[data-theme="dark"] .chat-body'));
 assert(!theme.includes('#shell .chat[data-theme] .chat-body'));
 assert(!theme.includes('#e843b5'));
 assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.email'));
 assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/firebase.database'));
});
test('mobile headers respect camera safe areas and notification reads use server authorization',()=>{
 const theme=fs.readFileSync('pulze-theme.css','utf8'),gateway=fs.readFileSync('free-push-apps-script/Code.gs','utf8');
 assert(theme.includes('calc(66px + env(safe-area-inset-top, 0px))'));
 assert(theme.includes('padding-top: env(safe-area-inset-top, 0px) !important'));
 assert(gateway.includes("headers:{Authorization:'Bearer '+token}"));
 assert(gateway.includes("d.platform==='android'||d.platform==='web'"));
 assert(gateway.includes('devices_(id,adminToken)'));
 assert(html.includes('read-receipt'));
 assert(html.includes('updatedAt:entries.length'));
});
test('profile login sync preserves gallery, and Android push token registration uses the free gateway',()=>{
 assert(html.includes('publishPublicProfile(user,{...data,username,avatar})'));
 const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8')).rules;assert.equal(rules.pushDevices['.read'],false);assert.equal(rules.pushDevices['.write'],false);assert(rules.pushDevices.$uid['.read'].includes('auth.uid === $uid'));assert(!rules.pushDevices.$uid['.read'].includes("root.child('friends')"));assert(rules.pushDevices.$uid.$deviceId['.write'].includes('auth.uid === $uid'));assert(rules.pushDevices.$uid.$deviceId['.validate'].includes("'android'"));assert.equal(rules.serverConfig['.read'],false);
 const register=html.slice(html.indexOf(' registerPushDevice:'),html.indexOf(' getCallIceServers:'));assert(notifications.includes("pushGatewayRequest('register',data)"));assert(notifications.includes("data.platform!=='ios'"));assert(notifications.includes("pushGatewayRequest('unregister',{deviceId})"));assert(notifications.includes("window.ChatNative?.platform!=='ios'"));assert(register.includes('callAdmin("registerPushDevice"'));assert(register.includes('callAdmin("unregisterPushDevice"'));assert(html.includes('permission&&registered'));assert(html.includes('registered=!!window.ChatMobile?.isRegistered?.()'));
});
test('Safari sign-in uses persistent storage fallbacks and keyboard-safe credentials',()=>{const theme=fs.readFileSync('pulze-theme.css','utf8');assert(html.includes('initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence,browserSessionPersistence]})'));assert(html.includes('autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="email"'));assert(html.includes("document.getElementById('password').autocomplete=authMode==='signin'?'current-password':'new-password'"));assert(html.includes("event.key==='Enter'&&authMode==='signin'"));assert(theme.includes('body.auth-required .shell { height:auto!important'));assert(theme.includes('overflow:visible!important'));});
test('opening a read chat does not create an endless read receipt loop',()=>{
 const start=html.lastIndexOf("markChatRead=function(chat)");
 const end=html.indexOf(';\nconst pulseRenderMessages',start);
 const source=html.slice(start,end);
 assert(start>0);assert(source.includes("if(!unseen.length)return"));
 assert(source.indexOf("if(!unseen.length)return")<source.indexOf('markConversationRead(chat.id,unseen)'));
});
test('read receipts are sent as one atomic database update',()=>{
 const start=html.indexOf('const markConversationRead=async');
 const end=html.indexOf(';const setRemoteLike',start);
 const source=html.slice(start,end);
 assert(source.includes("if(!ids.length)return false"));
 assert(source.includes('await update(ref(db),updates)'));
 assert(!source.includes('Promise.allSettled'));
});
test('chat photos are constrained on mobile and scroll position is anchored',()=>{
 assert(fs.readFileSync('pulze-theme.css','utf8').includes('max-width: min(60vw, 240px)'));
 assert(fs.readFileSync('calls.js','utf8').includes('max-width:min(60vw,240px)'));
 assert(html.includes("const pulseRenderMessages=renderMessages"));
 assert(html.includes("anchorIndex=rows.findIndex"));
});
test('accepted requests create friends for both users and repair missing friend rows in realtime',()=>{
 const start=html.indexOf('const updateFriendRequest=async');
 const end=html.indexOf(';\nconst localReadAt',start);
 const source=html.slice(start,end);
 assert(source.includes('await set(ref(db,requestPath),stamp);await set(ref(db,sentPath),stamp)'));
 assert(source.includes('await Promise.all([set(ref(db,"friends/"+u.uid+"/"+other),true),set(ref(db,"friends/"+other+"/"+u.uid),true)])'));
 const watch=html.slice(html.indexOf('const watchSocial='),html.indexOf(';\nconst requestFriend='));
 assert(!watch.includes('if(!profilesReady)return'));
 assert(watch.includes('...Object.entries(requests).filter(([,r])=>r?.status==="accepted")'));
 assert(watch.includes('...Object.entries(sent).filter(([,r])=>r?.status==="accepted")'));
 assert(watch.includes('set(ref(db,"friends/"+uid+"/"+id),true)'));
 const request=html.slice(html.indexOf('const requestFriend='),html.indexOf(';\nconst updateFriendRequest='));
 assert(request.includes('await set(requestRef,request);await set(sentRef,request)'));
 const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8')).rules;
 assert(rules.friendRequests.$target.$sender['.write'].includes("data.child('status').val() === 'pending' && newData.child('status').val() === 'pending'"));
});
test('accepting a request atomically repairs both users friend rows',async()=>{
 const start=html.indexOf('const updateFriendRequest=async');
 const end=html.indexOf(';\nconst localReadAt',start);
 const values={
  'friendRequests/recipient/sender':{senderUid:'sender',targetUid:'recipient',status:'pending',createdAt:1},
  'sentRequests/sender/recipient':{senderUid:'sender',targetUid:'recipient',status:'pending',createdAt:1}
 };
 const {context,dom}=fixture();context.auth={currentUser:{uid:'recipient',emailVerified:true}};context.db={};context.ref=(_db,path)=>path;context.get=async path=>({val:()=>values[path]??null});context.set=async(path,value)=>{values[path]=value};
 await vm.runInContext(`${html.slice(start,end)}; updateFriendRequest('sender','accepted')`,context);
 assert.equal(values['friendRequests/recipient/sender'].status,'accepted');
 assert.equal(values['sentRequests/sender/recipient'].status,'accepted');
 assert.equal(values['friends/recipient/sender'],true);
 assert.equal(values['friends/sender/recipient'],true);
 dom.window.close();
});

test('iOS web push requires a Home Screen app and sends a visible FCM notification',()=>{
 const notifications=fs.readFileSync('notifications.js','utf8'),worker=fs.readFileSync('sw.js','utf8'),gateway=fs.readFileSync('free-push-apps-script/Code.gs','utf8');
 assert(notifications.includes('needsIOSHomeScreen()'));
 assert(notifications.includes('Safari → Megosztás → Hozzáadás a Főképernyőhöz'));
 assert(gateway.includes('webpush.notification={'));
 assert(gateway.includes('webpush.fcm_options={link}'));
 assert(gateway.includes("tag:'message-'+compact_(event.messageId,64)"));
 assert(worker.includes('if(payload.notification)return'));
 assert(worker.includes('clear-chat-notifications'));
 assert(worker.includes('pulze-pro-shell-v16'));
});
test('photo compression fallback stays within the Realtime Database image limit',async()=>{
 const start=html.indexOf('async function compressPhotoForDatabase('),end=html.indexOf('async function uploadChatMedia(',start);assert(start>=0&&end>start);
 const {context,dom}=fixture();let blobs=[];context.createImageBitmap=async()=>({width:2400,height:1800,close(){}});context.document.createElement=()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toBlob:undefined});
 const canvas=context.document.createElement();canvas.toBlob=(callback,type,quality)=>{const blob={size:Math.round(canvas.width*canvas.height*quality*.55),type};blobs.push(blob);callback(blob)};context.document.createElement=()=>canvas;
 context.FileReader=class{readAsDataURL(blob){this.result='data:image/jpeg;base64,'+'x'.repeat(Math.ceil(blob.size*4/3));this.onload()}};
 vm.runInContext(html.slice(start,end),context);const result=await context.compressPhotoForDatabase({});assert(result.startsWith('data:image/jpeg;base64,'));assert(result.length<=740000);assert(blobs.length>0);dom.window.close();
});
test('chat camera, gallery videos, storage uploads, media viewer and receipts are present',()=>{
 const theme=fs.readFileSync('pulze-theme.css','utf8'),storageRules=fs.readFileSync('storage.rules','utf8');
 assert(html.includes('id="cameraModal"'));assert(html.includes('onclick="capturePhoto()"'));assert(html.includes('id="mediaInput" accept="image/*,video/*"'));
 assert(html.includes('uploadConversationMedia'));assert(html.includes('compressPhotoForDatabase(file)'));assert(html.includes('mediaType||"image"'));assert(html.includes('class="message-video"'));
 assert(html.includes("m[0]==='mine'&&m[12]"));assert(theme.includes('.camera-controls'));assert(theme.includes('grid-template-columns:1fr 84px 1fr'));
 assert(storageRules.includes('request.auth.uid == uid'));assert(storageRules.includes('52428800'));assert(storageRules.includes('(image|video)'));
});
test('video messages render in the chat and the seen marker hides for an unread reply, then returns after reading',()=>{
 const {context,w,dom}=fixture(),chat={id:'one',name:'Anna',remote:true,group:false,avatar:'',messages:[['mine','szia','12:00',0,'',0,false,'sent','me','', 'Martin',1,true,'',''],['received','válasz','12:01',0,'',0,false,'reply','peer','', 'Anna',2,false,'','']]};
 context.chats=[chat];Object.assign(context,{expiryTimeout:null,renderList:()=>{},persist:()=>{},getChatTheme:()=> 'dark',isGroupCreator:()=>false,messageAvatarHTML:()=>'',esc:String,markChatRead:()=>{}});
 const source=html.slice(html.indexOf('function renderMessages(){'),html.indexOf('function selectChat('));vm.runInContext(source,context);vm.runInContext('renderMessages()',context);
 assert.equal(w.document.querySelectorAll('video.message-video').length,0);assert.equal(w.document.querySelector('.read-receipt'),null);
 chat.messages[1][12]=true;vm.runInContext('renderMessages()',context);assert.equal(w.document.querySelector('.read-receipt')?.textContent,'Láttam');
 chat.messages.push(['mine','', '12:02',0,'',0,false,'clip','me','', 'Martin',3,false,'https://cdn.example/clip.mp4','video']);vm.runInContext('renderMessages()',context);assert.equal(w.document.querySelectorAll('video.message-video').length,1);assert.equal(w.document.querySelector('.read-receipt'),null);dom.window.close();
});
