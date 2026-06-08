import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// =========================
// FIREBASE
// =========================
const firebaseConfig = {

  apiKey:
    "AIzaSyCp32H2WeN3A4ZwwWeUWe3Qcjqh0mz_vvQ",

  authDomain:
    "teh-tarik-nusantara-26371.firebaseapp.com",

  projectId:
    "teh-tarik-nusantara-26371"

};

const app =
  initializeApp(
    firebaseConfig
  );


export const auth =
  getAuth(app);

export const db =
  getFirestore(app);

// Expose ke window untuk file non-module (navbar.js)
window._firebaseAuth      = auth;
window._firebaseDb        = db;
window._firebaseFirestore = { doc, getDoc };


// =========================
// AUTH CHECK
// ADMIN CABANG ONLY
// =========================
onAuthStateChanged(
  auth,
  async(user)=>{

    // BELUM LOGIN
    if(!user){

      logout();
      return;
    }

    const uid =
      user.uid;

    try{

      // USERS/{uid}
      const userRef =
        doc(
          db,
          "users",
          uid
        );

      const userSnap =
        await getDoc(
          userRef
        );

      // USER TIDAK ADA
      if(
        !userSnap.exists()
      ){

        logout();
        return;
      }

      const data =
        userSnap.data();


      // HARUS ADMIN CABANG
      if(
        data.role !==
        "adminCabang"
      ){

        logout();
        return;
      }


      // =========================
      // AMBIL NAMA CABANG
      // =========================
      let namaCabang =
        "-";

      if(data.idCabang){

        try{

          const cabangRef =
            doc(
              db,
              "kantorCabang",
              data.idCabang
            );

          const cabangSnap =
            await getDoc(
              cabangRef
            );

          if(
            cabangSnap.exists()
          ){

            namaCabang =
              cabangSnap.data()
              .namaCabang
              ||
              "-";
          }

        }catch(err){

          console.log(
            "Gagal ambil cabang",
            err
          );
        }

      }


      // =========================
      // SET UI
      // =========================
      const nama =
        data.nama
        ||
        "Admin";

      const foto =
        data.foto
        ||
        "";


      // aman untuk page lain
      const namaEl =
        document.getElementById(
          "namaAdmin"
        );

      const cabangEl =
        document.getElementById(
          "cabangAdmin"
        );

      const fotoEl =
        document.getElementById(
          "fotoAdmin"
        );

      const initialEl =
        document.getElementById(
          "avatarInitial"
        );


      // nama
      if(namaEl){

        namaEl.innerText =
          nama;
      }

      // cabang
      if(cabangEl){

        cabangEl.innerText =
          namaCabang;
      }


      // =========================
      // FOTO / INISIAL
      // =========================
      if(
        fotoEl &&
        initialEl
      ){

        const inisial =
          nama
          .trim()
          .charAt(0)
          .toUpperCase();

        initialEl.innerText =
          inisial;


        // jika ada foto
        if(foto){

          fotoEl.src =
            foto;

          fotoEl.onload =
            ()=>{

              fotoEl.style.display =
                "block";

              initialEl.style.display =
                "none";
            };

          fotoEl.onerror =
            ()=>{

              fotoEl.style.display =
                "none";

              initialEl.style.display =
                "block";
            };

        }

      }


      // =========================
      // SHOW DASHBOARD
      // =========================
      const dashboard =
        document.getElementById(
          "dashboard"
        );

      if(dashboard){

        dashboard.style.display =
          "block";
      }

      console.log(
        "✅ Admin Cabang Login"
      );

    }catch(err){

      console.log(err);

      logout();
    }

  }
);


// =========================
// LOGOUT
// =========================
function logout(){

  window.location.href =
    "login.html";
}