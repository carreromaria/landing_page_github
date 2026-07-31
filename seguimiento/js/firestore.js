// ============================================================
// LINENCE — Seguimiento de Proyectos
// Capa de acceso a datos de Firestore
// ============================================================
// Todas las lecturas/escrituras a Firestore pasan por aquí, para
// que la vista cliente, el dashboard y el login nunca hablen con
// Firestore directamente. Facilita mantenerlo a futuro.

import { db } from './firebase-config.js';
import {
  doc, getDoc,
  collection, getDocs, query, orderBy
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
