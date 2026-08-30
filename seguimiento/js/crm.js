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
  listarUsuariosStaff
} from './firestore.js';

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
  INS: "Instagram",
  FAC: "Facebook",
  TIK: "TikTok",
  WSP: "WhatsApp",
  REF: "Formulario web",
  PRS: "Showroom"
};

const DIAS_ALERTA_SIN_CONTACTO = 3;

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

function mostrarToast(mensaje, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = mensaje;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
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
  document.getElementById('detalleTelefono').textContent = lead.telefono || '—';
  document.getElementById('detalleEmail').textContent = lead.email || '—';

  const proyectoVinculadoEl = document.getElementById('detalleProyectoVinculado');
  if (lead.proyectoVinculado) {
    proyectoVinculadoEl.style.display = '';
    proyectoVinculadoEl.textContent = `Vinculado a ${lead.proyectoVinculado} en Seguimiento`;
  } else {
    proyectoVinculadoEl.style.display = 'none';
  }

  const selectEtapa = document.getElementById('selectEtapaLead');
  const esCierre = lead.etapa === 'Ganado' || lead.etapa === 'Perdido';
  selectEtapa.style.display = esCierre ? 'none' : '';
  selectEtapa.value = esCierre ? 'Nuevo contacto' : lead.etapa;

  document.getElementById('accionesCierre').style.display = esCierre ? 'none' : '';

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

document.getElementById('selectEtapaLead').addEventListener('change', async (e) => {
  if (!leadSeleccionadoId) return;
  try {
    await cambiarEtapaLead(leadSeleccionadoId, e.target.value);
    mostrarToast('Etapa actualizada.');
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
  modalNuevoLead.classList.add('visible');
});
document.getElementById('btnCancelarNuevoLead').addEventListener('click', () => {
  modalNuevoLead.classList.remove('visible');
});

formNuevoLead.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('modalLeadError');
  errorEl.textContent = '';

  const datos = {
    nombre: document.getElementById('lNombre').value.trim(),
    telefono: document.getElementById('lTelefono').value.trim(),
    email: document.getElementById('lEmail').value.trim(),
    canalOrigen: document.getElementById('lCanal').value,
    tipoProyecto: document.getElementById('lTipoProyecto').value.trim(),
    presupuestoEstimado: document.getElementById('lPresupuesto').value
      ? Number(document.getElementById('lPresupuesto').value) : null,
    vendedorAsignado: document.getElementById('lVendedor').value || null,
    notaInicial: document.getElementById('lNotaInicial').value.trim(),
    creadoPorNombre: STAFF_ACTUAL?.nombre || ''
  };

  if (!datos.nombre || !datos.canalOrigen || !datos.tipoProyecto) {
    errorEl.textContent = 'Completa nombre, canal de origen y tipo de proyecto.';
    return;
  }

  try {
    await crearLead(datos, STAFF_ACTUAL.uid);
    modalNuevoLead.classList.remove('visible');
    mostrarToast('Lead creado.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo crear el lead. Intenta de nuevo.';
  }
});

// ---------- Modal: marcar ganado ----------

const modalGanado = document.getElementById('modalGanado');

document.getElementById('btnMarcarGanado').addEventListener('click', () => {
  document.getElementById('inputCodigoProyecto').value = '';
  document.getElementById('ganadoError').textContent = '';
  modalGanado.classList.add('visible');
});
document.getElementById('btnCancelarGanado').addEventListener('click', () => {
  modalGanado.classList.remove('visible');
});

document.getElementById('btnConfirmarGanado').addEventListener('click', async () => {
  const errorEl = document.getElementById('ganadoError');
  const codigo = document.getElementById('inputCodigoProyecto').value.trim().toUpperCase();

  if (!/^LIN-\d{4,5}$/.test(codigo)) {
    errorEl.textContent = 'Ingresa un código válido, ej. LIN-00006.';
    return;
  }

  try {
    await marcarLeadGanado(leadSeleccionadoId, codigo);
    modalGanado.classList.remove('visible');
    vistaDetalleLead.style.display = 'none';
    vistaKanban.style.display = '';
    mostrarToast('Lead marcado como ganado.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  }
});

// ---------- Modal: marcar perdido ----------

const modalPerdido = document.getElementById('modalPerdido');

document.getElementById('btnMarcarPerdido').addEventListener('click', () => {
  document.getElementById('inputMotivoPerdido').value = '';
  document.getElementById('perdidoError').textContent = '';
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
  }
});
