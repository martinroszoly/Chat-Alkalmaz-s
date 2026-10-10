const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {initializeApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getDatabase}=require("firebase-admin/database");
initializeApp();
const DB_URL="https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app";
const database=()=>getDatabase(undefined,DB_URL);
const OWNER="martin.roszoly2002@gmail.com";
function requireOwner(request){
  const token=request.auth&&request.auth.token;
  if(!token||token.email_verified!==true||(token.email||"").toLowerCase()!==OWNER){
    throw new HttpsError("permission-denied","Tulajdonosi hozzáférés szükséges.");
  }
}
const safeText=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
exports.adminListProfiles=onCall({region:"europe-west1"},async request=>{
  requireOwner(request);
  const auth=getAuth(),db=database();
  const profiles=(await db.ref("users").get()).val()||{};
  const users=[];let pageToken;
  do{
    const page=await auth.listUsers(1000,pageToken);
    for(const user of page.users){
      const data=profiles[user.uid]||{};
      users.push({uid:user.uid,email:user.email||"",username:data.username||user.displayName||"",avatar:data.avatar||user.photoURL||"",disabled:user.disabled===true});
    }
    pageToken=page.pageToken;
  }while(pageToken);
  return {profiles:users};
});
exports.adminUpdateProfile=onCall({region:"europe-west1"},async request=>{
  requireOwner(request);
  const uid=safeText(request.data&&request.data.uid,128);
  const username=safeText(request.data&&request.data.username,40);
  const avatar=request.data&&request.data.avatar;
  if(!uid||username.length<2)throw new HttpsError("invalid-argument","Adj meg érvényes nevet.");
  if(uid===request.auth.uid)throw new HttpsError("failed-precondition","A tulajdonosi profilt itt nem lehet módosítani.");
  if(typeof avatar!=="string"||avatar.length>2800000||!(avatar.startsWith("data:image/")||avatar.startsWith("https://")||avatar===""))throw new HttpsError("invalid-argument","Érvénytelen profilkép.");
  const user=await getAuth().getUser(uid);
  if(user.disabled)throw new HttpsError("failed-precondition","A kitiltott profilt nem lehet módosítani.");
  await getAuth().updateUser(uid,{displayName:username});
  await database().ref("users/"+uid).update({username,avatar,email:user.email||""});
  return {ok:true};
});
exports.adminBanProfile=onCall({region:"europe-west1"},async request=>{
  requireOwner(request);
  const uid=safeText(request.data&&request.data.uid,128);
  if(!uid||uid===request.auth.uid)throw new HttpsError("failed-precondition","A tulajdonosi fiók nem tiltható ki.");
  const auth=getAuth(),db=database(),user=await auth.getUser(uid);
  if((user.email||"").toLowerCase()===OWNER)throw new HttpsError("failed-precondition","A tulajdonosi fiók nem tiltható ki.");
  await db.ref("bannedUsers/"+uid).set({email:user.email||"",bannedAt:Date.now()});
  await auth.updateUser(uid,{disabled:true});
  await auth.revokeRefreshTokens(uid);
  await db.ref("users/"+uid).remove();
  return {ok:true};
});
// Mobile and web push delivery; device tokens are stored only through authenticated callables.
const pushFunctions=require('./push');
for(const [name,fn]of Object.entries(pushFunctions))if(name!=='_helpers')exports[name]=fn;
Object.assign(exports,require('./apple-push'));
