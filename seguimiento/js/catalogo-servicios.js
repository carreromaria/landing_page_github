// ============================================================
// LINENCE — Catálogo de Servicios
// Lógica de la pantalla catalogo-servicios.html
// ============================================================
// Igual que crm.js: reutiliza auth.js y firestore.js. No habla con
// Firestore directamente en ningún punto de este archivo.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  listarServiciosCatalogo, crearServicioCatalogo,
  actualizarServicioCatalogo, cambiarEstadoServicioCatalogo
} from './firestore.js';

// ---------- Estado ----------

let servicios = [];
let modoEdicion = null;       // null = creando, o el id del servicio en edición
let idParaCambiarEstado = null;

// ---------- Referencias DOM ----------

const tablaBody = document.getElementById('tablaServiciosBody');
const catVacio = document.getElementById('catVacio');

const modalServicio = document.getElementById('modalServicio');
const modalServicioTitulo = document.getElementById('modalServicioTitulo');
const inputPrefijo = document.getElementById('inputPrefijo');
const inputCodigo = document.getElementById('inputCodigo');
const inputNombre = document.getElementById('inputNombre');
const inputCategoria = document.getElementById('inputCategoria');
const inputTipo = document.getElementById('inputTipo');
const filaPrefijoCodigo = document.getElementById('filaPrefijoCodigo');
const errorNombre = document.getElementById('errorNombre');

const modalEstado = document.getElementById('modalEstado');
const modalEstadoTitulo = document.getElementById('modalEstadoTitulo');
const modalEstadoTexto = document.getElementById('modalEstadoTexto');

const toastEl = document.getElementById('catToast');

// ---------- Guardia de sesión (mismo patrón que crm.js / dashboard.js) ----------

observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = '';
  document.getElementById('staffNombre').textContent = staff.nombre || '—';
  document.getElementById('staffRol').textContent = staff.rol || '—';
  cargarServicios();
});

document.getElementById('btnCerrarSesion')?.addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Carga y render ----------

async function cargarServicios() {
  try {
    servicios = await listarServiciosCatalogo();
    renderTabla();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo cargar el catálogo.', 'error');
  }
}

function renderTabla() {
  tablaBody.innerHTML = '';

  if (servicios.length === 0) {
    catVacio.style.display = 'block';
    return;
  }
  catVacio.style.display = 'none';

  servicios.forEach((s) => {
    const tr = document.createElement('tr');
    const estadoClase = s.activo !== false ? 'cat-estado-activo' : 'cat-estado-inactivo';
    const estadoTexto = s.activo !== false ? 'Activo' : 'Inactivo';
    const accionEstadoTexto = s.activo !== false ? 'Desactivar' : 'Activar';

    tr.innerHTML = `
      <td class="cat-codigo">${escapeHtml(s.codigo)}</td>
      <td>${escapeHtml(s.nombre)}</td>
      <td>${escapeHtml(s.categoria || '—')}</td>
      <td>${escapeHtml(s.tipo || '—')}</td>
      <td><span class="cat-estado ${estadoClase}">${estadoTexto}</span></td>
      <td class="cat-acciones">
        <button class="cat-accion-editar" data-id="${s.id}" data-accion="editar">Editar</button>
        <button class="cat-accion-estado" data-id="${s.id}" data-accion="estado">${accionEstadoTexto}</button>
      </td>
    `;
    tablaBody.appendChild(tr);
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- Código nuevo: prefijo (de la categoría/nombre) + correlativo ----------
// Los códigos viejos (ej. "0018", numéricos, sin prefijo) quedan intactos:
// esta lógica solo aplica para los servicios que se creen de aquí en adelante.

function quitarAcentos(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Sugiere un prefijo de 3 letras a partir del nombre, ej. "Walking Closet" -> "WAL" */
function sugerirPrefijo(nombre) {
  const limpio = quitarAcentos(nombre).toUpperCase().replace(/[^A-Z]/g, '');
  return limpio.slice(0, 3) || 'SRV';
}

/** Da el siguiente correlativo DENTRO de ese prefijo, ej. si ya existe WAL-001 -> WAL-002 */
function generarCodigoPorPrefijo(prefijo) {
  if (!prefijo) return '';
  const regex = new RegExp(`^${prefijo}-(\\d+)$`);
  const maxNumero = servicios.reduce((max, s) => {
    const match = String(s.codigo || '').match(regex);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `${prefijo}-${String(maxNumero + 1).padStart(3, '0')}`;
}

function actualizarPreviewCodigo() {
  const prefijo = inputPrefijo.value.trim().toUpperCase();
  inputPrefijo.value = prefijo;
  inputCodigo.value = generarCodigoPorPrefijo(prefijo);
}

inputPrefijo.addEventListener('input', actualizarPreviewCodigo);

// ---------- Modal: nuevo / editar ----------

document.getElementById('btnNuevoServicio').addEventListener('click', () => {
  modoEdicion = null;
  modalServicioTitulo.textContent = 'Nuevo servicio';
  filaPrefijoCodigo.style.display = '';
  inputNombre.value = '';
  inputPrefijo.value = '';
  inputCodigo.value = '';
  inputCategoria.value = '';
  inputTipo.value = '';
  errorNombre.classList.remove('visible');
  modalServicio.style.display = 'flex';
});

// Sugiere el prefijo automáticamente al escribir el nombre, mientras la
// persona no lo haya editado a mano todavía (si ya lo tocó, no se lo pisamos).
let prefijoTocadoManualmente = false;
inputPrefijo.addEventListener('input', () => { prefijoTocadoManualmente = true; });
inputNombre.addEventListener('input', () => {
  if (modoEdicion || prefijoTocadoManualmente) return;
  inputPrefijo.value = sugerirPrefijo(inputNombre.value);
  actualizarPreviewCodigo();
});

function abrirEdicion(id) {
  const servicio = servicios.find(s => s.id === id);
  if (!servicio) return;
  modoEdicion = id;
  modalServicioTitulo.textContent = 'Editar servicio';
  filaPrefijoCodigo.style.display = 'none'; // el código ya existe, no se recalcula al editar
  inputNombre.value = servicio.nombre;
  inputCategoria.value = servicio.categoria || '';
  inputTipo.value = servicio.tipo || '';
  errorNombre.classList.remove('visible');
  modalServicio.style.display = 'flex';
}

document.getElementById('btnGuardarServicio').addEventListener('click', async () => {
  const nombre = inputNombre.value.trim();
  if (!nombre) {
    errorNombre.textContent = 'Este campo es obligatorio.';
    errorNombre.classList.add('visible');
    return;
  }
  if (!modoEdicion && !inputCodigo.value) {
    errorNombre.textContent = 'Escribe un prefijo válido para generar el código.';
    errorNombre.classList.add('visible');
    return;
  }

  const datosComunes = {
    nombre,
    categoria: inputCategoria.value || null,
    tipo: inputTipo.value || null
  };

  try {
    if (modoEdicion) {
      await actualizarServicioCatalogo(modoEdicion, datosComunes);
      mostrarToast('Servicio actualizado correctamente.');
    } else {
      await crearServicioCatalogo({ ...datosComunes, codigo: inputCodigo.value });
      mostrarToast('Servicio creado correctamente.');
    }
    modoEdicion = null;
    prefijoTocadoManualmente = false;
    modalServicio.style.display = 'none';
    await cargarServicios();
  } catch (err) {
    console.error(err);
    mostrarToast('Ocurrió un error al guardar. Intenta nuevamente.', 'error');
  }
});

document.getElementById('btnCancelarServicio').addEventListener('click', () => {
  modalServicio.style.display = 'none';
});

// ---------- Activar / desactivar ----------

function abrirConfirmacionEstado(id) {
  const servicio = servicios.find(s => s.id === id);
  if (!servicio) return;
  idParaCambiarEstado = id;
  const activo = servicio.activo !== false;
  modalEstadoTitulo.textContent = `¿${activo ? 'Desactivar' : 'Activar'} servicio?`;
  modalEstadoTexto.textContent = activo
    ? `"${servicio.nombre}" dejará de estar disponible como opción en nuevos Leads y Cotizaciones. No se elimina del historial existente.`
    : `"${servicio.nombre}" volverá a estar disponible como opción en nuevos Leads y Cotizaciones.`;
  modalEstado.style.display = 'flex';
}

document.getElementById('btnConfirmarEstado').addEventListener('click', async () => {
  const servicio = servicios.find(s => s.id === idParaCambiarEstado);
  if (!servicio) return;
  const activo = servicio.activo !== false;

  try {
    await cambiarEstadoServicioCatalogo(servicio.id, !activo);
    modalEstado.style.display = 'none';
    mostrarToast(`Servicio ${activo ? 'desactivado' : 'activado'} correctamente.`);
    await cargarServicios();
  } catch (err) {
    console.error(err);
    mostrarToast('Ocurrió un error al cambiar el estado.', 'error');
  }
});

document.getElementById('btnCancelarEstado').addEventListener('click', () => {
  modalEstado.style.display = 'none';
});

// ---------- Delegación de clicks en la tabla ----------

tablaBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-accion]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.accion === 'editar') abrirEdicion(id);
  if (btn.dataset.accion === 'estado') abrirConfirmacionEstado(id);
});

// ---------- Toast (estilos inline, mismo patrón que crm.js) ----------

function mostrarToast(mensaje, tipo = 'ok') {
  toastEl.textContent = mensaje;
  toastEl.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:999999;
    background:${tipo === 'error' ? '#c14b32' : '#141213'};
    color:#faf7f2; font-family:'Poppins', sans-serif; font-size:13.5px;
    padding:12px 18px; border-radius:8px;
    box-shadow:0 10px 26px rgba(20,18,19,0.28);
    border-left:3px solid #d6a52c;
    opacity:1; transition:opacity .3s ease;
  `;
  setTimeout(() => { toastEl.style.opacity = '0'; }, 2500);
}
