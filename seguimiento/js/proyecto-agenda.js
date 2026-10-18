// ============================================================
// LINENCE — Agenda dentro del detalle del proyecto
// ============================================================
// dashboard.js llama a mostrarAgendaProyecto(codigo) al abrir un proyecto
// y a ocultarAgendaProyecto() al volver al listado. El bloque en sí (botones,
// lista de actividades) lo dibuja el componente compartido
// js/components/agenda-actividades.js; aquí solo se dice qué mostrar.
//
// Las actividades se leen de la colección "eventos" (campo proyectoCodigo);
// aquí no se guarda ni se copia nada del proyecto.

import { crearAgendaActividades } from './components/agenda-actividades.js';

const agenda = crearAgendaActividades({
  id: 'agendaProyecto',
  titulo: 'Agenda del proyecto',
  tipos: ['visita_cliente', 'toma_medidas', 'reunion_diseno', 'instalacion', 'entrega', 'postventa'],
  textoVacio: 'Aún no hay actividades agendadas para este proyecto.',
  textoError: 'No se pudo leer la agenda de este proyecto.',
  // Va antes de la primera sección del detalle del proyecto
  insertar: (seccion) => {
    const detalle = document.getElementById('vistaDetalle');
    if (!detalle) return false;
    const primera = detalle.querySelector('.panel-seccion');
    if (primera) detalle.insertBefore(seccion, primera);
    else detalle.appendChild(seccion);
  },
  urlNueva: (codigo, tipo) =>
    `agenda.html?nuevo=1&proyecto=${encodeURIComponent(codigo)}${tipo ? `&tipo=${tipo}` : ''}`,
  suscribir: (fs, codigo, alDatos, alError) => fs.escucharEventosDeProyecto(codigo, alDatos, alError)
});

/** Abre (o actualiza) el bloque de agenda para el proyecto que se está mirando. */
export function mostrarAgendaProyecto(codigo) {
  const cod = String(codigo || '').toUpperCase();
  if (!/^LIN-\d+$/.test(cod)) return;
  return agenda.mostrar(cod);
}

/** Deja de escuchar al volver al listado. */
export function ocultarAgendaProyecto() {
  agenda.ocultar();
}
