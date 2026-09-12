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
  escucharCotizacionesVigentes
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
const cotFechaEntrega = document.getElementById('cotFechaEntrega');
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

function formatearFecha(timestamp) {
  const fecha = timestamp?.toDate?.();
  if (!fecha) return '—';
  return fecha.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
    cotFechaEntrega.value = vigenteActual.fechaEntrega || '';
    cotFormaPago.value = vigenteActual.formaPago || '';
    cotValidaDesde.value = vigenteActual.validaDesde || '';
  } else {
    editorFolioVersion.textContent = 'Aún no tiene cotización — se creará como versión 1';
    btnGuardarNuevaVersion.style.display = 'none';
    btnGuardarCotizacion.textContent = 'Guardar cotización';
    renderFilas([]);
    cotPorcentajeAbono.value = '';
    cotFechaEntrega.value = '';
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
    <td class="cot-item-valor-unitario" id="cotVU_${rowId}">—</td>
    <td><input type="text" id="cotTotal_${rowId}" class="cot-item-total" inputmode="numeric" placeholder="$0" value="${item.total ? formatearMilesInput(String(item.total)) : ''}"></td>
    <td><button type="button" class="cot-item-eliminar" data-row-id="${rowId}" aria-label="Eliminar fila">✕</button></td>
  `;
  cotizacionItemsBody.appendChild(tr);

  mejorarSelect(`#cotCod_${rowId}`);

  const selCodigo = document.getElementById(`cotCod_${rowId}`);
  const inpDesc = document.getElementById(`cotDesc_${rowId}`);
  const inpCant = document.getElementById(`cotCant_${rowId}`);
  const inpTotal = document.getElementById(`cotTotal_${rowId}`);

  selCodigo.addEventListener('change', () => {
    if (!inpDesc.value.trim()) {
      const servicio = serviciosCatalogo.find(s => s.codigo === selCodigo.value);
      if (servicio) inpDesc.value = servicio.nombre;
    }
    recalcularCotizacion();
  });

  inpDesc.addEventListener('input', recalcularCotizacion);
  inpCant.addEventListener('input', () => { actualizarValorUnitarioFila(rowId); recalcularCotizacion(); });
  activarFormatoMiles(inpTotal);
  inpTotal.addEventListener('input', () => { actualizarValorUnitarioFila(rowId); recalcularCotizacion(); });

  actualizarValorUnitarioFila(rowId);
}

function actualizarValorUnitarioFila(rowId) {
  const cantidad = parsearCantidad(document.getElementById(`cotCant_${rowId}`)?.value);
  const total = parsearMonto(document.getElementById(`cotTotal_${rowId}`)?.value);
  const celdaVU = document.getElementById(`cotVU_${rowId}`);
  if (!celdaVU) return;

  if (!cantidad || cantidad <= 0 || !total) {
    celdaVU.textContent = '—';
    return;
  }
  celdaVU.textContent = formatearMoneda(total / cantidad) + ' /ml';
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
    return {
      codigo: document.getElementById(`cotCod_${rowId}`).value,
      descripcion: document.getElementById(`cotDesc_${rowId}`).value.trim(),
      cantidad: document.getElementById(`cotCant_${rowId}`).value.trim(),
      total: parsearMonto(document.getElementById(`cotTotal_${rowId}`).value)
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
  const incompleto = items.find(i => !i.codigo || !i.cantidad || !i.total);
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
    fechaEntrega: cotFechaEntrega.value.trim(),
    formaPago: cotFormaPago.value.trim(),
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
      html2canvas: { scale: 2, useCORS: true },
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
  document.getElementById('pdfFechaEntrega').textContent = cotizacion.fechaEntrega || '—';
  document.getElementById('pdfCliente').textContent = lead.nombre || '—';
  document.getElementById('pdfTelefono').textContent = lead.telefono || '—';
  document.getElementById('pdfDireccion').textContent = formatearDireccion(lead.direccion);
  document.getElementById('pdfFormaPago').textContent = cotizacion.formaPago || '—';

  document.getElementById('pdfItemsBody').innerHTML = cotizacion.items.map(item => `
    <tr>
      <td>${escapeHtml(item.codigo)}</td>
      <td>${escapeHtml(item.cantidad)} m</td>
      <td>${escapeHtml(item.descripcion)}</td>
      <td>${formatearMoneda(item.total / parsearCantidad(item.cantidad))}</td>
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
