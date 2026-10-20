// ============================================================
// LINENCE — Agenda y Gestión de Vencimientos
// Motor de eventos (lógica pura: fechas, recurrencias, estados,
// alertas y conflictos). NO habla con Firestore ni con el DOM:
// la campanita, el calendario y los demás módulos usan este mismo
// archivo, así hay un único lugar donde viven las reglas.
// ============================================================
//
// Convenciones:
//  - Las fechas viajan como texto "AAAA-MM-DD" y las horas como "HH:MM",
//    siempre en hora de Chile. Así no hay cambios de día por zona horaria.
//  - Un evento guarda su regla de repetición y su `proximaFecha`
//    (la ocurrencia vigente). No se crean copias por cada repetición.

export const ZONA = 'America/Santiago';

// ---------- Catálogos ----------

export const CATEGORIAS = {
  actividad:   { nombre: 'Actividad',   icono: '📆' },
  recordatorio:{ nombre: 'Recordatorio',icono: '🔔' },
  vencimiento: { nombre: 'Otro vencimiento', icono: '📅' },
  servicio:    { nombre: 'Servicio / suscripción', icono: '💡' },
  obligacion:  { nombre: 'Crédito / obligación', icono: '💳' },
  cumpleanos:  { nombre: 'Cumpleaños y aniversarios', icono: '🎂' },
  vehiculo:    { nombre: 'Vehículo', icono: '🚗' }
};

/** Categorías que registran pagos (monto, comprobante, historial de pagos). */
export const CATEGORIAS_PAGO = ['servicio', 'obligacion'];
export const esPago = (ev) => CATEGORIAS_PAGO.includes(ev?.categoria);

export const TIPOS_ACTIVIDAD = {
  visita_cliente:  { nombre: 'Visita a cliente',     icono: '🏠' },
  toma_medidas:    { nombre: 'Toma de medidas',      icono: '📏' },
  reunion_diseno:  { nombre: 'Reunión de diseño',    icono: '🎨' },
  firma_contrato:  { nombre: 'Firma de contrato',    icono: '✍️' },
  instalacion:     { nombre: 'Instalación',          icono: '🚚' },
  entrega:         { nombre: 'Entrega',              icono: '📦' },
  postventa:       { nombre: 'Postventa',            icono: '🔧' },
  reunion_interna: { nombre: 'Reunión interna',      icono: '👥' },
  taller:          { nombre: 'Actividad de taller',  icono: '🏭' },
  vehiculo:        { nombre: 'Actividad de vehículo',icono: '🚗' },
  otra:            { nombre: 'Otra actividad',       icono: '📋' }
};

export const PRIORIDADES = {
  baja:    { nombre: 'Baja',    orden: 1 },
  media:   { nombre: 'Media',   orden: 2 },
  alta:    { nombre: 'Alta',    orden: 3 },
  urgente: { nombre: 'Urgente', orden: 4 }
};

export const ESTADOS = {
  borrador:               { nombre: 'Borrador',                abierto: true  },
  programado:             { nombre: 'Programado',              abierto: true  },
  confirmacion_pendiente: { nombre: 'Confirmación pendiente',  abierto: true  },
  confirmado:             { nombre: 'Confirmado',              abierto: true  },
  en_ejecucion:           { nombre: 'En ejecución',            abierto: true  },
  reprogramado:           { nombre: 'Reprogramado',            abierto: true  },
  pendiente:              { nombre: 'Pendiente',               abierto: true  },
  pospuesto:              { nombre: 'Pospuesto',               abierto: true  },
  realizado:              { nombre: 'Realizado',               abierto: false },
  cancelado:              { nombre: 'Cancelado',               abierto: false },
  no_realizado:           { nombre: 'No realizado',            abierto: false }
};

export const ESTADOS_POR_CATEGORIA = {
  actividad:    ['borrador','programado','confirmacion_pendiente','confirmado','en_ejecucion','realizado','cancelado','reprogramado','no_realizado'],
  recordatorio: ['pendiente','realizado','pospuesto','cancelado'],
  vencimiento:  ['pendiente','realizado','pospuesto','cancelado'],
  servicio:     ['pendiente','realizado','pospuesto','cancelado'],
  obligacion:   ['pendiente','realizado','pospuesto','cancelado'],
  cumpleanos:   ['pendiente','realizado','pospuesto','cancelado'],
  vehiculo:     ['pendiente','realizado','pospuesto','cancelado']
};

export function estadoInicial(categoria) {
  return categoria === 'actividad' ? 'programado' : 'pendiente';
}
/** Estado "en curso" al que vuelve una serie repetitiva después de completar una ocurrencia. */
export function estadoReinicio(categoria) { return estadoInicial(categoria); }

export function estaAbierto(estado) { return ESTADOS[estado]?.abierto !== false; }

export const ANTICIPACIONES = [
  { v: 0,  t: 'En el momento' },
  { v: 1,  t: '1 día antes' },
  { v: 3,  t: '3 días antes' },
  { v: 5,  t: '5 días antes' },
  { v: 7,  t: '7 días antes' },
  { v: 15, t: '15 días antes' },
  { v: 30, t: '30 días antes' }
];

/** Anticipación sugerida al crear, según categoría (editable por el usuario). */
export const ANTICIPACION_SUGERIDA = { actividad: 1, recordatorio: 1, vencimiento: 5, servicio: 5, obligacion: 7, cumpleanos: 7, vehiculo: 30 };

/** Repetición con la que parte cada categoría al crear (se puede cambiar). */
export const REPETICION_SUGERIDA = { servicio: 'mensual', obligacion: 'mensual', cumpleanos: 'anual' };

// Opciones rápidas de repetición → regla interna {frecuencia, intervalo}
export const REPETICIONES = {
  unica:        { nombre: 'Una sola vez',  regla: { frecuencia: 'ninguna', intervalo: 1 } },
  diaria:       { nombre: 'Diario',        regla: { frecuencia: 'dias',    intervalo: 1 } },
  semanal:      { nombre: 'Semanal',       regla: { frecuencia: 'semanas', intervalo: 1 } },
  mensual:      { nombre: 'Mensual',       regla: { frecuencia: 'meses',   intervalo: 1 } },
  trimestral:   { nombre: 'Trimestral',    regla: { frecuencia: 'meses',   intervalo: 3 } },
  semestral:    { nombre: 'Semestral',     regla: { frecuencia: 'meses',   intervalo: 6 } },
  anual:        { nombre: 'Anual',         regla: { frecuencia: 'anios',   intervalo: 1 } },
  personalizada:{ nombre: 'Cada X días / semanas / meses…', regla: null }
};

/** Dada una regla guardada, devuelve la clave de REPETICIONES que la representa. */
export function claveRepeticion(regla) {
  if (!regla || regla.frecuencia === 'ninguna') return 'unica';
  for (const [k, r] of Object.entries(REPETICIONES)) {
    if (r.regla && r.regla.frecuencia === regla.frecuencia && r.regla.intervalo === regla.intervalo) return k;
  }
  return 'personalizada';
}

export function textoRegla(regla) {
  if (!regla || regla.frecuencia === 'ninguna') return 'Una sola vez';
  const k = claveRepeticion(regla);
  if (k !== 'personalizada') return REPETICIONES[k].nombre;
  const u = { dias: 'días', semanas: 'semanas', meses: 'meses', anios: 'años' }[regla.frecuencia] || regla.frecuencia;
  return `Cada ${regla.intervalo} ${u}`;
}

export function esRecurrente(ev) {
  return !!ev?.recurrencia && ev.recurrencia.frecuencia !== 'ninguna';
}

// ---------- Fechas (texto AAAA-MM-DD, hora de Chile) ----------

const p2 = n => String(n).padStart(2, '0');

export function hoyStr(ahora = new Date()) {
  // "en-CA" entrega AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}
export function horaAhoraStr(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(ahora);
}

export function partesFecha(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return { y, m, d };
}
export function armarFecha(y, m, d) { return `${y}-${p2(m)}-${p2(d)}`; }
const utc = s => { const { y, m, d } = partesFecha(s); return Date.UTC(y, m - 1, d); };

export function diasEntre(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }

export function sumarDias(s, n) {
  const t = new Date(utc(s) + n * 86400000);
  return armarFecha(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
/** 0 = domingo … 6 = sábado */
export function diaSemana(s) { return new Date(utc(s)).getUTCDay(); }
export function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** Suma meses respetando el día "ancla" (31 ene → 28 feb → 31 mar). */
export function sumarMeses(s, n, ancla) {
  const { y, m, d } = partesFecha(s);
  const dia = ancla || d;
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return armarFecha(ny, nm, Math.min(dia, diasDelMes(ny, nm)));
}

/** Lunes de la semana que contiene la fecha dada. */
export function lunesDeSemana(s) {
  const dow = diaSemana(s);               // 0 dom … 6 sáb
  return sumarDias(s, dow === 0 ? -6 : 1 - dow);
}

/**
 * Siguiente fecha según la regla. `ancla` = día del mes original (para
 * repeticiones mensuales/anuales). Devuelve null si no repite o si se
 * pasa de la fecha límite `regla.hasta`.
 */
export function siguienteFecha(fecha, regla, ancla) {
  if (!regla || regla.frecuencia === 'ninguna') return null;
  const n = Math.max(1, parseInt(regla.intervalo, 10) || 1);
  let sig;
  switch (regla.frecuencia) {
    case 'dias':    sig = sumarDias(fecha, n); break;
    case 'semanas': sig = sumarDias(fecha, 7 * n); break;
    case 'meses':   sig = sumarMeses(fecha, n, ancla); break;
    case 'anios':   sig = sumarMeses(fecha, 12 * n, ancla); break;
    default: return null;
  }
  if (regla.hasta && sig > regla.hasta) return null;
  return sig;
}

/** Si cae sábado/domingo y el evento lo pide, la alerta se calcula desde el viernes. */
export function fechaEfectivaAlerta(ev) {
  const f = ev.proximaFecha;
  if (!f || !ev.avisarHabilAnterior) return f;
  const dow = diaSemana(f);
  if (dow === 6) return sumarDias(f, -1);
  if (dow === 0) return sumarDias(f, -2);
  return f;
}

// ---------- Horas ----------

export function aMinutos(h) {
  if (!h) return null;
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
}
export function desdeMinutos(min) { return `${p2(Math.floor(min / 60))}:${p2(min % 60)}`; }

/** [inicio, fin] en minutos del día, o null si el evento no tiene hora. */
export function intervalo(ev) {
  if (ev.todoElDia || !ev.horaInicio) return null;
  const ini = aMinutos(ev.horaInicio);
  let fin = ev.horaFin ? aMinutos(ev.horaFin) : ini + 60;
  if (fin <= ini) fin = ini + 60;
  return [ini, fin];
}

// ---------- Formato ----------

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
export const NOMBRES_MES = MESES;
export const NOMBRES_DIA = DIAS;

export function formatoFechaCorta(s) {
  const { d, m } = partesFecha(s);
  return `${d} ${MESES[m - 1].slice(0, 3)}`;
}
export function formatoFechaLarga(s) {
  const { y, m, d } = partesFecha(s);
  return `${DIAS[diaSemana(s)]} ${d} de ${MESES[m - 1]} de ${y}`;
}
export function formatoFechaDMA(s) {
  const { y, m, d } = partesFecha(s);
  return `${p2(d)}/${p2(m)}/${y}`;
}

// ---------- Ocurrencias ----------

/**
 * Fechas en que un evento aparece dentro de [desde, hasta].
 * - Sin repetición: su proximaFecha.
 * - Con repetición abierta: desde proximaFecha hacia adelante.
 * - Cerrado (realizado/cancelado): solo su fecha, para verlo en el calendario.
 */
export function fechasEnRango(ev, desde, hasta) {
  const base = ev.proximaFecha || ev.fecha;
  if (!base) return [];
  if (!estaAbierto(ev.estado) || !esRecurrente(ev)) {
    return (base >= desde && base <= hasta) ? [base] : [];
  }
  // Un crédito con cuotas se proyecta solo hasta su última cuota pendiente.
  const limite = ev.categoria === 'obligacion' ? (estadoCuotas(ev)?.restantes ?? Infinity) : Infinity;
  const out = [];
  let f = base, guard = 0, n = 1;
  while (f && f <= hasta && guard++ < 500 && n <= limite) {
    if (f >= desde) out.push(f);
    f = siguienteFecha(f, ev.recurrencia, ev.diaAncla);
    n++;
  }
  return out;
}

/** Lista plana [{ev, fecha}] ordenada por fecha y hora. */
export function ocurrenciasEnRango(eventos, desde, hasta) {
  const out = [];
  for (const ev of eventos) {
    for (const fecha of fechasEnRango(ev, desde, hasta)) out.push({ ev, fecha });
  }
  out.sort((a, b) =>
    a.fecha.localeCompare(b.fecha) ||
    (a.ev.horaInicio || '99:99').localeCompare(b.ev.horaInicio || '99:99') ||
    (PRIORIDADES[b.ev.prioridad]?.orden || 0) - (PRIORIDADES[a.ev.prioridad]?.orden || 0));
  return out;
}

// ---------- Alertas ----------

/**
 * Evalúa un evento contra "hoy". Devuelve null si no hay nada que avisar, o
 *   { nivel: 'vencido'|'urgente'|'proximo', dias, texto }
 * - vencido (rojo): la fecha ya pasó y nadie lo gestionó. No desaparece solo.
 * - urgente (rojo): vence hoy y es un vencimiento/pago, o tiene prioridad alta/urgente.
 * - proximo (naranja): dentro de la ventana de anticipación.
 */
function evaluarPorFecha(ev, hoy = hoyStr()) {
  if (!estaAbierto(ev.estado) || !ev.proximaFecha) return null;
  const dias = diasEntre(hoy, ev.proximaFecha);
  if (dias < 0) {
    const n = -dias;
    return { nivel: 'vencido', dias, texto: `Vencido hace ${n} ${n === 1 ? 'día' : 'días'}` };
  }
  const ant = Number.isFinite(ev.anticipacionDias) ? ev.anticipacionDias : 0;
  const diasAlerta = diasEntre(hoy, fechaEfectivaAlerta(ev));
  if (diasAlerta > ant) return null;       // todavía no toca avisar

  const prioAlta = ['alta', 'urgente'].includes(ev.prioridad);
  const texto = dias === 0 ? 'Es hoy' : dias === 1 ? 'Es mañana' : `Faltan ${dias} días`;
  if (dias === 0 && (ev.categoria === 'vencimiento' || esPago(ev) || prioAlta)) return { nivel: 'urgente', dias, texto };
  if (ev.prioridad === 'urgente') return { nivel: 'urgente', dias, texto };
  return { nivel: 'proximo', dias, texto };
}

/** Eventos con alerta activa, ordenados: rojo primero, luego por fecha. */
export function alertasPendientes(eventos, hoy = hoyStr()) {
  const out = [];
  for (const ev of eventos) {
    const a = evaluarEvento(ev, hoy);
    if (a) out.push({ ev, ...a });
  }
  const peso = { vencido: 0, urgente: 1, proximo: 2 };
  out.sort((a, b) => peso[a.nivel] - peso[b.nivel] || (a.ev.proximaFecha || '9999-12-31').localeCompare(b.ev.proximaFecha || '9999-12-31'));
  return out;
}

/** Color semántico de un evento para el calendario: 'rojo' | 'naranja' | 'verde' | 'gris'. */
export function colorEvento(ev, hoy = hoyStr()) {
  if (!estaAbierto(ev.estado)) return 'gris';
  const a = evaluarEvento(ev, hoy);
  if (a && (a.nivel === 'vencido' || a.nivel === 'urgente')) return 'rojo';
  if (ev.estado === 'confirmacion_pendiente' || ev.estado === 'borrador') return 'naranja';
  if (a && a.nivel === 'proximo' && ev.categoria !== 'actividad') return 'naranja';
  return 'verde';
}

// ---------- Conflictos de agenda ----------

/**
 * Busca choques de recurso o de responsable con otras actividades abiertas
 * el mismo día y con horas que se pisan.
 * candidato: { fecha, horaInicio, horaFin, todoElDia, recursoIds[], responsableUid }
 * Devuelve [{ ev, motivo: 'recurso'|'responsable', recursoId? }]
 */
export function detectarConflictos(candidato, eventos, excluirId = null) {
  const iv = intervalo(candidato);
  if (!iv) return [];
  const recursos = candidato.recursoIds || [];
  const out = [];
  for (const ev of eventos) {
    if (ev.id === excluirId || !estaAbierto(ev.estado)) continue;
    if (!fechasEnRango(ev, candidato.fecha, candidato.fecha).length) continue;
    const iv2 = intervalo(ev);
    if (!iv2 || !(iv[0] < iv2[1] && iv2[0] < iv[1])) continue;
    for (const r of recursos) {
      if ((ev.recursoIds || []).includes(r)) out.push({ ev, motivo: 'recurso', recursoId: r });
    }
    if (candidato.responsableUid && ev.responsableUid === candidato.responsableUid) {
      out.push({ ev, motivo: 'responsable' });
    }
  }
  return out;
}

/**
 * Disponibilidad de cada recurso en un día.
 * Devuelve { [recursoId]: { estado: 'libre'|'ocupado'|'pendiente', tramos:[{ini,fin,ev}] } }
 */
export function disponibilidadDelDia(recursos, eventos, fecha) {
  const res = {};
  for (const r of recursos) res[r.id] = { estado: 'libre', tramos: [] };
  for (const ev of eventos) {
    if (!estaAbierto(ev.estado) || !fechasEnRango(ev, fecha, fecha).length) continue;
    const iv = intervalo(ev) || [0, 24 * 60];
    for (const rid of (ev.recursoIds || [])) {
      if (res[rid]) res[rid].tramos.push({ ini: iv[0], fin: iv[1], ev });
    }
  }
  for (const r of Object.values(res)) {
    r.tramos.sort((a, b) => a.ini - b.ini);
    if (r.tramos.length) {
      const todoPendiente = r.tramos.every(t => ['confirmacion_pendiente', 'borrador'].includes(t.ev.estado));
      r.estado = todoPendiente ? 'pendiente' : 'ocupado';
    }
  }
  return res;
}

// ---------- Búsqueda ----------

export function textoBuscable(ev, nombresRecursos = {}, extra = '') {
  return [
    ev.codigo, ev.titulo, ev.descripcion, ev.notas, ev.responsableNombre, ev.proyectoCodigo, extra,
    ev.datos?.proveedor, ev.datos?.institucion, ev.datos?.persona, ev.datos?.colaboradorNombre, ev.datos?.referencia,
    CATEGORIAS[ev.categoria]?.nombre, TIPOS_ACTIVIDAD[ev.tipo]?.nombre,
    ESTADOS[ev.estado]?.nombre,
    ...(ev.recursoIds || []).map(id => nombresRecursos[id])
  ].filter(Boolean).join(' ').toLowerCase()
   .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function normalizarBusqueda(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}


// ---------- Catálogos de administración (Fase 3) ----------

export const TIPOS_SERVICIO = ['Agua','Electricidad','Gas','Internet','Telefonía','Arriendo','Hosting','Dominio','Software','Licencia','Alarma','Seguridad','Seguro','Contabilidad','Aseo','Mantención contratada','Otro servicio'];
export const TIPOS_OBLIGACION = ['Crédito bancario','Crédito automotriz','Crédito de consumo','Crédito hipotecario','Leasing','Préstamo','Tarjeta','Otra obligación'];
export const PARENTESCOS = { colaborador: 'Colaborador/a', hijo: 'Hijo/a de colaborador', pareja: 'Cónyuge / pareja', familiar: 'Otro familiar', otro: 'Otra persona' };
export const MONEDAS = ['CLP', 'UF', 'USD'];
export const METODOS_PAGO = ['Transferencia', 'Débito automático (PAT)', 'Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Cheque', 'Otro'];

/** $1.250.000 · UF 12,5 · US$ 100 */
export function formatoMonto(n, moneda = 'CLP') {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (moneda === 'UF') return 'UF ' + v.toLocaleString('es-CL', { maximumFractionDigits: 4 });
  if (moneda === 'USD') return 'US$ ' + v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  return '$' + Math.round(v).toLocaleString('es-CL');
}

/** Monto que corresponde pagar en la próxima ocurrencia: valor del servicio o cuota del crédito. */
export function montoEvento(ev) {
  const d = ev?.datos || {};
  const monto = ev?.categoria === 'obligacion' ? d.montoCuota : d.monto;
  return Number.isFinite(Number(monto)) && monto !== '' && monto != null ? { monto: Number(monto), moneda: d.moneda || 'CLP' } : null;
}

/** Cuotas de un crédito: { pagadas, total, siguiente, restantes } o null si no se indicó el total. */
export function estadoCuotas(ev) {
  const d = ev?.datos || {};
  const total = parseInt(d.cuotasTotales, 10);
  if (!(total > 0)) return null;
  const pagadas = Math.min(total, Math.max(0, parseInt(d.cuotasPagadas, 10) || 0));
  return { pagadas, total, siguiente: Math.min(total, pagadas + 1), restantes: total - pagadas };
}

// ---------- Cumpleaños y aniversarios ----------

/** Próxima vez que cae la fecha base (nacimiento o ingreso) desde "hoy". 29 feb → 28 feb en años no bisiestos. */
export function proximoAniversario(base, hoy = hoyStr()) {
  const { y: yh } = partesFecha(hoy);
  const { m, d } = partesFecha(base);
  const en = (anio) => armarFecha(anio, m, Math.min(d, diasDelMes(anio, m)));
  const c = en(yh);
  return c >= hoy ? c : en(yh + 1);
}
/** Años que cumple en la fecha dada (cumpleaños o años de antigüedad). */
export function aniosEn(base, fecha) { return partesFecha(fecha).y - partesFecha(base).y; }

export function textoCumple(ev) {
  const d = ev?.datos; if (!d?.fechaBase) return '';
  const n = aniosEn(d.fechaBase, ev.proximaFecha);
  if (n <= 0) return '';
  return d.motivo === 'aniversario' ? `Cumple ${n} ${n === 1 ? 'año' : 'años'} en la empresa` : `Cumple ${n} ${n === 1 ? 'año' : 'años'}`;
}

/** Título sugerido según categoría y datos del formulario (el usuario puede cambiarlo). */
export function tituloSugerido(categoria, d = {}) {
  if (categoria === 'servicio') return [d.servicio, d.proveedor].filter(Boolean).join(' — ');
  if (categoria === 'obligacion') return [d.tipoObligacion, d.institucion].filter(Boolean).join(' — ');
  if (categoria === 'cumpleanos') {
    if (!d.persona) return '';
    const sufijo = d.parentesco === 'hijo' && d.colaboradorNombre ? ` (hijo/a de ${d.colaboradorNombre})`
      : d.parentesco === 'pareja' && d.colaboradorNombre ? ` (pareja de ${d.colaboradorNombre})`
      : d.parentesco === 'familiar' && d.colaboradorNombre ? ` (familiar de ${d.colaboradorNombre})` : '';
    return (d.motivo === 'aniversario' ? 'Aniversario laboral de ' : 'Cumpleaños de ') + d.persona + sufijo;
  }
  return '';
}


// ============================================================
// VEHÍCULOS (Fase 4)
// ============================================================
// Las mantenciones se rigen principalmente por kilometraje: el motor compara el
// "próximo km" de cada mantención con el kilometraje actual del vehículo.
// Los documentos (permiso, SOAP, revisión técnica…) son vencimientos por fecha
// y usan la regla de fechas de siempre.

export const TIPOS_MANTENCION = ['Cambio de aceite','Filtro de aceite','Filtro de aire','Filtro de combustible','Filtro de habitáculo','Revisión de frenos','Cambio de pastillas','Revisión de batería','Rotación de neumáticos','Cambio de neumáticos','Alineación','Balanceo','Suspensión','Fluidos','Refrigeración','Bujías','Mantención general','Otra mantención'];
export const TIPOS_DOCUMENTO_VEHICULO = ['Permiso de circulación','SOAP','Revisión técnica','Seguro automotriz','GPS','Otro documento'];
export const TIPOS_GASTO_VEHICULO = ['Combustible','Peajes','Estacionamiento','Mantención','Reparación','Neumáticos','Seguro','Permiso de circulación','SOAP','Crédito','Leasing','Otro'];
export const MODOS_MANTENCION = {
  km: 'Por kilometraje',
  fecha: 'Por fecha',
  km_o_fecha: 'Kilometraje o fecha (lo que ocurra primero)',
  km_y_fecha: 'Kilometraje y fecha (cuando se cumplan ambos)'
};

export const formatoKm = (n) => Number.isFinite(Number(n)) && n !== '' && n != null ? Number(n).toLocaleString('es-CL') + ' km' : '';

// Contexto: vehículos cargados (la agenda y la campanita lo actualizan al leer la colección).
let _vehiculos = {};
export function setVehiculos(lista) { _vehiculos = Object.fromEntries((lista || []).map(v => [v.id, v])); }
export const vehiculoDe = (ev) => _vehiculos[ev?.vehiculoId] || null;
export const etiquetaVehiculo = (v) => v ? [v.patente, [v.marca, v.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '';

export const esMantencion = (ev) => ev?.categoria === 'vehiculo' && ev.datos?.clase === 'mantencion';
export const modoUsaKm = (modo) => ['km', 'km_o_fecha', 'km_y_fecha'].includes(modo);
export const modoUsaFecha = (modo) => ['fecha', 'km_o_fecha', 'km_y_fecha'].includes(modo);
export const mantencionUsaKm = (ev) => esMantencion(ev) && modoUsaKm(ev.datos.modo);

/** Km que faltan para la mantención (negativo si ya se pasó). null si faltan datos. */
export function restanteKm(ev) {
  const v = vehiculoDe(ev);
  const actual = Number(v?.kmActual), prox = Number(ev?.datos?.proximoKm);
  if (!v || !Number.isFinite(actual) || v.kmActual === '' || v.kmActual == null || !Number.isFinite(prox) || ev.datos.proximoKm == null) return null;
  return prox - actual;
}

function evaluarPorKm(ev) {
  const r = restanteKm(ev);
  if (r == null) return null;
  const aviso = Number(ev.datos.avisoKm) || 0;
  if (r <= 0) return { nivel: 'vencido', dias: null, km: r, texto: r === 0 ? 'Kilometraje alcanzado' : `Kilometraje superado por ${formatoKm(-r)}` };
  if (r <= aviso) return { nivel: 'proximo', dias: null, km: r, texto: `Se aproxima: faltan ${formatoKm(r)}` };
  return null;
}

const SEV = { proximo: 1, urgente: 2, vencido: 3 };
const peor = (a, b) => !a ? b : !b ? a : (SEV[a.nivel] >= SEV[b.nivel] ? a : b);
const mejor = (a, b) => (SEV[a.nivel] <= SEV[b.nivel] ? a : b);

/**
 * Evaluación de alertas de cualquier evento. Las mantenciones por kilometraje
 * se miden contra el kilometraje actual del vehículo; el resto, por fecha.
 */
export function evaluarEvento(ev, hoy = hoyStr()) {
  if (!estaAbierto(ev.estado)) return null;
  if (mantencionUsaKm(ev)) {
    const modo = ev.datos.modo;
    const k = evaluarPorKm(ev);
    if (modo === 'km') return k;
    const f = evaluarPorFecha(ev, hoy);
    if (modo === 'km_o_fecha') return peor(k, f);
    return (k && f) ? mejor(k, f) : null;           // km_y_fecha: solo avisa cuando ambas condiciones avisan
  }
  return evaluarPorFecha(ev, hoy);
}

/** Texto corto de "cuándo" para filas y alertas: la fecha, o el km objetivo si es solo por kilometraje. */
export function cuandoCorto(ev) {
  if (ev?.proximaFecha) return formatoFechaCorta(ev.proximaFecha);
  if (ev?.datos?.proximoKm != null) return formatoKm(ev.datos.proximoKm);
  return '';
}

/**
 * Qué cambia en la mantención al registrarla: nuevo último km/fecha y próximo km/fecha
 * (kilometraje real + intervalo; fecha real + meses). Devuelve campos listos para actualizar.
 */
export function planSiguiente(ev, kmReal, fechaReal) {
  const d = ev.datos || {};
  const out = { 'datos.ultimoKm': kmReal, 'datos.ultimaFecha': fechaReal };
  if (modoUsaKm(d.modo) && Number(d.intervaloKm) > 0) out['datos.proximoKm'] = Number(kmReal) + Number(d.intervaloKm);
  if (modoUsaFecha(d.modo) && Number(d.intervaloMeses) > 0) out.proximaFecha = sumarMeses(fechaReal, Number(d.intervaloMeses), null);
  return out;
}


// ============================================================
// RECORDATORIOS AUTOMÁTICOS (Fase 5)
// ============================================================
// Cuando se programa una actividad de cierto tipo (por ejemplo una instalación),
// la agenda crea sola recordatorios "N días antes". Los pasos son configurables
// por tipo de actividad. Aquí vive solo la lógica pura (qué crear, mover o cancelar);
// agenda.js la ejecuta contra Firestore.

export const AUTOMATIZACIONES_DEFECTO = {
  activo: true,
  reglas: {
    instalacion: [
      { dias: 7, titulo: 'Confirmar instalación con cliente' },
      { dias: 3, titulo: 'Verificar materiales' },
      { dias: 1, titulo: 'Preparar equipo de instalación' }
    ]
  }
};

/** Configuración guardada (o null) → configuración usable. Sin configuración usa los valores originales. */
export function normalizarAutomatizaciones(cfg) {
  if (!cfg) return { activo: true, reglas: JSON.parse(JSON.stringify(AUTOMATIZACIONES_DEFECTO.reglas)) };
  return { activo: cfg.activo !== false, reglas: cfg.reglas && typeof cfg.reglas === 'object' ? cfg.reglas : {} };
}

export function textoPasos(pasos) {
  if (!pasos?.length) return 'Sin recordatorios automáticos';
  const dias = [...pasos].sort((a, b) => b.dias - a.dias).map(p => p.dias === 0 ? 'el mismo día' : String(p.dias));
  return 'Avisos: ' + dias.join(' · ') + (pasos.every(p => p.dias > 0) ? ' días antes' : '');
}

/**
 * Qué hay que hacer para dejar los recordatorios de una actividad al día.
 * padre: la actividad (id, categoria, tipo, titulo, proximaFecha, estado…)
 * existentes: recordatorios automáticos ya creados para esa actividad (origen.eventoId == padre.id)
 * Devuelve { crear:[{clave,dias,fecha,titulo}], actualizar:[{ev,d}], cancelar:[ev] }
 *  - Si la actividad se cierra (realizada/cancelada) o cambia de fecha, los recordatorios pendientes se mueven o cancelan.
 *  - Un recordatorio ya hecho para esa misma fecha no se vuelve a crear.
 *  - Los avisos cuya fecha ya pasó no se crean.
 */
export function planificarRecordatorios(padre, reglas, existentes, hoy = hoyStr()) {
  const pasos = (padre.categoria === 'actividad' && estaAbierto(padre.estado) && padre.proximaFecha) ? (reglas?.[padre.tipo] || []) : [];
  const deseados = pasos
    .map(p => ({ clave: 'dias-' + p.dias, dias: p.dias, fecha: sumarDias(padre.proximaFecha, -p.dias), titulo: `${p.titulo} — ${padre.titulo}` }))
    .filter(d => d.fecha >= hoy);
  const crear = [], actualizar = [], cancelar = [];
  for (const d of deseados) {
    const delClave = existentes.filter(e => e.origen?.clave === d.clave);
    const abierto = delClave.find(e => estaAbierto(e.estado));
    if (abierto) {
      if (abierto.proximaFecha !== d.fecha || abierto.titulo !== d.titulo) actualizar.push({ ev: abierto, d });
    } else if (!delClave.some(e => e.origen?.fechaPadre === padre.proximaFecha)) {
      crear.push(d);
    }
  }
  const claves = new Set(deseados.map(d => d.clave));
  for (const e of existentes) if (estaAbierto(e.estado) && !claves.has(e.origen?.clave)) cancelar.push(e);
  return { crear, actualizar, cancelar };
}
