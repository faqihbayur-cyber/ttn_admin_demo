import { auth, db } from "./index.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DB_NAME  = "laporanDistribusiDB";
const DB_STORE = "laporanAdmin";

let currentUid  = null;
let currentDate = null;
let varianKeys  = [];
let saldoKemarinGlobal = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) { console.log("Belum login"); return; }
  console.log("Login:", user.uid);
  currentUid = user.uid;

  const now = new Date();
  currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  await loadVarian();
  initCalendar();
  setupReloadBtn();
  setupInputStockPopup();
  setupSaldoBulanKemarinPopup();
});
const tableScroll = document.querySelector(".laporan-table-scroll");

if (tableScroll) {
  let isDown = false;
  let startX;
  let startY;
  let scrollLeft;
  let scrollTop;

  tableScroll.addEventListener("mousedown", (e) => {
    isDown = true;
    tableScroll.classList.add("dragging");

    startX = e.pageX - tableScroll.offsetLeft;
    startY = e.pageY - tableScroll.offsetTop;

    scrollLeft = tableScroll.scrollLeft;
    scrollTop = tableScroll.scrollTop;
  });

  window.addEventListener("mouseup", () => {
    isDown = false;
    tableScroll.classList.remove("dragging");
  });

  tableScroll.addEventListener("mouseleave", () => {
    isDown = false;
    tableScroll.classList.remove("dragging");
  });

  tableScroll.addEventListener("mousemove", (e) => {
    if (!isDown) return;

    e.preventDefault();

    const x = e.pageX - tableScroll.offsetLeft;
    const y = e.pageY - tableScroll.offsetTop;

    const walkX = (x - startX) * 1.5;
    const walkY = (y - startY) * 1.5;

    tableScroll.scrollLeft = scrollLeft - walkX;
    tableScroll.scrollTop = scrollTop - walkY;
  });
}
function initCalendar() {
  const monthYear = document.getElementById("calendarMonthYear");
  const datesWrap = document.getElementById("calendarDates");
  const dateBtn   = document.getElementById("dateFilterBtn");
  const dateInput = document.getElementById("dateFilterInput");
  const bulan     = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

  let selectedDate = new Date();

  const _setDate = (d) => {
    currentDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  _setDate(selectedDate);
  renderCalendar(selectedDate);

  dateBtn.addEventListener("click", () => dateInput.showPicker());

  dateInput.addEventListener("change", async (e) => {
    selectedDate = new Date(e.target.value);
    _setDate(selectedDate);
    renderCalendar(selectedDate);
    console.log("Tanggal:", e.target.value);
    await renderTableFromDB();
    await renderSaldoBulanKemarinData();
  });

  function renderCalendar(date) {
    const isMobile  = window.innerWidth <= 768;
    const year      = date.getFullYear();
    const month     = date.getMonth();
    const activeDay = date.getDate();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const firstDay  = new Date(year, month, 1).getDay();

    monthYear.textContent = `${bulan[month]} ${year}`;
    datesWrap.innerHTML   = "";

    const makeItem = (day) => {
      const el = document.createElement("div");
      el.className  = "calendar-date-item";
      el.textContent = day;
      if (day === activeDay) el.classList.add("active");

      el.addEventListener("click", async () => {
        selectedDate = new Date(year, month, day);
        const yyyy = selectedDate.getFullYear();
        const mm   = String(selectedDate.getMonth() + 1).padStart(2, "0");
        const dd   = String(day).padStart(2, "0");
        const tanggal = `${yyyy}-${mm}-${dd}`;
        dateInput.value = tanggal;
        currentDate     = tanggal;
        renderCalendar(selectedDate);
        console.log("Tanggal:", tanggal);
        await renderTableFromDB();
        await renderSaldoBulanKemarinData();
      });

      datesWrap.appendChild(el);
    };

    if (isMobile) {
      let start = activeDay - 3;
      let end   = activeDay + 3;
      if (start < 1)       { end += (1 - start); start = 1; }
      if (end > totalDays) { start -= (end - totalDays); end = totalDays; if (start < 1) start = 1; }
      for (let day = start; day <= end; day++) makeItem(day);
      return;
    }

    for (let i = 0; i < firstDay; i++) datesWrap.appendChild(document.createElement("div"));
    for (let day = 1; day <= totalDays; day++) makeItem(day);
  }
}
function formatTanggalIndonesia(dateStr) {

  if (!dateStr)
    return "-";

  const date =
    new Date(dateStr);

  return date.toLocaleDateString(
    "id-ID",
    {
      weekday:
        "long",

      day:
        "numeric",

      month:
        "long",

      year:
        "numeric"
    }
  );
}
function getPreviousMonth(dateStr) {
  const d = new Date(dateStr);

  d.setMonth(d.getMonth() - 1);

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}`;
}
async function loadVarian() {
  try {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDoc(doc(db, "users", currentUid));

    if (!snap.exists()) {
      console.warn("⚠️ User doc tidak ditemukan");
      renderTableHeader([]);
      renderTableBody([], []);
      return;
    }

    const varian = snap.data()?.varian || [];
    console.log("📦 Raw varian:", JSON.stringify(varian));

    varianKeys = varian.map(v => Object.keys(v)[0]).filter(Boolean);
    console.log("🏷️ Varian keys:", varianKeys);
    
    // render saldo dinamis
    renderSaldoBulanKemarin(varianKeys);
    
    renderTableHeader(varianKeys);
    await renderTableFromDB();
    await renderSaldoBulanKemarinData();
    setupFilterRentang();
    setupFilterKolom();

  } catch (err) {
    console.error("❌ loadVarian error:", err);
  }
}
function renderSaldoBulanKemarin(keys = []) {
  const wrap = document.getElementById("saldoBulanKemarinWrap");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="saldo-bulan-card">

      <div class="saldo-bulan-title">
        SALDO BULAN KEMARIN
      </div>

      <div class="saldo-bulan-grid">
        ${keys.map(key => `
          <div class="saldo-item">

            <div class="saldo-item-label">
              ${key}
            </div>

            <div class="saldo-item-value" id="saldoVal_${key}">
              —
            </div>

          </div>
        `).join("")}
      </div>

    </div>
  `;
}
async function renderSaldoBulanKemarinData() {
  const grid = document.getElementById("saldoKemarinGrid");
  if (!grid || !currentDate) return;

  try {
    const bulan = getPreviousMonth(currentDate);

    const {
      doc,
      getDoc
    } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
    );

    const snap = await getDoc(
      doc(
        db,
        "users",
        currentUid,
        "saldoBulanKemarin",
        bulan
      )
    );

    const data = snap.exists()
      ? snap.data()
      : {};

    const saldo = data?.saldo || {};

    grid.innerHTML = varianKeys.map(k => `
      <div class="saldo-kemarin-item">
        <div class="saldo-kemarin-key">
          ${k}
        </div>

        <div class="saldo-kemarin-val">
          ${saldo[k] ?? 0}
        </div>
      </div>
    `).join("");
    // Update card saldo bulan kemarin di atas tabel
    varianKeys.forEach(k => {
      const el = document.getElementById(`saldoVal_${k}`);
      if (el) el.innerText = saldo[k] ?? 0;
    });

    // Update global untuk kalkulasi tabel
    saldoKemarinGlobal = saldo;

  } catch (err) {
    console.error(
      "❌ render saldo bulan kemarin error:",
      err
    );

    grid.innerHTML = varianKeys.map(k => `
      <div class="saldo-kemarin-item">
        <div class="saldo-kemarin-key">
          ${k}
        </div>

        <div class="saldo-kemarin-val">
          0
        </div>
      </div>
    `).join("");
  }
}
function setupSaldoBulanKemarinPopup() {
  const btn = document.getElementById(
    "btnSaldoBulanKemarin"
  );

  const overlay = document.getElementById(
    "popupStockOverlay"
  );

  const body = document.querySelector(
    ".popup-stock-body"
  );

  const title = document.querySelector(
    ".popup-stock-title-wrap h3"
  );

  const dateText = document.getElementById(
    "popupStockDateText"
  );

  if (!btn || !overlay || !body)
    return;

  btn.addEventListener(
    "click",
    async () => {

      title.textContent =
        "Saldo Bulan Kemarin";

      dateText.textContent =
        currentDate?.slice(0, 7) || "-";

      const bulan = getPreviousMonth(currentDate);

      let existingSaldo = {};

      try {
        const { doc, getDoc } = await import(
          "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
        );
        const snap = await getDoc(
          doc(db, "users", currentUid, "saldoBulanKemarin", bulan)
        );
        existingSaldo = snap.exists() ? (snap.data()?.saldo || {}) : {};
      } catch (err) {
        console.error("Gagal load saldo bulan kemarin:", err);
      }

      body.innerHTML = `
        <div class="popup-stock-form">

          ${varianKeys.map(key => `
            <div class="popup-stock-group">
              <label class="popup-stock-label">
                ${key}
              </label>

              <input
                type="number"
                min="0"
                class="popup-stock-input saldo-input"
                data-key="${key}"
                placeholder="${key}"
                value="${existingSaldo[key] ?? ""}"
              />
            </div>
          `).join("")}

          <button
            id="saveSaldoBulanBtn"
            class="popup-stock-submit"
          >
            Simpan
          </button>

        </div>
      `;

      overlay.classList.add("show");
      document.body.classList.add(
        "popup-open"
      );

      const saveBtn =
        document.getElementById(
          "saveSaldoBulanBtn"
        );

      saveBtn.onclick =
        async () => {
          saveBtn.disabled =
            true;

          saveBtn.classList.add(
            "loading"
          );

          saveBtn.innerHTML =
            `<div class="popup-stock-spinner"></div>`;

          try {
            const saldo = {};

            document
              .querySelectorAll(
                ".saldo-input"
              )
              .forEach(input => {
                const key =
                  input.dataset.key;

                saldo[key] =
                  Number(
                    input.value || 0
                  );
              });

            // Simpan ke Firestore
            const { doc, setDoc } = await import(
              "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
            );
            await setDoc(
              doc(db, "users", currentUid, "saldoBulanKemarin", bulan),
              { bulan, saldo },
              { merge: true }
            );

            await renderSaldoBulanKemarinData();

            saveBtn.innerHTML =
              "Berhasil";

            saveBtn.classList.add(
              "success"
            );

            setTimeout(() => {
              saveBtn.disabled =
                false;

              saveBtn.innerHTML =
                "Simpan";

              saveBtn.classList.remove(
                "success",
                "loading"
              );

              overlay.classList.remove(
                "show"
              );

              document.body.classList.remove(
                "popup-open"
              );
            }, 1200);

          } catch (err) {
            console.error(err);

            saveBtn.innerHTML =
              "Gagal";

            saveBtn.classList.add(
              "error"
            );

            setTimeout(() => {
              saveBtn.disabled =
                false;

              saveBtn.innerHTML =
                "Simpan";

              saveBtn.classList.remove(
                "error",
                "loading"
              );
            }, 1500);
          }
        };
    }
  );
}

function openRincianDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);

    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade =
        !existingDB.objectStoreNames.contains("laporanAdmin") ||
        !existingDB.objectStoreNames.contains("users") ||
        !existingDB.objectStoreNames.contains("saldoBulanKemarin");
      existingDB.close();

      const req = indexedDB.open(DB_NAME, needsUpgrade ? currentVersion + 1 : currentVersion);

      req.onupgradeneeded = (ev) => {
        const dbUp = ev.target.result;

        if (!dbUp.objectStoreNames.contains("laporanAdmin")) {
          dbUp.createObjectStore("laporanAdmin", { keyPath: "tanggal" });
          console.log("🗄️ Store laporanAdmin dibuat");
        }

        if (!dbUp.objectStoreNames.contains("users")) {
          dbUp.createObjectStore("users", { keyPath: "uid" });
          console.log("🗄️ Store users dibuat");
        }
        if (!dbUp.objectStoreNames.contains("saldoBulanKemarin")) {
          dbUp.createObjectStore("saldoBulanKemarin", { keyPath: "bulan" });
          console.log("🗄️ Store saldoBulanKemarin dibuat");
        }
        if (!dbUp.objectStoreNames.contains("laporanAdmin")) {
          dbUp.createObjectStore("laporanAdmin", { keyPath: "tanggal" });
          console.log("🗄️ Store laporanAdmin dibuat");
        }     
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };
    checkReq.onerror = () => reject(checkReq.error);
  });
}
async function saveUsersToDB(docs) {
  const dbConn = await openRincianDB();

  if (!dbConn.objectStoreNames.contains("users")) {
    console.warn("⚠️ Store users belum ada, skip");
    return;
  }

  const tx    = dbConn.transaction("users", "readwrite");
  const store = tx.objectStore("users");

  docs.forEach(d => store.put({ tanggal: d.id, ...d.data() }));

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function debugRincianDB() {
  try {
    const dbConn = await openRincianDB();
    if (!dbConn.objectStoreNames.contains(DB_STORE)) { console.warn("⚠️ Store belum ada"); return; }
    const tx  = dbConn.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => {
      const data = req.result || [];
      console.log("📦 rincianPengeluaranDB:", data.length, "record");
      console.table(data);
      data.forEach((item, i) => console.log(`📄 Record ${i + 1}:`, JSON.parse(JSON.stringify(item))));
    };
    req.onerror = () => console.error("❌ Gagal baca:", req.error);
  } catch (err) {
    console.error("❌ debugRincianDB error:", err);
  }
}
async function renderTableFromDB() {
  const tbody = document.getElementById("laporanTbody");
  if (!tbody || !currentDate) return;

  try {
    const dbConn = await openRincianDB();

    if (!dbConn.objectStoreNames.contains(DB_STORE)) {
      renderTableBody([], varianKeys, null, null);
      return;
    }

    const bulan = currentDate.slice(0, 7);

    saldoKemarinGlobal = await getSaldoBulanKemarin(getPreviousMonth(currentDate));

    const tx = dbConn.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();

    req.onsuccess = () => {
      let all = req.result || [];
    
      let dateFrom = null;
      let dateTo   = null;
    
      if (filterRentang.dari && filterRentang.sampai) {
        dateFrom = filterRentang.dari;
        dateTo   = filterRentang.sampai;
    
        all = all.filter(d => {
          const tgl = d.tanggal;
          return tgl >= dateFrom && tgl <= dateTo;
        });
    
      } else {
        all = all.filter(d => d.tanggal?.startsWith(bulan));
      }
    
      renderTableBody(all, varianKeys, dateFrom, dateTo);
      renderTableFooter(all, varianKeys);
    
      // ⬇️ tunggu DOM footer update
      requestAnimationFrame(() => {
        renderAnalisaCard();
      });
    
      setTimeout(() => applyKolomVisibility(), 0);
    };

    req.onerror = () => {
      renderTableBody([], varianKeys, null, null);
    };

  } catch (err) {
    console.error("❌ renderTableFromDB error:", err);
    renderTableBody([], varianKeys, null, null);
  }
}


function setupReloadBtn() {
  const btn = document.getElementById("reloadUsersBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (!currentUid || !currentDate) { console.warn("⚠️ UID atau tanggal belum siap"); return; }

    btn.classList.add("loading");

    try {
      const tanggal = currentDate;
      console.log("🔄 Query Firestore tanggal:", tanggal);

      // 1. getDoc langsung per tanggal — lebih efisien dari query
      const { doc: fsDoc, getDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      const snap = await getDoc(
        fsDoc(db, "users", currentUid, "laporanAdmin", tanggal)
      );

      if (snap.exists()) {
        // Merge dengan stockOpname yang sudah ada di IndexedDB
        const dbConn = await openRincianDB();
        const tx     = dbConn.transaction(DB_STORE, "readwrite");
        const store  = tx.objectStore(DB_STORE);
        const getReq = store.get(tanggal);

        await new Promise((resolve, reject) => {
          getReq.onsuccess = () => {
            const prev    = getReq.result || { tanggal };
            const merged  = {
              ...prev,
              tanggal,
              ...snap.data(),
              // jaga stockOpname dari input lokal — tidak ditimpa Firestore
              stockOpname: {
                ...(snap.data()?.stockOpname  || {}),
                ...(prev.stockOpname          || {}),
              }
            };
            const put = store.put(merged);
            put.onsuccess = () => resolve();
            put.onerror   = () => reject(put.error);
          };
          getReq.onerror = () => reject(getReq.error);
        });

        console.log("✅ laporanAdmin tersimpan:", tanggal);
      } else {
        console.warn("⚠️ Tidak ada data untuk tanggal:", tanggal);
      }

      // 2. Query users createdBy == currentUid
      const qUsers        = query(
        collection(db, "users"),
        where("createdBy", "==", currentUid)
      );
      const snapshotUsers = await getDocs(qUsers);

      if (!snapshotUsers.empty) {
        await saveUsersToDB(snapshotUsers.docs);
        console.log("✅ users tersimpan ke IndexedDB");
      }

      await renderTableFromDB();

    } catch (err) {
      console.error("❌ Reload error:", err);
    } finally {
      btn.classList.remove("loading");
    }
  });
}

function renderTableHeader(keys) {
  const thead = document.getElementById("laporanThead");
  if (!thead) return;

  const mainRow = document.createElement("tr");
  const subRow  = document.createElement("tr");

  // kolom tanggal tidak disembunyikan
  mainRow.innerHTML += `<th rowspan="2" style="min-width:160px">TANGGAL</th>`;
  mainRow.innerHTML += `<th rowspan="2" class="col-expired">EXPIRED</th>`;
  mainRow.innerHTML += `<th rowspan="2" class="col-koki">KOKI</th>`;
  mainRow.innerHTML += `<th rowspan="2" class="col-loyang">LOYANG</th>`;
  mainRow.innerHTML += `<th rowspan="2" class="col-loyang-matcha">LOYANG MATCHA</th>`;

  if (keys.length > 0) {
    const groups = [
      { label: "TARGET",        cls: "col-target"  },
      { label: "INPUT",         cls: "col-input"   },
      { label: "OUTPUT",        cls: "col-output"  },
      { label: "REJECT",        cls: "col-reject"  },
      { label: "FEE",           cls: "col-fee"     },
      { label: "RUSAK FREEZER", cls: "col-rusak"   },
      { label: "BASI FREEZER",  cls: "col-basi"    },
      { label: "PROMOSI",       cls: "col-promosi" },
      { label: "OF FLAVOR",     cls: "col-flavor"  },
      { label: "BARANG HILANG", cls: "col-hilang"  },
      { label: "SALDO BARANG",  cls: "col-saldo"   },
    ];

    groups.forEach(({ label, cls }) => {
      mainRow.innerHTML += `<th colspan="${keys.length}" class="${cls}-group">${label}</th>`;
      keys.forEach(v => subRow.innerHTML += `<th class="${cls}">${v.toUpperCase()}</th>`);
    });
  }

  thead.innerHTML = "";
  thead.appendChild(mainRow);
  thead.appendChild(subRow);
}
const SKIP_FIELDS = new Set([
  "id", "tanggal", "createdBy", "updatedAt", "idCabang",
  "stockOpname", "pengeluaranProduksi", "pengeluaranDistribusi",
  "rincianPengeluaranSync"
]);
// =====================
// STATE FILTER
// =====================
let filterRentang  = { dari: null, sampai: null };
let hiddenKolom    = new Set(); // nama th yang disembunyikan

// =====================
// FILTER RENTANG
// =====================
function positionPopup(popup, btn) {
  const rect = btn.getBoundingClientRect();
  popup.style.top  = `${rect.bottom + 8}px`;
  popup.style.left = `${Math.min(rect.left, window.innerWidth - popup.offsetWidth - 12)}px`;
}

function setupFilterRentang() {
  const btn      = document.getElementById("btnFilterRentang");
  const popup    = document.getElementById("popupRentang");
  const dari     = document.getElementById("rentangDari");
  const sampai   = document.getElementById("rentangSampai");
  const terapkan = document.getElementById("btnRentangTerapkan");
  const reset    = document.getElementById("btnRentangReset");

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = popup.classList.contains("hidden");
    document.getElementById("popupFilterKolom")?.classList.add("hidden");
    document.getElementById("popupFilterKolom")?.classList.remove("show");

    if (isHidden) {
      popup.classList.remove("hidden");
      requestAnimationFrame(() => {
        positionPopup(popup, btn);
        popup.classList.add("show");
      });
    } else {
      popup.classList.remove("show");
      setTimeout(() => popup.classList.add("hidden"), 180);
    }
  });

  terapkan?.addEventListener("click", async () => {
    if (!dari.value || !sampai.value) return;
    filterRentang.dari   = dari.value;
    filterRentang.sampai = sampai.value;
    popup.classList.remove("show");
    setTimeout(() => popup.classList.add("hidden"), 180);
    await renderTableFromDB();
  });

  reset?.addEventListener("click", async () => {
    filterRentang = { dari: null, sampai: null };
    dari.value    = "";
    sampai.value  = "";
    popup.classList.remove("show");
    setTimeout(() => popup.classList.add("hidden"), 180);
    await renderTableFromDB();
  });

  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) {
      popup.classList.remove("show");
      setTimeout(() => popup.classList.add("hidden"), 180);
    }
  });
}


// =====================
// FILTER KOLOM
// =====================
const KOLOM_LIST = [
  "TANGGAL", "EXPIRED", "LOYANG", "LOYANG MATCHA", "KOKI",
  "TARGET", "INPUT", "OUTPUT", "REJECT",
  "FEE", "RUSAK FREEZER", "BASI FREEZER",
  "PROMOSI", "OF FLAVOR", "BARANG HILANG", "SALDO BARANG"
];

function setupFilterKolom() {
  const btn   = document.getElementById("btnFilterKolom");
  const popup = document.getElementById("popupFilterKolom");
  const tutup = document.getElementById("btnKolomTutup");

  const renderChecklist = () => {
    const list = document.getElementById("kolomCheckList");
    list.innerHTML = KOLOM_LIST.map(nama => `
      <label class="kolom-check-item">
        <input type="checkbox" class="kolom-check" value="${nama}"
          ${hiddenKolom.has(nama) ? "" : "checked"} />
        <span>${nama}</span>
      </label>
    `).join("");

    list.querySelectorAll(".kolom-check").forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.checked) hiddenKolom.delete(cb.value);
        else            hiddenKolom.add(cb.value);
        applyKolomVisibility();
      });
    });
  };

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = popup.classList.contains("hidden");
    document.getElementById("popupRentang")?.classList.remove("show");
    setTimeout(() => document.getElementById("popupRentang")?.classList.add("hidden"), 180);

    if (isHidden) {
      renderChecklist();
      popup.classList.remove("hidden");
      requestAnimationFrame(() => {
        positionPopup(popup, btn);
        popup.classList.add("show");
      });
    } else {
      popup.classList.remove("show");
      setTimeout(() => popup.classList.add("hidden"), 180);
    }
  });

  tutup?.addEventListener("click", () => {
    popup.classList.remove("show");
    setTimeout(() => popup.classList.add("hidden"), 180);
  });

  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) {
      popup.classList.remove("show");
      setTimeout(() => popup.classList.add("hidden"), 180);
    }
  });
}

function applyKolomVisibility() {
  const table  = document.querySelector(".laporan-tbl");
  if (!table) return;

  const allRows = table.querySelectorAll("tr");

  allRows.forEach(tr => {
    tr.querySelectorAll("th, td").forEach(cell => {
      const colClass = cell.className;

      // map class ke nama kolom
      const classToNama = {
        "col-expired":  "EXPIRED",
        "col-loyang":   "LOYANG",
        "col-loyang-matcha": "LOYANG MATCHA",
        "col-koki":     "KOKI",
        "col-target":   "TARGET",
        "col-input":    "INPUT",
        "col-output":   "OUTPUT",
        "col-reject":   "REJECT",
        "col-fee":      "FEE",
        "col-rusak":    "RUSAK FREEZER",
        "col-basi":     "BASI FREEZER",
        "col-promosi":  "PROMOSI",
        "col-flavor":   "OF FLAVOR",
        "col-hilang":   "BARANG HILANG",
        "col-saldo":    "SALDO BARANG",
      };

      for (const [cls, nama] of Object.entries(classToNama)) {
        if (cell.classList.contains(cls)) {
          cell.style.display = hiddenKolom.has(nama) ? "none" : "";
        }
      }
    });
  });
}
function renderSaldoKemarin(keys) {
  const grid = document.getElementById("saldoKemarinGrid");
  if (!grid) return;

  grid.innerHTML = keys.map(k => `
    <div class="saldo-kemarin-item">
      <div class="saldo-kemarin-key">${k}</div>
      <div class="saldo-kemarin-val" id="saldoKemarin_${k}">-</div>
    </div>
  `).join("");
}
function hitungPerField(item, keys, accessor) {
  const result = {};
  keys.forEach(k => result[k] = 0);

  Object.entries(item).forEach(([uid, val]) => {
    if (SKIP_FIELDS.has(uid)) return;
    if (typeof val !== "object" || val === null) return;

    const obj = accessor(val);
    if (!obj || typeof obj !== "object") return;

    keys.forEach(k => {
      result[k] += Number(obj[k] || 0);
    });
  });

  return result;
}
function hitungSaldoBerantai(dataList, keys, saldoAwalMap = {}, startDate = null, endDate = null) {
  const result = {};
  let prevSaldo = { ...saldoAwalMap };

  // Buat map data by tanggal
  const dataMap = {};
  dataList.forEach(item => {
    const tgl = item.tanggal || item.id;
    dataMap[tgl] = item;
  });

  // Tentukan range tanggal
  const sorted = [...dataList].sort((a, b) =>
    (a.tanggal || a.id).localeCompare(b.tanggal || b.id)
  );

  if (sorted.length === 0) return result;

  const firstTgl = startDate || sorted[0].tanggal || sorted[0].id;
  const lastTgl  = endDate   || sorted[sorted.length - 1].tanggal || sorted[sorted.length - 1].id;

  // Loop setiap hari dari awal sampai akhir
  const cur = new Date(firstTgl);
  const end = new Date(lastTgl);

  while (cur <= end) {
    const yyyy = cur.getFullYear();
    const mm   = String(cur.getMonth() + 1).padStart(2, "0");
    const dd   = String(cur.getDate()).padStart(2, "0");
    const tgl  = `${yyyy}-${mm}-${dd}`;

    const item  = dataMap[tgl] || {};
    const stock = item.stockOpname || {};

    const input  = stock.produksi    || {};
    const output = Object.keys(item).length ? hitungOutput(item, keys) : {};
    const fee    = Object.keys(item).length ? hitungFee(item, keys)    : {};
    const reject = stock.reject       || {};
    const rusak  = stock.rusakFreezer || {};
    const basi   = stock.basiFreezer  || {};
    const promo  = stock.promosi      || {};
    const hilang = stock.barangHilang || {};
    const ofFlav = Object.keys(item).length ? hitungOfFlavor(item, keys) : {};

    const saldoHariIni = {};

    keys.forEach(k => {
      const prev = Number(prevSaldo[k] || 0);

      const totalMasuk =
        Number(input[k]  || 0);

      const totalKeluar =
        Number(output[k] || 0) +
        Number(fee[k]    || 0) +
        Number(reject[k] || 0) +
        Number(rusak[k]  || 0) +
        Number(basi[k]   || 0) +
        Number(promo[k]  || 0) +
        Number(ofFlav[k] || 0) +
        Number(hilang[k] || 0);

      saldoHariIni[k] = prev + totalMasuk - totalKeluar;
    });

    result[tgl] = saldoHariIni;
    prevSaldo   = saldoHariIni;

    cur.setDate(cur.getDate() + 1);
  }

  return result;
}
async function getSaldoBulanKemarin(bulan) {
  try {
    const { doc, getDoc } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
    );
    const snap = await getDoc(
      doc(db, "users", currentUid, "saldoBulanKemarin", bulan)
    );
    return snap.exists() ? (snap.data()?.saldo || {}) : {};
  } catch (err) {
    console.error("getSaldoBulanKemarin error:", err);
    return {};
  }
}

function hitungOutput(item, keys) {
  return hitungPerField(item, keys, val => val?.pembayaran?.closing);
}

function hitungFee(item, keys) {
  return hitungPerField(item, keys, val => val?.fee);
}

function hitungOfFlavor(item, keys) {
  return hitungPerField(item, keys, val => val?.offFlavor);
}
function renderTableBody(dataList, keys, dateFrom = null, dateTo = null) {
  const tbody = document.getElementById("laporanTbody");
  if (!tbody || !currentDate) return;
  tbody.innerHTML = "";
  const dataMap = {};
  dataList.forEach(item => {
    const key = item.tanggal || item.id;
    dataMap[key] = item;
  });
  let startDate, endDate;
  if (dateFrom && dateTo) {
    startDate = new Date(dateFrom);
    endDate   = new Date(dateTo);
  } else {
    const [yr, mo] = currentDate.split("-").map(Number);
    startDate = new Date(yr, mo - 1, 1);
    endDate   = new Date(yr, mo, 0);
  }

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const yyyy   = d.getFullYear();
    const mm     = String(d.getMonth() + 1).padStart(2, "0");
    const dd     = String(d.getDate()).padStart(2, "0");
    const tglKey = `${yyyy}-${mm}-${dd}`;
    const item  = dataMap[tglKey] || {};
    const stock = item.stockOpname || {};
    const tanggalStr = new Date(
      yyyy,
      d.getMonth(),
      d.getDate()
    ).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    const v = (val) => {
      if (val === undefined || val === null) return "";
      const num = Number(val);
      if (!isNaN(num)) {
        const rounded = Math.round(num);
        return rounded === 0
          ? ""
          : rounded;
      }
      return val;
    };
    const tr = document.createElement("tr");
    tr.innerHTML += `<td>${tanggalStr}</td>`;
    tr.innerHTML += `<td class="col-expired">${v(stock.tanggalExpired)}</td>`;
    tr.innerHTML += `<td class="col-koki">${v(stock.koki)}</td>`;
    tr.innerHTML += `<td class="col-loyang">${v(stock.jumlahLoyang)}</td>`;
    tr.innerHTML += `<td class="col-loyang-matcha">${v(stock.jumlahLoyangMatcha)}</td>`;

    const targetMap = {};
    const loyangNormal = Number(stock.jumlahLoyang || 0);
    const inputCB = Number(stock.produksi?.CB || 0);
    const inputBB = Number(stock.produksi?.BB || 0);
    targetMap.CB = loyangNormal * 230;
    targetMap.BB =
      targetMap.CB -
      inputCB -
      inputBB;
    const inputBK = Number(stock.produksi?.BK || 0);
    const inputMC = Number(stock.produksi?.MC || 0);
    targetMap.BK = (targetMap.BB / 2) * 2.8;
    targetMap.MC =
      inputBK +
      inputMC -
      targetMap.BK;
    keys.forEach(k => {
      tr.innerHTML += `
        <td class="col-target">
          ${v(targetMap[k])}
        </td>
      `;
    });

    // INPUT
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-input">${v(stock.produksi?.[k])}</td>`
    );

    // OUTPUT
    const outputMap = hitungOutput(item, keys);
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-output">${outputMap[k] || ""}</td>`
    );

    // REJECT
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-reject">${v(stock.reject?.[k])}</td>`
    );

    // FEE
    const feeMap = hitungFee(item, keys);
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-fee">${feeMap[k] || ""}</td>`
    );

    // RUSAK FREEZER
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-rusak">${v(stock.rusakFreezer?.[k])}</td>`
    );

    // BASI FREEZER
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-basi">${v(stock.basiFreezer?.[k])}</td>`
    );

    // PROMOSI
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-promosi">${v(stock.promosi?.[k])}</td>`
    );

    // OF FLAVOR
    const ofFlavorMap = hitungOfFlavor(item, keys);
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-flavor">${ofFlavorMap[k] || ""}</td>`
    );

    // BARANG HILANG
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-hilang">${v(stock.barangHilang?.[k])}</td>`
    );
    const fullSortedData = [...dataList].sort((a, b) =>
      (a.tanggal || a.id).localeCompare(b.tanggal || b.id)
    );
    const saldoMap = hitungSaldoBerantai(fullSortedData, keys, saldoKemarinGlobal);
    
    const saldoHariIni = saldoMap[tglKey] || {};
    
    keys.forEach(k =>
      tr.innerHTML += `<td class="col-saldo">${v(saldoHariIni[k])}</td>`
    );

    tbody.appendChild(tr);
  }
}
function renderTableFooter(dataList, keys) {
  const tfoot = document.getElementById("laporanTfoot");
  if (!tfoot) return;

  const stockKeys = [
    "target",
    "produksi",
    "reject",
    "fee",
    "rusakFreezer",
    "basiFreezer",
    "promosi",
    "ofFlavor",
    "barangHilang",
    "saldoBarang"
  ];

  const sumMap = {};
  stockKeys.forEach(group => {
    sumMap[group] = {};
    keys.forEach(k => sumMap[group][k] = 0);
  });

  let totalLoyang = 0;
  let totalLoyangMatcha = 0;

  // ===== HITUNG SEMUA TOTAL =====
  dataList.forEach(item => {
    const stock = item.stockOpname || {};

    totalLoyang += Number(stock.jumlahLoyang || 0);
    totalLoyangMatcha += Number(stock.jumlahLoyangMatcha || 0);

    stockKeys.forEach(group => {
      const obj = stock[group] || {};
      keys.forEach(k => {
        sumMap[group][k] += Number(obj[k] || 0);
      });
    });
  });

  // ===== OUTPUT TOTAL BARIS =====
  const tr = document.createElement("tr");

  tr.innerHTML += `<td class="col-total-label">TOTAL</td>`;
  tr.innerHTML += `<td class="col-total-empty col-expired"></td>`;
  tr.innerHTML += `<td class="col-total-empty col-koki"></td>`;

  // LOYANG NORMAL + MATCHA
  tr.innerHTML += `<td class="col-loyang">${totalLoyang}</td>`;
  tr.innerHTML += `<td class="col-loyang-matcha">${totalLoyangMatcha}</td>`;

  // ===== TARGET (hitung dari semua baris tbody) =====
  const totalTarget = {};
  keys.forEach(k => totalTarget[k] = 0);

  dataList.forEach(item => {
    const stock      = item.stockOpname || {};
    const loyang     = Number(stock.jumlahLoyang || 0);
    const inputCB    = Number(stock.produksi?.CB || 0);
    const inputBB    = Number(stock.produksi?.BB || 0);
    const tCB        = loyang * 230;
    const tBB        = tCB - inputCB - inputBB;
    const inputBK    = Number(stock.produksi?.BK || 0);
    const inputMC    = Number(stock.produksi?.MC || 0);
    const tBK        = (tBB / 2) * 2.8;
    const tMC        = inputBK + inputMC - tBK;

    const tMap = { CB: tCB, BB: tBB, BK: tBK, MC: tMC };
    keys.forEach(k => {
      totalTarget[k] += Number(tMap[k] || 0);
    });
  });

  keys.forEach(k => {
    tr.innerHTML += `<td class="col-target">${Math.round(totalTarget[k]) || ""}</td>`;
  });

  // ===== PRODUKSI =====
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-input">${sumMap.produksi[k]}</td>`;
  });

  // ===== OUTPUT =====
  const totalOutput = {};
  keys.forEach(k => totalOutput[k] = 0);

  dataList.forEach(item => {
    const out = hitungOutput(item, keys);
    keys.forEach(k => totalOutput[k] += out[k]);
  });

  keys.forEach(k => {
    tr.innerHTML += `<td class="col-output">${totalOutput[k]}</td>`;
  });

  // ===== REJECT =====
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-reject">${sumMap.reject[k]}</td>`;
  });

  // ===== FEE =====
  const totalFee = {};
  keys.forEach(k => totalFee[k] = 0);

  dataList.forEach(item => {
    const f = hitungFee(item, keys);
    keys.forEach(k => totalFee[k] += f[k]);
  });

  keys.forEach(k => {
    tr.innerHTML += `<td class="col-fee">${totalFee[k]}</td>`;
  });

  // ===== RUSAK FREEZER =====
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-rusak">${sumMap.rusakFreezer[k]}</td>`;
  });

  // ===== BASI FREEZER =====
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-basi">${sumMap.basiFreezer[k]}</td>`;
  });

  // ===== PROMOSI =====
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-promosi">${sumMap.promosi[k]}</td>`;
  });

  // ===== OF FLAVOR =====
  const totalOfFlavor = {};
  keys.forEach(k => totalOfFlavor[k] = 0);

  dataList.forEach(item => {
    const of = hitungOfFlavor(item, keys);
    keys.forEach(k => totalOfFlavor[k] += of[k]);
  });

  keys.forEach(k => {
    tr.innerHTML += `<td class="col-flavor">${totalOfFlavor[k]}</td>`;
  });

  // ===== BARANG HILANG =====
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-hilang">${sumMap.barangHilang[k]}</td>`;
  });

  // ===== SALDO BARANG (FIX) =====
  const fullSortedData = [...dataList].sort((a, b) =>
    (a.tanggal || a.id).localeCompare(b.tanggal || b.id)
  );
  
  const saldoMap = hitungSaldoBerantai(fullSortedData, keys, saldoKemarinGlobal);
  
  // total saldo (AKUMULASI semua hari)
  const totalSaldo = {};
  keys.forEach(k => totalSaldo[k] = 0);
  
  Object.values(saldoMap).forEach(day => {
    keys.forEach(k => {
      totalSaldo[k] += Number(day[k] || 0);
    });
  });
  
  keys.forEach(k => {
    tr.innerHTML += `<td class="col-saldo">${totalSaldo[k]}</td>`;
  });

  tfoot.innerHTML = "";
  tfoot.appendChild(tr);
}

function getExpiredDate(baseDate, totalDays = 0) {
  if (!baseDate) return "";
  const date = new Date(baseDate);
  date.setDate(date.getDate() + Number(totalDays || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
async function renderPopupStockForm(mode = "main") {
  const body = document.querySelector(".popup-stock-body");
  if (!body) return;

  let kokiList    = [];
  let expiredDays = 0;

  try {
    const { doc, getDoc, collection: col, query: q, where: w, getDocs: gd } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
    );

    const userSnap       = await getDoc(doc(db, "users", currentUid));
    const userData       = userSnap.data() || {};
    const adminCabangUid = userData.createdBy || currentUid;

    const adminSnap = await getDoc(doc(db, "users", adminCabangUid));
    const idCabang  = adminSnap.data()?.idCabang;

    if (idCabang) {
      const cabangSnap = await getDoc(doc(db, "kantorCabang", idCabang));
      expiredDays = Number(cabangSnap.data()?.target?.expired) || 0;
      console.log("🎯 expiredDays:", expiredDays);
    }

    const snap = await gd(q(col(db, "users"), w("createdBy", "==", adminCabangUid), w("role", "==", "produksi")));
    kokiList   = snap.docs.map(d => d.data()?.nama).filter(Boolean);

  } catch (err) {
    console.error("❌ load popup:", err);
  }

  // ambil data existing dari IndexedDB
  let existingData = {};
  try {
    const dbConn = await openRincianDB();
    if (dbConn.objectStoreNames.contains(DB_STORE)) {
      const tx  = dbConn.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(currentDate);
      existingData = await new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result || {});
        req.onerror   = () => resolve({});
      });
    }
    // Fallback ke Firestore kalau IndexedDB kosong
    if (!existingData?.stockOpname) {
      const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const snap = await getDoc(doc(db, "users", currentUid, "laporanAdmin", currentDate));
      if (snap.exists()) {
        existingData = { tanggal: snap.id, ...snap.data() };
        // Simpan ke IndexedDB sekalian
        const dbConn2 = await openRincianDB();
        const tx2     = dbConn2.transaction(DB_STORE, "readwrite");
        tx2.objectStore(DB_STORE).put(existingData);
      }
    }
  } catch (e) {
    console.warn("⚠️ Gagal load existing data:", e);
  }

  const existing    = existingData?.stockOpname || {};
  const expiredDate = getExpiredDate(currentDate, expiredDays);

  console.log("📋 Existing stock opname:", existing);

  // update date text di header popup
  const popupDateText = document.getElementById("popupStockDateText");
  if (popupDateText) popupDateText.textContent = formatTanggalIndonesia(currentDate);

  // helper render group
  const gridGroup = (label, field) => `
    <div class="popup-stock-group">
      <label class="popup-stock-label">${label}</label>
      <div class="popup-stock-grid">
        ${varianKeys.map(k => `
          <input type="number" min="0" class="popup-stock-input"
            placeholder="${k}"
            value="${existing[field]?.[k] ?? ""}" />
        `).join("")}
      </div>
    </div>
  `;

  body.innerHTML = `
    <form id="popupStockForm" class="popup-stock-form">

      <!-- KOKI -->
      <div class="popup-stock-group">
        <label class="popup-stock-label">Koki</label>
        <div class="popup-stock-select-wrap">
          <button type="button" id="popupStockKokiBtn" class="popup-stock-custom-select">
            <span id="popupStockKokiText">${existing.koki || "Pilih koki"}</span>
            <span class="popup-stock-arrow">▾</span>
          </button>
          <div id="popupStockKokiMenu" class="popup-stock-dropdown">
            ${kokiList.map(n => `<button type="button" class="popup-stock-option" data-value="${n}">${n}</button>`).join("")}
            <button type="button" class="popup-stock-option" data-value="lainnya">Lainnya</button>
          </div>
        </div>
        <input type="hidden" id="popupStockKoki" value="${existing.koki || ""}" />
        <input type="text" id="popupStockKokiManual" class="popup-stock-input"
          placeholder="Tulis nama koki" style="display:none" />
      </div>

      <!-- LOYANG -->
      <div class="popup-stock-group">
        <label class="popup-stock-label">Loyang Original</label>
        <input type="number" min="0" class="popup-stock-input"
          placeholder="Jumlah loyang" value="${existing.jumlahLoyang ?? ""}" />
      </div>
      
      <!-- LOYANG MATCHA -->
      <div class="popup-stock-group">
        <label class="popup-stock-label">Loyang Matcha</label>
        <input type="number" min="0" class="popup-stock-input"
          placeholder="Jumlah loyang matcha"
          value="${existing.jumlahLoyangMatcha ?? ""}" />
      </div>

      ${mode === "main" ? `
        ${gridGroup("Produksi", "produksi")}
        ${gridGroup("Reject", "reject")}
      ` : `
        ${gridGroup("Rusak Freezer", "rusakFreezer")}  
        ${gridGroup("Basi Freezer", "basiFreezer")}  
        ${gridGroup("Promosi", "promosi")}
        ${gridGroup("Barang Hilang", "barangHilang")}
      `}

      <!-- EXPIRED -->
      <div class="popup-stock-group">
        <label class="popup-stock-label">Tanggal Expired</label>
        <input type="date" class="popup-stock-input" value="${expiredDate}" readonly />
      </div>

      <button type="button" id="popupStockSaveBtn" class="popup-stock-submit">Simpan</button>

    </form>
  `;

  // ── DROPDOWN KOKI ────────────────────────────
  const kokiBtn    = document.getElementById("popupStockKokiBtn");
  const kokiText   = document.getElementById("popupStockKokiText");
  const kokiMenu   = document.getElementById("popupStockKokiMenu");
  const kokiHidden = document.getElementById("popupStockKoki");
  const kokiManual = document.getElementById("popupStockKokiManual");

  kokiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    kokiMenu.classList.toggle("show");
    kokiBtn.classList.toggle("active");
  });

  document.querySelectorAll(".popup-stock-option").forEach(opt => {
    opt.addEventListener("click", () => {
      const val     = opt.dataset.value;
      const isOther = val === "lainnya";
      kokiText.textContent     = opt.textContent.trim();
      kokiHidden.value         = val;
      kokiMenu.classList.remove("show");
      kokiBtn.classList.remove("active");
      kokiManual.style.display = isOther ? "block" : "none";
      kokiManual.required      = isOther;
      if (!isOther) kokiManual.value = "";
    });
  });

  document.addEventListener("click", (e) => {
    if (!kokiBtn?.contains(e.target) && !kokiMenu?.contains(e.target)) {
      kokiMenu.classList.remove("show");
      kokiBtn.classList.remove("active");
    }
  });

  // ── SAVE BUTTON ──────────────────────────────
  const saveBtn = document.getElementById("popupStockSaveBtn");

  saveBtn.onclick = async () => {
    saveBtn.disabled  = true;
    saveBtn.classList.add("loading");
    saveBtn.innerHTML = `<div class="popup-stock-spinner"></div>`;

    try {
      // koki
      const kokiVal    = kokiHidden.value.trim();
      const kokiManVal = kokiManual.value.trim();
      const koki       = kokiVal === "lainnya" ? kokiManVal : kokiVal;

      // loyang
      const jumlahLoyang = Number(body.querySelector("input[placeholder='Jumlah loyang']")?.value || 0);
      const jumlahLoyangMatcha = Number(body.querySelector("input[placeholder='Jumlah loyang matcha']")?.value || 0);

      // build object hanya key yang terisi > 0
      const buildObj = (label) => {
        const obj = {};
        const group = [...body.querySelectorAll(".popup-stock-group")]
          .find(g => g.querySelector(".popup-stock-label")?.textContent?.trim() === label);
        if (!group) return obj;
        const inputs = group.querySelectorAll("input.popup-stock-input[type='number']");
        varianKeys.forEach((k, i) => {
          const val = Number(inputs[i]?.value);
          if (!isNaN(val) && val > 0) obj[k] = val;
        });
        return obj;
      };

      const produksi     = buildObj("Produksi");
      const reject       = buildObj("Reject");
      const rusakFreezer = buildObj("Rusak Freezer");  
      const basiFreezer  = buildObj("Basi Freezer");  
      const promosi      = buildObj("Promosi");  
      const barangHilang = buildObj("Barang Hilang");

      const tanggalExpired = body.querySelector("input[type='date']")?.value || "";

      // payload
      // payload merge existing
      const stockOpname = { ...(existing || {})};
      if (mode === "main") {
        stockOpname.jumlahLoyang   = jumlahLoyang;
        stockOpname.jumlahLoyangMatcha = jumlahLoyangMatcha;
        stockOpname.koki           = koki;
        stockOpname.tanggalExpired = tanggalExpired;
        if (Object.keys(produksi).length) stockOpname.produksi = produksi;
        if (Object.keys(reject).length) stockOpname.reject = reject;
      }
      if (mode === "plus") {  
        if (Object.keys(rusakFreezer).length) stockOpname.rusakFreezer = rusakFreezer;  
        if (Object.keys(basiFreezer).length) stockOpname.basiFreezer = basiFreezer;  
        if (Object.keys(promosi).length) stockOpname.promosi = promosi;  
        if (Object.keys(barangHilang).length) stockOpname.barangHilang = barangHilang;  
      }
      console.log("📦 Stock opname payload:", JSON.stringify(stockOpname));
      const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

      await setDoc(doc(db, "users", currentUid, "laporanAdmin", currentDate), {
        createdBy: currentUid,
        tanggal:   currentDate,
        updatedAt: serverTimestamp(),
        stockOpname
      }, { merge: true });

      console.log("✅ Firestore tersimpan:", currentDate);

      // Simpan ke IndexedDB — merge dengan data existing
      const dbConn = await openRincianDB();
      const tx     = dbConn.transaction(DB_STORE, "readwrite");
      const store  = tx.objectStore(DB_STORE);
      const getReq = store.get(currentDate);

      await new Promise((resolve, reject) => {
        getReq.onsuccess = () => {
          const prev   = getReq.result || { tanggal: currentDate };
          const merged = {
            ...prev,
            createdBy  : currentUid,
            tanggal    : currentDate,
            updatedAt  : Date.now(),
            stockOpname: {
              ...(prev.stockOpname || {}),
              ...stockOpname
            }
          };
          const put = store.put(merged);
          put.onsuccess = () => resolve();
          put.onerror   = () => reject(put.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });

      console.log("✅ IndexedDB tersimpan:", currentDate);
      await renderTableFromDB();

      saveBtn.classList.remove("loading");
      saveBtn.innerHTML = "Berhasil";
      saveBtn.classList.add("success");

      setTimeout(() => {
        saveBtn.disabled  = false;
        saveBtn.innerHTML = "Simpan";
        saveBtn.classList.remove("success", "error");
        document.getElementById("popupStockOverlay")?.classList.remove("show");
      }, 2000);

    } catch (err) {
      console.error("❌ Save stock opname error:", err);
      saveBtn.classList.remove("loading");
      saveBtn.innerHTML = "Gagal";
      saveBtn.classList.add("error");
      setTimeout(() => {
        saveBtn.disabled  = false;
        saveBtn.innerHTML = "Simpan";
        saveBtn.classList.remove("success", "error");
      }, 2000);
    }
  };
}
function setupInputStockPopup() {
  const btnMain   = document.getElementById("inputStockBtn");
  const btnPlus   = document.getElementById("inputStockPlusBtn");
  const overlay   = document.getElementById("popupStockOverlay");
  const card      = document.getElementById("popupStockCard");
  const closeBtn  = document.getElementById("closePopupStock");
  const dragHandle = document.getElementById("popupStockDrag");
  const content   = card?.querySelector(".popup-detail-content");
  if (!overlay || !card || !dragHandle) return;

  let popupMode = "main";

  const openPopup = async (mode = "main") => {
    popupMode = mode;
    await renderPopupStockForm(mode);
    overlay.classList.add("show");
    document.body.classList.add("popup-open");
    card.style.cssText = "";
  };

  const closePopup = () => {
    overlay.classList.remove("show");
    document.body.classList.remove("popup-open");
    card.style.cssText = "";
  };

  btnMain?.addEventListener("click", () => openPopup("main"));
  btnPlus?.addEventListener("click", () => openPopup("plus"));
  closeBtn?.addEventListener("click", closePopup);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePopup();
  });

  let isDragging = false, offsetX = 0, offsetY = 0;
  dragHandle.addEventListener("mousedown", (e) => {
    if (window.innerWidth <= 768) return;
    isDragging = true;
    const rect = card.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    card.style.position   = "fixed";
    card.style.margin     = "0";
    card.style.transition = "none";
    dragHandle.style.cursor = "grabbing";
    document.body.style.cursor = "grabbing";
  });
  document.addEventListener("mouseup", () => {
    isDragging = false;
    card.style.transition = "";
    dragHandle.style.cursor = "";
    document.body.style.cursor = "";
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    card.style.left = `${e.clientX - offsetX}px`;
    card.style.top  = `${e.clientY - offsetY}px`;
  });

  let startY = 0, currentY = 0, dragging = false;
  dragHandle.addEventListener("touchstart", (e) => {
    if (window.innerWidth > 768) return;
    if ((content?.scrollTop || 0) > 0) return;
    dragging = true;
    startY   = e.touches[0].clientY;
    currentY = startY;
    card.style.transition = "none";
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    const diffY = currentY - startY;
    if (diffY <= 0) return;
    e.preventDefault();
    card.style.transform = `translateY(${diffY}px)`;
  }, { passive: false });
  window.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    const diffY = currentY - startY;
    card.style.transition = "transform .28s cubic-bezier(.22,.61,.36,1)";
    if (diffY > 120) {
      card.style.transform = "translateY(100%)";
      setTimeout(closePopup, 220);
    } else {
      card.style.transform = "translateY(0)";
    }
  });
}

function renderAnalisaCard() {

  const keys = [
    "input","output","fee","rusak","basi","flavor","promosi","hilang","saldo"
  ];

  const labels = {
    input: "INPUT",
    output: "OUTPUT",
    fee: "FEE",
    rusak: "RUSAK FREEZER",
    basi: "BASI FREEZER",
    flavor: "OF FLAVOR",
    promosi: "PROMOSI",
    hilang: "HILANG",
    saldo: "SALDO BARANG"
  };

  const body = document.getElementById("analisaBody");
  if (!body) return;

  body.innerHTML = "";

  // =====================
  // ITEM NORMAL
  // =====================
  keys.forEach(k => {

    let val = 0;

    if (k === "saldo") {
      const saldoEl = document.querySelectorAll("tfoot .col-saldo");
      saldoEl.forEach(el => {
        val += Number(el.textContent || 0);
      });
    } else {
      val = getTotal(k);
    }

    body.innerHTML += `
      <div class="analisa-item ${k === "saldo" ? "saldo-item" : ""}">
        <div class="analisa-label">${labels[k]}</div>
        <div class="analisa-value">${val}</div>
      </div>
    `;
  });

  // =====================
  // KPI BARU: GAGAL DISTRIBUSI
  // =====================

  const totalInput = getTotal("input");

  const barangMati =
    getTotal("fee") +
    getTotal("rusak") +
    getTotal("basi") +
    getTotal("flavor") +
    getTotal("promosi") +
    getTotal("hilang");

  const persen = totalInput > 0
    ? (barangMati / totalInput) * 100
    : 0;

  body.innerHTML += `
    <div class="analisa-item analisa-gagal">
      
      <div class="analisa-label-center">
        Persentase Barang Gagal Terdistribusi
      </div>

      <div class="analisa-big-value">
        ${barangMati} / ${totalInput}
      </div>

      <div class="analisa-percent">
        ${persen.toFixed(2)}%
      </div>

    </div>
  `;
  renderAnalisaChart();
}
let analisaChartInstance = null;
let activeIndex = null;

function renderAnalisaChart() {

  const ctx = document.getElementById("analisaChart");
  if (!ctx) return;

  const labels = [
    "INPUT",
    "OUTPUT",
    "FEE",
    "RUSAK",
    "BASI",
    "OF FLAVOR",
    "PROMOSI",
    "HILANG",
    "SALDO"
  ];

  const keys = [
    "input","output","fee","rusak","basi","flavor","promosi","hilang","saldo"
  ];

  const data = keys.map(k => getTotal(k));

  const totalInput = data[0];

  // update center text
  document.getElementById("chartCenterText").innerHTML =
    `TOTAL INPUT<br><b>${totalInput}</b>`;

  const colors = [
    "#4ade80",
    "#60a5fa",
    "#facc15",
    "#fb7185",
    "#f97316",
    "#a78bfa",
    "#34d399",
    "#f43f5e",
    "#d4b185"
  ];

  if (analisaChartInstance) {
    analisaChartInstance.destroy();
  }

  analisaChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",

      onClick: (evt, elements) => {
        if (!elements.length) return;

        const index = elements[0].index;
        activeIndex = index;

        highlightSlice(index, labels[index], data[index]);
      },

      plugins: {
        legend: {
          display: false
        },
      
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = ctx.raw;
              const percent = totalInput > 0
                ? ((value / totalInput) * 100).toFixed(1)
                : 0;
      
              return `${ctx.label}: ${value} (${percent}%)`;
            }
          }
        }
      }
    }
  });
}
function highlightSlice(index, label, value) {

  // reset semua highlight table
  document.querySelectorAll(".laporan-tbl td.highlight")
    .forEach(el => el.classList.remove("highlight"));

  const classMap = {
    0: "col-input",
    1: "col-output",
    2: "col-fee",
    3: "col-rusak",
    4: "col-basi",
    5: "col-flavor",
    6: "col-promosi",
    7: "col-hilang",
    8: "col-saldo"
  };

  const cls = classMap[index];
  if (!cls) return;

  document.querySelectorAll(`.${cls}`)
    .forEach(el => el.classList.add("highlight"));

  // update center text
  document.getElementById("chartCenterText").innerHTML =
    `${label}<br><b>${value}</b>`;
}
function getTotal(key){
  const el = document.querySelector(`tfoot .col-${key}`);
  return el ? Number(el.textContent) || 0 : 0;
}