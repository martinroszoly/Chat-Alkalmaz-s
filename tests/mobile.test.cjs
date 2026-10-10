const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
function fixture(){
 const dom=new JSDOM(html,{url:'https://example.test/Chat-Alkalmaz-s/',runScripts:'outside-only'}),w=dom.window;
 const context=vm.createContext({document:w.document,navigator:{},localStorage:w.localStorage,window:{},console,Image:w.Image,MediaStream:class{},setTimeout,clearTimeout,setInterval,clearInterval,Date,chats:[{id:'one',remote:true,peerUid:'peer',name:'Anna',messages:[]}],current:'one',activePhoneCall:null,pendingPhoneCall:null,firebaseUser:{uid:'me'},toast:()=>{}});
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
test('service worker focuses an existing app and sends the exact route',async()=>{
 const handlers={},events=[];const ctx=vm.createContext({self:{addEventListener:(n,f)=>handlers[n]=f,registration:{scope:'https://example.test/Chat-Alkalmaz-s/'},location:{origin:'https://example.test'},clients:{matchAll:async()=>[{url:'https://example.test/Chat-Alkalmaz-s/',postMessage:d=>events.push(d),focus:async()=>events.push('focus')}]}},URL,importScripts:()=>{},firebase:{initializeApp:()=>{},messaging:()=>({onBackgroundMessage:()=>{}})}});
 vm.runInContext(fs.readFileSync('sw.js','utf8'),ctx);let wait;handlers.notificationclick({notification:{close:()=>{},data:{chatId:'one'}},waitUntil:p=>wait=p});await wait;assert.equal(events[0].chatId,'one');assert.equal(events[1],'focus');
});
test('profile login sync preserves gallery, and push tokens can only be written by their owner',()=>{
 assert(html.includes('publishPublicProfile(user,{...data,username,avatar})'));
 const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8')).rules;assert.equal(rules.pushDevices['.read'],false);assert.equal(rules.pushDevices['.write'],false);assert.equal(rules.serverConfig['.read'],false);
});
