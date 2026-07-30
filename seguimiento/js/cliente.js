// ============================================================
// LINENCE — Seguimiento de Proyectos
// Vista Cliente — lógica de renderizado
// ============================================================
// FASE 4: usa datos de prueba (PROYECTO_MOCK) para maquetar.
// FASE 5: PROYECTO_MOCK se reemplaza por una lectura real a
// Firestore usando el código+token de la URL. El resto de este
// archivo (renderizado) no debería necesitar cambios grandes.

import { ETAPAS, calcularPorcentaje } from './etapas.js';

// ---------- DATOS DE PRUEBA ----------
const PROYECTO_MOCK = {
  codigo: "LIN-59147",
  cliente: "Familia Herrera Muñoz",
  tipoProyecto: "Cocina moderna + Walk-in Closet",
  responsable: "Abraham Quintero",
  fechaEstimadaInstalacion: "18 de septiembre, 2026",
  etapaActualIndex: 5,               // "Armado"
  estadoEtapaActual: "en_proceso",
  observaciones: "Se confirmaron los tiradores en línea dorada mate, tal como se conversó en la visita al taller. La fecha de instalación puede variar levemente según el avance del control de calidad.",
  fotos: [
    { url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600", descripcion: "Estructura de closet en armado" },
    { url: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600", descripcion: "Detalle de corte de tableros" },
    { url: "https://images.unsplash.com/photo-1600566752355-35792bedcfea?w=600", descripcion: "Cocina, vista de avance" }
  ],
  historial: [
    { etapaNombre: "Armado", estadoNuevo: "en_proceso", fecha: "24 jul 2026", hora: "11:20", observacion: "Se inicia el armado de módulos de cocina." },
    { etapaNombre: "Control de Calidad", estadoNuevo: "pendiente", fecha: "—", hora: "", observacion: "" },
    { etapaNombre: "Armado", estadoNuevo: "pendiente", fecha: "22 jul 2026", hora: "09:00", observacion: "Se recibieron todos los tableros cortados desde bodega." },
    { etapaNombre: "Fabricación", estadoNuevo: "completada", fecha: "18 jul 2026", hora: "17:40", observacion: "Fabricación de piezas principales terminada." },
    { etapaNombre: "Corte de materiales", estadoNuevo: "completada", fecha: "10 jul 2026", hora: "10:05", observacion: "" },
    { etapaNombre: "Compra de materiales", estadoNuevo: "completada", fecha: "2 jul 2026", hora: "16:00", observacion: "" },
    { etapaNombre: "Abono del 50%", estadoNuevo: "completada", fecha: "28 jun 2026", hora: "12:30", observacion: "" },
    { etapaNombre: "Cotización aceptada", estadoNuevo: "completada", fecha: "25 jun 2026", hora: "18:15", observacion: "" }
  ]
};

function init(proyecto){
  renderHero(proyecto);
  renderCinta(proyecto);
  renderInfoGrid(proyecto);
  renderTimeline(proyecto);
  renderGaleria(proyecto);
  renderObservaciones(proyecto);
  renderHistorial(proyecto);
  activarReveal();
  activarLightbox();
}

function estadoLegible(estado){
  return { pendiente: "Pendiente", en_proceso: "En proceso", completada: "Completada" }[estado] ?? estado;
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
  document.getElementById('infoFecha').textContent = p.fechaEstimadaInstalacion;
  document.getElementById('infoResponsable').textContent = p.responsable;
  document.getElementById('infoCodigo').textContent = p.codigo;
}

function renderTimeline(p){
  const list = document.getElementById('timelineList');
  list.innerHTML = ETAPAS.map(e => {
    let estadoClase = 'pendiente';
    let fecha = '';
    if (e.index < p.etapaActualIndex) estadoClase = 'completada';
    if (e.index === p.etapaActualIndex) estadoClase = 'actual';

    const registro = p.historial.find(h => h.etapaNombre === e.nombre);
    if (registro && registro.fecha !== '—') fecha = `${registro.fecha} · ${registro.hora}`;

    const icono = estadoClase === 'completada' ? '✓' : (estadoClase === 'actual' ? '' : '');

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
  if (!p.fotos.length){
    document.getElementById('galeriaSection').style.display = 'none';
    return;
  }
  grid.innerHTML = p.fotos.map(f => `
    <figure data-full="${f.url.replace('w=600','w=1600')}">
      <img src="${f.url}" alt="${f.descripcion}" loading="lazy">
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

function renderHistorial(p){
  const list = document.getElementById('historialList');
  list.innerHTML = p.historial
    .filter(h => h.fecha !== '—')
    .map(h => `
      <li class="historial-item">
        <button class="historial-toggle" aria-expanded="false">
          <span>${h.etapaNombre} — ${estadoLegible(h.estadoNuevo)} · ${h.fecha}</span>
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

document.addEventListener('DOMContentLoaded', () => init(PROYECTO_MOCK));
