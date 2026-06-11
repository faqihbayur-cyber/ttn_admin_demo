import { messaging, db, auth } from "./index.js";
import { getToken }            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, setDoc }         from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// VAPID key dari Firebase Console → Project Settings → Cloud Messaging
const VAPID_KEY = "BO7ialfKuwNOjNt1qIVheqCb06BvV6Z8FDGGN9B5AB4Dp51uQ6FIGuglKUVAWt3R4Ox17E14DZGnbe0TkDUBV0Y";

export async function initFCM() {
  try {
    // Minta izin notifikasi
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("❌ Izin notifikasi ditolak");
      return;
    }

    // Register service worker
    const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    // Ambil token
    const token = await getToken(messaging, {
      vapidKey:        VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) { console.log("❌ FCM token kosong"); return; }
    console.log("✅ FCM Token:", token);

    // Simpan token ke Firestore
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      await setDoc(
        doc(db, "users", user.uid),
        { fcmToken: token },
        { merge: true }
      );
      console.log("✅ FCM token tersimpan");
    });

  } catch (err) {
    console.error("❌ initFCM:", err);
  }
}