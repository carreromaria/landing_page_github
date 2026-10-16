// ============================================================
// LINENCE — Reportes
// Lógica de la pantalla reportes.html
// ============================================================
// Hoy: leads por canal de origen y cuántos terminan ganados.
// Todo se calcula con los leads reales del CRM; no hay datos de ejemplo.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import { listarLeads } from './firestore.js';

// Mismos canales del CRM (crm.js). Si se agrega un canal nuevo allá, agregarlo aquí.
const CANALES = {
  REF: 'Landing page',
  SWR: 'Showroom',
  WSP: 'WhatsApp',
  INS: 'Instagram',
  FAC: 'Facebook',
  TIK: 'TikTok'
};

const MIN_LEADS_PARA_COMPARAR = 3;

let todosLosLeads = [];

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const porcentaje = (parte, total) => total ? Math.round((parte / total) * 100) : 0;
const plural = (n, singular, pluralTxt) => `${n} ${n === 1 ? singular : pluralTxt}`;

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
  cargar();
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

// ---------- Datos ----------

async function cargar() {
  try {
    todosLosLeads = await listarLeads();
    document.getElementById('repCargando').style.display = 'none';
    document.getElementById('repContenido').style.display = '';
    render();
  } catch (err) {
    console.error(err);
    document.getElementById('repCargando').textContent = 'No pudimos cargar los datos. Intenta recargar la página.';
  }
}

/** Filtra los leads por la fecha en que se crearon, según el período elegido. */
function leadsDelPeriodo() {
  const periodo = document.getElementById('filtroPeriodo').value;
  if (periodo === 'todo') return todosLosLeads;

  const ahora = new Date();
  let desde;
  if (periodo === 'mes') desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  else if (periodo === 'anio') desde = new Date(ahora.getFullYear(), 0, 1);
  else desde = new Date(ahora.getTime() - Number(periodo) * 24 * 60 * 60 * 1000);

  return todosLosLeads.filter(l => {
    const fecha = l.creadoEn?.toDate ? l.creadoEn.toDate() : null;
    return fecha && fecha >= desde;
  });
}

function resumenPorCanal(leads) {
  const mapa = {};
  leads.forEach(l => {
    const clave = l.canalOrigen || 'SIN';
    mapa[clave] = mapa[clave] || { clave, total: 0, ganados: 0, perdidos: 0 };
    mapa[clave].total++;
    if (l.etapa === 'Ganado') mapa[clave].ganados++;
    if (l.etapa === 'Perdido') mapa[clave].perdidos++;
  });
  return Object.values(mapa).sort((a, b) => b.total - a.total || b.ganados - a.ganados);
}

const nombreCanal = (clave) => CANALES[clave] || (clave === 'SIN' ? 'Sin canal' : clave);

// ---------- Render ----------

function render() {
  const leads = leadsDelPeriodo();
  const total = leads.length;
  const ganados = leads.filter(l => l.etapa === 'Ganado').length;
  const perdidos = leads.filter(l => l.etapa === 'Perdido').length;
  const enCurso = total - ganados - perdidos;

  document.getElementById('repKpis').innerHTML = [
    { valor: total, etiqueta: 'Leads recibidos' },
    { valor: ganados, etiqueta: 'Ganados' },
    { valor: enCurso, etiqueta: 'En curso' },
    { valor: perdidos, etiqueta: 'Perdidos' },
    { valor: total ? `${porcentaje(ganados, total)}%` : '—', etiqueta: 'Conversión (ganados / leads)', destacado: true }
  ].map(k => `
    <div class="rep-kpi${k.destacado ? ' destacado' : ''}">
      <div class="valor">${k.valor}</div>
      <div class="etiqueta">${k.etiqueta}</div>
    </div>`).join('');

  const canales = resumenPorCanal(leads);
  const contenedor = document.getElementById('repCanales');
  const vacio = document.getElementById('repVacio');
  const lectura = document.getElementById('repLecturaWrap');

  if (!canales.length) {
    contenedor.innerHTML = '';
    vacio.style.display = 'block';
    lectura.style.display = 'none';
    return;
  }
  vacio.style.display = 'none';

  const maximo = canales[0].total;
  contenedor.innerHTML = canales.map(c => `
    <div class="rep-canal">
      <div class="rep-canal-nombre">${escapar(nombreCanal(c.clave))}</div>
      <div class="rep-barra" title="${escapar(nombreCanal(c.clave))}: ${plural(c.total, 'lead', 'leads')}, ${plural(c.ganados, 'ganado', 'ganados')}">
        <div class="rep-barra-leads" style="width:${(c.total / maximo) * 100}%;">
          <div class="rep-barra-ganados" style="width:${porcentaje(c.ganados, c.total)}%;"></div>
        </div>
      </div>
      <div class="rep-canal-cifras">
        <strong>${plural(c.total, 'lead', 'leads')}</strong> · ${plural(c.ganados, 'ganado', 'ganados')}<br>
        <span class="conv">Conversión ${porcentaje(c.ganados, c.total)}%</span>
      </div>
    </div>`).join('');

  renderLectura(canales, total);
}

/** Frases calculadas con los datos reales; nada se inventa. */
function renderLectura(canales, total) {
  const frases = [];

  const mas = canales[0];
  frases.push(`<strong>Más leads:</strong> ${escapar(nombreCanal(mas.clave))}, con ${plural(mas.total, 'lead', 'leads')} (${porcentaje(mas.total, total)}% del total).`);

  const comparables = canales.filter(c => c.total >= MIN_LEADS_PARA_COMPARAR);
  if (comparables.length >= 2) {
    const mejor = [...comparables].sort((a, b) => (b.ganados / b.total) - (a.ganados / a.total) || b.total - a.total)[0];
    if (mejor.ganados > 0) {
      frases.push(`<strong>Mejor conversión:</strong> ${escapar(nombreCanal(mejor.clave))}, con ${porcentaje(mejor.ganados, mejor.total)}% (${mejor.ganados} de ${mejor.total}).`);
    } else {
      frases.push('<strong>Mejor conversión:</strong> todavía ningún canal con suficientes leads tiene ganados en este período.');
    }
  } else {
    frases.push(`<strong>Mejor conversión:</strong> aún hay pocos leads por canal para comparar (se necesitan al menos ${MIN_LEADS_PARA_COMPARAR} en dos canales).`);
  }

  document.getElementById('repLectura').innerHTML = frases.map(f => `<li>${f}</li>`).join('');
  document.getElementById('repLecturaWrap').style.display = '';
}

document.getElementById('filtroPeriodo').addEventListener('change', render);
