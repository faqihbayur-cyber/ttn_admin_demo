
import { auth, db } from "./index.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
function showToast(message, type = 'info') {
  const existing = document.getElementById('custom-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'custom-toast';

  const colors = {
    success : { bg: '#2ecc71', icon: '✅' },
    error   : { bg: '#e74c3c', icon: '❌' },
    warning : { bg: '#f39c12', icon: '⚠️' },
    info    : { bg: '#3498db', icon: 'ℹ️' },
  };
  const { bg, icon } = colors[type] ?? colors.info;

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close">✕</button>
  `;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: ${bg};
    color: #fff;
    padding: 12px 16px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.85rem;
    font-weight: 600;
    box-shadow: 0 6px 24px rgba(0,0,0,0.18);
    z-index: 99999;
    max-width: 320px;
    animation: toastIn 0.3s ease;
  `;

  document.body.appendChild(toast);

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  });

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
}

let currentUser = null;
const bulanNama = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
let filterPeriod = localStorage.getItem('filterPeriod') || 'month';
let filterYear   = Number(localStorage.getItem('filterYear'))  || new Date().getFullYear();
let filterMonth  = Number(localStorage.getItem('filterMonth')) ?? new Date().getMonth();

const DB_NAME          = "laporanDistribusiDB";
const STORE_USERS      = "users";
const STORE_KANTOR_CABANG = "kantorCabang";
const STORE_LAPORAN    = "laporanAdmin";

function openDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);
    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   =
        !existingDB.objectStoreNames.contains(STORE_USERS) ||
        !existingDB.objectStoreNames.contains(STORE_KANTOR_CABANG) ||
        !existingDB.objectStoreNames.contains(STORE_LAPORAN);
      existingDB.close();
      const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;
      const req = indexedDB.open(DB_NAME, targetVersion);
      req.onupgradeneeded = (ev) => {
        const dbUp = ev.target.result;
        if (!dbUp.objectStoreNames.contains(STORE_USERS)) {
          dbUp.createObjectStore(STORE_USERS, { keyPath: "uid" });
        }
        if (!dbUp.objectStoreNames.contains(STORE_KANTOR_CABANG)) {
          dbUp.createObjectStore(STORE_KANTOR_CABANG, { keyPath: "id" });
        }
        if (!dbUp.objectStoreNames.contains(STORE_LAPORAN)) {
          dbUp.createObjectStore(STORE_LAPORAN, { keyPath: "tanggal" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };
    checkReq.onerror = () => reject(checkReq.error);
  });
}
async function getUsersFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_USERS, "readonly");
    const store = tx.objectStore(STORE_USERS);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function getKantorCabangFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_KANTOR_CABANG, "readonly");
    const store = tx.objectStore(STORE_KANTOR_CABANG);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result?.[0] || null);
    req.onerror   = () => reject(req.error);
  });
}

function updateMonthLabel() {
  const el = document.getElementById('selected-month-label');
  if (el) el.textContent = `${bulanNama[filterMonth]} ${filterYear}`;
}
function saveFilterState() {
  localStorage.setItem('filterPeriod', filterPeriod);
  localStorage.setItem('filterYear',   filterYear);
  localStorage.setItem('filterMonth',  filterMonth);
}
function getFilteredLaporan(semua) {
  const yyyy = filterYear;
  const mm   = String(filterMonth + 1).padStart(2, '0');

  if (filterPeriod === 'month') {
    const start = `${yyyy}-${mm}-01`;
    const end   = `${yyyy}-${mm}-31`;
    return semua.filter(doc => doc.tanggal >= start && doc.tanggal <= end);
  }

  if (filterPeriod === 'week') {
    const now   = new Date();
    const day   = now.getDay(); // 0=minggu
    const mon   = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
    const sun   = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt   = d => d.toISOString().slice(0, 10);
    return semua.filter(doc => doc.tanggal >= fmt(mon) && doc.tanggal <= fmt(sun));
  }

  if (filterPeriod === 'year') {
    const start = `${yyyy}-01-01`;
    const end   = `${yyyy}-12-31`;
    return semua.filter(doc => doc.tanggal >= start && doc.tanggal <= end);
  }

  if (filterPeriod === 'custom' && crStartDate && crEndDate) {
    return semua.filter(doc => doc.tanggal >= crStartDate && doc.tanggal <= crEndDate);
  }

  return semua;
}
function getPrevFilteredLaporan(semua) {
  if (filterPeriod === 'month') {
    const prevDate  = new Date(filterYear, filterMonth - 1, 1);
    const prevYYYY  = prevDate.getFullYear();
    const prevMM    = String(prevDate.getMonth() + 1).padStart(2, '0');
    const start     = `${prevYYYY}-${prevMM}-01`;
    const end       = `${prevYYYY}-${prevMM}-31`;
    return semua.filter(doc => doc.tanggal >= start && doc.tanggal <= end);
  }

  if (filterPeriod === 'week') {
    const now   = new Date();
    const day   = now.getDay();
    const mon   = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7) - 7);
    const sun   = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt   = d => d.toISOString().slice(0, 10);
    return semua.filter(doc => doc.tanggal >= fmt(mon) && doc.tanggal <= fmt(sun));
  }

  if (filterPeriod === 'year') {
    const start = `${filterYear - 1}-01-01`;
    const end   = `${filterYear - 1}-12-31`;
    return semua.filter(doc => doc.tanggal >= start && doc.tanggal <= end);
  }

  if (filterPeriod === 'custom' && crStartDate && crEndDate) {
    // Prev = range dengan durasi sama, mundur sebanyak durasi range
    const ms       = 86400000;
    const startMs  = new Date(crStartDate).getTime();
    const endMs    = new Date(crEndDate).getTime();
    const duration = endMs - startMs;
    const prevEnd  = new Date(startMs - ms).toISOString().slice(0, 10);
    const prevStart= new Date(startMs - ms - duration).toISOString().slice(0, 10);
    return semua.filter(doc => doc.tanggal >= prevStart && doc.tanggal <= prevEnd);
  }

  return [];
}

// ── CUSTOM RANGE ─────────────────────────────────────────
let crStartDate = localStorage.getItem('crStartDate') || null;
let crEndDate   = localStorage.getItem('crEndDate')   || null;
let crCalYear   = new Date().getFullYear();
let crCalMonth  = new Date().getMonth();
let crPicking   = 'start'; // 'start' | 'end'

const DAY_NAMES = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const BULAN_PANJANG = ['Januari','Februari','Maret','April','Mei','Juni', 'Juli','Agustus','September','Oktober','November','Desember'];

function fmtDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${BULAN_PANJANG[parseInt(m)-1]} ${y}`;
}
function renderMiniCal(gridEl, year, month) {
  gridEl.innerHTML = '';
  // Header nama hari
  DAY_NAMES.forEach(d => {
    const el = document.createElement('div');
    el.className = 'mini-cal-day-name';
    el.textContent = d;
    gridEl.appendChild(el);
  });
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  // Empty cells
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'mini-cal-day empty';
    gridEl.appendChild(el);
  }
  for (let d = 1; d <= totalDays; d++) {
    const mm  = String(month + 1).padStart(2, '0');
    const dd  = String(d).padStart(2, '0');
    const iso = `${year}-${mm}-${dd}`;
    const el  = document.createElement('div');
    el.className = 'mini-cal-day';
    el.textContent = d;

    const isStart   = iso === crStartDate;
    const isEnd     = iso === crEndDate;
    const inRange   = crStartDate && crEndDate && iso > crStartDate && iso < crEndDate;

    if (isStart || isEnd) el.classList.add('selected');
    else if (inRange)     el.classList.add('in-range');

    el.addEventListener('click', () => onDayClick(iso));
    gridEl.appendChild(el);
  }
}
function renderCustomRangeCals() {
  // Kiri = bulan aktif, Kanan = bulan berikutnya
  const rightYear  = crCalMonth === 11 ? crCalYear + 1 : crCalYear;
  const rightMonth = crCalMonth === 11 ? 0 : crCalMonth + 1;

  document.getElementById('cal-left-label').textContent  = `${BULAN_PANJANG[crCalMonth]} ${crCalYear}`;
  document.getElementById('cal-right-label').textContent = `${BULAN_PANJANG[rightMonth]} ${rightYear}`;

  renderMiniCal(document.getElementById('cal-left-grid'),  crCalYear,  crCalMonth);
  renderMiniCal(document.getElementById('cal-right-grid'), rightYear,  rightMonth);

  // Update preview label
  document.getElementById('range-start-label').textContent = crStartDate ? fmtDate(crStartDate) : 'Pilih tanggal mulai';
  document.getElementById('range-end-label').textContent   = crEndDate   ? fmtDate(crEndDate)   : 'Pilih tanggal akhir';

  // Enable apply hanya jika keduanya sudah dipilih
  document.getElementById('custom-range-apply').disabled = !(crStartDate && crEndDate);
}
function onDayClick(iso) {
  if (crPicking === 'start') {
    crStartDate = iso;
    crEndDate   = null;
    crPicking   = 'end';
  } else {
    if (iso < crStartDate) {
      // Kalau pilih tanggal sebelum start, reset
      crStartDate = iso;
      crEndDate   = null;
      crPicking   = 'end';
    } else {
      crEndDate = iso;
      crPicking = 'start';
    }
  }
  renderCustomRangeCals();
}
function openCustomRange() {
  crPicking = 'start';
  // Buka di bulan start yang tersimpan, atau bulan sekarang
  if (crStartDate) {
    const [y, m] = crStartDate.split('-');
    crCalYear  = parseInt(y);
    crCalMonth = parseInt(m) - 1;
  } else {
    crCalYear  = new Date().getFullYear();
    crCalMonth = new Date().getMonth();
  }
  renderCustomRangeCals();
  document.getElementById('custom-range-overlay').classList.add('open');
}
function closeCustomRange() {
  document.getElementById('custom-range-overlay').classList.remove('open');
}
function applyCustomRange() {
  if (!crStartDate || !crEndDate) return;
  localStorage.setItem('crStartDate', crStartDate);
  localStorage.setItem('crEndDate',   crEndDate);
  localStorage.setItem('filterPeriod', 'custom');
  filterPeriod = 'custom';

  // Update label tombol custom range
  updateCustomRangeLabel();

  // Nonaktifkan period btn
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));

  closeCustomRange();
  renderKPIs();
  initRevenueChart();
}
function resetCustomRange() {
  crStartDate  = null;
  crEndDate    = null;
  filterPeriod = 'month';
  localStorage.removeItem('crStartDate');
  localStorage.removeItem('crEndDate');
  localStorage.setItem('filterPeriod', 'month');

  // Aktifkan kembali tombol Bulan
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === 'month');
  });

  updateCustomRangeLabel();
  renderKPIs();
  initRevenueChart();
}
function updateCustomRangeLabel() {
  const btn = document.querySelector('.custom-range-btn');
  if (!btn) return;
  if (filterPeriod === 'custom' && crStartDate && crEndDate) {
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
      ${fmtDate(crStartDate)} – ${fmtDate(crEndDate)}
      <span id="reset-range-btn" style="
        margin-left:4px; width:16px; height:16px;
        border-radius:50%; background:rgba(255,255,255,0.2);
        display:inline-flex; align-items:center; justify-content:center;
        font-size:0.75rem; line-height:1; font-weight:700;
        transition: background 0.2s;
      ">✕</span>
    `;
    btn.classList.add('active');

    // Pasang event di tombol ✕ — stopPropagation supaya tidak trigger openCustomRange
    setTimeout(() => {
      const resetBtn = document.getElementById('reset-range-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          resetCustomRange();
        });
        resetBtn.addEventListener('mouseenter', () => resetBtn.style.background = 'rgba(255,255,255,0.35)');
        resetBtn.addEventListener('mouseleave', () => resetBtn.style.background = 'rgba(255,255,255,0.2)');
      }
    }, 0);
  } else {
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
      Custom Range
    `;
    btn.classList.remove('active');
  }
}

// Event listeners custom range
document.getElementById('cal-prev').addEventListener('click', () => {
  if (crCalMonth === 0) { crCalMonth = 11; crCalYear--; }
  else crCalMonth--;
  renderCustomRangeCals();
});
document.getElementById('cal-next').addEventListener('click', () => {
  if (crCalMonth === 11) { crCalMonth = 0; crCalYear++; }
  else crCalMonth++;
  renderCustomRangeCals();
});
document.getElementById('custom-range-cancel').addEventListener('click', closeCustomRange);
document.getElementById('custom-range-apply').addEventListener('click', applyCustomRange);
document.getElementById('custom-range-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCustomRange();
});
document.querySelector('.custom-range-btn').addEventListener('click', openCustomRange);
function initMonthPicker(uid) {
  const btn      = document.getElementById('month-picker-btn');
  const dropdown = document.getElementById('month-dropdown');
  const grid     = document.getElementById('month-grid');
  const yearEl   = document.getElementById('year-label');

  function renderGrid() {
    yearEl.textContent = filterYear;
    grid.innerHTML = '';
    bulanNama.forEach((nama, i) => {
      const div = document.createElement('div');
      div.className = 'month-item' + (i === filterMonth ? ' active' : '');
      div.textContent = nama;
      div.addEventListener('click', async (e) => {
        e.stopPropagation();
        filterMonth = i;
        saveFilterState();
        updateMonthLabel();
        dropdown.classList.remove('open');
        renderGrid();

        // Reset flag fromServer & slip-edited supaya slip ikut fresh
        document.querySelectorAll('.slip-editable').forEach(el => {
          delete el.dataset.fromServer;
          el.classList.remove('slip-edited');
        });
        // Kosongkan extra rows supaya tidak double
        document.getElementById('slip-pendapatan-extra').innerHTML = '';
        document.getElementById('slip-bonus-extra').innerHTML      = '';
        document.getElementById('slip-potongan-extra').innerHTML   = '';

        await Promise.all([
          renderKPIs(),
          initRevenueChart(),
          renderSalesTable(),
          renderProductAnalysis(),
          renderHunters(),
          renderVarianChart(),
          updateSlipPreview(),
          renderNotaGrid(),
        ]);
      });
      grid.appendChild(div);
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    renderGrid();
  });

  document.getElementById('prev-year').addEventListener('click', async (e) => {
    e.stopPropagation();
    filterYear--;
    saveFilterState();
    renderGrid();
    document.querySelectorAll('.slip-editable').forEach(el => {
      delete el.dataset.fromServer;
      el.classList.remove('slip-edited');
    });
    document.getElementById('slip-pendapatan-extra').innerHTML = '';
    document.getElementById('slip-bonus-extra').innerHTML      = '';
    document.getElementById('slip-potongan-extra').innerHTML   = '';
    await Promise.all([
      renderKPIs(), initRevenueChart(), renderSalesTable(),
      renderHunters(), renderVarianChart(), updateSlipPreview(), renderNotaGrid(),
    ]);
  });

  document.getElementById('next-year').addEventListener('click', async (e) => {
    e.stopPropagation();
    filterYear++;
    saveFilterState();
    renderGrid();
    document.querySelectorAll('.slip-editable').forEach(el => {
      delete el.dataset.fromServer;
      el.classList.remove('slip-edited');
    });
    document.getElementById('slip-pendapatan-extra').innerHTML = '';
    document.getElementById('slip-bonus-extra').innerHTML      = '';
    document.getElementById('slip-potongan-extra').innerHTML   = '';
    await Promise.all([
      renderKPIs(), initRevenueChart(), renderSalesTable(),
      renderHunters(), renderVarianChart(), updateSlipPreview(), renderNotaGrid(),
    ]);
  });
  document.addEventListener('click', () => dropdown.classList.remove('open'));
}

async function fetchUsersFromFirestore(uid) {
  try {
    const q    = query(
      collection(db, 'users'),
      where('createdBy', '==', uid)
    );
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    console.log('🔥 Firestore users:', data);
    await saveUsersToDB(data);
    console.log('💾 IndexedDB users updated');
  } catch (err) {
    console.error('❌ Gagal fetch users:', err);
  }
}
async function saveUsersToDB(dataArr) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_USERS, 'readwrite');
    const store = tx.objectStore(STORE_USERS);
    dataArr.forEach(item => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function fetchKantorCabangFromFirestore(uid) {
  try {
    const kantorCabang = await getKantorCabangFromDB();
    const idCabang     = kantorCabang?.idCabang ?? kantorCabang?.id ?? null;
    if (!idCabang) { console.warn('⚠️ idCabang tidak ditemukan'); return; }

    const snap = await getDoc(doc(db, 'kantorCabang', idCabang));
    if (!snap.exists()) { console.warn('⚠️ kantorCabang tidak ditemukan di Firestore'); return; }

    const data = { id: snap.id, ...snap.data() };
    await saveKantorCabangToDB(data);
    console.log('💾 IndexedDB kantorCabang updated');
  } catch (err) {
    console.error('❌ Gagal fetch kantorCabang:', err);
  }
}
async function saveKantorCabangToDB(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_KANTOR_CABANG, 'readwrite');
    const store = tx.objectStore(STORE_KANTOR_CABANG);
    store.put(data);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function fetchLaporanFromFirestore(uid) {
  const btn = document.getElementById('reload-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const yyyy      = filterYear;
    const mm        = String(filterMonth + 1).padStart(2, '0');
    const startDate = `${yyyy}-${mm}-01`;
    const endDate   = `${yyyy}-${mm}-31`;

    const q    = query(
      collection(db, "users", uid, "laporanAdmin"),
      where("tanggal", ">=", startDate),
      where("tanggal", "<=", endDate)
    );
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ tanggal: d.id, ...d.data() }));
    console.log("🔥 Firestore laporanAdmin bulan ini:", data);

    await Promise.all([
      saveLaporanToDB(data),
      fetchKantorCabangFromFirestore(uid),
    ]);
    console.log("💾 IndexedDB laporanAdmin & kantorCabang updated");
  } catch (err) {
    console.error("❌ Gagal fetch laporanAdmin:", err);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}
async function saveLaporanToDB(dataArr) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_LAPORAN, "readwrite");
    const store = tx.objectStore(STORE_LAPORAN);
    dataArr.forEach(item => store.put(item)); // put = insert atau update kalau tanggal sama
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function getLaporanAdminFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_LAPORAN, "readonly");
    const store = tx.objectStore(STORE_LAPORAN);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    console.log("Belum login");
    return;
  }
  currentUser = user;
  console.log("Login:", user.uid);

  // Ambil data lokal dulu
  const [users, kantorCabang, laporanAdmin] = await Promise.all([
    getUsersFromDB(),
    getKantorCabangFromDB(),
    getLaporanAdminFromDB()
  ]);

  console.log("Users lokal:", users);
  console.log("Kantor cabang:", kantorCabang);
  console.log("Laporan admin:", laporanAdmin);
  // Tombol reload → query Firestore laporanAdmin
  const reloadBtn = document.getElementById('reload-btn');
  reloadBtn.onclick = async () => {
    await Promise.all([
      fetchLaporanFromFirestore(user.uid),
      fetchUsersFromFirestore(user.uid),
    ]);
    await renderKPIs();
    initRevenueChart();
  };
  initMonthPicker(user.uid);
  updateMonthLabel();
  updateCustomRangeLabel();

  // Auto-fetch dari Firestore saat pertama buka, biar semua device dapat data fresh
  await fetchLaporanFromFirestore(user.uid);

  await renderKPIs();
  renderSalesTable();
  renderProductAnalysis();
  renderHunters();
  renderVarianChart();
  populateSlipNama();
  initSlipGaji();

  setTimeout(() => {
    initRevenueChart();
  }, 300);
});

function updateClock() {
  const el = document.getElementById('realtime-clock');
  if (!el) return;
  const now = new Date();
  const options = {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  };
  el.textContent = now.toLocaleDateString('id-ID', options);
}
setInterval(updateClock, 1000);
document.addEventListener('DOMContentLoaded', () => updateClock());

document.querySelectorAll('.period-btn').forEach(btn => {
  // Set active sesuai state tersimpan
  if (btn.dataset.period === filterPeriod) btn.classList.add('active');
  else btn.classList.remove('active');

  btn.addEventListener('click', function () {
    filterPeriod = this.dataset.period;
    saveFilterState();
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    // Tampilkan/sembunyikan month picker — hanya muncul saat mode bulan atau tahun
    const monthPickerBtn = document.getElementById('month-picker-btn');
    if (monthPickerBtn) {
      monthPickerBtn.style.display = filterPeriod === 'week' ? 'none' : '';
    }

    renderKPIs();
    initRevenueChart();
    renderSalesTable();
    renderHunters();
    renderVarianChart();
    updateSlipPreview();
  });
});

function animateCounter(element, target, prefix = '', suffix = '', duration = 1500) {
  const startTime = performance.now();
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(target * easeOut);
    element.textContent = prefix + current.toLocaleString('id-ID') + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}
function formatCurrency(value) {
  return 'Rp ' + Number(value).toLocaleString('id-ID');
}

const KPI_COLORS = [];
function hitungKPIFromLaporan(laporanArr) {
  let totalRevenue    = 0;
  let grossProfit     = 0;
  let netProfit       = 0;
  let totalKurirOrder = 0;

  const SKIP_KEYS = new Set([
    'tanggal', 'updatedAt', 'createdAt', 'createdBy', 'idCabang',
    'pengeluaranProduksi', 'pengeluaranDistribusi', 'stockOpname'
  ]);

  laporanArr.forEach(doc => {
    // Expenditure — baca langsung dari root doc
    const pgl = doc?.pengeluaranDistribusi ?? {};
    grossProfit += Number(pgl?.customerBaruHunter?.upahHunter ?? 0);
    grossProfit += (pgl?.lainnya ?? [])
      .reduce((a, b) => a + (Number(b?.harga) || 0), 0);
    grossProfit += (pgl?.perbaikanPeralatan ?? [])
      .reduce((a, b) => a + (Number(b?.harga) || 0), 0);

    // Revenue, Net Profit, Kurir Order — dari object per UID
    Object.entries(doc).forEach(([key, val]) => {
      if (SKIP_KEYS.has(key)) return;
      if (!val || typeof val !== 'object') return;

      const keuangan = val?.distribusi?.keuangan;
      if (keuangan && typeof keuangan === 'object') {
        totalRevenue += Number(keuangan.grossMargin   ?? 0);
        netProfit    += Number(keuangan.profitKemarin ?? 0);
      }

      const closing = val?.pembayaran?.closing;
      if (closing && typeof closing === 'object') {
        Object.values(closing).forEach(qty => {
          totalKurirOrder += Number(qty ?? 0);
        });
      }
    });
  });

  return { totalRevenue, grossProfit, netProfit, totalKurirOrder };
}
function buildKpiData(totalRevenue, grossProfit, netProfit, totalKurirOrder, revChange, grossChange, netChange, kurirChange) {
  return [
    {
      label: 'Total Revenue', value: totalRevenue, prefix: 'Rp ', suffix: '',
      icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
      change: revChange.pct, up: revChange.up, color: KPI_COLORS[0]
    },
    {
      label: 'Expenditure', value: grossProfit, prefix: 'Rp ', suffix: '',
      icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      change: grossChange.pct, up: grossChange.up, color: KPI_COLORS[1]
    },
    {
      label: 'Net Profit', value: netProfit, prefix: 'Rp ', suffix: '',
      icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
      change: netChange.pct, up: netChange.up, color: KPI_COLORS[2],
      extraBtn: true, extraValue: netProfit - grossProfit
    },
    {
      label: 'Total Kurir Order', value: totalKurirOrder, prefix: '', suffix: ' Order',
      icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z',
      change: kurirChange.pct, up: kurirChange.up, color: KPI_COLORS[3]
    },
  ];
}
async function renderKPIs() {
  const grid = document.getElementById('kpi-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const semua = await getLaporanAdminFromDB();

  // Bulan sekarang
  const yyyy      = filterYear;
  const mm        = String(filterMonth + 1).padStart(2, '0');
  const startDate = `${yyyy}-${mm}-01`;
  const endDate   = `${yyyy}-${mm}-31`;
  const laporanArr  = getFilteredLaporan(semua);
  const laporanPrev = getPrevFilteredLaporan(semua);

  console.log(`📅 Period: ${filterPeriod} | Sekarang: ${laporanArr.length} docs | Kemarin: ${laporanPrev.length} docs`);

  const curr = hitungKPIFromLaporan(laporanArr);
  const prev = hitungKPIFromLaporan(laporanPrev);

  function hitungPersen(currVal, prevVal) {
    if (prevVal === 0) return { pct: null, up: currVal >= 0 };
    const pct = ((currVal - prevVal) / Math.abs(prevVal)) * 100;
    return { pct: Math.round(pct * 10) / 10, up: pct >= 0 };
  }

  const revChange    = hitungPersen(curr.totalRevenue,    prev.totalRevenue);
  const grossChange  = hitungPersen(curr.grossProfit,     prev.grossProfit);
  const netChange    = hitungPersen(curr.netProfit,       prev.netProfit);
  const kurirChange  = hitungPersen(curr.totalKurirOrder, prev.totalKurirOrder);

  const kpiData = buildKpiData(
    curr.totalRevenue, curr.grossProfit, curr.netProfit, curr.totalKurirOrder,
    revChange, grossChange, netChange, kurirChange
  );

  kpiData.forEach((kpi, index) => {
    const card = document.createElement('div');
    card.className = `kpi-card kpi-card--${index}`;
    card.innerHTML = `
      <div class="kpi-card-top">
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="${kpi.icon}"/>
          </svg>
        </div>
        ${kpi.extraBtn ? `
          <button class="kpi-net-bersih-btn" data-value="${kpi.extraValue}">
            Net Profit Bersih
          </button>
        ` : ''}
      </div>
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-value" data-target="${kpi.value}" data-prefix="${kpi.prefix}" data-suffix="${kpi.suffix}">0</div>
      <div class="kpi-change ${kpi.up ? 'up' : 'down'}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="${kpi.up ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'}"/>
        </svg>
        ${kpi.change !== null ? (kpi.change > 0 ? '+' : '') + kpi.change + '% vs bln lalu' : 'Belum ada data bln lalu'}
      </div>
    `;
    grid.appendChild(card);
    setTimeout(() => {
      const valEl = card.querySelector('.kpi-value');
      animateCounter(valEl, kpi.value, kpi.prefix, kpi.suffix);
    }, index * 100);

    const extraBtn = card.querySelector('.kpi-net-bersih-btn');
    if (extraBtn) {
      let showing = false;
      const valEl = card.querySelector('.kpi-value');
      extraBtn.addEventListener('click', () => {
        showing = !showing;
        const target = showing ? Number(extraBtn.dataset.value) : kpi.value;
        const label  = showing ? 'Net Profit Bersih' : 'Net Profit';
        card.querySelector('.kpi-label').textContent = label;
        extraBtn.textContent = showing ? 'Tampilkan Semua' : 'Net Profit Bersih';
        extraBtn.classList.toggle('active', showing);
        animateCounter(valEl, target, kpi.prefix, kpi.suffix);
      });
    }
  });
}

let revenueChartInstance = null;
function buildChartLabelsAndData(laporanArr) {
  const SKIP_KEYS = new Set([
    'tanggal','updatedAt','createdAt','createdBy','idCabang',
    'pengeluaranProduksi','stockOpname'
    // pengeluaranDistribusi DIHAPUS dari skip — sekarang dibaca per UID
  ]);

  if (laporanArr.length === 0) return { labels: [], revenue: [], grossProfit: [], netProfit: [] };

  const perTanggal = {};
  laporanArr.forEach(doc => {
    const tanggal = doc.tanggal;
    let rev = 0, gross = 0, net = 0;

    // Expenditure dari root doc
    const pgl = doc?.pengeluaranDistribusi ?? {};
    gross += Number(pgl?.customerBaruHunter?.upahHunter ?? 0);
    gross += (pgl?.lainnya ?? []).reduce((a, b) => a + (Number(b?.harga) || 0), 0);
    gross += (pgl?.perbaikanPeralatan ?? []).reduce((a, b) => a + (Number(b?.harga) || 0), 0);

    Object.entries(doc).forEach(([k, val]) => {
      if (SKIP_KEYS.has(k)) return;
      if (!val || typeof val !== 'object') return;

      const keu = val?.distribusi?.keuangan;
      if (keu && typeof keu === 'object') {
        rev += Number(keu.grossMargin   ?? 0);
        net += Number(keu.profitKemarin ?? 0);
      }
    });

    if (!perTanggal[tanggal]) perTanggal[tanggal] = { rev: 0, gross: 0, net: 0 };
    perTanggal[tanggal].rev   += rev;
    perTanggal[tanggal].gross += gross;
    perTanggal[tanggal].net   += net;
  });

  if (filterPeriod === 'year') {
    const mapRev = {}, mapGross = {}, mapNet = {};
    Object.entries(perTanggal).forEach(([tgl, val]) => {
      const m   = parseInt(tgl.split('-')[1]) - 1;
      const key = bulanNama[m];
      mapRev[key]   = (mapRev[key]   || 0) + val.rev;
      mapGross[key] = (mapGross[key] || 0) + val.gross;
      mapNet[key]   = (mapNet[key]   || 0) + val.net;
    });
    const labels      = bulanNama.filter(b => mapRev[b] !== undefined || mapGross[b] !== undefined);
    const revenue     = labels.map(l => mapRev[l]   || 0);
    const grossProfit = labels.map(l => mapGross[l] || 0);
    const netProfit   = labels.map(l => mapNet[l]   || 0);
    return { labels, revenue, grossProfit, netProfit };
  }

  const sortedDates = Object.keys(perTanggal).sort();
  const labels      = sortedDates.map(tgl => {
    const [y, m, d] = tgl.split('-');
    return `${parseInt(d)} ${bulanNama[parseInt(m)-1]}`;
  });
  const revenue     = sortedDates.map(tgl => perTanggal[tgl].rev);
  const grossProfit = sortedDates.map(tgl => perTanggal[tgl].gross);
  const netProfit   = sortedDates.map(tgl => perTanggal[tgl].net);

  return { labels, revenue, grossProfit, netProfit };
}
async function initRevenueChart() {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;

  const semua      = await getLaporanAdminFromDB();
  const laporanArr = getFilteredLaporan(semua);
  const { labels, revenue, grossProfit, netProfit } = buildChartLabelsAndData(laporanArr);

  // Hitung lebar dinamis — min 35px per label
  const container   = canvas.parentElement;
  const minWidth    = Math.max(container.clientWidth, labels.length * 35);
  canvas.style.width  = minWidth + 'px';
  canvas.style.height = '300px';
  canvas.width        = minWidth;
  canvas.height       = 300;

  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color       = '#8a6540';
  Chart.defaults.scale.grid.color = 'rgba(176,138,92,0.08)';

  if (revenueChartInstance) { revenueChartInstance.destroy(); revenueChartInstance = null; }

  const ctx = canvas.getContext('2d');
  revenueChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revenue,
          borderColor: '#b18b63',
          backgroundColor: 'rgba(177,139,99,0.1)',
          borderWidth: 3, tension: 0.4, fill: true,
          pointBackgroundColor: '#b18b63', pointBorderColor: '#fff',
          pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
        },
        {
          label: 'Expenditure',
          data: grossProfit,
          borderColor: '#2ecc71',
          backgroundColor: 'rgba(46,204,113,0.08)',
          borderWidth: 3, tension: 0.4, fill: true,
          pointBackgroundColor: '#2ecc71', pointBorderColor: '#fff',
          pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
        },
        {
          label: 'Net Profit',
          data: netProfit,
          borderColor: '#3498db',
          backgroundColor: 'rgba(52,152,219,0.07)',
          borderWidth: 3, tension: 0.4, fill: true,
          pointBackgroundColor: '#3498db', pointBorderColor: '#fff',
          pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(111,83,50,0.95)',
          titleColor: '#fff', bodyColor: '#fff',
          borderColor: 'rgba(176,138,92,0.22)', borderWidth: 1,
          padding: 12, cornerRadius: 8,
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          ticks: { callback: value => formatCurrency(value) }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

async function fetchHariLibur(uidAdmin, bulan) {
  try {
    const ref  = doc(db, "users", uidAdmin, "hariLibur", bulan);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data().jumlahHari ?? 0) : 0;
  } catch (err) {
    console.error("❌ fetchHariLibur:", err);
    return 0;
  }
}
async function saveHariLibur(uidAdmin, bulan, jumlahHari, idCabang) {
  const ref = doc(db, "users", uidAdmin, "hariLibur", bulan);
  await setDoc(ref, { idCabang, jumlahHari, bulan }, { merge: true });
}
async function getSalesUsers() {
  const users = await getUsersFromDB();
  return users.filter(u => u.role === 'kurir' || u.role === 'hunter' || u.role === 'sales');
}
async function getSalesTableData() {
  const [users, allLaporan, kantorCabang] = await Promise.all([
    getSalesUsers(),
    getLaporanAdminFromDB(),
    getKantorCabangFromDB()
  ]);

  const filtered  = getFilteredLaporan(allLaporan);
  const bulanKey  = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}`;
  const idCabang  = kantorCabang?.id ?? '';
  const uidAdmin  = currentUser?.uid ?? '';

  const hariLiburArr = await Promise.all(
    users.map(u => fetchHariLibur(uidAdmin, bulanKey))
  );

  // Hitung libur distribusi (misal "Minggu") dalam bulan filter
  const namaHariLiburDist = kantorCabang?.hariLibur?.distribusi ?? null;
  const HARI_MAP = { 'Minggu':0,'Senin':1,'Selasa':2,'Rabu':3,'Kamis':4,'Jumat':5,'Sabtu':6 };
  const totalHariBulan = new Date(filterYear, filterMonth + 1, 0).getDate();
  let liburDistribusi = 0;
  if (namaHariLiburDist && HARI_MAP[namaHariLiburDist] !== undefined) {
    const targetDay = HARI_MAP[namaHariLiburDist];
    for (let d = 1; d <= totalHariBulan; d++) {
      if (new Date(filterYear, filterMonth, d).getDay() === targetDay) liburDistribusi++;
    }
  }
  const bonusKehadiranVal = kantorCabang?.bonus?.kehadiran ?? 0;

  return users.map((user, i) => {
    const uid  = user.uid;
    const docs = filtered.filter(doc => doc[uid] && typeof doc[uid] === 'object');

    const sumField = (getter) => docs.reduce((acc, doc) => {
      return acc + (Number(getter(doc[uid])) || 0);
    }, 0);

    return {
      uid,
      nama:         user.nama,
      role:         user.role,
      pay:          sumField(d => {
                      const obj = d?.distribusi?.pay;
                      if (!obj || typeof obj !== 'object') return 0;
                      return Object.entries(obj)
                        .filter(([k]) => k !== 'margin')
                        .reduce((a, [, v]) => a + (Number(v) || 0), 0);
                    }),
      payRaw:       docs.reduce((acc, doc) => {
                      const obj = doc[user.uid]?.distribusi?.pay;
                      if (!obj) return acc;
                      Object.entries(obj).forEach(([k, v]) => {
                        if (k === 'margin') return;
                        acc[k] = (acc[k] || 0) + (Number(v) || 0);
                      });
                      acc.margin = (acc.margin || 0) + (Number(obj.margin) || 0);
                      return acc;
                    }, {}),
      expired:      sumField(d => {
                      const obj = d?.distribusi?.expired;
                      if (!obj || typeof obj !== 'object') return 0;
                      return Object.entries(obj)
                        .filter(([k]) => k !== 'margin')
                        .reduce((a, [, v]) => a + (Number(v) || 0), 0);
                    }),
      expiredRaw:   docs.reduce((acc, doc) => {
                      const obj = doc[user.uid]?.distribusi?.expired;
                      if (!obj) return acc;
                      Object.entries(obj).forEach(([k, v]) => {
                        if (k === 'margin') return;
                        acc[k] = (acc[k] || 0) + (Number(v) || 0);
                      });
                      acc.margin = (acc.margin || 0) + (Number(obj.margin) || 0);
                      return acc;
                    }, {}),
      customerNew:  sumField(d => d?.distribusi?.infoTarget?.customerNew),
      customerPutus:    sumField(d => d?.distribusi?.infoTarget?.putus),
      potonganCustomer: sumField(d => d?.distribusi?.infoTarget?.potongan?.potonganTargetCustomer),
      potonganData:     sumField(d => d?.distribusi?.infoTarget?.potongan?.potonganTargetData),
      kasbon:           sumField(d => d?.distribusi?.keuangan?.kasbon),
      klaimInsentif:    sumField(d => d?.distribusi?.keuangan?.klaimInsentif),
      bonusKunjungan:   sumField(d => d?.distribusi?.keuangan?.bonus?.bonusKunjungan),
      bonusPay:         sumField(d => d?.distribusi?.keuangan?.bonus?.bonusPay),
      hariKerja:        docs.length,
      hariLibur:        hariLiburArr[i],
      bonusKehadiran:   (docs.length + hariLiburArr[i] + liburDistribusi === totalHariBulan)
                          ? bonusKehadiranVal : 0,
      _bulanKey:        bulanKey,
      _idCabang:        idCabang,
      _uidAdmin:        uidAdmin,
    };
  });
}
function showHariLiburPopup(sales) {
  const existing = document.getElementById('hari-libur-popup');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'hari-libur-popup';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.4);
    display:flex;align-items:center;justify-content:center;z-index:9999;
  `;

  overlay.innerHTML = `
    <div class="hari-libur-popup-box">
      <div class="hari-libur-popup-title">Hari Libur</div>
      <div class="hari-libur-popup-sub">${sales.nama} · ${sales._bulanKey}</div>
      <input id="hari-libur-input" type="number" min="0" max="31" value="${sales.hariLibur}" class="hari-libur-input"/>
      <div class="hari-libur-popup-btns">
        <button id="hari-libur-cancel" class="hari-libur-btn-cancel">Batal</button>
        <button id="hari-libur-save" class="hari-libur-btn-save">Simpan</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('hari-libur-cancel').addEventListener('click', () => overlay.remove());

  const saveBtn = document.getElementById('hari-libur-save');
  saveBtn.addEventListener('click', async () => {
    const val = parseInt(document.getElementById('hari-libur-input').value) || 0;
    saveBtn.textContent = 'Menyimpan...';
    saveBtn.disabled = true;
    try {
      await saveHariLibur(sales._uidAdmin, sales._bulanKey, val, sales._idCabang);
      saveBtn.textContent = '✓ Tersimpan';
      saveBtn.style.background = '#2ecc71';
      setTimeout(() => { overlay.remove(); renderSalesTable(); }, 800);
    } catch (err) {
      saveBtn.textContent = '✗ Gagal';
      saveBtn.style.background = '#e74c3c';
      saveBtn.disabled = false;
      setTimeout(() => {
        saveBtn.textContent = 'Simpan';
        saveBtn.style.background = 'var(--accent,#b18b63)';
      }, 2000);
    }
  });
}
function showDetailPopup(title, obj, anchorEl, expiredObj, payObj) {
  // Tutup popup lain yang terbuka
  document.querySelectorAll('.detail-popup').forEach(p => p.remove());
  document.removeEventListener('click', closeDetailPopup);

  const entries = Object.entries(obj ?? {}).filter(([k]) => k !== 'margin');
  const margin  = Number(obj?.margin ?? 0);

  // Hitung persentase expired dari pay (hanya jika expiredObj disertakan)
  let persenHtml = '';
  if (expiredObj !== undefined) {
    const totalExpired = Object.entries(expiredObj ?? {})
      .filter(([k]) => k !== 'margin')
      .reduce((a, [, v]) => a + (Number(v) || 0), 0);
    const totalPay = Object.entries(payObj ?? {})
      .filter(([k]) => k !== 'margin')
      .reduce((a, [, v]) => a + (Number(v) || 0), 0);
    console.log('totalPay:', totalPay, '| totalExpired:', totalExpired);
    const persen = totalPay > 0 ? ((totalExpired / totalPay) * 100).toFixed(1) : '0.0';
    persenHtml = `
      <div class="detail-popup-footer-row">
        <span class="detail-popup-footer-label">Persentase Expired</span>
        <span class="detail-popup-footer-val">${persen}%</span>
      </div>
    `;
  }

  const rows = entries.length
    ? entries.map(([k, v]) => `
        <div class="detail-popup-row">
          <span class="detail-popup-key">${k}</span>
          <span class="detail-popup-val">${Number(v).toLocaleString('id-ID')}</span>
        </div>`).join('')
    : `<div class="detail-popup-key" style="text-align:center;padding:12px 0;">Tidak ada data</div>`;

  const popup = document.createElement('div');
  popup.className = 'detail-popup';
  popup.innerHTML = `
    <div class="detail-popup-title">${title}</div>
    ${rows}
    <hr class="detail-popup-divider">
    <div class="detail-popup-footer-row">
      <span class="detail-popup-footer-label">Jumlah Uang</span>
      <span class="detail-popup-footer-val">${margin.toLocaleString('id-ID')}</span>
    </div>
    ${persenHtml}
    <button class="detail-popup-close">Tutup</button>
  `;
  document.body.appendChild(popup);

  // Posisi dekat anchor
  const rect = anchorEl.getBoundingClientRect();
  const popupW = 260;
  const popupH = popup.offsetHeight;
  let top  = rect.bottom + 8;
  let left = rect.left;
  if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
  if (top + popupH > window.innerHeight + window.scrollY - 8) top = rect.top + window.scrollY - popupH - 8;
  popup.style.top  = `${top}px`;
  popup.style.left = `${left}px`;

  popup.querySelector('.detail-popup-close').addEventListener('click', () => popup.remove());

  // Klik di luar popup → tutup
  setTimeout(() => {
    document.addEventListener('click', closeDetailPopup);
  }, 0);
}
function closeDetailPopup(e) {
  const popup = document.querySelector('.detail-popup');
  if (popup && !popup.contains(e.target)) {
    popup.remove();
    document.removeEventListener('click', closeDetailPopup);
  }
}

document.getElementById('btn-slip-gaji').addEventListener('click', toggleSlipGaji);
function toggleSlipGaji() {
  const card = document.getElementById('slip-gaji-card');
  const btn  = document.getElementById('btn-slip-gaji');
  const open = card.style.display === 'none';
  card.style.display = open ? 'block' : 'none';
  btn.textContent    = open ? 'Tutup Slip Gaji' : 'Tetapkan Slip Gaji';
}
async function populateSlipNama() {
  const users  = await getSalesUsers();
  const select = document.getElementById('slip-nama');
  if (!select) return;
  select.innerHTML = '<option value="">-- Pilih Nama --</option>';
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value       = u.uid;
    opt.textContent = u.nama;
    select.appendChild(opt);
  });
}
function initSlipGaji() {
  // Auto-isi periode dari filter aktif
  const periodeEl = document.getElementById('slip-periode');
  if (periodeEl) {
    periodeEl.value = `${bulanNama[filterMonth]} ${filterYear}`;
  }

  // Update periode jika filter berubah
  document.getElementById('slip-nama')?.dispatchEvent(new Event('change'));

  // Mirror nama ke preview
  document.getElementById('slip-nama')?.addEventListener('change', updateSlipPreview);
  // Mirror catatan ke preview
  document.getElementById('slip-catatan')?.addEventListener('input', () => {
    const val = document.getElementById('slip-catatan').value.trim();
    const group = document.getElementById('prev-catatan-group');
    const text  = document.getElementById('prev-catatan-text');
    if (val) {
      text.textContent  = val;
      group.style.display = '';
    } else {
      group.style.display = 'none';
    }
  });
  
  // Tombol load data server
  document.getElementById('slip-btn-load-server')?.addEventListener('click', async () => {
    const btn         = document.getElementById('slip-btn-load-server');
    const selectedUid = document.getElementById('slip-nama')?.value;
    const periode     = document.getElementById('slip-periode')?.value?.trim();

    if (!selectedUid) return showToast('Pilih nama karyawan dulu', 'warning');
    if (!periode)     return showToast('Periode belum terisi', 'warning');

    // Format periodeId sama seperti saat simpan
    const bulanMap = {
      'Januari':'01','Februari':'02','Maret':'03','April':'04',
      'Mei':'05','Juni':'06','Juli':'07','Agustus':'08',
      'September':'09','Oktober':'10','November':'11','Desember':'12'
    };
    const [namaBulan, tahun] = periode.split(' ');
    const periodeId = `${tahun}-${bulanMap[namaBulan] ?? '00'}`;

    // Loading state
    btn.disabled   = true;
    btn.textContent = '⏳ Memuat...';

    try {
      const docRef  = doc(db, 'users', selectedUid, 'slipGaji', periodeId);
      const snap    = await getDoc(docRef);

      if (!snap.exists()) {
        btn.textContent      = '📭 Belum ada data';
        btn.style.background = '#f39c12';
        btn.style.color      = '#fff';
        btn.style.border     = 'none';
        setTimeout(() => {
          btn.disabled         = false;
          btn.textContent      = 'Tampilkan Data Server';
          btn.style.background = '';
          btn.style.color      = '';
          btn.style.border     = '';
        }, 2000);
        return;
      }

      const data = snap.data();

      // Helper: set field dari server — pasang flag supaya tidak di-overwrite updateSlipPreview
      const setField = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = Number(val) ? Number(val).toLocaleString('id-ID') : (val ?? '0');
        el.dataset.original = val;
        el.dataset.fromServer = '1';
        el.classList.remove('slip-edited');
      };

      // Ambil dari struktur slipGaji array
      const pendapatan = data.slipGaji?.[0]?.pendapatan ?? {};
      const bonus      = data.slipGaji?.[1]?.bonus      ?? {};
      const potongan   = data.slipGaji?.[2]?.potongan   ?? {};

      // Populate pendapatan
      setField('slip-upah-hari',      pendapatan.upahPokok?.hari       ?? 0);
      setField('slip-upah-uang',      pendapatan.upahPokok?.pembayaran ?? 0);
      setField('slip-transport-hari', pendapatan.tunjanganTransport?.hari       ?? 0);
      setField('slip-transport-uang', pendapatan.tunjanganTransport?.pembayaran ?? 0);

      if (pendapatan.tunjanganLibur) {
        setField('slip-libur-hari', pendapatan.tunjanganLibur.hari       ?? 0);
        setField('slip-libur-uang', pendapatan.tunjanganLibur.pembayaran ?? 0);
        const rowLibur = document.getElementById('slip-row-libur');
        if (rowLibur) rowLibur.style.display = '';
      }

      // Populate bonus
      setField('slip-bonus-pay-uang',       bonus.bonusPay?.pembayaran       ?? 0);
      setField('slip-bonus-kunjungan-uang', bonus.bonusKunjungan?.pembayaran ?? 0);
      setField('slip-bonus-kehadiran-uang', bonus.bonusKehadiran?.pembayaran ?? 0);

      // Populate potongan
      setField('slip-pot-customer', potongan.targetCustomer?.pembayaran ?? 0);
      setField('slip-pot-data',     potongan.targetData?.pembayaran     ?? 0);
      setField('slip-pot-kasbon',   potongan.kasbon?.pembayaran         ?? 0);
      setField('slip-pot-klaim',    potongan.klaimInsentif?.pembayaran  ?? 0);

      // Populate catatan
      const catatanEl = document.getElementById('slip-catatan');
      if (catatanEl) catatanEl.value = data.catatan ?? '';

      // Populate extra rows pendapatan
      const extraKeys = ['upahPokok','tunjanganTransport','tunjanganLibur'];
      const containerPendapatan = document.getElementById('slip-pendapatan-extra');
      containerPendapatan.innerHTML = '';
      Object.entries(pendapatan).forEach(([key, val]) => {
        if (extraKeys.includes(key)) return;
        const idx = containerPendapatan.children.length;
        const row = document.createElement('div');
        row.className = 'slip-extra-row';
        row.innerHTML = `
          <input class="slip-extra-input" type="text" placeholder="Nama" data-group="pendapatan" data-idx="${idx}" data-field="nama" value="${key}"/>
          <input class="slip-extra-input" type="number" placeholder="0" data-group="pendapatan" data-idx="${idx}" data-field="hari" value="${val.hari ?? 0}"/>
          <input class="slip-extra-input" type="number" placeholder="0" data-group="pendapatan" data-idx="${idx}" data-field="uang" value="${val.pembayaran ?? 0}"/>
        `;
        row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateSlipPreview));
        containerPendapatan.appendChild(row);
      });

      // Populate extra rows bonus
      const bonusFixedKeys = ['bonusPay','bonusKunjungan','bonusKehadiran'];
      const containerBonus = document.getElementById('slip-bonus-extra');
      containerBonus.innerHTML = '';
      Object.entries(bonus).forEach(([key, val]) => {
        if (bonusFixedKeys.includes(key)) return;
        const idx = containerBonus.children.length;
        const row = document.createElement('div');
        row.className = 'slip-extra-row';
        row.innerHTML = `
          <input class="slip-extra-input" type="text" placeholder="Nama" data-group="bonus" data-idx="${idx}" data-field="nama" value="${key}"/>
          <input class="slip-extra-input" type="number" placeholder="0" data-group="bonus" data-idx="${idx}" data-field="hari" value="${val.hari ?? 0}"/>
          <input class="slip-extra-input" type="number" placeholder="0" data-group="bonus" data-idx="${idx}" data-field="uang" value="${val.pembayaran ?? 0}"/>
        `;
        row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateSlipPreview));
        containerBonus.appendChild(row);
      });

      // Populate extra rows potongan
      const potonganFixedKeys = ['targetCustomer','targetData','kasbon','klaimInsentif'];
      const containerPotongan = document.getElementById('slip-potongan-extra');
      containerPotongan.innerHTML = '';
      Object.entries(potongan).forEach(([key, val]) => {
        if (potonganFixedKeys.includes(key)) return;
        const idx = containerPotongan.children.length;
        const row = document.createElement('div');
        row.className = 'slip-extra-row';
        row.innerHTML = `
          <input class="slip-extra-input" type="text" placeholder="Nama" data-group="potongan" data-idx="${idx}" data-field="nama" value="${key}"/>
          <input class="slip-extra-input" type="number" placeholder="0" data-group="potongan" data-idx="${idx}" data-field="hari" value="${val.hari ?? 0}"/>
          <input class="slip-extra-input" type="number" placeholder="0" data-group="potongan" data-idx="${idx}" data-field="uang" value="${val.pembayaran ?? 0}"/>
        `;
        row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateSlipPreview));
        containerPotongan.appendChild(row);
      });
      updateSlipPreview();

      // Sukses state
      btn.textContent      = '✅ Data Dimuat';
      btn.style.background = '#2ecc71';
      btn.style.color      = '#fff';
      btn.style.border     = 'none';

      setTimeout(() => {
        btn.disabled         = false;
        btn.textContent      = 'Tampilkan Data Server';
        btn.style.background = '';
        btn.style.color      = '';
        btn.style.border     = '';
      }, 2000);

    } catch (err) {
      console.error('Gagal load data server:', err);
      btn.textContent      = '❌ Gagal Memuat';
      btn.style.background = '#e74c3c';
      btn.style.color      = '#fff';
      btn.style.border     = 'none';

      setTimeout(() => {
        btn.disabled         = false;
        btn.textContent      = 'Tampilkan Data Server';
        btn.style.background = '';
        btn.style.color      = '';
        btn.style.border     = '';
      }, 2000);
    }
  });

  // Tombol tambah pendapatan
  document.getElementById('slip-add-pendapatan')?.addEventListener('click', () => {
    const container = document.getElementById('slip-pendapatan-extra');
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'slip-extra-row';
    row.innerHTML = `
      <input class="slip-extra-input" type="text" placeholder="Nama" data-group="pendapatan" data-idx="${idx}" data-field="nama"/>
      <input class="slip-extra-input" type="number" placeholder="0" data-group="pendapatan" data-idx="${idx}" data-field="hari"/>
      <input class="slip-extra-input" type="number" placeholder="0" data-group="pendapatan" data-idx="${idx}" data-field="uang"/>
    `;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateSlipPreview));
    container.appendChild(row);
    updateSlipPreview();
  });

  // Tombol tambah bonus
  document.getElementById('slip-add-bonus')?.addEventListener('click', () => {
    const container = document.getElementById('slip-bonus-extra');
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'slip-extra-row';
    row.innerHTML = `
      <input class="slip-extra-input" type="text" placeholder="Nama" data-group="bonus" data-idx="${idx}" data-field="nama"/>
      <input class="slip-extra-input" type="number" placeholder="0" data-group="bonus" data-idx="${idx}" data-field="hari"/>
      <input class="slip-extra-input" type="number" placeholder="0" data-group="bonus" data-idx="${idx}" data-field="uang"/>
    `;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateSlipPreview));
    container.appendChild(row);
    updateSlipPreview();
  });

  // Tombol tambah potongan
  document.getElementById('slip-add-potongan')?.addEventListener('click', () => {
    const container = document.getElementById('slip-potongan-extra');
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'slip-extra-row';
    row.innerHTML = `
      <input class="slip-extra-input" type="text" placeholder="Nama" data-group="potongan" data-idx="${idx}" data-field="nama"/>
      <input class="slip-extra-input" type="number" placeholder="0" data-group="potongan" data-idx="${idx}" data-field="hari"/>
      <input class="slip-extra-input" type="number" placeholder="0" data-group="potongan" data-idx="${idx}" data-field="uang"/>
    `;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateSlipPreview));
    container.appendChild(row);
    updateSlipPreview();
  });
}
async function updateSlipPreview() {
  const kantorCabang = await getKantorCabangFromDB();
  const uid          = document.getElementById('slip-nama')?.value;
  const allLaporan   = await getLaporanAdminFromDB();
  const filtered     = getFilteredLaporan(allLaporan);

  // Hitung hariKerja user terpilih
  let hariKerja = 0;
  if (uid) {
    const docs = filtered.filter(doc => doc[uid] && typeof doc[uid] === 'object');
    hariKerja  = docs.length;
  }

  const bonusKehadiran = Number(kantorCabang?.bonus?.kehadiran    ?? 0);
  const insentif       = Number(kantorCabang?.bonus?.data?.insentif ?? 0);
  const upahPokok      = hariKerja * bonusKehadiran;
  const transport      = hariKerja * insentif;

  // Hitung hariLibur user terpilih
  let hariLibur = 0;
  if (uid) {
    const bulanKey = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}`;
    const hlVal    = await fetchHariLibur(currentUser?.uid ?? '', bulanKey);
    hariLibur      = Number(hlVal ?? 0);
  }
  const tunjanganLibur = hariLibur * bonusKehadiran;

  // Update form kiri — set value + simpan original untuk highlight deteksi
  function setEditableField(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    el.dataset.original = val;

    // Jangan overwrite kalau sudah diedit user ATAU sudah diisi dari server
    if (!el.classList.contains('slip-edited') && !el.dataset.fromServer) {
      el.value = Number(val) ? Number(val).toLocaleString('id-ID') : val;
    }

    if (!el._listenerAttached) {
      el.addEventListener('input', () => {
        const raw = el.value.replace(/\./g, '').replace(',', '.');
        const changed = Number(raw) !== Number(el.dataset.original);
        el.classList.toggle('slip-edited', changed);
        // Hapus flag server kalau user mulai edit
        if (changed) delete el.dataset.fromServer;
        updateSlipPreview();
      });
      el._listenerAttached = true;
    }
  }

  setEditableField('slip-upah-hari',      hariKerja);
  setEditableField('slip-upah-uang',      upahPokok);
  setEditableField('slip-transport-hari', hariKerja);
  setEditableField('slip-transport-uang', transport);

  // Tunjangan Hari Libur di form kiri
  const rowLibur = document.getElementById('slip-row-libur');
  if (tunjanganLibur > 0) {
    if (rowLibur) {
      setEditableField('slip-libur-hari', hariLibur);
      setEditableField('slip-libur-uang', tunjanganLibur);
      rowLibur.style.display = '';
    }
  } else {
    if (rowLibur) rowLibur.style.display = 'none';
  }

  // Nama & periode preview
  const namaEl   = document.getElementById('slip-nama');
  const namaTeks = namaEl?.options[namaEl.selectedIndex]?.text ?? '-';
  document.getElementById('prev-nama').textContent    = uid ? namaTeks : '-';
  const periodeTeks = `${bulanNama[filterMonth]} ${filterYear}`;
  if (document.getElementById('slip-periode')) {
    document.getElementById('slip-periode').value = periodeTeks;
  }
  document.getElementById('prev-periode').textContent = periodeTeks;

  // Baca dari input (bisa sudah di-override user)
  const getVal = (id) => {
    const raw = document.getElementById(id)?.value ?? '0';
    return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
  };

  const upahPokoFinal    = getVal('slip-upah-uang');
  const upahHariFinal    = getVal('slip-upah-hari');
  const transportFinal   = getVal('slip-transport-uang');
  const transportHariFinal = getVal('slip-transport-hari');
  const liburUangFinal   = getVal('slip-libur-uang');
  const liburHariFinal   = getVal('slip-libur-hari');

  // Build preview rows pendapatan
  let totalPendapatan = upahPokoFinal + transportFinal + (tunjanganLibur > 0 ? liburUangFinal : 0);
  let rowsHtml = `
    <div class="slip-row">
      <span class="slip-row-nama">Upah Pokok</span>
      <span class="slip-row-hari">${upahHariFinal}</span>
      <span class="slip-row-uang">${upahPokoFinal.toLocaleString('id-ID')}</span>
    </div>
    <div class="slip-row">
      <span class="slip-row-nama">Tunjangan Transport</span>
      <span class="slip-row-hari">${transportHariFinal}</span>
      <span class="slip-row-uang">${transportFinal.toLocaleString('id-ID')}</span>
    </div>
    ${tunjanganLibur > 0 ? `
    <div class="slip-row">
      <span class="slip-row-nama">Tunjangan Hari Libur</span>
      <span class="slip-row-hari">${liburHariFinal}</span>
      <span class="slip-row-uang">${liburUangFinal.toLocaleString('id-ID')}</span>
    </div>` : ''}
  `;

  // Extra rows
  const extras = document.querySelectorAll('#slip-pendapatan-extra .slip-extra-row');
  extras.forEach(row => {
    const nama = row.querySelector('[data-field="nama"]')?.value || '-';
    const hari = Number(row.querySelector('[data-field="hari"]')?.value) || 0;
    const uang = Number(row.querySelector('[data-field="uang"]')?.value) || 0;
    totalPendapatan += uang;
    rowsHtml += `
      <div class="slip-row">
        <span class="slip-row-nama">${nama}</span>
        <span class="slip-row-hari">${hari || '-'}</span>
        <span class="slip-row-uang">${uang.toLocaleString('id-ID')}</span>
      </div>
    `;
  });

  document.getElementById('prev-pendapatan-rows').innerHTML = rowsHtml;
  document.getElementById('prev-total-pendapatan').textContent = `Rp ${totalPendapatan.toLocaleString('id-ID')}`;

  // Ambil nilai bonus dari salesData
  let bonusPay       = 0;
  let bonusKunjungan = 0;
  let bonusKehadiranVal = 0;
  if (uid) {
    const allLap  = await getLaporanAdminFromDB();
    const filt    = getFilteredLaporan(allLap);
    const docs    = filt.filter(doc => doc[uid] && typeof doc[uid] === 'object');
    const sumF    = (getter) => docs.reduce((acc, doc) => acc + (Number(getter(doc[uid])) || 0), 0);
    bonusPay          = sumF(d => d?.distribusi?.keuangan?.bonus?.bonusPay);
    bonusKunjungan    = sumF(d => d?.distribusi?.keuangan?.bonus?.bonusKunjungan);
    const totalHariBulan  = new Date(filterYear, filterMonth + 1, 0).getDate();
    const namaHariLiburDist = kantorCabang?.hariLibur?.distribusi ?? null;
    const HARI_MAP = {'Minggu':0,'Senin':1,'Selasa':2,'Rabu':3,'Kamis':4,'Jumat':5,'Sabtu':6};
    let liburDist = 0;
    if (namaHariLiburDist && HARI_MAP[namaHariLiburDist] !== undefined) {
      const targetDay = HARI_MAP[namaHariLiburDist];
      for (let d = 1; d <= totalHariBulan; d++) {
        if (new Date(filterYear, filterMonth, d).getDay() === targetDay) liburDist++;
      }
    }
    bonusKehadiranVal = (hariKerja + hariLibur + liburDist === totalHariBulan) ? bonusKehadiran : 0;
  }

  // Update form kiri bonus
  setEditableField('slip-bonus-pay-uang',       bonusPay);
  setEditableField('slip-bonus-kunjungan-uang', bonusKunjungan);
  setEditableField('slip-bonus-kehadiran-uang', bonusKehadiranVal);

  // Baca dari input bonus (bisa di-override)
  const bonusPayFinal       = getVal('slip-bonus-pay-uang');
  const bonusKunjunganFinal = getVal('slip-bonus-kunjungan-uang');
  const bonusKehadiranFinal = getVal('slip-bonus-kehadiran-uang');

  // Build preview bonus rows
  let bonusRowsHtml = `
    <div class="slip-row">
      <span class="slip-row-nama">Bonus Pay</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${bonusPayFinal.toLocaleString('id-ID')}</span>
    </div>
    <div class="slip-row">
      <span class="slip-row-nama">Bonus Kunjungan</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${bonusKunjunganFinal.toLocaleString('id-ID')}</span>
    </div>
    <div class="slip-row">
      <span class="slip-row-nama">Bonus Kehadiran</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${bonusKehadiranFinal.toLocaleString('id-ID')}</span>
    </div>
  `;
  // Extra rows bonus
  let totalBonusFinal = bonusPayFinal + bonusKunjunganFinal + bonusKehadiranFinal;
  const bonusExtras = document.querySelectorAll('#slip-bonus-extra .slip-extra-row');
  bonusExtras.forEach(row => {
    const nama = row.querySelector('[data-field="nama"]')?.value || '-';
    const hari = Number(row.querySelector('[data-field="hari"]')?.value) || 0;
    const uang = Number(row.querySelector('[data-field="uang"]')?.value) || 0;
    totalBonusFinal += uang;
    bonusRowsHtml += `
      <div class="slip-row">
        <span class="slip-row-nama">${nama}</span>
        <span class="slip-row-hari">${hari || '-'}</span>
        <span class="slip-row-uang">${uang.toLocaleString('id-ID')}</span>
      </div>
    `;
  });

  document.getElementById('prev-bonus-rows').innerHTML  = bonusRowsHtml;
  document.getElementById('prev-total-bonus').textContent = `Rp ${totalBonusFinal.toLocaleString('id-ID')}`;
  // Potongan
  let potCustomer = 0;
  let potData     = 0;
  let kasbon      = 0;
  let klaimInsentif = 0;
  if (uid) {
    const allLap2 = await getLaporanAdminFromDB();
    const filt2   = getFilteredLaporan(allLap2);
    const docs2   = filt2.filter(doc => doc[uid] && typeof doc[uid] === 'object');
    const sumF2   = (getter) => docs2.reduce((acc, doc) => acc + (Number(getter(doc[uid])) || 0), 0);
    potCustomer  = sumF2(d => d?.distribusi?.infoTarget?.potongan?.potonganTargetCustomer);
    potData      = sumF2(d => d?.distribusi?.infoTarget?.potongan?.potonganTargetData);
    kasbon       = sumF2(d => d?.distribusi?.keuangan?.kasbon);
    klaimInsentif= sumF2(d => d?.distribusi?.keuangan?.klaimInsentif);
  }

  // Update form kiri potongan
  setEditableField('slip-pot-customer', potCustomer);
  setEditableField('slip-pot-data',     potData);
  setEditableField('slip-pot-kasbon',   kasbon);
  setEditableField('slip-pot-klaim',    klaimInsentif);

  // Baca dari input potongan (bisa di-override)
  const potCustomerFinal = getVal('slip-pot-customer');
  const potDataFinal     = getVal('slip-pot-data');
  const kasbonFinal      = getVal('slip-pot-kasbon');
  const klaimFinal       = getVal('slip-pot-klaim');

  // Build preview potongan rows
  const totalPotongan = potCustomerFinal + potDataFinal + kasbonFinal + klaimFinal;
  let potonganRowsHtml = `
    <div class="slip-row">
      <span class="slip-row-nama">Target Customer</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${potCustomerFinal.toLocaleString('id-ID')}</span>
    </div>
    <div class="slip-row">
      <span class="slip-row-nama">Target Data</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${potDataFinal.toLocaleString('id-ID')}</span>
    </div>
    <div class="slip-row">
      <span class="slip-row-nama">Kasbon</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${kasbonFinal.toLocaleString('id-ID')}</span>
    </div>
    <div class="slip-row">
      <span class="slip-row-nama">Klaim Insentif</span>
      <span class="slip-row-hari">-</span>
      <span class="slip-row-uang">${klaimFinal.toLocaleString('id-ID')}</span>
    </div>
  `;
  // Extra rows potongan
  let totalPotonganFinal = totalPotongan;
  let potonganRowsHtmlFinal = potonganRowsHtml;
  const potonganExtras = document.querySelectorAll('#slip-potongan-extra .slip-extra-row');
  potonganExtras.forEach(row => {
    const nama = row.querySelector('[data-field="nama"]')?.value || '-';
    const hari = Number(row.querySelector('[data-field="hari"]')?.value) || 0;
    const uang = Number(row.querySelector('[data-field="uang"]')?.value) || 0;
    totalPotonganFinal += uang;
    potonganRowsHtmlFinal += `
      <div class="slip-row">
        <span class="slip-row-nama">${nama}</span>
        <span class="slip-row-hari">${hari || '-'}</span>
        <span class="slip-row-uang">${uang.toLocaleString('id-ID')}</span>
      </div>
    `;
  });

  document.getElementById('prev-potongan-rows').innerHTML     = potonganRowsHtmlFinal;
  document.getElementById('prev-total-potongan').textContent  = `Rp ${totalPotonganFinal.toLocaleString('id-ID')}`;

  // Total Penerimaan = Total Pendapatan + Total Bonus - Total Potongan
  const totalPenerimaan = totalPendapatan + totalBonusFinal - totalPotonganFinal;
  const elPenerimaan = document.getElementById('prev-total-penerimaan');
  if (elPenerimaan) {
    elPenerimaan.textContent = `Rp ${totalPenerimaan.toLocaleString('id-ID')}`;
    elPenerimaan.style.color = totalPenerimaan >= 0 ? '' : '#e74c3c';
  }
}
document.getElementById('slip-btn-simpan')?.addEventListener('click', async () => {
  const btn = document.getElementById('slip-btn-simpan');

  // === VALIDASI ===
  const selectedUid = document.getElementById('slip-nama')?.value;
  const periode     = document.getElementById('slip-periode')?.value?.trim();
  if (!selectedUid) return showToast('Pilih nama karyawan dulu', 'warning');
    if (!periode)     return showToast('Periode belum terisi', 'warning');

  // === HELPER ===
  const getVal = (id) => {
    const raw = document.getElementById(id)?.value ?? '0';
    return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
  };

  // === PENDAPATAN ===
  const pendapatan = {
    upahPokok: {
      hari      : getVal('slip-upah-hari'),
      pembayaran: getVal('slip-upah-uang'),
    },
    tunjanganTransport: {
      hari      : getVal('slip-transport-hari'),
      pembayaran: getVal('slip-transport-uang'),
    },
  };

  const liburUang = getVal('slip-libur-uang');
  if (liburUang > 0) {
    pendapatan.tunjanganLibur = {
      hari      : getVal('slip-libur-hari'),
      pembayaran: liburUang,
    };
  }

  document.querySelectorAll('#slip-pendapatan-extra .slip-extra-row').forEach(row => {
    const nama = row.querySelector('[data-field="nama"]')?.value?.trim();
    const hari = Number(row.querySelector('[data-field="hari"]')?.value) || 0;
    const uang = Number(row.querySelector('[data-field="uang"]')?.value) || 0;
    if (nama) {
      const key = nama.replace(/\s+/g, '_').toLowerCase();
      pendapatan[key] = { hari, pembayaran: uang };
    }
  });

  // === BONUS ===
  const bonus = {
    bonusPay      : { hari: 0, pembayaran: getVal('slip-bonus-pay-uang') },
    bonusKunjungan: { hari: 0, pembayaran: getVal('slip-bonus-kunjungan-uang') },
    bonusKehadiran: { hari: 0, pembayaran: getVal('slip-bonus-kehadiran-uang') },
  };

  document.querySelectorAll('#slip-bonus-extra .slip-extra-row').forEach(row => {
    const nama = row.querySelector('[data-field="nama"]')?.value?.trim();
    const hari = Number(row.querySelector('[data-field="hari"]')?.value) || 0;
    const uang = Number(row.querySelector('[data-field="uang"]')?.value) || 0;
    if (nama) {
      const key = nama.replace(/\s+/g, '_').toLowerCase();
      bonus[key] = { hari, pembayaran: uang };
    }
  });

  // === POTONGAN ===
  const potongan = {
    targetCustomer: { hari: 0, pembayaran: getVal('slip-pot-customer') },
    targetData    : { hari: 0, pembayaran: getVal('slip-pot-data') },
    kasbon        : { hari: 0, pembayaran: getVal('slip-pot-kasbon') },
    klaimInsentif : { hari: 0, pembayaran: getVal('slip-pot-klaim') },
  };

  document.querySelectorAll('#slip-potongan-extra .slip-extra-row').forEach(row => {
    const nama = row.querySelector('[data-field="nama"]')?.value?.trim();
    const hari = Number(row.querySelector('[data-field="hari"]')?.value) || 0;
    const uang = Number(row.querySelector('[data-field="uang"]')?.value) || 0;
    if (nama) {
      const key = nama.replace(/\s+/g, '_').toLowerCase();
      potongan[key] = { hari, pembayaran: uang };
    }
  });

  // === TOTAL PENERIMAAN ===
  const totalPenerimaan = Number(
    document.getElementById('prev-total-penerimaan')
      ?.textContent?.replace('Rp', '').replace(/\./g, '').replace(',', '.').trim()
  ) || 0;

  // === CATATAN ===
  const catatan = document.getElementById('slip-catatan')?.value?.trim() ||
    'Pembayaran gaji telah dilakukan oleh perusahaan Melalui delegasi secara tunai ke pegawai';

  // === PERIODE ID ===
  // "Mei 2026" → "2026-05"
  const bulanMap = {
    'Januari':'01','Februari':'02','Maret':'03','April':'04',
    'Mei':'05','Juni':'06','Juli':'07','Agustus':'08',
    'September':'09','Oktober':'10','November':'11','Desember':'12'
  };
  const [namaBulan, tahun] = periode.split(' ');
  const periodeId = `${tahun}-${bulanMap[namaBulan] ?? '00'}`;

  // === BUILD DOKUMEN ===
  const idCabang = (await getKantorCabangFromDB())?.id ?? '';

  const docData = {
    createdBy : currentUser.uid,
    idCabang  : idCabang,
    idUser    : selectedUid,
    periode   : periodeId,
    createdAt : serverTimestamp(),
    slipGaji  : [
      { pendapatan },
      { bonus },
      { potongan },
    ],
    totalPenerimaan,
    catatan,
  };

  // === SIMPAN ===
  btn.disabled  = true;
  btn.innerHTML = `<span class="slip-btn-spinner"></span> Menyimpan...`;

  await new Promise(r => setTimeout(r, 1000));

  try {
    const docRef = doc(db, 'users', selectedUid, 'slipGaji', periodeId);
    await setDoc(docRef, docData);

    // State: sukses
    btn.innerHTML = `✅ Berhasil Disimpan`;
    btn.style.background = '#2ecc71';

    setTimeout(() => {
      btn.disabled         = false;
      btn.innerHTML        = 'Simpan Slip Gaji';
      btn.style.background = '';
    }, 2000);

  } catch (err) {
    console.error('Gagal simpan slip gaji:', err);

    // State: gagal
    btn.innerHTML        = `❌ Gagal: ${err.message}`;
    btn.style.background = '#e74c3c';

    setTimeout(() => {
      btn.disabled         = false;
      btn.innerHTML        = 'Simpan Slip Gaji';
      btn.style.background = '';
    }, 2000);
  }
});

function getRoleBadge(role) {
  const valid = ['kurir', 'hunter', 'sales'];
  const slug  = valid.includes(role) ? role : 'default';
  const label = role ? role.charAt(0).toUpperCase() + role.slice(1) : '-';
  return `<span class="role-badge role-badge--${slug}">${label}</span>`;}
async function renderSalesTable() {
  const tbody = document.getElementById('sales-tbody');
  if (!tbody) return;
  tbody.style.opacity = '0.4';

  const kantorCabang = await getKantorCabangFromDB();
  const varian       = kantorCabang?.varian ?? {};
  const varianKeys = (kantorCabang?.varianOrder ?? Object.keys(varian).sort());

  // Build header dinamis
  const thead = document.querySelector('#sales-table thead tr');
  if (thead) {
    // Reset ke Nama saja dulu
    thead.innerHTML = '<th>Nama</th>';
    varianKeys.forEach(key => {
      const th = document.createElement('th');
      th.textContent = key;
      thead.appendChild(th);
    });

    ['Pembayaran', 'Keterangan', 'Total Setoran'].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      thead.appendChild(th);
    });
  }

  const salesData = await getSalesTableData();
  tbody.innerHTML = '';
  tbody.style.opacity = '1';
  initTableDrag();

  const allLaporan = await getLaporanAdminFromDB();
  const filtered   = getFilteredLaporan(allLaporan);

  salesData.forEach((sales, idx) => {
    const uid  = sales.uid;
    const docs = filtered.filter(doc => doc[uid] && typeof doc[uid] === 'object');

    // Jumlahkan closing per key varian dari semua dokumen bulan ini
    const closingPerKey = {};
    varianKeys.forEach(key => {
      closingPerKey[key] = docs.reduce((acc, doc) => {
        return acc + (Number(doc[uid]?.pembayaran?.closing?.[key]) || 0);
      }, 0);
    });

    const fmt = (val) => val ? val.toLocaleString('id-ID') : '';

    const pembayaran = docs.reduce((acc, doc) => {
      return acc + (Number(doc[uid]?.pembayaran?.nota?.bayar) || 0);
    }, 0);

    const keterangan = docs.reduce((acc, doc) => {
      return acc + (Number(doc[uid]?.pembayaran?.nota?.keterangan) || 0);
    }, 0);

    const totalSetoran = pembayaran - keterangan;

    const varianTds = varianKeys.map(key =>
      `<td>${closingPerKey[key] ? closingPerKey[key].toLocaleString('id-ID') : ''}</td>`
    ).join('');

    const tr = document.createElement('tr');
    if (keterangan < 0) tr.classList.add('row-keterangan-minus');
    tr.innerHTML = `
      <td><strong>${sales.nama ?? '-'}</strong>${getRoleBadge(sales.role)}</td>
      ${varianTds}
      <td>${fmt(pembayaran)}</td>
      <td>${fmt(keterangan)}</td>
      <td>${fmt(totalSetoran)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Baris sum per kolom
  const sumClosingPerKey = {};
  varianKeys.forEach(key => { sumClosingPerKey[key] = 0; });
  let sumPembayaran = 0, sumKeterangan = 0, sumSetoran = 0;

  salesData.forEach(sales => {
    const uid  = sales.uid;
    const docs = filtered.filter(doc => doc[uid] && typeof doc[uid] === 'object');

    varianKeys.forEach(key => {
      sumClosingPerKey[key] += docs.reduce((acc, doc) =>
        acc + (Number(doc[uid]?.pembayaran?.closing?.[key]) || 0), 0);
    });

    sumPembayaran += docs.reduce((acc, doc) =>
      acc + (Number(doc[uid]?.pembayaran?.nota?.bayar) || 0), 0);
    sumKeterangan += docs.reduce((acc, doc) =>
      acc + (Number(doc[uid]?.pembayaran?.nota?.keterangan) || 0), 0);
  });
  sumSetoran = sumPembayaran - sumKeterangan;

  const trSum = document.createElement('tr');
  trSum.style.cssText = 'font-weight:700; border-top: 2px solid var(--laporan-row-border); background: var(--custom-option-hover-bg);';
  const varianSumTds = varianKeys.map(key =>
    `<td>${sumClosingPerKey[key] ? sumClosingPerKey[key].toLocaleString('id-ID') : '-'}</td>`
  ).join('');
  trSum.innerHTML = `
    <td>Total</td>
    ${varianSumTds}
    <td>${sumPembayaran ? sumPembayaran.toLocaleString('id-ID') : '-'}</td>
    <td>${sumKeterangan ? sumKeterangan.toLocaleString('id-ID') : '-'}</td>
    <td>${sumSetoran ? sumSetoran.toLocaleString('id-ID') : '-'}</td>
  `;
  tbody.appendChild(trSum);

  // ── Build donut chart data ──────────────────
  const allLaporan2 = await getLaporanAdminFromDB();
  const filtered2   = getFilteredLaporan(allLaporan2);

  const totalPerKey = {};
  varianKeys.forEach(key => { totalPerKey[key] = 0; });
  totalPerKey['Pembayaran']    = 0;
  totalPerKey['Keterangan']    = 0;
  totalPerKey['Total Setoran'] = 0;

  salesData.forEach(sales => {
    const uid  = sales.uid;
    const docs = filtered2.filter(doc => doc[uid] && typeof doc[uid] === 'object');

    varianKeys.forEach(key => {
      totalPerKey[key] += docs.reduce((acc, doc) =>
        acc + (Number(doc[uid]?.pembayaran?.closing?.[key]) || 0), 0);
    });

    totalPerKey['Pembayaran'] += docs.reduce((acc, doc) =>
      acc + (Number(doc[uid]?.pembayaran?.nota?.bayar) || 0), 0);

    const keteranganSales = docs.reduce((acc, doc) =>
      acc + (Number(doc[uid]?.pembayaran?.nota?.keterangan) || 0), 0);
    const pembayaranSales = docs.reduce((acc, doc) =>
      acc + (Number(doc[uid]?.pembayaran?.nota?.bayar) || 0), 0);

    totalPerKey['Keterangan']    += keteranganSales;
    totalPerKey['Total Setoran'] += pembayaranSales - keteranganSales;
  });

  const donutLabels = [...varianKeys];
  const donutData   = donutLabels.map(k => Math.abs(totalPerKey[k] || 0));
  const donutTotal  = donutData.reduce((a, b) => a + b, 0);

  const DONUT_COLORS = [
    '#b18b63','#e8c98a','#a0c878','#6baed6',
    '#e07b6b','#b39ddb','#f48fb1','#80cbc4','#ffd54f'
  ];

  // Legend
  const legendEl = document.getElementById('sales-donut-legend');
  if (legendEl) {
    legendEl.innerHTML = donutLabels.map((label, i) => `
      <div class="sales-donut-legend-item">
        <span class="sales-donut-legend-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]};"></span>
        <span class="sales-donut-legend-label">${label}</span>
        <span class="sales-donut-legend-val">${(totalPerKey[label] || 0).toLocaleString('id-ID')}</span>
      </div>
    `).join('');
  }

  document.getElementById('sales-donut-total').textContent = donutTotal.toLocaleString('id-ID');

  const donutCanvas = document.getElementById('salesDonutChart');
  if (donutCanvas) {
    if (window._salesDonutInstance) { window._salesDonutInstance.destroy(); }
    window._salesDonutInstance = new Chart(donutCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: donutLabels,
        datasets: [{
          data: donutData,
          backgroundColor: DONUT_COLORS,
          borderColor: '#fff',
          borderWidth: 2,
          hoverOffset: 8,
          borderRadius: 3,
        }]
      },
      options: {
        cutout: '65%',
        responsive: false,
        animation: { animateRotate: true, duration: 800 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: c => `${c.label}: ${c.parsed.toLocaleString('id-ID')}`
            }
          }
        }
      }
    });
  }
}
async function renderProductAnalysis() {
  const kantorCabang = await getKantorCabangFromDB();
  const varian       = kantorCabang?.varian ?? {};
  const varianKeys   = Object.keys(varian);

  const JENIS = [
    'Saldo Kemarin',
    'Input',
    'Output',
    'Fee',
    'Rusak Freezer',
    'Basi Freezer',
    'Off Flavor',
    'Promosi',
    'Barang Hilang',
    'Saldo Akhir',
  ];

  const container = document.getElementById('product-analysis-card');
  if (!container) return;

  const bulanKey     = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}`;
  const prevDate     = new Date(filterYear, filterMonth - 1, 1);
  const bulanPrevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  // Ambil saldo bulan kemarin dari Firestore
  const saldoKemarin = {};
  try {
    const snap = await getDoc(
      doc(db, 'users', currentUser.uid, 'saldoBulanKemarin', bulanPrevKey)
    );
    if (snap.exists()) {
      const data = snap.data()?.saldo ?? {};
      varianKeys.forEach(k => {
        saldoKemarin[k] = Number(data[k] ?? 0);
      });
    } else {
      varianKeys.forEach(k => saldoKemarin[k] = 0);
    }
  } catch (err) {
    varianKeys.forEach(k => saldoKemarin[k] = 0);
  }

  // Data per jenis per varian
  // Ambil semua dokumen bulan ini dari store laporanAdmin
  const allLaporan = await getLaporanAdminFromDB();
  const filtered   = getFilteredLaporan(allLaporan);

  const SKIP_KEYS = new Set([
    'tanggal', 'updatedAt', 'createdAt', 'createdBy',
    'idCabang', 'pengeluaranProduksi', 'pengeluaranDistribusi', 'stockOpname'
  ]);

  const dataMap = {
    'Saldo Kemarin' : saldoKemarin,
    'Input'         : {},
    'Output'        : {},
    'Fee'           : {},
    'Rusak Freezer' : {},
    'Basi Freezer'  : {},
    'Off Flavor'    : {},
    'Promosi'       : {},
    'Barang Hilang' : {},
    'Saldo Akhir'   : {},
  };
  varianKeys.forEach(k => {
    dataMap['Input'][k]         = 0;
    dataMap['Output'][k]        = 0;
    dataMap['Fee'][k]           = 0;
    dataMap['Rusak Freezer'][k] = 0;
    dataMap['Basi Freezer'][k]  = 0;
    dataMap['Off Flavor'][k]    = 0;
    dataMap['Promosi'][k]       = 0;
    dataMap['Barang Hilang'][k] = 0;
    dataMap['Saldo Akhir'][k]   = 0;
  });

  filtered.forEach(docData => {
    const stock = docData?.stockOpname ?? {};

    // Input
    varianKeys.forEach(k => {
      dataMap['Input'][k]         += Number(stock?.produksi?.[k]      ?? 0);
      dataMap['Rusak Freezer'][k] += Number(stock?.rusakFreezer?.[k]  ?? 0);
      dataMap['Basi Freezer'][k]  += Number(stock?.basiFreezer?.[k]   ?? 0);
      dataMap['Promosi'][k]       += Number(stock?.promosi?.[k]       ?? 0);
      dataMap['Barang Hilang'][k] += Number(stock?.barangHilang?.[k]  ?? 0);
    });

    // Output, Fee, Off Flavor — jumlahkan semua UID
    Object.entries(docData).forEach(([key, val]) => {
      if (SKIP_KEYS.has(key)) return;
      if (!val || typeof val !== 'object') return;

      varianKeys.forEach(k => {
        dataMap['Output'][k]    += Number(val?.pembayaran?.closing?.[k] ?? 0);
        dataMap['Fee'][k]       += Number(val?.fee?.[k]                 ?? 0);
        dataMap['Off Flavor'][k]+= Number(val?.offFlavor?.[k]           ?? 0);
      });
    });
  });
  
  // Hitung Saldo Akhir per key
  varianKeys.forEach(k => {
    dataMap['Saldo Akhir'][k] =
      (dataMap['Saldo Kemarin'][k] ?? 0) +
      (dataMap['Input'][k]         ?? 0) -
      (dataMap['Output'][k]        ?? 0) -
      (dataMap['Fee'][k]           ?? 0) -
      (dataMap['Rusak Freezer'][k] ?? 0) -
      (dataMap['Basi Freezer'][k]  ?? 0) -
      (dataMap['Off Flavor'][k]    ?? 0) -
      (dataMap['Promosi'][k]       ?? 0) -
      (dataMap['Barang Hilang'][k] ?? 0);
  });

  const thVarian = varianKeys.map(k =>
    `<th>${kantorCabang.varian[k]} <span style="opacity:0.5;font-weight:400;">(${k})</span></th>`
  ).join('');

  const tdRows = JENIS.map(jenis => {
    const tds = varianKeys.map(k => {
      const val = dataMap[jenis]?.[k] ?? 0;
      return `<td>${val !== 0 ? val.toLocaleString('id-ID') : ''}</td>`;
    }).join('');
    return `
      <tr>
        <td><strong>${jenis}</strong></td>
        ${tds}
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="table-card">
      <div class="card-header" style="margin-bottom:16px;">
        <h3 class="card-title">Product Analysis</h3>
      </div>
      <div class="sales-table-wrapper" style="-webkit-overflow-scrolling:touch;">
        <table class="data-table" id="product-analysis-table" style="min-width:${Math.max(480, varianKeys.length * 120 + 180)}px;">
          <thead>
            <tr>
              <th>Jenis</th>
              ${thVarian}
            </tr>
          </thead>
          <tbody>
            ${tdRows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function initTableDrag() {
  const wrapper = document.querySelector('.sales-table-wrapper');
  if (!wrapper) return;

  let isDown    = false;
  let startX    = 0;
  let scrollLeft = 0;
  let dragStart  = 0;

  wrapper.addEventListener('mousedown', (e) => {
    dragStart = Date.now();
    isDown    = true;
    startX    = e.pageX - wrapper.offsetLeft;
    scrollLeft= wrapper.scrollLeft;
  });

  wrapper.addEventListener('mouseleave', () => {
    isDown = false;
    wrapper.classList.remove('dragging');
  });

  wrapper.addEventListener('mouseup', () => {
    isDown = false;
    wrapper.classList.remove('dragging');
  });

  wrapper.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    // Long press threshold ~150ms
    if (Date.now() - dragStart < 150) return;
    wrapper.classList.add('dragging');
    e.preventDefault();
    const x    = e.pageX - wrapper.offsetLeft;
    const walk = (x - startX) * 1.2;
    wrapper.scrollLeft = scrollLeft - walk;
  });
}

let varianChartInstance = null;
async function renderVarianChart() {
  const kantorCabang = await getKantorCabangFromDB();
  const varian       = kantorCabang?.varian ?? {};
  const produkList   = Object.entries(varian);
  if (!produkList.length) return;

  const allLaporan = await getLaporanAdminFromDB();
  const filtered   = getFilteredLaporan(allLaporan);

  const SKIP_KEYS = new Set(['tanggal','updatedAt','createdAt','createdBy','idCabang',
    'pengeluaranProduksi','pengeluaranDistribusi','stockOpname']);

  const payPerKey = {}, expiredPerKey = {};
  filtered.forEach(doc => {
    Object.entries(doc).forEach(([k, val]) => {
      if (SKIP_KEYS.has(k)) return;
      if (!val || typeof val !== 'object') return;
      produkList.forEach(([varKey]) => {
        payPerKey[varKey]     = (payPerKey[varKey]     || 0) + (Number(val?.distribusi?.pay?.[varKey])     || 0);
        expiredPerKey[varKey] = (expiredPerKey[varKey] || 0) + (Number(val?.distribusi?.expired?.[varKey]) || 0);
      });
    });
  });

  const COLORS = ['#b18b63','#e8c98a','#a0c878','#6baed6','#e07b6b','#b39ddb','#f48fb1','#80cbc4'];

  const labels  = [];
  const data    = [];
  const colors  = [];
  let totalPct  = 0;

  produkList.forEach(([key, nama], i) => {
    const pay     = payPerKey[key]     || 0;
    const expired = expiredPerKey[key] || 0;
    const closing = pay + expired;
    const persen  = closing > 0 ? parseFloat(((pay / closing) * 100).toFixed(1)) : 0;
    labels.push(nama);
    data.push(persen);
    colors.push(COLORS[i % COLORS.length]);
    totalPct += persen;
  });

  const avgPct = data.length > 0 ? (totalPct / data.length).toFixed(1) : '0.0';
  document.getElementById('varian-center-val').textContent = `${avgPct}%`;

  // Legend
  const legend = document.getElementById('varian-legend');
  legend.innerHTML = '';
  produkList.forEach(([key, nama], i) => {
    const pay     = payPerKey[key]     || 0;
    const expired = expiredPerKey[key] || 0;
    const closing = pay + expired;
    const persen  = closing > 0 ? ((pay / closing) * 100).toFixed(1) : '0.0';
    const persenNum = parseFloat(persen);
    
    let alertColor, alertBg, alertIcon, alertText;
    
    if (persenNum >= 90) {
      alertIcon  = '❦';
      alertColor = '#0f8f5a';
      alertBg    = 'rgba(15,143,90,0.08)';
      alertText  = 'Dominasi pasar sangat kuat. Produk menunjukkan tingkat penyerapan yang luar biasa dengan repeat order tinggi dan risiko expired yang sangat rendah. Permintaan pasar masih terbuka lebar sehingga direkomendasikan memperluas area distribusi, meningkatkan stok siap jual, dan mempercepat akuisisi outlet baru.';
    }
    else if (persenNum >= 80) {
      alertIcon  = '𔒝';
      alertColor = '#1a7f4b';
      alertBg    = 'rgba(26,127,75,0.08)';
      alertText  = 'Performa penjualan sangat sehat. Produk diterima dengan baik oleh pasar dan mampu mempertahankan tingkat closing yang tinggi. Fokus pada konsistensi pelayanan, penguatan branding, serta peningkatan frekuensi kunjungan untuk menjaga pertumbuhan.';
    }
    else if (persenNum >= 70) {
      alertIcon  = '𖣂';
      alertColor = '#2e8b57';
      alertBg    = 'rgba(46,139,87,0.08)';
      alertText  = 'Pertumbuhan positif dengan distribusi yang cukup efektif. Produk memiliki daya serap yang baik namun masih terdapat potensi peningkatan pada area tertentu. Aktivasi promosi dan perluasan jangkauan pelanggan dapat mendorong pertumbuhan lebih tinggi.';
    }
    else if (persenNum >= 60) {
      alertIcon  = 'ꕤ';
      alertColor = '#b18b63';
      alertBg    = 'rgba(177,139,99,0.08)';
      alertText  = 'Kondisi pasar relatif stabil. Penjualan masih berada pada level aman namun laju pertumbuhan mulai melambat. Diperlukan monitoring kompetitor, penguatan aktivitas sales, dan evaluasi efektivitas distribusi untuk menjaga momentum.';
    }
    else if (persenNum >= 50) {
      alertIcon  = '⚠';
      alertColor = '#c87941';
      alertBg    = 'rgba(200,121,65,0.08)';
      alertText  = 'Terjadi perlambatan penyerapan produk di pasar. Sebagian distribusi belum mampu dikonversi menjadi penjualan optimal. Perlu evaluasi area distribusi, performa tim lapangan, strategi promosi, serta kualitas eksekusi penjualan.';
    }
    else if (persenNum >= 40) {
      alertIcon  = '📉';
      alertColor = '#d46a2f';
      alertBg    = 'rgba(212,106,47,0.08)';
      alertText  = 'Penjualan berada di bawah target yang diharapkan. Risiko stok lambat bergerak mulai meningkat dan efisiensi distribusi menurun. Dibutuhkan strategi aktivasi pasar, peningkatan akuisisi pelanggan baru, dan optimalisasi kunjungan outlet.';
    }
    else if (persenNum >= 25) {
      alertIcon  = 'ᯤ';
      alertColor = '#d35400';
      alertBg    = 'rgba(211,84,0,0.08)';
      alertText  = 'Respons pasar terhadap produk tergolong lemah. Tingkat expired mulai memberikan dampak signifikan terhadap performa distribusi. Direkomendasikan melakukan audit harga, evaluasi wilayah distribusi, analisis kompetitor, serta penyesuaian strategi pemasaran.';
    }
    else {
      alertIcon  = '.☘܁˖';
      alertColor = '#c0392b';
      alertBg    = 'rgba(192,57,43,0.08)';
      alertText  = 'Kondisi kritis. Produk gagal terserap pasar secara optimal sehingga tingkat expired mendominasi dibanding penjualan. Risiko kerugian, penumpukan stok, dan penurunan produktivitas distribusi sangat tinggi. Tindakan korektif dan evaluasi menyeluruh perlu segera dilakukan.';
    }

    legend.innerHTML += `
      <div class="varian-legend-item" style="background:${alertBg};">
        <div class="varian-legend-row">
          <div class="varian-legend-dot" style="background:${colors[i]};"></div>
          <div class="varian-legend-name">${nama} <span class="varian-legend-key">(${key})</span></div>
          <div class="varian-legend-pct" style="color:${alertColor};">${persen}%</div>
        </div>
        <div class="varian-legend-alert" style="color:${alertColor};">${alertIcon} ${alertText}</div>
      </div>
    `;
  });

  // Chart
  const canvas = document.getElementById('varian-donut-chart');
  if (!canvas) return;
  if (varianChartInstance) { varianChartInstance.destroy(); varianChartInstance = null; }
  
  // Card ke-5: varian terbaik
  const bestIdx    = data.indexOf(Math.max(...data));
  const bestNama   = labels[bestIdx];
  const bestPersen = data[bestIdx];
  const bestColor  = colors[bestIdx];

  const existingBest = document.getElementById('varian-best-card');
  if (existingBest) existingBest.remove();

  const bestCard = document.createElement('div');
  bestCard.id = 'varian-best-card';
  bestCard.className = 'hunter-card';
  bestCard.className = 'hunter-card varian-best-card';
  bestCard.style.cssText = `background:linear-gradient(135deg,${bestColor}22,${bestColor}11);border:2px solid ${bestColor}44;`;
  bestCard.innerHTML = `
    <div class="varian-best-icon">🏆</div>
    <div class="varian-best-nama">${bestNama}</div>
    <div class="varian-best-label">Penjualan paling tinggi</div>
    <div class="varian-best-pct" style="color:${bestColor};">${bestPersen}%</div>
    <div class="varian-best-desc">Varian ini memimpin penjualan bulan ini.<br>Strategis untuk perbesar pasar! 🚀</div>
  `;
  document.getElementById('hunter-grid').appendChild(bestCard);

  varianChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: '#fff',
        borderWidth: 3,
        hoverOffset: 10,
        borderRadius: 4,
      }]
    },
    options: {
      cutout: '65%',
      responsive: false,
      animation: { animateRotate: true, duration: 900 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => `${c.label}: ${c.parsed}%`
          }
        }
      }
    }
  });
}
async function renderHunters() {
  const grid = document.getElementById('hunter-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const kantorCabang = await getKantorCabangFromDB();
  const varian = kantorCabang?.varian ?? {};
  const produkList = Object.entries(varian);

  if (produkList.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Tidak ada produk</div>';
    return;
  }
  const allLaporan = await getLaporanAdminFromDB();
  const filtered   = getFilteredLaporan(allLaporan);

  const SKIP_KEYS = new Set(['tanggal','updatedAt','createdAt','createdBy','idCabang',
    'pengeluaranProduksi','pengeluaranDistribusi','stockOpname']);

  // Akumulasi per key varian, semua uid, semua doc
  const payPerKey     = {};
  const expiredPerKey = {};

  filtered.forEach(doc => {
    Object.entries(doc).forEach(([k, val]) => {
      if (SKIP_KEYS.has(k)) return;
      if (!val || typeof val !== 'object') return;
      const pay     = val?.distribusi?.pay;
      const expired = val?.distribusi?.expired;
      produkList.forEach(([varKey]) => {
        payPerKey[varKey]     = (payPerKey[varKey]     || 0) + (Number(pay?.[varKey])     || 0);
        expiredPerKey[varKey] = (expiredPerKey[varKey] || 0) + (Number(expired?.[varKey]) || 0);
      });
    });
  });

  produkList.forEach(([key, namaProduk], index) => {
    const card = document.createElement('div');
    card.className = 'hunter-card';
    card.style.animationDelay = `${index * 0.05}s`;
    const pay     = payPerKey[key]     || 0;
    const expired = expiredPerKey[key] || 0;
    const closing = pay + expired;
    const persen  = closing > 0 ? ((pay / closing) * 100).toFixed(1) : '0.0';

    card.innerHTML = `
      <div class="hunter-header">
        <div class="hunter-avatar">${key}</div>
        <div>
          <div class="hunter-name">${namaProduk}</div>
        </div>
      </div>
      <div class="hunter-stats">
        <div class="hunter-stat">
          <div class="hunter-stat-value">${pay.toLocaleString('id-ID')}</div>
          <div class="hunter-stat-label">Pay</div>
        </div>
        <div class="hunter-stat">
          <div class="hunter-stat-value">${expired.toLocaleString('id-ID')}</div>
          <div class="hunter-stat-label">Expired</div>
        </div>
        <div class="hunter-stat">
          <div class="hunter-stat-value">${closing.toLocaleString('id-ID')}</div>
          <div class="hunter-stat-label">Closing</div>
        </div>
        <div class="hunter-stat">
          <div class="hunter-stat-value">${persen}%</div>
          <div class="hunter-stat-label">% Pay</div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}
