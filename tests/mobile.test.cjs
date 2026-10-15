const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
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
test('notification opens the requested existing chat without creating a new one',async()=>{
 const {context,w,dom}=fixture();let opened=null,shown=false;context.firebaseUser={uid:'me',emailVerified:true};context.window={addEventListener:()=>{}};context.crypto=require('node:crypto').webcrypto;context.location={href:'https://example.test/'};context.URL=URL;
 Object.assign(context,{selectChat:id=>opened=id,showChats:()=>shown=true});vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);
 await context.window.ChatMobile.openRoute({chatId:'one'});assert.equal(opened,'one');assert.equal(shown,true);dom.window.close();
});
test('native notifications are not marked enabled until a valid FCM token is saved',async()=>{
 const {context,w,dom}=fixture(),errors=[];context.firebaseUser={uid:'me',emailVerified:true};context.window={addEventListener:()=>{},ChatNative:{isNative:true,platform:'android',phone:{getPendingAction:async()=>({}),registerPush:async()=>undefined}}};context.crypto=require('node:crypto').webcrypto;context.location={href:'https://example.test/'};context.URL=URL;context.window.chatFirebase={registerPushDevice:async()=>true};context.toast=message=>errors.push(message);context.updateNotificationSetting=()=>{};
 vm.runInContext(fs.readFileSync('notifications.js','utf8'),context);await context.window.ChatMobile.accountReady(context.firebaseUser);
 assert.equal(w.localStorage.getItem('messageNotifications'),null);assert.equal(context.window.ChatMobile.isRegistered(),false);assert.match(errors[0],/értesítési tokent/);dom.window.close();
});
test('service worker focuses an existing app and sends the exact route',async()=>{
 const handlers={},events=[];const ctx=vm.createContext({self:{addEventListener:(n,f)=>handlers[n]=f,registration:{scope:'https://example.test/Chat-Alkalmaz-s/'},location:{origin:'https://example.test'},clients:{matchAll:async()=>[{url:'https://example.test/Chat-Alkalmaz-s/',postMessage:d=>events.push(d),focus:async()=>events.push('focus')}]}},URL,importScripts:()=>{},firebase:{initializeApp:()=>{},messaging:()=>({onBackgroundMessage:()=>{}})}});
 vm.runInContext(fs.readFileSync('sw.js','utf8'),ctx);let wait;handlers.notificationclick({notification:{close:()=>{},data:{chatId:'one'}},waitUntil:p=>wait=p});await wait;assert.equal(events[0].chatId,'one');assert.equal(events[1],'focus');
});
test('gold-and-black pulsing theme loads app-wide and the push gateway has its RTDB identity scope',()=>{
 const theme=fs.readFileSync('pulze-theme.css','utf8'),manifest=JSON.parse(fs.readFileSync('free-push-apps-script/appsscript.json','utf8'));
 assert(html.indexOf('pulze-theme.css?v=6')<html.indexOf('<body'));
 assert(!html.includes('pulseAqua'));
 assert(fs.readFileSync('sw.js','utf8').includes('pulze-pro-shell-v8'));
 assert(theme.includes('--pulze-gradient'));
 assert(theme.includes('body::before'));
 assert(theme.includes('animation: pulze-glow'));
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
});
test('profile login sync preserves gallery, and push tokens can only be written by their owner',()=>{
 assert(html.includes('publishPublicProfile(user,{...data,username,avatar})'));
 const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8')).rules;assert.equal(rules.pushDevices['.read'],false);assert.equal(rules.pushDevices['.write'],false);assert(rules.pushDevices.$uid['.read'].includes('auth.uid === $uid'));assert(!rules.pushDevices.$uid['.read'].includes("root.child('friends')"));assert(rules.pushDevices.$uid.$deviceId['.write'].includes('auth.uid === $uid'));assert(rules.pushDevices.$uid.$deviceId['.validate'].includes("'android'"));assert.equal(rules.serverConfig['.read'],false);
 const register=html.slice(html.indexOf(' registerPushDevice:'),html.indexOf(' unregisterPushDevice:'));assert(register.includes('set(ref(db,path)'));assert(register.includes('const saved=(await get(ref(db,path))).val()'));assert(!register.includes('sendFreePush'));assert(html.includes('native?!!window.ChatMobile?.isRegistered?.()'));
});
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
