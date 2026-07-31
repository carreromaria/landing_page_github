// ============================================================
// LINENCE — Seguimiento de Proyectos
// Autenticación de staff
// ============================================================
// Capa de acceso a Firebase Authentication. login.html y
// dashboard.html hablan con Firebase Auth solo a través de aquí.

import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { obtenerUsuarioStaff } from './firestore.js';

/**
 * Intenta iniciar sesión y valida que el usuario sea staff activo
 * (existe en la colección "usuarios" con activo:true).
 * Si la validación de staff falla, cierra la sesión de Auth de
 * inmediato — no basta con tener cuenta, hay que estar autorizado.
 */
export async function iniciarSesionStaff(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const staff = await obtenerUsuarioStaff(cred.user.uid);

  if (!staff || staff.activo !== true) {
    await signOut(auth);
    throw new Error("CUENTA_NO_AUTORIZADA");
  }
  return staff;
}

export function cerrarSesion() {
  return signOut(auth);
}

/**
 * Ejecuta callback(staff) cuando hay una sesión de staff válida,
 * o callback(null) si no hay sesión / no es staff autorizado.
 * Úsalo para proteger dashboard.html.
 */
export function observarSesionStaff(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) { callback(null); return; }
    try {
      const staff = await obtenerUsuarioStaff(user.uid);
      callback(staff && staff.activo === true ? staff : null);
    } catch (err) {
      console.error("Error validando sesión de staff:", err);
      callback(null);
    }
  });
}
