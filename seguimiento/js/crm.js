// ============================================================
// LINENCE — CRM
// Lógica del tablero de leads (crm.html)
// ============================================================
// Reutiliza la misma capa de autenticación (auth.js) y de datos
// (firestore.js) que ya usa el resto del panel interno. No duplica
// nada de eso: solo agrega lo específico del CRM.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  crearLead, escucharLeads, actualizarLead, agregarNotaLead,
  cambiarEtapaLead, marcarLeadGanado, marcarLeadPerdido,
  listarUsuariosStaff, eliminarLead, crearProyectoConCodigoAutomatico
} from './firestore.js';
import { generarToken } from './utils.js';

// ---------- Configuración del pipeline ----------

const ETAPAS = [
  "Nuevo contacto",
  "En conversación",
  "Propuesta enviada",
  "Negociación",
  "Ganado",
  "Perdido"
];

const CANALES = {
  REF: "LANDING PAGE-REF",
  SWR: "SHOWROOM-SWR",
  WSP: "WHATSAPP-WSP",
  INS: "INSTAGRAM-INS",
  FAC: "FACEBOOK-FAC",
  TIK: "TIKTOK-TIK"
};

const DIAS_ALERTA_SIN_CONTACTO = 3;

/** Igual que en dashboard.js: arma el código visible, ej. CT-WSP-00004. */
function construirCodigoCotizacion(numero, prefijoCanal) {
  if (!numero || !prefijoCanal) return '';
  return `CT-${prefijoCanal}-${numero.padStart(5, '0')}`;
}

function actualizarPreviewCotizacion(prefijo) {
  const numInput = document.getElementById(prefijo + 'NumCotizacion');
  const canalSelect = document.getElementById(prefijo + 'Canal');
  const preview = document.getElementById(prefijo + 'CotizacionPreview');
  if (!numInput || !canalSelect || !preview) return;
  const codigo = construirCodigoCotizacion(numInput.value.trim(), canalSelect.value);
  preview.textContent = codigo ? `Se verá como: ${codigo}` : 'Se verá como: CT-XXX-00000';
}

function activarSoloDigitosCotizacion(inputEl) {
  inputEl.addEventListener('input', () => {
    inputEl.value = inputEl.value.replace(/\D/g, '').slice(0, 5);
  });
}

['l', 'e'].forEach(prefijo => {
  const numInput = document.getElementById(prefijo + 'NumCotizacion');
  const canalSelect = document.getElementById(prefijo + 'Canal');
  activarSoloDigitosCotizacion(numInput);
  numInput.addEventListener('input', () => actualizarPreviewCotizacion(prefijo));
  canalSelect.addEventListener('change', () => actualizarPreviewCotizacion(prefijo));
});

// ---------- Estado ----------

let STAFF_ACTUAL = null;
let usuariosStaff = [];
let leadsActuales = [];
let leadSeleccionadoId = null;
let dejarDeEscucharLeads = null;

// ---------- Referencias DOM ----------

const dashCargando = document.getElementById('dashCargando');
const dashLayout = document.getElementById('dashLayout');
const dashTopbarMobile = document.getElementById('dashTopbarMobile');
const staffNombreEl = document.getElementById('staffNombre');
const staffRolEl = document.getElementById('staffRol');

const vistaKanban = document.getElementById('vistaKanban');
const vistaDetalleLead = document.getElementById('vistaDetalleLead');
const crmKanban = document.getElementById('crmKanban');

const buscadorLead = document.getElementById('buscadorLead');
const filtroCanal = document.getElementById('filtroCanal');
const filtroVendedor = document.getElementById('filtroVendedor');

const toastContainer = document.getElementById('toastContainer');

// ---------- Guardia de sesión (mismo patrón que dashboard.html) ----------

observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  STAFF_ACTUAL = staff;
  staffNombreEl.textContent = staff.nombre || '—';
  staffRolEl.textContent = staff.rol || '—';

  dashCargando.style.display = 'none';
  dashLayout.style.display = '';
  actualizarVisibilidadTopbar();

  inicializar();
});

function actualizarVisibilidadTopbar() {
  dashTopbarMobile.style.display = window.innerWidth <= 900 ? 'flex' : 'none';
}
window.addEventListener('resize', actualizarVisibilidadTopbar);

// ---------- Sidebar mobile ----------

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

document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Toast simple ----------

// Estilos en línea a propósito: así el toast nunca depende de que
// dashboard.css no tenga ya una regla .toast con su propia animación
// (que es justo lo que estaba pasando antes).
toastContainer.style.cssText = `
  position:fixed; top:24px; right:24px; z-index:999999;
  display:flex; flex-direction:column; gap:8px; pointer-events:none;
`;

function mostrarToast(mensaje, tipo = 'ok') {
  const el = document.createElement('div');
  el.textContent = mensaje;
  el.style.cssText = `
    background:${tipo === 'error' ? '#c14b32' : '#141213'};
    color:#faf7f2;
    font-family:'Poppins', sans-serif;
    font-size:13.5px;
    padding:12px 18px;
    border-radius:8px;
    box-shadow:0 10px 26px rgba(20,18,19,0.28);
    border-left:3px solid #d6a52c;
    opacity:1;
    transform:translateY(0);
    transition:opacity .25s ease, transform .25s ease;
    pointer-events:auto;
  `;
  toastContainer.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 300);
  }, 7000);
}

// ---------- Inicialización ----------

async function inicializar() {
  try {
    usuariosStaff = await listarUsuariosStaff();
    poblarSelectsVendedor();
  } catch (err) {
    console.error('Error cargando staff:', err);
  }

  dejarDeEscucharLeads = escucharLeads(
    (leads) => { leadsActuales = leads; renderKanban(); },
    () => mostrarToast('No se pudieron cargar los leads.', 'error')
  );
}

function poblarSelectsVendedor() {
  const opciones = usuariosStaff
    .map(u => `<option value="${u.uid}">${escapeHtml(u.nombre || u.uid)}</option>`)
    .join('');
  filtroVendedor.insertAdjacentHTML('beforeend', opciones);
  document.getElementById('lVendedor').insertAdjacentHTML('beforeend', opciones);
  document.getElementById('eVendedor').insertAdjacentHTML('beforeend', opciones);
}

function nombreVendedor(uid) {
  if (!uid) return '—';
  const u = usuariosStaff.find(u => u.uid === uid);
  return u ? (u.nombre || uid) : '—';
}

// ---------- Utilidades ----------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatearPresupuesto(valor) {
  if (!valor && valor !== 0) return '—';
  return '$' + Number(valor).toLocaleString('es-CL');
}

function diasSinContacto(lead) {
  const fecha = lead.fechaUltimoContacto?.toDate?.() || lead.creadoEn?.toDate?.();
  if (!fecha) return null;
  const ms = Date.now() - fecha.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------- Filtros ----------

function leadsFiltrados() {
  const texto = buscadorLead.value.trim().toLowerCase();
  const canal = filtroCanal.value;
  const vendedor = filtroVendedor.value;

  return leadsActuales.filter(lead => {
    if (canal && lead.canalOrigen !== canal) return false;
    if (vendedor && lead.vendedorAsignado !== vendedor) return false;
    if (texto) {
      const enNombre = (lead.nombre || '').toLowerCase().includes(texto);
      const enTelefono = (lead.telefono || '').toLowerCase().includes(texto);
      if (!enNombre && !enTelefono) return false;
    }
    return true;
  });
}

[buscadorLead, filtroCanal, filtroVendedor].forEach(el => {
  el.addEventListener('input', renderKanban);
});

// ---------- Render del tablero ----------

function renderKanban() {
  const leads = leadsFiltrados();

  crmKanban.innerHTML = ETAPAS.map(etapa => {
    const leadsEtapa = leads.filter(l => l.etapa === etapa);
    const tarjetas = leadsEtapa.length
      ? leadsEtapa.map(tarjetaHtml).join('')
      : `<p class="crm-vacio-columna">Sin leads aquí.</p>`;

    return `
      <div class="crm-columna">
        <div class="crm-columna-titulo">
          <span>${etapa}</span>
          <span class="crm-columna-contador">· ${leadsEtapa.length}</span>
        </div>
        ${tarjetas}
      </div>
    `;
  }).join('');

  crmKanban.querySelectorAll('[data-lead-id]').forEach(card => {
    card.addEventListener('click', () => abrirDetalleLead(card.dataset.leadId));
  });
}

function tarjetaHtml(lead) {
  const dias = diasSinContacto(lead);
  const esCierre = lead.etapa === 'Ganado' || lead.etapa === 'Perdido';
  const claseCierre = lead.etapa === 'Ganado' ? 'es-ganado' : lead.etapa === 'Perdido' ? 'es-perdido' : '';
  const alertaClase = (!esCierre && dias !== null && dias >= DIAS_ALERTA_SIN_CONTACTO) ? 'alerta' : '';

  let tiempoTexto = '—';
  if (lead.etapa === 'Ganado' && lead.proyectoVinculado) {
    tiempoTexto = `${escapeHtml(lead.proyectoVinculado)} vinculado`;
  } else if (dias !== null) {
    tiempoTexto = dias === 0 ? 'hoy' : `hace ${dias} día${dias === 1 ? '' : 's'}`;
  }

  return `
    <div class="crm-card ${claseCierre}" data-lead-id="${lead.id}" tabindex="0">
      <div class="crm-card-nombre">${escapeHtml(lead.nombre)}</div>
      <div class="crm-card-meta">${escapeHtml(lead.tipoProyecto || '—')} · ${CANALES[lead.canalOrigen] || lead.canalOrigen || '—'}</div>
      <div class="crm-card-tiempo ${alertaClase}">${tiempoTexto}</div>
    </div>
  `;
}

// ---------- Vista de detalle ----------

function abrirDetalleLead(id) {
  const lead = leadsActuales.find(l => l.id === id);
  if (!lead) return;

  leadSeleccionadoId = id;

  document.getElementById('detalleEtapaBadge').textContent = lead.etapa;
  document.getElementById('detalleNombre').textContent = lead.nombre;
  document.getElementById('detalleMetaProyecto').textContent =
    `${lead.tipoProyecto || '—'} · ${CANALES[lead.canalOrigen] || lead.canalOrigen || '—'}`;
  document.getElementById('detallePresupuesto').textContent = formatearPresupuesto(lead.presupuestoEstimado);
  document.getElementById('detalleVendedor').textContent = nombreVendedor(lead.vendedorAsignado);
  document.getElementById('detalleNumCotizacion').textContent =
    construirCodigoCotizacion(lead.numCotizacion, lead.canalOrigen) || (lead.numCotizacion || '—');
  document.getElementById('detalleTelefono').textContent = lead.telefono || '—';
  document.getElementById('detalleEmail').textContent = lead.email || '—';

  const proyectoVinculadoEl = document.getElementById('detalleProyectoVinculado');
  if (lead.proyectoVinculado) {
    proyectoVinculadoEl.style.display = '';
    proyectoVinculadoEl.textContent = `Vinculado a ${lead.proyectoVinculado} en Seguimiento`;
  } else {
    proyectoVinculadoEl.style.display = 'none';
  }

  const selectEtapaWrap = document.querySelector('.crm-select-etapa-wrap');
  const esCierre = lead.etapa === 'Ganado' || lead.etapa === 'Perdido';
  selectEtapaWrap.style.display = esCierre ? 'none' : '';
  marcarEtapaSeleccionada(esCierre ? 'Nuevo contacto' : lead.etapa);

  document.getElementById('accionesCierre').style.display = esCierre ? 'none' : '';

  const zonaEliminar = document.getElementById('zonaEliminarLead');
  zonaEliminar.style.display = (STAFF_ACTUAL?.rol === 'admin') ? '' : 'none';
  document.getElementById('nombreConfirmacionLead').textContent = lead.nombre;
  document.getElementById('pasoUnoEliminarLead').style.display = '';
  document.getElementById('pasoDosEliminarLead').style.display = 'none';
  document.getElementById('inputConfirmacionNombreLead').value = '';
  document.getElementById('eliminarLeadError').textContent = '';
  document.getElementById('eliminarLeadError').classList.remove('visible');
  document.getElementById('btnConfirmarEliminacionLead').disabled = true;

  renderNotas(lead.notas || []);

  vistaKanban.style.display = 'none';
  vistaDetalleLead.style.display = '';
  vistaDetalleLead.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNotas(notas) {
  const lista = document.getElementById('listaNotas');
  const vacio = document.getElementById('notasVacio');

  if (!notas.length) {
    lista.innerHTML = '';
    vacio.style.display = '';
    return;
  }
  vacio.style.display = 'none';

  const ordenadas = [...notas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  lista.innerHTML = ordenadas.map(n => `
    <div class="crm-nota">
      <div class="crm-nota-texto">${escapeHtml(n.texto)}</div>
      <div class="crm-nota-meta">${escapeHtml(n.autor || '—')} · ${formatearFechaNota(n.fecha)}</div>
    </div>
  `).join('');
}

function formatearFechaNota(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

document.getElementById('btnVolverKanban').addEventListener('click', () => {
  leadSeleccionadoId = null;
  vistaDetalleLead.style.display = 'none';
  vistaKanban.style.display = '';
});

// ---------- Dropdown propio: cambiar etapa ----------

const dropdownEtapa = document.getElementById('dropdownEtapa');
const dropdownEtapaTrigger = document.getElementById('dropdownEtapaTrigger');
const dropdownEtapaLista = document.getElementById('dropdownEtapaLista');
const dropdownEtapaValor = document.getElementById('dropdownEtapaValor');

function marcarEtapaSeleccionada(etapa) {
  dropdownEtapaLista.querySelectorAll('li').forEach(li => {
    li.classList.toggle('seleccionado', li.dataset.valor === etapa);
  });
}

function abrirDropdownEtapa() {
  dropdownEtapaLista.hidden = false;
  dropdownEtapa.classList.add('abierto');
  dropdownEtapaTrigger.setAttribute('aria-expanded', 'true');
}
function cerrarDropdownEtapa() {
  dropdownEtapaLista.hidden = true;
  dropdownEtapa.classList.remove('abierto');
  dropdownEtapaTrigger.setAttribute('aria-expanded', 'false');
}

dropdownEtapaTrigger.addEventListener('click', () => {
  dropdownEtapaLista.hidden ? abrirDropdownEtapa() : cerrarDropdownEtapa();
});

document.addEventListener('click', (e) => {
  if (!dropdownEtapa.contains(e.target)) cerrarDropdownEtapa();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarDropdownEtapa();
});

dropdownEtapaLista.addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-valor]');
  if (!li || !leadSeleccionadoId) return;

  const nuevaEtapa = li.dataset.valor;
  cerrarDropdownEtapa();
  marcarEtapaSeleccionada(nuevaEtapa);
  document.getElementById('detalleEtapaBadge').textContent = nuevaEtapa;

  try {
    await cambiarEtapaLead(leadSeleccionadoId, nuevaEtapa);
    mostrarToast(`Etapa actualizada a "${nuevaEtapa}".`);
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo cambiar la etapa.', 'error');
  }
});

document.getElementById('btnAgregarNota').addEventListener('click', async () => {
  const input = document.getElementById('inputNuevaNota');
  const texto = input.value.trim();
  if (!texto || !leadSeleccionadoId) return;

  try {
    await agregarNotaLead(leadSeleccionadoId, { texto, autor: STAFF_ACTUAL.nombre || '' });
    input.value = '';
    mostrarToast('Nota agregada.');
  } catch (err) {
    console.error(err);
    mostrarToast('No se pudo agregar la nota.', 'error');
  }
});

// ---------- Modal: nuevo lead ----------

const modalNuevoLead = document.getElementById('modalNuevoLead');
const formNuevoLead = document.getElementById('formNuevoLead');

document.getElementById('btnNuevoLead').addEventListener('click', () => {
  formNuevoLead.reset();
  document.getElementById('modalLeadError').textContent = '';
  document.getElementById('modalLeadError').classList.remove('visible');
  document.getElementById('lCotizacionPreview').textContent = 'Se verá como: CT-XXX-00000';
  modalNuevoLead.classList.add('visible');
});
document.getElementById('btnCancelarNuevoLead').addEventListener('click', () => {
  modalNuevoLead.classList.remove('visible');
});

formNuevoLead.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('modalLeadError');
  errorEl.textContent = '';
  errorEl.classList.remove('visible');

  const datos = {
    nombre: document.getElementById('lNombre').value.trim(),
    telefono: document.getElementById('lTelefono').value.trim(),
    email: document.getElementById('lEmail').value.trim(),
    canalOrigen: document.getElementById('lCanal').value,
    tipoProyecto: document.getElementById('lTipoProyecto').value.trim(),
    presupuestoEstimado: document.getElementById('lPresupuesto').value
      ? Number(document.getElementById('lPresupuesto').value) : null,
    vendedorAsignado: document.getElementById('lVendedor').value || null,
    numCotizacion: document.getElementById('lNumCotizacion').value.trim(),
    notaInicial: document.getElementById('lNotaInicial').value.trim(),
    creadoPorNombre: STAFF_ACTUAL?.nombre || ''
  };

  if (!datos.nombre || !datos.canalOrigen || !datos.tipoProyecto) {
    errorEl.textContent = 'Completa nombre, canal de origen y tipo de proyecto.';
    errorEl.classList.add('visible');
    return;
  }

  if (datos.numCotizacion && datos.numCotizacion.length !== 5) {
    errorEl.textContent = 'El N° de cotización debe tener exactamente 5 dígitos.';
    errorEl.classList.add('visible');
    return;
  }

  try {
    await crearLead(datos, STAFF_ACTUAL.uid);
    modalNuevoLead.classList.remove('visible');
    mostrarToast('Lead creado.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo crear el lead. Intenta de nuevo.';
    errorEl.classList.add('visible');
  }
});

// ---------- Modal: editar datos del lead ----------

const modalEditarLead = document.getElementById('modalEditarLead');
const formEditarLead = document.getElementById('formEditarLead');

document.getElementById('btnEditarLead').addEventListener('click', () => {
  const lead = leadsActuales.find(l => l.id === leadSeleccionadoId);
  if (!lead) return;

  document.getElementById('eNombre').value = lead.nombre || '';
  document.getElementById('eTelefono').value = lead.telefono || '';
  document.getElementById('eEmail').value = lead.email || '';
  document.getElementById('eCanal').value = lead.canalOrigen || '';
  document.getElementById('eTipoProyecto').value = lead.tipoProyecto || '';
  document.getElementById('ePresupuesto').value = lead.presupuestoEstimado ?? '';
  document.getElementById('eVendedor').value = lead.vendedorAsignado || '';
  document.getElementById('eNumCotizacion').value = lead.numCotizacion || '';
  actualizarPreviewCotizacion('e');
  document.getElementById('modalEditarError').textContent = '';
  document.getElementById('modalEditarError').classList.remove('visible');

  modalEditarLead.classList.add('visible');
});

document.getElementById('btnCancelarEditarLead').addEventListener('click', () => {
  modalEditarLead.classList.remove('visible');
});

formEditarLead.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('modalEditarError');
  errorEl.textContent = '';
  errorEl.classList.remove('visible');

  const datos = {
    nombre: document.getElementById('eNombre').value.trim(),
    telefono: document.getElementById('eTelefono').value.trim(),
    email: document.getElementById('eEmail').value.trim(),
    canalOrigen: document.getElementById('eCanal').value,
    tipoProyecto: document.getElementById('eTipoProyecto').value.trim(),
    presupuestoEstimado: document.getElementById('ePresupuesto').value
      ? Number(document.getElementById('ePresupuesto').value) : null,
    vendedorAsignado: document.getElementById('eVendedor').value || null,
    numCotizacion: document.getElementById('eNumCotizacion').value.trim()
  };

  if (!datos.nombre || !datos.canalOrigen || !datos.tipoProyecto) {
    errorEl.textContent = 'Completa nombre, canal de origen y tipo de proyecto.';
    errorEl.classList.add('visible');
    return;
  }

  if (datos.numCotizacion && datos.numCotizacion.length !== 5) {
    errorEl.textContent = 'El N° de cotización debe tener exactamente 5 dígitos.';
    errorEl.classList.add('visible');
    return;
  }

  try {
    await actualizarLead(leadSeleccionadoId, datos);
    modalEditarLead.classList.remove('visible');
    abrirDetalleLead(leadSeleccionadoId);
    mostrarToast('Datos actualizados.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
    errorEl.classList.add('visible');
  }
});

// ---------- Modal: marcar ganado ----------

const modalGanado = document.getElementById('modalGanado');

document.getElementById('btnMarcarGanado').addEventListener('click', () => {
  document.getElementById('ganadoError').textContent = '';
  document.getElementById('ganadoError').classList.remove('visible');
  modalGanado.classList.add('visible');
});
document.getElementById('btnCancelarGanado').addEventListener('click', () => {
  modalGanado.classList.remove('visible');
});

/**
 * Arma el objeto de un proyecto nuevo a partir de un lead, con el mismo
 * formato que usa el formulario manual "Nuevo proyecto" de Seguimiento
 * (mismos nombres de campo, mismas mayúsculas). RUT y dirección quedan
 * vacíos a propósito: se completan después directo en Seguimiento.
 */
/**
 * Seguimiento guarda "responsable" como el NOMBRE del staff (no su uid;
 * ver poblarSelectResponsable en dashboard.js). El CRM en cambio guarda
 * vendedorAsignado como uid (lo necesita para el select y los filtros).
 * Esta función traduce uid → nombre antes de crear el proyecto.
 */
function nombreResponsableDesdeLead(lead) {
  const staff = usuariosStaff.find(u => u.uid === lead.vendedorAsignado);
  if (staff) return staff.nombre || staff.email || '';
  return STAFF_ACTUAL.nombre || STAFF_ACTUAL.email || '';
}

function armarProyectoDesdeLead(lead) {
  return {
    cliente: (lead.nombre || '').toUpperCase(),
    rut: '',
    telefono: lead.telefono || '',
    email: (lead.email || '').toUpperCase(),
    tipoProyecto: (lead.tipoProyecto || '').toUpperCase(),
    categoria: 'Bronce',
    cantidadProyectosCliente: 1,
    responsable: nombreResponsableDesdeLead(lead),
    direccion: { region: '', comuna: '', calle: '', numero: '', depto: '', sector: '', indicaciones: '' },
    fechaEstimadaInicio: null,
    fechaEstimadaFin: null,
    canalOrigen: lead.canalOrigen || '',
    numCotizacion: lead.numCotizacion || '',
    codigoCotizacion: construirCodigoCotizacion(lead.numCotizacion, lead.canalOrigen),
    observaciones: 'CREADO AUTOMÁTICAMENTE DESDE CRM.',
    token: generarToken()
  };
}

document.getElementById('btnConfirmarGanado').addEventListener('click', async () => {
  const errorEl = document.getElementById('ganadoError');
  const btn = document.getElementById('btnConfirmarGanado');
  const lead = leadsActuales.find(l => l.id === leadSeleccionadoId);
  if (!lead) return;

  errorEl.textContent = '';
  errorEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Creando…';

  try {
    const datosProyecto = armarProyectoDesdeLead(lead);
    const codigo = await crearProyectoConCodigoAutomatico(datosProyecto, STAFF_ACTUAL.uid);
    await marcarLeadGanado(leadSeleccionadoId, codigo);

    modalGanado.classList.remove('visible');
    vistaDetalleLead.style.display = 'none';
    vistaKanban.style.display = '';
    mostrarToast(`Proyecto ${codigo} creado. Lead marcado como ganado.`);
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo crear el proyecto. Intenta de nuevo.';
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear proyecto y marcar ganado';
  }
});


// ---------- Modal: marcar perdido ----------

const modalPerdido = document.getElementById('modalPerdido');

document.getElementById('btnMarcarPerdido').addEventListener('click', () => {
  document.getElementById('inputMotivoPerdido').value = '';
  document.getElementById('perdidoError').textContent = '';
  document.getElementById('perdidoError').classList.remove('visible');
  modalPerdido.classList.add('visible');
});
document.getElementById('btnCancelarPerdido').addEventListener('click', () => {
  modalPerdido.classList.remove('visible');
});

document.getElementById('btnConfirmarPerdido').addEventListener('click', async () => {
  const errorEl = document.getElementById('perdidoError');
  const motivo = document.getElementById('inputMotivoPerdido').value.trim();

  if (!motivo) {
    errorEl.textContent = 'Cuéntanos brevemente el motivo.';
    errorEl.classList.add('visible');
    return;
  }

  try {
    await marcarLeadPerdido(leadSeleccionadoId, motivo);
    modalPerdido.classList.remove('visible');
    vistaDetalleLead.style.display = 'none';
    vistaKanban.style.display = '';
    mostrarToast('Lead marcado como perdido.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
    errorEl.classList.add('visible');
  }
});

// ---------- Eliminar lead (solo admin) ----------

document.getElementById('btnIniciarEliminacionLead').addEventListener('click', () => {
  document.getElementById('pasoUnoEliminarLead').style.display = 'none';
  document.getElementById('pasoDosEliminarLead').style.display = '';
});

document.getElementById('btnCancelarEliminacionLead').addEventListener('click', () => {
  document.getElementById('pasoDosEliminarLead').style.display = 'none';
  document.getElementById('pasoUnoEliminarLead').style.display = '';
});

document.getElementById('inputConfirmacionNombreLead').addEventListener('input', (e) => {
  const lead = leadsActuales.find(l => l.id === leadSeleccionadoId);
  const coincide = lead && e.target.value.trim() === lead.nombre;
  document.getElementById('btnConfirmarEliminacionLead').disabled = !coincide;
});

document.getElementById('btnConfirmarEliminacionLead').addEventListener('click', async () => {
  const errorEl = document.getElementById('eliminarLeadError');
  try {
    await eliminarLead(leadSeleccionadoId);
    leadSeleccionadoId = null;
    vistaDetalleLead.style.display = 'none';
    vistaKanban.style.display = '';
    mostrarToast('Lead eliminado.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo eliminar. Verifica que tengas permisos de administrador.';
    errorEl.classList.add('visible');
  }
});
