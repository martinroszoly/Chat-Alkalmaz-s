package hu.martinroszoly.chat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

public class ChatMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message){
        Map<String,String>d=message.getData();String type=d.get("type");
        if("call-ended".equals(type)){getSharedPreferences("endedCalls",MODE_PRIVATE).edit().putLong(d.get("callId"),System.currentTimeMillis()).apply();ChatNotifications.cancel(this,d.get("callId"));return;}
        Bitmap avatar=avatar(d.get("avatarUrl"));
        if("call".equals(type)){if(getSharedPreferences("endedCalls",MODE_PRIVATE).getLong(d.get("callId"),0)>System.currentTimeMillis()-120000)return;try{ChatNotifications.incoming(this,d.get("callId"),d.getOrDefault("title","Ismerős hív").replaceFirst(" hív$",""),Long.parseLong(d.getOrDefault("expiresAt","0")),avatar);}catch(Exception ignored){}}
        else if("message".equals(type))ChatNotifications.message(this,d,avatar);
    }
    private Bitmap avatar(String url){
        if(url==null||!url.startsWith("https://"))return null;
        HttpURLConnection conn=null;
        try{conn=(HttpURLConnection)new URL(url).openConnection();conn.setConnectTimeout(3500);conn.setReadTimeout(3500);conn.setInstanceFollowRedirects(false);if(conn.getResponseCode()!=200||conn.getContentLengthLong()>1000000)return null;byte[] bytes=conn.getInputStream().readNBytes(1000001);if(bytes.length>1000000)return null;return BitmapFactory.decodeByteArray(bytes,0,bytes.length);}catch(Exception e){return null;}finally{if(conn!=null)conn.disconnect();}
    }
}
