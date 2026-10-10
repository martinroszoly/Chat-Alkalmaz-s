const {defineSecret}=require('firebase-functions/params');
const {onValueCreated}=require('firebase-functions/v2/database');
const {getDatabase}=require('firebase-admin/database');
const crypto=require('node:crypto'),http2=require('node:http2');
const {messagePayload,callPayload}=require('./push')._helpers;
const notificationAvatar=require('./notification-avatar');
const config=defineSecret('APPLE_PUSH_CONFIG');
const opts={region:'europe-west1',instance:'chat-alkalmazas-578c8-default-rtdb',secrets:[config],retry:true};
const db=()=>getDatabase(undefined,'https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app');
function appleJwt(c){
  const head=Buffer.from(JSON.stringify({alg:'ES256',kid:c.keyId})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:c.teamId,iat:Math.floor(Date.now()/1000)})).toString('base64url');
  const signature=crypto.sign('sha256',Buffer.from(head+'.'+body),{key:c.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return head+'.'+body+'.'+signature;
}
async function send(uid,data,voip=false){
  const c=JSON.parse(config.value()),devices=(await db().ref('pushDevices/'+uid).get()).val()||{};
  await Promise.all(Object.entries(devices).filter(([,d])=>d.platform==='ios'&&d.updatedAt>Date.now()-60*86400000).map(async([id,d])=>{
    const token=voip?d.voipToken:d.token;if(!token)return;
    const session=http2.connect(c.production?'https://api.push.apple.com':'https://api.sandbox.push.apple.com');
    try{
      await new Promise((resolve,reject)=>{
        const req=session.request({':method':'POST',':path':'/3/device/'+token,authorization:'bearer '+appleJwt(c),'apns-topic':c.bundleId+(voip?'.voip':''),'apns-push-type':voip?'voip':'alert','apns-priority':'10','apns-expiration':voip?'0':String(Math.floor(Date.now()/1000)+86400),'apns-collapse-id':data.tag.slice(0,64)});
        let status;req.on('response',h=>status=h[':status']);req.on('data',()=>{});req.on('error',reject);session.on('error',reject);
        req.on('end',async()=>{if(status===200)resolve();else if(status===410||status===400){await db().ref('pushDevices/'+uid+'/'+id+'/'+(voip?'voipToken':'token')).remove();resolve();}else reject(new Error('APNs delivery failed: '+status));});
        req.end(JSON.stringify(voip?{aps:{},...data}:{aps:{alert:{title:data.title,subtitle:data.isGroup==='true'?data.senderName:'',body:data.body},sound:'default','mutable-content':1,'thread-id':data.chatId},...data}));
      });
    }finally{session.close();}
  }));
}
exports.sendAppleMessagePush=onValueCreated({...opts,ref:'/conversations/{chatId}/messages/{messageId}'},async e=>{
  const m=e.data.val();if(m.expiresAt&&m.expiresAt<Date.now())return;
  const members=(await db().ref('conversations/'+e.params.chatId+'/members').get()).val()||{};
  const p=messagePayload(e.params.chatId,e.params.messageId,m),conversation=(await db().ref('conversations/'+e.params.chatId).get()).val()||{};p.senderName=String(m.senderName||'Felhasználó').slice(0,80);p.isGroup=String(conversation.type==='group');p.groupName=conversation.type==='group'?String(conversation.name||'Csoport').slice(0,80):'';p.avatarUrl=await notificationAvatar(m.senderUid);if(p.groupName)p.title=p.groupName;await Promise.all(Object.keys(members).filter(uid=>members[uid]===true&&uid!==m.senderUid).map(uid=>send(uid,p)));
});
exports.sendAppleCallPush=onValueCreated({...opts,ref:'/calls/{callId}'},async e=>{
  const call=e.data.val();if(call.status!=='ringing'||(call.expiresAt||call.createdAt+60000)<Date.now())return;
  await send(call.calleeUid,callPayload(e.params.callId,call),true);
});
