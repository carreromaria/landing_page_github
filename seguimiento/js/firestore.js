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
 * Devuelve TODOS los proyectos de un RUT, el más recientemente actualizado
 * primero. Se usa en Documentación para que, si un cliente tiene varios
 * proyectos, se pueda elegir cuál abrir.
 */
export async function buscarProyectosPorRut(rut) {
  if (!rut) return [];
  const snap = await getDocs(query(collection(db, "proyectos"), where("rut", "==", rut)));
  const proyectos = snap.docs.map(d => ({ codigo: d.id, ...d.data() }));
  proyectos.sort((a, b) => (b.actualizadoEn?.toMillis?.() || 0) - (a.actualizadoEn?.toMillis?.() || 0));
  return proyectos;
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

  await sincronizarVistaClienteSegura(codigo);
  return codigo;
}

/** Actualiza campos generales de un proyecto (no las etapas). */
export async function actualizarProyecto(codigo, datos) {
  const ref = doc(db, "proyectos", codigo);
  await updateDoc(ref, {
    ...datos,
    actualizadoEn: serverTimestamp()
  });
  await sincronizarVistaClienteSegura(codigo);
}

/**
 * Elimina un proyecto por completo: su historial, y el documento
 * principal. Requiere rol admin (ver firestore.rules). Las fotos en
 * Storage se eliminan aparte, desde dashboard.js, usando storage.js.
 */
export async function eliminarProyecto(codigo) {
  const historialSnap = await getDocs(collection(db, "proyectos", codigo, "historial"));
  const batch = writeBatch(db);
  // También se borra la copia pública que ve el cliente
  const snapProyecto = await getDoc(doc(db, "proyectos", codigo));
  const token = snapProyecto.exists() ? snapProyecto.data().token : null;
  if (token) batch.delete(doc(db, "vistaCliente", token));
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
  await sincronizarVistaClienteSegura(codigo);
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
  await sincronizarVistaClienteSegura(codigo);
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
  await sincronizarVistaClienteSegura(codigo);
}

// ============================================================
// ---------- Vista del cliente (copia pública y segura) ----------
// ============================================================
// El cliente NO lee la colección "proyectos" (tiene RUT, teléfono, montos…).
// Lee un documento aparte, "vistaCliente/{token}", con SOLO lo que se le
// muestra en su página de seguimiento. El id del documento es el token
// secreto del enlace, así que solo puede abrirlo quien tenga el enlace
// completo; nadie puede listar ni recorrer la colección.
// El staff la mantiene al día: se actualiza sola cada vez que cambia el
// proyecto (datos, etapa, fotos).

/** Lo que ve el cliente en su enlace. Devuelve null si el token no existe. */
export async function obtenerVistaCliente(token) {
  const snap = await getDoc(doc(db, "vistaCliente", token));
  return snap.exists() ? snap.data() : null;
}

/** Reconstruye la copia pública de un proyecto a partir de los datos reales. */
export async function sincronizarVistaCliente(codigo) {
  const refProyecto = doc(db, "proyectos", codigo);
  const snap = await getDoc(refProyecto);
  if (!snap.exists()) return;
  const p = snap.data();
  if (!p.token) return;

  const historialSnap = await getDocs(query(collection(db, "proyectos", codigo, "historial"), orderBy("fecha", "desc")));
  const historial = historialSnap.docs.map(d => {
    const h = d.data();
    return {
      etapaNombre: h.etapaNombre || "",
      estadoNuevo: h.estadoNuevo || "",
      fecha: h.fecha || new Date(),
      observacion: h.observacion || ""
    };
  });
  const fotos = (p.fotos || []).map(f => ({
    url: f.url, tipo: f.tipo || "foto", descripcion: f.descripcion || ""
  }));

  await setDoc(doc(db, "vistaCliente", p.token), {
    codigo,
    cliente: p.cliente || "",
    tipoProyecto: p.tipoProyecto || "",
    etapaActualIndex: p.etapaActualIndex ?? 0,
    estadoEtapaActual: p.estadoEtapaActual || "pendiente",
    activo: p.activo !== false,
    fechaEstimadaInicio: p.fechaEstimadaInicio || null,
    fechaEstimadaFin: p.fechaEstimadaFin || null,
    fechaEstimadaInstalacion: p.fechaEstimadaInstalacion || null,
    responsable: p.responsable || "",
    direccion: p.direccion ?? null,
    categoria: p.categoria || "",
    cantidadProyectosCliente: p.cantidadProyectosCliente || 1,
    codigoCotizacion: p.codigoCotizacion || "",
    observaciones: p.observaciones || "",
    fotos,
    historial,
    actualizadoEn: serverTimestamp()
  });

  // Si el token del proyecto cambió, se borra la copia del token anterior
  if (p.vistaClienteToken && p.vistaClienteToken !== p.token) {
    await deleteDoc(doc(db, "vistaCliente", p.vistaClienteToken)).catch(() => {});
  }
  if (p.vistaClienteToken !== p.token) {
    await updateDoc(refProyecto, { vistaClienteToken: p.token });
  }
}

/** Igual que la anterior, pero un fallo aquí nunca debe romper el guardado del staff. */
async function sincronizarVistaClienteSegura(codigo) {
  try {
    await sincronizarVistaCliente(codigo);
  } catch (err) {
    console.error("No pudimos actualizar la vista del cliente:", err);
  }
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
  const refContador = doc(db, "contadores", "leads");

  // El número del lead (L-00001, L-00002…) se asigna junto con la creación,
  // en una transacción, así nunca se repite ni se salta aunque dos personas
  // creen un lead al mismo tiempo. Es independiente del LIN-XXXXX del proyecto.
  await runTransaction(db, async (transaction) => {
    const snapContador = await transaction.get(refContador);
    const nuevoNumero = (snapContador.exists() ? snapContador.data().ultimo : 0) + 1;
    transaction.set(refContador, { ultimo: nuevoNumero });
    transaction.set(ref, {
      ...resto,
      codigoLead: "L-" + String(nuevoNumero).padStart(5, "0"),
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
  });

  return ref.id;
}

/**
 * Asigna número (L-00001…) a los leads que aún no lo tienen, en orden de
 * creación (el más antiguo recibe el número más bajo). Es seguro llamarla
 * varias veces o desde varias sesiones a la vez: dentro de la transacción
 * se vuelve a revisar cada lead y se salta el que ya tenga número.
 * Devuelve cuántos leads recibieron número.
 */
export async function asignarCodigosLeadFaltantes(leads) {
  const faltantes = leads
    .filter(l => !l.codigoLead)
    .sort((a, b) => (a.creadoEn?.toMillis?.() || 0) - (b.creadoEn?.toMillis?.() || 0));
  if (!faltantes.length) return 0;

  const refContador = doc(db, "contadores", "leads");
  let total = 0;

  // De a 400 por transacción (el límite de Firestore es 500 escrituras).
  for (let i = 0; i < faltantes.length; i += 400) {
    const lote = faltantes.slice(i, i + 400);
    total += await runTransaction(db, async (transaction) => {
      const snapContador = await transaction.get(refContador);
      let ultimo = snapContador.exists() ? snapContador.data().ultimo : 0;
      const refs = lote.map(l => doc(db, "leads", l.id));
      const snaps = await Promise.all(refs.map(r => transaction.get(r)));
      let asignados = 0;
      snaps.forEach((snap, idx) => {
        if (!snap.exists() || snap.data().codigoLead) return;
        ultimo++;
        asignados++;
        transaction.update(refs[idx], { codigoLead: "L-" + String(ultimo).padStart(5, "0") });
      });
      if (asignados) transaction.set(refContador, { ultimo });
      return asignados;
    });
  }
  return total;
}

/** Lista todos los leads una sola vez (para reportes). */
export async function listarLeads() {
  const snap = await getDocs(collection(db, "leads"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
 * Obtiene un lead puntual (lectura única, no realtime). Se usa desde
 * pantallas que no necesitan el listado completo en vivo, como el
 * módulo de Cotizaciones al abrir un lead por su id en la URL.
 */
export async function obtenerLead(id) {
  const ref = doc(db, "leads", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
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
    etapaActualizadaEn: serverTimestamp(),
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
    etapaActualizadaEn: serverTimestamp(),
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
    etapaActualizadaEn: serverTimestamp(),
    actualizadoEn: serverTimestamp()
  });
}

/** Elimina un lead por completo. Requiere rol admin (ver firestore.rules). */
export async function eliminarLead(id) {
  await deleteDoc(doc(db, "leads", id));
}

// ============================================================
// ---------- Catálogo de Servicios (código ↔ nombre) ----------
// ============================================================
// Un mismo catálogo alimenta tanto el "Tipo de proyecto" del lead
// como el desplegable de "Código" en la tabla de Cotización, para
// que ambos lados siempre usen los mismos códigos.

/**
 * Lista todos los servicios del catálogo, ordenados por código.
 * Incluye activos e inactivos (para la pantalla de administración
 * del catálogo).
 */
export async function listarServiciosCatalogo() {
  const ref = collection(db, "catalogoServicios");
  const q = query(ref, orderBy("codigo", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lista solo los servicios activos del catálogo. Se usa para poblar
 * el desplegable de "Código" al armar una cotización, así los
 * servicios desactivados no aparecen como opción nueva.
 */
export async function listarServiciosActivos() {
  const servicios = await listarServiciosCatalogo();
  return servicios.filter(s => s.activo !== false);
}

/**
 * Crea un servicio nuevo en el catálogo.
 * @param {{codigo:string, nombre:string}} datos
 * @returns {Promise<string>} id del documento creado
 */
export async function crearServicioCatalogo(datos) {
  const ref = doc(collection(db, "catalogoServicios"));
  await setDoc(ref, {
    ...datos,
    activo: true,
    creadoEn: serverTimestamp()
  });
  return ref.id;
}

/** Actualiza el nombre de un servicio del catálogo (el código no cambia). */
export async function actualizarServicioCatalogo(id, datos) {
  const ref = doc(db, "catalogoServicios", id);
  await updateDoc(ref, datos);
}

/** Activa o desactiva un servicio del catálogo (nunca se elimina de raíz). */
export async function cambiarEstadoServicioCatalogo(id, activo) {
  const ref = doc(db, "catalogoServicios", id);
  await updateDoc(ref, { activo });
}

// ============================================================
// ---------- Catálogo de Descripción de Cotización ----------
// ============================================================
// Alimenta el checklist de materiales, herrajes, cubiertas y
// accesorios que se marca en el editor de Cotizaciones y se imprime
// en el documento "Descripción de Cotización" (DC). Mismo patrón que
// catalogoServicios: las opciones nunca se eliminan, solo se activan
// o desactivan, para no perder trazabilidad de cotizaciones antiguas
// que ya hayan usado una opción.
//
// Cada documento tiene: { categoria: 'materiales'|'herrajes'|'cubiertas'|'accesorios'|'elementos'|'tiposMaterial'|'acabados'|'proveedores', nombre, activo }

// 'elementos' y 'tiposMaterial' alimentan los selects del bloque "Materiales y
// colores elegidos" (Elemento: mueble aéreo, cubierta… / Material: melamina,
// cuarzo…). Viven en la misma colección para no crear una nueva (y no tener que
// publicar reglas nuevas en Firebase Console).
const ORDEN_CATEGORIAS_DESCRIPCION = ['materiales', 'herrajes', 'cubiertas', 'accesorios', 'elementos', 'tiposMaterial', 'acabados', 'proveedores'];

/**
 * Lista todas las opciones del catálogo (activas e inactivas),
 * agrupadas por categoría en el orden fijo del documento DC y
 * ordenadas alfabéticamente dentro de cada categoría.
 */
export async function listarCatalogoDescripcion() {
  const ref = collection(db, "catalogoDescripcion");
  const snap = await getDocs(ref);
  const opciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  opciones.sort((a, b) => {
    const ordenCat = ORDEN_CATEGORIAS_DESCRIPCION.indexOf(a.categoria) - ORDEN_CATEGORIAS_DESCRIPCION.indexOf(b.categoria);
    if (ordenCat !== 0) return ordenCat;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });
  return opciones;
}

/** Igual que listarCatalogoDescripcion, pero solo las opciones activas. */
export async function listarCatalogoDescripcionActivo() {
  const opciones = await listarCatalogoDescripcion();
  return opciones.filter(o => o.activo !== false);
}

/**
 * Agrega una opción nueva al catálogo (ej. un herraje recién salido
 * al mercado). Se puede crear desde el mismo checklist en Cotizaciones,
 * sin salir de la pantalla.
 * @param {{categoria:string, nombre:string}} datos
 * @returns {Promise<string>} id del documento creado
 */
export async function crearOpcionCatalogoDescripcion(datos) {
  const ref = doc(collection(db, "catalogoDescripcion"));
  await setDoc(ref, {
    ...datos,
    activo: true,
    creadoEn: serverTimestamp()
  });
  return ref.id;
}

/**
 * Cambia el nombre de una opción del catálogo (ej. "Mueble base" → "Mueble bajo").
 * `clave` (opcional) guarda el nombre original de una opción sugerida por el sistema,
 * para que "Cargar filas sugeridas" siga encontrándola aunque cambie de nombre.
 * Las cotizaciones ya guardadas no cambian: guardan el texto tal como estaba.
 */
export async function renombrarOpcionCatalogoDescripcion(id, nombre, clave) {
  const ref = doc(db, "catalogoDescripcion", id);
  await updateDoc(ref, clave ? { nombre, clave } : { nombre });
}

/** Activa o desactiva una opción del catálogo (nunca se elimina de raíz). */
export async function cambiarEstadoOpcionCatalogoDescripcion(id, activo) {
  const ref = doc(db, "catalogoDescripcion", id);
  await updateDoc(ref, { activo });
}

// ============================================================
// ---------- Cotizaciones (colección propia, vinculada al Lead) ----------
// ============================================================
// Un Lead puede tener varias cotizaciones a lo largo del tiempo
// (versiones, por negociación de precio). Solo una queda "vigente"
// por Lead; las anteriores pasan a "reemplazada" y se conservan
// como historial — nunca se borran.

/**
 * Crea una cotización nueva para un Lead, con folio correlativo
 * automático (CT-XXX-00000, donde XXX es el tipo de proyecto del
 * lead) y número de versión también automático. Si el Lead ya tenía
 * una cotización vigente, la marca como "reemplazada" en la misma
 * transacción.
 *
 * @param {string} leadId
 * @param {string} prefijoCodigo 3 letras del tipo de proyecto (ej. "COC", "CLO"), viene de
 *   lead.tipoProyectoCodigo. Los leads antiguos sin tipo siguen usando su canal (ej. "WSP").
 * @param {{proyecto:string, items:object[], totalGeneral:number, porcentajeAbono:number, abono:number}} datos
 * @param {string} uid
 * @returns {Promise<string>} id de la cotización creada
 */
export async function crearCotizacion(leadId, prefijoCodigo, datos, uid, opcion = "A") {
  const refContador = doc(db, "contadores", "cotizaciones");

  // La versión y el reemplazo se calculan DENTRO de la misma opción:
  // cada opción (A, B, C…) tiene su propio historial de versiones.
  const vigenteAnterior = await obtenerCotizacionVigentePorOpcion(leadId, opcion);

  // El número de versión sale de TODO el historial de esa opción (vigente +
  // reemplazadas), no solo de la vigente: así nunca puede repetirse ni
  // volver a V1 si por cualquier motivo la vigente no se encuentra.
  // Primera cotización de la opción = V1; cada versión nueva = la mayor + 1.
  const historialOpcion = (await listarCotizacionesPorLead(leadId))
    .filter(c => (c.opcion || "A") === opcion);
  const mayorVersion = historialOpcion.reduce((max, c) => Math.max(max, Number(c.version) || 1), 0);
  const nuevaVersion = mayorVersion + 1;

  // Una cotización = un número. Las versiones nuevas (V2, V3…) de la MISMA opción
  // conservan el folio de la primera (CT-COC-00023 V1, V2, V3…) y no gastan número
  // del contador; así el contador refleja cotizaciones reales y no revisiones.
  // Solo la primera versión de una opción recibe un número nuevo.
  const ultimaVersion = historialOpcion.reduce(
    (mejor, c) => (!mejor || (Number(c.version) || 1) > (Number(mejor.version) || 1)) ? c : mejor, null);
  const folioExistente = ultimaVersion?.numero || null;

  const nuevoId = await runTransaction(db, async (transaction) => {
    let folio = folioExistente;
    if (!folio) {
      const snapContador = await transaction.get(refContador);
      const ultimo = snapContador.exists() ? snapContador.data().ultimo : 0;
      const nuevoNumero = ultimo + 1;
      folio = `CT-${prefijoCodigo}-${String(nuevoNumero).padStart(5, "0")}`;
      transaction.set(refContador, { ultimo: nuevoNumero });
    }

    const refNueva = doc(collection(db, "cotizaciones"));

    if (vigenteAnterior) {
      transaction.update(doc(db, "cotizaciones", vigenteAnterior.id), { estado: "reemplazada" });
    }

    transaction.set(refNueva, {
      ...datos,
      leadId,
      opcion,
      // Si la opción ya estaba aprobada, la nueva versión sigue aprobada.
      aprobada: !!vigenteAnterior?.aprobada,
      numero: folio,
      version: nuevaVersion,
      estado: "vigente",
      creadoPor: uid,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });

    return refNueva.id;
  });

  return nuevoId;
}

/** Actualiza los datos de una cotización existente (sin cambiar versión ni folio). */
export async function actualizarCotizacion(id, datos) {
  const ref = doc(db, "cotizaciones", id);
  await updateDoc(ref, {
    ...datos,
    actualizadoEn: serverTimestamp()
  });
}

/**
 * Opciones de un Lead: cada opción (A, B, C…) es una cotización
 * distinta del mismo proyecto (ej. cubierta de cuarzo vs. postformado).
 * Devuelve la versión vigente de CADA opción, ordenadas por letra.
 * Las cotizaciones antiguas, sin campo "opcion", cuentan como opción A.
 */
export async function listarOpcionesVigentesPorLead(leadId) {
  const ref = collection(db, "cotizaciones");
  const q = query(ref, where("leadId", "==", leadId), where("estado", "==", "vigente"));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => {
      const datos = d.data();
      return { id: d.id, ...datos, opcion: datos.opcion || "A" };
    })
    .sort((x, y) => x.opcion.localeCompare(y.opcion));
}

/**
 * La opción "principal" del Lead: la marcada como Aprobada; si no hay
 * ninguna aprobada, la modificada más recientemente. Es la que leen
 * Documentación, la Descripción de Cotización y el Presupuesto estimado.
 */
export function elegirOpcionPrincipal(opciones) {
  if (!opciones || opciones.length === 0) return null;
  const aprobada = opciones.find(o => o.aprobada);
  if (aprobada) return aprobada;
  const ms = (o) => o.actualizadoEn?.toMillis?.() ?? 0;
  return opciones.slice().sort((x, y) => ms(y) - ms(x))[0];
}

/** Siguiente letra libre para una opción nueva (A, B, C…). */
export function siguienteLetraOpcion(opciones) {
  const maxCodigo = (opciones || []).reduce(
    (max, o) => Math.max(max, (o.opcion || "A").charCodeAt(0)), 64
  );
  return String.fromCharCode(maxCodigo + 1);
}

/** Cotización vigente de una opción puntual del Lead (o null). */
export async function obtenerCotizacionVigentePorOpcion(leadId, opcion) {
  const opciones = await listarOpcionesVigentesPorLead(leadId);
  return opciones.find(o => o.opcion === opcion) || null;
}

/**
 * Devuelve la cotización "principal" de un Lead (aprobada, o la más
 * reciente), o null si todavía no tiene ninguna. Mantiene el mismo
 * nombre y forma de respuesta de siempre, así los módulos que ya la
 * usan (CRM, Documentación) siguen funcionando sin cambios.
 */
export async function obtenerCotizacionVigentePorLead(leadId) {
  const opciones = await listarOpcionesVigentesPorLead(leadId);
  return elegirOpcionPrincipal(opciones);
}

/**
 * Marca (o desmarca) una opción como Aprobada. Solo puede haber una
 * aprobada por Lead: al aprobar una, se desmarcan las demás.
 */
export async function marcarOpcionAprobada(leadId, idCotizacion, aprobada = true) {
  const opciones = await listarOpcionesVigentesPorLead(leadId);
  const batch = writeBatch(db);
  opciones.forEach(o => {
    const debeEstarAprobada = aprobada && o.id === idCotizacion;
    if (!!o.aprobada !== debeEstarAprobada) {
      batch.update(doc(db, "cotizaciones", o.id), { aprobada: debeEstarAprobada });
    }
  });
  await batch.commit();
}

/**
 * Devuelve todas las versiones de la cotización de un Lead
 * (vigente + reemplazadas), más reciente primero.
 */
export async function listarCotizacionesPorLead(leadId) {
  const ref = collection(db, "cotizaciones");
  const q = query(ref, where("leadId", "==", leadId));
  const snap = await getDocs(q);
  const cotizaciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cotizaciones.sort((a, b) => (b.version || 0) - (a.version || 0));
  return cotizaciones;
}

/**
 * Escucha en tiempo real todas las cotizaciones vigentes (una por
 * Lead), para el listado principal del módulo Cotizaciones.
 * Devuelve una función para dejar de escuchar.
 */
export function escucharCotizacionesVigentes(callback, onError) {
  const ref = collection(db, "cotizaciones");
  const q = query(ref, where("estado", "==", "vigente"), orderBy("actualizadoEn", "desc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

// ============================================================
// ---------- Tipos de proyecto (código de 3 letras) ----------
// ============================================================
// Alimentan la parte central del código de los documentos, ej.
// CV-COC-00004 (COC = cocina). Cada tipo vive en la colección
// "tiposProyecto" con su código como id. Nunca se borra un tipo que
// ya se haya usado: se desactiva, así los documentos antiguos no
// pierden coherencia. MIX y OTR son "protegidos": siempre existen.

export const TIPOS_PROYECTO_BASE = [
  { codigo: "COC", nombre: "Cocina" },
  { codigo: "VAN", nombre: "Vanitorio" },
  { codigo: "CLO", nombre: "Closet" },
  { codigo: "WAL", nombre: "Walking closet" },
  { codigo: "CEN", nombre: "Centro de entretenimiento" },
  { codigo: "OFI", nombre: "Mobiliario corporativo" },
  { codigo: "LOC", nombre: "Mobiliario comercial" },
  { codigo: "MIX", nombre: "Varios tipos", protegido: true },
  { codigo: "OTR", nombre: "Otros", protegido: true }
];

/**
 * Lista todos los tipos de proyecto (activos e inactivos). Si la
 * colección aún está vacía (nadie ha entrado al módulo de
 * administración), devuelve los tipos base para que los selectores
 * igual funcionen.
 */
export async function listarTiposProyecto() {
  const snap = await getDocs(collection(db, "tiposProyecto"));
  if (snap.empty) {
    return TIPOS_PROYECTO_BASE.map((t, i) => ({ ...t, activo: true, protegido: !!t.protegido, orden: i, virtual: true }));
  }
  return snap.docs
    .map(d => ({ codigo: d.id, ...d.data() }))
    .sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

/** Solo los tipos activos (para los selectores al crear leads y proyectos). */
export async function listarTiposProyectoActivos() {
  const tipos = await listarTiposProyecto();
  return tipos.filter(t => t.activo !== false);
}

/** Carga los tipos base la primera vez (solo si la colección está vacía). */
export async function asegurarTiposProyectoBase() {
  const snap = await getDocs(collection(db, "tiposProyecto"));
  if (!snap.empty) return false;
  const batch = writeBatch(db);
  TIPOS_PROYECTO_BASE.forEach((t, i) => {
    batch.set(doc(db, "tiposProyecto", t.codigo), {
      nombre: t.nombre, activo: true, protegido: !!t.protegido, orden: i, creadoEn: serverTimestamp()
    });
  });
  await batch.commit();
  return true;
}

/** Crea un tipo nuevo. Falla con Error("EXISTE") si el código ya está tomado. */
export async function crearTipoProyecto(codigo, nombre) {
  const ref = doc(db, "tiposProyecto", codigo);
  if ((await getDoc(ref)).exists()) throw new Error("EXISTE");
  await setDoc(ref, { nombre, activo: true, protegido: false, orden: Date.now(), creadoEn: serverTimestamp() });
}

/** Cambia el nombre de un tipo (siempre permitido; no afecta ningún documento). */
export async function actualizarNombreTipoProyecto(codigo, nombre) {
  await updateDoc(doc(db, "tiposProyecto", codigo), { nombre });
}

/** Activa o desactiva un tipo. */
export async function cambiarEstadoTipoProyecto(codigo, activo) {
  await updateDoc(doc(db, "tiposProyecto", codigo), { activo });
}

/** Elimina un tipo. La pantalla solo lo permite si nunca se usó y no es protegido. */
export async function eliminarTipoProyecto(codigo) {
  await deleteDoc(doc(db, "tiposProyecto", codigo));
}

/** Cambia el código de un tipo. La pantalla solo lo permite si nunca se usó. */
export async function renombrarCodigoTipoProyecto(codigoViejo, codigoNuevo) {
  const refViejo = doc(db, "tiposProyecto", codigoViejo);
  const refNuevo = doc(db, "tiposProyecto", codigoNuevo);
  if ((await getDoc(refNuevo)).exists()) throw new Error("EXISTE");
  const datos = (await getDoc(refViejo)).data();
  const batch = writeBatch(db);
  batch.set(refNuevo, datos);
  batch.delete(refViejo);
  await batch.commit();
}

/** Cuántos leads y proyectos usa cada código: { COC: { leads: 2, proyectos: 1 }, ... } */
export async function contarUsoTiposProyecto() {
  const uso = {};
  const sumar = (codigo, campo) => {
    if (!codigo) return;
    uso[codigo] = uso[codigo] || { leads: 0, proyectos: 0 };
    uso[codigo][campo]++;
  };
  const [leads, proyectos] = await Promise.all([
    getDocs(collection(db, "leads")),
    getDocs(collection(db, "proyectos"))
  ]);
  leads.forEach(d => sumar(d.data().tipoProyectoCodigo, "leads"));
  proyectos.forEach(d => sumar(d.data().tipoProyectoCodigo, "proyectos"));
  return uso;
}


// ============================================================
// AGENDA Y GESTIÓN DE VENCIMIENTOS
// ============================================================
// Colecciones: eventos (+ subcolección historial) y recursos.
// El motor de reglas (recurrencias, alertas, conflictos) vive en
// js/agenda-motor.js; aquí solo se lee y se escribe.
//
// Importante: cada evento guarda `abierto` (true/false, derivado del
// estado). Así la campanita puede pedir solo los pendientes con una
// consulta simple, sin índices compuestos.

/** Firestore no acepta `undefined`: lo quita (deja null y vacíos tal cual). */
function limpiarUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/** Todos los eventos (para el calendario), en tiempo real. */
export function escucharEventos(callback, onError) {
  // Sin orderBy: las mantenciones solo por kilometraje no tienen fecha y quedarían fuera de una consulta ordenada.
  // La agenda ordena en pantalla.
  return onSnapshot(collection(db, "eventos"),
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** Eventos vinculados a un proyecto (LIN-XXXXX), en tiempo real. Consulta simple, sin índice compuesto. */
export function escucharEventosDeProyecto(codigoProyecto, callback, onError) {
  const q = query(collection(db, "eventos"), where("proyectoCodigo", "==", codigoProyecto));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** Junta varias consultas de eventos en una sola lista (sin repetidos), en tiempo real. */
function escucharConsultasEventos(consultas, callback, onError) {
  const resultados = consultas.map(() => null);
  const emitir = () => {
    if (resultados.some(r => r === null)) return;
    const unicos = new Map();
    resultados.forEach(lista => lista.forEach(ev => unicos.set(ev.id, ev)));
    callback([...unicos.values()]);
  };
  const paradores = consultas.map((q, i) => onSnapshot(q,
    (snap) => { resultados[i] = snap.docs.map(d => ({ id: d.id, ...d.data() })); emitir(); },
    (err) => { console.error(err); onError?.(err); }
  ));
  return () => paradores.forEach(parar => parar());
}

/**
 * Eventos de un cliente (lead) en tiempo real: los agendados desde el CRM
 * (campo leadId) y, si el lead ya está vinculado a un proyecto, también los
 * del proyecto (proyectoCodigo). Consultas simples, sin índice compuesto.
 */
export function escucharEventosDeLead(leadId, codigoProyecto, callback, onError) {
  const consultas = [query(collection(db, "eventos"), where("leadId", "==", leadId))];
  if (codigoProyecto) consultas.push(query(collection(db, "eventos"), where("proyectoCodigo", "==", codigoProyecto)));
  return escucharConsultasEventos(consultas, callback, onError);
}

/**
 * Eventos de un proyecto en tiempo real: los suyos (proyectoCodigo) más los
 * que se agendaron en el CRM para el lead vinculado (leads con
 * proyectoVinculado == código). Si no se pudieran leer los leads, se muestran
 * solo los del proyecto.
 */
export function escucharEventosDeProyectoYLead(codigoProyecto, callback, onError) {
  let delProyecto = null, leadIds = null;
  const porLead = {}, paradoresLead = {};
  const emitir = () => {
    if (delProyecto === null || leadIds === null) return;
    if (leadIds.some(id => porLead[id] === undefined)) return;
    const unicos = new Map();
    delProyecto.forEach(ev => unicos.set(ev.id, ev));
    leadIds.forEach(id => porLead[id].forEach(ev => unicos.set(ev.id, ev)));
    callback([...unicos.values()]);
  };
  const pararProyecto = onSnapshot(
    query(collection(db, "eventos"), where("proyectoCodigo", "==", codigoProyecto)),
    (snap) => { delProyecto = snap.docs.map(d => ({ id: d.id, ...d.data() })); emitir(); },
    (err) => { console.error(err); onError?.(err); }
  );
  const pararLeads = onSnapshot(
    query(collection(db, "leads"), where("proyectoVinculado", "==", codigoProyecto)),
    (snap) => {
      leadIds = snap.docs.map(d => d.id);
      Object.keys(paradoresLead).forEach(id => {
        if (!leadIds.includes(id)) { paradoresLead[id](); delete paradoresLead[id]; delete porLead[id]; }
      });
      leadIds.forEach(id => {
        if (paradoresLead[id]) return;
        paradoresLead[id] = onSnapshot(
          query(collection(db, "eventos"), where("leadId", "==", id)),
          (s) => { porLead[id] = s.docs.map(d => ({ id: d.id, ...d.data() })); emitir(); },
          (err) => { console.error(err); porLead[id] = []; emitir(); }
        );
      });
      emitir();
    },
    (err) => { console.error(err); leadIds = []; emitir(); }
  );
  return () => { pararProyecto(); pararLeads(); Object.values(paradoresLead).forEach(p => p()); };
}

/** Solo los eventos pendientes (abierto == true), en tiempo real. Lo usa la campanita. */
export function escucharEventosAbiertos(callback, onError) {
  const q = query(collection(db, "eventos"), where("abierto", "==", true));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

export async function obtenerEvento(id) {
  const snap = await getDoc(doc(db, "eventos", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Crea un evento con código EV-00001, EV-00002… (contador atómico, igual
 * que proyectos y leads) y deja la primera línea en su historial.
 * Devuelve { id, codigo }.
 */
export async function crearEvento(datos, uid, nombreUsuario) {
  const ref = doc(collection(db, "eventos"));
  const refContador = doc(db, "contadores", "eventos");
  let codigo = "";
  await runTransaction(db, async (transaction) => {
    const snapContador = await transaction.get(refContador);
    const nuevoNumero = (snapContador.exists() ? snapContador.data().ultimo : 0) + 1;
    codigo = "EV-" + String(nuevoNumero).padStart(5, "0");
    transaction.set(refContador, { ultimo: nuevoNumero });
    transaction.set(ref, limpiarUndefined({
      ...datos,
      codigo,
      creadoPor: uid,
      creadoPorNombre: nombreUsuario || "",
      creadoEn: serverTimestamp(),
      actualizadoPor: uid,
      actualizadoPorNombre: nombreUsuario || "",
      actualizadoEn: serverTimestamp()
    }));
    transaction.set(doc(collection(ref, "historial")), {
      tipo: "creado",
      estadoNuevo: datos.estado || "",
      fechaNueva: datos.proximaFecha || "",
      por: uid,
      porNombre: nombreUsuario || "",
      fecha: serverTimestamp()
    });
  });
  return { id: ref.id, codigo };
}

/**
 * Actualiza un evento y, en la misma operación, agrega una línea al historial
 * (cambio de estado, reprogramación, pago/realización, edición).
 * @param {object} entrada  { tipo, estadoAnterior?, estadoNuevo?, fechaAnterior?, fechaNueva?,
 *                            fechaOcurrencia?, nota?, por, porNombre }
 */
export async function actualizarEvento(id, datos, entrada) {
  const ref = doc(db, "eventos", id);
  const batch = writeBatch(db);
  batch.update(ref, limpiarUndefined({ ...datos, actualizadoEn: serverTimestamp() }));
  if (entrada) {
    batch.set(doc(collection(ref, "historial")), limpiarUndefined({ ...entrada, fecha: serverTimestamp() }));
  }
  await batch.commit();
}

/** Historial de un evento en tiempo real, más reciente primero. */
export function escucharHistorialEvento(id, callback, onError) {
  const q = query(collection(db, "eventos", id, "historial"), orderBy("fecha", "desc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

// ---------- Recursos reservables (personas, equipos, vehículos, sala, taller) ----------
// Nunca se eliminan: se desactivan (campo activo), igual que el resto de los catálogos.

export function escucharRecursos(callback, onError) {
  const q = query(collection(db, "recursos"), orderBy("nombre", "asc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** @param {{nombre:string, tipo:string}} datos */
export async function crearRecurso(datos, uid) {
  const ref = doc(collection(db, "recursos"));
  await setDoc(ref, { ...datos, activo: true, creadoPor: uid, creadoEn: serverTimestamp() });
  return ref.id;
}

export async function actualizarRecurso(id, datos) {
  await updateDoc(doc(db, "recursos", id), limpiarUndefined({ ...datos, actualizadoEn: serverTimestamp() }));
}


// ---------- Colaboradores (cumpleaños y aniversarios laborales) ----------
// Datos personales: solo los lee y escribe un administrador (ver firestore.rules).
// Nunca se eliminan: se desactivan (activo:false) y sus recordatorios se cancelan.

export function escucharColaboradores(callback, onError) {
  const q = query(collection(db, "colaboradores"), orderBy("nombre", "asc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** @returns {Promise<string>} id del colaborador */
export async function crearColaborador(datos, uid) {
  const ref = doc(collection(db, "colaboradores"));
  await setDoc(ref, limpiarUndefined({ ...datos, activo: true, creadoPor: uid, creadoEn: serverTimestamp() }));
  return ref.id;
}

export async function actualizarColaborador(id, datos) {
  await updateDoc(doc(db, "colaboradores", id), limpiarUndefined({ ...datos, actualizadoEn: serverTimestamp() }));
}


// ---------- Vehículos (Fase 4) ----------
// vehiculos/{id}                 ficha: marca, modelo, año, patente, VIN, kmActual, responsable, activo
// vehiculos/{id}/lecturas        historial de kilometraje
// vehiculos/{id}/mantenciones    mantenciones realizadas (tipo, fecha, km, taller, costo, factura, próxima)
// vehiculos/{id}/gastos          gastos (combustible, peajes, reparaciones…) — base para reportes futuros
// Las mantenciones programadas y los documentos son eventos (categoria "vehiculo", campo vehiculoId).
// Nada se elimina: los vehículos se desactivan.

export function escucharVehiculos(callback, onError) {
  const q = query(collection(db, "vehiculos"), orderBy("patente", "asc"));
  return onSnapshot(q,
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** Crea el vehículo y deja la primera lectura de kilometraje. @returns {Promise<string>} id */
export async function crearVehiculo(datos, uid, nombreUsuario) {
  const ref = doc(collection(db, "vehiculos"));
  const batch = writeBatch(db);
  batch.set(ref, limpiarUndefined({ ...datos, activo: true, creadoPor: uid, creadoEn: serverTimestamp(), kmActualizadoEn: serverTimestamp() }));
  if (Number.isFinite(Number(datos.kmActual))) {
    batch.set(doc(collection(ref, "lecturas")), { km: Number(datos.kmActual), fecha: serverTimestamp(), por: uid, porNombre: nombreUsuario || "", nota: "Kilometraje inicial" });
  }
  await batch.commit();
  return ref.id;
}

export async function actualizarVehiculo(id, datos) {
  await updateDoc(doc(db, "vehiculos", id), limpiarUndefined({ ...datos, actualizadoEn: serverTimestamp() }));
}

/** Actualiza el kilometraje actual y guarda la lectura en el historial. */
export async function registrarKilometraje(vehiculoId, km, uid, nombreUsuario, nota = "") {
  const ref = doc(db, "vehiculos", vehiculoId);
  const batch = writeBatch(db);
  batch.update(ref, { kmActual: Number(km), kmActualizadoEn: serverTimestamp(), actualizadoEn: serverTimestamp() });
  batch.set(doc(collection(ref, "lecturas")), { km: Number(km), fecha: serverTimestamp(), por: uid, porNombre: nombreUsuario || "", nota });
  await batch.commit();
}

export function escucharMantencionesVehiculo(vehiculoId, callback, onError) {
  const q = query(collection(db, "vehiculos", vehiculoId, "mantenciones"), orderBy("fecha", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => { console.error(err); onError?.(err); });
}
export function escucharGastosVehiculo(vehiculoId, callback, onError) {
  const q = query(collection(db, "vehiculos", vehiculoId, "gastos"), orderBy("fecha", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => { console.error(err); onError?.(err); });
}

/** Registra un gasto; si trae kilometraje mayor al actual, también actualiza el vehículo. */
export async function crearGastoVehiculo(vehiculoId, gasto, uid, nombreUsuario, kmNuevo = null) {
  const ref = doc(db, "vehiculos", vehiculoId);
  const batch = writeBatch(db);
  batch.set(doc(collection(ref, "gastos")), limpiarUndefined({ ...gasto, creadoPor: uid, creadoPorNombre: nombreUsuario || "", creadoEn: serverTimestamp() }));
  if (kmNuevo != null) {
    batch.update(ref, { kmActual: Number(kmNuevo), kmActualizadoEn: serverTimestamp(), actualizadoEn: serverTimestamp() });
    batch.set(doc(collection(ref, "lecturas")), { km: Number(kmNuevo), fecha: serverTimestamp(), por: uid, porNombre: nombreUsuario || "", nota: "Registrado con un gasto" });
  }
  await batch.commit();
}

/**
 * Registra una mantención realizada, todo junto (o no se guarda nada):
 *  - actualiza la mantención programada (nuevo último km / próximo km / próxima fecha) y su historial,
 *  - guarda la mantención en el historial del vehículo,
 *  - si hubo costo, lo anota como gasto,
 *  - si el kilometraje realizado es mayor al actual, actualiza el vehículo y su historial de km.
 */
export async function registrarMantencionVehiculo({ eventoId, eventoUpdate, entradaHistorial, vehiculoId, mantencion, gasto, kmVehiculo, lectura }) {
  const evRef = doc(db, "eventos", eventoId);
  const vRef = doc(db, "vehiculos", vehiculoId);
  const batch = writeBatch(db);
  batch.update(evRef, limpiarUndefined({ ...eventoUpdate, actualizadoEn: serverTimestamp() }));
  batch.set(doc(collection(evRef, "historial")), limpiarUndefined({ ...entradaHistorial, fecha: serverTimestamp() }));
  batch.set(doc(collection(vRef, "mantenciones")), limpiarUndefined({ ...mantencion, creadoEn: serverTimestamp() }));
  if (gasto) batch.set(doc(collection(vRef, "gastos")), limpiarUndefined({ ...gasto, creadoEn: serverTimestamp() }));
  if (kmVehiculo != null) {
    batch.update(vRef, { kmActual: Number(kmVehiculo), kmActualizadoEn: serverTimestamp(), actualizadoEn: serverTimestamp() });
    batch.set(doc(collection(vRef, "lecturas")), limpiarUndefined({ ...lectura, km: Number(kmVehiculo), fecha: serverTimestamp() }));
  }
  await batch.commit();
}
