import { db, auth } from "./index.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, onSnapshot, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DB_NAME         = "laporanDistribusiDB";
const STORE_USERS      = "users";

const DB_NAME_PRODUKSI = "appAdminCabangDB";
const STORE_PENGELUARAN = "pengeluaranProduksi";

let firestoreSync   = null;
let localSync       = null;
let unsubscribeSync = null;
let filterState = {
  mode: "month",
  from: null,
  to: null,
  jenis: null,
  keyword: null
};
const saved = localStorage.getItem("filterState");
if (saved) filterState = JSON.parse(saved);
let filterStateDistribusi = {
  mode: "month",
  from: null,
  to: null,
  jenis: null,
  keyword: null
};
const savedDistribusi = localStorage.getItem("filterStateDistribusi");
if (savedDistribusi) filterStateDistribusi = JSON.parse(savedDistribusi);

const fab     = document.getElementById("fabAction");
const overlay = document.getElementById("refreshOverlay");
const btn     = document.getElementById("btnRefresh");
const text    = document.getElementById("refreshText");
const btnFilterRange = document.getElementById("btnFilterRange");
const filterOverlay = document.getElementById("filterRangeOverlay");
const fromInput = document.getElementById("filterFromDate");
const toInput = document.getElementById("filterToDate");
const btnApplyRange = document.getElementById("btnApplyRange");
const btnResetRange = document.getElementById("btnResetRange");
const fabFilter  = document.getElementById("fabFilter");
const filterText = document.getElementById("filterText");
const dateInput = document.createElement("input");
const btnFilterJenis = document.getElementById("btnFilterJenis");
const btnCariAkun = document.getElementById("btnCariAkun");

const filterJenisOverlay = document.getElementById("filterJenisOverlay");
const filterAkunOverlay = document.getElementById("filterAkunOverlay");

const filterJenisSelect = document.getElementById("filterJenisSelect");
const searchAkunInput = document.getElementById("searchAkunInput");
const suggestList = document.getElementById("suggestList");
const filterRangeDistribusiOverlay = document.getElementById("filterRangeDistribusiOverlay");
const filterJenisDistribusiOverlay = document.getElementById("filterJenisDistribusiOverlay");
const filterAkunDistribusiOverlay  = document.getElementById("filterAkunDistribusiOverlay");
const fromInputDistribusi          = document.getElementById("filterFromDateDistribusi");
const toInputDistribusi            = document.getElementById("filterToDateDistribusi");
const filterJenisDistribusiSelect  = document.getElementById("filterJenisDistribusiSelect");
const searchAkunDistribusiInput    = document.getElementById("searchAkunDistribusiInput");
const suggestListDistribusi        = document.getElementById("suggestListDistribusi");

fab.style.display = "none";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  console.log("🔐 Login:", user.uid);
  if (unsubscribeSync) unsubscribeSync();
  listenFirestoreSync(user.uid);
  await loadLocalSync();
  checkSyncStatus();
  showRincianDBConsole();
  await applyFilter(selectedDate);
  updateFilterIndicators();
});

function listenFirestoreSync(uid) {
  const ref = doc(db, "users", uid);
  unsubscribeSync = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    firestoreSync = data?.rincianPengeluaranSync || null;
    console.log("🔥 Firestore sync:", firestoreSync);
    checkSyncStatus();
  });
}
function openProduksiDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME_PRODUKSI);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function openDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);

    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   = !existingDB.objectStoreNames.contains("rincianPengeluaranDB");

      existingDB.close();

      const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;
      const req = indexedDB.open(DB_NAME, targetVersion);

      req.onupgradeneeded = (ev) => {
        const dbUp = ev.target.result;

        if (!dbUp.objectStoreNames.contains(STORE_USERS)) {
          dbUp.createObjectStore(STORE_USERS, { keyPath: "uid" });
          console.log("🗄️ Store users dibuat");
        }

        if (!dbUp.objectStoreNames.contains("rincianPengeluaranDB")) {
          dbUp.createObjectStore("rincianPengeluaranDB", { keyPath: "id" });
          console.log("🗄️ Store rincianPengeluaranDB dibuat");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };

    checkReq.onerror = () => reject(checkReq.error);
  });
}
window.openRincianDB = openDB;

window.saveToRincianDBSingle = async function(tanggal, pengeluaranProduksi) {
  try {
    const dbConn = await openDB();
    if (!dbConn.objectStoreNames.contains("rincianPengeluaranDB")) return;
    return new Promise((resolve, reject) => {
      const tx    = dbConn.transaction("rincianPengeluaranDB", "readwrite");
      const store = tx.objectStore("rincianPengeluaranDB");
      const getReq = store.get(tanggal);
      getReq.onsuccess = () => {
        const existing = getReq.result || {};
        const merged = {
          ...existing,
          id: tanggal,
          tanggal,
          createdBy: auth.currentUser?.uid || "",
          pengeluaranProduksi: {
            ...(existing.pengeluaranProduksi || {}),
            ...pengeluaranProduksi
          },
          updatedAt: Date.now()
        };
        const putReq = store.put(merged);
        putReq.onsuccess = () => resolve();
        putReq.onerror  = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.error("❌ saveToRincianDBSingle:", err);
  }
};
async function showRincianDBConsole() {
  try {
    const dbConn = await openDB();

    if (!dbConn.objectStoreNames.contains("rincianPengeluaranDB")) {
      console.warn("⚠️ Store rincianPengeluaranDB belum ada");
      return;
    }

    const tx = dbConn.transaction(
      "rincianPengeluaranDB",
      "readonly"
    );

    const store = tx.objectStore(
      "rincianPengeluaranDB"
    );

    const req = store.getAll();

    req.onsuccess = () => {
      const data = req.result || [];

      console.log(
        "📦 rincianPengeluaranDB:",
        data.length,
        "record"
      );

      console.table(data);

      // tampil detail per item
      data.forEach((item, i) => {
        console.log(
          `📄 Record ${i + 1}`,
          JSON.parse(JSON.stringify(item))
        );
      });
    };

    req.onerror = () => {
      console.error(
        "❌ Gagal baca rincianPengeluaranDB:",
        req.error
      );
    };

  } catch (err) {
    console.error(
      "❌ showRincianDBConsole error:",
      err
    );
  }
}
async function updateLocalSync(newSync) {
  const dbConn = await openDB();
  if (!dbConn.objectStoreNames.contains(STORE_USERS)) return;
  const tx    = dbConn.transaction(STORE_USERS, "readwrite");
  const store = tx.objectStore(STORE_USERS);
  const req   = store.getAll();
  req.onsuccess = () => {
    const data  = req.result || [];
    const uid   = auth.currentUser?.uid;
    const index = data.findIndex(u => u.uid === uid);
    if (index === -1) return;
    const user = data[index];
    user.rincianPengeluaranSync = {
      ...user.rincianPengeluaranSync,
      version:  newSync.version,
      updateAt: newSync.updateAt || Date.now()
    };
    store.put(user);
    console.log("💾 Sync updated:", user.rincianPengeluaranSync);
    localSync = user.rincianPengeluaranSync;
    checkSyncStatus();
  };
}
async function loadLocalSync() {
  const dbConn = await openDB();
  if (!dbConn.objectStoreNames.contains(STORE_USERS)) return;
  const tx    = dbConn.transaction(STORE_USERS, "readonly");
  const store = tx.objectStore(STORE_USERS);  const req   = store.getAll();

  req.onsuccess = () => {
    const data     = req.result || [];
    const uid      = auth.currentUser?.uid;
    const userData = data.find(u => u.uid === uid);
    localSync = userData?.rincianPengeluaranSync || null;
    console.log("💾 Local sync:", localSync);
    checkSyncStatus();
  };
}
async function saveToRincianDB(snapshot) {
  const dbConn = await openProduksiDB();
  if (!dbConn.objectStoreNames.contains(STORE_PENGELUARAN)) {
    console.warn("⚠️ Store pengeluaranProduksi belum ada");
    return;
  }
  const tx    = dbConn.transaction(STORE_PENGELUARAN, "readwrite");
  const store = tx.objectStore(STORE_PENGELUARAN);
  const puts  = [];
  snapshot.forEach((docSnap) => {
    const data   = docSnap.data();
    const record = {
      tanggal: docSnap.id,
      pengeluaranProduksi: data.pengeluaranProduksi || {},
      pengeluaranDistribusi: data.pengeluaranDistribusi || {},
      updatedAt: Date.now()
    };
    console.log("💾 Put:", record.tanggal);
    puts.push(new Promise((resolve, reject) => {
      const r = store.put(record);
      r.onsuccess = () => resolve();
      r.onerror   = () => reject(r.error);
    }));
  });
  await Promise.all(puts);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
  console.log("✅ Semua doc tersimpan ke rincianPengeluaranDB");
}
async function debugRincianDB() {
  const dbConn = await openDB();
  if (!dbConn.objectStoreNames.contains("rincianPengeluaranDB")) {
    console.warn("⚠️ Store rincianPengeluaranDB belum ada");
    return;
  }
  const tx    = dbConn.transaction("rincianPengeluaranDB", "readonly");
  const store = tx.objectStore("rincianPengeluaranDB");
  const req   = store.getAll();
  req.onsuccess = () => {
    const data = req.result || [];
    console.log("📦 rincianPengeluaranDB:", data.length, "record");
    console.table(data);
  };
  req.onerror = () => console.error("❌ Gagal baca:", req.error);
}
function checkSyncStatus() {
  if (!firestoreSync) return;
  const fsVersion    = Number(firestoreSync?.version) || 0;
  const localVersion = Number(localSync?.version)     || 0;
  console.log("📊 Compare — Firestore:", fsVersion, "| IndexedDB:", localVersion);
  const hasUpdate = !localSync || fsVersion > localVersion;
  fab.style.display = hasUpdate ? "flex" : "none";
  console.log(hasUpdate ? "🔔 UPDATE AVAILABLE" : "✅ UP TO DATE");
}
fab.addEventListener("click", () => {
  overlay.classList.remove("hidden");
  btn.classList.remove("loading", "success", "error");
  btn.textContent  = "Segarkan";
  text.textContent = "Ada data baru, klik segarkan";
});
btn.addEventListener("click", async () => {
  btn.classList.remove("success", "error");
  btn.classList.add("loading");
  btn.textContent  = "Segarkan";
  text.textContent = "Memproses data...";
  try {
    if (!selectedDate) throw new Error("Tanggal belum dipilih");
    const [year, month] = selectedDate.split("-");
    const lastDay       = new Date(parseInt(year), parseInt(month), 0).getDate();
    const startTanggal  = `${year}-${month}-01`;
    const endTanggal    = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
    console.log("📅 Sync range:", startTanggal, "→", endTanggal);
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("User tidak login");
    const colRef = collection(db, "users", uid, "laporanAdmin");
    const q = query(
      colRef,
      where("createdBy", "==", uid),
      where("tanggal", ">=", startTanggal),
      where("tanggal", "<=", endTanggal)
    );
    const snapshot = await getDocs(q);
    console.log("🔥 Docs ditemukan:", snapshot.size);
    await saveToRincianDB(snapshot);
    await updateLocalSync(firestoreSync);
    await renderRincianTable(selectedDate);
    btn.classList.remove("loading");
    btn.classList.add("success");
    await renderDistribusiTable(selectedDate);
    btn.textContent  = "Berhasil diperbarui";
    text.textContent = "Data sudah sinkron";
    debugRincianDB();
    showRincianDBConsole();
    setTimeout(() => overlay.classList.add("hidden"), 700);
  } catch (err) {
    console.error("❌ Refresh error:", err);
    btn.classList.remove("loading");
    btn.classList.add("error");
    btn.textContent  = "Gagal, coba lagi";
    text.textContent = "Update gagal";
  }
});
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.add("hidden");
});
function setupCloseOnOutsideClick() {
  const overlays = document.querySelectorAll(".overlay, .filter-overlay");

  overlays.forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      // kalau klik background (bukan isi popup)
      if (e.target === overlay) {
        overlay.classList.add("hidden");
      }
    });
  });
}

setupCloseOnOutsideClick();

btnFilterRange.addEventListener("click", () => {
  filterOverlay.classList.remove("hidden");
  fromInput.value = filterState.from || "";
  toInput.value = filterState.to || "";
});
btnApplyRange.addEventListener("click", async () => {
  const from = fromInput.value;
  const to = toInput.value;
  if (!from || !to) return;
  filterState.mode = "range";
  filterState.from = from;
  filterState.to = to;
  localStorage.setItem("filterState", JSON.stringify(filterState));
  filterOverlay.classList.add("hidden");
  await renderRincianTable(selectedDate);
  await renderDistribusiTable(selectedDate);
  updateFilterIndicators();
});
btnResetRange.addEventListener("click", async () => {
  filterState = {
    mode: "month",
    from: null,
    to: null,
    jenis: null,
    keyword: null
  };

  localStorage.setItem("filterState", JSON.stringify(filterState));

  filterOverlay.classList.add("hidden");

  // render semua tanggal dalam bulan selectedDate
  await renderRincianTable(selectedDate);
  updateFilterIndicators();
});

btnFilterJenis.addEventListener("click", () => {
  filterJenisOverlay.classList.remove("hidden");
  filterJenisSelect.value = filterState.jenis || "";
});
document.getElementById("btnApplyJenis").addEventListener("click", async () => {
  const val = filterJenisSelect.value;

  if (!val) {
    filterState.mode  = "month";
    filterState.jenis = null;
    filterState.from  = null;
    filterState.to    = null;
  } else {
    filterState.mode  = "jenis";
    filterState.jenis = val;
  }

  localStorage.setItem("filterState", JSON.stringify(filterState));
  filterJenisOverlay.classList.add("hidden");
  await renderRincianTable(selectedDate);
  updateFilterIndicators();
});

btnCariAkun.addEventListener("click", () => {
  filterAkunOverlay.classList.remove("hidden");
  searchAkunInput.value = filterState.keyword || "";
  renderSuggest("");
});
searchAkunInput.addEventListener("input", (e) => {
  renderSuggest(e.target.value);
});
function renderSuggest(keyword) {
  const allData = window.__allRincianData || [];
  const list = new Set();
  allData.forEach(d => {
    const produksi = d.pengeluaranProduksi || {};
    Object.keys(produksi.fixCost || {}).forEach(n => list.add(n));
    Object.keys(produksi.variableCost || {}).forEach(n => list.add(n));
    Object.keys(produksi.marginalCost || {}).forEach(n => list.add(n));
  });
  const filtered = [...list].filter(n =>
    n.toLowerCase().includes(keyword.toLowerCase())
  );
  suggestList.innerHTML = filtered.map(n => `
    <div class="suggest-item" onclick="selectAkun('${n}')">
      ${n}
    </div>
  `).join("");
}
window.selectAkun = (nama) => {
  searchAkunInput.value = nama;
  renderSuggest(nama);
};
document.getElementById("btnApplyAkun").addEventListener("click", async () => {
  filterState.mode = "akun";
  filterState.keyword = searchAkunInput.value;
  localStorage.setItem("filterState", JSON.stringify(filterState));
  filterAkunOverlay.classList.add("hidden");
  await renderRincianTable(selectedDate);
  updateFilterIndicators();
});

const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
let selectedDate =
  localStorage.getItem(
    "rincianFilterTanggal"
  ) || todayStr;
const initialDate = new Date(selectedDate);
filterText.textContent = initialDate.getDate();

dateInput.type               = "date";
dateInput.style.position     = "fixed";
dateInput.style.opacity      = "0";
dateInput.style.pointerEvents = "none";
dateInput.style.zIndex       = "-1";
document.body.appendChild(dateInput);

fabFilter.addEventListener("click", () => {
  dateInput.showPicker?.();
  dateInput.click();
});
dateInput.addEventListener("change", async (e) => {
  const value = e.target.value;
  if (!value) return;
  selectedDate = value;
  localStorage.setItem("rincianFilterTanggal", value);
  const d = new Date(value);
  filterText.textContent = d.getDate();
  await applyFilter(selectedDate);
  await renderDistribusiTable(selectedDate);
});

async function applyFilter(date) {
  if (!filterState.mode || filterState.mode === "single") {
    filterState.mode = "month";
  }
  if (!filterStateDistribusi.mode || filterStateDistribusi.mode === "single") {
    filterStateDistribusi.mode = "month";
  }
  await renderRincianTable(date);
  await renderDistribusiTable(date);
}
function getShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getDate()} ${["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][d.getMonth()]}`;
}

function setFilterBtnText(btn, svgHtml, text) {
  if (!btn) return;
  btn.innerHTML = svgHtml + `<span>${text}</span>`;
}

function updateFilterIndicators() {
  // SVG masing-masing tombol
  const svgRentang = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM14.25 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"/><path fill-rule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clip-rule="evenodd"/></svg>`;
  const svgJenis  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-.53 14.03a.75.75 0 0 0 1.06 0l3-3a.75.75 0 1 0-1.06-1.06l-1.72 1.72V8.25a.75.75 0 0 0-1.5 0v5.69l-1.72-1.72a.75.75 0 0 0-1.06 1.06l3 3Z" clip-rule="evenodd"/></svg>`;
  const svgCari   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8.25 10.875a2.625 2.625 0 1 1 5.25 0 2.625 2.625 0 0 1-5.25 0Z"/><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.125 4.5a4.125 4.125 0 1 0 2.338 7.524l2.007 2.006a.75.75 0 1 0 1.06-1.06l-2.006-2.007a4.125 4.125 0 0 0-3.399-6.463Z" clip-rule="evenodd"/></svg>`;

  // ── PRODUKSI ──
  const btnRange = document.getElementById('btnFilterRange');
  const btnJenis = document.getElementById('btnFilterJenis');
  const btnAkun  = document.getElementById('btnCariAkun');

  const isRangeActive = filterState.mode === 'range' && filterState.from && filterState.to;
  const isJenisActive = filterState.mode === 'jenis' && !!filterState.jenis;
  const isAkunActive  = filterState.mode === 'akun'  && !!filterState.keyword;

  btnRange?.classList.toggle('filter-active', isRangeActive);
  btnJenis?.classList.toggle('filter-active', isJenisActive);
  btnAkun?.classList.toggle('filter-active',  isAkunActive);

  setFilterBtnText(btnRange, svgRentang, isRangeActive
    ? `${getShortDate(filterState.from)} - ${getShortDate(filterState.to)}`
    : 'Rentang');
  setFilterBtnText(btnJenis, svgJenis, isJenisActive ? filterState.jenis : 'Pilih Jenis');
  setFilterBtnText(btnAkun,  svgCari,  isAkunActive  ? filterState.keyword : 'Cari');

  // ── DISTRIBUSI ──
  const btnRangeD = document.getElementById('btnFilterRangeDistribusi');
  const btnJenisD = document.getElementById('btnFilterJenisDistribusi');
  const btnAkunD  = document.getElementById('btnCariAkunDistribusi');

  const isRangeDActive = filterStateDistribusi.mode === 'range' && filterStateDistribusi.from && filterStateDistribusi.to;
  const isJenisDActive = filterStateDistribusi.mode === 'jenis' && !!filterStateDistribusi.jenis;
  const isAkunDActive  = filterStateDistribusi.mode === 'akun'  && !!filterStateDistribusi.keyword;

  btnRangeD?.classList.toggle('filter-active', isRangeDActive);
  btnJenisD?.classList.toggle('filter-active', isJenisDActive);
  btnAkunD?.classList.toggle('filter-active',  isAkunDActive);

  setFilterBtnText(btnRangeD, svgRentang, isRangeDActive
    ? `${getShortDate(filterStateDistribusi.from)} - ${getShortDate(filterStateDistribusi.to)}`
    : 'Rentang');
  setFilterBtnText(btnJenisD, svgJenis, isJenisDActive ? filterStateDistribusi.jenis : 'Pilih Jenis');
  setFilterBtnText(btnAkunD,  svgCari,  isAkunDActive  ? filterStateDistribusi.keyword : 'Cari');
}

async function renderRincianTable(filterDate) {
  try {
    const tbody =
      document.getElementById(
        "rincianTableBody"
      );
    if (!tbody) return;
    tbody.innerHTML = "";
    const dbConn = await openProduksiDB();
    if (!dbConn.objectStoreNames.contains(STORE_PENGELUARAN)) {
      console.warn("Store pengeluaranProduksi tidak ada");
      return;
    }
    const tx    = dbConn.transaction(STORE_PENGELUARAN, "readonly");
    const store = tx.objectStore(STORE_PENGELUARAN);
    const docs = await new Promise(
      (resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () =>
          resolve(req.result || []);
        req.onerror = () =>
          reject(req.error);
      }
    );
    window.__allRincianData = docs;
    const filteredDocs = docs.filter(doc => {
      const date = doc.tanggal || doc.id;

      if (filterState.mode === "range") {
        return date >= filterState.from && date <= filterState.to;
      }

      if (filterState.mode === "single") {
        return date === filterDate;
      }

      if (filterState.mode === "month") {
        return date.startsWith(selectedDate.slice(0, 7));
      }

      if (filterState.mode === "jenis") {
        // filter berdasarkan jenis yang dipilih
        // jika tidak ada jenis dipilih, tampilkan semua
        if (!filterState.jenis) return true;
        const produksi = doc.pengeluaranProduksi || {};
        if (filterState.jenis === "Fix")      return Object.keys(produksi.fixCost      || {}).length > 0;
        if (filterState.jenis === "Variable") return Object.keys(produksi.variableCost || {}).length > 0;
        if (filterState.jenis === "Marginal") return Object.keys(produksi.marginalCost || {}).length > 0;
        return false;
      }

      if (filterState.mode === "akun") {
        if (!filterState.keyword) return true;
        const keyword = filterState.keyword.toLowerCase();
        const produksi = doc.pengeluaranProduksi || {};
        const semuaNama = [
          ...Object.keys(produksi.fixCost      || {}),
          ...Object.keys(produksi.variableCost || {}),
          ...Object.keys(produksi.marginalCost || {})
        ];
        return semuaNama.some(n => n.toLowerCase().includes(keyword));
      }

      return true;
    });
    const rows = [];
    const produksiSummary = {
      variable: 0,
      fix: 0,
      marginal: 0
    };

    filteredDocs.forEach(doc => {
      const tanggal = doc.tanggal || doc.id;
      const produksi = doc.pengeluaranProduksi || {};
      
      const fix = produksi.fixCost || {};
      Object.entries(fix).forEach(([nama, total]) => {
        const nominal = Number(total || 0);
        produksiSummary.fix += nominal;
        rows.push({
          tanggal,
          pengeluaran: nama,
          qty: 1,
          jenis: "Fix",
          harga: nominal,
          total: nominal
        });
      });

      const variable = produksi.variableCost || {};
      Object.entries(variable).forEach(([nama, item]) => {
        const totalVariable = Number(item.total || 0);
        produksiSummary.variable += totalVariable;
        rows.push({
          tanggal,
          pengeluaran: nama,
          qty: item.qty || 1,
          jenis: "Variable",
          harga: item.harga || 0,
          total: totalVariable
        });
      });

      const marginal = produksi.marginalCost || {};
      Object.entries(marginal).forEach(([nama, item]) => {
        const totalMarginal = Number(item.total || 0);
        produksiSummary.marginal += totalMarginal;
        rows.push({
          tanggal,
          pengeluaran: nama,
          qty: item.qty || 1,
          jenis: "Marginal",
          harga: item.harga || 0,
          total: totalMarginal
        });
      });
      
      const kasbon = produksi.kasbon || {};
      Object.values(kasbon).forEach(item => {
              const nominal =
          Number(item.nominal || 0);
        rows.push({
          tanggal,
          pengeluaran:
            `Kasbon ${item.nama || "-"}`,
          qty: 1,
          jenis: "Kasbon",
          harga: nominal,
          total: nominal
        });
      });
    });
    // filter rows berdasarkan jenis
    if (filterState.mode === "jenis" && filterState.jenis) {
      rows.splice(0, rows.length, ...rows.filter(r => r.jenis === filterState.jenis));
    }

    // filter rows berdasarkan keyword akun
    if (filterState.mode === "akun" && filterState.keyword) {
      const keyword = filterState.keyword.toLowerCase();
      rows.splice(0, rows.length, ...rows.filter(r =>
        r.pengeluaran.toLowerCase().includes(keyword)
      ));
    }
    rows.sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    const summary = rows.reduce(
        (acc, row) => {
          acc.qty += Number(row.qty || 0);
          acc.harga += Number(row.harga || 0);
          acc.total += Number(row.total || 0);
          return acc;
        },
        {
          qty: 0,
          harga: 0,
          total: 0
        }
      );
    
    const footer = document.getElementById("rincianTableFooter");
    
    tbody.innerHTML =
      rows.map(row => `
        <tr>
          <td>${formatTanggal(row.tanggal)}</td>
          <td>${row.pengeluaran}</td>
          <td>${row.jenis}</td>
          <td>${row.qty}</td>
          <td>${formatRupiah(row.harga)}</td>
          <td>${formatRupiah(row.total)}</td>
        </tr>
      `).join("");
    const totalProduksi =
      produksiSummary.variable +
      produksiSummary.fix +
      produksiSummary.marginal;
    document.getElementById("summaryTotalProduksi").textContent = formatRupiah(totalProduksi);
    document.getElementById("summaryVariable").textContent = formatRupiah(produksiSummary.variable);
    document.getElementById("summaryFix").textContent = formatRupiah(produksiSummary.fix);
    document.getElementById("summaryMarginal").textContent = formatRupiah(produksiSummary.marginal);    
    footer.innerHTML = `
      <tr class="table-footer-total">
    
        <td colspan="3">
          Total Bulan Ini
        </td>
    
        <td>
          ${summary.qty}
        </td>
    
        <td>
          ${formatRupiah(summary.harga)}
        </td>
    
        <td>
          ${formatRupiah(summary.total)}
        </td>
    
      </tr>
    `;
    console.log(
      "✅ Table rendered:",
      rows.length,
      "rows"
    );
  } catch (err) {
    console.error(
      "❌ renderRincianTable error:",
      err
    );
  }
}

// =====================
// RENDER DISTRIBUSI TABLE
// =====================
async function renderDistribusiTable(filterDate) {
  try {
    const tbody = document.getElementById("rincianDistribusiTableBody");
    const footer = document.getElementById("rincianDistribusiTableFooter");
    if (!tbody) return;
    tbody.innerHTML = "";

    const dbConn = await openProduksiDB();
    if (!dbConn.objectStoreNames.contains(STORE_PENGELUARAN)) {
      console.warn("Store pengeluaranProduksi tidak ada");
      return;
    }
    const tx    = dbConn.transaction(STORE_PENGELUARAN, "readonly");
    const store = tx.objectStore(STORE_PENGELUARAN);
    const docs = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });

    window.__allDistribusiData = docs;

    const filteredDocs = docs.filter(doc => {
      const date = doc.tanggal || doc.id;
      if (filterStateDistribusi.mode === "range")  return date >= filterStateDistribusi.from && date <= filterStateDistribusi.to;
      if (filterStateDistribusi.mode === "single") return date === filterDate;
      if (filterStateDistribusi.mode === "month")  return date.startsWith(selectedDate.slice(0, 7));
      if (filterStateDistribusi.mode === "jenis") {
        if (!filterStateDistribusi.jenis) return true;
        const dist = doc.pengeluaranDistribusi || {};
        if (filterStateDistribusi.jenis === "Customer Baru Hunter") return !!dist.customerBaruHunter?.upahHunter;
        if (filterStateDistribusi.jenis === "Perbaikan Peralatan")  return (dist.perbaikanPeralatan || []).some(i => i.harga > 0);
        if (filterStateDistribusi.jenis === "Lainnya")              return (dist.lainnya || []).some(i => i.harga > 0);
        return false;
      }
      if (filterStateDistribusi.mode === "akun") {
        if (!filterStateDistribusi.keyword) return true;
        const kw   = filterStateDistribusi.keyword.toLowerCase();
        const dist = doc.pengeluaranDistribusi || {};
        const names = [
          String(dist.customerBaruHunter?.customer || ""),
          ...(dist.perbaikanPeralatan || []).map(i => String(i.nama || "")),
          ...(dist.lainnya || []).map(i => String(i.nama || ""))
        ];
        return names.some(n => n.toLowerCase().includes(kw));
      }
      return true;
    });

    const rows = [];
    let totalDistribusi = 0;

    filteredDocs.forEach(doc => {
      const tanggal   = doc.tanggal || doc.id;
      const distribusi = doc.pengeluaranDistribusi || {};

      // ── customerBaruHunter ──────────────────
      const hunter = distribusi.customerBaruHunter;
      if (hunter) {
        const harga = Number(hunter.upahHunter || 0);
        if (harga > 0) {
          totalDistribusi += harga;
          rows.push({
            tanggal,
            pengeluaran: String(hunter.customer || "Hunter"),
            jenis: "Customer Baru Hunter",
            harga
          });
        }
      }

      // ── perbaikanPeralatan (array) ──────────
      const perbaikan = distribusi.perbaikanPeralatan || [];
      perbaikan.forEach(item => {
        const harga = Number(item.harga || 0);
        if (harga > 0) {
          totalDistribusi += harga;
          rows.push({
            tanggal,
            pengeluaran: String(item.nama || "-"),
            jenis: "Perbaikan Peralatan",
            harga
          });
        }
      });

      // ── lainnya (array) ─────────────────────
      const lainnya = distribusi.lainnya || [];
      lainnya.forEach(item => {
        const harga = Number(item.harga || 0);
        if (harga > 0) {
          totalDistribusi += harga;
          rows.push({
            tanggal,
            pengeluaran: String(item.nama || "-"),
            jenis: "Lainnya",
            harga
          });
        }
      });
    });
    
    if (filterStateDistribusi.mode === "jenis" && filterStateDistribusi.jenis) {
      rows.splice(0, rows.length, ...rows.filter(r => r.jenis === filterStateDistribusi.jenis));
    }
    if (filterStateDistribusi.mode === "akun" && filterStateDistribusi.keyword) {
      const kw = filterStateDistribusi.keyword.toLowerCase().trim();
      rows.splice(0, rows.length, ...rows.filter(r =>
        (r.pengeluaran || "").toLowerCase().includes(kw)
      ));
      console.log("🔎 Filter akun distribusi:", kw, "→", rows.length, "rows");
    }

    rows.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

    tbody.innerHTML = rows.map(row => `
      <tr>
        <td>${formatTanggal(row.tanggal)}</td>
        <td>${row.pengeluaran}</td>
        <td>${row.jenis}</td>
        <td>${formatRupiah(row.harga)}</td>
      </tr>
    `).join("");

    footer.innerHTML = `
      <tr class="table-footer-total">
        <td colspan="3">Total</td>
        <td>${formatRupiah(totalDistribusi)}</td>
      </tr>
    `;

    // update summary distribusi
    const elTotal = document.getElementById("summaryTotalDistribusi");
    if (elTotal) elTotal.textContent = formatRupiah(totalDistribusi);

    console.log("✅ Distribusi table rendered:", rows.length, "rows");

  } catch (err) {
    console.error("❌ renderDistribusiTable error:", err);
  }
}
// =====================
// FILTER DISTRIBUSI EVENTS
// =====================
document.getElementById("btnFilterRangeDistribusi").addEventListener("click", () => {
  filterRangeDistribusiOverlay.classList.remove("hidden");
  fromInputDistribusi.value = filterStateDistribusi.from || "";
  toInputDistribusi.value   = filterStateDistribusi.to   || "";
});

document.getElementById("btnApplyRangeDistribusi").addEventListener("click", async () => {
  const from = fromInputDistribusi.value;
  const to   = toInputDistribusi.value;
  if (!from || !to) return;
  filterStateDistribusi.mode = "range";
  filterStateDistribusi.from = from;
  filterStateDistribusi.to   = to;
  localStorage.setItem("filterStateDistribusi", JSON.stringify(filterStateDistribusi));
  filterRangeDistribusiOverlay.classList.add("hidden");
  await renderDistribusiTable(selectedDate);
  updateFilterIndicators();
});

document.getElementById("btnResetRangeDistribusi").addEventListener("click", async () => {
  filterStateDistribusi = {
    mode: "month",
    from: null,
    to: null,
    jenis: null,
    keyword: null
  };
  localStorage.setItem("filterStateDistribusi", JSON.stringify(filterStateDistribusi));
  filterRangeDistribusiOverlay.classList.add("hidden");
  await renderDistribusiTable(selectedDate);
});

document.getElementById("btnFilterJenisDistribusi").addEventListener("click", () => {
  filterJenisDistribusiOverlay.classList.remove("hidden");
  filterJenisDistribusiSelect.value = filterStateDistribusi.jenis || "";
});

document.getElementById("btnApplyJenisDistribusi").addEventListener("click", async () => {
  const val = filterJenisDistribusiSelect.value;
  if (!val) {
    filterStateDistribusi.mode  = "month";
    filterStateDistribusi.jenis = null;
    filterStateDistribusi.from  = null;
    filterStateDistribusi.to    = null;
  } else {
    filterStateDistribusi.mode  = "jenis";
    filterStateDistribusi.jenis = val;
  }
  localStorage.setItem("filterStateDistribusi", JSON.stringify(filterStateDistribusi));
  filterJenisDistribusiOverlay.classList.add("hidden");
  await renderDistribusiTable(selectedDate);
  updateFilterIndicators();
});

document.getElementById("btnCariAkunDistribusi").addEventListener("click", async () => {
  filterAkunDistribusiOverlay.classList.remove("hidden");
  searchAkunDistribusiInput.value = filterStateDistribusi.keyword || "";
  await renderSuggestDistribusi("");
});

searchAkunDistribusiInput.addEventListener("input", async (e) => {
  await renderSuggestDistribusi(e.target.value);
});

async function renderSuggestDistribusi(keyword) {
  // kalau belum ada cache, load dulu dari IndexedDB
  if (!window.__allDistribusiData || window.__allDistribusiData.length === 0) {
    try {
      const dbConn = await openProduksiDB();
      if (dbConn.objectStoreNames.contains(STORE_PENGELUARAN)) {
        const tx    = dbConn.transaction(STORE_PENGELUARAN, "readonly");
        const store = tx.objectStore(STORE_PENGELUARAN);
        window.__allDistribusiData = await new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror   = () => reject(req.error);
        });
      }
    } catch (err) {
      console.error("❌ renderSuggestDistribusi load error:", err);
    }
  }

  const allData = window.__allDistribusiData || [];
  const list = new Set();

  allData.forEach(d => {
    const dist = d.pengeluaranDistribusi || {};
    if (dist.customerBaruHunter?.customer) {
      list.add(String(dist.customerBaruHunter.customer));
    }
    (dist.perbaikanPeralatan || []).forEach(i => { if (i.nama) list.add(i.nama); });
    (dist.lainnya || []).forEach(i => { if (i.nama) list.add(i.nama); });
  });

  const filtered = [...list].filter(n =>
    n.toLowerCase().includes(keyword.toLowerCase())
  );

  suggestListDistribusi.innerHTML = filtered.length
    ? filtered.map(n => `
        <div class="suggest-item" onclick="selectAkunDistribusi('${n}')">
          ${n}
        </div>
      `).join("")
    : `<div style="padding:8px;color:#9b7a53;font-size:12px;">Tidak ada hasil</div>`;
}

window.selectAkunDistribusi = (nama) => {
  searchAkunDistribusiInput.value = nama;
  renderSuggestDistribusi(nama);
};

document.getElementById("btnApplyAkunDistribusi").addEventListener("click", async () => {
  const keyword = searchAkunDistribusiInput.value.trim();

  if (!keyword) {
    filterStateDistribusi.mode    = "month";
    filterStateDistribusi.keyword = null;
  } else {
    filterStateDistribusi.mode    = "akun";
    filterStateDistribusi.keyword = keyword;
  }

  localStorage.setItem("filterStateDistribusi", JSON.stringify(filterStateDistribusi));
  filterAkunDistribusiOverlay.classList.add("hidden");
  await renderDistribusiTable(selectedDate);
});

function formatRupiah(n) {
  if (n === "-" || n == null)
    return "-";
  return "Rp" +
    Number(n || 0)
      .toLocaleString("id-ID");
}
function formatTanggal(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "short"
    }
  );
}
