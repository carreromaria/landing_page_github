// ============================================================
// LINENCE — Agenda dentro del detalle del proyecto
// ============================================================
// Agrega, en la vista de detalle de dashboard.html, un bloque con
// "Programar actividad" y las actividades ya agendadas de ese proyecto.
// Se carga con una línea en dashboard.html y no toca dashboard.js:
// detecta qué proyecto se está mirando leyendo el código (#detalleCodigo).
//
// Las actividades se leen de la colección "eventos" (campo proyectoCodigo);
// aquí no se guarda ni se copia nada del proyecto.

import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { escucharEventosDeProyecto } from './firestore.js';
import { TIPOS_ACTIVIDAD, ESTADOS, estaAbierto, evaluarEvento, formatoFechaCorta, hoyStr } from './agenda-motor.js';

const ATAJOS = ['visita_cliente', 'toma_medidas', 'reunion_diseno', 'instalacion', 'entrega', 'postventa'];
const ROJO = '#c14b32', NARANJA = '#d98a2b', VERDE = '#5b8a5a', GRIS = '#8a8a8a';

let seccion = null, lista = null, codigoActual = null, parar = null;

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inyectarEstilos() {
  if (document.getElementById('proyecto-agenda-estilos')) return;
  const s = document.createElement('style');
  s.id = 'proyecto-agenda-estilos';
  s.textContent = `
  .pa-atajos{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px}
  .pa-atajos a{padding:7px 14px;border:1px solid #d3bb8c;border-radius:999px;font:500 12px Poppins,sans-serif;color:#141213;text-decoration:none;background:#fff}
  .pa-atajos a:hover{background:#f5efe2;border-color:#d6a52c}
  .pa-fila{display:flex;gap:12px;align-items:center;padding:10px 12px;margin-bottom:8px;border:1px solid #e6d9bd;border-left:4px solid ${VERDE};border-radius:8px;
    text-decoration:none;color:#141213;background:#fff;font-family:Poppins,sans-serif}
  .pa-fila:hover{background:#faf7f2}
  .pa-fecha{flex:0 0 92px;font-size:12px;font-weight:600;line-height:1.3}
  .pa-fecha small{display:block;font-weight:400;opacity:.65}
  .pa-titulo{flex:1;min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pa-estado{font-size:11px;font-weight:500;white-space:nowrap}
  .pa-vacio{font-size:13px;opacity:.6;margin:0}
  @media(max-width:600px){.pa-fila{flex-wrap:wrap}.pa-fecha{flex:0 0 100%}}`;
  document.head.appendChild(s);
}

function crearSeccion() {
  const detalle = document.getElementById('vistaDetalle');
  if (!detalle) return false;
  seccion = document.createElement('section');
  seccion.className = 'panel-seccion';
  seccion.id = 'agendaProyecto';
  seccion.innerHTML = `<h2>Agenda del proyecto</h2><div class="pa-atajos" id="paAtajos"></div><div id="paLista"></div>`;
  const primera = detalle.querySelector('.panel-seccion');
  if (primera) detalle.insertBefore(seccion, primera);
  else detalle.appendChild(seccion);
  lista = seccion.querySelector('#paLista');
  return true;
}

function pintarAtajos(codigo) {
  const base = `agenda.html?nuevo=1&proyecto=${encodeURIComponent(codigo)}`;
  seccion.querySelector('#paAtajos').innerHTML =
    ATAJOS.map(t => `<a href="${base}&tipo=${t}">${TIPOS_ACTIVIDAD[t].icono} ${esc(TIPOS_ACTIVIDAD[t].nombre)}</a>`).join('') +
    `<a href="${base}">＋ Otra actividad</a>`;
}

function pintarLista(eventos) {
  const hoy = hoyStr();
  const orden = [...eventos].sort((a, b) => {
    const ab = estaAbierto(a.estado), bb = estaAbierto(b.estado);
    if (ab !== bb) return ab ? -1 : 1;                       // pendientes primero
    return ab ? (a.proximaFecha || '').localeCompare(b.proximaFecha || '')
              : (b.proximaFecha || '').localeCompare(a.proximaFecha || '');
  });
  if (!orden.length) { lista.innerHTML = '<p class="pa-vacio">Aún no hay actividades agendadas para este proyecto.</p>'; return; }
  lista.innerHTML = orden.map(ev => {
    const abierto = estaAbierto(ev.estado);
    const al = evaluarEvento(ev, hoy);
    const color = !abierto ? GRIS : al?.nivel === 'vencido' ? ROJO : (ev.estado === 'confirmacion_pendiente' || al?.nivel === 'urgente') ? NARANJA : VERDE;
    const icono = TIPOS_ACTIVIDAD[ev.tipo]?.icono || '📋';
    const hora = ev.todoElDia ? 'Todo el día' : ev.horaInicio ? (ev.horaFin ? `${ev.horaInicio}–${ev.horaFin}` : ev.horaInicio) : '';
    const estado = al?.nivel === 'vencido' ? 'Vencido' : (ESTADOS[ev.estado]?.nombre || ev.estado);
    return `<a class="pa-fila" style="border-left-color:${color}${abierto ? '' : ';opacity:.7'}" href="agenda.html?evento=${encodeURIComponent(ev.id)}">
      <span class="pa-fecha">${esc(formatoFechaCorta(ev.proximaFecha))}<small>${esc(hora)}</small></span>
      <span class="pa-titulo">${icono} ${esc(ev.titulo)}</span>
      <span class="pa-estado" style="color:${color}">${esc(estado)}</span></a>`;
  }).join('');
}

function revisarProyecto() {
  const el = document.getElementById('detalleCodigo');
  const codigo = (el?.textContent || '').trim();
  const valido = /^LIN-\d+$/i.test(codigo) ? codigo.toUpperCase() : null;
  if (valido === codigoActual) return;
  parar?.(); parar = null; codigoActual = valido;
  if (!valido) { if (lista) lista.innerHTML = ''; return; }
  pintarAtajos(valido);
  lista.innerHTML = '<p class="pa-vacio">Cargando…</p>';
  parar = escucharEventosDeProyecto(valido, pintarLista,
    () => { lista.innerHTML = '<p class="pa-vacio">No se pudo leer la agenda de este proyecto.</p>'; });
}

function iniciar() {
  const el = document.getElementById('detalleCodigo');
  if (!el || !crearSeccion()) return;
  inyectarEstilos();
  new MutationObserver(revisarProyecto).observe(el, { childList: true, characterData: true, subtree: true });
  revisarProyecto();
}

onAuthStateChanged(auth, (user) => {
  if (!user || seccion) return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
});
