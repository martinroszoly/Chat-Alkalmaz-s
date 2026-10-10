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
    return ContentService.createTextOutput(JSON.stringify({ok:false})).setMimeType(ContentService.MimeType.JSON);
  }
}

function verifyUser_(idToken) {
  const response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, {method:'post', contentType:'application/json', payload:JSON.stringify({idToken:idToken}), muteHttpExceptions:true});
  const data = JSON.parse(response.getContentText());
  const user = data.users && data.users[0];
  if (response.getResponseCode() !== 200 || !user || !user.emailVerified) throw new Error('Érvénytelen bejelentkezés');
  return user;
}

function serviceToken_() { return ScriptApp.getOAuthToken(); }
function database_(path,token){const response=UrlFetchApp.fetch(DATABASE_URL+'/'+path+'.json',{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('Adatbázis hiba');return JSON.parse(response.getContentText())}
function writeDatabase_(path,value,token,method){const response=UrlFetchApp.fetch(DATABASE_URL+'/'+path+'.json',{method:method||'put',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:value===null?'null':JSON.stringify(value),muteHttpExceptions:true});if(response.getResponseCode()>=300)throw new Error('Az értesítési eszköz mentése nem sikerült')}
function compact_(value,max){return String(value||'').slice(0,max||1000)}
function send_(deviceToken,data,token){const response=UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/'+PROJECT_ID+'/messages:send',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({message:{token:deviceToken,data:data,android:{priority:'high',ttl:data.type==='call'?'60s':'86400s'}}}),muteHttpExceptions:true});const text=response.getContentText();if(response.getResponseCode()>=300&&!/UNREGISTERED|INVALID_ARGUMENT/.test(text))throw new Error('FCM küldési hiba')}
function devices_(uid,token){return Object.values(database_('pushDevices/'+encodeURIComponent(uid),token)||{}).filter(d=>d.platform==='android'&&typeof d.token==='string')}
function notify_(event,uid){
  const token=serviceToken_();
  if(event.kind==='register'){
    if((event.platform!=='android'&&event.platform!=='web')||typeof event.deviceId!=='string'||typeof event.token!=='string'||event.deviceId.length<8||event.token.length<20)throw new Error('Érvénytelen értesítési eszköz');
    writeDatabase_('pushDevices/'+encodeURIComponent(uid)+'/'+encodeURIComponent(event.deviceId),{platform:event.platform,token:event.token,updatedAt:Date.now()},token);return;
  }
  if(event.kind==='unregister'){
    if(typeof event.deviceId!=='string'||event.deviceId.length<8)throw new Error('Érvénytelen értesítési eszköz');
    writeDatabase_('pushDevices/'+encodeURIComponent(uid)+'/'+encodeURIComponent(event.deviceId),null,token,'delete');return;
  }
  const avatarData=typeof event.avatarData==='string'&&event.avatarData.indexOf('data:image/')===0&&event.avatarData.length<3500?event.avatarData:'';
  if(event.kind==='message'){
    const chat=database_('conversations/'+encodeURIComponent(event.chatId),token),message=chat&&chat.messages&&chat.messages[event.messageId];if(!chat||!message||message.senderUid!==uid)throw new Error('Az üzenet nem küldhető');
    const group=chat.type==='group',data={type:'message',chatId:compact_(event.chatId),title:group?compact_(chat.name||'Csoport',80):compact_(message.senderName||'Új üzenet',80),body:compact_(message.text||'Fényképet küldött'),senderName:compact_(message.senderName||'Felhasználó',80),isGroup:String(group),groupName:group?compact_(chat.name||'Csoport',80):'',tag:'message-'+compact_(event.messageId),avatarData:avatarData};
    Object.keys(chat.members||{}).filter(id=>chat.members[id]===true&&id!==uid).forEach(id=>devices_(id,token).forEach(d=>send_(d.token,data,token)));return;
  }
  if(event.kind==='call'){
    const call=database_('calls/'+encodeURIComponent(event.callId),token);if(!call||call.callerUid!==uid||call.status!=='ringing'||call.expiresAt<Date.now())throw new Error('A hívás nem küldhető');
    const data={type:'call',callId:compact_(event.callId),chatId:compact_(call.conversationId),title:compact_(call.callerName||'Ismerős',80)+' hív',body:'Bejövő hívás · Koppints a fogadáshoz',tag:'call-'+compact_(event.callId),expiresAt:String(call.expiresAt),avatarData:avatarData};devices_(call.calleeUid,token).forEach(d=>send_(d.token,data,token));return;
  }
  throw new Error('Ismeretlen értesítéstípus');
}
