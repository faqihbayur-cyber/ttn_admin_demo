import { getApp }     from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth }    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const VAPID_KEY = "BO7ialfKuwNOjNt1qIVheqCb06BvV6Z8FDGGN9B5AB4Dp51uQ6FIGuglKUVAWt3R4Ox17E14DZGnbe0TkDUBV0Y";

async function saveFcmToken(token) {
  try {
    const app  = getApp();
    const auth = getAuth(app);
    const db   = getFirestore(app);
    const user = auth.currentUser;
    if (!user || !token) return;
    await setDoc(
      doc(db, "users", user.uid),
      { fcmToken: token },
      { merge: true }
    );
    console.log("✅ FCM token tersimpan:", token);
  } catch (err) {
    console.error("❌ saveFcmToken:", err);
  }
}

async function initFCM() {
  // WebView Android — tunggu native token
  window.onNativeFcmToken = async function(token) {
    console.log("📱 Native FCM token diterima:", token);
    await saveFcmToken(token);
  };

  // Token sudah diinject sebelum initFCM dipanggil
  if (window.nativeFcmToken) {
    await saveFcmToken(window.nativeFcmToken);
    return;
  }

  // WebView tidak support Notification API — skip
  if (typeof Notification === "undefined") {
    console.log("⚠️ WebView — skip, tunggu native token");
    return;
  }

  // Fallback browser biasa
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("❌ Izin notifikasi ditolak");
      return;
    }
    const app       = getApp();
    const messaging = getMessaging(app);
    const swReg     = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token     = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) { console.log("❌ FCM token kosong"); return; }
    await saveFcmToken(token);
  } catch (err) {
    console.error("❌ initFCM:", err);
  }
}

window.initFCM = initFCM;
export { initFCM };