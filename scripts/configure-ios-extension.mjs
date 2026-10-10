import xcode from 'xcode';
import {writeFile} from 'node:fs/promises';
const path='ios/App/App.xcodeproj/project.pbxproj',project=xcode.project(path);project.parseSync();
const native=project.pbxNativeTargetSection();
if(!Object.values(native).some(t=>t.name==='"ChatNotificationService"')){
 const t=project.addTarget('ChatNotificationService','app_extension','ChatNotificationService','hu.martinroszoly.chat.notifications');
 project.addBuildPhase(['ChatNotificationService/NotificationService.swift'],'PBXSourcesBuildPhase','Sources',t.uuid);
 project.addBuildPhase(['Intents.framework','UserNotifications.framework'],'PBXFrameworksBuildPhase','Frameworks',t.uuid);
 const configList=project.pbxXCConfigurationList()[t.pbxNativeTarget.buildConfigurationList];
 for(const ref of configList.buildConfigurations){const conf=project.pbxXCBuildConfigurationSection()[ref.value];Object.assign(conf.buildSettings,{INFOPLIST_FILE:'ChatNotificationService/Info.plist',CODE_SIGN_ENTITLEMENTS:'ChatNotificationService/NotificationService.entitlements',SWIFT_VERSION:'5.0',IPHONEOS_DEPLOYMENT_TARGET:'15.0',TARGETED_DEVICE_FAMILY:'"1,2"',CURRENT_PROJECT_VERSION:'1',MARKETING_VERSION:'1.0',CLANG_ENABLE_MODULES:'YES'});}
 await writeFile(path,project.writeSync());
}
