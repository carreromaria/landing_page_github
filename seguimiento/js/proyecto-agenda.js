// ============================================================
// LINENCE — Agenda dentro del detalle del proyecto
// ============================================================
// dashboard.js llama a mostrarAgendaProyecto(codigo) al abrir un proyecto
// y a ocultarAgendaProyecto() al volver al listado. Agrega, en la vista de
// detalle, un bloque con "Programar actividad" y las actividades ya
// agendadas de ese proyecto.
//
// Las actividades se leen de la colección "eventos" (campo proyectoCodigo);
// aquí no se guarda ni se copia nada del proyecto.
//
// Los módulos de agenda se cargan al usarse (import dinámico) para que, si
// un archivo no está subido o el navegador guardó una versión vieja, el
// detalle del proyecto siga funcionando igual.

const ATAJOS = ['visita_cliente', 'toma_medidas', 'reunion_diseno', 'instalacion', 'entrega', 'postventa'];
const ROJO = '#c14b32', NARANJA = '#d98a2b', VERDE = '#5b8a5a', GRIS = '#8a8a8a';

let seccion = null, lista = null, parar = null, M = null, codigoActual = null;

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
    ATAJOS.map(t => `<a href="${base}&tipo=${t}">${M.TIPOS_ACTIVIDAD[t].icono} ${esc(M.TIPOS_ACTIVIDAD[t].nombre)}</a>`).join('') +
    `<a href="${base}">＋ Otra actividad</a>`;
}

function pintarLista(eventos) {
  const hoy = M.hoyStr();
  const orden = [...eventos].sort((a, b) => {
    const ab = M.estaAbierto(a.estado), bb = M.estaAbierto(b.estado);
    if (ab !== bb) return ab ? -1 : 1;                       // pendientes primero
    return ab ? (a.proximaFecha || '').localeCompare(b.proximaFecha || '')
              : (b.proximaFecha || '').localeCompare(a.proximaFecha || '');
  });
  if (!orden.length) { lista.innerHTML = '<p class="pa-vacio">Aún no hay actividades agendadas para este proyecto.</p>'; return; }
  lista.innerHTML = orden.map(ev => {
    const abierto = M.estaAbierto(ev.estado);
    const al = M.evaluarEvento(ev, hoy);
    const color = !abierto ? GRIS : al?.nivel === 'vencido' ? ROJO : (ev.estado === 'confirmacion_pendiente' || al?.nivel === 'urgente') ? NARANJA : VERDE;
    const icono = M.TIPOS_ACTIVIDAD[ev.tipo]?.icono || '📋';
    const hora = ev.todoElDia ? 'Todo el día' : ev.horaInicio ? (ev.horaFin ? `${ev.horaInicio}–${ev.horaFin}` : ev.horaInicio) : '';
    const estado = al?.nivel === 'vencido' ? 'Vencido' : (M.ESTADOS[ev.estado]?.nombre || ev.estado);
    return `<a class="pa-fila" style="border-left-color:${color}${abierto ? '' : ';opacity:.7'}" href="agenda.html?evento=${encodeURIComponent(ev.id)}">
      <span class="pa-fecha">${esc(M.formatoFechaCorta(ev.proximaFecha))}<small>${esc(hora)}</small></span>
      <span class="pa-titulo">${icono} ${esc(ev.titulo)}</span>
      <span class="pa-estado" style="color:${color}">${esc(estado)}</span></a>`;
  }).join('');
}

/** Abre (o actualiza) el bloque de agenda para el proyecto que se está mirando. */
export async function mostrarAgendaProyecto(codigo) {
  const cod = String(codigo || '').toUpperCase();
  if (!/^LIN-\d+$/.test(cod)) return;
  parar?.(); parar = null; codigoActual = cod;
  try {
    const [fs, motor] = await Promise.all([import('./firestore.js'), import('./agenda-motor.js')]);
    if (codigoActual !== cod) return;                 // se cambió de proyecto mientras cargaba
    M = motor;
    inyectarEstilos();
    if (!seccion && !crearSeccion()) return;
    pintarAtajos(cod);
    lista.innerHTML = '<p class="pa-vacio">Cargando…</p>';
    parar = fs.escucharEventosDeProyecto(cod, pintarLista,
      () => { lista.innerHTML = '<p class="pa-vacio">No se pudo leer la agenda de este proyecto.</p>'; });
  } catch (err) {
    console.warn('Agenda del proyecto no disponible:', err);
    if (lista) lista.innerHTML = '<p class="pa-vacio">La agenda de este proyecto no está disponible por ahora.</p>';
  }
}

/** Deja de escuchar al volver al listado. */
export function ocultarAgendaProyecto() {
  parar?.(); parar = null; codigoActual = null;
  if (lista) lista.innerHTML = '';
}
