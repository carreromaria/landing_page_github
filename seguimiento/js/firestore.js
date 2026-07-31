// ============================================================
// LINENCE — Seguimiento de Proyectos
// Capa de acceso a datos de Firestore
// ============================================================
// Todas las lecturas/escrituras a Firestore pasan por aquí, para
// que la vista cliente, el dashboard y el login nunca hablen con
// Firestore directamente. Facilita mantenerlo a futuro.

import { db } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc,
  collection, getDocs, query, orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * Obtiene un proyecto por su código (LIN-XXXXX).
 * Devuelve null si no existe.
 */
export async function obtenerProyecto(codigo) {
  const ref = doc(db, "proyectos", codigo);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { codigo: snap.id, ...snap.data() };
}

/**
 * Obtiene el historial completo de un proyecto, más reciente primero.
 */
export async function obtenerHistorial(codigo) {
  const ref = collection(db, "proyectos", codigo, "historial");
  const q = query(ref, orderBy("fecha", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Obtiene el registro de staff de un usuario autenticado (colección "usuarios").
 * Devuelve null si el uid no tiene un registro ahí (no es staff autorizado).
 */
export async function obtenerUsuarioStaff(uid) {
  const ref = doc(db, "usuarios", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() };
}

// ---------- Funciones para el panel interno (dashboard) ----------

/**
 * Lista todos los proyectos, más recientemente actualizados primero.
 * Requiere estar autenticado como staff (ver firestore.rules).
 */
export async function listarProyectos() {
  const ref = collection(db, "proyectos");
  const q = query(ref, orderBy("actualizadoEn", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ codigo: d.id, ...d.data() }));
}

/**
 * Crea un proyecto nuevo. El código (documento ID) debe ser el mismo
 * ID que ya entrega el formulario de cotización de la landing
 * (ej. LIN-59147). El token de acceso del cliente se genera en
 * dashboard.js (utils.js → generarToken) y se pasa dentro de `datos`.
 */
export async function crearProyecto(codigo, datos, uid) {
  const ref = doc(db, "proyectos", codigo);
  await setDoc(ref, {
    ...datos,
    etapaActualIndex: 0,
    estadoEtapaActual: "pendiente",
    fotos: [],
    activo: true,
    creadoPor: uid,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp()
  });
}

/** Actualiza campos generales de un proyecto (no las etapas, ver Fase 8). */
export async function actualizarProyecto(codigo, datos) {
  const ref = doc(db, "proyectos", codigo);
  await updateDoc(ref, {
    ...datos,
    actualizadoEn: serverTimestamp()
  });
}
