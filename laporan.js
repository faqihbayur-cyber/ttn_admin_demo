import { auth, db } from "./index.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, collectionGroup, getDocs, query, where,
  doc, getDoc, updateDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    initCalendar();
    await loadKurirFromIndexedDB();
    await renderLaporanHeader();
    setupReloadButton();
    setupInputPengeluaran();
    setupPopupAmplop();
    setupReadingMode();
    await renderLaporanTanggalTable();
  } finally {
    const skeleton = document.getElementById("pageSkeleton");
    if (skeleton) {
      skeleton.style.opacity = "0";
      setTimeout(() => skeleton.remove(), 300);
    }
  }
});

const DB_NAME           = "laporanDistribusiDB";
const STORE_USERS       = "users";
const STORE_LAPORAN_ADMIN = "laporanAdmin";
const STORE_KANTOR_CABANG = "kantorCabang";
const DB_NAME_LAPORAN   = "appAdminCabangDB";
const STORE_DATA_HARIAN = "dataHarian";

let selectedKurirUid = null;
let usersCache       = [];
let laporanFilter    = "all";
let _dragActive      = false;
let _dragOffsetX     = 0;
let _dragOffsetY     = 0;

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);
    checkReq.onsuccess = e => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   =
        !existingDB.objectStoreNames.contains(STORE_USERS) ||
        !existingDB.objectStoreNames.contains(STORE_KANTOR_CABANG) ||
        !existingDB.objectStoreNames.contains(STORE_LAPORAN_ADMIN);
      existingDB.close();
      const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;
      const req = indexedDB.open(DB_NAME, targetVersion);
      req.onupgradeneeded = ev => {
        const dbUp = ev.target.result;
        if (!dbUp.objectStoreNames.contains(STORE_USERS)) {
          const s = dbUp.createObjectStore(STORE_USERS, { keyPath: "uid" });
          s.createIndex("createdBy", "createdBy", { unique: false });
        }
        if (!dbUp.objectStoreNames.contains(STORE_KANTOR_CABANG))
          dbUp.createObjectStore(STORE_KANTOR_CABANG, { keyPath: "id" });
        if (!dbUp.objectStoreNames.contains(STORE_LAPORAN_ADMIN)) {
          const s = dbUp.createObjectStore(STORE_LAPORAN_ADMIN, { keyPath: "tanggal" });
          s.createIndex("tanggal", "tanggal", { unique: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };
    checkReq.onerror = () => reject(checkReq.error);
  });
}

async function clearUsersByCreator(createdBy) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_USERS, "readwrite");
    const store = tx.objectStore(STORE_USERS);
    const req   = store.getAll();
    req.onsuccess = () => {
      req.result.forEach(user => {
        if (user.createdBy === createdBy) store.delete(user.uid);
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function saveUsersToDB(users) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_USERS, "readwrite");
    const store = tx.objectStore(STORE_USERS);
    users.forEach(user => store.put(user));
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function saveKantorCabangToDB(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_KANTOR_CABANG, "readwrite");
    const store = tx.objectStore(STORE_KANTOR_CABANG);
    store.put(data);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function getUsersFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_USERS, "readonly");
    const req = tx.objectStore(STORE_USERS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getKantorCabangFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KANTOR_CABANG, "readonly");
    const req = tx.objectStore(STORE_KANTOR_CABANG).getAll();
    req.onsuccess = () => resolve(req.result?.[0] || null);
    req.onerror   = () => reject(req.error);
  });
}

async function getDataHarianFromDB(uidKurir, tanggal) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME_LAPORAN);
    req.onsuccess = () => {
      const db    = req.result;
      const tx    = db.transaction(STORE_DATA_HARIAN, "readonly");
      const getReq = tx.objectStore(STORE_DATA_HARIAN).get(`${uidKurir}_${tanggal}`);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror   = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveDataHarianToDBLaporan(uidKurir, tanggal, data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME_LAPORAN);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DATA_HARIAN)) { resolve(); return; }
      const tx = db.transaction(STORE_DATA_HARIAN, "readwrite");
      tx.objectStore(STORE_DATA_HARIAN).put({
        id: `${uidKurir}_${tanggal}`, uidKurir, tanggal, data, updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveLaporanAdminToDB(tanggal, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_LAPORAN_ADMIN, "readwrite");
    const store  = tx.objectStore(STORE_LAPORAN_ADMIN);
    const getReq = store.get(tanggal);
    getReq.onsuccess = () => {
      const merged = { ...(getReq.result || {}), ...data, tanggal, updatedAt: Date.now() };
      const put    = store.put(merged);
      put.onsuccess = () => resolve();
      put.onerror   = () => reject(put.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror     = () => reject(tx.error);
  });
}

async function getLaporanAdminFromDB(tanggal) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_LAPORAN_ADMIN, "readonly");
    const getReq = tx.objectStore(STORE_LAPORAN_ADMIN).get(tanggal);
    getReq.onsuccess = () => resolve(getReq.result ? { data: getReq.result } : null);
    getReq.onerror   = () => reject(getReq.error);
  });
}

// ─── Amplop helpers ──────────────────────────────────────────────────────────

function getTanggalAktif() {
  const val = document.getElementById("dateFilterInput")?.value;
  if (val) return val;
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getDetailAmplopDistribusi() {
  try {
    const db     = await openDB();
    const tx     = db.transaction(STORE_LAPORAN_ADMIN, "readonly");
    const store  = tx.objectStore(STORE_LAPORAN_ADMIN);
    const tanggal = getTanggalAktif();
    return new Promise(resolve => {
      const req = store.get(tanggal);
      req.onsuccess = () => {
        const laporan = req.result;
        if (!laporan) { resolve({ grossMargin: 0, pengeluaranKurir: 0, pengeluaranDistribusi: 0, amplopDistribusi: 0 }); return; }
        let grossMargin = 0, pengeluaranKurir = 0;
        Object.values(laporan?.data || {}).forEach(kurir => {
          const k = kurir?.distribusi?.keuangan;
          grossMargin      += Number(k?.grossMargin) || 0;
          pengeluaranKurir += (Number(k?.kasbon) || 0) + (Number(k?.klaimInsentif) || 0);
        });
        const p               = laporan?.data?.pengeluaranDistribusi;
        const totalPerbaikan  = (p?.perbaikanPeralatan || []).reduce((t, i) => t + (Number(i?.harga) || 0), 0);
        const totalLainnya    = (p?.lainnya || []).reduce((t, i) => t + (Number(i?.harga) || 0), 0);
        const upahHunter      = Number(p?.customerBaruHunter?.upahHunter) || 0;
        const pengeluaranDistribusi = totalPerbaikan + totalLainnya + upahHunter;
        resolve({ grossMargin, pengeluaranKurir, pengeluaranDistribusi, amplopDistribusi: grossMargin - pengeluaranKurir - pengeluaranDistribusi });
      };
      req.onerror = () => resolve({ grossMargin: 0, pengeluaranKurir: 0, pengeluaranDistribusi: 0, amplopDistribusi: 0 });
    });
  } catch {
    return { grossMargin: 0, pengeluaranKurir: 0, pengeluaranDistribusi: 0, amplopDistribusi: 0 };
  }
}

async function getDetailAmplopProduksi() {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_LAPORAN_ADMIN, "readonly");
    const store = tx.objectStore(STORE_LAPORAN_ADMIN);
    const tanggal = getTanggalAktif();
    return new Promise(resolve => {
      const req = store.get(tanggal);
      req.onsuccess = () => {
        const laporan = req.result;
        if (!laporan) { resolve({ pembayaranKurir: 0, pengeluaranProduksi: 0, amplopProduksi: 0 }); return; }
        let pembayaranKurir = 0;
        Object.values(laporan?.data || {}).forEach(item => {
          pembayaranKurir += Number(item?.pembayaran?.nota?.bayar) || 0;
        });
        const produksi         = laporan?.data?.pengeluaranProduksi || {};
        const totalFixCost     = Object.values(produksi?.fixCost     || {}).reduce((t, v) => t + (Number(v) || 0), 0);
        const totalMarginal    = Object.values(produksi?.marginalCost || {}).reduce((t, i) => t + (Number(i?.total) || 0), 0);
        const totalVariable    = Object.values(produksi?.variableCost || {}).reduce((t, i) => t + (Number(i?.total) || 0), 0);
        const pengeluaranProduksi = totalFixCost + totalMarginal + totalVariable;
        resolve({ pembayaranKurir, pengeluaranProduksi, amplopProduksi: pembayaranKurir - pengeluaranProduksi });
      };
      req.onerror = () => resolve({ pembayaranKurir: 0, pengeluaranProduksi: 0, amplopProduksi: 0 });
    });
  } catch {
    return { pembayaranKurir: 0, pengeluaranProduksi: 0, amplopProduksi: 0 };
  }
}

// ─── Calendar ────────────────────────────────────────────────────────────────

function initCalendar() {
  const monthYear = document.getElementById("calendarMonthYear");
  const datesWrap = document.getElementById("calendarDates");
  const dateBtn   = document.getElementById("dateFilterBtn");
  const dateInput = document.getElementById("dateFilterInput");
  const bulan     = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  let selectedDate = new Date();
  renderCalendar(selectedDate);

  dateBtn.addEventListener("click", () => dateInput.showPicker());
  dateInput.addEventListener("change", async e => {
    selectedDate = new Date(e.target.value);
    renderCalendar(selectedDate);
    if (selectedKurirUid) await renderReport(selectedKurirUid);
    await renderLaporanTanggalTable();
  });

  function renderCalendar(date) {
    const isMobile  = window.innerWidth <= 768;
    const year      = date.getFullYear();
    const month     = date.getMonth();
    const activeDay = date.getDate();
    monthYear.textContent = `${bulan[month]} ${year}`;
    datesWrap.innerHTML   = "";
    const firstDay  = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    const makeItem = day => {
      const el = document.createElement("div");
      el.className  = "calendar-date-item";
      el.textContent = day;
      if (day === activeDay) el.classList.add("active");
      el.addEventListener("click", async () => {
        selectedDate = new Date(year, month, day);
        const yyyy = selectedDate.getFullYear();
        const mm   = String(selectedDate.getMonth() + 1).padStart(2, "0");
        const dd   = String(day).padStart(2, "0");
        const tgl  = `${yyyy}-${mm}-${dd}`;
        dateInput.value = tgl;
        renderCalendar(selectedDate);
        if (selectedKurirUid) await renderReport(selectedKurirUid);
        await renderLaporanTanggalTable();
      });
      datesWrap.appendChild(el);
    };

    if (isMobile) {
      let start = activeDay - 3, end = activeDay + 3;
      if (start < 1)         { end += (1 - start); start = 1; }
      if (end > totalDays)   { start -= (end - totalDays); end = totalDays; if (start < 1) start = 1; }
      for (let d = start; d <= end; d++) makeItem(d);
      return;
    }
    for (let i = 0; i < firstDay; i++) datesWrap.appendChild(document.createElement("div"));
    for (let d = 1; d <= totalDays; d++) makeItem(d);
  }
}

// ─── Reload buttons & filter ─────────────────────────────────────────────────

function setupReloadButton() {
  document.getElementById("reloadUsersBtn")   ?.addEventListener("click", reloadUsers);
  document.getElementById("reloadLaporanBtn") ?.addEventListener("click", reloadLaporanAdmin);

  const filterBtn      = document.getElementById("laporanFilterBtn");
  const filterDropdown = document.getElementById("laporanFilterDropdown");
  if (filterBtn && filterDropdown) {
    filterDropdown.querySelectorAll(".laporan-filter-item").forEach(item => {
      item.classList.toggle("active", item.dataset.filter === laporanFilter);
    });
    const filterLabel = { all: "Semua ⌄", until: "S/d Aktif ⌄", active: "Aktif ⌄" };
    filterBtn.textContent = filterLabel[laporanFilter] || "Filter ⌄";

    filterBtn.addEventListener("click", e => { e.stopPropagation(); filterDropdown.classList.toggle("show"); });
    document.addEventListener("click", () => filterDropdown.classList.remove("show"));
    filterDropdown.querySelectorAll(".laporan-filter-item").forEach(item => {
      item.addEventListener("click", async () => {
        laporanFilter = item.dataset.filter;
        filterDropdown.querySelectorAll(".laporan-filter-item").forEach(el => el.classList.remove("active"));
        item.classList.add("active");
        filterBtn.textContent = filterLabel[laporanFilter];
        filterDropdown.classList.remove("show");
        await renderLaporanTanggalTable();
      });
    });

    const exportBtn      = document.getElementById("laporanExportBtn");
    const exportDropdown = document.getElementById("laporanExportDropdown");
    if (exportBtn && exportDropdown) {
      exportBtn.addEventListener("click", e => { e.stopPropagation(); exportDropdown.classList.toggle("show"); });
      document.addEventListener("click", () => exportDropdown.classList.remove("show"));
    }
    document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
      exportDropdown?.classList.remove("show");
      exportTableToCSV();
    });
    document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
      exportDropdown?.classList.remove("show");
      exportTableToPDF();
    });
  }
}

// ─── Input Pengeluaran ───────────────────────────────────────────────────────

function setupInputPengeluaran() {
  const openBtn            = document.getElementById("openPengeluaranBtn");
  const overlay            = document.getElementById("popupPengeluaranOverlay");
  const closeBtn           = document.getElementById("closePengeluaranBtn");
  const addPerbaikanBtn    = document.getElementById("addPerbaikanBtn");
  const addLainnyaBtn      = document.getElementById("addLainnyaBtn");
  const perbaikanContainer = document.getElementById("perbaikanContainer");
  const lainnyaContainer   = document.getElementById("lainnyaContainer");
  const cekHunterBtn       = document.getElementById("cekCustomerHunterBtn");
  const upahHunterStatus   = document.getElementById("upahHunterStatus");
  const savePengeluaranBtn = document.getElementById("savePengeluaranBtn");
  if (!openBtn || !overlay) return;

  let customerHunterData = { customer: 0, upahHunter: 0 };

  function updateSaveButtonState() {
    if (!savePengeluaranBtn) return;
    const rows     = [...document.querySelectorAll("#perbaikanContainer .pengeluaran-row, #lainnyaContainer .pengeluaran-row")];
    const adaInput = rows.some(row => row.querySelector(".pengeluaran-input")?.value?.trim() || row.querySelector(".pengeluaran-harga")?.value?.trim());
    const boleh    = adaInput || customerHunterData.upahHunter > 0;
    savePengeluaranBtn.disabled        = !boleh;
    savePengeluaranBtn.style.opacity   = boleh ? "1" : ".55";
    savePengeluaranBtn.style.pointerEvents = boleh ? "auto" : "none";
  }

  function resetPopupPengeluaran() {
    perbaikanContainer.innerHTML = "";
    lainnyaContainer.innerHTML   = "";
    customerHunterData = { customer: 0, upahHunter: 0 };
    upahHunterStatus.textContent = "Belum dicek";
    updateSaveButtonState();
  }

  function formatRupiahInput(value) {
    return value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function createRow(placeholder) {
    const row = document.createElement("div");
    row.className = "pengeluaran-row";
    row.innerHTML = `
      <input class="pengeluaran-input" type="text" placeholder="${placeholder}">
      <input class="pengeluaran-harga" type="text" inputmode="numeric" placeholder="Harga">
    `;
    const harga = row.querySelector(".pengeluaran-harga");
    const nama  = row.querySelector(".pengeluaran-input");
    harga?.addEventListener("input", () => { harga.value = formatRupiahInput(harga.value); updateSaveButtonState(); });
    nama?.addEventListener("input", updateSaveButtonState);
    return row;
  }

  async function loadPengeluaranHistory() {
    try {
      resetPopupPengeluaran();
      const tanggal  = getTanggalAktif();
      const uidAdmin = auth.currentUser?.uid;
      if (!uidAdmin) return;
      const snap = await getDoc(doc(db, "users", uidAdmin, "laporanAdmin", tanggal));
      if (!snap.exists()) return;
      const pengeluaran = snap.data()?.pengeluaranDistribusi;
      if (!pengeluaran) return;

      (pengeluaran?.perbaikanPeralatan || []).forEach(item => {
        const row = createRow("Input perbaikan");
        row.querySelector(".pengeluaran-input").value = item.nama || "";
        row.querySelector(".pengeluaran-harga").value = Number(item.harga || 0).toLocaleString("id-ID");
        perbaikanContainer.appendChild(row);
      });
      (pengeluaran?.lainnya || []).forEach(item => {
        const row = createRow("Input lainnya");
        row.querySelector(".pengeluaran-input").value = item.nama || "";
        row.querySelector(".pengeluaran-harga").value = Number(item.harga || 0).toLocaleString("id-ID");
        lainnyaContainer.appendChild(row);
      });
      const hunter = pengeluaran?.customerBaruHunter;
      if (hunter) {
        customerHunterData = { customer: hunter.customer || 0, upahHunter: hunter.upahHunter || 0 };
        if (hunter.customer > 0) {
          upahHunterStatus.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:12px;">
              <span>(${Number(hunter.customer).toLocaleString("id-ID")} Customer)</span>
              <span style="font-weight:700;color:#2d2d2d;">${Number(hunter.upahHunter).toLocaleString("id-ID")}</span>
            </div>`;
        }
      }
      updateSaveButtonState();
    } catch (err) {
      console.error("Gagal load history pengeluaran:", err);
    }
  }

  async function openPopup() {
    overlay.classList.add("show");
    const subtitle = document.getElementById("popupPengeluaranSubtitle");
    const tanggal  = getTanggalAktif();
    if (subtitle && tanggal) {
      subtitle.textContent = new Date(tanggal).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }
    await loadPengeluaranHistory();
  }

  function closePopup() { overlay.classList.remove("show"); }

  addPerbaikanBtn?.addEventListener("click", () => perbaikanContainer?.appendChild(createRow("Input perbaikan")));
  addLainnyaBtn?.addEventListener("click",   () => lainnyaContainer?.appendChild(createRow("Input lainnya")));

  cekHunterBtn?.addEventListener("click", async () => {
    const origHtml = cekHunterBtn.innerHTML;
    try {
      cekHunterBtn.disabled  = true;
      cekHunterBtn.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:10px;"><span class="btn-loading-spinner"></span>Checking...</span>`;
      upahHunterStatus.textContent = "Checking...";
      await new Promise(r => setTimeout(r, 1500));

      const tanggal      = getTanggalAktif();
      const kantorCabang = await getKantorCabangFromDB();
      const idCabang     = kantorCabang?.id;
      if (!idCabang) { upahHunterStatus.textContent = "Tidak ada"; return; }

      const users   = await getUsersFromDB();
      const hunters = users.filter(u => u.role === "hunter");
      let totalCustomer = 0;
      for (const hunter of hunters) {
        const q    = query(collectionGroup(db, "customerBaruHunter"), where("tanggal", "==", tanggal), where("idCabang", "==", idCabang), where("createdBy", "==", hunter.uid));
        const snap = await getDocs(q);
        totalCustomer += snap.size;
      }

      const upahPerCustomer = Number(kantorCabang?.upahHunter || 0);
      const totalUpah       = totalCustomer * upahPerCustomer;
      customerHunterData    = { customer: totalCustomer, upahHunter: totalUpah };
      updateSaveButtonState();

      if (totalCustomer > 0) {
        upahHunterStatus.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:12px;">
            <span>(${Number(totalCustomer).toLocaleString("id-ID")} Customer)</span>
            <span style="font-weight:700;color:#2d2d2d;">${Number(totalUpah).toLocaleString("id-ID")}</span>
          </div>`;
      } else {
        upahHunterStatus.textContent = "Tidak ada";
        customerHunterData = { customer: 0, upahHunter: 0 };
        updateSaveButtonState();
      }
    } catch (err) {
      console.error("Gagal cek customer hunter:", err);
      upahHunterStatus.textContent = "Gagal memuat";
    } finally {
      cekHunterBtn.disabled  = false;
      cekHunterBtn.innerHTML = origHtml;
    }
  });

  savePengeluaranBtn?.addEventListener("click", async () => {
    const origText = savePengeluaranBtn.innerHTML;
    try {
      savePengeluaranBtn.disabled  = true;
      savePengeluaranBtn.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:10px;"><span class="btn-loading-spinner"></span>Menyimpan...</span>`;
      await new Promise(r => setTimeout(r, 1500));

      const tanggal  = getTanggalAktif();
      const ambilRows = container => [...container.querySelectorAll(".pengeluaran-row")]
        .map(row => {
          const nama  = row.querySelector(".pengeluaran-input")?.value?.trim();
          const harga = Number(row.querySelector(".pengeluaran-harga")?.value?.trim()?.replaceAll(".", "") || 0);
          if (!nama && !harga) return null;
          return { nama, harga };
        }).filter(Boolean);

      const perbaikan = ambilRows(perbaikanContainer);
      const lainnya   = ambilRows(lainnyaContainer);
      const semuaRows = [...perbaikanContainer.querySelectorAll(".pengeluaran-row"), ...lainnyaContainer.querySelectorAll(".pengeluaran-row")];
      const adaHargaKosong = semuaRows.some(row => {
        const nama  = row.querySelector(".pengeluaran-input")?.value?.trim();
        const harga = row.querySelector(".pengeluaran-harga")?.value?.trim();
        return nama && !harga;
      });

      if (adaHargaKosong) {
        const wo = document.getElementById("warningTargetOverlay");
        const wt = wo?.querySelector(".warning-omset-title");
        const ws = wo?.querySelector(".warning-omset-subtitle");
        if (wt) wt.textContent = "Harga belum di isi";
        if (ws) ws.textContent = "Masih ada input pengeluaran yang belum memiliki harga.";
        wo?.classList.add("show");
        document.getElementById("btnCekLagiTarget").onclick = () => wo?.classList.remove("show");
        savePengeluaranBtn.disabled  = false;
        savePengeluaranBtn.innerHTML = origText;
        return;
      }

      if (!perbaikan.length && !lainnya.length && !customerHunterData?.customer) {
        savePengeluaranBtn.disabled  = false;
        savePengeluaranBtn.innerHTML = origText;
        return;
      }

      const uidAdmin = auth.currentUser?.uid;
      if (!uidAdmin) { savePengeluaranBtn.innerHTML = "Belum login"; return; }

      const laporanRef  = doc(db, "users", uidAdmin, "laporanAdmin", tanggal);
      const laporanSnap = await getDoc(laporanRef);
      if (!laporanSnap.exists()) { savePengeluaranBtn.innerHTML = "Belum ada data"; return; }

      const pengeluaranDistribusi = {
        perbaikanPeralatan: perbaikan,
        lainnya,
        customerBaruHunter: { customer: customerHunterData?.customer || 0, upahHunter: customerHunterData?.upahHunter || 0 }
      };

      await updateDoc(laporanRef, { pengeluaranDistribusi, updatedAt: serverTimestamp() });

      try {
        const userRef     = doc(db, "users", uidAdmin);
        const userSnap    = await getDoc(userRef);
        const curVersion  = userSnap.data()?.rincianPengeluaranSync?.version || 0;
        await updateDoc(userRef, { rincianPengeluaranSync: { updatedAt: serverTimestamp(), version: curVersion + 1 } });
        const allUsers    = await getUsersFromDB();
        await saveUsersToDB(allUsers.map(u => u.uid === uidAdmin ? { ...u, rincianPengeluaranSync: { updatedAt: Date.now(), version: curVersion + 1 } } : u));
      } catch (err) { console.error("❌ update sync gagal:", err); }

      try {
        const oldLocal = await getLaporanAdminFromDB(tanggal);
        await saveLaporanAdminToDB(tanggal, { ...(oldLocal?.data || {}), pengeluaranDistribusi, updatedAt: Date.now() });
      } catch (err) { console.error("❌ indexeddb gagal:", err); }

      savePengeluaranBtn.innerHTML = "Berhasil ✓";
    } catch (err) {
      console.error("Gagal simpan pengeluaran:", err);
      savePengeluaranBtn.innerHTML = "Gagal menyimpan";
    } finally {
      setTimeout(() => { savePengeluaranBtn.disabled = false; savePengeluaranBtn.innerHTML = origText; }, 1800);
    }
  });

  updateSaveButtonState();
  document.getElementById("warningTargetOverlay")?.addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("show"); });

  // Desktop drag
  if (window.innerWidth > 768) {
    const box    = document.getElementById("popupPengeluaranBox");
    const header = box?.querySelector(".popup-detail-header");
    if (box && header) {
      let dragging = false, offX = 0, offY = 0;
      header.style.cursor = "grab";
      header.addEventListener("mousedown", e => {
        if (e.target.closest("button")) return;
        dragging = true;
        const rect = box.getBoundingClientRect();
        box.style.cssText += ";position:fixed;margin:0;right:auto;transform:none;";
        box.style.left = rect.left + "px";
        box.style.top  = rect.top  + "px";
        offX = e.clientX - rect.left;
        offY = e.clientY - rect.top;
        header.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      });
      document.addEventListener("mousemove", e => {
        if (!dragging) return;
        box.style.left = Math.max(0, Math.min(e.clientX - offX, window.innerWidth  - box.offsetWidth))  + "px";
        box.style.top  = Math.max(0, Math.min(e.clientY - offY, window.innerHeight - box.offsetHeight)) + "px";
      });
      document.addEventListener("mouseup", () => { if (!dragging) return; dragging = false; header.style.cursor = "grab"; document.body.style.userSelect = ""; });
    }
  }

  // Mobile swipe close
  setupSwipeClose(document.getElementById("popupPengeluaranBox"), closePopup);

  openBtn.addEventListener("click", openPopup);
  closeBtn?.addEventListener("click", closePopup);
  overlay.addEventListener("click", e => { if (e.target === overlay) closePopup(); });
}

// ─── Popup Amplop ────────────────────────────────────────────────────────────

function setupPopupAmplop() {
  const openBtn  = document.getElementById("openAmplopBtn");
  const overlay  = document.getElementById("popupAmplopOverlay");
  const closeBtn = document.getElementById("closeAmplopBtn");
  const box      = document.getElementById("popupAmplopBox");
  const header   = box?.querySelector(".popup-detail-header");
  if (!openBtn || !overlay || !box) return;

  async function openPopup() {
    overlay.classList.add("show");
    box.style.cssText = "";
    const subtitle = document.getElementById("popupAmplopSubtitle");
    const tanggal  = getTanggalAktif();
    if (subtitle) subtitle.textContent = new Date(tanggal).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const [dist, prod] = await Promise.all([getDetailAmplopDistribusi(), getDetailAmplopProduksi()]);
    const fmt = v => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v || 0);

    document.getElementById("detailAmplopDistribusi")      && (document.getElementById("detailAmplopDistribusi").textContent      = fmt(dist.grossMargin));
    document.getElementById("detailPengeluaranKurir")      && (document.getElementById("detailPengeluaranKurir").textContent      = fmt(dist.pengeluaranKurir));
    document.getElementById("detailPengeluaranDistribusi") && (document.getElementById("detailPengeluaranDistribusi").textContent = fmt(dist.pengeluaranDistribusi));
    document.getElementById("detailAmplopFinal")           && (document.getElementById("detailAmplopFinal").textContent           = fmt(dist.amplopDistribusi));
    document.getElementById("detailPembayaranKurir")       && (document.getElementById("detailPembayaranKurir").textContent       = fmt(prod.pembayaranKurir));
    document.getElementById("detailPengeluaranProduksi")   && (document.getElementById("detailPengeluaranProduksi").textContent   = fmt(prod.pengeluaranProduksi));
    document.getElementById("detailAmplopProduksiFinal")   && (document.getElementById("detailAmplopProduksiFinal").textContent   = fmt(prod.amplopProduksi));
  }

  function closePopup() { overlay.classList.remove("show"); box.style.transform = ""; box.style.transition = ""; }

  openBtn.addEventListener("click", openPopup);
  closeBtn?.addEventListener("click", closePopup);
  overlay.addEventListener("click", e => { if (e.target === overlay) closePopup(); });

  // Desktop drag
  if (window.innerWidth > 768 && header) {
    let dragging = false, offX = 0, offY = 0;
    header.addEventListener("mousedown", e => {
      if (e.target.closest("button")) return;
      dragging = true;
      const rect = box.getBoundingClientRect();
      box.style.cssText += ";right:auto;margin:0;transform:none;";
      box.style.left = rect.left + "px";
      box.style.top  = rect.top  + "px";
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      document.body.style.userSelect = "none";
      const move = e => { if (!dragging) return; box.style.left = Math.max(0, Math.min(e.clientX - offX, window.innerWidth - box.offsetWidth)) + "px"; box.style.top = Math.max(0, Math.min(e.clientY - offY, window.innerHeight - box.offsetHeight)) + "px"; };
      const up   = () => { dragging = false; document.body.style.userSelect = ""; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  setupSwipeClose(box, closePopup);
}

// ─── Swipe close (shared) ────────────────────────────────────────────────────

function setupSwipeClose(box, closeFn) {
  if (!box) return;
  let startY = 0, currentY = 0, isDragging = false;
  box.addEventListener("touchstart", e => {
    if (window.innerWidth > 768 || box.scrollTop > 10) return;
    startY = currentY = e.touches[0].clientY;
    isDragging = true;
    box.style.transition = "none";
  }, { passive: true });
  box.addEventListener("touchmove", e => {
    if (!isDragging || window.innerWidth > 768) return;
    currentY = e.touches[0].clientY;
    const delta = currentY - startY;
    if (delta < 0) return;
    box.style.transform = `translateY(${delta * .9}px)`;
  }, { passive: true });
  box.addEventListener("touchend", () => {
    if (!isDragging || window.innerWidth > 768) return;
    isDragging = false;
    const delta = currentY - startY;
    box.style.transition = "transform .28s ease";
    if (delta > 120) {
      box.style.transform = "translateY(100%)";
      setTimeout(() => { closeFn(); box.style.transform = ""; box.style.transition = ""; }, 280);
    } else {
      box.style.transform = "";
    }
  });
}

// ─── Reading mode ─────────────────────────────────────────────────────────────

function setupReadingMode() {
  const btn      = document.getElementById("laporanReadingBtn");
  const closeBtn = document.getElementById("readingCloseBtn");
  if (!btn) return;
  const toggle = (forceClose = false) => {
    const active = forceClose ? false : !document.body.classList.contains("reading-mode");
    document.body.classList.toggle("reading-mode", active);
    btn.classList.toggle("active", active);
    btn.textContent = active ? "Tutup Mode" : "Mode Baca";
  };
  btn.addEventListener("click", () => toggle());
  closeBtn?.addEventListener("click", () => toggle(true));
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportTableToCSV() {
  const table = document.querySelector(".laporan-table");
  if (!table) return;
  const csv = [...table.querySelectorAll("tr")].map(row =>
    [...row.querySelectorAll("th, td")].map(col => {
      let t = col.innerText.trim().replace(/\n/g, " ");
      if (t.includes(",") || t.includes('"')) t = `"${t.replace(/"/g, '""')}"`;
      return t;
    }).join(",")
  );
  const blob    = new Blob(["\uFEFF" + csv.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `laporan-${getTanggalAktif()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportTableToPDF() {
  const wrapper = document.querySelector(".laporan-table-wrapper");
  const table   = document.querySelector(".laporan-table");
  if (!wrapper || !table) return;
  const btn = document.getElementById("exportPdfBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Membuat PDF..."; }
    const orig = { maxHeight: wrapper.style.maxHeight, overflow: wrapper.style.overflow, height: wrapper.style.height, width: wrapper.style.width, scrollTop: wrapper.scrollTop };
    wrapper.style.maxHeight = "none";
    wrapper.style.height    = "auto";
    wrapper.style.overflow  = "visible";
    wrapper.scrollTop       = 0;
    await new Promise(r => setTimeout(r, 300));

    const canvas = await html2canvas(table, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw  = pdf.internal.pageSize.getWidth();
    const ph  = pdf.internal.pageSize.getHeight();
    const m   = 5, imgW = pw - m * 2, imgH = (canvas.height * imgW) / canvas.width;
    let left = imgH, pos = m;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", m, pos, imgW, imgH);
    left -= ph;
    while (left > 0) { pos = left - imgH + m; pdf.addPage(); pdf.addImage(canvas.toDataURL("image/png"), "PNG", m, pos, imgW, imgH); left -= ph; }
    pdf.save(`laporan-${getTanggalAktif()}.pdf`);

    Object.assign(wrapper.style, { maxHeight: orig.maxHeight, height: orig.height, overflow: orig.overflow, width: orig.width });
    wrapper.scrollTop = orig.scrollTop;
  } catch (err) { console.error("Gagal export PDF:", err); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Export PDF"; } }
}

// ─── Reload data ──────────────────────────────────────────────────────────────

async function reloadUsers() {
  const btn  = document.getElementById("reloadUsersBtn");
  const user = auth.currentUser;
  if (!user) return;
  try {
    btn?.classList.add("loading");
    const teamSnap  = await getDocs(query(collection(db, "users"), where("role", "in", ["sales","kurir","hunter"]), where("createdBy", "==", user.uid), where("status", "==", true)));
    const adminSnap = await getDoc(doc(db, "users", user.uid));
    const adminData = adminSnap.exists() ? adminSnap.data() : null;
    const idCabang  = adminData?.idCabang;
    const users     = [];
    teamSnap.forEach(s => users.push({ uid: s.id, ...s.data() }));
    if (adminSnap.exists()) users.push({ uid: user.uid, ...adminSnap.data() });
    if (idCabang) {
      const kcSnap = await getDoc(doc(db, "kantorCabang", idCabang));
      if (kcSnap.exists()) await saveKantorCabangToDB({ id: idCabang, ...kcSnap.data() });
    }
    await clearUsersByCreator(user.uid);
    await saveUsersToDB(users);
    await reloadLaporanAdminByTanggal(getTanggalAktif());
    await loadKurirFromIndexedDB();
  } catch (err) { console.error("Reload error:", err); }
  finally { btn?.classList.remove("loading"); }
}

async function reloadLaporanAdminByTanggal(tanggal) {
  const user = auth.currentUser;
  if (!user || !tanggal) return null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid, "laporanAdmin", tanggal));
    if (!snap.exists()) return null;
    const data = snap.data();
    await saveLaporanAdminToDB(tanggal, data);
    return data;
  } catch (err) {
    if (err?.code === "permission-denied") return null;
    console.error(`Gagal reload laporan admin ${tanggal}:`, err);
    return null;
  }
}

async function reloadLaporanAdmin() {
  const btn     = document.getElementById("reloadLaporanBtn");
  const alertEl = document.getElementById("reloadLaporanAlert");
  const user    = auth.currentUser;
  if (!user || btn?.classList.contains("loading")) return;
  const showAlert = (msg, color, delay = 2600) => {
    if (!alertEl) return;
    alertEl.innerHTML   = msg;
    alertEl.style.color = color;
    alertEl.classList.add("show");
    setTimeout(() => { alertEl.classList.remove("show"); btn.classList.remove("freeze"); }, delay);
  };
  try {
    btn.classList.add("loading");
    alertEl?.classList.remove("show");
    const tanggal = getTanggalAktif();
    await new Promise(r => setTimeout(r, 2000));
    const snap = await getDocs(query(collectionGroup(db, "laporanAdmin"), where("tanggal", "==", tanggal), where("createdBy", "==", user.uid)));
    btn.classList.remove("loading");
    btn.classList.add("freeze");
    if (snap.empty) { showAlert("Data tidak ditemukan<br>Cek tanggal!", "#c54b4b"); return; }
    await saveLaporanAdminToDB(tanggal, snap.docs[0].data() || {});
    await renderLaporanTanggalTable();
    showAlert("Data berhasil diambil", "#2d8b57");
  } catch (err) {
    console.error("Reload laporan error:", err);
    btn?.classList.remove("loading");
    btn?.classList.add("freeze");
    showAlert("Gagal mengambil data", "#c54b4b");
  }
}

// ─── Load kurir list ──────────────────────────────────────────────────────────

async function loadKurirFromIndexedDB() {
  const listEl = document.getElementById("listKurir");
  if (!listEl) return;
  const user = auth.currentUser;
  if (!user) { listEl.innerHTML = `<div class="loading-card">Menunggu login...</div>`; return; }
  try {
    const allUsers = await getUsersFromDB();
    const users    = allUsers.filter(item => item.createdBy === user.uid && item.status === true && ["sales","kurir","hunter"].includes(item.role));
    usersCache = users;
    if (!users.length) { listEl.innerHTML = `<div class="loading-card">Belum ada data, klik tombol reload terlebih dahulu!</div>`; return; }
    listEl.innerHTML = users.map(data => {
      const nama    = escapeHtml(data.nama || "Tanpa Nama");
      const role    = escapeHtml(data.role || "-");
      const inisial = (data.nama || "?").trim().charAt(0).toUpperCase();
      const avatar  = data.foto
        ? `<img class="user-photo" src="${escapeHtml(data.foto)}" data-inisial="${escapeHtml(inisial)}" alt="${nama}">`
        : `<div class="user-photo-fallback">${escapeHtml(inisial)}</div>`;
      return `
        <div class="user-item" data-uid="${data.uid}">
          ${avatar}
          <div class="user-info">
            <div class="user-name">${nama}</div>
            <div class="user-role">${role}</div>
          </div>
        </div>`;
    }).join("");
    setupKurirClick(users);
    setupCustomDropdown(users);
    setupLaporanDropdown(users);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="loading-card">Gagal memuat data</div>`;
  }
}

// ─── Kurir click & dropdowns ─────────────────────────────────────────────────

function setupKurirClick(users) {
  const items = document.querySelectorAll(".user-item");
  items.forEach(item => {
    item.addEventListener("click", async () => {
      const uid      = item.dataset.uid;
      const userData = users.find(x => x.uid === uid);
      selectedKurirUid = uid;
      const inputRole = document.getElementById("laporanRole");
      if (inputRole && userData) inputRole.value = userData.role || "-";
      items.forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      await renderReport(uid);
      await renderLaporanTanggalTable(); // FIX: ditambahkan
    });
  });
}

function setupCustomDropdown(users) {
  const wrapper = document.getElementById("laporanUserDropdown");
  const btn     = document.getElementById("laporanDropdownBtn");
  const text    = document.getElementById("laporanDropdownText");
  const list    = document.getElementById("laporanDropdownList");
  if (!wrapper || !btn || !list) return;

  list.innerHTML = users.map(user => {
    const nama    = escapeHtml(user.nama || "Tanpa Nama");
    const role    = escapeHtml(user.role || "-");
    const inisial = nama.charAt(0).toUpperCase();
    return `
      <div class="laporan-dropdown-item" data-uid="${user.uid}">
        <div class="laporan-dropdown-avatar">${user.foto ? `<img src="${escapeHtml(user.foto)}">` : inisial}</div>
        <div class="laporan-dropdown-info">
          <div class="laporan-dropdown-name">${nama}</div>
          <div class="laporan-dropdown-role">${role}</div>
        </div>
      </div>`;
  }).join("");

  btn.onclick = () => wrapper.classList.toggle("active");
  document.addEventListener("click", e => { if (!wrapper.contains(e.target)) wrapper.classList.remove("active"); });

  list.querySelectorAll(".laporan-dropdown-item").forEach(item => {
    item.onclick = async () => {
      const uid  = item.dataset.uid;
      const user = users.find(x => x.uid === uid);
      if (!user) return;
      selectedKurirUid = uid;
      text.textContent = user.nama;
      document.getElementById("laporanRole").value = user.role || "-";
      list.querySelectorAll(".laporan-dropdown-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      wrapper.classList.remove("active");
      await renderReport(uid);
      await renderLaporanTanggalTable();
    };
  });
}

function setupLaporanDropdown(users) {
  const wrapper = document.getElementById("laporanUserDropdown");
  const btn     = document.getElementById("laporanDropdownBtn");
  const text    = document.getElementById("laporanDropdownText");
  const list    = document.getElementById("laporanDropdownList");
  const search  = document.getElementById("laporanDropdownSearch");
  if (!wrapper || !btn || !list) return;

  const renderList = data => {
    list.innerHTML = data.map(u => {
      const nama    = u.nama || "Tanpa Nama";
      const role    = u.role || "-";
      const inisial = nama.charAt(0).toUpperCase();
      return `
        <div class="laporan-dropdown-item" data-uid="${u.uid}">
          <div class="laporan-dropdown-avatar">${u.foto ? `<img src="${u.foto}">` : inisial}</div>
          <div class="laporan-dropdown-info">
            <div class="laporan-dropdown-name">${nama}</div>
            <div class="laporan-dropdown-role">${role}</div>
          </div>
        </div>`;
    }).join("");
    list.querySelectorAll(".laporan-dropdown-item").forEach(item => {
      item.onclick = async () => {
        const uid  = item.dataset.uid;
        const user = users.find(x => x.uid === uid);
        if (!user) return;
        selectedKurirUid = uid;
        text.textContent = user.nama;
        document.getElementById("laporanRole").value = user.role || "-";
        wrapper.classList.remove("active");
        await renderReport(uid);
        await renderLaporanTanggalTable();
      };
    });
  };

  renderList(users);
  btn.onclick = () => { wrapper.classList.toggle("active"); if (wrapper.classList.contains("active")) setTimeout(() => search?.focus(), 80); };
  search?.addEventListener("input", () => renderList(users.filter(u => (u.nama || "").toLowerCase().includes(search.value.toLowerCase()))));
  document.addEventListener("click", e => { if (!wrapper.contains(e.target)) wrapper.classList.remove("active"); });
}

// ─── Render report cards ─────────────────────────────────────────────────────

async function renderReport(uid) {
  const reportEl = document.getElementById("reportCollection");
  const userData = usersCache.find(x => x.uid === uid);
  if (!userData || !reportEl) return;

  const tanggal = document.getElementById("dateFilterInput")?.value || new Date().toISOString().split("T")[0];
  let laporan   = await getDataHarianFromDB(uid, tanggal);

  if (!laporan) {
    try {
      const snap = await getDoc(doc(db, "users", auth.currentUser.uid, "laporanAdmin", tanggal));
      if (snap.exists()) {
        const fsData     = snap.data();
        const kurirData  = fsData[uid] || {};
        const infoTarget = kurirData?.distribusi?.infoTarget || {};
        const hasil = {
          closing          : kurirData?.pembayaran?.closing || {},
          pay              : kurirData?.distribusi?.pay     || {},
          expired          : kurirData?.distribusi?.expired || {},
          fee: {}, disable: {}, saldoBarang: {},
          kunjungan        : Number(infoTarget?.kunjungan)        || 0,
          pembayaran       : { bayarKonsumen: Number(kurirData?.distribusi?.keuangan?.inputOmset) || 0, bayarProduksi: 0 },
          keterangan       : { pending: Number(infoTarget?.pending) || 0, tutup: Number(infoTarget?.tutup) || 0, putus: Number(infoTarget?.putus) || 0 },
          customerNew      : Number(infoTarget?.customerNew)      || 0,
          customerLama     : Number(infoTarget?.customerLama)     || 0,
          customerTambahan : Number(infoTarget?.customerTambahan) || 0,
          targetData       : infoTarget?.targetData       ?? "",
          targetCustomer   : infoTarget?.targetCustomer   ?? "",
          potongan         : infoTarget?.potongan         || {},
        };
        await saveDataHarianToDBLaporan(uid, tanggal, hasil);
        laporan = { data: hasil };
      }
    } catch (err) { console.warn("Fallback laporanAdmin gagal:", err.code); }
  }

  const closingData  = laporan?.data?.closing  || {};
  const payData      = laporan?.data?.pay      || {};
  const expiredData  = laporan?.data?.expired  || {};
  const omset        = Number(laporan?.data?.pembayaran?.bayarKonsumen) || 0;
  const customerLama     = laporan?.data?.customerLama     ?? 0;
  const customerTambahan = laporan?.data?.customerTambahan ?? 0;
  const customerNew      = laporan?.data?.customerNew      ?? 0;
  const kunjungan        = Number(laporan?.data?.kunjungan) || 0;
  const jumlahCustomer   = customerLama + customerTambahan + customerNew;
  const keterangan       = laporan?.data?.keterangan || {};
  const tutup    = Number(keterangan.tutup)   || 0;
  const pending  = Number(keterangan.pending) || 0;
  const putus    = Number(keterangan.putus)   || 0;

  const kantorCabang    = await getKantorCabangFromDB();
  const targetCustomer  = Number(kantorCabang?.bonus?.data?.targetCustomer) || 0;
  const ofTarget        = kunjungan - jumlahCustomer;
  const keteranganTarget = kunjungan - targetCustomer;

  const activeVarians = (userData.varian || []).filter(v => { const key = Object.keys(v)[0]; return key && v[key]?.isAktif; });
  const sumClosing  = activeVarians.reduce((acc, v) => acc + (Number(closingData[Object.keys(v)[0]]) || 0), 0);
  const sumPay      = activeVarians.reduce((acc, v) => acc + (Number(payData[Object.keys(v)[0]])     || 0), 0);
  const sumExpired  = activeVarians.reduce((acc, v) => acc + (Number(expiredData[Object.keys(v)[0]]) || 0), 0);

  const varianRows = (src, sum, section) => `
    ${activeVarians.map(v => { const key = Object.keys(v)[0]; return `<div class="report-item"><div class="report-key">${escapeHtml(key)}</div><div class="report-value">${src[key] ?? ""}</div></div>`; }).join("")}
    <div class="report-item report-jumlah" data-section="${section}" style="cursor:pointer;margin-top:4px;">
      <div class="report-key" style="color:#b08a5c;">Jumlah</div>
      <div class="report-value" style="color:#b08a5c;text-decoration:underline dotted;">${sum} ↗</div>
    </div>`;

  reportEl.innerHTML = `
    <div class="report-card"><div class="report-card-title">CLOSING</div><div class="report-list">${varianRows(closingData, sumClosing, "closing")}</div></div>
    <div class="report-card"><div class="report-card-title">PAY</div><div class="report-list">${varianRows(payData, sumPay, "pay")}</div></div>
    <div class="report-card"><div class="report-card-title">EXPIRED</div><div class="report-list">${varianRows(expiredData, sumExpired, "expired")}</div></div>
    <div class="report-card">
      <div class="report-card-title">INFO TARGET</div>
      <div class="report-list">
        <div class="report-item"><div class="report-key">Customer Lama</div><div class="report-value">${customerLama}</div></div>
        <div class="report-item"><div class="report-key">Customer Tambahan</div><div class="report-value">${customerTambahan}</div></div>
        <div class="report-item"><div class="report-key">Customer Baru</div><div class="report-value">${customerNew}</div></div>
        <div class="report-item"><div class="report-key">Jumlah Customer</div><div class="report-value">${jumlahCustomer}</div></div>
        <div class="report-item report-selengkapnya" style="cursor:pointer;margin-top:4px;">
          <div class="report-key" style="color:#b08a5c;">Selengkapnya</div><div class="report-value" style="color:#b08a5c;">↗</div>
        </div>
      </div>
    </div>
    <div class="report-card">
      <div class="report-card-title">KEUANGAN</div>
      <div class="report-list">
        <div class="report-item"><div class="report-key">Omset</div><div class="report-value">Rp ${formatRupiah(omset)}</div></div>
        <div class="report-item"><div class="report-key">Bonus</div><div class="report-value">Rp 0</div></div>
        <div class="report-item"><div class="report-key">Insentif</div><div class="report-value">Rp 0</div></div>
        <div class="report-item"><div class="report-key">Kasbon</div><div class="report-value">Rp 0</div></div>
        <div class="report-item report-keuangan" style="cursor:pointer;margin-top:4px;">
          <div class="report-key" style="color:#b08a5c;">Selengkapnya</div><div class="report-value" style="color:#b08a5c;">↗</div>
        </div>
      </div>
    </div>`;

  reportEl.querySelectorAll(".report-jumlah").forEach(el => {
    el.addEventListener("click", () => {
      const sec = el.dataset.section;
      const map = { closing: [closingData, "Closing", sumClosing], pay: [payData, "Pay", sumPay], expired: [expiredData, "Expired", sumExpired] };
      const [src, title, sum] = map[sec] || [];
      if (title) openPopup(title, tanggal, sum, activeVarians, src, userData);
    });
  });
  reportEl.querySelector(".report-selengkapnya")?.addEventListener("click", () =>
    openPopupInfoTarget(tanggal, jumlahCustomer, tutup, pending, putus, kunjungan, ofTarget, keteranganTarget)
  );
  reportEl.querySelector(".report-keuangan")?.addEventListener("click", () =>
    openPopupKeuangan(tanggal, omset, keteranganTarget, payData, expiredData, kunjungan)
  );
}

// ─── Popup Detail (closing/pay/expired) ──────────────────────────────────────

function openPopup(title, tanggal, sum, varians, dataSource, userData) {
  const overlay = document.getElementById("popupDetailOverlay");
  const box     = document.getElementById("popupDetailBox");
  document.getElementById("popupDetailTitle").textContent    = title === "Pay" ? "Detail Pay (Margin)" : `Detail ${title}`;
  document.getElementById("popupDetailSubtitle").textContent = `Tanggal: ${tanggal}`;
  document.getElementById("popupDetailTotal").textContent    = sum;

  let totalQty = 0, totalHarga = 0;
  const html = varians.map(v => {
    const key          = Object.keys(v)[0];
    const qty          = Number(dataSource[key]) || 0;
    const hargaProduksi = Number(v[key]?.hargaProduksi) || 0;
    const hargaKonsumen = Number(v[key]?.hargaKonsumen) || 0;
    const hargaPerItem  = title === "Pay" ? (hargaKonsumen - hargaProduksi) : hargaProduksi;
    const subtotal      = qty * hargaPerItem;
    totalQty   += qty;
    totalHarga += subtotal;
    return `<div class="popup-detail-item"><div class="popup-detail-item-key">${escapeHtml(key)}</div><div class="popup-detail-item-value">${qty}</div><div class="popup-detail-item-value">${formatRupiah(subtotal)}</div></div>`;
  }).join("");

  document.getElementById("popupDetailList").innerHTML = `
    ${html}
    <div class="popup-detail-divider" style="height:1px;background:rgba(176,138,92,.14);margin:6px 0;"></div>
    <div class="popup-detail-item" style="background:rgba(176,138,92,.08);font-weight:700;">
      <div class="popup-detail-item-key" style="color:#b08a5c;">Jumlah</div>
      <div class="popup-detail-item-value" style="color:#b08a5c;">${totalQty}</div>
      <div class="popup-detail-item-value" style="color:#b08a5c;">${formatRupiah(totalHarga)}</div>
    </div>`;

  positionPopupDesktop(box);
  overlay.classList.add("show");
  if (window.innerWidth > 768) enableDetailDrag();
}

function closePopup() {
  document.getElementById("popupDetailOverlay").classList.remove("show");
  disableDetailDrag();
}

function positionPopupDesktop(box) {
  if (window.innerWidth <= 768) return;
  box.style.left      = "auto";
  box.style.right     = "34px";
  box.style.transform = "scale(1)";
  const ph  = Math.min(box.offsetHeight || 650, window.innerHeight * 0.86);
  box.style.top = Math.max(24, (window.innerHeight - ph) / 2) + "px";
}

function enableDetailDrag() {
  const box    = document.getElementById("popupDetailBox");
  const header = box?.querySelector(".popup-detail-header");
  if (!box || !header) return;
  const rect = box.getBoundingClientRect();
  box.style.left = rect.left + "px";
  box.style.top  = rect.top  + "px";
  box.style.right = "auto";
  box.style.transform = "none";
  box.style.position  = "fixed";
  box.style.margin    = "0";
  // FIX: pakai cloneNode-trick agar listener tidak double
  const newHeader = header.cloneNode(true);
  header.parentNode.replaceChild(newHeader, header);
  newHeader.addEventListener("mousedown", onDragStart);
}

function disableDetailDrag() {
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup",   onDragEnd);
}

function onDragStart(e) {
  if (e.target.closest("button")) return;
  _dragActive = true;
  const box   = document.getElementById("popupDetailBox");
  const rect  = box.getBoundingClientRect();
  _dragOffsetX = e.clientX - rect.left;
  _dragOffsetY = e.clientY - rect.top;
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup",   onDragEnd);
}

function onDragMove(e) {
  if (!_dragActive) return;
  const box = document.getElementById("popupDetailBox");
  box.style.left = Math.max(0, Math.min(e.clientX - _dragOffsetX, window.innerWidth  - box.offsetWidth))  + "px";
  box.style.top  = Math.max(0, Math.min(e.clientY - _dragOffsetY, window.innerHeight - box.offsetHeight)) + "px";
}

function onDragEnd() {
  _dragActive = false;
  document.body.style.userSelect = "";
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup",   onDragEnd);
}

document.getElementById("popupDetailClose")?.addEventListener("click", closePopup);
document.getElementById("popupDetailOverlay")?.addEventListener("click", e => { if (e.target === e.currentTarget) closePopup(); });
document.getElementById("warningOmsetOverlay")?.addEventListener("click", e => e.stopPropagation());
setupSwipeClose(document.getElementById("popupDetailBox"), () => { closePopup(); const box = document.getElementById("popupDetailBox"); if (box) box.style.transform = ""; });

// ─── Popup Info Target ───────────────────────────────────────────────────────

function openPopupInfoTarget(tanggal, jumlah, tutup, pending, putus, kunjungan, ofTarget, keteranganTarget) {
  document.getElementById("popupDetailTitle").textContent    = "Info Target";
  document.getElementById("popupDetailSubtitle").textContent = `Tanggal: ${tanggal}`;
  document.getElementById("popupDetailTotal").textContent    = jumlah;
  document.getElementById("popupDetailList").innerHTML = `
    <div class="popup-detail-item"><div class="popup-detail-item-key">Tutup</div><div class="popup-detail-item-value">${tutup}</div></div>
    <div class="popup-detail-item"><div class="popup-detail-item-key">Pending</div><div class="popup-detail-item-value">${pending}</div></div>
    <div class="popup-detail-item"><div class="popup-detail-item-key">Putus</div><div class="popup-detail-item-value">${putus}</div></div>
    <div class="popup-detail-item"><div class="popup-detail-item-key">Kunjungan</div><div class="popup-detail-item-value">${kunjungan}</div></div>
    <div class="popup-detail-item"><div class="popup-detail-item-key">Target Data</div><div class="popup-detail-item-value">${ofTarget}</div></div>
    <div class="popup-detail-item"><div class="popup-detail-item-key">Target Customer</div><div class="popup-detail-item-value">${keteranganTarget}</div></div>
    <div class="target-potongan-box">
      <div class="target-potongan-title">Potongan Target</div>
      <div class="keuangan-bonus-item"><span>Potongan Target Data</span><strong id="potonganTargetDataVal">-</strong></div>
      <div class="keuangan-bonus-item"><span>Potongan Target Customer</span><strong id="potonganTargetCustomerVal">-</strong></div>
      <div class="keuangan-bonus-item keuangan-bonus-item-total"><span>Jumlah Potongan</span><strong id="jumlahPotonganVal">-</strong></div>
    </div>`;

  const overlay = document.getElementById("popupDetailOverlay");
  const box     = document.getElementById("popupDetailBox");
  positionPopupDesktop(box);
  if (window.innerWidth > 768) enableDetailDrag();
  overlay.classList.add("show");

  (async () => {
    const kantorCabang = await getKantorCabangFromDB();
    const bonusData    = kantorCabang?.bonus?.data || {};
    const potongan     = kantorCabang?.potongan || {};
    let nilaiPotonganData = 0, nilaiPotonganCustomer = 0;

    const elData = document.getElementById("potonganTargetDataVal");
    if (elData) {
      if (ofTarget < 0) {
        nilaiPotonganData = Number(bonusData?.insentif) || 0;
        elData.textContent = nilaiPotonganData > 0 ? `Rp ${formatRupiah(nilaiPotonganData)}` : "-";
      } else { elData.textContent = "-"; }
    }

    const elCustomer = document.getElementById("potonganTargetCustomerVal");
    if (elCustomer) {
      const setengahUpah   = potongan?.setengahUpah || {};
      const batasPersen    = Number(setengahUpah?.batas) || 0;
      const potonganPersen = Number(setengahUpah?.potonganUpah) || 0;
      const upahHarian     = Number(kantorCabang?.upahHarian) || 0;
      const batasCustomer  = Number(potongan?.kelipatanUpah?.batas) || 0;
      let kenaRule = false;

      if (jumlah >= batasCustomer && batasPersen > 0) {
        const targetKunjungan = Math.floor(jumlah * (batasPersen / 100));
        if (kunjungan <= targetKunjungan) {
          nilaiPotonganCustomer = Math.floor(upahHarian * (potonganPersen / 100));
          elCustomer.textContent = nilaiPotonganCustomer > 0 ? `Rp ${formatRupiah(nilaiPotonganCustomer)}` : "-";
          kenaRule = true;
        }
      }
      if (!kenaRule) {
        const kelipatanUpah = potongan?.kelipatanUpah || {};
        const batas         = Number(kelipatanUpah?.batas) || 0;
        const kelipatan     = Number(kelipatanUpah?.kelipatan) || 1;
        const potonganUpah  = Number(kelipatanUpah?.potonganUpah) || 0;
        if (jumlah < batas) { elCustomer.textContent = "-"; }
        else {
          const selisih = batas - kunjungan;
          if (selisih <= 0) { elCustomer.textContent = "-"; }
          else {
            nilaiPotonganCustomer = Math.ceil(selisih / kelipatan) * potonganUpah;
            elCustomer.textContent = nilaiPotonganCustomer > 0 ? `Rp ${formatRupiah(nilaiPotonganCustomer)}` : "-";
          }
        }
      }
    }

    const elJumlah = document.getElementById("jumlahPotonganVal");
    if (elJumlah) {
      const total = nilaiPotonganData + nilaiPotonganCustomer;
      elJumlah.textContent = total > 0 ? `Rp ${formatRupiah(total)}` : "-";
    }
  })();
}

// ─── Popup Keuangan ───────────────────────────────────────────────────────────

function openPopupKeuangan(tanggal, omset = 0, keteranganTarget = 0, payData = {}, expiredData = {}, kunjungan = 0) {
  document.getElementById("popupDetailTitle").textContent    = "Keuangan";
  document.getElementById("popupDetailSubtitle").textContent = `Tanggal: ${tanggal}`;
  document.getElementById("popupDetailTotal").textContent    = `Rp ${formatRupiah(omset)}`;
  document.getElementById("popupDetailList").innerHTML = `
    <div class="keuangan-form">
      <div class="keuangan-group">
        <label class="keuangan-label">Omset</label>
        <input type="number" inputmode="numeric" class="keuangan-input" id="keuanganOmset" placeholder="Masukkan omset">
      </div>
      <div class="keuangan-group">
        <label class="keuangan-label">Klaim Insentif</label>
        <input type="number" inputmode="numeric" class="keuangan-input" id="keuanganInsentif" placeholder="Masukkan insentif">
      </div>
      <div class="keuangan-group">
        <label class="keuangan-label">Kasbon</label>
        <input type="number" inputmode="numeric" class="keuangan-input" id="keuanganKasbon" placeholder="Masukkan kasbon">
      </div>
      <div class="keuangan-bonus-box">
        <div class="keuangan-bonus-title">Bonus</div>
        <div class="keuangan-bonus-item"><span>Bonus Insentif</span><strong id="bonusInsentifVal">-</strong></div>
        <div class="keuangan-bonus-item"><span>Bonus Kunjungan</span><strong id="bonusKunjunganVal">-</strong></div>
        <div class="keuangan-bonus-item"><span>Bonus Pay</span><strong id="bonusPayVal">-</strong></div>
      </div>
      <button id="btnKirimKeuangan" class="keuangan-submit-btn">Kirim</button>
    </div>`;

  const overlay   = document.getElementById("popupDetailOverlay");
  const box       = document.getElementById("popupDetailBox");
  // FIX: deklarasi inputOmset sebelum dipakai di bawah
  const inputOmset    = document.getElementById("keuanganOmset");
  const inputInsentif = document.getElementById("keuanganInsentif");
  const inputKasbon   = document.getElementById("keuanganKasbon");
  const btn           = document.getElementById("btnKirimKeuangan");

  function formatInputRibuan(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      const angka = input.value.replace(/\D/g, "");
      input.value = angka ? Number(angka).toLocaleString("id-ID") : "";
    });
  }
  formatInputRibuan(inputOmset);
  formatInputRibuan(inputInsentif);
  formatInputRibuan(inputKasbon);

  // Hitung bonus async
  (async () => {
    const kantorCabang = await getKantorCabangFromDB();
    const bonus        = kantorCabang?.bonus || {};

    const elKunjungan = document.getElementById("bonusKunjunganVal");
    if (elKunjungan) {
      const cb     = bonus?.customer || {};
      const target = Number(cb?.target) || 0;
      const keli   = Number(cb?.kelipatan) || 1;
      const uang   = Number(cb?.uang) || 0;
      if (kunjungan <= target) { elKunjungan.textContent = "-"; }
      else {
        const kali = Math.floor((kunjungan - target - 1) / keli) + 1;
        elKunjungan.textContent = (kali * uang) > 0 ? `Rp ${formatRupiah(kali * uang)}` : "-";
      }
    }

    const elInsentif = document.getElementById("bonusInsentifVal");
    if (elInsentif) {
      if (keteranganTarget >= 0) {
        const uang = Number(bonus?.data?.insentif) || 0;
        elInsentif.textContent = uang > 0 ? `Rp ${formatRupiah(uang)}` : "-";
      } else { elInsentif.textContent = "-"; }
    }

    const elPay = document.getElementById("bonusPayVal");
    if (elPay) {
      const sumExpiredBonus = Object.values(expiredData).reduce((acc, v) => acc + (Number(v) || 0), 0);
      const ketentuan       = Number(bonus?.ketentuan) || 0;
      if (sumExpiredBonus > ketentuan) { elPay.textContent = "-"; }
      else {
        const sumPayBonus = Object.values(payData).reduce((acc, v) => acc + (Number(v) || 0), 0);
        if (sumPayBonus < 180) { elPay.textContent = "-"; }
        else {
          let bonusPayUang = 0, cocok = false;
          Object.values(bonus?.margin || {}).forEach(obj => {
            const min = Number(obj.minimal) || 0, max = Number(obj.maksimal) || 0, uang = Number(obj.uang) || 0;
            if (sumPayBonus >= min && sumPayBonus <= max) { bonusPayUang = uang; cocok = true; }
          });
          elPay.textContent = cocok && bonusPayUang > 0 ? `Rp ${formatRupiah(bonusPayUang)}` : "-";
        }
      }
    }
  })();

  // Load existing keuangan dari IndexedDB
  (async () => {
    try {
      const laporanAdmin = await getLaporanAdminFromDB(tanggal);
      const keuangan     = laporanAdmin?.data?.[selectedKurirUid]?.distribusi?.keuangan || {};
      if (inputOmset    && keuangan.inputOmset   > 0) inputOmset.value    = Number(keuangan.inputOmset).toLocaleString("id-ID");
      if (inputInsentif && keuangan.klaimInsentif > 0) inputInsentif.value = Number(keuangan.klaimInsentif).toLocaleString("id-ID");
      if (inputKasbon   && keuangan.kasbon        > 0) inputKasbon.value   = Number(keuangan.kasbon).toLocaleString("id-ID");
      const hasValue    = inputOmset.value.trim() !== "";
      btn.disabled      = !hasValue;
      btn.classList.toggle("disabled", !hasValue);
    } catch (err) { console.error("Gagal load keuangan:", err); }
  })();

  inputOmset.addEventListener("input", () => {
    const hasValue = inputOmset.value.trim() !== "";
    btn.disabled   = !hasValue;
    btn.classList.toggle("disabled", !hasValue);
  });

  async function submitKeuangan() {
    if (btn.classList.contains("loading")) return;
    btn.classList.add("loading");
    btn.textContent = "Mengirim...";
    try {
      const adminUid = auth.currentUser?.uid;
      if (!adminUid || !selectedKurirUid) throw new Error("UID tidak ditemukan");

      const docRef  = doc(db, "users", adminUid, "laporanAdmin", tanggal);
      const snap    = await getDoc(docRef);
      if (!snap.exists() || !snap.data()[selectedKurirUid]) { openBelumAdaData(); btn.classList.remove("loading"); btn.textContent = "Kirim"; return; }

      const userData      = usersCache.find(x => x.uid === selectedKurirUid);
      const activeVarians = (userData?.varian || []).filter(v => { const k = Object.keys(v)[0]; return k && v[k]?.isAktif; });
      const laporan       = await getDataHarianFromDB(selectedKurirUid, tanggal);
      const payDataRaw    = laporan?.data?.pay     || {};
      const expiredDataRaw = laporan?.data?.expired || {};

      let jumlahUangClosing = 0;
      activeVarians.forEach(v => {
        const key = Object.keys(v)[0];
        jumlahUangClosing += (Number(laporan?.data?.closing?.[key]) || 0) * (Number(v[key]?.hargaProduksi) || 0);
      });

      const pay = {}, expired = {};
      let payMargin = 0, expiredMargin = 0;
      activeVarians.forEach(v => {
        const key = Object.keys(v)[0];
        const qp  = Number(payDataRaw[key]) || 0;
        const qe  = Number(expiredDataRaw[key]) || 0;
        if (qp > 0) { pay[key] = qp; payMargin += qp * ((Number(v[key]?.hargaKonsumen) || 0) - (Number(v[key]?.hargaProduksi) || 0)); }
        if (qe > 0) { expired[key] = qe; expiredMargin += qe * (Number(v[key]?.hargaProduksi) || 0); }
      });
      pay.margin     = payMargin;
      expired.margin = expiredMargin;

      const cl      = laporan?.data?.customerLama     ?? 0;
      const ct      = laporan?.data?.customerTambahan ?? 0;
      const cn      = laporan?.data?.customerNew      ?? 0;
      const cJml    = cl + ct + cn;
      const ket     = laporan?.data?.keterangan || {};
      const kTutup  = Number(ket.tutup)   || 0;
      const kPend   = Number(ket.pending) || 0;
      const kPutus  = Number(ket.putus)   || 0;
      const kunj    = Number(laporan?.data?.kunjungan) || 0;
      const kc2     = await getKantorCabangFromDB();
      const tgCust  = Number(kc2?.bonus?.data?.targetCustomer) || 0;
      const oT      = kunj - cJml;
      const kT      = kunj - tgCust;
      const potonganTargetData = oT < 0 ? (Number(kc2?.bonus?.data?.insentif) || 0) : 0;

      const bonusInsentif   = kT >= 0 ? (Number(kc2?.bonus?.data?.insentif) || 0) : 0;
      const bonusKunjungan  = Number(document.getElementById("bonusKunjunganVal")?.textContent.replace(/[^0-9]/g, "")) || 0;
      const bonusPay        = Number(document.getElementById("bonusPayVal")?.textContent.replace(/[^0-9]/g, ""))        || 0;
      const jumlahBonus     = bonusInsentif + bonusKunjungan + bonusPay;
      const inputOmsetValue = Number(inputOmset.value.replace(/\./g, "")) || 0;
      const grossMargin     = inputOmsetValue - jumlahUangClosing;
      const upahHarian      = Number(kc2?.upahHarian) || 0;

      const distribusi = {
        expired, pay,
        infoTarget: {
          kunjungan: kunj, tutup: kTutup, pending: kPend, putus: kPutus,
          targetData: oT, targetCustomer: kT,
          customerLama: cl, customerTambahan: ct, customerNew: cn, jumlahCustomer: cJml,
          potongan: { potonganTargetData, potonganTargetCustomer: 0, jumlahPotongan: potonganTargetData }
        },
        keuangan: {
          omset, inputOmset: inputOmsetValue, grossMargin,
          profitSekarang: grossMargin - jumlahBonus - upahHarian,
          profitKemarin: pay.margin - expired.margin - jumlahBonus - upahHarian,
          klaimInsentif: Number(inputInsentif?.value?.replace(/\./g, "")) || 0,
          kasbon:        Number(inputKasbon?.value?.replace(/\./g, ""))   || 0,
          bonus: { bonusInsentif, bonusKunjungan, bonusPay, jumlahBonus }
        }
      };

      await updateDoc(docRef, { tanggal, [`${selectedKurirUid}.distribusi`]: distribusi });

      try { const s = await getDoc(docRef); if (s.exists()) await saveLaporanAdminToDB(tanggal, s.data()); } catch (e) { console.warn(e.code); }
      try {
        const existing = await getDataHarianFromDB(selectedKurirUid, tanggal);
        if (existing) await saveDataHarianToDBLaporan(selectedKurirUid, tanggal, {
          ...existing.data,
          pay: distribusi.pay, expired: distribusi.expired,
          kunjungan: distribusi.infoTarget.kunjungan,
          customerLama: distribusi.infoTarget.customerLama, customerTambahan: distribusi.infoTarget.customerTambahan, customerNew: distribusi.infoTarget.customerNew,
          keterangan: { tutup: kTutup, pending: kPend, putus: kPutus },
          pembayaran: { bayarKonsumen: distribusi.keuangan.inputOmset, bayarProduksi: 0 }
        });
      } catch (e) { console.warn(e.code); }

      await setDoc(doc(db, "users", selectedKurirUid, "laporanMarketing", tanggal), { distribusi }, { merge: true });
      btn.classList.add("success");
      btn.textContent = "Berhasil";
    } catch (err) {
      console.error(err);
      btn.classList.add("error");
      btn.textContent = "Gagal";
    } finally {
      setTimeout(() => { btn.classList.remove("loading","success","error"); btn.textContent = "Kirim"; }, 1600);
    }
  }

  btn.addEventListener("click", () => {
    const insentifVal = Number(inputInsentif?.value.replace(/\./g, "")) || 0;
    if (insentifVal > 0 && keteranganTarget < 0) { openWarningBelumTarget(); return; }
    const inputVal = Number(inputOmset.value.replace(/\./g, "")) || 0;
    if (inputVal !== omset) { openWarningOmset(submitKeuangan); return; }
    submitKeuangan();
  });

  positionPopupDesktop(box);
  if (window.innerWidth > 768) enableDetailDrag();
  overlay.classList.add("show");
}

// ─── Warning popups ───────────────────────────────────────────────────────────

function openWarningOmset(onContinue) {
  const overlay  = document.getElementById("warningOmsetOverlay");
  const btnCek   = document.getElementById("btnCekLagi");
  const btnLanjut = document.getElementById("btnLanjutSimpan");
  overlay.classList.add("show");
  btnCek.onclick    = () => overlay.classList.remove("show");
  btnLanjut.onclick = () => { overlay.classList.remove("show"); onContinue?.(); };
}

function openBelumAdaData() { alert("Belum ada data"); }

function openWarningBelumTarget() {
  const overlay = document.getElementById("warningTargetOverlay");
  const btnCek  = document.getElementById("btnCekLagiTarget");
  overlay.classList.add("show");
  btnCek.onclick = () => overlay.classList.remove("show");
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatRupiah(angka) {
  return new Intl.NumberFormat("id-ID").format(Number(angka) || 0);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Report drag scroll ───────────────────────────────────────────────────────

(function enableReportDragScroll() {
  const report = document.getElementById("reportCollection");
  if (!report || window.innerWidth <= 768) return;
  let isDown = false, startX, scrollLeft;
  report.style.cursor = "grab";
  report.addEventListener("mousedown", e => { isDown = true; startX = e.pageX - report.offsetLeft; scrollLeft = report.scrollLeft; report.style.cursor = "grabbing"; });
  report.addEventListener("mouseleave", () => { isDown = false; report.style.cursor = "grab"; });
  report.addEventListener("mouseup",    () => { isDown = false; report.style.cursor = "grab"; });
  report.addEventListener("mousemove", e => {
    if (!isDown) return;
    e.preventDefault();
    report.scrollLeft = scrollLeft - (e.pageX - report.offsetLeft - startX) * 1.4;
  });
})();

// ─── Tabel drag scroll ────────────────────────────────────────────────────────

(function setupTabelDragScroll() {
  const wrapper = document.querySelector(".laporan-table-wrapper");
  if (!wrapper) return;
  let isDown = false, startX, startY, scrollLeft, scrollTop;
  wrapper.addEventListener("mousedown", e => {
    isDown = true; startX = e.pageX - wrapper.offsetLeft; startY = e.pageY - wrapper.offsetTop;
    scrollLeft = wrapper.scrollLeft; scrollTop = wrapper.scrollTop;
    wrapper.style.cursor = "grabbing"; wrapper.style.userSelect = "none";
  });
  window.addEventListener("mouseup",      () => { if (!isDown) return; isDown = false; wrapper.style.cursor = ""; wrapper.style.userSelect = ""; });
  wrapper.addEventListener("mouseleave",  () => { if (!isDown) return; isDown = false; wrapper.style.cursor = ""; wrapper.style.userSelect = ""; });
  wrapper.addEventListener("mousemove", e => {
    if (!isDown) return;
    e.preventDefault();
    wrapper.scrollLeft = scrollLeft - (e.pageX - wrapper.offsetLeft - startX) * 1.5;
    wrapper.scrollTop  = scrollTop  - (e.pageY - wrapper.offsetTop  - startY) * 1.5;
  });
})();

// ─── Laporan header ───────────────────────────────────────────────────────────

async function renderLaporanHeader() {
  const topHeader   = document.getElementById("laporanHeaderTop");
  const varianHeader = document.getElementById("laporanVarianHeader");
  if (!topHeader || !varianHeader || !auth.currentUser) return;

  const users         = await getUsersFromDB();
  const adminCabang   = users.find(item => item.uid === auth.currentUser.uid && item.role === "adminCabang");
  if (!adminCabang) return;

  const activeVarians = (adminCabang.varian || []).filter(v => { const k = Object.keys(v)[0]; return k && v[k]?.isAktif; });
  const n             = activeVarians.length;

  topHeader.innerHTML = `
    <th rowspan="2" class="th-tanggal">TANGGAL</th>
    <th colspan="${n + 1}" class="th-section">CLOSING</th>
    <th colspan="${n + 1}" class="th-section">PAY</th>
    <th colspan="${n + 2}" class="th-section">EXPIRED</th>
    <th colspan="4" class="th-section">CUSTOMER</th>
    <th colspan="6" class="th-section">INFO TARGET</th>
    <th colspan="5" class="th-section">KEUANGAN</th>`;

  varianHeader.innerHTML = "";
  ["closing","pay","expired"].forEach(section => {
    activeVarians.forEach(v => { varianHeader.innerHTML += `<th>${escapeHtml(Object.keys(v)[0])}</th>`; });
    varianHeader.innerHTML += `<th>JML</th>`;
    if (section === "expired") varianHeader.innerHTML += `<th>%</th>`;
  });
  ["Old","Plus","New","JML"].forEach(s => { varianHeader.innerHTML += `<th>${s}</th>`; });
  ["Tutup","Pending","Putus","Kunjungan","Target Data","Target Customer"].forEach(s => { varianHeader.innerHTML += `<th>${s}</th>`; });
  ["Omset","Validasi Omset","Bonus","Insentif","Kasbon"].forEach(s => { varianHeader.innerHTML += `<th>${s}</th>`; });

  // Dynamic CSS column highlight
  const g = n + 1, e = n + 2;
  const h1s = 1, h1e = g;
  const h2s = h1e + 1, h2e = h2s + g - 1;
  const h3s = h2e + 1, h3e = h3s + e - 1;
  const h4s = h3e + 1, h4e = h4s + 3;
  const h5s = h4e + 1, h5e = h5s + 5;
  const h6s = h5e + 1, h6e = h6s + 4;
  const b1s = 2, b1e = b1s + g - 1;
  const b2s = b1e + 1, b2e = b2s + g - 1;
  const b3s = b2e + 1, b3e = b3s + e - 1;
  const b4s = b3e + 1, b4e = b4s + 3;
  const b5s = b4e + 1, b5e = b5s + 5;
  const b6s = b5e + 1, b6e = b6s + 4;

  let styleEl = document.getElementById("laporan-dynamic-style");
  if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "laporan-dynamic-style"; document.head.appendChild(styleEl); }
  styleEl.textContent = `
    #laporanVarianHeader th:nth-child(n+${h1s}):nth-child(-n+${h1e}) { background:#d7c0a2; }
    #laporanVarianHeader th:nth-child(n+${h2s}):nth-child(-n+${h2e}) { background:#b7d8c0; }
    #laporanVarianHeader th:nth-child(n+${h3s}):nth-child(-n+${h3e}) { background:#e3b5b5; }
    #laporanVarianHeader th:nth-child(n+${h4s}):nth-child(-n+${h4e}) { background:#c9c2e8; }
    #laporanVarianHeader th:nth-child(n+${h5s}):nth-child(-n+${h5e}) { background:#aecde8; }
    #laporanVarianHeader th:nth-child(n+${h6s}):nth-child(-n+${h6e}) { background:#e7d2a9; }
    .laporan-table tbody td:nth-child(n+${b1s}):nth-child(-n+${b1e}) { background:#f6efe6; }
    .laporan-table tbody td:nth-child(n+${b2s}):nth-child(-n+${b2e}) { background:#edf7f0; }
    .laporan-table tbody td:nth-child(n+${b3s}):nth-child(-n+${b3e}) { background:#fbeeee; }
    .laporan-table tbody td:nth-child(n+${b4s}):nth-child(-n+${b4e}) { background:#f2f0fb; }
    .laporan-table tbody td:nth-child(n+${b5s}):nth-child(-n+${b5e}) { background:#eaf4fb; }
    .laporan-table tbody td:nth-child(n+${b6s}):nth-child(-n+${b6e}) { background:#fbf5e9; }`;
}

// ─── Laporan table ────────────────────────────────────────────────────────────

async function renderLaporanTanggalTable() {
  const tbody = document.getElementById("laporanTableBody");
  if (!tbody) return;

  const dateInput   = document.getElementById("dateFilterInput");
  const selectedDate = dateInput?.value ? new Date(dateInput.value) : new Date();
  const year        = selectedDate.getFullYear();
  const month       = selectedDate.getMonth();
  const totalDays   = new Date(year, month + 1, 0).getDate();
  const namaHari    = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const namaBulan   = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const mm          = String(month + 1).padStart(2, "0");
  const yyyy        = String(year);

  const allUsers      = await getUsersFromDB();
  const adminData     = allUsers.find(u => u.uid === auth.currentUser?.uid);
  const activeVarians = (adminData?.varian || []).filter(v => { const k = Object.keys(v)[0]; return k && v[k]?.isAktif; });
  const n             = activeVarians.length;

  // Preload semua data bulan ini
  const allLaporan = {}, allDataHarian = {};
  for (let d = 1; d <= totalDays; d++) {
    const dd  = String(d).padStart(2, "0");
    const tgl = `${yyyy}-${mm}-${dd}`;
    const rec = await getLaporanAdminFromDB(tgl);
    if (rec) allLaporan[tgl] = rec;
    if (selectedKurirUid) {
      const dh = await getDataHarianFromDB(selectedKurirUid, tgl);
      if (dh) allDataHarian[tgl] = dh;
    }
  }

  const activeDay  = selectedDate.getMonth() === month && selectedDate.getFullYear() === year ? selectedDate.getDate() : totalDays;
  const dayEnd     = laporanFilter === "active" || laporanFilter === "until" ? activeDay : totalDays;
  const onlyActive = laporanFilter === "active";

  const initTotals = () => ({
    closing: Array(n).fill(0), closingJml: 0,
    pay:     Array(n).fill(0), payJml:     0,
    expired: Array(n).fill(0), expiredJml: 0,
    customerLama: 0, customerTambahan: 0, customerNew: 0, customerJml: 0,
    tutup: 0, pending: 0, putus: 0, kunjungan: 0,
    omset: 0, validasiOmset: 0, bonus: 0, insentif: 0, kasbon: 0
  });

  let weeklyTotals = initTotals(), grandTotal = initTotals();
  tbody.innerHTML = "";

  for (let day = 1; day <= dayEnd; day++) {
    if (onlyActive && day !== activeDay) continue;
    const date         = new Date(year, month, day);
    const dd           = String(day).padStart(2, "0");
    const tgl          = `${yyyy}-${mm}-${dd}`;
    const tanggalText  = `${namaHari[date.getDay()]}, ${day} ${namaBulan[month]} ${year}`;

    let kurirData = null;
    if (selectedKurirUid) {
      const fromDB = allLaporan[tgl]?.data;
      if (fromDB?.[selectedKurirUid]) {
        kurirData = fromDB[selectedKurirUid];
      } else {
        try {
          const snap = await getDoc(doc(db, "users", auth.currentUser.uid, "laporanAdmin", tgl));
          if (snap.exists()) { const fs = snap.data(); kurirData = fs[selectedKurirUid] || null; await saveLaporanAdminToDB(tgl, fs); }
        } catch (err) { console.warn(`Fallback Firestore gagal ${tgl}:`, err.code); }
      }
    }

    const dh = allDataHarian[tgl]?.data || {};

    // CLOSING
    const closing = kurirData?.pembayaran?.closing || {};
    let closingJml = 0;
    const closingCells = activeVarians.map(v => { const k = Object.keys(v)[0]; const val = Number(closing[k]) || 0; closingJml += val; return `<td>${val || ""}</td>`; }).join("") + `<td class="laporan-jml-cell">${closingJml || ""}</td>`;

    // PAY
    const pay = kurirData?.distribusi?.pay || {};
    let payJml = 0;
    const payCells = activeVarians.map(v => { const k = Object.keys(v)[0]; const val = Number(pay[k]) || 0; payJml += val; return `<td>${val || ""}</td>`; }).join("") + `<td class="laporan-jml-cell">${payJml || ""}</td>`;

    // EXPIRED
    const expired = kurirData?.distribusi?.expired || {};
    let expiredJml = 0;
    const expiredCells = activeVarians.map(v => { const k = Object.keys(v)[0]; const val = Number(expired[k]) || 0; expiredJml += val; return `<td>${val || ""}</td>`; }).join("");
    const expiredPercent = payJml > 0 ? Math.round((expiredJml / payJml) * 100) : 0;
    const expiredExtra   = `<td class="laporan-jml-cell">${expiredJml || ""}</td><td class="laporan-persentase-cell">${payJml > 0 ? expiredPercent + "%" : ""}</td>`;

    // CUSTOMER
    const cL   = Number(dh.customerLama)     || 0;
    const cT   = Number(dh.customerTambahan) || 0;
    const cN   = Number(dh.customerNew)      || 0;
    const cJml = cL + cT + cN;
    const customerCells = [cL, cT, cN, cJml].map((v, i) => `<td class="${i === 3 ? "laporan-jml-cell" : ""}">${v || ""}</td>`).join("");

    // INFO TARGET
    const infoTarget    = kurirData?.distribusi?.infoTarget || {};
    const tutup         = Number(infoTarget.tutup)          || 0;
    const pending       = Number(infoTarget.pending)        || 0;
    const putus         = Number(infoTarget.putus)          || 0;
    const kunjungan     = Number(infoTarget.kunjungan)      || 0;
    const targetData    = infoTarget.targetData    ?? "";
    const targetCustomer = infoTarget.targetCustomer ?? "";
    const infoTargetCells = [tutup || "", pending || "", putus || "", kunjungan || "", targetData, targetCustomer].map(v => `<td>${v !== "" ? v : ""}</td>`).join("");

    // KEUANGAN
    const keuangan      = kurirData?.distribusi?.keuangan || {};
    const omset         = Number(keuangan.inputOmset) || 0;
    const bonus         = (Number(keuangan.bonus?.bonusPay) || 0) + (Number(keuangan.bonus?.bonusKunjungan) || 0);
    const insentif      = Number(keuangan.klaimInsentif) || 0;
    const kasbon        = Number(keuangan.kasbon)        || 0;
    const validasiOmset = Number(keuangan.omset)         || 0;
    const keuanganCells = [
      omset        > 0 ? `Rp ${formatRupiah(omset)}`         : "",
      validasiOmset > 0 ? `Rp ${formatRupiah(validasiOmset)}` : "",
      bonus        > 0 ? `Rp ${formatRupiah(bonus)}`         : "",
      insentif     > 0 ? `Rp ${formatRupiah(insentif)}`      : "",
      kasbon       > 0 ? `Rp ${formatRupiah(kasbon)}`        : ""
    ].map(v => `<td>${v}</td>`).join("");

    // Akumulasi totals
    activeVarians.forEach((v, i) => {
      const k   = Object.keys(v)[0];
      const cv  = Number(closing[k]) || 0;
      const pv  = Number(pay[k])     || 0;
      const ev  = Number(expired[k]) || 0;
      weeklyTotals.closing[i] += cv; grandTotal.closing[i] += cv;
      weeklyTotals.pay[i]     += pv; grandTotal.pay[i]     += pv;
      weeklyTotals.expired[i] += ev; grandTotal.expired[i] += ev;
      weeklyTotals.closingJml += cv; grandTotal.closingJml += cv;
      weeklyTotals.payJml     += pv; grandTotal.payJml     += pv;
      weeklyTotals.expiredJml += ev; grandTotal.expiredJml += ev;
    });
    const addToTotals = t => {
      t.customerLama += cL; t.customerTambahan += cT; t.customerNew += cN; t.customerJml += cJml;
      t.tutup += tutup; t.pending += pending; t.putus += putus; t.kunjungan += kunjungan;
      t.omset += omset; t.validasiOmset += validasiOmset; t.bonus += bonus; t.insentif += insentif; t.kasbon += kasbon;
    };
    addToTotals(weeklyTotals);
    addToTotals(grandTotal);

    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="tanggal-cell">${tanggalText}</td>${closingCells}${payCells}${expiredCells}${expiredExtra}${customerCells}${infoTargetCells}${keuanganCells}`;
    tbody.appendChild(tr);

    // Subtotal baris Minggu
    if (date.getDay() === 0) {
      const wExp = weeklyTotals.payJml > 0 ? Math.round((weeklyTotals.expiredJml / weeklyTotals.payJml) * 100) + "%" : "";
      const subTr = document.createElement("tr");
      subTr.className = "laporan-subtotal-row";
      subTr.innerHTML = `
        <td class="tanggal-cell" style="font-weight:700;color:#b08a5c;">Total Minggu Ini</td>
        ${weeklyTotals.closing.map(v => `<td style="font-weight:700;">${v || ""}</td>`).join("")}<td style="font-weight:700;">${weeklyTotals.closingJml || ""}</td>
        ${weeklyTotals.pay.map(v => `<td style="font-weight:700;">${v || ""}</td>`).join("")}<td style="font-weight:700;">${weeklyTotals.payJml || ""}</td>
        ${weeklyTotals.expired.map(v => `<td style="font-weight:700;">${v || ""}</td>`).join("")}<td style="font-weight:700;">${weeklyTotals.expiredJml || ""}</td>
        <td class="laporan-persentase-cell" style="font-weight:700;">${wExp}</td>
        <td style="font-weight:700;">${weeklyTotals.customerLama || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.customerTambahan || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.customerNew || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.customerJml || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.tutup || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.pending || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.putus || ""}</td>
        <td style="font-weight:700;">${weeklyTotals.kunjungan || ""}</td>
        <td style="font-weight:700;"></td><td style="font-weight:700;"></td>
        <td style="font-weight:700;">${weeklyTotals.omset > 0 ? `Rp ${formatRupiah(weeklyTotals.omset)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.validasiOmset > 0 ? `Rp ${formatRupiah(weeklyTotals.validasiOmset)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.bonus > 0 ? `Rp ${formatRupiah(weeklyTotals.bonus)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.insentif > 0 ? `Rp ${formatRupiah(weeklyTotals.insentif)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.kasbon > 0 ? `Rp ${formatRupiah(weeklyTotals.kasbon)}` : ""}</td>`;
      tbody.appendChild(subTr);
      weeklyTotals = initTotals();
    }
  }

  // Grand total row
  const gExp = grandTotal.payJml > 0 ? Math.round((grandTotal.expiredJml / grandTotal.payJml) * 100) + "%" : "";
  const totalTr = document.createElement("tr");
  totalTr.className = "laporan-grandtotal-row";
  totalTr.innerHTML = `
    <td class="tanggal-cell" style="font-weight:800;color:#b08a5c;">TOTAL</td>
    ${grandTotal.closing.map(v => `<td style="font-weight:800;">${v || ""}</td>`).join("")}<td style="font-weight:800;">${grandTotal.closingJml || ""}</td>
    ${grandTotal.pay.map(v => `<td style="font-weight:800;">${v || ""}</td>`).join("")}<td style="font-weight:800;">${grandTotal.payJml || ""}</td>
    ${grandTotal.expired.map(v => `<td style="font-weight:800;">${v || ""}</td>`).join("")}<td style="font-weight:800;">${grandTotal.expiredJml || ""}</td>
    <td class="laporan-persentase-cell" style="font-weight:800;">${gExp}</td>
    <td style="font-weight:800;">${grandTotal.customerLama || ""}</td>
    <td style="font-weight:800;">${grandTotal.customerTambahan || ""}</td>
    <td style="font-weight:800;">${grandTotal.customerNew || ""}</td>
    <td style="font-weight:800;">${grandTotal.customerJml || ""}</td>
    <td style="font-weight:800;">${grandTotal.tutup || ""}</td>
    <td style="font-weight:800;">${grandTotal.pending || ""}</td>
    <td style="font-weight:800;">${grandTotal.putus || ""}</td>
    <td style="font-weight:800;">${grandTotal.kunjungan || ""}</td>
    <td style="font-weight:800;"></td><td style="font-weight:800;"></td>
    <td style="font-weight:800;">${grandTotal.omset > 0 ? `Rp ${formatRupiah(grandTotal.omset)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.validasiOmset > 0 ? `Rp ${formatRupiah(grandTotal.validasiOmset)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.bonus > 0 ? `Rp ${formatRupiah(grandTotal.bonus)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.insentif > 0 ? `Rp ${formatRupiah(grandTotal.insentif)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.kasbon > 0 ? `Rp ${formatRupiah(grandTotal.kasbon)}` : ""}</td>`;
  tbody.appendChild(totalTr);
}
