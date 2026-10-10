import {Capacitor,registerPlugin} from '@capacitor/core';
const phone=registerPlugin('ChatPhone');
window.ChatNative={isNative:Capacitor.isNativePlatform(),platform:Capacitor.getPlatform(),phone};
if(Capacitor.isNativePlatform()){
  phone.addListener('pushToken',data=>window.dispatchEvent(new CustomEvent('chat:native-token',{detail:data})));
  phone.addListener('notificationAction',data=>window.dispatchEvent(new CustomEvent('chat:native-route',{detail:data})));
  phone.addListener('endCall',data=>window.dispatchEvent(new CustomEvent('chat:native-end',{detail:data})));
  phone.addListener('pushError',data=>window.dispatchEvent(new CustomEvent('chat:native-push-error',{detail:data})));
}
