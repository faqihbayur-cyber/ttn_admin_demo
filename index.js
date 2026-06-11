import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }           from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCp32H2WeN3A4ZwwWeUWe3Qcjqh0mz_vvQ",
  authDomain:        "teh-tarik-nusantara-26371.firebaseapp.com",
  projectId:         "teh-tarik-nusantara-26371",
  storageBucket:     "teh-tarik-nusantara-26371.firebasestorage.app",
  messagingSenderId: "354760960352",
  appId:         "1:354760960352:web:7d6a6c07dace937a74d605",
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage   = getStorage(app);
export const messaging = getMessaging(app);

// Expose ke window untuk file non-module (navbar.js, dsb)
window._firebaseAuth      = auth;
window._firebaseDb        = db;
window._firebaseStorage   = storage;
window._firebaseFirestore = { doc, getDoc };