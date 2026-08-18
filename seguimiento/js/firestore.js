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
  collection, getDocs, query, orderBy, where,
  serverTimestamp, writeBatch, arrayUnion, arrayRemove,
  onSnapshot, runTransaction
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

/**
 * Cuenta cuántos proyectos existen ya en Firestore para un mismo RUT
 * (cliente recurrente). Se usa para calcular la categoría del cliente
 * de forma automática (Bronce / Oro / Élite).
 *
 * @param {string} rut RUT normalizado (sin puntos, con guión, mayúsculas)
 * @returns {Promise<number>} cantidad de proyectos existentes con ese RUT
 */
export async function contarProyectosPorRut(rut) {
  if (!rut) return 0;
  const ref = collection(db, "proyectos");
  const q = query(ref, where("rut", "==", rut));
  const snap = await getDocs(q);
  return snap.size;
}

// ---------- Funciones para el panel interno (dashboard) ----------

/**
 * Lista todos los usuarios de staff activos (para el desplegable de
 * "Responsable"). Requiere la regla `allow list: if esStaff();` en
 * la colección usuarios.
 */
export async function listarUsuariosStaff() {
  const ref = collection(db, "usuarios");
  const snap = await getDocs(ref);
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => u.activo !== false);
}

/**
 * Igual que listarProyectos, pero en tiempo real: callback(proyectos)
 * se ejecuta de inmediato y cada vez que algo cambia en Firestore
 * (desde esta pestaña o cualquier otra). Devuelve una función para
 * dejar de escuchar (llamarla al salir del listado).
 */
export function escucharProyectos(callback, onError) {
  const ref = collection(db, "proyectos");
  const q = query(ref, orderBy("actualizadoEn", "desc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ codigo: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/**
 * Escucha en tiempo real un proyecto individual por su código.
 * callback(proyecto) se ejecuta de inmediato y cada vez que cambia
 * ese proyecto en Firestore. Si el proyecto no existe, callback(null).
 * Devuelve una función para dejar de escuchar.
 */
export function escucharProyecto(codigo, callback, onError) {
  const ref = doc(db, "proyectos", codigo);
  return onSnapshot(ref,
    (snap) => callback(snap.exists() ? { codigo: snap.id, ...snap.data() } : null),
    (err) => { console.error(err); onError?.(err); }
  );
}

/**
 * Escucha en tiempo real el historial completo de un proyecto,
 * más reciente primero. Devuelve una función para dejar de escuchar.
 */
export function escucharHistorial(codigo, callback, onError) {
  const ref = collection(db, "proyectos", codigo, "historial");
  const q = query(ref, orderBy("fecha", "desc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/**
 * Crea un proyecto nuevo asignándole automáticamente el siguiente
 * código secuencial (LIN-00001, LIN-00002...). Usa una transacción
 * atómica: lee el último número usado, lo sube en 1, y crea el
 * proyecto, todo junto — así nunca se repite ni se salta un número
 * aunque dos personas creen un proyecto al mismo tiempo.
 *
 * Devuelve el código generado (ej. "LIN-00006").
 */
export async function crearProyectoConCodigoAutomatico(datos, uid) {
  const refContador = doc(db, "contadores", "proyectos");

  const codigo = await runTransaction(db, async (transaction) => {
    const snapContador = await transaction.get(refContador);
    const ultimo = snapContador.exists() ? snapContador.data().ultimo : 0;
    const nuevoNumero = ultimo + 1;
    const nuevoCodigo = "LIN-" + String(nuevoNumero).padStart(5, "0");

    transaction.set(refContador, { ultimo: nuevoNumero });
    transaction.set(doc(db, "proyectos", nuevoCodigo), {
      ...datos,
      etapaActualIndex: 0,
      estadoEtapaActual: "pendiente",
      fotos: [],
      activo: true,
      creadoPor: uid,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });

    return nuevoCodigo;
  });

  return codigo;
}

/** Actualiza campos generales de un proyecto (no las etapas). */
export async function actualizarProyecto(codigo, datos) {
  const ref = doc(db, "proyectos", codigo);
  await updateDoc(ref, {
    ...datos,
    actualizadoEn: serverTimestamp()
  });
}

/**
 * Elimina un proyecto por completo: su historial, y el documento
 * principal. Requiere rol admin (ver firestore.rules). Las fotos en
 * Storage se eliminan aparte, desde dashboard.js, usando storage.js.
 */
export async function eliminarProyecto(codigo) {
  const historialSnap = await getDocs(collection(db, "proyectos", codigo, "historial"));
  const batch = writeBatch(db);
  historialSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, "proyectos", codigo));
  await batch.commit();
}

// ---------- Gestión de etapas (Fase 8) ----------

/**
 * Cambia la etapa/estado actual de un proyecto y registra el cambio
 * en el historial, en una sola operación atómica (writeBatch): o se
 * guardan ambos cambios, o no se guarda ninguno.
 *
 * @param {string} codigo
 * @param {{etapaActualIndex:number, estadoEtapaActual:string}} nuevoEstado
 * @param {{etapaNombre:string, estadoAnterior:string, estadoNuevo:string, usuario:string, usuarioNombre:string, observacion?:string}} entradaHistorial
 */
export async function cambiarEtapaProyecto(codigo, nuevoEstado, entradaHistorial) {
  const batch = writeBatch(db);

  const refProyecto = doc(db, "proyectos", codigo);
  batch.update(refProyecto, {
    ...nuevoEstado,
    actualizadoEn: serverTimestamp()
  });

  const refHistorial = doc(collection(db, "proyectos", codigo, "historial"));
  batch.set(refHistorial, {
    ...entradaHistorial,
    fecha: serverTimestamp(),
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  });

  await batch.commit();
}

// ---------- Fotografías (Fase 9) ----------

/**
 * Agrega una fotografía al array `fotos` del proyecto.
 * @param {string} codigo
 * @param {{url:string, storagePath:string, descripcion:string, fecha:Date}} foto
 */
export async function agregarFotoProyecto(codigo, foto) {
  const ref = doc(db, "proyectos", codigo);
  await updateDoc(ref, {
    fotos: arrayUnion(foto),
    actualizadoEn: serverTimestamp()
  });
}

/**
 * Quita una fotografía específica del array `fotos` del proyecto.
 * Debe pasarse el objeto EXACTO como está guardado (arrayRemove
 * compara por igualdad de todo el objeto).
 */
export async function quitarFotoProyecto(codigo, foto) {
  const ref = doc(db, "proyectos", codigo);
  await updateDoc(ref, {
    fotos: arrayRemove(foto),
    actualizadoEn: serverTimestamp()
  });
}
