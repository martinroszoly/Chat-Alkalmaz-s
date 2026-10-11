# Pulse ingyenes Android push gateway

Ez az Apps Script a Firebase Spark csomag melletti, díjmentes FCM HTTP v1 küldési útvonalat készíti elő. Nincs telepítve vagy aktiválva; a `push-config.json` gateway URL-je üres marad addig, amíg a tulajdonos a saját Google-fiókjában nem telepíti.

## Telepítés telefonról vagy számítógépről

1. Nyisd meg a `script.google.com` oldalt a saját, Firebase-projekthez hozzáférő Google-fiókoddal, majd válaszd az **Új projekt** lehetőséget.
2. A szerkesztőben nyisd meg a `Code.gs` fájlt, töröld a mintakódot, és másold be a tároló `free-push-apps-script/Code.gs` fájljának teljes tartalmát.
3. A **Projektbeállítások** alatt kapcsold be a `appsscript.json` manifest megjelenítését. Cseréld le a manifest tartalmát a tároló `free-push-apps-script/appsscript.json` fájljára, majd mentsd a projektet.
4. Válaszd a **Telepítés → Új telepítés** lehetőséget, típusnak a **Webalkalmazás** típust.
5. A végrehajtás legyen **Én**. Az elérési jogosultság legyen **Bárki**, hogy a telefonos alkalmazás elérhesse a végpontot. A végpont Firebase ID-tokent ellenőriz; jelszót vagy egyszer használatos kódot ne adj meg az alkalmazásnak.
6. Telepítéskor engedélyezd a manifestben felsorolt Google-jogosultságokat. A Google-fióknak rendelkeznie kell a Firebase-projekthez szükséges adatbázis- és Firebase Cloud Messaging-hozzáféréssel.
7. Másold ki a telepítés által adott, `/exec` végű Web App URL-t, és állítsd be a `push-config.json` fájl `pushGatewayUrl` mezőjében. Ezután új Android APK-t kell építeni, hogy a telefon az új URL-t használja.

## Ellenőrzés

- A Web App **Végrehajtások** nézetében ellenőrizd a `doPost` futásait és hibáit.
- Tesztelj két, ellenőrzött emailcímű fiókkal: külön eszközazonosítót regisztrál mindkettő, majd küldj üzenetet és hívást az egyik készülékről a másikra.
- A sikeres APK-fordítás önmagában nem igazolja az FCM-küldést. A Web App telepítése és a lezárt képernyős próba külön szükséges.

Az Apps Script fájl csak ellenőrzött Firebase ID-tokennel dolgozik, a lekérdezéseit a megadott push-eseményekre korlátozza, az elavult FCM-tokeneket pedig eltávolítja. A Google Apps Script, a Firebase Spark és az FCM HTTP v1 használata nem indít Cloud Functiont vagy más Blaze-köteles Firebase-funkciót.
