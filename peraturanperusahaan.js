import { auth, db }           from "./index.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LS_KEY_SAMPUL = 'profilSampul';

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

    // Foto avatar
    if (foto) {
      const imgEl = document.getElementById('avatarImg');
      imgEl.src = foto;
      imgEl.style.display = 'block';
      document.getElementById('avatarInitial').style.display = 'none';
    }

    // Sampul dari localStorage
    loadSampul();

  } catch (err) {
    console.error('❌ profil auth:', err);
    window.location.href = 'login.html';
  }
});

(function () {

  // ─── DATA DUMMY ──────────────────────────────
  const DUMMY_DATA = [
    {
      id: "bab_1",
      nomor: 1,
      judul: "Ketentuan Umum",
      urutan: 1,
      aktif: true,
      updatedAt: "2026-01-15",
      pasal: [
        {
          nomor: 1, judul: "Definisi", urutan: 1, aktif: true,
          ayat: [
            { nomor: 1, isi: "Perusahaan adalah PT Rizquna Jaya Mandiri yang bergerak di bidang distribusi dan pemasaran.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Karyawan adalah setiap orang yang terikat hubungan kerja dengan perusahaan berdasarkan perjanjian kerja.", urutan: 2, aktif: true },
            { nomor: 3, isi: "Peraturan Perusahaan adalah ketentuan yang dibuat secara tertulis oleh pengusaha yang memuat syarat-syarat kerja.", urutan: 3, aktif: true }
          ]
        },
        {
          nomor: 2, judul: "Tujuan", urutan: 2, aktif: true,
          ayat: [
            { nomor: 1, isi: "Peraturan perusahaan ini bertujuan untuk menciptakan hubungan kerja yang harmonis antara perusahaan dan karyawan.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Menjamin kepastian hak dan kewajiban masing-masing pihak dalam hubungan kerja.", urutan: 2, aktif: true }
          ]
        },
        {
          nomor: 3, judul: "Ruang Lingkup", urutan: 3, aktif: true,
          ayat: [
            { nomor: 1, isi: "Peraturan ini berlaku bagi seluruh karyawan perusahaan di semua cabang dan wilayah kerja.", urutan: 1, aktif: true }
          ]
        }
      ]
    },
    {
      id: "bab_2",
      nomor: 2,
      judul: "Hak dan Kewajiban Karyawan",
      urutan: 2,
      aktif: true,
      updatedAt: "2026-01-15",
      pasal: [
        {
          nomor: 4, judul: "Hak Karyawan", urutan: 1, aktif: true,
          ayat: [
            { nomor: 1, isi: "Setiap karyawan berhak mendapatkan upah sesuai dengan perjanjian kerja yang telah disepakati.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Karyawan berhak mendapatkan cuti tahunan sebanyak 12 hari kerja setelah bekerja selama 12 bulan berturut-turut.", urutan: 2, aktif: true },
            { nomor: 3, isi: "Karyawan berhak mendapatkan jaminan sosial ketenagakerjaan sesuai peraturan perundangan yang berlaku.", urutan: 3, aktif: true }
          ]
        },
        {
          nomor: 5, judul: "Kewajiban Karyawan", urutan: 2, aktif: true,
          ayat: [
            { nomor: 1, isi: "Karyawan wajib mentaati seluruh peraturan perusahaan dan kebijakan yang ditetapkan manajemen.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Karyawan wajib menjaga kerahasiaan informasi perusahaan yang bersifat rahasia.", urutan: 2, aktif: true },
            { nomor: 3, isi: "Karyawan wajib hadir tepat waktu sesuai jadwal yang telah ditetapkan.", urutan: 3, aktif: true },
            { nomor: 4, isi: "Karyawan wajib menjaga nama baik perusahaan di dalam maupun di luar lingkungan kerja.", urutan: 4, aktif: true }
          ]
        },
        {
          nomor: 6, judul: "Jam Kerja", urutan: 3, aktif: true,
          ayat: [
            { nomor: 1, isi: "Jam kerja normal adalah 8 jam per hari atau 40 jam per minggu, tidak termasuk waktu istirahat.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Waktu istirahat diberikan selama 1 jam pada hari kerja dan 1,5 jam pada hari Jumat.", urutan: 2, aktif: true }
          ]
        }
      ]
    },
    {
      id: "bab_3",
      nomor: 3,
      judul: "Sanksi dan Pelanggaran",
      urutan: 3,
      aktif: true,
      updatedAt: "2026-02-01",
      pasal: [
        {
          nomor: 7, judul: "Jenis Pelanggaran", urutan: 1, aktif: true,
          ayat: [
            { nomor: 1, isi: "Pelanggaran ringan adalah pelanggaran yang tidak mengakibatkan kerugian langsung bagi perusahaan.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Pelanggaran sedang adalah pelanggaran yang mengakibatkan kerugian terbatas bagi perusahaan atau rekan kerja.", urutan: 2, aktif: true },
            { nomor: 3, isi: "Pelanggaran berat adalah pelanggaran yang mengakibatkan kerugian besar atau mencemarkan nama baik perusahaan.", urutan: 3, aktif: true }
          ]
        },
        {
          nomor: 8, judul: "Jenis Sanksi", urutan: 2, aktif: true,
          ayat: [
            { nomor: 1, isi: "Sanksi teguran lisan diberikan untuk pelanggaran ringan pertama kali.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Sanksi teguran tertulis pertama diberikan untuk pelanggaran ringan yang berulang atau pelanggaran sedang pertama.", urutan: 2, aktif: true },
            { nomor: 3, isi: "Pemutusan Hubungan Kerja dapat dilakukan apabila karyawan melakukan pelanggaran berat.", urutan: 3, aktif: true }
          ]
        },
        {
          nomor: 9, judul: "Prosedur Penanganan Pelanggaran", urutan: 3, aktif: true,
          ayat: [
            { nomor: 1, isi: "Setiap pelanggaran harus dilaporkan kepada atasan langsung dalam waktu 1x24 jam.", urutan: 1, aktif: true },
            { nomor: 2, isi: "Penanganan pelanggaran dilakukan secara objektif dengan mendengar keterangan dari semua pihak terkait.", urutan: 2, aktif: true }
          ]
        }
      ]
    }
  ];

  // ─── STATE ────────────────────────────────────
  let _data        = [];
  let _searchMode  = false;
  let _keyword     = "";

  // ─── INIT ─────────────────────────────────────
  window.initPeraturanView = async function () {
    renderLoadingState();

    // Ambil data kantor dari IndexedDB
    const idb = await window.openAppDB();
    const kantorData = await new Promise(resolve => {
      try {
        const tx  = idb.transaction("kantorDB", "readonly");
        const req = tx.objectStore("kantorDB").getAll();
        req.onsuccess = () => {
          const raw = req.result?.[0] || {};
          resolve(raw.data || raw);
        };
        req.onerror = () => resolve({});
      } catch { resolve({}); }
    });

    // Render nama PT dan foto di hero
    // Scope ke view peraturan agar tidak salah ambil elemen
    const viewEl    = document.getElementById("view-peraturan");
    const heroIcon  = viewEl?.querySelector(".pp-hero-icon");
    const heroTitle = viewEl?.querySelector(".pp-hero-title");

    if (heroTitle && kantorData.namaPt) {
      heroTitle.innerText = kantorData.namaPt;
    }

    if (heroIcon) {
      if (kantorData.fotoPt) {
        heroIcon.innerHTML = `
          <img
            src="${kantorData.fotoPt}"
            alt="Logo"
            style="width:44px;height:44px;object-fit:contain;border-radius:10px;"
            onerror="this.parentElement.innerHTML='<i class=\'fa-solid fa-scale-balanced\'></i>'"
          />
        `;
      }
      // Jika tidak ada fotoPt, biarkan icon fa-scale-balanced tetap tampil
    }

    try {
      // Coba fetch dari Firestore
      const snap = await window.getDocs(
        window.collection(window.db, "peraturanPerusahaan")
      );
      if (!snap.empty) {
        _data = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(b => b.aktif !== false)
          .sort((a, b) => (a.urutan ?? a.nomor ?? 0) - (b.urutan ?? b.nomor ?? 0));
      } else {
        _data = DUMMY_DATA;
      }
    } catch (e) {
      console.warn("Firestore gagal, pakai dummy:", e.message);
      _data = DUMMY_DATA;
    }
    renderPeraturan(_data);
    renderStats(_data);
    renderSheetList(_data);
  };

  function renderLoadingState() {
    const list = document.getElementById("ppList");
    if (list) list.innerHTML = `
      <div class="pp-loading">
        <div class="pp-spinner"></div>
        <div>Memuat peraturan...</div>
      </div>`;
  }

  // ─── STATS ────────────────────────────────────
  function renderStats(data) {
    const totalBab   = data.length;
    const totalPasal = data.reduce((s, b) => s + (b.pasal?.length || 0), 0);
    const dates = data.map(b => {
      const u = b.updatedAt;
      if (!u) return null;
      // Firestore Timestamp
      if (u?.toDate) return u.toDate().getTime();
      // String atau number
      return new Date(u).getTime();
    }).filter(Boolean).sort((a,b) => b - a);

    const lastUpdate = dates[0]
      ? new Date(dates[0]).toLocaleDateString("id-ID", {
          day:"2-digit", month:"short", year:"numeric"
        })
      : "-";

    const el = id => document.getElementById(id);
    if (el("statBab"))    el("statBab").innerText    = totalBab;
    if (el("statPasal"))  el("statPasal").innerText  = totalPasal;
    if (el("statUpdate")) el("statUpdate").innerText = lastUpdate;
  }

  // ─── RENDER PERATURAN ─────────────────────────
  window.renderPeraturan = function (data, keyword) {
    const list = document.getElementById("ppList");
    if (!list) return;

    if (!data || data.length === 0) {
      list.innerHTML = `
        <div class="pp-empty">
          <i class="fa-solid fa-file-circle-xmark"></i>
          Tidak ada peraturan ditemukan
        </div>`;
      return;
    }

    list.innerHTML = data.map((bab, bi) => {
      const babLabel = toRoman(bab.nomor || bi + 1);
      const pasalList = (bab.pasal || [])
        .filter(p => p.aktif !== false)
        .sort((a, b) => (a.urutan || a.nomor) - (b.urutan || b.nomor));

      return `
        <div class="pp-bab-card" id="bab-${bab.id}" data-bab-id="${bab.id}">
          <div class="pp-bab-header" onclick="toggleBab('${bab.id}')">
            <div class="pp-bab-num">BAB<br>${babLabel}</div>
            <div class="pp-bab-info">
              <div class="pp-bab-label">Bab ${bab.nomor || bi + 1}</div>
              <div class="pp-bab-judul">${highlight(bab.judul, keyword)}</div>
              <div class="pp-bab-meta">${pasalList.length} Pasal</div>
            </div>
            <i class="fa-solid fa-chevron-down pp-bab-chevron"></i>
          </div>
          <div class="pp-bab-content">
            <div class="pp-bab-inner">
              ${pasalList.map(p => renderPasal(p, bab.id, keyword)).join("")}
            </div>
          </div>
        </div>`;
    }).join("");

    // Auto-expand jika search
    if (keyword) {
      document.querySelectorAll(".pp-bab-card").forEach(c => c.classList.add("open"));
      document.querySelectorAll(".pp-pasal-card").forEach(c => c.classList.add("open"));
    }
  };

  function renderPasal(p, babId, keyword) {
    const ayatList = (p.ayat || [])
      .filter(a => a.aktif !== false)
      .sort((a, b) => (a.urutan || a.nomor) - (b.urutan || b.nomor));

    return `
      <div class="pp-pasal-card" id="pasal-${babId}-${p.nomor}" data-pasal="${babId}-${p.nomor}">
        <div class="pp-pasal-header" onclick="togglePasal('${babId}', ${p.nomor})">
          <div class="pp-pasal-num">${p.nomor}</div>
          <div class="pp-pasal-info">
            <div class="pp-pasal-label">Pasal ${p.nomor}</div>
            <div class="pp-pasal-judul">${highlight(p.judul, keyword)}</div>
          </div>
          <i class="fa-solid fa-chevron-down pp-pasal-chevron"></i>
        </div>
        <div class="pp-pasal-content">
          <div class="pp-pasal-inner">
            ${ayatList.map(a => `
              <div class="pp-ayat">
                <div class="pp-ayat-num">(${a.nomor})</div>
                <div class="pp-ayat-isi">${highlight(a.isi, keyword)}</div>
              </div>`).join("")}
          </div>
        </div>
      </div>`;
  }

  // ─── TOGGLE BAB ───────────────────────────────
  window.toggleBab = function (babId) {
    const card = document.getElementById("bab-" + babId);
    if (!card) return;
    card.classList.toggle("open");
  };

  // ─── TOGGLE PASAL ─────────────────────────────
  window.togglePasal = function (babId, pasalNomor) {
    const card = document.getElementById(`pasal-${babId}-${pasalNomor}`);
    if (!card) return;
    card.classList.toggle("open");
  };

  // ─── SEARCH ───────────────────────────────────
  let _searchTimeout = null;
  window.filterPeraturan = function (keyword) {
    _keyword = keyword.trim();
    const clearBtn = document.getElementById("ppSearchClear");
    if (clearBtn) clearBtn.classList.toggle("visible", _keyword.length > 0);

    clearTimeout(_searchTimeout);
    _searchTimeout = setTimeout(() => {
      if (!_keyword) {
        renderPeraturan(_data);
        return;
      }
      const kw = _keyword.toLowerCase();
      const filtered = _data.map(bab => {
        const babMatch = (bab.judul || "").toLowerCase().includes(kw);
        const pasalFiltered = (bab.pasal || []).map(p => {
          const pasalMatch = (p.judul || "").toLowerCase().includes(kw);
          const ayatFiltered = (p.ayat || []).filter(a =>
            (a.isi || "").toLowerCase().includes(kw)
          );
          if (pasalMatch || ayatFiltered.length > 0) {
            return { ...p, ayat: pasalMatch ? p.ayat : ayatFiltered };
          }
          return null;
        }).filter(Boolean);

        if (babMatch || pasalFiltered.length > 0) {
          return { ...bab, pasal: babMatch ? bab.pasal : pasalFiltered };
        }
        return null;
      }).filter(Boolean);

      renderPeraturan(filtered, _keyword);
    }, 250);
  };

  window.clearSearch = function () {
    const input = document.getElementById("ppSearchInput");
    if (input) { input.value = ""; input.focus(); }
    window.filterPeraturan("");
  };

  // ─── SEARCH TOGGLE ────────────────────────────
  window.toggleSearch = function () {
    const bar   = document.getElementById("ppSearchBar");
    const input = document.getElementById("ppSearchInput");
    if (!bar) return;
    _searchMode = !_searchMode;
    bar.classList.toggle("open", _searchMode);
    if (_searchMode) setTimeout(() => input?.focus(), 300);
    else { clearSearch(); bar.classList.remove("open"); }
  };

  // ─── BOTTOM SHEET ─────────────────────────────
  function renderSheetList(data) {
    const el = document.getElementById("ppSheetList");
    if (!el) return;
    el.innerHTML = data.map((bab, bi) => `
      <div class="pp-sheet-item" onclick="scrollToBab('${bab.id}')">
        <div class="pp-sheet-item-num">BAB<br>${toRoman(bab.nomor || bi + 1)}</div>
        <div class="pp-sheet-item-judul">${bab.judul}</div>
        <i class="fa-solid fa-chevron-right" style="color:var(--text-secondary);font-size:11px"></i>
      </div>`).join("");
  }

  window.openDaftarBab = function () {
    document.getElementById("ppOverlay")?.classList.add("active");
    document.getElementById("ppSheet")?.classList.add("open");
  };

  window.closeDaftarBab = function () {
    document.getElementById("ppOverlay")?.classList.remove("active");
    document.getElementById("ppSheet")?.classList.remove("open");
  };

  window.scrollToBab = function (babId) {
    closeDaftarBab();
    // Buka bab jika belum terbuka
    const card = document.getElementById("bab-" + babId);
    if (card && !card.classList.contains("open")) {
      card.classList.add("open");
    }
    setTimeout(() => {
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  };

  // ─── HELPERS ──────────────────────────────────
  function toRoman(n) {
    const map = [
      [1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],
      [100,"C"],[90,"XC"],[50,"L"],[40,"XL"],
      [10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]
    ];
    let r = "";
    for (const [v, s] of map) { while (n >= v) { r += s; n -= v; } }
    return r;
  }

  function highlight(text, keyword) {
    if (!keyword || !text) return text || "";
    const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`(${esc})`, "gi"),
      `<span class="pp-highlight">$1</span>`);
  }

})();