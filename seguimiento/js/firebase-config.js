// ============================================================
// LINENCE — Seguimiento de Proyectos
// Configuración de Firebase
// ============================================================
// Reemplaza los valores de abajo por los que te entrega la
// consola de Firebase en:
// Configuración del proyecto > Tus apps > (app web) > Config
// ============================================================

// SDKs de Firebase (versión modular, importados desde CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA6_QOJslOrul2ZVgukaIL_UeMWWiMFOQI",
  authDomain: "linence-seguimiento.firebaseapp.com",
  projectId: "linence-seguimiento",
  storageBucket: "linence-seguimiento.firebasestorage.app",
  messagingSenderId: "632716782326",
  appId: "1:632716782326:web:9bad04e0b23ffb0a039ad7"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
