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
  escucharCotizacionesVigentes, crearServicioCatalogo
} from './firestore.js';
import { mejorarSelect } from './components/dropdown-linence.js';

// ---------- Estado ----------

let STAFF_ACTUAL = null;
let serviciosCatalogo = [];
let cotizacionRowCounter = 0;
let leadActual = null;
let vigenteActual = null;   // null si el lead todavía no tiene cotización
let dejarDeEscuchar = null;

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
const cotVersionesAnteriores = document.getElementById('cotVersionesAnteriores');
const btnVerVersiones = document.getElementById('btnVerVersiones');
const listaVersionesAnteriores = document.getElementById('listaVersionesAnteriores');

// ---------- Guardia de sesión ----------

observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  STAFF_ACTUAL = staff;
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = '';
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
      <td><a href="cotizaciones.html?leadId=${c.leadId}" class="cat-accion-editar">Ver / editar</a></td>
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
    cotFechaEntregaInicio.value = vigenteActual.fechaEntregaInicio || '';
    cotFechaEntregaFin.value = vigenteActual.fechaEntregaFin || '';
    cotFormaPago.value = vigenteActual.formaPago || '';
    cotValidaDesde.value = vigenteActual.validaDesde || '';
  } else {
    editorFolioVersion.textContent = 'Aún no tiene cotización — se creará como versión 1';
    btnGuardarNuevaVersion.style.display = 'none';
    btnGuardarCotizacion.textContent = 'Guardar cotización';
    renderFilas([]);
    cotPorcentajeAbono.value = '';
    cotFechaEntregaInicio.value = '';
    cotFechaEntregaFin.value = '';
    cotFormaPago.value = '';
    cotValidaDesde.value = new Date().toISOString().slice(0, 10);
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
    <td class="cot-item-total" id="cotTotal_${rowId}">$0</td>
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

  const porcentaje = parseInt(cotPorcentajeAbono.value, 10) || 0;
  const abono = Math.round(totalGeneral * (porcentaje / 100));
  cotAbono.textContent = formatearMoneda(abono);

  return { proyecto, items, totalGeneral, porcentaje, abono };
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
  const { proyecto, items, totalGeneral, porcentaje, abono } = recalcularCotizacion();

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
    porcentajeAbono: porcentaje, abono,
    clienteNombre: leadActual.nombre || '',
    fechaEntregaInicio: cotFechaEntregaInicio.value,
    fechaEntregaFin: cotFechaEntregaFin.value,
    formaPago: cotFormaPago.value,
    validaDesde: cotValidaDesde.value
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

btnDescargarPDF.addEventListener('click', async () => {
  if (!vigenteActual) {
    cotizacionError.textContent = 'Guarda la cotización primero: el PDF necesita el folio real.';
    cotizacionError.classList.add('visible');
    return;
  }

  const original = btnDescargarPDF.textContent;
  btnDescargarPDF.textContent = 'Generando…';
  btnDescargarPDF.disabled = true;

  try {
    llenarPlantillaPDF(vigenteActual, leadActual);

    const plantilla = document.getElementById('plantillaPDF');
    const nombreArchivo = `Cotizacion_${(leadActual.nombre || 'cliente').replace(/\s+/g, '_')}_${vigenteActual.numero}.pdf`;

    const blob = await html2pdf().set({
      margin: 0,
      filename: nombreArchivo,
      html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).from(plantilla).toPdf().output('blob');

    // Se abre en una pestaña nueva usando el visor de PDF nativo del
    // navegador (con zoom, páginas, rotar, imprimir y descargar ya
    // incluidos) en vez de descargarlo directo sin poder revisarlo.
    const url = URL.createObjectURL(blob);
    const ventana = window.open(url, '_blank');
    if (!ventana) {
      mostrarToast('El navegador bloqueó la ventana emergente. Habilítala e intenta de nuevo.', 'error');
    }
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo generar el PDF. Intenta nuevamente.', 'error');
  } finally {
    btnDescargarPDF.textContent = original;
    btnDescargarPDF.disabled = false;
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

  document.getElementById('pdfTotal').textContent = formatearMoneda(cotizacion.totalGeneral);
  document.getElementById('pdfAbonoLabel').textContent = `Abono ${cotizacion.porcentajeAbono || 0}%`;
  document.getElementById('pdfAbono').textContent = formatearMoneda(cotizacion.abono);
}
