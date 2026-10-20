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
  crearRecurso, actualizarRecurso, escucharProyectos, escucharLeads,
  escucharColaboradores, crearColaborador, actualizarColaborador,
  escucharVehiculos, crearVehiculo, actualizarVehiculo, registrarKilometraje,
  escucharMantencionesVehiculo, escucharGastosVehiculo, crearGastoVehiculo, registrarMantencionVehiculo,
  escucharConfigAgenda, guardarConfigAgenda
} from './firestore.js';
import { formatearDireccion } from './regiones-comunas.js';
import * as M from './agenda-motor.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const HORA_INI = 7, HORA_FIN = 20, ALTO_HORA = 48;   // rejilla semanal 07:00–20:00
const TIPOS_RECURSO = { persona: 'Persona', equipo: 'Equipo de instalación', vehiculo: 'Vehículo', sala: 'Sala de reuniones', taller: 'Taller', otro: 'Otro' };

const S = {
  staff: null, eventos: [], recursos: [], usuarios: [], proyectos: [], proyectosPorCodigo: {}, autoConfig: M.normalizarAutomatizaciones(null), autoTipo: null, leadsPorId: {}, leadsListos: false, leadFormId: null, tituloAuto: '', deepLinkNuevoHecho: false, colaboradores: [], colabEditando: null, vehiculos: [], vehEditando: null, vehKm: null, vehGasto: null, planEditando: null, mantencionId: null, hvId: null, hvMant: [], hvGastos: [], hvPararM: null, hvPararG: null,
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

// ---------- Proyecto vinculado (se lee en vivo, nunca se copia) ----------

const proyecto = (codigo) => (codigo ? S.proyectosPorCodigo[codigo] || null : null);
const telefonoProyecto = (p) => p?.telefono || p?.fono || p?.celular || '';
const etiquetaProyecto = (codigo) => { const p = proyecto(codigo); return p ? `${codigo} — ${p.cliente || ''}` : codigo; };

function bloqueProyecto(codigo) {
  if (!codigo) return '';
  const p = proyecto(codigo);
  const enlace = `<a href="dashboard.html?codigo=${encodeURIComponent(codigo)}">${esc(codigo)}</a>`;
  if (!p) return `<div class="ag-proy"><div class="ag-proy-cab">${enlace}</div><small>No se encontró el proyecto (¿se cargó la lista?).</small></div>`;
  const dir = (p.direccion && typeof p.direccion === 'object') ? formatearDireccion(p.direccion) : (p.direccion || '');
  const tel = telefonoProyecto(p);
  return `<div class="ag-proy">
    <div class="ag-proy-cab">${enlace} · ${esc(p.cliente || '')}</div>
    ${p.tipoProyecto ? `<div>${esc(p.tipoProyecto)}</div>` : ''}
    ${tel ? `<div>📞 <a href="tel:${esc(tel)}">${esc(tel)}</a></div>` : ''}
    ${dir ? `<div>📍 ${esc(dir)}</div>` : ''}
    ${!tel && !dir ? '<small>El proyecto aún no tiene teléfono ni dirección registrados.</small>' : ''}</div>`;
}

// ---------- Cliente (lead) vinculado: actividades agendadas desde el CRM (se lee en vivo, nunca se copia) ----------

const lead = (id) => (id ? S.leadsPorId[id] || null : null);
const etiquetaLead = (id) => { const l = lead(id); return l ? `${l.codigoLead ? l.codigoLead + ' — ' : ''}${l.nombre || ''}` : 'Cliente'; };

function bloqueLead(id) {
  if (!id) return '';
  const l = lead(id);
  if (!l) return `<div class="ag-proy"><div class="ag-proy-cab">Cliente</div><small>No se encontró el cliente (¿se cargó la lista?).</small></div>`;
  const dir = (l.direccion && typeof l.direccion === 'object') ? formatearDireccion(l.direccion) : (l.direccion || '');
  const tel = l.telefono || '';
  return `<div class="ag-proy">
    <div class="ag-proy-cab">${l.codigoLead ? esc(l.codigoLead) + ' · ' : ''}${esc(l.nombre || '')} <small>(en CRM)</small></div>
    ${l.tipoProyecto ? `<div>${esc(l.tipoProyecto)}</div>` : ''}
    ${tel ? `<div>📞 <a href="tel:${esc(tel)}">${esc(tel)}</a></div>` : ''}
    ${dir ? `<div>📍 ${esc(dir)}</div>` : ''}
    ${!tel && !dir ? '<small>El cliente aún no tiene teléfono ni dirección registrados.</small>' : ''}</div>`;
}

/** Texto del proyecto o cliente vinculado para buscar (código + nombre). */
const textoProyecto = (ev) => ev.proyectoCodigo ? `${ev.proyectoCodigo} ${proyecto(ev.proyectoCodigo)?.cliente || ''}`
  : ev.leadId ? `${lead(ev.leadId)?.codigoLead || ''} ${lead(ev.leadId)?.nombre || ''}` : '';

/** Número de un campo del formulario (vacío → null). */
const num = (id) => { const v = $(id).value; return v === '' ? null : Number(v); };

/** Texto corto con los datos propios de la categoría (monto, cuota, edad…). */
function resumenDatos(ev) {
  if (M.esPago(ev)) {
    const mo = M.montoEvento(ev);
    const c = ev.categoria === 'obligacion' ? M.estadoCuotas(ev) : null;
    return [mo ? M.formatoMonto(mo.monto, mo.moneda) : '', c ? `cuota ${c.siguiente}/${c.total}` : ''].filter(Boolean).join(' · ');
  }
  if (ev.categoria === 'cumpleanos') return M.textoCumple(ev);
  if (ev.categoria === 'vehiculo') {
    const v = M.vehiculoDe(ev), r = M.restanteKm(ev);
    const km = M.mantencionUsaKm(ev) && r != null ? (r > 0 ? `faltan ${M.formatoKm(r)}` : 'kilometraje alcanzado') : '';
    return [v?.patente, km].filter(Boolean).join(' · ');
  }
  return '';
}

const etiquetaCompletar = (ev) => M.esMantencion(ev) ? '🔧 Registrar mantención' : ev.categoria === 'vehiculo' ? '✓ Marcar como renovado' : M.esPago(ev) ? '💳 Registrar pago' : ev.categoria === 'cumpleanos' ? '✓ Marcar como saludado' : '✓ Marcar realizado';

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
    if (qn && !M.textoBuscable(ev, nombres, textoProyecto(ev)).includes(qn)) return false;
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
    <button type="button" class="ag-mini" data-accion="completar" data-ev="${esc(ev.id)}" title="${M.esPago(ev) ? 'Registrar pago' : 'Marcar como realizado'}">${M.esPago(ev) ? '💳' : '✓'}</button>
    <button type="button" class="ag-mini" data-accion="posponer" data-ev="${esc(ev.id)}" title="Posponer / reprogramar">⏰</button>` : '';
  const sub = [M.CATEGORIAS[ev.categoria]?.nombre, M.TIPOS_ACTIVIDAD[ev.tipo]?.nombre, resumenDatos({ ...ev, proximaFecha: fecha }), ev.proyectoCodigo ? etiquetaProyecto(ev.proyectoCodigo) : (ev.leadId ? etiquetaLead(ev.leadId) : ''), ev.responsableNombre].filter(Boolean).map(esc).join(' · ');
  return `<div class="ag-fila ${M.colorEvento({ ...ev, proximaFecha: fecha })}" data-ev="${esc(ev.id)}">
    <div class="ag-fila-hora">${esc(textoHora(ev)) || (fecha ? '—' : esc(M.cuandoCorto(ev)))}</div>
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

  const tarjeta = (n, t, cls, vista, estado, chico) =>
    `<button type="button" class="ag-card ${cls}" data-ir="${vista}" data-estado="${estado || ''}"><span class="n ${chico ? 'monto' : ''}">${n}</span><span class="t">${t}</span></button>`;

  const cumples30 = M.ocurrenciasEnRango(abiertos.filter(e => e.categoria === 'cumpleanos'), hoy, M.sumarDias(hoy, 30)).length;
  const { y: yh, m: mh } = M.partesFecha(hoy);
  const pagosMes = M.ocurrenciasEnRango(abiertos.filter(M.esPago), M.armarFecha(yh, mh, 1), M.armarFecha(yh, mh, M.diasDelMes(yh, mh))).map(o => ({ ...o.ev, proximaFecha: o.fecha }));

  const atencion = alertas.slice(0, 8).map(a => `<div class="ag-fila ${a.nivel === 'proximo' ? 'naranja' : 'rojo'}" data-ev="${esc(a.ev.id)}">
      <div class="ag-fila-hora">${esc(M.cuandoCorto(a.ev))}</div>
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${iconoEv(a.ev)} ${esc(a.ev.titulo)}</div><div class="ag-fila-sub">${esc([a.texto, resumenDatos(a.ev)].filter(Boolean).join(' · '))}</div></div>
      <div class="ag-fila-tags">${badgePrioridad(a.ev)}</div></div>`).join('');

  const prox = M.ocurrenciasEnRango(abiertos, hoy, M.sumarDias(hoy, 45)).slice(0, 8).map(o => `<div class="ag-fila ${M.colorEvento({ ...o.ev, proximaFecha: o.fecha })}" data-ev="${esc(o.ev.id)}">
      <div class="ag-fila-hora">${esc(M.formatoFechaCorta(o.fecha))}<br><small>${esc(textoHora(o.ev))}</small></div>
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${iconoEv(o.ev)} ${esc(o.ev.titulo)}</div><div class="ag-fila-sub">${esc(resumenDatos({ ...o.ev, proximaFecha: o.fecha }) || o.ev.responsableNombre || '')}</div></div>
      <div class="ag-fila-tags">${badgeEstado(o.ev)}</div></div>`).join('');

  $('paneResumen').innerHTML = `
    <div class="ag-cards">
      ${tarjeta(vencidos, '🔴 Vencidos', 'rojo', 'agenda', 'vencido')}
      ${tarjeta(n7, '🟠 Próximos 7 días', 'naranja', 'agenda')}
      ${tarjeta(n30, '🟡 Próximos 30 días', 'amarillo', 'agenda')}
      ${tarjeta(semana, '📆 Actividades esta semana', 'neutro', 'semana')}
      ${tarjeta(cumples30, '🎂 Cumpleaños próximos (30 días)', 'neutro', 'cumpleanos')}
      ${tarjeta(sumarPorMoneda(pagosMes), '💳 Por pagar este mes', 'neutro', 'pagos', '', true)}
      ${tarjeta(alertas.filter(a => a.ev.categoria === 'vehiculo').length, '🚗 Vehículos con alerta', alertas.some(a => a.ev.categoria === 'vehiculo' && a.nivel !== 'proximo') ? 'rojo' : 'neutro', 'vehiculos')}
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
    const vencidos = abiertos.filter(e => e.proximaFecha && e.proximaFecha < hoy).sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));
    const porKm = S.f.estado === 'vencido' ? [] : M.alertasPendientes(abiertos.filter(e => !e.proximaFecha));
    if (porKm.length) html += `<h3 class="ag-grupo rojo">🚗 Mantenciones por kilometraje con alerta (${porKm.length})</h3>` + porKm.map(a => filaAgenda(a.ev, null)).join('');
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

// ---------- Vista: Pagos y vencimientos ----------

/** Suma de montos por moneda: "$1.250.000 + UF 12". */
function sumarPorMoneda(lista) {
  const t = {};
  for (const ev of lista) { const m = M.montoEvento(ev); if (m) t[m.moneda] = (t[m.moneda] || 0) + m.monto; }
  return Object.entries(t).map(([mon, v]) => M.formatoMonto(v, mon)).join(' + ') || '$0';
}

function filaPago(ev) {
  const color = M.colorEvento(ev);
  const mo = M.montoEvento(ev);
  const c = ev.categoria === 'obligacion' ? M.estadoCuotas(ev) : null;
  const a = M.evaluarEvento(ev, M.hoyStr());
  const quien = ev.categoria === 'servicio' ? ev.datos?.proveedor : ev.datos?.institucion;
  const sub = [quien, M.textoRegla(ev.recurrencia), ev.responsableNombre].filter(Boolean).map(esc).join(' · ');
  const barra = c ? `<div class="ag-barra"><i style="width:${Math.round(c.pagadas / c.total * 100)}%"></i></div><div class="ag-fila-sub">${c.pagadas} de ${c.total} cuotas pagadas · quedan ${c.restantes}</div>` : '';
  return `<div class="ag-fila ${color}" data-ev="${esc(ev.id)}">
    <div class="ag-fila-hora">${esc(M.formatoFechaCorta(ev.proximaFecha))}<br><small>${esc(a?.texto || '')}</small></div>
    <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${iconoEv(ev)} ${esc(ev.titulo)}</div><div class="ag-fila-sub">${sub}</div>${barra}</div>
    <div class="ag-fila-monto">${mo ? esc(M.formatoMonto(mo.monto, mo.moneda)) : '<small>Monto variable</small>'}</div>
    <div class="ag-fila-tags">${badgeEstado(ev)}</div>
    <div class="ag-fila-acc"><button type="button" class="ag-mini" data-accion="completar" data-ev="${esc(ev.id)}" title="Registrar pago">💳</button></div></div>`;
}

function renderPagos() {
  const hoy = M.hoyStr();
  const { y, m } = M.partesFecha(hoy);
  const ini = M.armarFecha(y, m, 1), fin = M.armarFecha(y, m, M.diasDelMes(y, m));
  const sigIni = M.sumarDias(fin, 1); const { y: y2, m: m2 } = M.partesFecha(sigIni);
  const sigFin = M.armarFecha(y2, m2, M.diasDelMes(y2, m2));
  const abiertos = eventosFiltrados().filter(e => M.esPago(e) && M.estaAbierto(e.estado));
  const comoEv = (o) => ({ ...o.ev, proximaFecha: o.fecha });
  const delMes = M.ocurrenciasEnRango(abiertos, ini, fin).map(comoEv);
  const delSig = M.ocurrenciasEnRango(abiertos, sigIni, sigFin).map(comoEv);
  const vencidos = abiertos.filter(e => e.proximaFecha < hoy);
  const lista = abiertos.slice().sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));
  const sinMonto = abiertos.filter(e => !M.montoEvento(e)).length;

  $('panePagos').innerHTML = `
    <div class="ag-cards ag-cards-pagos">
      <div class="ag-card rojo static"><span class="n monto">${esc(sumarPorMoneda(vencidos))}</span><span class="t">🔴 Vencido (${vencidos.length})</span></div>
      <div class="ag-card naranja static"><span class="n monto">${esc(sumarPorMoneda(delMes))}</span><span class="t">🟠 Por pagar este mes (${delMes.length})</span></div>
      <div class="ag-card neutro static"><span class="n monto">${esc(sumarPorMoneda(delSig))}</span><span class="t">📅 Mes siguiente (${delSig.length})</span></div>
    </div>
    ${sinMonto ? `<p class="ag-ayuda">${sinMonto} ${sinMonto === 1 ? 'pago no tiene' : 'pagos no tienen'} monto fijo y no suma${sinMonto === 1 ? '' : 'n'} en los totales.</p>` : ''}
    <div class="ag-dia-cab" style="margin-top:18px"><h2 class="ag-h2" style="margin:0">Servicios, suscripciones y créditos</h2>
      <span><button type="button" class="btn-secundario" data-nueva-cat="servicio">+ Servicio</button> <button type="button" class="btn-secundario" data-nueva-cat="obligacion">+ Crédito</button></span></div>
    ${lista.map(filaPago).join('') || '<p class="ag-vacio">Aún no hay servicios ni créditos registrados. Crea el primero con “+ Servicio” o “+ Crédito”.</p>'}
    <p class="ag-ayuda">Al registrar un pago, queda en el historial del servicio o crédito y la agenda programa el siguiente vencimiento. Los totales solo suman pagos con monto fijo.</p>`;
}

// ---------- Vista: Cumpleaños y aniversarios ----------

function renderCumpleanos() {
  const hoy = M.hoyStr();
  const evs = eventosFiltrados().filter(e => e.categoria === 'cumpleanos' && M.estaAbierto(e.estado));
  const vencidos = evs.filter(e => e.proximaFecha < hoy).sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));
  const occ = M.ocurrenciasEnRango(evs, hoy, M.sumarDias(hoy, 364));
  let html = '';
  if (vencidos.length) html += `<h3 class="ag-grupo rojo">🔴 Sin saludar (${vencidos.length})</h3>` + vencidos.map(e => filaAgenda(e, e.proximaFecha)).join('');
  let mesAct = '';
  for (const o of occ) {
    const { y, m } = M.partesFecha(o.fecha);
    const clave = `${M.NOMBRES_MES[m - 1]} ${y}`;
    if (clave !== mesAct) { html += `<h3 class="ag-grupo">${esc(clave)}</h3>`; mesAct = clave; }
    html += filaAgenda(o.ev, o.fecha);
  }
  $('paneCumpleanos').innerHTML = `
    <div class="ag-dia-cab"><h2 class="ag-h2" style="margin:0">Próximos 12 meses</h2>
      <button type="button" class="btn-secundario" data-nueva-cat="cumpleanos">+ Cumpleaños / aniversario</button></div>
    ${html || '<p class="ag-vacio">Aún no hay cumpleaños ni aniversarios. Puedes crearlos aquí o, más rápido, desde la pestaña Colaboradores.</p>'}`;
}

// ---------- Vista: Vehículos ----------

const veh = (id) => S.vehiculos.find(v => v.id === id) || null;
const fechaTs = (ts) => { try { return ts?.toDate ? M.formatoFechaDMA(M.hoyStr(ts.toDate())) : ''; } catch { return ''; } };

function filaPlan(ev) {
  const color = M.colorEvento(ev);
  const mant = M.esMantencion(ev);
  let detalle = '', barra = '';
  if (mant) {
    const d = ev.datos, r = M.restanteKm(ev), v = M.vehiculoDe(ev);
    if (M.mantencionUsaKm(ev)) {
      detalle = `Próxima: ${M.formatoKm(d.proximoKm)}` + (r != null ? (r > 0 ? ` · faltan ${M.formatoKm(r)}` : ' · kilometraje alcanzado') : '');
      const span = Number(d.proximoKm) - Number(d.ultimoKm);
      if (v && span > 0 && Number.isFinite(Number(v.kmActual))) {
        const pct = Math.max(0, Math.min(100, Math.round((Number(v.kmActual) - Number(d.ultimoKm)) / span * 100)));
        barra = `<div class="ag-barra ${color}"><i style="width:${pct}%"></i></div>`;
      }
    }
    if (ev.proximaFecha && M.modoUsaFecha(d.modo)) detalle += (detalle ? ' · ' : 'Próxima: ') + M.formatoFechaDMA(ev.proximaFecha);
    if (d.ultimoKm != null) detalle += ` · última a los ${M.formatoKm(d.ultimoKm)}`;
  } else {
    detalle = `Vence ${ev.proximaFecha ? M.formatoFechaDMA(ev.proximaFecha) : '—'}${M.esRecurrente(ev) ? ' · se renueva cada año' : ''}`;
  }
  return `<div class="ag-fila ${color}" data-ev="${esc(ev.id)}">
    <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${mant ? '🔧' : '📄'} ${esc(ev.datos?.nombre || ev.titulo)}</div><div class="ag-fila-sub">${esc(detalle)}</div>${barra}</div>
    <div class="ag-fila-tags">${badgeEstado(ev)}</div>
    <div class="ag-fila-acc"><button type="button" class="ag-mini" data-accion="completar" data-ev="${esc(ev.id)}" title="${mant ? 'Registrar mantención' : 'Marcar como renovado'}">${mant ? '🔧' : '✓'}</button></div></div>`;
}

function renderVehiculos() {
  const hoy = M.hoyStr();
  const planes = S.eventos.filter(e => e.categoria === 'vehiculo' && M.estaAbierto(e.estado));
  const conAlerta = M.alertasPendientes(planes, hoy);
  const tarjetas = S.vehiculos.map(v => {
    const propios = planes.filter(e => e.vehiculoId === v.id)
      .sort((a, b) => (M.esMantencion(b) - M.esMantencion(a)) || String(a.titulo).localeCompare(String(b.titulo)));
    const alertas = conAlerta.filter(a => a.ev.vehiculoId === v.id).length;
    const modelo = [v.marca, v.modelo, v.anio].filter(Boolean).join(' ');
    return `<div class="ag-veh ${v.activo === false ? 'inactivo' : ''}">
      <div class="ag-veh-cab">
        <div><div class="ag-veh-pat">${esc(v.patente)} ${alertas ? `<span class="ag-badge rojo">${alertas} ${alertas === 1 ? 'alerta' : 'alertas'}</span>` : ''}${v.activo === false ? '<span class="ag-badge gris">Inactivo</span>' : ''}</div>
          <div class="ag-veh-mod">${esc(modelo)}${v.responsableNombre ? ' · ' + esc(v.responsableNombre) : ''}</div></div>
        <div class="ag-veh-km"><b>${v.kmActual != null && v.kmActual !== '' ? esc(M.formatoKm(v.kmActual)) : 'Sin kilometraje'}</b>
          <small>${v.kmActualizadoEn ? 'actualizado ' + esc(fechaTs(v.kmActualizadoEn)) : ''}</small>
          <button type="button" class="btn-secundario" data-veh-km="${esc(v.id)}">Actualizar km</button></div>
      </div>
      <div class="ag-veh-acciones">
        <button type="button" class="btn-secundario" data-veh-plan="${esc(v.id)}:mantencion">+ Mantención</button>
        <button type="button" class="btn-secundario" data-veh-plan="${esc(v.id)}:documento">+ Documento</button>
        <button type="button" class="btn-secundario" data-veh-hist="${esc(v.id)}">Historial y gastos</button>
        <button type="button" class="btn-secundario" data-veh-editar="${esc(v.id)}">Editar</button>
        <button type="button" class="btn-secundario" data-veh-estado="${esc(v.id)}">${v.activo === false ? 'Activar' : 'Desactivar'}</button>
      </div>
      ${propios.map(filaPlan).join('') || '<p class="ag-vacio">Sin mantenciones ni documentos programados. Agrega el cambio de aceite, la revisión técnica, el SOAP…</p>'}
    </div>`;
  }).join('');
  $('paneVehiculos').innerHTML = `<div class="ag-dia-cab"><h2 class="ag-h2" style="margin:0">Vehículos</h2><button type="button" class="btn-primario" id="btnNuevoVehiculo">+ Nuevo vehículo</button></div>
    <p class="ag-ayuda">Las mantenciones se controlan principalmente por kilometraje: mantén el kilometraje al día con “Actualizar km” y la agenda avisa cuando se acerca o se alcanza. Los documentos (permiso, SOAP, revisión técnica…) se controlan por fecha.</p>
    ${tarjetas || '<p class="ag-vacio">Aún no hay vehículos. Crea el primero, por ejemplo la camioneta de Linence.</p>'}`;
}

// ---------- Vista: Colaboradores (solo administradores) ----------

function renderColaboradores() {
  const filas = S.colaboradores.map(c => {
    const fam = (c.familiares || []).length;
    const datos = [c.cargo, c.fechaNacimiento ? 'Nac. ' + M.formatoFechaDMA(c.fechaNacimiento) : '', c.fechaIngreso ? 'Ingreso ' + M.formatoFechaDMA(c.fechaIngreso) : '', fam ? `${fam} familiar${fam === 1 ? '' : 'es'}` : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="ag-fila ${c.activo === false ? 'gris' : 'verde'}">
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${esc(c.nombre)}${c.activo === false ? ' · Inactivo' : ''}</div><div class="ag-fila-sub">${datos}</div></div>
      <div class="ag-fila-acc"><button type="button" class="btn-secundario" data-colab-editar="${esc(c.id)}">Editar</button>
      <button type="button" class="btn-secundario" data-colab-estado="${esc(c.id)}">${c.activo === false ? 'Activar' : 'Desactivar'}</button></div></div>`;
  }).join('');
  $('paneColaboradores').innerHTML = `<div class="ag-dia-cab"><h2 class="ag-h2" style="margin:0">Colaboradores</h2><button type="button" class="btn-primario" id="btnNuevoColaborador">+ Nuevo colaborador</button></div>
    <p class="ag-ayuda">Al guardar un colaborador, la agenda crea sola su cumpleaños, su aniversario laboral y los cumpleaños de sus familiares, y los mantiene al día si cambias una fecha. Estos datos personales solo los ve un administrador; los recordatorios sí los ve todo el equipo.</p>
    ${filas || '<p class="ag-vacio">Aún no hay colaboradores registrados.</p>'}`;
}

// ---------- Vista: Configuración (solo administradores) ----------

function renderConfiguracion() {
  const reglas = S.autoConfig.reglas || {};
  const filas = Object.entries(M.TIPOS_ACTIVIDAD).map(([k, t]) => `<div class="ag-fila ${reglas[k]?.length ? 'verde' : 'gris'}">
      <div class="ag-fila-cuerpo"><div class="ag-fila-titulo">${t.icono} ${esc(t.nombre)}</div><div class="ag-fila-sub">${esc(M.textoPasos(reglas[k]))}</div></div>
      <div class="ag-fila-acc"><button type="button" class="btn-secundario" data-auto-editar="${k}">Editar</button></div></div>`).join('');
  $('paneConfiguracion').innerHTML = `
    <div class="ag-dia-cab"><h2 class="ag-h2" style="margin:0">Recordatorios automáticos</h2>
      <button type="button" class="btn-secundario" id="btnAutoActivo">${S.autoConfig.activo ? '✓ Activados · desactivar' : 'Desactivados · activar'}</button></div>
    <p class="ag-ayuda">Al programar una actividad de un tipo, la agenda crea sola los recordatorios que configures (por ejemplo, para una instalación: 7 días antes “Confirmar con el cliente”, 3 días antes “Verificar materiales”, 1 día antes “Preparar el equipo”). Si la actividad se reprograma, sus recordatorios se mueven; si se cancela o se realiza, se cancelan los pendientes. Los cambios de esta pantalla valen para las actividades nuevas.</p>
    ${filas}
    <div class="ag-veh-acciones" style="margin-top:16px">
      <button type="button" class="btn-secundario" id="btnAutoAplicar">Generar para actividades ya programadas</button>
      <button type="button" class="btn-secundario" id="btnAutoRestaurar">Restaurar valores originales</button>
    </div>`;
}

function filaPaso(p = {}) {
  return `<div class="ag-paso-fila">
    <input type="number" class="paso-dias" min="0" max="90" inputmode="numeric" value="${p.dias ?? ''}" placeholder="Días" aria-label="Días antes">
    <input type="text" class="paso-titulo" value="${esc(p.titulo || '')}" placeholder="Qué hay que hacer. Ej. Confirmar con el cliente" autocomplete="off">
    <button type="button" class="ag-mini paso-quitar" aria-label="Quitar aviso">×</button></div>`;
}
function abrirAuto(tipo) {
  S.autoTipo = tipo;
  $('auTitulo').textContent = 'Recordatorios · ' + (M.TIPOS_ACTIVIDAD[tipo]?.nombre || '');
  const pasos = [...(S.autoConfig.reglas?.[tipo] || [])].sort((a, b) => b.dias - a.dias);
  $('auFilas').innerHTML = pasos.map(filaPaso).join('') || filaPaso();
  limpiarErr('auError');
  $('modalAuto').classList.add('visible');
}
async function guardarConfigAuto(nuevo, mensaje) {
  try { await guardarConfigAgenda(nuevo, S.staff.uid); toast(mensaje); return true; }
  catch (e) { console.error(e); toast('No se pudo guardar la configuración. ¿Publicaste las reglas nuevas y eres administrador?', 'error'); return false; }
}
async function guardarAuto() {
  const filas = [...$('auFilas').querySelectorAll('.ag-paso-fila')].map(r => ({ dias: r.querySelector('.paso-dias').value, titulo: r.querySelector('.paso-titulo').value.trim() }))
    .filter(p => p.dias !== '' || p.titulo);
  if (filas.some(p => p.dias === '' || !p.titulo)) return errEn('auError', 'Cada aviso necesita los días y un texto.');
  const pasos = filas.map(p => ({ dias: parseInt(p.dias, 10), titulo: p.titulo }));
  if (pasos.some(p => !(p.dias >= 0 && p.dias <= 90))) return errEn('auError', 'Los días deben estar entre 0 y 90.');
  if (new Set(pasos.map(p => p.dias)).size !== pasos.length) return errEn('auError', 'No puede haber dos avisos con los mismos días.');
  const reglas = { ...(S.autoConfig.reglas || {}) };
  if (pasos.length) reglas[S.autoTipo] = pasos.sort((a, b) => b.dias - a.dias); else delete reglas[S.autoTipo];
  if (await guardarConfigAuto({ activo: S.autoConfig.activo, reglas }, 'Configuración guardada')) cerrarModal('modalAuto');
}
async function aplicarAutomatizacionesExistentes() {
  const hoy = M.hoyStr();
  const lista = S.eventos.filter(e => e.categoria === 'actividad' && M.estaAbierto(e.estado) && e.proximaFecha >= hoy && S.autoConfig.reglas?.[e.tipo]?.length);
  if (!lista.length) return toast('No hay actividades futuras con recordatorios configurados.');
  if (!confirm(`Se revisarán ${lista.length} actividad${lista.length === 1 ? '' : 'es'} programada${lista.length === 1 ? '' : 's'} y se crearán los recordatorios que falten. ¿Continuar?`)) return;
  const total = { creados: 0, actualizados: 0, cancelados: 0 };
  try {
    for (const e of lista) { const r = await sincronizarAutomatizaciones(e); total.creados += r.creados; total.actualizados += r.actualizados; total.cancelados += r.cancelados; }
    toast('Listo' + (textoAuto(total) || ' · no faltaba ningún recordatorio'));
  } catch (err) { console.error(err); toast('No se pudo completar. Revisa tu conexión.', 'error'); }
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
  $('agFiltros').style.display = ['recursos', 'colaboradores', 'vehiculos', 'configuracion'].includes(S.vista) ? 'none' : '';
  ({ resumen: renderResumen, mes: renderMes, semana: renderSemana, agenda: renderAgenda, pagos: renderPagos, cumpleanos: renderCumpleanos, colaboradores: renderColaboradores, vehiculos: renderVehiculos, configuracion: renderConfiguracion, recursos: renderRecursos })[S.vista]();
}

function irA(vista) { S.vista = vista; render(); }

// ---------- Formulario de evento ----------

function llenarEstados(categoria, actual) {
  const sel = $('evEstado');
  sel.innerHTML = (M.ESTADOS_POR_CATEGORIA[categoria] || []).map(e => `<option value="${e}">${esc(M.ESTADOS[e].nombre)}</option>`).join('');
  sel.value = actual || M.estadoInicial(categoria);
}

const BLOQUES_CATEGORIA = { servicio: 'evBloqueServicio', obligacion: 'evBloqueObligacion', cumpleanos: 'evBloqueCumple' };

function actualizarFormularioSegunCategoria() {
  const cat = $('evCategoria').value;
  const pago = M.CATEGORIAS_PAGO.includes(cat), cumple = cat === 'cumpleanos';
  Object.entries(BLOQUES_CATEGORIA).forEach(([c, id]) => { $(id).style.display = c === cat ? '' : 'none'; });
  $('evTipoWrap').style.display = cat === 'actividad' ? '' : 'none';
  $('evRecursosWrap').style.display = cat === 'actividad' ? '' : 'none';
  ['evTodoDiaWrap', 'evHorarioWrap', 'evHoraFinWrap'].forEach(id => { $(id).style.display = (pago || cumple) ? 'none' : ''; });
  ['evCuandoTitulo', 'evFechaWrap', 'evRepiteWrap'].forEach(id => { $(id).style.display = cumple ? 'none' : ''; });
  $('evFechaLabel').innerHTML = (pago ? 'Próximo vencimiento' : 'Fecha') + ' <span style="color:#c14b32;">*</span>';
  if (!S.editandoId) {
    llenarEstados(cat);
    $('evAntic').value = String(M.ANTICIPACION_SUGERIDA[cat] ?? 1);
    $('evRepite').value = M.REPETICION_SUGERIDA[cat] || 'unica';
    actualizarAnticCustom();
  }
  actualizarRepeticion();
}
function actualizarRepeticion() {
  const k = $('evRepite').value;
  const cumple = $('evCategoria').value === 'cumpleanos';
  $('evCustomWrap').style.display = (!cumple && k === 'personalizada') ? '' : 'none';
  $('evUnidadWrap').style.display = (!cumple && k === 'personalizada') ? '' : 'none';
  $('evHastaWrap').style.display = (cumple || k === 'unica') ? 'none' : '';
}
function actualizarCumpleEtiqueta() {
  $('cuFechaLabel').textContent = $('cuMotivo').value === 'aniversario' ? 'Fecha de ingreso a Linence' : 'Fecha de nacimiento';
}
function actualizarAnticCustom() { $('evAnticCustomWrap').style.display = $('evAntic').value === 'otro' ? '' : 'none'; }
function actualizarHorario() {
  const td = $('evTodoDia').checked;
  $('evHoraIni').disabled = td; $('evHoraFin').disabled = td;
}

function abrirFormulario(ev = null, preset = {}) {
  S.editandoId = ev?.id || null;
  S.leadFormId = ev ? (ev.leadId || null) : (preset.leadId || null);
  $('evError').classList.remove('visible'); $('evError').textContent = '';
  $('evModalTitulo').textContent = ev ? 'Editar evento' : 'Crear evento';
  $('btnGuardarEvento').textContent = ev ? 'Guardar cambios' : 'Crear evento';
  $('evCategoria').disabled = !!ev;

  const cat = ev?.categoria || preset.categoria || 'actividad';
  $('evCategoria').value = cat;
  $('evTipo').value = ev?.tipo || preset.tipo || 'visita_cliente';
  $('evTitulo').value = ev?.titulo || preset.titulo || '';
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
  $('evProyecto').value = ev?.proyectoCodigo ? etiquetaProyecto(ev.proyectoCodigo) : (preset.proyectoCodigo ? etiquetaProyecto(preset.proyectoCodigo) : '');
  S.tituloAuto = '';
  $('evResp').value = ev?.responsableUid ?? (ev ? '' : (S.staff?.uid || ''));
  $('evDescripcion').value = ev?.descripcion || '';
  $('evNotas').value = ev?.notas || '';

  const marcados = new Set(ev?.recursoIds || preset.recursoIds || []);
  const activos = S.recursos.filter(r => r.activo !== false || marcados.has(r.id));
  $('evRecursos').innerHTML = activos.map(r => `<label class="ag-check"><input type="checkbox" value="${esc(r.id)}" ${marcados.has(r.id) ? 'checked' : ''}> ${esc(r.nombre)}</label>`).join('')
    || '<span class="ag-ayuda">No hay recursos creados todavía (pestaña “Recursos”).</span>';

  const d = ev?.datos || {};
  $('svTipo').value = d.servicio || M.TIPOS_SERVICIO[0]; $('svProveedor').value = d.proveedor || ''; $('svNumCliente').value = d.nroCliente || '';
  $('svMetodo').value = d.metodoPago || ''; $('svMonto').value = d.monto ?? ''; $('svMoneda').value = d.moneda || 'CLP';
  $('obTipo').value = d.tipoObligacion || M.TIPOS_OBLIGACION[0]; $('obInstitucion').value = d.institucion || ''; $('obReferencia').value = d.referencia || '';
  $('obMetodo').value = d.metodoPago || ''; $('obCuotasTotales').value = d.cuotasTotales ?? ''; $('obCuotasPagadas').value = d.cuotasPagadas ?? '';
  $('obMontoCuota').value = d.montoCuota ?? ''; $('obMoneda').value = d.moneda || 'CLP'; $('obMontoOriginal').value = d.montoOriginal ?? '';
  $('obSaldo').value = d.saldo ?? ''; $('obTasa').value = d.tasa ?? '';
  $('cuMotivo').value = d.motivo || 'cumpleanos'; $('cuPersona').value = d.persona || ''; $('cuParentesco').value = d.parentesco || 'colaborador';
  $('cuColaborador').value = d.colaboradorNombre || ''; $('cuFechaBase').value = d.fechaBase || '';
  if (ev?.origen) { $('cuPersona').readOnly = true; } else { $('cuPersona').readOnly = false; }

  actualizarFormularioSegunCategoria(); actualizarRepeticion(); actualizarAnticCustom(); actualizarHorario(); actualizarCumpleEtiqueta();
  mostrarInfoProyecto(!ev);
  $('modalEvento').classList.add('visible');
  setTimeout(() => $('evTitulo').focus(), 50);
}

/** Del texto del campo ("LIN-00025 — Juan Pérez" o solo el código) obtiene el código del proyecto. */
function codigoDesdeTexto(t) {
  const m = String(t || '').match(/LIN-\d+/i);
  return m ? m[0].toUpperCase() : null;
}

/** Datos propios de la categoría elegida en el formulario (null si no tiene). */
function leerDatosCategoria(cat) {
  if (cat === 'servicio') return { servicio: $('svTipo').value, proveedor: $('svProveedor').value.trim(), nroCliente: $('svNumCliente').value.trim(), monto: num('svMonto'), moneda: $('svMoneda').value || 'CLP', metodoPago: $('svMetodo').value || null };
  if (cat === 'obligacion') return {
    tipoObligacion: $('obTipo').value, institucion: $('obInstitucion').value.trim(), referencia: $('obReferencia').value.trim(), metodoPago: $('obMetodo').value || null,
    cuotasTotales: num('obCuotasTotales'), cuotasPagadas: num('obCuotasPagadas') ?? 0, montoCuota: num('obMontoCuota'), moneda: $('obMoneda').value || 'CLP',
    montoOriginal: num('obMontoOriginal'), saldo: num('obSaldo'), tasa: num('obTasa')
  };
  if (cat === 'cumpleanos') return { motivo: $('cuMotivo').value, persona: $('cuPersona').value.trim(), parentesco: $('cuParentesco').value, colaboradorNombre: $('cuColaborador').value.trim(), fechaBase: $('cuFechaBase').value };
  return null;
}

/** Sugiere el título si todavía no se escribió uno propio (nunca pisa lo que el usuario escribió). */
function sugerirTitulo() {
  const cat = $('evCategoria').value;
  let auto = '';
  if (cat === 'actividad') {
    const p = proyecto(codigoDesdeTexto($('evProyecto').value));
    const cliente = p ? p.cliente : (lead(S.leadFormId)?.nombre);   // sin proyecto elegido, el cliente del CRM
    const tipoNombre = M.TIPOS_ACTIVIDAD[$('evTipo').value]?.nombre || '';
    auto = (cliente && tipoNombre) ? `${tipoNombre} — ${cliente || ''}` : '';
  } else {
    auto = M.tituloSugerido(cat, leerDatosCategoria(cat) || {});
  }
  const actual = $('evTitulo').value.trim();
  if (auto && (!actual || actual === S.tituloAuto)) { $('evTitulo').value = auto; S.tituloAuto = auto; }
}

/** Muestra los datos traídos del proyecto y, si corresponde, sugiere el título. */
function mostrarInfoProyecto(sugerir = true) {
  const codigo = codigoDesdeTexto($('evProyecto').value);
  const box = $('evProyectoInfo');
  const html = codigo ? bloqueProyecto(codigo) : (S.leadFormId ? bloqueLead(S.leadFormId) : '');
  box.style.display = html ? '' : 'none';
  box.innerHTML = html;
  if (sugerir) sugerirTitulo();
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
  const d = {
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
    notas: $('evNotas').value.trim(),
    proyectoCodigo: codigoDesdeTexto($('evProyecto').value),
    leadId: S.leadFormId || null,   // cliente del CRM (si la actividad se agendó desde su ficha); se guarda solo el id
    relacion: codigoDesdeTexto($('evProyecto').value) ? { tipo: 'proyecto', id: codigoDesdeTexto($('evProyecto').value), codigo: codigoDesdeTexto($('evProyecto').value) }
      : (S.leadFormId ? { tipo: 'lead', id: S.leadFormId } : null)
  };
  d.datos = leerDatosCategoria(cat);
  if (cat === 'cumpleanos') {
    const base = d.datos.fechaBase;
    const ex = S.editandoId ? S.eventos.find(e => e.id === S.editandoId) : null;
    d.recurrencia = { frecuencia: 'anios', intervalo: 1, hasta: null };
    d.todoElDia = true; d.horaInicio = null; d.horaFin = null; d.recursoIds = [];
    if (base) {
      d.proximaFecha = (ex && ex.datos?.fechaBase === base && ex.proximaFecha) ? ex.proximaFecha : M.proximoAniversario(base);
      d.diaAncla = M.partesFecha(base).d;
    } else d.proximaFecha = '';
  } else if (M.CATEGORIAS_PAGO.includes(cat)) {
    d.todoElDia = true; d.horaInicio = null; d.horaFin = null; d.recursoIds = [];
  }
  return d;
}

function errorFormulario(msg) { const e = $('evError'); e.textContent = msg; e.classList.add('visible'); }

async function guardarEvento() {
  const d = leerFormulario();
  if (!d.titulo) return errorFormulario('Escribe un título.');
  if (d.categoria === 'cumpleanos') {
    if (!d.datos.persona) return errorFormulario('Escribe el nombre de la persona.');
    if (!d.datos.fechaBase) return errorFormulario(d.datos.motivo === 'aniversario' ? 'Indica la fecha de ingreso.' : 'Indica la fecha de nacimiento.');
  }
  if (!d.proximaFecha) return errorFormulario('Elige una fecha.');
  if (d.categoria === 'obligacion' && d.datos.cuotasTotales != null && d.datos.cuotasPagadas > d.datos.cuotasTotales) return errorFormulario('Las cuotas pagadas no pueden superar el total de cuotas.');
  if ($('evProyecto').value.trim() && !d.proyectoCodigo) return errorFormulario('Elige un proyecto de la lista (por ejemplo LIN-00025) o deja el campo vacío.');
  if (d.proyectoCodigo && S.proyectos.length && !proyecto(d.proyectoCodigo)) return errorFormulario('No encontré ese proyecto. Revisa el código.');
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
      const nuevo = await crearEvento({ ...d, fecha: d.proximaFecha, diaAncla: d.diaAncla ?? M.partesFecha(d.proximaFecha).d, adjuntos: [] }, S.staff.uid, nombreStaff());
      toast('Evento creado' + await autoTras({ ...d, id: nuevo.id }));
    } else {
      const ev = S.eventos.find(e => e.id === S.editandoId);
      const cambioFecha = ev.proximaFecha !== d.proximaFecha;
      const cambioEstado = ev.estado !== d.estado;
      const datos = { ...d, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() };
      if (cambioFecha || d.diaAncla) datos.diaAncla = d.diaAncla ?? M.partesFecha(d.proximaFecha).d;
      delete datos.categoria;   // la categoría no cambia al editar
      const entrada = cambioFecha
        ? { tipo: 'reprogramado', fechaAnterior: ev.proximaFecha, fechaNueva: d.proximaFecha, estadoAnterior: ev.estado, estadoNuevo: d.estado, ...por }
        : cambioEstado
          ? { tipo: 'estado', estadoAnterior: ev.estado, estadoNuevo: d.estado, ...por }
          : { tipo: 'editado', ...por };
      await actualizarEvento(S.editandoId, datos, entrada);
      toast('Cambios guardados' + await autoTras({ ...ev, ...datos, id: ev.id }));
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
    if (h.kmReal != null) partes.push(esc(M.formatoKm(h.kmReal)));
    if (h.proveedor) partes.push(esc(h.proveedor));
    if (h.nuevoProximoKm != null) partes.push('próxima: ' + esc(M.formatoKm(h.nuevoProximoKm)));
    if (h.cuota) partes.push(`cuota ${h.cuota}${h.cuotasTotales ? '/' + h.cuotasTotales : ''}`);
    if (h.monto != null) partes.push(esc(M.formatoMonto(h.monto, h.moneda)));
    if (h.metodoPago) partes.push(esc(h.metodoPago));
    if (h.referencia) partes.push('ref. ' + esc(h.referencia));
    if (h.fechaOcurrencia) partes.push(`ocurrencia del ${esc(M.formatoFechaDMA(h.fechaOcurrencia))}`);
    if (h.fechaReal) partes.push(`realizado el ${esc(M.formatoFechaDMA(h.fechaReal))}`);
    if (h.fechaNueva) partes.push(`próxima: ${esc(M.formatoFechaDMA(h.fechaNueva))}`);
  }
  if (h.nota) partes.push(`“${esc(h.nota)}”`);
  const etiqueta = (h.tipo === 'completado' && h.kmReal != null) ? 'Mantención registrada' : (h.tipo === 'completado' && (h.monto != null || h.cuota || h.metodoPago)) ? 'Pago registrado' : (ETIQ_HIST[h.tipo] || h.tipo);
  return `<div class="ag-hist"><b>${esc(etiqueta)}</b> <span>${partes.join(' · ')}</span><small>${esc(h.porNombre || '')} · ${esc(fechaHoraTs(h.fecha))}</small></div>`;
}

function abrirDetalle(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  S.detalleId = id;
  pintarDetalle(ev);
  $('modalDetalle').classList.add('visible');
  S.pararHistorial?.();
  S.pararHistorial = escucharHistorialEvento(id, (lista) => { $('detHistorial').innerHTML = lista.map(lineaHistorial).join('') || '<p class="ag-vacio">Sin movimientos.</p>'; });
}

/** Filas del detalle con los datos propios de la categoría. */
function filasDatos(ev) {
  const origen = ev.origen?.tipo === 'automatizacion'
    ? `<div class="ag-det-fila"><span>Origen</span><div>Recordatorio automático · <a href="#" data-abrir-ev="${esc(ev.origen.eventoId)}">ver la actividad</a></div></div>` : '';
  return origen + filasDatosCategoria(ev);
}

function filasDatosCategoria(ev) {
  const d = ev.datos || {};
  const f = (k, v) => v ? `<div class="ag-det-fila"><span>${k}</span><div>${v}</div></div>` : '';
  if (ev.categoria === 'servicio') {
    const mo = M.montoEvento(ev);
    return f('Servicio', esc(d.servicio)) + f('Proveedor', esc(d.proveedor)) + f('N° de cliente', esc(d.nroCliente)) +
      f('Monto', mo ? esc(M.formatoMonto(mo.monto, mo.moneda)) : 'Variable (se indica al pagar)') + f('Método de pago', esc(d.metodoPago));
  }
  if (ev.categoria === 'obligacion') {
    const c = M.estadoCuotas(ev), mo = M.montoEvento(ev);
    const cuotas = c ? `<b>${c.pagadas} de ${c.total}</b> cuotas pagadas · quedan ${c.restantes}<div class="ag-barra"><i style="width:${Math.round(c.pagadas / c.total * 100)}%"></i></div>` : '';
    return f('Tipo', esc(d.tipoObligacion)) + f('Institución', esc(d.institucion)) + f('Contrato / referencia', esc(d.referencia)) + f('Cuotas', cuotas) +
      f('Monto de la cuota', mo ? esc(M.formatoMonto(mo.monto, mo.moneda)) : '') +
      f('Monto original', d.montoOriginal != null ? esc(M.formatoMonto(d.montoOriginal, d.moneda)) : '') +
      f('Saldo pendiente', d.saldo != null ? esc(M.formatoMonto(d.saldo, d.moneda)) : '') +
      f('Tasa de interés', d.tasa != null ? esc(d.tasa + ' %') : '') + f('Método de pago', esc(d.metodoPago));
  }
  if (ev.categoria === 'vehiculo') {
    const v = M.vehiculoDe(ev), r = M.restanteKm(ev);
    let html = f('Vehículo', esc(M.etiquetaVehiculo(v) || ev.vehiculoId || ''));
    if (ev.datos?.clase === 'mantencion') {
      const usaKm = M.mantencionUsaKm(ev);
      html += f('Mantención', esc(ev.datos.nombre)) + f('Se controla', esc(M.MODOS_MANTENCION[ev.datos.modo] || ''));
      if (usaKm) {
        const span = Number(ev.datos.proximoKm) - Number(ev.datos.ultimoKm);
        const pct = (v && span > 0) ? Math.max(0, Math.min(100, Math.round((Number(v.kmActual) - Number(ev.datos.ultimoKm)) / span * 100))) : null;
        html += f('Kilometraje actual', v?.kmActual != null ? esc(M.formatoKm(v.kmActual)) : '') + f('Última mantención', ev.datos.ultimoKm != null ? esc(M.formatoKm(ev.datos.ultimoKm)) : '') +
          f('Próxima mantención', `<b>${esc(M.formatoKm(ev.datos.proximoKm))}</b>${r != null ? (r > 0 ? ` · faltan ${esc(M.formatoKm(r))}` : ' · <b>kilometraje alcanzado</b>') : ''}${pct != null ? `<div class="ag-barra"><i style="width:${pct}%"></i></div>` : ''}`) +
          f('Cada', esc(M.formatoKm(ev.datos.intervaloKm))) + f('Aviso', ev.datos.avisoKm != null ? `${esc(M.formatoKm(ev.datos.avisoKm))} antes` : '');
      }
      if (M.modoUsaFecha(ev.datos.modo)) html += f('Cada', ev.datos.intervaloMeses ? `${esc(ev.datos.intervaloMeses)} meses` : '') + f('Última vez', ev.datos.ultimaFecha ? esc(M.formatoFechaDMA(ev.datos.ultimaFecha)) : '');
    } else {
      html += f('Documento', esc(ev.datos?.nombre));
    }
    return html;
  }
  if (ev.categoria === 'cumpleanos') {
    return f('Persona', esc(d.persona)) + f('Relación', esc(M.PARENTESCOS[d.parentesco] || '')) + f('Colaborador asociado', esc(d.colaboradorNombre)) +
      f('Próxima fecha', esc(M.textoCumple(ev))) + f(d.motivo === 'aniversario' ? 'Fecha de ingreso' : 'Fecha de nacimiento', d.fechaBase ? esc(M.formatoFechaDMA(d.fechaBase)) : '') +
      (ev.origen ? f('Origen', 'Creado desde la ficha de un colaborador (se actualiza solo al editarla)') : '');
  }
  return '';
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
    ${fila(M.esPago(ev) || ev.categoria === 'vehiculo' ? 'Próximo vencimiento' : 'Cuándo', (ev.proximaFecha ? esc(M.formatoFechaLarga(ev.proximaFecha)) : 'Según kilometraje') + (textoHora(ev) ? ' · ' + esc(textoHora(ev)) : ''))}
    ${filasDatos(ev)}
    ${fila('Categoría', esc(M.CATEGORIAS[ev.categoria]?.nombre || '') + (ev.tipo ? ' · ' + esc(M.TIPOS_ACTIVIDAD[ev.tipo]?.nombre || '') : ''))}
    ${fila('Repetición', esc(M.textoRegla(ev.recurrencia)) + (ev.recurrencia?.hasta ? ` (hasta ${esc(M.formatoFechaDMA(ev.recurrencia.hasta))})` : ''))}
    ${fila('Aviso', esc(ant) + (ev.avisarHabilAnterior ? ' · día hábil anterior si cae fin de semana' : ''))}
    ${fila('Proyecto / cliente', ev.proyectoCodigo ? bloqueProyecto(ev.proyectoCodigo) : bloqueLead(ev.leadId))}
    ${fila('Responsable', esc(ev.responsableNombre))}
    ${fila('Recursos', (ev.recursoIds || []).map(id => esc(rec[id] || '—')).join(', '))}
    ${fila('Descripción', esc(ev.descripcion).replace(/\n/g, '<br>'))}
    ${fila('Notas', esc(ev.notas).replace(/\n/g, '<br>'))}
    ${fila(M.esPago(ev) ? 'Último pago' : 'Última vez realizado', ev.ultimaRealizacion ? esc(M.formatoFechaDMA(ev.ultimaRealizacion)) : '')}
    ${fila('Creado', esc(ev.creadoPorNombre || '') + ' · ' + esc(fechaHoraTs(ev.creadoEn)))}
    ${fila('Última modificación', esc(ev.actualizadoPorNombre || '') + ' · ' + esc(fechaHoraTs(ev.actualizadoEn)))}
    <div class="ag-det-estado campo"><label for="detEstado">Cambiar estado</label><select id="detEstado">${opcionesEstado}</select></div>
    <div class="ag-det-acciones">
      ${abierto ? `<button type="button" class="btn-primario" data-det="completar">${etiquetaCompletar(ev)}</button>
      ${ev.proximaFecha ? `<button type="button" class="btn-secundario" data-det="posponer">⏰ Posponer / reprogramar</button>` : ''}` : ''}
      <button type="button" class="btn-secundario" data-det="editar">Editar</button>
      ${abierto ? `<button type="button" class="btn-peligro" data-det="cancelar">Cancelar evento</button>` : ''}
    </div>
    <h3 class="ag-h3">Historial</h3><div id="detHistorial" class="ag-hist-lista"></div>`;
}

// ---------- Completar / posponer / cancelar / estado ----------

// ---------- Recordatorios automáticos (Fase 5) ----------

/**
 * Deja al día los recordatorios automáticos de una actividad: crea los que faltan,
 * mueve los que cambiaron de fecha y cancela los que ya no corresponden.
 * `padre` es la actividad tal como quedó (campos mezclados con lo recién guardado).
 */
async function sincronizarAutomatizaciones(padre) {
  const r = { creados: 0, actualizados: 0, cancelados: 0 };
  if (!S.autoConfig.activo || padre.categoria !== 'actividad') return r;
  const existentes = S.eventos.filter(e => e.origen?.tipo === 'automatizacion' && e.origen.eventoId === padre.id);
  const plan = M.planificarRecordatorios(padre, S.autoConfig.reglas, existentes);
  const por = { por: S.staff.uid, porNombre: nombreStaff() };
  const prioridad = ['alta', 'urgente'].includes(padre.prioridad) ? padre.prioridad : 'media';

  for (const d of plan.crear) {
    await crearEvento({
      titulo: d.titulo, categoria: 'recordatorio', tipo: null, prioridad, estado: 'pendiente', abierto: true,
      fecha: d.fecha, proximaFecha: d.fecha, diaAncla: M.partesFecha(d.fecha).d, todoElDia: true, horaInicio: null, horaFin: null,
      recurrencia: { frecuencia: 'ninguna', intervalo: 1, hasta: null }, anticipacionDias: 0, avisarHabilAnterior: false,
      responsableUid: padre.responsableUid || null, responsableNombre: padre.responsableNombre || '', recursoIds: [],
      descripcion: `Recordatorio automático: ${d.dias} ${d.dias === 1 ? 'día' : 'días'} antes de «${padre.titulo}»`, notas: '',
      proyectoCodigo: null, relacion: { tipo: 'evento', id: padre.id }, adjuntos: [],
      origen: { tipo: 'automatizacion', eventoId: padre.id, clave: d.clave, fechaPadre: padre.proximaFecha }
    }, S.staff.uid, nombreStaff());
    r.creados++;
  }
  for (const { ev, d } of plan.actualizar) {
    await actualizarEvento(ev.id,
      { proximaFecha: d.fecha, titulo: d.titulo, diaAncla: M.partesFecha(d.fecha).d, 'origen.fechaPadre': padre.proximaFecha, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
      { tipo: 'reprogramado', fechaAnterior: ev.proximaFecha, fechaNueva: d.fecha, estadoAnterior: ev.estado, estadoNuevo: ev.estado, nota: 'Ajustado porque cambió la actividad', ...por });
    r.actualizados++;
  }
  for (const ev of plan.cancelar) {
    await actualizarEvento(ev.id, { estado: 'cancelado', abierto: false, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
      { tipo: 'cancelado', estadoAnterior: ev.estado, estadoNuevo: 'cancelado', nota: 'La actividad cambió o terminó', ...por });
    r.cancelados++;
  }
  return r;
}

function textoAuto(r) {
  const p = [];
  if (r.creados) p.push(`${r.creados} recordatorio${r.creados === 1 ? '' : 's'} automático${r.creados === 1 ? '' : 's'} creado${r.creados === 1 ? '' : 's'}`);
  if (r.actualizados) p.push(`${r.actualizados} ajustado${r.actualizados === 1 ? '' : 's'}`);
  if (r.cancelados) p.push(`${r.cancelados} cancelado${r.cancelados === 1 ? '' : 's'}`);
  return p.length ? ' · ' + p.join(', ') : '';
}

/** Sincroniza sin romper el flujo principal: si falla, solo se avisa en consola. Devuelve el texto para el aviso. */
async function autoTras(padre) {
  try { return textoAuto(await sincronizarAutomatizaciones(padre)); }
  catch (e) { console.warn('No se pudieron actualizar los recordatorios automáticos', e); return ''; }
}

let _accionId = null;

function abrirCompletar(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  if (M.esMantencion(ev)) return abrirMantencion(id);
  _accionId = id;
  const rec = M.esRecurrente(ev), pago = M.esPago(ev);
  const c = ev.categoria === 'obligacion' ? M.estadoCuotas(ev) : null;
  const ultima = !!c && c.pagadas + 1 >= c.total;
  const sig = (rec && !ultima) ? M.siguienteFecha(ev.proximaFecha, ev.recurrencia, ev.diaAncla) : null;
  const mo = M.montoEvento(ev);

  $('cpTitulo').textContent = pago ? 'Registrar pago' : ev.categoria === 'cumpleanos' ? 'Marcar como saludado' : 'Marcar como realizado';
  $('btnConfirmarCompletar').textContent = pago ? 'Registrar pago' : 'Confirmar';
  document.querySelector('label[for="cpFecha"]').textContent = pago ? 'Fecha de pago' : 'Fecha en que se realizó';
  $('cpFecha').value = M.hoyStr();
  $('cpNota').value = '';
  $('cpPagoWrap').style.display = pago ? '' : 'none';
  $('cpMonto').value = mo ? mo.monto : '';
  $('cpMontoLabel').textContent = c ? `Monto pagado (cuota ${c.siguiente} de ${c.total})` : 'Monto pagado';
  $('cpMetodo').value = ev.datos?.metodoPago || '';
  $('cpReferencia').value = ''; $('cpSaldo').value = '';
  $('cpSaldoWrap').style.display = ev.categoria === 'obligacion' ? '' : 'none';
  $('cpProximaWrap').style.display = sig ? '' : 'none';
  $('cpProxima').value = sig || '';
  $('cpTexto').textContent = ultima
    ? 'Es la última cuota: al registrarla el crédito queda totalmente pagado y se conserva en el historial.'
    : rec
      ? (sig ? 'Queda en el historial y la agenda programa el siguiente vencimiento (puedes cambiar la fecha si varía).' : 'Era la última ocurrencia de la serie: el evento quedará como realizado.')
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

  // Datos del pago (servicios y créditos)
  const extra = {}, upd = {};
  const pago = M.esPago(ev);
  if (pago) {
    extra.monto = num('cpMonto'); extra.moneda = ev.datos?.moneda || 'CLP';
    extra.metodoPago = $('cpMetodo').value || null; extra.referencia = $('cpReferencia').value.trim() || null;
    if (ev.categoria === 'obligacion') {
      const total = parseInt(ev.datos?.cuotasTotales, 10) || 0;
      const pagadas = (parseInt(ev.datos?.cuotasPagadas, 10) || 0) + 1;
      extra.cuota = pagadas; if (total) extra.cuotasTotales = total;
      upd['datos.cuotasPagadas'] = pagadas;
      if ($('cpSaldo').value !== '') upd['datos.saldo'] = Number($('cpSaldo').value);
    }
  }
  const por = { por: S.staff.uid, porNombre: nombreStaff() };
  const btn = $('btnConfirmarCompletar'); btn.disabled = true;
  try {
    if (sig) {
      const estado = M.estadoReinicio(ev.categoria);
      await actualizarEvento(ev.id,
        { ...upd, proximaFecha: sig, estado, abierto: true, ultimaRealizacion: fechaReal, diaAncla: ev.diaAncla || M.partesFecha(ev.proximaFecha).d, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
        { tipo: 'completado', fechaOcurrencia: ev.proximaFecha, fechaReal, fechaNueva: sig, estadoAnterior: ev.estado, estadoNuevo: estado, nota, ...extra, ...por });
      toast((pago ? 'Pago registrado. Próximo vencimiento: ' + M.formatoFechaDMA(sig) : 'Registrado. Próxima fecha: ' + M.formatoFechaDMA(sig)) + await autoTras({ ...ev, proximaFecha: sig, estado }));
    } else {
      await actualizarEvento(ev.id,
        { ...upd, estado: 'realizado', abierto: false, ultimaRealizacion: fechaReal, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
        { tipo: 'completado', fechaOcurrencia: ev.proximaFecha, fechaReal, estadoAnterior: ev.estado, estadoNuevo: 'realizado', nota, ...extra, ...por });
      toast((pago ? 'Pago registrado' : 'Marcado como realizado') + await autoTras({ ...ev, estado: 'realizado' }));
    }
    cerrarModal('modalCompletar');
  } catch (e) { console.error(e); toast('No se pudo guardar', 'error'); }
  finally { btn.disabled = false; }
}

function abrirPosponer(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  if (!ev.proximaFecha) { toast('Esta mantención se controla por kilometraje: actualiza el kilometraje del vehículo o edita la mantención.', 'error'); return; }
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
    toast('Reprogramado para el ' + M.formatoFechaDMA(nueva) + await autoTras({ ...ev, ...datos, id: ev.id }));
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
    toast('Evento cancelado' + await autoTras({ ...ev, estado: 'cancelado' }));
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
    toast('Estado actualizado' + await autoTras({ ...ev, estado: nuevo }));
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

// ---------- Vehículos: ficha, kilometraje, planes, mantenciones, gastos ----------

const NUM = (id) => { const v = $(id).value; return v === '' ? null : Number(v); };
const errEn = (id, msg) => { const e = $(id); e.textContent = msg; e.classList.add('visible'); };
const limpiarErr = (id) => { const e = $(id); e.textContent = ''; e.classList.remove('visible'); };

function abrirVehiculo(id = null) {
  S.vehEditando = id;
  const v = veh(id);
  $('vhTitulo').textContent = v ? 'Editar vehículo' : 'Nuevo vehículo';
  $('vhPatente').value = v?.patente || ''; $('vhAnio').value = v?.anio ?? ''; $('vhMarca').value = v?.marca || ''; $('vhModelo').value = v?.modelo || '';
  $('vhKm').value = v?.kmActual ?? ''; $('vhKm').disabled = !!v;
  $('vhKmLabel').textContent = v ? 'Kilometraje actual (se cambia con “Actualizar km”)' : 'Kilometraje actual';
  $('vhVin').value = v?.vin || ''; $('vhResp').value = v?.responsableUid || ''; $('vhObs').value = v?.observaciones || '';
  limpiarErr('vhError');
  $('modalVehiculo').classList.add('visible');
}

async function guardarVehiculo() {
  const patente = $('vhPatente').value.trim().toUpperCase().replace(/\s+/g, '');
  if (!patente) return errEn('vhError', 'Escribe la patente.');
  if (S.vehiculos.some(v => v.patente === patente && v.id !== S.vehEditando)) return errEn('vhError', 'Ya existe un vehículo con esa patente.');
  const u = S.usuarios.find(x => x.uid === $('vhResp').value);
  const datos = {
    patente, marca: $('vhMarca').value.trim(), modelo: $('vhModelo').value.trim(), anio: NUM('vhAnio'), vin: $('vhVin').value.trim(),
    responsableUid: u?.uid || null, responsableNombre: u ? (u.nombre || u.email || '') : '', observaciones: $('vhObs').value.trim()
  };
  const btn = $('btnGuardarVehiculo'); btn.disabled = true;
  try {
    if (S.vehEditando) await actualizarVehiculo(S.vehEditando, datos);
    else {
      const km = NUM('vhKm');
      await crearVehiculo({ ...datos, kmActual: km }, S.staff.uid, nombreStaff());
    }
    cerrarModal('modalVehiculo'); toast('Vehículo guardado');
  } catch (e) { console.error(e); errEn('vhError', 'No se pudo guardar. Revisa tu conexión.'); }
  finally { btn.disabled = false; }
}

async function cambiarEstadoVehiculo(id) {
  const v = veh(id); if (!v) return;
  try { await actualizarVehiculo(id, { activo: v.activo === false }); toast(v.activo === false ? 'Vehículo activado' : 'Vehículo desactivado'); }
  catch (e) { console.error(e); toast('No se pudo cambiar el estado', 'error'); }
}

// Kilometraje
function abrirKm(id) {
  S.vehKm = id; const v = veh(id);
  $('kmInfo').textContent = `${M.etiquetaVehiculo(v)} · kilometraje registrado: ${v.kmActual != null && v.kmActual !== '' ? M.formatoKm(v.kmActual) : 'ninguno'}`;
  $('kmValor').value = v.kmActual ?? ''; $('kmNota').value = ''; limpiarErr('kmError');
  $('modalKm').classList.add('visible'); setTimeout(() => $('kmValor').select(), 50);
}
async function guardarKm() {
  const v = veh(S.vehKm); const km = NUM('kmValor');
  if (km == null || km < 0) return errEn('kmError', 'Escribe el kilometraje actual.');
  if (v.kmActual != null && v.kmActual !== '' && km < Number(v.kmActual)) return errEn('kmError', `No puede ser menor al registrado (${M.formatoKm(v.kmActual)}). Si hubo un error de registro, avísame para corregirlo.`);
  const btn = $('btnGuardarKm'); btn.disabled = true;
  try { await registrarKilometraje(v.id, km, S.staff.uid, nombreStaff(), $('kmNota').value.trim()); cerrarModal('modalKm'); toast('Kilometraje actualizado: ' + M.formatoKm(km)); }
  catch (e) { console.error(e); errEn('kmError', 'No se pudo guardar.'); }
  finally { btn.disabled = false; }
}

// Plan de mantención / documento
function llenarTiposPlan(clase, actual) {
  const lista = clase === 'documento' ? M.TIPOS_DOCUMENTO_VEHICULO : M.TIPOS_MANTENCION;
  $('pvTipo').innerHTML = lista.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (actual && lista.includes(actual)) $('pvTipo').value = actual;
}
function actualizarPlanFormulario() {
  const clase = $('pvClase').value, modo = $('pvModo').value;
  const mant = clase === 'mantencion';
  $('pvTipoLabel').textContent = mant ? 'Tipo de mantención' : 'Documento';
  $('pvModoWrap').style.display = mant ? '' : 'none';
  $('pvKmBloque').style.display = (mant && M.modoUsaKm(modo)) ? '' : 'none';
  $('pvFechaBloque').style.display = (!mant || M.modoUsaFecha(modo)) ? '' : 'none';
  $('pvMesesWrap').style.display = mant ? '' : 'none';
  $('pvRenuevaWrap').style.display = mant ? 'none' : '';
  $('pvFechaLabel').textContent = mant ? 'Próxima fecha' : 'Vencimiento';
}
function recalcularProximoKm() {
  if ($('pvProximoKm').dataset.manual === '1') return;
  const u = NUM('pvUltimoKm'), i = NUM('pvIntervaloKm');
  $('pvProximoKm').value = (u != null && i > 0) ? u + i : '';
}
function abrirPlan(vehiculoId, clase = 'mantencion', ev = null) {
  S.planEditando = ev?.id || null;
  const activos = S.vehiculos.filter(v => v.activo !== false || v.id === vehiculoId);
  $('pvVehiculo').innerHTML = activos.map(v => `<option value="${esc(v.id)}">${esc(M.etiquetaVehiculo(v))}</option>`).join('');
  $('pvVehiculo').value = vehiculoId || activos[0]?.id || '';
  $('pvVehiculo').disabled = !!ev;
  $('pvClase').value = clase; $('pvClase').disabled = !!ev;
  llenarTiposPlan(clase, ev?.datos?.nombre);
  const d = ev?.datos || {}, v = veh($('pvVehiculo').value);
  $('pvModo').value = d.modo || 'km';
  $('pvUltimoKm').value = d.ultimoKm ?? (v?.kmActual ?? ''); $('pvIntervaloKm').value = d.intervaloKm ?? ''; $('pvProximoKm').value = d.proximoKm ?? '';
  $('pvProximoKm').dataset.manual = ev ? '1' : '0';
  $('pvAvisoKm').value = d.avisoKm ?? 500; $('pvIntervaloMeses').value = d.intervaloMeses ?? '';
  $('pvFecha').value = ev?.proximaFecha || '';
  $('pvAntic').value = ev ? ev.anticipacionDias : (clase === 'documento' ? 30 : 15);
  $('pvRenueva').checked = ev ? M.esRecurrente(ev) : true;
  $('pvNotas').value = ev?.notas || '';
  limpiarErr('pvError');
  $('pvTitulo').textContent = ev ? 'Editar programación' : (clase === 'documento' ? 'Nuevo documento del vehículo' : 'Nueva mantención programada');
  actualizarPlanFormulario();
  $('modalPlan').classList.add('visible');
}

async function guardarPlan() {
  const v = veh($('pvVehiculo').value);
  if (!v) return errEn('pvError', 'Primero crea un vehículo.');
  const clase = $('pvClase').value, nombre = $('pvTipo').value, modo = $('pvModo').value;
  const mant = clase === 'mantencion';
  const usaKm = mant && M.modoUsaKm(modo), usaFecha = !mant || M.modoUsaFecha(modo);
  const datos = { clase, nombre };
  let proximaFecha = null;
  if (mant) {
    datos.modo = modo;
    if (usaKm) {
      const ultimo = NUM('pvUltimoKm'), inter = NUM('pvIntervaloKm'); let prox = NUM('pvProximoKm');
      if (ultimo == null) return errEn('pvError', 'Indica el último kilometraje en que se hizo (si nunca, usa el kilometraje actual).');
      if (!(inter > 0) && prox == null) return errEn('pvError', 'Indica cada cuántos km se repite o el próximo kilometraje.');
      if (prox == null) prox = ultimo + inter;
      if (prox <= ultimo) return errEn('pvError', 'El próximo kilometraje debe ser mayor al último.');
      Object.assign(datos, { ultimoKm: ultimo, intervaloKm: inter > 0 ? inter : null, proximoKm: prox, avisoKm: Math.max(0, NUM('pvAvisoKm') ?? 500) });
    }
    if (usaFecha) datos.intervaloMeses = NUM('pvIntervaloMeses');
    if (S.planEditando) datos.ultimaFecha = S.eventos.find(e => e.id === S.planEditando)?.datos?.ultimaFecha ?? null;
  }
  if (usaFecha) {
    proximaFecha = $('pvFecha').value;
    if (!proximaFecha) return errEn('pvError', mant ? 'Indica la próxima fecha.' : 'Indica la fecha de vencimiento.');
  }
  const d = {
    titulo: `${nombre} — ${v.patente}`, categoria: 'vehiculo', tipo: null, prioridad: 'media', estado: 'pendiente', abierto: true,
    proximaFecha, todoElDia: true, horaInicio: null, horaFin: null,
    recurrencia: (!mant && $('pvRenueva').checked) ? { frecuencia: 'anios', intervalo: 1, hasta: null } : { frecuencia: 'ninguna', intervalo: 1, hasta: null },
    anticipacionDias: Math.max(0, NUM('pvAntic') ?? 0), avisarHabilAnterior: false,
    responsableUid: v.responsableUid || null, responsableNombre: v.responsableNombre || '', recursoIds: [],
    notas: $('pvNotas').value.trim(), vehiculoId: v.id, relacion: { tipo: 'vehiculo', id: v.id }, datos
  };
  const btn = $('btnGuardarPlan'); btn.disabled = true;
  try {
    if (!S.planEditando) {
      await crearEvento({ ...d, fecha: proximaFecha || M.hoyStr(), diaAncla: M.partesFecha(proximaFecha || M.hoyStr()).d, descripcion: '', proyectoCodigo: null, adjuntos: [] }, S.staff.uid, nombreStaff());
      toast(mant ? 'Mantención programada' : 'Documento registrado');
    } else {
      const ex = S.eventos.find(e => e.id === S.planEditando);
      const { estado, abierto, ...resto } = d;               // no se cambia el estado al editar
      await actualizarEvento(S.planEditando, { ...resto, ...(proximaFecha ? { diaAncla: M.partesFecha(proximaFecha).d } : {}), actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
        { tipo: 'editado', estadoAnterior: ex.estado, estadoNuevo: ex.estado, por: S.staff.uid, porNombre: nombreStaff() });
      toast('Cambios guardados');
    }
    cerrarModal('modalPlan');
  } catch (e) { console.error(e); errEn('pvError', 'No se pudo guardar. Revisa tu conexión.'); }
  finally { btn.disabled = false; }
}

// Registrar mantención realizada
function actualizarMantencionProx() {
  const ev = S.eventos.find(e => e.id === S.mantencionId); if (!ev) return;
  const km = NUM('mtKm'), fecha = $('mtFecha').value || M.hoyStr();
  const plan = M.planSiguiente(ev, km ?? ev.datos.ultimoKm ?? 0, fecha);
  if (M.mantencionUsaKm(ev)) $('mtProxKm').value = km != null ? (plan['datos.proximoKm'] ?? '') : '';
  if (M.modoUsaFecha(ev.datos.modo)) $('mtProxFecha').value = plan.proximaFecha || '';
}
function abrirMantencion(id) {
  const ev = S.eventos.find(e => e.id === id); if (!ev) return;
  S.mantencionId = id; const v = M.vehiculoDe(ev);
  const usaKm = M.mantencionUsaKm(ev), usaFecha = M.modoUsaFecha(ev.datos.modo);
  $('mtInfo').textContent = `${ev.datos.nombre} · ${M.etiquetaVehiculo(v)}` + (usaKm ? ` · programada a los ${M.formatoKm(ev.datos.proximoKm)}` : '');
  $('mtFecha').value = M.hoyStr();
  $('mtKm').value = v?.kmActual ?? '';
  $('mtKmLabel').textContent = usaKm ? 'Kilometraje al hacerla' : 'Kilometraje al hacerla (opcional)';
  ['mtTaller', 'mtCosto', 'mtFactura', 'mtObs'].forEach(i => { $(i).value = ''; });
  $('mtProxKmWrap').style.display = usaKm ? '' : 'none';
  $('mtProxFechaWrap').style.display = usaFecha ? '' : 'none';
  actualizarMantencionProx(); limpiarErr('mtError');
  $('modalMantencion').classList.add('visible');
}
async function confirmarMantencion() {
  const ev = S.eventos.find(e => e.id === S.mantencionId); if (!ev) return;
  const v = M.vehiculoDe(ev);
  const usaKm = M.mantencionUsaKm(ev), usaFecha = M.modoUsaFecha(ev.datos.modo);
  const fecha = $('mtFecha').value || M.hoyStr(), km = NUM('mtKm');
  if (usaKm && km == null) return errEn('mtError', 'Indica el kilometraje al que se hizo.');
  const proxKm = usaKm ? NUM('mtProxKm') : null, proxFecha = usaFecha ? $('mtProxFecha').value : null;
  if (usaKm && (proxKm == null || proxKm <= km)) return errEn('mtError', 'El próximo kilometraje debe ser mayor al kilometraje actual de la mantención.');
  if (usaFecha && !proxFecha) return errEn('mtError', 'Indica la fecha de la próxima mantención.');
  const costo = NUM('mtCosto'), taller = $('mtTaller').value.trim(), factura = $('mtFactura').value.trim(), obs = $('mtObs').value.trim();
  const por = { por: S.staff.uid, porNombre: nombreStaff() };
  const eventoUpdate = {
    'datos.ultimoKm': km ?? ev.datos.ultimoKm ?? null, 'datos.ultimaFecha': fecha,
    ...(usaKm ? { 'datos.proximoKm': proxKm } : {}), ...(usaFecha ? { proximaFecha: proxFecha } : {}),
    estado: 'pendiente', abierto: true, ultimaRealizacion: fecha, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff()
  };
  const btn = $('btnGuardarMantencion'); btn.disabled = true;
  try {
    await registrarMantencionVehiculo({
      eventoId: ev.id, eventoUpdate,
      entradaHistorial: { tipo: 'completado', fechaOcurrencia: ev.proximaFecha || null, fechaReal: fecha, kmReal: km, proveedor: taller || null, monto: costo, moneda: 'CLP', referencia: factura || null, nuevoProximoKm: proxKm, fechaNueva: proxFecha || null, estadoAnterior: ev.estado, estadoNuevo: 'pendiente', nota: obs, ...por },
      vehiculoId: ev.vehiculoId,
      mantencion: { eventoId: ev.id, tipo: ev.datos.nombre, fecha, km, taller, costo, factura, proximoKm: proxKm, proximaFecha: proxFecha || null, observaciones: obs, ...por },
      gasto: costo > 0 ? { tipo: 'Mantención', descripcion: ev.datos.nombre, fecha, monto: costo, moneda: 'CLP', km, proveedor: taller, eventoId: ev.id, creadoPor: S.staff.uid } : null,
      kmVehiculo: (km != null && km > (Number(v?.kmActual) || 0)) ? km : null,
      lectura: { ...por, nota: 'Registrado con la mantención: ' + ev.datos.nombre }
    });
    cerrarModal('modalMantencion');
    toast(usaKm ? `Mantención registrada. Próxima: ${M.formatoKm(proxKm)}` : 'Mantención registrada');
  } catch (e) { console.error(e); errEn('mtError', 'No se pudo guardar. Revisa tu conexión.'); }
  finally { btn.disabled = false; }
}

// Gastos
function abrirGasto(vehiculoId) {
  S.vehGasto = vehiculoId;
  $('gsTipo').value = 'Combustible'; $('gsFecha').value = M.hoyStr();
  ['gsMonto', 'gsKm', 'gsProveedor', 'gsDesc'].forEach(i => { $(i).value = ''; });
  limpiarErr('gsError');
  $('modalGasto').classList.add('visible');
}
async function guardarGasto() {
  const v = veh(S.vehGasto); const monto = NUM('gsMonto'), km = NUM('gsKm');
  if (!(monto > 0)) return errEn('gsError', 'Indica el monto del gasto.');
  const btn = $('btnGuardarGasto'); btn.disabled = true;
  try {
    const kmNuevo = (km != null && km > (Number(v.kmActual) || 0)) ? km : null;
    await crearGastoVehiculo(v.id, { tipo: $('gsTipo').value, fecha: $('gsFecha').value || M.hoyStr(), monto, moneda: 'CLP', km, proveedor: $('gsProveedor').value.trim(), descripcion: $('gsDesc').value.trim() }, S.staff.uid, nombreStaff(), kmNuevo);
    cerrarModal('modalGasto'); toast('Gasto registrado' + (kmNuevo ? ' · kilometraje actualizado' : ''));
  } catch (e) { console.error(e); errEn('gsError', 'No se pudo guardar.'); }
  finally { btn.disabled = false; }
}

// Historial y gastos del vehículo
function pintarHistorialVehiculo() {
  const filaM = (m) => `<div class="ag-hist"><b>${esc(m.tipo)}</b> <span>${esc(M.formatoFechaDMA(m.fecha))}${m.km != null ? ' · ' + esc(M.formatoKm(m.km)) : ''}${m.taller ? ' · ' + esc(m.taller) : ''}${m.costo ? ' · ' + esc(M.formatoMonto(m.costo)) : ''}${m.factura ? ' · fact. ' + esc(m.factura) : ''}${m.proximoKm != null ? ' · próxima: ' + esc(M.formatoKm(m.proximoKm)) : ''}</span>${m.observaciones ? `<small>${esc(m.observaciones)}</small>` : ''}</div>`;
  const filaG = (g) => `<div class="ag-hist"><b>${esc(g.tipo)}</b> <span>${esc(M.formatoFechaDMA(g.fecha))} · ${esc(M.formatoMonto(g.monto))}${g.proveedor ? ' · ' + esc(g.proveedor) : ''}${g.descripcion ? ' · ' + esc(g.descripcion) : ''}${g.km != null ? ' · ' + esc(M.formatoKm(g.km)) : ''}</span></div>`;
  const anio = M.hoyStr().slice(0, 4);
  const total = S.hvGastos.reduce((a, g) => a + (Number(g.monto) || 0), 0);
  const totalAnio = S.hvGastos.filter(g => String(g.fecha).startsWith(anio)).reduce((a, g) => a + (Number(g.monto) || 0), 0);
  $('hvContenido').innerHTML = `
    <div class="ag-dia-cab"><h3 class="ag-h3" style="margin:0">Gastos · ${esc(M.formatoMonto(totalAnio))} este año · ${esc(M.formatoMonto(total))} en total</h3>
      <button type="button" class="btn-secundario" id="btnNuevoGasto">+ Registrar gasto</button></div>
    <div class="ag-hist-lista">${S.hvGastos.map(filaG).join('') || '<p class="ag-vacio">Sin gastos registrados.</p>'}</div>
    <h3 class="ag-h3">Mantenciones realizadas</h3>
    <div class="ag-hist-lista">${S.hvMant.map(filaM).join('') || '<p class="ag-vacio">Aún no hay mantenciones registradas.</p>'}</div>`;
}
function abrirHistorialVehiculo(id) {
  S.hvId = id; S.hvMant = []; S.hvGastos = [];
  $('hvTitulo').textContent = 'Historial · ' + M.etiquetaVehiculo(veh(id));
  S.hvPararM?.(); S.hvPararG?.();
  S.hvPararM = escucharMantencionesVehiculo(id, (l) => { S.hvMant = l; pintarHistorialVehiculo(); });
  S.hvPararG = escucharGastosVehiculo(id, (l) => { S.hvGastos = l; pintarHistorialVehiculo(); });
  pintarHistorialVehiculo();
  $('modalHistVeh').classList.add('visible');
}

// ---------- Colaboradores ----------

const PARENTESCOS_FAMILIAR = { hijo: 'Hijo/a', pareja: 'Cónyuge / pareja', familiar: 'Otro familiar' };
const idCorto = () => Math.random().toString(36).slice(2, 8);

function filaFamiliar(f = {}) {
  const opciones = Object.entries(PARENTESCOS_FAMILIAR).map(([k, v]) => `<option value="${k}" ${f.parentesco === k ? 'selected' : ''}>${v}</option>`).join('');
  return `<div class="ag-fam-fila" data-fid="${esc(f.id || idCorto())}">
    <input type="text" class="fam-nombre" placeholder="Nombre" value="${esc(f.nombre || '')}" autocomplete="off">
    <select class="fam-parentesco">${opciones}</select>
    <input type="date" class="fam-fecha" value="${esc(f.fechaNacimiento || '')}" aria-label="Fecha de nacimiento">
    <button type="button" class="ag-mini fam-quitar" aria-label="Quitar familiar">×</button></div>`;
}

function abrirColaborador(id = null) {
  S.colabEditando = id;
  const c = S.colaboradores.find(x => x.id === id);
  $('coModalTitulo').textContent = c ? 'Editar colaborador' : 'Nuevo colaborador';
  $('coNombre').value = c?.nombre || ''; $('coCargo').value = c?.cargo || '';
  $('coNacimiento').value = c?.fechaNacimiento || ''; $('coIngreso').value = c?.fechaIngreso || '';
  $('coAviso').value = Number.isFinite(c?.avisoDias) ? c.avisoDias : 7;
  $('coFamiliares').innerHTML = (c?.familiares || []).map(filaFamiliar).join('');
  $('coError').textContent = ''; $('coError').classList.remove('visible');
  $('modalColaborador').classList.add('visible');
}

function leerFamiliares() {
  return [...$('coFamiliares').querySelectorAll('.ag-fam-fila')].map(r => ({
    id: r.dataset.fid, nombre: r.querySelector('.fam-nombre').value.trim(),
    parentesco: r.querySelector('.fam-parentesco').value, fechaNacimiento: r.querySelector('.fam-fecha').value || null
  })).filter(f => f.nombre || f.fechaNacimiento);
}

/**
 * Deja la agenda al día con la ficha del colaborador: crea los recordatorios que faltan
 * (cumpleaños, aniversario laboral, cumpleaños de familiares), actualiza los que cambiaron
 * y cancela los que ya no corresponden. Cada recordatorio guarda `origen` para reconocerlo.
 */
async function sincronizarEventosColaborador(c) {
  const por = { por: S.staff.uid, porNombre: nombreStaff() };
  const aviso = Number.isFinite(c.avisoDias) ? c.avisoDias : 7;
  const deseados = [];
  if (c.activo !== false) {
    if (c.fechaNacimiento) deseados.push({ clave: 'nacimiento', motivo: 'cumpleanos', persona: c.nombre, parentesco: 'colaborador', base: c.fechaNacimiento });
    if (c.fechaIngreso) deseados.push({ clave: 'ingreso', motivo: 'aniversario', persona: c.nombre, parentesco: 'colaborador', base: c.fechaIngreso });
    (c.familiares || []).forEach(f => {
      if (f.nombre && f.fechaNacimiento) deseados.push({ clave: 'familiar-' + f.id, motivo: 'cumpleanos', persona: f.nombre, parentesco: f.parentesco || 'familiar', base: f.fechaNacimiento });
    });
  }
  const propios = S.eventos.filter(e => e.origen?.tipo === 'colaborador' && e.origen.id === c.id && M.estaAbierto(e.estado));
  const r = { creados: 0, actualizados: 0, cancelados: 0 };

  for (const d of deseados) {
    const datos = { motivo: d.motivo, persona: d.persona, parentesco: d.parentesco, colaboradorNombre: c.nombre, fechaBase: d.base };
    const titulo = M.tituloSugerido('cumpleanos', datos);
    const ex = propios.find(e => e.origen.clave === d.clave);
    if (!ex) {
      const prox = M.proximoAniversario(d.base);
      await crearEvento({
        titulo, categoria: 'cumpleanos', tipo: null, prioridad: 'media', estado: 'pendiente', abierto: true,
        fecha: prox, proximaFecha: prox, diaAncla: M.partesFecha(d.base).d, todoElDia: true, horaInicio: null, horaFin: null,
        recurrencia: { frecuencia: 'anios', intervalo: 1, hasta: null }, anticipacionDias: aviso, avisarHabilAnterior: false,
        responsableUid: null, responsableNombre: '', recursoIds: [], descripcion: '', notas: '', proyectoCodigo: null, relacion: null, adjuntos: [],
        datos, origen: { tipo: 'colaborador', id: c.id, clave: d.clave }
      }, S.staff.uid, nombreStaff());
      r.creados++;
    } else if (ex.titulo !== titulo || ex.datos?.fechaBase !== d.base || ex.anticipacionDias !== aviso) {
      const cambioBase = ex.datos?.fechaBase !== d.base;
      await actualizarEvento(ex.id, {
        titulo, datos, anticipacionDias: aviso,
        ...(cambioBase ? { proximaFecha: M.proximoAniversario(d.base), diaAncla: M.partesFecha(d.base).d } : {}),
        actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff()
      }, { tipo: 'editado', nota: 'Actualizado desde la ficha del colaborador', ...por });
      r.actualizados++;
    }
  }
  const claves = new Set(deseados.map(d => d.clave));
  for (const ex of propios) {
    if (claves.has(ex.origen.clave)) continue;
    await actualizarEvento(ex.id, { estado: 'cancelado', abierto: false, actualizadoPor: S.staff.uid, actualizadoPorNombre: nombreStaff() },
      { tipo: 'cancelado', estadoAnterior: ex.estado, estadoNuevo: 'cancelado', nota: 'Ya no corresponde según la ficha del colaborador', ...por });
    r.cancelados++;
  }
  return r;
}

function resumenSync(r) {
  const partes = [];
  if (r.creados) partes.push(`${r.creados} recordatorio${r.creados === 1 ? '' : 's'} creado${r.creados === 1 ? '' : 's'}`);
  if (r.actualizados) partes.push(`${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}`);
  if (r.cancelados) partes.push(`${r.cancelados} cancelado${r.cancelados === 1 ? '' : 's'}`);
  return partes.length ? ' · ' + partes.join(', ') : '';
}

async function guardarColaborador() {
  const err = (m) => { const e = $('coError'); e.textContent = m; e.classList.add('visible'); };
  const nombre = $('coNombre').value.trim();
  if (!nombre) return err('Escribe el nombre del colaborador.');
  const familiares = leerFamiliares();
  if (familiares.some(f => !f.nombre || !f.fechaNacimiento)) return err('Cada familiar necesita nombre y fecha de nacimiento (o quítalo de la lista).');
  const datos = {
    nombre, cargo: $('coCargo').value.trim(), fechaNacimiento: $('coNacimiento').value || null, fechaIngreso: $('coIngreso').value || null,
    avisoDias: Math.max(0, parseInt($('coAviso').value, 10) || 0), familiares
  };
  const btn = $('btnGuardarColaborador'); btn.disabled = true;
  try {
    let id = S.colabEditando;
    const previo = S.colaboradores.find(x => x.id === id);
    if (id) await actualizarColaborador(id, datos); else id = await crearColaborador(datos, S.staff.uid);
    const r = await sincronizarEventosColaborador({ id, ...datos, activo: previo ? previo.activo !== false : true });
    cerrarModal('modalColaborador');
    toast('Colaborador guardado' + resumenSync(r));
  } catch (e) { console.error(e); err('No se pudo guardar. Revisa tu conexión (y que tu usuario sea administrador).'); }
  finally { btn.disabled = false; }
}

async function cambiarEstadoColaborador(id) {
  const c = S.colaboradores.find(x => x.id === id); if (!c) return;
  const activo = c.activo === false;     // el nuevo estado
  try {
    await actualizarColaborador(id, { activo });
    const r = await sincronizarEventosColaborador({ ...c, activo });
    toast((activo ? 'Colaborador activado' : 'Colaborador desactivado') + resumenSync(r));
  } catch (e) { console.error(e); toast('No se pudo cambiar el estado', 'error'); }
}

// ---------- Modales ----------

function cerrarModal(id) {
  $(id).classList.remove('visible');
  if (id === 'modalDetalle') { S.pararHistorial?.(); S.pararHistorial = null; S.detalleId = null; }
  if (id === 'modalHistVeh') { S.hvPararM?.(); S.hvPararG?.(); S.hvPararM = S.hvPararG = null; S.hvId = null; }
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
    if (t.closest('#btnNuevoVehiculo')) return abrirVehiculo();
    const ae = t.closest('[data-auto-editar]'); if (ae) return abrirAuto(ae.dataset.autoEditar);
    if (t.closest('#btnAutoActivo')) return guardarConfigAuto({ activo: !S.autoConfig.activo, reglas: S.autoConfig.reglas || {} }, S.autoConfig.activo ? 'Recordatorios automáticos desactivados' : 'Recordatorios automáticos activados');
    if (t.closest('#btnAutoAplicar')) return aplicarAutomatizacionesExistentes();
    if (t.closest('#btnAutoRestaurar')) { if (confirm('¿Volver a los valores originales? (Instalación: 7, 3 y 1 días antes)')) guardarConfigAuto({ activo: true, reglas: JSON.parse(JSON.stringify(M.AUTOMATIZACIONES_DEFECTO.reglas)) }, 'Valores originales restaurados'); return; }
    const vk = t.closest('[data-veh-km]'); if (vk) return abrirKm(vk.dataset.vehKm);
    const ve = t.closest('[data-veh-editar]'); if (ve) return abrirVehiculo(ve.dataset.vehEditar);
    const vs = t.closest('[data-veh-estado]'); if (vs) return cambiarEstadoVehiculo(vs.dataset.vehEstado);
    const vh = t.closest('[data-veh-hist]'); if (vh) return abrirHistorialVehiculo(vh.dataset.vehHist);
    const vp = t.closest('[data-veh-plan]'); if (vp) { const [vid, clase] = vp.dataset.vehPlan.split(':'); return abrirPlan(vid, clase); }
    const nc = t.closest('[data-nueva-cat]'); if (nc) return abrirFormulario(null, { categoria: nc.dataset.nuevaCat });
    if (t.closest('#btnNuevoColaborador')) return abrirColaborador();
    const ce = t.closest('[data-colab-editar]'); if (ce) return abrirColaborador(ce.dataset.colabEditar);
    const cs = t.closest('[data-colab-estado]'); if (cs) return cambiarEstadoColaborador(cs.dataset.colabEstado);
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

  // Recordatorios automáticos
  $('btnAgregarPaso').addEventListener('click', () => $('auFilas').insertAdjacentHTML('beforeend', filaPaso()));
  $('auFilas').addEventListener('click', (e) => e.target.closest('.paso-quitar')?.closest('.ag-paso-fila')?.remove());
  $('btnGuardarAuto').addEventListener('click', guardarAuto);
  $('btnCancelarAuto').addEventListener('click', () => cerrarModal('modalAuto'));

  // Vehículos
  $('btnGuardarVehiculo').addEventListener('click', guardarVehiculo);
  $('btnCancelarVehiculo').addEventListener('click', () => cerrarModal('modalVehiculo'));
  $('btnGuardarKm').addEventListener('click', guardarKm);
  $('btnCancelarKm').addEventListener('click', () => cerrarModal('modalKm'));
  $('btnGuardarPlan').addEventListener('click', guardarPlan);
  $('btnCancelarPlan').addEventListener('click', () => cerrarModal('modalPlan'));
  $('pvClase').addEventListener('change', () => { llenarTiposPlan($('pvClase').value); $('pvAntic').value = $('pvClase').value === 'documento' ? 30 : 15; actualizarPlanFormulario(); });
  $('pvModo').addEventListener('change', actualizarPlanFormulario);
  $('pvVehiculo').addEventListener('change', () => { if (!S.planEditando) { $('pvUltimoKm').value = veh($('pvVehiculo').value)?.kmActual ?? ''; recalcularProximoKm(); } });
  ['pvUltimoKm', 'pvIntervaloKm'].forEach(id => $(id).addEventListener('input', recalcularProximoKm));
  $('pvProximoKm').addEventListener('input', () => { $('pvProximoKm').dataset.manual = '1'; });
  $('btnGuardarMantencion').addEventListener('click', confirmarMantencion);
  $('btnCancelarMantencion').addEventListener('click', () => cerrarModal('modalMantencion'));
  ['mtKm', 'mtFecha'].forEach(id => $(id).addEventListener('input', actualizarMantencionProx));
  $('btnGuardarGasto').addEventListener('click', guardarGasto);
  $('btnCancelarGasto').addEventListener('click', () => cerrarModal('modalGasto'));
  $('btnCerrarHistVeh').addEventListener('click', () => cerrarModal('modalHistVeh'));
  $('hvContenido').addEventListener('click', (e) => { if (e.target.closest('#btnNuevoGasto')) abrirGasto(S.hvId); });

  // Colaboradores
  $('btnAgregarFamiliar').addEventListener('click', () => $('coFamiliares').insertAdjacentHTML('beforeend', filaFamiliar()));
  $('coFamiliares').addEventListener('click', (e) => e.target.closest('.fam-quitar')?.closest('.ag-fam-fila')?.remove());
  $('btnGuardarColaborador').addEventListener('click', guardarColaborador);
  $('btnCancelarColaborador').addEventListener('click', () => cerrarModal('modalColaborador'));

  // Título sugerido según lo que se va escribiendo (servicios, créditos, cumpleaños)
  ['svTipo', 'svProveedor', 'obTipo', 'obInstitucion', 'cuPersona', 'cuParentesco', 'cuColaborador', 'cuMotivo'].forEach(id => {
    $(id).addEventListener('input', sugerirTitulo); $(id).addEventListener('change', sugerirTitulo);
  });
  $('cuMotivo').addEventListener('change', actualizarCumpleEtiqueta);

  // Formulario
  $('evCategoria').addEventListener('change', () => { actualizarFormularioSegunCategoria(); mostrarInfoProyecto(); });
  $('evTipo').addEventListener('change', () => mostrarInfoProyecto());
  $('evProyecto').addEventListener('input', () => mostrarInfoProyecto());
  $('evProyecto').addEventListener('change', () => mostrarInfoProyecto());
  $('evRepite').addEventListener('change', actualizarRepeticion);
  $('evAntic').addEventListener('change', actualizarAnticCustom);
  $('evTodoDia').addEventListener('change', actualizarHorario);
  $('formEvento').addEventListener('submit', (e) => { e.preventDefault(); guardarEvento(); });
  $('btnCancelarEvento').addEventListener('click', () => cerrarModal('modalEvento'));

  // Detalle
  $('detContenido').addEventListener('click', (e) => {
    const ab = e.target.closest('[data-abrir-ev]');
    if (ab) { e.preventDefault(); if (S.eventos.some(x => x.id === ab.dataset.abrirEv)) abrirDetalle(ab.dataset.abrirEv); else toast('Esa actividad ya no está en la agenda', 'error'); return; }
    const b = e.target.closest('[data-det]'); if (!b) return;
    const id = S.detalleId; const a = b.dataset.det;
    if (a === 'editar') { const ev = S.eventos.find(x => x.id === id); cerrarModal('modalDetalle'); if (ev.categoria === 'vehiculo') abrirPlan(ev.vehiculoId, ev.datos?.clase, ev); else abrirFormulario(ev); }
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

  // Menú lateral en teléfono: mismo mecanismo que dashboard.js (clase "abierto").
  const alternar = (abrir) => ['dashSidebar', 'sidebarOverlay'].forEach(id => $(id)?.classList.toggle('abierto', abrir));
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
}

/** agenda.html?nuevo=1&proyecto=LIN-00025&tipo=instalacion → formulario ya con el proyecto elegido.
 *  agenda.html?nuevo=1&lead=<id del lead>&tipo=visita_cliente → igual, pero con el cliente del CRM. */
function deepLinkNuevo() {
  if (S.deepLinkNuevoHecho) return;
  const p = new URLSearchParams(location.search);
  if (p.get('nuevo') !== '1') return;
  if (p.get('lead') && !S.leadsListos) return;   // espera a leer los clientes para mostrar sus datos; se reintenta al llegar
  S.deepLinkNuevoHecho = true;
  const tipo = M.TIPOS_ACTIVIDAD[p.get('tipo')] ? p.get('tipo') : undefined;
  abrirFormulario(null, { fecha: p.get('fecha') || undefined, proyectoCodigo: codigoDesdeTexto(p.get('proyecto')) || undefined, leadId: p.get('lead') || undefined, tipo, categoria: 'actividad' });
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
  $('staffRol').textContent = staff.rol === 'admin' ? 'Administrador' : 'Staff';
  $('btnCerrarSesion').addEventListener('click', async () => { await cerrarSesion(); location.href = 'login.html'; });

  // Estructura estática (listas de opciones)
  $('fCat').innerHTML = '<option value="">Todas las categorías</option>' + Object.entries(M.CATEGORIAS).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  const todosEstados = [...new Set(Object.values(M.ESTADOS_POR_CATEGORIA).flat())];
  $('fEstado').innerHTML = '<option value="">Todos los estados</option><option value="vencido">Vencidos</option>' + todosEstados.map(k => `<option value="${k}">${M.ESTADOS[k].nombre}</option>`).join('');
  $('fPrio').innerHTML = '<option value="">Todas las prioridades</option>' + Object.entries(M.PRIORIDADES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('evCategoria').innerHTML = Object.entries(M.CATEGORIAS).filter(([k]) => k !== 'vehiculo').map(([k, v]) => `<option value="${k}">${v.icono} ${v.nombre}</option>`).join('');
  $('evTipo').innerHTML = Object.entries(M.TIPOS_ACTIVIDAD).map(([k, v]) => `<option value="${k}">${v.icono} ${v.nombre}</option>`).join('');
  $('evPrioridad').innerHTML = Object.entries(M.PRIORIDADES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('evRepite').innerHTML = Object.entries(M.REPETICIONES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join('');
  $('evAntic').innerHTML = M.ANTICIPACIONES.map(a => `<option value="${a.v}">${a.t}</option>`).join('') + '<option value="otro">Personalizado…</option>';
  const opts = (arr, vacio) => (vacio ? `<option value="">${vacio}</option>` : '') + arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  $('svTipo').innerHTML = opts(M.TIPOS_SERVICIO); $('obTipo').innerHTML = opts(M.TIPOS_OBLIGACION);
  ['svMoneda', 'obMoneda'].forEach(id => { $(id).innerHTML = opts(M.MONEDAS); });
  ['svMetodo', 'obMetodo', 'cpMetodo'].forEach(id => { $(id).innerHTML = opts(M.METODOS_PAGO, '—'); });
  $('cuMotivo').innerHTML = '<option value="cumpleanos">Cumpleaños</option><option value="aniversario">Aniversario laboral</option>';
  $('cuParentesco').innerHTML = Object.entries(M.PARENTESCOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('pvModo').innerHTML = Object.entries(M.MODOS_MANTENCION).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('gsTipo').innerHTML = M.TIPOS_GASTO_VEHICULO.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('rcTipo').innerHTML = Object.entries(TIPOS_RECURSO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  try { S.usuarios = await listarUsuariosStaff(); } catch (e) { console.warn('No se pudo cargar la lista de responsables', e); }
  const optsResp = S.usuarios.map(u => `<option value="${esc(u.uid)}">${esc(u.nombre || u.email || u.uid)}</option>`).join('');
  $('fResp').innerHTML = '<option value="">Todos los responsables</option>' + optsResp;
  $('evResp').innerHTML = '<option value="">Sin asignar</option>' + optsResp;
  $('vhResp').innerHTML = '<option value="">Sin asignar</option>' + optsResp;

  enlazar();
  await mejorarSelects(['fCat', 'fEstado', 'fPrio', 'fResp', 'evCategoria', 'evTipo', 'evPrioridad', 'evRepite', 'evUnidad', 'evAntic', 'evResp', 'rcTipo', 'svTipo', 'svMoneda', 'svMetodo', 'obTipo', 'obMoneda', 'obMetodo', 'cuMotivo', 'cuParentesco', 'cpMetodo', 'pvModo', 'gsTipo']);

  escucharRecursos((lista) => { S.recursos = lista; refrescarSiAplica(); }, () => toast('No se pudieron leer los recursos', 'error'));
  if (esAdmin()) {
    $('tabColaboradores').style.display = '';
    escucharColaboradores((lista) => {
      S.colaboradores = lista;
      $('cuColaboradorLista').innerHTML = lista.filter(c => c.activo !== false).map(c => `<option value="${esc(c.nombre)}"></option>`).join('');
      refrescarSiAplica();
    }, () => toast('No se pudo leer la lista de colaboradores', 'error'));
  }
  if (esAdmin()) $('tabConfiguracion').style.display = '';
  escucharConfigAgenda((cfg) => { S.autoConfig = M.normalizarAutomatizaciones(cfg); refrescarSiAplica(); },
    () => console.warn('No se pudo leer la configuración de recordatorios automáticos; se usan los valores originales.'));
  escucharVehiculos((lista) => { S.vehiculos = lista; M.setVehiculos(lista); refrescarSiAplica(); }, () => toast('No se pudieron leer los vehículos. ¿Publicaste las reglas nuevas?', 'error'));
  escucharProyectos((lista) => {
    S.proyectos = lista.filter(p => p.activo !== false);
    S.proyectosPorCodigo = Object.fromEntries(lista.map(p => [p.codigo, p]));
    $('evProyectoLista').innerHTML = S.proyectos
      .sort((a, b) => String(b.codigo).localeCompare(String(a.codigo)))
      .map(p => `<option value="${esc(p.codigo)} — ${esc(p.cliente || '')}"></option>`).join('');
    refrescarSiAplica();
    deepLinkNuevo();
  }, () => { toast('No se pudieron leer los proyectos', 'error'); deepLinkNuevo(); });
  escucharLeads((lista) => {
    S.leadsPorId = Object.fromEntries(lista.map(l => [l.id, l]));
    S.leadsListos = true;
    refrescarSiAplica();
    deepLinkNuevo();
  }, () => { S.leadsListos = true; deepLinkNuevo(); });   // si no se pueden leer, la agenda funciona igual (sin datos del cliente)
  escucharEventos((lista) => { S.eventos = lista; refrescarSiAplica(); intentarDeepLink(); }, () => toast('No se pudo leer la agenda. Revisa que las reglas de Firestore incluyan "eventos".', 'error'));
  render();
}

function mostrarLayout() {
  $('dashCargando').style.display = 'none';
  $('dashLayout').style.display = 'flex';
  $('dashTopbarMobile').style.display = '';   // como en dashboard.js: lo muestra el CSS solo en móvil
}

observarSesionStaff((staff) => {
  if (!staff) { location.href = 'login.html'; return; }
  if (S.staff) return;          // la sesión ya estaba iniciada
  mostrarLayout();
  iniciar(staff);
});
