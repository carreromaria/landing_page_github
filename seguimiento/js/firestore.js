// ============================================================
// LINENCE — Seguimiento de Proyectos
// Capa de acceso a datos de Firestore
// ============================================================
// Todas las lecturas/escrituras a Firestore pasan por aquí, para
// que la vista cliente, el dashboard y el login nunca hablen con
// Firestore directamente. Facilita mantenerlo a futuro.

import { db } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
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

/**
 * Busca el proyecto más reciente registrado con un RUT dado, para
 * autocompletar el formulario de "Nuevo proyecto" cuando el cliente
 * ya existe. Devuelve null si no hay ningún proyecto con ese RUT.
 *
 * Nota: se ordena en el navegador (no con orderBy en Firestore) para
 * no depender de un índice compuesto rut+actualizadoEn.
 *
 * @param {string} rut RUT normalizado (sin puntos, con guión, mayúsculas)
 */
export async function buscarProyectoPorRut(rut) {
  if (!rut) return null;
  const ref = collection(db, "proyectos");
  const q = query(ref, where("rut", "==", rut));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const proyectos = snap.docs.map(d => ({ codigo: d.id, ...d.data() }));
  proyectos.sort((a, b) => (b.actualizadoEn?.toMillis?.() || 0) - (a.actualizadoEn?.toMillis?.() || 0));
  return proyectos[0];
}

/**
 * Devuelve las direcciones distintas usadas en proyectos anteriores con
 * este RUT, de la más reciente a la más antigua. Se usa para ofrecerlas
 * como opciones al crear/editar un proyecto de un cliente que ya tiene
 * otras viviendas registradas (la dirección nunca se autocompleta sola,
 * porque un mismo cliente puede tener varias propiedades).
 *
 * Nota: se ordena en el navegador (no con orderBy en Firestore) para
 * no depender de un índice compuesto rut+actualizadoEn. Los proyectos
 * antiguos cuya dirección todavía sea texto plano (antes de la dirección
 * estructurada) se omiten aquí, ya que no se pueden ofrecer como opción
 * estructurada — su dato original no se pierde, sigue en el proyecto.
 *
 * @param {string} rut RUT normalizado (sin puntos, con guión, mayúsculas)
 * @param {string} [excluirCodigo] código de proyecto a excluir del resultado
 *   (para no listar la dirección del mismo proyecto que se está editando)
 * @returns {Promise<object[]>} direcciones estructuradas {region, comuna, calle, numero, depto, sector, indicaciones}
 */
export async function buscarDireccionesPorRut(rut, excluirCodigo) {
  if (!rut) return [];
  const ref = collection(db, "proyectos");
  const q = query(ref, where("rut", "==", rut));
  const snap = await getDocs(q);
  const proyectos = snap.docs.map(d => ({ codigo: d.id, ...d.data() }));
  proyectos.sort((a, b) => (b.actualizadoEn?.toMillis?.() || 0) - (a.actualizadoEn?.toMillis?.() || 0));
  const vistos = new Set();
  const direcciones = [];
  proyectos.forEach(p => {
    if (excluirCodigo && p.codigo === excluirCodigo) return;
    const d = p.direccion;
    if (!d || typeof d !== 'object') return; // omite direcciones antiguas en texto plano
    if (!(d.calle || d.numero || d.comuna || d.region)) return; // dirección vacía
    const clave = JSON.stringify(d);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    direcciones.push(d);
  });
  return direcciones;
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

// ============================================================
// ---------- CRM: Leads (etapa comercial, antes de Seguimiento) ----------
// ============================================================
// Un lead vive en la colección "leads" desde que llega un contacto
// hasta que se gana (y se vincula manualmente a un código LIN-XXXXX
// creado en Seguimiento) o se pierde. Nunca se auto-crea un proyecto:
// eso siempre lo hace la persona a cargo, a propósito.

/**
 * Crea un lead nuevo. `datos` debe traer al menos: nombre, canalOrigen,
 * tipoProyecto. Si viene `notaInicial`, se guarda como primera entrada
 * de la bitácora.
 *
 * @param {object} datos
 * @param {string} uid  uid del staff que crea el lead
 * @returns {Promise<string>} id del lead creado
 */
export async function crearLead(datos, uid) {
  const { notaInicial, ...resto } = datos;
  const ref = doc(collection(db, "leads"));

  await setDoc(ref, {
    ...resto,
    etapa: "Nuevo contacto",
    notas: notaInicial ? [{
      texto: notaInicial,
      autor: resto.creadoPorNombre || "",
      fecha: new Date().toISOString()
    }] : [],
    creadoPor: uid,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
    fechaUltimoContacto: serverTimestamp()
  });

  return ref.id;
}

/**
 * Escucha en tiempo real todos los leads, más recientemente
 * actualizados primero. callback(leads) se ejecuta de inmediato y
 * cada vez que algo cambia. Devuelve una función para dejar de
 * escuchar (llamarla al salir del CRM).
 */
export function escucharLeads(callback, onError) {
  const ref = collection(db, "leads");
  const q = query(ref, orderBy("actualizadoEn", "desc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** Actualiza campos generales de un lead (datos de contacto, etc). */
export async function actualizarLead(id, datos) {
  const ref = doc(db, "leads", id);
  await updateDoc(ref, {
    ...datos,
    actualizadoEn: serverTimestamp()
  });
}

/**
 * Agrega una entrada a la bitácora del lead y refresca la fecha de
 * último contacto (así la alerta de "días sin contacto" se reinicia).
 * @param {string} id
 * @param {{texto:string, autor:string}} nota
 */
export async function agregarNotaLead(id, nota) {
  const ref = doc(db, "leads", id);
  await updateDoc(ref, {
    notas: arrayUnion({ ...nota, fecha: new Date().toISOString() }),
    actualizadoEn: serverTimestamp(),
    fechaUltimoContacto: serverTimestamp()
  });
}

/** Mueve un lead a otra etapa del pipeline (uso manual desde el tablero). */
export async function cambiarEtapaLead(id, nuevaEtapa) {
  const ref = doc(db, "leads", id);
  await updateDoc(ref, {
    etapa: nuevaEtapa,
    actualizadoEn: serverTimestamp(),
    fechaUltimoContacto: serverTimestamp()
  });
}

/**
 * Marca un lead como Ganado y lo vincula al proyecto que ya se creó
 * a mano en Seguimiento. Este vínculo es siempre manual: nunca se
 * crea el proyecto automáticamente desde acá.
 * @param {string} id
 * @param {string} codigoProyecto código LIN-XXXXX ya existente
 */
export async function marcarLeadGanado(id, codigoProyecto) {
  const ref = doc(db, "leads", id);
  await updateDoc(ref, {
    etapa: "Ganado",
    proyectoVinculado: codigoProyecto,
    fechaGanadoOPerdido: serverTimestamp(),
    actualizadoEn: serverTimestamp()
  });
}

/** Marca un lead como Perdido, con motivo (para poder analizarlo después). */
export async function marcarLeadPerdido(id, motivo) {
  const ref = doc(db, "leads", id);
  await updateDoc(ref, {
    etapa: "Perdido",
    motivoPerdida: motivo,
    fechaGanadoOPerdido: serverTimestamp(),
    actualizadoEn: serverTimestamp()
  });
}

/** Elimina un lead por completo. Requiere rol admin (ver firestore.rules). */
export async function eliminarLead(id) {
  await deleteDoc(doc(db, "leads", id));
}
