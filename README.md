# Üzenetek – Android, iPhone és web

A nyilvános profil felül középen jeleníti meg a profilképet és a nevet, alatta a kapcsolati és üzenetgombokat, alul középen a galériát. A galéria üres állapotban is megnyitható; idegen profilnál nincs feltöltés vagy törlés. Belépéskor a nyilvános profil fotói megmaradnak.

Csoportos chatben a küldő neve az üzenet (és fénykép) fölött jelenik meg. Privát chatben nincs külön névsor. Az Android értesítés MessagingStyle és Person API-t használ a küldő képével, az iPhone értesítés kommunikációs szándékot és értesítési bővítményt. A telefon rendszere határozza meg a pontos elrendezést, képelhelyezést, zárolási képernyőn látható szöveget és a felhasználó némítási beállításait. Az értesítés koppintásra a megfelelő chatet vagy hívást nyitja meg, bejelentkezés után is.

A hívásablak magasabb, profilképet, szürke/fehér kihangosítót, zöld fogadót és piros elutasító/lerakógombot tartalmaz. Androidon natív AudioManager kezeli a hangkimenetet, iPhone-on AVAudioSession és CallKit. A webes változat nem tudja a telefon saját csengőhangját vagy hangkimenetét minden böngészőben vezérelni. Lejárt hívás nem fogadható; a hívás státuszát mindkét fél követi. A szerver egy percenként lezárja a lejárt hívásokat.

## Fejlesztés

```sh
npm ci
npm test
npm run mobile:sync
npm run android
# Macen, Xcode-dal:
npm run ios
```

Az Android és iOS projektek a repóban vannak. A `www` csomag és a natív webes másolatok generáltak. Az Android build Java 21-et, Android SDK 36-ot igényel. A GitHub Actions Android debug APK-t készít, és aláírás nélkül ellenőrzi az iOS szimulátoros fordítást. A szimulátoros build nem iPhone-ra telepíthető IPA.

## Élesítéshez még szükséges

1. **Firebase Android app:** regisztráld a `hu.martinroszoly.chat` csomagnevet a `chat-alkalmazas-578c8` projektben. A letöltött `google-services.json` fájlt tedd az `android/app` mappába. A GitHub buildhez ugyanezt a JSON-t a `GOOGLE_SERVICES_JSON` repository secret tartalmazza. Konfiguráció nélkül az APK felülete működik, a natív háttérértesítés regisztrációja hibaüzenetet ad.
2. **Firebase szerver:** jogosult fiókkal, Blaze csomag mellett telepítsd az adatbázisszabályokat és az új függvényeket. Meglévő admin függvényeket is megtartjuk. Az Apple függvények külön élesíthetők, az Apple kulcs megadásáig hagyd ki őket:

```sh
cd functions && npm install && cd ..
firebase deploy --only database,functions:registerPushDevice,functions:unregisterPushDevice,functions:getCallIceServers,functions:sendMessagePush,functions:sendCallPush,functions:sendCallEndedPush,functions:expireRingingCalls
```

3. **Web push:** a Firebase → Projektbeállítások → Cloud Messaging → Web Push certificates nyilvános VAPID kulcsát írd a `push-config.json` `vapidKey` mezőjébe. A webes fájlokat a meglévő GitHub Pages kiadással kell publikálni. Az értesítés gomb kér engedélyt. iPhone-on a webapphoz főképernyős telepítés és push-t támogató iOS szükséges.
4. **Profilkép értesítésben:** az értesítési szerver a képet a projekt Storage bucketjében tárolja és egy napig érvényes aláírt URL-t készít. Engedélyezett Storage és a függvény szolgáltatásfiókjának Storage hozzáférés, valamint aláírási jogosultság (`iam.serviceAccounts.signBlob`) szükséges. Ha ez nincs beállítva, az üzenet megérkezik, de az értesítés monogramot/appikont használ.
5. **Apple kiadás:** fizetős Apple Developer tagság, a `hu.martinroszoly.chat` és `hu.martinroszoly.chat.notifications` azonosítók, Push Notifications és Communication Notifications jogosultságok, aláírás és TestFlight/App Store terjesztés szükséges. A fő appban audio, VoIP és remote-notification háttérmód van. A NotificationService bővítmény a fő appba be van ágyazva. Az Apple APNs tokenes kulcsot Secret Managerbe tedd, ne a repóba:

```sh
firebase functions:secrets:set APPLE_PUSH_CONFIG
# A biztonságos promptban JSON: {"keyId":"...","teamId":"...","bundleId":"hu.martinroszoly.chat","privateKey":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----","production":false}
firebase deploy --only functions:sendAppleMessagePush,functions:sendAppleCallPush
```

A fejlesztői build `aps-environment` értéke `development`; TestFlight/App Store kiadásban `production` entitlement és APNs `production:true` konfiguráció kell. A PushKit bejövő hívást mindig CallKitnek jelentjük. Az iOS natív réteg az aktív webes bejelentkezési tokennel követi a hívás státuszát; ha hideg indításkor még nincs használható token, a 60 másodperces lejárat biztosítja a hívásablak bezárását. A natív WebRTC háttérműködését valós iPhone-on is ellenőrizni kell.
6. **TURN:** eltérő mobilhálózatok közötti megbízható WebRTC híváshoz TURN szerver kell. A kizárólag szerver által olvasható RTDB `serverConfig/turn` értéke `{urls:["turns:...:5349"],username:"...",credential:"..."}`. A kliens ezt hitelesített callable-on kapja; nincs nyilvános TURN jelszó a repóban. Beállítás nélkül STUN kapcsolat érhető el, ami nem működik minden hálózatpáron.
7. **Valós eszközteszt:** két fiókkal ellenőrizd az előtérben/háttérben/lezárt képernyőn érkező privát és csoportos üzenetet, értesítésből chatnyitást, bejövő hívás fogadását, elutasítását, kihangosítást és lerakást. Néma mód, fókusz mód, értesítési engedélyek és Android teljes képernyős hívási engedély módosíthatják a jelzést. Release APK/AAB kiadáshoz saját Android aláírókulcs is kell.

Az Apple hitelesítési kulcsok és Android aláírókulcsok nem szerepelnek a forrásban. A Firebase adatokat nem migráljuk és nem töröljük.
