import UserNotifications
import Intents

class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var bestContent: UNMutableNotificationContent?
    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler=contentHandler
        guard let content=request.content.mutableCopy() as? UNMutableNotificationContent else{contentHandler(request.content);return}
        bestContent=content
        let d=content.userInfo
        guard let urlString=d["avatarUrl"] as? String,let url=URL(string:urlString),url.scheme=="https" else{finish(content);return}
        let config=URLSessionConfiguration.ephemeral;config.timeoutIntervalForRequest=8
        URLSession(configuration:config).dataTask(with:url){data,response,error in
            guard error==nil,let data=data,data.count<1000000 else{self.finish(content);return}
            let sender=INPerson(personHandle:INPersonHandle(value:d["senderName"] as? String ?? content.title,type:.unknown),nameComponents:nil,displayName:d["senderName"] as? String ?? content.title,image:INImage(imageData:data),contactIdentifier:nil,customIdentifier:nil)
            let me=INPerson(personHandle:INPersonHandle(value:"me",type:.unknown),nameComponents:nil,displayName:"Te",image:nil,contactIdentifier:nil,customIdentifier:nil,isMe:true)
            let group=d["isGroup"] as? String == "true"
            let intent=INSendMessageIntent(recipients:[me],outgoingMessageType:.outgoingMessageText,content:content.body,speakableGroupName:group ? INSpeakableString(spokenPhrase:d["groupName"] as? String ?? "Csoport") : nil,conversationIdentifier:d["chatId"] as? String,serviceName:"Üzenetek",sender:sender,attachments:nil)
            intent.setImage(sender.image,forParameterNamed:\.sender)
            let interaction=INInteraction(intent:intent,response:nil);interaction.direction = .incoming
            interaction.donate{_ in
                do{self.finish(try content.updating(from:intent))}catch{self.finish(content)}
            }
        }.resume()
    }
    private func finish(_ content:UNNotificationContent){if let h=handler{handler=nil;h(content)}}
    override func serviceExtensionTimeWillExpire(){if let content=bestContent{finish(content)}}
}
