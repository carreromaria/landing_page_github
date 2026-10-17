// ============================================================
// LINENCE — Agenda y Gestión de Vencimientos (pantalla)
// ============================================================
// Todo el acceso a datos va por firestore.js y todas las reglas
// (recurrencias, alertas, conflictos) por agenda-motor.js.
// Aquí solo está lo visual: resumen, calendario mensual/semanal,
// lista de agenda, formularios y recursos.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  escucharEventos, escucharRecursos, listarUsuariosStaff,
  crearEvento, actualizarEvento, escucharHistorialEvento,
  crearRecurso, actualizarRecurso
} from './firestore.js';
import * as M from './agenda-motor.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const HORA_INI = 7, HORA_FIN = 20, ALTO_HORA = 48;   // rejilla semanal 07:00–20:00
const TIPOS_RECURSO = { persona: 'Persona', equipo: 'Equipo de instalación', vehiculo: 'Vehículo', sala: 'Sala de reuniones', taller: 'Taller', otro: 'Otro' };

const S = {
  staff: null, eventos: [], recursos: [], usuarios: [],
  vista: 'resumen',
  mesRef: M.hoyStr().slice(0, 8) + '01',
  semanaRef: M.hoyStr(),
  diaSel: M.hoyStr(),
  f: { cat: '', estado: '', prio: '', resp: '', q: '' },
  semRecurso: '',
  editandoId: null, detalleId: null, pararHistorial: null,
  deepLinkHecho: false
};

// ---------- Utilidades ----------

function toast(msg, tipo = 'ok') {
  const c = $('toastContainer'); if (!c) return;
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `background:${tipo === 'error' ? '#c14b32' : '#141213'};color:#fff;padding:12px 18px;border-radius:8px;margin-top:8px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.25);border-left:3px solid #d3bb8c;`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

const nombresRecursos = () => Object.fromEntries(S.recursos.map(r => [r.id, r.nombre]));
const nombreStaff = () => S.staff?.nombre || S.staff?.email || 'Usuario';
const esAdmin = () => S.staff?.rol === 'admin';

function iconoEv(ev) { return M.TIPOS_ACTIVIDAD[ev.tipo]?.icono || M.CATEGORIAS[ev.categoria]?.icono || '📋'; }
function textoHora(ev) {
  if (ev.todoElDia) return 'Todo el día';
  if (!ev.horaInicio) return '';
  return ev.horaFin ? `${ev.horaInicio}–${ev.horaFin}` : ev.horaInicio;
}

let _mejorar = null;
async function mejorarSelects(ids) {
  try {
    if (!_mejorar) _mejorar = (await import('./components/dropdown-linence.js')).mejorarSelect;
    for (const id of ids) { const el = $(id); if (el && !el.dataset.lnMejorado) { _mejorar(el); el.dataset.lnMejorado = '1'; } }
  } catch (e) { console.warn('Dropdown de marca no disponible; se usan selects nativos.', e); }
}

// ---------- Filtros ----------

function eventosFiltrados() {
  const { cat, estado, prio, resp, q } = S.f;
  const hoy = M.hoyStr();
  const nombres = nombresRecursos();
  const qn = M.normalizarBusqueda(q);
  return S.eventos.filter(ev => {
    if (cat && ev.categoria !== cat) return false;
    if (prio && ev.prioridad !== prio) return false;
    if (resp && ev.responsableUid !== resp) return false;
    if (estado === 'vencido') { if (M.evaluarEvento(ev, hoy)?.nivel !== 'vencido') return false; }
    else if (estado && ev.estado !== estado) return false;
    if (qn && !M.textoBuscable(ev, nombres).includes(qn)) return false;
    return true;
  });
}

// ---------- Chips y filas ----------

function chip(ev, fecha) {
  const color = M.colorEvento({ ...ev, proximaFecha: fecha }, M.hoyStr());
  const h = ev.horaInicio && !ev.todoElDia ? `<b>${esc(ev.horaInicio)}</b> ` : '';
  return `<button type="button" class="ag-chip ${color}" data-ev="${esc(ev.id)}" title="${esc(ev.titulo)}">${iconoEv(ev)} ${h}${esc(ev.titulo)}</button>`;
}

function badgeEstado(ev) {
  const a = M.evaluarEvento(ev, M.hoyStr());
  if (a?.nivel === 'vencido') return `<span class="ag-badge rojo">Vencido</span>`;
  const c = M.colorEvento(ev);
  return `<span class="ag-badge ${c}">${esc(M.ESTADOS[ev.estado]?.nombre || ev.estado)}</span>`;
}
const badgePrioridad = (ev) => ['alta', 'urgente'].includes(ev.prioridad)
  ? `<span class="ag-badge ${ev.prioridad === 'urgente' ? 'rojo' : 'naranja'}">${esc(M.PRIORIDADES[ev.prioridad].nombre)}</span>` : '';

function filaAgenda(ev, fecha) {
  const abierto = M.estaAbierto(ev.estado);
  const acciones = abierto ? `
    <button type="button" class="ag-mini" data-accion="completar" data-ev="${esc(ev.id)}" title="Marcar como realizado">✓</button>
    <button type="button" class="ag-mini" data-accion="posponer" data-ev="${esc(ev.id)}" title="Posponer / reprogramar">⏰</button>` : '';
  const sub = [M.CATEGORIAS[ev.categoria]?.nombre, M.TIPOS_ACTIVIDAD[ev.tipo]?.nombre, ev.responsableNombre].filter(Boolean).map(esc).join(' · ');
  return `<div class="ag-fila ${M.colorEvento({ ...ev, proximaFecha: fecha })}" data-ev="${esc(ev.id)}">
    <div class="ag-fila-hora">${esc(textoHora(ev)) || '—'}</div>
    <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${iconoEv(ev)} ${esc(ev.titulo)}</div><div class="ag-fila-sub">${sub}</div></div>
    <div class="ag-fila-tags">${badgePrioridad(ev)}${badgeEstado(ev)}</div>
    <div class="ag-fila-acc">${acciones}</div></div>`;
}

// ---------- Vista: Resumen ----------

function renderResumen() {
  const hoy = M.hoyStr();
  const evs = eventosFiltrados();
  const alertas = M.alertasPendientes(evs, hoy);
  const vencidos = alertas.filter(a => a.nivel === 'vencido').length;
  const abiertos = evs.filter(e => M.estaAbierto(e.estado));
  const n7 = M.ocurrenciasEnRango(abiertos, hoy, M.sumarDias(hoy, 7)).length;
  const n30 = M.ocurrenciasEnRango(abiertos, hoy, M.sumarDias(hoy, 30)).length;
  const lun = M.lunesDeSemana(hoy);
  const semana = M.ocurrenciasEnRango(abiertos.filter(e => e.categoria === 'actividad'), lun, M.sumarDias(lun, 6)).length;

  const tarjeta = (n, t, cls, vista, estado) =>
    `<button type="button" class="ag-card ${cls}" data-ir="${vista}" data-estado="${estado || ''}"><span class="n">${n}</span><span class="t">${t}</span></button>`;

  const atencion = alertas.slice(0, 8).map(a => `<div class="ag-fila ${a.nivel === 'proximo' ? 'naranja' : 'rojo'}" data-ev="${esc(a.ev.id)}">
      <div class="ag-fila-hora">${esc(M.formatoFechaCorta(a.ev.proximaFecha))}</div>
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${iconoEv(a.ev)} ${esc(a.ev.titulo)}</div><div class="ag-fila-sub">${esc(a.texto)}</div></div>
      <div class="ag-fila-tags">${badgePrioridad(a.ev)}</div></div>`).join('');

  const prox = M.ocurrenciasEnRango(abiertos, hoy, M.sumarDias(hoy, 45)).slice(0, 8).map(o => `<div class="ag-fila ${M.colorEvento({ ...o.ev, proximaFecha: o.fecha })}" data-ev="${esc(o.ev.id)}">
      <div class="ag-fila-hora">${esc(M.formatoFechaCorta(o.fecha))}<br><small>${esc(textoHora(o.ev))}</small></div>
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${iconoEv(o.ev)} ${esc(o.ev.titulo)}</div><div class="ag-fila-sub">${esc(o.ev.responsableNombre || '')}</div></div>
      <div class="ag-fila-tags">${badgeEstado(o.ev)}</div></div>`).join('');

  $('paneResumen').innerHTML = `
    <div class="ag-cards">
      ${tarjeta(vencidos, '🔴 Vencidos', 'rojo', 'agenda', 'vencido')}
      ${tarjeta(n7, '🟠 Próximos 7 días', 'naranja', 'agenda')}
      ${tarjeta(n30, '🟡 Próximos 30 días', 'amarillo', 'agenda')}
      ${tarjeta(semana, '📆 Actividades esta semana', 'neutro', 'semana')}
      ${tarjeta(alertas.length, '⚠️ Alertas pendientes', alertas.some(a => a.nivel !== 'proximo') ? 'rojo' : 'naranja', 'agenda')}
    </div>
    <div class="ag-dos-col">
      <section><h2 class="ag-h2">Requiere atención</h2>${atencion || '<p class="ag-vacio">Todo al día por ahora. ✨</p>'}</section>
      <section><h2 class="ag-h2">Próximas actividades</h2>${prox || '<p class="ag-vacio">No hay nada programado en los próximos 45 días. Usa “+ Crear evento”.</p>'}</section>
    </div>`;
}

// ---------- Vista: Mes ----------

function renderMes() {
  const { y, m } = M.partesFecha(S.mesRef);
  const hoy = M.hoyStr();
  const ini = M.lunesDeSemana(S.mesRef);
  const fin = M.sumarDias(ini, 41);
  const porDia = {};
  for (const o of M.ocurrenciasEnRango(eventosFiltrados(), ini, fin)) (porDia[o.fecha] ||= []).push(o);

  let celdas = '';
  for (let i = 0; i < 42; i++) {
    const f = M.sumarDias(ini, i);
    const { m: mm, d } = M.partesFecha(f);
    const lista = porDia[f] || [];
    const chips = lista.slice(0, 3).map(o => chip(o.ev, f)).join('');
    const mas = lista.length > 3 ? `<button type="button" class="ag-mas" data-dia="${f}">+${lista.length - 3} más</button>` : '';
    celdas += `<div class="ag-celda ${mm !== m ? 'fuera' : ''} ${f === hoy ? 'hoy' : ''} ${f === S.diaSel ? 'sel' : ''}" data-dia="${f}">
      <span class="ag-num">${d}</span>${chips}${mas}</div>`;
  }
  const cab = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="ag-cab">${d}</div>`).join('');

  const delDia = M.ocurrenciasEnRango(eventosFiltrados(), S.diaSel, S.diaSel);
  $('paneMes').innerHTML = `
    <div class="ag-nav"><button type="button" class="btn-secundario" data-nav="mes-" aria-label="Mes anterior">◀</button>
      <h2 class="ag-titulo-nav">${esc(M.NOMBRES_MES[m - 1])} ${y}</h2>
      <button type="button" class="btn-secundario" data-nav="mes+" aria-label="Mes siguiente">▶</button>
      <button type="button" class="btn-secundario" data-nav="mes0">Hoy</button></div>
    <div class="ag-mes">${cab}${celdas}</div>
    <section class="ag-dia-panel"><div class="ag-dia-cab"><h3>${esc(M.formatoFechaLarga(S.diaSel))}</h3>
      <button type="button" class="btn-secundario" data-nuevo-dia="${S.diaSel}">+ Evento este día</button></div>
      ${delDia.map(o => filaAgenda(o.ev, o.fecha)).join('') || '<p class="ag-vacio">Sin actividades este día.</p>'}</section>`;
}

// ---------- Vista: Semana ----------

function carriles(items) {
  items.sort((a, b) => a.ini - b.ini || a.fin - b.fin);
  const out = []; let cluster = [], lanes = [], fin = -1;
  const cerrar = () => { cluster.forEach(c => c.total = lanes.length); out.push(...cluster); cluster = []; lanes = []; fin = -1; };
  for (const it of items) {
    if (cluster.length && it.ini >= fin) cerrar();
    let l = lanes.findIndex(e => e <= it.ini);
    if (l < 0) { l = lanes.length; lanes.push(0); }
    lanes[l] = it.fin; it.lane = l; cluster.push(it); fin = Math.max(fin, it.fin);
  }
  cerrar();
  return out;
}

function renderSemana() {
  const hoy = M.hoyStr();
  const lun = M.lunesDeSemana(S.semanaRef);
  const dom = M.sumarDias(lun, 6);
  if (S.diaSel < lun || S.diaSel > dom) S.diaSel = (hoy >= lun && hoy <= dom) ? hoy : lun;

  let evs = eventosFiltrados();
  if (S.semRecurso) evs = evs.filter(e => (e.recursoIds || []).includes(S.semRecurso));
  const occ = M.ocurrenciasEnRango(evs, lun, dom);
  const dias = Array.from({ length: 7 }, (_, i) => M.sumarDias(lun, i));
  const nomDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  const cabeceras = dias.map((f, i) => `<div class="ag-sem-cab ${f === hoy ? 'hoy' : ''} ${f === S.diaSel ? 'sel' : ''}" data-dia="${f}">${nomDia[i]}<b>${M.partesFecha(f).d}</b></div>`).join('');
  const sinHora = dias.map(f => `<div class="ag-sem-sinhora">${occ.filter(o => o.fecha === f && !M.intervalo(o.ev)).map(o => chip(o.ev, f)).join('')}</div>`).join('');

  const horas = Array.from({ length: HORA_FIN - HORA_INI }, (_, i) => `<div class="ag-hora" style="height:${ALTO_HORA}px">${String(HORA_INI + i).padStart(2, '0')}:00</div>`).join('');
  const columnas = dias.map(f => {
    const items = occ.filter(o => o.fecha === f && M.intervalo(o.ev)).map(o => {
      const [a, b] = M.intervalo(o.ev);
      return { o, ini: Math.max(a, HORA_INI * 60), fin: Math.min(Math.max(b, a + 30), HORA_FIN * 60) };
    }).filter(it => it.fin > it.ini);
    const bloques = carriles(items).map(it => {
      const top = (it.ini - HORA_INI * 60) / 60 * ALTO_HORA;
      const alto = Math.max(22, (it.fin - it.ini) / 60 * ALTO_HORA - 2);
      const ancho = 100 / it.total;
      const color = M.colorEvento({ ...it.o.ev, proximaFecha: f }, hoy);
      return `<button type="button" class="ag-bloque ${color}" data-ev="${esc(it.o.ev.id)}" style="top:${top}px;height:${alto}px;left:calc(${it.lane * ancho}% + 1px);width:calc(${ancho}% - 3px)">
        <b>${esc(it.o.ev.horaInicio)}</b> ${iconoEv(it.o.ev)} ${esc(it.o.ev.titulo)}</button>`;
    }).join('');
    return `<div class="ag-sem-col ${f === hoy ? 'hoy' : ''}" data-dia="${f}" style="height:${(HORA_FIN - HORA_INI) * ALTO_HORA}px">${bloques}</div>`;
  }).join('');

  // Lista por día (teléfono)
  const lista = dias.map((f, i) => {
    const del = occ.filter(o => o.fecha === f);
    return `<div class="ag-sem-dia-lista ${f === hoy ? 'hoy' : ''}"><h4>${nomDia[i]} ${M.partesFecha(f).d}</h4>${del.map(o => filaAgenda(o.ev, f)).join('') || '<p class="ag-vacio">Libre</p>'}</div>`;
  }).join('');

  // Disponibilidad por recurso del día seleccionado
  const activos = S.recursos.filter(r => r.activo !== false);
  const disp = M.disponibilidadDelDia(activos, S.eventos, S.diaSel);
  const fmt = (min) => M.desdeMinutos(min);
  const filasDisp = activos.map(r => {
    const d = disp[r.id];
    const ic = d.estado === 'libre' ? '🟢' : d.estado === 'pendiente' ? '🟠' : '🔴';
    const txt = d.estado === 'libre' ? 'Disponible' : d.estado === 'pendiente' ? 'Pendiente de confirmación' : 'Ocupado';
    const tramos = d.tramos.map(t => `${t.ini === 0 && t.fin === 1440 ? 'Todo el día' : fmt(t.ini) + '–' + fmt(t.fin)} · ${esc(t.ev.titulo)}`).join('<br>');
    return `<div class="ag-disp-fila"><span class="ag-disp-nombre">${esc(r.nombre)}<small>${esc(TIPOS_RECURSO[r.tipo] || '')}</small></span>
      <span class="ag-disp-estado">${ic} ${txt}</span><span class="ag-disp-tramos">${tramos}</span></div>`;
  }).join('');

  const opcionesRec = `<option value="">Todos los recursos</option>` + activos.map(r => `<option value="${esc(r.id)}" ${S.semRecurso === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('');
  const { d: d1, m: m1 } = M.partesFecha(lun), { d: d2, m: m2, y: y2 } = M.partesFecha(dom);

  $('paneSemana').innerHTML = `
    <div class="ag-nav"><button type="button" class="btn-secundario" data-nav="sem-" aria-label="Semana anterior">◀</button>
      <h2 class="ag-titulo-nav">${d1} ${M.NOMBRES_MES[m1 - 1].slice(0, 3)} – ${d2} ${M.NOMBRES_MES[m2 - 1].slice(0, 3)} ${y2}</h2>
      <button type="button" class="btn-secundario" data-nav="sem+" aria-label="Semana siguiente">▶</button>
      <button type="button" class="btn-secundario" data-nav="sem0">Hoy</button>
      <select id="semRecurso" class="ag-select-sem" aria-label="Filtrar por recurso">${opcionesRec}</select></div>
    <div class="ag-semana">
      <div class="ag-sem-grid">
        <div class="ag-sem-esq"></div>${cabeceras}
        <div class="ag-sem-esq ag-sem-esq-sh">Sin hora</div>${sinHora}
        <div class="ag-sem-horas">${horas}</div>${columnas}
      </div>
    </div>
    <div class="ag-sem-lista">${lista}</div>
    <div class="ag-leyenda"><span><i class="verde"></i> Programado / confirmado</span><span><i class="naranja"></i> Pendiente de confirmación o próximo</span><span><i class="rojo"></i> Vencido / urgente</span></div>
    <section class="ag-dia-panel"><div class="ag-dia-cab"><h3>Disponibilidad · ${esc(M.formatoFechaLarga(S.diaSel))}</h3></div>
      ${filasDisp || '<p class="ag-vacio">Aún no hay recursos. Créalos en la pestaña “Recursos” para ver quién está libre y quién ocupado.</p>'}</section>`;
}

// ---------- Vista: Agenda (lista) ----------

function renderAgenda() {
  const hoy = M.hoyStr();
  const evs = eventosFiltrados();
  let html = '';
  if (S.f.estado && S.f.estado !== 'vencido' && !M.estaAbierto(S.f.estado)) {
    // Se pidió ver realizados / cancelados: lista simple, más recientes primero.
    const lista = evs.slice().sort((a, b) => (b.proximaFecha || '').localeCompare(a.proximaFecha || '')).slice(0, 200);
    html = lista.map(ev => filaAgenda(ev, ev.proximaFecha)).join('') || '<p class="ag-vacio">Sin resultados.</p>';
  } else {
    const abiertos = evs.filter(e => M.estaAbierto(e.estado));
    const vencidos = abiertos.filter(e => e.proximaFecha < hoy).sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));
    if (vencidos.length) html += `<h3 class="ag-grupo rojo">🔴 Vencidos (${vencidos.length})</h3>` + vencidos.map(ev => filaAgenda(ev, ev.proximaFecha)).join('');
    if (S.f.estado !== 'vencido') {
      const occ = M.ocurrenciasEnRango(abiertos, hoy, M.sumarDias(hoy, 120));
      let ultima = '';
      for (const o of occ) {
        if (o.fecha !== ultima) { html += `<h3 class="ag-grupo">${esc(M.formatoFechaLarga(o.fecha))}${o.fecha === hoy ? ' · Hoy' : ''}</h3>`; ultima = o.fecha; }
        html += filaAgenda(o.ev, o.fecha);
      }
      if (!occ.length && !vencidos.length) html = '<p class="ag-vacio">No hay actividades ni vencimientos pendientes con estos filtros.</p>';
    }
  }
  $('paneAgenda').innerHTML = `<div class="ag-lista">${html}</div>`;
}

// ---------- Vista: Recursos ----------

function renderRecursos() {
  const filas = S.recursos.map(r => `<div class="ag-fila ${r.activo === false ? 'gris' : 'verde'}">
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${esc(r.nombre)}</div><div class="ag-fila-sub">${esc(TIPOS_RECURSO[r.tipo] || r.tipo || '')}${r.activo === false ? ' · Inactivo' : ''}</div></div>
      <div class="ag-fila-acc"><button type="button" class="btn-secundario" data-rec-editar="${esc(r.id)}">Editar</button>
      <button type="button" class="btn-secundario" data-rec-estado="${esc(r.id)}">${r.activo === false ? 'Activar' : 'Desactivar'}</button></div></div>`).join('');
  $('paneRecursos').innerHTML = `<div class="ag-dia-cab"><h2 class="ag-h2" style="margin:0">Recursos reservables</h2><button type="button" class="btn-primario" id="btnNuevoRecurso">+ Nuevo recurso</button></div>
    <p class="ag-ayuda">Equipos de instalación, vehículos, personas, sala de reuniones o taller. Al asignarlos a una actividad, la agenda avisa si ya están ocupados. Los recursos no se eliminan: se desactivan.</p>
    ${filas || '<p class="ag-vacio">Aún no hay recursos. Crea el primero, por ejemplo “Equipo de instalación A”.</p>'}`;
}

// ---------- Render general ----------

function render() {
  document.querySelectorAll('.ag-tab').forEach(b => b.classList.toggle('activa', b.dataset.vista === S.vista));
  document.querySelectorAll('.ag-pane').forEach(p => p.style.display = (p.id === 'pane' + S.vista[0].toUpperCase() + S.vista.slice(1)) ? '' : 'none');
  $('agFiltros').style.display = S.vista === 'recursos' ? 'none' : '';
  ({ resumen: renderResumen, mes: renderMes, semana: renderSemana, agenda: renderAgenda, recursos: renderRecursos })[S.vista]();
}

function irA(vista) { S.vista = vista; render(); }

// ---------- Formulario de evento ----------

function llenarEstados(categoria, actual) {
  const sel = $('evEstado');
  sel.innerHTML = (M.ESTADOS_POR_CATEGORIA[categoria] || []).map(e => `<option value="${e}">${esc(M.ESTADOS[e].nombre)}</option>`).join('');
  sel.value = actual || M.estadoInicial(categoria);
}

function actualizarFormularioSegunCategoria() {
  const cat = $('evCategoria').value;
  $('evTipoWrap').style.display = cat === 'actividad' ? '' : 'none';
  $('evHorarioWrap').style.display = '';
  $('evRecursosWrap').style.display = cat === 'actividad' ? '' : 'none';
  if (!S.editandoId) {
    llenarEstados(cat);
    $('evAntic').value = String(M.ANTICIPACION_SUGERIDA[cat] ?? 1);
    actualizarAnticCustom();
  }
}
function actualizarRepeticion() {
  const k = $('evRepite').value;
  $('evCustomWrap').style.display = k === 'personalizada' ? '' : 'none';
  $('evUnidadWrap').style.display = k === 'personalizada' ? '' : 'none';
  $('evHastaWrap').style.display = k === 'unica' ? 'none' : '';
}
function actualizarAnticCustom() { $('evAnticCustomWrap').style.display = $('evAntic').value === 'otro' ? '' : 'none'; }
function actualizarHorario() {
  const td = $('evTodoDia').checked;
  $('evHoraIni').disabled = td; $('evHoraFin').disabled = td;
}

function abrirFormulario(ev = null, preset = {}) {
  S.editandoId = ev?.id || null;
  $('evError').classList.remove('visible'); $('evError').textContent = '';
  $('evModalTitulo').textContent = ev ? 'Editar evento' : 'Crear evento';
  $('btnGuardarEvento').textContent = ev ? 'Guardar cambios' : 'Crear evento';
  $('evCategoria').disabled = !!ev;

  const cat = ev?.categoria || preset.categoria || 'actividad';
  $('evCategoria').value = cat;
  $('evTipo').value = ev?.tipo || preset.tipo || 'visita_cliente';
  $('evTitulo').value = ev?.titulo || '';
  $('evPrioridad').value = ev?.prioridad || 'media';
  llenarEstados(cat, ev?.estado);
  $('evFecha').value = ev?.proximaFecha || preset.fecha || M.hoyStr();
  $('evTodoDia').checked = !!ev?.todoElDia;
  $('evHoraIni').value = ev?.horaInicio || preset.horaInicio || '';
  $('evHoraFin').value = ev?.horaFin || preset.horaFin || '';
  const rec = ev?.recurrencia || { frecuencia: 'ninguna', intervalo: 1 };
  const k = M.claveRepeticion(rec);
  $('evRepite').value = k;
  $('evIntervalo').value = rec.intervalo || 1;
  $('evUnidad').value = ['dias', 'semanas', 'meses', 'anios'].includes(rec.frecuencia) ? rec.frecuencia : 'dias';
  $('evHasta').value = rec.hasta || '';
  const ant = ev ? ev.anticipacionDias : (M.ANTICIPACION_SUGERIDA[cat] ?? 1);
  const estandar = M.ANTICIPACIONES.some(a => a.v === ant);
  $('evAntic').value = estandar ? String(ant) : 'otro';
  $('evAnticCustom').value = estandar ? '' : ant;
  $('evHabil').checked = !!ev?.avisarHabilAnterior;
  $('evResp').value = ev?.responsableUid ?? (ev ? '' : (S.staff?.uid || ''));
  $('evDescripcion').value = ev?.descripcion || '';
  $('evNotas').value = ev?.notas || '';

  const marcados = new Set(ev?.recursoIds || preset.recursoIds || []);
  const activos = S.recursos.filter(r => r.activo !== false || marcados.has(r.id));
  $('evRecursos').innerHTML = activos.map(r => `<label class="ag-check"><input type="checkbox" value="${esc(r.id)}" ${marcados.has(r.id) ? 'checked' : ''}> ${esc(r.nombre)}</label>`).join('')
    || '<span class="ag-ayuda">No hay recursos creados todavía (pestaña “Recursos”).</span>';

  actualizarFormularioSegunCategoria(); actualizarRepeticion(); actualizarAnticCustom(); actualizarHorario();
  $('modalEvento').classList.add('visible');
  setTimeout(() => $('evTitulo').focus(), 50);
}

function leerFormulario() {
  const cat = $('evCategoria').value;
  const k = $('evRepite').value;
  let recurrencia = { frecuencia: 'ninguna', intervalo: 1, hasta: null };
  if (k === 'personalizada') {
    recurrencia = { frecuencia: $('evUnidad').value, intervalo: Math.max(1, parseInt($('evIntervalo').value, 10) || 1), hasta: $('evHasta').value || null };
  } else if (k !== 'unica') {
    recurrencia = { ...M.REPETICIONES[k].regla, hasta: $('evHasta').value || null };
  }
  const antSel = $('evAntic').value;
  const anticipacionDias = antSel === 'otro' ? Math.max(0, parseInt($('evAnticCustom').value, 10) || 0) : parseInt(antSel, 10);
  const uid = $('evResp').value;
  const u = S.usuarios.find(x => x.uid === uid);
  const todo = $('evTodoDia').checked;
  const estado = $('evEstado').value;
  return {
    titulo: $('evTitulo').value.trim(),
    categoria: cat,
    tipo: cat === 'actividad' ? $('evTipo').value : null,
    prioridad: $('evPrioridad').value,
    estado, abierto: M.estaAbierto(estado),
    proximaFecha: $('evFecha').value,
    todoElDia: todo,
    horaInicio: todo ? null : ($('evHoraIni').value || null),
    horaFin: todo ? null : ($('evHoraFin').value || null),
    recurrencia, anticipacionDias,
    avisarHabilAnterior: $('evHabil').checked,
    responsableUid: uid || null,
    responsableNombre: u ? (u.nombre || u.email || '') : '',
    recursoIds: cat === 'actividad' ? [...$('evRecursos').querySelectorAll('input:checked')].map(i => i.value) : [],
    descripcion: $('evDescripcion').value.trim(),
    notas: $('evNotas').value.trim()
  };
}

function errorFormulario(msg) { const e = $('evError'); e.textContent = msg; e.classList.add('visible'); }

async function guardarEvento() {
  const d = leerFormulario();
  if (!d.titulo) return errorFormulario('Escribe un título.');
  if (!d.proximaFecha) return errorFormulario('Elige una fecha.');
  if (d.horaInicio && d.horaFin && d.horaFin <= d.horaInicio) return errorFormulario('La hora de término debe ser posterior a la de inicio.');
  if (d.recurrencia.hasta && d.recurrencia.hasta < d.proximaFecha) return errorFormulario('La fecha límite de la repetición no puede ser anterior a la fecha del evento.');

  if (d.categoria === 'actividad' && M.estaAbierto(d.estado)) {
    const conf = M.detectarConflictos({ fecha: d.proximaFecha, horaInicio: d.horaInicio, horaFin: d.horaFin, todoElDia: d.todoElDia, recursoIds: d.recursoIds, responsableUid: d.responsableUid }, S.eventos, S.editandoId);
    if (conf.length && !(await confirmarConflictos(conf))) return;
  }

  const btn = $('btnGuardarEvento'); btn.disabled = true;
  try {
    const por = { por: S.staff.uid, porNombre: nombreStaff() };
    if (!S.editandoId) {
      await crearEvento({ ...d, fecha: d.proximaFecha, diaAncla: M.partesFecha(d.proximaFecha).d, relacion: null, adjuntos: [] }, S.staff.uid, nombreStaff());
      toast('Evento creado');
    } else {
      const ev = S.eventos.find(e => e.id === S.editandoId);
      const cambioFecha = ev.proximaFecha !== d.proximaFecha;
      const cambioEstado = ev.estado !== d.estado;
      const datos = { ...d, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() };
      if (cambioFecha) datos.diaAncla = M.partesFecha(d.proximaFecha).d;
      delete datos.categoria;   // la categoría no cambia al editar
      const entrada = cambioFecha
        ? { tipo: 'reprogramado', fechaAnterior: ev.proximaFecha, fechaNueva: d.proximaFecha, estadoAnterior: ev.estado, estadoNuevo: d.estado, ...por }
        : cambioEstado
          ? { tipo: 'estado', estadoAnterior: ev.estado, estadoNuevo: d.estado, ...por }
          : { tipo: 'editado', ...por };
      await actualizarEvento(S.editandoId, datos, entrada);
      toast('Cambios guardados');
    }
    cerrarModal('modalEvento');
  } catch (e) {
    console.error(e);
    errorFormulario('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.');
  } finally { btn.disabled = false; }
}

// ---------- Conflictos ----------

let _resolverConflicto = null;
function confirmarConflictos(conflictos) {
  const rec = nombresRecursos();
  const vistos = new Set();
  const lineas = conflictos.filter(c => { const k = c.ev.id + c.motivo + (c.recursoId || ''); if (vistos.has(k)) return false; vistos.add(k); return true; }).map(c => {
    const iv = M.intervalo(c.ev); const h = iv ? `${M.desdeMinutos(iv[0])} y ${M.desdeMinutos(iv[1])}` : 'ese día';
    return c.motivo === 'recurso'
      ? `<li>El recurso «${esc(rec[c.recursoId] || 'seleccionado')}» ya está asignado a «${esc(c.ev.titulo)}» entre ${h}.</li>`
      : `<li>El responsable «${esc(c.ev.responsableNombre || 'seleccionado')}» ya tiene asignada la actividad «${esc(c.ev.titulo)}» entre ${h}.</li>`;
  }).join('');
  $('conflictoLista').innerHTML = lineas;
  $('modalConflicto').classList.add('visible');
  return new Promise(res => { _resolverConflicto = res; });
}
function resolverConflicto(v) { $('modalConflicto').classList.remove('visible'); _resolverConflicto?.(v); _resolverConflicto = null; }

// ---------- Detalle ----------

function fechaHoraTs(ts) { try { return ts?.toDate ? ts.toDate().toLocaleString('es-CL', { timeZone: M.ZONA }) : ''; } catch { return ''; } }

const ETIQ_HIST = { creado: 'Creado', estado: 'Cambio de estado', completado: 'Realizado', reprogramado: 'Reprogramado', editado: 'Editado', cancelado: 'Cancelado' };
function lineaHistorial(h) {
  const partes = [];
  if (h.estadoAnterior && h.estadoNuevo && h.estadoAnterior !== h.estadoNuevo) partes.push(`${esc(M.ESTADOS[h.estadoAnterior]?.nombre || h.estadoAnterior)} → ${esc(M.ESTADOS[h.estadoNuevo]?.nombre || h.estadoNuevo)}`);
  else if (h.estadoNuevo && h.tipo === 'creado') partes.push(esc(M.ESTADOS[h.estadoNuevo]?.nombre || h.estadoNuevo));
  if (h.fechaAnterior && h.fechaNueva) partes.push(`${esc(M.formatoFechaDMA(h.fechaAnterior))} → ${esc(M.formatoFechaDMA(h.fechaNueva))}`);
  if (h.tipo === 'completado') {
    if (h.fechaOcurrencia) partes.push(`ocurrencia del ${esc(M.formatoFechaDMA(h.fechaOcurrencia))}`);
    if (h.fechaReal) partes.push(`realizado el ${esc(M.formatoFechaDMA(h.fechaReal))}`);
    if (h.fechaNueva) partes.push(`próxima: ${esc(M.formatoFechaDMA(h.fechaNueva))}`);
  }
  if (h.nota) partes.push(`“${esc(h.nota)}”`);
  return `<div class="ag-hist"><b>${esc(ETIQ_HIST[h.tipo] || h.tipo)}</b> <span>${partes.join(' · ')}</span><small>${esc(h.porNombre || '')} · ${esc(fechaHoraTs(h.fecha))}</small></div>`;
}

function abrirDetalle(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  S.detalleId = id;
  pintarDetalle(ev);
  $('modalDetalle').classList.add('visible');
  S.pararHistorial?.();
  S.pararHistorial = escucharHistorialEvento(id, (lista) => { $('detHistorial').innerHTML = lista.map(lineaHistorial).join('') || '<p class="ag-vacio">Sin movimientos.</p>'; });
}

function pintarDetalle(ev) {
  const rec = nombresRecursos();
  const a = M.evaluarEvento(ev, M.hoyStr());
  const abierto = M.estaAbierto(ev.estado);
  const ant = M.ANTICIPACIONES.find(x => x.v === ev.anticipacionDias)?.t || `${ev.anticipacionDias} días antes`;
  const fila = (k, v) => v ? `<div class="ag-det-fila"><span>${k}</span><div>${v}</div></div>` : '';
  const opcionesEstado = (M.ESTADOS_POR_CATEGORIA[ev.categoria] || []).map(e => `<option value="${e}" ${e === ev.estado ? 'selected' : ''}>${esc(M.ESTADOS[e].nombre)}</option>`).join('');
  $('detContenido').innerHTML = `
    <div class="ag-det-cab"><span class="ag-codigo">${esc(ev.codigo || '')}</span>${badgeEstado(ev)}${badgePrioridad(ev)}</div>
    <h2>${iconoEv(ev)} ${esc(ev.titulo)}</h2>
    ${a ? `<p class="ag-det-alerta ${a.nivel === 'proximo' ? 'naranja' : 'rojo'}">${esc(a.texto)}</p>` : ''}
    ${fila('Cuándo', esc(M.formatoFechaLarga(ev.proximaFecha)) + (textoHora(ev) ? ' · ' + esc(textoHora(ev)) : ''))}
    ${fila('Categoría', esc(M.CATEGORIAS[ev.categoria]?.nombre || '') + (ev.tipo ? ' · ' + esc(M.TIPOS_ACTIVIDAD[ev.tipo]?.nombre || '') : ''))}
    ${fila('Repetición', esc(M.textoRegla(ev.recurrencia)) + (ev.recurrencia?.hasta ? ` (hasta ${esc(M.formatoFechaDMA(ev.recurrencia.hasta))})` : ''))}
    ${fila('Aviso', esc(ant) + (ev.avisarHabilAnterior ? ' · día hábil anterior si cae fin de semana' : ''))}
    ${fila('Responsable', esc(ev.responsableNombre))}
    ${fila('Recursos', (ev.recursoIds || []).map(id => esc(rec[id] || '—')).join(', '))}
    ${fila('Descripción', esc(ev.descripcion).replace(/\n/g, '<br>'))}
    ${fila('Notas', esc(ev.notas).replace(/\n/g, '<br>'))}
    ${fila('Última vez realizado', ev.ultimaRealizacion ? esc(M.formatoFechaDMA(ev.ultimaRealizacion)) : '')}
    ${fila('Creado', esc(ev.creadoPorNombre || '') + ' · ' + esc(fechaHoraTs(ev.creadoEn)))}
    ${fila('Última modificación', esc(ev.actualizadoPorNombre || '') + ' · ' + esc(fechaHoraTs(ev.actualizadoEn)))}
    <div class="ag-det-estado campo"><label for="detEstado">Cambiar estado</label><select id="detEstado">${opcionesEstado}</select></div>
    <div class="ag-det-acciones">
      ${abierto ? `<button type="button" class="btn-primario" data-det="completar">✓ Marcar realizado</button>
      <button type="button" class="btn-secundario" data-det="posponer">⏰ Posponer / reprogramar</button>` : ''}
      <button type="button" class="btn-secundario" data-det="editar">Editar</button>
      ${abierto ? `<button type="button" class="btn-peligro" data-det="cancelar">Cancelar evento</button>` : ''}
    </div>
    <h3 class="ag-h3">Historial</h3><div id="detHistorial" class="ag-hist-lista"></div>`;
}

// ---------- Completar / posponer / cancelar / estado ----------

let _accionId = null;

function abrirCompletar(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  _accionId = id;
  const rec = M.esRecurrente(ev);
  const sig = rec ? M.siguienteFecha(ev.proximaFecha, ev.recurrencia, ev.diaAncla) : null;
  $('cpFecha').value = M.hoyStr();
  $('cpNota').value = '';
  $('cpProximaWrap').style.display = sig ? '' : 'none';
  $('cpProxima').value = sig || '';
  $('cpTexto').textContent = rec
    ? (sig ? 'Esta ocurrencia quedará en el historial y se programa la siguiente.' : 'Era la última ocurrencia de la serie: el evento quedará como realizado.')
    : 'El evento quedará como realizado y se conserva en el historial.';
  $('cpError').textContent = ''; $('cpError').classList.remove('visible');
  $('modalCompletar').classList.add('visible');
}

async function confirmarCompletar() {
  const ev = S.eventos.find(e => e.id === _accionId); if (!ev) return;
  const fechaReal = $('cpFecha').value || M.hoyStr();
  const nota = $('cpNota').value.trim();
  const sigVisible = $('cpProximaWrap').style.display !== 'none';
  const sig = sigVisible ? $('cpProxima').value : '';
  if (sigVisible && !sig) { const e = $('cpError'); e.textContent = 'Indica la próxima fecha.'; e.classList.add('visible'); return; }
  const por = { por: S.staff.uid, porNombre: nombreStaff() };
  const btn = $('btnConfirmarCompletar'); btn.disabled = true;
  try {
    if (sig) {
      const estado = M.estadoReinicio(ev.categoria);
      await actualizarEvento(ev.id,
        { proximaFecha: sig, estado, abierto: true, ultimaRealizacion: fechaReal, diaAncla: ev.diaAncla || M.partesFecha(ev.proximaFecha).d, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
        { tipo: 'completado', fechaOcurrencia: ev.proximaFecha, fechaReal, fechaNueva: sig, estadoAnterior: ev.estado, estadoNuevo: estado, nota, ...por });
      toast('Registrado. Próxima fecha: ' + M.formatoFechaDMA(sig));
    } else {
      await actualizarEvento(ev.id,
        { estado: 'realizado', abierto: false, ultimaRealizacion: fechaReal, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
        { tipo: 'completado', fechaOcurrencia: ev.proximaFecha, fechaReal, estadoAnterior: ev.estado, estadoNuevo: 'realizado', nota, ...por });
      toast('Marcado como realizado');
    }
    cerrarModal('modalCompletar');
  } catch (e) { console.error(e); toast('No se pudo guardar', 'error'); }
  finally { btn.disabled = false; }
}

function abrirPosponer(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  _accionId = id;
  $('pmFecha').value = ev.proximaFecha;
  $('pmHora').value = ev.horaInicio || '';
  $('pmHoraWrap').style.display = ev.horaInicio && !ev.todoElDia ? '' : 'none';
  $('pmMotivo').value = '';
  $('pmError').textContent = ''; $('pmError').classList.remove('visible');
  $('modalPosponer').classList.add('visible');
}

async function confirmarPosponer() {
  const ev = S.eventos.find(e => e.id === _accionId); if (!ev) return;
  const nueva = $('pmFecha').value;
  if (!nueva) { const e = $('pmError'); e.textContent = 'Elige la nueva fecha.'; e.classList.add('visible'); return; }
  const datos = { proximaFecha: nueva, estado: ev.categoria === 'actividad' ? 'reprogramado' : 'pospuesto', abierto: true, diaAncla: M.partesFecha(nueva).d, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() };
  const horaNueva = $('pmHoraWrap').style.display !== 'none' ? $('pmHora').value : '';
  if (horaNueva && horaNueva !== ev.horaInicio) {
    const iv = M.intervalo(ev);
    datos.horaInicio = horaNueva;
    if (iv) datos.horaFin = M.desdeMinutos(Math.min(1439, M.aMinutos(horaNueva) + (iv[1] - iv[0])));
  }
  if (ev.categoria === 'actividad') {
    const conf = M.detectarConflictos({ fecha: nueva, horaInicio: datos.horaInicio ?? ev.horaInicio, horaFin: datos.horaFin ?? ev.horaFin, todoElDia: ev.todoElDia, recursoIds: ev.recursoIds, responsableUid: ev.responsableUid }, S.eventos, ev.id);
    if (conf.length && !(await confirmarConflictos(conf))) return;
  }
  const btn = $('btnConfirmarPosponer'); btn.disabled = true;
  try {
    await actualizarEvento(ev.id, datos, { tipo: 'reprogramado', fechaAnterior: ev.proximaFecha, fechaNueva: nueva, estadoAnterior: ev.estado, estadoNuevo: datos.estado, nota: $('pmMotivo').value.trim(), por: S.staff.uid, porNombre: nombreStaff() });
    toast('Reprogramado para el ' + M.formatoFechaDMA(nueva));
    cerrarModal('modalPosponer');
  } catch (e) { console.error(e); toast('No se pudo guardar', 'error'); }
  finally { btn.disabled = false; }
}

async function cancelarEvento(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  const msg = M.esRecurrente(ev) ? '¿Cancelar este evento? Se detiene toda la serie repetitiva (el historial se conserva).' : '¿Cancelar este evento? Queda en el historial como cancelado.';
  if (!confirm(msg)) return;
  try {
    await actualizarEvento(id, { estado: 'cancelado', abierto: false, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
      { tipo: 'cancelado', estadoAnterior: ev.estado, estadoNuevo: 'cancelado', por: S.staff.uid, porNombre: nombreStaff() });
    toast('Evento cancelado');
  } catch (e) { console.error(e); toast('No se pudo cancelar', 'error'); }
}

async function cambiarEstado(id, nuevo) {
  const ev = S.eventos.find(e => e.id === id); if (!ev || ev.estado === nuevo) return;
  if (nuevo === 'realizado' || nuevo === 'cancelado') {
    const sel = $('detEstado'); if (sel) sel.value = ev.estado;   // vuelve al estado actual hasta confirmar
    if (nuevo === 'realizado') abrirCompletar(id); else await cancelarEvento(id);
    return;
  }
  try {
    await actualizarEvento(id, { estado: nuevo, abierto: M.estaAbierto(nuevo), actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
      { tipo: 'estado', estadoAnterior: ev.estado, estadoNuevo: nuevo, por: S.staff.uid, porNombre: nombreStaff() });
    toast('Estado actualizado');
  } catch (e) { console.error(e); toast('No se pudo cambiar el estado', 'error'); }
}

// ---------- Recursos ----------

let _recEditando = null;
function abrirRecurso(id = null) {
  _recEditando = id;
  const r = S.recursos.find(x => x.id === id);
  $('rcNombre').value = r?.nombre || '';
  $('rcTipo').value = r?.tipo || 'equipo';
  $('rcError').textContent = ''; $('rcError').classList.remove('visible');
  $('modalRecurso').classList.add('visible');
}
async function guardarRecurso() {
  const nombre = $('rcNombre').value.trim();
  if (!nombre) { const e = $('rcError'); e.textContent = 'Escribe un nombre.'; e.classList.add('visible'); return; }
  try {
    if (_recEditando) await actualizarRecurso(_recEditando, { nombre, tipo: $('rcTipo').value });
    else await crearRecurso({ nombre, tipo: $('rcTipo').value }, S.staff.uid);
    cerrarModal('modalRecurso'); toast('Recurso guardado');
  } catch (e) { console.error(e); toast('No se pudo guardar el recurso', 'error'); }
}

// ---------- Modales ----------

function cerrarModal(id) {
  $(id).classList.remove('visible');
  if (id === 'modalDetalle') { S.pararHistorial?.(); S.pararHistorial = null; S.detalleId = null; }
}

// ---------- Eventos de la página ----------

function enlazar() {
  // Pestañas
  document.querySelectorAll('.ag-tab').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));

  // Filtros
  const filtro = (id, k) => $(id).addEventListener('change', () => { S.f[k] = $(id).value; render(); });
  filtro('fCat', 'cat'); filtro('fEstado', 'estado'); filtro('fPrio', 'prio'); filtro('fResp', 'resp');
  $('agBuscador').addEventListener('input', () => { S.f.q = $('agBuscador').value; render(); });
  $('btnLimpiarFiltros').addEventListener('click', () => {
    S.f = { cat: '', estado: '', prio: '', resp: '', q: '' };
    ['fCat', 'fEstado', 'fPrio', 'fResp'].forEach(id => { $(id).value = ''; });
    $('agBuscador').value = ''; render();
  });

  $('btnNuevoEvento').addEventListener('click', () => abrirFormulario(null, { fecha: S.vista === 'mes' ? S.diaSel : undefined }));

  // Delegación general sobre el contenedor de paneles
  $('agPaneles').addEventListener('click', (e) => {
    const t = e.target;
    const nav = t.closest('[data-nav]');
    if (nav) {
      const k = nav.dataset.nav;
      if (k === 'mes-') S.mesRef = M.sumarMeses(S.mesRef, -1, 1);
      else if (k === 'mes+') S.mesRef = M.sumarMeses(S.mesRef, 1, 1);
      else if (k === 'mes0') { S.mesRef = M.hoyStr().slice(0, 8) + '01'; S.diaSel = M.hoyStr(); }
      else if (k === 'sem-') S.semanaRef = M.sumarDias(S.semanaRef, -7);
      else if (k === 'sem+') S.semanaRef = M.sumarDias(S.semanaRef, 7);
      else if (k === 'sem0') { S.semanaRef = M.hoyStr(); S.diaSel = M.hoyStr(); }
      return render();
    }
    const ir = t.closest('[data-ir]');
    if (ir) { if (ir.dataset.estado) { S.f.estado = ir.dataset.estado; $('fEstado').value = ir.dataset.estado; } return irA(ir.dataset.ir); }
    const acc = t.closest('[data-accion]');
    if (acc) { e.stopPropagation(); return acc.dataset.accion === 'completar' ? abrirCompletar(acc.dataset.ev) : abrirPosponer(acc.dataset.ev); }
    const nd = t.closest('[data-nuevo-dia]');
    if (nd) return abrirFormulario(null, { fecha: nd.dataset.nuevoDia });
    const ev = t.closest('[data-ev]');
    if (ev) return abrirDetalle(ev.dataset.ev);
    if (t.closest('#btnNuevoRecurso')) return abrirRecurso();
    const re = t.closest('[data-rec-editar]'); if (re) return abrirRecurso(re.dataset.recEditar);
    const rs = t.closest('[data-rec-estado]');
    if (rs) { const r = S.recursos.find(x => x.id === rs.dataset.recEstado); return actualizarRecurso(r.id, { activo: r.activo === false }).then(() => toast(r.activo === false ? 'Recurso activado' : 'Recurso desactivado')).catch(() => toast('No se pudo cambiar', 'error')); }

    // Mes: clic en celda o "+N más" selecciona el día
    const dia = t.closest('.ag-celda, .ag-mas, .ag-sem-cab');
    if (dia?.dataset.dia) { S.diaSel = dia.dataset.dia; return render(); }
  });

  // Semana: clic en espacio libre de una columna → crear evento a esa hora
  $('agPaneles').addEventListener('click', (e) => {
    const col = e.target.closest('.ag-sem-col');
    if (!col || e.target.closest('.ag-bloque')) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const minutos = Math.floor((HORA_INI * 60 + (y / ALTO_HORA) * 60) / 30) * 30;
    abrirFormulario(null, { fecha: col.dataset.dia, horaInicio: M.desdeMinutos(minutos), horaFin: M.desdeMinutos(minutos + 60) });
  });
  $('agPaneles').addEventListener('change', (e) => { if (e.target.id === 'semRecurso') { S.semRecurso = e.target.value; render(); } });

  // Formulario
  $('evCategoria').addEventListener('change', actualizarFormularioSegunCategoria);
  $('evRepite').addEventListener('change', actualizarRepeticion);
  $('evAntic').addEventListener('change', actualizarAnticCustom);
  $('evTodoDia').addEventListener('change', actualizarHorario);
  $('formEvento').addEventListener('submit', (e) => { e.preventDefault(); guardarEvento(); });
  $('btnCancelarEvento').addEventListener('click', () => cerrarModal('modalEvento'));

  // Detalle
  $('detContenido').addEventListener('click', (e) => {
    const b = e.target.closest('[data-det]'); if (!b) return;
    const id = S.detalleId; const a = b.dataset.det;
    if (a === 'editar') { const ev = S.eventos.find(x => x.id === id); cerrarModal('modalDetalle'); abrirFormulario(ev); }
    else if (a === 'completar') abrirCompletar(id);
    else if (a === 'posponer') abrirPosponer(id);
    else if (a === 'cancelar') cancelarEvento(id);
  });
  $('detContenido').addEventListener('change', (e) => { if (e.target.id === 'detEstado') { cambiarEstado(S.detalleId, e.target.value); } });
  $('btnCerrarDetalle').addEventListener('click', () => cerrarModal('modalDetalle'));

  // Completar / posponer / conflicto / recurso
  $('btnConfirmarCompletar').addEventListener('click', confirmarCompletar);
  $('btnCancelarCompletar').addEventListener('click', () => cerrarModal('modalCompletar'));
  $('btnConfirmarPosponer').addEventListener('click', confirmarPosponer);
  $('btnCancelarPosponer').addEventListener('click', () => cerrarModal('modalPosponer'));
  $('btnConflictoVolver').addEventListener('click', () => resolverConflicto(false));
  $('btnConflictoForzar').addEventListener('click', () => resolverConflicto(true));
  $('btnGuardarRecurso').addEventListener('click', guardarRecurso);
  $('btnCancelarRecurso').addEventListener('click', () => cerrarModal('modalRecurso'));

  // Cerrar modales al hacer clic fuera / Escape
  document.querySelectorAll('.agenda-modal').forEach(m => m.addEventListener('mousedown', (e) => {
    if (e.target === m && m.id !== 'modalConflicto') cerrarModal(m.id);
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.agenda-modal.visible').forEach(m => { if (m.id === 'modalConflicto') resolverConflicto(false); else cerrarModal(m.id); });
  });

  // Menú lateral en teléfono. Se alternan varias clases habituales además de la propia,
  // para convivir con el CSS del panel (dashboard.css) sin depender de dashboard.js.
  const alternar = (abrir) => {
    document.body.classList.toggle('agenda-menu-abierto', abrir);
    ['dashSidebar', 'sidebarOverlay'].forEach(id => ['abierto', 'open', 'visible', 'activo'].forEach(c => $(id)?.classList.toggle(c, abrir)));
  };
  $('btnAbrirSidebar')?.addEventListener('click', () => alternar(true));
  $('btnCerrarSidebar')?.addEventListener('click', () => alternar(false));
  $('sidebarOverlay')?.addEventListener('click', () => alternar(false));
}

// ---------- Datos en vivo ----------

function intentarDeepLink() {
  if (S.deepLinkHecho || !S.eventos.length) return;
  const p = new URLSearchParams(location.search);
  const id = p.get('evento');
  if (id && S.eventos.some(e => e.id === id)) { S.deepLinkHecho = true; abrirDetalle(id); }
  else if (p.get('nuevo') === '1') { S.deepLinkHecho = true; abrirFormulario(null, { fecha: p.get('fecha') || undefined }); }
}

function refrescarSiAplica() {
  render();
  if (S.detalleId) {
    const ev = S.eventos.find(e => e.id === S.detalleId);
    if (ev && !document.activeElement?.closest('#detContenido')) { const h = $('detHistorial')?.innerHTML; pintarDetalle(ev); if (h) $('detHistorial').innerHTML = h; }
    else if (!ev) cerrarModal('modalDetalle');
  }
}

async function iniciar(staff) {
  S.staff = staff;
  $('staffNombre').textContent = staff.nombre || staff.email || '—';
  $('staffRol').textContent = staff.rol || '—';
  $('btnCerrarSesion').addEventListener('click', async () => { await cerrarSesion(); location.href = 'login.html'; });

  // Estructura estática (listas de opciones)
  $('fCat').innerHTML = '<option value="">Todas las categorías</option>' + Object.entries(M.CATEGORIAS).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  const todosEstados = [...new Set(Object.values(M.ESTADOS_POR_CATEGORIA).flat())];
  $('fEstado').innerHTML = '<option value="">Todos los estados</option><option value="vencido">Vencidos</option>' + todosEstados.map(k => `<option value="${k}">${M.ESTADOS[k].nombre}</option>`).join('');
  $('fPrio').innerHTML = '<option value="">Todas las prioridades</option>' + Object.entries(M.PRIORIDADES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('evCategoria').innerHTML = Object.entries(M.CATEGORIAS).map(([k, v]) => `<option value="${k}">${v.icono} ${v.nombre}</option>`).join('');
  $('evTipo').innerHTML = Object.entries(M.TIPOS_ACTIVIDAD).map(([k, v]) => `<option value="${k}">${v.icono} ${v.nombre}</option>`).join('');
  $('evPrioridad').innerHTML = Object.entries(M.PRIORIDADES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('evRepite').innerHTML = Object.entries(M.REPETICIONES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('evAntic').innerHTML = M.ANTICIPACIONES.map(a => `<option value="${a.v}">${a.t}</option>`).join('') + '<option value="otro">Personalizado…</option>';
  $('rcTipo').innerHTML = Object.entries(TIPOS_RECURSO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  try { S.usuarios = await listarUsuariosStaff(); } catch (e) { console.warn('No se pudo cargar la lista de responsables', e); }
  const optsResp = S.usuarios.map(u => `<option value="${esc(u.uid)}">${esc(u.nombre || u.email || u.uid)}</option>`).join('');
  $('fResp').innerHTML = '<option value="">Todos los responsables</option>' + optsResp;
  $('evResp').innerHTML = '<option value="">Sin asignar</option>' + optsResp;

  enlazar();
  await mejorarSelects(['fCat', 'fEstado', 'fPrio', 'fResp', 'evCategoria', 'evTipo', 'evPrioridad', 'evRepite', 'evUnidad', 'evAntic', 'evResp', 'rcTipo']);

  escucharRecursos((lista) => { S.recursos = lista; refrescarSiAplica(); }, () => toast('No se pudieron leer los recursos', 'error'));
  escucharEventos((lista) => { S.eventos = lista; refrescarSiAplica(); intentarDeepLink(); }, () => toast('No se pudo leer la agenda. Revisa que las reglas de Firestore incluyan "eventos".', 'error'));
  render();
}

function mostrarLayout() {
  $('dashCargando').style.display = 'none';
  $('dashLayout').style.display = 'flex';
  const top = $('dashTopbarMobile');
  const mq = window.matchMedia('(max-width: 900px)');
  const ajustar = () => { top.style.display = mq.matches ? 'flex' : 'none'; };
  ajustar(); mq.addEventListener?.('change', ajustar);
}

observarSesionStaff((staff) => {
  if (!staff) { location.href = 'login.html'; return; }
  if (S.staff) return;          // la sesión ya estaba iniciada
  mostrarLayout();
  iniciar(staff);
});
