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
