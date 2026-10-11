/* Shared call screen and WebRTC lifecycle for web, Android and iOS. */
let localCallStream = null, callGeneration = 0, callTimeout = null, durationTimer = null;
let callSpeaker = false, ringTimer = null, ringContext = null;
function setCallAvatar(src) {
  const avatar = document.getElementById('callAvatar');
  avatar.replaceChildren();
  if (src) { const image = new Image(); image.src = src; image.alt = ''; avatar.append(image); }
  else avatar.textContent = '♙';
}
function showCallOverlay(title, status, incoming = false, avatar = '') {
  document.getElementById('callTitle').textContent = title || 'Hívás';
  document.getElementById('callStatus').textContent = status || '';
  if (avatar) setCallAvatar(avatar);
  document.getElementById('callAcceptButton').hidden = !incoming;
  document.getElementById('callDeclineButton').hidden = !incoming;
  document.getElementById('callHangupButton').hidden = incoming;
  document.getElementById('callSpeakerButton').hidden = incoming;
  document.getElementById('callOverlay').style.display = 'grid';
}
function hideCallOverlay() { document.getElementById('callOverlay').style.display = 'none'; }
function ringIncomingCall() {
  stopCallRingtone();
  if (window.ChatNative?.isNative) { window.ChatNative.phone.startRingtone().catch(console.warn); return; }
  // Browsers cannot access the device's default ringtone; this is the web fallback.
  try {
    ringContext = new (window.AudioContext || window.webkitAudioContext)();
    const ring = () => { if (!ringContext) return; const ctx = ringContext;
      for (const offset of [0, .3]) { const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=660;g.gain.value=.07;o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+offset);o.stop(ctx.currentTime+offset+.2); }
    }; ring(); ringTimer = setInterval(ring, 1800);
  } catch { /* Autoplay may require an earlier user gesture. */ }
}
function stopCallRingtone() {
  clearInterval(ringTimer); ringTimer=null;
  if (ringContext) { ringContext.close().catch(()=>{}); ringContext=null; }
  window.ChatNative?.phone.stopRingtone().catch(console.warn);
}
function showIncomingCall(call) {
  setCallAvatar(call.callerAvatar || '');
  showCallOverlay(call.callerName || 'Ismerős', 'Bejövő hívás', true);
  ringIncomingCall();
  window.ChatMobile?.alertCall(call);
}
async function waitForIce(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise(resolve => {
    let timer; const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};
    const check=()=>{if(pc.iceGatheringState==='complete')done();};
    pc.addEventListener('icegatheringstatechange',check); timer=setTimeout(done,10000);
  });
}
async function makeCallPeer() {
  let config;try{config=await window.chatFirebase.getCallIceServers();}catch(e){if(!['functions/not-found','functions/unavailable','functions/internal'].includes(e.code))throw e;config={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};}
  const pc = new RTCPeerConnection({iceServers: config.iceServers});
  pc.ontrack = e => {
    const audio = document.getElementById('remoteCallAudio');
    audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(console.warn);
  };
  pc.onconnectionstatechange = () => {
    if (activePhoneCall?.pc !== pc) return;
    if (pc.connectionState==='connected') {
      clearTimeout(callTimeout); document.getElementById('callStatus').textContent='Hívás folyamatban';
      if (!durationTimer) { const since=Date.now(); durationTimer=setInterval(()=>{
        const seconds=Math.floor((Date.now()-since)/1000);
        document.getElementById('callDuration').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
      },1000); }
    } else if (pc.connectionState==='failed') { toast('A híváskapcsolat megszakadt');endPhoneCall(); }
  };
  return pc;
}
function watchActiveCall(call) {
  call.stops.push(window.chatFirebase.watchCall(call.id, async data => {
    if (activePhoneCall !== call) return;
    if (!data || ['ended','declined'].includes(data.status)) {releasePhoneCall();toast('A hívás véget ért');return;}
    if (data.answer && !call.remoteSet) {
      call.remoteSet=true;
      try { await call.pc.setRemoteDescription(data.answer);for(const c of call.queuedIce||[])await call.pc.addIceCandidate(c);call.queuedIce=[]; }
      catch(e) { if(activePhoneCall===call){toast('A hívás nem kapcsolható');endPhoneCall();} }
    }
  }));
  call.stops.push(window.chatFirebase.watchCallCandidates(call.id,call.side==='caller'?'callee':'caller',async candidate=>{
    if(!call.pc.remoteDescription){(call.queuedIce??=[]).push(candidate);return;}
    try {await call.pc.addIceCandidate(candidate);} catch(e){if(activePhoneCall===call)console.warn(e);}
  }));
}
function publishIce(call, candidates) {
  const send=c=>window.chatFirebase.addCallCandidate(call.id,call.side,c).catch(console.warn);
  candidates.forEach(send);call.pc.onicecandidate=e=>{if(e.candidate)send(e.candidate.toJSON());};
}
function releasePhoneCall() {
  callGeneration++; clearTimeout(callTimeout);clearInterval(durationTimer);durationTimer=null;
  document.getElementById('callDuration').textContent='';stopCallRingtone();
  const call=activePhoneCall;activePhoneCall=null;
  if(call){for(const stop of call.stops||[])stop();call.pc?.close();if(call.id)window.ChatNative?.phone.endCall({callId:call.id}).catch(console.warn);}
  if(pendingPhoneCall?.id)window.ChatNative?.phone.endCall({callId:pendingPhoneCall.id}).catch(console.warn);
  localCallStream?.getTracks().forEach(t=>t.stop());localCallStream=null;pendingPhoneCall=null;
  document.getElementById('remoteCallAudio').srcObject=null;
  callSpeaker=false;document.getElementById('callSpeakerButton').setAttribute('aria-pressed','false');
  window.ChatNative?.phone.setSpeaker({enabled:false}).catch(console.warn);hideCallOverlay();
}
async function startPhoneCall() {
  if(activePhoneCall||pendingPhoneCall){toast('Már van folyamatban lévő hívás');return;}
  const chat=chats.find(c=>c.id===current);
  if(!chat?.remote||chat.group||!chat.peerUid){toast('Hívás csak privát beszélgetésben indítható');return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){toast('Ezen az eszközön nem érhető el a hívás');return;}
  const generation=++callGeneration,session={peerUid:chat.peerUid,stops:[],side:'caller'};activePhoneCall=session;
  setCallAvatar(chat.avatar||'');showCallOverlay(chat.name,'Mikrofon engedélyezése…');
  try {
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(generation!==callGeneration){stream.getTracks().forEach(t=>t.stop());return;}localCallStream=stream;
    const pc=await makeCallPeer();if(generation!==callGeneration){pc.close();return;}session.pc=pc;
    const candidates=[];pc.onicecandidate=e=>{if(e.candidate)candidates.push(e.candidate.toJSON());};
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));await pc.setLocalDescription(await pc.createOffer());await waitForIce(pc);
    if(generation!==callGeneration)return;
    const id=await window.chatFirebase.createCall(chat.peerUid,pc.localDescription.toJSON(),chat.id);
    if(generation!==callGeneration){await window.chatFirebase.setCallStatus(id,'ended');await window.chatFirebase.clearCallInbox(chat.peerUid,id);return;}
    session.id=id;publishIce(session,candidates);watchActiveCall(session);showCallOverlay(chat.name,'Kicseng…');
    callTimeout=setTimeout(()=>{if(activePhoneCall===session){toast('Nem fogadták a hívást');endPhoneCall();}},60000);
    await window.ChatNative?.phone.startCall({callId:id,name:chat.name});
  } catch(e) { if(generation===callGeneration){await endPhoneCall();toast(e.name==='NotAllowedError'?'Engedélyezd a mikrofont a híváshoz':e.message||'Nem indítható hívás');} }
}
async function acceptPhoneCall() {
  const incoming=pendingPhoneCall;if(!incoming||activePhoneCall)return;
  const generation=++callGeneration,session={id:incoming.id,peerUid:incoming.callerUid,stops:[],side:'callee',remoteSet:true};activePhoneCall=session;
  stopCallRingtone();showCallOverlay(incoming.callerName,'Kapcsolódás…',false,incoming.callerAvatar);
  try {
    const fresh=await window.chatFirebase.getCall(incoming.id);
    if(!fresh||fresh.status!=='ringing'||(fresh.expiresAt||fresh.createdAt+60000)<Date.now())throw new Error('Ez a hívás már véget ért');
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(generation!==callGeneration){stream.getTracks().forEach(t=>t.stop());return;}localCallStream=stream;
    const pc=await makeCallPeer();if(generation!==callGeneration){pc.close();return;}session.pc=pc;
    const candidates=[];pc.onicecandidate=e=>{if(e.candidate)candidates.push(e.candidate.toJSON());};
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));await pc.setRemoteDescription(incoming.offer);await pc.setLocalDescription(await pc.createAnswer());await waitForIce(pc);
    if(generation!==callGeneration)return;
    const latest=await window.chatFirebase.getCall(incoming.id);if(latest?.status!=='ringing')throw new Error('A hívó befejezte a hívást');
    await window.chatFirebase.answerCall(incoming.id,pc.localDescription.toJSON());
    if(generation!==callGeneration)return;
    pendingPhoneCall=null;await window.chatFirebase.clearCallInbox(firebaseUser.uid,incoming.id);
    publishIce(session,candidates);watchActiveCall(session);
    callTimeout=setTimeout(()=>{if(activePhoneCall===session&&pc.connectionState!=='connected'){toast('Nem sikerült kapcsolódni');endPhoneCall();}},30000);
    await window.ChatNative?.phone.acceptCall({callId:incoming.id,name:incoming.callerName||'Hívás'});
  } catch(e){if(generation===callGeneration){await endPhoneCall();toast(e.message||'Nem sikerült fogadni a hívást');}}
}
async function declinePhoneCall() {
  const incoming=pendingPhoneCall;releasePhoneCall();
  if(incoming)try{await window.chatFirebase.setCallStatus(incoming.id,'declined');await window.chatFirebase.clearCallInbox(firebaseUser.uid,incoming.id);}catch(e){toast('A hívás elutasítása nem jutott el a szerverhez');console.warn(e);}
}
async function endPhoneCall() {
  const call=activePhoneCall||pendingPhoneCall;releasePhoneCall();
  if(call?.id)try{const latest=await window.chatFirebase.getCall(call.id);if(latest&&['ringing','answered'].includes(latest.status))await window.chatFirebase.setCallStatus(call.id,'ended');await window.chatFirebase.clearCallInbox(call.side==='caller'?call.peerUid:firebaseUser.uid,call.id);}catch(e){toast('A hívás lezárása nem jutott el a szerverhez');console.warn(e);}
}
async function toggleCallSpeaker() {
  const enabled=!callSpeaker;
  try {
    if(window.ChatNative?.isNative)await window.ChatNative.phone.setSpeaker({enabled});
    else {
      const audio=document.getElementById('remoteCallAudio');
      if(!audio.setSinkId)throw new Error('A böngészőben a telefon saját hangkimenet-választójával válts kihangosításra');
      const devices=await navigator.mediaDevices.enumerateDevices(),speaker=devices.find(d=>d.kind==='audiooutput'&&/speaker|hangszóró/i.test(d.label));
      if(enabled&&!speaker)throw new Error('A böngésző nem ad hozzáférést külön kihangosítóhoz');
      await audio.setSinkId(enabled?speaker.deviceId:'default');
    }
    callSpeaker=enabled;document.getElementById('callSpeakerButton').setAttribute('aria-pressed',String(enabled));
  }catch(e){toast(e.message||'Nem sikerült hangkimenetet váltani');}
}

/* Visual and interaction fixes loaded after the chat UI is available. */
(() => {
  const css = `.group-photo-actions button{min-height:43px;padding:10px 14px;border:1px solid #3b6479!important;border-radius:10px!important;background:#19364b!important;color:#eaf7fb!important;font:700 14px 'DM Sans',sans-serif!important;white-space:nowrap;box-shadow:none!important}.group-photo-actions button+button{border-color:#6a4a57!important;background:#352633!important;color:#ffdce4!important}.group-delete{margin-right:auto!important;background:#b92745!important;color:#fff!important}.person.selected{background:transparent!important;box-shadow:none!important}.nav-alert:not([hidden]){display:inline-grid!important;place-items:center!important;background:#ef3d5d!important;color:#fff!important}.call-control .phone-icon{width:30px;height:30px;fill:currentColor;display:block}`;
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  isGroupCreator=c=>!!(c&&c.group&&((c.owner&&c.owner===firebaseUser?.uid)||(!c.owner&&c.createdBy&&c.createdBy===currentUserKey())));
  const actions=document.querySelector('#groupSettingsModal .modal-actions');
  if(actions&&!document.getElementById('deleteGroupButton')){const button=document.createElement('button');button.id='deleteGroupButton';button.type='button';button.className='group-delete';button.textContent='Csoport törlése';button.hidden=true;button.onclick=async()=>{const c=chats.find(x=>x.id===current);if(!c||!isGroupCreator(c))return;if(!confirm('Biztosan törlöd a „'+c.name+'” csoportot? Ez minden tagnál eltűnik.'))return;try{await window.chatFirebase.deleteGroup(c.id);chats=chats.filter(x=>x.id!==c.id);current=null;persist();closeGroupSettings();renderMessages();renderList();showChats();toast('A csoport törölve')}catch(e){toast(e.message||'A csoport törlése sikertelen')}};actions.prepend(button)}
  async function refreshProfileDetails(){if(!window.chatFirebase||!firebaseUser?.uid)return;let changed=false,profiles=new Map();for(const c of chats.filter(x=>x.remote)){if(!c.group&&!c.peerUid&&c.id)try{const fresh=await window.chatFirebase.getConversation(c.id);if(fresh?.peerUid){c.peerUid=fresh.peerUid;changed=true}}catch{}let ids=c.group?[firebaseUser.uid,...new Set((c.messages||[]).map(m=>m[8]).filter(Boolean))]:[firebaseUser.uid,c.peerUid].filter(Boolean);for(const id of ids)if(!profiles.has(id))try{profiles.set(id,await window.chatFirebase.getPublicProfile(id))}catch{profiles.set(id,null)}if(!c.group){const p=profiles.get(c.peerUid);if(p&&(c.name!==p.name||c.avatar!==p.avatar)){c.name=p.name;c.avatar=p.avatar||'';changed=true}}for(const m of c.messages||[]){const p=profiles.get(m[8]);if(p&&(m[10]!==p.name||m[4]!==p.avatar)){m[10]=p.name;m[4]=p.avatar||'';changed=true}}}if(changed){persist();renderList();if(current)renderMessages()}}
  if(typeof messageProfile==='function')messageProfile=async function(){if(!activeProfile)return;try{const id=await window.chatFirebase.createPrivateConversation(activeProfile.id,activeProfile);let c=chats.find(x=>x.remote&&x.id===id),fresh=await window.chatFirebase.getConversation(id);if(fresh){const i=chats.findIndex(x=>x.id===id);if(i<0)chats.unshift(fresh);else chats[i]={...chats[i],...fresh};c=chats.find(x=>x.id===id)}if(!c){c={id,name:activeProfile.name,avatar:activeProfile.avatar||'',peerUid:activeProfile.id,remote:true,group:false,messages:[],unread:0,last:'Még nincs üzenet',time:''};chats.unshift(c)}showChats();selectChat(c.id);renderList();await refreshProfileDetails()}catch(e){toast(e.message||'A beszélgetés nem indítható el')}};
  if(typeof openGroupSettings==='function'){const originalOpenGroupSettings=openGroupSettings;openGroupSettings=function(){const button=document.getElementById('deleteGroupButton'),c=chats.find(x=>x.id===current);if(button)button.hidden=!isGroupCreator(c);return originalOpenGroupSettings()}}
  let profileRefreshTimer=0;
  const scheduleProfileRefresh=()=>{clearTimeout(profileRefreshTimer);profileRefreshTimer=setTimeout(()=>refreshProfileDetails().catch(console.warn),40)};
  if(typeof mergeRemoteChat==='function'){const originalMergeRemoteChat=mergeRemoteChat;mergeRemoteChat=function(remote){originalMergeRemoteChat(remote);scheduleProfileRefresh()}}
  if(typeof window.applyFirebaseAccount==='function'){const originalApplyFirebaseAccount=window.applyFirebaseAccount;window.applyFirebaseAccount=async function(...args){const result=await originalApplyFirebaseAccount.apply(this,args);scheduleProfileRefresh();return result}}
  setTimeout(scheduleProfileRefresh,0);
  window.addEventListener?.('focus',refreshProfileDetails);
  document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)refreshProfileDetails()});
})();
