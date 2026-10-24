package hu.martinroszoly.chat;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name="ChatPhone",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class ChatPhonePlugin extends Plugin {
    private Ringtone ringtone;
    @PluginMethod public void checkForUpdate(PluginCall call){
        new Thread(()->{
            HttpURLConnection connection=null;
            try{
                connection=(HttpURLConnection)new URL("https://api.github.com/repos/martinroszoly/Chat-Alkalmaz-s/releases/latest").openConnection();
                connection.setRequestProperty("Accept","application/vnd.github+json");connection.setRequestProperty("User-Agent","Pulze-pro-Android");connection.setConnectTimeout(8000);connection.setReadTimeout(8000);
                if(connection.getResponseCode()!=200)throw new IllegalStateException("A frissítés ellenőrzése most nem sikerült.");
                StringBuilder body=new StringBuilder();try(InputStream in=connection.getInputStream()){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)body.append(new String(buffer,0,n,java.nio.charset.StandardCharsets.UTF_8));}
                JSONObject release=new JSONObject(body.toString());String releaseTag=release.optString("tag_name","");String releaseBody=release.optString("body","");int versionCode=0;String versionName=releaseTag;java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("versionCode\\s*:\\s*(\\d+)").matcher(releaseBody);if(matcher.find())versionCode=Integer.parseInt(matcher.group(1));java.util.regex.Matcher nameMatcher=java.util.regex.Pattern.compile("versionName\\s*:\\s*([^\\r\\n]+)").matcher(releaseBody);if(nameMatcher.find())versionName=nameMatcher.group(1).trim();
                String apkUrl="";org.json.JSONArray assets=release.optJSONArray("assets");if(assets!=null)for(int i=0;i<assets.length();i++){JSONObject asset=assets.optJSONObject(i);if(asset!=null&&"Pulze-pro.apk".equals(asset.optString("name"))){apkUrl=asset.optString("browser_download_url","");break;}}
                if(versionCode<=0||apkUrl.isEmpty())throw new IllegalStateException("A kiadási csomag még nem érhető el.");
                JSObject result=new JSObject();int installedVersion=getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),0).versionCode;result.put("available",versionCode>installedVersion);result.put("versionCode",versionCode);result.put("versionName",versionName);result.put("apkUrl",apkUrl);call.resolve(result);
            }catch(Exception e){call.reject(e.getMessage()==null?"A frissítés nem ellenőrizhető.":e.getMessage(),e);}finally{if(connection!=null)connection.disconnect();}
        }).start();
    }
    @PluginMethod public void installAppUpdate(PluginCall call){
        String apkUrl=call.getString("apkUrl","");
        if(!apkUrl.startsWith("https://github.com/martinroszoly/Chat-Alkalmaz-s/releases/download/")){call.reject("Érvénytelen frissítési cím.");return;}
        if(Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){
            try{Intent settings=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName()));settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);getContext().startActivity(settings);JSObject result=new JSObject();result.put("needsPermission",true);call.resolve(result);}catch(Exception e){call.reject("Engedélyezd az alkalmazástelepítést a telefon beállításaiban.",e);}return;
        }
        call.setKeepAlive(true);
        new Thread(()->{
            HttpURLConnection connection=null;
            try{
                connection=(HttpURLConnection)new URL(apkUrl).openConnection();connection.setInstanceFollowRedirects(true);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
                if(connection.getResponseCode()!=200)throw new IllegalStateException("Az APK letöltése nem sikerült.");
                long length=connection.getContentLengthLong();if(length>100L*1024*1024)throw new IllegalStateException("A frissítőfájl túl nagy.");
                File folder=new File(getContext().getCacheDir(),"updates");if(!folder.exists()&&!folder.mkdirs())throw new IllegalStateException("Nem sikerült előkészíteni a frissítést.");
                File apk=new File(folder,"Pulze-pro.apk");try(InputStream in=connection.getInputStream();FileOutputStream out=new FileOutputStream(apk)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
                Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",apk);Intent install=new Intent(Intent.ACTION_VIEW);install.setDataAndType(uri,"application/vnd.android.package-archive");install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);getContext().startActivity(install);call.resolve(new JSObject());
            }catch(Exception e){call.reject(e.getMessage()==null?"A frissítés telepítője nem indítható el.":e.getMessage(),e);}finally{if(connection!=null)connection.disconnect();}
        }).start();
    }
    @PluginMethod public void registerPush(PluginCall call) {
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"notificationPermission");return;}
        registerToken(call);
    }
    @PermissionCallback private void notificationPermission(PluginCall call){if(getPermissionState("notifications")==PermissionState.GRANTED)registerToken(call);else call.reject("Engedélyezd az értesítéseket a telefon beállításaiban");}
    private void registerToken(PluginCall call){
        try{FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->{
            if(!task.isSuccessful()){call.reject("Firebase értesítésregisztráció sikertelen",task.getException());return;}
            JSObject token=new JSObject();token.put("token",task.getResult());token.put("platform","android");notifyListeners("pushToken",token,true);call.resolve(token);
        });}catch(Exception e){call.reject("A Firebase Android konfiguráció hiányzik",e);}
    }
    @PluginMethod public void getPendingAction(PluginCall call){JSObject data=route(getActivity().getIntent());getActivity().getIntent().removeExtra("chatId");getActivity().getIntent().removeExtra("callId");getActivity().getIntent().removeExtra("action");call.resolve(data);}
    static JSObject route(Intent i){JSObject data=new JSObject();if(i!=null)for(String k:new String[]{"chatId","callId","action"})if(i.hasExtra(k))data.put(k,i.getStringExtra(k));return data;}
    @Override protected void handleOnNewIntent(Intent i){getActivity().setIntent(i);notifyListeners("notificationAction",route(i),true);}
    @PluginMethod public void clearChatNotifications(PluginCall call){
        String chatId=call.getString("chatId","");
        if(chatId.isEmpty()){call.reject("Hiányzó beszélgetésazonosító");return;}
        android.app.NotificationManager manager=getContext().getSystemService(android.app.NotificationManager.class);
        if(Build.VERSION.SDK_INT>=23){for(android.service.notification.StatusBarNotification item:manager.getActiveNotifications())if(("pulze-chat-"+chatId).equals(item.getNotification().getGroup()))manager.cancel(item.getId());}
        call.resolve();
    }
    @PluginMethod public void reportIncomingCall(PluginCall call){String id=call.getString("callId","");ChatNotifications.incoming(getContext(),id,call.getString("name","Ismerős"),call.getLong("expiresAt",System.currentTimeMillis()+60000),null);call.resolve();}
    @PluginMethod public void startCall(PluginCall call){startOngoing(call);}
    @PluginMethod public void acceptCall(PluginCall call){stopRingtoneNow();ChatNotifications.cancel(getContext(),call.getString("callId",""));startOngoing(call);}
    private void startOngoing(PluginCall call){
        Intent intent=new Intent(getContext(),ActiveCallService.class);intent.putExtra("callId",call.getString("callId",""));intent.putExtra("name",call.getString("name","Hívás"));
        try{getContext().startForegroundService(intent);call.resolve();}catch(Exception e){call.reject("A háttérhívást nem lehet elindítani",e);}
    }
    @PluginMethod public void endCall(PluginCall call){stopRingtoneNow();ChatNotifications.cancel(getContext(),call.getString("callId",""));getContext().stopService(new Intent(getContext(),ActiveCallService.class));resetAudioRouting();call.resolve();}
    @PluginMethod public void setSpeaker(PluginCall call){try{setSpeakerNow(Boolean.TRUE.equals(call.getBoolean("enabled",false)));call.resolve();}catch(Exception e){call.reject("A kihangosítás nem állítható",e);}}
    private void setSpeakerNow(boolean enabled){
        AudioManager audio=(AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if(Build.VERSION.SDK_INT>=31){
            AudioDeviceInfo target=null;for(AudioDeviceInfo d:audio.getAvailableCommunicationDevices())if(d.getType()==(enabled?AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)){target=d;break;}
            if(target!=null&&!audio.setCommunicationDevice(target))throw new IllegalStateException("Nem sikerült hangkimenetet váltani");
            else if(target==null&&enabled)throw new IllegalStateException("Nem érhető el kihangosító");else if(target==null)audio.clearCommunicationDevice();
        }else audio.setSpeakerphoneOn(enabled);
    }
    private void resetAudioRouting(){
        AudioManager audio=(AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);
        if(Build.VERSION.SDK_INT>=31)audio.clearCommunicationDevice();else audio.setSpeakerphoneOn(false);
        audio.setMode(AudioManager.MODE_NORMAL);
    }
    @PluginMethod public void startRingtone(PluginCall call){stopRingtoneNow();ringtone=RingtoneManager.getRingtone(getContext(),RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));if(ringtone!=null){if(Build.VERSION.SDK_INT>=28)ringtone.setLooping(true);ringtone.play();}call.resolve();}
    @PluginMethod public void stopRingtone(PluginCall call){stopRingtoneNow();call.resolve();}
    private void stopRingtoneNow(){if(ringtone!=null){ringtone.stop();ringtone=null;}}
    @Override protected void handleOnDestroy(){stopRingtoneNow();}
}
