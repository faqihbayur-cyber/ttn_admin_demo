import { auth, db, storage }  from "./index.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDoc,
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const LS_KEY_SAMPUL = 'profilSampul';
let currentUserUid  = null;

// ── AUTH ──────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }

  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists()) { window.location.href = 'login.html'; return; }

    const data      = userSnap.data();
    const nama      = data.nama  || 'Admin';
    const role      = data.role  || '-';
    const foto      = data.foto  || '';
    const inisial   = nama.trim().charAt(0).toUpperCase();
    const email     = user.email || '-';

    // Nama cabang
    let namaCabang = '-';
    if (data.idCabang) {
      try {
        const cabSnap = await getDoc(doc(db, 'kantorCabang', data.idCabang));
        if (cabSnap.exists()) namaCabang = cabSnap.data().namaCabang || '-';
      } catch (_) {}
    }

    // Isi UI
    document.getElementById('profilNama').textContent  = nama;
    document.getElementById('profilRole').textContent  = roleLabel(role);
    document.getElementById('profilCabang').textContent = namaCabang;
    document.getElementById('rowNama').textContent     = nama;
    document.getElementById('rowEmail').textContent    = email;
    document.getElementById('rowCabang').textContent   = namaCabang;
    document.getElementById('rowRole').textContent     = roleLabel(role);
    document.getElementById('avatarInitial').textContent = inisial;

    if (foto) {
      const imgEl = document.getElementById('avatarImg');
      imgEl.src = foto;
      imgEl.style.display = 'block';
      document.getElementById('avatarInitial').style.display = 'none';
    }
    
    // Hilangkan efek loading lingkaran avatar
    document.getElementById('avatarRing').classList.remove('is-loading');

    // Kembalikan susunan ikon cabang utama & hilangkan skeletonnya
    const cabangParent = document.getElementById('profilCabangParent');
    if (cabangParent) {
      cabangParent.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> <span id="profilCabang">${namaCabang}</span>`;
    }

    currentUserUid = user.uid;
    // Sampul dari localStorage, fallback ke Firestore
    loadSampul(data.fotoSampul || '');


  } catch (err) {
    console.error('❌ profil auth:', err);
    window.location.href = 'login.html';
  }
});

function roleLabel(role) {
  const map = {
    adminCabang: 'Admin Cabang',
    adminPusat:  'Admin Pusat',
    kurir:       'Kurir',
    hunter:      'Hunter',
    sales:       'Sales',
  };
  return map[role] || role;
}

// ── NAVIGASI ROW  ───────────────
document.querySelectorAll('.profil-row--link').forEach(row => {
  row.style.cursor = 'pointer';
  row.addEventListener('click', () => {
    const href = row.dataset.href;
    if (href) window.location.href = href;
  });
});

// ── BACK ──────────────────────────────────────────────────
document.getElementById('btnBack').addEventListener('click', () => {
  history.length > 1 ? history.back() : (window.location.href = 'home.html');
});

// ── LOGOUT ────────────────────────────────────────────────
document.getElementById('btnLogout').addEventListener('click', async () => {
  const ok = confirm('Yakin ingin keluar?');
  if (!ok) return;
  try {
    await signOut(auth);
    window.location.href = 'login.html';
  } catch (err) {
    console.error('❌ logout:', err);
    alert('Gagal logout. Coba lagi.');
  }
});

// ── SAMPUL LOCALSTORAGE ───────────────────────────────────
function loadSampul(firestoreUrl = '') {
  const saved = localStorage.getItem(LS_KEY_SAMPUL);
  const img   = document.getElementById('sampulImg');

  if (saved) {
    // Prioritas localStorage
    img.src           = saved;
    img.style.display = 'block';
    return;
  }

  // Fallback ke Firestore URL
  if (firestoreUrl) {
    img.src           = firestoreUrl;
    img.style.display = 'block';
    // Simpan ke localStorage supaya berikutnya pakai lokal
    localStorage.setItem(LS_KEY_SAMPUL, firestoreUrl);
  }
}

async function saveSampul(dataUrl) {
  if (!currentUserUid) return;

  // Tampilkan preview dulu dari base64 sementara upload
  const img = document.getElementById('sampulImg');
  img.src           = dataUrl;
  img.style.display = 'block';

  try {
    const res        = await fetch(dataUrl);
    const blob       = await res.blob();
    const storageRef = ref(storage, `sampul/${currentUserUid}/fotoSampul.jpg`);
    await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
    const downloadURL = await getDownloadURL(storageRef);

    // Simpan URL ke localStorage
    localStorage.setItem(LS_KEY_SAMPUL, downloadURL);
    img.src = downloadURL;

    // Simpan URL ke Firestore
    await setDoc(
      doc(db, 'users', currentUserUid),
      { fotoSampul: downloadURL },
      { merge: true }
    );
    console.log('✅ fotoSampul tersimpan ke Storage:', downloadURL);
  } catch (err) {
    console.error('❌ Gagal upload fotoSampul:', err);
    alert('Gagal upload foto. Coba lagi.');
  }
}

// ── SAMPUL EDIT BUTTON ────────────────────────────────────
const sampulOptions = document.getElementById('sampulOptions');

document.getElementById('btnEditSampul').addEventListener('click', (e) => {
  e.stopPropagation();
  sampulOptions.classList.toggle('open');
});

// Tutup popup kalau klik di luar
document.addEventListener('click', (e) => {
  if (!sampulOptions.contains(e.target)) {
    sampulOptions.classList.remove('open');
  }
});

// Opsi: Ganti Foto → buka galeri
document.getElementById('btnOptEdit').addEventListener('click', () => {
  sampulOptions.classList.remove('open');
  document.getElementById('sampulInput').click();
});

// Opsi: Hapus Sampul → hapus localStorage + reset UI
document.getElementById('btnOptHapus').addEventListener('click', async () => {
  sampulOptions.classList.remove('open');
  localStorage.removeItem(LS_KEY_SAMPUL);
  const img = document.getElementById('sampulImg');
  img.src           = '';
  img.style.display = 'none';

  if (!currentUserUid) return;
  try {
    // Hapus dari Storage
    const storageRef = ref(storage, `sampul/${currentUserUid}/fotoSampul.jpg`);
    await deleteObject(storageRef).catch(() => {}); // ignore kalau file tidak ada

    // Hapus URL dari Firestore
    await setDoc(
      doc(db, 'users', currentUserUid),
      { fotoSampul: '' },
      { merge: true }
    );
    console.log('✅ fotoSampul dihapus');
  } catch (err) {
    console.error('❌ Gagal hapus fotoSampul:', err);
  }
});

document.getElementById('sampulInput').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => openCrop(e.target.result);
  reader.readAsDataURL(file);
  this.value = '';
});

// ── CROP ENGINE ───────────────────────────────────────────
let cropImg      = new Image();
let cropScale    = 1;
let cropOffX     = 0;
let cropOffY     = 0;
let cropDragActive = false;
let cropLastX    = 0;
let cropLastY    = 0;
let cropLastPinchDist = 0;

const cropOverlay = document.getElementById('cropOverlay');
const cropWrap    = document.getElementById('cropWrap');
const canvas      = document.getElementById('cropCanvas');
const ctx         = canvas.getContext('2d');
const zoomSlider  = document.getElementById('cropZoom');

function openCrop(src) {
  cropImg = new Image();
  cropImg.onload = () => {
    // Buka overlay dulu supaya wrap punya dimensi
    cropOverlay.classList.add('open');

    // Tunggu 1 frame agar layout selesai render
    requestAnimationFrame(() => {
      const W = cropWrap.clientWidth  || 360;
      const H = cropWrap.clientHeight || 202;
      canvas.width  = W;
      canvas.height = H;

      const scaleW = W / cropImg.width;
      const scaleH = H / cropImg.height;
      cropScale  = Math.max(scaleW, scaleH);
      cropOffX   = (W - cropImg.width  * cropScale) / 2;
      cropOffY   = (H - cropImg.height * cropScale) / 2;

      zoomSlider.min   = '1';
      zoomSlider.max   = '3';
      zoomSlider.step  = '0.01';
      zoomSlider.value = '1';

      clampOffset();
      drawCrop();
    });
  };
  cropImg.src = src;
}

function drawCrop() {
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(
    cropImg,
    cropOffX, cropOffY,
    cropImg.width  * cropScale,
    cropImg.height * cropScale
  );
}

function clampOffset() {
  const W = canvas.width;
  const H = canvas.height;
  const iW = cropImg.width  * cropScale;
  const iH = cropImg.height * cropScale;
  // Jangan sampai ada area kosong
  if (iW >= W) {
    cropOffX = Math.min(0, Math.max(W - iW, cropOffX));
  } else {
    cropOffX = (W - iW) / 2;
  }
  if (iH >= H) {
    cropOffY = Math.min(0, Math.max(H - iH, cropOffY));
  } else {
    cropOffY = (H - iH) / 2;
  }
}

// Zoom slider
zoomSlider.addEventListener('input', () => {
  const W = canvas.width;
  const H = canvas.height;
  const scaleW  = W / cropImg.width;
  const scaleH  = H / cropImg.height;
  const baseScale = Math.max(scaleW, scaleH);
  const newScale  = baseScale * Math.max(1, parseFloat(zoomSlider.value));
  const ratio     = newScale / cropScale;
  cropOffX  = W / 2 - ratio * (W / 2 - cropOffX);
  cropOffY  = H / 2 - ratio * (H / 2 - cropOffY);
  cropScale = newScale;
  clampOffset();
  drawCrop();
});

// Mouse drag
cropWrap.addEventListener('mousedown', e => {
  cropDragActive = true;
  cropLastX = e.clientX;
  cropLastY = e.clientY;
  cropWrap.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!cropDragActive) return;
  cropOffX += e.clientX - cropLastX;
  cropOffY += e.clientY - cropLastY;
  cropLastX = e.clientX;
  cropLastY = e.clientY;
  clampOffset();
  drawCrop();
});
window.addEventListener('mouseup', () => {
  cropDragActive = false;
  cropWrap.style.cursor = 'move';
});

// Mouse wheel zoom
cropWrap.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.05 : 0.95;
  const W = canvas.width;
  const H = canvas.height;
  const scaleW    = W / cropImg.width;
  const scaleH    = H / cropImg.height;
  const minScale  = Math.max(scaleW, scaleH);
  const newScale  = Math.min(Math.max(cropScale * factor, minScale), minScale * 3);
  const ratio     = newScale / cropScale;
  cropOffX  = W / 2 - ratio * (W / 2 - cropOffX);
  cropOffY  = H / 2 - ratio * (H / 2 - cropOffY);
  cropScale = newScale;
  clampOffset();
  drawCrop();
  // Sync slider
  zoomSlider.value = Math.max(1, cropScale / minScale);
}, { passive: false });

// Touch drag + pinch
cropWrap.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    cropDragActive = true;
    cropLastX = e.touches[0].clientX;
    cropLastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    cropDragActive = false;
    cropLastPinchDist = pinchDist(e.touches);
  }
}, { passive: true });

cropWrap.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && cropDragActive) {
    cropOffX += e.touches[0].clientX - cropLastX;
    cropOffY += e.touches[0].clientY - cropLastY;
    cropLastX = e.touches[0].clientX;
    cropLastY = e.touches[0].clientY;
    clampOffset();
    drawCrop();
  } else if (e.touches.length === 2) {
    const dist   = pinchDist(e.touches);
    const factor = dist / cropLastPinchDist;
    cropLastPinchDist = dist;
    const W = canvas.width;
    const H = canvas.height;
    const scaleW   = W / cropImg.width;
    const scaleH   = H / cropImg.height;
    const minScale = Math.max(scaleW, scaleH);
    const newScale = Math.min(Math.max(cropScale * factor, minScale), minScale * 3);
    const ratio    = newScale / cropScale;
    cropOffX  = W / 2 - ratio * (W / 2 - cropOffX);
    cropOffY  = H / 2 - ratio * (H / 2 - cropOffY);
    cropScale = newScale;
    clampOffset();
    drawCrop();
    zoomSlider.value = Math.max(1, cropScale / minScale);
  }
}, { passive: false });

cropWrap.addEventListener('touchend', () => { cropDragActive = false; });

function pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Tutup modal
function closeCrop() { cropOverlay.classList.remove('open'); }
document.getElementById('btnCropClose').addEventListener('click',  closeCrop);
document.getElementById('btnCropCancel').addEventListener('click', closeCrop);
cropOverlay.addEventListener('click', e => {
  if (e.target === cropOverlay) closeCrop();
});

// Simpan hasil crop
document.getElementById('btnCropApply').addEventListener('click', () => {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  saveSampul(dataUrl);
  closeCrop();
});
