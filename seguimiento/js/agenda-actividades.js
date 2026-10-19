// ============================================================
// LINENCE — Componente "Agenda de actividades"
// ============================================================
// Bloque reutilizable: título + botones para programar actividades + lista
// de las actividades ya agendadas. Lo usan Proyectos (js/proyecto-agenda.js)
// y el CRM (ficha del cliente); cada pantalla solo le dice QUÉ mostrar:
//
//   const agenda = crearAgendaActividades({
//     id: 'agendaProyecto',                       // id de la sección en el DOM
//     titulo: 'Agenda del proyecto',
//     tipos: ['visita_cliente', 'toma_medidas'],  // botones, en este orden (claves de TIPOS_ACTIVIDAD)
//     conOtraActividad: true,                     // agrega "＋ Otra actividad"
//     estiloCrm: false,                           // true = rótulo dorado del CRM en vez de h2
//     textoVacio: 'Aún no hay actividades agendadas para este proyecto.',
//     textoError: 'No se pudo leer la agenda de este proyecto.',
//     insertar: (seccion) => { ... },             // pone la sección en la pantalla; false si no puede
//     urlNueva: (clave, tipo) => 'agenda.html?nuevo=1&...',   // tipo = undefined en "Otra actividad"
//     suscribir: (fs, clave, alDatos, alError) => fs.escucharXxx(clave, alDatos, alError)  // devuelve la función para dejar de escuchar
//   });
//   agenda.mostrar(clave);   // al abrir la ficha (clave: texto u objeto; solo se le pasa a urlNueva y suscribir)
//   agenda.ocultar();        // al cerrarla
//
// Las actividades viven en la colección "eventos" (no se copia nada aquí).
// firestore.js y agenda-motor.js se cargan al usarse (import dinámico): si un
// archivo no estuviera subido o el navegador guardó una versión vieja, la
// pantalla que usa el componente sigue funcionando igual.

const ROJO = '#c14b32', NARANJA = '#d98a2b', VERDE = '#5b8a5a', GRIS = '#8a8a8a';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inyectarEstilos() {
  if (document.getElementById('agenda-actividades-estilos')) return;
  const s = document.createElement('style');
  s.id = 'agenda-actividades-estilos';
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
  .pa-seccion-crm{margin-bottom:8px}
  @media(max-width:600px){.pa-fila{flex-wrap:wrap}.pa-fecha{flex:0 0 100%}}`;
  document.head.appendChild(s);
}

export function crearAgendaActividades(opciones) {
  const {
    id, titulo, tipos = [], conOtraActividad = true, estiloCrm = false,
    textoVacio = 'Aún no hay actividades agendadas.',
    textoError = 'No se pudo leer la agenda.',
    insertar, urlNueva, suscribir
  } = opciones;

  let seccion = null, lista = null, parar = null, M = null, claveActual = null;

  function crearSeccion() {
    const el = document.createElement('section');
    el.id = id;
    // En el CRM los títulos de sección son el rótulo dorado (.crm-bitacora-titulo); en Proyectos, un h2 dentro de .panel-seccion
    el.className = estiloCrm ? 'pa-seccion-crm' : 'panel-seccion';
    const encabezado = estiloCrm ? `<div class="crm-bitacora-titulo">${esc(titulo)}</div>` : `<h2>${esc(titulo)}</h2>`;
    el.innerHTML = `${encabezado}<div class="pa-atajos"></div><div class="pa-lista"></div>`;
    if (insertar(el) === false) return false;
    seccion = el;
    lista = el.querySelector('.pa-lista');
    return true;
  }

  function pintarAtajos(clave) {
    const botones = tipos.filter(t => M.TIPOS_ACTIVIDAD[t]).map(t =>
      `<a href="${esc(urlNueva(clave, t))}">${M.TIPOS_ACTIVIDAD[t].icono} ${esc(M.TIPOS_ACTIVIDAD[t].nombre)}</a>`);
    if (conOtraActividad) botones.push(`<a href="${esc(urlNueva(clave))}">＋ Otra actividad</a>`);
    seccion.querySelector('.pa-atajos').innerHTML = botones.join('');
  }

  function pintarLista(eventos) {
    const hoy = M.hoyStr();
    const orden = [...eventos].sort((a, b) => {
      const ab = M.estaAbierto(a.estado), bb = M.estaAbierto(b.estado);
      if (ab !== bb) return ab ? -1 : 1;                       // pendientes primero
      return ab ? (a.proximaFecha || '').localeCompare(b.proximaFecha || '')
                : (b.proximaFecha || '').localeCompare(a.proximaFecha || '');
    });
    if (!orden.length) { lista.innerHTML = `<p class="pa-vacio">${esc(textoVacio)}</p>`; return; }
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

  /** Abre (o actualiza) el bloque para la ficha que se está mirando. */
  async function mostrar(clave) {
    if (!clave) return;
    parar?.(); parar = null; claveActual = clave;
    try {
      const [fs, motor] = await Promise.all([import('../firestore.js'), import('../agenda-motor.js')]);
      if (claveActual !== clave) return;                 // se cambió de ficha mientras cargaba
      M = motor;
      inyectarEstilos();
      if (seccion && !seccion.isConnected) seccion = null; // la pantalla rehizo su contenido
      if (!seccion && !crearSeccion()) return;
      pintarAtajos(clave);
      lista.innerHTML = '<p class="pa-vacio">Cargando…</p>';
      parar = suscribir(fs, clave, pintarLista,
        () => { lista.innerHTML = `<p class="pa-vacio">${esc(textoError)}</p>`; });
    } catch (err) {
      console.warn('Agenda no disponible:', err);
      if (lista) lista.innerHTML = '<p class="pa-vacio">La agenda no está disponible por ahora.</p>';
    }
  }

  /** Deja de escuchar al cerrar la ficha. */
  function ocultar() {
    parar?.(); parar = null; claveActual = null;
    if (lista) lista.innerHTML = '';
  }

  return { mostrar, ocultar };
}
