// ============================================================
// LINENCE — Seguimiento de Proyectos
// Vista Cliente — lógica de renderizado (FASE 5: datos reales)
// ============================================================
// Lee ?codigo=LIN-59147&token=xxxx de la URL, valida contra
// Firestore y renderiza. Si el código no existe o el token no
// coincide, muestra un estado de error — nunca datos ajenos.

import { ETAPAS, calcularPorcentaje } from './etapas.js';
import { obtenerProyecto, obtenerHistorial } from './firestore.js';
import { getQueryParams, formatearFecha } from './utils.js';

const ICONOS_ETAPA = [
  // Cotización aceptada — documento con check
  '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><polyline points="8,13 11,16 16,10"/>',
  // Abono del 50% — tarjeta
  '<rect x="3" y="6" width="18" height="12" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>',
  // Compra de materiales — carrito
  '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.6L21 8H6"/>',
  // Corte de materiales — tijeras
  '<circle cx="7" cy="6" r="2.1"/><circle cx="7" cy="18" r="2.1"/><line x1="8.5" y1="7.5" x2="20" y2="19"/><line x1="8.5" y1="16.5" x2="20" y2="5"/>',
  // Fabricación — engranaje
  '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6"/>',
  // Armado — llave
  '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2 2.8-2.8z"/>',
  // Control de Calidad — escudo con check
  '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><polyline points="9,12 11,14 15,10"/>',
  // Embalaje — caja
  '<path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M3 8v9l9 4 9-4V8"/><line x1="12" y1="12" x2="12" y2="21"/>',
  // Coordinación de instalación — calendario
  '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  // Instalación — camión
  '<rect x="1" y="7" width="13" height="10" rx="1"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.7"/><circle cx="17" cy="19" r="1.7"/>',
  // Entrega del proyecto — casa con check
  '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><polyline points="9,15 11,17 15,13"/>'
];

async function init() {
  const { codigo, token } = getQueryParams();

  if (!codigo || !token) {
    mostrarError("Este enlace no es válido. Revisa que copiaste la dirección completa que te enviamos.");
    return;
  }

  let proyecto;
  try {
    proyecto = await obtenerProyecto(codigo);
  } catch (err) {
    console.error(err);
    mostrarError("No pudimos cargar tu proyecto en este momento. Intenta nuevamente en unos minutos.");
    return;
  }

  if (!proyecto || proyecto.token !== token) {
    mostrarError("No encontramos un proyecto con ese enlace. Si crees que esto es un error, escríbenos por WhatsApp.");
    return;
  }

  if (proyecto.activo === false) {
    mostrarError("Este proyecto ya no está disponible para seguimiento. Si tienes dudas, escríbenos por WhatsApp.");
    return;
  }

  let historial = [];
  try {
    historial = await obtenerHistorial(codigo);
  } catch (err) {
    console.error("No se pudo cargar el historial:", err);
    // El proyecto igual se muestra aunque el historial falle
  }

  ocultarCarga();
  renderHero(proyecto);
  renderCinta(proyecto);
  renderInfoGrid(proyecto);
  renderTimeline(proyecto, historial);
  renderGaleria(proyecto);
  renderObservaciones(proyecto);
  renderHistorial(historial);
  activarReveal();
  activarLightbox();
}

function estadoLegible(estado){
  return { pendiente: "Pendiente", en_proceso: "En proceso", completada: "Completada" }[estado] ?? estado;
}

function ocultarCarga(){
  document.getElementById('estadoCarga').style.display = 'none';
  document.getElementById('contenidoProyecto').style.display = 'block';
}

function mostrarError(mensaje){
  document.getElementById('estadoCarga').style.display = 'none';
  const errorBox = document.getElementById('estadoError');
  errorBox.querySelector('p').textContent = mensaje;
  errorBox.style.display = 'flex';
}

function renderHero(p){
  document.getElementById('codigoHeader').textContent = p.codigo;
  document.getElementById('clienteNombre').textContent = p.cliente;
  document.getElementById('tipoProyecto').textContent = p.tipoProyecto;
  document.getElementById('estadoActualTexto').textContent =
    `${ETAPAS[p.etapaActualIndex].nombre} · ${estadoLegible(p.estadoEtapaActual)}`;
}

function renderCinta(p){
  const porcentaje = calcularPorcentaje(p.etapaActualIndex, p.estadoEtapaActual);
  document.getElementById('porcentajeTexto').textContent = porcentaje;

  const track = document.getElementById('cintaTrack');
  track.style.setProperty('--avance', porcentaje + '%');

  const marcasWrap = document.getElementById('cintaMarcas');
  marcasWrap.innerHTML = ETAPAS.map((e, i) => `
    <div class="marca ${i <= p.etapaActualIndex ? 'activa' : ''}">
      <span class="num">${e.porcentaje}%</span>
    </div>
  `).join('');

  const iconosWrap = document.getElementById('tapeIcons');
  iconosWrap.innerHTML = ETAPAS.map((e, i) => {
    const esActual = i === p.etapaActualIndex;
    return `
      <div class="tape-icon-item ${esActual ? 'actual' : ''}">
        <div class="tape-icon-circle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONOS_ETAPA[i]}</svg>
        </div>
        <div class="tape-dotted"></div>
        <div class="tape-icon-nombre">${e.nombre}</div>
        <div class="tape-icon-num">${e.index + 1}</div>
      </div>`;
  }).join('');
}

function renderInfoGrid(p){
  document.getElementById('infoFecha').textContent =
    p.fechaEstimadaInstalacion ? formatearFecha(p.fechaEstimadaInstalacion) : 'Por confirmar';
  document.getElementById('infoResponsable').textContent = p.responsable || 'Por asignar';
  document.getElementById('infoCodigo').textContent = p.codigo;
}

function renderTimeline(p, historial){
  const list = document.getElementById('timelineList');
  list.innerHTML = ETAPAS.map(e => {
    let estadoClase = 'pendiente';
    if (e.index < p.etapaActualIndex) estadoClase = 'completada';
    if (e.index === p.etapaActualIndex) estadoClase = 'actual';

    const registro = historial.find(h => h.etapaNombre === e.nombre);
    const fecha = registro ? formatearFecha(registro.fecha, true) : '';
    const icono = estadoClase === 'completada' ? '✓' : '';

    return `
      <li class="timeline-item ${estadoClase}">
        <div class="timeline-marker">${icono}</div>
        <div class="timeline-content">
          <div class="nombre-etapa">${e.nombre}</div>
          ${fecha ? `<div class="fecha-etapa">${fecha}</div>` : ''}
        </div>
      </li>`;
  }).join('');
}

function renderGaleria(p){
  const grid = document.getElementById('galeriaGrid');
  const fotos = p.fotos || [];
  if (!fotos.length){
    document.getElementById('galeriaSection').style.display = 'none';
    return;
  }
  grid.innerHTML = fotos.map(f => `
    <figure data-full="${f.url}">
      <img src="${f.url}" alt="${f.descripcion || 'Fotografía del avance'}" loading="lazy">
    </figure>
  `).join('');
}

function renderObservaciones(p){
  if (!p.observaciones){
    document.getElementById('observacionesSection').style.display = 'none';
    return;
  }
  document.getElementById('observacionesTexto').textContent = p.observaciones;
}

function renderHistorial(historial){
  const list = document.getElementById('historialList');
  if (!historial.length){
    document.getElementById('historialSectionWrap').style.display = 'none';
    return;
  }
  list.innerHTML = historial.map(h => `
    <li class="historial-item">
      <button class="historial-toggle" aria-expanded="false">
        <span>${h.etapaNombre} — ${estadoLegible(h.estadoNuevo)} · ${formatearFecha(h.fecha)}</span>
        <span class="flecha">⌄</span>
      </button>
      <div class="historial-detalle">${h.observacion || 'Sin observaciones adicionales.'}</div>
    </li>
  `).join('');

  list.querySelectorAll('.historial-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.historial-item');
      const isOpen = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen);
    });
  });
}

function activarReveal(){
  const targets = document.querySelectorAll('.reveal-target');
  targets.forEach(el => el.classList.add('reveal'));

  if (!('IntersectionObserver' in window)){
    targets.forEach(el => el.classList.add('visible'));
    return;
  }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting){
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  targets.forEach(el => obs.observe(el));
}

function activarLightbox(){
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');

  document.getElementById('galeriaGrid').addEventListener('click', (e) => {
    const figure = e.target.closest('figure');
    if (!figure) return;
    lightboxImg.src = figure.dataset.full;
    lightbox.classList.add('open');
  });

  document.getElementById('lightboxClose').addEventListener('click', () => {
    lightbox.classList.remove('open');
  });
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) lightbox.classList.remove('open');
  });
}

document.addEventListener('DOMContentLoaded', init);
