const {getStorage}=require('firebase-admin/storage');
const {getDatabase}=require('firebase-admin/database');
const crypto=require('node:crypto');
module.exports=async uid=>{
  try{
    const p=(await getDatabase(undefined,'https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app').ref('publicProfiles/'+uid+'/avatar').get()).val()||'';
    if(p.startsWith('https://'))return p;
    const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p);if(!match)return '';
    const buffer=Buffer.from(match[2],'base64');if(buffer.length>900000)return '';
    const key=crypto.createHash('sha256').update(buffer).digest('hex');
    const file=getStorage().bucket('chat-alkalmazas-578c8.firebasestorage.app').file('notification-avatars/'+uid+'/'+key+'.'+match[1]);
    if(!(await file.exists())[0])await file.save(buffer,{metadata:{contentType:'image/'+match[1],cacheControl:'private,max-age=86400'}});
    return(await file.getSignedUrl({action:'read',expires:Date.now()+86400000}))[0];
  }catch(e){console.warn('Notification avatar unavailable',e.code||e.message);return '';}
};
