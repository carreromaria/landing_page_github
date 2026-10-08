// ============================================================
// LINENCE — Cotizaciones
// Lógica de cotizaciones.html (lista + editor)
// ============================================================
// Reutiliza auth.js y firestore.js, igual que el resto del panel.
// La cotización vive en su propia colección "cotizaciones",
// vinculada a un Lead por leadId. Un Lead puede tener varias
// versiones a lo largo del tiempo; solo una queda "vigente" por opción.
// Además, un Lead puede tener varias OPCIONES en paralelo (A, B, C…):
// cotizaciones distintas del mismo proyecto (ej. cubierta de cuarzo vs.
// postformado), cada una con su propio historial de versiones.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  listarServiciosActivos, obtenerLead,
  listarOpcionesVigentesPorLead, elegirOpcionPrincipal, siguienteLetraOpcion,
  marcarOpcionAprobada,
  listarCotizacionesPorLead, crearCotizacion, actualizarCotizacion,
  escucharCotizacionesVigentes, crearServicioCatalogo,
  listarCatalogoDescripcion, crearOpcionCatalogoDescripcion,
  renombrarOpcionCatalogoDescripcion, cambiarEstadoOpcionCatalogoDescripcion,
  listarUsuariosStaff
} from './firestore.js';
import { mejorarSelect } from './components/dropdown-linence.js';
// El diseño de los documentos CT y DC vive en un solo archivo compartido
// con el módulo Documentación (js/documentos-cotizacion.js).
import { htmlCotizacion, htmlDescripcion, imprimirDocumentoPdf, nombreArchivoDocumento } from './documentos-cotizacion.js?v=17';

// ---------- Estado ----------

let STAFF_ACTUAL = null;
let serviciosCatalogo = [];
let catalogoDescripcionCompleto = []; // solo las opciones ACTIVAS del catálogo (checklist y selects)
let catalogoDescripcionTodo = [];     // todas (activas e inactivas), para "Gestionar opciones"
let usuariosStaffCotizacion = []; // para resolver leadActual.vendedorAsignado (uid) a un nombre
let cotizacionRowCounter = 0;
let leadActual = null;
let vigenteActual = null;   // null si esta opción todavía no está guardada
let opcionesLead = [];      // versión vigente de cada opción del lead
let opcionActual = 'A';     // letra de la opción que se está editando
let dejarDeEscuchar = null;

const CATEGORIAS_DESCRIPCION = ['materiales', 'herrajes', 'cubiertas', 'accesorios'];
const NOMBRES_CATEGORIA_DESCRIPCION = {
  materiales: 'Materiales', herrajes: 'Herrajes', cubiertas: 'Cubiertas', accesorios: 'Accesorios',
  // Catálogos de los selects de "Materiales y colores elegidos"
  elementos: 'Elemento', tiposMaterial: 'Material', acabados: 'Acabado', proveedores: 'Proveedor'
};
const CATEGORIAS_MATERIALES_COLORES = ['elementos', 'tiposMaterial', 'acabados', 'proveedores'];
let materialesColoresRowCounter = 0;

const parametrosURL = new URLSearchParams(window.location.search);
const leadId = parametrosURL.get('leadId');
const opcionDesdeURL = (parametrosURL.get('opcion') || '').toUpperCase().slice(0, 1);

// ---------- Referencias DOM ----------

const vistaLista = document.getElementById('vistaListaCotizaciones');
const vistaEditor = document.getElementById('vistaEditorCotizacion');
const tablaCotizacionesBody = document.getElementById('tablaCotizacionesBody');
const listaCotizacionesVacio = document.getElementById('listaCotizacionesVacio');

const editorClienteNombre = document.getElementById('editorClienteNombre');
const editorFolioVersion = document.getElementById('editorFolioVersion');
const cotizacionItemsBody = document.getElementById('cotizacionItemsBody');
const cotTotalGeneral = document.getElementById('cotTotalGeneral');
const cotDescuento = document.getElementById('cotDescuento');
const cotNeto = document.getElementById('cotNeto');
const cotAplicaIva = document.getElementById('cotAplicaIva');
const filaIva = document.getElementById('filaIva');
const cotIvaMonto = document.getElementById('cotIvaMonto');
const cotTotalFinal = document.getElementById('cotTotalFinal');
const cotPorcentajeAbono = document.getElementById('cotPorcentajeAbono');
const cotAbono = document.getElementById('cotAbono');
const cotizacionError = document.getElementById('cotizacionError');
const btnGuardarCotizacion = document.getElementById('btnGuardarCotizacion');
const btnGuardarNuevaVersion = document.getElementById('btnGuardarNuevaVersion');
const btnMarcarAprobada = document.getElementById('btnMarcarAprobada');
const cotDescripcionOpcion = document.getElementById('cotDescripcionOpcion');
const cotOpcionesBar = document.getElementById('cotOpcionesBar');

// Textos de entrada siempre en MAYÚSCULA (se convierte al escribir y al guardar).
function forzarMayusculasInput(el) {
  el.addEventListener('input', () => {
    const inicio = el.selectionStart;
    const fin = el.selectionEnd;
    const mayus = el.value.toLocaleUpperCase('es-CL');
    if (mayus !== el.value) {
      el.value = mayus;
      try { el.setSelectionRange(inicio, fin); } catch (_) { /* sin selección */ }
    }
  });
}
forzarMayusculasInput(cotDescripcionOpcion);
const btnDescargarPDF = document.getElementById('btnDescargarPDF');
const cotFechaEntregaInicio = document.getElementById('cotFechaEntregaInicio');
const cotFechaEntregaFin = document.getElementById('cotFechaEntregaFin');
const cotDiasHabilesEntrega = document.getElementById('cotDiasHabilesEntrega');
const cotValidaDesde = document.getElementById('cotValidaDesde');
const cotFormaPagoTodas = document.getElementById('cotFormaPagoTodas');
const cotFormaPagoChecks = Array.from(document.querySelectorAll('input[name="formaPagoOpt"]'));

/** Formas de pago marcadas, como texto "Transferencia, Depósito" (así se guarda y se imprime). */
function leerFormaPago() {
  return cotFormaPagoChecks.filter(c => c.checked).map(c => c.value).join(', ');
}
function escribirFormaPago(texto) {
  const marcadas = String(texto || '').split(',').map(x => x.trim()).filter(Boolean);
  cotFormaPagoChecks.forEach(c => { c.checked = marcadas.includes(c.value); });
  sincronizarTodasFormaPago();
}
function sincronizarTodasFormaPago() {
  cotFormaPagoTodas.checked = cotFormaPagoChecks.every(c => c.checked);
}
cotFormaPagoTodas.addEventListener('change', () => {
  cotFormaPagoChecks.forEach(c => { c.checked = cotFormaPagoTodas.checked; });
});
cotFormaPagoChecks.forEach(c => c.addEventListener('change', sincronizarTodasFormaPago));

// ── Fecha de entrega estimada: se calcula con fecha base + días hábiles (lun-vie, sin descontar feriados)
const MARGEN_DIAS_ENTREGA_FINAL = 3; // la fecha final = fecha inicial + 3 días corridos (editable a mano)

function fechaLocalISO(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

/** Suma N días hábiles (lunes a viernes) a una fecha "YYYY-MM-DD". */
function sumarDiasHabiles(fechaISO, dias) {
  const cursor = new Date(fechaISO + 'T00:00:00');
  let restantes = dias;
  while (restantes > 0) {
    cursor.setDate(cursor.getDate() + 1);
    const dia = cursor.getDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return cursor;
}

/** Recalcula "Entrega desde" y "Entrega hasta" a partir de la fecha base y los días hábiles. */
function recalcularFechaEntrega() {
  const base = cotValidaDesde.value; // "Válida desde" es también la fecha desde la que cuentan los días hábiles
  const dias = parseInt(cotDiasHabilesEntrega.value, 10);
  if (!base || isNaN(dias) || dias < 0) return;
  const inicio = sumarDiasHabiles(base, dias);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + MARGEN_DIAS_ENTREGA_FINAL);
  cotFechaEntregaInicio.value = fechaLocalISO(inicio);
  cotFechaEntregaFin.value = fechaLocalISO(fin);
}

cotDiasHabilesEntrega.addEventListener('input', () => {
  cotDiasHabilesEntrega.value = cotDiasHabilesEntrega.value.replace(/\D/g, '');
  recalcularFechaEntrega();
});
cotValidaDesde.addEventListener('change', recalcularFechaEntrega);
const cotVersionesAnteriores = document.getElementById('cotVersionesAnteriores');
const btnVerVersiones = document.getElementById('btnVerVersiones');
const listaVersionesAnteriores = document.getElementById('listaVersionesAnteriores');

const contenedoresChecklistDescripcion = {
  materiales: document.getElementById('cotDescMateriales'),
  herrajes: document.getElementById('cotDescHerrajes'),
  cubiertas: document.getElementById('cotDescCubiertas'),
  accesorios: document.getElementById('cotDescAccesorios')
};
const cotMcFilas = document.getElementById('cotMcFilas');
const cotDescResumenTexto = document.getElementById('cotDescResumenTexto');
const modalDescripcionCotizacion = document.getElementById('modalDescripcionCotizacion');
const btnEditarDescripcion = document.getElementById('btnEditarDescripcion');
const btnCerrarDescripcion = document.getElementById('btnCerrarDescripcion');

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

// Lista completa tal como llega de Firestore (en tiempo real). Los filtros y el
// orden solo cambian lo que se ve; nunca tocan los datos.
let listaCotizaciones = [];
const filtrosCot = { texto: '', estado: '', fecha: '' };
const ordenCot = { col: null, dir: 'asc' };

function inicializarLista() {
  dejarDeEscuchar = escucharCotizacionesVigentes(
    (cotizaciones) => { listaCotizaciones = cotizaciones; renderListaCotizaciones(); },
    () => mostrarToast('No se pudieron cargar las cotizaciones.', 'error')
  );
}

function normalizarBusqueda(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function valorOrdenCot(c, col) {
  switch (col) {
    case 'folio': return c.numero || '';
    case 'cliente': return c.clienteNombre || '';
    case 'proyecto': return c.proyecto || '';
    case 'total': return Number(c.totalGeneral) || 0;
    case 'abono': return Number(c.abono) || 0;
    case 'actualizada': return c.actualizadoEn?.toDate?.().getTime() || 0;
    default: return '';
  }
}

function cotizacionesVisibles() {
  const texto = normalizarBusqueda(filtrosCot.texto);
  const dias = Number(filtrosCot.fecha) || 0;
  const desde = dias ? Date.now() - dias * 24 * 60 * 60 * 1000 : 0;

  let lista = listaCotizaciones.filter((c) => {
    if (texto) {
      const pajar = normalizarBusqueda(`${c.numero || ''} ${c.clienteNombre || ''} ${c.proyecto || ''} ${c.descripcionOpcion || ''}`);
      if (!pajar.includes(texto)) return false;
    }
    if (filtrosCot.estado === 'aprobada' && !c.aprobada) return false;
    if (filtrosCot.estado === 'pendiente' && c.aprobada) return false;
    if (desde) {
      const t = c.actualizadoEn?.toDate?.().getTime() || 0;
      if (t < desde) return false;
    }
    return true;
  });

  if (ordenCot.col) {
    const factor = ordenCot.dir === 'asc' ? 1 : -1;
    lista = [...lista].sort((a, b) => {
      const va = valorOrdenCot(a, ordenCot.col);
      const vb = valorOrdenCot(b, ordenCot.col);
      if (typeof va === 'number') return factor * (va - vb);
      if (!va && !vb) return 0;
      if (!va) return 1;   // los vacíos siempre al final
      if (!vb) return -1;
      return factor * va.localeCompare(vb, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  return lista;
}

function actualizarControlesFiltroCot() {
  const fTexto = document.getElementById('filtroCotTexto');
  const fEstado = document.getElementById('filtroCotEstado');
  const fFecha = document.getElementById('filtroCotFecha');
  fTexto.classList.toggle('activo', !!filtrosCot.texto.trim());
  fEstado.classList.toggle('activo', !!filtrosCot.estado);
  fFecha.classList.toggle('activo', !!filtrosCot.fecha);
  document.getElementById('btnLimpiarFiltrosCot').style.display =
    (filtrosCot.texto.trim() || filtrosCot.estado || filtrosCot.fecha) ? '' : 'none';

  document.querySelectorAll('#vistaListaCotizaciones .cat-tabla thead th[data-col]').forEach((th) => {
    const activa = th.dataset.col === ordenCot.col;
    th.classList.toggle('orden-asc', activa && ordenCot.dir === 'asc');
    th.classList.toggle('orden-desc', activa && ordenCot.dir === 'desc');
    th.setAttribute('aria-sort', !activa ? 'none' : (ordenCot.dir === 'asc' ? 'ascending' : 'descending'));
  });
}

document.getElementById('filtroCotTexto').addEventListener('input', (e) => { filtrosCot.texto = e.target.value; renderListaCotizaciones(); });
document.getElementById('filtroCotEstado').addEventListener('change', (e) => { filtrosCot.estado = e.target.value; renderListaCotizaciones(); });
document.getElementById('filtroCotFecha').addEventListener('change', (e) => { filtrosCot.fecha = e.target.value; renderListaCotizaciones(); });
document.getElementById('btnLimpiarFiltrosCot').addEventListener('click', () => {
  filtrosCot.texto = filtrosCot.estado = filtrosCot.fecha = '';
  document.getElementById('filtroCotTexto').value = '';
  document.getElementById('filtroCotEstado').value = '';
  document.getElementById('filtroCotFecha').value = '';
  renderListaCotizaciones();
});

// Clic en una cabecera: primero ascendente, siguiente clic descendente, y así alternando.
document.querySelectorAll('#vistaListaCotizaciones .cat-orden').forEach((btn) => {
  btn.addEventListener('click', () => {
    const col = btn.dataset.orden;
    if (ordenCot.col === col) {
      ordenCot.dir = ordenCot.dir === 'asc' ? 'desc' : 'asc';
    } else {
      ordenCot.col = col;
      ordenCot.dir = 'asc';
    }
    renderListaCotizaciones();
  });
});

function renderListaCotizaciones() {
  tablaCotizacionesBody.innerHTML = '';
  actualizarControlesFiltroCot();

  const cotizaciones = cotizacionesVisibles();

  if (cotizaciones.length === 0) {
    listaCotizacionesVacio.textContent = listaCotizaciones.length === 0
      ? 'Aún no hay cotizaciones creadas. Crea una desde el detalle de un Lead en CRM.'
      : 'Ninguna cotización coincide con los filtros.';
    listaCotizacionesVacio.style.display = 'block';
    return;
  }
  listaCotizacionesVacio.style.display = 'none';

  // Cuántas opciones tiene cada lead: si tiene más de una, se muestra
  // la etiqueta de opción en todas sus filas.
  const opcionesPorLead = {};
  listaCotizaciones.forEach(c => { opcionesPorLead[c.leadId] = (opcionesPorLead[c.leadId] || 0) + 1; });

  cotizaciones.forEach((c) => {
    const opcion = c.opcion || 'A';
    const mostrarOpcion = opcionesPorLead[c.leadId] > 1 || !!c.descripcionOpcion;
    const etiquetaOpcion = mostrarOpcion
      ? `<div style="font-size:12px; color:#8a7a5a; margin-top:3px;">Opción ${escapeHtml(opcion)}${c.descripcionOpcion ? ' · ' + escapeHtml(c.descripcionOpcion) : ''}${c.aprobada ? ' · ✓ Aprobada' : ''}</div>`
      : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cat-codigo">${escapeHtml(c.numero)} <span class="cot-badge-version">v${c.version}</span></td>
      <td>${escapeHtml(c.clienteNombre || '—')}</td>
      <td>${escapeHtml(c.proyecto || '—')}${etiquetaOpcion}</td>
      <td>${formatearMoneda(c.totalGeneral)}</td>
      <td>${formatearMoneda(c.abono)}</td>
      <td>${formatearFecha(c.actualizadoEn)}</td>
      <td><a href="cotizaciones.html?leadId=${c.leadId}&opcion=${encodeURIComponent(opcion)}" class="cot-btn-ver">Ver / editar</a></td>
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
    await recargarCatalogoDescripcion();
    await asegurarCatalogoMaterialesColores();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo cargar el catálogo de la Descripción de Cotización.', 'error');
  }

  try {
    usuariosStaffCotizacion = await listarUsuariosStaff();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo cargar la lista de vendedores.', 'error');
  }

  leadActual = await obtenerLead(leadId);
  if (!leadActual) {
    mostrarToast('No se encontró ese lead.', 'error');
    editorClienteNombre.textContent = 'Lead no encontrado';
    return;
  }
  editorClienteNombre.textContent = leadActual.nombre || '—';

  mejorarSelect('#cotMcPlantilla');
  const plantillaDetectada = plantillaPorTipoProyecto(leadActual.tipoProyecto);
  if (plantillaDetectada) document.getElementById('cotMcPlantilla').value = plantillaDetectada;

  // Opción a editar: la que viene en la URL; si no viene, 'A' provisoriamente
  // y cargarCotizacionVigente() la reemplaza por la principal del lead.
  opcionActual = opcionDesdeURL || 'A';

  await cargarCotizacionVigente();
  cargarVersionesAnteriores();
}

async function cargarCotizacionVigente() {
  opcionesLead = await listarOpcionesVigentesPorLead(leadId);

  // Si la URL no trae opción, se abre la principal (aprobada o más reciente).
  if (!opcionDesdeURL && !vigenteActual) {
    const principal = elegirOpcionPrincipal(opcionesLead);
    if (principal) opcionActual = principal.opcion;
  }

  vigenteActual = opcionesLead.find(o => o.opcion === opcionActual) || null;

  // Opción nueva (todavía no guardada): arranca como copia de la principal,
  // para cambiar solo lo que difiere (cubierta, color, herrajes…).
  const base = vigenteActual || elegirOpcionPrincipal(opcionesLead);

  if (base) {
    renderFilas(base.items);
    cotDescuento.value = base.descuento ? formatearMilesInput(String(base.descuento)) : '';
    cotPorcentajeAbono.value = base.porcentajeAbono ?? '';
    cotAplicaIva.checked = !!base.aplicaIva;
    cotFechaEntregaInicio.value = base.fechaEntregaInicio || '';
    cotFechaEntregaFin.value = base.fechaEntregaFin || '';
    cotDiasHabilesEntrega.value = base.diasHabilesEntrega ?? '';
    escribirFormaPago(base.formaPago);
    cotValidaDesde.value = vigenteActual ? (base.validaDesde || '') : new Date().toISOString().slice(0, 10);
    renderChecklistDescripcionCompleto(base.descripcionCotizacion || {});
    renderMaterialesColores(base.materialesColores || []);
  } else {
    renderFilas([]);
    cotDescuento.value = '';
    cotPorcentajeAbono.value = '';
    cotAplicaIva.checked = false;
    cotFechaEntregaInicio.value = '';
    cotFechaEntregaFin.value = '';
    cotDiasHabilesEntrega.value = '';
    escribirFormaPago('');
    cotValidaDesde.value = new Date().toISOString().slice(0, 10);
    renderChecklistDescripcionCompleto({});
    renderMaterialesColores([]);
  }
  actualizarResumenDescripcion();

  cotDescripcionOpcion.value = vigenteActual?.descripcionOpcion || '';

  if (vigenteActual) {
    editorFolioVersion.textContent = `Opción ${opcionActual} · ${vigenteActual.numero} · versión ${vigenteActual.version}`;
    btnGuardarNuevaVersion.style.display = '';
    btnGuardarCotizacion.textContent = 'Guardar cambios';
  } else if (base) {
    editorFolioVersion.textContent = `Opción ${opcionActual} nueva — copia de la opción ${base.opcion}, se crea al guardar`;
    btnGuardarNuevaVersion.style.display = 'none';
    btnGuardarCotizacion.textContent = 'Guardar opción';
  } else {
    editorFolioVersion.textContent = 'Aún no tiene cotización — se creará como versión 1';
    btnGuardarNuevaVersion.style.display = 'none';
    btnGuardarCotizacion.textContent = 'Guardar cotización';
  }

  // La Descripción de Cotización es de ESTA opción: se rotula con su letra
  // para que siempre quede claro a cuál pertenece lo que se está marcando.
  const rotuloOpcion = (opcionesLead.length > 1 || opcionActual !== 'A') ? ` · Opción ${opcionActual}` : '';
  document.getElementById('cotDescTituloCard').textContent = `Descripción de Cotización${rotuloOpcion}`;
  document.getElementById('cotDescTituloModal').textContent = `Descripción de Cotización${rotuloOpcion}`;

  actualizarBotonAprobada();
  renderBarraOpciones();
  recalcularCotizacion();
}

/** Chips con las opciones del lead + acceso a "+ Nueva opción". */
function renderBarraOpciones() {
  if (opcionesLead.length === 0) {
    cotOpcionesBar.style.display = 'none';
    return;
  }
  const enlace = (letra) => `cotizaciones.html?leadId=${encodeURIComponent(leadId)}&opcion=${encodeURIComponent(letra)}`;

  const chips = opcionesLead.map(o => {
    const activa = o.opcion === opcionActual;
    const texto = `${o.aprobada ? '✓ ' : ''}${o.opcion}${o.descripcionOpcion ? ' · ' + o.descripcionOpcion : ''}`;
    return `<a href="${enlace(o.opcion)}" class="cot-chip-opcion${activa ? ' activa' : ''}">${escapeHtml(texto)}</a>`;
  });

  // Opción nueva aún sin guardar: se muestra como chip activo provisional.
  if (!vigenteActual) {
    chips.push(`<span class="cot-chip-opcion activa">${escapeHtml(opcionActual)} · nueva (sin guardar)</span>`);
  } else {
    chips.push(`<a href="${enlace(siguienteLetraOpcion(opcionesLead))}" class="cot-chip-opcion cot-chip-nueva">+ Nueva opción</a>`);
  }

  cotOpcionesBar.innerHTML = chips.join('');
  cotOpcionesBar.style.display = '';
}

/** El botón "Aprobada" solo tiene sentido si ya está guardada y hay más de una opción (o ya está aprobada). */
function actualizarBotonAprobada() {
  const visible = !!vigenteActual && (opcionesLead.length > 1 || !!vigenteActual.aprobada);
  btnMarcarAprobada.style.display = visible ? '' : 'none';
  btnMarcarAprobada.textContent = vigenteActual?.aprobada ? 'Quitar aprobación' : '✓ Marcar como aprobada';
}

btnMarcarAprobada.addEventListener('click', async () => {
  if (!vigenteActual) return;
  try {
    await marcarOpcionAprobada(leadId, vigenteActual.id, !vigenteActual.aprobada);
    mostrarToast(vigenteActual.aprobada ? 'Aprobación quitada.' : `Opción ${opcionActual} marcada como aprobada.`);
    await cargarCotizacionVigente();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo actualizar la aprobación.', 'error');
  }
});

async function cargarVersionesAnteriores() {
  const todas = await listarCotizacionesPorLead(leadId);
  // Historial de ESTA opción: la versión actual + las anteriores, para que
  // se vea que la V1 quedó guardada desde el primer guardado.
  const historial = todas.filter(c => (c.opcion || 'A') === opcionActual);

  if (historial.length === 0) {
    cotVersionesAnteriores.style.display = 'none';
    return;
  }

  const hayAnteriores = historial.some(c => c.estado !== 'vigente');
  cotVersionesAnteriores.style.display = '';
  btnVerVersiones.textContent = listaVersionesAnteriores.style.display === 'block'
    ? 'Ocultar historial de versiones'
    : 'Ver historial de versiones';
  listaVersionesAnteriores.innerHTML = historial.map(c => `
    <div class="cot-version-item">
      <span>${escapeHtml(c.numero)} · v${c.version}${c.estado === 'vigente' ? ' (actual)' : ''} — ${formatearFecha(c.actualizadoEn)}</span>
      <span>${formatearMoneda(c.totalGeneral)}</span>
    </div>
  `).join('') + (hayAnteriores ? '' : '<div class="cot-version-item"><span>Aún no hay versiones anteriores.</span></div>');
}

btnVerVersiones.addEventListener('click', () => {
  const visible = listaVersionesAnteriores.style.display === 'block';
  listaVersionesAnteriores.style.display = visible ? 'none' : 'block';
  btnVerVersiones.textContent = visible ? 'Ver historial de versiones' : 'Ocultar historial de versiones';
});

// ---------- Filas de la tabla ----------

function opcionesCodigoServicio(codigoSeleccionado) {
  const catalogoOrdenado = serviciosCatalogo.slice().sort((a, b) => a.codigo.localeCompare(b.codigo));
  const opciones = catalogoOrdenado.map(s =>
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
    <td class="cot-item-orden" style="text-align:center; white-space:nowrap;">
      <button type="button" class="cot-item-mover" data-dir="up" data-row-id="${rowId}" aria-label="Mover ítem arriba" style="display:block; width:26px; height:20px; line-height:18px; padding:0; margin:0 auto; border:1px solid #ddd; border-radius:4px 4px 0 0; background:#fff; cursor:pointer; font-size:11px;">▲</button>
      <button type="button" class="cot-item-mover" data-dir="down" data-row-id="${rowId}" aria-label="Mover ítem abajo" style="display:block; width:26px; height:20px; line-height:18px; padding:0; margin:0 auto; border:1px solid #ddd; border-top:none; border-radius:0 0 4px 4px; background:#fff; cursor:pointer; font-size:11px;">▼</button>
    </td>
    <td><select id="cotCod_${rowId}" class="cot-item-codigo">${opcionesCodigoServicio(item.codigo)}</select></td>
    <td><input type="text" id="cotDesc_${rowId}" class="cot-item-descripcion" placeholder="Descripción" value="${escapeHtml(item.descripcion || '')}"></td>
    <td><input type="text" id="cotCant_${rowId}" class="cot-item-cantidad" placeholder="Ej. 7,40" value="${escapeHtml(item.cantidad || '')}"></td>
    <td><input type="text" id="cotVU_${rowId}" class="cot-item-valor-unitario-input" inputmode="numeric" placeholder="$0" value="${item.valorUnitario ? formatearMilesInput(String(item.valorUnitario)) : ''}"></td>
    <td><span class="cot-item-total" id="cotTotal_${rowId}">$0</span></td>
    <td><button type="button" class="cot-item-eliminar" data-row-id="${rowId}" aria-label="Eliminar fila">✕</button></td>
  `;
  cotizacionItemsBody.appendChild(tr);

  mejorarSelect(`#cotCod_${rowId}`, { buscar: true, placeholderBuscar: 'Buscar por código o nombre…' });

  const selCodigo = document.getElementById(`cotCod_${rowId}`);

  // El botón del código muestra solo el comienzo del texto (el resto se oculta con "…"):
  // al pasar el mouse por encima se ve el nombre completo del servicio.
  const actualizarTituloCodigo = () => {
    const trigger = selCodigo.closest('td')?.querySelector('.ln-dropdown-trigger');
    if (trigger) trigger.title = selCodigo.options[selCodigo.selectedIndex]?.text || '';
  };
  actualizarTituloCodigo();
  selCodigo.addEventListener('change', actualizarTituloCodigo);

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

  forzarMayusculasInput(inpDesc);
  inpDesc.addEventListener('input', recalcularCotizacion);
  activarFormatoCantidad(inpCant);
  inpCant.addEventListener('input', () => { actualizarTotalFila(rowId); recalcularCotizacion(); });
  activarFormatoMiles(inpVU);
  inpVU.addEventListener('input', () => { actualizarTotalFila(rowId); recalcularCotizacion(); });

  actualizarTotalFila(rowId);
  actualizarBotonesOrden();
}

/** Deshabilita ▲ en la primera fila y ▼ en la última, para que se note visualmente el límite. */
function actualizarBotonesOrden() {
  const filas = [...cotizacionItemsBody.querySelectorAll('tr')];
  filas.forEach((tr, i) => {
    const btnArriba = tr.querySelector('.cot-item-mover[data-dir="up"]');
    const btnAbajo = tr.querySelector('.cot-item-mover[data-dir="down"]');
    if (btnArriba) btnArriba.disabled = (i === 0);
    if (btnAbajo) btnAbajo.disabled = (i === filas.length - 1);
  });
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
  const btnEliminar = e.target.closest('.cot-item-eliminar');
  if (btnEliminar) {
    if (cotizacionItemsBody.querySelectorAll('tr').length === 1) {
      renderFilas([]);
      recalcularCotizacion();
      return;
    }
    btnEliminar.closest('tr').remove();
    actualizarBotonesOrden();
    recalcularCotizacion();
    return;
  }

  const btnMover = e.target.closest('.cot-item-mover');
  if (btnMover) {
    const tr = btnMover.closest('tr');
    if (btnMover.dataset.dir === 'up') {
      const anterior = tr.previousElementSibling;
      if (anterior) tr.parentNode.insertBefore(tr, anterior);
    } else {
      const siguiente = tr.nextElementSibling;
      if (siguiente) tr.parentNode.insertBefore(siguiente, tr);
    }
    actualizarBotonesOrden();
    recalcularCotizacion();
  }
});

// ---------- Secciones plegables del modal de Descripción (flechita) ----------
function alternarSeccionDescripcion(header) {
  const seccion = header.closest('.cot-desc-seccion');
  const colapsada = seccion.classList.toggle('colapsada');
  header.setAttribute('aria-expanded', String(!colapsada));
}
document.querySelectorAll('.cot-sec-header').forEach(header => {
  header.addEventListener('click', () => alternarSeccionDescripcion(header));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      alternarSeccionDescripcion(header);
    }
  });
});

// ---------- Materiales y colores elegidos ----------
// Una fila por elemento del mueble: Elemento (select) + Material (select) + Color (texto libre).
// Los selects salen del catálogo editable (colección catalogoDescripcion, categorías
// 'elementos' y 'tiposMaterial'). En la cotización se guardan como texto
// (materialesColores: [{ elemento, material, color }]), así el documento no depende de
// que una opción del catálogo se desactive más adelante.

const ELEMENTOS_INICIALES = ['Mueble aéreo', 'Mueble base', 'Cubierta'];
const MATERIALES_INICIALES = ['Melamina', 'Postformado', 'Cuarzo'];
const ACABADOS_INICIALES = ['Mate', 'Brillante', 'Texturizado', 'Liso'];

// Filas sugeridas según el tipo de proyecto: solo dejan listos los elementos
// (María completa material, color, acabado y código). Si falta alguno en el
// catálogo de Elemento, se crea al cargar la plantilla.
const PLANTILLAS_MATERIALES_COLORES = {
  cocina: ['Mueble base', 'Mueble aéreo', 'Cubierta'],
  closet: ['Estructura interna', 'Puertas y frentes'],
  bano: ['Estructura y frentes', 'Cubierta'],
  entretenimiento: ['Fondo de TV', 'Mueble base', 'Repisas'],
  office: ['Cubierta de escritorio', 'Cajoneras'],
  logia: ['Módulos superiores e inferiores', 'Cubierta']
};

// Nombres originales que el sistema usa en "Cargar filas sugeridas". Si María renombra
// una de estas opciones, se guarda su nombre original en el campo `clave` para que las
// filas sugeridas la sigan encontrando con el nombre nuevo.
const CLAVES_SUGERIDAS = new Set([...ELEMENTOS_INICIALES, ...Object.values(PLANTILLAS_MATERIALES_COLORES).flat()]);

/** Carga TODO el catálogo; los selects y el checklist usan solo las activas. */
async function recargarCatalogoDescripcion() {
  catalogoDescripcionTodo = await listarCatalogoDescripcion();
  catalogoDescripcionCompleto = catalogoDescripcionTodo.filter(o => o.activo !== false);
}

/** La primera vez (catálogo vacío) deja listas las opciones básicas; después se agregan con "+ Elemento" / "+ Material". */
async function asegurarCatalogoMaterialesColores() {
  let huboCambios = false;
  const sembrar = async (categoria, nombres) => {
    // Se mira el catálogo completo: si María desactivó todo lo de una categoría, no se vuelve a sembrar.
    if (catalogoDescripcionTodo.some(o => o.categoria === categoria)) return;
    for (const nombre of nombres) {
      await crearOpcionCatalogoDescripcion({ categoria, nombre, ...(categoria === 'elementos' ? { clave: nombre } : {}) });
    }
    huboCambios = true;
  };
  await sembrar('elementos', ELEMENTOS_INICIALES);
  await sembrar('tiposMaterial', MATERIALES_INICIALES);
  await sembrar('acabados', ACABADOS_INICIALES);
  if (huboCambios) await recargarCatalogoDescripcion();
}

function opcionesSelectMc(categoria, seleccionado) {
  const nombres = catalogoDescripcionCompleto.filter(o => o.categoria === categoria).map(o => o.nombre);
  // Si la opción guardada ya no está activa en el catálogo, se muestra igual para no perder el dato.
  if (seleccionado && !nombres.includes(seleccionado)) nombres.push(seleccionado);
  const opciones = nombres.map(n =>
    `<option value="${escapeHtml(n)}" ${n === seleccionado ? 'selected' : ''}>${escapeHtml(n)}</option>`
  ).join('');
  return `<option value="">Selecciona…</option>${opciones}`;
}

function agregarFilaMaterialColor(fila = {}) {
  const id = materialesColoresRowCounter++;
  const div = document.createElement('div');
  div.className = 'cot-mc-fila';
  div.dataset.mcId = id;
  div.innerHTML = `
    <div class="cot-mc-campo">
      <label for="cotMcEl_${id}">Elemento</label>
      <select id="cotMcEl_${id}">${opcionesSelectMc('elementos', fila.elemento)}</select>
    </div>
    <div class="cot-mc-campo">
      <label for="cotMcMat_${id}">Material</label>
      <select id="cotMcMat_${id}">${opcionesSelectMc('tiposMaterial', fila.material)}</select>
    </div>
    <div class="cot-mc-campo">
      <label for="cotMcAcab_${id}">Acabado <span style="font-weight:400; color:#8a7a5a;">(opcional)</span></label>
      <select id="cotMcAcab_${id}">${opcionesSelectMc('acabados', fila.acabado)}</select>
    </div>
    <button type="button" class="cot-mc-eliminar" data-mc-id="${id}" aria-label="Quitar fila">✕</button>
    <div class="cot-mc-campo">
      <label for="cotMcCol_${id}">Color</label>
      <input type="text" id="cotMcCol_${id}" placeholder="Ej: ARCILLA" value="${escapeHtml(fila.color || '')}">
    </div>
    <div class="cot-mc-campo">
      <label for="cotMcCod_${id}">Código <span style="font-weight:400; color:#8a7a5a;">(opcional)</span></label>
      <input type="text" id="cotMcCod_${id}" placeholder="Ej: código del color" value="${escapeHtml(fila.codigo || '')}">
    </div>
    <div class="cot-mc-campo">
      <label for="cotMcProv_${id}">Proveedor <span style="font-weight:400; color:#8a7a5a;">(opcional)</span></label>
      <select id="cotMcProv_${id}">${opcionesSelectMc('proveedores', fila.proveedor)}</select>
    </div>
  `;
  cotMcFilas.appendChild(div);

  mejorarSelect(`#cotMcEl_${id}`);
  mejorarSelect(`#cotMcMat_${id}`);
  mejorarSelect(`#cotMcAcab_${id}`);
  mejorarSelect(`#cotMcProv_${id}`);
  forzarMayusculasInput(document.getElementById(`cotMcCol_${id}`));
  forzarMayusculasInput(document.getElementById(`cotMcCod_${id}`));

}

/** Dibuja las filas guardadas; si no hay ninguna, deja una vacía lista para llenar. */
function renderMaterialesColores(filas = []) {
  cotMcFilas.innerHTML = '';
  materialesColoresRowCounter = 0;
  const lista = filas.length ? filas : [{}];
  lista.forEach(f => agregarFilaMaterialColor(f));
}

/** Lee las filas del bloque, sin las que están completamente vacías. */
function leerMaterialesColoresCrudo() {
  return [...cotMcFilas.querySelectorAll('.cot-mc-fila')].map(div => {
    const id = div.dataset.mcId;
    return {
      elemento: document.getElementById(`cotMcEl_${id}`).value,
      material: document.getElementById(`cotMcMat_${id}`).value,
      color: document.getElementById(`cotMcCol_${id}`).value.trim().toLocaleUpperCase('es-CL'),
      acabado: document.getElementById(`cotMcAcab_${id}`).value,
      codigo: document.getElementById(`cotMcCod_${id}`).value.trim().toLocaleUpperCase('es-CL'),
      proveedor: document.getElementById(`cotMcProv_${id}`).value
    };
  }).filter(f => f.elemento || f.material || f.color || f.acabado || f.codigo || f.proveedor);
}

function validarMaterialesColores(filas) {
  const incompleta = filas.some(f => !f.elemento || !f.material || !f.color);
  return incompleta
    ? 'En "Materiales y colores elegidos" hay una fila incompleta: completa elemento, material y color, o quita la fila (Editar selección).'
    : null;
}

// ---------- Gestionar opciones (renombrar / activar / desactivar) ----------

const modalGestionarOpciones = document.getElementById('modalGestionarOpciones');
const gestionListas = document.getElementById('gestionListas');
const gestionError = document.getElementById('gestionError');
const CAMPO_FILA_POR_CATEGORIA = { elementos: 'elemento', tiposMaterial: 'material', acabados: 'acabado', proveedores: 'proveedor' };

function normalizarNombre(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function renderGestionOpciones() {
  gestionListas.innerHTML = CATEGORIAS_MATERIALES_COLORES.map(categoria => {
    const opciones = catalogoDescripcionTodo.filter(o => o.categoria === categoria);
    const filas = opciones.length ? opciones.map(o => `
      <div class="cot-gest-fila ${o.activo === false ? 'inactiva' : ''}" data-id="${o.id}" data-cat="${categoria}" data-original="${escapeHtml(o.nombre)}">
        <input type="text" class="cot-gest-nombre" value="${escapeHtml(o.nombre)}" aria-label="Nombre de la opción">
        <button type="button" class="cot-gest-guardar" disabled>Guardar</button>
        <label class="cot-gest-activo"><input type="checkbox" ${o.activo === false ? '' : 'checked'}> Activo</label>
      </div>
    `).join('') : '<p class="cot-desc-vacio">Aún no hay opciones.</p>';
    return `<div class="cot-gest-seccion"><div class="cot-gest-titulo">${NOMBRES_CATEGORIA_DESCRIPCION[categoria]}</div>${filas}</div>`;
  }).join('');
}

function mostrarErrorGestion(texto) {
  gestionError.textContent = texto || '';
  gestionError.classList.toggle('visible', !!texto);
}

/** Vuelve a leer el catálogo y a dibujar los selects del bloque conservando lo ya escrito (con un reemplazo de nombre opcional). */
async function refrescarTrasGestion(reemplazo) {
  const filasActuales = leerMaterialesColoresCrudo();
  if (reemplazo) {
    filasActuales.forEach(f => {
      if (f[reemplazo.campo] === reemplazo.viejo) f[reemplazo.campo] = reemplazo.nuevo;
    });
  }
  await recargarCatalogoDescripcion();
  renderMaterialesColores(filasActuales);
  renderGestionOpciones();
  actualizarResumenDescripcion();
}

document.getElementById('btnGestionarOpciones').addEventListener('click', () => {
  mostrarErrorGestion('');
  renderGestionOpciones();
  modalGestionarOpciones.style.display = 'flex';
});
document.getElementById('btnCerrarGestion').addEventListener('click', () => {
  modalGestionarOpciones.style.display = 'none';
});

gestionListas.addEventListener('input', (e) => {
  const input = e.target.closest('.cot-gest-nombre');
  if (!input) return;
  const fila = input.closest('.cot-gest-fila');
  fila.querySelector('.cot-gest-guardar').disabled = input.value.trim() === fila.dataset.original || !input.value.trim();
});

gestionListas.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.closest('.cot-gest-nombre')) return;
  e.preventDefault();
  const boton = e.target.closest('.cot-gest-fila').querySelector('.cot-gest-guardar');
  if (!boton.disabled) boton.click();
});

gestionListas.addEventListener('click', async (e) => {
  const boton = e.target.closest('.cot-gest-guardar');
  if (!boton || boton.disabled) return;
  const fila = boton.closest('.cot-gest-fila');
  const { id, cat: categoria, original } = fila.dataset;
  const nuevo = fila.querySelector('.cot-gest-nombre').value.trim();
  mostrarErrorGestion('');

  const repetido = catalogoDescripcionTodo.some(o =>
    o.categoria === categoria && o.id !== id && normalizarNombre(o.nombre) === normalizarNombre(nuevo));
  if (repetido) {
    mostrarErrorGestion(`Ya existe una opción llamada "${nuevo}" en ${NOMBRES_CATEGORIA_DESCRIPCION[categoria]}.`);
    return;
  }

  try {
    const doc = catalogoDescripcionTodo.find(o => o.id === id);
    const clave = (!doc?.clave && CLAVES_SUGERIDAS.has(doc?.nombre)) ? doc.nombre : undefined;
    await renombrarOpcionCatalogoDescripcion(id, nuevo, clave);
    await refrescarTrasGestion({ campo: CAMPO_FILA_POR_CATEGORIA[categoria], viejo: original, nuevo });
    mostrarToast(`Renombrado a "${nuevo}".`);
  } catch (err) {
    console.error(err);
    mostrarErrorGestion('No se pudo guardar el cambio. Intenta de nuevo.');
  }
});

gestionListas.addEventListener('change', async (e) => {
  const check = e.target.closest('.cot-gest-activo input');
  if (!check) return;
  const { id } = check.closest('.cot-gest-fila').dataset;
  mostrarErrorGestion('');
  try {
    await cambiarEstadoOpcionCatalogoDescripcion(id, check.checked);
    await refrescarTrasGestion();
  } catch (err) {
    console.error(err);
    check.checked = !check.checked;
    mostrarErrorGestion('No se pudo cambiar el estado. Intenta de nuevo.');
  }
});

/** Adivina la plantilla a partir del texto libre de "tipo de proyecto" del lead. */
function plantillaPorTipoProyecto(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/cocina/.test(t)) return 'cocina';
  if (/closet|vestidor|walk/.test(t)) return 'closet';
  if (/bano|vanitorio|vanity/.test(t)) return 'bano';
  if (/entretenimiento|\btv\b|living|rack/.test(t)) return 'entretenimiento';
  if (/escritorio|office|oficina/.test(t)) return 'office';
  if (/logia|lavander/.test(t)) return 'logia';
  return null;
}

/** Agrega las filas sugeridas que falten (no pisa ni duplica lo que ya está escrito). */
async function cargarFilasSugeridas() {
  const clavePlantilla = document.getElementById('cotMcPlantilla').value;
  const nombresBase = PLANTILLAS_MATERIALES_COLORES[clavePlantilla] || [];
  const encontrar = (n) => catalogoDescripcionTodo.find(o => o.categoria === 'elementos' && (o.clave === n || o.nombre === n));
  try {
    const faltantes = nombresBase.filter(n => !encontrar(n));
    for (const nombre of faltantes) {
      await crearOpcionCatalogoDescripcion({ categoria: 'elementos', nombre, clave: nombre });
    }
    if (faltantes.length) await recargarCatalogoDescripcion();
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudieron agregar algunos elementos al catálogo.', 'error');
  }

  // Se usa el nombre actual de cada opción (por si fue renombrada) y se omiten las desactivadas.
  const elementos = nombresBase
    .map(encontrar)
    .filter(o => o && o.activo !== false)
    .map(o => o.nombre);

  const actuales = leerMaterialesColoresCrudo();
  const yaEstan = new Set(actuales.map(f => f.elemento));
  const nuevas = elementos.filter(n => !yaEstan.has(n)).map(n => ({ elemento: n }));
  if (!nuevas.length) {
    mostrarToast('Esos elementos ya están en la lista.', 'info');
    return;
  }
  renderMaterialesColores([...actuales, ...nuevas]);
  actualizarResumenDescripcion();
  mostrarToast('Filas sugeridas cargadas. Completa material y color.');
}

document.getElementById('btnCargarSugeridas').addEventListener('click', cargarFilasSugeridas);

document.getElementById('btnAgregarFilaMc').addEventListener('click', () => {
  agregarFilaMaterialColor();
  actualizarResumenDescripcion();
});

cotMcFilas.addEventListener('click', (e) => {
  const btn = e.target.closest('.cot-mc-eliminar');
  if (!btn) return;
  btn.closest('.cot-mc-fila').remove();
  actualizarResumenDescripcion();
});
cotMcFilas.addEventListener('change', () => actualizarResumenDescripcion());
cotMcFilas.addEventListener('input', () => actualizarResumenDescripcion());

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

/** Texto tipo "3 materiales · 5 herrajes seleccionados", solo con lo que tiene marcas. */
function actualizarResumenDescripcion() {
  const seleccion = leerDescripcionCotizacion();
  const partes = CATEGORIAS_DESCRIPCION
    .filter(categoria => seleccion[categoria].length > 0)
    .map(categoria => `${seleccion[categoria].length} ${NOMBRES_CATEGORIA_DESCRIPCION[categoria].toLowerCase()}`);
  const cantidadColores = leerMaterialesColoresCrudo().length;
  if (cantidadColores) {
    partes.unshift(`${cantidadColores} ${cantidadColores === 1 ? 'elemento con color' : 'elementos con color'}`);
  }
  cotDescResumenTexto.textContent = partes.length
    ? `${partes.join(' · ')} seleccionados.`
    : 'Sin opciones marcadas aún.';
}

// El checklist se vuelve a dibujar completo cada vez que cambia la
// selección o se agrega una opción nueva (innerHTML), así que se
// delega el evento "change" al contenedor del modal en vez de
// engancharlo a cada checkbox por separado.
document.querySelector('.cot-desc-modal-scroll').addEventListener('change', (e) => {
  if (e.target.matches('input[type="checkbox"]')) actualizarResumenDescripcion();
});

btnEditarDescripcion.addEventListener('click', () => {
  modalDescripcionCotizacion.classList.add('visible');
});
btnCerrarDescripcion.addEventListener('click', () => {
  modalDescripcionCotizacion.classList.remove('visible');
});
modalDescripcionCotizacion.addEventListener('click', (e) => {
  if (e.target === modalDescripcionCotizacion) modalDescripcionCotizacion.classList.remove('visible');
});

// ---------- Modal: nueva opción del catálogo de Descripción ----------

let categoriaNuevaOpcion = null;
const modalNuevaOpcionDescripcion = document.getElementById('modalNuevaOpcionDescripcion');
const nuevaOpcionTitulo = document.getElementById('nuevaOpcionTitulo');
const nuevaOpcionNombre = document.getElementById('nuevaOpcionNombre');
const nuevaOpcionError = document.getElementById('nuevaOpcionError');

document.querySelectorAll('.cot-btn-agregar-opcion[data-categoria]').forEach(btn => {
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
    if (CATEGORIAS_MATERIALES_COLORES.includes(categoriaNuevaOpcion)) {
      // Opción para los selects de "Materiales y colores elegidos": se vuelven a dibujar
      // las filas con lo que ya estaba escrito, así el select nuevo aparece en todas.
      const filasActuales = leerMaterialesColoresCrudo();
      await crearOpcionCatalogoDescripcion({ categoria: categoriaNuevaOpcion, nombre });
      await recargarCatalogoDescripcion();
      renderMaterialesColores(filasActuales);
    } else {
      const seleccionActual = leerDescripcionCotizacion();
      const nuevoId = await crearOpcionCatalogoDescripcion({ categoria: categoriaNuevaOpcion, nombre });
      await recargarCatalogoDescripcion();
      seleccionActual[categoriaNuevaOpcion].push(nuevoId);
      renderChecklistDescripcionCategoria(categoriaNuevaOpcion, seleccionActual[categoriaNuevaOpcion]);
    }
    actualizarResumenDescripcion();
    modalNuevaOpcionDescripcion.style.display = 'none';
    mostrarToast(`"${nombre}" agregado al catálogo.`);
  } catch (err) {
    console.error(err);
    nuevaOpcionError.textContent = 'Ocurrió un error al guardar. Intenta de nuevo.';
    nuevaOpcionError.classList.add('visible');
  }
});

activarFormatoMiles(cotDescuento);
cotDescuento.addEventListener('input', recalcularCotizacion);

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
      descripcion: document.getElementById(`cotDesc_${rowId}`).value.trim().toLocaleUpperCase('es-CL'),
      cantidad,
      valorUnitario,
      total
    };
  }).filter(item => item.descripcion || item.total);
}

function recalcularCotizacion() {
  const items = leerItemsCotizacion();

  const proyecto = items.map(i => i.descripcion).filter(Boolean).join(', ');

  const monto = items.reduce((suma, i) => suma + (i.total || 0), 0);
  cotTotalGeneral.textContent = formatearMoneda(monto);

  const descuento = parsearMonto(cotDescuento.value);
  const neto = Math.max(0, monto - descuento);
  cotNeto.textContent = formatearMoneda(neto);

  // El I.V.A. y el Total se calculan sobre el Neto (Monto ya descontado), no sobre el Monto.
  const aplicaIva = cotAplicaIva.checked;
  const ivaMonto = aplicaIva ? Math.round(neto * 0.19) : 0;
  const total = neto + ivaMonto;

  filaIva.style.display = aplicaIva ? '' : 'none';
  cotIvaMonto.textContent = formatearMoneda(ivaMonto);
  cotTotalFinal.textContent = formatearMoneda(total);

  const porcentaje = parseInt(cotPorcentajeAbono.value, 10) || 0;
  const abono = Math.round(total * (porcentaje / 100));
  cotAbono.textContent = formatearMoneda(abono);

  return { proyecto, items, monto, descuento, neto, aplicaIva, ivaMonto, total, porcentaje, abono };
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
  const { proyecto, items, monto, descuento, neto, aplicaIva, ivaMonto, total, porcentaje, abono } = recalcularCotizacion();

  cotizacionError.textContent = '';
  cotizacionError.classList.remove('visible');

  const errorValidacion = validarCotizacion(items);
  if (errorValidacion) {
    cotizacionError.textContent = errorValidacion;
    cotizacionError.classList.add('visible');
    return;
  }

  const materialesColores = leerMaterialesColoresCrudo();
  const errorMateriales = validarMaterialesColores(materialesColores);
  if (errorMateriales) {
    cotizacionError.textContent = errorMateriales;
    cotizacionError.classList.add('visible');
    return;
  }

  const datos = {
    // totalGeneral y totalConIva mantienen su nombre de campo en Firestore
    // (se usan en otros módulos), aunque ahora "Monto" y "Total" se llaman
    // distinto en la interfaz.
    proyecto, items, totalGeneral: monto,
    descuento, neto,
    aplicaIva, ivaMonto, totalConIva: total,
    porcentajeAbono: porcentaje, abono,
    clienteNombre: (leadActual.nombre || '').toLocaleUpperCase('es-CL'),
    fechaEntregaInicio: cotFechaEntregaInicio.value,
    fechaEntregaFin: cotFechaEntregaFin.value,
    diasHabilesEntrega: cotDiasHabilesEntrega.value === '' ? null : parseInt(cotDiasHabilesEntrega.value, 10),
    formaPago: leerFormaPago(),
    validaDesde: cotValidaDesde.value,
    descripcionCotizacion: leerDescripcionCotizacion(),
    materialesColores,
    descripcionOpcion: cotDescripcionOpcion.value.trim().toLocaleUpperCase('es-CL')
  };

  // Con más de una opción, cada una necesita su descripción para poder distinguirlas.
  const variasOpciones = opcionesLead.length > 1 || opcionActual !== 'A';
  if (variasOpciones && !datos.descripcionOpcion) {
    cotizacionError.textContent = 'Escribe una descripción para esta opción (ej. "Cubierta de cuarzo") para poder distinguirla de las otras.';
    cotizacionError.classList.add('visible');
    cotDescripcionOpcion.focus();
    return;
  }

  try {
    if (!vigenteActual || comoNuevaVersion) {
      await crearCotizacion(leadId, leadActual.canalOrigen, datos, STAFF_ACTUAL.uid, opcionActual);
      mostrarToast(comoNuevaVersion ? 'Nueva versión creada.' : (opcionActual === 'A' && opcionesLead.length === 0 ? 'Cotización creada como versión 1.' : `Opción ${opcionActual} creada como versión 1.`));
      // Deja la opción en la URL, para que al recargar siga en la misma.
      history.replaceState(null, '', `cotizaciones.html?leadId=${encodeURIComponent(leadId)}&opcion=${encodeURIComponent(opcionActual)}`);
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

// Mismo estilo de dropdown de marca que el resto del panel (ver #cotFormaPago).
mejorarSelect('#nuevoCodigoCategoria');
mejorarSelect('#nuevoCodigoTipo');

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
  imprimirDocumentoPdf(document.getElementById('plantillaPDF'), nombreArchivoCotizacion('Cotización'));
});

document.getElementById('btnDescargarPdfModal').addEventListener('click', () => {
  // Pasado a impresión nativa del navegador, igual que en Documentación:
  // html2pdf.js cortaba contenido y dejaba saltos en blanco en
  // documentos de varias páginas sin poder reproducirlo/depurarlo acá.
  // El diálogo de impresión con destino "Guardar como PDF" usa la
  // paginación real del navegador.
  mostrarToast('Elige "Guardar como PDF" en el destino de impresión.', 'info');
  imprimirDocumentoPdf(document.getElementById('plantillaPDF'), nombreArchivoCotizacion('Cotización'));
});

/** Nombre sugerido del PDF: "Cotización · Patricia Rivera · V2 · LINENCE". */
function nombreArchivoCotizacion(documento) {
  return nombreArchivoDocumento({
    documento,
    cliente: leadActual?.nombre,
    version: vigenteActual?.version
  });
}

/** Resuelve leadActual.vendedorAsignado (uid) a un nombre, igual que nombreVendedor() en crm.js. */
function nombreVendedorPorUid(uid) {
  if (!uid) return '—';
  const u = usuariosStaffCotizacion.find(u => u.uid === uid);
  return u ? (u.nombre || uid) : '—';
}

/** El lead guarda vendedorAsignado como uid; la plantilla necesita el nombre ya resuelto. */
function clienteParaPlantilla(lead) {
  return { ...lead, vendedorNombre: nombreVendedorPorUid(lead?.vendedorAsignado) };
}

function llenarPlantillaPDF(cotizacion, lead) {
  // Mismo documento que genera el módulo Documentación: sale de js/documentos-cotizacion.js
  document.getElementById('plantillaPDF').innerHTML = htmlCotizacion({ cotizacion, cliente: clienteParaPlantilla(lead) });
}

// ---------- Descargar Descripción de Cotización (documento DC) ----------
// Mismo folio que la cotización (CT-XXX-00000 -> DC-XXX-00000) y misma
// fuente de datos: lo que quedó marcado en el checklist de esta
// cotización guardada. Es el mismo documento que aparece en el
// módulo Documentación (comparten el catálogo y el formato).

const modalPdfDescripcion = document.getElementById('modalPdfDescripcion');

function llenarPlantillaDC(cotizacion, lead) {
  document.getElementById('plantillaDC').innerHTML = htmlDescripcion({
    cotizacion,
    cliente: clienteParaPlantilla(lead),
    catalogo: catalogoDescripcionCompleto
  });
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
  imprimirDocumentoPdf(document.getElementById('plantillaDC'), nombreArchivoCotizacion('Descripción de la Cotización'));
});

document.getElementById('btnDescargarDCModal').addEventListener('click', () => {
  mostrarToast('Elige "Guardar como PDF" en el destino de impresión.', 'info');
  imprimirDocumentoPdf(document.getElementById('plantillaDC'), nombreArchivoCotizacion('Descripción de la Cotización'));
});
