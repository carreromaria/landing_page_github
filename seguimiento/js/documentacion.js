// ============================================================
// LINENCE — Documentación
// Controlador de documentacion.html
// ============================================================
// Busca un proyecto por RUT y genera los documentos del cliente
// listos para descargar en PDF o imprimir. Los datos de cotización
// son "provisionales": viven dentro del mismo Proyecto (campo
// `cotizacion`) hasta que exista el módulo de Cotizaciones.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import { buscarProyectoPorRut, actualizarProyecto } from './firestore.js';

let PROYECTO_ACTUAL = null;
let STAFF_ACTUAL = null;

// ============================================================
// Guardia de sesión (idéntica a dashboard.html/crm.html)
// ============================================================
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
  reiniciarTimersInactividad();
});

document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Cierre de sesión por inactividad (40 min), igual que en dashboard.js ----------
const INACTIVIDAD_MIN = 40;
const AVISO_ANTES_MIN = 1;
const INACTIVIDAD_MS = INACTIVIDAD_MIN * 60 * 1000;
const AVISO_MS = AVISO_ANTES_MIN * 60 * 1000;

let timerAvisoInactividad = null;
let timerCierreInactividad = null;

function limpiarTimersInactividad() {
  if (timerAvisoInactividad) clearTimeout(timerAvisoInactividad);
  if (timerCierreInactividad) clearTimeout(timerCierreInactividad);
}

function reiniciarTimersInactividad() {
  if (!STAFF_ACTUAL) return;
  limpiarTimersInactividad();

  timerAvisoInactividad = setTimeout(() => {
    mostrarToast(
      `Tu sesión se cerrará en ${AVISO_ANTES_MIN} minuto por inactividad. Mueve el mouse o toca la pantalla para seguir conectado.`,
      'error'
    );
  }, INACTIVIDAD_MS - AVISO_MS);

  timerCierreInactividad = setTimeout(async () => {
    try { sessionStorage.setItem('linence_logout_reason', 'inactividad'); } catch (e) { /* no-op */ }
    await cerrarSesion();
    window.location.href = 'login.html';
  }, INACTIVIDAD_MS);
}

['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach((evento) => {
  window.addEventListener(evento, reiniciarTimersInactividad, { passive: true });
});

// ---------- Sidebar off-canvas (mobile), igual que en dashboard.js ----------
const dashSidebar = document.getElementById('dashSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
function abrirSidebar() { dashSidebar.classList.add('abierto'); sidebarOverlay.classList.add('abierto'); }
function cerrarSidebarMobile() { dashSidebar.classList.remove('abierto'); sidebarOverlay.classList.remove('abierto'); }
document.getElementById('btnAbrirSidebar').addEventListener('click', abrirSidebar);
document.getElementById('btnCerrarSidebar').addEventListener('click', cerrarSidebarMobile);
sidebarOverlay.addEventListener('click', cerrarSidebarMobile);

// ---------- Toasts (misma UI que dashboard.html) ----------
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

// ============================================================
// Helpers generales
// ============================================================
function limpiarRut(valor) {
  return (valor || '').trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
}

function formatearRutVisible(rutLimpio) {
  if (!rutLimpio) return '—';
  const [numero, dv] = rutLimpio.split('-');
  if (!numero) return rutLimpio;
  const conPuntos = numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dv ? `${conPuntos}-${dv}` : conPuntos;
}

function formatearCLP(valor) {
  const n = Math.round(Number(valor) || 0);
  return '$' + n.toLocaleString('es-CL');
}

function formatearFechaLarga(isoFecha) {
  if (!isoFecha) return '____________________';
  const [anio, mes, dia] = isoFecha.split('-');
  const fecha = new Date(Number(anio), Number(mes) - 1, Number(dia));
  return fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fechaGarantiaHasta(isoFecha) {
  if (!isoFecha) return '____________________';
  const [anio, mes, dia] = isoFecha.split('-');
  const fecha = new Date(Number(anio), Number(mes) - 1, Number(dia));
  fecha.setMonth(fecha.getMonth() + 6);
  return fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function tituloCase(texto) {
  return (texto || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function formatearDireccionSimple(direccion) {
  if (!direccion) return '____________________';
  if (typeof direccion === 'string') return direccion;
  const partes = [
    [direccion.calle, direccion.numero].filter(Boolean).join(' '),
    direccion.depto,
    direccion.sector,
    direccion.comuna
  ].filter(Boolean);
  return partes.join(', ') || '____________________';
}

/**
 * Arma el código de un documento reutilizando el código de cotización
 * ya existente en el proyecto (ej. "CT-WSP-00004" → "CB-WSP-00004").
 * Si el proyecto no tiene código de cotización, usa su código LIN.
 */
function codigoDocumento(prefijo, proyecto) {
  const base = proyecto.codigoCotizacion || '';
  const match = base.match(/^[A-Z]+-([A-Z]+)-(\d+)$/);
  if (match) return `${prefijo}-${match[1]}-${match[2]}`;
  return `${prefijo}-${proyecto.codigo || ''}`;
}

// ============================================================
// Búsqueda de proyecto por RUT
// ============================================================
document.getElementById('formBuscarRut').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rutLimpio = limpiarRut(document.getElementById('inputRutBuscar').value);

  document.getElementById('docNoEncontrado').classList.remove('visible');
  document.getElementById('docClienteResultado').classList.remove('visible');
  document.getElementById('docCotizacionPanel').classList.remove('visible');

  if (!rutLimpio) {
    mostrarToast('Escribe un RUT para buscar.', 'error');
    return;
  }

  try {
    const proyecto = await buscarProyectoPorRut(rutLimpio);
    if (!proyecto) {
      PROYECTO_ACTUAL = null;
      document.getElementById('docNoEncontrado').classList.add('visible');
      renderizarDocsGrid();
      return;
    }
    PROYECTO_ACTUAL = proyecto;
    mostrarResultadoCliente(proyecto);
    poblarFormCotizacion(proyecto.cotizacion || {});
    document.getElementById('docCotizacionPanel').classList.add('visible');
    renderizarDocsGrid();
  } catch (err) {
    console.error(err);
    mostrarToast('No pudimos buscar el proyecto. Intenta de nuevo.', 'error');
  }
});

function mostrarResultadoCliente(p) {
  document.getElementById('docClienteNombre').textContent = tituloCase(p.cliente) || 'Sin nombre';
  document.getElementById('docClienteMeta').textContent =
    `${p.codigo || '—'} · ${p.tipoProyecto || 'Sin tipo'} · RUT ${formatearRutVisible(p.rut)}`;
  document.getElementById('docClienteResultado').classList.add('visible');
}

// ============================================================
// Panel de Cotización provisional
// ============================================================
document.getElementById('cotizacionToggle').addEventListener('click', () => {
  const form = document.getElementById('formCotizacion');
  const flecha = document.getElementById('flechaCotizacion');
  const abierto = form.style.display !== 'none';
  form.style.display = abierto ? 'none' : 'block';
  flecha.textContent = abierto ? '⌄' : '⌃';
});

function crearFilaItem(item = {}) {
  const fila = document.createElement('div');
  fila.className = 'doc-item-fila';
  fila.innerHTML = `
    <input type="text" class="item-codigo" placeholder="Código" value="${item.codigo || ''}">
    <input type="number" class="item-cantidad" placeholder="Cant." min="0" value="${item.cantidad ?? ''}">
    <input type="text" class="item-descripcion" placeholder="Descripción" value="${item.descripcion || ''}">
    <input type="number" class="item-valor" placeholder="Valor unitario" min="0" value="${item.valorUnitario ?? ''}">
    <button type="button" class="doc-item-quitar" title="Quitar ítem">×</button>
  `;
  fila.querySelector('.doc-item-quitar').addEventListener('click', () => {
    fila.remove();
    calcularTotalesCotizacion();
  });
  fila.querySelectorAll('input').forEach(inp => inp.addEventListener('input', calcularTotalesCotizacion));
  return fila;
}

document.getElementById('btnAgregarItem').addEventListener('click', () => {
  document.getElementById('cotItemsTabla').appendChild(crearFilaItem());
});

document.getElementById('cotIva').addEventListener('input', calcularTotalesCotizacion);
document.getElementById('cotAbonoPorcentaje').addEventListener('input', calcularTotalesCotizacion);

function leerItemsCotizacion() {
  return Array.from(document.querySelectorAll('#cotItemsTabla .doc-item-fila')).map(fila => ({
    codigo: fila.querySelector('.item-codigo').value.trim(),
    cantidad: Number(fila.querySelector('.item-cantidad').value) || 0,
    descripcion: fila.querySelector('.item-descripcion').value.trim(),
    valorUnitario: Number(fila.querySelector('.item-valor').value) || 0
  })).filter(it => it.codigo || it.descripcion || it.cantidad || it.valorUnitario);
}

function calcularTotalesCotizacion() {
  const items = leerItemsCotizacion();
  const subtotal = items.reduce((acc, it) => acc + (it.cantidad * it.valorUnitario), 0);
  const iva = Number(document.getElementById('cotIva').value) || 0;
  const total = subtotal + iva;
  const abonoPorcentaje = Number(document.getElementById('cotAbonoPorcentaje').value) || 0;
  const abonoMonto = Math.round(total * abonoPorcentaje / 100);
  const saldo = total - abonoMonto;

  document.getElementById('cotSubtotal').textContent = formatearCLP(subtotal);
  document.getElementById('cotTotal').textContent = formatearCLP(total);
  document.getElementById('cotAbonoMonto').textContent = formatearCLP(abonoMonto);
  document.getElementById('cotSaldo').textContent = formatearCLP(saldo);

  return { subtotal, iva, total, abonoPorcentaje, abonoMonto, saldo };
}

function poblarFormCotizacion(cot) {
  document.getElementById('cotNumero').value = cot.numero || PROYECTO_ACTUAL?.codigoCotizacion || '';
  document.getElementById('cotFechaCotizacion').value = cot.fechaCotizacion || '';
  document.getElementById('cotFechaValidez').value = cot.fechaValidez || '';
  document.getElementById('cotIva').value = cot.iva ?? 0;
  document.getElementById('cotAbonoPorcentaje').value = cot.abonoPorcentaje ?? 60;
  document.getElementById('cotFormaPago').value = cot.formaPago || '';
  document.getElementById('cotMedioPago').value = cot.medioPago || '';
  document.getElementById('cotBanco').value = cot.banco || '';
  document.getElementById('cotFechaPago').value = cot.fechaPago || '';
  document.getElementById('cotFechaInstalacion').value = cot.fechaInstalacion || '';
  document.getElementById('cotFechaContrato').value = cot.fechaContrato || '';
  document.getElementById('cotPlazoDias').value = cot.plazoDias ?? 16;
  document.getElementById('cotHoraInicio').value = cot.horaInicio || '';
  document.getElementById('cotHoraTermino').value = cot.horaTermino || '';
  document.getElementById('cotObservaciones').value = cot.observaciones || '';
  document.getElementById('cotInstalador').value = cot.instalador || 'Abraham Quintero';
  renderCatalogoCheckboxes('catMateriales', CATALOGO_MATERIALES, cot.materiales);
  renderCatalogoCheckboxes('catHerrajes', CATALOGO_HERRAJES, cot.herrajes);
  renderCatalogoCheckboxes('catCubiertas', CATALOGO_CUBIERTAS, cot.cubiertas);
  renderCatalogoCheckboxes('catAccesorios', CATALOGO_ACCESORIOS, cot.accesorios);
  document.getElementById('cotMaterialesOtros').value = (cot.materialesOtros || []).join(', ');
  document.getElementById('cotHerrajesOtros').value = (cot.herrajesOtros || []).join(', ');
  document.getElementById('cotCubiertasOtros').value = (cot.cubiertasOtros || []).join(', ');
  document.getElementById('cotAccesoriosOtros').value = (cot.accesoriosOtros || []).join(', ');

  const tabla = document.getElementById('cotItemsTabla');
  tabla.innerHTML = '';
  const items = (cot.items && cot.items.length) ? cot.items : [{}];
  items.forEach(it => tabla.appendChild(crearFilaItem(it)));
  calcularTotalesCotizacion();

  // Panel cerrado por defecto; se abre solo si el usuario hace clic.
  document.getElementById('formCotizacion').style.display = 'none';
  document.getElementById('flechaCotizacion').textContent = '⌄';
}

document.getElementById('formCotizacion').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!PROYECTO_ACTUAL) return;

  const totales = calcularTotalesCotizacion();
  const cotizacion = {
    numero: document.getElementById('cotNumero').value.trim(),
    fechaCotizacion: document.getElementById('cotFechaCotizacion').value,
    fechaValidez: document.getElementById('cotFechaValidez').value,
    items: leerItemsCotizacion(),
    iva: totales.iva,
    abonoPorcentaje: totales.abonoPorcentaje,
    formaPago: document.getElementById('cotFormaPago').value.trim(),
    medioPago: document.getElementById('cotMedioPago').value.trim(),
    banco: document.getElementById('cotBanco').value.trim(),
    fechaPago: document.getElementById('cotFechaPago').value,
    fechaInstalacion: document.getElementById('cotFechaInstalacion').value,
    fechaContrato: document.getElementById('cotFechaContrato').value,
    plazoDias: Number(document.getElementById('cotPlazoDias').value) || 0,
    horaInicio: document.getElementById('cotHoraInicio').value,
    horaTermino: document.getElementById('cotHoraTermino').value,
    observaciones: document.getElementById('cotObservaciones').value.trim(),
    instalador: document.getElementById('cotInstalador').value.trim() || 'Abraham Quintero',
    materiales: leerCatalogoCheckboxes('catMateriales'),
    herrajes: leerCatalogoCheckboxes('catHerrajes'),
    cubiertas: leerCatalogoCheckboxes('catCubiertas'),
    accesorios: leerCatalogoCheckboxes('catAccesorios'),
    materialesOtros: document.getElementById('cotMaterialesOtros').value.split(',').map(s => s.trim()).filter(Boolean),
    herrajesOtros: document.getElementById('cotHerrajesOtros').value.split(',').map(s => s.trim()).filter(Boolean),
    cubiertasOtros: document.getElementById('cotCubiertasOtros').value.split(',').map(s => s.trim()).filter(Boolean),
    accesoriosOtros: document.getElementById('cotAccesoriosOtros').value.split(',').map(s => s.trim()).filter(Boolean),
    // Totales ya calculados, para que los documentos no tengan que recalcular.
    subtotal: totales.subtotal,
    total: totales.total,
    abonoMonto: totales.abonoMonto,
    saldoMonto: totales.saldo
  };

  try {
    await actualizarProyecto(PROYECTO_ACTUAL.codigo, { cotizacion });
    PROYECTO_ACTUAL.cotizacion = cotizacion;
    mostrarToast('Datos de cotización guardados.');
  } catch (err) {
    console.error(err);
    document.getElementById('cotizacionError').textContent = 'No pudimos guardar los datos. Intenta de nuevo.';
  }
});

// ============================================================
// Catálogo de opciones para la Descripción de Cotización (DC)
// ============================================================
const CATALOGO_MATERIALES = [
  'Melamina blanca de 15 mm', 'Melamina blanca de 18 mm',
  'Melamina de color de 15 mm', 'Melamina de color de 18 mm',
  'MDF blanco de 15 mm', 'MDF blanco de 18 mm', 'MDF blanco de 3 mm', 'MDF de color de 3 mm',
  'Tapacantos blanco 0.4 mm x 22 mm', 'Tapacantos blanco 2 mm x 22 mm', 'Tapacantos blanco alto brillo 1.5 mm x 22 mm',
  'Tapacantos de color 0.4 mm x 22 mm', 'Tapacantos de color 2 mm x 22 mm', 'Tapacantos de color alto brillo 1.5 mm x 22 mm'
];
const CATALOGO_HERRAJES = [
  'Bisagras de cazoletas de 90° (cierre normal)', 'Bisagras de cazoletas de 90° (cierre suave)',
  'Bisagras de cazoleta de 165° (cierre normal)', 'Bisagra de cazoleta de 165° (cierre suave)',
  'Bisagra de cazoleta de 175° (cierre normal)', 'Bisagra de cazoleta de 175° (cierre suave)',
  'Correderas telescópicas (cierre normal)', 'Correderas telescópicas (cierre suave)',
  'Correderas telescópicas ocultas (cierre suave)', 'Bombín hidráulico (cierre suave)',
  'Brazo compás (cierre normal)', 'Push to Open'
];
const CATALOGO_CUBIERTAS = [
  'Cuarzo canto pulido y respaldo recto', 'Cuarzo con regrueso y respaldo recto',
  'Granito canto pulido y respaldo recto', 'Granito con regrueso y respaldo recto',
  'Postformado canto recto y respaldo recto', 'Postformado canto curvo y respaldo curvo'
];
const CATALOGO_ACCESORIOS = [
  'Especiero metálico (cierre suave)', 'Especiero en melamina (cierre suave)', 'Cubertero en PVC',
  'Magic corner metálico', 'Magic corner en melamina', 'Esquinero extraíble tipo riñón', 'Rotonda esquina 180°',
  'Basurero extraíble 3 x 10 litros (cierre suave)', 'Basurero extraíble 20L x 10L (cierre suave)',
  'Basurero extraíble 2 x 27,5 litros (cierre suave)', 'Basurero extraíble 18L x 6L (cierre suave)',
  'Cestas extraíbles 3 niveles 30 cm (cierre suave)', 'Cesta extraíble 2 niveles 40 cm (cierre suave)',
  'Escurreplatos con bandeja de acero inoxidable 60 cm', 'Escurreplatos con bandeja de acero inoxidable 90 cm',
  'Luces led con canaleta (luz cálida)', 'Luces led con canaleta (luz fría)', 'Luces led con canaletas (luz RGB)'
];

/** Dibuja un catálogo de checkboxes dentro de #contenedorId, marcando los que ya estén guardados. */
function renderCatalogoCheckboxes(contenedorId, catalogo, seleccionados = []) {
  const contenedor = document.getElementById(contenedorId);
  contenedor.innerHTML = catalogo.map((opcion, i) => `
    <label>
      <input type="checkbox" value="${opcion.replace(/"/g, '&quot;')}" id="${contenedorId}_${i}" ${seleccionados.includes(opcion) ? 'checked' : ''}>
      ${opcion}
    </label>
  `).join('');
}

/** Lee las opciones marcadas de un catálogo ya dibujado con renderCatalogoCheckboxes. */
function leerCatalogoCheckboxes(contenedorId) {
  return Array.from(document.querySelectorAll(`#${contenedorId} input[type="checkbox"]:checked`)).map(c => c.value);
}

function listaLineas(texto, textoVacio = 'Según cotización aprobada.') {
  const lineas = (texto || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lineas.length) return `<li>${textoVacio}</li>`;
  return lineas.map(l => `<li>${l}</li>`).join('');
}

/** Junta lo marcado del catálogo + lo escrito en "Otros" para mostrar en el documento. */
function listaCatalogo(seleccionados = [], otros = [], textoVacio = 'Según cotización (si aplica).') {
  const todo = [...(seleccionados || []), ...(otros || [])];
  if (!todo.length) return `<li>${textoVacio}</li>`;
  return todo.map(item => `<li>${item}</li>`).join('');
}

/** Chequeo mínimo para saber si ya se guardó una cotización utilizable. */
function cotizacionCompleta(p) {
  return !!(p.cotizacion && p.cotizacion.total > 0);
}

// ============================================================
// Definición de documentos y grilla
// ============================================================
const DOCUMENTOS = [
  { sigla: 'PT',  nombre: 'Portada institucional', activo: true, generar: generarPortada },
  { sigla: 'CB',  nombre: 'Carta de Bienvenida', activo: true, generar: generarCartaBienvenida },
  { sigla: 'COT', nombre: 'Cotización', activo: true, requiereCotizacion: true, generar: generarCotizacion },
  { sigla: 'DC',  nombre: 'Descripción de la Cotización', activo: true, requiereCotizacion: true, generar: generarDescripcionCotizacion },
  { sigla: 'CV',  nombre: 'Contrato de Venta e Instalación', activo: true, requiereCotizacion: true, generar: generarContratoVenta },
  { sigla: 'MU',  nombre: 'Manual de Uso y Mantención', activo: true, generar: generarManualUso },
  { sigla: 'CG',  nombre: 'Certificado de Garantía Comercial', activo: true, generar: generarCertificadoGarantia },
  { sigla: 'ER',  nombre: 'Acta de Entrega y Recepción Conforme', activo: true, generar: generarActaEntrega },
  { sigla: 'CR',  nombre: 'Comprobante de Recepción de Abono', activo: true, requiereCotizacion: true, generar: generarComprobanteAbono },
  { sigla: 'TP',  nombre: 'Tarjeta de Servicio Postventa', activo: true, generar: generarTarjetaPostventa },
  { sigla: 'EG',  nombre: 'Tarjeta de Evaluación en Google', activo: true, generar: generarTarjetaEvaluacionGoogle }
];

function renderizarDocsGrid() {
  const grid = document.getElementById('docsGrid');
  grid.innerHTML = '';
  DOCUMENTOS.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'doc-card' + (doc.activo ? '' : ' doc-pendiente');
    card.innerHTML = `
      <div class="doc-card-top">
        <span class="doc-sigla">${doc.sigla}</span>
        ${doc.activo ? '' : '<span class="badge-proximamente">Próximamente</span>'}
      </div>
      <h3>${doc.nombre}</h3>
      <div class="doc-card-botones">
        <button type="button" class="btn-secundario btn-vista-previa" ${doc.activo ? '' : 'disabled'}>Vista previa</button>
      </div>
    `;
    if (doc.activo) {
      card.querySelector('.btn-vista-previa').addEventListener('click', () => {
        if (!PROYECTO_ACTUAL) {
          mostrarToast('Primero busca un cliente por RUT.', 'error');
          return;
        }
        if (doc.requiereCotizacion && !cotizacionCompleta(PROYECTO_ACTUAL)) {
          mostrarToast('Completa y guarda primero los "Datos de cotización" de este proyecto.', 'error');
          return;
        }
        const html = doc.generar(PROYECTO_ACTUAL);
        abrirModalDocumento(html, `${doc.sigla}-${PROYECTO_ACTUAL.codigo}`);
      });
    }
    grid.appendChild(card);
  });
}
renderizarDocsGrid();

// ============================================================
// Encabezado y pie de página reutilizables (misma línea gráfica
// en todos los documentos)
// ============================================================
function encabezadoHoja(titulo, codigo) {
  return `
    <div class="hoja-header">
      <div><span class="hoja-titulo">${titulo}</span><span class="hoja-codigo">${codigo}</span></div>
      <img src="assets/img/logo-wordmark-claro.png" alt="Linence">
    </div>
    <div class="hoja-datos-empresa">
      <span><strong>LINENCE SpA.</strong> · R.U.T: 78.446.739-2</span>
      <span>DIRECCIÓN: Av. Salvador Allende 500</span>
      <span>CORREO: contacto@linence.cl</span>
    </div>
  `;
}

function pieHoja() {
  return `
    <div class="hoja-footer">
      <span>www.linence.cl</span>
      <span>Instagram · Facebook · TikTok: Linence.cl</span>
      <span>WhatsApp +56 9 5703 9988</span>
    </div>
  `;
}

// ============================================================
// CB — Carta de Bienvenida
// ============================================================
function generarCartaBienvenida(p) {
  const nombreCliente = tituloCase(p.cliente) || '____________________';
  const codigo = codigoDocumento('CB', p);

  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Carta de Bienvenida', codigo)}
      <div class="hoja-cuerpo">
        <h2>Carta de Bienvenida</h2>
        <p><strong>Estimado(a) Cliente: ${nombreCliente}</strong></p>

        <p>En nombre de todo el equipo de <strong>LINENCE SpA</strong>, queremos agradecer sinceramente la confianza que ha depositado en nosotros para desarrollar un proyecto tan importante para usted.</p>

        <p>Cada espacio que diseñamos y fabricamos representa mucho más que mobiliario. Es el resultado de un proceso en el que combinamos diseño, ingeniería, precisión y dedicación, con el propósito de crear ambientes funcionales, elegantes y duraderos que acompañen a nuestros clientes por muchos años.</p>

        <p>Nuestro compromiso no finaliza con la instalación del proyecto. A partir de este momento, comienza una nueva etapa en la que seguiremos disponibles para brindarle orientación, soporte y acompañamiento cuando lo necesite. La calidad de nuestros productos va de la mano con un servicio postventa responsable y cercano.</p>

        <p>Con el objetivo de facilitar el cuidado de su mobiliario y mantener sus condiciones originales, ponemos a su disposición la presente documentación, la cual forma parte del expediente oficial de su proyecto:</p>

        <ul>
          <li>Contrato de Venta e Instalación.</li>
          <li>Acta de Entrega y Recepción Conforme.</li>
          <li>Certificado de Garantía Comercial.</li>
          <li>Manual de Uso y Mantención.</li>
          <li>Anexo Técnico de Materiales.</li>
          <li>Ficha Técnica del Proyecto.</li>
        </ul>

        <p>Le recomendamos conservar estos documentos, ya que contienen información relevante sobre las especificaciones técnicas del proyecto, las condiciones de la garantía comercial y las recomendaciones para la correcta conservación del mobiliario.</p>

        <p>En LINENCE creemos que los mejores proyectos nacen de la confianza, el compromiso y la atención a los detalles. Esa filosofía guía nuestro trabajo en cada etapa del proceso, desde el diseño inicial hasta la entrega final.</p>

        <p>Esperamos que disfrute plenamente de su nuevo espacio y que este refleje la calidad, funcionalidad y estilo que inspiraron su proyecto.</p>

        <p>Agradecemos nuevamente su preferencia y esperamos seguir acompañándolo en sus futuros proyectos.</p>

        <p>Reciba un cordial saludo.</p>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// CV — Contrato de Venta e Instalación
// ============================================================
function generarContratoVenta(p) {
  const cot = p.cotizacion || {};
  const nombreCliente = tituloCase(p.cliente) || '____________________';
  const rutCliente = formatearRutVisible(p.rut);
  const domicilioCliente = formatearDireccionSimple(p.direccion);
  const tipoMobiliario = p.tipoProyecto || '____________________';
  const codigo = codigoDocumento('CV', p);
  const fechaContrato = formatearFechaLarga(cot.fechaContrato);
  const total = formatearCLP(cot.total);
  const abonoPct = cot.abonoPorcentaje ?? 60;
  const saldoPct = 100 - abonoPct;
  const plazoDias = cot.plazoDias || 16;

  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Contrato de Venta e Instalación', codigo)}
      <div class="hoja-cuerpo">
        <h2>Contrato de Venta e Instalación</h2>
        <p class="hoja-subtitulo">Fabricación e Instalación de ${tipoMobiliario}</p>

        <p><strong>PRIMERA</strong>: <u>COMPARECENCIA</u>. Con fecha ${fechaContrato}, en la ciudad de Rancagua-Chile, comparecen, por una parte, LINENCE SpA, RUN N° 78.446.739-2, con domicilio en Av. Salvador Allende 500, representada por su Gerente General, Maria Carrero Peralta, en adelante "LINENCE". Por otra parte, el cliente, ${nombreCliente}, RUN N° ${rutCliente}, domicilio en ${domicilioCliente}, en adelante "EL CLIENTE".</p>

        <p>Ambas partes acuerdan celebrar el presente Contrato de Venta e Instalación de Mobiliario a Medida, el cual se regirá por las siguientes cláusulas.</p>

        <p><strong>SEGUNDA</strong>: <u>OBJETIVO DEL CONTRATO.</u> LINENCE se obliga a fabricar, suministrar, transportar e instalar un <strong>${tipoMobiliario} fabricado a medida</strong>, conforme a las especificaciones técnicas, planos, renders, cotización y demás antecedentes aprobados por el Cliente.</p>

        <p>El Cliente se obliga a recibir el proyecto y pagar el precio convenido en las condiciones establecidas en este contrato.</p>

        <p><strong>TERCERA</strong>: <u>DOCUMENTOS INTEGRANTES</u>. Forman parte integrante del presente contrato:</p>
        <ul>
          <li>Cotización aceptada.</li>
          <li>Planos aprobados (si existen).</li>
          <li>Renders aprobados (si existen).</li>
          <li>Especificaciones técnicas.</li>
          <li>Ficha Técnica del Proyecto.</li>
          <li>Órdenes de Cambio (si existen).</li>
          <li>Certificado de Garantía Comercial.</li>
          <li>Manual de Uso y Mantención.</li>
          <li>Anexo Técnico.</li>
        </ul>
        <p>En caso de discrepancia, prevalecerá el presente contrato y, posteriormente, los documentos anexos en el orden antes señalado.</p>

        <p><strong>CUARTA:</strong> <u>DESCRIPCIÓN DEL PROYECTO</u>. LINENCE fabricará e instalará un ${tipoMobiliario} con las siguientes características:</p>
        <ul>
          <li>Tipo de mobiliario: ${tipoMobiliario}.</li>
          <li>Fabricación a medida.</li>
          <li>Materiales: Según cotización aprobada.</li>
          <li>Color: Según muestra aprobada.</li>
          <li>Herrajes: Según especificación técnica.</li>
          <li>Cubierta: Según cotización (si aplica).</li>
          <li>Lavamanos: Según cotización (si aplica).</li>
          <li>Grifería: Según cotización (si aplica).</li>
        </ul>
        <p>Cualquier modificación deberá realizarse conforme a la Cláusula XI.</p>

        <p><strong>QUINTA:</strong> <u>PRECIO</u>. El valor total del proyecto asciende a: ${total}. Este valor incluye únicamente los trabajos expresamente indicados en la cotización aceptada. No se consideran trabajos adicionales que no hayan sido presupuestados.</p>

        <p><strong>SEXTA:</strong> <u>FORMA DE PAGO</u>. El Cliente se obliga a pagar el precio del proyecto de la siguiente forma:</p>
        <ul>
          <li>Abono inicial: ${abonoPct} %</li>
          <li>Saldo final: ${saldoPct} %</li>
        </ul>
        <p>Cada pago será respaldado mediante el correspondiente comprobante de Recepción de Abono o documento tributario, según corresponda. El incumplimiento de estas obligaciones podrá dar lugar a la improcedencia de la garantía.</p>

        <p><strong>SÉPTIMA:</strong> <u>PLAZO DE EJECUCIÓN</u>. El plazo estimado para la fabricación e instalación será de <strong>${plazoDias} días hábiles</strong>, contados desde: la recepción del abono inicial; la aprobación definitiva del diseño (cuando corresponda); y la confirmación de disponibilidad del lugar de instalación. Los plazos podrán modificarse por causas no imputables a LINENCE, incluyendo fuerza mayor, retrasos de proveedores o solicitudes de modificación realizadas por el Cliente.</p>

        <p><strong>OCTAVA:</strong> <u>OBLIGACIONES DE LINENCE.</u> LINENCE se compromete a: fabricar el mobiliario conforme a las especificaciones aprobadas; utilizar materiales de calidad; instalar el proyecto mediante personal calificado; mantener informado al Cliente sobre el avance del proyecto; entregar la documentación correspondiente al finalizar la instalación; y otorgar la Garantía Comercial en los términos establecidos en el documento respectivo.</p>

        <p><strong>NOVENA:</strong> <u>OBLIGACIONES DEL CLIENTE.</u> El Cliente se obliga a: pagar el precio convenido; permitir el acceso al inmueble; disponer de un espacio libre para la instalación; contar con instalaciones eléctricas y sanitarias operativas cuando corresponda; revisar el proyecto al momento de la entrega; y firmar el Acta de Entrega y Recepción Conforme, dejando constancia de cualquier observación.</p>

        <p><strong>DÉCIMA</strong>: <u>CONDICIONES DEL LUGAR DE INSTALACIÓN.</u> El Cliente declara que el lugar destinado a la instalación se encontrará en condiciones adecuadas para ejecutar los trabajos contratados, en particular: muros terminados; piso terminado y nivelado; conexiones sanitarias disponibles (si corresponde); conexiones eléctricas disponibles (si corresponde); y área libre de obstáculos. Si estas condiciones no se cumplen, LINENCE podrá reprogramar la instalación sin que ello constituya un incumplimiento contractual.</p>

        <p><strong>DÉCIMA PRIMERA:</strong> <u>MODIFICACIONES DEL PROYECTO.</u> Toda modificación solicitada por el Cliente deberá formalizarse por escrito mediante una Orden de Cambio emitida por LINENCE. Las modificaciones podrán generar variaciones en el precio, el plazo de ejecución, los materiales o las especificaciones técnicas. Ninguna modificación será ejecutada sin la aceptación expresa del Cliente.</p>

        <p><strong>DÉCIMA SEGUNDA:</strong> <u>ENTREGA DEL PROYECTO.</u> Finalizada la instalación, las partes suscribirán el Acta de Entrega y Recepción Conforme. Si existieren observaciones menores que no afecten el uso normal del mobiliario, estas quedarán registradas en el Acta con un plazo acordado para su corrección.</p>

        <p><strong>DÉCIMA TERCERA:</strong> <u>GARANTÍA COMERCIAL.</u> LINENCE otorgará una Garantía Comercial de seis (6) meses, contados desde la fecha de recepción conforme del proyecto, de acuerdo con las condiciones establecidas en el Certificado de Garantía Comercial entregado al Cliente. Esta garantía es complementaria y no limita los derechos que la legislación chilena reconoce a los consumidores.</p>

        <p><strong>DÉCIMA CUARTA:</strong> <u>LIMITACIONES.</u> No constituirán incumplimiento contractual: variaciones naturales de color, veta o textura propias de los materiales; tolerancias normales de fabricación e instalación; y cambios producidos por condiciones ambientales o de iluminación.</p>

        <p><strong>DÉCIMA QUINTA</strong>: <u>TERMINACIÓN ANTICIPADA.</u> En caso de que el Cliente decida desistir del proyecto una vez iniciada la fabricación, deberá pagar los costos efectivamente incurridos por LINENCE hasta la fecha de la comunicación, incluyendo materiales adquiridos, trabajos ejecutados y demás gastos directamente asociados al proyecto.</p>

        <p><strong>DÉCIMA SEXTA:</strong> <u>PROTECCIÓN DE DATOS PERSONALES.</u> Los datos proporcionados por el Cliente serán utilizados exclusivamente para la ejecución del proyecto, la gestión administrativa y el servicio postventa, de conformidad con la normativa chilena aplicable.</p>

        <p><strong>DÉCIMA SÉPTIMA:</strong> <u>AUTORIZACIÓN PARA USO DE IMÁGENES.</u> El Cliente manifiesta: ( ) Autorizo a LINENCE a utilizar fotografías del proyecto terminado con fines publicitarios e institucionales, resguardando mi privacidad. ( ) No autorizo dicho uso.</p>

        <p><strong>DÉCIMA OCTAVA:</strong> <u>LEGISLACIÓN APLICABLE Y SOLUCIÓN DE CONTROVERSIAS.</u> El presente contrato se regirá por las leyes de la República de Chile. Las partes procurarán resolver cualquier diferencia mediante negociación directa y de buena fe. Si ello no fuere posible, la controversia será sometida a los tribunales de justicia competentes, sin perjuicio de los derechos que la legislación chilena reconoce al consumidor.</p>

        <p><strong>DÉCIMA NOVENA:</strong> <u>ACEPTACIÓN.</u> Las partes declaran haber leído íntegramente el presente contrato, comprender su contenido y aceptar todas sus cláusulas. Se firma en dos ejemplares de igual tenor y fecha, quedando uno en poder de cada parte.</p>

        <p><strong>RECEPCIÓN:</strong></p>
        <p>Cliente: ____________________&nbsp;&nbsp;&nbsp; RUT: ____________________</p>
        <p>Nombre: ${nombreCliente}</p>
        <p>Firma: ____________________&nbsp;&nbsp;&nbsp; Fecha: ____________________</p>

        <p><strong>LINENCE SpA:</strong></p>
        <p>Representante: María Carrero Peralta&nbsp;&nbsp;&nbsp; RUT: 26.429.618-8</p>
        <p>Cargo: Gerente General</p>
        <p>Firma: ____________________&nbsp;&nbsp;&nbsp; Fecha: ____________________</p>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// PT — Portada institucional
// ============================================================
function generarPortada(p) {
  const nombreCliente = tituloCase(p.cliente) || '____________________';
  return `
    <div class="hoja-documento" style="background:var(--ink); color:#fff; align-items:center; justify-content:center; text-align:center; padding:60px 40px;">
      <img src="assets/img/logo-wordmark-claro.png" alt="Linence" style="height:70px; margin-bottom:26px;">
      <div style="font-size:13px; letter-spacing:0.15em; opacity:0.7; margin-bottom:60px;">FÁBRICA DE MUEBLES MODERNOS</div>
      <div style="font-size:26px; font-weight:600; letter-spacing:0.04em; color:var(--gold); margin-bottom:8px;">DOCUMENTACIÓN</div>
      <div style="font-size:18px; letter-spacing:0.1em; margin-bottom:50px;">DEL PROYECTO</div>
      <div style="font-size:14px; opacity:0.85;">${nombreCliente}</div>
      <div style="font-size:12px; opacity:0.6; margin-top:4px;">Código de Proyecto: ${p.codigo || ''}</div>
    </div>
  `;
}

// ============================================================
// COT — Cotización
// ============================================================
function generarCotizacion(p) {
  const cot = p.cotizacion || {};
  const codigo = cot.numero || codigoDocumento('COT', p);
  const items = (cot.items && cot.items.length) ? cot.items : [];
  const filas = items.map(it => `
    <tr>
      <td>${it.codigo || ''}</td>
      <td style="text-align:center;">${it.cantidad || 0}</td>
      <td>${it.descripcion || ''}</td>
      <td style="text-align:right;">${formatearCLP(it.valorUnitario)}</td>
      <td style="text-align:right;">${formatearCLP((it.cantidad || 0) * (it.valorUnitario || 0))}</td>
    </tr>
  `).join('');

  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Cotización', codigo)}
      <div class="hoja-cuerpo">
        <table style="width:100%; border-collapse:collapse; margin-bottom:18px; font-size:12px;">
          <tr>
            <td style="border:1px solid var(--gold-line); padding:6px 10px;"><strong>FECHA:</strong> ${formatearFechaLarga(cot.fechaCotizacion)}</td>
            <td style="border:1px solid var(--gold-line); padding:6px 10px;"><strong>PROYECTO:</strong> ${p.tipoProyecto || '—'}</td>
            <td style="border:1px solid var(--gold-line); padding:6px 10px;"><strong>VÁLIDA HASTA:</strong> ${formatearFechaLarga(cot.fechaValidez)}</td>
          </tr>
          <tr>
            <td style="border:1px solid var(--gold-line); padding:6px 10px;" colspan="2"><strong>CLIENTE:</strong> ${tituloCase(p.cliente)}</td>
            <td style="border:1px solid var(--gold-line); padding:6px 10px;"><strong>TELÉFONO:</strong> ${p.telefono || '—'}</td>
          </tr>
          <tr>
            <td style="border:1px solid var(--gold-line); padding:6px 10px;" colspan="3"><strong>DIRECCIÓN:</strong> ${formatearDireccionSimple(p.direccion)}</td>
          </tr>
        </table>

        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:18px;">
          <thead>
            <tr style="background:var(--ink); color:#fff;">
              <th style="padding:8px; text-align:left;">Código</th>
              <th style="padding:8px;">Cantidad</th>
              <th style="padding:8px; text-align:left;">Descripción</th>
              <th style="padding:8px; text-align:right;">Valor unitario</th>
              <th style="padding:8px; text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${filas || '<tr><td colspan="5" style="padding:8px; text-align:center; opacity:0.6;">Sin ítems cargados</td></tr>'}</tbody>
        </table>

        <p>Esta cotización de su proyecto es válida hasta ${formatearFechaLarga(cot.fechaValidez)}.<br>Cualquier duda o consulta comuníquese con nosotros, estaremos gustosos de atenderlo.</p>
        <p><strong>GRACIAS POR SU PREFERENCIA…!!!</strong></p>

        <table style="width:260px; margin-left:auto; border-collapse:collapse; font-size:13px;">
          <tr><td style="padding:6px 10px; background:var(--sand-soft);">SUBTOTAL</td><td style="padding:6px 10px; text-align:right;">${formatearCLP(cot.subtotal)}</td></tr>
          <tr><td style="padding:6px 10px; background:var(--sand-soft);">I.V.A</td><td style="padding:6px 10px; text-align:right;">${formatearCLP(cot.iva)}</td></tr>
          <tr><td style="padding:6px 10px; background:var(--ink); color:#fff;"><strong>TOTAL</strong></td><td style="padding:6px 10px; text-align:right; background:var(--ink); color:#fff;"><strong>${formatearCLP(cot.total)}</strong></td></tr>
          <tr><td style="padding:6px 10px; background:var(--gold); color:var(--ink);">ABONO ${cot.abonoPorcentaje ?? 60}%</td><td style="padding:6px 10px; text-align:right; background:var(--gold); color:var(--ink);"><strong>${formatearCLP(cot.abonoMonto)}</strong></td></tr>
        </table>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// DC — Descripción de la Cotización
// ============================================================
function generarDescripcionCotizacion(p) {
  const cot = p.cotizacion || {};
  const codigo = codigoDocumento('DC', p);
  const nombreCliente = tituloCase(p.cliente) || '____________________';
  const rutCliente = formatearRutVisible(p.rut);
  const domicilioCliente = formatearDireccionSimple(p.direccion);

  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Descripción de Cotización', codigo)}
      <div class="hoja-cuerpo">
        <h2>Descripción de Fabricación e Instalación de Mobiliario a Medida</h2>
        <p style="text-align:center;" class="hoja-subtitulo"></p>

        <p>Con fecha ${formatearFechaLarga(cot.fechaCotizacion)}, en la ciudad de Rancagua-Chile, se presenta la siguiente descripción de cotización de servicios entre: EL PRESTADOR: LINENCE SpA. Mobiliario a Medida, representada para estos efectos por doña Maria Carrero, RUT 26.429.618-8, con domicilio comercial en Av. Salvador Allende # 500, en adelante "LINENCE SpA". EL CLIENTE: ${nombreCliente}, RUT: ${rutCliente}, con domicilio en ${domicilioCliente}, en adelante "El Cliente". Ambas partes acuerdan la descripción de la cotización de forma voluntaria a continuación:</p>

        <p><strong>1. MATERIALES A UTILIZAR EN LA FABRICACIÓN DE ESTRUCTURA DE MUEBLES Y PUERTAS:</strong></p>
        <p>LINENCE SpA. se compromete a ejecutar los trabajos utilizando materiales de primera calidad, de acuerdo a los estándares mínimos de las marcas (Masisa/Arauco Vesto).</p>
        <ul>${listaCatalogo(cot.materiales, cot.materialesOtros)}</ul>

        <p><strong>2. HERRAJES A UTILIZAR:</strong></p>
        <ul>${listaCatalogo(cot.herrajes, cot.herrajesOtros)}</ul>

        <p><strong>3. CUBIERTAS:</strong></p>
        <ul>${listaCatalogo(cot.cubiertas, cot.cubiertasOtros)}</ul>

        <p><strong>4. ACCESORIOS:</strong></p>
        <ul>${listaCatalogo(cot.accesorios, cot.accesoriosOtros)}</ul>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// MU — Manual de Uso y Mantención
// ============================================================
function generarManualUso(p) {
  const cot = p.cotizacion || {};
  const codigo = codigoDocumento('MU', p);
  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Manual de Uso y Mantención', codigo)}
      <div class="hoja-cuerpo">
        <h2>Manual de Uso y Mantención del Mobiliario</h2>
        <p class="hoja-subtitulo">Recomendaciones para la conservación y vida útil del proyecto</p>

        <p>Con fecha ${formatearFechaLarga(cot.fechaInstalacion)}, en la ciudad de Rancagua-Chile, se presenta el siguiente manual de uso y mantención del mobiliario siguiendo las políticas internas de LINENCE SpA.</p>

        <p><strong>PRIMERA: OBJETIVO.</strong> El presente Manual de Uso y Mantención tiene por finalidad proporcionar al cliente las recomendaciones necesarias para el correcto uso, limpieza, conservación y mantenimiento del mobiliario fabricado e instalado por LINENCE SpA. La correcta aplicación de estas recomendaciones contribuirá a preservar la funcionalidad, apariencia y vida útil del proyecto, además de facilitar el ejercicio de la garantía comercial otorgada por la empresa. Este manual forma parte de la documentación oficial entregada al cliente y debe conservarse junto con el Contrato de Venta, el Acta de Entrega y el Certificado de Garantía.</p>

        <p><strong>SEGUNDA: ALCANCE.</strong> Las presentes recomendaciones son aplicables a todos los muebles fabricados e instalados por LINENCE SpA, incluyendo, entre otros: cocinas, clósets, walk-in closets, muebles de baño, centros de entretenimiento, home office, muebles de oficina, muebles comerciales, mobiliario a medida y elementos complementarios instalados por LINENCE SpA.</p>

        <p><strong>TERCERA: RECOMENDACIONES GENERALES DE USO.</strong> El mobiliario ha sido diseñado para un uso residencial o comercial normal, según el proyecto contratado. Para preservar su correcto funcionamiento se recomienda: abrir y cerrar puertas y cajones de forma suave, evitando golpes bruscos; no utilizar cajones, puertas o repisas como apoyo para subir personas o soportar cargas distintas a las previstas; evitar impactos con objetos contundentes; no colgar elementos pesados en puertas o cajones; no arrastrar objetos sobre las superficies del mobiliario; y evitar que niños jueguen sobre el mobiliario o utilicen cajones abiertos como escalones.</p>

        <p><strong>CUARTA: LIMPIEZA DEL MOBILIARIO.</strong> Para la limpieza habitual se recomienda utilizar un paño de microfibra o un paño suave ligeramente humedecido, secar inmediatamente cualquier exceso de humedad y utilizar únicamente detergentes neutros o productos de limpieza no abrasivos. No utilizar: virutillas, esponjas metálicas, lijas, cloro concentrado, amoniaco, acetona, solventes industriales, limpiadores en polvo ni productos corrosivos, ya que pueden deteriorar las superficies, afectar las terminaciones y disminuir la vida útil del mobiliario.</p>

        <p><strong>QUINTA: HUMEDAD Y TEMPERATURA.</strong> La madera industrializada y los tableros melamínicos son sensibles a la exposición prolongada a la humedad. Se recomienda secar inmediatamente cualquier derrame de líquidos, no permitir acumulación de agua sobre cubiertas, uniones o cantos, mantener los espacios correctamente ventilados, evitar condensación permanente y reparar oportunamente filtraciones provenientes de techos, muros o instalaciones sanitarias. La exposición continua a humedad excesiva puede producir deformaciones, hinchamiento de tableros, desprendimiento de cantos y deterioro de las terminaciones.</p>

        <p><strong>SEXTA: EXPOSICIÓN AL SOL.</strong> La exposición permanente y directa a la radiación solar puede generar alteraciones naturales en el color, brillo o acabado de determinados materiales. Cuando sea posible, se recomienda utilizar cortinas, persianas o filtros solares. Estas alteraciones corresponden al envejecimiento natural de los materiales y no constituyen un defecto de fabricación.</p>

        <p><strong>SÉPTIMA: BISAGRAS, CORREDERAS Y HERRAJES.</strong> Los sistemas de apertura utilizados por LINENCE SpA. son componentes de precisión. Para prolongar su vida útil: no forzar la apertura más allá del recorrido normal, evitar cierres bruscos, no utilizar puertas o cajones para soportar peso adicional y mantener libres de suciedad las correderas y bisagras. Si se detecta un funcionamiento irregular, se recomienda contactar a LINENCE SpA. antes de intervenir el mecanismo.</p>

        <p><strong>OCTAVA: CARGAS RECOMENDADAS.</strong> Para evitar deformaciones estructurales: distribuir uniformemente el peso sobre repisas y cajones, evitar concentrar cargas excesivas en un solo punto y no sobrepasar la capacidad prevista para cada módulo. Cuando existan muebles destinados a soportar equipos específicos, deberán utilizarse únicamente para dicho propósito.</p>

        <p><strong>NOVENA: ELECTRODOMÉSTICOS Y OTROS ELEMENTOS.</strong> Los electrodomésticos, griferías, lavaplatos, sistemas de iluminación, cubiertas y demás elementos suministrados por terceros deberán utilizarse conforme a las instrucciones entregadas por sus respectivos fabricantes. LINENCE SpA. no es responsable por fallas originadas en dichos productos.</p>

        <p><strong>DÉCIMA: MANTENIMIENTO PREVENTIVO.</strong> Se recomienda efectuar una revisión visual del mobiliario cada seis meses, verificando: nivelación general, correcto cierre de puertas, funcionamiento de cajones, estado de bisagras, estado de correderas, estado de fijaciones visibles y condición de sellos y siliconas, cuando existan. La detección temprana de anomalías contribuye a prolongar la vida útil del proyecto.</p>

        <p><strong>DÉCIMA PRIMERA: RECOMENDACIONES PARA COCINA.</strong> En muebles de cocina se recomienda especialmente: utilizar siempre campana extractora durante la cocción, evitar exposición prolongada al vapor, no apoyar ollas o recipientes calientes directamente sobre superficies no diseñadas para altas temperaturas, limpiar inmediatamente aceites y grasas, y revisar periódicamente posibles filtraciones bajo el lavaplatos.</p>

        <p><strong>DÉCIMA SEGUNDA: RECOMENDACIONES PARA BAÑO.</strong> En mobiliario de baño se recomienda: mantener una adecuada ventilación del recinto, secar las superficies luego de una exposición prolongada al agua, evitar que el agua permanezca acumulada sobre cubiertas o muebles, y revisar periódicamente el estado de sifones, llaves y conexiones sanitarias.</p>

        <p><strong>DÉCIMA TERCERA: INTERVENCIONES.</strong> No se recomienda perforar, desmontar, modificar o trasladar el mobiliario sin autorización de LINENCE SpA. Toda intervención realizada por terceros podrá afectar la estabilidad del proyecto y dejar sin efecto la cobertura establecida en el Certificado de Garantía respecto de los elementos intervenidos.</p>

        <p><strong>DÉCIMA CUARTA: SERVICIO POSVENTA.</strong> Ante cualquier consulta relacionada con el funcionamiento del mobiliario, el cliente podrá contactar a LINENCE SpA. a través de sus canales oficiales. Cuando corresponda, la empresa podrá coordinar una visita técnica para evaluar el requerimiento y determinar la solución más adecuada.</p>

        <p><strong>DÉCIMA QUINTA: DECLARACIÓN DEL CLIENTE.</strong> El cliente declara haber recibido el presente Manual de Uso y Mantención y manifiesta comprender la importancia de seguir las recomendaciones aquí contenidas para preservar las condiciones óptimas del mobiliario instalado.</p>

        ${tablaDatosProyecto(p)}
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// CG — Certificado de Garantía Comercial
// ============================================================
function generarCertificadoGarantia(p) {
  const cot = p.cotizacion || {};
  const codigo = codigoDocumento('CG', p);
  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Certificado de Garantía Comercial', codigo)}
      <div class="hoja-cuerpo">
        <h2>Certificado de Garantía Comercial</h2>
        <p class="hoja-subtitulo">Fabricación e Instalación de Mobiliario</p>

        <p>Con fecha ${formatearFechaLarga(cot.fechaInstalacion)}, en la ciudad de Rancagua-Chile, se presenta el siguiente Certificado de Garantía Comercial siguiendo las políticas internas de LINENCE SpA.</p>

        <p><strong>PRIMERA: OBJETIVO.</strong> El presente Certificado de Garantía Comercial tiene por objeto establecer las condiciones bajo las cuales LINENCE SpA otorga garantía respecto de los muebles fabricados e instalados por la empresa, definiendo su alcance, cobertura, exclusiones, procedimiento de atención y demás condiciones aplicables. Este documento constituye una garantía comercial voluntaria, independiente del Contrato de Venta o Prestación de Servicios suscrito entre las partes, y regula exclusivamente las obligaciones asumidas por LINENCE en materia de postventa. Su emisión tiene por finalidad otorgar seguridad al cliente respecto de la calidad del trabajo ejecutado y establecer un procedimiento transparente para la atención de eventuales incidencias derivadas de defectos de fabricación o instalación.</p>

        <p><strong>SEGUNDA: DEFINICIONES.</strong> <strong>Empresa:</strong> LINENCE SpA. <strong>Cliente:</strong> Persona natural o jurídica que contrata la fabricación e instalación del proyecto. <strong>Proyecto:</strong> Conjunto de muebles, accesorios y elementos fabricados e instalados por LINENCE conforme al contrato, presupuesto o cotización aceptada. <strong>Defecto de Fabricación:</strong> Falla originada durante el proceso de fabricación que afecte la funcionalidad, resistencia o terminación del mobiliario. <strong>Defecto de Instalación:</strong> Falla atribuible exclusivamente a la ejecución de la instalación realizada por personal autorizado de LINENCE SpA. <strong>Garantía Comercial:</strong> Compromiso voluntario asumido por LINENCE SpA para reparar o reemplazar los elementos cubiertos por este documento, en las condiciones aquí establecidas.</p>

        <p><strong>TERCERA: VIGENCIA DE LA GARANTÍA.</strong> LINENCE SpA otorga una Garantía Comercial de seis (6) meses, contados desde la fecha de entrega e instalación conforme del proyecto. La garantía será válida únicamente respecto del cliente que figure en el contrato o documento tributario correspondiente y no será transferible a terceros, salvo autorización expresa y por escrito de LINENCE. La presente garantía es complementaria a los derechos que pudieren corresponder al consumidor conforme a la legislación chilena vigente y, en ningún caso, limita, restringe o sustituye aquellos derechos de carácter irrenunciable.</p>

        <p><strong>CUARTA: ALCANCE DE LA GARANTÍA.</strong> La garantía comprenderá exclusivamente defectos atribuibles a la fabricación o instalación ejecutadas por LINENCE SpA. Entre otros, se considerarán cubiertos: defectos estructurales derivados del proceso de fabricación; desprendimiento de cantos por falla de fabricación; defectos en uniones y ensambles estructurales; desajuste de puertas, cajones o frentes provocado por errores de instalación; fallas en bisagras, correderas, sistemas de apertura o cierre cuya causa sea imputable a la fabricación o instalación; corrección de nivelaciones y alineaciones originadas por una instalación deficiente; y defectos de terminación ocasionados durante el proceso productivo. Verificada la procedencia de la garantía, LINENCE SpA podrá, según corresponda: a) reparar el elemento afectado; b) reemplazar la pieza defectuosa; o c) aplicar la solución técnica que resulte más adecuada. La determinación de la solución corresponderá exclusivamente al criterio técnico de LINENCE SpA.</p>

        <p><strong>QUINTA: EXCLUSIONES DE LA GARANTÍA.</strong> La presente garantía no cubrirá daños o desperfectos ocasionados por: golpes, impactos o accidentes; rayaduras, cortes o perforaciones; uso distinto al previsto para el mobiliario; sobrecarga de peso superior a la capacidad estructural del mueble; humedad excesiva, condensación, filtraciones o inundaciones; incendios, sismos, temporales, fenómenos naturales u otros casos fortuitos o de fuerza mayor; manipulación, desmontaje, traslado o reparación realizada por terceros no autorizados por LINENCE; modificaciones efectuadas por el cliente posteriores a la instalación; instalación de accesorios adicionales no contemplados en el proyecto original; utilización de productos químicos agresivos o elementos abrasivos; exposición permanente y directa a radiación solar; y desgaste normal derivado del uso cotidiano. Asimismo, quedan excluidos de esta garantía los productos suministrados por terceros, tales como: electrodomésticos, lavaplatos, encimeras, hornos, campanas, griferías, artefactos sanitarios, cubiertas de piedra natural, cuarzo, porcelánico u otros materiales similares, sistemas de iluminación y accesorios o componentes de marcas externas. En estos casos será aplicable únicamente la garantía otorgada por el fabricante o proveedor correspondiente.</p>

        <p><strong>SEXTA: OBLIGACIONES DEL CLIENTE.</strong> Para mantener vigente la presente garantía, el cliente deberá: utilizar el mobiliario conforme a su finalidad; mantener condiciones adecuadas de humedad, ventilación y temperatura; limpiar las superficies utilizando únicamente paños suaves y productos de limpieza neutros; evitar el contacto prolongado con agua sobre tableros, cantos y uniones; no efectuar modificaciones sin autorización escrita de LINENCE SpA; y permitir la inspección técnica cuando ésta sea requerida para evaluar una solicitud de garantía. El incumplimiento de estas obligaciones podrá dar lugar a la improcedencia de la garantía.</p>

        <p><strong>SÉPTIMA: PROCEDIMIENTO PARA HACER EFECTIVA LA GARANTÍA.</strong> Toda solicitud deberá realizarse por medio de los canales oficiales de atención de LINENCE SpA. El cliente deberá proporcionar, a lo menos: nombre completo, número de contrato, presupuesto o cotización, dirección del proyecto, descripción detallada del inconveniente y registro fotográfico del defecto observado. Una vez recibida la solicitud, LINENCE SpA acusará recepción y coordinará la evaluación técnica correspondiente.</p>

        <p><strong>OCTAVA: INSPECCIÓN TÉCNICA.</strong> LINENCE SpA podrá efectuar una inspección técnica presencial o remota con el objeto de determinar el origen del desperfecto informado. La procedencia o improcedencia de la garantía será determinada exclusivamente sobre la base del informe emitido por el área técnica de la empresa. La negativa injustificada del cliente a permitir dicha inspección impedirá establecer la causa del desperfecto y podrá dar lugar al rechazo de la solicitud de garantía.</p>

        <p><strong>NOVENA: REPARACIÓN O REEMPLAZO.</strong> Cuando la garantía resulte procedente, LINENCE SpA ejecutará la reparación o reemplazo dentro de un plazo razonable, considerando la complejidad del trabajo, disponibilidad de materiales, fabricación de piezas y programación de instalaciones. Las reparaciones efectuadas bajo garantía no extenderán ni renovarán el plazo original de vigencia.</p>

        <p><strong>DÉCIMA: LIMITACIÓN DE RESPONSABILIDAD.</strong> La responsabilidad de LINENCE SpA se limitará exclusivamente a la reparación, ajuste o reemplazo de los elementos cubiertos por la presente garantía. En ningún caso la empresa responderá por daños indirectos, lucro cesante, pérdida de uso, perjuicios comerciales, daños ocasionados a bienes distintos del mobiliario ni cualquier otra consecuencia derivada de hechos ajenos a su responsabilidad.</p>

        <p><strong>DÉCIMA PRIMERA: LEGISLACIÓN APLICABLE.</strong> El presente Certificado de Garantía se regirá por las leyes de la República de Chile, especialmente por las disposiciones contenidas en el Código Civil, la Ley N.º 19.496 sobre Protección de los Derechos de los Consumidores y las demás normas legales que resulten aplicables. Si alguna disposición de este documento fuere declarada contraria a normas legales de carácter imperativo, dicha circunstancia no afectará la validez de las restantes cláusulas, las cuales continuarán plenamente vigentes.</p>

        <p><strong>DÉCIMA SEGUNDA: ACEPTACIÓN.</strong> Con su firma, el cliente declara: haber recibido el proyecto conforme a lo contratado; haber inspeccionado visualmente el mobiliario instalado; haber recibido las recomendaciones básicas de uso y mantención; y haber leído, comprendido y aceptado íntegramente las condiciones del presente Certificado de Garantía.</p>

        ${tablaDatosProyecto(p)}

        <p><strong>RECEPCIÓN — Cliente:</strong></p>
        <p>Nombre: ____________________&nbsp;&nbsp;&nbsp; Firma: ____________________&nbsp;&nbsp;&nbsp; Fecha: ____________________</p>
        <p><strong>LINENCE SpA:</strong></p>
        <p>Representante: María Carrero Peralta&nbsp;&nbsp;&nbsp; Cargo: Gerente General</p>
        <p>Firma: ____________________&nbsp;&nbsp;&nbsp; Fecha: ____________________</p>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// ER — Acta de Entrega y Recepción Conforme
// ============================================================
function generarActaEntrega(p) {
  const cot = p.cotizacion || {};
  const codigo = codigoDocumento('ER', p);
  const numeroCotizacion = cot.numero || codigoDocumento('COT', p);

  const checklist = (items) => items.map(i => `<li>☐ ${i}</li>`).join('');

  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Acta de Entrega y Recepción Conforme', codigo)}
      <div class="hoja-cuerpo">
        <h2>Acta de Entrega y Recepción Conforme</h2>
        <p class="hoja-subtitulo">Proyecto de Fabricación e Instalación de Mobiliario</p>

        <p><strong>PRIMERA</strong>: <u>OBJETO</u>. La presente acta tiene por objeto dejar constancia de la entrega formal del proyecto ejecutado por LINENCE SpA, acreditando que el cliente recibió el mobiliario fabricado e instalado conforme a las condiciones pactadas, luego de efectuar la inspección correspondiente. Asimismo, este documento registra las observaciones efectuadas durante la entrega, los compromisos asumidos por las partes, cuando corresponda, y la conformidad final del cliente. La presente Acta forma parte del expediente oficial del proyecto y complementa el Contrato de Venta e Instalación, el Certificado de Garantía Comercial, el Manual de Uso y Mantención y Descripción de la Cotización.</p>

        <p><strong>SEGUNDA</strong>: <u>IDENTIFICACIÓN DEL PROYECTO.</u></p>
        <p>
          Código del Proyecto: ${p.codigo || '—'}<br>
          Cliente: ${tituloCase(p.cliente)}<br>
          RUT: ${formatearRutVisible(p.rut)}<br>
          Proyecto: ${p.tipoProyecto || '—'}<br>
          Dirección de Instalación: ${formatearDireccionSimple(p.direccion)}<br>
          Contrato / Cotización: ${numeroCotizacion}<br>
          Fecha de Instalación: ${formatearFechaLarga(cot.fechaInstalacion)}<br>
          Hora de Inicio: ${cot.horaInicio || '____'} Hrs&nbsp;&nbsp;&nbsp; Hora de Término: ${cot.horaTermino || '____'} Hrs
        </p>

        <p><strong>TERCERA</strong>: <u>PERSONAL RESPONSABLE.</u></p>
        <p><strong>Por LINENCE SpA:</strong><br>
        Jefe de Proyecto: María Carrero Peralta.<br>
        Instalador Responsable: ${cot.instalador || '____________________'}.</p>
        <p><strong>Por el Cliente:</strong><br>
        Persona que recibe el proyecto: ${tituloCase(p.cliente)}<br>
        Relación con el Cliente (si aplica): ____________________</p>

        <p><strong>CUARTA:</strong> <u>VERIFICACIÓN DEL PROYECTO</u>. Se deja constancia de que el cliente realizó una inspección visual y funcional del proyecto junto al representante de LINENCE.</p>
        <p><strong>Control de Verificación</strong></p>
        <ul>${checklist(['Dimensiones conforme al proyecto.', 'Nivelación del mobiliario.', 'Correcta fijación de módulos.', 'Funcionamiento de puertas.', 'Funcionamiento de cajones.', 'Regulación de bisagras.', 'Funcionamiento de correderas.', 'Terminaciones revisadas.', 'Cantos inspeccionados.', 'Cubiertas instaladas correctamente.', 'Sellos y siliconas revisados.', 'Limpieza final realizada.', 'Área de trabajo entregada en condiciones adecuadas.'])}</ul>

        <p><strong>QUINTA:</strong> <u>ELEMENTOS ENTREGADOS.</u> Se deja constancia de la entrega de los siguientes elementos:</p>
        <ul>${checklist(['Llaves.', 'Controles remotos.', 'Accesorios adicionales.', 'Repuestos (si aplica).', 'Otros: ____________________'])}</ul>

        <p><strong>SEXTA:</strong> <u>DOCUMENTACIÓN ENTREGADA.</u> El cliente declara haber recibido los siguientes documentos:</p>
        <ul>${checklist(['Contrato de Venta e Instalación.', 'Descripción de Fabricación e Instalación de Mobiliario.', 'Certificado de Garantía Comercial.', 'Manual de Uso y Mantención.', 'Acta de Entrega y Recepción Conforme.'])}</ul>

        <p><strong>SÉPTIMA:</strong> <u>OBSERVACIONES.</u> ${cot.observaciones ? cot.observaciones : '☐ Se deja constancia de que el proyecto fue recibido sin observaciones.'}</p>

        <p><strong>OCTAVA:</strong> <u>COMPROMISOS PENDIENTES (SI APLICA).</u> ☐ No existen trabajos pendientes al momento de la entrega.</p>

        <p><strong>NOVENA:</strong> <u>DECLARACIÓN DE RECEPCIÓN CONFORME.</u> El Cliente declara que: recibió el proyecto objeto del contrato; realizó una inspección visual y funcional del mobiliario instalado; recibió las explicaciones necesarias respecto del uso y mantención del proyecto; recibió la documentación indicada en esta acta; y conoce el procedimiento para solicitar servicio postventa y hacer efectiva la Garantía Comercial cuando corresponda. La firma de esta Acta acredita la recepción del proyecto en el estado observado al momento de la entrega, sin perjuicio de los derechos que la legislación chilena reconoce al consumidor respecto de defectos que puedan manifestarse con posterioridad.</p>

        <p><strong>DÉCIMA</strong>: <u>REGISTRO FOTOGRÁFICO.</u> Se deja constancia de que LINENCE SpA podrá incorporar al expediente técnico fotografías del proyecto terminado como respaldo de la entrega, respetando la confidencialidad del cliente. Autorización para uso de imágenes con fines corporativos: ☐ Sí autorizo. ☐ No autorizo.</p>

        <p><strong>DÉCIMA PRIMERA:</strong> <u>LEGISLACIÓN APLICABLE.</u> La presente Acta se regirá por las leyes de la República de Chile, especialmente por las disposiciones del Código Civil, la Ley N.º 19.496 sobre Protección de los Derechos de los Consumidores y las demás normas legales que resulten aplicables.</p>

        <p><strong>DÉCIMA SEGUNDA:</strong> <u>FIRMAS.</u> Con su firma, las partes declaran que la información contenida en la presente Acta es fiel expresión de lo ocurrido durante la entrega del proyecto.</p>

        <p><strong>CLIENTE</strong></p>
        <p>Nombre: ____________________&nbsp;&nbsp;&nbsp; RUT: ____________________<br>
        Firma: ____________________&nbsp;&nbsp;&nbsp; Fecha: ____________________</p>

        <p><strong>POR LINENCE SpA</strong></p>
        <p>Representante: María Carrero Peralta&nbsp;&nbsp;&nbsp; Cargo: Gerente General<br>
        Firma: ____________________&nbsp;&nbsp;&nbsp; Fecha: ____________________</p>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// CR — Comprobante de Recepción de Abono
// ============================================================
function generarComprobanteAbono(p) {
  const cot = p.cotizacion || {};
  const codigo = codigoDocumento('CR', p);
  const numeroCotizacion = cot.numero || codigoDocumento('COT', p);

  return `
    <div class="hoja-documento">
      ${encabezadoHoja('Recepción de Abono', codigo)}
      <div class="hoja-cuerpo">
        <h2>Comprobante de Recepción de Abono</h2>
        <p class="hoja-subtitulo">${p.tipoProyecto || 'Fabricación a medida'}</p>

        <p>Con fecha ${formatearFechaLarga(cot.fechaPago)}, en la ciudad de Rancagua-Chile, se presenta el siguiente comprobante de recepción de abono, siguiendo las políticas internas de LINENCE SpA.</p>

        <p><strong>I. INFORMACIÓN DEL DOCUMENTO</strong><br>Código del Proyecto: ${p.codigo || '—'}</p>

        <p><strong>II. DATOS DEL CLIENTE</strong><br>
        Nombre o Razón Social: ${tituloCase(p.cliente)}<br>
        Rut: ${formatearRutVisible(p.rut)}<br>
        Dirección: ${formatearDireccionSimple(p.direccion)}<br>
        Teléfono: ${p.telefono || '—'}<br>
        Correo: ${(p.email || '').toLowerCase() || '—'}</p>

        <p><strong>III. INFORMACIÓN DEL PROYECTO</strong><br>
        Nombre del Proyecto: ${p.tipoProyecto || '—'}<br>
        Dirección de Instalación: ${formatearDireccionSimple(p.direccion)}<br>
        N° de Cotización: ${numeroCotizacion}</p>

        <p><strong>IV. DETALLE DEL ABONO RECIBIDO</strong><br>
        Monto abonado: ${formatearCLP(cot.abonoMonto)}<br>
        Porcentaje de Abono Recibido: ${cot.abonoPorcentaje ?? 60}%<br>
        Monto Total del Proyecto: ${formatearCLP(cot.total)}</p>

        <p><strong>V. MEDIO DE PAGO</strong><br>
        Medio: ${cot.medioPago || '____________________'}<br>
        Banco: ${cot.banco || '____________________'}<br>
        Fecha del Pago: ${formatearFechaLarga(cot.fechaPago)}</p>

        <p><strong>Los pagos fueron realizados a la siguiente cuenta de:</strong><br>
        MARIA LOURDES CARRERO<br>26.429.618-8<br>Banco Bci<br>Cuenta Corriente<br>95178252</p>

        <p><strong>VI. DESTINO DEL ABONO</strong><br>
        El monto recibido será imputado al proyecto indicado en este comprobante. Este documento acredita la recepción administrativa del abono y no reemplaza la boleta o factura que corresponda emitir conforme a la legislación tributaria chilena.</p>

        <p><strong>VII. OBSERVACIONES</strong><br>${cot.observaciones || 'Sin observaciones.'}</p>

        <p><strong>VIII. DECLARACIÓN</strong><br>
        LINENCE SpA deja constancia de haber recibido el monto indicado, el cual será imputado al proyecto señalado. El saldo pendiente deberá pagarse conforme al contrato o cotización aceptada.</p>

        <p><strong>IX. FIRMA</strong><br>
        Linence SpA<br>Representante: María Lourdes Carrero Peralta<br>Cargo: Gerente General<br>Firma: María Carrero</p>
      </div>
      ${pieHoja()}
    </div>
  `;
}

// ============================================================
// TP — Tarjeta de Servicio Postventa
// ============================================================
function generarTarjetaPostventa() {
  return `
    <div class="hoja-documento" style="min-height:auto; align-items:center; justify-content:center; padding:60px 30px; gap:30px; flex-direction:row; flex-wrap:wrap;">
      <div style="border:2px solid var(--gold); border-radius:6px; padding:30px 26px; width:280px; text-align:center;">
        <img src="assets/img/logo-wordmark-oscuro.png" onerror="this.src='assets/img/logo-wordmark-claro.png'; this.style.background='var(--ink)'; this.style.padding='6px'" alt="Linence" style="height:36px; margin-bottom:16px;">
        <div style="font-size:16px; font-weight:700; color:var(--ink);">SERVICIO POSTVENTA</div>
        <div style="font-size:13px; color:var(--gold); font-style:italic; margin-top:6px;">Siempre cerca de usted</div>
      </div>
      <div style="border:2px solid var(--gold); border-radius:6px; padding:30px 26px; width:280px; text-align:center;">
        <img src="assets/img/logo-wordmark-oscuro.png" onerror="this.src='assets/img/logo-wordmark-claro.png'; this.style.background='var(--ink)'; this.style.padding='6px'" alt="Linence" style="height:44px; margin-bottom:6px;">
        <div style="font-size:10px; letter-spacing:0.12em; opacity:0.6; margin-top:8px;">FÁBRICA DE MUEBLES MODERNOS</div>
      </div>
    </div>
  `;
}

// ============================================================
// EG — Tarjeta de Evaluación en Google
// ============================================================
function generarTarjetaEvaluacionGoogle(p) {
  // TODO: reemplazar por el link real de reseñas de Google de Linence.
  const linkResena = 'https://g.page/r/REEMPLAZAR-CON-TU-LINK/review';
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(linkResena)}`;

  return `
    <div class="hoja-documento" style="min-height:auto; align-items:center; justify-content:center; padding:50px 30px; gap:24px; flex-direction:row; flex-wrap:wrap;">
      <div style="border:2px solid var(--gold); border-radius:6px; padding:26px; width:300px;">
        <div style="font-weight:700; font-size:14px; color:var(--ink); margin-bottom:10px;">TU OPINIÓN ES PARTE DE NUESTRA ESENCIA</div>
        <p style="font-size:12px;">Gracias por confiar en <strong>LINENCE.</strong> Queremos conocer tu experiencia y seguir entregando una atención de excelencia.</p>
        <img src="${qr}" alt="QR reseña Google" style="display:block; margin:10px auto;">
        <div style="text-align:center; font-size:12px;"><span style="color:var(--gold); font-weight:700;">EVALÚANOS</span> EN <span style="color:var(--gold); font-weight:700;">GOOGLE</span></div>
        <div style="text-align:center; color:var(--gold); font-size:16px; letter-spacing:3px;">★★★★★</div>
        <p style="text-align:center; font-size:11px; opacity:0.75;">Tu reseña nos ayuda a crecer y a llegar a más personas</p>
      </div>
      <div style="border:2px solid var(--gold); border-radius:6px; padding:26px; width:300px;">
        <div style="font-weight:700; font-size:14px; color:var(--ink); margin-bottom:10px;">SERVICIO POSTVENTA</div>
        <p style="font-size:12px;">Nuestro compromiso continúa después de la entrega.</p>
        <p style="font-size:12px;"><strong style="color:var(--gold);">WhatsApp</strong><br>+56 9 5703 9988</p>
        <p style="font-size:12px;"><strong style="color:var(--gold);">Correo electrónico</strong><br>contacto@linence.cl</p>
        <p style="font-size:12px;"><strong style="color:var(--gold);">Sitio web</strong><br>www.linence.cl</p>
        <p style="font-size:12px;"><strong style="color:var(--gold);">Código de Proyecto</strong><br>${p.codigo || '—'}</p>
      </div>
    </div>
  `;
}

// ============================================================
// Tabla de datos del proyecto, reutilizada al pie de MU y CG
// ============================================================
function tablaDatosProyecto(p) {
  const cot = p.cotizacion || {};
  const numeroCotizacion = cot.numero || codigoDocumento('COT', p);
  return `
    <p><strong>DATOS DEL PROYECTO:</strong></p>
    <p>
      Cliente: ${tituloCase(p.cliente)}<br>
      RUT: ${formatearRutVisible(p.rut)}<br>
      Proyecto: ${p.tipoProyecto || '—'}<br>
      Dirección: ${formatearDireccionSimple(p.direccion)}<br>
      Cotización N°: ${numeroCotizacion}<br>
      Fecha de Entrega e Instalación: ${formatearFechaLarga(cot.fechaInstalacion)}<br>
      Vigencia de la Garantía hasta: ${fechaGarantiaHasta(cot.fechaInstalacion)}
    </p>
  `;
}

// Exportadas por si más adelante se quieren usar helpers desde otro documento.
export { formatearFechaLarga, fechaGarantiaHasta, formatearDireccionSimple, formatearCLP, codigoDocumento, tituloCase };

// ============================================================
// Modal de vista previa / descarga / impresión
// ============================================================
const modalDocumento = document.getElementById('modalDocumento');

function abrirModalDocumento(html, nombreArchivoBase) {
  document.getElementById('hojaDocumentoImprimir').innerHTML = html;
  document.getElementById('hojaDocumentoImprimir').dataset.archivo = nombreArchivoBase;
  modalDocumento.classList.add('open');
}
function cerrarModalDocumento() {
  modalDocumento.classList.remove('open');
}
document.getElementById('btnCerrarModalDoc').addEventListener('click', cerrarModalDocumento);
modalDocumento.addEventListener('click', (e) => { if (e.target === modalDocumento) cerrarModalDocumento(); });

document.getElementById('btnImprimirDoc').addEventListener('click', () => {
  window.print();
});

document.getElementById('btnDescargarDoc').addEventListener('click', () => {
  const contenedor = document.getElementById('hojaDocumentoImprimir');
  const hoja = contenedor.querySelector('.hoja-documento');
  const nombreArchivo = (contenedor.dataset.archivo || 'documento') + '.pdf';
  if (!hoja || !window.html2pdf) {
    mostrarToast('No se pudo generar el PDF. Intenta de nuevo.', 'error');
    return;
  }
  window.html2pdf().set({
    margin: 0,
    filename: nombreArchivo,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(hoja).save();
});
