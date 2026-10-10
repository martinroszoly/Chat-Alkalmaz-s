const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onValueCreated,onValueUpdated}=require('firebase-functions/v2/database');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getDatabase}=require('firebase-admin/database');
const {getMessaging}=require('firebase-admin/messaging');
const crypto=require('node:crypto');
const notificationAvatar=require('./notification-avatar');
const DB_URL='https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app';
const db=()=>getDatabase(undefined,DB_URL);
const opts={region:'europe-west1',instance:'chat-alkalmazas-578c8-default-rtdb'};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function uidOf(r){if(!r.auth?.token.email_verified)throw new HttpsError('unauthenticated','Megerősített bejelentkezés szükséges');return r.auth.uid;}
exports.registerPushDevice=onCall({region:'europe-west1'},async r=>{
  const uid=uidOf(r),{deviceId,token,platform,voipToken}=r.data||{};
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(deviceId||'')||!['web','android','ios'].includes(platform))throw new HttpsError('invalid-argument','Érvénytelen eszköz');
  if((typeof token!=='string'||token.length<20||token.length>4096)&&!voipToken)throw new HttpsError('invalid-argument','Érvénytelen értesítési token');
  if(platform==='ios'&&token&&!/^[a-f0-9]{64,200}$/i.test(token))throw new HttpsError('invalid-argument','Érvénytelen Apple token');
  if(voipToken&&(platform!=='ios'||!/^[a-f0-9]{64,200}$/i.test(voipToken)))throw new HttpsError('invalid-argument','Érvénytelen VoIP token');
  const path='pushDevices/'+uid+'/'+deviceId,old=(await db().ref(path).get()).val()||{};
  for(const t of [token,voipToken].filter(Boolean)){
    const key=hash(t),previous=(await db().ref('pushTokenOwners/'+key).get()).val();
    if(previous&&previous.uid!==uid)await db().ref('pushDevices/'+previous.uid+'/'+previous.deviceId).remove();
    await db().ref('pushTokenOwners/'+key).set({uid,deviceId});
  }
  await db().ref(path).set({...old,platform,updatedAt:Date.now(),...(token?{token}:{}),...(voipToken?{voipToken}:{})});
  return{ok:true};
});
exports.unregisterPushDevice=onCall({region:'europe-west1'},async r=>{
  const uid=uidOf(r),id=r.data?.deviceId;if(!/^[a-zA-Z0-9-]{16,80}$/.test(id||''))throw new HttpsError('invalid-argument','Érvénytelen eszköz');
  await db().ref('pushDevices/'+uid+'/'+id).remove();return{ok:true};
});
exports.getCallIceServers=onCall({region:'europe-west1'},async r=>{
  uidOf(r);const turn=(await db().ref('serverConfig/turn').get()).val();
  const iceServers=[{urls:'stun:stun.l.google.com:19302'}];
  if(turn?.urls&&turn.username&&turn.credential)iceServers.push({urls:turn.urls,username:turn.username,credential:turn.credential});
  return{iceServers,relayConfigured:iceServers.length>1};
});
function messagePayload(chatId,messageId,message){return{type:'message',chatId,title:String(message.senderName||'Új üzenet').slice(0,80),body:String(message.text||'Fényképet küldött').slice(0,1000),tag:'message-'+messageId};}
function callPayload(callId,call){return{type:'call',callId,chatId:call.conversationId||'',title:(call.callerName||'Ismerős')+' hív',body:'Bejövő hívás · Koppints a fogadáshoz',tag:'call-'+callId,expiresAt:String(call.expiresAt||call.createdAt+60000)};}
async function sendFcm(uid,data){
  const devices=(await db().ref('pushDevices/'+uid).get()).val()||{};
  const entries=Object.entries(devices).filter(([,d])=>d.token&&d.platform!=='ios'&&d.updatedAt>Date.now()-60*86400000);
  if(!entries.length)return;
  const results=await getMessaging().sendEach(entries.map(([,d])=>({token:d.token,data,android:{priority:'high',ttl:data.type==='call'?60000:86400000},webpush:{headers:{Urgency:'high',TTL:data.type==='call'?'60':'86400'}}})));
  await Promise.all(results.responses.map((r,i)=>r.error&&['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error.code)?db().ref('pushDevices/'+uid+'/'+entries[i][0]).remove():Promise.resolve()));
  const retry=results.responses.find(r=>r.error&&!['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error.code));if(retry)throw retry.error;
}
exports.sendMessagePush=onValueCreated({...opts,ref:'/conversations/{chatId}/messages/{messageId}',retry:true},async e=>{
  const m=e.data.val();if(m.expiresAt&&m.expiresAt<Date.now())return;
  const members=(await db().ref('conversations/'+e.params.chatId+'/members').get()).val()||{};
  const p=messagePayload(e.params.chatId,e.params.messageId,m);
  const conversation=(await db().ref('conversations/'+e.params.chatId).get()).val()||{};
  p.senderName=String(m.senderName||'Felhasználó').slice(0,80);p.isGroup=String(conversation.type==='group');p.groupName=conversation.type==='group'?String(conversation.name||'Csoport').slice(0,80):'';p.avatarUrl=await notificationAvatar(m.senderUid);
  if(p.groupName)p.title=p.groupName;
  await Promise.all(Object.keys(members).filter(uid=>members[uid]===true&&uid!==m.senderUid).map(uid=>sendFcm(uid,p)));
});
exports.sendCallPush=onValueCreated({...opts,ref:'/calls/{callId}',retry:true},async e=>{
  const call=e.data.val();if(call.status!=='ringing'||(call.expiresAt||call.createdAt+60000)<Date.now())return;
  const payload=callPayload(e.params.callId,call);payload.avatarUrl=await notificationAvatar(call.callerUid);await sendFcm(call.calleeUid,payload);
});
exports.sendCallEndedPush=onValueUpdated({...opts,ref:'/calls/{callId}/status',retry:true},async e=>{
  if(!['ended','declined','answered'].includes(e.data.after.val()))return;
  const call=(await db().ref('calls/'+e.params.callId).get()).val();if(!call)return;
  await sendFcm(call.calleeUid,{type:'call-ended',callId:e.params.callId,tag:'call-'+e.params.callId});
  await db().ref('callInbox/'+call.calleeUid+'/'+e.params.callId).remove();
});
exports.expireRingingCalls=onSchedule({region:'europe-west1',schedule:'every 1 minutes'},async()=>{
  const calls=(await db().ref('calls').orderByChild('status').equalTo('ringing').get()).val()||{};
  for(const [id,c]of Object.entries(calls))if((c.expiresAt||c.createdAt+60000)<Date.now()){
    await db().ref('calls/'+id+'/status').transaction(s=>s==='ringing'?'ended':undefined);
    await db().ref('callInbox/'+c.calleeUid+'/'+id).remove();
  }
});
exports._helpers={messagePayload,callPayload};
