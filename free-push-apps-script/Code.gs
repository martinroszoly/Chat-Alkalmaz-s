// Pulse – ingyenes Spark/FCM értesítési kapu Google Apps Scripthez.
const PROJECT_ID = 'chat-alkalmazas-578c8';
const DATABASE_URL = 'https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app';
const API_KEY = 'AIzaSyAX1n-46JJ6a3XnQwd_d0QaDoQbV1QnSYc';

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents || '{}');
    const sender = verifyUser_(body.authToken);
    notify_(body, sender.localId);
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(error && error.message || error).slice(0,240)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function verifyUser_(idToken) {
  if(typeof idToken!=='string'||idToken.split('.').length!==3) throw new Error('Érvénytelen bejelentkezés');
  let claims;
  try { claims=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(idToken.split('.')[1])).getDataAsString()); } catch(e) { throw new Error('Érvénytelen bejelentkezés'); }
  const uid=String(claims.user_id||claims.sub||'');
  if(!uid||claims.aud!==PROJECT_ID||claims.iss!=='https://securetoken.google.com/'+PROJECT_ID) throw new Error('Érvénytelen bejelentkezés');
  const url=DATABASE_URL+'/pushDevices/'+encodeURIComponent(uid)+'.json?auth='+encodeURIComponent(idToken);
  const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(response.getResponseCode()!==200) throw new Error('Firebase bejelentkezés ellenőrzése sikertelen ('+response.getResponseCode()+')');
  return {localId:uid,emailVerified:true};
}

function serviceToken_() { return ScriptApp.getOAuthToken(); }
function database_(path,token){const response=UrlFetchApp.fetch(DATABASE_URL+'/'+path+'.json',{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});if(response.getResponseCode()!==200){console.error('Realtime Database read failed',response.getResponseCode(),response.getContentText().slice(0,500));throw new Error('Adatbázis hiba ('+response.getResponseCode()+')')}return JSON.parse(response.getContentText())}
function writeDatabase_(path,value,token,method){const response=UrlFetchApp.fetch(DATABASE_URL+'/'+path+'.json?auth='+encodeURIComponent(token),{method:method||'put',contentType:'application/json',payload:value===null?'null':JSON.stringify(value),muteHttpExceptions:true});if(response.getResponseCode()>=300)throw new Error('Az értesítési eszköz mentése nem sikerült ('+response.getResponseCode()+')')}
function adminWriteDatabase_(path,value,token,method){const response=UrlFetchApp.fetch(DATABASE_URL+'/'+path+'.json',{method:method||'put',headers:{Authorization:'Bearer '+token},contentType:'application/json',payload:value===null?'null':JSON.stringify(value),muteHttpExceptions:true});if(response.getResponseCode()>=300)throw new Error('Az értesítési eszköz törlése nem sikerült ('+response.getResponseCode()+')')}
function compact_(value,max){return String(value||'').slice(0,max||1000)}
function send_(uid,device,data,token){
  const link='https://chat-alkalmazas-578c8.web.app/?'+(data.callId?'call='+encodeURIComponent(data.callId):'chat='+encodeURIComponent(data.chatId||''));
  const pushData={...data};delete pushData.avatarData;
  const webpush={headers:{Urgency:'high',TTL:(data.type==='call'||data.type==='call-ended')?'60':'86400'}};
  if(data.type!=='call-ended'){
    webpush.notification={
      title:compact_(data.title,'Pulze-pro',80),
      body:compact_(data.body,'Új üzenet',350),
      icon:'https://chat-alkalmazas-578c8.web.app/icons/icon-192.png',
      badge:'https://chat-alkalmazas-578c8.web.app/icons/badge.png',
      tag:compact_(data.tag,'pulze-message',64),
      data:{type:compact_(data.type,24),chatId:compact_(data.chatId,180),callId:compact_(data.callId,180),url:link},
      ...(data.type==='call'?{require_interaction:true}:{})
    };
    webpush.fcm_options={link};
  }
  const message={token:device.token,data:pushData,android:{priority:'high',ttl:(data.type==='call'||data.type==='call-ended')?'60s':'86400s'},webpush:webpush};
  const response=UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/'+PROJECT_ID+'/messages:send',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({message}),muteHttpExceptions:true});
  const text=response.getContentText();
  if(response.getResponseCode()>=300){if(/UNREGISTERED/.test(text)){adminWriteDatabase_('pushDevices/'+encodeURIComponent(uid)+'/'+encodeURIComponent(device.id),null,token,'delete');return}throw new Error('FCM küldési hiba: '+text.slice(0,500))}
}
function devices_(uid,token){return Object.entries(database_('pushDevices/'+encodeURIComponent(uid),token)||{}).filter(([,d])=>(d.platform==='android'||d.platform==='web')&&typeof d.token==='string').map(([id,d])=>({id,token:d.token}))}
function profile_(uid,token){return database_('publicProfiles/'+encodeURIComponent(uid),token)||{}}
function notify_(event,uid){
  // Verify the caller's Firebase ID token, then use the script owner's scoped
  // Firebase Database OAuth token for private device-token and message reads.
  const token=event.authToken,adminToken=serviceToken_();
  if(event.kind==='register'){
    if((event.platform!=='android'&&event.platform!=='web')||typeof event.deviceId!=='string'||typeof event.token!=='string'||event.deviceId.length<8||event.token.length<20)throw new Error('Érvénytelen értesítési eszköz');
    writeDatabase_('pushDevices/'+encodeURIComponent(uid)+'/'+encodeURIComponent(event.deviceId),{platform:event.platform,token:event.token,updatedAt:Date.now()},token);return;
  }
  if(event.kind==='unregister'){
    if(typeof event.deviceId!=='string'||event.deviceId.length<8)throw new Error('Érvénytelen értesítési eszköz');
    writeDatabase_('pushDevices/'+encodeURIComponent(uid)+'/'+encodeURIComponent(event.deviceId),null,token,'delete');return;
  }
  const avatarData=typeof event.avatarData==='string'&&event.avatarData.indexOf('data:image/')===0&&event.avatarData.length<=2800?event.avatarData:'';
  if(event.kind==='message'){
    const chat=database_('conversations/'+encodeURIComponent(event.chatId),adminToken),message=chat&&chat.messages&&chat.messages[event.messageId];if(!chat||chat.members?.[uid]!==true||!message||message.senderUid!==uid)throw new Error('Az üzenet nem küldhető');
    const profile=profile_(uid,adminToken),senderName=compact_(profile.username||message.senderName||'Felhasználó',80),group=chat.type==='group',data={type:'message',chatId:compact_(event.chatId,180),title:group?compact_(chat.name||'Csoport',80):senderName,body:compact_(message.text||'Fényképet küldött',350),senderName:senderName,isGroup:String(group),groupName:group?compact_(chat.name||'Csoport',80):'',tag:'message-'+compact_(event.messageId,64),avatarData:avatarData};
    Object.keys(chat.members||{}).filter(id=>chat.members[id]===true&&id!==uid).forEach(id=>devices_(id,adminToken).forEach(d=>send_(id,d,data,adminToken)));return;
  }
  if(event.kind==='call-ended'){
    const call=database_('calls/'+encodeURIComponent(event.callId),adminToken);
    if(!call||![call.callerUid,call.calleeUid].includes(uid)||!['ended','declined'].includes(call.status))throw new Error('A hívás lezárása nem küldhető');
    const data={type:'call-ended',callId:compact_(event.callId,180)};
    [call.callerUid,call.calleeUid].forEach(target=>devices_(target,adminToken).forEach(d=>send_(target,d,data,adminToken)));return;
  }
  if(event.kind==='call'){
    const call=database_('calls/'+encodeURIComponent(event.callId),adminToken);if(!call||call.callerUid!==uid||call.status!=='ringing'||call.expiresAt<Date.now())throw new Error('A hívás nem küldhető');
    const profile=profile_(uid,adminToken),data={type:'call',callId:compact_(event.callId,180),chatId:compact_(call.conversationId,180),title:compact_(profile.username||call.callerName||'Ismerős',80)+' hív',body:'Bejövő hívás · Koppints a fogadáshoz',tag:'call-'+compact_(event.callId,180),expiresAt:String(call.expiresAt),avatarData:avatarData};devices_(call.calleeUid,adminToken).forEach(d=>send_(call.calleeUid,d,data,adminToken));return;
  }
  throw new Error('Ismeretlen értesítéstípus');
}
