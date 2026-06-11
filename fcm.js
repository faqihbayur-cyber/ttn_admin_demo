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
    // Cek dulu apakah sudah pernah izin
    if (Notification.permission === "granted") {
      // Langsung ambil token
    } else if (Notification.permission === "denied") {
      console.log("❌ Notifikasi diblokir user");
      return;
    } else {
      // Tampilkan popup custom dulu
      const izin = await showNotifPermissionPopup();
      if (!izin) {
        console.log("❌ User menolak di popup custom");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("❌ Izin notifikasi ditolak");
        return;
      }
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
function showNotifPermissionPopup() {
  return new Promise(resolve => {
    // Buat overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.5);
      z-index:99999;display:flex;align-items:flex-end;
      justify-content:center;padding:0 0 32px;
      animation:fadeIn .2s ease;
    `;

    // Card
    const card = document.createElement('div');
    card.style.cssText = `
      background:#fff;border-radius:20px;padding:24px;
      width:calc(100% - 32px);max-width:420px;
      box-shadow:0 8px 32px rgba(0,0,0,.15);
      animation:slideUp .3s cubic-bezier(.34,1.56,.64,1);
    `;

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:#EDE0CF;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A8845A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </div>
        <div>
          <div style="font-weight:700;font-size:15px;color:#3A312A">Aktifkan Notifikasi</div>
          <div style="font-size:12px;color:#9B8E84;margin-top:2px">TTN Marketing</div>
        </div>
      </div>
      <p style="font-size:13px;color:#6B5E55;line-height:1.6;margin-bottom:18px">
        Izinkan notifikasi untuk menerima info pengumuman dan update pengajuan secara langsung.
      </p>
      <div style="display:flex;gap:10px">
        <button id="notifBtnTolak" style="flex:1;height:42px;border-radius:10px;border:1px solid #E8DED2;background:#fff;font-size:13px;font-weight:500;color:#9B8E84;cursor:pointer">
          Nanti Saja
        </button>
        <button id="notifBtnIzin" style="flex:2;height:42px;border-radius:10px;border:none;background:#C9A67B;font-size:13px;font-weight:600;color:#fff;cursor:pointer">
          Izinkan Notifikasi
        </button>
      </div>
    `;

    // Style animasi
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      @keyframes slideUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
    `;
    document.head.appendChild(style);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('notifBtnIzin').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    document.getElementById('notifBtnTolak').onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}
window.initFCM = initFCM;
export { initFCM };