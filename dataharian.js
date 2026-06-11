import { db, auth } from "./index.js";
import {
  collection, collectionGroup, query, where,
  getDocs, doc, getDoc, setDoc, updateDoc,
  serverTimestamp, deleteField,
  Timestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const toggleCostBtn = document.getElementById("toggleCostBtn");
const fixSection = document.getElementById("fixCostSection");
const marginalSection = document.getElementById("marginalCostSection");
const kasbonCostBtn = document.getElementById("kasbonCostBtn");
const btnSimpanPengeluaran = document.getElementById("btnSimpanPengeluaran");
const toggleLainnyaBtn = document.getElementById("toggleLainnya");
const lainnyaWrap = document.getElementById("lainnyaWrap");
const listWrap = document.getElementById("lainnyaList");
const fixWrap = document.getElementById("fixCostWrap");

// ── Cache ──────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000;
const cacheDataHarian = {};
const CACHE_KANTOR_TTL = 5 * 60 * 1000;
const cacheLaporanAdmin = {};

const DB_VERSION = 2;
const DB_NAME = "appAdminCabangDB";
const STORE_DATA_HARIAN = "dataHarian";
const STORE_PENGELUARAN = "pengeluaranProduksi";
const STORE_LAPORAN = "laporanAdmin";

const DB_VERSION_PENGELUARAN = 3;
const DB_NAME_USERS = "laporanDistribusiDB";
const STORE_USERS = "users";

const STORAGE_FILTER_KEY = "laporanFilter";
const bulanNama = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

let cacheVarian = null;
const cacheKurirMap = {};
let cacheUpdatedAt = null;
let cacheKantorCabang = null;
let cacheKantorCabangUpdatedAt = null;
let costHidden = true;
let selectedMonth = new Date().getMonth();
let selectedYear = new Date().getFullYear();
let laporanFilter = localStorage.getItem(STORAGE_FILTER_KEY) || "all";
let dbIndexed = null;

// ── Auth Ready ─────────────────────────────────────────
// Tampilkan skeleton saat halaman load
(function showKurirSkeleton() {
  const listEl = document.getElementById("listKurir");
  if (!listEl) return;
  listEl.innerHTML = Array.from({ length: 4 }).map(() => `
    <div class="kurir-skeleton">
      <div class="ks-avatar sk-pulse"></div>
      <div class="ks-info">
        <div class="ks-name sk-pulse"></div>
        <div class="ks-role sk-pulse"></div>
      </div>
      <div class="ks-actions">
        <div class="ks-btn sk-pulse"></div>
        <div class="ks-btn sk-pulse"></div>
        <div class="ks-btn sk-pulse"></div>
      </div>
    </div>
  `).join('');
})();

onAuthStateChanged(auth, async user => {
  if (!user) {
    const listEl = document.getElementById("listKurir");
    if (listEl) listEl.innerHTML = `<div class="loading-card">Belum login</div>`;
    return;
  }
  console.log("🔐 USER LOGIN:", user.uid);
  const adminSnap = await getDoc(doc(db, "users", user.uid));
  if (!adminSnap.exists()) {
    console.log("⚠️ admin tidak ditemukan");
    return;
  }
  const adminData = adminSnap.data();
  const idCabang = adminData.idCabang;
  console.log("🏢 ID CABANG:", idCabang);
  // ── INI LOAD KANTOR CABANG ──
  const kantorCabang = await loadKantorCabang(idCabang);
  console.log("📦 KANTOR CABANG READY IN RAM:", kantorCabang);
  renderPengeluaranVariable(kantorCabang);
  renderFixCost(kantorCabang);
  renderMarginalCost();
  await loadPengeluaranProduksiDraft();
  updatePeriodTitle();
  restoreFilterUI();
  renderLaporanHarian();
  loadKurir();
});

async function loadKantorCabang(idCabang, forceReload = false) {
  const now = Date.now();
  // ── RAM HIT ──
  if (
    !forceReload &&
    cacheKantorCabang &&
    cacheKantorCabangUpdatedAt &&
    (now - cacheKantorCabangUpdatedAt < CACHE_KANTOR_TTL)
  ) {
    console.log("⚡ KANTOR CABANG RAM HIT:", idCabang);
    return cacheKantorCabang;
  }
  try {
    console.log("🔄 FETCH KANTOR CABANG FIRESTORE:", idCabang);
    const snap = await getDoc(doc(db, "kantorCabang", idCabang));
    if (!snap.exists()) {
      console.log("⚠️ KANTOR CABANG TIDAK ADA:", idCabang);
      return null;
    }
    const data = snap.data();
    cacheKantorCabang = data;
    cacheKantorCabangUpdatedAt = now;
    console.log("✅ KANTOR CABANG LOADED:", data);
    return data;
  } catch (err) {
    console.error("❌ gagal load kantorCabang:", err);
    return null;
  }
}
async function updateRincianPengeluaranSync(uid) {
  try {
    const ref = doc(db, "users", uid);

    await setDoc(ref, {
      rincianPengeluaranSync: {
        version: increment(1),
        updatedAt: serverTimestamp()
      }
    }, { merge: true });

    // ambil version terbaru dari Firestore setelah update
    const snap = await getDoc(ref);
    const data = snap.data();

    const syncData = {
      version: data?.rincianPengeluaranSync?.version || 0,
      updatedAt: Date.now()
    };

    await updateUserSyncToIDB(uid, syncData);

    console.log("🔄 sync Firestore + IndexedDB USERS updated");

  } catch (err) {
    console.error("❌ updateRincianPengeluaranSync error:", err);
  }
}

function openLocalDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION_PENGELUARAN);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PENGELUARAN)) {
        db.createObjectStore(STORE_PENGELUARAN, { keyPath: "tanggal" });
        console.log("✅ Store pengeluaranProduksi dibuat");
      }
      if (!db.objectStoreNames.contains(STORE_LAPORAN)) {
        db.createObjectStore(STORE_LAPORAN, { keyPath: "id" })
          .createIndex("tanggal", "tanggal", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DATA_HARIAN)) {
        db.createObjectStore(STORE_DATA_HARIAN, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}
function openLocalDBUsers() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME_USERS);

    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   = !existingDB.objectStoreNames.contains(STORE_USERS) ||
                             !existingDB.objectStoreNames.contains("laporanAdmin");

      existingDB.close();

      const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;
      const req = indexedDB.open(DB_NAME_USERS, targetVersion);

      req.onupgradeneeded = (ev) => {
        const dbUp = ev.target.result;

        if (!dbUp.objectStoreNames.contains(STORE_USERS)) {
          dbUp.createObjectStore(STORE_USERS, { keyPath: "uid" });
          console.log("✅ STORE USERS dibuat");
        }

        if (!dbUp.objectStoreNames.contains("laporanAdmin")) {
          dbUp.createObjectStore("laporanAdmin", { keyPath: "tanggal" });
          console.log("✅ STORE laporanAdmin dibuat");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };

    checkReq.onerror = () => reject(checkReq.error);
  });
}
async function updateUserSyncToIDB(uid, syncData) {
  try {
    const db = await openLocalDBUsers();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_USERS, "readwrite");
      const store = tx.objectStore(STORE_USERS);

      const getReq = store.get(uid);

      getReq.onsuccess = () => {
        const user = getReq.result || { uid };

        user.rincianPengeluaranSync = {
          version: syncData.version || 0,
          updatedAt: syncData.updatedAt || Date.now()
        };

        store.put(user);
      };

      getReq.onerror = () => reject(getReq.error);

      tx.oncomplete = () => {
        console.log("💾 IndexedDB USERS sync updated:", uid);
        resolve();
      };

      tx.onerror = () => reject(tx.error);
    });

  } catch (err) {
    console.error("❌ updateUserSyncToIDB error:", err);
  }
}
async function savePengeluaranIndexedDB(data) {
  try {
    const db = await openLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        STORE_PENGELUARAN,
        "readwrite"
      );

      tx.objectStore(STORE_PENGELUARAN).put(data);
      tx.oncomplete = () => {
        console.log("💾 IndexedDB saved:", data.tanggal);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("❌ save indexeddb:", err);
  }
}
async function getPengeluaranIndexedDB(tanggal) {
  try {
    const db = await openLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENGELUARAN, "readonly");
      const req = tx.objectStore(STORE_PENGELUARAN).get(tanggal);
      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error(err);
    return null;
  }
}
async function getKasbonByTanggalUser(tanggal, uid) {
  try {
    // Pakai loadKasbonDraft supaya ada fallback Firestore
    const kasbon = await loadKasbonDraft(tanggal);

    const found = Object.entries(kasbon)
      .find(([id, item]) =>
        item.uid === uid &&
        item.tanggal === tanggal
      );

    if (!found) return null;

    return {
      id: found[0],
      data: found[1]
    };

  } catch (err) {
    console.error("❌ getKasbonByTanggalUser:", err);
    return null;
  }
}
function renderPengeluaranVariable(kantorCabang) {
  const container = document.getElementById("variableExpenseWrap");
  if (!container) return;
  const list = kantorCabang?.pengeluaran?.variable || [];

  // Hapus hanya variable rows lama, jangan replace innerHTML
  container.querySelectorAll(".variable-row").forEach(el => el.remove());

  const fragment = document.createDocumentFragment();
  list.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "expense-row variable-row";
    div.dataset.index = index;
    div.dataset.harga = item.harga;
    div.innerHTML = `
      <div class="expense-label">${item.jenis}</div>
      <input type="number" min="0" placeholder="0" class="qty-input variable-qty">
      <input type="text" readonly placeholder="0" class="harga-input variable-total">
    `;
    fragment.appendChild(div);
  });

  // Insert sebelum elemen pertama yang ada di container
  container.insertBefore(fragment, container.firstChild);
  console.log("✅ Variable pengeluaran dirender:", list);
}
// Hitung otomatis variable cost
document.addEventListener("input", e => {
  if (!e.target.classList.contains("variable-qty")) return;
  const row = e.target.closest(".variable-row");
  if (!row) return;
  const harga = Number(row.dataset.harga || 0);
  const qty   = Number(e.target.value || 0);
  const totalEl = row.querySelector(".variable-total");
  if (totalEl) totalEl.value = (qty * harga).toLocaleString("id-ID");
});
toggleLainnyaBtn?.addEventListener("click", () => {
  lainnyaWrap.classList.add("show");
  addLainnyaRow();
});
function addLainnyaRow() {
  const row = document.createElement("div");
  row.className = "lainnya-row";
  row.innerHTML = `
    <input type="text" placeholder="Jenis" class="lainnya-jenis">
    <input type="number" placeholder="Qty" class="lainnya-qty">
    <input type="number" placeholder="Harga" class="lainnya-harga">
    <button type="button" class="btn-remove">X</button>
  `;
  row.querySelector(".btn-remove").addEventListener("click", () => {
    row.remove();
  });
  listWrap.appendChild(row);
}

/* FIX COST RENDER (DARI RAM KANTOR CABANG) */
function renderFixCost(kantorCabang) {
  const list = kantorCabang?.pengeluaran?.fix || [];
  const html = list.map((item) => `
    <div class="fix-row">
      <div class="fix-label">${item}</div>
      <input type="text" placeholder="0" class="fix-input">
    </div>
  `).join("");
  fixWrap.innerHTML = html;
}
document.addEventListener("input", (e) => {
  if (!e.target.classList.contains("fix-input")) return;
  let value = e.target.value;
  value = formatRibuan(value);
  e.target.value = value;
});

function renderMarginalCost() {
  const container = document.getElementById("marginalCostWrap");
  if (!container) return;

  container.innerHTML = `
    <div id="marginalList"></div>

    <button type="button" id="btnTambahMarginal" class="btn-lainnya">
      + Tambah Alat Baru
    </button>
  `;

  document.getElementById("btnTambahMarginal")
    .addEventListener("click", addMarginalRow);

  addMarginalRow(); // default 1 row
}
function addMarginalRow() {
  const list = document.getElementById("marginalList");

  const row = document.createElement("div");
  row.className = "lainnya-row"; // pakai style yang sama

  row.innerHTML = `
    <input type="text" placeholder="Alat baru" class="marginal-nama">
    <input type="number" placeholder="Qty" class="marginal-qty">
    <input type="number" placeholder="Harga" class="marginal-harga">
    <button type="button" class="btn-remove">X</button>
  `;

  row.querySelector(".btn-remove").addEventListener("click", () => {
    row.remove();
  });

  list.appendChild(row);
}
function getMarginalCostData() {
  const result = [];
  document.querySelectorAll("#marginalList .lainnya-row").forEach(row => {
    const nama = row.querySelector(".marginal-nama")?.value || "";
    const qty = Number(row.querySelector(".marginal-qty")?.value || 0);
    const harga = Number(row.querySelector(".marginal-harga")?.value || 0);

    if (nama || qty || harga) {
      result.push({
        nama,
        qty,
        harga,
        total: qty * harga
      });
    }
  });

  return result;
}
async function savePengeluaranProduksi(e) {
  const btn = e?.target || btnSimpanPengeluaran;
  if (!btn) return;
  const originalText = "Simpan";
  try {
    // ── BUTTON LOADING ─────────────────────
    btn.disabled = true;
    btn.innerHTML = "Menyimpan...";
    const user = auth.currentUser;
    if (!user) throw new Error("Belum login");
    const today = getTanggalLocal();
    const adminSnap = await getDoc(doc(db, "users", user.uid));
    if (!adminSnap.exists()) {
      throw new Error("Admin tidak ditemukan");
    }

    const adminData = adminSnap.data();
    const idCabang = adminData.idCabang || "";
    const variableCost = {};
    document.querySelectorAll(".variable-row").forEach(row => {
      const label = row.querySelector(".expense-label")?.innerText?.trim() || "";
      const qty = Number(row.querySelector(".variable-qty")?.value || 0);
      const harga = Number(row.dataset.harga || 0);
      const total = qty * harga;

      if (qty > 0) {
        variableCost[label] = {
          qty,
          harga,
          total
        };
      }
    });
    document.querySelectorAll("#lainnyaList .lainnya-row")
      .forEach(row => {
        const jenis =
          row.querySelector(".lainnya-jenis")?.value?.trim() || "";
        const qty = Number(row.querySelector(".lainnya-qty")?.value || 0);

        const harga = Number(row.querySelector(".lainnya-harga")?.value || 0);
        if (jenis || qty || harga) {
          variableCost[jenis || "lainnya"] = {
            qty,
            harga,
            total: qty * harga
          };
        }
      });
    const fixCost = {};
    document.querySelectorAll(".fix-row")
      .forEach(row => {
        const label =
          row.querySelector(".fix-label")
            ?.innerText?.trim() || "";
        const nominal = parseRibuan(row.querySelector(".fix-input")?.value || 0);
        if (nominal > 0) {
          fixCost[label] = nominal;
        }
      });
    const marginalCost = {};
    getMarginalCostData().forEach(item => {
      if (!item.nama) return;
      marginalCost[item.nama] = {
        qty: item.qty,
        harga: item.harga,
        total: item.total
      };
    });
    const laporanRef = doc(db, "users", user.uid, "laporanAdmin", today);
    await setDoc(laporanRef, {
      createdBy: user.uid,
      idCabang,
      tanggal: today,
      updatedAt: serverTimestamp(),
      pengeluaranProduksi: {
        variableCost,
        fixCost,
        marginalCost
      }
    }, { merge: true });
    await updateRincianPengeluaranSync(user.uid);
    await savePengeluaranIndexedDB({
      tanggal: today,
      pengeluaranProduksi: {
        variableCost,
        fixCost,
        marginalCost
      },
      updatedAt: Date.now()
    });
    console.log("✅ pengeluaranProduksi tersimpan");
    btn.innerHTML = "✔ Tersimpan";
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error("❌ savePengeluaranProduksi:", err);
    btn.innerHTML = "❌ Gagal";
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 2000);
  }
}
async function loadPengeluaranProduksiDraft() {
  try {
    const today = getTanggalLocal();
    let data = null;
    
    // 1. Coba IndexedDB dulu
    const localData = await getPengeluaranIndexedDB(today);
    if (localData?.pengeluaranProduksi) {
      console.log("💾 draft dari IndexedDB:", localData);
      data = localData.pengeluaranProduksi;
    } else {
      // 2. Fallback ke Firestore
      console.log("📭 IndexedDB kosong, load dari Firestore...");
      try {
        const user = auth.currentUser;
        if (!user) return;
        const snap = await getDoc(doc(db, "users", user.uid, "laporanAdmin", today));
        if (snap.exists() && snap.data()?.pengeluaranProduksi) {
          data = snap.data().pengeluaranProduksi;
          console.log("☁️ draft dari Firestore:", data);
          // Simpan ke IndexedDB supaya next load tidak perlu ke Firestore
          await savePengeluaranIndexedDB({
            tanggal: today,
            pengeluaranProduksi: data,
            updatedAt: Date.now()
          });
        } else {
          console.log("📭 Firestore juga kosong");
          return;
        }
      } catch (err) {
        console.error("❌ Gagal load Firestore:", err);
        return;
      }
    }
    
    console.log("📦 draft ditemukan:", data);
    document.querySelectorAll(".variable-row").forEach(row => {
      const label = row.querySelector(".expense-label")?.innerText?.trim();
      const item = data.variableCost?.[label];
      if (!item) return;
      const qtyInput = row.querySelector(".variable-qty");
      const totalInput = row.querySelector(".variable-total");
      qtyInput.value = item.qty || 0;
      totalInput.value = formatRibuan(item.total || 0);
    });
    document.querySelectorAll(".fix-row").forEach(row => {
      const label = row.querySelector(".fix-label")?.innerText?.trim();
      const nominal = data.fixCost?.[label];
      if (!nominal) return;
      row.querySelector(".fix-input")
        .value = formatRibuan(nominal);
    });
    const marginalList = document.getElementById("marginalList");
    if (marginalList && data.marginalCost) {
      marginalList.innerHTML = "";
      Object.entries(
        data.marginalCost
      ).forEach(([nama, item]) => {
        addMarginalRow();
        const row = marginalList.lastElementChild;
        row.querySelector(".marginal-nama").value = nama;
        row.querySelector(".marginal-qty").value = item.qty || 0;
        row.querySelector(".marginal-harga").value = item.harga || 0;
      });
    }
    const defaultVariable = Array.from(document.querySelectorAll(".expense-label")).map(el => el.innerText.trim());
    Object.entries(data.variableCost || {}).forEach(([jenis, item]) => {
      if (defaultVariable.includes(jenis)) return;
      addLainnyaRow();
      const row = listWrap.lastElementChild;
      row.querySelector(".lainnya-jenis").value = jenis;
      row.querySelector(".lainnya-qty").value = item.qty || 0;
      row.querySelector(".lainnya-harga").value = item.harga || 0;
      lainnyaWrap ?.classList.add("show");
    });
    console.log("Draft pengeluaran loaded");
  } catch (err) {
    console.error("❌ load draft:", err);
  }
}
// ICON SVG
const eyeOn = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
  <path fill-rule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clip-rule="evenodd" />
</svg>
`;
const eyeOff = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM22.676 12.553a11.249 11.249 0 0 1-2.631 4.31l-3.099-3.099a5.25 5.25 0 0 0-6.71-6.71L7.759 4.577a11.217 11.217 0 0 1 4.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113Z" />
  <path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0 1 15.75 12ZM12.53 15.713l-4.243-4.244a3.75 3.75 0 0 0 4.244 4.243Z" />
  <path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 0 0-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 0 1 6.75 12Z" />
</svg>

`;
const kasbonIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M4.5 3.75a3 3 0 0 0-3 3v.75h21v-.75a3 3 0 0 0-3-3h-15Z" />
  <path fill-rule="evenodd" d="M22.5 9.75h-21v7.5a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3v-7.5Zm-18 3.75a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clip-rule="evenodd" />
</svg>
`;
if (kasbonCostBtn) {
  kasbonCostBtn.innerHTML = kasbonIcon;
}
fixSection?.classList.add("hidden-section");
marginalSection?.classList.add("hidden-section");
if (toggleCostBtn) {
  toggleCostBtn.innerHTML = eyeOff;
}
costHidden = true;
fixSection?.classList.add("hidden");
marginalSection?.classList.add("hidden");
if (toggleCostBtn) {
  toggleCostBtn.innerHTML = eyeOff;
}
toggleCostBtn?.addEventListener("click", () => {
  costHidden = !costHidden;
  if (costHidden) {
    fixSection?.classList.add("hidden");
    marginalSection?.classList.add("hidden");
    toggleCostBtn.innerHTML = eyeOff;
  } else {
    fixSection?.classList.remove("hidden");
    marginalSection?.classList.remove("hidden");
    toggleCostBtn.innerHTML = eyeOn;
  }
});
btnSimpanPengeluaran?.addEventListener(
  "click",
  savePengeluaranProduksi
);
kasbonCostBtn?.addEventListener("click", async () => {
  const today = getTanggalLocal();
  const users = await loadKasbonUsers();

  openPopup("Kasbon Produksi", `
    <div class="kasbon-form">
      <label>Tanggal</label>
      <input type="date" class="kasbon-tanggal" value="${today}">

      <label>Nama</label>
      <div class="kasbon-dropdown">
        <div class="kasbon-dropdown-selected" tabindex="0">
          -- Pilih Nama --
        </div>
        <div class="kasbon-dropdown-list"></div>
        <input type="hidden" class="kasbon-nama">
      </div>

      <label>Nominal</label>
      <input type="text" class="kasbon-nominal" placeholder="Rp 0" inputmode="numeric">

      <label>Keterangan</label>
      <textarea class="kasbon-keterangan" rows="4"></textarea>

      <button class="kasbon-save-btn">
        Simpan Kasbon
      </button>

    </div>
  `);

  setTimeout(() => {
    initKasbonDropdown(users);
    const input = document.querySelector(".kasbon-nominal");
    const tanggalInput = document.querySelector(
        ".kasbon-tanggal"
      );
    tanggalInput?.addEventListener("change", async () => {
        const form = document.querySelector(".kasbon-form");
        const uid = form?.querySelector(".kasbon-nama")?.value;
        if (!uid) return;
        const tanggal = tanggalInput.value;
        const kasbon = await getKasbonByTanggalUser(tanggal, uid);
        const nominalInput = form.querySelector(".kasbon-nominal");
        const ketInput = form.querySelector(".kasbon-keterangan");
        const saveBtn = form.querySelector(".kasbon-save-btn");
        if (kasbon) {
          nominalInput.value = formatRibuan(kasbon.data.nominal || 0);
          ketInput.value = kasbon.data.keterangan || "";
          form.dataset.kasbonId = kasbon.id;
          saveBtn.innerText = "Update Kasbon";
        } else {
          nominalInput.value = "";
          ketInput.value = "";
          delete form.dataset.kasbonId;
          saveBtn.innerText = "Simpan Kasbon";
        }
      });
    input?.addEventListener("input", (e) => {
      e.target.value = formatRibuan(e.target.value);
    });
    document.querySelector(".kasbon-save-btn")
      ?.addEventListener("click", (e) => saveKasbonCost(e));
  }, 50);
});
function initKasbonDropdown(users) {
  const wrap = document.querySelector(".kasbon-dropdown");
  if (!wrap) return;
  const selected = wrap.querySelector(".kasbon-dropdown-selected");
  const list = wrap.querySelector(".kasbon-dropdown-list");
  const hidden = wrap.querySelector(".kasbon-nama");

  list.innerHTML = users.map(u => `
    <div class="kasbon-dropdown-item"
      data-uid="${u.uid}"
      data-nama="${escapeHtml(u.nama)}">

      <span>${escapeHtml(u.nama)}</span>
      <small style="opacity:.6">${u.role}</small>
    </div>
  `).join("");

  selected.onclick = () => {
    list.style.display = list.style.display === "block" ? "none" : "block";
  };

  list.querySelectorAll(".kasbon-dropdown-item").forEach(item => {
    item.onclick = async () => {
      selected.innerText = item.dataset.nama;
      hidden.value = item.dataset.uid;
      list.style.display = "none";
      const form = document.querySelector(".kasbon-form");
      if (!form) return;
      const tanggal = form.querySelector(".kasbon-tanggal").value;
      const uid = item.dataset.uid;
      const kasbon = await getKasbonByTanggalUser(tanggal, uid);
      const nominalInput = form.querySelector(".kasbon-nominal");
      const ketInput = form.querySelector(".kasbon-keterangan");
      const saveBtn = form.querySelector(".kasbon-save-btn");
      if (kasbon) {
        nominalInput.value = formatRibuan(kasbon.data.nominal || 0);
        ketInput.value = kasbon.data.keterangan || "";
        form.dataset.kasbonId = kasbon.id;
        saveBtn.innerText = "Update Kasbon";
        console.log("kasbon ditemukan", kasbon);
      } else {
        nominalInput.value = "";
        ketInput.value = "";
        delete form.dataset.kasbonId;
        saveBtn.innerText = "Simpan Kasbon";
        console.log("belum ada kasbon");
      }
    };
  });
  wrap._closeHandler = (e) => {
    if (!wrap.contains(e.target)) {
      list.style.display = "none";
    }
  };
  document.removeEventListener("click", wrap._closeHandler);
  document.addEventListener("click", wrap._closeHandler);
}
async function loadKasbonUsers() {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, "users"),
        where("createdBy", "==", user.uid),
        where("status", "==", true),
        where("role", "in", ["adminCabang", "produksi"])
      )
    );
    const result = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      result.push({
        uid: docSnap.id,
        nama: d.nama || "Tanpa Nama",
        role: d.role || "-"
      });
    });
    console.log("👥 Kasbon Users:", result);
    return result;
  } catch (err) {
    console.error("❌ loadKasbonUsers error:", err);
    return [];
  }
}
async function saveKasbonCost(e) {
  const btn = e?.target || document.querySelector(".kasbon-save-btn");
  const form = document.querySelector(".kasbon-form");
  if (!form || !btn) return;
  const originalText = "Simpan Kasbon";
  try {
    btn.disabled = true;
    btn.innerHTML = `
      <span class="kasbon-spinner"></span>
      Menyimpan...
    `;
    const user = auth.currentUser;
    if (!user) throw new Error("Belum login");

    const tanggal = form.querySelector(".kasbon-tanggal").value;
    const uid = form.querySelector(".kasbon-nama").value;
    const nominal = parseRibuan(form.querySelector(".kasbon-nominal").value || 0);
    const keterangan = form.querySelector(".kasbon-keterangan").value.trim();
    const nama = form.querySelector(".kasbon-dropdown-selected")?.innerText.trim() || "";

    if (!tanggal || !uid || nominal <= 0 || !nama) {
      btn.innerHTML = "Data belum lengkap";
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }, 1500);
      return;
    }

    // Ambil role dari users collection
    const userSnap = await getDoc(doc(db, "users", uid));
    const userData = userSnap.exists() ? userSnap.data() : {};

    const kasbonId = form.dataset.kasbonId || Date.now().toString();
    const kasbonData = {
      uid,
      nama,
      role: userData.role || "",
      tanggal,
      nominal,
      keterangan,
      createdAt: Date.now()
    };

    const adminSnap = await getDoc(doc(db, "users", user.uid));
    const adminData = adminSnap.data();
    const idCabang = adminData?.idCabang || "";

    const laporanRef = doc(db, "users", user.uid, "laporanAdmin", tanggal);
    await setDoc(laporanRef, {
      createdBy: user.uid,
      idCabang,
      tanggal,
      updatedAt: serverTimestamp(),
      pengeluaranProduksi: {
        kasbon: {
          [kasbonId]: kasbonData
        }
      }
    }, { merge: true });

    await updateRincianPengeluaranSync(user.uid);

    const oldLocal = await getPengeluaranIndexedDB(tanggal);
    const oldKasbon = oldLocal?.pengeluaranProduksi?.kasbon || {};
    await savePengeluaranIndexedDB({
      ...(oldLocal || {}),
      tanggal,
      pengeluaranProduksi: {
        ...(oldLocal?.pengeluaranProduksi || {}),
        kasbon: {
          ...oldKasbon,
          [kasbonId]: kasbonData
        }
      },
      updatedAt: Date.now()
    });

    console.log("✅ kasbon saved:", kasbonData);
    btn.innerHTML = "✔ Tersimpan";
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
      closePopupWithCleanup?.();
    }, 1500);

  } catch (err) {
    console.error("❌ saveKasbonCost:", err);
    btn.innerHTML = "❌ Gagal";
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 2000);
  }
}
async function loadKasbonDraft(tanggal) {
  try {
    const today = tanggal || getTanggalLocal();

    // 1. Coba IndexedDB dulu
    const localData = await getPengeluaranIndexedDB(today);
    if (localData?.pengeluaranProduksi?.kasbon) {
      console.log("💾 kasbon dari IndexedDB:", localData.pengeluaranProduksi.kasbon);
      return localData.pengeluaranProduksi.kasbon;
    }

    // 2. Fallback ke Firestore
    console.log("📭 IndexedDB kosong, load kasbon dari Firestore...");
    const user = auth.currentUser;
    if (!user) return {};

    const snap = await getDoc(doc(db, "users", user.uid, "laporanAdmin", today));
    if (snap.exists() && snap.data()?.pengeluaranProduksi?.kasbon) {
      const kasbon = snap.data().pengeluaranProduksi.kasbon;
      console.log("☁️ kasbon dari Firestore:", kasbon);

      // Simpan ke IndexedDB supaya next load tidak perlu ke Firestore
      const oldLocal = await getPengeluaranIndexedDB(today);
      await savePengeluaranIndexedDB({
        ...(oldLocal || {}),
        tanggal: today,
        pengeluaranProduksi: {
          ...(oldLocal?.pengeluaranProduksi || {}),
          kasbon
        },
        updatedAt: Date.now()
      });

      return kasbon;
    }

    console.log("📭 Firestore kasbon juga kosong");
    return {};

  } catch (err) {
    console.error("❌ loadKasbonDraft:", err);
    return {};
  }
}

// ── Load Varian ────────────────────────────────────────
async function loadVarian() {
  if (cacheVarian && cacheUpdatedAt && (Date.now() - cacheUpdatedAt < CACHE_TTL)) return cacheVarian;
  try {
    const user = auth.currentUser;
    if (!user) return [];
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) return [];
    const varian = userSnap.data().varian || [];
    cacheVarian = varian;
    cacheUpdatedAt = Date.now();
    return varian;
  } catch (err) {
    console.error("Gagal load varian", err);
    return [];
  }
}
function invalidateVarianCache() {
  cacheVarian = null;
  cacheUpdatedAt = null;
}

// ── Helpers ────────────────────────────────────────────
function getTanggalLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function getHariIndonesia(tanggal) {
  const hariNama = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const date = new Date(`${tanggal}T00:00:00`);
  return hariNama[date.getDay()];
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function formatRibuan(value) {
  const angka = String(value).replace(/\D/g, "");
  return angka ? Number(angka).toLocaleString("id-ID") : "";
}
function parseRibuan(value) {
  return Number(String(value).replace(/\./g, "").replace(/\D/g, "")) || 0;
}
function formatTanggalIndonesia(timestamp) {
  if (!timestamp?.toDate) return "-";
  const date = timestamp.toDate();
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

async function loadKurir() {
  const listEl = document.getElementById("listKurir");
  if (!listEl) return;
  try {
    const user = auth.currentUser;
    if (!user) {
      listEl.innerHTML = `<div class="loading-card">Menunggu login...</div>`;
      return;
    }
    const roles = ["kurir", "sales", "hunter"];
    console.log("🔍 Load Kurir Role Filter:", roles);
    const snap = await getDocs(
      query(
        collection(db, "users"),
        where("role", "in", roles),
        where("createdBy", "==", user.uid),
        where("status", "==", true)
      )
    );
    console.log("📦 Total hasil Firestore:", snap.size);
    if (snap.empty) {
      listEl.innerHTML = `<div class="loading-card">Belum ada kurir</div>`;
      return;
    }
    let html = "";
    snap.forEach(docSnap => {
      const data = docSnap.data();
      // safety filter (kalau suatu saat data produksi nyasar ke query)
      if (!roles.includes(data.role)) {
        console.log("⛔ DIBLOK ROLE:", data.role, docSnap.id);
        return;
      }
      const nama = escapeHtml(data.nama || "Tanpa Nama");
      const uidMarketing = escapeHtml(docSnap.id);
      const role = escapeHtml(data.role || "kurir");
      const foto = data.foto || "";
      const inisial = (data.nama || "?").trim().charAt(0).toUpperCase();
      console.log("👤 Kurir Loaded:", {
        id: docSnap.id,
        nama: data.nama,
        role: data.role
      });
      cacheKurirMap[docSnap.id] = {
        nama: data.nama || "Tanpa Nama",
        role: data.role || "kurir"
      };      
      const avatarHtml = foto
        ? `<img class="avatar-img" src="${escapeHtml(foto)}" data-inisial="${escapeHtml(inisial)}" alt="${nama}">`
        : `<span class="avatar-text">${escapeHtml(inisial)}</span>`;
      const actionBtn = (type, label, svg) => `
        <div class="kurir-action">
          <button class="action-btn popup-btn"
            data-type="${type}"
            data-nama="${nama}"
            data-uid="${uidMarketing}">
      
            ${svg}
      
          </button>
      
          <div class="action-tooltip">${label}</div>
        </div>`;
        html += `
          <div class="kurir-card kurir-open-popup"
            data-nama="${nama}"
            data-role="${role}"
            data-uid="${uidMarketing}">
            
            <div class="avatar">${avatarHtml}</div>
        
            <div class="kurir-info">
              <h3>${nama}</h3>
              <p>${role}</p>
            </div>
        
            <div class="kurir-action-group">
        
              ${actionBtn("order", "Order", `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>


              `)}
        
              ${actionBtn("fee", "Fee", `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              `)}
        
              ${actionBtn("offflavor", "Off Flavor", `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              `)}
        
              ${actionBtn("sisabarang", "Sisa Barang", `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>

              `)}
        
              ${actionBtn("pembayaran", "Pembayaran", `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                </svg>
              `)}
        
            </div>
          </div>
        `;
    });

    listEl.innerHTML = html;
    console.log("✅ Render kurir selesai");
    // ── Long Press Catatan Kurir ──
    listEl.querySelectorAll(".kurir-card").forEach(card => {
      let pressTimer = null;
      function startPress() {
        pressTimer = setTimeout(async () => {
          console.log("📝 Open Catatan:", card.dataset.uid);
          await openPopupCatatanKurir(card.dataset.uid, card.dataset.nama);
        }, 600);
      }
      function cancelPress() {
        clearTimeout(pressTimer);
      }
      card.addEventListener("touchstart", startPress, { passive: true });
      card.addEventListener("touchend", cancelPress);
      card.addEventListener("touchmove", cancelPress);
      card.addEventListener("mousedown", startPress);
      card.addEventListener("mouseup", cancelPress);
      card.addEventListener("mouseleave", cancelPress);
    });
    listEl.querySelectorAll(".avatar-img").forEach(img => {
      img.addEventListener("error", function () {
        this.parentElement.innerHTML =
          `<span class="avatar-text">${escapeHtml(this.dataset.inisial || "?")}</span>`;
      });
    });
  } catch (err) {
    console.error("❌ loadKurir error:", err);
    listEl.innerHTML = `<div class="loading-card">Gagal memuat data</div>`;
  }
}
async function buildPopupForm(type, nama, uidMarketing) {
  const varian = await loadVarian();
  const isPembayaran = type === "pembayaran";
  let inputsHtml = "";

  varian.forEach(item => {
    const namaKey = Object.keys(item)[0];
    if (!namaKey) return;
    const detail = item[namaKey];
    if (!detail || detail.isAktif !== true) return;

    if (isPembayaran) {
      const hargaProduksi = detail.hargaProduksi || 0;
      inputsHtml += `
        <div class="popup-payment-row" data-key="${escapeHtml(namaKey)}">
          <div class="payment-inline">
            <span class="payment-label">${escapeHtml(namaKey)}</span>
            <span class="payment-closing">0</span>
            <span class="payment-x">×</span>
            <span class="payment-harga" data-harga="${hargaProduksi}">${hargaProduksi.toLocaleString("id-ID")}</span>
            <span class="payment-separator">:</span>
            <span class="payment-total">0</span>
          </div>
        </div>`;
    } else {
      inputsHtml += `
        <div class="popup-input-row">
          <label>${escapeHtml(namaKey)}</label>
          <input type="number" min="0" class="popup-input" data-key="${escapeHtml(namaKey)}">
        </div>`;
    }
  });

  const today = getTanggalLocal();
  return `
    <div class="popup-form" data-type="${escapeHtml(type)}" data-uid="${escapeHtml(uidMarketing)}">
      <div class="popup-kurir">${escapeHtml(nama)}</div>
      <div class="popup-input-row">
        <label>Tanggal</label>
        <input type="date" class="popup-input popup-date" value="${today}">
      </div>
      ${inputsHtml}
      ${isPembayaran ? `
        <div class="popup-payment-summary">
          <div class="popup-summary-row"><span>Jumlah</span><span class="sum-value">0</span></div>
          <div class="popup-summary-row"><span>Total Harga</span><span class="sum-harga">0</span></div>
        </div>
        <div class="popup-input-row">
          <label>Bayar</label>
          <input type="text" inputmode="numeric" min="0" class="popup-input input-bayar">
        </div>
        <div class="payment-keterangan">0</div>` : ""}
      <button class="popup-save-btn">Simpan</button>
    </div>`;
}
async function calculatePembayaran(form) {
  try {
    if (form.dataset.type !== "pembayaran") return;
    const tanggal = form.querySelector(".popup-date").value;
    if (!tanggal) return;

    const laporanSnap = await getDoc(doc(db, "users", form.dataset.uid, "laporanMarketing", tanggal));
    const d = laporanSnap.exists() ? laporanSnap.data() : {};
    const order = d.order || {};
    const fee = d.fee || {};
    const offFlavor = d.offFlavor || {};
    const sisaBarang = d.sisaBarang || {};

    let sumValue = 0, sumHarga = 0;
    form.querySelectorAll(".popup-payment-row").forEach(row => {
      const key = row.dataset.key;
      const closing = Math.max(0,
        Number(order[key] || 0) - Number(fee[key] || 0) -
        Number(offFlavor[key] || 0) - Number(sisaBarang[key] || 0)
      );
      const hargaEl = row.querySelector(".payment-harga");
      const harga = Number(hargaEl.dataset.harga || 0);
      const total = closing * harga;
      row.querySelector(".payment-closing").innerText = closing;
      hargaEl.innerText = harga.toLocaleString("id-ID");
      row.querySelector(".payment-total").innerText = total.toLocaleString("id-ID");
      sumValue += closing;
      sumHarga += total;
    });

    const sumValueEl = form.querySelector(".sum-value");
    const sumHargaEl = form.querySelector(".sum-harga");
    if (sumValueEl) sumValueEl.innerText = sumValue.toLocaleString("id-ID");
    if (sumHargaEl) sumHargaEl.innerText = sumHarga.toLocaleString("id-ID");

    const bayar = parseRibuan(form.querySelector(".input-bayar")?.value || 0);
    const selisih = bayar - sumHarga;
    const ketEl = form.querySelector(".payment-keterangan");
    if (!ketEl) return;

    if (selisih === 0) {
      ketEl.innerText = "Lunas";
      ketEl.style.color = "green";
    } else if (selisih < 0) {
      ketEl.innerText = `- ${Math.abs(selisih).toLocaleString("id-ID")}`;
      ketEl.style.color = "red";
    } else {
      ketEl.innerText = `+ ${selisih.toLocaleString("id-ID")}`;
      ketEl.style.color = "purple";
    }
  } catch (err) {
    console.error("Gagal hitung pembayaran", err);
  }
}
async function loadPopupPreview(form) {
  try {
    const type = form.dataset.type;
    const tanggal = form.querySelector(".popup-date")?.value;
    if (!tanggal) return;
    let firestoreField = type;
    if (type === "offflavor") firestoreField = "offFlavor";
    if (type === "sisabarang") firestoreField = "sisaBarang";
    let data = {};
    try {
      const snap = await getDoc(doc(db, "users", form.dataset.uid, "laporanMarketing", tanggal));
      if (snap.exists()) data = snap.data();
    } catch (err) {
      console.warn("Preview kosong:", err.code);
    }
    if (type === "pembayaran") {
      const bayarInput = form.querySelector(".input-bayar");
      const bayar = data.pembayaran?.nota?.bayar;
      if (bayarInput) bayarInput.value = bayar > 0 ? formatRibuan(bayar) : "";
      await calculatePembayaran(form);
      return;
    }

    const popupData = data[firestoreField] || {};
    form.querySelectorAll(".popup-input[data-key]").forEach(input => {
      const val = popupData[input.dataset.key];
      input.value = val > 0 ? val : "";
    });
  } catch (err) {
    console.error("Gagal preview popup", err);
  }
}
async function savePopupData(btn) {
  const form = btn.closest(".popup-form");
  if (!form) return;

  btn.disabled = true;
  btn.innerText = "Menyimpan...";
  let sukses = false;

  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Belum login");

    const adminSnap = await getDoc(doc(db, "users", user.uid));
    if (!adminSnap.exists()) throw new Error("User tidak ditemukan");

    const adminData = adminSnap.data();
    const idCabang = adminData.idCabang || "";
    const uidMarketing = form.dataset.uid;
    const type = form.dataset.type;
    const tanggal = form.querySelector(".popup-date").value;
    if (!tanggal) { alert("Tanggal wajib diisi"); return; }

    const laporanRef = doc(db, "users", uidMarketing, "laporanMarketing", tanggal);

    // ── Pembayaran ─────────────────────────────────────
    if (type === "pembayaran") {
      await calculatePembayaran(form);

      const closing = {};
      let totalHarga = 0;
      form.querySelectorAll(".popup-payment-row").forEach(row => {
        const key = row.dataset.key;
        const value = Number(row.querySelector(".payment-closing").innerText || 0);
        const harga = Number(row.querySelector(".payment-harga").dataset.harga || 0);
        if (value > 0) closing[key] = value;
        totalHarga += value * harga;
      });

      const bayar = parseRibuan(form.querySelector(".input-bayar")?.value || 0);
      const selisih = bayar - totalHarga;
      const status = selisih === 0 ? "Lunas" : selisih < 0 ? "Kurang" : "Lebih";

      await setDoc(laporanRef, {
        createdBy: user.uid,
        idMarketing: uidMarketing,
        idCabang,
        tanggal,
        pembayaran: {
          closing,
          nota: { bayar, keterangan: selisih, status },
          createdAt: serverTimestamp()
        }
      }, { merge: true });

      // Mirror ke laporanAdmin
      try {
        const laporanSnap = await getDoc(laporanRef);
        const laporanData = laporanSnap.exists() ? laporanSnap.data() : {};
        const marketingSnap = await getDoc(doc(db, "users", uidMarketing));
        const namaMarketing = marketingSnap.exists() ? (marketingSnap.data().nama || "") : "";

        await setDoc(doc(db, "users", user.uid, "laporanAdmin", tanggal), {
          createdBy: user.uid,
          idCabang,
          tanggal,
          updatedAt: serverTimestamp(),
          [uidMarketing]: {
            nama: namaMarketing,
            order: laporanData.order || {},
            fee: laporanData.fee || {},
            offFlavor: laporanData.offFlavor || {},
            sisaBarang: laporanData.sisaBarang || {},
            pembayaran: {
              closing,
              nota: { bayar, keterangan: selisih, status },
              createdAt: serverTimestamp()
            }
          }
        }, { merge: true });
        console.log("✅ laporanAdmin berhasil diupdate");
      } catch (err) {
        console.error("❌ Gagal update laporanAdmin", err);
      }
      sukses = true;
      btn.innerText = "Tersimpan ✓";
      setTimeout(() => closePopupWithCleanup(), 700);
      return;
    }

    // ── Normal (order / fee / dst) ─────────────────────
    const mapData = {};
    form.querySelectorAll("[data-key]").forEach(input => {
      const val = Number(input.value || 0);
      if (val > 0) mapData[input.dataset.key] = val;
    });

    let firestoreField = type;
    if (type === "offflavor") firestoreField = "offFlavor";
    if (type === "sisabarang") firestoreField = "sisaBarang";

    try {
      const snap = await getDoc(laporanRef);
      if (snap.exists()) await setDoc(laporanRef, { [firestoreField]: deleteField() }, { merge: true });
    } catch (err) {
      console.warn("Skip read laporan:", err.code);
    }

    await setDoc(laporanRef, {
      createdBy: user.uid,
      idMarketing: uidMarketing,
      idCabang,
      tanggal,
      createdAt: serverTimestamp(),
      [firestoreField]: mapData
    }, { merge: true });

    // Update bawaBarang (khusus order)
    if (type === "order") {
      try {
        const marketingRef = doc(db, "users", uidMarketing);
        const marketingSnap = await getDoc(marketingRef);
        if (marketingSnap.exists()) {
          const oldBawaBarang = marketingSnap.data().bawaBarang || [];
          const newBawaBarang = oldBawaBarang.map(item => {
            const key = Object.keys(item)[0];
            if (!key) return item;
            return { [key]: { ...item[key], bawa: Number(mapData[key] || 0) } };
          });
          await setDoc(marketingRef, { bawaBarang: newBawaBarang, bawaBarangUpdate: serverTimestamp() }, { merge: true });
        }
      } catch (err) {
        console.error("Gagal update bawaBarang", err);
      }
    }
    sukses = true;
    btn.innerText = "Tersimpan ✓";
    setTimeout(() => closePopupWithCleanup(), 700);
  } catch (err) {
    console.error(err);
    alert("Gagal menyimpan");
  } finally {
    if (!sukses) {
      btn.disabled = false;
      btn.innerText = "Simpan";
    }
  }
}
function openPopup(title, content) {
  document.getElementById("popupTitle").innerText = title;
  document.getElementById("popupContent").innerHTML = content;
  document.getElementById("popupOverlay").classList.add("show");
  document.body.classList.add("popup-open");
  requestAnimationFrame(() => enablePopupDrag(".popup-box", ".popup-header"));
}
function closePopup() {
  document.getElementById("popupOverlay").classList.remove("show");
  document.body.classList.remove("popup-open");
}
async function openPopupCatatanKurir(uidKurir, namaKurir) {
  try {
    const snap = await getDoc(doc(db, "users", uidKurir));
    let body = "";
    let createdAtText = "-";
    if (snap.exists()) {
      const data = snap.data();
      body = data?.catatan?.body || "";
      createdAtText = formatTanggalIndonesia(data?.catatan?.createdAt);
    }
    const content = `
      <div class="popup-catatan" data-uid="${escapeHtml(uidKurir)}">
        <div class="popup-catatan-header">
          <div class="popup-catatan-title">Catatan: ${escapeHtml(namaKurir)}</div>
          <div class="popup-catatan-date">Terakhir diubah: ${escapeHtml(createdAtText)}</div>
        </div>
        <textarea class="popup-catatan-input" placeholder="Tulis catatan" rows="8">${escapeHtml(body)}</textarea>
        <button class="popup-catatan-save">Simpan</button>
      </div>`;
    openPopup("Catatan Kurir", content);
  } catch (err) {
    console.error("Gagal buka catatan", err);
    alert("Gagal memuat catatan");
  }
}
async function saveCatatanKurir(btn) {
  const wrap = btn.closest(".popup-catatan");
  if (!wrap) return;
  const uid = wrap.dataset.uid;
  const textarea = wrap.querySelector(".popup-catatan-input");
  const body = textarea?.value?.trim() || "";
  btn.disabled = true;
  btn.innerText = "Menyimpan...";
  try {
    await setDoc(
      doc(db, "users", uid),
      { catatan: { body, createdAt: serverTimestamp() } },
      { merge: true }
    );
    btn.innerText = "Catatan disimpan";
    setTimeout(() => closePopupWithCleanup(), 900);
  } catch (err) {
    console.error("Gagal simpan catatan", err);
    btn.disabled = false;
    btn.innerText = "Gagal";
  }
}
async function loadDataHarian(uidKurir, forceReload = false, selectedTanggal = null) {
  const tanggal = selectedTanggal || getTanggalLocal();
  const cacheKey = `${uidKurir}_${tanggal}`;

  // ── RELOAD MANUAL ──
  if (forceReload) {
    try {
      console.log("🔄 Reload Firestore", cacheKey);

      delete cacheDataHarian[cacheKey];
      // BUG FIX: pisah argumen
      await deleteDataHarianIndexedDB(uidKurir, tanggal);

      const adminSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      const idCabang = adminSnap.exists() ? (adminSnap.data().idCabang || "") : "";
      if (!idCabang) return null;

      const hasil = {
        fee: {},
        disable: {},
        closing: {},
        expired: {},
        pay: {},
        saldoBarang: {},
        kunjungan: 0,
        pembayaran: { bayarKonsumen: 0, bayarProduksi: 0 },
        keterangan: { pending: 0, tutup: 0, putus: 0 },
        customerNew: 0,
        customerLama: 0,
        customerTambahan: 0
      };

      const snap = await getDocs(query(
        collectionGroup(db, "dataHarian"),
        where("idCabang", "==", idCabang),
        where("pemilik", "==", uidKurir),
        where("tanggal", "==", tanggal)
      ));

      hasil.kunjungan = snap.size;

      snap.forEach(docSnap => {
        const data = docSnap.data();

        ["fee", "disable", "closing", "expired", "pay"].forEach(f => {
          if (!data[f] || typeof data[f] !== "object") return;
          Object.entries(data[f]).forEach(([key, val]) => {
            hasil[f][key] = (hasil[f][key] || 0) + (Number(val) || 0);
          });
        });

        if (data.pembayaran) {
          hasil.pembayaran.bayarKonsumen += Number(data.pembayaran?.bayarKonsumen) || 0;
          hasil.pembayaran.bayarProduksi += Number(data.pembayaran?.bayarProduksi) || 0;
        }

        const status = data?.keterangan?.status?.trim()?.toLowerCase();
        if (status === "pending") hasil.keterangan.pending++;
        else if (status === "tutup") hasil.keterangan.tutup++;
        else if (status === "putus") hasil.keterangan.putus++;
      });
      // ── Ambil Bawa Barang (order laporanMarketing) ──
      try {
        const laporanMarketingSnap = await getDoc(
          doc(db, "users", uidKurir, "laporanMarketing", tanggal)
        );
      
        const order = laporanMarketingSnap.exists()
          ? (laporanMarketingSnap.data().order || {})
          : {};
      
        // Rumus:
        // saldo = bawaBarang - closing - fee - disable
        const allKeys = new Set([
          ...Object.keys(order),
          ...Object.keys(hasil.closing),
          ...Object.keys(hasil.fee),
          ...Object.keys(hasil.disable)
        ]);
      
        allKeys.forEach(key => {
          const bawaBarang = Number(order[key] || 0);
          const closing = Number(hasil.closing[key] || 0);
          const fee = Number(hasil.fee[key] || 0);
          const disable = Number(hasil.disable[key] || 0);
      
          hasil.saldoBarang[key] =
            bawaBarang - closing - fee - disable;
        });
      
      } catch (err) {
        console.error("❌ Gagal hitung saldo barang", err);
      }
      // ── Hitung Customer ──
      const startDate = new Date(`${tanggal}T00:00:00`);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(endDate);
      const hariFilter = getHariIndonesia(tanggal);

      try {
        // Customer Baru
        const customerNewSnap = await getDocs(query(
          collection(db, "customer"),
          where("idCabang", "==", idCabang),
          where("pemilik", "==", uidKurir),
          where("createdBy", "==", uidKurir),
          where("acc", "==", true),
          where("createdAt", ">=", startTimestamp),
          where("createdAt", "<", endTimestamp)
        ));
        hasil.customerNew = customerNewSnap.size;

        // Customer Lama
        const customerLamaSnap = await getDocs(query(
          collection(db, "customer"),
          where("idCabang", "==", idCabang),
          where("pemilik", "==", uidKurir),
          where("hari", "==", hariFilter),
          where("isNew", "==", false)
        ));
        hasil.customerLama = customerLamaSnap.docs.filter(docSnap => {
          const data = docSnap.data();
          return !("acc" in data);
        }).length;

        // Customer Tambahan
        const customerTambahanSnap = await getDocs(query(
          collection(db, "customer"),
          where("idCabang", "==", idCabang),
          where("pemilik", "==", uidKurir),
          where("hari", "==", hariFilter),
          where("isNew", "==", true)
        ));
        hasil.customerTambahan = customerTambahanSnap.docs.filter(docSnap => {
          const data = docSnap.data();
          return !("acc" in data);
        }).length;

        console.log("👥 Customer", {
          baru: hasil.customerNew,
          lama: hasil.customerLama,
          tambahan: hasil.customerTambahan,
          hari: hariFilter
        });
      } catch (err) {
        console.error("❌ Gagal query customer", err);
        hasil.customerNew = 0;
        hasil.customerLama = 0;
        hasil.customerTambahan = 0;
      }

      let namaKurir = "";
      try {
      const kurirSnap = await getDoc(doc(db, "users", uidKurir));
      namaKurir = kurirSnap.exists() ? (kurirSnap.data().nama || "") : "";
      } catch (_) {}
      
      hasil.nama = namaKurir;
      cacheDataHarian[cacheKey] = hasil;
      await saveDataHarianIndexedDB(uidKurir, tanggal, hasil);

      const savedIndexed = await getDataHarianIndexedDB(uidKurir, tanggal);
      console.log("💾 INDEXEDDB FINAL:", {
        id: cacheKey,
        uidKurir,
        tanggal,
        data: savedIndexed
      });

      return hasil;
    } catch (err) {
      console.error("❌ Reload gagal", err);
      return null;
    }
  }

  // ── 1. RAM ──
  if (cacheDataHarian[cacheKey] !== undefined) {
    console.log("⚡ RAM HIT", cacheKey);
    return cacheDataHarian[cacheKey];
  }

  // ── 2. IndexedDB ──
  const indexedData = await getDataHarianIndexedDB(uidKurir, tanggal);
  if (indexedData !== null) {
    console.log("💾 IndexedDB HIT", cacheKey);
    cacheDataHarian[cacheKey] = indexedData;
    return indexedData;
  }

  // ── 3. Tidak ada cache ──
  console.log("📭 Belum ada cache", cacheKey);
  cacheDataHarian[cacheKey] = undefined;
  return undefined;
}
async function renderPopupDataHarian(uidKurir, nama, role, forceReload = false, selectedTanggal = null) {
  const contentEl = document.getElementById("popupDataHarianContent");
  if (!contentEl) return;

  const today = selectedTanggal || getTanggalLocal();
  const data = await loadDataHarian(uidKurir, forceReload, today);

  // Tidak ada cache + belum reload manual
  if (data === undefined) {
    contentEl.innerHTML = `
      <div class="dh-container">
        <div class="dh-top">
          <div class="dh-user">
            <h3>${escapeHtml(nama)}</h3>
            <p>${escapeHtml(role)}</p>
          </div>
          <div class="dh-date-wrap">
            <input type="date" class="dh-date-input" value="${today}"
              data-uid="${escapeHtml(uidKurir)}"
              data-nama="${escapeHtml(nama)}"
              data-role="${escapeHtml(role)}">
          </div>
        </div>
        <div style="text-align:center;padding:32px 20px;color:#777;">
          <div>Belum ada data</div>
          <div style="font-size:13px;margin-top:6px;">Klik reload untuk memuat data</div>
        </div>
        <div class="popup-dataharian-reload-wrap">
          <button class="popup-dataharian-reload"
            data-uid="${escapeHtml(uidKurir)}"
            data-nama="${escapeHtml(nama)}"
            data-role="${escapeHtml(role)}"
            data-tanggal="${today}">Reload</button>
        </div>
      </div>`;
    return;
  }

  // Gagal load firestore saat reload
  if (data === null) {
    contentEl.innerHTML = `
      <div style="text-align:center;padding:30px;color:red;">Gagal memuat data</div>
      <div class="popup-dataharian-reload-wrap">
        <button class="popup-dataharian-reload"
          data-uid="${escapeHtml(uidKurir)}"
          data-nama="${escapeHtml(nama)}"
          data-role="${escapeHtml(role)}"
          data-tanggal="${today}">Reload</button>
      </div>`;
    return;
  }

  async function renderItems(obj) {
    const varian = await loadVarian();
  
    const sortedEntries = varian
      .map(item => {
        const key = Object.keys(item)[0];
        return [key, obj[key] || 0];
      })
      .filter(([, value]) => value > 0);
  
    if (!sortedEntries.length) {
      return `<div class="dh-empty">Tidak ada data</div>`;
    }
  
    return `
      <div class="dh-list">
        ${sortedEntries.map(([k, v]) => `
          <div class="dh-item">
            <span class="dh-key">${escapeHtml(k)}</span>
            <span class="dh-value">
              ${Number(v).toLocaleString("id-ID")}
            </span>
          </div>
        `).join("")}
      </div>
    `;
  }

  const card = (cls, title, content) => `
    <div class="dh-card ${cls}">
      <div class="dh-card-title">${title}</div>
      ${content}
    </div>`;

  const [htmlFee, htmlDisable, htmlClosing, htmlExpired, htmlPay, htmlSaldo] = await Promise.all([
  renderItems(data.fee),
  renderItems(data.disable),
  renderItems(data.closing),
  renderItems(data.expired),
  renderItems(data.pay),
  renderItems(data.saldoBarang || {})
]);

contentEl.innerHTML = `
    <div class="dh-container">
      <div class="dh-top">
        <div class="dh-user"><h3>${escapeHtml(nama)}</h3><p>${escapeHtml(role)}</p></div>
        <div class="dh-date-wrap">
          <input type="date" class="dh-date-input" value="${today}"
            data-uid="${escapeHtml(uidKurir)}"
            data-nama="${escapeHtml(nama)}"
            data-role="${escapeHtml(role)}">
        </div>
      </div>
      <div class="dh-grid">
        ${card("fee", "Fee", htmlFee)}
        ${card("disable", "Disable", htmlDisable)}
        ${card("closing", "Closing", htmlClosing)}
        ${card("expired", "Expired", htmlExpired)}
        ${card("pay", "Pay", htmlPay)}
        ${card("saldo", "Saldo Barang", htmlSaldo)}
        <div class="dh-omset-full">
          <div class="dh-omset-title">Total Omset</div>
          <div class="dh-omset-value">Rp ${Number(data.pembayaran?.bayarKonsumen || 0).toLocaleString("id-ID")}</div>
          <div class="dh-omset-sub">Total pembayaran konsumen</div>
        </div>
      </div>
      <div class="popup-dataharian-reload-wrap">
        <button class="popup-dataharian-reload"
          data-uid="${escapeHtml(uidKurir)}"
          data-nama="${escapeHtml(nama)}"
          data-role="${escapeHtml(role)}"
          data-tanggal="${today}">Reload</button>
      </div>
    </div>`;
}
function openPopupDataHarian(title, content) {
  const overlay = document.getElementById("popupDataHarianOverlay");
  document.getElementById("popupDataHarianTitle").innerText = title;
  document.getElementById("popupDataHarianContent").innerHTML = content;
  overlay.classList.add("show");
  document.body.classList.add("popup-open");
  requestAnimationFrame(() => enablePopupDrag(".popup-dataharian-box", ".popup-dataharian-header"));
}
function closePopupDataHarian() {
  document.getElementById("popupDataHarianOverlay").classList.remove("show");
  document.body.classList.remove("popup-open");
}

function enablePopupDrag(popupSelector, handleSelector) {
  const popup = document.querySelector(popupSelector);
  if (popup?._cleanupDrag) popup._cleanupDrag();
  const handle = popup?.querySelector(handleSelector);
  if (!popup || !handle || window.innerWidth <= 768) return;

  popup.style.cssText += ";position:fixed;margin:0;transform:none;";
  const rect = popup.getBoundingClientRect();
  popup.style.left = rect.left + "px";
  popup.style.top = rect.top + "px";

  let isDragging = false, offsetX = 0, offsetY = 0;
  handle.style.cursor = "grab";

  function onMouseDown(e) {
    if (e.target.closest("button,input,textarea,select")) return;
    isDragging = true;
    const r = popup.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;
    handle.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }
  function onMouseMove(e) {
    if (!isDragging) return;
    popup.style.left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - popup.offsetWidth)) + "px";
    popup.style.top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - popup.offsetHeight)) + "px";
  }
  function onMouseUp() {
    isDragging = false;
    handle.style.cursor = "grab";
    document.body.style.userSelect = "";
  }

  handle.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  popup._cleanupDrag = () => {
    handle.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    delete popup._cleanupDrag;
  };
}
function cleanupDrag(sel) { document.querySelector(sel)?._cleanupDrag?.(); }
function closePopupWithCleanup() { cleanupDrag(".popup-box"); closePopup(); }
function closePopupDataHarianWithCleanup() { cleanupDrag(".popup-dataharian-box"); closePopupDataHarian(); }
(function setupSwipePopupBox() {
  const box = document.querySelector(".popup-box");
  if (!box) return;
  let startY = 0, currentY = 0, dragging = false;

  box.addEventListener("touchstart", e => {
    if (window.innerWidth > 768) return;
    startY   = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
    box.style.transition = "none";
  }, { passive: true });

  box.addEventListener("touchmove", e => {
    if (!dragging || window.innerWidth > 768) return;
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy < 0) return;
    e.preventDefault();
    box.style.transform = `translateY(${dy}px)`;
  }, { passive: false });

  box.addEventListener("touchend", () => {
    if (!dragging || window.innerWidth > 768) return;
    dragging = false;
    box.style.transition = "";
    const dy = currentY - startY;
    if (dy > 120) {
      box.style.transform = "translateY(100%)";
      setTimeout(() => {
        closePopupWithCleanup();
        box.style.transform = "";
      }, 300);
    } else {
      box.style.transform = "";
    }
  });
})();
(function setupSwipeDataHarian() {
  const box = document.querySelector(".popup-dataharian-box");
  if (!box) return;
  let startY = 0, currentY = 0, dragging = false;

  box.addEventListener("touchstart", e => {
    if (window.innerWidth > 768) return;
    startY   = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
    box.style.transition = "none";
  }, { passive: true });

  box.addEventListener("touchmove", e => {
    if (!dragging || window.innerWidth > 768) return;
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy < 0) return;
    e.preventDefault();
    box.style.transform = `translateY(${dy}px)`;
  }, { passive: false });

  box.addEventListener("touchend", () => {
    if (!dragging || window.innerWidth > 768) return;
    dragging = false;
    box.style.transition = "";
    const dy = currentY - startY;
    if (dy > 120) {
      box.style.transform = "translateY(100%)";
      setTimeout(() => {
        closePopupDataHarianWithCleanup();
        box.style.transform = "";
      }, 300);
    } else {
      box.style.transform = "";
    }
  });
})();

function openIndexedDB() {
  if (dbIndexed) return Promise.resolve(dbIndexed);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION_PENGELUARAN);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_LAPORAN)) {
        db.createObjectStore(STORE_LAPORAN, { keyPath: "id" })
          .createIndex("tanggal", "tanggal", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DATA_HARIAN)) {
        db.createObjectStore(STORE_DATA_HARIAN, { keyPath: "id" });
      }
    };
    req.onsuccess = e => { dbIndexed = e.target.result; resolve(dbIndexed); };
    req.onerror = () => reject(req.error);
  });
}

async function saveLaporanIndexedDB(tanggal, data) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LAPORAN, "readwrite");
      tx.objectStore(STORE_LAPORAN).put({ id: tanggal, tanggal, data, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("❌ save IndexedDB gagal", err);
  }
}
async function getLaporanIndexedDB(tanggal) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_LAPORAN, "readonly")
        .objectStore(STORE_LAPORAN).get(tanggal);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("❌ get IndexedDB gagal", err);
    return null;
  }
}
async function deleteLaporanIndexedDB(tanggal) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LAPORAN, "readwrite");
      tx.objectStore(STORE_LAPORAN).delete(tanggal);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("❌ delete cache gagal", err);
  }
}
async function saveDataHarianIndexedDB(uidKurir, tanggal, data) {
  try {
    const db = await openIndexedDB();
    const id = `${uidKurir}_${tanggal}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATA_HARIAN, "readwrite");
      tx.objectStore(STORE_DATA_HARIAN).put({ id, uidKurir, tanggal, data, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("❌ save data harian gagal", err);
  }
}
async function getDataHarianIndexedDB(uidKurir, tanggal) {
  try {
    const db = await openIndexedDB();
    const id = `${uidKurir}_${tanggal}`;
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_DATA_HARIAN, "readonly")
        .objectStore(STORE_DATA_HARIAN).get(id);
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("❌ get data harian gagal", err);
    return null;
  }
}
async function deleteDataHarianIndexedDB(uidKurir, tanggal) {
  try {
    const db = await openIndexedDB();
    const id = `${uidKurir}_${tanggal}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATA_HARIAN, "readwrite");
      tx.objectStore(STORE_DATA_HARIAN).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("❌ delete data harian gagal", err);
  }
}

function formatTanggalDoc(tahun, bulan, tanggal) {
  return `${tahun}-${String(bulan + 1).padStart(2, "0")}-${String(tanggal).padStart(2, "0")}`;
}
function updatePeriodTitle() {
  const btn = document.getElementById("dataPeriodBtn");
  if (btn) btn.innerText = `Laporan Harian ${bulanNama[selectedMonth]} ${selectedYear}`;
}
function launchRankingConfetti() {
  const card = document.getElementById("rankingOmsetCard");
  if (!card) return;
  const colors = ["#d9b45d", "#b88a2b", "#c0c4cf", "#d79f74", "#B08A5C"];
  for (let i = 0; i < 28; i++) {
    const confetti = document.createElement("div");
    confetti.className = "ranking-confetti";
    confetti.style.left = Math.random() * 100 + "%";
    confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 0.3 + "s";
    card.appendChild(confetti);
    setTimeout(() => confetti.remove(), 2200);
  }
}
async function renderRankingOmset() {
  const el = document.getElementById("rankingOmsetCard");
  const content = document.getElementById("rankingContent");
  const hideBtn = document.getElementById("btnHideRanking");
  if (!el || !content) return;

  content.innerHTML = `
    <div class="ranking-loading">
      <div class="ranking-spinner"></div>
      <div class="ranking-loading-text">🏆 Menghitung juara hari ini...</div>
    </div>`;

  await new Promise(resolve => setTimeout(resolve, 2200));

  try {
    const today = getTanggalLocal();
    
    // Ambil semua kurir dari IndexedDB dataHarian
    const db = await openIndexedDB();
    const allHarian = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATA_HARIAN, "readonly");
      const req = tx.objectStore(STORE_DATA_HARIAN).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    
    // Filter hanya yang tanggal hari ini
    const todayEntries = allHarian.filter(entry => entry.tanggal === today);
    
    if (!todayEntries.length) {
      content.innerHTML = `
        <div class="ranking-placeholder">Belum ada data hari ini</div>
        <button id="btnShowRanking" class="ranking-btn">Refresh</button>`;
      return;
    }
    
    const ranking = todayEntries
      .map(entry => ({
        nama: entry.data?.nama || entry.uidKurir,
        omset: Number(entry.data?.pembayaran?.bayarKonsumen || 0)
      }))
      .sort((a, b) => b.omset - a.omset)
      .slice(0, 3);

    content.innerHTML = `
      <div class="ranking-list">
        ${ranking.map((item, index) => `
          <div class="ranking-item">
            <div class="ranking-left">
              <div class="rank-badge rank-${index + 1}">${index + 1}</div>
              <div class="rank-name">${escapeHtml(item.nama)}</div>
            </div>
            <div class="rank-omset">Rp ${item.omset.toLocaleString("id-ID")}</div>
          </div>`).join("")}
        <button id="btnShowRanking" class="ranking-btn" style="margin-top:14px;">Refresh</button>
      </div>`;

    hideBtn?.classList.remove("hidden");
    launchRankingConfetti();
  } catch (err) {
    console.error(err);
  }
}
function restoreFilterUI() {
  document.querySelectorAll(".data-filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === laporanFilter);
  });
}

async function loadLaporanAdminTanggal(tanggalDoc, forceReload = false) {
  const user = auth.currentUser;
  if (!user) return null;

  if (forceReload) {
    try {
      console.log("🔄 Reload Firestore", tanggalDoc);
      delete cacheLaporanAdmin[tanggalDoc];
      await deleteLaporanIndexedDB(tanggalDoc);

      const snap = await getDoc(doc(db, "users", user.uid, "laporanAdmin", tanggalDoc));
      const data = snap.exists() ? snap.data() : null;
      cacheLaporanAdmin[tanggalDoc] = data;
      if (data !== null) await saveLaporanIndexedDB(tanggalDoc, data);
      return data;
    } catch (err) {
      console.error("❌ Reload Firestore gagal", err);
      return null;
    }
  }

  // 1. RAM cache
  if (cacheLaporanAdmin[tanggalDoc] !== undefined) {
    console.log("⚡ RAM CACHE HIT", tanggalDoc);
    return cacheLaporanAdmin[tanggalDoc];
  }

  // 2. IndexedDB
  const indexedData = await getLaporanIndexedDB(tanggalDoc);
  if (indexedData !== null) {
    console.log("💾 IndexedDB HIT", tanggalDoc);
    cacheLaporanAdmin[tanggalDoc] = indexedData;
    return indexedData;
  }

  // 3. Tidak ada cache
  console.log("📭 Tidak ada cache", tanggalDoc);
  cacheLaporanAdmin[tanggalDoc] = undefined;
  return undefined;
}
async function renderLaporanHarian() {
  const listEl = document.getElementById("laporanHarianList");
  if (!listEl) return;

  const hariNama = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const totalHari = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const tanggalList = [];
  let html = "";
  const today = getTanggalLocal();

  for (let tanggal = 1; tanggal <= totalHari; tanggal++) {
    const tanggalDoc = formatTanggalDoc(selectedYear, selectedMonth, tanggal);

    if (laporanFilter === "aktif" && tanggalDoc !== today) continue;

    const date = new Date(selectedYear, selectedMonth, tanggal);
    const namaHari = hariNama[date.getDay()];
    tanggalList.push(tanggalDoc);

    html += `
      <div class="laporan-item">
        <button class="laporan-trigger" type="button">
          <div class="laporan-tanggal">${namaHari}, ${tanggal} ${bulanNama[selectedMonth]} ${selectedYear}</div>
          <div class="laporan-arrow">▶</div>
        </button>
        <div class="laporan-content">
          <div class="laporan-reload-wrap">
            <button class="laporan-reload-btn" data-tanggal="${tanggalDoc}">Reload</button>
            <button class="laporan-rekap-btn" data-tanggal="${tanggalDoc}">Rekapitulasi</button>
          </div>
          <div class="laporan-placeholder" id="laporan-content-${tanggalDoc}">Loading...</div>
        </div>
      </div>`;
  }

  listEl.innerHTML = html;

  await Promise.all(
    tanggalList.map(async tanggalDoc => {
      try {
        const laporanData = await loadLaporanAdminTanggal(tanggalDoc, false);
        const laporanItem = document.getElementById(`laporan-content-${tanggalDoc}`)?.closest(".laporan-item");

        cacheLaporanAdmin[tanggalDoc] = laporanData;
        renderLaporanCard(tanggalDoc);

        if (!laporanItem) return;

        const users = laporanData
          ? Object.values(laporanData).filter(item => typeof item === "object" && item?.nama)
          : [];

        const adaKurang = users.some(item => {
          const status = item?.pembayaran?.nota?.status;
          return typeof status === "string" && status.trim().toLowerCase() === "kurang";
        });

        laporanItem.classList.toggle("laporan-kurang", adaKurang);

        if (laporanFilter === "tunggakan") {
          laporanItem.style.display = adaKurang ? "" : "none";
        }
      } catch (err) {
        console.error("Gagal render laporan", tanggalDoc, err);
      }
    })
  );
}
function renderLaporanCard(tanggalDoc) {
  const el = document.getElementById(`laporan-content-${tanggalDoc}`);
  if (!el) return;
  const data = cacheLaporanAdmin[tanggalDoc];

  if (data === undefined) { el.innerHTML = "Belum ada data, klik reload"; return; }
  if (data === null) { el.innerHTML = "Belum ada data"; return; }

  const users = Object.entries(data).filter(([, val]) => typeof val === "object" && val?.nama);
  if (!users.length) { el.innerHTML = "Belum ada data"; return; }

  function renderMapChip(obj = {}) {
    const entries = Object.entries(obj);
    if (!entries.length) return `<span class="laporan-empty">-</span>`;
    return entries.map(([k, v]) =>
      `<span class="laporan-chip">${escapeHtml(k)}: ${Number(v).toLocaleString("id-ID")}</span>`
    ).join("");
  }

  function renderPembayaran(nota = {}) {
    const bayar = Number(nota?.bayar || 0);
    const status = nota?.status || "-";
    const ket = Number(nota?.keterangan || 0);
    let cls = "lunas", text = status;
    if (status === "Kurang") { cls = "kurang"; text = `Kurang -${Math.abs(ket).toLocaleString("id-ID")}`; }
    else if (status === "Lebih") { cls = "lebih"; text = `Lebih +${Math.abs(ket).toLocaleString("id-ID")}`; }
    return `
      <div class="laporan-payment">
        <div class="laporan-user-line"><span>Pembayaran</span><strong>${bayar.toLocaleString("id-ID")}</strong></div>
        <div class="laporan-status ${cls}">${text}</div>
      </div>`;
  }

  const row = (label, chips) => `
    <div class="laporan-user-row">
      <span class="laporan-label">${label}</span>
      <div class="laporan-chip-wrap">${chips}</div>
    </div>`;

  el.innerHTML = `
    <div class="laporan-user-scroll">
      ${users.map(([, item]) => `
        <div class="laporan-user-card">
          <div class="laporan-user-name">${escapeHtml(item.nama)}</div>
          ${row("Order", renderMapChip(item.order))}
          ${row("Fee", renderMapChip(item.fee))}
          ${row("Off Flavor", renderMapChip(item.offFlavor))}
          ${row("Sisa Barang", renderMapChip(item.sisaBarang))}
          ${row("Closing", renderMapChip(item?.pembayaran?.closing))}
          ${renderPembayaran(item?.pembayaran?.nota)}
        </div>`).join("")}
    </div>`;
}
function buildRekapitulasi(tanggalDoc) {
  const data = cacheLaporanAdmin[tanggalDoc];
  if (!data) return null;
  const users = Object.values(data).filter(item => typeof item === "object" && item?.nama);
  if (!users.length) return null;

  const hasil = {
    order: {}, fee: {}, offFlavor: {}, sisaBarang: {}, closing: {},
    pembayaran: { bayar: 0, kurang: 0, lebih: 0 }
  };

  function sumMap(target, source = {}) {
    Object.entries(source).forEach(([k, v]) => { target[k] = (target[k] || 0) + Number(v || 0); });
  }

  users.forEach(item => {
    sumMap(hasil.order, item.order);
    sumMap(hasil.fee, item.fee);
    sumMap(hasil.offFlavor, item.offFlavor);
    sumMap(hasil.sisaBarang, item.sisaBarang);
    sumMap(hasil.closing, item?.pembayaran?.closing);
    hasil.pembayaran.bayar += Number(item?.pembayaran?.nota?.bayar || 0);
    const ket = Number(item?.pembayaran?.nota?.keterangan || 0);
    if (ket < 0) hasil.pembayaran.kurang += Math.abs(ket);
    if (ket > 0) hasil.pembayaran.lebih += ket;
  });
  return hasil;
}
function openPopupRekapitulasi(tanggalDoc) {
  const data = buildRekapitulasi(tanggalDoc);
  if (!data) { alert("Belum ada data"); return; }

  function renderMapChip(obj = {}) {
    const entries = Object.entries(obj);
    if (!entries.length) return `<span class="laporan-empty">-</span>`;
    return entries.map(([k, v]) =>
      `<span class="laporan-chip">${escapeHtml(k)}: ${Number(v).toLocaleString("id-ID")}</span>`
    ).join("");
  }

  const row = (label, chips) => `
    <div class="laporan-user-row">
      <span class="laporan-label">${label}</span>
      <div class="laporan-chip-wrap">${chips}</div>
    </div>`;

  openPopup("Rekapitulasi", `
    <div class="laporan-user-card">
      <div class="laporan-user-name" style="text-align:center;">REKAPITULASI</div>
      ${row("Order", renderMapChip(data.order))}
      ${row("Fee", renderMapChip(data.fee))}
      ${row("Off Flavor", renderMapChip(data.offFlavor))}
      ${row("Sisa Barang", renderMapChip(data.sisaBarang))}
      ${row("Closing", renderMapChip(data.closing))}
      <div class="laporan-payment">
        <div class="laporan-user-line"><span>Pembayaran</span><strong>${data.pembayaran.bayar.toLocaleString("id-ID")}</strong></div>
        <div class="laporan-status">
          Kurang: ${data.pembayaran.kurang.toLocaleString("id-ID")} | Lebih: ${data.pembayaran.lebih.toLocaleString("id-ID")}
        </div>
      </div>
    </div>`);
}
function buildPeriodDropdown() {
  const monthMenu = document.getElementById("monthMenu");
  const yearMenu = document.getElementById("yearMenu");
  if (!monthMenu || !yearMenu) return;

  monthMenu.innerHTML = bulanNama.map((b, i) =>
    `<div class="custom-option" data-month="${i}">${b}</div>`
  ).join("");

  const currentYear = new Date().getFullYear();
  yearMenu.innerHTML = Array.from({ length: currentYear + 3 - 2023 }, (_, i) => currentYear + 2 - i)
    .map(y => `<div class="custom-option" data-year="${y}">${y}</div>`).join("");

  document.getElementById("selectedMonthText").innerText = bulanNama[selectedMonth];
  document.getElementById("selectedYearText").innerText = selectedYear;
}
function openPeriodPopup() {
  buildPeriodDropdown();
  document.getElementById("periodPopupOverlay").classList.add("show");
}
function closePeriodPopup() {
  document.getElementById("periodPopupOverlay").classList.remove("show");
}

document.addEventListener("click", async e => {
  // Ranking
  const rankingBtn = e.target.closest("#btnShowRanking");
  if (rankingBtn) { await renderRankingOmset(); return; }

  const hideRanking = e.target.closest("#btnHideRanking");
  if (hideRanking) {
    document.getElementById("rankingContent").innerHTML = `
      <div class="ranking-placeholder">Tampilkan ranking omset hari ini</div>
      <button id="btnShowRanking" class="ranking-btn">Tampilkan</button>`;
    hideRanking.classList.add("hidden");
    return;
  }

  // Popup close
  if (e.target.id === "popupDataHarianClose") { closePopupDataHarianWithCleanup(); return; }
  if (e.target.id === "popupClose" || e.target.id === "popupOverlay") { closePopupWithCleanup(); return; }
  if (e.target.id === "periodPopupOverlay") { closePeriodPopup(); return; }
  if (e.target.id === "dataPeriodBtn") { openPeriodPopup(); return; }
  if (e.target.id === "applyPeriodBtn") { updatePeriodTitle(); renderLaporanHarian(); closePeriodPopup(); return; }

  // Catatan kurir
  const saveCatatanBtn = e.target.closest(".popup-catatan-save");
  if (saveCatatanBtn) { await saveCatatanKurir(saveCatatanBtn); return; }

  // Save popup form
  const saveBtn = e.target.closest(".popup-save-btn");
  if (saveBtn) { await savePopupData(saveBtn); return; }

  // Reload data harian
  const reloadDhBtn = e.target.closest(".popup-dataharian-reload");
  if (reloadDhBtn) {
    reloadDhBtn.disabled = true;
    reloadDhBtn.innerText = "⏳ Memuat...";
    await renderPopupDataHarian(
      reloadDhBtn.dataset.uid,
      reloadDhBtn.dataset.nama,
      reloadDhBtn.dataset.role,
      true,
      reloadDhBtn.dataset.tanggal
    );
    return;
  }

  // Reload laporan admin
  const reloadLaporanBtn = e.target.closest(".laporan-reload-btn");
  if (reloadLaporanBtn) {
    reloadLaporanBtn.disabled = true;
    reloadLaporanBtn.innerText = "Loading...";
    await loadLaporanAdminTanggal(reloadLaporanBtn.dataset.tanggal, true);
    renderLaporanCard(reloadLaporanBtn.dataset.tanggal);
    reloadLaporanBtn.disabled = false;
    reloadLaporanBtn.innerText = "Reload";
    return;
  }

  // Rekapitulasi
  const rekapBtn = e.target.closest(".laporan-rekap-btn");
  if (rekapBtn) {
    await loadLaporanAdminTanggal(rekapBtn.dataset.tanggal, false);
    openPopupRekapitulasi(rekapBtn.dataset.tanggal);
    return;
  }

  // Filter
  const filterBtn = e.target.closest(".data-filter-btn");
  if (filterBtn) {
    laporanFilter = filterBtn.dataset.filter;
    localStorage.setItem(STORAGE_FILTER_KEY, laporanFilter);
    document.querySelectorAll(".data-filter-btn").forEach(btn => btn.classList.remove("active"));
    filterBtn.classList.add("active");
    renderLaporanHarian();
    return;
  }

  // Toggle accordion laporan
  const laporanBtn = e.target.closest(".laporan-trigger");
  if (laporanBtn) {
    laporanBtn.closest(".laporan-item").classList.toggle("open");
    return;
  }

  // Period dropdown bulan
  const monthBtn = e.target.closest("[data-month]");
  if (monthBtn) {
    selectedMonth = Number(monthBtn.dataset.month);
    document.getElementById("selectedMonthText").innerText = bulanNama[selectedMonth];
    document.getElementById("monthMenu").classList.remove("show");
    return;
  }

  // Period dropdown tahun
  const yearBtn = e.target.closest("[data-year]");
  if (yearBtn) {
    selectedYear = Number(yearBtn.dataset.year);
    document.getElementById("selectedYearText").innerText = selectedYear;
    document.getElementById("yearMenu").classList.remove("show");
    return;
  }

  if (e.target.closest("#monthSelect .custom-select-trigger")) {
    document.getElementById("monthMenu").classList.toggle("show");
    return;
  }
  if (e.target.closest("#yearSelect .custom-select-trigger")) {
    document.getElementById("yearMenu").classList.toggle("show");
    return;
  }

  // Buka popup data harian (klik kurir card)
  const kurirCard = e.target.closest(".kurir-open-popup");
  if (kurirCard && !e.target.closest(".popup-btn")) {
    if (window.getSelection()?.toString()) return;
    openPopupDataHarian("Data Harian", "");
    await renderPopupDataHarian(
      kurirCard.dataset.uid,
      kurirCard.dataset.nama,
      kurirCard.dataset.role,
      false
    );
    return;
  }

  // Buka popup form (order/fee/dll)
  const btn = e.target.closest(".popup-btn");
  if (btn) {
    const { nama, uid, type } = btn.dataset;
    const titles = {
      order: "Order",
      fee: "Fee",
      offflavor: "Off Flavor",
      sisabarang: "Sisa Barang",
      pembayaran: "Pembayaran"
    };
    const content = await buildPopupForm(type, nama, uid);
    openPopup(titles[type] || type, content);
    const form = document.querySelector(".popup-form");
    if (form) {
      await loadPopupPreview(form);
      await calculatePembayaran(form);
    }
  }
});
document.addEventListener("change", async e => {
  const dhDate = e.target.closest(".dh-date-input");
  if (dhDate) {
    const contentEl = document.getElementById("popupDataHarianContent");
    if (contentEl) contentEl.style.opacity = ".6";
    await renderPopupDataHarian(
      dhDate.dataset.uid,
      dhDate.dataset.nama,
      dhDate.dataset.role,
      false,
      dhDate.value
    );
    if (contentEl) contentEl.style.opacity = "1";
    return;
  }

  if (e.target.classList.contains("popup-date")) {
    const form = e.target.closest(".popup-form");
    if (form) {
      await loadPopupPreview(form);
      await calculatePembayaran(form);
    }
  }
});
document.addEventListener("input", async e => {
  if (!e.target.classList.contains("input-bayar")) return;
  const formatted = formatRibuan(e.target.value);
  if (e.target.value !== formatted) e.target.value = formatted;
  const form = e.target.closest(".popup-form");
  if (form) await calculatePembayaran(form);
});
