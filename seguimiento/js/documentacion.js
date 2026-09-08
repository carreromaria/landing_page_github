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
  document.getElementById('cotHoraInicio').value = cot.horaInicio || '';
  document.getElementById('cotHoraTermino').value = cot.horaTermino || '';
  document.getElementById('cotObservaciones').value = cot.observaciones || '';

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
    horaInicio: document.getElementById('cotHoraInicio').value,
    horaTermino: document.getElementById('cotHoraTermino').value,
    observaciones: document.getElementById('cotObservaciones').value.trim()
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
// Definición de documentos y grilla
// ============================================================
const DOCUMENTOS = [
  { sigla: 'PT',  nombre: 'Portada institucional', activo: false },
  { sigla: 'CB',  nombre: 'Carta de Bienvenida', activo: true, generar: generarCartaBienvenida },
  { sigla: 'COT', nombre: 'Cotización', activo: false, requiereCotizacion: true },
  { sigla: 'DC',  nombre: 'Descripción de la Cotización', activo: false, requiereCotizacion: true },
  { sigla: 'CV',  nombre: 'Contrato de Venta e Instalación', activo: false, requiereCotizacion: true },
  { sigla: 'MU',  nombre: 'Manual de Uso y Mantención', activo: false },
  { sigla: 'CG',  nombre: 'Certificado de Garantía Comercial', activo: false },
  { sigla: 'ER',  nombre: 'Acta de Entrega y Recepción Conforme', activo: false },
  { sigla: 'CR',  nombre: 'Comprobante de Recepción de Abono', activo: false, requiereCotizacion: true },
  { sigla: 'TP',  nombre: 'Tarjeta de Servicio Postventa', activo: false },
  { sigla: 'EG',  nombre: 'Tarjeta de Evaluación en Google', activo: false }
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
