import { auth, db, storage } from "./index.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Secondary Firebase app untuk buat akun baru tanpa logout admin
const secondaryApp = initializeApp({
  apiKey:"AIzaSyCp32H2WeN3A4ZwwWeUWe3Qcjqh0mz_vvQ",
  authDomain:"teh-tarik-nusantara-26371.firebaseapp.com",
  projectId:"teh-tarik-nusantara-26371",
  storageBucket:"teh-tarik-nusantara-26371.firebasestorage.app",
  messagingSenderId:"354760960352",
  appId:"1:354760960352:web:7d6a6c07dace937a74d605",
}, "secondary");
const secondaryAuth = getAuth(secondaryApp);

let adminUser = null;
let adminData = null;
let fotoBase64 = "";

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  adminUser = user;

  // Ambil data admin
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) adminData = snap.data();

  loadTeam(user.uid);
  initPopup();
  initEditPopup();
  initSwipeClose("mktPopupOverlay", "mktPopup");
  initSwipeClose("mktEditOverlay", "mktEditPopup");
});

// ── LOAD TEAM ──────────────────────────────
async function loadTeam(uid) {
  const list    = document.getElementById("mktList");
  const loading = document.getElementById("mktLoading");

  try {
    const q = query(
      collection(db, "users"),
      where("createdBy", "==", uid),
      where("role", "in", ["kurir", "hunter", "sales"])
    );
    const snap = await getDocs(q);
    loading.remove();

    if (snap.empty) {
      list.innerHTML = `
        <div class="mkt-empty">
          <i class="fa-solid fa-users-slash"></i>
          Belum ada anggota tim
        </div>`;
      return;
    }

    const docs = snap.docs.sort((a, b) => {
      const aStatus = a.data().status !== false ? 1 : 0;
      const bStatus = b.data().status !== false ? 1 : 0;
      return bStatus - aStatus;
    });

    docs.forEach(d => {
      const data = d.data();
      const initial = (data.nama || "?").charAt(0).toUpperCase();
      const avatar = data.foto
        ? `<img class="mkt-avatar" src="${data.foto}" alt="${data.nama}"
             onerror="this.outerHTML='<div class=mkt-avatar-placeholder>${initial}</div>'">`
        : `<div class="mkt-avatar-placeholder">${initial}</div>`;

      const card = document.createElement("div");
      card.className = "mkt-card";
      card.innerHTML = `
        ${avatar}
        <div class="mkt-info">
          <div class="mkt-nama">${data.nama || "-"}</div>
          <div class="mkt-role">${data.role || "-"}</div>
        </div>`;
      if (!data.status) card.classList.add("mkt-card-nonaktif");
      card.addEventListener("click", () => openEditPopup(d.id, data));
      setupLongPress(card, d.id, data.status);
      list.appendChild(card);
    });

  } catch (err) {
    console.error(err);
    document.getElementById("mktLoading").innerHTML =
      `<i class="fa-solid fa-circle-exclamation"></i><span>Gagal memuat data</span>`;
  }
}

// ── POPUP ───────────────────────────────────
function initPopup() {
  const overlay  = document.getElementById("mktPopupOverlay");
  const btnBuka  = document.getElementById("btnTambahAkun");
  const btnTutup = document.getElementById("btnTutupPopup");
  const btnSimpan = document.getElementById("btnSimpanAkun");
  const btnText  = document.getElementById("btnSimpanText");
  const errorEl  = document.getElementById("mktError");
  const fotoInput = document.getElementById("mktFotoInput");
  const fotoPlaceholder = document.getElementById("mktFotoPlaceholder");

  btnBuka.onclick  = () => overlay.classList.add("active");
  btnTutup.onclick = () => overlay.classList.remove("active");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("active");
  });

  // Preview foto
  fotoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      fotoBase64 = ev.target.result;
      fotoPlaceholder.innerHTML = `<img src="${fotoBase64}">`;
    };
    reader.readAsDataURL(file);
  });

  // Simpan
  btnSimpan.onclick = async () => {
    errorEl.textContent = "";
    const role     = document.getElementById("mktRole").value.trim();
    const nama     = document.getElementById("mktNama").value.trim();
    const email    = document.getElementById("mktEmail").value.trim();
    const password = document.getElementById("mktPassword").value.trim();
    const nik      = document.getElementById("mktNik").value.trim();
    const noTelpon = document.getElementById("mktNoTelpon").value.trim();
    const alamat   = document.getElementById("mktAlamat").value.trim();
    const motivasi = document.getElementById("mktMotivasi").value.trim();

    if (!role)     return errorEl.textContent = "Role wajib dipilih";
    if (!nama)     return errorEl.textContent = "Nama wajib diisi";
    if (!email)    return errorEl.textContent = "Email wajib diisi";
    if (!password || password.length < 6)
                   return errorEl.textContent = "Password min. 6 karakter";
    if (!nik)      return errorEl.textContent = "NIK wajib diisi";
    if (!noTelpon) return errorEl.textContent = "No. Telpon wajib diisi";
    if (!alamat)   return errorEl.textContent = "Alamat wajib diisi";

    btnSimpan.disabled = true;
    btnText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
      // Ambil namaCabang dari kantorCabang
      let kantorCabang = "";
      if (adminData?.idCabang) {
        const kantorSnap = await getDoc(doc(db, "kantorCabang", adminData.idCabang));
        if (kantorSnap.exists()) kantorCabang = kantorSnap.data().namaCabang || "";
      }

      // Ambil varian dari data admin
      const varian = adminData?.varian || [];

      // Buat akun Auth via secondary app
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUid = cred.user.uid;

      // Upload foto jika ada
      let fotoUrl = "";
      if (fotoBase64) {
        try {
          const compressed = await new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
              const MAX = 400;
              let w = img.width, h = img.height;
              if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
              const canvas = document.createElement("canvas");
              canvas.width = w; canvas.height = h;
              canvas.getContext("2d").drawImage(img, 0, 0, w, h);
              canvas.toBlob(b => resolve(b), "image/jpeg", 0.75);
            };
            img.src = fotoBase64;
          });
          const sRef = storageRef(storage, `fotoUsers/${newUid}`);
          await uploadBytes(sRef, compressed, { contentType: "image/jpeg" });
          fotoUrl = await getDownloadURL(sRef);
        } catch (e) {
          console.log("Upload foto gagal:", e);
        }
      }

      // Simpan ke Firestore
      await setDoc(doc(db, "users", newUid), {
        id: newUid,
        nama,
        email,
        role,
        nik,
        noTelpon,
        alamat,
        motivasi,
        foto: fotoUrl,
        idCabang: adminData?.idCabang || "",
        kantorCabang,
        varian,
        createdBy: adminUser.uid,
        createdAt: serverTimestamp(),
        status: true
      });

      // Logout secondary agar tidak bentrok
      await secondaryAuth.signOut();

      // Reset form
      resetForm();
      overlay.classList.remove("active");

      // Reload list
      document.getElementById("mktList").innerHTML =
        `<div class="mkt-loading" id="mktLoading">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>Memuat data...</span>
        </div>`;
      loadTeam(adminUser.uid);

    } catch (err) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") {
        errorEl.textContent = "Email sudah digunakan";
      } else if (err.code === "auth/invalid-email") {
        errorEl.textContent = "Format email tidak valid";
      } else {
        errorEl.textContent = err.message || "Gagal menyimpan";
      }
    } finally {
      btnSimpan.disabled = false;
      btnText.textContent = "Simpan";
    }
  };
}

function resetForm() {
  fotoBase64 = "";
  document.getElementById("mktRole").value = "";
  document.getElementById("mktNama").value = "";
  document.getElementById("mktEmail").value = "";
  document.getElementById("mktPassword").value = "";
  document.getElementById("mktNik").value = "";
  document.getElementById("mktNoTelpon").value = "";
  document.getElementById("mktAlamat").value = "";
  document.getElementById("mktMotivasi").value = "";
  document.getElementById("mktFotoPlaceholder").innerHTML =
    `<i class="fa-solid fa-camera"></i><span>Foto</span>`;
  document.getElementById("mktError").textContent = "";
}

// ── EDIT POPUP ──────────────────────────────
let editUid = "";
let editFotoBase64 = "";
let editFotoUrl = "";

function openEditPopup(uid, data) {
  editUid = uid;
  editFotoBase64 = "";
  editFotoUrl = data.foto || "";

  // Isi form
  document.getElementById("mktEditNama").value     = data.nama || "";
  document.getElementById("mktEditNoTelpon").value = data.noTelpon || "";
  document.getElementById("mktEditAlamat").value   = data.alamat || "";
  document.getElementById("mktEditMotivasi").value = data.motivasi || "";

  const placeholder = document.getElementById("mktEditFotoPlaceholder");
  if (data.foto) {
    placeholder.innerHTML = `<img src="${data.foto}">`;
  } else {
    const initial = (data.nama || "?").charAt(0).toUpperCase();
    placeholder.innerHTML = `<i class="fa-solid fa-camera"></i><span>Foto</span>`;
  }

  document.getElementById("mktEditError").textContent = "";
  document.getElementById("mktEditOverlay").classList.add("active");
}

function initEditPopup() {
  const overlay  = document.getElementById("mktEditOverlay");
  const btnTutup = document.getElementById("btnTutupEdit");
  const btnSimpan = document.getElementById("btnSimpanEdit");
  const btnText  = document.getElementById("btnSimpanEditText");
  const errorEl  = document.getElementById("mktEditError");
  const fotoInput = document.getElementById("mktEditFotoInput");

  btnTutup.onclick = () => overlay.classList.remove("active");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("active");
  });

  fotoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      editFotoBase64 = ev.target.result;
      document.getElementById("mktEditFotoPlaceholder").innerHTML =
        `<img src="${editFotoBase64}">`;
    };
    reader.readAsDataURL(file);
  });

  btnSimpan.onclick = async () => {
    errorEl.textContent = "";
    const nama     = document.getElementById("mktEditNama").value.trim();
    const noTelpon = document.getElementById("mktEditNoTelpon").value.trim();
    const alamat   = document.getElementById("mktEditAlamat").value.trim();
    const motivasi = document.getElementById("mktEditMotivasi").value.trim();

    if (!nama)     return errorEl.textContent = "Nama wajib diisi";
    if (!noTelpon) return errorEl.textContent = "No. Telpon wajib diisi";
    if (!alamat)   return errorEl.textContent = "Alamat wajib diisi";

    btnSimpan.disabled = true;
    btnText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
      let fotoUrl = editFotoUrl;

      // Upload foto baru jika ada
      if (editFotoBase64) {
        const compressed = await new Promise(resolve => {
          const img = new Image();
          img.onload = () => {
            const MAX = 400;
            let w = img.width, h = img.height;
            if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            canvas.toBlob(b => resolve(b), "image/jpeg", 0.75);
          };
          img.src = editFotoBase64;
        });
        const sRef = storageRef(storage, `fotoUsers/${editUid}`);
        await uploadBytes(sRef, compressed, { contentType: "image/jpeg" });
        fotoUrl = await getDownloadURL(sRef);
      }

      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
        .then(async ({ doc: fsDoc, updateDoc }) => {
          await updateDoc(fsDoc(db, "users", editUid), {
            nama, noTelpon, alamat, motivasi, foto: fotoUrl
          });
        });

      overlay.classList.remove("active");

      // Reload list
      document.getElementById("mktList").innerHTML =
        `<div class="mkt-loading" id="mktLoading">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>Memuat data...</span>
        </div>`;
      loadTeam(adminUser.uid);

    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message || "Gagal menyimpan";
    } finally {
      btnSimpan.disabled = false;
      btnText.textContent = "Simpan";
    }
  };
}

// ── SWIPE TO CLOSE POPUP ──────────────────────────────
function initSwipeClose(overlayId, popupId, closeFn) {
  const overlay = document.getElementById(overlayId);
  const popup   = document.getElementById(popupId);
  let startY = 0, currentY = 0, dragging = false;

  popup.addEventListener("touchstart", (e) => {
    if (window.innerWidth > 768) return;
    startY   = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
    popup.style.transition = "none";
  }, { passive: true });

  popup.addEventListener("touchmove", (e) => {
    if (!dragging || window.innerWidth > 768) return;
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy < 0) return;
    e.preventDefault();
    popup.style.transform = `translateY(${dy}px)`;
  }, { passive: false });

  popup.addEventListener("touchend", () => {
    if (!dragging || window.innerWidth > 768) return;
    dragging = false;
    popup.style.transition = "";
    const dy = currentY - startY;
    if (dy > 120) {
      popup.style.transform = "translateY(100%)";
      setTimeout(() => {
        overlay.classList.remove("active");
        popup.style.transform = "";
        if (closeFn) closeFn();
      }, 300);
    } else {
      popup.style.transform = "";
    }
  });
}

// ── LONG PRESS ──────────────────────────────
function setupLongPress(card, uid, status) {
  let timer = null;

  const trigger = () => {
    openStatusPopup(uid, status);
  };

  card.addEventListener("mousedown", () => {
    timer = setTimeout(trigger, 600);
  });
  card.addEventListener("mouseup",   () => clearTimeout(timer));
  card.addEventListener("mouseleave", () => clearTimeout(timer));

  card.addEventListener("touchstart", () => {
    timer = setTimeout(trigger, 600);
  }, { passive: true });
  card.addEventListener("touchend",   () => clearTimeout(timer));
  card.addEventListener("touchmove",  () => clearTimeout(timer));
}

function openStatusPopup(uid, currentStatus) {
  const existing = document.getElementById("mktStatusPopup");
  if (existing) existing.remove();

  const isAktif = currentStatus !== false;
  const overlay = document.createElement("div");
  overlay.id = "mktStatusPopup";
  overlay.className = "mkt-confirm-overlay";
  overlay.innerHTML = `
    <div class="mkt-confirm-box">
      <div class="mkt-confirm-icon">
        <i class="fa-solid ${isAktif ? 'fa-user-slash' : 'fa-user-check'}"></i>
      </div>
      <div class="mkt-confirm-title">
        ${isAktif ? "Nonaktifkan akun ini?" : "Aktifkan akun ini?"}
      </div>
      <div class="mkt-confirm-desc">
        ${isAktif
          ? "Akun tidak bisa login setelah dinonaktifkan."
          : "Akun akan aktif kembali dan bisa login."}
      </div>
      <div class="mkt-confirm-actions">
        <button class="mkt-confirm-cancel">Batal</button>
        <button class="mkt-confirm-ok ${isAktif ? 'danger' : 'success'}">
          ${isAktif ? "Nonaktifkan" : "Aktifkan"}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("active"));

  overlay.querySelector(".mkt-confirm-cancel").onclick = () => {
    overlay.classList.remove("active");
    setTimeout(() => overlay.remove(), 300);
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.remove("active");
      setTimeout(() => overlay.remove(), 300);
    }
  });

  overlay.querySelector(".mkt-confirm-ok").onclick = async () => {
    try {
      const { doc: fsDoc, updateDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      await updateDoc(fsDoc(db, "users", uid), { status: !isAktif });
      overlay.classList.remove("active");
      setTimeout(() => overlay.remove(), 300);

      // Reload list
      document.getElementById("mktList").innerHTML =
        `<div class="mkt-loading" id="mktLoading">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>Memuat data...</span>
        </div>`;
      loadTeam(adminUser.uid);
    } catch (err) {
      console.error(err);
    }
  };
}