import { auth, db } from "./index.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, collectionGroup, getDocs, query, where, documentId, doc, getDoc, updateDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(
  auth,
  async user => {
    if (!user) {return;}

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

      const skeleton =
        document.getElementById(
          "pageSkeleton"
        );

      if (skeleton) {
        skeleton.style.opacity = "0";

        setTimeout(() => {
          skeleton.remove();
        }, 300);
      }

    }
  }
);

const DB_NAME    = "laporanDistribusiDB";
const STORE_USERS = "users";
const STORE_LAPORAN_ADMIN = "laporanAdmin";
const STORE_KANTOR_CABANG = "kantorCabang";

const DB_NAME_LAPORAN = "appAdminCabangDB";
const STORE_DATA_HARIAN = "dataHarian";

let selectedKurirUid = null;
let usersCache = [];
let laporanFilter = "all";
let _dragActive   = false;
let _dragOffsetX  = 0;
let _dragOffsetY  = 0;

function openDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);

    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   =
        !existingDB.objectStoreNames.contains(STORE_USERS) ||
        !existingDB.objectStoreNames.contains(STORE_KANTOR_CABANG) ||
        !existingDB.objectStoreNames.contains(STORE_LAPORAN_ADMIN);

      existingDB.close();

      const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;
      const req = indexedDB.open(DB_NAME, targetVersion);

      req.onupgradeneeded = (ev) => {
        const dbUp = ev.target.result;

        if (!dbUp.objectStoreNames.contains(STORE_USERS)) {
          const store = dbUp.createObjectStore(STORE_USERS, { keyPath: "uid" });
          store.createIndex("createdBy", "createdBy", { unique: false });
          console.log("🗄️ Store users dibuat");
        }

        if (!dbUp.objectStoreNames.contains(STORE_KANTOR_CABANG)) {
          dbUp.createObjectStore(STORE_KANTOR_CABANG, { keyPath: "id" });
          console.log("🗄️ Store kantorCabang dibuat");
        }

        if (!dbUp.objectStoreNames.contains(STORE_LAPORAN_ADMIN)) {
          const store = dbUp.createObjectStore(STORE_LAPORAN_ADMIN, { keyPath: "tanggal" });
          store.createIndex("tanggal", "tanggal", { unique: true });
          console.log("🗄️ Store laporanAdmin dibuat");
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
  return new Promise(
    (resolve, reject) => {
    const tx =
      db.transaction(STORE_KANTOR_CABANG, "readwrite");
    const store = tx.objectStore(STORE_KANTOR_CABANG);
    store.put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    const tx = db.transaction(STORE_KANTOR_CABANG, "readonly");
    const store = tx.objectStore(STORE_KANTOR_CABANG);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result?.[0] || null);
    req.onerror = () => reject(req.error);
  });
}
async function getDataHarianFromDB(uidKurir, tanggal) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME_LAPORAN);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE_DATA_HARIAN, "readonly");
      const store = tx.objectStore(STORE_DATA_HARIAN);
      const id = `${uidKurir}_${tanggal}`;
      const getReq = store.get(id);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getDetailAmplopDistribusi() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_LAPORAN_ADMIN, "readonly");
    const store = tx.objectStore(STORE_LAPORAN_ADMIN);
    let tanggal =
      document.getElementById("dateFilterInput")?.value;
    if (!tanggal) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      tanggal = `${yyyy}-${mm}-${dd}`;
    }
    return new Promise(resolve => {
        const req = store.get(tanggal);
        req.onsuccess = () => {
            const laporan = req.result;
            if (!laporan) {
              resolve({
                grossMargin: 0,
                pengeluaranKurir: 0,
                pengeluaranDistribusi: 0,
                amplopDistribusi: 0
              });
              return;
            }
            let grossMargin = 0;
            let pengeluaranKurir = 0;
            Object.values(laporan ?.data || {})
            .forEach(kurir => {
                const keuangan =
                  kurir
                  ?.distribusi
                  ?.keuangan;
                grossMargin +=
                  Number(keuangan ?.grossMargin) || 0;
                pengeluaranKurir +=
                  (Number(keuangan ?.kasbon) || 0) +
                  (Number(keuangan ?.klaimInsentif) || 0);
              }
            );
            const pengeluaran =
              laporan
              ?.data
              ?.pengeluaranDistribusi;
            const perbaikan =
              pengeluaran
              ?.perbaikanPeralatan
              || [];
            const lainnya =
              pengeluaran
              ?.lainnya
              || [];
            const upahHunter =
              Number(
                pengeluaran
                ?.customerBaruHunter
                ?.upahHunter
              ) || 0;
            const totalPerbaikan =
              perbaikan.reduce(
                (total, item) => total + (
                    Number(item ?.harga) || 0
                  ),
                0
              );
            const totalLainnya = lainnya.reduce(
              (total, item) => total + (
                    Number(item ?.harga) || 0
                  ),
                0
              );
            const pengeluaranDistribusi =
              totalPerbaikan +
              totalLainnya +
              upahHunter;
            const amplopDistribusi =
              grossMargin -
              pengeluaranKurir -
              pengeluaranDistribusi;
            resolve({
              grossMargin,
              pengeluaranKurir,
              pengeluaranDistribusi,
              amplopDistribusi
            });
          };
        req.onerror = () =>
            resolve({
              grossMargin: 0,
              pengeluaranKurir: 0,
              pengeluaranDistribusi: 0,
              amplopDistribusi: 0
            });
      }
    );
  } catch {
    return {
      grossMargin: 0,
      pengeluaranKurir: 0,
      pengeluaranDistribusi: 0,
      amplopDistribusi: 0
    };
  }
}
async function getDetailAmplopProduksi() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_LAPORAN_ADMIN, "readonly");
    const store = tx.objectStore(STORE_LAPORAN_ADMIN);
    let tanggal = document.getElementById("dateFilterInput")?.value;
    if (!tanggal) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      tanggal = `${yyyy}-${mm}-${dd}`;
    }
    return new Promise(
      resolve => {
        const req = store.get(tanggal);
        req.onsuccess = () => {
          const laporan = req.result;
          if (!laporan) {
            resolve({
              pembayaranKurir: 0,
              pengeluaranProduksi: 0
            }); return;
          }
          let pembayaranKurir = 0;
          Object.values(laporan?.data || {}).forEach(
            item => {
            pembayaranKurir += Number(
                item
                ?.pembayaran
                ?.nota
                ?.bayar
              ) || 0;
          });
          const produksi = laporan ?.data ?.pengeluaranProduksi || {};
          const fixCost = produksi ?.fixCost || {};
          const marginalCost = produksi ?.marginalCost || {};
          const variableCost = produksi ?.variableCost || {};
          const totalFixCost = Object.values(fixCost).reduce((total, value) => total + (Number(value) || 0), 0);
          const totalMarginalCost =
            Object.values(marginalCost).reduce(
              (total, item) =>
                total + (
                  Number(item?.total) || 0
                ),
              0
            );
          
          const totalVariableCost =
            Object.values(variableCost).reduce(
              (total, item) =>
                total + (
                  Number(item?.total) || 0
                ),
              0
            );
          const pengeluaranProduksi =
            totalFixCost +
            totalMarginalCost +
            totalVariableCost;
          const amplopProduksi =
            pembayaranKurir -
            pengeluaranProduksi;
          resolve({
            pembayaranKurir,
            pengeluaranProduksi,
            amplopProduksi
          });
        };
        req.onerror = () => resolve({
              pembayaranKurir: 0,
              pengeluaranProduksi: 0,
              amplopProduksi: 0
            });
      }
    );
  } catch {
    return {
      pembayaranKurir: 0,
      pengeluaranProduksi: 0,
      amplopProduksi: 0
    };
  }
}

function initCalendar() {
  const monthYear = document.getElementById("calendarMonthYear");
  const datesWrap = document.getElementById("calendarDates");
  const dateBtn   = document.getElementById("dateFilterBtn");
  const dateInput = document.getElementById("dateFilterInput");
  const bulan = [
    "Januari","Februari","Maret","April","Mei","Juni",
    "Juli","Agustus","September","Oktober","November","Desember"
  ];
  let selectedDate = new Date();
  renderCalendar(selectedDate);
  dateBtn.addEventListener("click", () => dateInput.showPicker());
  dateInput.addEventListener("change", async e => {
    selectedDate = new Date(e.target.value);
    renderCalendar(selectedDate);
    console.log("Tanggal:", e.target.value);
    if (selectedKurirUid) {
      await renderReport(selectedKurirUid);
    }
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
      const el =
        document.createElement("div");
      el.className =
        "calendar-date-item";
      el.textContent =
        day;
      if (day === activeDay) {
        el.classList.add(
          "active"
        );
      }
      el.addEventListener(
        "click",
        async () => {
          selectedDate =
            new Date(
              year,
              month,
              day
            );
          const yyyy =
            selectedDate
              .getFullYear();
          const mm =
            String(
              selectedDate.getMonth() + 1
            ).padStart(2, "0");
          const dd =
            String(day)
            .padStart(2, "0");
          const tanggal =
            `${yyyy}-${mm}-${dd}`;
          dateInput.value =
            tanggal;
          renderCalendar(
            selectedDate
          );
          console.log(
            "Tanggal:",
            tanggal
          );
          if (
            selectedKurirUid
          ) {
            await renderReport(
              selectedKurirUid
            );
          }
        }
      );
      datesWrap.appendChild(el);
    };
    if (isMobile) {
      let start = activeDay - 3;
      let end   = activeDay + 3;
      if (start < 1)          { end += (1 - start); start = 1; }
      if (end > totalDays)    { start -= (end - totalDays); end = totalDays; if (start < 1) start = 1; }
      for (let day = start; day <= end; day++) makeItem(day);
      return;
    }
    /* DESKTOP — grid penuh */
    for (let i = 0; i < firstDay; i++) datesWrap.appendChild(document.createElement("div"));
    for (let day = 1; day <= totalDays; day++) makeItem(day);
  }
}
function setupReloadButton() {
  const userBtn   = document.getElementById("reloadUsersBtn");
  const laporanBtn = document.getElementById("reloadLaporanBtn");
  if (userBtn)    userBtn.addEventListener("click", reloadUsers);
  if (laporanBtn) laporanBtn.addEventListener("click", reloadLaporanAdmin);

  // Filter dropdown
  const filterBtn      = document.getElementById("laporanFilterBtn");
  const filterDropdown = document.getElementById("laporanFilterDropdown");

  if (filterBtn && filterDropdown) {
    // Restore state
    filterDropdown.querySelectorAll(".laporan-filter-item").forEach(item => {
      item.classList.toggle("active", item.dataset.filter === laporanFilter);
    });
    filterBtn.textContent = {
      all:    "Semua ⌄",
      until:  "S/d Aktif ⌄",
      active: "Aktif ⌄"
    }[laporanFilter] || "Filter ⌄";

    filterBtn.addEventListener("click", e => {
      e.stopPropagation();
      filterDropdown.classList.toggle("show");
    });

    document.addEventListener("click", () => {
      filterDropdown.classList.remove("show");
    });

    filterDropdown.querySelectorAll(".laporan-filter-item").forEach(item => {
      item.addEventListener("click", async () => {
        laporanFilter = item.dataset.filter;
        filterDropdown.querySelectorAll(".laporan-filter-item")
          .forEach(el => el.classList.remove("active"));
        item.classList.add("active");
        filterBtn.textContent = {
          all:    "Semua ⌄",
          until:  "S/d Aktif ⌄",
          active: "Aktif ⌄"
        }[laporanFilter];
        filterDropdown.classList.remove("show");
        await renderLaporanTanggalTable();
      });
    });
      // Export dropdown
    const exportBtn      = document.getElementById("laporanExportBtn");
    const exportDropdown = document.getElementById("laporanExportDropdown");
    const csvBtn         = document.getElementById("exportCsvBtn");
    const pdfBtn         = document.getElementById("exportPdfBtn");
  
    if (exportBtn && exportDropdown) {
      exportBtn.addEventListener("click", e => {
        e.stopPropagation();
        exportDropdown.classList.toggle("show");
      });
      document.addEventListener("click", () => {
        exportDropdown.classList.remove("show");
      });
    }
  
    if (csvBtn) {
      csvBtn.addEventListener("click", () => {
        exportDropdown.classList.remove("show");
        exportTableToCSV();
      });
    }
  
    if (pdfBtn) {
      pdfBtn.addEventListener("click", () => {
        exportDropdown.classList.remove("show");
        exportTableToPDF();
      });
    }
  }
}
function setupInputPengeluaran() {
  const openBtn = document.getElementById("openPengeluaranBtn");
  const overlay = document.getElementById("popupPengeluaranOverlay");
  const closeBtn = document.getElementById("closePengeluaranBtn");
  const addPerbaikanBtn = document.getElementById("addPerbaikanBtn");
  const addLainnyaBtn = document.getElementById("addLainnyaBtn");
  const perbaikanContainer = document.getElementById("perbaikanContainer");
  const lainnyaContainer = document.getElementById("lainnyaContainer");
  const cekCustomerHunterBtn = document.getElementById("cekCustomerHunterBtn");
  const upahHunterStatus = document.getElementById("upahHunterStatus");
  const savePengeluaranBtn = document.getElementById("savePengeluaranBtn");
    
  let customerHunterData =
  { customer: 0, upahHunter: 0 };  
  function updateSaveButtonState() {
    if (
      !savePengeluaranBtn
    ) return;
    const semuaInput =
      [
        ...document.querySelectorAll(
          "#perbaikanContainer .pengeluaran-row, #lainnyaContainer .pengeluaran-row"
        )
      ];
    const adaInput =
      semuaInput.some(
        row => {
          const nama =
            row
            .querySelector(".pengeluaran-input")
            ?.value
            ?.trim();
          const harga =
            row
            .querySelector(".pengeluaran-harga")
            ?.value
            ?.trim();
          return (nama || harga);
        }
      );
    const adaHunter =
      customerHunterData
        .upahHunter > 0;
    const bolehSimpan =
      adaInput ||
      adaHunter;
    savePengeluaranBtn.disabled =
      !bolehSimpan;
    savePengeluaranBtn.style.opacity =
      bolehSimpan
        ? "1"
        : ".55";
    savePengeluaranBtn.style.pointerEvents =
      bolehSimpan
        ? "auto"
        : "none";
  }  
  if (
    !openBtn ||
    !overlay
  ) return;
  function resetPopupPengeluaran() {
    perbaikanContainer.innerHTML =
      "";
    lainnyaContainer.innerHTML =
      "";
    customerHunterData =
    {
      customer: 0,
      upahHunter: 0
    };
    upahHunterStatus.textContent =
      "Belum dicek";
    updateSaveButtonState();
  }
  async function loadPengeluaranHistory() {
    try {
      resetPopupPengeluaran();
      let tanggal =
        document.getElementById("dateFilterInput")?.value;
      if (!tanggal) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm =
          String(
            now.getMonth() + 1
          ).padStart(
            2,
            "0"
          );
        const dd =
          String(
            now.getDate()
          ).padStart(
            2,
            "0"
          );
        tanggal =
          `${yyyy}-${mm}-${dd}`;
      }
      const uidAdmin =
        auth.currentUser?.uid;
      if (!uidAdmin)
        return;
      const laporanRef =
        doc(
          db,
          "users",
          uidAdmin,
          "laporanAdmin",
          tanggal
        );
      const snap =
        await getDoc(
          laporanRef
        );
      if (
        !snap.exists()
      ) return;
      const data = snap.data();
      const pengeluaran =
        data
        ?.pengeluaranDistribusi;
      if (!pengeluaran) return;
      const perbaikan =
        pengeluaran
        ?.perbaikanPeralatan
        || [];
      perbaikan.forEach(
        item => {
          const row = createRow("Input perbaikan");
          row.querySelector(
            ".pengeluaran-input"
          ).value =
            item.nama || "";
          row.querySelector(
            ".pengeluaran-harga"
          ).value =
            Number(
              item.harga || 0
            ).toLocaleString(
              "id-ID"
            );
          perbaikanContainer
            .appendChild(
              row
            );
        }
      );
      const lainnya =
        pengeluaran
        ?.lainnya
        || [];
      lainnya.forEach(
        item => {
          const row = createRow("Input lainnya");
          row.querySelector(
            ".pengeluaran-input"
          ).value =
            item.nama || "";
          row.querySelector(
            ".pengeluaran-harga"
          ).value =
            Number(
              item.harga || 0
            ).toLocaleString(
              "id-ID"
            );
          lainnyaContainer
            .appendChild(
              row
            );
        }
      );
      const hunter =
        pengeluaran
        ?.customerBaruHunter;
      if (hunter) {
        customerHunterData =
        {
          customer: hunter.customer || 0,
          upahHunter: hunter.upahHunter || 0
        };
        if (hunter.customer > 0) {
          upahHunterStatus.innerHTML =
            `
            <div
              style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                width:100%;
                gap:12px;
              "
            >
              <span>
                (${Number(
                  hunter.customer
                ).toLocaleString(
                  "id-ID"
                )} Customer)
              </span>
              <span style="font-weight:700; color:#2d2d2d;">
                ${Number(
                  hunter.upahHunter
                ).toLocaleString(
                  "id-ID"
                )}
              </span>
            </div>
            `;
        }
      }
      updateSaveButtonState();
    } catch (
      err
    ) {
      console.error("Gagal load history pengeluaran:", err);
    }
  }
  async function openPopup() {
    overlay.classList.add("show");
    const subtitle = document.getElementById("popupPengeluaranSubtitle");
    let tanggal = document.getElementById("dateFilterInput")?.value;
    if (!tanggal) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(
          2,
          "0"
        );
      const dd = String(now.getDate()).padStart(
          2,
          "0"
        );
      tanggal = `${yyyy}-${mm}-${dd}`;
    }
    if (
      subtitle &&
      tanggal
    ) {
      const date = new Date(tanggal);
      subtitle.textContent = date.toLocaleDateString(
          "id-ID",
          {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
          }
        );
    }
    await loadPengeluaranHistory();
  }
  function closePopup() {
    overlay.classList.remove("show");
  }
  function formatRupiah(value) {
    return value
      .replace(/\D/g, "")
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  function createRow(placeholder) {
    const row = document.createElement("div");
    row.className = "pengeluaran-row";
    row.innerHTML =
      `
      <input class="pengeluaran-input" type="text" placeholder="${placeholder}">
      <input class="pengeluaran-harga" type="text" inputmode="numeric" placeholder="Harga">
      `;
    const hargaInput =
      row.querySelector(".pengeluaran-harga");
    hargaInput
      ?.addEventListener("input", () => {
          hargaInput.value =
          formatRupiah(hargaInput.value);
        }
      );
    const namaInput =
      row.querySelector(".pengeluaran-input");
    namaInput
      ?.addEventListener("input",
        updateSaveButtonState
      );
    hargaInput
      ?.addEventListener("input", () => {
          hargaInput.value =
            formatRupiah(hargaInput.value);
          updateSaveButtonState();
        }
      );
    return row;
  }
  document
    .querySelectorAll(".pengeluaran-harga")
    .forEach(input => {
      input.addEventListener("input", () => {
          input.value =
            formatRupiah(input.value);
          updateSaveButtonState();
        }
      );
    });
  addPerbaikanBtn
    ?.addEventListener("click", () => {
        perbaikanContainer
          ?.appendChild(
            createRow("Input perbaikan")
          );
      }
    );
  addLainnyaBtn
    ?.addEventListener("click", () => {
        lainnyaContainer
          ?.appendChild(
            createRow("Input lainnya")
          );
      }
    );
  cekCustomerHunterBtn
    ?.addEventListener("click", async () => {
        const originalBtnText =
          cekCustomerHunterBtn.innerHTML;
        try {
          cekCustomerHunterBtn.disabled = true;
          cekCustomerHunterBtn.innerHTML =
            `
            <span style=" display:flex; align-items:center; justify-content:center; gap:10px;">
              <span class="btn-loading-spinner"></span>
              Checking...
            </span>
            `;
          upahHunterStatus.textContent =
            "Checking...";
          await new Promise(
            resolve =>
              setTimeout(resolve, 1500)
          );
          let tanggal =
            document.getElementById("dateFilterInput")?.value;
          if (!tanggal) {
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const dd = String(now.getDate()).padStart(2, "0");
            tanggal = `${yyyy}-${mm}-${dd}`;
          }
          console.log("Tanggal query:", tanggal);
          const kantorCabang = await getKantorCabangFromDB();
          const idCabang = kantorCabang?.id;
          if (!idCabang) {
            console.log("idCabang tidak ditemukan");
            upahHunterStatus.textContent = "Tidak ada";
            return;
          }
          const users = await getUsersFromDB();
          const hunters =
            users.filter(
              user =>
                user.role ===
                "hunter"
            );
          console.log("Hunter ditemukan:", hunters.length);
          let totalCustomer = 0;
          for (const hunter of hunters) {
            const q =
              query(
                collectionGroup(db, "customerBaruHunter"),
                where("tanggal", "==", tanggal),
                where("idCabang", "==", idCabang),
                where("createdBy", "==", hunter.uid)
              );
            const snap = await getDocs(q);
            const total = snap.size;
            console.log(
              `Hunter ${
                hunter.nama ||
                hunter.uid
              }:`,
              total
            );
            totalCustomer += total;
          }
          console.log("TOTAL CUSTOMER BARU:", totalCustomer);
          const upahPerCustomer =
            Number(kantorCabang?.upahHunter || 0);
          const totalUpah =
            totalCustomer *
            upahPerCustomer;
            customerHunterData =
            {
              customer:
                totalCustomer,
              upahHunter:
                totalUpah
            };
            updateSaveButtonState();
          const formatNumber =
            number =>
              Number(number)
              .toLocaleString(
                "id-ID"
              );
          if (totalCustomer > 0) {
            upahHunterStatus.innerHTML =
              `
              <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:12px;">
                <span>
                  (${formatNumber(totalCustomer)} Customer)
                </span>
                <span style="font-weight:700; color:#2d2d2d;">
                  ${formatNumber(totalUpah)}
                </span>
              </div>
              `;
          } else {
            upahHunterStatus.textContent = "Tidak ada";
            customerHunterData =
            {
              customer: 0,
              upahHunter: 0
            };
            updateSaveButtonState();              
          }
        } catch (err) {
          console.error("Gagal cek customer hunter:", err);
          upahHunterStatus.textContent = "Gagal memuat";
        } finally {
          cekCustomerHunterBtn.disabled =
            false;
          cekCustomerHunterBtn.innerHTML =
            originalBtnText;
        }
      }
    );
  savePengeluaranBtn
    ?.addEventListener(
      "click",
      async () => {
        const originalText =
          savePengeluaranBtn.innerHTML;
        try {
          savePengeluaranBtn.disabled = true;
          savePengeluaranBtn.innerHTML =
            `
            <span style="display:flex; align-items:center; justify-content:center; gap:10px;">
              <span class="btn-loading-spinner"></span>
              Menyimpan...
            </span>
            `;
          await new Promise(
            resolve =>
              setTimeout(resolve, 1500)
          );
          let tanggal =
            document.getElementById("dateFilterInput")?.value;
          if (!tanggal) {
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm =
              String(now.getMonth() + 1).padStart(2, "0");
            const dd =
              String(now.getDate()).padStart(2, "0");
            tanggal = `${yyyy}-${mm}-${dd}`;
          }
          const ambilRows = container => {
              return [
                ...container.querySelectorAll(
                  ".pengeluaran-row"
                )
              ]
              .map(row => {
                const nama =
                  row.querySelector(".pengeluaran-input")
                  ?.value
                  ?.trim();
                const hargaRaw =
                  row.querySelector(".pengeluaran-harga")
                  ?.value
                  ?.trim();
                const harga =
                  Number(
                    hargaRaw
                    ?.replaceAll(
                      ".",
                      ""
                    ) || 0
                  );
                if (
                  !nama &&
                  !harga
                ) return null;
                return {
                  nama,
                  harga
                };
              })
              .filter(Boolean);
            };
          const perbaikan = ambilRows(perbaikanContainer);
          const lainnya = ambilRows(lainnyaContainer);
          const semuaRows =
            [
              ...perbaikanContainer.querySelectorAll(
                ".pengeluaran-row"
              ),
              ...lainnyaContainer.querySelectorAll(
                ".pengeluaran-row"
              )
            ];
          const adaHargaKosong = semuaRows.some(row => {
                const nama =
                  row.querySelector(".pengeluaran-input")
                  ?.value
                  ?.trim();
                const harga =
                  row.querySelector(".pengeluaran-harga")
                  ?.value
                  ?.trim();
                return (
                  nama &&
                  !harga
                );
              }
            );
          if (adaHargaKosong) {
            const warningOverlay = document.getElementById("warningTargetOverlay");
            const warningTitle = warningOverlay?.querySelector(".warning-omset-title");
            const warningSubtitle = warningOverlay?.querySelector(".warning-omset-subtitle");
            const btnCekLagi = document.getElementById("btnCekLagiTarget");
            if (warningTitle) {
              warningTitle.textContent = "Harga belum di isi";
            }
            if (warningSubtitle) {
              warningSubtitle.textContent =
                "Masih ada input pengeluaran yang belum memiliki harga.";
            }
            warningOverlay ?.classList.add("show");
            btnCekLagi.onclick =
              () => {
                warningOverlay
                  ?.classList.remove("show");
              };
            savePengeluaranBtn.disabled = false;
            savePengeluaranBtn.innerHTML = originalText;
            return;
          }
          const adaDataPengeluaran =
            perbaikan.length > 0 ||
            lainnya.length > 0;
          const adaHunter =
            customerHunterData
            ?.customer > 0;
          if (
            !adaDataPengeluaran &&
            !adaHunter
          ) {
            savePengeluaranBtn.disabled = false;
            savePengeluaranBtn.innerHTML = originalText;
            return;
          }
          const uidAdmin =
            auth.currentUser?.uid;
          if (!uidAdmin) {
            savePengeluaranBtn.innerHTML = "Belum login";
            return;
          }
          const laporanRef =
            doc(
              db,
              "users",
              uidAdmin,
              "laporanAdmin",
              tanggal
            );
          const laporanSnap =
            await getDoc(laporanRef);
          if (!laporanSnap.exists()) {
            savePengeluaranBtn.innerHTML = "Belum ada data";
            return;
          }
          const pengeluaranDistribusi = {
            perbaikanPeralatan:
              perbaikan,
          
            lainnya:
              lainnya,
          
            customerBaruHunter: {
              customer:
                customerHunterData
                  ?.customer || 0,
          
              upahHunter:
                customerHunterData
                  ?.upahHunter || 0
            }
          };
          
          // ── SAVE LAPORAN ──
          await updateDoc(
            laporanRef,
            {
              pengeluaranDistribusi,
              updatedAt:
                serverTimestamp()
            }
          );
          
          // ── UPDATE SYNC VERSION ──
          try {
          
            const userRef = doc(
              db,
              "users",
              uidAdmin
            );
          
            const userSnap =
              await getDoc(
                userRef
              );
          
            const currentVersion =
              userSnap.data()
              ?.rincianPengeluaranSync
              ?.version || 0;
          
            await updateDoc(
              userRef,
              {
                rincianPengeluaranSync:
                {
                  updatedAt:
                    serverTimestamp(),
          
                  version:
                    currentVersion + 1
                }
              }
            );
            try {
              const users = await getUsersFromDB();
            
              const updatedUsers = users.map(u => {
                if (u.uid === uidAdmin) {
                  return {
                    ...u,
                    rincianPengeluaranSync: {
                      updatedAt: Date.now(),
                      version: currentVersion + 1
                    }
                  };
                }
                return u;
              });
            
              await saveUsersToDB(updatedUsers);
            
              console.log("💾 IndexedDB users sync updated");
            } catch (err) {
              console.error("❌ gagal update indexedDB users:", err);
            }          
            console.log(
              "✅ sync version updated:",
              currentVersion + 1
            );
          
          } catch (syncErr) {
          
            console.error(
              "❌ update sync gagal:",
              syncErr
            );
          }
          
          // ── UPDATE INDEXED DB ──
          try {
          
            const oldLocal =
              await getLaporanAdminFromDB(
                tanggal
              );
          
            await saveLaporanAdminToDB(
              tanggal,
              {
                ...(oldLocal?.data || {}),
          
                pengeluaranDistribusi,
          
                updatedAt:
                  Date.now()
              }
            );
          
            console.log(
              "💾 indexeddb updated"
            );
          
          } catch (dbErr) {
          
            console.error(
              "❌ indexeddb gagal:",
              dbErr
            );
          }
          savePengeluaranBtn.innerHTML = "Berhasil ✓";
        } catch (err) {
          console.error("Gagal simpan pengeluaran:", err);
          savePengeluaranBtn.innerHTML = "Gagal menyimpan";
        } finally {
          setTimeout(
            () => {
              savePengeluaranBtn.disabled = false;
              savePengeluaranBtn.innerHTML = originalText;
            },
            1800
          );
        }
      }
    );
  updateSaveButtonState();
  const warningOverlay =
    document.getElementById("warningTargetOverlay");
  warningOverlay
    ?.addEventListener("click", e => {
        if (e.target === warningOverlay) {
          warningOverlay.classList.remove("show");
        }
      }
    );
  // Desktop drag pengeluaran
  (function setupDragPengeluaran() {
    if (window.innerWidth <= 768) return;
    const box    = document.getElementById("popupPengeluaranBox");
    const header = box?.querySelector(".popup-detail-header");
    if (!box || !header) return;

    let dragging = false;
    let offsetX  = 0;
    let offsetY  = 0;

    header.style.cursor = "grab";

    function onDown(e) {
      if (e.target.closest("button")) return;
      dragging = true;
      const rect  = box.getBoundingClientRect();
      box.style.position  = "fixed";
      box.style.margin    = "0";
      box.style.right     = "auto";
      box.style.transform = "none";
      box.style.left      = rect.left + "px";
      box.style.top       = rect.top  + "px";
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      header.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    function onMove(e) {
      if (!dragging) return;
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth  - box.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - box.offsetHeight));
      box.style.left = x + "px";
      box.style.top  = y + "px";
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      header.style.cursor = "grab";
      document.body.style.userSelect = "";
    }

    header.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  })();
  openBtn.addEventListener("click", openPopup);
  closeBtn ?.addEventListener("click", closePopup);
  overlay.addEventListener("click", e => {
      if (e.target === overlay) {
        closePopup();
      }
    }
  );
  (function setupSwipeClosePengeluaran() {
    const box =
      document.getElementById("popupPengeluaranBox");
    if (!box) return;
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    box.addEventListener("touchstart", e => {
        if (
          window.innerWidth >
          768
        ) return;
        const scrollTop = box.scrollTop;
        if (
          scrollTop > 10
        ) return;
    
        startY = e.touches[0].clientY;
        currentY = startY;
        isDragging = true;
        box.style.transition = "none";
      },
      {
        passive: true
      }
    );
    box.addEventListener("touchmove", e => {
        if (
          !isDragging ||
          window.innerWidth >
          768
        ) return;
        currentY = e.touches[0].clientY;
        const deltaY =
          currentY -
          startY;
        if (
          deltaY < 0
        ) return;
        box.style.transform = `translateY(${deltaY * .9}px)`;
      },
      {
        passive: true
      }
    );
    box.addEventListener("touchend", () => {
        if (
          !isDragging ||
          window.innerWidth >
          768
        ) return;
        isDragging = false;
        const deltaY =
          currentY -
          startY;
        box.style.transition = "transform .28s ease";
        if (deltaY > 120) {
          box.style.transform = "translateY(100%)";
          setTimeout(() => {
              closePopup();
              box.style.transform = "";
              box.style.transition = "";
            },
            280
          );
        } else {
          box.style.transform =
            "";
        }
      }
    );
  })();
}

function setupPopupAmplop() {
  const openBtn = document.getElementById("openAmplopBtn");
  const overlay = document.getElementById("popupAmplopOverlay");
  const closeBtn = document.getElementById("closeAmplopBtn");
  const box = document.getElementById("popupAmplopBox");
  const header = box?.querySelector(".popup-detail-header");
  if (!openBtn || !overlay || !box) return;

  async function openPopup() {
    overlay.classList.add("show");
    box.style.left = "";
    box.style.top = "";
    box.style.transform = "";
    const subtitle = document.getElementById("popupAmplopSubtitle");
    let tanggal = document.getElementById("dateFilterInput")?.value;
    if (!tanggal) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      tanggal = `${yyyy}-${mm}-${dd}`;
    }
  
    if (subtitle && tanggal) {
      const date = new Date(tanggal);
      subtitle.textContent =
        date.toLocaleDateString("id-ID",
          {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
          }
        );
    }
    const detailDistribusi = document.getElementById("detailAmplopDistribusi");
    const detailPengeluaranKurir = document.getElementById("detailPengeluaranKurir");
    const detailPengeluaranDistribusi = document.getElementById("detailPengeluaranDistribusi");
    const detailAmplopFinal = document.getElementById("detailAmplopFinal");
    const detailPembayaranKurir = document.getElementById("detailPembayaranKurir");
    const detailPengeluaranProduksi = document.getElementById("detailPengeluaranProduksi");
    const detailAmplopProduksiFinal = document.getElementById("detailAmplopProduksiFinal");    
      
    const {
      grossMargin,
      pengeluaranKurir,
      pengeluaranDistribusi,
      amplopDistribusi
    } =
      await getDetailAmplopDistribusi();
    
    const {
      pembayaranKurir,
      pengeluaranProduksi,
      amplopProduksi
    } =
      await getDetailAmplopProduksi();
      
    const formatRupiah = value => new Intl.NumberFormat("id-ID", {
            style: "currency", currency: "IDR", maximumFractionDigits: 0
          }
        ).format(value || 0);
    if (detailDistribusi) {
      detailDistribusi.textContent = formatRupiah(grossMargin);
    }
    if (detailPengeluaranKurir) {
      detailPengeluaranKurir.textContent = formatRupiah(pengeluaranKurir);
    }
    if (detailPengeluaranDistribusi) {
      detailPengeluaranDistribusi.textContent = formatRupiah(pengeluaranDistribusi);
    }
    if (detailAmplopFinal) {
      detailAmplopFinal.textContent = formatRupiah(amplopDistribusi);
    }
    if (detailPembayaranKurir) {
      detailPembayaranKurir.textContent = formatRupiah(pembayaranKurir);
    }
    if (detailPengeluaranProduksi) {
      detailPengeluaranProduksi.textContent = formatRupiah(pengeluaranProduksi);
    }
    if (detailAmplopProduksiFinal) {
      detailAmplopProduksiFinal.textContent =
        formatRupiah(
          amplopProduksi
        );
    }
  }
  function closePopup() {
    overlay.classList.remove("show");
    box.style.transform = "";
    box.style.transition = "";
  }
  openBtn.addEventListener("click", openPopup);
  closeBtn ?.addEventListener("click", closePopup);
  overlay.addEventListener("click", e => {
      if (e.target === overlay) {closePopup();}
    }
  );
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;
  function onDragStart(e) {
    if (window.innerWidth <= 768) return;
    if (e.target.closest("button")) return;
    isDragging = true;
    const rect = box.getBoundingClientRect();
    box.style.right = "auto";
    box.style.margin = "0";
    box.style.transform = "none";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  }
  function onDragMove(e) {
    if (!isDragging) return;
    const x = Math.max(0, Math.min(
          e.clientX - offsetX, window.innerWidth - box.offsetWidth
        )
      );
    const y = Math.max(0, Math.min(
          e.clientY - offsetY, window.innerHeight - box.offsetHeight
        )
      );
    box.style.left = x + "px";
    box.style.top = y + "px";
  }
  function onDragEnd() {
    isDragging = false;
    document.body.style.userSelect = "";
    document.removeEventListener( "mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
  }
  header?.addEventListener("mousedown", onDragStart);
  let startY = 0;
  let currentY = 0;
  let isSwiping = false;
  box.addEventListener("touchstart", e => {
      if (window.innerWidth > 768) return;
      const scrollTop = box.scrollTop;
      if (scrollTop > 10) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isSwiping = true;
      box.style.transition = "none";
    },
    {passive: true}
  );
  box.addEventListener("touchmove", e => {
      if (!isSwiping || window.innerWidth > 768) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;
      if (deltaY < 0) return;
      box.style.transform = `translateY(${deltaY * .9}px)`;
    },
    {passive: true}
  );
  box.addEventListener("touchend", () => {
      if (!isSwiping || window.innerWidth > 768) return;
      isSwiping = false;
      const deltaY = currentY - startY;
      box.style.transition = "transform .28s ease";
      if (deltaY > 120) {
        box.style.transform = "translateY(100%)";
        setTimeout(() => {closePopup();}, 280);
      } else {box.style.transform = "";}
    });
}

function setupReadingMode() {
  const btn = document.getElementById("laporanReadingBtn");
  const closeBtn = document.getElementById("readingCloseBtn");
  if (!btn) return;
  function toggleReading(forceClose = false) {
    const isActive = forceClose ? false : !document.body.classList.contains("reading-mode");
    document.body.classList.toggle("reading-mode", isActive);
    btn.classList.toggle("active", isActive);
    btn.textContent = isActive ? "Tutup Mode" : "Mode Baca";
  }
  btn.addEventListener(
    "click",
    () => toggleReading()
  );
  closeBtn?.addEventListener(
    "click",
    () => toggleReading(true)
  );
}
function exportTableToCSV() {
  const table  = document.querySelector(".laporan-table");
  if (!table) return;

  const rows   = table.querySelectorAll("tr");
  const csv    = [];

  rows.forEach(row => {
    const cols = row.querySelectorAll("th, td");
    const rowData = Array.from(cols).map(col => {
      let text = col.innerText.trim().replace(/\n/g, " ");
      if (text.includes(",") || text.includes('"')) {
        text = `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    csv.push(rowData.join(","));
  });

  const blob = new Blob(["\uFEFF" + csv.join("\n")], {
    type: "text/csv;charset=utf-8;"
  });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const dateVal = document.getElementById("dateFilterInput")?.value || "laporan";
  a.href     = url;
  a.download = `laporan-${dateVal}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
async function exportTableToPDF() {
  const wrapper =
    document.querySelector(
      ".laporan-table-wrapper"
    );
  const table =
    document.querySelector(
      ".laporan-table"
    );
  if (!wrapper || !table)
    return;
  try {
    const dateVal =
      document.getElementById(
        "dateFilterInput"
      )?.value || "laporan";
    const btn =
      document.getElementById(
        "exportPdfBtn"
      );
    if (btn) {
      btn.disabled = true;
      btn.textContent =
        "Membuat PDF...";
    }
    // simpan style asli
    const original = {
      maxHeight:
        wrapper.style.maxHeight,
      overflow:
        wrapper.style.overflow,
      height:
        wrapper.style.height,
      width:
        wrapper.style.width,
      scrollTop:
        wrapper.scrollTop
    };
    // buka semua scroll biar semua tanggal ikut
    wrapper.style.maxHeight =
      "none";
    wrapper.style.height =
      "auto";
    wrapper.style.overflow =
      "visible";
    wrapper.scrollTop = 0;
    // tunggu render ulang
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          300
        )
    );
    // capture full table
    const canvas =
      await html2canvas(
        table,
        {
          scale: 2,
          useCORS: true,
          backgroundColor:
            "#ffffff"
        }
      );
    const imgData =
      canvas.toDataURL(
        "image/png"
      );
    const { jsPDF } =
      window.jspdf;
    const pdf =
      new jsPDF({
        orientation:
          "landscape",
        unit: "mm",
        format: "a4"
      });
    const pageWidth =
      pdf.internal.pageSize.getWidth();
    const pageHeight =
      pdf.internal.pageSize.getHeight();
    const margin = 5;
    const imgWidth =
      pageWidth -
      margin * 2;
    const imgHeight =
      (
        canvas.height *
        imgWidth
      ) / canvas.width;
    let heightLeft =
      imgHeight;
    let position =
      margin;
    // halaman pertama
    pdf.addImage(
      imgData,
      "PNG",
      margin,
      position,
      imgWidth,
      imgHeight
    );
    heightLeft -=
      pageHeight;
    // multi halaman
    while (
      heightLeft > 0
    ) {
      position =
        heightLeft -
        imgHeight +
        margin;
      pdf.addPage();
      pdf.addImage(
        imgData,
        "PNG",
        margin,
        position,
        imgWidth,
        imgHeight
      );
      heightLeft -=
        pageHeight;
    }
    pdf.save(
      `laporan-${dateVal}.pdf`
    );
    // restore style
    wrapper.style.maxHeight =
      original.maxHeight;
    wrapper.style.height =
      original.height;
    wrapper.style.overflow =
      original.overflow;
    wrapper.style.width =
      original.width;
    wrapper.scrollTop =
      original.scrollTop;
  } catch (err) {
    console.error(
      "Gagal export PDF:",
      err
    );
  } finally {
    const btn =
      document.getElementById(
        "exportPdfBtn"
      );
    if (btn) {
      btn.disabled =
        false;
      btn.textContent =
        "Export PDF";
    }
  }
}
async function reloadUsers() {
  const btn  = document.getElementById("reloadUsersBtn");
  const user = auth.currentUser;
  if (!user) return;
  try {
    btn?.classList.add("loading");
    console.log("Reload users...");
    const teamSnap = await getDocs(query(
      collection(db, "users"),
      where("role",      "in", ["sales","kurir","hunter"]),
      where("createdBy", "==", user.uid),
      where("status",    "==", true)
    ));
    const adminSnap = await getDoc(doc(db, "users", user.uid));
    const adminData = adminSnap.exists() ? adminSnap.data() : null;
    const idCabang = adminData?.idCabang;    
    const users = [];
    teamSnap.forEach(docSnap => users.push({ uid: docSnap.id, ...docSnap.data() }));
    if (adminSnap.exists()) users.push({ uid: user.uid, ...adminSnap.data() });
    if (idCabang) {
      const kantorCabangSnap = await getDoc(doc(db, "kantorCabang", idCabang));
      if (kantorCabangSnap.exists()) {
        await saveKantorCabangToDB({
          id: idCabang,
          ...kantorCabangSnap.data()
        });
        console.log("Kantor cabang cached:", kantorCabangSnap.data());
      }
    }    
    await clearUsersByCreator(user.uid);
    await saveUsersToDB(users);
    console.log("Users cached:", users);
    let tanggal = document.getElementById("dateFilterInput")?.value;
    if (!tanggal) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String( now.getDate()).padStart(2, "0");
      tanggal = `${yyyy}-${mm}-${dd}`;
    }
    await reloadLaporanAdminByTanggal(tanggal);
    await loadKurirFromIndexedDB();
  } catch (err) {
    console.error("Reload error:", err);
  } finally {
    btn?.classList.remove("loading");
  }
}
async function saveLaporanAdminToDB(tanggal, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_LAPORAN_ADMIN, "readwrite");
    const store  = tx.objectStore(STORE_LAPORAN_ADMIN);
    const getReq = store.get(tanggal);
    getReq.onsuccess = () => {
      const existing = getReq.result || {};
      const merged   = {
        ...existing,
        ...data,
        tanggal,
        updatedAt: Date.now()
      };
      const putReq = store.put(merged);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}
async function reloadLaporanAdminByTanggal(tanggal) {
  const user = auth.currentUser;
  if (!user || !tanggal) {
    return null;
  }
  try {
    const laporanRef = doc(db, "users", user.uid, "laporanAdmin", tanggal);
    const laporanSnap = await getDoc(laporanRef);
    if (!laporanSnap.exists()) {
      console.log(`Skip laporan ${tanggal} (belum ada doc)`);
      return null;
    }
    const data = laporanSnap.data();
    await saveLaporanAdminToDB(tanggal, data);
    console.log(`Laporan admin cached: ${tanggal}`);
    return data;
  } catch (err) {
    if (err?.code === "permission-denied") {
      console.log(`Skip laporan ${tanggal} (permission denied)`);
      return null;
    }
    console.error(`Gagal reload laporan admin ${tanggal}:`, err);
    return null;
  }
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
async function reloadLaporanAdmin() {
  const btn = document.getElementById("reloadLaporanBtn");
  const alertEl = document.getElementById("reloadLaporanAlert");
  const user = auth.currentUser;
  if (!user || btn?.classList.contains("loading")) return;
  try {
    btn.classList.add("loading");
    if (alertEl) {
      alertEl.classList.remove("show");
      alertEl.textContent = "";
    }
    const tanggal = document.getElementById("dateFilterInput")?.value || new Date().toISOString().split("T")[0];
    await new Promise( resolve => setTimeout(resolve, 2000));
    const q = query(
      collectionGroup(db, "laporanAdmin"),
      where("tanggal", "==", tanggal),
      where("createdBy", "==", user.uid)
    );
    const snap = await getDocs(q); btn.classList.remove("loading");
    btn.classList.add("freeze");
    if (snap.empty) {
      if (alertEl) {
        alertEl.innerHTML = "Data tidak ditemukan<br>Cek tanggal!";
        alertEl.style.color = "#c54b4b";
        alertEl.classList.add("show");
      }
      setTimeout(() => {
        alertEl?.classList.remove("show");
        btn.classList.remove("freeze");
      }, 2600);
      return;
    }
    const laporanData = snap.docs[0].data() || {};
    await saveLaporanAdminToDB(tanggal, laporanData);
    const savedLaporan = await getLaporanAdminFromDB(tanggal);
    console.log("Laporan berhasil disimpan ke IndexedDB:", savedLaporan);
    
    await renderLaporanTanggalTable(); if (alertEl) {
      alertEl.style.color ="#2d8b57";
      alertEl.textContent ="Data berhasil diambil";
      alertEl.classList.add("show");
    }
    setTimeout(() => {
      alertEl?.classList.remove("show");
      btn.classList.remove("freeze");
    }, 2600);
  } catch (err) {
    console.error("Reload laporan error:", err);
    btn?.classList.remove("loading");
    btn?.classList.add("freeze");
    if (alertEl) {
      alertEl.textContent ="Gagal mengambil data";
      alertEl.style.color ="#c54b4b";
      alertEl.classList.add("show");
    }
    setTimeout(() => {
      alertEl?.classList.remove("show");
      btn?.classList.remove("freeze");
    }, 2600);
  }
}
async function loadKurirFromIndexedDB() {
  const listEl = document.getElementById("listKurir");
  if (!listEl) return;
  const user = auth.currentUser;
  if (!user) {
    listEl.innerHTML = `<div class="loading-card">Menunggu login...</div>`;
    return;
  }
  try {
    const allUsers = await getUsersFromDB();
    const users = allUsers.filter(item =>
      item.createdBy === user.uid &&
      item.status === true &&
      ["sales","kurir","hunter"].includes(item.role)
    );
    console.log("Loaded from IndexedDB:", users);
    usersCache = users;
    if (users.length === 0) {
      listEl.innerHTML = `<div class="loading-card">Belum ada data, klik tombol reload terlebih dahulu!</div>`;
      return;
    }
    listEl.innerHTML = users.map(data => {
      const nama    = escapeHtml(data.nama || "Tanpa Nama");
      const role    = escapeHtml(data.role || "-");
      const foto    = data.foto || "";
      const inisial = (data.nama || "?").trim().charAt(0).toUpperCase();

      const avatarHtml = foto
        ? `<img class="user-photo" src="${escapeHtml(foto)}" data-inisial="${escapeHtml(inisial)}" alt="${nama}">`
        : `<div class="user-photo-fallback">${escapeHtml(inisial)}</div>`;
      return `
        <div
          class="user-item"
          data-uid="${data.uid}"
        >
          ${avatarHtml}
          <div class="user-info">
            <div class="user-name">
              ${nama}
            </div>
            <div class="user-role">
              ${role}
            </div>
          </div>
        </div>
      `;
    }).join("");
    setupKurirClick(users);
    setupCustomDropdown(users);
    setupLaporanDropdown(users);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="loading-card">Gagal memuat data</div>`;
  }
}
function setupCustomDropdown(users) {
  const wrapper = document.getElementById("laporanUserDropdown");
  const btn = document.getElementById("laporanDropdownBtn");
  const text = document.getElementById("laporanDropdownText");
  const list = document.getElementById("laporanDropdownList");
  if (!wrapper || !btn || !list) return;
  list.innerHTML = users.map(user => {
    const nama = escapeHtml(user.nama || "Tanpa Nama");
    const role = escapeHtml(user.role || "-");
    const foto = user.foto || "";
    const inisial = nama.charAt(0).toUpperCase();
    return `
      <div class="laporan-dropdown-item" data-uid="${user.uid}">
        <div class="laporan-dropdown-avatar">
          ${
            foto ? ` <img src="${escapeHtml(foto)}">` : inisial
          }
        </div>
        <div class="laporan-dropdown-info">
          <div class="laporan-dropdown-name">
            ${nama}
          </div>
          <div class="laporan-dropdown-role">
            ${role}
          </div>
        </div>
      </div>
    `;
  }).join("");
  btn.onclick = () => {
    wrapper.classList.toggle("active");
  };
  document.addEventListener("click", e => {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove("active");
    }
  });
  list.querySelectorAll(".laporan-dropdown-item").forEach(item => {
    item.onclick = async () => {
      const uid = item.dataset.uid;
      const user = users.find(x => x.uid === uid);
      if (!user) return;
      selectedKurirUid = uid;
      text.textContent = user.nama;
      document .getElementById( "laporanRole" ).value = user.role || "-"; list
        .querySelectorAll(".laporan-dropdown-item")
        .forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      wrapper.classList.remove("active");
      await renderReport(uid);
      await renderLaporanTanggalTable();
    };
  });
}
async function saveDataHarianToDBLaporan(uidKurir, tanggal, data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME_LAPORAN);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DATA_HARIAN)) {
        resolve();
        return;
      }
      const id = `${uidKurir}_${tanggal}`;
      const tx = db.transaction(STORE_DATA_HARIAN, "readwrite");
      tx.objectStore(STORE_DATA_HARIAN).put({
        id, uidKurir, tanggal, data, updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}
async function renderReport(uid) {
  const reportEl =
    document.getElementById(
      "reportCollection"
    );
  const userData =
    usersCache.find(
      x => x.uid === uid
    );
  if (!userData || !reportEl) return;
  const dateInput =
    document.getElementById(
      "dateFilterInput"
    );
  const tanggal =
    dateInput?.value ||
    new Date()
      .toISOString()
      .split("T")[0];
  let laporan = await getDataHarianFromDB(uid, tanggal);

  if (!laporan) {
    try {
      const snap = await getDoc(
        doc(db, "users", auth.currentUser.uid, "laporanAdmin", tanggal)
      );
      if (snap.exists()) {
        const fsData    = snap.data();
        const kurirData = fsData[uid] || {};
        const infoTarget = kurirData?.distribusi?.infoTarget || {};
        const hasil = {
          closing     : kurirData?.pembayaran?.closing || {},
          pay         : kurirData?.distribusi?.pay     || {},
          expired     : kurirData?.distribusi?.expired || {},
          fee         : {},
          disable     : {},
          saldoBarang : {},
          kunjungan        : Number(infoTarget?.kunjungan)        || 0,
          pembayaran       : {
            bayarKonsumen  : Number(kurirData?.distribusi?.keuangan?.inputOmset) || 0,
            bayarProduksi  : 0
          },
          keterangan       : {
            pending        : Number(infoTarget?.pending) || 0,
            tutup          : Number(infoTarget?.tutup)   || 0,
            putus          : Number(infoTarget?.putus)   || 0,
          },
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
    } catch (err) {
      console.warn("Fallback laporanAdmin gagal:", err.code);
    }
  }

  const closingData  = laporan?.data?.closing  || {};
  const payData      = laporan?.data?.pay      || {};
  const expiredData  = laporan?.data?.expired  || {};
  const omset =
    Number(
      laporan?.data
        ?.pembayaran
        ?.bayarKonsumen
    ) || 0; 
  const customerLama =
    laporan?.data?.customerLama ?? 0;
  const customerTambahan =
    laporan?.data?.customerTambahan ?? 0;
  const customerNew =
    laporan?.data?.customerNew ?? 0;
  const kunjungan =
    Number(
      laporan?.data?.kunjungan
    ) || 0;
  const jumlahCustomer =
    customerLama +
    customerTambahan +
    customerNew;
  const keterangan =
    laporan?.data?.keterangan || {};
  const tutup =
    Number(
      keterangan.tutup
    ) || 0;
  const pending =
    Number(
      keterangan.pending
    ) || 0;
  const putus =
    Number(
      keterangan.putus
    ) || 0;
  const kantorCabang =
    await getKantorCabangFromDB();
  const targetCustomer =
    Number(
      kantorCabang
        ?.bonus
        ?.data
        ?.targetCustomer
    ) || 0;
  const repeatOrder =
    jumlahCustomer -
    tutup -
    pending -
    putus;
  const ofTarget =
    kunjungan -
    jumlahCustomer;
  const keteranganTarget =
    kunjungan -
    targetCustomer;
  const activeVarians =
    (userData.varian || [])
      .filter(v => {
        const key =
          Object.keys(v)[0];
        return (
          key &&
          v[key]?.isAktif
        );
      });
  const sumClosing = activeVarians.reduce((acc, v) => {
    const key = Object.keys(v)[0];
    return acc + (Number(closingData[key]) || 0);
  }, 0);
  const sumPay = activeVarians.reduce((acc, v) => {
    const key = Object.keys(v)[0];
    return acc + (Number(payData[key]) || 0);
  }, 0);
  const sumExpired = activeVarians.reduce((acc, v) => {
    const key = Object.keys(v)[0];
    return acc + (Number(expiredData[key]) || 0);
  }, 0);
  reportEl.innerHTML = `
    <!-- CLOSING -->
    <div class="report-card">
      <div class="report-card-title">
        CLOSING
      </div>
      <div class="report-list">
        ${
          activeVarians.map(v => {
            const key = Object.keys(v)[0];
            return `
              <div class="report-item">
                <div class="report-key">${escapeHtml(key)}</div>
                <div class="report-value">${closingData[key] ?? ""}</div>
              </div>
            `;
          }).join("")
        }
        <div
          class="report-item report-jumlah"
          data-section="closing"
          style="cursor:pointer;margin-top:4px;"
        >
          <div class="report-key" style="color:#b08a5c;">
            Jumlah
          </div>
          <div class="report-value" style="color:#b08a5c;text-decoration:underline dotted;">
            ${sumClosing} ↗
          </div>
        </div>

      </div>

    </div>

    <!-- PAY -->
    <div class="report-card">
      <div class="report-card-title">
        PAY
      </div>
      <div class="report-list">
        ${
          activeVarians.map(v => {
            const key = Object.keys(v)[0];
            return `
              <div class="report-item">
                <div class="report-key">${escapeHtml(key)}</div>
                <div class="report-value">${payData[key] ?? ""}</div>
              </div>
            `;
          }).join("")
        }
        <div
          class="report-item report-jumlah"
          data-section="pay"
          style="cursor:pointer;margin-top:4px;"
        >
          <div class="report-key" style="color:#b08a5c;">
            Jumlah
          </div>
          <div class="report-value" style="color:#b08a5c;text-decoration:underline dotted;">
            ${sumPay} ↗
          </div>
        </div>
      </div>
    </div>

    <!-- EXPIRED -->
    <div class="report-card">
      <div class="report-card-title">
        EXPIRED
      </div>
      <div class="report-list">
        ${
          activeVarians.map(v => {
            const key = Object.keys(v)[0];
            return `
              <div class="report-item">
                <div class="report-key">${escapeHtml(key)}</div>
                <div class="report-value">${expiredData[key] ?? ""}</div>
              </div>
            `;
          }).join("")
        }

        <div
          class="report-item report-jumlah"
          data-section="expired"
          style="cursor:pointer;margin-top:4px;"
        >
          <div class="report-key" style="color:#b08a5c;">
            Jumlah
          </div>
          <div class="report-value" style="color:#b08a5c;text-decoration:underline dotted;">
            ${sumExpired} ↗
          </div>
        </div>

      </div>

    </div>
    
<!-- INFO TARGET -->
    <div class="report-card">

      <div class="report-card-title">
        INFO TARGET
      </div>

      <div class="report-list">

        <div class="report-item">
          <div class="report-key">Customer Lama</div>
          <div class="report-value">${customerLama}</div>
        </div>

        <div class="report-item">
          <div class="report-key">Customer Tambahan</div>
          <div class="report-value">${customerTambahan}</div>
        </div>

        <div class="report-item">
          <div class="report-key">Customer Baru</div>
          <div class="report-value">${customerNew}</div>
        </div>

        <div class="report-item">
          <div class="report-key">Jumlah Customer</div>
          <div class="report-value">${jumlahCustomer}</div>
        </div>

        <div
          class="report-item report-selengkapnya"
          style="cursor:pointer;margin-top:4px;"
        >
          <div class="report-key" style="color:#b08a5c;">
            Selengkapnya
          </div>
          <div class="report-value" style="color:#b08a5c;">
            ↗
          </div>
        </div>

      </div>

    </div>
    
    <!-- KEUANGAN -->
    <div class="report-card">
    
      <div class="report-card-title">
        KEUANGAN
      </div>
    
      <div class="report-list">
    
        <div class="report-item">
          <div class="report-key">
            Omset
          </div>
          <div class="report-value">
            Rp ${formatRupiah(omset)}
          </div>
        </div>
    
        <div class="report-item">
          <div class="report-key">
            Bonus
          </div>
          <div class="report-value">
            Rp 0
          </div>
        </div>
    
        <div class="report-item">
          <div class="report-key">
            Insentif
          </div>
          <div class="report-value">
            Rp 0
          </div>
        </div>
    
        <div class="report-item">
          <div class="report-key">
            Kasbon
          </div>
          <div class="report-value">
            Rp 0
          </div>
        </div>
    
        <div
          class="report-item report-keuangan"
          style="
            cursor:pointer;
            margin-top:4px;
          "
        >
          <div
            class="report-key"
            style="color:#b08a5c;"
          >
            Selengkapnya
          </div>
    
          <div
            class="report-value"
            style="color:#b08a5c;"
          >
            ↗
          </div>
        </div>
    
      </div>
    
    </div>    
  `;
// setup klik jumlah
  reportEl.querySelectorAll(".report-jumlah").forEach(el => {
    el.addEventListener("click", () => {
      const section = el.dataset.section;

      let dataSource = {};
      let title = "";
      let sum = 0;

      if (section === "closing") {
        dataSource = closingData;
        title      = "Closing";
        sum        = sumClosing;
      } else if (section === "pay") {
        dataSource = payData;
        title      = "Pay";
        sum        = sumPay;
      } else if (section === "expired") {
        dataSource = expiredData;
        title      = "Expired";
        sum        = sumExpired;
      }

      openPopup(title, tanggal, sum, activeVarians, dataSource, userData);
    });
// setup klik selengkapnya info target
  reportEl.querySelector(".report-selengkapnya")
    ?.addEventListener("click", () => {
      openPopupInfoTarget(
        tanggal,
        jumlahCustomer,
        tutup,
        pending,
        putus,
        kunjungan,
        ofTarget,
        keteranganTarget
      );
    });    
  });
  // setup klik selengkapnya keuangan
  reportEl.querySelector(".report-keuangan")
    ?.addEventListener("click", () => {
  
      openPopupKeuangan(
        tanggal,
        omset,
        keteranganTarget,
        payData,
        expiredData,
        kunjungan
      );
  
    });
}
function setupLaporanDropdown(users) {
  const wrapper =
    document.getElementById(
      "laporanUserDropdown"
    );
  const btn =
    document.getElementById(
      "laporanDropdownBtn"
    );
  const text =
    document.getElementById(
      "laporanDropdownText"
    );
  const popup =
    document.getElementById(
      "laporanDropdownPopup"
    );
  const list =
    document.getElementById(
      "laporanDropdownList"
    );
  const search =
    document.getElementById(
      "laporanDropdownSearch"
    );
  if (
    !wrapper ||
    !btn ||
    !list
  ) return;
  renderList(users);
  btn.onclick =
    () => {
      wrapper.classList.toggle(
        "active"
      );
      if (
        wrapper.classList.contains(
          "active"
        )
      ) {
        setTimeout(() => {
          search?.focus();
        }, 80);
      }
    };
  search?.addEventListener(
    "input",
    () => {
      const keyword =
        search.value
        .toLowerCase();
      const filtered =
        users.filter(u =>
          (
            u.nama || ""
          )
          .toLowerCase()
          .includes(keyword)
        );
      renderList(
        filtered
      );
    }
  );
  document.addEventListener(
    "click",
    e => {
      if (
        !wrapper.contains(
          e.target
        )
      ) {
        wrapper.classList.remove(
          "active"
        );
      }
    }
  );
  function renderList(
    data
  ) {
    list.innerHTML =
      data.map(u => {
        const nama =
          u.nama ||
          "Tanpa Nama";
        const role =
          u.role ||
          "-";
        const foto =
          u.foto ||
          "";
        const inisial =
          nama.charAt(0)
          .toUpperCase();
        return `
          <div class="laporan-dropdown-item" data-uid="${u.uid}">
            <div class="laporan-dropdown-avatar">
              ${
                foto
                ? ` <img src="${foto}">`
                : inisial
              }
            </div>
            <div class="laporan-dropdown-info">
              <div class="laporan-dropdown-name">
                ${nama}
              </div>
              <div class="laporan-dropdown-role">
                ${role}
              </div>
            </div>
          </div>
        `;
      }).join("");
    list.querySelectorAll(
      ".laporan-dropdown-item"
    ).forEach(item => {
      item.onclick =
        async () => {
        const uid =
          item.dataset.uid;
        const user =
          users.find(
            x =>
            x.uid === uid
          );
        if (
          !user
        ) return;
        selectedKurirUid =
          uid;
        text.textContent =
          user.nama;
        document
          .getElementById(
            "laporanRole"
          ).value =
          user.role || "-";
        wrapper.classList.remove(
          "active"
        );
        await renderReport(uid);
        await renderLaporanTanggalTable();
      };
    });
  }
}
function setupKurirClick(users) {
  const items =
    document.querySelectorAll(
      ".user-item"
    );
  items.forEach(item => {
    item.addEventListener(
      "click",
      async () => {
        const uid =
          item.dataset.uid;
        selectedKurirUid =
          uid;
        const selectUser =
          document.getElementById(
            "laporanUserSelect"
          );
        const inputRole =
          document.getElementById(
            "laporanRole"
          );
        const userData =
          users.find(
            x => x.uid === uid
          );
        if (selectUser) {
          selectUser.value =
            uid;
        }
        if (
          inputRole &&
          userData
        ) {
          inputRole.value =
            userData.role || "-";
        }          
        items.forEach(el =>
          el.classList.remove(
            "active"
          )
        );
        item.classList.add(
          "active"
        );
        await renderReport(uid);
      }
    );
  });
}
function openPopupInfoTarget(tanggal, jumlah, tutup, pending, putus, kunjungan, ofTarget, keteranganTarget) {
  document.getElementById(
    "popupDetailTitle"
  ).textContent =
    "Info Target";
  document.getElementById(
    "popupDetailSubtitle"
  ).textContent =
    `Tanggal: ${tanggal}`;
  document.getElementById(
    "popupDetailTotal"
  ).textContent =
    jumlah;
  document.getElementById(
    "popupDetailList"
  ).innerHTML = `
    <div class="popup-detail-item">
      <div class="popup-detail-item-key">
        Tutup
      </div>
      <div class="popup-detail-item-value">
        ${tutup}
      </div>
    </div>
    <div class="popup-detail-item">
      <div class="popup-detail-item-key">
        Pending
      </div>
      <div class="popup-detail-item-value">
        ${pending}
      </div>
    </div>
    <div class="popup-detail-item">
      <div class="popup-detail-item-key">
        Putus
      </div>
      <div class="popup-detail-item-value">
        ${putus}
      </div>
    </div>
    <div class="popup-detail-item">
      <div class="popup-detail-item-key">
        Kunjungan
      </div>
      <div class="popup-detail-item-value">
        ${kunjungan}
      </div>
    </div>
    <div class="popup-detail-item">
      <div class="popup-detail-item-key">
        Target Data
      </div>
      <div class="popup-detail-item-value">
        ${ofTarget}
      </div>
    </div>  
    <div class="popup-detail-item">
      <div class="popup-detail-item-key">
        Target Customer
      </div>
      <div class="popup-detail-item-value">
        ${keteranganTarget}
      </div>
    </div>   

    <!-- Potongan Target -->  
    <div class="target-potongan-box">  
      <div class="target-potongan-title">  
        Potongan Target
      </div>  
      <div class="keuangan-bonus-item">  
        <span>  
          Potongan Target Data  
        </span>  
        <strong id="potonganTargetDataVal">  
          -  
        </strong>  
      </div>  
      <div class="keuangan-bonus-item">  
        <span>  
          Potongan Target Customer  
        </span>  
        <strong id="potonganTargetCustomerVal">  
          -  
        </strong>  
      </div>
      <div class="keuangan-bonus-item keuangan-bonus-item-total">
        <span>
          Jumlah Potongan
        </span>
        <strong id="jumlahPotonganVal">
          -
        </strong>
      </div>
    </div>
  `;
  const overlay =
    document.getElementById(
      "popupDetailOverlay"
    );
  const box =
    document.getElementById(
      "popupDetailBox"
    );
  if (window.innerWidth > 768) {
    box.style.left =
      "auto";
    box.style.right =
      "34px";
    const popupHeight =
      Math.min(
        box.offsetHeight || 650,
        window.innerHeight * 0.86
      );
    const centerTop =
      (
        window.innerHeight -
        popupHeight
      ) / 2;
    box.style.top =
      Math.max(
        24,
        centerTop
      ) + "px";
    box.style.transform =
      "scale(1)";
    enableDetailDrag();
  }
  (async () => {
    const kantorCabang =
      await getKantorCabangFromDB();
    const bonusData =
      kantorCabang?.bonus?.data || {};
    const elPotonganData =
      document.getElementById(
        "potonganTargetDataVal"
      );
    let nilaiPotonganData = 0;
    if (elPotonganData) {
      if (ofTarget >= 0) {
        elPotonganData.textContent =
          "-";
      } else {
        const insentifPotongan =
          Number(
            bonusData?.insentif
          ) || 0;
        nilaiPotonganData =
          insentifPotongan;
        elPotonganData.textContent =
          insentifPotongan > 0
            ? `Rp ${formatRupiah(insentifPotongan)}`
            : "-";
      }
    }
    const elPotonganCustomer =
      document.getElementById(
        "potonganTargetCustomerVal"
      );
    let nilaiPotonganCustomer = 0;
    if (elPotonganCustomer) {
      const potongan =
        kantorCabang
          ?.potongan || {};
      const setengahUpah =
        potongan
          ?.setengahUpah || {};
      const batasPersen =
        Number(
          setengahUpah?.batas
        ) || 0;
      const potonganPersen =
        Number(
          setengahUpah
            ?.potonganUpah
        ) || 0;
      const upahHarian =
        Number(
          kantorCabang
            ?.upahHarian
        ) || 0;
      const batasCustomer =
        Number(
          potongan
            ?.kelipatanUpah
            ?.batas
        ) || 0;
      let kenaRuleSetengah =
        false;
      if (
        jumlah >= batasCustomer &&
        batasPersen > 0
      ) {
        const targetKunjungan =
          Math.floor(
            jumlah *
            (
              batasPersen / 100
            )
          );
        if (
          kunjungan <=
          targetKunjungan
        ) {
          nilaiPotonganCustomer =
            Math.floor(
              upahHarian *
              (
                potonganPersen / 100
              )
            );
          elPotonganCustomer
            .textContent =
            nilaiPotonganCustomer > 0
              ? `Rp ${formatRupiah(
                  nilaiPotonganCustomer
                )}`
              : "-";
          kenaRuleSetengah =
            true;
        }
      }
      if (!kenaRuleSetengah) {
        const kelipatanUpah =
          potongan
            ?.kelipatanUpah || {};
        const batas =
          Number(
            kelipatanUpah
              ?.batas
          ) || 0;
        const kelipatan =
          Number(
            kelipatanUpah
              ?.kelipatan
          ) || 1;
        const potonganUpah =
          Number(
            kelipatanUpah
              ?.potonganUpah
          ) || 0;
        if (jumlah < batas) {
          elPotonganCustomer
            .textContent =
            "-";
        } else {
          const selisih =
            batas -
            kunjungan;
          if (
            selisih <= 0
          ) {
            elPotonganCustomer
              .textContent =
              "-";
          } else {
            const kali =
              Math.ceil(
                selisih /
                kelipatan
              );
            nilaiPotonganCustomer =
              kali *
              potonganUpah;
            elPotonganCustomer
              .textContent =
              nilaiPotonganCustomer > 0
                ? `Rp ${formatRupiah(
                    nilaiPotonganCustomer
                  )}`
                : "-";
          }
        }
      }
    }
    const elJumlah =
      document.getElementById(
        "jumlahPotonganVal"
      );
    if (elJumlah) {
      const total =
        nilaiPotonganData +
        nilaiPotonganCustomer;
      elJumlah.textContent =
        total > 0
          ? `Rp ${formatRupiah(total)}`
          : "-";
    }
  })();
  overlay.classList.add(
    "show"
  );
}
function openPopupKeuangan(tanggal, omset = 0, keteranganTarget = 0, payData = {}, expiredData = {}, kunjungan = 0) {
  document.getElementById(
    "popupDetailTitle"
  ).textContent =
    "Keuangan";
  document.getElementById(
    "popupDetailSubtitle"
  ).textContent =
    `Tanggal: ${tanggal}`;
  document.getElementById(
    "popupDetailTotal"
  ).textContent =
    `Rp ${formatRupiah(omset)}`;
  document.getElementById(
    "popupDetailList"
  ).innerHTML = `
    <div class="keuangan-form">
      <!-- Omset -->
      <div class="keuangan-group">
        <label class="keuangan-label">
          Omset
        </label>
        <input
          type="number"
          inputmode="numeric"
          class="keuangan-input"
          id="keuanganOmset"
          placeholder="Masukkan omset"
        >
      </div>

      <!-- Insentif -->
      <div class="keuangan-group">
        <label class="keuangan-label">
          Klaim Insentif
        </label>
        <input
          type="number"
          inputmode="numeric"
          class="keuangan-input"
          id="keuanganInsentif"
          placeholder="Masukkan insentif"
        >
      </div>

      <!-- Kasbon -->
      <div class="keuangan-group">
        <label class="keuangan-label">
          Kasbon
        </label>
        <input
          type="number"
          inputmode="numeric"
          class="keuangan-input"
          id="keuanganKasbon"
          placeholder="Masukkan kasbon"
        >
      </div>

      <!-- Bonus -->
      <div class="keuangan-bonus-box">
        <div class="keuangan-bonus-title">
          Bonus
        </div>
        <div class="keuangan-bonus-item">
          <span>Bonus Insentif</span>
          <strong id="bonusInsentifVal">-</strong>
        </div>
        <div class="keuangan-bonus-item">
          <span>Bonus Kunjungan</span>
          <strong id="bonusKunjunganVal">-</strong>
        </div>
        <div class="keuangan-bonus-item">
          <span>Bonus Pay</span>
          <strong id="bonusPayVal">-</strong>
        </div>
      </div>

      <!-- Tombol -->
      <button
        id="btnKirimKeuangan"
        class="keuangan-submit-btn"
      >
        Kirim
      </button>
    </div>
  `;
  
  (async () => {
    const kantorCabang =
      await getKantorCabangFromDB();
    const bonus =
      kantorCabang?.bonus || {};
    const elKunjungan =
      document.getElementById(
        "bonusKunjunganVal"
      );
    if (elKunjungan) {
      const customerBonus =
        bonus?.customer || {};
      const targetKunjungan =
        Number(
          customerBonus?.target
        ) || 0;
      const kelipatan =
        Number(
          customerBonus?.kelipatan
        ) || 1;
      const uangKunjungan =
        Number(
          customerBonus?.uang
        ) || 0;
      if (kunjungan <= targetKunjungan) {
        elKunjungan.textContent =
          "-";
      } else {
        const kali =
          Math.floor(
            (kunjungan - targetKunjungan - 1) /
            kelipatan
          ) + 1;
        const totalBonusKunjungan =
          kali * uangKunjungan;
        elKunjungan.textContent =
          totalBonusKunjungan > 0
            ? `Rp ${formatRupiah(totalBonusKunjungan)}`
            : "-";
      }
    }
    const elInsentif =
      document.getElementById(
        "bonusInsentifVal"
      );
    if (elInsentif) {
      if (keteranganTarget >= 0) {
        const uangInsentif =
          Number(
            bonus
              ?.data
              ?.insentif
          ) || 0;
        elInsentif.textContent =
          uangInsentif > 0
            ? `Rp ${formatRupiah(uangInsentif)}`
            : "-";
      } else {
        elInsentif.textContent =
          "-";
      }
    }
    const elPay =
      document.getElementById(
        "bonusPayVal"
      );
    if (elPay) {
      const sumExpiredBonus =
        Object.values(
          expiredData
        ).reduce(
          (acc, v) =>
            acc + (Number(v) || 0),
          0
        );
      const ketentuan =
        Number(
          bonus?.ketentuan
        ) || 0;
      console.log("expiredData raw:", expiredData);
      console.log("payData raw:", payData);
      console.log("sumExpiredBonus:", sumExpiredBonus);
      console.log("ketentuan:", ketentuan);
      console.log("bonus object:", bonus);
      console.log("margin object:", bonus?.margin);

      if (sumExpiredBonus > ketentuan) {
        elPay.textContent = "-";
      } else {
        const sumPayBonus =
          Object.values(
            payData
          ).reduce(
            (acc, v) =>
              acc + (Number(v) || 0),
            0
          );
        if (sumPayBonus < 180) {
          elPay.textContent = "-";
        } else {
          const margin =
            bonus?.margin || {};
          let bonusPayUang = 0;
          let cocok = false;
          Object.values(margin)
            .forEach(obj => {
              const min =
                Number(obj.minimal) || 0;
              const max =
                Number(obj.maksimal) || 0;
              const uang =
                Number(obj.uang) || 0;
              if (
                sumPayBonus >= min &&
                sumPayBonus <= max
              ) {
                bonusPayUang = uang;
                cocok = true;
              }
            });
          elPay.textContent =
            cocok && bonusPayUang > 0
              ? `Rp ${formatRupiah(bonusPayUang)}`
              : "-";
        }
      }
    }
  })();
  // Ambil data keuangan dari IndexedDB laporanAdmin
  (async () => {
    try {
      const laporanAdmin =
        await getLaporanAdminFromDB(
          tanggal
        );
  
      const keuangan =
        laporanAdmin?.data?.[
          selectedKurirUid
        ]?.distribusi
          ?.keuangan || {};
  
      const inputOmsetEl =
        document.getElementById(
          "keuanganOmset"
        );
      const inputInsentif =
        document.getElementById(
          "keuanganInsentif"
        );
      
      const inputKasbon =
        document.getElementById(
          "keuanganKasbon"
        );
      
      // formatter ribuan
      function formatInputRibuan(input) {
        if (!input) return;
      
        input.addEventListener(
          "input",
          () => {
            const angka =
              input.value.replace(
                /\D/g,
                ""
              );
      
            input.value =
              angka
                ? Number(
                    angka
                  ).toLocaleString(
                    "id-ID"
                  )
                : "";
          }
        );
      }
      
      formatInputRibuan(
        inputOmset
      );
      
      formatInputRibuan(
        inputInsentif
      );
      
      formatInputRibuan(
        inputKasbon
      );  
      const inputInsentifEl =
        document.getElementById(
          "keuanganInsentif"
        );
  
      const inputKasbonEl =
        document.getElementById(
          "keuanganKasbon"
        );
  
      // isi value sesuai laporanAdmin
      if (inputOmsetEl) {
        inputOmsetEl.value =
          keuangan.inputOmset > 0
            ? Number(
                keuangan.inputOmset
              ).toLocaleString(
                "id-ID"
              )
            : "";
      }
      
      if (inputInsentifEl) {
        inputInsentifEl.value =
          keuangan.klaimInsentif > 0
            ? Number(
                keuangan.klaimInsentif
              ).toLocaleString(
                "id-ID"
              )
            : "";
      }
      
      if (inputKasbonEl) {
        inputKasbonEl.value =
          keuangan.kasbon > 0
            ? Number(
                keuangan.kasbon
              ).toLocaleString(
                "id-ID"
              )
            : "";
      }
    } catch (err) {
      console.error(
        "Gagal load keuangan:",
        err
      );
    }
  })();
  const btn =
    document.getElementById(
      "btnKirimKeuangan"
    );
  const inputOmset =
    document.getElementById(
      "keuanganOmset"
    );
  const hasInitialValue =
    inputOmset.value.trim() !== "";
  
  btn.disabled =
    !hasInitialValue;
  
  btn.classList.toggle(
    "disabled",
    !hasInitialValue
  );
  
  inputOmset.addEventListener(
    "input",
    () => {
      const hasValue =
        inputOmset.value.trim() !== "";
      btn.disabled =
        !hasValue;
      btn.classList.toggle(
        "disabled",
        !hasValue
      );
    }
  );
  
  async function submitKeuangan() {
    if (
      btn.classList.contains(
        "loading"
      )
    ) return;
    btn.classList.add(
      "loading"
    );
  
    btn.textContent =
      "Mengirim...";
  
    try {
      const adminUid =
        auth.currentUser?.uid;
  
      if (
        !adminUid ||
        !selectedKurirUid
      ) {
        throw new Error(
          "UID tidak ditemukan"
        );
      }
  
      const docRef =
        doc(
          db,
          "users",
          adminUid,
          "laporanAdmin",
          tanggal
        );
  
      const snap =
        await getDoc(
          docRef
        );
  
      if (
        !snap.exists()
      ) {
        openBelumAdaData();
  
        btn.classList.remove(
          "loading"
        );
  
        btn.textContent =
          "Kirim";
  
        return;
      }
  
      const docData =
        snap.data() || {};
  
      if (
        !docData[
          selectedKurirUid
        ]
      ) {
        openBelumAdaData();
  
        btn.classList.remove(
          "loading"
        );
  
        btn.textContent =
          "Kirim";
  
        return;
      }
  
      const userData =
        usersCache.find(
          x =>
            x.uid ===
            selectedKurirUid
        );
  
      const activeVarians =
        (
          userData?.varian ||
          []
        ).filter(v => {
          const key =
            Object.keys(v)[0];
  
          return (
            key &&
            v[key]
              ?.isAktif
          );
        });
  
      const laporan =
        await getDataHarianFromDB(
          selectedKurirUid,
          tanggal
        );
  
      const payDataRaw =
        laporan?.data
          ?.pay || {};
  
      const expiredDataRaw =
        laporan?.data
          ?.expired || {};
  
      // ==========================
      // HITUNG JUMLAH UANG CLOSING
      // ==========================
      let jumlahUangClosing =
        0;
  
      activeVarians.forEach(
        v => {
          const key =
            Object.keys(v)[0];
  
          const qty =
            Number(
              laporan?.data
                ?.closing?.[
                key
              ]
            ) || 0;
  
          const hargaProduksi =
            Number(
              v[key]
                ?.hargaProduksi
            ) || 0;
  
          jumlahUangClosing +=
            qty *
            hargaProduksi;
        }
      );
  
      const pay = {};
      let payMargin = 0;
  
      activeVarians.forEach(
        v => {
          const key =
            Object.keys(v)[0];
  
          const qty =
            Number(
              payDataRaw[
                key
              ]
            ) || 0;
  
          if (
            qty <= 0
          )
            return;
  
          pay[key] =
            qty;
  
          const hargaProduksi =
            Number(
              v[key]
                ?.hargaProduksi
            ) || 0;
  
          const hargaKonsumen =
            Number(
              v[key]
                ?.hargaKonsumen
            ) || 0;
  
          const margin =
            hargaKonsumen -
            hargaProduksi;
  
          payMargin +=
            qty *
            margin;
        }
      );
  
      pay.margin =
        payMargin;
  
      const expired =
        {};
  
      let expiredMargin =
        0;
  
      activeVarians.forEach(
        v => {
          const key =
            Object.keys(v)[0];
  
          const qty =
            Number(
              expiredDataRaw[
                key
              ]
            ) || 0;
  
          if (
            qty <= 0
          )
            return;
  
          expired[key] =
            qty;
  
          const hargaProduksi =
            Number(
              v[key]
                ?.hargaProduksi
            ) || 0;
  
          expiredMargin +=
            qty *
            hargaProduksi;
        }
      );
  
      expired.margin =
        expiredMargin;
  
      const customerLama =
        laporan?.data
          ?.customerLama ??
        0;
  
      const customerTambahan =
        laporan?.data
          ?.customerTambahan ??
        0;
  
      const customerNew =
        laporan?.data
          ?.customerNew ??
        0;
  
      const jumlahCustomer =
        customerLama +
        customerTambahan +
        customerNew;
  
      const keterangan =
        laporan?.data
          ?.keterangan ||
        {};
  
      const tutup =
        Number(
          keterangan.tutup
        ) || 0;
  
      const pending =
        Number(
          keterangan.pending
        ) || 0;
  
      const putus =
        Number(
          keterangan.putus
        ) || 0;
  
      const kunjungan =
        Number(
          laporan?.data
            ?.kunjungan
        ) || 0;
  
      const kantorCabang =
        await getKantorCabangFromDB();
  
      const targetCustomer =
        Number(
          kantorCabang
            ?.bonus
            ?.data
            ?.targetCustomer
        ) || 0;
  
      const ofTarget =
        kunjungan -
        jumlahCustomer;
  
      const keteranganTarget =
        kunjungan -
        targetCustomer;
  
      let potonganTargetData =
        0;
  
      if (
        ofTarget < 0
      ) {
        potonganTargetData =
          Number(
            kantorCabang
              ?.bonus
              ?.data
              ?.insentif
          ) || 0;
      }
  
      const jumlahPotongan =
        potonganTargetData;
  
      const bonusInsentif =
        keteranganTarget >=
        0
          ? Number(
              kantorCabang
                ?.bonus
                ?.data
                ?.insentif
            ) || 0
          : 0;
  
      const bonusKunjungan =
        Number(
          document
            .getElementById(
              "bonusKunjunganVal"
            )
            ?.textContent
            .replace(
              /[^0-9]/g,
              ""
            )
        ) || 0;
  
      const bonusPay =
        Number(
          document
            .getElementById(
              "bonusPayVal"
            )
            ?.textContent
            .replace(
              /[^0-9]/g,
              ""
            )
        ) || 0;
  
      const jumlahBonus =
        bonusInsentif +
        bonusKunjungan +
        bonusPay;
      
      const inputOmsetValue =
        Number(
          inputOmset.value
            .replace(
              /\./g,
              ""
            )
        ) || 0;
      
      // ==========================
      // GROSS MARGIN
      // Omset - jumlah uang closing
      // ==========================
      const grossMargin =
        inputOmsetValue -
        jumlahUangClosing;
      
      // ==========================
      // PROFIT SEKARANG
      // grossMargin - bonus - upah harian
      // ==========================
      const upahHarian =
        Number(
          kantorCabang
            ?.upahHarian
        ) || 0;
      
      const profitSekarang =
        grossMargin -
        jumlahBonus -
        upahHarian;
      
      const profitKemarin =
        pay.margin -
        expired.margin -
        jumlahBonus -
        upahHarian;  
        
      const distribusi = {
        expired: {
          ...expired
        },
  
        pay: {
          ...pay
        },
  
        infoTarget: {
          kunjungan,

          tutup,
          pending,
          putus,

          targetData:
            ofTarget,

          targetCustomer:
            keteranganTarget,

          customerLama,
          customerTambahan,
          customerNew,
          jumlahCustomer,

          potongan: {
            potonganTargetData,

            potonganTargetCustomer:
              0,

            jumlahPotongan
          }
        },
        keuangan: {
          omset,
          inputOmset:
            inputOmsetValue,
          grossMargin,
          profitSekarang,
          profitKemarin,
          klaimInsentif:
            Number(
              document
                .getElementById(
                  "keuanganInsentif"
                )
                ?.value
                ?.replace(
                  /\./g,
                  ""
                )
            ) || 0,
        
          kasbon:
            Number(
              document
                .getElementById(
                  "keuanganKasbon"
                )
                ?.value
                ?.replace(
                  /\./g,
                  ""
                )
            ) || 0,
        
          bonus: {
            bonusInsentif,
            bonusKunjungan,
            bonusPay,
            jumlahBonus
          }
        }
      };
  
      await updateDoc(
        docRef,
        {
          tanggal,
          [`${selectedKurirUid}.distribusi`]: distribusi
        }
      );

      // Update store laporanAdmin
      try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          await saveLaporanAdminToDB(tanggal, snap.data());
        }
      } catch (err) {
        console.warn("Gagal update store laporanAdmin:", err.code);
      }

      // Update store dataHarian
      try {
        const existing = await getDataHarianFromDB(selectedKurirUid, tanggal);
        if (existing) {
          const updated = {
            ...existing.data,
            pay         : distribusi.pay,
            expired     : distribusi.expired,
            kunjungan   : distribusi.infoTarget?.kunjungan        || 0,
            customerLama     : distribusi.infoTarget?.customerLama     || 0,
            customerTambahan : distribusi.infoTarget?.customerTambahan || 0,
            customerNew      : distribusi.infoTarget?.customerNew      || 0,
            keterangan  : {
              tutup   : distribusi.infoTarget?.tutup   || 0,
              pending : distribusi.infoTarget?.pending || 0,
              putus   : distribusi.infoTarget?.putus   || 0,
            },
            pembayaran  : {
              bayarKonsumen : distribusi.keuangan?.inputOmset || 0,
              bayarProduksi : 0
            }
          };
          await saveDataHarianToDBLaporan(selectedKurirUid, tanggal, updated);
        }
      } catch (err) {
        console.warn("Gagal update store dataHarian:", err.code);
      }
  
      const laporanMarketingRef =
        doc(
          db,
          "users",
          selectedKurirUid,
          "laporanMarketing",
          tanggal
        );
  
      await setDoc(
        laporanMarketingRef,
        {
          distribusi
        },
        {
          merge: true
        }
      );
  
      btn.classList.add(
        "success"
      );
  
      btn.textContent =
        "Berhasil";
    } catch (err) {
      console.error(
        err
      );
  
      btn.classList.add(
        "error"
      );
  
      btn.textContent =
        "Gagal";
    } finally {
      setTimeout(
        () => {
          btn.classList.remove(
            "loading",
            "success",
            "error"
          );
  
          btn.textContent =
            "Kirim";
        },
        1600
      );
    }
  }
  btn.addEventListener(
    "click",
    () => {
      const inputInsentif =
        document.getElementById(
          "keuanganInsentif"
        );
      const hasInsentif =
        inputInsentif?.value.trim() !== "" &&
        Number(
          inputInsentif.value
            .replace(
              /\./g,
              ""
            )
        ) > 0;
      if (
        hasInsentif &&
        keteranganTarget < 0
      ) {
        openWarningBelumTarget();
        return;
      }
      const inputValue =
        Number(
          inputOmset.value
            .replace(
              /\./g,
              ""
            )
        ) || 0;
      if (
        inputValue !== omset
      ) {
        openWarningOmset(
          submitKeuangan
        );
        return;
      }
      submitKeuangan();
    }
  );
  const overlay =
    document.getElementById(
      "popupDetailOverlay"
    );
  const box =
    document.getElementById(
      "popupDetailBox"
    );
  if (window.innerWidth > 768) {
    box.style.left = "auto";
    box.style.right = "34px";
    const popupHeight =
      Math.min(
        box.offsetHeight || 650,
        window.innerHeight * 0.86
      );
    const centerTop =
      (
        window.innerHeight -
        popupHeight
      ) / 2;
    box.style.top =
      Math.max(
        24,
        centerTop
      ) + "px";
    box.style.transform =
      "scale(1)";
    enableDetailDrag();
  }
  overlay.classList.add(
    "show"
  );
}
function openPopup(title, tanggal, sum, varians, dataSource, userData) {
  const overlay = document.getElementById("popupDetailOverlay");
  const box     = document.getElementById("popupDetailBox");

  document.getElementById( "popupDetailTitle" ).textContent = title === "Pay" ? "Detail Pay (Margin)" : `Detail ${title}`;
  document.getElementById("popupDetailSubtitle").textContent = `Tanggal: ${tanggal}`;
  document.getElementById("popupDetailTotal").textContent    = sum;

  let totalQty   = 0;
  let totalHarga = 0;
  
  const html = varians.map(v => {
  
    const key =
      Object.keys(v)[0];
  
    const qty =
      Number(
        dataSource[key]
      ) || 0;
  
    const hargaProduksi =
      Number(
        v[key]
          ?.hargaProduksi
      ) || 0;
    
    const hargaKonsumen =
      Number(
        v[key]
          ?.hargaKonsumen
      ) || 0;
    
    // khusus PAY pakai margin
    const hargaPerItem =
      title === "Pay"
        ? (
            hargaKonsumen -
            hargaProduksi
          )
        : hargaProduksi;
    
    const subtotal =
      qty *
      hargaPerItem;
  
    totalQty += qty;
    totalHarga += subtotal;
  
    return `
      <div
        class="popup-detail-item"
      >
  
        <div
          class="popup-detail-item-key"
        >
          ${escapeHtml(key)}
        </div>
  
        <div
          class="popup-detail-item-value"
        >
          ${qty}
        </div>
  
        <div
          class="popup-detail-item-value"
        >
          ${formatRupiah(
            subtotal
          )}
        </div>
  
      </div>
    `;
  
  }).join("");
  
  document.getElementById(
    "popupDetailList"
  ).innerHTML = `
  
    ${html}
  
    <div
      class="popup-detail-divider"
      style="
        height:1px;
        background:
        rgba(
          176,
          138,
          92,
          .14
        );
        margin:6px 0;
      "
    ></div>
  
    <div
      class="popup-detail-item"
      style="
        background:
        rgba(
          176,
          138,
          92,
          .08
        );
        font-weight:700;
      "
    >
  
      <div
        class="popup-detail-item-key"
        style="
          color:#b08a5c;
        "
      >
        Jumlah
      </div>
  
      <div
        class="popup-detail-item-value"
        style="
          color:#b08a5c;
        "
      >
        ${totalQty}
      </div>
  
      <div
        class="popup-detail-item-value"
        style="
          color:#b08a5c;
        "
      >
        ${formatRupiah(
          totalHarga
        )}
      </div>
  
    </div>
  `;

  // posisi default desktop (pojok kanan tengah)
  if (window.innerWidth > 768) {
    box.style.left = "auto";
    box.style.right = "34px";
    // center vertikal aman
    const popupHeight = Math.min(
      box.offsetHeight || 650,
      window.innerHeight * 0.86
    );
    const centerTop =
      (window.innerHeight - popupHeight) / 2;
    box.style.top =
      Math.max(24, centerTop) + "px";
    box.style.transform =
      "scale(1)";
  }
  overlay.classList.add("show");
  // aktifkan drag hanya desktop
  if (window.innerWidth > 768) {
    enableDetailDrag();
  }
}
function closePopup() {
  document.getElementById("popupDetailOverlay").classList.remove("show");
  disableDetailDrag();
}
function enableDetailDrag() {
  const box = document.getElementById("popupDetailBox");
  const header = box?.querySelector(".popup-detail-header");
  if (!box || !header) return;
  const rect = box.getBoundingClientRect();

  box.style.left = rect.left + "px";
  box.style.top = rect.top + "px";
  box.style.right = "auto";
  box.style.transform = "none";
  box.style.position = "fixed"; // penting
  box.style.margin = "0";

  header.addEventListener("mousedown", onDragStart);
}
function disableDetailDrag() {
  const header = document.getElementById("popupDetailHeader");
  header?.removeEventListener("mousedown", onDragStart);
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
  const x   = Math.max(0, Math.min(e.clientX - _dragOffsetX, window.innerWidth  - box.offsetWidth));
  const y   = Math.max(0, Math.min(e.clientY - _dragOffsetY, window.innerHeight - box.offsetHeight));
  box.style.left = x + "px";
  box.style.top  = y + "px";
}
function onDragEnd() {
  _dragActive = false;
  document.body.style.userSelect = "";
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup",   onDragEnd);
}

document.getElementById("popupDetailClose")
  ?.addEventListener("click", closePopup);
document.getElementById("popupDetailOverlay")
  ?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closePopup();
  });
document.getElementById("warningOmsetOverlay")
  ?.addEventListener("click", e => {
    e.stopPropagation();
  });
(function setupSwipeClose() {
  const box = document.getElementById("popupDetailBox");
  if (!box) return;
  let startY      = 0;
  let currentY    = 0;
  let isDragging  = false;
  box.addEventListener("touchstart", e => {
    if (window.innerWidth > 768) return;
    startY     = e.touches[0].clientY;
    currentY   = startY;
    isDragging = true;
    box.style.transition = "none";
  }, { passive: true });
  box.addEventListener("touchmove", e => {
    if (!isDragging || window.innerWidth > 768) return;
    currentY      = e.touches[0].clientY;
    const deltaY  = currentY - startY;
    if (deltaY < 0) return; // arah atas, abaikan
    box.style.transform = `translateY(${deltaY}px)`;
  }, { passive: true });
  box.addEventListener("touchend", () => {
    if (!isDragging || window.innerWidth > 768) return;
    isDragging = false;
    const deltaY = currentY - startY;
    box.style.transition = "";
    if (deltaY > 120) {
      // cukup jauh → tutup
      box.style.transform = "translateY(100%)";
      setTimeout(() => {
        closePopup();
        box.style.transform = "";
      }, 280);
    } else {
      // kurang jauh → balik ke atas
      box.style.transform = "";
    }
  });
})();
function openWarningOmset(onContinue) {
  const overlay = document.getElementById( "warningOmsetOverlay" );
  const btnCek = document.getElementById( "btnCekLagi" );
  const btnLanjut = document.getElementById( "btnLanjutSimpan" );
  overlay.classList.add( "show" );
  btnCek.onclick =
    () => {
      overlay.classList.remove(
        "show"
      );
    };
  btnLanjut.onclick =
    () => {
      overlay.classList.remove(
        "show"
      );
      onContinue?.();
    };
}
function openBelumAdaData() {
  alert(
    "Belum ada data"
  );
}
function openWarningBelumTarget() {
  const overlay =
    document.getElementById(
      "warningTargetOverlay"
    );

  const btnCek =
    document.getElementById(
      "btnCekLagiTarget"
    );

  overlay.classList.add(
    "show"
  );

  btnCek.onclick =
    () => {
      overlay.classList.remove(
        "show"
      );
    };
}

function formatRupiah(angka) {
  return new Intl
    .NumberFormat(
      "id-ID"
    )
    .format(
      Number(
        angka
      ) || 0
    );
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
(function enableReportDragScroll() {
  const report =
    document.getElementById(
      "reportCollection"
    );
  if (!report) return;
  let isDown = false;
  let startX;
  let scrollLeft;
  // desktop only
  if (window.innerWidth <= 768)
    return;
  report.style.cursor = "grab";
  report.addEventListener(
    "mousedown",
    e => {
      isDown = true;
      report.classList.add( "dragging" );
      startX = e.pageX - report.offsetLeft; scrollLeft = report.scrollLeft; report.style.cursor = "grabbing";
    }
  );
  report.addEventListener(
    "mouseleave",
    () => {
      isDown = false;
      report.classList.remove(
        "dragging"
      );
      report.style.cursor =
        "grab";
    }
  );
  report.addEventListener(
    "mouseup",
    () => {
      isDown = false;
      report.classList.remove(
        "dragging"
      );
      report.style.cursor =
        "grab";
    }
  );
  report.addEventListener(
    "mousemove",
    e => {
      if (!isDown) return;
      e.preventDefault();
      const x =
        e.pageX -
        report.offsetLeft;
      const walk =
        (x - startX) * 1.4;
      report.scrollLeft =
        scrollLeft - walk;
    }
  );
})();

async function renderLaporanTanggalTable() {
  const tbody =
    document.getElementById("laporanTableBody");
  if (!tbody) return;
  const dateInput =
    document.getElementById("dateFilterInput");
  const selectedDate =
    dateInput?.value
      ? new Date(dateInput.value)
      : new Date();
  const year  = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const namaHari  = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const namaBulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const allUsers    = await getUsersFromDB();
  const adminData   = allUsers.find(u => u.uid === auth.currentUser?.uid);
  const activeVarians = (adminData?.varian || []).filter(v => {
    const key = Object.keys(v)[0];
    return key && v[key]?.isAktif;
  });
  const n = activeVarians.length;
  const mm   = String(month + 1).padStart(2, "0");
  const yyyy = String(year);
  // Ambil semua laporan bulan ini
  const allLaporan = {};
  for (let d = 1; d <= totalDays; d++) {
    const dd      = String(d).padStart(2, "0");
    const tgl     = `${yyyy}-${mm}-${dd}`;
    const record  = await getLaporanAdminFromDB(tgl);
    if (record) allLaporan[tgl] = record;
  }
  // Ambil semua dataHarian bulan ini (hanya jika kurir dipilih)
  const allDataHarian = {};
  if (selectedKurirUid) {
    for (let d = 1; d <= totalDays; d++) {
      const dd  = String(d).padStart(2, "0");
      const tgl = `${yyyy}-${mm}-${dd}`;
      const dh  = await getDataHarianFromDB(selectedKurirUid, tgl);
      if (dh) allDataHarian[tgl] = dh;
    }
  }
  // Tentukan range hari berdasar filter
  const dateInput2  = document.getElementById("dateFilterInput");
  const activeDate  = dateInput2?.value ? new Date(dateInput2.value) : new Date();
  const activeDay   = activeDate.getMonth() === month && activeDate.getFullYear() === year
    ? activeDate.getDate()
    : totalDays;
  const dayStart = 1;
  const dayEnd   = laporanFilter === "active" ? activeDay
                 : laporanFilter === "until"  ? activeDay
                 : totalDays;
  const onlyActive = laporanFilter === "active";
  tbody.innerHTML = "";
  const initTotals = () => ({
    closing: Array(n).fill(0),
    closingJml: 0,
    pay: Array(n).fill(0),
    payJml: 0,
    expired: Array(n).fill(0),
    expiredJml: 0,
    expiredPercent: 0,
    customerLama: 0,
    customerTambahan: 0,
    customerNew: 0,
    customerJml: 0,
    tutup: 0,
    pending: 0,
    putus: 0,
    kunjungan: 0,
    targetData: "",
    targetCustomer: "",
    omset: 0,
    validasiOmset: 0,
    bonus: 0,
    insentif: 0,
    kasbon: 0
  });
  let weeklyTotals = initTotals();
  let grandTotal   = initTotals();
  const resetWeeklyTotals = () => { weeklyTotals = initTotals(); };
  for (let day = dayStart; day <= dayEnd; day++) {
    if (onlyActive && day !== activeDay) continue;
    const date        = new Date(year, month, day);
    const dd          = String(day).padStart(2, "0");
    const tgl         = `${yyyy}-${mm}-${dd}`;
    const tanggalText = `${namaHari[date.getDay()]}, ${day} ${namaBulan[month]} ${year}`;
    // Data dari laporanAdmin — coba IndexedDB dulu, fallback Firestore
    let kurirData = null;
    if (selectedKurirUid) {
      const fromDB = allLaporan[tgl]?.data;
      if (fromDB?.[selectedKurirUid]) {
        kurirData = fromDB[selectedKurirUid];
      } else {
        // Fallback Firestore
        try {
          const snap = await getDoc(
            doc(db, "users", auth.currentUser.uid, "laporanAdmin", tgl)
          );
          if (snap.exists()) {
            const fsData = snap.data();
            kurirData = fsData[selectedKurirUid] || null;
            // Simpan ke IndexedDB supaya next render tidak perlu Firestore lagi
            await saveLaporanAdminToDB(tgl, fsData);
          }
        } catch (err) {
          console.warn(`Fallback Firestore gagal ${tgl}:`, err.code);
        }
      }
    }
    // Data dari dataHarian
    const dh = allDataHarian[tgl]?.data || {};
    // CLOSING dari pembayaran.closing
    const closing = kurirData?.pembayaran?.closing || {};
    let closingJml = 0;
    const closingCells = activeVarians.map(v => {
      const key = Object.keys(v)[0];
      const val = Number(closing[key]) || 0;
      closingJml += val;
      return `<td>${val > 0 ? val : ""}</td>`;
    }).join("") + `
      <td class="laporan-jml-cell">
        ${closingJml > 0 ? closingJml : ""}
      </td>
    `;
    // PAY dari laporanAdmin.distribusi.pay
    const pay = kurirData?.distribusi?.pay || {};
    let payJml = 0;
    const payCells = activeVarians.map(v => {
      const key = Object.keys(v)[0];
      const val = Number(pay[key]) || 0;
      payJml += val;
      return `<td>${val > 0 ? val : ""}</td>`;
    }).join("") + `
      <td class="laporan-jml-cell">
        ${payJml > 0 ? payJml : ""}
      </td>
    `;
    // EXPIRED dari laporanAdmin.distribusi.expired
    const expired =
      kurirData?.distribusi?.expired || {};
    let expiredJml = 0;
    const expiredCells =
      activeVarians.map(v => {
        const key =
          Object.keys(v)[0];
        const val =
          Number(expired[key]) || 0;
        expiredJml += val;
        return `
          <td>
            ${val > 0 ? val : ""}
          </td>
        `;
      }).join("");
    // persen expired vs pay
    const expiredPercent =
      payJml > 0
        ? Math.round(
            (expiredJml / payJml) * 100
          )
        : 0;
    const expiredExtraCells = `
      <td class="laporan-jml-cell">
        ${expiredJml > 0
          ? expiredJml
          : ""}
      </td>
      <td class="laporan-persentase-cell">
        ${payJml > 0
          ? expiredPercent + "%"
          : ""}
      </td>
    `;
    // CUSTOMER dari dataHarian
    const customerLama     = Number(dh.customerLama)     || 0;
    const customerTambahan = Number(dh.customerTambahan) || 0;
    const customerNew      = Number(dh.customerNew)      || 0;
    const customerJml      = customerLama + customerTambahan + customerNew;
    const customerCells = [
      customerLama,
      customerTambahan,
      customerNew,
      customerJml
    ].map((val, i) => `
      <td
        class="${
          i === 3
            ? "laporan-jml-cell"
            : ""
        }"
      >
        ${val > 0 ? val : ""}
      </td>
    `).join("");
    // INFO TARGET dari laporanAdmin.distribusi.infoTarget
    const infoTarget     = kurirData?.distribusi?.infoTarget || {};
    const tutup          = Number(infoTarget.tutup)          || 0;
    const pending        = Number(infoTarget.pending)        || 0;
    const putus          = Number(infoTarget.putus)          || 0;
    const kunjungan      = Number(infoTarget.kunjungan)      || 0;
    const targetData     = infoTarget.targetData             ?? "";
    const targetCustomer = infoTarget.targetCustomer         ?? "";
    const infoTargetCells = [
      tutup     > 0 ? tutup     : "",
      pending   > 0 ? pending   : "",
      putus     > 0 ? putus     : "",
      kunjungan > 0 ? kunjungan : "",
      targetData,
      targetCustomer
    ].map(val => `<td>${val !== "" ? val : ""}</td>`).join("");
    // KEUANGAN dari laporanAdmin.distribusi.keuangan
    const keuangan      = kurirData?.distribusi?.keuangan || {};
    const omset         = Number(keuangan.inputOmset)             || 0;
    const bonus         = (Number(keuangan.bonus?.bonusPay)       || 0)
                        + (Number(keuangan.bonus?.bonusKunjungan) || 0);
    const insentif      = Number(keuangan.klaimInsentif)          || 0;
    const kasbon        = Number(keuangan.kasbon)                 || 0;
    const validasiOmset = Number(keuangan.omset) || 0;
    const keuanganCells = [
      omset        > 0 ? `Rp ${formatRupiah(omset)}`        : "",
      validasiOmset > 0 ? `Rp ${formatRupiah(validasiOmset)}` : "",
      bonus        > 0 ? `Rp ${formatRupiah(bonus)}`        : "",
      insentif     > 0 ? `Rp ${formatRupiah(insentif)}`     : "",
      kasbon       > 0 ? `Rp ${formatRupiah(kasbon)}`       : ""
    ].map(val => `<td>${val}</td>`).join("");
    // Akumulasi weekly & grand total
    activeVarians.forEach((v, i) => {
      const key = Object.keys(v)[0];
      const closingVal =
        Number(closing[key]) || 0;
      const payVal =
        Number(pay[key]) || 0;
      const expiredVal =
        Number(expired[key]) || 0;
      weeklyTotals.closing[i] += closingVal;
      weeklyTotals.pay[i] += payVal;
      weeklyTotals.expired[i] += expiredVal;
      grandTotal.closing[i] += closingVal;
      grandTotal.pay[i] += payVal;
      grandTotal.expired[i] += expiredVal;
      weeklyTotals.closingJml += closingVal;
      weeklyTotals.payJml += payVal;
      weeklyTotals.expiredJml += expiredVal;
      grandTotal.closingJml += closingVal;
      grandTotal.payJml += payVal;
      grandTotal.expiredJml += expiredVal;
    });
    weeklyTotals.customerLama     += customerLama;
    weeklyTotals.customerTambahan += customerTambahan;
    weeklyTotals.customerNew      += customerNew;
    weeklyTotals.customerJml      += customerJml;
    weeklyTotals.tutup            += tutup;
    weeklyTotals.pending          += pending;
    weeklyTotals.putus            += putus;
    weeklyTotals.kunjungan        += kunjungan;
    weeklyTotals.omset            += omset;
    weeklyTotals.validasiOmset    += validasiOmset;
    weeklyTotals.bonus            += bonus;
    weeklyTotals.insentif         += insentif;
    weeklyTotals.kasbon           += kasbon;
    grandTotal.customerLama       += customerLama;
    grandTotal.customerTambahan   += customerTambahan;
    grandTotal.customerNew        += customerNew;
    grandTotal.customerJml        += customerJml;
    grandTotal.tutup              += tutup;
    grandTotal.pending            += pending;
    grandTotal.putus              += putus;
    grandTotal.kunjungan          += kunjungan;
    grandTotal.omset              += omset;
    grandTotal.validasiOmset      += validasiOmset;
    grandTotal.bonus              += bonus;
    grandTotal.insentif           += insentif;
    grandTotal.kasbon             += kasbon;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="tanggal-cell">${tanggalText}</td>
      ${closingCells}
      ${payCells}
      ${expiredCells}
      ${expiredExtraCells}
      ${customerCells}
      ${infoTargetCells}
      ${keuanganCells}
    `;
    tbody.appendChild(tr);
    // Tambah baris subtotal setiap hari Minggu
    if (date.getDay() === 0) {
      const subTr = document.createElement("tr");
      subTr.className = "laporan-subtotal-row";
      subTr.innerHTML = `
        <td class="tanggal-cell" style="font-weight:700;color:#b08a5c;">
          Total Minggu Ini
        </td>
        ${weeklyTotals.closing.map(v => `<td style="font-weight:700;">${v > 0 ? v : ""}</td>`).join("")}
        <td style="font-weight:700;">
          ${weeklyTotals.closingJml > 0 ? weeklyTotals.closingJml : ""}
        </td>
        ${weeklyTotals.pay.map(v => `<td style="font-weight:700;">${v > 0 ? v : ""}</td>`).join("")}
        <td style="font-weight:700;">
          ${weeklyTotals.payJml > 0 ? weeklyTotals.payJml : ""}
        </td>
        ${weeklyTotals.expired.map(v => `<td style="font-weight:700;">${v > 0 ? v : ""}</td>`).join("")}
        <td style="font-weight:700;">
          ${weeklyTotals.expiredJml > 0 ? weeklyTotals.expiredJml : ""}
        </td>
        <td
          class="laporan-persentase-cell"
          style="font-weight:700;"
        >
          ${
            weeklyTotals.payJml > 0
              ? Math.round(
                  (
                    weeklyTotals.expiredJml /
                    weeklyTotals.payJml
                  ) * 100
                ) + "%"
              : ""
          }
        </td>        
        <td style="font-weight:700;">${weeklyTotals.customerLama > 0 ? weeklyTotals.customerLama : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.customerTambahan > 0 ? weeklyTotals.customerTambahan : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.customerNew > 0 ? weeklyTotals.customerNew : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.customerJml > 0 ? weeklyTotals.customerJml : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.tutup > 0 ? weeklyTotals.tutup : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.pending > 0 ? weeklyTotals.pending : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.putus > 0 ? weeklyTotals.putus : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.kunjungan > 0 ? weeklyTotals.kunjungan : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.targetData !== "" ? weeklyTotals.targetData : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.targetCustomer !== "" ? weeklyTotals.targetCustomer : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.omset > 0 ? `Rp ${formatRupiah(weeklyTotals.omset)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.validasiOmset > 0 ? `Rp ${formatRupiah(weeklyTotals.validasiOmset)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.bonus > 0 ? `Rp ${formatRupiah(weeklyTotals.bonus)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.insentif > 0 ? `Rp ${formatRupiah(weeklyTotals.insentif)}` : ""}</td>
        <td style="font-weight:700;">${weeklyTotals.kasbon > 0 ? `Rp ${formatRupiah(weeklyTotals.kasbon)}` : ""}</td>
      `;
      tbody.appendChild(subTr);
      resetWeeklyTotals();
    }
  }
  // Baris total keseluruhan
  const totalTr = document.createElement("tr");
  totalTr.className = "laporan-grandtotal-row";
  totalTr.innerHTML = `
    <td class="tanggal-cell" style="font-weight:800;color:#b08a5c;">
      TOTAL
    </td>
    ${grandTotal.closing.map(v => `<td style="font-weight:800;">${v > 0 ? v : ""}</td>`).join("")}
    <td style="font-weight:800;">
      ${grandTotal.closingJml > 0 ? grandTotal.closingJml : ""}
    </td>
    ${grandTotal.pay.map(v => `<td style="font-weight:800;">${v > 0 ? v : ""}</td>`).join("")}
    <td style="font-weight:800;">
      ${grandTotal.payJml > 0 ? grandTotal.payJml : ""}
    </td>
    ${grandTotal.expired.map(v => `<td style="font-weight:800;">${v > 0 ? v : ""}</td>`).join("")}
    <td style="font-weight:800;">
      ${grandTotal.expiredJml > 0 ? grandTotal.expiredJml : ""}
    </td>
    <td
      class="laporan-persentase-cell"
      style="font-weight:800;"
    >
      ${
        grandTotal.payJml > 0
          ? Math.round(
              (
                grandTotal.expiredJml /
                grandTotal.payJml
              ) * 100
            ) + "%"
          : ""
      }
    </td>    
    <td style="font-weight:800;">${grandTotal.customerLama > 0 ? grandTotal.customerLama : ""}</td>
    <td style="font-weight:800;">${grandTotal.customerTambahan > 0 ? grandTotal.customerTambahan : ""}</td>
    <td style="font-weight:800;">${grandTotal.customerNew > 0 ? grandTotal.customerNew : ""}</td>
    <td style="font-weight:800;">${grandTotal.customerJml > 0 ? grandTotal.customerJml : ""}</td>
    <td style="font-weight:800;">${grandTotal.tutup > 0 ? grandTotal.tutup : ""}</td>
    <td style="font-weight:800;">${grandTotal.pending > 0 ? grandTotal.pending : ""}</td>
    <td style="font-weight:800;">${grandTotal.putus > 0 ? grandTotal.putus : ""}</td>
    <td style="font-weight:800;">${grandTotal.kunjungan > 0 ? grandTotal.kunjungan : ""}</td>
    <td style="font-weight:800;">${grandTotal.targetData !== "" ? grandTotal.targetData : ""}</td>
    <td style="font-weight:800;">${grandTotal.targetCustomer !== "" ? grandTotal.targetCustomer : ""}</td>
    <td style="font-weight:800;">${grandTotal.omset > 0 ? `Rp ${formatRupiah(grandTotal.omset)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.validasiOmset > 0 ? `Rp ${formatRupiah(grandTotal.validasiOmset)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.bonus > 0 ? `Rp ${formatRupiah(grandTotal.bonus)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.insentif > 0 ? `Rp ${formatRupiah(grandTotal.insentif)}` : ""}</td>
    <td style="font-weight:800;">${grandTotal.kasbon > 0 ? `Rp ${formatRupiah(grandTotal.kasbon)}` : ""}</td>
  `;
  tbody.appendChild(totalTr);
}
async function renderVarianHeader() {
  const adminData =
    usersCache.find(
      u =>
        u.uid === auth.currentUser?.uid
    );

  if (!adminData) return;

  const activeVarians =
    (adminData.varian || [])
      .filter(v => {
        const key =
          Object.keys(v)[0];

        return (
          key &&
          v[key]?.isAktif
        );
      });

  const jumlahVarian =
    activeVarians.length;

  // HEADER BARIS 1
  document.querySelector(
    ".laporan-table thead tr"
  ).innerHTML = `
    <th rowspan="2" class="th-tanggal">
      TANGGAL
    </th>

    <th colspan="${jumlahVarian}" class="th-section">
      CLOSING
    </th>

    <th colspan="${jumlahVarian}" class="th-section">
      PAY
    </th>

    <th colspan="${jumlahVarian}" class="th-section">
      EXPIRED
    </th>
  `;

  // HEADER BARIS 2
  const varianHeader =
    document.getElementById(
      "laporanVarianHeader"
    );

  varianHeader.innerHTML =
    `
      ${
        activeVarians
          .map(v => {
            const key =
              Object.keys(v)[0];

            return `
              <th>${escapeHtml(key)}</th>
            `;
          })
          .join("")
      }

      ${
        activeVarians
          .map(v => {
            const key =
              Object.keys(v)[0];

            return `
              <th>${escapeHtml(key)}</th>
            `;
          })
          .join("")
      }

      ${
        activeVarians
          .map(v => {
            const key =
              Object.keys(v)[0];

            return `
              <th>${escapeHtml(key)}</th>
            `;
          })
          .join("")
      }
    `;
}
async function renderLaporanHeader() {
  const topHeader =
    document.getElementById(
      "laporanHeaderTop"
    );
  const varianHeader =
    document.getElementById(
      "laporanVarianHeader"
    );
  if (
    !topHeader ||
    !varianHeader
  ) return;
  const user =
    auth.currentUser;
  if (!user) return;
  const users =
    await getUsersFromDB();
  const adminCabang =
    users.find(
      item =>
        item.uid === user.uid &&
        item.role ===
          "adminCabang"
    );
  if (!adminCabang) return;
  const activeVarians =
    (adminCabang.varian || [])
      .filter(v => {
        const key =
          Object.keys(v)[0];
        return (
          key &&
          v[key]?.isAktif
        );
      });
  const totalVarian =
    activeVarians.length;
  // BARIS 1
  topHeader.innerHTML = `
    <th rowspan="2" class="th-tanggal">
      TANGGAL
    </th>
    <th colspan="${totalVarian + 1}" class="th-section">
      CLOSING
    </th>
    <th colspan="${totalVarian + 1}" class="th-section">
      PAY
    </th>
    <th colspan="${totalVarian + 2}" class="th-section">
      EXPIRED
    </th>
    <th colspan="4" class="th-section">
      CUSTOMER
    </th>
    <th colspan="6" class="th-section">
      INFO TARGET
    </th>
    <th colspan="5" class="th-section">
      KEUANGAN
    </th>
  `;

    // BARIS 2
    varianHeader.innerHTML =
      "";
    ["closing", "pay", "expired"]
    .forEach(section => {
      activeVarians.forEach(v => {
        const key =
          Object.keys(v)[0];
        varianHeader.innerHTML += `
          <th>${escapeHtml(key)}</th>
        `;
      });
      varianHeader.innerHTML += `
        <th>JML</th>
      `;
      if (section === "expired") {
        varianHeader.innerHTML += `
          <th>%</th>
        `;
      }
    });
    ["Old", "Plus", "New", "JML"].forEach(item => {
      varianHeader.innerHTML += `<th>${item}</th>`;
    });
    ["Tutup", "Pending", "Putus", "Kunjungan", "Target Data", "Target Customer"].forEach(item => {
      varianHeader.innerHTML += `<th>${item}</th>`;
    });
    ["Omset", "Validasi Omset", "Bonus", "Insentif", "Kasbon"].forEach(item => {
      varianHeader.innerHTML += `<th>${item}</th>`;
    });
    // Dynamic CSS highlight
    const n = totalVarian;
    const styleId = "laporan-dynamic-style";
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    // karena sekarang tiap section ada +1 kolom JML
    const g = n + 1;
    const e = n + 2;
    
    // Header row 2
    const h1s = 1;
    const h1e = g;
    
    const h2s = h1e + 1;
    const h2e = h2s + g - 1;
    
    const h3s = h2e + 1;
    const h3e = h3s + e - 1;
    
    const h4s = h3e + 1;
    const h4e = h4s + 3;
    
    const h5s = h4e + 1;
    const h5e = h5s + 5;
    
    const h6s = h5e + 1;
    const h6e = h6s + 4;
    
    
    // Body td
    const b1s = 2;
    const b1e = b1s + g - 1;
    
    const b2s = b1e + 1;
    const b2e = b2s + g - 1;
    
    const b3s = b2e + 1;
    const b3e = b3s + e - 1;
    
    const b4s = b3e + 1;
    const b4e = b4s + 3;
    
    const b5s = b4e + 1;
    const b5e = b5s + 5;
    
    const b6s = b5e + 1;
    const b6e = b6s + 4;

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
      .laporan-table tbody td:nth-child(n+${b6s}):nth-child(-n+${b6e}) { background:#fbf5e9; }
    `;
}
(function setupTabelDragScroll() {
  const wrapper = document.querySelector(".laporan-table-wrapper");
  if (!wrapper) return;

  let isDown   = false;
  let startX;
  let startY;
  let scrollLeft;
  let scrollTop;

  wrapper.addEventListener("mousedown", e => {
    isDown     = true;
    startX     = e.pageX - wrapper.offsetLeft;
    startY     = e.pageY - wrapper.offsetTop;
    scrollLeft = wrapper.scrollLeft;
    scrollTop  = wrapper.scrollTop;
    wrapper.style.cursor = "grabbing";
    wrapper.style.userSelect = "none";
  });

  window.addEventListener("mouseup", () => {
    if (!isDown) return;
    isDown = false;
    wrapper.style.cursor = "";
    wrapper.style.userSelect = "";
  });

  wrapper.addEventListener("mouseleave", () => {
    if (!isDown) return;
    isDown = false;
    wrapper.style.cursor = "";
    wrapper.style.userSelect = "";
  });

  wrapper.addEventListener("mousemove", e => {
    if (!isDown) return;
    e.preventDefault();
    const x     = e.pageX - wrapper.offsetLeft;
    const y     = e.pageY - wrapper.offsetTop;
    const walkX = (x - startX) * 1.5;
    const walkY = (y - startY) * 1.5;
    wrapper.scrollLeft = scrollLeft - walkX;
    wrapper.scrollTop  = scrollTop  - walkY;
  });
})();
