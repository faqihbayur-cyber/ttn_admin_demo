// FIREBASE
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCp32H2WeN3A4ZwwWeUWe3Qcjqh0mz_vvQ",
  authDomain: "teh-tarik-nusantara-26371.firebaseapp.com",
  projectId: "teh-tarik-nusantara-26371"
};


// INIT
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// BACKGROUND FLOAT LOGO
const logoCount = 20;

for(let i = 0; i < logoCount; i++){

  const logo = document.createElement("img");

  logo.src = "LogoTTN.png";
  logo.className = "bg-logo";

  logo.style.left = Math.random() * 100 + "vw";
  logo.style.top = Math.random() * 100 + "vh";

  let size = 30 + Math.random() * 40;

  logo.style.width = size + "px";
  logo.style.height = size + "px";

  logo.style.animationDuration =
    (18 + Math.random() * 20) + "s";

  document.body.appendChild(logo);
}


// ANIMASI LOGO
const logo = document.getElementById("logoTTN");

logo.addEventListener("click", () => {

  logo.classList.remove("logo-spin");

  void logo.offsetWidth;

  logo.classList.add("logo-spin");
});


// LOGIN FUNCTION
async function login(){

  const email =
    document.getElementById("username").value;

  const password =
    document.getElementById("password").value;

  const btn =
    document.getElementById("loginBtn");

  const text =
    document.getElementById("btnText");

  const loader =
    document.getElementById("btnLoader");

  const errorMsg =
    document.getElementById("error-msg");


  // RESET ERROR
  errorMsg.innerText = "";


  // LOADING ON
  text.style.display = "none";
  loader.style.display = "inline-block";
  btn.disabled = true;


  try{

    // LOGIN FIREBASE
    const userCredential =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    const user = userCredential.user;

    const uid = user.uid;


    // CEK COLLECTION USERS
    const docRef = doc(db, "users", uid);

    const docSnap = await getDoc(docRef);


    if(docSnap.exists()){

      console.log("Login berhasil");


      // SIMPAN LOGIN
      localStorage.setItem("isLogin", "true");

      localStorage.setItem(
        "uid",
        uid
      );


      // REDIRECT
      window.location.href = "index.html";

    }else{

      errorMsg.innerText =
        "Akun bukan marketing";

      text.style.display = "inline";
      loader.style.display = "none";
      btn.disabled = false;
    }

  }catch(error){

    console.log(error);

    errorMsg.innerText =
      "Email atau password salah";

    text.style.display = "inline";
    loader.style.display = "none";
    btn.disabled = false;
  }
}


// ENTER KEY
document.addEventListener("keydown", (e)=>{

  if(e.key === "Enter"){
    login();
  }
});


// GLOBAL
window.login = login;
