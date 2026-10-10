package hu.martinroszoly.chat;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import java.util.Map;

public class ChatNotifications {
    static final String MESSAGES="chat_messages_v1",CALLS="chat_calls_v1",ACTIVE="chat_active_calls_v1";
    static int id(String key){return key.hashCode()&0x7fffffff;}
    static void channels(Context c){
        NotificationManager nm=c.getSystemService(NotificationManager.class);
        NotificationChannel messages=new NotificationChannel(MESSAGES,"Pulse üzenetek",NotificationManager.IMPORTANCE_HIGH);messages.enableVibration(true);messages.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());nm.createNotificationChannel(messages);
        NotificationChannel calls=new NotificationChannel(CALLS,"Bejövő hívások",NotificationManager.IMPORTANCE_HIGH);calls.enableVibration(true);calls.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());nm.createNotificationChannel(calls);
        nm.createNotificationChannel(new NotificationChannel(ACTIVE,"Folyamatban lévő hívás",NotificationManager.IMPORTANCE_LOW));
    }
    static PendingIntent route(Context c,String chat,String call,String action){
        Intent i=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if(chat!=null)i.putExtra("chatId",chat);if(call!=null)i.putExtra("callId",call);if(action!=null)i.putExtra("action",action);
        i.setData(android.net.Uri.parse("chatapp://notification/"+(call!=null?call:chat)+"/"+action));
        return PendingIntent.getActivity(c,id(i.getDataString()),i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void message(Context c,Map<String,String>d,Bitmap avatar){
        channels(c);Person.Builder sender=new Person.Builder().setName(d.getOrDefault("senderName",d.getOrDefault("title","Felhasználó")));
        if(avatar!=null)sender.setIcon(IconCompat.createWithBitmap(avatar));
        boolean group="true".equals(d.get("isGroup"));
        NotificationCompat.MessagingStyle style=new NotificationCompat.MessagingStyle(new Person.Builder().setName("Te").build()).setGroupConversation(group).addMessage(d.getOrDefault("body",""),System.currentTimeMillis(),sender.build());
        if(group)style.setConversationTitle(d.getOrDefault("groupName","Csoport"));
        PendingIntent open=route(c,d.get("chatId"),null,"open");
        NotificationCompat.Builder b=new NotificationCompat.Builder(c,MESSAGES).setSmallIcon(R.drawable.ic_notification).setContentTitle(d.get("title")).setContentText(d.get("body")).setStyle(style).setContentIntent(open).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_MESSAGE).setPriority(NotificationCompat.PRIORITY_HIGH).addAction(0,"Chat megnyitása",open);
        if(avatar!=null)b.setLargeIcon(avatar);
        c.getSystemService(NotificationManager.class).notify(id(d.getOrDefault("tag",d.get("chatId"))),b.build());
    }
    static void incoming(Context c,String call,String name,long expiry,Bitmap avatar){
        if(expiry<=System.currentTimeMillis())return;channels(c);Person.Builder p=new Person.Builder().setName(name).setImportant(true);if(avatar!=null)p.setIcon(IconCompat.createWithBitmap(avatar));
        PendingIntent open=route(c,null,call,"open"),accept=route(c,null,call,"accept"),decline=route(c,null,call,"decline");
        NotificationCompat.Builder b=new NotificationCompat.Builder(c,CALLS).setSmallIcon(R.drawable.ic_notification).setContentTitle(name+" hív").setContentText("Bejövő hívás").setStyle(NotificationCompat.CallStyle.forIncomingCall(p.build(),decline,accept)).setContentIntent(open).setFullScreenIntent(open,true).setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX).setOnlyAlertOnce(true).setAutoCancel(true).setTimeoutAfter(expiry-System.currentTimeMillis());
        if(avatar!=null)b.setLargeIcon(avatar);Notification n=b.build();n.flags|=Notification.FLAG_INSISTENT;c.getSystemService(NotificationManager.class).notify(id("call-"+call),n);
    }
    static void cancel(Context c,String call){c.getSystemService(NotificationManager.class).cancel(id("call-"+call));}
}
