import UIKit
import Capacitor
import CallKit
import PushKit
import UserNotifications
import AVFAudio

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        ChatPhoneManager.shared.configure()
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        ChatPhoneManager.shared.didRegister(token: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        ChatPhoneManager.shared.plugin?.emit("pushError", ["message": error.localizedDescription])
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

class ChatViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(ChatPhonePlugin()) }
}

@objc(ChatPhonePlugin)
public class ChatPhonePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ChatPhonePlugin"
    public let jsName = "ChatPhone"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "registerPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportIncomingCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acceptCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpeaker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRingtone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRingtone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise)
    ]
    public override func load() { ChatPhoneManager.shared.plugin = self }
    func emit(_ name: String, _ data: [String: Any]) { notifyListeners(name, data: data, retainUntilConsumed: true) }
    @objc func registerPush(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { allowed, error in
            if let error = error { call.reject(error.localizedDescription); return }
            guard allowed else { call.reject("Engedélyezd az értesítéseket a telefon beállításaiban"); return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
                ChatPhoneManager.shared.emitTokens()
                call.resolve()
            }
        }
    }
    @objc func getPendingAction(_ call: CAPPluginCall) {
        call.resolve(ChatPhoneManager.shared.pendingAction ?? [:]); ChatPhoneManager.shared.pendingAction = nil
    }
    @objc func reportIncomingCall(_ call: CAPPluginCall) {
        guard let id=call.getString("callId") else {call.reject("Hiányzó hívásazonosító");return}
        ChatPhoneManager.shared.incoming(id: id, name: call.getString("name") ?? "Ismerős", expiry: call.getDouble("expiresAt") ?? (Date().timeIntervalSince1970+60)*1000) { error in
            if let error=error {call.reject(error.localizedDescription)}else{call.resolve()}
        }
    }
    @objc func startCall(_ call: CAPPluginCall) {
        guard let id=call.getString("callId"),let uuid=UUID(uuidString:id) else {call.reject("Érvénytelen hívásazonosító");return}
        let action=CXStartCallAction(call:uuid,handle:CXHandle(type:.generic,value:call.getString("name") ?? "Hívás"))
        ChatPhoneManager.shared.callNames[uuid]=id
        ChatPhoneManager.shared.controller.request(CXTransaction(action:action)) { error in
            if let error=error{call.reject(error.localizedDescription)}else{call.resolve()}
        }
    }
    @objc func acceptCall(_ call: CAPPluginCall) {
        guard let id=call.getString("callId"),let uuid=UUID(uuidString:id) else{call.reject("Érvénytelen hívásazonosító");return}
        let manager=ChatPhoneManager.shared
        manager.activeIds.insert(uuid)
        if let action=manager.answers.removeValue(forKey:uuid){action.fulfill();call.resolve()}
        else{manager.acceptedFromApp.insert(uuid);manager.controller.request(CXTransaction(action:CXAnswerCallAction(call:uuid))){error in if let error=error{call.reject(error.localizedDescription)}else{call.resolve()}}}
    }
    @objc func endCall(_ call: CAPPluginCall) {
        if let id=call.getString("callId"),let uuid=UUID(uuidString:id){ChatPhoneManager.shared.end(uuid:uuid)}
        call.resolve()
    }
    @objc func setSpeaker(_ call: CAPPluginCall) {
        do {
            let session=AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord,mode:.voiceChat,options:[.allowBluetooth])
            try session.overrideOutputAudioPort(call.getBool("enabled") == true ? .speaker : .none)
            call.resolve()
        }catch{call.reject(error.localizedDescription)}
    }
    @objc func setSession(_ call: CAPPluginCall) {ChatPhoneManager.shared.idToken=call.getString("idToken");call.resolve()}
    // CallKit uses the device's default system ringtone for incoming calls.
    @objc func startRingtone(_ call: CAPPluginCall){call.resolve()}
    @objc func stopRingtone(_ call: CAPPluginCall){call.resolve()}
}

final class ChatPhoneManager: NSObject, PKPushRegistryDelegate, CXProviderDelegate, UNUserNotificationCenterDelegate {
    static let shared=ChatPhoneManager()
    weak var plugin: ChatPhonePlugin?
    let controller=CXCallController()
    let provider: CXProvider
    var registry: PKPushRegistry?
    var callNames: [UUID:String]=[:]
    var answers: [UUID:CXAnswerCallAction]=[:]
    var acceptedFromApp=Set<UUID>()
    var activeIds=Set<UUID>()
    var timers: [UUID:Timer]=[:]
    var pendingAction: [String:Any]?
    var idToken:String?
    override init(){let c=CXProviderConfiguration(localizedName:"Pulse");c.supportsVideo=false;c.maximumCallsPerCallGroup=1;c.supportedHandleTypes=[.generic];provider=CXProvider(configuration:c);super.init();provider.setDelegate(self,queue:.main)}
    func configure(){UNUserNotificationCenter.current().delegate=self;registry=PKPushRegistry(queue:.main);registry?.delegate=self;registry?.desiredPushTypes=[.voIP]}
    func didRegister(token:Data){UserDefaults.standard.set(token.map{String(format:"%02x",$0)}.joined(),forKey:"apnsToken");emitTokens()}
    func emitTokens(){var data:[String:Any]=["platform":"ios"];if let t=UserDefaults.standard.string(forKey:"apnsToken"){data["token"]=t};if let t=UserDefaults.standard.string(forKey:"voipToken"){data["voipToken"]=t};if data.count>1{plugin?.emit("pushToken",data)}}
    func pushRegistry(_ registry:PKPushRegistry,didUpdate credentials:PKPushCredentials,for type:PKPushType){UserDefaults.standard.set(credentials.token.map{String(format:"%02x",$0)}.joined(),forKey:"voipToken");emitTokens()}
    func pushRegistry(_ registry:PKPushRegistry,didInvalidatePushTokenFor type:PKPushType){UserDefaults.standard.removeObject(forKey:"voipToken")}
    func pushRegistry(_ registry:PKPushRegistry,didReceiveIncomingPushWith payload:PKPushPayload,for type:PKPushType,completion:@escaping()->Void){
        let d=payload.dictionaryPayload;guard let id=d["callId"] as? String else{completion();return}
        let expiry=Double(d["expiresAt"] as? String ?? "") ?? (Date().timeIntervalSince1970+60)*1000
        incoming(id:id,name:(d["title"] as? String ?? "Ismerős hív").replacingOccurrences(of:" hív",with:""),expiry:expiry){_ in completion()}
    }
    func incoming(id:String,name:String,expiry:Double,completion:@escaping(Error?)->Void){
        guard let uuid=UUID(uuidString:id) else{completion(NSError(domain:"Chat",code:1));return}
        if callNames[uuid] != nil{completion(nil);return}
        let update=CXCallUpdate();update.remoteHandle=CXHandle(type:.generic,value:name);update.localizedCallerName=name;update.hasVideo=false
        provider.reportNewIncomingCall(with:uuid,update:update){error in
            DispatchQueue.main.async{
                if error==nil{
                    self.callNames[uuid]=id
                    self.timers[uuid]=Timer.scheduledTimer(withTimeInterval:2,repeats:true){_ in
                        if !self.activeIds.contains(uuid) && Date().timeIntervalSince1970*1000>=expiry{self.end(uuid:uuid);return}
                        self.checkStatus(uuid:uuid,id:id)
                    }
                    self.pendingAction=["callId":id,"action":"open"]
                }
                completion(error)
            }
        }
    }
    func checkStatus(uuid:UUID,id:String){
        guard let token=idToken,let url=URL(string:"https://chat-alkalmazas-578c8-default-rtdb.europe-west1.firebasedatabase.app/calls/\(id)/status.json?auth=\(token)")else{return}
        URLSession.shared.dataTask(with:url){data,response,error in
            guard error==nil,let data=data,let status=try? JSONSerialization.jsonObject(with:data,options:.fragmentsAllowed) as? String else{return}
            DispatchQueue.main.async{if status=="ended"||status=="declined"{self.end(uuid:uuid)}else if status=="answered" && self.activeIds.contains(uuid){ /* Continue observing until remote hangup. */ }}
        }.resume()
    }
    func end(uuid:UUID){activeIds.remove(uuid);timers.removeValue(forKey:uuid)?.invalidate();answers.removeValue(forKey:uuid)?.fail();provider.reportCall(with:uuid,endedAt:Date(),reason:.remoteEnded);callNames.removeValue(forKey:uuid)}
    func providerDidReset(_ provider:CXProvider){for id in Array(callNames.keys){end(uuid:id)}}
    func provider(_ provider:CXProvider,perform action:CXStartCallAction){try? AVAudioSession.sharedInstance().setCategory(.playAndRecord,mode:.voiceChat,options:[.allowBluetooth]);provider.reportOutgoingCall(with:action.callUUID,startedConnectingAt:Date());action.fulfill()}
    func provider(_ provider:CXProvider,perform action:CXAnswerCallAction){
        if acceptedFromApp.remove(action.callUUID) != nil{action.fulfill();return}
        if let id=callNames[action.callUUID]{answers[action.callUUID]=action;let data:[String:Any]=["callId":id,"action":"accept"];pendingAction=data;plugin?.emit("notificationAction",data)}else{action.fail()}
    }
    func provider(_ provider:CXProvider,perform action:CXEndCallAction){
        if let id=callNames[action.callUUID]{let data:[String:Any]=["callId":id,"action":"decline"];pendingAction=data;plugin?.emit("endCall",data)}
        timers.removeValue(forKey:action.callUUID)?.invalidate();callNames.removeValue(forKey:action.callUUID);action.fulfill()
    }
    func provider(_ provider:CXProvider,didActivate audioSession:AVAudioSession){try? audioSession.setCategory(.playAndRecord,mode:.voiceChat,options:[.allowBluetooth])}
    func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler completionHandler:@escaping(UNNotificationPresentationOptions)->Void){completionHandler([.banner,.list,.sound])}
    func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse,withCompletionHandler completionHandler:@escaping()->Void){
        let d=response.notification.request.content.userInfo;var route:[String:Any]=[:];if let id=d["chatId"] as? String{route["chatId"]=id};if let id=d["callId"] as? String{route["callId"]=id};pendingAction=route;plugin?.emit("notificationAction",route);completionHandler()
    }
}
