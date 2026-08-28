// ============================================================
// LINENCE — Seguimiento de Proyectos
// Controlador de dashboard.html
// ============================================================

import { observarSesionStaff, cerrarSesion } from './auth.js';
import {
  escucharProyectos, crearProyectoConCodigoAutomatico, obtenerProyecto,
  escucharProyecto, escucharHistorial, actualizarProyecto, cambiarEtapaProyecto,
  agregarFotoProyecto, quitarFotoProyecto, eliminarProyecto,
  listarUsuariosStaff, contarProyectosPorRut, buscarProyectoPorRut, buscarDireccionesPorRut
} from './firestore.js';
import { REGIONES_COMUNAS, comunasDeRegion, formatearDireccion } from './regiones-comunas.js';
import { validarFoto, subirFoto, validarVideo, subirVideo, eliminarFotoStorage, eliminarTodasLasFotos } from './storage.js';
import { notificarCambioEtapa } from './emailjs.js';
import { generarEnlaceWhatsappManual, generarEnlaceWhatsappBienvenida } from './whatsapp.js';
import { generarToken, formatearFecha } from './utils.js';
import { ETAPAS, calcularPorcentaje } from './etapas.js';

let TODOS_LOS_PROYECTOS = [];
let STAFF_ACTUAL = null;
let USUARIOS_STAFF = [];

// ============================================================
// RUT, CATEGORÍA AUTOMÁTICA, CANAL Y CÓDIGO DE COTIZACIÓN
// ============================================================

const CANALES = {
  REF: 'LANDING PAGE-REF',
  PRS: 'PRESENCIAL-PRS',
  WSP: 'WHATSAPP-WSP',
  INS: 'INSTAGRAM-INS',
  FAC: 'FACEBOOK-FAC',
  TIK: 'TIKTOK-TIK'
};

/** Normaliza un RUT: mayúsculas, sin puntos ni espacios (conserva el guión). */
function limpiarRut(valor) {
  return (valor || '').trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
}

/** Valida un RUT chileno (formato NUMERO-DV) usando el algoritmo módulo 11. */
function validarRut(rutLimpio) {
  if (!/^\d{7,8}-[\dK]$/.test(rutLimpio)) return false;
  const [numero, dv] = rutLimpio.split('-');
  let suma = 0;
  let multiplicador = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    suma += Number(numero[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dvEsperado === dv;
}

/** Bronce: 0–1 proyecto · Oro: 2–4 proyectos · Élite: 5 o más. */
function calcularCategoria(cantidadProyectos) {
  if (cantidadProyectos >= 5) return 'Élite';
  if (cantidadProyectos >= 2) return 'Oro';
  return 'Bronce';
}

function claseCategoria(categoria) {
  return { Bronce: 'bronce', Oro: 'oro', 'Élite': 'elite' }[categoria] || 'bronce';
}

/** Arma el código visible para el cliente, ej. COT-WSP-00004. */
function construirCodigoCotizacion(numero, prefijoCanal) {
  if (!numero || !prefijoCanal) return '';
  return `COT-${prefijoCanal}-${numero.padStart(5, '0')}`;
}

function debounce(fn, esperaMs) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), esperaMs);
  };
}

/**
 * Actualiza el badge de categoría en vivo mientras se escribe el RUT.
 * @param {'f'|'e'} prefijo campo de "Nuevo proyecto" (f) o "Editar" (e)
 * @param {number} extra 1 si es un proyecto nuevo aún no guardado, 0 si ya existe
 */
async function actualizarCategoriaPreview(prefijo, extra) {
  const rutInput = document.getElementById(prefijo + 'Rut');
  const badge = document.getElementById(prefijo + 'CategoriaBadge');
  const nota = document.getElementById(prefijo + 'CategoriaNota');
  if (!rutInput || !badge || !nota) return;

  const rutLimpio = limpiarRut(rutInput.value);
  if (!rutLimpio) {
    badge.textContent = 'Bronce';
    badge.className = 'badge-categoria bronce';
    nota.textContent = 'Ingresa el RUT para calcular la categoría';
    return;
  }
  if (!validarRut(rutLimpio)) {
    badge.textContent = '—';
    badge.className = 'badge-categoria';
    nota.textContent = 'Ese RUT no parece válido';
    return;
  }

  nota.textContent = 'Calculando…';
  try {
    const cantidadExistente = await contarProyectosPorRut(rutLimpio);
    const total = cantidadExistente + extra;
    const categoria = calcularCategoria(total);
    badge.textContent = categoria;
    badge.className = 'badge-categoria ' + claseCategoria(categoria);
    nota.textContent = `Este cliente tiene ${total} proyecto${total === 1 ? '' : 's'} en total`;
  } catch (err) {
    console.error(err);
    nota.textContent = 'No pudimos calcular la categoría automáticamente';
  }
}
const actualizarCategoriaPreviewDebounced = debounce(actualizarCategoriaPreview, 500);

function actualizarCotizacionPreview(prefijo) {
  const numInput = document.getElementById(prefijo + 'NumCotizacion');
  const canalSelect = document.getElementById(prefijo + 'Canal');
  const preview = document.getElementById(prefijo + 'CotizacionPreview');
  if (!numInput || !canalSelect || !preview) return;

  const codigo = construirCodigoCotizacion(numInput.value.trim(), canalSelect.value);
  preview.textContent = codigo ? `Se verá como: ${codigo}` : 'Se verá como: COT-XXX-00000';
}

function activarSoloDigitosCotizacion(inputEl) {
  inputEl.addEventListener('input', () => {
    inputEl.value = inputEl.value.replace(/\D/g, '').slice(0, 6);
  });
}

document.getElementById('fRut').addEventListener('input', () => actualizarCategoriaPreviewDebounced('f', 1));
document.getElementById('eRut').addEventListener('input', () => actualizarCategoriaPreviewDebounced('e', 0));
document.getElementById('fNumCotizacion').addEventListener('input', () => actualizarCotizacionPreview('f'));
document.getElementById('fCanal').addEventListener('change', () => actualizarCotizacionPreview('f'));
document.getElementById('eNumCotizacion').addEventListener('input', () => actualizarCotizacionPreview('e'));
document.getElementById('eCanal').addEventListener('change', () => actualizarCotizacionPreview('e'));
activarSoloDigitosCotizacion(document.getElementById('fNumCotizacion'));
activarSoloDigitosCotizacion(document.getElementById('eNumCotizacion'));

// ============================================================
// DIRECCIÓN ESTRUCTURADA (Región / Comuna / Calle / Número / etc.)
// ============================================================

/** Llena el <select> de región con las 16 regiones de Chile (una sola vez). */
function poblarSelectRegion(prefijo) {
  const select = document.getElementById(prefijo + 'Region');
  if (!select) return;
  select.innerHTML = '<option value="">Selecciona…</option>' +
    REGIONES_COMUNAS.map(r => `<option value="${r.region}">${r.region}</option>`).join('');
}
poblarSelectRegion('f');
poblarSelectRegion('e');

/** Llena el <select> de comuna según la región elegida; lo deja deshabilitado si no hay región. */
function poblarSelectComuna(prefijo, regionSeleccionada, comunaAMarcar) {
  const select = document.getElementById(prefijo + 'Comuna');
  if (!select) return;
  const comunas = comunasDeRegion(regionSeleccionada);
  if (!regionSeleccionada || !comunas.length) {
    select.innerHTML = '<option value="">Primero selecciona una región…</option>';
    select.disabled = true;
    return;
  }
  select.innerHTML = '<option value="">Selecciona…</option>' +
    comunas.map(c => `<option value="${c}">${c}</option>`).join('');
  select.disabled = false;
  if (comunaAMarcar && comunas.includes(comunaAMarcar)) select.value = comunaAMarcar;
}

document.getElementById('fRegion').addEventListener('change', (e) => poblarSelectComuna('f', e.target.value));
document.getElementById('eRegion').addEventListener('change', (e) => poblarSelectComuna('e', e.target.value));

/** Lee los campos de dirección del formulario y arma el objeto que se guarda en Firestore. */
function leerDireccionDelFormulario(prefijo) {
  return {
    region: document.getElementById(prefijo + 'Region').value,
    comuna: document.getElementById(prefijo + 'Comuna').value,
    calle: document.getElementById(prefijo + 'Calle').value.trim().toUpperCase(),
    numero: document.getElementById(prefijo + 'Numero').value.trim(),
    depto: document.getElementById(prefijo + 'Depto').value.trim().toUpperCase(),
    sector: document.getElementById(prefijo + 'Sector').value.trim().toUpperCase(),
    indicaciones: document.getElementById(prefijo + 'Indicaciones').value.trim().toUpperCase()
  };
}

/** Escribe un objeto de dirección en los campos del formulario (con el encadenado región→comuna). */
function escribirDireccionEnFormulario(prefijo, d) {
  const region = d?.region || '';
  document.getElementById(prefijo + 'Region').value = region;
  poblarSelectComuna(prefijo, region, d?.comuna || '');
  document.getElementById(prefijo + 'Calle').value = d?.calle || '';
  document.getElementById(prefijo + 'Numero').value = d?.numero || '';
  document.getElementById(prefijo + 'Depto').value = d?.depto || '';
  document.getElementById(prefijo + 'Sector').value = d?.sector || '';
  document.getElementById(prefijo + 'Indicaciones').value = d?.indicaciones || '';
}

/** Limpia por completo los campos de dirección (para al abrir el modal "Nuevo proyecto"). */
function limpiarDireccionEnFormulario(prefijo) {
  escribirDireccionEnFormulario(prefijo, null);
}

// ---- Autocompletar datos de cliente si el RUT ya existe en Firestore ----
// Nombre, teléfono y correo se autocompletan porque no cambian entre
// proyectos del mismo cliente. La dirección NUNCA se autocompleta sola:
// un cliente puede tener varias viviendas, así que sus direcciones
// anteriores se ofrecen como opciones para elegir (o se completa una nueva).
let ultimoRutAutocompletadoNuevo = '';
let ultimoRutAutocompletadoEdicion = '';
let rutOriginalEdicion = '';

function poblarDireccionesPrevias(prefijo, direcciones) {
  const wrap = document.getElementById(prefijo + 'DireccionesPreviasWrap');
  const select = document.getElementById(prefijo + 'DireccionesPrevias');
  if (!wrap || !select) return;
  const placeholder = '<option value="">Selecciona una dirección o completa una nueva abajo…</option>';
  if (!direcciones.length) {
    wrap.style.display = 'none';
    select.innerHTML = placeholder;
    return;
  }
  select.innerHTML = placeholder + direcciones
    .map(d => `<option value='${JSON.stringify(d).replace(/'/g, '&#39;')}'>${formatearDireccion(d)}</option>`)
    .join('');
  wrap.style.display = 'block';
}

/**
 * @param {'f'|'e'} prefijo formulario de "Nuevo proyecto" (f) o "Editar" (e)
 * @param {string} rutLimpio
 * @param {string|null} excluirCodigo código del proyecto actual (solo en edición, para no listar su propia dirección)
 */
async function autocompletarDatosCliente(prefijo, rutLimpio, excluirCodigo) {
  const avisoEl = document.getElementById(prefijo + 'RutAutocompletado');

  try {
    const [proyectoExistente, direcciones] = await Promise.all([
      buscarProyectoPorRut(rutLimpio),
      buscarDireccionesPorRut(rutLimpio, excluirCodigo)
    ]);

    if (proyectoExistente) {
      document.getElementById(prefijo + 'Cliente').value = proyectoExistente.cliente || '';
      document.getElementById(prefijo + 'Telefono').value = proyectoExistente.telefono || '';
      document.getElementById(prefijo + 'Email').value = proyectoExistente.email || '';
      if (avisoEl) avisoEl.textContent = 'Cliente ya registrado: completamos su nombre, teléfono y correo. Elige la dirección abajo.';
      mostrarToast('Encontramos a este cliente y completamos sus datos de contacto.', 'exito');
    } else if (avisoEl) {
      avisoEl.textContent = '';
    }

    poblarDireccionesPrevias(prefijo, direcciones);
  } catch (err) {
    console.error('No pudimos buscar datos previos del cliente:', err);
  }
}

document.getElementById('fRut').addEventListener('blur', () => {
  const rutLimpio = limpiarRut(document.getElementById('fRut').value);
  if (rutLimpio && validarRut(rutLimpio) && rutLimpio !== ultimoRutAutocompletadoNuevo) {
    ultimoRutAutocompletadoNuevo = rutLimpio;
    autocompletarDatosCliente('f', rutLimpio, null);
  }
});

document.getElementById('fDireccionesPrevias').addEventListener('change', (e) => {
  if (!e.target.value) return;
  try { escribirDireccionEnFormulario('f', JSON.parse(e.target.value)); }
  catch (err) { console.error('No pudimos leer la dirección seleccionada:', err); }
});

document.getElementById('eRut').addEventListener('blur', () => {
  const rutLimpio = limpiarRut(document.getElementById('eRut').value);
  // Solo busca de nuevo si el RUT cambió respecto al que traía el proyecto al abrirlo
  if (rutLimpio && validarRut(rutLimpio) && rutLimpio !== rutOriginalEdicion && rutLimpio !== ultimoRutAutocompletadoEdicion) {
    ultimoRutAutocompletadoEdicion = rutLimpio;
    autocompletarDatosCliente('e', rutLimpio, PROYECTO_ACTUAL?.codigo || null);
  }
});

document.getElementById('eDireccionesPrevias').addEventListener('change', (e) => {
  if (!e.target.value) return;
  try { escribirDireccionEnFormulario('e', JSON.parse(e.target.value)); }
  catch (err) { console.error('No pudimos leer la dirección seleccionada:', err); }
});

/** Convierte un Timestamp de Firestore (o Date) al formato yyyy-mm-dd que espera <input type="date">. */
function timestampAValorInput(valor) {
  if (!valor) return '';
  const fecha = valor.toDate ? valor.toDate() : new Date(valor);
  if (isNaN(fecha.getTime())) return '';
  return fecha.toISOString().slice(0, 10);
}

/** Texto legible del rango de instalación, con compatibilidad para proyectos antiguos de fecha única. */
function formatearRangoFechas(inicio, fin) {
  const i = inicio ? formatearFecha(inicio) : null;
  const f = fin ? formatearFecha(fin) : null;
  if (i && f && i !== f) return `${i} al ${f}`;
  if (i) return i;
  if (f) return f;
  return 'Por confirmar';
}

// ---------- Toast (mensajes flotantes) ----------
function mostrarToast(mensaje, tipo = 'exito') {
  if (!mensaje) return;
  const contenedor = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + tipo;
  toast.innerHTML = `<span class="toast-icono">${tipo === 'error' ? '⚠️' : '✓'}</span><span>${mensaje}</span>`;
  contenedor.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ---------- Guardia de sesión ----------
observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  STAFF_ACTUAL = staff;
  document.getElementById('staffNombre').textContent = staff.nombre || staff.email;
  document.getElementById('staffRol').textContent = staff.rol === 'admin' ? 'Administrador' : 'Staff';
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = 'flex';
  document.getElementById('dashTopbarMobile').style.display = '';
  cargarProyectos();
  listarUsuariosStaff().then(lista => { USUARIOS_STAFF = lista; }).catch(err => console.error(err));
});

document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Sidebar off-canvas (mobile) ----------
const dashSidebar = document.getElementById('dashSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

function abrirSidebar() {
  dashSidebar.classList.add('abierto');
  sidebarOverlay.classList.add('abierto');
}
function cerrarSidebarMobile() {
  dashSidebar.classList.remove('abierto');
  sidebarOverlay.classList.remove('abierto');
}
document.getElementById('btnAbrirSidebar').addEventListener('click', abrirSidebar);
document.getElementById('btnCerrarSidebar').addEventListener('click', cerrarSidebarMobile);
sidebarOverlay.addEventListener('click', cerrarSidebarMobile);

// ---------- Cargar y renderizar listado (tiempo real) ----------
function cargarProyectos() {
  const lista = document.getElementById('listaProyectos');
  lista.innerHTML = '<div class="dash-vacio">Cargando proyectos…</div>';

  escucharProyectos(
    (proyectos) => {
      TODOS_LOS_PROYECTOS = proyectos;
      renderLista();
    },
    () => {
      lista.innerHTML = '<div class="dash-vacio">No pudimos cargar los proyectos. Intenta recargar la página.</div>';
    }
  );
}

function renderLista() {
  const textoBusqueda = document.getElementById('buscador').value.trim().toLowerCase();
  const estadoFiltro = document.getElementById('filtroEstado').value;

  const filtrados = TODOS_LOS_PROYECTOS.filter(p => {
    const coincideTexto = !textoBusqueda ||
      p.codigo.toLowerCase().includes(textoBusqueda) ||
      (p.cliente || '').toLowerCase().includes(textoBusqueda);
    const coincideEstado = !estadoFiltro || p.estadoEtapaActual === estadoFiltro;
    return coincideTexto && coincideEstado;
  });

  const lista = document.getElementById('listaProyectos');
  const vacio = document.getElementById('dashVacio');

  if (!filtrados.length) {
    lista.innerHTML = '';
    vacio.style.display = 'block';
    vacio.textContent = TODOS_LOS_PROYECTOS.length
      ? 'Ningún proyecto coincide con tu búsqueda.'
      : 'Aún no hay proyectos creados. Haz clic en "+ Nuevo proyecto" para agregar el primero.';
    return;
  }
  vacio.style.display = 'none';

  lista.innerHTML = filtrados.map(p => {
    const etapa = ETAPAS[p.etapaActualIndex] || ETAPAS[0];
    const porcentajeReal = calcularPorcentaje(p.etapaActualIndex, p.estadoEtapaActual);
    const estadoLegible = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada' }[p.estadoEtapaActual] || p.estadoEtapaActual;
    return `
      <div class="fila-proyecto" data-codigo="${p.codigo}">
        <span class="codigo">${p.codigo}</span>
        <span class="cliente-nombre">${p.cliente || '—'}</span>
        <span class="tipo-col">${p.tipoProyecto || '—'}</span>
        <span class="etapa-col"><span class="badge-estado ${p.estadoEtapaActual}">${etapa.nombre}</span></span>
        <span class="porcentaje-mini">${porcentajeReal}%</span>
        <span class="estado-col">${estadoLegible}</span>
      </div>`;
  }).join('');

  lista.querySelectorAll('.fila-proyecto').forEach(fila => {
    fila.addEventListener('click', () => abrirDetalle(fila.dataset.codigo));
  });
}

document.getElementById('buscador').addEventListener('input', renderLista);
document.getElementById('filtroEstado').addEventListener('change', renderLista);

// ---------- Modal: nuevo proyecto ----------
const modalNuevo = document.getElementById('modalNuevo');
const formNuevo = document.getElementById('formNuevoProyecto');
const modalError = document.getElementById('modalError');
const btnGuardar = document.getElementById('btnGuardarNuevo');

document.getElementById('btnNuevoProyecto').addEventListener('click', () => {
  formNuevo.reset();
  modalError.classList.remove('visible');
  poblarSelectResponsable(document.getElementById('fResponsable'));
  document.getElementById('fCategoriaBadge').textContent = 'Bronce';
  document.getElementById('fCategoriaBadge').className = 'badge-categoria bronce';
  document.getElementById('fCategoriaNota').textContent = 'Ingresa el RUT para calcular la categoría';
  document.getElementById('fCotizacionPreview').textContent = 'Se verá como: COT-XXX-00000';
  document.getElementById('fRutAutocompletado').textContent = '';
  poblarDireccionesPrevias('f', []);
  limpiarDireccionEnFormulario('f');
  ultimoRutAutocompletadoNuevo = '';
  modalNuevo.classList.add('open');
});
document.getElementById('btnCancelarNuevo').addEventListener('click', () => {
  modalNuevo.classList.remove('open');
});
modalNuevo.addEventListener('click', (e) => {
  if (e.target === modalNuevo) modalNuevo.classList.remove('open');
});

formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  modalError.classList.remove('visible');

  const fechaInicioValor = document.getElementById('fFechaInicio').value;
  const fechaFinValor = document.getElementById('fFechaFin').value;
  const telefono = document.getElementById('fTelefono').value.trim();
  const rutLimpio = limpiarRut(document.getElementById('fRut').value);
  const canalOrigen = document.getElementById('fCanal').value;
  const numCotizacion = document.getElementById('fNumCotizacion').value.trim();

  if (telefono && !/^[\d\s()+-]+$/.test(telefono)) {
    modalError.textContent = 'El teléfono solo puede contener números (y +, espacios o guiones).';
    modalError.classList.add('visible');
    return;
  }

  if (rutLimpio && !validarRut(rutLimpio)) {
    modalError.textContent = 'El RUT ingresado no es válido. Revisa el formato (ej. 12.345.678-9).';
    modalError.classList.add('visible');
    return;
  }

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Creando…';

  // La categoría se calcula sola según cuántos proyectos previos tiene ese RUT
  let categoria = 'Bronce';
  if (rutLimpio) {
    try {
      const cantidadExistente = await contarProyectosPorRut(rutLimpio);
      categoria = calcularCategoria(cantidadExistente + 1);
    } catch (err) {
      console.error('No pudimos calcular la categoría automáticamente:', err);
    }
  }

  const datos = {
    cliente: document.getElementById('fCliente').value.trim().toUpperCase(),
    rut: rutLimpio,
    telefono: telefono,
    email: document.getElementById('fEmail').value.trim().toUpperCase(),
    tipoProyecto: document.getElementById('fTipoProyecto').value.trim().toUpperCase(),
    categoria,
    responsable: document.getElementById('fResponsable').value,
    direccion: leerDireccionDelFormulario('f'),
    fechaEstimadaInicio: fechaInicioValor ? new Date(fechaInicioValor) : null,
    fechaEstimadaFin: fechaFinValor ? new Date(fechaFinValor) : null,
    canalOrigen,
    numCotizacion,
    codigoCotizacion: construirCodigoCotizacion(numCotizacion, canalOrigen),
    observaciones: document.getElementById('fObservaciones').value.trim().toUpperCase(),
    token: generarToken()
  };

  try {
    const codigo = await crearProyectoConCodigoAutomatico(datos, STAFF_ACTUAL.uid);
    modalNuevo.classList.remove('open');
    mostrarEnlaceGenerado(codigo, datos.token);
  } catch (err) {
    console.error(err);
    modalError.textContent = 'No pudimos crear el proyecto. Intenta nuevamente.';
    modalError.classList.add('visible');
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Crear proyecto';
  }
});

// ---------- Modal: enlace generado ----------
const modalExito = document.getElementById('modalExito');

function mostrarEnlaceGenerado(codigo, token) {
  const url = `${window.location.origin}/seguimiento/proyecto.html?codigo=${encodeURIComponent(codigo)}&token=${encodeURIComponent(token)}`;
  document.getElementById('enlaceGeneradoInput').value = url;
  modalExito.classList.add('open');
}

document.getElementById('btnCopiarEnlace').addEventListener('click', () => {
  const input = document.getElementById('enlaceGeneradoInput');
  input.select();
  navigator.clipboard?.writeText(input.value);
  const btn = document.getElementById('btnCopiarEnlace');
  btn.textContent = '¡Copiado!';
  setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
});

document.getElementById('btnCerrarExito').addEventListener('click', () => {
  modalExito.classList.remove('open');
});

// ---------- Helpers: responsables, mayúsculas automáticas, teléfono ----------

function poblarSelectResponsable(selectEl, valorActual) {
  const opciones = USUARIOS_STAFF.map(u => {
    const nombre = u.nombre || u.email;
    return `<option value="${nombre}">${nombre}</option>`;
  }).join('');
  selectEl.innerHTML = '<option value="">Selecciona…</option>' + opciones;
  if (valorActual) {
    const existe = USUARIOS_STAFF.some(u => (u.nombre || u.email) === valorActual);
    if (!existe) {
      selectEl.insertAdjacentHTML('beforeend', `<option value="${valorActual}">${valorActual} (no está en la lista)</option>`);
    }
    selectEl.value = valorActual;
  }
}

/** Convierte a mayúsculas mientras se escribe, en todos los inputs/textarea con la clase .campo-mayusculas. */
function activarMayusculasAutomaticas(contenedor) {
  contenedor.querySelectorAll('input[type="text"], input[type="email"], textarea').forEach(el => {
    el.addEventListener('input', () => {
      const cursor = el.selectionStart;
      el.value = el.value.toUpperCase();
      el.setSelectionRange(cursor, cursor);
    });
  });
}
activarMayusculasAutomaticas(document.getElementById('formNuevoProyecto'));
activarMayusculasAutomaticas(document.getElementById('formEditarProyecto'));

/** Solo permite dígitos y algunos símbolos válidos de teléfono mientras se escribe. */
function activarValidacionTelefono(inputEl) {
  inputEl.addEventListener('input', () => {
    inputEl.value = inputEl.value.replace(/[^\d\s()+-]/g, '');
  });
}
activarValidacionTelefono(document.getElementById('fTelefono'));
activarValidacionTelefono(document.getElementById('eTelefono'));

// ============================================================
// VISTA DE DETALLE (Fase 8)
// ============================================================



const vistaListado = document.querySelector('.dash-main'); // el primer .dash-main = listado
const vistaDetalle = document.getElementById('vistaDetalle');
let PROYECTO_ACTUAL = null;
let ultimoHistorialCargado = [];
let unsubProyectoDetalle = null;
let unsubHistorialDetalle = null;

function abrirDetalle(codigo) {
  vistaListado.style.display = 'none';
  vistaDetalle.style.display = 'block';
  vistaDetalle.scrollIntoView({ behavior: 'instant' });

  document.getElementById('detalleCodigo').textContent = codigo;
  document.getElementById('detalleCliente').textContent = 'Cargando…';
  document.getElementById('detalleTipo').textContent = '';

  detenerListenersDetalle();

  let historialListo = false;

  unsubHistorialDetalle = escucharHistorial(codigo, (historial) => {
    ultimoHistorialCargado = historial;
    historialListo = true;
    if (PROYECTO_ACTUAL) renderDetalle(PROYECTO_ACTUAL, ultimoHistorialCargado);
  }, () => mostrarToast('No pudimos cargar el historial.', 'error'));

  unsubProyectoDetalle = escucharProyecto(codigo, (proyecto) => {
    if (!proyecto) {
      mostrarToast('No se encontró el proyecto ' + codigo + '.', 'error');
      volverAlListado();
      return;
    }
    PROYECTO_ACTUAL = proyecto;
    if (historialListo) renderDetalle(proyecto, ultimoHistorialCargado);
  }, () => {
    mostrarToast('No pudimos cargar el proyecto.', 'error');
    volverAlListado();
  });
}

function detenerListenersDetalle() {
  unsubProyectoDetalle?.();
  unsubHistorialDetalle?.();
  unsubProyectoDetalle = null;
  unsubHistorialDetalle = null;
}

function volverAlListado() {
  detenerListenersDetalle();
  vistaDetalle.style.display = 'none';
  vistaListado.style.display = 'block';
  PROYECTO_ACTUAL = null;
}
document.getElementById('btnVolverListado').addEventListener('click', () => {
  volverAlListado();
});

function renderDetalle(p, historial) {
  document.getElementById('detalleCodigo').textContent = p.codigo;
  document.getElementById('detalleCliente').textContent = p.cliente || 'Sin nombre';
  document.getElementById('detalleTipo').textContent = p.tipoProyecto || '';

  const enlace = `${window.location.origin}/seguimiento/proyecto.html?codigo=${encodeURIComponent(p.codigo)}&token=${encodeURIComponent(p.token || '')}`;
  document.getElementById('detalleEnlaceCliente').href = enlace;

  const etapaActualNombre = (ETAPAS[p.etapaActualIndex] ?? ETAPAS[0]).nombre;
  const direccionTextoDetalle = (p.direccion && typeof p.direccion === 'object')
    ? formatearDireccion(p.direccion)
    : (p.direccion || '');
  const enlaceWa = generarEnlaceWhatsappManual({
    telefono: p.telefono,
    cliente: p.cliente,
    etapaNombre: etapaActualNombre,
    enlaceProyecto: enlace,
    direccionTexto: direccionTextoDetalle
  });
  const btnWa = document.getElementById('detalleEnlaceWhatsapp');
  if (enlaceWa) {
    btnWa.href = enlaceWa;
    btnWa.style.display = '';
  } else {
    btnWa.style.display = 'none'; // el proyecto no tiene teléfono cargado
  }

  const enlaceBienvenida = generarEnlaceWhatsappBienvenida({
    telefono: p.telefono,
    cliente: p.cliente,
    enlaceProyecto: enlace,
    direccionTexto: direccionTextoDetalle
  });
  const btnBienvenida = document.getElementById('detalleEnlaceBienvenida');
  if (enlaceBienvenida) {
    btnBienvenida.href = enlaceBienvenida;
    btnBienvenida.style.display = '';
  } else {
    btnBienvenida.style.display = 'none';
  }

  // ---- Control de etapa ----
  const etapa = ETAPAS[p.etapaActualIndex] ?? ETAPAS[0];
  const estadoLegible = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada' }[p.estadoEtapaActual] || p.estadoEtapaActual;
  document.getElementById('etapaNombreActual').textContent = etapa.nombre;
  const badge = document.getElementById('etapaEstadoBadge');
  badge.textContent = estadoLegible;
  badge.className = 'badge-estado ' + p.estadoEtapaActual;

  document.getElementById('btnRetroceder').disabled = p.etapaActualIndex === 0;
  document.getElementById('btnIniciarEtapa').disabled = p.estadoEtapaActual !== 'pendiente';
  document.getElementById('btnCompletarEtapa').textContent =
    p.etapaActualIndex === ETAPAS.length - 1 ? 'Marcar como entregado ✓' : 'Completar y avanzar →';

  const miniTimeline = document.getElementById('miniTimeline');
  miniTimeline.innerHTML = ETAPAS.map(e => {
    let clase = '';
    if (e.index < p.etapaActualIndex) clase = 'completada';
    if (e.index === p.etapaActualIndex) clase = 'actual';
    return `<li class="${clase}">${e.nombre}</li>`;
  }).join('');

  // ---- Galería de fotos ----
  renderGaleriaDashboard(p.fotos || []);

  // ---- Formulario de datos generales ----
  document.getElementById('eCliente').value = p.cliente || '';
  document.getElementById('eRut').value = p.rut || '';
  document.getElementById('eTelefono').value = p.telefono || '';
  document.getElementById('eEmail').value = p.email || '';
  document.getElementById('eTipoProyecto').value = p.tipoProyecto || '';
  // Compatibilidad: proyectos antiguos guardaban la dirección como texto plano.
  // Si es así, se coloca en "Calle" para no perder el dato; se puede reordenar a mano.
  const direccionProyecto = (p.direccion && typeof p.direccion === 'object')
    ? p.direccion
    : (p.direccion ? { calle: p.direccion } : null);
  escribirDireccionEnFormulario('e', direccionProyecto);
  document.getElementById('eRutAutocompletado').textContent = '';
  poblarDireccionesPrevias('e', []);
  rutOriginalEdicion = limpiarRut(p.rut || '');
  ultimoRutAutocompletadoEdicion = '';
  // Compatibilidad: proyectos antiguos solo tienen fechaEstimadaInstalacion (fecha única)
  document.getElementById('eFechaInicio').value = timestampAValorInput(p.fechaEstimadaInicio || p.fechaEstimadaInstalacion);
  document.getElementById('eFechaFin').value = timestampAValorInput(p.fechaEstimadaFin || p.fechaEstimadaInstalacion);
  document.getElementById('eCanal').value = p.canalOrigen || '';
  document.getElementById('eNumCotizacion').value = p.numCotizacion || '';
  document.getElementById('eObservaciones').value = p.observaciones || '';
  poblarSelectResponsable(document.getElementById('eResponsable'), p.responsable || '');

  const categoriaActual = p.categoria || 'Bronce';
  document.getElementById('eCategoriaBadge').textContent = categoriaActual;
  document.getElementById('eCategoriaBadge').className = 'badge-categoria ' + claseCategoria(categoriaActual);
  document.getElementById('eCategoriaNota').textContent = 'Categoría actual · se recalcula sola al guardar';
  actualizarCotizacionPreview('e');

  // ---- Resumen tipo lista (colapsado por defecto) ----
  const categoriaClase = claseCategoria(p.categoria || '');
  const filaCategoria = p.categoria
    ? `<span class="badge-categoria ${categoriaClase}">${p.categoria}</span>`
    : '<span class="resumen-valor" style="opacity:0.4;">Sin asignar</span>';
  const canalLegible = CANALES[p.canalOrigen] || '—';
  const fechaInicioLegible = p.fechaEstimadaInicio || p.fechaEstimadaInstalacion;
  const fechaFinLegible = p.fechaEstimadaFin || p.fechaEstimadaInstalacion;

  document.getElementById('resumenDatos').innerHTML = `
    <li><span class="resumen-label">Cliente</span><span class="resumen-valor">${p.cliente || '—'}</span></li>
    <li><span class="resumen-label">RUT</span><span class="resumen-valor">${p.rut || '—'}</span></li>
    <li><span class="resumen-label">Teléfono</span><span class="resumen-valor">${p.telefono || '—'}</span></li>
    <li><span class="resumen-label">Correo</span><span class="resumen-valor">${p.email || '—'}</span></li>
    <li><span class="resumen-label">Tipo de proyecto</span><span class="resumen-valor">${p.tipoProyecto || '—'}</span></li>
    <li><span class="resumen-label">Categoría</span>${filaCategoria}</li>
    <li><span class="resumen-label">Responsable</span><span class="resumen-valor">${p.responsable || 'Por asignar'}</span></li>
    <li><span class="resumen-label">Dirección</span><span class="resumen-valor">${(p.direccion && typeof p.direccion === 'object') ? (formatearDireccion(p.direccion) || '—') : (p.direccion || '—')}</span></li>
    <li><span class="resumen-label">Fecha estimada</span><span class="resumen-valor">${formatearRangoFechas(fechaInicioLegible, fechaFinLegible)}</span></li>
    <li><span class="resumen-label">Canal de origen</span><span class="resumen-valor">${canalLegible}</span></li>
    <li><span class="resumen-label">N° de cotización</span><span class="resumen-valor">${p.codigoCotizacion || '—'}</span></li>
  `;
  // Siempre vuelve a mostrarse colapsado al entrar/recargar el detalle
  document.getElementById('formEditarProyecto').style.display = 'none';
  document.getElementById('resumenDatos').style.display = 'block';
  document.getElementById('flechaDatos').classList.remove('abierta');

  // ---- Zona de eliminación (solo admin) ----
  document.getElementById('zonaPeligro').style.display = STAFF_ACTUAL.rol === 'admin' ? 'block' : 'none';
  document.getElementById('codigoConfirmacion').textContent = p.codigo;
  resetearPasosEliminacion();

  // ---- Historial ----
  const listaHist = document.getElementById('historialDashboard');
  if (!historial.length) {
    listaHist.innerHTML = '<li style="opacity:0.5;">Aún no hay movimientos registrados.</li>';
  } else {
    listaHist.innerHTML = historial.map(h => `
      <li>
        <div class="linea-1">
          <span>${h.etapaNombre} — ${ { pendiente:'Pendiente', en_proceso:'En proceso', completada:'Completada' }[h.estadoNuevo] || h.estadoNuevo }</span>
          <span>${formatearFecha(h.fecha, true)}</span>
        </div>
        ${h.usuarioNombre ? `<div class="nombre-usuario">Registrado por ${h.usuarioNombre}</div>` : ''}
        ${h.observacion ? `<div class="obs">${h.observacion}</div>` : ''}
      </li>
    `).join('');
  }
}

// ---- Expandir/colapsar "Datos del proyecto" ----
document.getElementById('datosProyectoToggle').addEventListener('click', () => {
  const form = document.getElementById('formEditarProyecto');
  const resumen = document.getElementById('resumenDatos');
  const flecha = document.getElementById('flechaDatos');
  const abrir = form.style.display === 'none';
  form.style.display = abrir ? 'block' : 'none';
  resumen.style.display = abrir ? 'none' : 'block';
  flecha.classList.toggle('abierta', abrir);
});

document.getElementById('btnCancelarEdicion').addEventListener('click', () => {
  document.getElementById('formEditarProyecto').style.display = 'none';
  document.getElementById('resumenDatos').style.display = 'block';
  document.getElementById('flechaDatos').classList.remove('abierta');
});

// ---- Guardar datos generales ----
document.getElementById('formEditarProyecto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('editarError');
  errorBox.classList.remove('visible');
  const btn = document.getElementById('btnGuardarEdicion');

  const telefono = document.getElementById('eTelefono').value.trim();
  if (telefono && !/^[\d\s()+-]+$/.test(telefono)) {
    errorBox.textContent = 'El teléfono solo puede contener números (y +, espacios o guiones).';
    errorBox.classList.add('visible');
    return;
  }

  const rutLimpio = limpiarRut(document.getElementById('eRut').value);
  if (rutLimpio && !validarRut(rutLimpio)) {
    errorBox.textContent = 'El RUT ingresado no es válido. Revisa el formato (ej. 12.345.678-9).';
    errorBox.classList.add('visible');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando…';

  // Recalcula la categoría por si el RUT cambió o hay proyectos nuevos del mismo cliente
  let categoria = PROYECTO_ACTUAL.categoria || 'Bronce';
  if (rutLimpio) {
    try {
      const cantidadTotal = await contarProyectosPorRut(rutLimpio);
      categoria = calcularCategoria(cantidadTotal);
    } catch (err) {
      console.error('No pudimos recalcular la categoría automáticamente:', err);
    }
  }

  const fechaInicioValor = document.getElementById('eFechaInicio').value;
  const fechaFinValor = document.getElementById('eFechaFin').value;
  const canalOrigen = document.getElementById('eCanal').value;
  const numCotizacion = document.getElementById('eNumCotizacion').value.trim();

  const datos = {
    cliente: document.getElementById('eCliente').value.trim().toUpperCase(),
    rut: rutLimpio,
    telefono: telefono,
    email: document.getElementById('eEmail').value.trim().toUpperCase(),
    tipoProyecto: document.getElementById('eTipoProyecto').value.trim().toUpperCase(),
    categoria,
    responsable: document.getElementById('eResponsable').value,
    direccion: leerDireccionDelFormulario('e'),
    fechaEstimadaInicio: fechaInicioValor ? new Date(fechaInicioValor) : null,
    fechaEstimadaFin: fechaFinValor ? new Date(fechaFinValor) : null,
    canalOrigen,
    numCotizacion,
    codigoCotizacion: construirCodigoCotizacion(numCotizacion, canalOrigen),
    observaciones: document.getElementById('eObservaciones').value.trim().toUpperCase()
  };

  try {
    await actualizarProyecto(PROYECTO_ACTUAL.codigo, datos);
    PROYECTO_ACTUAL = { ...PROYECTO_ACTUAL, ...datos };
    document.getElementById('detalleCliente').textContent = datos.cliente || 'Sin nombre';
    document.getElementById('detalleTipo').textContent = datos.tipoProyecto || '';
    renderDetalle(PROYECTO_ACTUAL, ultimoHistorialCargado);
    mostrarToast('Datos del proyecto guardados', 'exito');
    btn.textContent = '¡Guardado!';
    setTimeout(() => { btn.textContent = 'Guardar cambios'; btn.disabled = false; }, 1500);
  } catch (err) {
    console.error(err);
    errorBox.textContent = 'No pudimos guardar los cambios. Intenta nuevamente.';
    errorBox.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
});

// ---- Botones de avance de etapa ----
document.getElementById('btnIniciarEtapa').addEventListener('click', async () => {
  await ejecutarCambioEtapa({
    etapaActualIndex: PROYECTO_ACTUAL.etapaActualIndex,
    estadoEtapaActual: 'en_proceso'
  }, {
    estadoAnterior: 'pendiente',
    estadoNuevo: 'en_proceso',
    observacionManual: document.getElementById('obsEtapaInput').value.trim()
  });
});

document.getElementById('btnCompletarEtapa').addEventListener('click', async () => {
  const esUltima = PROYECTO_ACTUAL.etapaActualIndex === ETAPAS.length - 1;
  const estadoAnterior = PROYECTO_ACTUAL.estadoEtapaActual;
  const observacionManual = document.getElementById('obsEtapaInput').value.trim();

  if (esUltima) {
    await ejecutarCambioEtapa({
      etapaActualIndex: PROYECTO_ACTUAL.etapaActualIndex,
      estadoEtapaActual: 'completada'
    }, { estadoAnterior, estadoNuevo: 'completada', observacionManual });
    return;
  }

  await ejecutarCambioEtapa({
    etapaActualIndex: PROYECTO_ACTUAL.etapaActualIndex + 1,
    estadoEtapaActual: 'pendiente'
  }, {
    estadoAnterior,
    estadoNuevo: 'completada',
    etapaNombreOverride: ETAPAS[PROYECTO_ACTUAL.etapaActualIndex].nombre,
    observacionManual
  });
});

document.getElementById('btnRetroceder').addEventListener('click', async () => {
  if (PROYECTO_ACTUAL.etapaActualIndex === 0) return;
  const confirmar = confirm('¿Retroceder a la etapa anterior? Esto quedará registrado en el historial.');
  if (!confirmar) return;

  const observacionManual = document.getElementById('obsEtapaInput').value.trim();

  await ejecutarCambioEtapa({
    etapaActualIndex: PROYECTO_ACTUAL.etapaActualIndex - 1,
    estadoEtapaActual: 'en_proceso'
  }, {
    estadoAnterior: PROYECTO_ACTUAL.estadoEtapaActual,
    estadoNuevo: 'en_proceso',
    etapaNombreOverride: ETAPAS[PROYECTO_ACTUAL.etapaActualIndex - 1].nombre,
    esRetroceso: true,
    observacionManual
  });
});

async function ejecutarCambioEtapa(nuevoEstado, { estadoAnterior, estadoNuevo, etapaNombreOverride, esRetroceso, observacionManual }) {
  const botones = ['btnIniciarEtapa', 'btnCompletarEtapa', 'btnRetroceder'].map(id => document.getElementById(id));
  botones.forEach(b => b.disabled = true);

  const etapaNombre = etapaNombreOverride || ETAPAS[PROYECTO_ACTUAL.etapaActualIndex].nombre;
  const observacionFinal = observacionManual
    ? observacionManual
    : (esRetroceso ? 'Corrección: se retrocedió la etapa manualmente.' : '');

  try {
    await cambiarEtapaProyecto(PROYECTO_ACTUAL.codigo, nuevoEstado, {
      etapaIndex: PROYECTO_ACTUAL.etapaActualIndex,
      etapaNombre,
      estadoAnterior,
      estadoNuevo,
      usuario: STAFF_ACTUAL.uid,
      usuarioNombre: STAFF_ACTUAL.nombre || STAFF_ACTUAL.email,
      observacion: observacionFinal
    });

    if (!esRetroceso) {
      const porcentajeActual = calcularPorcentaje(nuevoEstado.etapaActualIndex, nuevoEstado.estadoEtapaActual);
      const fechaEstimadaTexto = PROYECTO_ACTUAL.fechaEstimadaInstalacion
        ? formatearFecha(PROYECTO_ACTUAL.fechaEstimadaInstalacion)
        : 'Por confirmar';
      const direccionTextoNotificacion = (PROYECTO_ACTUAL.direccion && typeof PROYECTO_ACTUAL.direccion === 'object')
        ? formatearDireccion(PROYECTO_ACTUAL.direccion)
        : (PROYECTO_ACTUAL.direccion || '');

      const resultado = await notificarCambioEtapa({
        email: PROYECTO_ACTUAL.email,
        cliente: PROYECTO_ACTUAL.cliente,
        etapaNombre,
        codigo: PROYECTO_ACTUAL.codigo,
        token: PROYECTO_ACTUAL.token,
        tipoProyecto: PROYECTO_ACTUAL.tipoProyecto,
        porcentaje: porcentajeActual,
        fechaEstimadaTexto,
        direccionTexto: direccionTextoNotificacion
      });
      if (!resultado.enviado) {
        console.warn('Notificación no enviada:', resultado.motivo);
      }
    }

    document.getElementById('obsEtapaInput').value = '';

    // Refresca el proyecto en memoria y vuelve a pintar el detalle (etapa, badge,
    // mini-timeline y botones) de inmediato, en vez de esperar a un refresh manual.
    PROYECTO_ACTUAL = { ...PROYECTO_ACTUAL, ...nuevoEstado };
    renderDetalle(PROYECTO_ACTUAL, ultimoHistorialCargado);

    const mensajesToast = {
      iniciar: 'Etapa marcada "En proceso"',
      completar: esRetroceso ? '' : (nuevoEstado.estadoEtapaActual === 'completada' ? 'Proyecto marcado como entregado ✓' : 'Etapa completada, avanzó a la siguiente'),
      retroceso: 'Etapa retrocedida'
    };
    mostrarToast(esRetroceso ? mensajesToast.retroceso : (estadoNuevo === 'en_proceso' ? mensajesToast.iniciar : mensajesToast.completar), 'exito');
  } catch (err) {
    console.error(err);
    mostrarToast('No pudimos actualizar la etapa. Intenta nuevamente.', 'error');
    botones.forEach(b => b.disabled = false);
  }
}

// ============================================================
// FOTOGRAFÍAS (Fase 9)
// ============================================================

function renderGaleriaDashboard(fotos) {
  const grid = document.getElementById('galeriaDashboard');
  if (!fotos.length) {
    grid.innerHTML = '<div class="foto-vacio">Aún no hay fotografías subidas para este proyecto.</div>';
    return;
  }
  grid.innerHTML = fotos.map((f, i) => `
    <figure>
      ${f.tipo === 'video'
        ? `<video src="${f.url}" muted loop playsinline></video><span class="badge-video" title="Video">▶</span>`
        : `<img src="${f.url}" alt="${f.descripcion || 'Fotografía del proyecto'}">`}
      <button type="button" class="btn-eliminar-foto" data-indice="${i}" title="${f.tipo === 'video' ? 'Eliminar video' : 'Eliminar fotografía'}">×</button>
    </figure>
  `).join('');

  grid.querySelectorAll('.btn-eliminar-foto').forEach(btn => {
    btn.addEventListener('click', () => eliminarFoto(fotos[Number(btn.dataset.indice)]));
  });
}

async function eliminarFoto(foto) {
  const esVideo = foto.tipo === 'video';
  const confirmar = confirm(`¿Eliminar ${esVideo ? 'este video' : 'esta fotografía'}? Esta acción no se puede deshacer.`);
  if (!confirmar) return;

  try {
    await quitarFotoProyecto(PROYECTO_ACTUAL.codigo, foto);
    await eliminarFotoStorage(foto.storagePath);
    PROYECTO_ACTUAL.fotos = (PROYECTO_ACTUAL.fotos || []).filter(f => f.storagePath !== foto.storagePath);
    renderGaleriaDashboard(PROYECTO_ACTUAL.fotos);
  } catch (err) {
    console.error(err);
    alert('No pudimos eliminar la fotografía. Intenta nuevamente.');
  }
}

const dropzone = document.getElementById('dropzone');
const inputFoto = document.getElementById('inputFoto');
const progresoBox = document.getElementById('subidaProgreso');
const barraFill = document.getElementById('barraFill');
const subidaTexto = document.getElementById('subidaTexto');
const fotoError = document.getElementById('fotoError');

inputFoto.addEventListener('change', () => {
  if (inputFoto.files[0]) manejarSubidaFoto(inputFoto.files[0]);
});

['dragover', 'dragenter'].forEach(evento => {
  dropzone.addEventListener(evento, (e) => {
    e.preventDefault();
    dropzone.classList.add('arrastrando');
  });
});
['dragleave', 'drop'].forEach(evento => {
  dropzone.addEventListener(evento, (e) => {
    e.preventDefault();
    dropzone.classList.remove('arrastrando');
  });
});
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) manejarSubidaFoto(file);
});

async function manejarSubidaFoto(file) {
  fotoError.classList.remove('visible');

  const esVideo = file.type.startsWith('video/');
  const errorValidacion = esVideo ? validarVideo(file) : validarFoto(file);
  if (errorValidacion) {
    fotoError.textContent = errorValidacion;
    fotoError.classList.add('visible');
    inputFoto.value = '';
    return;
  }

  progresoBox.style.display = 'block';
  barraFill.style.width = '0%';
  subidaTexto.textContent = 'Subiendo… 0%';

  try {
    const onProgreso = (pct) => {
      barraFill.style.width = pct + '%';
      subidaTexto.textContent = `Subiendo… ${pct}%`;
    };

    const { url, storagePath } = esVideo
      ? await subirVideo(PROYECTO_ACTUAL.codigo, file, onProgreso)
      : await subirFoto(PROYECTO_ACTUAL.codigo, file, onProgreso);

    const foto = esVideo
      ? { url, storagePath, descripcion: '', fecha: new Date(), tipo: 'video' }
      : { url, storagePath, descripcion: '', fecha: new Date() };
    await agregarFotoProyecto(PROYECTO_ACTUAL.codigo, foto);

    PROYECTO_ACTUAL.fotos = [...(PROYECTO_ACTUAL.fotos || []), foto];
    renderGaleriaDashboard(PROYECTO_ACTUAL.fotos);

    subidaTexto.textContent = esVideo ? '¡Video subido!' : '¡Foto subida!';
    mostrarToast(esVideo ? 'Video agregado a la galería' : 'Fotografía agregada a la galería', 'exito');
    setTimeout(() => { progresoBox.style.display = 'none'; }, 1200);
  } catch (err) {
    console.error(err);
    fotoError.textContent = `No pudimos subir ${esVideo ? 'el video' : 'la fotografía'}. Intenta nuevamente.`;
    fotoError.classList.add('visible');
    progresoBox.style.display = 'none';
  } finally {
    inputFoto.value = '';
  }
}

// ============================================================
// ELIMINAR PROYECTO (solo admin)
// ============================================================

function resetearPasosEliminacion() {
  document.getElementById('pasoUnoEliminar').style.display = 'block';
  document.getElementById('pasoDosEliminar').style.display = 'none';
  document.getElementById('inputConfirmacionCodigo').value = '';
  document.getElementById('eliminarError').classList.remove('visible');
  document.getElementById('btnConfirmarEliminacion').disabled = true;
}

document.getElementById('btnIniciarEliminacion').addEventListener('click', () => {
  document.getElementById('pasoUnoEliminar').style.display = 'none';
  document.getElementById('pasoDosEliminar').style.display = 'block';
  document.getElementById('inputConfirmacionCodigo').focus();
});

document.getElementById('btnCancelarEliminacion').addEventListener('click', resetearPasosEliminacion);

document.getElementById('inputConfirmacionCodigo').addEventListener('input', (e) => {
  const coincide = e.target.value.trim() === PROYECTO_ACTUAL.codigo;
  document.getElementById('btnConfirmarEliminacion').disabled = !coincide;
});

document.getElementById('btnConfirmarEliminacion').addEventListener('click', async () => {
  const btn = document.getElementById('btnConfirmarEliminacion');
  const errorBox = document.getElementById('eliminarError');
  errorBox.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Eliminando…';

  try {
    await eliminarTodasLasFotos(PROYECTO_ACTUAL.fotos);
    await eliminarProyecto(PROYECTO_ACTUAL.codigo);
    alert('El proyecto ' + PROYECTO_ACTUAL.codigo + ' fue eliminado permanentemente.');
    volverAlListado();
  } catch (err) {
    console.error(err);
    errorBox.textContent = 'No pudimos eliminar el proyecto. Intenta nuevamente.';
    errorBox.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Eliminar definitivamente';
  }
});

// ---- Botón flotante: Volver arriba ----
(function initBotonVolverArriba() {
  const btn = document.getElementById('btnVolverArriba');
  if (!btn) return;
  const UMBRAL_SCROLL = 300;

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > UMBRAL_SCROLL);
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
