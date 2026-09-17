// ============================================================
// LINENCE — Cotizaciones
// Lógica de cotizaciones.html (lista + editor)
// ============================================================
// Reutiliza auth.js y firestore.js, igual que el resto del panel.
// La cotización vive en su propia colección "cotizaciones",
// vinculada a un Lead por leadId. Un Lead puede tener varias
// versiones a lo largo del tiempo; solo una queda "vigente".

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  listarServiciosActivos, obtenerLead, obtenerCotizacionVigentePorLead,
  listarCotizacionesPorLead, crearCotizacion, actualizarCotizacion,
  escucharCotizacionesVigentes, crearServicioCatalogo,
  listarCatalogoDescripcionActivo, crearOpcionCatalogoDescripcion
} from './firestore.js';
import { mejorarSelect } from './components/dropdown-linence.js';

// ---------- Estado ----------

let STAFF_ACTUAL = null;
let serviciosCatalogo = [];
let catalogoDescripcionCompleto = []; // catálogo de Materiales/Herrajes/Cubiertas/Accesorios (DC)
let cotizacionRowCounter = 0;
let leadActual = null;
let vigenteActual = null;   // null si el lead todavía no tiene cotización
let dejarDeEscuchar = null;

const CATEGORIAS_DESCRIPCION = ['materiales', 'herrajes', 'cubiertas', 'accesorios'];
const NOMBRES_CATEGORIA_DESCRIPCION = {
  materiales: 'Materiales', herrajes: 'Herrajes', cubiertas: 'Cubiertas', accesorios: 'Accesorios'
};

const leadId = new URLSearchParams(window.location.search).get('leadId');

// ---------- Referencias DOM ----------

const vistaLista = document.getElementById('vistaListaCotizaciones');
const vistaEditor = document.getElementById('vistaEditorCotizacion');
const tablaCotizacionesBody = document.getElementById('tablaCotizacionesBody');
const listaCotizacionesVacio = document.getElementById('listaCotizacionesVacio');

const editorClienteNombre = document.getElementById('editorClienteNombre');
const editorFolioVersion = document.getElementById('editorFolioVersion');
const cotizacionItemsBody = document.getElementById('cotizacionItemsBody');
const cotProyectoAuto = document.getElementById('cotProyectoAuto');
const cotTotalGeneral = document.getElementById('cotTotalGeneral');
const cotAplicaIva = document.getElementById('cotAplicaIva');
const filaIva = document.getElementById('filaIva');
const cotIvaMonto = document.getElementById('cotIvaMonto');
const filaTotalConIva = document.getElementById('filaTotalConIva');
const cotTotalConIva = document.getElementById('cotTotalConIva');
const cotPorcentajeAbono = document.getElementById('cotPorcentajeAbono');
const cotAbono = document.getElementById('cotAbono');
const cotizacionError = document.getElementById('cotizacionError');
const btnGuardarCotizacion = document.getElementById('btnGuardarCotizacion');
const btnGuardarNuevaVersion = document.getElementById('btnGuardarNuevaVersion');
const btnDescargarPDF = document.getElementById('btnDescargarPDF');
const cotFechaEntregaInicio = document.getElementById('cotFechaEntregaInicio');
const cotFechaEntregaFin = document.getElementById('cotFechaEntregaFin');
const cotFormaPago = document.getElementById('cotFormaPago');
const cotValidaDesde = document.getElementById('cotValidaDesde');
const cotClienteRut = document.getElementById('cotClienteRut');
const cotVersionesAnteriores = document.getElementById('cotVersionesAnteriores');
const btnVerVersiones = document.getElementById('btnVerVersiones');
const listaVersionesAnteriores = document.getElementById('listaVersionesAnteriores');

const contenedoresChecklistDescripcion = {
  materiales: document.getElementById('cotDescMateriales'),
  herrajes: document.getElementById('cotDescHerrajes'),
  cubiertas: document.getElementById('cotDescCubiertas'),
  accesorios: document.getElementById('cotDescAccesorios')
};

// ---------- Guardia de sesión ----------

const dashTopbarMobile = document.getElementById('dashTopbarMobile');

function actualizarVisibilidadTopbar() {
  dashTopbarMobile.style.display = window.innerWidth <= 900 ? 'flex' : 'none';
}
window.addEventListener('resize', actualizarVisibilidadTopbar);

observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  STAFF_ACTUAL = staff;
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = '';
  actualizarVisibilidadTopbar();
  document.getElementById('staffNombre').textContent = staff.nombre || '—';
  document.getElementById('staffRol').textContent = staff.rol || '—';

  if (leadId) {
    vistaLista.style.display = 'none';
    vistaEditor.style.display = '';
    inicializarEditor();
  } else {
    vistaEditor.style.display = 'none';
    vistaLista.style.display = '';
    inicializarLista();
  }
});

document.getElementById('btnCerrarSesion')?.addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Sidebar mobile (mismo patrón que crm.js) ----------

const btnAbrirSidebar = document.getElementById('btnAbrirSidebar');
const btnCerrarSidebar = document.getElementById('btnCerrarSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const dashSidebar = document.getElementById('dashSidebar');

function abrirSidebar() {
  dashSidebar.classList.add('abierto');
  sidebarOverlay.classList.add('visible');
}
function cerrarSidebar() {
  dashSidebar.classList.remove('abierto');
  sidebarOverlay.classList.remove('visible');
}
btnAbrirSidebar?.addEventListener('click', abrirSidebar);
btnCerrarSidebar?.addEventListener('click', cerrarSidebar);
sidebarOverlay?.addEventListener('click', cerrarSidebar);

// ---------- Utilidades compartidas ----------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatearMoneda(numero) {
  return '$' + (numero || 0).toLocaleString('es-CL');
}

function formatearMilesInput(valor) {
  const limpio = String(valor || '').replace(/\D/g, '');
  return limpio ? Number(limpio).toLocaleString('es-CL') : '';
}

function activarFormatoMiles(inputEl) {
  inputEl.addEventListener('input', () => {
    const cursor = inputEl.selectionStart;
    const largoAntes = inputEl.value.length;
    inputEl.value = formatearMilesInput(inputEl.value);
    const diff = inputEl.value.length - largoAntes;
    inputEl.setSelectionRange(cursor + diff, cursor + diff);
  });
}

function parsearMonto(texto) {
  const limpio = String(texto || '').replace(/\D/g, '');
  return limpio ? Number(limpio) : 0;
}

function parsearCantidad(texto) {
  const match = String(texto || '').replace(',', '.').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : NaN;
}

/**
 * Fuerza que Cantidad siempre use coma como separador decimal (nunca
 * punto), y solo permite dígitos + una coma — así el número nunca se
 * confunde con miles ni con el formato de EE.UU.
 */
function activarFormatoCantidad(inputEl) {
  inputEl.addEventListener('input', () => {
    let valor = inputEl.value.replace(/\./g, ',').replace(/[^\d,]/g, '');
    const primeraComa = valor.indexOf(',');
    if (primeraComa !== -1) {
      valor = valor.slice(0, primeraComa + 1) + valor.slice(primeraComa + 1).replace(/,/g, '');
    }
    inputEl.value = valor;
  });
}

function formatearFecha(timestamp) {
  const fecha = timestamp?.toDate?.();
  if (!fecha) return '—';
  return fecha.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Arma "02 al 04-10-26" a partir de dos fechas tipo input date (AAAA-MM-DD). */
function formatearRangoFechas(inicio, fin) {
  if (!inicio && !fin) return '—';
  const fechaInicio = inicio ? new Date(inicio + 'T00:00:00') : null;
  const fechaFin = fin ? new Date(fin + 'T00:00:00') : null;
  if (fechaInicio && fechaFin) {
    return `${String(fechaInicio.getDate()).padStart(2, '0')} al ${formatearFechaCorta(fechaFin)}`;
  }
  return formatearFechaCorta(fechaInicio || fechaFin);
}

/** Formato corto DD-MM-AA, igual al que usa el documento impreso. */
function formatearFechaCorta(fecha) {
  const d = String(fecha.getDate()).padStart(2, '0');
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const a = String(fecha.getFullYear()).slice(-2);
  return `${d}-${m}-${a}`;
}

/** Arma "Calle Número, Sector - Comuna" a partir del objeto dirección estructurado del lead. */
function formatearDireccion(direccion) {
  if (!direccion) return '—';
  const partes = [];
  if (direccion.calle || direccion.numero) {
    partes.push([direccion.calle, direccion.numero].filter(Boolean).join(' '));
  }
  const zona = [direccion.sector, direccion.comuna].filter(Boolean).join(' - ');
  if (zona) partes.push(zona);
  return partes.join(', ') || '—';
}

function mostrarToast(mensaje, tipo = 'ok') {
  const toastEl = document.getElementById('cotToast');
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

// ============================================================
// ---------- VISTA: LISTA ----------
// ============================================================

function inicializarLista() {
  dejarDeEscuchar = escucharCotizacionesVigentes(
    (cotizaciones) => renderListaCotizaciones(cotizaciones),
    () => mostrarToast('No se pudieron cargar las cotizaciones.', 'error')
  );
}

function renderListaCotizaciones(cotizaciones) {
  tablaCotizacionesBody.innerHTML = '';

  if (cotizaciones.length === 0) {
    listaCotizacionesVacio.style.display = 'block';
    return;
  }
  listaCotizacionesVacio.style.display = 'none';

  cotizaciones.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cat-codigo">${escapeHtml(c.numero)} <span class="cot-badge-version">v${c.version}</span></td>
      <td>${escapeHtml(c.clienteNombre || '—')}</td>
      <td>${escapeHtml(c.proyecto || '—')}</td>
      <td>${formatearMoneda(c.totalGeneral)}</td>
      <td>${formatearMoneda(c.abono)}</td>
      <td>${formatearFecha(c.actualizadoEn)}</td>
      <td><a href="cotizaciones.html?leadId=${c.leadId}" class="cot-btn-ver">Ver / editar</a></td>
    `;
    tablaCotizacionesBody.appendChild(tr);
  });
}

// ============================================================
// ---------- VISTA: EDITOR ----------
// ============================================================

async function inicializarEditor() {
  try {
    serviciosCatalogo = await listarServiciosActivos();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo cargar el catálogo de servicios.', 'error');
  }

  try {
    catalogoDescripcionCompleto = await listarCatalogoDescripcionActivo();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo cargar el catálogo de la Descripción de Cotización.', 'error');
  }

  leadActual = await obtenerLead(leadId);
  if (!leadActual) {
    mostrarToast('No se encontró ese lead.', 'error');
    editorClienteNombre.textContent = 'Lead no encontrado';
    return;
  }
  editorClienteNombre.textContent = leadActual.nombre || '—';

  mejorarSelect('#cotFormaPago', { ancho: 'auto' });

  await cargarCotizacionVigente();
  cargarVersionesAnteriores();
}

async function cargarCotizacionVigente() {
  vigenteActual = await obtenerCotizacionVigentePorLead(leadId);

  if (vigenteActual) {
    editorFolioVersion.textContent = `${vigenteActual.numero} · versión ${vigenteActual.version}`;
    btnGuardarNuevaVersion.style.display = '';
    btnGuardarCotizacion.textContent = 'Guardar cambios';
    renderFilas(vigenteActual.items);
    cotPorcentajeAbono.value = vigenteActual.porcentajeAbono ?? '';
    cotAplicaIva.checked = !!vigenteActual.aplicaIva;
    cotFechaEntregaInicio.value = vigenteActual.fechaEntregaInicio || '';
    cotFechaEntregaFin.value = vigenteActual.fechaEntregaFin || '';
    cotFormaPago.value = vigenteActual.formaPago || '';
    cotValidaDesde.value = vigenteActual.validaDesde || '';
    cotClienteRut.value = vigenteActual.clienteRut || leadActual.rut || '';
    renderChecklistDescripcionCompleto(vigenteActual.descripcionCotizacion || {});
  } else {
    editorFolioVersion.textContent = 'Aún no tiene cotización — se creará como versión 1';
    btnGuardarNuevaVersion.style.display = 'none';
    btnGuardarCotizacion.textContent = 'Guardar cotización';
    renderFilas([]);
    cotPorcentajeAbono.value = '';
    cotAplicaIva.checked = false;
    cotFechaEntregaInicio.value = '';
    cotFechaEntregaFin.value = '';
    cotFormaPago.value = '';
    cotValidaDesde.value = new Date().toISOString().slice(0, 10);
    cotClienteRut.value = leadActual.rut || '';
    renderChecklistDescripcionCompleto({});
  }
  recalcularCotizacion();
}

async function cargarVersionesAnteriores() {
  const todas = await listarCotizacionesPorLead(leadId);
  const anteriores = todas.filter(c => c.estado !== 'vigente');

  if (anteriores.length === 0) {
    cotVersionesAnteriores.style.display = 'none';
    return;
  }

  cotVersionesAnteriores.style.display = '';
  listaVersionesAnteriores.innerHTML = anteriores.map(c => `
    <div class="cot-version-item">
      <span>${escapeHtml(c.numero)} · v${c.version} — ${formatearFecha(c.actualizadoEn)}</span>
      <span>${formatearMoneda(c.totalGeneral)}</span>
    </div>
  `).join('');
}

btnVerVersiones.addEventListener('click', () => {
  const visible = listaVersionesAnteriores.style.display !== 'none';
  listaVersionesAnteriores.style.display = visible ? 'none' : 'block';
  btnVerVersiones.textContent = visible ? 'Ver versiones anteriores' : 'Ocultar versiones anteriores';
});

// ---------- Filas de la tabla ----------

function opcionesCodigoServicio(codigoSeleccionado) {
  const opciones = serviciosCatalogo.map(s =>
    `<option value="${s.codigo}" ${s.codigo === codigoSeleccionado ? 'selected' : ''}>${escapeHtml(s.codigo)} — ${escapeHtml(s.nombre)}</option>`
  ).join('');
  return `<option value="">Selecciona…</option>${opciones}`;
}

function renderFilas(items) {
  cotizacionItemsBody.innerHTML = '';
  cotizacionRowCounter = 0;
  const lista = (items && items.length) ? items : [{}];
  lista.forEach(item => agregarFilaCotizacion(item));
}

function agregarFilaCotizacion(item = {}) {
  const rowId = cotizacionRowCounter++;
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;

  tr.innerHTML = `
    <td><select id="cotCod_${rowId}" class="cot-item-codigo">${opcionesCodigoServicio(item.codigo)}</select></td>
    <td><input type="text" id="cotDesc_${rowId}" class="cot-item-descripcion" placeholder="Descripción" value="${escapeHtml(item.descripcion || '')}"></td>
    <td><input type="text" id="cotCant_${rowId}" class="cot-item-cantidad" placeholder="Ej. 7,40" value="${escapeHtml(item.cantidad || '')}"></td>
    <td><input type="text" id="cotVU_${rowId}" class="cot-item-valor-unitario-input" inputmode="numeric" placeholder="$0" value="${item.valorUnitario ? formatearMilesInput(String(item.valorUnitario)) : ''}"></td>
    <td><span class="cot-item-total" id="cotTotal_${rowId}">$0</span></td>
    <td><button type="button" class="cot-item-eliminar" data-row-id="${rowId}" aria-label="Eliminar fila">✕</button></td>
  `;
  cotizacionItemsBody.appendChild(tr);

  mejorarSelect(`#cotCod_${rowId}`);

  const selCodigo = document.getElementById(`cotCod_${rowId}`);
  const inpDesc = document.getElementById(`cotDesc_${rowId}`);
  const inpCant = document.getElementById(`cotCant_${rowId}`);
  const inpVU = document.getElementById(`cotVU_${rowId}`);

  selCodigo.addEventListener('change', () => {
    if (!inpDesc.value.trim()) {
      const servicio = serviciosCatalogo.find(s => s.codigo === selCodigo.value);
      if (servicio) inpDesc.value = servicio.nombre;
    }
    recalcularCotizacion();
  });

  inpDesc.addEventListener('input', recalcularCotizacion);
  activarFormatoCantidad(inpCant);
  inpCant.addEventListener('input', () => { actualizarTotalFila(rowId); recalcularCotizacion(); });
  activarFormatoMiles(inpVU);
  inpVU.addEventListener('input', () => { actualizarTotalFila(rowId); recalcularCotizacion(); });

  actualizarTotalFila(rowId);
}

/** Total línea = Cantidad × Valor Unitario (se calcula solo, no se edita). */
function actualizarTotalFila(rowId) {
  const cantidad = parsearCantidad(document.getElementById(`cotCant_${rowId}`)?.value);
  const valorUnitario = parsearMonto(document.getElementById(`cotVU_${rowId}`)?.value);
  const celdaTotal = document.getElementById(`cotTotal_${rowId}`);
  if (!celdaTotal) return;

  if (!cantidad || cantidad <= 0 || !valorUnitario) {
    celdaTotal.textContent = '$0';
    return;
  }
  celdaTotal.textContent = formatearMoneda(Math.round(cantidad * valorUnitario));
}

document.getElementById('btnAgregarItemCotizacion').addEventListener('click', () => {
  agregarFilaCotizacion();
});

cotizacionItemsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.cot-item-eliminar');
  if (!btn) return;
  if (cotizacionItemsBody.querySelectorAll('tr').length === 1) {
    renderFilas([]);
    recalcularCotizacion();
    return;
  }
  btn.closest('tr').remove();
  recalcularCotizacion();
});

// ---------- Checklist: Descripción de Cotización ----------

/** Dibuja las opciones activas de una categoría, marcando las ya seleccionadas (por id). */
function renderChecklistDescripcionCategoria(categoria, seleccionados = []) {
  const contenedor = contenedoresChecklistDescripcion[categoria];
  const opciones = catalogoDescripcionCompleto.filter(o => o.categoria === categoria);
  contenedor.innerHTML = opciones.length ? opciones.map(o => `
    <label class="cot-desc-item">
      <input type="checkbox" value="${o.id}" ${seleccionados.includes(o.id) ? 'checked' : ''}>
      ${escapeHtml(o.nombre)}
    </label>
  `).join('') : '<p class="cot-desc-vacio">Aún no hay opciones en esta categoría — agrega la primera con "+ Agregar opción".</p>';
}

function renderChecklistDescripcionCompleto(seleccion = {}) {
  CATEGORIAS_DESCRIPCION.forEach(categoria => {
    renderChecklistDescripcionCategoria(categoria, seleccion[categoria] || []);
  });
}

function leerChecklistDescripcionCategoria(categoria) {
  return [...contenedoresChecklistDescripcion[categoria].querySelectorAll('input[type="checkbox"]:checked')]
    .map(c => c.value);
}

function leerDescripcionCotizacion() {
  const resultado = {};
  CATEGORIAS_DESCRIPCION.forEach(categoria => {
    resultado[categoria] = leerChecklistDescripcionCategoria(categoria);
  });
  return resultado;
}

// ---------- Modal: nueva opción del catálogo de Descripción ----------

let categoriaNuevaOpcion = null;
const modalNuevaOpcionDescripcion = document.getElementById('modalNuevaOpcionDescripcion');
const nuevaOpcionTitulo = document.getElementById('nuevaOpcionTitulo');
const nuevaOpcionNombre = document.getElementById('nuevaOpcionNombre');
const nuevaOpcionError = document.getElementById('nuevaOpcionError');

document.querySelectorAll('.cot-btn-agregar-opcion').forEach(btn => {
  btn.addEventListener('click', () => {
    categoriaNuevaOpcion = btn.dataset.categoria;
    nuevaOpcionTitulo.textContent = `Nueva opción — ${NOMBRES_CATEGORIA_DESCRIPCION[categoriaNuevaOpcion]}`;
    nuevaOpcionNombre.value = '';
    nuevaOpcionError.classList.remove('visible');
    modalNuevaOpcionDescripcion.style.display = 'flex';
    nuevaOpcionNombre.focus();
  });
});

document.getElementById('btnCancelarNuevaOpcion').addEventListener('click', () => {
  modalNuevaOpcionDescripcion.style.display = 'none';
});

document.getElementById('btnGuardarNuevaOpcion').addEventListener('click', async () => {
  const nombre = nuevaOpcionNombre.value.trim();
  if (!nombre) {
    nuevaOpcionError.textContent = 'Escribe un nombre para la opción.';
    nuevaOpcionError.classList.add('visible');
    return;
  }

  try {
    const seleccionActual = leerDescripcionCotizacion();
    const nuevoId = await crearOpcionCatalogoDescripcion({ categoria: categoriaNuevaOpcion, nombre });
    catalogoDescripcionCompleto = await listarCatalogoDescripcionActivo();
    seleccionActual[categoriaNuevaOpcion].push(nuevoId);
    renderChecklistDescripcionCategoria(categoriaNuevaOpcion, seleccionActual[categoriaNuevaOpcion]);
    modalNuevaOpcionDescripcion.style.display = 'none';
    mostrarToast(`"${nombre}" agregado al catálogo.`);
  } catch (err) {
    console.error(err);
    nuevaOpcionError.textContent = 'Ocurrió un error al guardar. Intenta de nuevo.';
    nuevaOpcionError.classList.add('visible');
  }
});

cotAplicaIva.addEventListener('change', recalcularCotizacion);

cotPorcentajeAbono.addEventListener('input', () => {
  cotPorcentajeAbono.value = cotPorcentajeAbono.value.replace(/\D/g, '').slice(0, 3);
  recalcularCotizacion();
});

function leerItemsCotizacion() {
  return [...cotizacionItemsBody.querySelectorAll('tr')].map(tr => {
    const rowId = tr.dataset.rowId;
    const cantidad = document.getElementById(`cotCant_${rowId}`).value.trim();
    const valorUnitario = parsearMonto(document.getElementById(`cotVU_${rowId}`).value);
    const cantidadNum = parsearCantidad(cantidad) || 0;
    const total = Math.round(cantidadNum * valorUnitario);
    return {
      codigo: document.getElementById(`cotCod_${rowId}`).value,
      descripcion: document.getElementById(`cotDesc_${rowId}`).value.trim(),
      cantidad,
      valorUnitario,
      total
    };
  }).filter(item => item.descripcion || item.total);
}

function recalcularCotizacion() {
  const items = leerItemsCotizacion();

  const proyecto = items.map(i => i.descripcion).filter(Boolean).join(', ');
  cotProyectoAuto.textContent = proyecto || '—';

  const totalGeneral = items.reduce((suma, i) => suma + (i.total || 0), 0);
  cotTotalGeneral.textContent = formatearMoneda(totalGeneral);

  const aplicaIva = cotAplicaIva.checked;
  const ivaMonto = aplicaIva ? Math.round(totalGeneral * 0.19) : 0;
  const totalConIva = totalGeneral + ivaMonto;

  filaIva.style.display = aplicaIva ? '' : 'none';
  filaTotalConIva.style.display = aplicaIva ? '' : 'none';
  cotIvaMonto.textContent = formatearMoneda(ivaMonto);
  cotTotalConIva.textContent = formatearMoneda(totalConIva);

  // El Abono se calcula sobre el total con IVA cuando aplica; si no,
  // sobre el total general (neto), igual que siempre.
  const baseAbono = aplicaIva ? totalConIva : totalGeneral;

  const porcentaje = parseInt(cotPorcentajeAbono.value, 10) || 0;
  const abono = Math.round(baseAbono * (porcentaje / 100));
  cotAbono.textContent = formatearMoneda(abono);

  return { proyecto, items, totalGeneral, aplicaIva, ivaMonto, totalConIva, porcentaje, abono };
}

function validarCotizacion(items) {
  if (items.length === 0) {
    return 'Agrega al menos un servicio antes de guardar.';
  }
  const incompleto = items.find(i => !i.codigo || !i.cantidad || !i.valorUnitario);
  if (incompleto) {
    return 'Cada línea necesita código, cantidad y total.';
  }
  return null;
}

async function guardar({ comoNuevaVersion }) {
  const { proyecto, items, totalGeneral, aplicaIva, ivaMonto, totalConIva, porcentaje, abono } = recalcularCotizacion();

  cotizacionError.textContent = '';
  cotizacionError.classList.remove('visible');

  const errorValidacion = validarCotizacion(items);
  if (errorValidacion) {
    cotizacionError.textContent = errorValidacion;
    cotizacionError.classList.add('visible');
    return;
  }

  const datos = {
    proyecto, items, totalGeneral,
    aplicaIva, ivaMonto, totalConIva,
    porcentajeAbono: porcentaje, abono,
    clienteNombre: leadActual.nombre || '',
    fechaEntregaInicio: cotFechaEntregaInicio.value,
    fechaEntregaFin: cotFechaEntregaFin.value,
    formaPago: cotFormaPago.value,
    validaDesde: cotValidaDesde.value,
    clienteRut: cotClienteRut.value.trim(),
    descripcionCotizacion: leerDescripcionCotizacion()
  };

  try {
    if (!vigenteActual || comoNuevaVersion) {
      await crearCotizacion(leadId, leadActual.canalOrigen, datos, STAFF_ACTUAL.uid);
      mostrarToast(comoNuevaVersion ? 'Nueva versión creada.' : 'Cotización creada.');
    } else {
      await actualizarCotizacion(vigenteActual.id, datos);
      mostrarToast('Cotización actualizada.');
    }
    await cargarCotizacionVigente();
    await cargarVersionesAnteriores();
  } catch (err) {
    console.error(err);
    cotizacionError.textContent = 'Ocurrió un error al guardar. Intenta nuevamente.';
    cotizacionError.classList.add('visible');
  }
}

btnGuardarCotizacion.addEventListener('click', () => guardar({ comoNuevaVersion: false }));
btnGuardarNuevaVersion.addEventListener('click', () => guardar({ comoNuevaVersion: true }));

// ---------- Modal: nuevo código de servicio (sin salir de la pantalla) ----------

const modalNuevoCodigo = document.getElementById('modalNuevoCodigo');
const nuevoCodigoPrefijo = document.getElementById('nuevoCodigoPrefijo');
const nuevoCodigoInput = document.getElementById('nuevoCodigoInput');
const nuevoCodigoNombre = document.getElementById('nuevoCodigoNombre');
const nuevoCodigoCategoria = document.getElementById('nuevoCodigoCategoria');
const nuevoCodigoTipo = document.getElementById('nuevoCodigoTipo');
const nuevoCodigoError = document.getElementById('nuevoCodigoError');

/** Sugiere un prefijo de 3 letras a partir del nombre, ej. "Rack TV" -> "RAC" */
function sugerirPrefijo(nombre) {
  const limpio = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z]/g, '');
  return limpio.slice(0, 3) || 'SRV';
}

/** Da el siguiente correlativo dentro de ese prefijo, ej. si ya existe RAC-001 -> RAC-002 */
function generarCodigoPorPrefijo(prefijo) {
  if (!prefijo) return '';
  const regex = new RegExp(`^${prefijo}-(\\d+)$`);
  const maxNumero = serviciosCatalogo.reduce((max, s) => {
    const match = String(s.codigo || '').match(regex);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `${prefijo}-${String(maxNumero + 1).padStart(3, '0')}`;
}

function actualizarPreviewCodigoNuevo() {
  const prefijo = nuevoCodigoPrefijo.value.trim().toUpperCase();
  nuevoCodigoPrefijo.value = prefijo;
  nuevoCodigoInput.value = generarCodigoPorPrefijo(prefijo);
}

let prefijoNuevoTocado = false;
nuevoCodigoPrefijo.addEventListener('input', () => {
  prefijoNuevoTocado = true;
  actualizarPreviewCodigoNuevo();
});
nuevoCodigoNombre.addEventListener('input', () => {
  if (prefijoNuevoTocado) return;
  nuevoCodigoPrefijo.value = sugerirPrefijo(nuevoCodigoNombre.value);
  actualizarPreviewCodigoNuevo();
});

document.getElementById('btnNuevoCodigoDesdeAqui').addEventListener('click', () => {
  nuevoCodigoNombre.value = '';
  nuevoCodigoPrefijo.value = '';
  nuevoCodigoInput.value = '';
  nuevoCodigoCategoria.value = '';
  nuevoCodigoTipo.value = '';
  prefijoNuevoTocado = false;
  nuevoCodigoError.classList.remove('visible');
  modalNuevoCodigo.style.display = 'flex';
});

document.getElementById('btnCancelarNuevoCodigo').addEventListener('click', () => {
  modalNuevoCodigo.style.display = 'none';
});

document.getElementById('btnGuardarNuevoCodigo').addEventListener('click', async () => {
  const nombre = nuevoCodigoNombre.value.trim();
  if (!nombre) {
    nuevoCodigoError.textContent = 'Este campo es obligatorio.';
    nuevoCodigoError.classList.add('visible');
    return;
  }
  if (!nuevoCodigoInput.value) {
    nuevoCodigoError.textContent = 'Escribe un prefijo válido para generar el código.';
    nuevoCodigoError.classList.add('visible');
    return;
  }

  try {
    await crearServicioCatalogo({
      codigo: nuevoCodigoInput.value,
      nombre,
      categoria: nuevoCodigoCategoria.value || null,
      tipo: nuevoCodigoTipo.value || null
    });
    serviciosCatalogo = await listarServiciosActivos();
    modalNuevoCodigo.style.display = 'none';
    mostrarToast(`Servicio "${nombre}" creado (${nuevoCodigoInput.value}).`);
    agregarFilaCotizacion({ codigo: nuevoCodigoInput.value, descripcion: nombre });
  } catch (err) {
    console.error(err);
    nuevoCodigoError.textContent = 'Ocurrió un error al crear el servicio. Intenta de nuevo.';
    nuevoCodigoError.classList.add('visible');
  }
});

// ---------- Descargar PDF ----------
// Usa los datos ya guardados (vigenteActual) para que el folio y la
// versión que salen en el PDF sean siempre los reales. Si el lead
// todavía no tiene cotización guardada, pide guardar primero.

const modalPdfCotizacion = document.getElementById('modalPdfCotizacion');

btnDescargarPDF.addEventListener('click', () => {
  if (!vigenteActual) {
    cotizacionError.textContent = 'Guarda la cotización primero: el PDF necesita el folio real.';
    cotizacionError.classList.add('visible');
    return;
  }

  llenarPlantillaPDF(vigenteActual, leadActual);
  modalPdfCotizacion.classList.add('visible');
});

document.getElementById('btnCerrarModalPdf').addEventListener('click', () => {
  modalPdfCotizacion.classList.remove('visible');
});
modalPdfCotizacion.addEventListener('click', (e) => {
  if (e.target === modalPdfCotizacion) modalPdfCotizacion.classList.remove('visible');
});

document.getElementById('btnImprimirPdf').addEventListener('click', () => {
  window.print();
});

document.getElementById('btnDescargarPdfModal').addEventListener('click', async () => {
  const btn = document.getElementById('btnDescargarPdfModal');
  const original = btn.textContent;
  btn.textContent = 'Generando…';
  btn.disabled = true;

  try {
    const plantilla = document.getElementById('plantillaPDF');
    const nombreArchivo = `Cotizacion_${(leadActual.nombre || 'cliente').replace(/\s+/g, '_')}_${vigenteActual.numero}.pdf`;

    // La plantilla ya está genuinamente visible dentro del modal (nunca
    // escondida ni fuera de pantalla) — html2canvas la captura tal cual
    // se ve, igual que ya funciona en Documentación.
    await html2pdf().set({
      margin: 0,
      filename: nombreArchivo,
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).from(plantilla).save();

    mostrarToast('PDF descargado correctamente.');
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo generar el PDF. Intenta nuevamente.', 'error');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
});

function llenarPlantillaPDF(cotizacion, lead) {
  document.getElementById('pdfFolio').textContent = cotizacion.numero;
  document.getElementById('pdfFecha').textContent =
    formatearFechaCorta(cotizacion.creadoEn?.toDate?.() || new Date());
  document.getElementById('pdfProyecto').textContent = cotizacion.proyecto || '—';
  document.getElementById('pdfFechaEntrega').textContent = formatearRangoFechas(cotizacion.fechaEntregaInicio, cotizacion.fechaEntregaFin);
  document.getElementById('pdfCliente').textContent = lead.nombre || '—';
  document.getElementById('pdfTelefono').textContent = lead.telefono || '—';
  document.getElementById('pdfDireccion').textContent = formatearDireccion(lead.direccion);
  document.getElementById('pdfFormaPago').textContent = cotizacion.formaPago || '—';

  document.getElementById('pdfItemsBody').innerHTML = cotizacion.items.map(item => `
    <tr>
      <td>${escapeHtml(item.codigo)}</td>
      <td>${escapeHtml(item.cantidad)} m</td>
      <td>${escapeHtml(item.descripcion)}</td>
      <td>${formatearMoneda(item.valorUnitario)}</td>
      <td>${formatearMoneda(item.total)}</td>
    </tr>
  `).join('');

  const validaDesdeFecha = cotizacion.validaDesde
    ? formatearFechaCorta(new Date(cotizacion.validaDesde + 'T00:00:00'))
    : '—';
  document.getElementById('pdfValidaDesde').textContent =
    `Esta cotización de su proyecto es válida desde ${validaDesdeFecha}`;

  if (cotizacion.aplicaIva) {
    document.getElementById('pdfSubtotal').textContent = formatearMoneda(cotizacion.totalGeneral);
    document.getElementById('pdfIva').textContent = formatearMoneda(cotizacion.ivaMonto);
    document.getElementById('pdfTotal').textContent = formatearMoneda(cotizacion.totalConIva);
  } else {
    document.getElementById('pdfSubtotal').textContent = '';
    document.getElementById('pdfIva').textContent = '';
    document.getElementById('pdfTotal').textContent = formatearMoneda(cotizacion.totalGeneral);
  }
  document.getElementById('pdfAbonoLabel').textContent = `Abono ${cotizacion.porcentajeAbono || 0}%`;
  document.getElementById('pdfAbono').textContent = formatearMoneda(cotizacion.abono);
}

// ---------- Descargar Descripción de Cotización (documento DC) ----------
// Mismo folio que la cotización (CT-XXX-00000 -> DC-XXX-00000) y misma
// fuente de datos: lo que quedó marcado en el checklist de esta
// cotización guardada. Es el mismo documento que aparece en el
// módulo Documentación (comparten el catálogo y el formato).

const modalPdfDescripcion = document.getElementById('modalPdfDescripcion');

/** "CT-WSP-00002" -> "DC-WSP-00002" */
function folioDescripcion(numeroCotizacion) {
  return String(numeroCotizacion || '').replace(/^[A-Z]+-/, 'DC-');
}

function filaChecklistPDF(categoria, seleccionIds = []) {
  const opciones = catalogoDescripcionCompleto.filter(o => o.categoria === categoria);
  if (!opciones.length) return '<div class="pdf-dc-item">Sin opciones registradas en el catálogo.</div>';
  return opciones.map(o => `
    <div class="pdf-dc-item ${seleccionIds.includes(o.id) ? 'incluido' : ''}">${escapeHtml(o.nombre)}</div>
  `).join('');
}

function llenarPlantillaDC(cotizacion, lead) {
  document.getElementById('pdfDCFolio').textContent = folioDescripcion(cotizacion.numero);
  document.getElementById('pdfDCFecha').textContent =
    formatearFechaCorta(cotizacion.creadoEn?.toDate?.() || new Date());
  document.getElementById('pdfDCCliente').textContent = lead.nombre || '—';
  document.getElementById('pdfDCRut').textContent = cotizacion.clienteRut || lead.rut || '—';
  document.getElementById('pdfDCDireccion').textContent = formatearDireccion(lead.direccion);

  const seleccion = cotizacion.descripcionCotizacion || {};
  document.getElementById('pdfDCMateriales').innerHTML = filaChecklistPDF('materiales', seleccion.materiales);
  document.getElementById('pdfDCHerrajes').innerHTML = filaChecklistPDF('herrajes', seleccion.herrajes);
  document.getElementById('pdfDCCubiertas').innerHTML = filaChecklistPDF('cubiertas', seleccion.cubiertas);
  document.getElementById('pdfDCAccesorios').innerHTML = filaChecklistPDF('accesorios', seleccion.accesorios);
}

document.getElementById('btnVerDescripcion').addEventListener('click', () => {
  if (!vigenteActual) {
    cotizacionError.textContent = 'Guarda la cotización primero: el documento necesita el folio real.';
    cotizacionError.classList.add('visible');
    return;
  }
  llenarPlantillaDC(vigenteActual, leadActual);
  modalPdfDescripcion.classList.add('visible');
});

document.getElementById('btnCerrarModalDC').addEventListener('click', () => {
  modalPdfDescripcion.classList.remove('visible');
});
modalPdfDescripcion.addEventListener('click', (e) => {
  if (e.target === modalPdfDescripcion) modalPdfDescripcion.classList.remove('visible');
});

document.getElementById('btnImprimirDC').addEventListener('click', () => {
  window.print();
});

document.getElementById('btnDescargarDCModal').addEventListener('click', async () => {
  const btn = document.getElementById('btnDescargarDCModal');
  const original = btn.textContent;
  btn.textContent = 'Generando…';
  btn.disabled = true;

  try {
    const plantilla = document.getElementById('plantillaDC');
    const nombreArchivo = `Descripcion_${(leadActual.nombre || 'cliente').replace(/\s+/g, '_')}_${folioDescripcion(vigenteActual.numero)}.pdf`;

    await html2pdf().set({
      margin: 0,
      filename: nombreArchivo,
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).from(plantilla).save();

    mostrarToast('PDF descargado correctamente.');
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo generar el PDF. Intenta nuevamente.', 'error');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
});
