// ============================================================
// LINENCE — Campanita global de alertas
// ============================================================
// Se carga con una sola línea en cada página del panel:
//   <script type="module" src="js/campanita.js"></script>
// Inserta la campanita en el menú lateral (y en la barra superior en
// teléfono), escucha los eventos pendientes y muestra el contador.
// Trae sus propios estilos, así no depende del CSS de cada página.
//
// Usa onAuthStateChanged directo (no observarSesionStaff) para no
// activar dos veces el control de inactividad que ya arranca cada página.

import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { obtenerUsuarioStaff, escucharEventosAbiertos } from './firestore.js';
import { alertasPendientes, hoyStr, CATEGORIAS, TIPOS_ACTIVIDAD, formatoFechaCorta } from './agenda-motor.js';

const ROJO = '#c14b32', NARANJA = '#d98a2b';

let eventos = [];
let botones = [];
let panel = null;
let pararEscucha = null;

function inyectarEstilos() {
  if (document.getElementById('campanita-estilos')) return;
  const s = document.createElement('style');
  s.id = 'campanita-estilos';
  s.textContent = `
  .campanita-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;
    background:transparent;border:1px solid rgba(211,187,140,.35);color:#d3bb8c;cursor:pointer;transition:background .15s ease,border-color .15s ease;padding:0}
  .campanita-btn:hover{background:rgba(211,187,140,.12);border-color:#d3bb8c}
  .campanita-btn svg{width:19px;height:19px}
  .campanita-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:${ROJO};color:#fff;
    font:600 11px/18px Poppins,sans-serif;text-align:center;box-sizing:border-box;display:none}
  .campanita-badge.visible{display:block}
  .campanita-badge.naranja{background:${NARANJA}}
  .campanita-fila-sidebar{display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:0 4px}
  .campanita-fila-sidebar .campanita-etiqueta{font:400 13px Poppins,sans-serif;color:#d3bb8c;opacity:.85;cursor:pointer}
  .campanita-topbar{position:absolute;right:14px;top:50%;transform:translateY(-50%)}
  .campanita-panel{position:fixed;z-index:99998;width:360px;max-width:calc(100vw - 20px);max-height:min(70vh,520px);display:none;flex-direction:column;
    background:#fff;border:1px solid #d3bb8c;border-radius:12px;box-shadow:0 14px 40px rgba(20,18,19,.28);overflow:hidden;font-family:Poppins,sans-serif}
  .campanita-panel.visible{display:flex}
  .campanita-panel header{padding:14px 16px;background:#141213;color:#d3bb8c;font-size:13px;font-weight:500;letter-spacing:.03em;display:flex;justify-content:space-between;align-items:center}
  .campanita-panel header a{color:#d3bb8c;font-size:12px;text-decoration:none;opacity:.85}
  .campanita-panel header a:hover{opacity:1;text-decoration:underline}
  .campanita-lista{overflow:auto;flex:1}
  .campanita-item{display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid #f0e9da;text-decoration:none;color:#141213;align-items:flex-start}
  .campanita-item:hover{background:#faf7f2}
  .campanita-punto{width:10px;height:10px;border-radius:50%;margin-top:5px;flex:0 0 10px}
  .campanita-item .t{font-size:13px;font-weight:500;line-height:1.35}
  .campanita-item .s{font-size:12px;color:#6b6b6b;margin-top:2px}
  .campanita-vacio{padding:26px 16px;text-align:center;font-size:13px;color:#6b6b6b}
  @media(max-width:900px){.campanita-panel{left:10px !important;right:10px !important;width:auto;top:64px !important}}
  `;
  document.head.appendChild(s);
}

const SVG_CAMPANA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

function crearBoton(extraClase = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'campanita-btn ' + extraClase;
  b.setAttribute('aria-label', 'Alertas');
  b.innerHTML = SVG_CAMPANA + '<span class="campanita-badge"></span>';
  b.addEventListener('click', (e) => { e.stopPropagation(); alternarPanel(b); });
  botones.push(b);
  return b;
}

function insertarCampanitas() {
  // Desktop / menú lateral: justo encima del bloque de usuario.
  const user = document.querySelector('.dash-user');
  if (user && !document.querySelector('.campanita-fila-sidebar')) {
    const fila = document.createElement('div');
    fila.className = 'campanita-fila-sidebar';
    const b = crearBoton();
    const et = document.createElement('span');
    et.className = 'campanita-etiqueta';
    et.textContent = 'Alertas';
    et.addEventListener('click', (e) => { e.stopPropagation(); alternarPanel(b); });
    fila.append(b, et);
    user.parentNode.insertBefore(fila, user);
  }
  // Teléfono / tablet: barra superior (siempre accesible sin abrir el menú).
  const top = document.getElementById('dashTopbarMobile');
  if (top && !top.querySelector('.campanita-topbar')) {
    top.style.position = top.style.position || 'relative';
    const b = crearBoton('campanita-topbar');
    top.appendChild(b);
  }
}

function crearPanel() {
  panel = document.createElement('div');
  panel.className = 'campanita-panel';
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(panel);
  document.addEventListener('click', () => panel.classList.remove('visible'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.remove('visible'); });
}

function alternarPanel(boton) {
  if (!panel) return;
  const abrir = !panel.classList.contains('visible');
  panel.classList.remove('visible');
  if (!abrir) return;
  pintarPanel();
  const r = boton.getBoundingClientRect();
  panel.style.left = Math.max(10, Math.min(r.left, window.innerWidth - 370)) + 'px';
  panel.style.top = Math.min(r.bottom + 8, window.innerHeight - 140) + 'px';
  panel.classList.add('visible');
}

function esc(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function pintarPanel() {
  const alertas = alertasPendientes(eventos, hoyStr());
  const filas = alertas.slice(0, 30).map(a => {
    const rojo = a.nivel === 'vencido' || a.nivel === 'urgente';
    const icono = TIPOS_ACTIVIDAD[a.ev.tipo]?.icono || CATEGORIAS[a.ev.categoria]?.icono || '🔔';
    return `<a class="campanita-item" href="agenda.html?evento=${encodeURIComponent(a.ev.id)}">
      <span class="campanita-punto" style="background:${rojo ? ROJO : NARANJA}"></span>
      <span><div class="t">${icono} ${esc(a.ev.titulo)}</div>
      <div class="s">${esc(a.texto)} · ${esc(formatoFechaCorta(a.ev.proximaFecha))}${a.ev.horaInicio ? ' · ' + esc(a.ev.horaInicio) : ''}</div></span></a>`;
  }).join('');
  panel.innerHTML = `<header><span>Alertas pendientes (${alertas.length})</span><a href="agenda.html">Abrir agenda →</a></header>
    <div class="campanita-lista">${filas || '<div class="campanita-vacio">No tienes alertas pendientes. ✨</div>'}</div>`;
}

function actualizarContador() {
  const alertas = alertasPendientes(eventos, hoyStr());
  const hayRojo = alertas.some(a => a.nivel === 'vencido' || a.nivel === 'urgente');
  for (const b of botones) {
    const badge = b.querySelector('.campanita-badge');
    badge.textContent = alertas.length > 99 ? '99+' : String(alertas.length);
    badge.classList.toggle('visible', alertas.length > 0);
    badge.classList.toggle('naranja', alertas.length > 0 && !hayRojo);
  }
  if (panel?.classList.contains('visible')) pintarPanel();
}

function iniciar() {
  inyectarEstilos();
  insertarCampanitas();
  crearPanel();
  pararEscucha = escucharEventosAbiertos((lista) => { eventos = lista; actualizarContador(); },
    (err) => console.warn('Campanita: no se pudieron leer las alertas', err));
  // Recalcula cada minuto (cambio de día, alertas que "llegan" con el tiempo).
  setInterval(actualizarContador, 60000);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { pararEscucha?.(); return; }
  try {
    const staff = await obtenerUsuarioStaff(user.uid);
    if (staff && staff.activo === true && !panel) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
      else iniciar();
    }
  } catch (e) { console.warn('Campanita: sesión no verificada', e); }
});
