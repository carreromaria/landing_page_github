// ============================================================
// LINENCE — Administración de Tipos de proyecto
// Lógica de la pantalla tipos-proyecto.html
// ============================================================
// Reglas:
//  - El código son 3 letras mayúsculas, sin tildes ni espacios, y es único.
//  - El nombre se puede editar siempre.
//  - El código solo se puede cambiar mientras ningún lead ni proyecto lo use.
//  - Desactivar oculta el tipo al crear leads/proyectos nuevos; lo ya creado no cambia.
//  - Solo se puede eliminar un tipo que nunca se usó. MIX y OTR están protegidos.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  listarTiposProyecto, asegurarTiposProyectoBase, crearTipoProyecto,
  actualizarNombreTipoProyecto, cambiarEstadoTipoProyecto, eliminarTipoProyecto,
  renombrarCodigoTipoProyecto, contarUsoTiposProyecto
} from './firestore.js';

let tipos = [];
let uso = {};
let editando = null;         // código del tipo en edición (null = creando)
let accionPendiente = null;  // { tipo, codigo }
const filtros = { texto: '', estado: '' };

const tablaBody = document.getElementById('tablaTiposBody');
const catVacio = document.getElementById('catVacio');
const modalTipo = document.getElementById('modalTipo');
const inputCodigo = document.getElementById('inputCodigoTipo');
const inputNombre = document.getElementById('inputNombreTipo');
const errorCodigo = document.getElementById('errorCodigo');
const errorNombre = document.getElementById('errorNombre');
const notaCodigo = document.getElementById('notaCodigo');
const modalConfirmar = document.getElementById('modalConfirmar');
const toastEl = document.getElementById('catToast');

// ---------- Sesión y sidebar ----------

const dashTopbarMobile = document.getElementById('dashTopbarMobile');
const actualizarTopbar = () => { dashTopbarMobile.style.display = window.innerWidth <= 900 ? 'flex' : 'none'; };
window.addEventListener('resize', actualizarTopbar);

observarSesionStaff((staff) => {
  if (!staff) { window.location.href = 'login.html'; return; }
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = '';
  actualizarTopbar();
  document.getElementById('staffNombre').textContent = staff.nombre || '—';
  document.getElementById('staffRol').textContent = staff.rol || '—';
  iniciar();
});

document.getElementById('btnCerrarSesion')?.addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

const dashSidebar = document.getElementById('dashSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const abrirSidebar = () => { dashSidebar.classList.add('abierto'); sidebarOverlay.classList.add('visible'); };
const cerrarSidebar = () => { dashSidebar.classList.remove('abierto'); sidebarOverlay.classList.remove('visible'); };
document.getElementById('btnAbrirSidebar')?.addEventListener('click', abrirSidebar);
document.getElementById('btnCerrarSidebar')?.addEventListener('click', cerrarSidebar);
sidebarOverlay?.addEventListener('click', cerrarSidebar);

// ---------- Carga y render ----------

async function iniciar() {
  try {
    // La primera vez carga los 9 tipos base (COC, VAN, CLO, WAL, CEN, OFI, LOC, MIX, OTR)
    await asegurarTiposProyectoBase();
  } catch (err) {
    console.error('No pudimos cargar los tipos base:', err);
  }
  await cargar();
}

async function cargar() {
  try {
    [tipos, uso] = await Promise.all([listarTiposProyecto(), contarUsoTiposProyecto()]);
    render();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudieron cargar los tipos de proyecto.', 'error');
  }
}

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const totalUso = (codigo) => (uso[codigo]?.leads || 0) + (uso[codigo]?.proyectos || 0);

function textoUso(codigo) {
  const u = uso[codigo];
  if (!u || (!u.leads && !u.proyectos)) return 'Sin uso';
  const partes = [];
  if (u.leads) partes.push(`${u.leads} lead${u.leads === 1 ? '' : 's'}`);
  if (u.proyectos) partes.push(`${u.proyectos} proyecto${u.proyectos === 1 ? '' : 's'}`);
  return partes.join(' · ');
}

function render() {
  tablaBody.innerHTML = '';
  const texto = sinAcentos(filtros.texto).trim();
  const visibles = tipos.filter(t => {
    if (texto && !sinAcentos(`${t.codigo} ${t.nombre}`).includes(texto)) return false;
    const activo = t.activo !== false;
    if (filtros.estado === 'activo' && !activo) return false;
    if (filtros.estado === 'inactivo' && activo) return false;
    return true;
  });

  document.getElementById('btnLimpiarFiltros').style.display = (texto || filtros.estado) ? '' : 'none';

  if (!visibles.length) {
    catVacio.textContent = tipos.length ? 'Ningún tipo coincide con los filtros.' : 'Aún no hay tipos creados.';
    catVacio.style.display = 'block';
    return;
  }
  catVacio.style.display = 'none';

  visibles.forEach(t => {
    const activo = t.activo !== false;
    const enUso = totalUso(t.codigo) > 0;
    const acciones = [`<button class="cat-accion-editar" data-accion="editar" data-codigo="${t.codigo}">Editar</button>`];
    if (!t.protegido) {
      acciones.push(`<button class="cat-accion-estado" data-accion="estado" data-codigo="${t.codigo}">${activo ? 'Desactivar' : 'Activar'}</button>`);
      if (!enUso) acciones.push(`<button class="cat-accion-estado" data-accion="eliminar" data-codigo="${t.codigo}">Eliminar</button>`);
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cat-codigo">${escapar(t.codigo)}</td>
      <td>${escapar(t.nombre)}${t.protegido ? ' <span class="cat-estado cat-estado-activo" title="Siempre disponible">Protegido</span>' : ''}</td>
      <td>${textoUso(t.codigo)}</td>
      <td><span class="cat-estado ${activo ? 'cat-estado-activo' : 'cat-estado-inactivo'}">${activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="cat-acciones">${acciones.join('')}</td>`;
    tablaBody.appendChild(tr);
  });
}

document.getElementById('filtroTexto').addEventListener('input', (e) => { filtros.texto = e.target.value; render(); });
document.getElementById('filtroEstado').addEventListener('change', (e) => { filtros.estado = e.target.value; render(); });
document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
  filtros.texto = filtros.estado = '';
  document.getElementById('filtroTexto').value = '';
  document.getElementById('filtroEstado').value = '';
  render();
});

// ---------- Modal nuevo / editar ----------

inputCodigo.addEventListener('input', () => {
  inputCodigo.value = inputCodigo.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
});

document.getElementById('btnNuevoTipo').addEventListener('click', () => {
  editando = null;
  document.getElementById('modalTipoTitulo').textContent = 'Nuevo tipo';
  inputCodigo.value = '';
  inputCodigo.disabled = false;
  inputNombre.value = '';
  notaCodigo.style.display = 'none';
  errorCodigo.classList.remove('visible');
  errorNombre.classList.remove('visible');
  modalTipo.style.display = 'flex';
  inputCodigo.focus();
});

function abrirEdicion(codigo) {
  const t = tipos.find(x => x.codigo === codigo);
  if (!t) return;
  editando = codigo;
  document.getElementById('modalTipoTitulo').textContent = 'Editar tipo';
  inputCodigo.value = t.codigo;
  inputNombre.value = t.nombre || '';
  const bloqueado = t.protegido || totalUso(codigo) > 0;
  inputCodigo.disabled = bloqueado;
  notaCodigo.textContent = t.protegido
    ? 'Este tipo está protegido: el código no se puede cambiar.'
    : (bloqueado ? 'El código ya está en uso en leads o proyectos, por eso no se puede cambiar. El nombre sí.' : '');
  notaCodigo.style.display = bloqueado ? '' : 'none';
  errorCodigo.classList.remove('visible');
  errorNombre.classList.remove('visible');
  modalTipo.style.display = 'flex';
}

document.getElementById('btnCancelarTipo').addEventListener('click', () => { modalTipo.style.display = 'none'; });

document.getElementById('btnGuardarTipo').addEventListener('click', async () => {
  const codigo = inputCodigo.value.trim().toUpperCase();
  const nombre = inputNombre.value.trim();
  errorCodigo.classList.remove('visible');
  errorNombre.classList.remove('visible');

  if (!/^[A-Z]{3}$/.test(codigo)) {
    errorCodigo.textContent = 'Usa exactamente 3 letras, sin tildes ni espacios.';
    errorCodigo.classList.add('visible');
    return;
  }
  if (!nombre) { errorNombre.classList.add('visible'); return; }

  try {
    if (!editando) {
      await crearTipoProyecto(codigo, nombre);
      mostrarToast('Tipo creado correctamente.');
    } else {
      if (codigo !== editando) await renombrarCodigoTipoProyecto(editando, codigo);
      await actualizarNombreTipoProyecto(codigo, nombre);
      mostrarToast('Tipo actualizado correctamente.');
    }
    modalTipo.style.display = 'none';
    await cargar();
  } catch (err) {
    if (err.message === 'EXISTE') {
      errorCodigo.textContent = `El código ${codigo} ya existe. Elige otro.`;
      errorCodigo.classList.add('visible');
      return;
    }
    console.error(err);
    mostrarToast('Ocurrió un error al guardar. Intenta nuevamente.', 'error');
  }
});

// ---------- Activar / desactivar / eliminar ----------

function abrirConfirmacion(accion, codigo) {
  const t = tipos.find(x => x.codigo === codigo);
  if (!t) return;
  accionPendiente = { accion, codigo };
  const activo = t.activo !== false;
  const titulo = document.getElementById('modalConfirmarTitulo');
  const texto = document.getElementById('modalConfirmarTexto');
  if (accion === 'eliminar') {
    titulo.textContent = '¿Eliminar tipo?';
    texto.textContent = `"${t.codigo} — ${t.nombre}" se eliminará definitivamente. Solo es posible porque nunca se ha usado.`;
  } else {
    titulo.textContent = activo ? '¿Desactivar tipo?' : '¿Activar tipo?';
    texto.textContent = activo
      ? `"${t.codigo} — ${t.nombre}" dejará de aparecer al crear leads y proyectos nuevos. Lo que ya usa este código no cambia.`
      : `"${t.codigo} — ${t.nombre}" volverá a aparecer al crear leads y proyectos nuevos.`;
  }
  modalConfirmar.style.display = 'flex';
}

document.getElementById('btnCancelarConfirmar').addEventListener('click', () => { modalConfirmar.style.display = 'none'; });

document.getElementById('btnAceptarConfirmar').addEventListener('click', async () => {
  if (!accionPendiente) return;
  const { accion, codigo } = accionPendiente;
  const t = tipos.find(x => x.codigo === codigo);
  try {
    if (accion === 'eliminar') {
      if (totalUso(codigo) > 0 || t.protegido) throw new Error('EN_USO');
      await eliminarTipoProyecto(codigo);
      mostrarToast('Tipo eliminado.');
    } else {
      const activo = t.activo !== false;
      await cambiarEstadoTipoProyecto(codigo, !activo);
      mostrarToast(`Tipo ${activo ? 'desactivado' : 'activado'} correctamente.`);
    }
    modalConfirmar.style.display = 'none';
    await cargar();
  } catch (err) {
    console.error(err);
    mostrarToast(err.message === 'EN_USO' ? 'Este tipo ya está en uso: desactívalo en vez de eliminarlo.' : 'Ocurrió un error. Intenta nuevamente.', 'error');
  }
});

tablaBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-accion]');
  if (!btn) return;
  if (btn.dataset.accion === 'editar') abrirEdicion(btn.dataset.codigo);
  else abrirConfirmacion(btn.dataset.accion, btn.dataset.codigo);
});

// ---------- Toast ----------

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
