
document.addEventListener(
  "DOMContentLoaded",
  function(){

    const nav =
      document.querySelector("nav");

    const currentPage =
      window.location.pathname
      .split("/")
      .pop();

    nav.innerHTML = `

      <!-- FLOAT BUTTON -->
      <div class="nav-fab" id="navToggle">
        <div class="hamburger">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <!-- OVERLAY -->
      <div class="nav-overlay" id="navOverlay"></div>

      <!-- DRAWER -->
      <div class="nav-drawer" id="navDrawer">
        <div class="menu-header">
          <h2>MENU</h2>
          <div class="menu-line"></div>
        </div>

        <!-- HOME -->
        <a href="index.html" class="nav-link ${currentPage === "index.html" || currentPage === "" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          <span>Home</span>
        </a>

        <!-- DATA HARIAN -->
        <a href="dataharian.html" class="nav-link ${currentPage === "dataharian.html" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
          <span>Data Harian</span>
        </a>

        <!-- LAPORAN -->
        <a href="laporan.html" class="nav-link ${currentPage === "laporan.html" ? "active" : ""}">
          <svg viewBox="0 0 24 24">
            <path d="M4 19h16"/>
            <path d="M7 16V9"/>
            <path d="M12 16V5"/>
            <path d="M17 16v-7"/>
          </svg>
          <span>Laporan Distribusi</span>
        </a>
        
        <!-- RINCIAN -->
        <a href="rincianpengeluaran.html" class="nav-link ${currentPage === "rincianpengeluaran.html" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <span>Rincian Pengeluaran</span>
        </a>

        <!-- CUSTOMER -->
        <a href="customer.html" class="nav-link ${currentPage === "customer.html" ? "active" : ""}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
        </svg>
          <span>Customer</span>
        </a>

        <!-- STOCK OPNAME -->
        <a href="stockopname.html" class="nav-link ${currentPage === "stockopname.html" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205 3 1m1.5.5-1.5-.5M6.75 7.364V3h-3v18m3-13.636 10.5-3.819" />
          </svg>
          <span>Stock Opname</span>
        </a>
        
        <!-- ANALYSIS DISTRIBUSI -->
        <a href="analysisdistribusi.html" class="nav-link ${currentPage === "analysisdistribusi.html" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
          </svg>
          <span>Analysis Distribusi</span>
        </a>
        
        <!-- ANALYSIS DISTRIBUSI -->
        <a href="analysisproduksi.html" class="nav-link ${currentPage === "analysisproduksi.html" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
          </svg>
          <span>Analysis Produksi</span>
        </a>
        
        <!-- PROFIL -->
        <a href="profil.html" class="nav-link ${currentPage === "profil.html" ? "active" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          <span>Profil</span>
        </a>

        <!-- LOGOUT -->
        <a href="login.html" class="nav-link logout-btn">
          <svg viewBox="0 0 24 24">
            <path d="M15 16l5-4-5-4"/>
            <path d="M20 12H9"/>
            <path d="M13 20H5V4h8"/>
          </svg>
          <span>Logout</span>
        </a>

      </div>
    `;
    
    // Halaman yang dikunci
    const LOCKED_PAGES = [
      'analysisdistribusi.html',
      'analysisproduksi.html'
    ];
    const SESSION_DURATION = 30 * 60 * 1000; // 30 menit
    const SESSION_KEY = 'pageUnlocked';

    function isUnlocked() {
      const t = sessionStorage.getItem(SESSION_KEY);
      if (!t) return false;
      return (Date.now() - Number(t)) < SESSION_DURATION;
    }

    function setUnlocked() {
      sessionStorage.setItem(SESSION_KEY, Date.now());
    }

    // Pasang listener ke nav link yang terkunci
    function attachLockListeners() {
      LOCKED_PAGES.forEach(page => {
        const link = nav.querySelector(`a[href="${page}"]`);
        if (!link) return;

        link.addEventListener('click', async (e) => {
          // Kalau sudah unlock, langsung masuk
          if (isUnlocked()) return;

          e.preventDefault();
          const targetHref = link.getAttribute('href');

          // Ubah nav link jadi input mode
          const original = link.innerHTML;
          link.innerHTML = `
            <div class="nav-lock-form" id="nav-lock-form-${page}">
              <input
                class="nav-lock-input"
                type="password"
                placeholder="Password..."
                autocomplete="off"
              />
              <button class="nav-lock-submit">➤</button>
            </div>
          `;
          link.classList.add('nav-link-locked');

          const input  = link.querySelector('.nav-lock-input');
          const submit = link.querySelector('.nav-lock-submit');

          input.focus();

          // Klik di luar → kembalikan ke normal
          function restoreLink(e2) {
            if (!link.contains(e2.target)) {
              link.innerHTML = original;
              link.classList.remove('nav-link-locked', 'nav-link-error');
              document.removeEventListener('click', restoreLink);
            }
          }
          setTimeout(() => document.addEventListener('click', restoreLink), 0);

          // Submit password
          async function tryUnlock() {
            const inputVal = input.value.trim();
            if (!inputVal) return;

            submit.disabled    = true;
            submit.textContent = '⏳';

            try {
              // Ambil auth & db dari window
              const _auth = window._firebaseAuth;
              const _db   = window._firebaseDb;
              if (!_auth || !_db) throw new Error('Firebase belum siap');

              const user = _auth.currentUser;
              if (!user) throw new Error('Belum login');

              // Pakai Firebase modular via window
              const { doc: _doc, getDoc: _getDoc } = window._firebaseFirestore;

              const userSnap   = await _getDoc(_doc(_db, 'users', user.uid));
              const idCabang   = userSnap.data()?.idCabang;
              if (!idCabang) throw new Error('idCabang tidak ditemukan');

              const cabangSnap   = await _getDoc(_doc(_db, 'kantorCabang', idCabang));
              const pagePassword = cabangSnap.data()?.pagePassword;

              if (inputVal === pagePassword) {
                // Benar → unlock & navigasi
                setUnlocked();
                document.removeEventListener('click', restoreLink);
                window.location.href = targetHref;
              } else {
                // Salah → shake & reset
                link.classList.add('nav-link-error');
                input.value = '';
                input.placeholder = 'Password salah!';
                submit.disabled    = false;
                submit.textContent = '➤';
                setTimeout(() => {
                  link.classList.remove('nav-link-error');
                  input.placeholder = 'Password...';
                }, 1500);
              }
            } catch (err) {
              console.error('Lock error:', err);
              submit.disabled    = false;
              submit.textContent = '➤';
            }
          }

          submit.addEventListener('click', tryUnlock);
          input.addEventListener('keydown', (e3) => {
            if (e3.key === 'Enter') tryUnlock();
          });
        });
      });
    }

    attachLockListeners();


    const toggleBtn =
      document.getElementById(
        "navToggle"
      );

    const overlay =
      document.getElementById(
        "navOverlay"
      );

    const drawer =
      document.getElementById(
        "navDrawer"
      );


    function openNav(){

      drawer.classList.add(
        "open"
      );

      overlay.classList.add(
        "show"
      );

      document.body.classList.add(
        "nav-open"
      );

      toggleBtn.classList.add(
        "active"
      );

    }


    function closeNav(){

      drawer.classList.remove(
        "open"
      );

      overlay.classList.remove(
        "show"
      );

      document.body.classList.remove(
        "nav-open"
      );

      toggleBtn.classList.remove(
        "active"
      );

    }


    toggleBtn.addEventListener(
      "click",
      ()=>{

        if(
          drawer.classList.contains(
            "open"
          )
        ){

          closeNav();

        }else{

          openNav();

        }

      }
    );


    overlay.addEventListener(
      "click",
      closeNav
    );

  }
);