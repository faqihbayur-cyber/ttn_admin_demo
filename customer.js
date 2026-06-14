
import { auth, db, storage } from "./index.js";
import {
  onAuthStateChanged
} from
"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const DB_NAME = "laporanDistribusiDB";
const DB_NAME_CUSTOMER = "customerDB";
const STORE_USERS = "users";
const STORE_CUSTOMER = "customer";
const CUSTOMER_STATE_KEY = "customerPageState";
  
let usersCache = [];
let currentUser = null;
let selectedUserUid = "all";
let customerSearchKeyword = "";
let selectedHariFilter = "Semua";
let selectedStatusFilter = true;

let pacState = {
  pemilikUid:  localStorage.getItem("pac_pemilikUid")  || "",
  pemilikNama: localStorage.getItem("pac_pemilikNama") || "Pilih pemilik",
  hari:        localStorage.getItem("pac_hari")        || "",
};
let pacFotoBlob = null;
function savePacState() {
  localStorage.setItem("pac_pemilikUid",  pacState.pemilikUid);
  localStorage.setItem("pac_pemilikNama", pacState.pemilikNama);
  localStorage.setItem("pac_hari",        pacState.hari);
}

let rollingMode = false;
let draggedCustomer = null;
let longPressTimer = null;
let isDraggingCustomer = false;
let draggingElement = null;
let hoveredKurirUid = null;
let dragPreviewEl = null;

onAuthStateChanged(
  auth,
  async user => {
    if (!user) {
      console.log("Belum login");
      return;
    }
    currentUser = user;
    console.log("Login:", user.uid);
    await loadUsersFromIndexedDB();
    loadCustomerState();
    setupDropdown();
    setupAddCustomer();
    setupReloadButton();
    setupLottie();
    await renderCustomerList();
    await renderDefaultAside();
    await renderApprovalList();
  }
);
function openDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME);

    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   =
        !existingDB.objectStoreNames.contains(STORE_USERS) ||
        !existingDB.objectStoreNames.contains(STORE_CUSTOMER) ||
        !existingDB.objectStoreNames.contains("rincianPengeluaranDB");

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

        if (!dbUp.objectStoreNames.contains(STORE_CUSTOMER)) {
          dbUp.createObjectStore(STORE_CUSTOMER, { keyPath: "id" });
          console.log("🗄️ Store customer dibuat");
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

async function loadUsersFromIndexedDB() {
  try{
    const db = await openDB();
    const tx = db.transaction(STORE_USERS, "readonly");
    const store = tx.objectStore(STORE_USERS);
    const request = store.getAll();
    request.onsuccess = () => {
        usersCache = request.result || []; renderDropdownUsers();
      };
  }catch(error){
    console.error("Gagal load users:", error);
  }
}
async function openCustomerDB() {
  return new Promise((resolve, reject) => {
    const checkReq = indexedDB.open(DB_NAME_CUSTOMER);

    checkReq.onsuccess = (e) => {
      const existingDB     = e.target.result;
      const currentVersion = existingDB.version;
      const needsUpgrade   = !existingDB.objectStoreNames.contains(STORE_CUSTOMER);

      existingDB.close();

      const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;
      const req = indexedDB.open(DB_NAME_CUSTOMER, targetVersion);

      req.onupgradeneeded = (ev) => {
        const dbUp = ev.target.result;

        if (!dbUp.objectStoreNames.contains(STORE_CUSTOMER)) {
          dbUp.createObjectStore(STORE_CUSTOMER, { keyPath: "id" });
          console.log("🗄️ Store customer dibuat");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    };

    checkReq.onerror = () => reject(checkReq.error);
  });
}
async function getCustomerFromDB() {
  const db = await openCustomerDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_CUSTOMER, "readonly");
    const store = tx.objectStore(STORE_CUSTOMER);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}
function saveCustomerState(){
  const state = {
    selectedUserUid,
    customerSearchKeyword,
    selectedHariFilter,
    selectedStatusFilter,
    selectedCustomerId:
      localStorage.getItem(
        "selectedCustomerId"
      ) || null
  };
  localStorage.setItem(
    CUSTOMER_STATE_KEY,
    JSON.stringify(state)
  );
}
function loadCustomerState(){
  try{
    const saved =
      localStorage.getItem(
        CUSTOMER_STATE_KEY
      );
    if (!saved) return;
    const state = JSON.parse(saved);
    selectedUserUid = state.selectedUserUid ?? "all";
    customerSearchKeyword = state.customerSearchKeyword ?? "";
    selectedHariFilter = state.selectedHariFilter ?? "Semua";
    selectedStatusFilter = state.selectedStatusFilter ?? true;
  }catch(error){
    console.error(
      "Gagal load state:",
      error
    );
  }
}
function filterCustomerData(customers){
  let filtered = selectedUserUid === "all" ? customers : customers.filter(
          c =>
            c.pemilik ===
            selectedUserUid
        );
  filtered = filtered.filter(
      c =>
        c.status ===
        selectedStatusFilter
    );
  if (selectedHariFilter !== "Semua"){
    filtered = filtered.filter(
        c =>
          c.hari ===
          selectedHariFilter
      );
  }
  if (customerSearchKeyword){
    filtered = filtered.filter(c =>
        (c.namaCustomer || "")
          .toLowerCase()
          .includes(
            customerSearchKeyword
              .toLowerCase()
          )
      );
  }
  return filtered;
}
async function renderCustomerList() {
  const listEl = document.getElementById("customerList");
  if (!listEl) return;
  if (!selectedUserUid && selectedUserUid !== "all") {
    listEl.innerHTML = `
      <div class="customer-placeholder">
        <div id="customerLottie" class="placeholder-lottie">
        </div>
    
        <div class="placeholder-title">
          Belum ada customer
        </div>
    
        <div class="placeholder-subtitle">
          Pilih kurir terlebih dahulu.
        </div>
      </div>`;
    
    setupLottie();
    return;
  }
  const allCustomer = await getCustomerFromDB();
  const filtered =
    filterCustomerData(
      allCustomer
    );
  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="customer-placeholder">
        <div id="customerLottie" class="placeholder-lottie">
        </div>
        
        <div class="placeholder-title">
          Belum ada customer
        </div>
    
        <div class="placeholder-subtitle">
          Data customer akan muncul di sini.
        </div>
    
      </div>`;
    
    setupLottie();
    return;
  }
  listEl.innerHTML = filtered.map(c => {
    const nama    = c.namaCustomer || "-";
    const jarak   = c.jarak != null ? `${Number(c.jarak).toFixed(2)} km` : "-";
    const foto    = c.foto || "";
    const inisial = nama.charAt(0).toUpperCase();
    const avatarHtml = foto
      ? `<img class="customer-photo" src="${foto}" alt="${nama}">`
      : `<div class="customer-photo" style="background:#b08a5c;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;">${inisial}</div>`;

    return `
      <div class="customer-item" data-customer-id="${c.id}">
        ${avatarHtml}
        <div class="customer-info">
          <div class="customer-name-row">
            <div class="customer-name">
              ${nama}
            </div>
          </div>
    
          <div class="customer-distance">
            ${jarak}
          </div>
        </div>
    
        <div class="customer-actions">
    
          <button
            class="customer-action-btn
              ${c.status === false ? "disabled" : ""}
            "
            title="${
              c.status === false
                ? "Sudah Dihapus"
                : "Hapus"
            }"
            ${
              c.status === false
                ? "disabled"
                : ""
            }
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18"/>
              <path d="M8 6V4h8v2"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
            </svg>
          </button>
    
          <button class="customer-action-btn customer-map-btn" title="Map">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 21s7-5.33 7-11a7 7 0 1 0-14 0c0 5.67 7 11 7 11z"/>
              <circle cx="12" cy="10" r="2.5"/>
            </svg>
          </button>
    
          <button class="customer-action-btn customer-roll-btn" title="Rolling">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M16 3h5v5"/>
              <path d="M21 3l-7 7"/>
              <path d="M8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>
            </svg>
          </button>
    
        </div>
    
      </div>
    `;
  }).join("");
  listEl
    .querySelectorAll(".customer-item")
    .forEach(item => {
      item.addEventListener("click", e => {
          if (
            e.target.closest(".customer-action-btn")
          ) return;
          const customerId = item.dataset.customerId;
          const customer = filtered.find(
              c =>
                c.id ===
                customerId
            );
          if (!customer)
            return;
          renderCustomerAside(
            customer
          );
          
          localStorage.setItem(
            "selectedCustomerId",
            customer.id
          );
          
          saveCustomerState();
        }
      );
    });
  setupDeleteCustomerButtons(filtered);
  setupMapButtons(filtered);
  setupRollingButtons(filtered);
}
async function saveUsersToDB(users) {
  try {
    const db = await openDB();
    const tx    = db.transaction(STORE_USERS, "readwrite");
    const store = tx.objectStore(STORE_USERS);
    users.forEach(u => store.put(u));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Gagal simpan users:", err);
  }
}
async function saveCustomerToIndexedDB(customers){
  try{
    const db = await openCustomerDB();
    const tx = db.transaction(STORE_CUSTOMER, "readwrite");
    const store = tx.objectStore(STORE_CUSTOMER);
    for (const customer of customers){
      store.put(customer);
    }
    await new Promise(
      (resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }
    );
    console.log("Customer berhasil disimpan ke IndexedDB");
  }catch(error){
    console.error("Gagal simpan customer:", error);
  }
}

function renderDropdownUsers(){
  const list = document.getElementById("customerDropdownList");
  if (!list)
    return;
  list.innerHTML = `
  
    <div class="customer-dropdown-item" id="customerDropdownAll">
      <div class="customer-dropdown-name">
        Semua
      </div>
      <div class="customer-dropdown-role">
        Semua customer
      </div>
    </div>
  `;
  const allItem = document.getElementById("customerDropdownAll");
  allItem.addEventListener(
    "click",
    () => {
      selectedUserUid = "all";
      customerSearchKeyword = "";
      saveCustomerState();
      const searchInput = document.getElementById("asideSearchInput");
      if (searchInput){
        searchInput.value = "";
      }  
      document.getElementById(
        "customerDropdownText"
      ).textContent = "Semua";
      document.getElementById(
        "customerRole"
      ).value = "Semua User";
      document.getElementById("customerDropdownPopup")
        .classList.remove("show");
      renderCustomerList();
      renderDefaultAside();
    }
  );
  usersCache
    .filter(user => user.role !== "adminCabang")
    .forEach(user => {
        const item = document.createElement("div");
        item.className = "customer-dropdown-item";
        item.innerHTML = `
          <div class="customer-dropdown-name">
            ${user.nama || "-"}
          </div>
          <div class="customer-dropdown-role">
            ${user.role || "-"}
          </div>
        `;
        item.addEventListener("click", () => selectUser(user)
        );
        list.appendChild(item);
      }
    );
}
function selectUser(user){
  selectedUserUid = user.uid;
  customerSearchKeyword = "";
  const searchInput = document.getElementById("asideSearchInput");
  if (searchInput){
    searchInput.value = "";
  }
  saveCustomerState();
  document.getElementById(
    "customerDropdownText"
  ).textContent =
    user.nama || "-";
  document.getElementById(
    "customerRole"
  ).value =
    user.role || "-";
  document.getElementById(
    "customerDropdownPopup"
  ).classList.remove("show");
  renderCustomerList();
  renderDefaultAside();
}
function setupDropdown(){
  const btn = document.getElementById("customerDropdownBtn");
  const popup = document.getElementById("customerDropdownPopup");
  if (!btn || !popup) return;
  btn.addEventListener("click", e => {
      e.stopPropagation();
      popup.classList.toggle("show");
    }
  );
  document.addEventListener("click", () => {
      popup.classList.remove("show");
    }
  );
}
function setupReloadButton(){
  const btn = document.getElementById("reloadCustomerBtn");
  if (!btn)
    return;
  btn.addEventListener("click",
  async () => {
    try {
      btn.disabled = true;
      btn.classList.add("loading");
      await new Promise(resolve => setTimeout(resolve, 1500));
      const adminCabang = usersCache.find(user => user.uid === currentUser.uid);
      if (!adminCabang) {
        console.error("AdminCabang tidak ditemukan");
        return;
      }

      // Ambil users createdBy adminCabang
      const usersSnap = await getDocs(query(
        collection(db, "users"),
        where("createdBy", "==", currentUser.uid)
      ));
      const usersData = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
      // Tambah juga data admin sendiri jika belum ada
      const adminSnap = await getDoc(doc(db, "users", currentUser.uid));
      if (adminSnap.exists()) {
        usersData.push({ uid: currentUser.uid, ...adminSnap.data() });
      }
      await saveUsersToDB(usersData);
      usersCache = usersData;
      renderDropdownUsers();

      // Ambil customer
      const customerSnap = await getDocs(query(
        collection(db, "customer"),
        where("idCabang", "==", adminCabang.idCabang)
      ));
      const customerData = customerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      await saveCustomerToIndexedDB(customerData);
      await renderCustomerList();
      await renderDefaultAside();
    } catch (error) {
      console.error("Gagal reload:", error);
    } finally {
      btn.disabled = false;
      btn.classList.remove("loading");
    }
  }
);
}
async function renderDefaultAside(){
  const ownerEl = document.getElementById("asideOwnerText");
  const countEl = document.getElementById("asideCustomerCount");
  const body = document.getElementById("asideBody");
  if (!ownerEl || !countEl || !body) return;
  ownerEl.textContent =
    selectedUserUid ===
    "all"
      ? "Semua"
      : selectedUser?.nama || "-";
  document.getElementById(
    "customerDropdownText"
  ).textContent =
    selectedUserUid === "all"
      ? "Semua"
      : selectedUser?.nama || "-";
  document.getElementById(
    "customerRole"
  ).value =
    selectedUserUid === "all"
      ? "Semua User"
      : selectedUser?.role || "-";
  const allCustomer =
    await getCustomerFromDB();
  const filtered =
    filterCustomerData(
      allCustomer
    );
  countEl.textContent = filtered.length;
  const selectedCustomerId =
    localStorage.getItem(
      "selectedCustomerId"
    );
  const selectedCustomer =
    filtered.find(
      c =>
        c.id ===
        selectedCustomerId
    );
  if (selectedCustomer){
    renderCustomerAside(
      selectedCustomer
    );
  }else{
    localStorage.removeItem(
    "selectedCustomerId"
  );
  saveCustomerState();
    body.innerHTML = `
      <div class="aside-placeholder">
        <img
          src="./logoTTN.png"
          alt="Logo"
          class="aside-logo"
        />
      </div>
    `;
  }
  setupAsideCustomerSearch();
  setupAsideFilters();
}
async function setupAsideCustomerSearch(){
  const input = document.getElementById("asideSearchInput");
  const suggest = document.getElementById("asideSearchSuggest");
  if (!input || !suggest)
    return;
  const allCustomer = await getCustomerFromDB();
  const filteredCustomer =
    selectedUserUid === "all"
      ? allCustomer.filter(
          c => c.status === true
        )
      : allCustomer.filter(
          c =>
            c.pemilik ===
              selectedUserUid &&
            c.status === true
        );
  input.addEventListener(
    "input",
    async () => {
      customerSearchKeyword = input.value.trim();
      saveCustomerState();
      await renderCustomerList();
      const keyword = customerSearchKeyword.toLowerCase();
      if (!keyword){
        suggest.innerHTML = "";
        suggest.classList.remove("show");
        return;
      }
      const result =
        filteredCustomer.filter(c => (c.namaCustomer || "")
              .toLowerCase()
              .includes(keyword)
          )
          .slice(0, 8);
      if (result.length === 0){
        suggest.innerHTML =
          `
          <div class="aside-search-item">
            Tidak ditemukan
          </div>
          `;
        suggest.classList.add("show");
        return;
      }
      suggest.innerHTML =
        result.map(c => {
            const owner =
              usersCache.find(u => u.uid === c.pemilik);
            return `
              <div class="aside-search-item" data-id="${c.id}">
                <div class="aside-search-name">
                  ${c.namaCustomer || "-"}
                </div>
                <div class="aside-search-owner">
                  ${
                    owner?.nama ||
                    "-"
                  }
                </div>
              </div>
            `;
          })
          .join("");
      suggest.classList.add("show");
      suggest.querySelectorAll(".aside-search-item[data-id]")
        .forEach(item => {
          item.addEventListener("click", () => {
              const customer =
                filteredCustomer.find(
                  c =>
                    c.id ===
                    item.dataset.id
                );
              if (!customer)
                return;
              renderCustomerAside(customer);
              input.value = customer.namaCustomer || "";
              customerSearchKeyword = customer.namaCustomer || "";
              saveCustomerState();
              renderCustomerList();
              suggest.classList.remove("show");
            }
          );
        });
    }
  );
  document.addEventListener("click", e => {
      if (!e.target.closest(".aside-search")){
        suggest.classList.remove("show");
      }
    }
  );
}
function setupAsideFilters(){
  const hariSelect = document.getElementById(
      "filterHari"
    );
  const statusSelect = document.getElementById(
      "filterStatus"
    );
  const hariText = document.getElementById(
      "filterHariText"
    );
  const statusText = document.getElementById(
      "filterStatusText"
    );
  const hariDropdown = document.getElementById(
      "hariDropdown"
    );
  const statusDropdown = document.getElementById(
      "statusDropdown"
    );
  const triggers = document.querySelectorAll(
      ".aside-dropdown-trigger"
    );
  if (!hariSelect || !statusSelect) return;
  hariSelect.value = selectedHariFilter;
  statusSelect.value = String(selectedStatusFilter);
  hariText.textContent = selectedHariFilter;
  statusText.textContent =
    selectedStatusFilter
      ? "Aktif"
      : "Tidak Aktif";
  triggers.forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const target = btn.dataset.target;
      const popup = document.getElementById(`${target}Dropdown`);
      document.querySelectorAll(".aside-dropdown-popup")
        .forEach(el => {
          if (el !== popup){
            el.classList.remove("show");
          }
        });
      popup.classList.toggle("show");
    };
  });
  hariDropdown.querySelectorAll(".aside-dropdown-item")
    .forEach(item => {
      item.onclick =
        async () => {
          const value = item.dataset.value;
          selectedHariFilter = value;
          saveCustomerState();
          hariSelect.value = value;
          hariText.textContent = value;
          hariDropdown.classList.remove("show");
          await renderCustomerList();
          await renderDefaultAside();
        };
    });
  statusDropdown.querySelectorAll(".aside-dropdown-item")
    .forEach(item => {
      item.onclick = async () =>
        {
          const value = item.dataset.value;
          selectedStatusFilter = value === "true";
          saveCustomerState();
          statusSelect.value = value;
          statusText.textContent =
            value === "true"
              ? "Aktif"
              : "Tidak Aktif";
          statusDropdown.classList.remove("show");
          await renderCustomerList();
          await renderDefaultAside();
        };
    });
  document.onclick = e => {
    if (!e.target.closest(".aside-custom-dropdown")){
      document
        .querySelectorAll(".aside-dropdown-popup")
        .forEach(el =>
          el.classList.remove("show")
        );
    }
  };
}
async function renderCustomerAside(customer){
  const body = document.getElementById(
      "asideBody"
    );
  if (!body) return;
  const pemilikUser = usersCache.find(
      user =>
        user.uid ===
        customer.pemilik
    );
  const createdByUser = usersCache.find(
      user =>
        user.uid ===
        customer.createdBy
    );

  const namaPemilik = pemilikUser?.nama || "-";
  const namaCreatedBy = createdByUser?.nama || "-";
  const statusCustomer =
    customer.isNew === true
      ? "Baru"
      : "Lama";

  body.innerHTML = `
    <div class="aside-customer-detail">
      <div class="aside-photo-card">

        ${
          customer.foto
            ? `
              <img
                src="${customer.foto}"
                alt="${customer.namaCustomer || "-"}"
                class="aside-customer-photo"
              />
            `
            : `
              <div class="aside-photo-empty">
                Tidak ada foto
              </div>
            `
        }

      </div>

      <div class="aside-detail-list">

        <div class="aside-detail-item">
          <span class="detail-key">
            Nama Customer:
          </span>

          <span class="detail-value">
            ${customer.namaCustomer || "-"}
          </span>
        </div>

        <div class="aside-detail-item">
          <span class="detail-key">
            Pemilik:
          </span>

          <span class="detail-value">
            ${namaPemilik}
          </span>
        </div>

        <div class="aside-detail-item aside-full">
          <span class="detail-key">
            Alamat:
          </span>

          <span class="detail-value">
            ${customer.alamatCustomer || "-"}
          </span>
        </div>

        <div class="aside-detail-item">
          <span class="detail-key">
            Jarak:
          </span>

          <span class="detail-value">
            ${
              customer.jarak != null
                ? `${Number(customer.jarak).toFixed(2)} km`
                : "-"
            }
          </span>
        </div>

        <div class="aside-detail-item">
          <span class="detail-key">
            Hari:
          </span>

          <span class="detail-value">
            ${customer.hari || "-"}
          </span>
        </div>

        <div class="aside-detail-item">
          <span class="detail-key">
            Data Kemarin:
          </span>
        
          <span class="detail-value">
            ${
              customer.dataKemarin &&
              typeof customer.dataKemarin === "object"
                ? Object.entries(
                    customer.dataKemarin
                  )
                    .map(
                      ([key, value]) =>
                        `${key}: ${
                          value?.qty ?? 0
                        }`
                    )
                    .join(" &nbsp;&nbsp;&nbsp; ")
                : "-"
            }
          </span>
        </div>

        <div class="aside-detail-item">
          <span class="detail-key">
            Status:
          </span>

          <span class="detail-value">
            ${statusCustomer}
          </span>
        </div>

        <div class="aside-detail-item">
          <span class="detail-key">
            Created By:
          </span>
        
          <span class="detail-value">
            ${namaCreatedBy}
          </span>
        </div>
        
        <div class="aside-detail-item">
                  <span class="detail-key">
            Keterangan:
          </span>
          ${
            customer.status === true
              ? `
                <div
                  class="detail-status active"
                >
                  Aktif
                </div>
              `
              : `
                <button
                  class="detail-status inactive"
                  id="restoreCustomerBtn"
                  data-id="${customer.id}"
                >
                  Non Aktif
                </button>
              `
          }
        </div>
      </div>

      <button class="edit-customer-btn" id="btnEditCustomer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Edit Customer
      </button>
    </div>
  `;
  const restoreBtn = document.getElementById("restoreCustomerBtn");
  if (restoreBtn) restoreBtn.onclick = () => openRestorePopup(customer);

  document.getElementById("btnEditCustomer").addEventListener("click", () => {
    openEditCustomerMode(customer);
  });
}

function setupAddCustomer() {
  const openBtn  = document.getElementById("addCustomerBtn");
  const overlay  = document.getElementById("popupAddCustomerOverlay");
  const closeBtn = document.getElementById("closeAddCustomerBtn");
  const box      = document.getElementById("popupAddCustomerBox");
  if (!openBtn || !overlay || !box) return;
  openBtn.addEventListener("click",  openPac);
  closeBtn.addEventListener("click", closePac);
  overlay.addEventListener("click",  e => { if (e.target === overlay) closePac(); });
  setupPacFoto();
  setupPacDropdownHari();
  setupPacDropdownPemilik();
  setupPacSave();
  setupPacSwipeClose(box, closePac);
}
function openPac() {
  document.getElementById("popupAddCustomerOverlay").classList.add("show");
  // Refresh list pemilik setiap kali popup dibuka
  const list       = document.getElementById("pacPemilikList");
  const staffUsers = usersCache.filter(u =>
    ["hunter","sales"].includes(u.role) &&
    u.createdBy === currentUser?.uid
  );
  if (list) {
    if (!staffUsers.length) {
      list.innerHTML = `<div class="pac-dropdown-item" style="pointer-events:none;opacity:.5;">Belum ada data, klik reload dulu</div>`;
    } else {
      list.innerHTML = staffUsers.map(u => `
        <div class="pac-dropdown-item" data-uid="${u.uid}" data-nama="${u.nama || "-"}">
          ${u.nama || "-"}
          <div class="pac-item-sub">${u.role}</div>
        </div>`).join("");
      list.querySelectorAll(".pac-dropdown-item").forEach(item => {
        item.addEventListener("click", () => {
          pacState.pemilikUid  = item.dataset.uid;
          pacState.pemilikNama = item.dataset.nama;
          savePacState();
          document.getElementById("pacPemilikText").textContent = item.dataset.nama;
          document.getElementById("pacPemilikUid").value        = item.dataset.uid;
          list.querySelectorAll(".pac-dropdown-item").forEach(el => el.classList.remove("active"));
          item.classList.add("active");
          document.getElementById("pacPemilikDropdown")?.classList.remove("active");
          renderPacDataKemarin(item.dataset.uid);
          validatePacForm();
        });
      });
    }
  }
  restorePacState();
}
function closePac() {
  document.getElementById("popupAddCustomerOverlay").classList.remove("show");
  resetPacFoto();
}
function restorePacState() {
  if (pacState.pemilikUid) {
    document.getElementById("pacPemilikText").textContent = pacState.pemilikNama;
    document.getElementById("pacPemilikUid").value        = pacState.pemilikUid;
    renderPacDataKemarin(pacState.pemilikUid);
    document.getElementById("pacPemilikList")
      ?.querySelectorAll(".pac-dropdown-item")
      .forEach(el => el.classList.toggle("active", el.dataset.uid === pacState.pemilikUid));
  }
  if (pacState.hari) {
    document.getElementById("pacHariText").textContent = pacState.hari;
    document.getElementById("pacHariList")
      ?.querySelectorAll(".pac-dropdown-item")
      .forEach(el => el.classList.toggle("active", el.dataset.value === pacState.hari));
  }
  validatePacForm();
}
function setupPacFoto() {
  const preview = document.getElementById("pacFotoPreview");
  const input   = document.getElementById("pacFotoInput");
  if (!preview || !input) return;
  preview.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    pacFotoBlob = await compressImage(file, 800, 0.75);
    const url   = URL.createObjectURL(pacFotoBlob);
    preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:14px;">`;
  });
}
function resetPacFoto() {
  pacFotoBlob = null;
  const input   = document.getElementById("pacFotoInput");
  const preview = document.getElementById("pacFotoPreview");
  if (input) input.value = "";
  if (preview) preview.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" class="pac-foto-icon">
      <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="13" r="3"/>
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
    <span class="pac-foto-label">Pilih Foto</span>`;
}
function setupPacDropdownHari() {
  const dropdown = document.getElementById("pacHariDropdown");
  const btn      = document.getElementById("pacHariBtn");
  const list     = document.getElementById("pacHariList");
  if (!dropdown || !btn || !list) return;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    document.getElementById("pacPemilikDropdown")?.classList.remove("active");
    dropdown.classList.toggle("active");
  });
  document.addEventListener("click", () => dropdown.classList.remove("active"));
  list.querySelectorAll(".pac-dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      pacState.hari = item.dataset.value;
      savePacState();
      document.getElementById("pacHariText").textContent = item.dataset.value;
      list.querySelectorAll(".pac-dropdown-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      dropdown.classList.remove("active");
      validatePacForm();
    });
  });
}
function setupPacDropdownPemilik() {
  const dropdown = document.getElementById("pacPemilikDropdown");
  const btn      = document.getElementById("pacPemilikBtn");
  const list     = document.getElementById("pacPemilikList");
  if (!dropdown || !btn || !list) return;
  const staffUsers = usersCache.filter(u =>
    ["hunter","sales"].includes(u.role) &&
    u.createdBy === currentUser?.uid
  );
  if (!staffUsers.length) {
    list.innerHTML = `<div class="pac-dropdown-item" style="pointer-events:none;opacity:.5;">Belum ada data</div>`;
  } else {
    list.innerHTML = staffUsers.map(u => `
      <div class="pac-dropdown-item" data-uid="${u.uid}" data-nama="${u.nama || "-"}">
        ${u.nama || "-"}
        <div class="pac-item-sub">${u.role}</div>
      </div>`).join("");
  }
  btn.addEventListener("click", e => {
    e.stopPropagation();
    document.getElementById("pacHariDropdown")?.classList.remove("active");
    dropdown.classList.toggle("active");
  });
  document.addEventListener("click", () => dropdown.classList.remove("active"));
  list.querySelectorAll(".pac-dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      pacState.pemilikUid  = item.dataset.uid;
      pacState.pemilikNama = item.dataset.nama;
      savePacState();
      document.getElementById("pacPemilikText").textContent = item.dataset.nama;
      document.getElementById("pacPemilikUid").value        = item.dataset.uid;
      list.querySelectorAll(".pac-dropdown-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      dropdown.classList.remove("active");
      renderPacDataKemarin(item.dataset.uid);
      validatePacForm();
    });
  });
}
function renderPacDataKemarin(pemilikUid) {
  const container = document.getElementById("pacDataKemarin");
  if (!container) return;
  const admin = usersCache.find(u => u.uid === currentUser?.uid);
  const activeVarians = (admin?.varian || [])
    .filter(v => { const k = Object.keys(v)[0]; return k && v[k]?.isAktif; });
  if (!activeVarians.length) {
    container.innerHTML = `<div class="pac-dk-empty">Tidak ada varian aktif</div>`;
    return;
  }
  container.innerHTML = `
    <div class="pac-dk-grid">
      ${activeVarians.map(v => {
        const key = Object.keys(v)[0];
        return `
          <div class="pac-dk-col">
            <label class="pac-dk-key">${key}</label>
            <input class="pac-dk-qty" type="number" inputmode="numeric" placeholder="0" min="0" data-key="${key}">
          </div>`;
      }).join("")}
    </div>`;
}
function validatePacForm() {
  const nama    = document.getElementById("pacNama")?.value.trim();
  const pemilik = document.getElementById("pacPemilikUid")?.value;
  const btn     = document.getElementById("pacSaveBtn");
  if (!btn) return;
  btn.disabled = !(nama && pemilik && pacState.hari);
}
function setupPacSave() {
  document.getElementById("pacNama")?.addEventListener("input", validatePacForm);
  document.getElementById("pacSaveBtn")?.addEventListener("click", async () => {
    const btn     = document.getElementById("pacSaveBtn");
    const btnText = document.getElementById("pacSaveBtnText");
    if (btn.disabled || btn.classList.contains("loading")) return;
    const nama    = document.getElementById("pacNama").value.trim();
    const alamat  = document.getElementById("pacAlamat").value.trim();
    const pemilik = document.getElementById("pacPemilikUid").value;
    if (!nama || !pemilik || !pacState.hari) return;
    const dataKemarin = {};
    document.querySelectorAll(".pac-dk-qty").forEach(input => {
      const key = input.dataset.key;
      const qty = Number(input.value) || 0;
      if (key) dataKemarin[key] = { qty };
    });
    const admin    = usersCache.find(u => u.uid === currentUser?.uid);
    const idCabang = admin?.idCabang || "";
    btn.classList.add("loading");
    btnText.innerHTML = `<span class="pac-spinner"></span> Menyimpan...`;
    try {
      let fotoUrl = "";
      if (pacFotoBlob) {
        const fileName   = `fotoCustomer/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, pacFotoBlob);
        fotoUrl = await getDownloadURL(storageRef);
      }
      // Cek duplikat nama dari IndexedDB
      const semuaCustomer = await getCustomerFromDB();
      const namaBaru = nama.toLowerCase();
      const duplikat = semuaCustomer.some(c =>
        (c.namaCustomer || "").toLowerCase() === namaBaru
      );
      if (duplikat) {
        btn.classList.remove("loading");
        btnText.textContent = "Simpan";
        btn.disabled = false;
        showPacAlert("Nama customer sudah ada!");
        return;
      }
      const payload = {
        namaCustomer  : nama,
        alamatCustomer: alamat,
        pemilik       : pemilik,
        hari          : pacState.hari,
        dataKemarin   : dataKemarin,
        foto          : fotoUrl,
        idCabang      : idCabang,
        createdBy     : currentUser.uid,
        createdAt     : serverTimestamp(),
        status        : true,
        isNew         : true,
        jarak         : null,
      };
      const docRef = await addDoc(collection(db, "customer"), payload);
      await saveCustomerToIndexedDB([{ ...payload, id: docRef.id, createdAt: Date.now() }]);
      resetPacForm();
      closePac();
      await renderCustomerList();
      await renderDefaultAside();
      btnText.textContent = "Berhasil ✓";
    } catch (err) {
      console.error("Gagal simpan customer:", err);
      btnText.textContent = "Gagal";
    } finally {
      setTimeout(() => {
        btn.classList.remove("loading");
        btn.disabled = true;
        btnText.textContent = "Simpan";
      }, 1600);
    }
  });
}
function resetPacForm() {
  const nama   = document.getElementById("pacNama");
  const alamat = document.getElementById("pacAlamat");
  if (nama)   nama.value   = "";
  if (alamat) alamat.value = "";
  document.querySelectorAll(".pac-dk-qty").forEach(i => i.value = "");
  resetPacFoto();
  validatePacForm();
}
function showPacAlert(pesan) {
  const existing = document.getElementById("pacAlertToast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "pacAlertToast";
  toast.textContent = pesan;
  toast.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(40,40,40,.92);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    padding: 12px 20px;
    border-radius: 12px;
    white-space: nowrap;
    z-index: 10;
    pointer-events: none;
    animation: pacFadeIn .2s ease;
  `;
  const box = document.getElementById("popupAddCustomerBox");
  if (!box) return;
  box.style.position = "relative";
  box.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}
function setupPacSwipeClose(box, closeFn) {
  if (!box) return;
  let startY = 0, startX = 0, curY = 0, active = false;
  box.addEventListener("touchstart", e => {
    if (window.innerWidth > 768 || box.scrollTop > 10) return;
    startY = curY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    active = true;
    box.style.transition = "none";
  }, { passive: true });
  box.addEventListener("touchmove", e => {
    if (!active || window.innerWidth > 768) return;
    curY = e.touches[0].clientY;
    const dY = curY - startY;
    const dX = Math.abs(e.touches[0].clientX - startX);
    // Abaikan jika gerak horizontal lebih dominan
    if (dX > dY) return;
    if (dY < 0) return;
    // Cegah pull-to-refresh browser
    e.preventDefault();
    box.style.transform = `translateY(${dY * .9}px)`;
  }, { passive: false });
  box.addEventListener("touchend", () => {
    if (!active || window.innerWidth > 768) return;
    active = false;
    const d = curY - startY;
    box.style.transition = "transform .28s ease";
    if (d > 120) {
      box.style.transform = "translateY(100%)";
      setTimeout(() => { closeFn(); box.style.transform = ""; box.style.transition = ""; }, 280);
    } else {
      box.style.transform = "";
    }
  });
}

function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * maxWidth / w);
          w = maxWidth;
        }
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), "image/jpeg", quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function openEditCustomerMode(customer) {
  const body = document.getElementById("asideBody");
  if (!body) return;

  const HARI_LIST = ["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu","Minggu"];

  body.innerHTML = `
    <div class="aside-customer-detail" id="editCustomerWrap">

      <!-- Foto -->
      <div class="aside-photo-card edit-photo-card" id="editFotoWrap">
        ${customer.foto
          ? `<img src="${customer.foto}" alt="" class="aside-customer-photo" id="editFotoPreview">`
          : `<div class="aside-photo-empty" id="editFotoPreview">Tidak ada foto</div>`
        }
        <button class="edit-foto-btn" id="btnGantiFoto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          Ganti Foto
        </button>
        <input type="file" id="editFotoInput" accept="image/*" style="display:none">
      </div>

      <div class="aside-detail-list">

        <!-- Nama -->
        <div class="aside-detail-item aside-full">
          <span class="detail-key">Nama Customer:</span>
          <input type="text" class="edit-input" id="editNama"
            value="${customer.namaCustomer || ""}" placeholder="Nama customer…">
        </div>

        <!-- Alamat -->
        <div class="aside-detail-item aside-full">
          <span class="detail-key">Alamat:</span>
          <textarea class="edit-input edit-textarea" id="editAlamat"
            placeholder="Alamat…">${customer.alamatCustomer || ""}</textarea>
        </div>

        <!-- Hari -->
        <div class="aside-detail-item">
          <span class="detail-key">Hari:</span>
          <select class="edit-input edit-select" id="editHari">
            ${HARI_LIST.map(h =>
              `<option value="${h}" ${customer.hari === h ? "selected" : ""}>${h}</option>`
            ).join("")}
          </select>
        </div>

        <!-- Status isNew -->
        <div class="aside-detail-item">
          <span class="detail-key">Status:</span>
          <select class="edit-input edit-select" id="editIsNew">
            <option value="false" ${customer.isNew !== true ? "selected" : ""}>Lama</option>
            <option value="true"  ${customer.isNew === true ? "selected" : ""}>Baru</option>
          </select>
        </div>

      </div>

      <!-- Tombol Simpan -->
      <button class="edit-save-btn" id="btnSimpanCustomer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Simpan
      </button>

    </div>
  `;

  // State foto baru
  let fotoBaruUrl = customer.foto || "";
  let fotoBaruBlob = null;

  // Ganti foto
  document.getElementById("btnGantiFoto").addEventListener("click", () => {
    document.getElementById("editFotoInput").click();
  });
  document.getElementById("editFotoInput").addEventListener("change", function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      fotoBaruUrl = e.target.result;
      fotoBaruBlob = file;
      const prev = document.getElementById("editFotoPreview");
      prev.outerHTML = `<img src="${fotoBaruUrl}" alt="" class="aside-customer-photo" id="editFotoPreview">`;
    };
    reader.readAsDataURL(file);
  });

  // Simpan
  document.getElementById("btnSimpanCustomer").addEventListener("click", async () => {
    const btn     = document.getElementById("btnSimpanCustomer");
    const nama    = document.getElementById("editNama").value.trim();
    const alamat  = document.getElementById("editAlamat").value.trim();
    const hari    = document.getElementById("editHari").value;
    const isNew   = document.getElementById("editIsNew").value === "true";

    if (!nama) { alert("Nama customer wajib diisi."); return; }

    btn.disabled = true;
    btn.innerHTML = `<span>Menyimpan…</span>`;

    try {
      let fotoFinal = customer.foto || "";

      // Upload foto baru ke Storage jika ada
      if (fotoBaruBlob) {
        // Compress dulu via canvas
        const compressedBlob = await compressImage(fotoBaruBlob, 800, 0.75);
        const { ref, uploadBytes, getDownloadURL } =
          await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js");
        const storageRef = ref(storage, `fotoCustomer/${customer.id}`);
        await uploadBytes(storageRef, compressedBlob, { contentType: "image/jpeg" });
        fotoFinal = await getDownloadURL(storageRef);
      }

      const updateData = {
        namaCustomer:    nama,
        alamatCustomer:  alamat,
        hari,
        isNew,
        foto:            fotoFinal,
        updatedAt:       serverTimestamp(),
      };

      // Update Firestore
      await updateDoc(doc(db, "customer", customer.id), updateData);

      // Update IndexedDB
      const dbLocal = await openCustomerDB();
      await new Promise((resolve, reject) => {
        const tx    = dbLocal.transaction(STORE_CUSTOMER, "readwrite");
        const store = tx.objectStore(STORE_CUSTOMER);
        const getReq = store.get(customer.id);
        getReq.onsuccess = () => {
          const old = getReq.result;
          if (!old) { resolve(); return; }
          store.put({ ...old, ...updateData, foto: fotoFinal, updatedAt: new Date().toISOString() });
        };
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });

      // Refresh
      const updatedCustomer = { ...customer, ...updateData, foto: fotoFinal };
      await renderCustomerList();
      renderCustomerAside(updatedCustomer);

    } catch (err) {
      console.error("❌ Gagal simpan customer:", err);
      alert("Gagal menyimpan. Coba lagi.");
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Simpan`;
    }
  });
}
function openRollingAside(customer){
  const body = document.getElementById(
      "asideBody"
    );
  if (!body) return;
  draggedCustomer = customer;
  rollingMode = true;

  const kurirList = usersCache.filter( user =>
        [
          "kurir",
          "hunter",
          "sales"
        ].includes(
          user.role
        )
    );

  body.innerHTML = `
    <div class="rolling-wrapper">
      <div class="rolling-title">
        Rolling Customer
      </div>
      <div class="rolling-subtitle">
        Long press customer,
        lalu geser ke kurir.
      </div>
      <div class="rolling-list">
        ${
          kurirList.map(user => `
            <div class="rolling-user" data-uid="${user.uid}">
              ${
                user.foto
                ? `
                  <img
                    src="${user.foto}"
                    class="rolling-photo"
                  />
                `
                : `
                  <div class="rolling-photo rolling-photo-empty">
                    ${
                      (
                        user.nama ||
                        "-"
                      )
                      .charAt(0)
                      .toUpperCase()
                    }
                  </div>
                `
              }
              <div>
                <div class="rolling-name">
                  ${
                    user.nama ||
                    "-"
                  }
                </div>
                <div class="rolling-role">
                  ${
                    user.role ||
                    "-"
                  }
                </div>
              </div>
            </div>
          `).join("")
        }
      </div>
      <div
        class="rolling-alert-card"
        id="rollingAlertCard"
      >
        <b>
          Customer dipilih:
        </b>
        <br><br>
        ${
          customer.namaCustomer
          || "-"
        }
        <br><br>
        Tekan tombol customer
        agak lama untuk
        memulai rolling.
      </div>
    </div>
  `;
  setupRollingLongPress();
  setupRollingDropZones();
}
function setupRollingLongPress(){
  const customerItems = document.querySelectorAll(
      ".customer-item"
    );
  customerItems.forEach(item => {
    const customerId = item.dataset.customerId;
    let pressStarted = false;
    const startPress = () => {
      if (!rollingMode)
        return;
      pressStarted = true;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
          if (!pressStarted)
            return;
          isDraggingCustomer = true;
          draggingElement = item;
          item.classList.add("dragging-customer");
          const customer = draggedCustomer;
          const alertCard = document.getElementById(
              "rollingAlertCard"
            );
          if (alertCard){

            alertCard.innerHTML = `
              <b>
                Sedang memindahkan:
              </b>
              <br><br>
              ${
                customer?.namaCustomer
                || "-"
              }
              <br><br>
              Geser ke salah satu
              kurir.
            `;
          }
          navigator.vibrate?.(50);
          createDragPreview(customer);
        },350);
    };
    const cancelPress = () => {
      pressStarted = false;
      clearTimeout(longPressTimer);
    };
    item.addEventListener("mousedown", startPress);
    item.addEventListener("touchstart", startPress,
      { passive:true }
    );
    item.addEventListener("mouseup", cancelPress);
    item.addEventListener("mouseleave", cancelPress);
    item.addEventListener("touchend", cancelPress);
  });
}
function setupRollingDropZones(){
  const kurirItems = document.querySelectorAll(
      ".rolling-user"
    );
  const clearHover = () => {
      kurirItems.forEach( el =>
          el.classList.remove("rolling-hover")
      );
      hoveredKurirUid = null;
    };
  document.addEventListener("mousemove", detectHover);
  document.addEventListener("touchmove", detectHover,
    { passive:false }
  );
  document.addEventListener("mouseup", finishDrop);
  document.addEventListener("touchend", finishDrop);
  function detectHover(e){
    if (!isDraggingCustomer) return;
    const point =
      e.touches?.[0] || e;
    moveDragPreview(
      point.clientX,
      point.clientY
    );
    const el = document.elementFromPoint(
        point.clientX,
        point.clientY
      );
    const target = el?.closest(".rolling-user");
    clearHover();
    if (!target)
      return;
    target.classList.add("rolling-hover");
    hoveredKurirUid = target.dataset.uid;
  }
  async function finishDrop(){
    clearTimeout(longPressTimer);
    if (!isDraggingCustomer) return;
    isDraggingCustomer = false;
    draggingElement ?.classList.remove("dragging-customer");
      removeDragPreview();
    if (!hoveredKurirUid){
      clearHover();
      return;
    }
    const targetUser = usersCache.find(u =>
          u.uid ===
          hoveredKurirUid
      );
    if (!targetUser)
      return;
    try{
      showRollingLoading(targetUser.nama);
      await new Promise(resolve => setTimeout(
            resolve,
            900
          )
      );
      await updateDoc(
        doc(db, "customer", draggedCustomer.id),
        {pemilik: hoveredKurirUid}
      );
      const dbLocal = await openCustomerDB();
      await new Promise( (resolve, reject) => {
          const tx = dbLocal.transaction(STORE_CUSTOMER, "readwrite");
          const store = tx.objectStore(STORE_CUSTOMER);
          const getReq = store.get(draggedCustomer.id);
          getReq.onsuccess = () => {
            const old = getReq.result;
            if (!old){
              resolve();
              return;
            }
            store.put({
              ...old,
              pemilik:
                hoveredKurirUid
            });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }
      );
      showRollingSuccess(
        draggedCustomer.namaCustomer,
        targetUser.nama
      );
      await renderCustomerList();
      await renderDefaultAside();
    }catch(error){
      console.error("Rolling gagal:", error);
      alert("Gagal rolling customer");
    }finally{
      clearHover();
      hoveredKurirUid = null;
    }
  }
}
function createDragPreview(customer){
  removeDragPreview();
  const el = document.createElement("div");
  el.className = "drag-customer-preview";
  const foto = customer?.foto;
  const nama = customer?.namaCustomer || "?";
  const inisial = nama.charAt(0).toUpperCase();
  el.innerHTML =
    foto
      ? `
        <img
          src="${foto}"
          alt="${nama}"
        />
      `
      : `
        <div
          class="drag-preview-empty"
        >
          ${inisial}
        </div>
      `;
  document.body.appendChild(el);
  dragPreviewEl = el;
}
function moveDragPreview( x, y){
  if (!dragPreviewEl)
    return;
  dragPreviewEl.style.left = `${x}px`;
  dragPreviewEl.style.top = `${y}px`;
}
function removeDragPreview(){
  dragPreviewEl ?.remove();
  dragPreviewEl = null;
}
const wrap = document.querySelector(".content-wrap");

let isDragging = false;
let isLongPress = false;
let startX = 0;
let startY = 0;
let holdTimer = null;

let currentScroll = 0;

// LONG PRESS START
document.addEventListener("touchstart", (e) => {
  const target = e.target.closest(".customer-item");
  if (!target) return;

  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;

  holdTimer = setTimeout(() => {
    isLongPress = true;
    isDragging = true;

    wrap.classList.add("dragging");

    target.classList.add("dragging-customer");
  }, 500);
});
document.addEventListener("touchmove", (e) => {
  if (!isLongPress) return;

  const x = e.touches[0].clientX;
  const y = e.touches[0].clientY;

  const dx = x - startX;
  const dy = y - startY;

  // kalau gerak horizontal lebih dominan
  if (Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault();
  }

  // DRAG KE KANAN → pindah ke aside
  if (dx < -80) {
    // swipe kiri (optional)
  }

  if (dx > 80) {
    // 🔥 AUTO SCROLL KE ASIDE KANAN
    wrap.scrollTo({
      left: wrap.clientWidth,
      behavior: "smooth"
    });
  }
});
document.addEventListener("touchend", () => {
  clearTimeout(holdTimer);

  isLongPress = false;
  isDragging = false;

  wrap.classList.remove("dragging");

  document.querySelectorAll(".customer-item").forEach(el => {
    el.classList.remove("dragging-customer");
  });
});


function showRollingLoading(namaKurir){
  const alertCard = document.getElementById(
      "rollingAlertCard"
    );
  if (!alertCard)
    return;

  alertCard.innerHTML = `
    <div class="rolling-loader">
    </div>
    <br>
    Memindahkan customer
    ke
    <b>
      ${namaKurir}
    </b>
    ...
  `;
}
function showRollingSuccess(customerName, kurirName){
  const alertCard = document.getElementById("rollingAlertCard");
  if (!alertCard)
    return;
  alertCard.innerHTML = `
    ✅ Customer
    <b>
      ${customerName}
    </b>
    berhasil dipindahkan ke
    <b>
      ${kurirName}
    </b>
  `;
}
function renderCustomerMapAside(customer){

  const body =
    document.getElementById(
      "asideBody"
    );

  if (!body) return;

  const lat =
    customer.lokasiCustomer?._lat;

  const lng =
    customer.lokasiCustomer?._long;

  if (
    lat == null ||
    lng == null
  ){
    body.innerHTML = `
      <div class="map-empty">
        Lokasi customer tidak tersedia
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="customer-map-wrapper">

      <div
        id="customerLeafletMap"
        class="customer-leaflet-map"
      ></div>

      <button
        class="visit-map-btn"
        id="visitMapBtn"
      >
        Kunjungi
      </button>

    </div>
  `;

  setTimeout(() => {

    const map = L.map(
      "customerLeafletMap",
      {
        zoomControl: true
      }
    ).setView(
      [lat, lng],
      16
    );

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          "&copy; OpenStreetMap"
      }
    ).addTo(map);

    L.marker([lat, lng])
      .addTo(map)
      .bindPopup(
        customer.namaCustomer || "-"
      )
      .openPopup();

    // fix ukuran map saat aside baru render
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

  }, 100);

  const visitBtn =
    document.getElementById(
      "visitMapBtn"
    );

  visitBtn.onclick =
    () => {

      const url =
        `https://www.google.com/maps?q=${lat},${lng}`;

      window.open(
        url,
        "_blank"
      );
    };
}
function setupDeleteCustomerButtons(filtered){
  document
    .querySelectorAll(
      '.customer-action-btn[title="Hapus"]'
    )
    .forEach((btn,index)=>{

      btn.onclick = e => {
        e.stopPropagation();

        const customer =
          filtered[index];

        openDeletePopup(
          customer
        );
      };
    });
}
function setupRollingButtons(filtered){
  document.querySelectorAll(
      ".customer-roll-btn"
    )
    .forEach((btn,index)=>{
      btn.onclick = e => {
        e.stopPropagation();
        const customer = filtered[index];
        openRollingAside(customer);
      };
    });
}
function setupMapButtons(filtered){
  document.querySelectorAll(
      '.customer-map-btn'
    )
    .forEach(
      (btn,index) => {
        btn.onclick = e => {
          e.stopPropagation();
          const customer = filtered[index];
          renderCustomerMapAside(customer);
          localStorage.setItem(
            "selectedCustomerId",
            customer.id
          );
          saveCustomerState();
        };
      }
    );
}
function openDeletePopup(customer){
  const popup =
    document.getElementById(
      "deleteCustomerPopup"
    );
  const text =
    document.getElementById(
      "deletePopupText"
    );
  const cancelBtn =
    document.getElementById(
      "cancelDeleteBtn"
    );
  const confirmBtn =
    document.getElementById(
      "confirmDeleteBtn"
    );
  text.innerHTML = `
    Yakin ingin menghapus
    <b>
      ${customer.namaCustomer || "-"}
    </b>
    ?
    <br><br>
    Customer akan
    dinonaktifkan.
  `;
  popup.classList.add("show");
  cancelBtn.onclick = () => {
      popup.classList.remove("show");
    };
  confirmBtn.onclick = async () => {
      try{
        confirmBtn.classList.add("loading");
        confirmBtn.textContent = "Menghapus...";
        await new Promise( resolve =>
            setTimeout(resolve, 1000)
        );
        await updateDoc(
          doc(db, "customer", customer.id),
          {status:false}
        );
        const dbLocal = await openCustomerDB();
        await new Promise( (resolve, reject) => {
            const tx = dbLocal.transaction(STORE_CUSTOMER, "readwrite");
            const store = tx.objectStore(STORE_CUSTOMER);
            const getReq = store.get(customer.id);
            getReq.onsuccess = () => {
                const oldData = getReq.result;
                if (!oldData){
                  resolve();
                  return;
                }
                store.put({
                  ...oldData,
                  status:false
                });
              };
            getReq.onerror = () => reject(getReq.error);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          }
        );
        popup.classList.remove("show");
        localStorage.removeItem("selectedCustomerId");
        await renderCustomerList();
        await renderDefaultAside();
      }catch(error){
        console.error("Gagal hapus customer:", error);
        alert("Gagal hapus customer");
      }finally{
        confirmBtn.classList.remove("loading");
        confirmBtn.textContent = "Hapus";
      }
    };
}
function openRestorePopup(customer){
  const popup = document.getElementById(
      "restoreCustomerPopup"
    );
  const text =document.getElementById(
      "restorePopupText"
    );
  const cancelBtn = document.getElementById(
      "cancelRestoreBtn"
    );
  const confirmBtn = document.getElementById(
      "confirmRestoreBtn"
    );
  text.innerHTML = `
    Yakin ingin
    mengembalikan customer
    <b>
      ${customer.namaCustomer || "-"}
    </b>
    ?
  `;
  popup.classList.add("show");
  cancelBtn.onclick = () => {
      popup.classList.remove("show");
    };
  confirmBtn.onclick = async () => {
      try{
        confirmBtn.classList.add("loading");
        confirmBtn.textContent = "Mengembalikan...";
        await new Promise(resolve =>
            setTimeout(resolve, 1000)
        );
        await updateDoc(doc(db, "customer", customer.id),
          {status:true}
        );
        const dbLocal = await openCustomerDB();
        await new Promise( (resolve,reject)=>{
            const tx = dbLocal.transaction(STORE_CUSTOMER, "readwrite");
            const store = tx.objectStore(STORE_CUSTOMER);
            const getReq = store.get(customer.id);
            getReq.onsuccess = () => {
                const oldData = getReq.result;
                if (!oldData){
                  resolve();
                  return;
                }
                store.put({
                  ...oldData,
                  status:true
                });
              };
            tx.oncomplete = () => resolve();
            tx.onerror =
              () =>
                reject(
                  tx.error
                );
          }
        );
        popup.classList.remove("show");
        await renderCustomerList();
        await renderDefaultAside();
      }catch(error){
        console.error("Restore gagal:", error);
        alert("Gagal mengembalikan customer");
      }finally{
        confirmBtn.classList.remove("loading");
        confirmBtn.textContent = "Kembalikan";
      }
    };
}

function setupLottie(){
  const container = document.getElementById("customerLottie");
  if (!container)
    return;
  lottie.loadAnimation({
    container,
    renderer:"svg",
    loop:true,
    autoplay:true,
    path:"./anime.json"
  });
}

// APPROVAL ROLLING
async function renderApprovalList() {
  const container = document.getElementById("approvalList");
  if (!container) return;

  container.innerHTML = `
    <div class="approval-loading">
      Memuat data...
    </div>
  `;

  try {
    if (!currentUser) throw new Error("User belum login");

    const me = usersCache.find(u => u.uid === currentUser.uid);
    const idCabang = me?.idCabang;
    if (!idCabang) throw new Error("idCabang tidak ditemukan");

    const q = query(
      collection(db, "rolling"),
      where("idCabang", "==", idCabang),
      where("status",   "==", "pending")
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="approval-placeholder">
          Belum ada request approval
        </div>
      `;
      return;
    }

    container.innerHTML = snap.docs.map(docSnap => {
      const d  = docSnap.data();
      const id = docSnap.id;

      const typeLabel = d.type === "hari"
        ? "Rolling Hari"
        : "Rolling Pemilik";

      const detailHTML = d.type === "hari"
        ? `
          <div class="approval-item-row">
            <span class="approval-item-label">Dari</span>
            <span class="approval-item-val">${d.from?.hari || "-"}</span>
          </div>
          <div class="approval-item-row">
            <span class="approval-item-label">Ke</span>
            <span class="approval-item-val">${d.to?.hari || "-"}</span>
          </div>
        `
        : `
          <div class="approval-item-row">
            <span class="approval-item-label">Dari</span>
            <span class="approval-item-val">${d.from?.namaUser || "-"}</span>
          </div>
          <div class="approval-item-row">
            <span class="approval-item-label">Ke</span>
            <span class="approval-item-val">${d.to?.namaUser || "-"}</span>
          </div>
        `;

      const createdAt = d.createdAt?.toDate
        ? d.createdAt.toDate().toLocaleDateString("id-ID", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
          })
        : "-";

      const toHari     = d.to?.hari                         || "";
      const toIdUser   = d.to?.idUser                       || "";
      const idCustomer = d.from?.idCustomer || d.idCustomer || "";

      return `
        <div class="approval-item"
          data-id="${id}"
          data-type="${d.type || ""}"
          data-id-customer="${idCustomer}"
          data-to-hari="${toHari}"
          data-to-id-user="${toIdUser}"
        >
          <div class="approval-item-header">
            <div class="approval-item-name">${d.namaCustomer || "-"}</div>
            <div class="approval-item-type">${typeLabel}</div>
          </div>

          <div class="approval-item-body">
            <div class="approval-item-row">
              <span class="approval-item-label">Diajukan oleh</span>
              <span class="approval-item-val">${d.requestedBy?.nama || "-"}</span>
            </div>
            ${detailHTML}
            ${d.alasan ? `
              <div class="approval-item-row">
                <span class="approval-item-label">Alasan</span>
                <span class="approval-item-val">${d.alasan}</span>
              </div>
            ` : ""}
            <div class="approval-item-row">
              <span class="approval-item-label">Waktu</span>
              <span class="approval-item-val">${createdAt}</span>
            </div>
          </div>

          <div class="approval-item-actions">
            <button
              class="approval-btn approval-btn--reject"
              data-id="${id}"
              data-action="rejected"
            >
              ✕ Tolak
            </button>
            <button
              class="approval-btn approval-btn--approve"
              data-id="${id}"
              data-action="approved"
            >
              ✓ Setujui
            </button>
          </div>
        </div>
      `;
    }).join("");

    setupApprovalActions();

  } catch (err) {
    console.error("renderApprovalList error:", err);
    container.innerHTML = `
      <div class="approval-placeholder">
        ❌ Gagal memuat: ${err.message}
      </div>
    `;
  }
}
function setupApprovalActions() {
  const container = document.getElementById("approvalList");
  if (!container) return;

  container.querySelectorAll(".approval-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      if (!id || !action) return;

      const card = btn.closest(".approval-item");

      // Disable semua tombol di card
      card?.querySelectorAll(".approval-btn").forEach(b => {
        b.disabled      = true;
        b.style.opacity = "0.5";
      });

      try {
        // 1. Update status rolling
        await updateDoc(doc(db, "rolling", id), {
          status     : action,
          approvedAt : serverTimestamp(),
          approvedBy : currentUser.uid
        });

        // 2. Jika approved — update customer
        if (action === "approved") {
          const type       = card.dataset.type;
          const idCustomer = card.dataset.idCustomer;
          const toHari     = card.dataset.toHari;
          const toIdUser   = card.dataset.toIdUser;

          if (!idCustomer) throw new Error("idCustomer tidak ditemukan di data rolling");

          if (type === "hari") {
            if (!toHari) throw new Error("Hari tujuan tidak ditemukan");
            await updateDoc(doc(db, "customer", idCustomer), { hari: toHari });
            await updateCustomerInIndexedDB(idCustomer, { hari: toHari });

          } else if (type === "pemilik") {
            if (!toIdUser) throw new Error("ID user tujuan tidak ditemukan");
            await updateDoc(doc(db, "customer", idCustomer), { pemilik: toIdUser });
            await updateCustomerInIndexedDB(idCustomer, { pemilik: toIdUser });
          }
        }

        // 3. Animasi lalu refresh list + customer
        if (card) {
          card.style.transition = "opacity .25s, transform .25s";
          card.style.opacity    = "0";
          card.style.transform  = "translateX(30px)";
          setTimeout(async () => {
            await renderApprovalList();
            await renderCustomerList();
            await renderDefaultAside();
          }, 280);
        } else {
          await renderApprovalList();
          await renderCustomerList();
          await renderDefaultAside();
        }

      } catch (err) {
        console.error("handleApprovalAction error:", err);
        card?.querySelectorAll(".approval-btn").forEach(b => {
          b.disabled      = false;
          b.style.opacity = "";
        });
        alert("Gagal memproses: " + err.message);
      }
    });
  });
}
async function updateCustomerInIndexedDB(idCustomer, fields) {
  try {
    const dbConn = await openCustomerDB();
    const tx     = dbConn.transaction(STORE_CUSTOMER, "readwrite");
    const store  = tx.objectStore(STORE_CUSTOMER);

    await new Promise((resolve, reject) => {
      const getReq = store.get(idCustomer);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          resolve();
          return;
        }
        const putReq = store.put({ ...existing, ...fields });
        putReq.onsuccess = () => resolve();
        putReq.onerror   = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
      tx.onerror     = () => reject(tx.error);
    });

    console.log("✅ IndexedDB customer updated:", idCustomer, fields);

  } catch (err) {
    console.error("updateCustomerInIndexedDB error:", err);
  }
}
