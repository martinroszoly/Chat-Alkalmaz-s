package hu.martinroszoly.chat;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name="ChatPhone",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class ChatPhonePlugin extends Plugin {
    private Ringtone ringtone;
    @PluginMethod public void registerPush(PluginCall call) {
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"notificationPermission");return;}
        registerToken(call);
    }
    @PermissionCallback private void notificationPermission(PluginCall call){if(getPermissionState("notifications")==PermissionState.GRANTED)registerToken(call);else call.reject("Engedélyezd az értesítéseket a telefon beállításaiban");}
    private void registerToken(PluginCall call){
        try{FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->{
            if(!task.isSuccessful()){call.reject("Firebase értesítésregisztráció sikertelen",task.getException());return;}
            JSObject token=new JSObject();token.put("token",task.getResult());token.put("platform","android");notifyListeners("pushToken",token,true);call.resolve();
        });}catch(Exception e){call.reject("A Firebase Android konfiguráció hiányzik",e);}
    }
    @PluginMethod public void getPendingAction(PluginCall call){JSObject data=route(getActivity().getIntent());getActivity().getIntent().removeExtra("chatId");getActivity().getIntent().removeExtra("callId");getActivity().getIntent().removeExtra("action");call.resolve(data);}
    static JSObject route(Intent i){JSObject data=new JSObject();if(i!=null)for(String k:new String[]{"chatId","callId","action"})if(i.hasExtra(k))data.put(k,i.getStringExtra(k));return data;}
    @Override protected void handleOnNewIntent(Intent i){getActivity().setIntent(i);notifyListeners("notificationAction",route(i),true);}
    @PluginMethod public void reportIncomingCall(PluginCall call){String id=call.getString("callId","");ChatNotifications.incoming(getContext(),id,call.getString("name","Ismerős"),call.getLong("expiresAt",System.currentTimeMillis()+60000),null);call.resolve();}
    @PluginMethod public void startCall(PluginCall call){startOngoing(call);}
    @PluginMethod public void acceptCall(PluginCall call){stopRingtoneNow();ChatNotifications.cancel(getContext(),call.getString("callId",""));startOngoing(call);}
    private void startOngoing(PluginCall call){
        Intent intent=new Intent(getContext(),ActiveCallService.class);intent.putExtra("callId",call.getString("callId",""));intent.putExtra("name",call.getString("name","Hívás"));
        try{getContext().startForegroundService(intent);call.resolve();}catch(Exception e){call.reject("A háttérhívást nem lehet elindítani",e);}
    }
    @PluginMethod public void endCall(PluginCall call){stopRingtoneNow();ChatNotifications.cancel(getContext(),call.getString("callId",""));getContext().stopService(new Intent(getContext(),ActiveCallService.class));setSpeakerNow(false);call.resolve();}
    @PluginMethod public void setSpeaker(PluginCall call){try{setSpeakerNow(Boolean.TRUE.equals(call.getBoolean("enabled",false)));call.resolve();}catch(Exception e){call.reject("A kihangosítás nem állítható",e);}}
    private void setSpeakerNow(boolean enabled){
        AudioManager audio=(AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if(Build.VERSION.SDK_INT>=31){
            AudioDeviceInfo target=null;for(AudioDeviceInfo d:audio.getAvailableCommunicationDevices())if(d.getType()==(enabled?AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)){target=d;break;}
            if(target!=null&&!audio.setCommunicationDevice(target))throw new IllegalStateException("Nem sikerült hangkimenetet váltani");
            else if(target==null&&enabled)throw new IllegalStateException("Nem érhető el kihangosító");else if(target==null)audio.clearCommunicationDevice();
        }else audio.setSpeakerphoneOn(enabled);
    }
    @PluginMethod public void startRingtone(PluginCall call){stopRingtoneNow();ringtone=RingtoneManager.getRingtone(getContext(),RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));if(ringtone!=null){if(Build.VERSION.SDK_INT>=28)ringtone.setLooping(true);ringtone.play();}call.resolve();}
    @PluginMethod public void stopRingtone(PluginCall call){stopRingtoneNow();call.resolve();}
    private void stopRingtoneNow(){if(ringtone!=null){ringtone.stop();ringtone=null;}}
    @Override protected void handleOnDestroy(){stopRingtoneNow();}
}
