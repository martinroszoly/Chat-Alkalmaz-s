/* Pulse ingyenes FCM-küldő. Cloudflare Workers Free csomagra készült. */
const PROJECT_ID='chat-alkalmazas-578c8';
const DATABASE_URL='https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app';
const encoder=new TextEncoder();
const b64url=value=>btoa(typeof value==='string'?value:String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64url=value=>{const base=value.replace(/-/g,'+').replace(/_/g,'/'),padded=base+'='.repeat((4-base.length%4)%4);return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));};
let firebaseKeys, firebaseKeysUntil=0, serviceToken, serviceTokenUntil=0;

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*'}})}
function options(){return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, authorization'}})}
async function importPem(pem,usage){const body=pem.replace(/-----(BEGIN|END) (PRIVATE|PUBLIC) KEY-----|\s/g,'');return crypto.subtle.importKey('pkcs8',fromB64url(body),'RSASSA-PKCS1-v1_5',false,usage)}
async function googleToken(service){
 if(serviceToken&&Date.now()<serviceTokenUntil)return serviceToken;
 const now=Math.floor(Date.now()/1000),header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'})),claims=b64url(JSON.stringify({iss:service.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500})),input=header+'.'+claims;
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',await importPem(service.private_key,['sign']),encoder.encode(input));
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+b64url(signature)})});
 if(!response.ok)throw new Error('Google hitelesítés sikertelen');const data=await response.json();serviceToken=data.access_token;serviceTokenUntil=Date.now()+Math.max(60,data.expires_in-60)*1000;return serviceToken;
}
async function verifyFirebaseIdToken(token){
 const [head,body,signature]=String(token||'').split('.');if(!head||!body||!signature)throw new Error('Hiányzó bejelentkezés');const header=JSON.parse(new TextDecoder().decode(fromB64url(head))),claims=JSON.parse(new TextDecoder().decode(fromB64url(body)));
 if(header.alg!=='RS256'||claims.aud!==PROJECT_ID||claims.iss!=='https://securetoken.google.com/'+PROJECT_ID||!claims.sub||claims.exp*1000<Date.now())throw new Error('Érvénytelen bejelentkezés');
 if(!firebaseKeys||Date.now()>firebaseKeysUntil){const response=await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');firebaseKeys=await response.json();firebaseKeysUntil=Date.now()+3600000;}
 const pem=firebaseKeys[header.kid];if(!pem)throw new Error('Lejárt bejelentkezés');const key=await crypto.subtle.importKey('spki',fromB64url(pem.replace(/-----[^-]+-----|\s/g,'')),'RSASSA-PKCS1-v1_5',false,['verify']);if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,fromB64url(signature),encoder.encode(head+'.'+body)))throw new Error('Érvénytelen aláírás');return claims;
}
async function database(path,token){const response=await fetch(DATABASE_URL+'/'+path+'.json',{headers:{authorization:'Bearer '+token}});if(!response.ok)throw new Error('Adatbázis hiba');return response.json();}
const clean=value=>String(value||'').slice(0,1000);
async function sendOne(token,data,accessToken){const message={token,data,android:{priority:'high',ttl:data.type==='call'?'60s':'86400s'}};const response=await fetch('https://fcm.googleapis.com/v1/projects/'+PROJECT_ID+'/messages:send',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({message})});if(!response.ok){const text=await response.text();if(!/UNREGISTERED|INVALID_ARGUMENT/.test(text))throw new Error('FCM küldési hiba');}}
async function notify(event,env){
 const service=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT),accessToken=await googleToken(service),uid=event.uid,avatarData=typeof event.avatarData==='string'&&event.avatarData.startsWith('data:image/')&&event.avatarData.length<3500?event.avatarData:'';
 if(event.kind==='message'){
   const conversation=await database('conversations/'+encodeURIComponent(event.chatId),accessToken),message=conversation?.messages?.[event.messageId];if(!conversation||!message||message.senderUid!==uid)throw new Error('Az üzenet nem küldhető');
   const group=conversation.type==='group',data={type:'message',chatId:clean(event.chatId),title:group?clean(conversation.name||'Csoport'):clean(message.senderName||'Új üzenet'),body:clean(message.text||'Fényképet küldött'),senderName:clean(message.senderName||'Felhasználó'),isGroup:String(group),groupName:group?clean(conversation.name||'Csoport'):'',tag:'message-'+clean(event.messageId),avatarData};
   await Promise.all(Object.entries(conversation.members||{}).filter(([id,member])=>member===true&&id!==uid).map(async([id])=>{const devices=await database('pushDevices/'+encodeURIComponent(id),accessToken)||{};await Promise.all(Object.values(devices).filter(d=>d.platform==='android'&&typeof d.token==='string').map(d=>sendOne(d.token,data,accessToken)));}));return;
 }
 if(event.kind==='call'){
   const call=await database('calls/'+encodeURIComponent(event.callId),accessToken);if(!call||call.callerUid!==uid||call.status!=='ringing'||call.expiresAt<Date.now())throw new Error('A hívás nem küldhető');
   const data={type:'call',callId:clean(event.callId),chatId:clean(call.conversationId),title:clean(call.callerName||'Ismerős')+' hív',body:'Bejövő hívás · Koppints a fogadáshoz',tag:'call-'+clean(event.callId),expiresAt:String(call.expiresAt),avatarData};const devices=await database('pushDevices/'+encodeURIComponent(call.calleeUid),accessToken)||{};await Promise.all(Object.values(devices).filter(d=>d.platform==='android'&&typeof d.token==='string').map(d=>sendOne(d.token,data,accessToken)));return;
 }
 throw new Error('Ismeretlen értesítéstípus');
}
export default {async fetch(request,env){if(request.method==='OPTIONS')return options();if(request.method!=='POST')return json({error:'Not found'},404);try{const user=await verifyFirebaseIdToken(request.headers.get('authorization')?.replace(/^Bearer\s+/i,''));const event=await request.json();await notify({...event,uid:user.user_id},env);return json({ok:true});}catch(error){console.error(error);return json({error:'Az értesítés nem küldhető'},401);}}};
