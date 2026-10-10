package hu.martinroszoly.chat;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.media.AudioManager;
import androidx.core.app.NotificationCompat;
public class ActiveCallService extends Service {
    @Override public int onStartCommand(Intent i,int flags,int startId){
        ChatNotifications.channels(this);String id=i.getStringExtra("callId");
        Notification n=new NotificationCompat.Builder(this,ChatNotifications.ACTIVE).setSmallIcon(R.drawable.ic_notification).setContentTitle(i.getStringExtra("name")).setContentText("Hívás folyamatban").setOngoing(true).setCategory(NotificationCompat.CATEGORY_CALL).setContentIntent(ChatNotifications.route(this,null,id,"open")).addAction(0,"Lerakás",ChatNotifications.route(this,null,id,"end")).build();
        if(Build.VERSION.SDK_INT>=29)startForeground(8801,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);else startForeground(8801,n);return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onDestroy(){AudioManager a=getSystemService(AudioManager.class);if(Build.VERSION.SDK_INT>=31)a.clearCommunicationDevice();a.setMode(AudioManager.MODE_NORMAL);super.onDestroy();}
}
