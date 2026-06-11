import { auth, db, storage } from "./index.js";
import { initFCM } from "./fcm.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DB_NAME        = 'laporanDistribusiDB';
const STORE_NOTIF    = 'notifikasi';

function logout() {
  window.location.href = "login.html";
}
onAuthStateChanged(auth, async (user) => {
  if (!user) { logout(); return; }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) { logout(); return; }

    const data = userSnap.data();
    if (data.role !== "adminCabang") { logout(); return; }

    // Ambil nama cabang
    let namaCabang = "-";
    if (data.idCabang) {
      try {
        const cabangSnap = await getDoc(doc(db, "kantorCabang", data.idCabang));
        if (cabangSnap.exists()) namaCabang = cabangSnap.data().namaCabang || "-";
      } catch (e) { console.log("Gagal ambil cabang", e); }
    }

    const nama    = data.nama || "Admin";
    const foto    = data.foto || "";
    const inisial = nama.trim().charAt(0).toUpperCase();

    // Set nama & cabang
    const namaEl   = document.getElementById("namaAdmin");
    const cabangEl = document.getElementById("cabangAdmin");
    if (namaEl)   namaEl.innerText   = nama;
    if (cabangEl) cabangEl.innerText = namaCabang;

    // Set inisial avatar (sidebar + header)
    const avatarEl       = document.getElementById("avatarInitial");
    const avatarHeaderEl = document.getElementById("avatarInitialHeader");
    if (avatarEl)       avatarEl.innerText       = inisial;
    if (avatarHeaderEl) avatarHeaderEl.innerText = inisial;

    // Foto jika ada
    const fotoEl = document.getElementById("fotoAdmin");
    if (fotoEl && foto) {
      fotoEl.src     = foto;
      fotoEl.onload  = () => {
        fotoEl.style.display = "block";
        if (avatarEl)       avatarEl.style.display       = "none";
        if (avatarHeaderEl) avatarHeaderEl.style.display = "none";
      };
      fotoEl.onerror = () => {
        fotoEl.style.display = "none";
        if (avatarEl)       avatarEl.style.display       = "block";
        if (avatarHeaderEl) avatarHeaderEl.style.display = "block";
      };
    }

    // Greeting — setelah nama tersedia
    const h  = new Date().getHours();
    const gr = h < 11 ? "Selamat pagi"
             : h < 15 ? "Selamat siang"
             : h < 18 ? "Selamat sore"
             : "Selamat malam";
    const greetEl = document.getElementById("greetMsg");
    if (greetEl) greetEl.innerHTML = `${gr}, <strong>${nama}</strong>`;

    // Show dashboard, hide skeleton
    const skeleton = document.getElementById("skeletonLoader");
    if (skeleton) skeleton.style.display = "none";
    const dashboard = document.getElementById("dashboard");
    if (dashboard) dashboard.style.display = "block";

    pgmCurrentUid      = user.uid;
    initFCM();
    _pengajuanCabangId = data.idCabang || '';
    initNotifForUser(user.uid);
    // Badge pengajuan — cek saat login
    if (_pengajuanCabangId) {
      getDocs(query(
        collection(db, 'rolling'),
        where('status',   '==', 'pending'),
        where('idCabang', '==', _pengajuanCabangId)
      )).then(snap => {
        const dot = document.getElementById('pengajuanDot');
        if (dot) dot.style.display = snap.empty ? 'none' : 'block';
      }).catch(() => {});
    }
    console.log("✅ Admin Cabang Login:", nama);

  } catch (err) {
    console.error(err);
    logout();
  }
});

function updateDateTime() {
  const now  = new Date();
  const HARI = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const BLAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const hari = HARI[now.getDay()];
  const tgl  = now.getDate();
  const bln  = BLAN[now.getMonth()];
  const thn  = now.getFullYear();
  const hh   = String(now.getHours()).padStart(2,'0');
  const mm   = String(now.getMinutes()).padStart(2,'0');

  const dateEl = document.getElementById('headerDate');
  const timeEl = document.getElementById('headerTime');
  if (dateEl) dateEl.textContent = `${hari}, ${tgl} ${bln} ${thn}`;
  if (timeEl) timeEl.textContent = `${hh}.${mm}`;
}
updateDateTime();
setInterval(updateDateTime, 1000);

// ── HEADER POPUPS ────────────────────────────────────────────
(function initHeaderPopups() {
  const popups = {
    btnPengajuan:  'popupPengajuan',
    btnCatatan:    'popupCatatan',
    btnPengumuman: 'popupPengumuman',
    btnNotifikasi: 'popupNotifikasi',
  };
  const overlay = document.getElementById('popupOverlay');

  function openPopup(id) {
    closeAll();
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.contains('popup-overlay')
      ? el.classList.add('active')
      : el.classList.add('open');
    overlay.classList.add('open');
  }
  function closeAll() {
    document.querySelectorAll('.header-popup').forEach(p => p.classList.remove('open'));
    document.getElementById('popupCatatan')?.classList.remove('active');
    overlay.classList.remove('open');
  }

  Object.entries(popups).forEach(([btnId, popupId]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = document.getElementById(popupId);
      const isOpen = el?.classList.contains('open') || el?.classList.contains('active');
      if (isOpen) { closeAll(); return; }
      openPopup(popupId);
      if (popupId === 'popupPengumuman') pgmShowTab('buat');
      if (popupId === 'popupNotifikasi') notifShowTab('baru');
      if (popupId === 'popupPengajuan')  loadPengajuan();
    });
  });

  ['closePengajuan','closeCatatan','closePengumuman','closeNotifikasi'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', closeAll);
  });

  overlay.addEventListener('click', closeAll);
  document.getElementById('popupCatatan')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('popupCatatan')) closeAll();
  });

  // ── CURRENT USER (dari Firebase Auth) ───────────────────
  let currentUser = null;
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
  });

  async function loadCatatan() {
    if (!currentUser) return;
    try {
      const snap = await getDoc(
        doc(db, 'users', currentUser.uid)
      );
      const data = snap.exists()
        ? snap.data()
        : {};
      const catatan = data.catatanPribadi || {};
      document.getElementById('catatan-input').value = catatan.teks || '';
      document.getElementById('catatan-updated').textContent =
        catatan.updatedAt
          ? `Terakhir diubah: ${catatan.updatedAt}`
          : 'Belum pernah disimpan';
    } catch (err) {
      console.error('Gagal load catatan:', err);
      document.getElementById('catatan-updated').textContent = 'Gagal memuat catatan';
    }
  }
  document.getElementById('catatan-btn-simpan')
  ?.addEventListener('click', async () => {
    const btn   = document.getElementById('catatan-btn-simpan');
    const input = document.getElementById('catatan-input');
    if (!currentUser) return;
    const teks = input.value.trim();
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
    try {
      const updatedAt = new Date().toLocaleString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          catatanPribadi: {
            teks,
            updatedAt
          }
        },
        { merge: true }
      );
      document.getElementById('catatan-updated').textContent = `Terakhir diubah: ${updatedAt}`;
      btn.textContent = '✅ Tersimpan';
      setTimeout(() => {
        btn.textContent = 'Simpan Perubahan';
        btn.disabled = false;
      }, 1500);
    } catch (err) {
      console.error('Gagal simpan catatan:', err);
      btn.textContent = '❌ Gagal';
      setTimeout(() => {
        btn.textContent = 'Simpan Perubahan';
        btn.disabled = false;
      }, 1500);
    }
  });
  // reload setiap popup dibuka
  document.getElementById('btnCatatan')
  ?.addEventListener('click', loadCatatan);
  document.getElementById('btnCatatan')?.addEventListener('click', () => loadCatatan());

  // ── DRAG (mouse) ──────────────────────────────────────────
  document.querySelectorAll('.header-popup').forEach(popup => {
    const handle = popup.querySelector('.popup-drag-handle, .popup-handle');
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      const rect = popup.getBoundingClientRect();
      popup.style.transition = 'none';
      popup.style.left  = rect.left + 'px';
      popup.style.top   = rect.top  + 'px';
      popup.style.right = 'auto';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      popup.style.left = (e.clientX - ox) + 'px';
      popup.style.top  = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      popup.style.transition = '';
    });

    // ── SWIPE DOWN (mobile) ───────────────────────────────
    let startY = 0, startTop = 0;
    handle.addEventListener('touchstart', e => {
      startY   = e.touches[0].clientY;
      startTop = popup.getBoundingClientRect().top;
      popup.style.transition = 'none';
    }, { passive: true });
    handle.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) popup.style.top = (startTop + dy) + 'px';
    }, { passive: true });
    handle.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - startY;
      popup.style.transition = '';
      if (dy > 80) closeAll();
      else popup.style.top = startTop + 'px';
    });
  });
})();

const now = new Date();
let chartMonth = now.getMonth();
let chartYear  = now.getFullYear();
const barLabels    = ['Jakarta','Surabaya','Bandung','Medan','Makassar','Semarang'];
const barValues    = [42.8,38.5,31.2,24.1,27.6,22.4];
const MONTHS       = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// CHARTS
let lineChart;
async function loadChartFromIndexedDB(month, year) {
  const totalHari = new Date(year, month + 1, 0).getDate();
  const orderData   = new Array(totalHari).fill(0);
  const closingData = new Array(totalHari).fill(0);
  const payData     = new Array(totalHari).fill(0);
  const expiredData = new Array(totalHari).fill(0);

  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('laporanDistribusiDB');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });

    const store = db.transaction('laporanAdmin', 'readonly').objectStore('laporanAdmin');

    const allRecords = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });

    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;

    allRecords.forEach(record => {
      if (!record.tanggal?.startsWith(prefix)) return;
      const day = Number(record.tanggal.split('-')[2]) - 1;
      if (day < 0 || day >= totalHari) return;

      const data = record.data || record; // support both {data:{...}} and flat

      Object.entries(data).forEach(([, val]) => {
        if (typeof val !== 'object' || !val?.nama) return; // skip non-uid fields

        // Order — jumlahkan semua key
        Object.values(val.order || {}).forEach(qty => {
          orderData[day] += Number(qty) || 0;
        });

        // Closing — jumlahkan semua key
        Object.values(val.pembayaran?.closing || {}).forEach(qty => {
          closingData[day] += Number(qty) || 0;
        });

        // Pay — jumlahkan semua key kecuali "margin"
        Object.entries(val.distribusi?.pay || {}).forEach(([key, qty]) => {
          if (key === 'margin') return;
          payData[day] += Number(qty) || 0;
        });

        // Expired — jumlahkan semua key kecuali "margin"
        Object.entries(val.distribusi?.expired || {}).forEach(([key, qty]) => {
          if (key === 'margin') return;
          expiredData[day] += Number(qty) || 0;
        });
      });
    });

    db.close();
  } catch (err) {
    console.error('❌ loadChartFromIndexedDB:', err);
  }

  return { orderData, closingData, payData, expiredData };
}
function initLineChart(orderData, closingData, payData, expiredData, month, year) {
  const totalHari = new Date(year, month + 1, 0).getDate();
  const labels    = Array.from({ length: totalHari }, (_, i) => i + 1);

  const ctx  = document.getElementById('lineChart').getContext('2d');
  const gradOrder = ctx.createLinearGradient(0, 0, 0, 200);
  gradOrder.addColorStop(0, 'rgba(201,166,123,.18)');
  gradOrder.addColorStop(1, 'rgba(201,166,123,0)');
  const gradClosing = ctx.createLinearGradient(0, 0, 0, 200);
  gradClosing.addColorStop(0, 'rgba(123,175,138,.18)');
  gradClosing.addColorStop(1, 'rgba(123,175,138,0)');
  const gradPay = ctx.createLinearGradient(0, 0, 0, 200);
  gradPay.addColorStop(0, 'rgba(100,149,210,.18)');
  gradPay.addColorStop(1, 'rgba(100,149,210,0)');
  const gradExpired = ctx.createLinearGradient(0, 0, 0, 200);
  gradExpired.addColorStop(0, 'rgba(217,123,108,.18)');
  gradExpired.addColorStop(1, 'rgba(217,123,108,0)');

  if (lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Order',
          data: orderData,
          borderColor: '#C9A67B',
          backgroundColor: gradOrder,
          borderWidth: 2.5, pointRadius: 3,
          pointBackgroundColor: '#C9A67B',
          pointBorderColor: '#fff', pointBorderWidth: 2,
          tension: .35, fill: true
        },
        {
          label: 'Closing',
          data: closingData,
          borderColor: '#7BAF8A',
          backgroundColor: gradClosing,
          borderWidth: 2.5, pointRadius: 3,
          pointBackgroundColor: '#7BAF8A',
          pointBorderColor: '#fff', pointBorderWidth: 2,
          tension: .35, fill: true
        },
        {
          label: 'Pay',
          data: payData,
          borderColor: '#6495D2',
          backgroundColor: gradPay,
          borderWidth: 2.5, pointRadius: 3,
          pointBackgroundColor: '#6495D2',
          pointBorderColor: '#fff', pointBorderWidth: 2,
          tension: .35, fill: true
        },
        {
          label: 'Expired',
          data: expiredData,
          borderColor: '#D97B6C',
          backgroundColor: gradExpired,
          borderWidth: 2.5, pointRadius: 3,
          pointBackgroundColor: '#D97B6C',
          pointBorderColor: '#fff', pointBorderWidth: 2,
          tension: .35, fill: true
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#9B8E84', font: { size: 11 }, boxWidth: 10, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: '#3A312A', titleColor: '#E8DED2', bodyColor: '#fff',
          padding: 10, cornerRadius: 8, displayColors: true,
          callbacks: { label: c => ` ${c.dataset.label}: ${c.raw.toLocaleString('id-ID')}` }
        }
      },
      scales: {
        x: { grid: { color: '#F0EAE2' }, ticks: { color: '#9B8E84', font: { size: 10 } } },
        y: { grid: { color: '#F0EAE2' }, ticks: { color: '#9B8E84', font: { size: 11 }, callback: v => v.toLocaleString('id-ID') }, beginAtZero: true }
      }
    }
  });
}
async function loadAndRenderLineChart() {
  const { orderData, closingData, payData, expiredData } = await loadChartFromIndexedDB(chartMonth, chartYear);
  initLineChart(orderData, closingData, payData, expiredData, chartMonth, chartYear);
  const metaEl = document.getElementById('lineChartMeta');
  if (metaEl) metaEl.textContent = `${MONTHS[chartMonth]} ${chartYear}`;
}
async function loadBarChartFromIndexedDB(month, year) {
  const SKIP_KEYS = new Set(['tanggal','updatedAt','createdAt','createdBy','idCabang','pengeluaranProduksi','pengeluaranDistribusi','stockOpname']);
  const result = { barangHilang:0, basiFreezer:0, rusakFreezer:0, promosi:0, reject:0, fee:0, disable:0, offFlavor:0 };

  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('laporanDistribusiDB');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });
    const allRecords = await new Promise((resolve, reject) => {
      const req = db.transaction('laporanAdmin','readonly').objectStore('laporanAdmin').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
    db.close();

    const prefix = `${year}-${String(month + 1).padStart(2,'0')}-`;
    allRecords.forEach(record => {
      if (!record.tanggal?.startsWith(prefix)) return;
      const data = record.data || record;
      const so   = data.stockOpname || {};

      Object.values(so.barangHilang || {}).forEach(v => { result.barangHilang += Number(v) || 0; });
      Object.values(so.basiFreezer  || {}).forEach(v => { result.basiFreezer  += Number(v) || 0; });
      Object.values(so.rusakFreezer || {}).forEach(v => { result.rusakFreezer += Number(v) || 0; });
      Object.values(so.promosi      || {}).forEach(v => { result.promosi      += Number(v) || 0; });
      Object.values(so.reject       || {}).forEach(v => { result.reject       += Number(v) || 0; });

      Object.entries(data).forEach(([key, val]) => {
        if (SKIP_KEYS.has(key) || !val || typeof val !== 'object') return;
        Object.values(val.fee       || {}).forEach(v => { result.fee       += Number(v) || 0; });
        Object.values(val.disable   || {}).forEach(v => { result.disable   += Number(v) || 0; });
        Object.values(val.offFlavor || {}).forEach(v => { result.offFlavor += Number(v) || 0; });
      });
    });
  } catch (err) {
    console.error('❌ loadBarChartFromIndexedDB:', err);
  }
  return result;
}
async function initBarChart() {
  const d   = await loadBarChartFromIndexedDB(chartMonth, chartYear);
  const labels = ['Barang Hilang','Basi Freezer','Rusak Freezer','Promosi','Reject','Fee','Disable','Off Flavor'];
  const values = [d.barangHilang, d.basiFreezer, d.rusakFreezer, d.promosi, d.reject, d.fee, d.disable, d.offFlavor];
  const colors = ['#D97B6C','#C9A67B','#A8845A','#7BAF8A','#6495D2','#B07EC4','#9B8E84','#E8A87C'];

  const ctx = document.getElementById('barChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {display: false},
        tooltip: {
          backgroundColor: '#3A312A', titleColor: '#E8DED2', bodyColor: '#fff',
          padding: 10, cornerRadius: 8, displayColors: false,
          callbacks: {label: c => c.raw.toLocaleString('id-ID')}
        }
      },
      scales: {
        x: {grid: {display: false}, ticks: {color: '#9B8E84', font: {size: 10}}},
        y: {grid: {color: '#F0EAE2'}, ticks: {color: '#9B8E84', font: {size: 11}, callback: v => v.toLocaleString('id-ID')}, beginAtZero: true}
      }
    }
  });
}
// Populate dropdown bulan & tahun
(function populateChartDropdowns() {
  const MONTHS_LABEL = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const monthTrigger = document.getElementById('monthSelTrigger');
  const monthList    = document.getElementById('monthSelList');
  const yearTrigger  = document.getElementById('yearSelTrigger');
  const yearList     = document.getElementById('yearSelList');

  // Build bulan
  MONTHS_LABEL.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'custom-sel-option' + (i === chartMonth ? ' selected' : '');
    div.textContent = m;
    div.addEventListener('click', () => {
      chartMonth = i;
      monthTrigger.textContent = m;
      monthList.querySelectorAll('.custom-sel-option').forEach(o => o.classList.remove('selected'));
      div.classList.add('selected');
      document.getElementById('monthSelWrap').classList.remove('open');
      loadAndRenderLineChart();
      loadTableData();
    });
    monthList.appendChild(div);
  });
  monthTrigger.textContent = MONTHS_LABEL[chartMonth];

  // Build tahun
  const currentYear = new Date().getFullYear();
  for (let y = currentYear + 1; y >= 2023; y--) {
    const div = document.createElement('div');
    div.className = 'custom-sel-option' + (y === chartYear ? ' selected' : '');
    div.textContent = y;
    div.addEventListener('click', () => {
      chartYear = y;
      yearTrigger.textContent = y;
      yearList.querySelectorAll('.custom-sel-option').forEach(o => o.classList.remove('selected'));
      div.classList.add('selected');
      document.getElementById('yearSelWrap').classList.remove('open');
      loadAndRenderLineChart();
      loadTableData();
    });
    yearList.appendChild(div);
  }
  yearTrigger.textContent = chartYear;

  // Toggle open/close
  document.getElementById('monthSelTrigger').addEventListener('click', () => {
    document.getElementById('monthSelWrap').classList.toggle('open');
    document.getElementById('yearSelWrap').classList.remove('open');
  });
  document.getElementById('yearSelTrigger').addEventListener('click', () => {
    document.getElementById('yearSelWrap').classList.toggle('open');
    document.getElementById('monthSelWrap').classList.remove('open');
  });

  // Klik luar tutup dropdown
  document.addEventListener('click', e => {
    if (!e.target.closest('#monthSelWrap')) document.getElementById('monthSelWrap').classList.remove('open');
    if (!e.target.closest('#yearSelWrap'))  document.getElementById('yearSelWrap').classList.remove('open');
  });
})();

// ── AKTIVITAS TERBARU ─────────────────────────────────────────────────────────
const SKIP_KEYS_ACT = new Set(['tanggal','updatedAt','createdAt','createdBy','idCabang','pengeluaranProduksi','pengeluaranDistribusi','stockOpname']);

async function loadAktivitas() {
  const items = [];

  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('laporanDistribusiDB');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });

    // Ambil semua users dulu untuk mapping uid -> nama
    const usersMap = {};
    try {
      const userRecords = await new Promise((resolve, reject) => {
        const req = db.transaction('users','readonly').objectStore('users').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror   = () => reject(req.error);
      });
      userRecords.forEach(u => { if (u.id && u.nama) usersMap[u.id] = u.nama; });
    } catch(e) { console.warn('users store tidak ditemukan', e); }

    // Ambil laporanAdmin
    const allRecords = await new Promise((resolve, reject) => {
      const req = db.transaction('laporanAdmin','readonly').objectStore('laporanAdmin').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
    db.close();

    // 2 hari terakhir
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const allowed = new Set([fmt(today), fmt(yesterday)]);

    allRecords.forEach(record => {
      if (!allowed.has(record.tanggal)) return;
      const data = record.data || record;

      Object.entries(data).forEach(([uid, val]) => {
        if (SKIP_KEYS_ACT.has(uid) || !val || typeof val !== 'object' || !val.nama) return;
        const nama    = usersMap[uid] || val.nama || uid;
        const tanggal = record.tanggal;

        // Closing per key
        Object.entries(val.pembayaran?.closing || {}).forEach(([key, qty]) => {
          const jumlah = Number(qty) || 0;
          if (!jumlah) return;
          items.push({
            type:    'closing',
            dot:     'var(--green)',
            text:    `<strong>${nama}</strong> closing <strong>${key}</strong> sebanyak <strong>${jumlah.toLocaleString('id-ID')}</strong>`,
            tanggal,
          });
        });

        // Nota per uid
        const nota = val.pembayaran?.nota;
        if (nota) {
          const bayar      = Number(nota.bayar) || 0;
          const keterangan = Number(nota.keterangan) || 0;
          const status     = nota.status || '';
          const total      = bayar + keterangan;
          const isPlus     = keterangan >= 0;
          const dotColor   = status === 'lunas' ? 'var(--green)' : status === 'batal' ? 'var(--red)' : 'var(--primary)';
          const ketStr     = keterangan !== 0
            ? ` <span style="color:${isPlus ? 'var(--green)' : 'var(--red)'};">(${isPlus ? '+' : ''}${keterangan.toLocaleString('id-ID')})</span>`
            : '';
          items.push({
            type:    'nota',
            dot:     dotColor,
            text:    `<strong>${nama}</strong> nota <strong>Rp ${bayar.toLocaleString('id-ID')}</strong>${ketStr} — status <strong>${status}</strong>`,
            tanggal,
          });
        }
      });
    });

  } catch (err) {
    console.error('❌ loadAktivitas:', err);
  }

  return items;
}

async function renderAktivitas() {
  const el = document.querySelector('.activity-list');
  if (!el) return;
  el.innerHTML = `<div class="act-loading" style="padding:16px 0;color:var(--text-muted);font-size:13px;">Memuat aktivitas…</div>`;

  const items = await loadAktivitas();

  const reloadBtn = `
    <button class="pgm-btn-reload" id="btnReloadHistory">
      <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      Muat Ulang dari Server
    </button>
  `;
  if (!items.length) {
    document.getElementById('pgmHistoryList').innerHTML = reloadBtn + `<div class="pgm-history-empty">Belum ada pengumuman.</div>`;
    document.getElementById('btnReloadHistory')?.addEventListener('click', () => fetchAndSyncNotif());
    return;
  }

  // Urutkan: hari ini dulu, lalu kemarin
  const today = new Date();
  const fmtD  = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  items.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));

  el.innerHTML = items.map(item => {
    const label = item.tanggal === fmtD(today) ? 'Hari ini' : 'Kemarin';
    return `
      <div class="activity-item">
        <span class="act-dot" style="background:${item.dot}"></span>
        <div>
          <div class="act-text">${item.text}</div>
          <div class="act-time">${label}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ── TOP SALES ──────────────────────────────────────────
async function loadTopSales() {
  const result = {}; // uid -> { closing: 0 }

  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('laporanDistribusiDB');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });

    // Users map uid -> { nama, role }
    const usersMap = {};
    try {
      const userRecords = await new Promise((resolve, reject) => {
        const req = db.transaction('users','readonly').objectStore('users').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror   = () => reject(req.error);
      });
      userRecords.forEach(u => {
        if (u.id) usersMap[u.id] = { nama: u.nama || u.id, role: u.role || '-' };
      });
    } catch(e) { console.warn('users store tidak ditemukan', e); }

    // laporanAdmin — ambil semua kecuali hari ini
    const allRecords = await new Promise((resolve, reject) => {
      const req = db.transaction('laporanAdmin','readonly').objectStore('laporanAdmin').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
    db.close();

    const today = new Date();
    const fmtD  = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const todayStr = fmtD(today);

    allRecords.forEach(record => {
      if (record.tanggal === todayStr) return; // skip hari ini
      const data = record.data || record;

      Object.entries(data).forEach(([uid, val]) => {
        if (SKIP_KEYS_ACT.has(uid) || !val || typeof val !== 'object' || !val.nama) return;
        if (!result[uid]) result[uid] = { closing: 0 };
        Object.values(val.pembayaran?.closing || {}).forEach(v => {
          result[uid].closing += Number(v) || 0;
        });
      });
    });

    // Gabungkan dengan usersMap
    return Object.entries(result)
      .map(([uid, d]) => ({
        uid,
        nama:    usersMap[uid]?.nama  || uid,
        role:    usersMap[uid]?.role  || '-',
        closing: d.closing,
      }))
      .filter(s => s.closing > 0)
      .sort((a, b) => b.closing - a.closing);

  } catch (err) {
    console.error('❌ loadTopSales:', err);
    return [];
  }
}
async function renderTopSales() {
  const el = document.getElementById('topSalesList');
  if (!el) return;
  el.innerHTML = `<div style="padding:16px 0;color:var(--text-muted);font-size:13px;">Memuat data…</div>`;

  const sales = await loadTopSales();

  if (!sales.length) {
    el.innerHTML = `<div style="padding:16px 0;color:var(--text-muted);font-size:13px;">Belum ada data.</div>`;
    return;
  }

  const max      = sales[0].closing;
  const initials = n => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  el.innerHTML = sales.map((s, i) => `
    <div class="sales-item">
      <div class="sales-rank ${i === 0 ? 'gold' : ''}">${i + 1}</div>
      <div class="sales-avatar">${initials(s.nama)}</div>
      <div class="sales-info">
        <div class="sales-name">${s.nama}</div>
        <div class="sales-bar-wrap"><div class="sales-bar" style="width:${Math.round((s.closing/max)*100)}%"></div></div>
      </div>
      <div class="sales-val">${s.closing.toLocaleString('id-ID')}<div class="sales-branch">${s.role}</div></div>
    </div>
  `).join('');
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
let tableData      = [];
let filterTanggalDari  = '';
let filterTanggalSampai = '';
let filterStatus   = '';
let filterRole     = '';

function fmt(n) { return 'Rp ' + n.toLocaleString('id-ID'); }
function statusBadge(s) {
  const cls = s === 'lunas' ? 'lunas' : 'kurang';
  const label = s === 'lunas' ? 'Lunas' : 'Kurang';
  return `<span class="status-badge ${cls}">${label}</span>`;
}
function renderTable(data) {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const filtered = data.filter(r =>
    (!q             || [r.tanggal,r.nama,r.produk,r.status].some(v => String(v).toLowerCase().includes(q))) &&
    (!filterTanggalDari   || r.tanggal >= filterTanggalDari) &&
    (!filterTanggalSampai || r.tanggal <= filterTanggalSampai) &&
    (!filterStatus  || r.status  === filterStatus) &&
    (!filterRole    || r.role    === filterRole)
  );
  document.getElementById('transactionBody').innerHTML = filtered.length
    ? filtered.map(r => `
        <tr>
          <td>${r.tanggal}</td>
          <td>${r.nama}</td>
          <td style="font-size:12px">${r.produk}</td>
          <td style="font-weight:600">${fmt(r.pembayaran)}</td>
          <td>${statusBadge(r.status)}</td>
          <td style="color:${r.keterangan < 0 ? 'var(--red)' : r.keterangan > 0 ? 'var(--green)' : 'var(--text-muted)'}; font-weight:600">
            ${r.keterangan !== 0 ? (r.keterangan > 0 ? '+' : '') + r.keterangan.toLocaleString('id-ID') : '-'}
          </td>
        </tr>
      `).join('')
    : `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Tidak ada data</td></tr>`;
}
async function loadTableData() {
  tableData = [];
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('laporanDistribusiDB');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });

    const usersMap = {};
    try {
      const ur = await new Promise((resolve, reject) => {
        const req = db.transaction('users','readonly').objectStore('users').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror   = () => reject(req.error);
      });
      ur.forEach(u => { if (u.id) usersMap[u.id] = { nama: u.nama || u.id, role: u.role || '-' }; });
    } catch(e) { console.warn('users store tidak ditemukan', e); }

    const allRecords = await new Promise((resolve, reject) => {
      const req = db.transaction('laporanAdmin','readonly').objectStore('laporanAdmin').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
    db.close();

    allRecords.forEach(record => {
      if (!record.tanggal) return;
      const data = record.data || record;

      Object.entries(data).forEach(([uid, val]) => {
        if (SKIP_KEYS_ACT.has(uid) || !val || typeof val !== 'object' || !val.nama) return;

        const user       = usersMap[uid] || {};
        const nama       = user.nama  || val.nama || uid;
        const role       = user.role  || '-';
        const nota       = val.pembayaran?.nota || {};
        const pembayaran = Number(nota.bayar      ?? 0);
        const status     = (nota.status || '').toLowerCase();
        const keterangan = Number(nota.keterangan ?? 0);

        // Produk: closing key: value
        const closing = val.pembayaran?.closing || {};
        const produk  = Object.entries(closing)
          .filter(([, v]) => Number(v) > 0)
          .map(([k, v]) => `${k}: ${Number(v).toLocaleString('id-ID')}`)
          .join(', ') || '-';

        tableData.push({ tanggal: record.tanggal, nama, role, produk, pembayaran, status, keterangan });
      });
    });

    // Urutkan terbaru dulu
    tableData.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

    // Populate dropdown tanggal
    populateTanggalDropdown();

  } catch (err) {
    console.error('❌ loadTableData:', err);
  }

  renderTable(tableData);
}
function populateTanggalDropdown() {}
// Custom select toggle
function initCselDropdowns() {
  ['Status','Role'].forEach(name => {
    const wrap    = document.getElementById(`csel${name}Wrap`);
    const trigger = document.getElementById(`csel${name}Trigger`);
    if (!trigger) return;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains('open');
      document.querySelectorAll('.csel-wrap').forEach(w => w.classList.remove('open'));
      if (!isOpen) wrap.classList.add('open');
    });
  });

  // ── Range Picker ────────────────────────────────────────────
  let pickerStart  = null;
  let pickerEnd    = null;
  let pickerSelecting = 'start'; // 'start' | 'end'
  let calViewYear  = new Date().getFullYear();
  let calViewMonth = new Date().getMonth();

  const overlay    = document.getElementById('custom-range-overlay');
  const applyBtn   = document.getElementById('custom-range-apply');
  const cancelBtn  = document.getElementById('custom-range-cancel');
  const startLabel = document.getElementById('range-start-label');
  const endLabel   = document.getElementById('range-end-label');
  const DAYS       = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const BULAN      = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  function fmtDisplay(str) {
    if (!str) return null;
    const [y,m,d] = str.split('-');
    return `${d} ${BULAN[Number(m)-1]} ${y}`;
  }
  function renderCal() {
    // Kiri = calViewMonth/calViewYear, Kanan = bulan berikutnya
    const rightMonth = (calViewMonth + 1) % 12;
    const rightYear  = calViewMonth === 11 ? calViewYear + 1 : calViewYear;

    document.getElementById('cal-left-label').textContent  = `${BULAN[calViewMonth]} ${calViewYear}`;
    document.getElementById('cal-right-label').textContent = `${BULAN[rightMonth]} ${rightYear}`;

    renderCalGrid('cal-left-grid',  calViewYear,  calViewMonth);
    renderCalGrid('cal-right-grid', rightYear,    rightMonth);

    startLabel.textContent = pickerStart ? fmtDisplay(pickerStart) : 'Pilih tanggal mulai';
    endLabel.textContent   = pickerEnd   ? fmtDisplay(pickerEnd)   : 'Pilih tanggal akhir';
    applyBtn.disabled      = !(pickerStart && pickerEnd);
  }
  function renderCalGrid(gridId, year, month) {
    const grid      = document.getElementById(gridId);
    const firstDay  = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    let html = DAYS.map(d => `<div class="mini-cal-day-name">${d}</div>`).join('');

    for (let i = 0; i < firstDay; i++) html += `<div class="mini-cal-day empty"></div>`;

    for (let d = 1; d <= totalDays; d++) {
      const val = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      let cls = 'mini-cal-day';
      if (val === pickerStart || val === pickerEnd) cls += ' selected';
      else if (pickerStart && pickerEnd && val > pickerStart && val < pickerEnd) cls += ' in-range';
      html += `<div class="${cls}" data-val="${val}">${d}</div>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.mini-cal-day[data-val]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.dataset.val;
        if (pickerSelecting === 'start' || (pickerStart && pickerEnd)) {
          pickerStart     = v;
          pickerEnd       = null;
          pickerSelecting = 'end';
        } else {
          if (v < pickerStart) { pickerEnd = pickerStart; pickerStart = v; }
          else                 { pickerEnd = v; }
          pickerSelecting = 'start';
        }
        renderCal();
      });
    });
  }

  // Prev / Next bulan
  document.getElementById('cal-prev').addEventListener('click', () => {
    calViewMonth--;
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    renderCal();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calViewMonth++;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    renderCal();
  });

  // Buka modal
  document.getElementById('btnOpenRangePicker').addEventListener('click', (e) => {
    if (e.target.closest('#btnResetTanggal')) return;
    overlay.classList.add('open');
    renderCal();
  });

  // Tutup / batal
  cancelBtn.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  // Terapkan
  applyBtn.addEventListener('click', () => {
    filterTanggalDari   = pickerStart;
    filterTanggalSampai = pickerEnd;
    const label = document.getElementById('filterTanggalLabel');
    label.textContent = `${fmtDisplay(pickerStart)} → ${fmtDisplay(pickerEnd)}`;
    document.getElementById('btnResetTanggal').style.display = 'block';
    overlay.classList.remove('open');
    renderTable(tableData);
  });

  // Reset
  document.getElementById('btnResetTanggal').addEventListener('click', (e) => {
    e.stopPropagation();
    filterTanggalDari   = '';
    filterTanggalSampai = '';
    pickerStart         = null;
    pickerEnd           = null;
    document.getElementById('filterTanggalLabel').textContent  = 'Semua Tanggal';
    document.getElementById('btnResetTanggal').style.display   = 'none';
    renderTable(tableData);
  });

  // Status options
  document.getElementById('cselStatusList').querySelectorAll('.csel-option').forEach(opt => {
    opt.addEventListener('click', () => {
      filterStatus = opt.dataset.val;
      document.getElementById('cselStatusLabel').textContent = opt.textContent;
      document.getElementById('cselStatusList').querySelectorAll('.csel-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById('cselStatusWrap').classList.remove('open');
      renderTable(tableData);
    });
  });

  // Role options
  document.getElementById('cselRoleList').querySelectorAll('.csel-option').forEach(opt => {
    opt.addEventListener('click', () => {
      filterRole = opt.dataset.val;
      document.getElementById('cselRoleLabel').textContent = opt.textContent;
      document.getElementById('cselRoleList').querySelectorAll('.csel-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById('cselRoleWrap').classList.remove('open');
      renderTable(tableData);
    });
  });

  // Klik luar tutup semua
  document.addEventListener('click', () => {
    document.querySelectorAll('.csel-wrap').forEach(w => w.classList.remove('open'));
  });
}

document.getElementById('searchInput').addEventListener('input', () => renderTable(tableData));

// ── POPUP PENGUMUMAN ───────────────────────────────────
let pgmFotoBase64  = '';
let pgmCurrentUid  = '';
let pgmActiveTab   = 'buat';

function pgmShowTab(tab) {
  pgmActiveTab = tab;
  document.getElementById('pgmTabBuat').classList.toggle('active',    tab === 'buat');
  document.getElementById('pgmTabHistory').classList.toggle('active', tab === 'history');
  document.getElementById('pengumumanPreview').style.display  = 'none';
  document.getElementById('pengumumanForm').style.display     = tab === 'buat'    ? 'block' : 'none';
  document.getElementById('pengumumanHistory').style.display  = tab === 'history' ? 'block' : 'none';
  if (tab === 'history') loadPgmHistory();
}

document.getElementById('pgmTabBuat').addEventListener('click',    () => pgmShowTab('buat'));
document.getElementById('pgmTabHistory').addEventListener('click', () => pgmShowTab('history'));

function openDBWithNotif() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);
    checkReq.onsuccess = e => {
      const existing = e.target.result;
      const version  = existing.version;
      const needs    = !existing.objectStoreNames.contains(STORE_NOTIF);
      existing.close();
      const req = indexedDB.open(DB_NAME, needs ? version + 1 : version);
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_NOTIF)) {
          db.createObjectStore(STORE_NOTIF, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };
    checkReq.onerror = () => reject(checkReq.error);
  });
}
async function saveNotifToIDB(id, data) {
  const db = await openDBWithNotif();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NOTIF, 'readwrite')
      .objectStore(STORE_NOTIF)
      .put({ id, ...data });
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror   = () => { db.close(); reject(req.error); };
  });
}
async function getAllNotifFromIDB() {
  const db = await openDBWithNotif();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NOTIF, 'readonly')
      .objectStore(STORE_NOTIF)
      .getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror   = () => { db.close(); reject(req.error); };
  });
}

// ── state select mode ──────────────────────────────────
let pgmSelectMode    = false;
let pgmSelectedIds   = new Set();

function pgmEnterSelectMode() {
  pgmSelectMode = true;
  document.getElementById('pgmHistoryList').classList.add('pgm-select-mode');
  pgmUpdateDeleteBar();
}
function pgmExitSelectMode() {
  pgmSelectMode  = false;
  pgmSelectedIds = new Set();
  document.getElementById('pgmHistoryList').classList.remove('pgm-select-mode');
  // un-select semua item
  document.querySelectorAll('.pgm-history-item.selected')
    .forEach(el => el.classList.remove('selected'));
  pgmUpdateDeleteBar();
}
function pgmUpdateDeleteBar() {
  const bar  = document.getElementById('pgmDeleteBar');
  const info = document.getElementById('pgmDeleteBarInfo');
  const btn  = document.getElementById('pgmBtnHapus');
  if (!bar) return;
  if (pgmSelectMode) {
    bar.classList.add('visible');
    const n = pgmSelectedIds.size;
    info.textContent = n ? `${n} dipilih` : 'Tahan item untuk memilih';
    btn.disabled     = n === 0;
  } else {
    bar.classList.remove('visible');
  }
}
function renderHistoryList(items) {
  const listEl = document.getElementById('pgmHistoryList');

  // Reset select state tiap render
  pgmSelectMode  = false;
  pgmSelectedIds = new Set();
  listEl.classList.remove('pgm-select-mode');

  if (!items.length) {
    listEl.innerHTML = `
      <button class="pgm-btn-reload" id="btnReloadHistory">
        <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
        </svg>
        Muat Ulang dari Server
      </button>
      <div class="pgm-history-empty">Belum ada pengumuman.</div>
    `;
    document.getElementById('btnReloadHistory')
      ?.addEventListener('click', () => fetchAndSyncNotif());
    pgmUpdateDeleteBar();
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const tA = a.createdAt?.seconds || a.createdAt || 0;
    const tB = b.createdAt?.seconds || b.createdAt || 0;
    return tB - tA;
  });

  const reloadBtn = `
    <button class="pgm-btn-reload" id="btnReloadHistory">
      <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
      </svg>
      Muat Ulang dari Server
    </button>
  `;

  listEl.innerHTML = reloadBtn + sorted.map(dat => {
    const dibaca  = dat.dibaca || {};
    const total   = Object.keys(dibaca).length;
    const sudah   = Object.values(dibaca).filter(Boolean).length;
    const seconds = dat.createdAt?.seconds || dat.createdAt || 0;
    const tgl     = seconds
      ? new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
    const fotoHtml = dat.foto ? `<img src="${dat.foto}" alt="">` : '';
    return `
      <div class="pgm-history-item" data-id="${dat.id}">
        ${fotoHtml}
        <div class="pgm-history-body">
          <div class="pgm-history-title">${dat.judul || '—'}</div>
          <div class="pgm-history-pesan">${dat.pesan || ''}</div>
          <div class="pgm-history-meta">
            <span>${tgl}</span>
            <span class="pgm-history-dibaca">
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              ${sudah}/${total} dibaca
            </span>
          </div>
        </div>
        <div class="pgm-select-checkbox">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>
    `;
  }).join('');

  // Delete bar (sticky di bawah list)
  listEl.insertAdjacentHTML('afterend', `
    <div class="pgm-delete-bar" id="pgmDeleteBar">
      <span class="pgm-delete-bar-info" id="pgmDeleteBarInfo">Tahan item untuk memilih</span>
      <div class="pgm-delete-bar-actions">
        <button class="pgm-btn-cancel-select" id="pgmBtnCancelSelect">Batal</button>
        <button class="pgm-btn-hapus" id="pgmBtnHapus" disabled>Hapus</button>
      </div>
    </div>
  `);

  pgmUpdateDeleteBar();

  // ── Event listeners ────────────────────────────────────
  document.getElementById('btnReloadHistory')
    ?.addEventListener('click', () => fetchAndSyncNotif());

  document.getElementById('pgmBtnCancelSelect')
    ?.addEventListener('click', pgmExitSelectMode);

  document.getElementById('pgmBtnHapus')
    ?.addEventListener('click', pgmHapusSelected);

  // Long press + tap tiap item
  listEl.querySelectorAll('.pgm-history-item').forEach(el => {
    let pressTimer = null;

    const startPress = () => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (!pgmSelectMode) pgmEnterSelectMode();
        pgmToggleItem(el);
      }, 500);
    };
    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };

    el.addEventListener('touchstart',  startPress,  { passive: true });
    el.addEventListener('touchend',    cancelPress);
    el.addEventListener('touchmove',   cancelPress);
    el.addEventListener('mousedown',   startPress);
    el.addEventListener('mouseup',     cancelPress);
    el.addEventListener('mouseleave',  cancelPress);

    // Tap biasa → toggle select (hanya saat select mode aktif)
    el.addEventListener('click', () => {
      if (!pgmSelectMode) return;
      pgmToggleItem(el);
    });
  });
}
function pgmToggleItem(el) {
  const id = el.dataset.id;
  if (!id) return;
  if (pgmSelectedIds.has(id)) {
    pgmSelectedIds.delete(id);
    el.classList.remove('selected');
  } else {
    pgmSelectedIds.add(id);
    el.classList.add('selected');
  }
  pgmUpdateDeleteBar();
}
// ── POPUP PENGAJUAN ────────────────────────────────────
async function loadPengajuan() {
  const body = document.getElementById('pengajuanBody');
  if (!body) return;
  body.innerHTML = `<p class="popup-placeholder">Memuat…</p>`;

  try {
    if (!_pengajuanCabangId) {
      body.innerHTML = `<p class="popup-placeholder">Cabang tidak ditemukan.</p>`;
      return;
    }

    const snap = await getDocs(
      query(
        collection(db, 'rolling'),
        where('status',   '==', 'pending'),
        where('idCabang', '==', _pengajuanCabangId)
      )
    );

    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    // Update badge
    const dot = document.getElementById('pengajuanDot');
    if (dot) dot.style.display = items.length ? 'block' : 'none';

    if (!items.length) {
      body.innerHTML = `<p class="popup-placeholder">Tidak ada pengajuan pending.</p>`;
      return;
    }

    // Sort terbaru dulu
    items.sort((a, b) => {
      const tA = a.createdAt?.seconds || 0;
      const tB = b.createdAt?.seconds || 0;
      return tB - tA;
    });

    body.innerHTML = items.map(n => {
      const isHari    = n.type === 'hari';
      const seconds   = n.createdAt?.seconds || 0;
      const tgl       = seconds
        ? new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
      const requester = n.requestedBy?.nama || '—';

      let detailHtml = '';
      if (isHari) {
        detailHtml = `${n.from?.hari || '?'} → ${n.to?.hari || '?'}`;
      } else {
        const fromUser = n.from?.namaUser || '-';
        const toUser   = n.to?.namaUser   || '-';
        detailHtml = `${fromUser} → ${toUser}`;
      }

      const svgHari    = `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
      const svgPemilik = `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

      return `
        <div class="pengajuan-item" data-id="${n.idCustomer || ''}" data-docid="${n.id}">
          <div class="pengajuan-type-badge ${isHari ? 'hari' : 'pemilik'}">
            ${isHari ? svgHari : svgPemilik}
          </div>
          <div class="pengajuan-body">
            <div class="pengajuan-nama">${n.namaCustomer || '—'}</div>
            <div class="pengajuan-detail">
              <strong>${isHari ? 'Pindah Hari' : 'Pindah Pemilik'}</strong> · ${detailHtml}
            </div>
            <div class="pengajuan-meta">oleh ${requester} · ${tgl}</div>
          </div>
          <div class="pengajuan-arrow">
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      `;
    }).join('');

    // Klik → redirect ke customer.html
    body.querySelectorAll('.pengajuan-item').forEach(el => {
      el.addEventListener('click', () => {
        const idCustomer = el.dataset.id;
        if (idCustomer) {
          window.location.href = `customer.html?id=${idCustomer}`;
        }
      });
    });

  } catch (err) {
    console.error('❌ loadPengajuan:', err);
    body.innerHTML = `<p class="popup-placeholder">Gagal memuat.</p>`;
  }
}

// Simpan idCabang setelah auth
let _pengajuanCabangId = '';
async function getCabangId() { return _pengajuanCabangId; }

// ── POPUP NOTIFIKASI ──────────────────────────────────────
let notifCurrentUid = '';
let notifActiveTab  = 'baru';

async function initNotifForUser(uid) {
  notifCurrentUid = uid;
  await fetchAndSyncNotifCabang();
  renderNotifBadge();
}
async function fetchAndSyncNotifCabang() {
  try {
    const snap = await getDocs(
      query(collection(db, 'notifikasi'), where('type', '==', 'admin'))
    );
    for (const d of snap.docs) {
      const dat = d.data();
      if (!(notifCurrentUid in (dat.dibaca || {}))) continue;
      await saveNotifToIDB(d.id, {
        ...dat,
        id: d.id,
        createdAt: dat.createdAt?.seconds ?? (dat.createdAt || 0),
      });
    }
  } catch (err) {
    console.error('❌ fetchAndSyncNotifCabang:', err);
  }
}
async function getNotifCabang() {
  const all = await getAllNotifFromIDB();
  return all.filter(n =>
    n.type === 'admin' &&
    notifCurrentUid in (n.dibaca || {})
  );
}
function renderNotifBadge() {
  getNotifCabang().then(items => {
    const unread = items.filter(n => n.dibaca?.[notifCurrentUid] === false).length;
    let dot = document.querySelector('#btnNotifikasi .notif-dot');
    if (unread > 0) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'notif-dot';
        document.getElementById('btnNotifikasi').appendChild(dot);
      }
    } else {
      dot?.remove();
    }
    const tabBadge = document.getElementById('notifBadgeTab');
    if (tabBadge) {
      tabBadge.textContent = unread || '';
      tabBadge.classList.toggle('visible', unread > 0);
    }
  }).catch(() => {});
}
function notifShowTab(tab) {
  notifActiveTab = tab;
  document.getElementById('notifTabBaru')?.classList.toggle('active',    tab === 'baru');
  document.getElementById('notifTabHistory')?.classList.toggle('active', tab === 'history');
  loadNotifBody();
}

document.getElementById('notifTabBaru')
  ?.addEventListener('click', () => notifShowTab('baru'));
document.getElementById('notifTabHistory')
  ?.addEventListener('click', () => notifShowTab('history'));

async function loadNotifBody() {
  const body = document.getElementById('notifBody');
  if (!body) return;
  body.innerHTML = `<p class="popup-placeholder">Memuat…</p>`;

  try {
    const items  = await getNotifCabang();
    const sorted = [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const list   = notifActiveTab === 'baru'
      ? sorted.filter(n => n.dibaca?.[notifCurrentUid] === false)
      : sorted.filter(n => n.dibaca?.[notifCurrentUid] === true);

    if (!list.length) {
      body.innerHTML = `<p class="popup-placeholder">${
        notifActiveTab === 'baru' ? 'Semua notifikasi sudah dibaca.' : 'Belum ada riwayat.'
      }</p>`;
      return;
    }

    body.innerHTML = list.map(n => {
      const tgl = n.createdAt
        ? new Date(n.createdAt * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
      const fotoEl = n.foto
        ? `<img class="notif-item-foto" src="${n.foto}" alt="">`
        : `<div class="notif-item-icon">
             <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
               <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
             </svg>
           </div>`;
      const dotEl    = notifActiveTab === 'baru' ? `<div class="notif-unread-dot"></div>` : '';
      const tandaiEl = notifActiveTab === 'baru'
        ? `<div class="notif-item-tandai">
             <button class="notif-btn-tandai" data-id="${n.id}">Tandai dibaca</button>
           </div>` : '';
      return `
        <div class="notif-item ${notifActiveTab === 'baru' ? 'unread' : ''}" data-id="${n.id}">
          ${fotoEl}
          <div class="notif-item-body">
            <div class="notif-item-judul">${n.judul || '—'}</div>
            <div class="notif-item-pesan">${n.pesan || ''}</div>
            <div class="notif-item-tgl">${tgl}</div>
            ${tandaiEl}
          </div>
          ${dotEl}
        </div>
      `;
    }).join('');

    body.querySelectorAll('.notif-btn-tandai').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await notifTandaiDibaca(btn.dataset.id);
      });
    });

  } catch (err) {
    console.error('❌ loadNotifBody:', err);
    body.innerHTML = `<p class="popup-placeholder">Gagal memuat.</p>`;
  }
}
async function notifTandaiDibaca(id) {
  try {
    // Update Firestore
    const ref  = doc(db, 'notifikasi', id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const dibaca = snap.data().dibaca || {};
      dibaca[notifCurrentUid] = true;
      await setDoc(ref, { dibaca }, { merge: true });
    }
    // Update IndexedDB
    const idb  = await openDBWithNotif();
    const item = await new Promise((res, rej) => {
      const req = idb.transaction(STORE_NOTIF, 'readonly')
        .objectStore(STORE_NOTIF).get(id);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
    if (item) {
      item.dibaca = item.dibaca || {};
      item.dibaca[notifCurrentUid] = true;
      await new Promise((res, rej) => {
        const req = idb.transaction(STORE_NOTIF, 'readwrite')
          .objectStore(STORE_NOTIF).put(item);
        req.onsuccess = () => res();
        req.onerror   = () => rej(req.error);
      });
    }
    idb.close();
    renderNotifBadge();
    loadNotifBody();
  } catch (err) {
    console.error('❌ notifTandaiDibaca:', err);
  }
}

async function pgmHapusSelected() {
  if (!pgmSelectedIds.size) return;
  const n   = pgmSelectedIds.size;
  const ok  = confirm(`Hapus ${n} pengumuman? Tindakan ini tidak bisa dibatalkan.`);
  if (!ok) return;

  const btn = document.getElementById('pgmBtnHapus');
  btn.disabled  = true;
  btn.textContent = 'Menghapus…';

  const ids = [...pgmSelectedIds];
  const errs = [];

  for (const id of ids) {
    try {
      // Hapus Firestore
      await deleteDoc(doc(db, 'notifikasi', id));
    } catch (err) {
      console.warn('⚠️ Firestore delete gagal:', id, err);
      errs.push(id);
    }
    try {
      // Hapus IndexedDB
      const idb = await openDBWithNotif();
      await new Promise((res, rej) => {
        const req = idb.transaction(STORE_NOTIF, 'readwrite')
          .objectStore(STORE_NOTIF)
          .delete(id);
        req.onsuccess = () => { idb.close(); res(); };
        req.onerror   = () => { idb.close(); rej(req.error); };
      });
    } catch (err) {
      console.warn('⚠️ IDB delete gagal:', id, err);
    }
  }

  if (errs.length) {
    alert(`${errs.length} item gagal dihapus dari server. Cek koneksi & coba lagi.`);
  }

  pgmExitSelectMode();
  await loadPgmHistory(); // refresh list
}
async function loadPgmHistory() {
  const listEl = document.getElementById('pgmHistoryList');
  listEl.innerHTML = `<div class="pgm-history-empty">Memuat…</div>`;
  try {
    const items = await getAllNotifFromIDB();
    const mine  = items.filter(n => n.createdBy === pgmCurrentUid);
    renderHistoryList(mine);
  } catch (err) {
    console.error('❌ loadPgmHistory IDB:', err);
    listEl.innerHTML = `
      <button class="pgm-btn-reload" id="btnReloadHistory">
        <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Muat Ulang dari Server
      </button>
      <div class="pgm-history-empty">Gagal memuat.</div>
    `;
    document.getElementById('btnReloadHistory')?.addEventListener('click', () => fetchAndSyncNotif());
  }
}
async function fetchAndSyncNotif() {
  const listEl = document.getElementById('pgmHistoryList');
  const btn    = document.getElementById('btnReloadHistory');
  if (btn) { btn.disabled = true; btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Memuat…`; }

  try {
    const snap = await getDocs(
      query(
        collection(db, 'notifikasi'),
        where('createdBy', '==', pgmCurrentUid)
      )
    );
    for (const d of snap.docs) {
      const dat = d.data();
      await saveNotifToIDB(d.id, {
        ...dat,
        createdAt: dat.createdAt?.seconds
          ? dat.createdAt.seconds
          : (dat.createdAt || 0),
      });
    }
    const items = await getAllNotifFromIDB();
    const mine  = items.filter(n => n.createdBy === pgmCurrentUid);
    renderHistoryList(mine);
  } catch (err) {
    console.error('❌ fetchAndSyncNotif:', err);
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Muat Ulang dari Server`; }
  }
}

// Foto input
document.getElementById('pgmFotoPlaceholder').addEventListener('click', () => {
  document.getElementById('pgmFotoInput').click();
});
document.getElementById('pgmFotoInput').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    pgmFotoBase64 = e.target.result;
    document.getElementById('pgmFotoPreview').src     = pgmFotoBase64;
    document.getElementById('pgmFotoPreview').style.display    = 'block';
    document.getElementById('pgmFotoPlaceholder').style.display = 'none';
    document.getElementById('pgmFotoRemove').style.display     = 'flex';
  };
  reader.readAsDataURL(file);
});
document.getElementById('pgmFotoRemove').addEventListener('click', () => {
  pgmFotoBase64 = '';
  document.getElementById('pgmFotoInput').value                = '';
  document.getElementById('pgmFotoPreview').style.display      = 'none';
  document.getElementById('pgmFotoPlaceholder').style.display  = 'flex';
  document.getElementById('pgmFotoRemove').style.display       = 'none';
});

// Simpan
document.getElementById('btnSimpanPengumuman').addEventListener('click', async () => {
  const judul = document.getElementById('pgmJudul').value.trim();
  const pesan = document.getElementById('pgmPesan').value.trim();
  if (!judul || !pesan) {
    alert('Judul dan pesan wajib diisi.');
    return;
  }

  const btn = document.getElementById('btnSimpanPengumuman');
  btn.disabled = true;
  btn.innerHTML = `<span>Menyimpan…</span>`;

  try {
    const loadingEl = document.getElementById('pgmLoadingUsers');
    loadingEl.style.display = 'flex';

    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('createdBy', '==', pgmCurrentUid))
    );

    const dibaca = {};
    usersSnap.forEach(d => { dibaca[d.id] = false; });
    loadingEl.style.display = 'none';

    // Upload foto ke Storage jika ada
    let fotoUrl = '';
    if (pgmFotoBase64) {
      const res      = await fetch(pgmFotoBase64);
      const blob     = await res.blob();

      // Compress
      const compressed = await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const MAX  = 800;
          let w = img.width, h = img.height;
          if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(b => resolve(b), 'image/jpeg', 0.75);
        };
        img.src = pgmFotoBase64;
      });

      const { ref, uploadBytes, getDownloadURL } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
      const storageRef = ref(storage, `FCMImages/${pgmCurrentUid}_${Date.now()}.jpg`);
      await uploadBytes(storageRef, compressed, { contentType: 'image/jpeg' });
      fotoUrl = await getDownloadURL(storageRef);
    }

    const docRef = await addDoc(collection(db, 'notifikasi'), {
      createdBy: pgmCurrentUid,
      createdAt: serverTimestamp(),
      type:      'kurir',
      judul,
      pesan,
      foto:      fotoUrl,
      dibaca,
    });

    // Simpan ke IndexedDB
    await saveNotifToIDB(docRef.id, {
      createdBy: pgmCurrentUid,
      createdAt: Math.floor(Date.now() / 1000),
      type:      'kurir',
      judul,
      pesan,
      foto:      fotoUrl,
      dibaca,
    });

    // Tampilkan preview
    document.getElementById('pgmPreviewJudul').textContent = judul;
    document.getElementById('pgmPreviewPesan').textContent = pesan;
    document.getElementById('pgmPreviewMeta').textContent  =
      `Dikirim ke ${Object.keys(dibaca).length} penerima · Baru saja`;
    const previewFoto = document.getElementById('pgmPreviewFoto');
    if (pgmFotoBase64) {
      previewFoto.src           = pgmFotoBase64;
      previewFoto.style.display = 'block';
    } else {
      previewFoto.style.display = 'none';
    }

    document.getElementById('pengumumanForm').style.display    = 'none';
    document.getElementById('pengumumanPreview').style.display = 'block';

  } catch (err) {
    console.error('❌ Simpan pengumuman:', err);
    alert('Gagal menyimpan. Coba lagi.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Simpan & Kirim`;
  }
});

// Buat baru — reset form
document.getElementById('btnPengumumanBaru').addEventListener('click', () => {
  document.getElementById('pgmJudul').value              = '';
  document.getElementById('pgmPesan').value              = '';
  pgmFotoBase64                                          = '';
  document.getElementById('pgmFotoInput').value          = '';
  document.getElementById('pgmFotoPreview').style.display      = 'none';
  document.getElementById('pgmFotoPlaceholder').style.display  = 'flex';
  document.getElementById('pgmFotoRemove').style.display       = 'none';
  document.getElementById('pengumumanPreview').style.display   = 'none';
  document.getElementById('pengumumanForm').style.display      = 'block';
});

// EXPORT
document.getElementById('btnExcelExport').addEventListener('click', () => {
  const ws = XLSX.utils.json_to_sheet(transactions.map(r => ({
    Tanggal: r.tanggal, Cabang: r.cabang, Produk: r.produk,
    Qty: r.qty, Revenue: r.revenue, Status: r.status
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transaksi');
  XLSX.writeFile(wb, 'transaksi-nusantara.xlsx');
});
document.getElementById('btnPdfExport').addEventListener('click', () => window.print());

// INIT
async function loadKPI() {
  let omsetDistribusi = 0;
  let omsetProduksi   = 0;

  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('laporanDistribusiDB');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });

    const allRecords = await new Promise((resolve, reject) => {
      const req = db.transaction('laporanAdmin','readonly').objectStore('laporanAdmin').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
    db.close();

    if (!allRecords.length) return { omsetDistribusi, omsetProduksi };

    // Ambil dokumen terbaru saja
    const latest = allRecords.reduce((a, b) => (a.tanggal > b.tanggal ? a : b));
    const data   = latest.data || latest;

    Object.entries(data).forEach(([uid, val]) => {
      if (SKIP_KEYS_ACT.has(uid) || !val || typeof val !== 'object' || !val.nama) return;
      omsetDistribusi += Number(val.keuangan?.inputOmset  ?? 0);
      omsetProduksi   += Number(val.pembayaran?.nota?.bayar ?? 0);
    });

  } catch (err) {
    console.error('❌ loadKPI:', err);
  }

  return { omsetDistribusi, omsetProduksi };
}
async function renderKPI() {
  const { omsetDistribusi, omsetProduksi } = await loadKPI();
  const distEl = document.getElementById('kpiOmsetDistribusi');
  const prodEl = document.getElementById('kpiOmsetProduksi');
  if (distEl) distEl.textContent = 'Rp ' + omsetDistribusi.toLocaleString('id-ID');
  if (prodEl) prodEl.textContent = 'Rp ' + omsetProduksi.toLocaleString('id-ID');
}
function setPageSubTitle() {
  const now   = new Date();
  const bulan = now.toLocaleString('id-ID', {month: 'long'});
  const el    = document.getElementById('pageSubTitle');
  if (el) el.textContent = `KPI Keuangan — ${bulan} ${now.getFullYear()}`;
}

renderAktivitas();
loadAndRenderLineChart();
initBarChart().then(() => {
  const el = document.getElementById('barChartMeta');
  if (el) el.textContent = `${MONTHS[chartMonth]} ${chartYear}`;
});
renderTopSales();
loadTableData();
initCselDropdowns();
setPageSubTitle();
renderKPI();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .then(reg => {
        console.log("✅ Service Worker aktif", reg);
      })
      .catch(err => {
        console.log("❌ Service Worker gagal", err);
      });
  });
}
