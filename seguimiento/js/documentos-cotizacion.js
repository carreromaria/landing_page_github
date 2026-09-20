// ============================================================
// LINENCE — Documentos oficiales de Cotización (fuente única)
// ============================================================
// Aquí vive, UNA sola vez, el diseño del documento "Cotización" (COT)
// y del documento "Descripción de Cotización" (DC). Lo importan:
//   - cotizaciones.js  (módulo Cotizaciones)
//   - documentacion.js (módulo Documentación)
// así los dos módulos generan exactamente el mismo documento y, si
// algún día se cambia el diseño, se cambia solo acá (y en
// css/pdf-documentos.css, que trae los estilos y las reglas de impresión).
//
// Las funciones htmlCotizacion / htmlDescripcion devuelven el HTML
// INTERNO de un contenedor con clase "pdf-doc"; quien las use pone
// ese contenedor (<div class="pdf-doc">…</div>).
//
// Parámetros comunes:
//   cotizacion → documento de la colección "cotizaciones" tal como está en Firestore
//   cliente    → { nombre, telefono, rut, direccion }  (el Lead; la dirección puede
//                ser el objeto estructurado del lead o un texto)

// ---------- Helpers de formato ----------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatearMoneda(numero) {
  return '$' + (numero || 0).toLocaleString('es-CL');
}

/** Formato corto DD-MM-AA. */
function formatearFechaCorta(fecha) {
  const d = String(fecha.getDate()).padStart(2, '0');
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const a = String(fecha.getFullYear()).slice(-2);
  return `${d}-${m}-${a}`;
}

/** Arma "02 al 04-10-26" a partir de dos fechas tipo input date (AAAA-MM-DD). */
function formatearRangoFechas(inicio, fin) {
  if (!inicio && !fin) return '—';
  const fechaInicio = inicio ? new Date(inicio + 'T00:00:00') : null;
  const fechaFin = fin ? new Date(fin + 'T00:00:00') : null;
  if (fechaInicio && fechaFin) {
    return `${String(fechaInicio.getDate()).padStart(2, '0')} al ${formatearFechaCorta(fechaFin)}`;
  }
  return formatearFechaCorta(fechaInicio || fechaFin);
}

/** Arma "Calle Número, Sector - Comuna" a partir del objeto dirección estructurado del lead. */
function formatearDireccion(direccion) {
  if (!direccion) return '—';
  if (typeof direccion === 'string') return direccion;
  const partes = [];
  if (direccion.calle || direccion.numero) {
    partes.push([direccion.calle, direccion.numero].filter(Boolean).join(' '));
  }
  const zona = [direccion.sector, direccion.comuna].filter(Boolean).join(' - ');
  if (zona) partes.push(zona);
  return partes.join(', ') || '—';
}

/** "CT-WSP-00002" -> "DC-WSP-00002" */
export function folioDescripcion(numeroCotizacion) {
  return String(numeroCotizacion || '').replace(/^[A-Z]+-/, 'DC-');
}

// ---------- Encabezado y pie (los usan todos los documentos oficiales) ----------

/** Encabezado negro/dorado + datos de la empresa, envueltos en un solo bloque "fijo" para imprimir. */
export function htmlEncabezado(titulo, folio) {
  return `
  <div class="pdf-encabezado-fijo">
  <div class="pdf-header">
    <div class="pdf-header-izq">
      <div class="pdf-header-titulo">${escapeHtml(String(titulo).toUpperCase())}</div>
      <span class="pdf-header-folio">${escapeHtml(folio)}</span>
    </div>
    <div class="pdf-header-logo">
      <span class="pdf-logo-lin">LIN</span><span class="pdf-logo-ence">ENCE</span>
      <div class="pdf-logo-tagline">LÍNEA &amp; ESENCIA</div>
    </div>
  </div>

  <div class="pdf-empresa">
    <div><strong>LINENCE SpA.</strong> &nbsp; RUT: 78.446.739-2</div>
    <div>DIRECCIÓN: Av. Salvador Allende #500</div>
    <div>CORREO ELECTRONICO: contacto@linence.cl</div>
  </div>
  </div>
`;
}

/** Pie dorado con los datos de contacto. Íconos con width/height como atributos HTML (ver pdf-documentos.css). */
export function htmlPie() {
  return `
  <div class="pdf-contacto">
    <div class="pdf-contacto-fila"><img src="assets/img/icono-web.png" width="21" height="16" alt=""> Linence.cl</div>
    <div class="pdf-contacto-fila"><img src="assets/img/iconos-redes.png" width="24" height="16" alt=""> Linence.cl</div>
    <div class="pdf-contacto-fila"><img src="assets/img/icono-whatsapp.png" width="16" height="16" alt=""> +569 57039988</div>
  </div>
`;
}

// ---------- COT — Cotización ----------

export function htmlCotizacion({ cotizacion, cliente = {} }) {
  const fecha = formatearFechaCorta(cotizacion.creadoEn?.toDate?.() || new Date());
  const validaDesde = cotizacion.validaDesde
    ? formatearFechaCorta(new Date(cotizacion.validaDesde + 'T00:00:00'))
    : '—';

  const filas = (cotizacion.items || []).map(item => `<tr>
      <td>${escapeHtml(item.codigo)}</td>
      <td>${escapeHtml(item.cantidad)} m</td>
      <td>${escapeHtml(item.descripcion)}</td>
      <td>${formatearMoneda(item.valorUnitario)}</td>
      <td>${formatearMoneda(item.total)}</td>
    </tr>`).join('');

  // Las filas SUB TOTAL e I.V.A. siempre están, pero solo llevan monto si la cotización aplica IVA.
  const subtotal = cotizacion.aplicaIva ? formatearMoneda(cotizacion.totalGeneral) : '';
  const iva = cotizacion.aplicaIva ? formatearMoneda(cotizacion.ivaMonto) : '';
  const total = cotizacion.aplicaIva ? cotizacion.totalConIva : cotizacion.totalGeneral;

  return `${htmlEncabezado('Cotización', cotizacion.numero)}

  <table class="pdf-tabla-info">
    <tr>
      <th>FECHA:</th>
      <th>PROYECTO:</th>
      <th>FECHA DE ENTREGA:</th>
    </tr>
    <tr>
      <td>${fecha}</td>
      <td>${escapeHtml(cotizacion.proyecto || '—')}</td>
      <td>${formatearRangoFechas(cotizacion.fechaEntregaInicio, cotizacion.fechaEntregaFin)}</td>
    </tr>
    <tr>
      <th>CLIENTE:</th>
      <th colspan="2">TELÉFONO:</th>
    </tr>
    <tr>
      <td>${escapeHtml(cliente.nombre || '—')}</td>
      <td colspan="2">${escapeHtml(cliente.telefono || '—')}</td>
    </tr>
    <tr>
      <th>DIRECCIÓN:</th>
      <th colspan="2">FORMA DE PAGO:</th>
    </tr>
    <tr>
      <td>${escapeHtml(formatearDireccion(cliente.direccion))}</td>
      <td colspan="2">${escapeHtml(cotizacion.formaPago || '—')}</td>
    </tr>
  </table>

  <table class="pdf-tabla-items">
    <thead>
      <tr>
        <th>CODIGO</th>
        <th>CANTIDAD</th>
        <th>DESCRIPCIÓN</th>
        <th>VALOR UNITARIO</th>
        <th>TOTAL</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <div class="pdf-pie">
    <div class="pdf-pie-notas">
      <p>Esta cotización de su proyecto es válida desde ${validaDesde}</p>
      <p>Cualquier duda o consulta comuníquese con nosotros, estaremos gustoso de atenderlo.</p>
      <p class="pdf-pie-gracias">GRACIAS POR SU PREFERENCIA…!!!</p>
    </div>
    <table class="pdf-tabla-totales">
      <tr><th>SUB TOTAL</th><td>${subtotal}</td></tr>
      <tr><th>I.V.A</th><td>${iva}</td></tr>
      <tr><th>TOTAL</th><td>${formatearMoneda(total)}</td></tr>
      <tr><th>Abono ${cotizacion.porcentajeAbono || 0}%</th><td>${formatearMoneda(cotizacion.abono)}</td></tr>
    </table>
  </div>
${htmlPie()}`;
}

// ---------- DC — Descripción de Cotización ----------

/**
 * Lista de una categoría del checklist: muestra TODAS las opciones activas
 * del catálogo y resalta en dorado las que están marcadas en la cotización.
 */
function filaChecklist(catalogo, categoria, seleccionIds = []) {
  const opciones = (catalogo || []).filter(o => o.categoria === categoria);
  if (!opciones.length) return '<div class="pdf-dc-item">Sin opciones registradas en el catálogo.</div>';
  return opciones.map(o => `
    <div class="pdf-dc-item ${seleccionIds.includes(o.id) ? 'incluido' : ''}">${escapeHtml(o.nombre)}</div>
  `).join('');
}

export function htmlDescripcion({ cotizacion, cliente = {}, catalogo = [] }) {
  const fecha = formatearFechaCorta(cotizacion.creadoEn?.toDate?.() || new Date());
  const seleccion = cotizacion.descripcionCotizacion || {};

  // El cuerpo va dentro de una tabla con thead/tfoot vacíos ("espaciadores"): al
  // imprimir, el navegador repite esos dos bloques en CADA hoja, dejando libre
  // el lugar del encabezado y el pie fijos. Sin esto, el relleno solo existía en
  // la primera y última hoja y el texto de las demás quedaba debajo del encabezado.
  // En pantalla los espaciadores no se ven (ver css/pdf-documentos.css).
  return `${htmlEncabezado('Descripción de cotización', folioDescripcion(cotizacion.numero))}

<table class="pdf-paginado">
<thead><tr><td><div class="pdf-espaciador pdf-espaciador-arriba"></div></td></tr></thead>
<tbody><tr><td>

  <p class="pdf-dc-heading">DESCRIPCIÓN DE FABRICACIÓN E INSTALACIÓN DE MOBILIARIO A MEDIDA</p>

  <p class="pdf-dc-intro">
    Con fecha ${fecha}, en la ciudad de Rancagua-Chile, se presenta la siguiente descripción de cotización de servicios entre: EL PRESTADOR: LINENCE SpA. Mobiliario a Medida, representada para estos efectos por doña Maria Carrero Peralta, RUT: 26.429.616-8, con domicilio comercial en Av. Salvador Allende #500, en adelante "LINENCE SpA". EL CLIENTE: ${escapeHtml(cliente.nombre || '—')}, RUT: ${escapeHtml(cliente.rut || '—')}, con domicilio en ${escapeHtml(formatearDireccion(cliente.direccion))}, en adelante "El Cliente". Ambas partes acuerdan la descripción de la cotización de forma voluntaria a continuación:
  </p>

  <div class="pdf-dc-seccion">
    <p class="pdf-dc-seccion-titulo">1. MATERIALES A UTILIZAR EN LA FABRICACIÓN DE ESTRUCTURA DE MUEBLES Y PUERTAS:</p>
    <p class="pdf-dc-nota">LINENCE SpA. se compromete a ejecutar los trabajos utilizando materiales de primera calidad, de acuerdo a los estándares mínimos de las marcas (Masisa/Arauco Vesto).</p>
    <div class="pdf-dc-lista">${filaChecklist(catalogo, 'materiales', seleccion.materiales)}</div>
  </div>

  <div class="pdf-dc-seccion">
    <p class="pdf-dc-seccion-titulo">2. HERRAJES A UTILIZAR:</p>
    <div class="pdf-dc-lista">${filaChecklist(catalogo, 'herrajes', seleccion.herrajes)}</div>
  </div>

  <div class="pdf-dc-seccion">
    <p class="pdf-dc-seccion-titulo">3. CUBIERTAS:</p>
    <div class="pdf-dc-lista">${filaChecklist(catalogo, 'cubiertas', seleccion.cubiertas)}</div>
  </div>

  <div class="pdf-dc-seccion" style="margin-bottom:18px;">
    <p class="pdf-dc-seccion-titulo">4. ACCESORIOS:</p>
    <div class="pdf-dc-lista">${filaChecklist(catalogo, 'accesorios', seleccion.accesorios)}</div>
  </div>

</td></tr></tbody>
<tfoot><tr><td><div class="pdf-espaciador pdf-espaciador-abajo"></div></td></tr></tfoot>
</table>

${htmlPie()}`;
}

// ---------- Impresión / "Guardar como PDF" ----------

/**
 * Mide la altura real del encabezado y el pie ya renderizados en la
 * plantilla dada y la deja en variables CSS, para que el relleno
 * reservado arriba/abajo (encabezado y pie "fijos" al imprimir) calce
 * exacto sin adivinar píxeles.
 * @param {HTMLElement} plantilla el contenedor .pdf-doc visible en pantalla
 */
export function prepararAlturasParaImprimir(plantilla) {
  if (!plantilla) return;
  const RESPIRO = 26; // aire extra para que el texto no quede pegado al encabezado/pie
  const encabezado = plantilla.querySelector('.pdf-encabezado-fijo');
  const pie = plantilla.querySelector('.pdf-contacto');
  const arriba = encabezado ? (encabezado.offsetHeight + RESPIRO) + 'px' : null;
  const abajo = pie ? (pie.offsetHeight + RESPIRO) + 'px' : null;

  // Documentos de varias hojas (con .pdf-paginado): el espacio se reserva en los
  // espaciadores que el navegador repite en cada hoja, y el relleno del documento va en 0.
  // Documentos de una hoja (Cotización): el relleno del documento alcanza.
  const paginado = !!plantilla.querySelector('.pdf-paginado');
  if (arriba) {
    plantilla.style.setProperty('--print-esp-top', paginado ? arriba : '0px');
    plantilla.style.setProperty('--print-pad-top', paginado ? '0px' : arriba);
  }
  if (abajo) {
    plantilla.style.setProperty('--print-esp-bottom', paginado ? abajo : '0px');
    plantilla.style.setProperty('--print-pad-bottom', paginado ? '0px' : abajo);
  }
}

/**
 * Imprime un documento .pdf-doc que está dentro de un modal propio de
 * la página (Documentación). En vez de imprimir "a través" del modal
 * (cuyo fondo, márgenes y bordes se colaban en el PDF), copia el
 * documento a una zona de impresión limpia, directamente en <body>,
 * y solo se imprime eso. Las reglas de css/pdf-documentos.css hacen el resto.
 * @param {HTMLElement} origen el .pdf-doc visible en pantalla
 */
export function imprimirDocumentoPdf(origen) {
  if (!origen) return;
  prepararAlturasParaImprimir(origen); // se mide con el original, que sí está visible

  let zona = document.getElementById('zonaImpresionPdf');
  if (!zona) {
    zona = document.createElement('div');
    zona.id = 'zonaImpresionPdf';
    document.body.appendChild(zona);
  }
  const copia = origen.cloneNode(true); // conserva las variables de altura medidas
  copia.removeAttribute('id');
  zona.innerHTML = '';
  zona.appendChild(copia);
  document.body.classList.add('imprimiendo-pdf-doc');

  const limpiar = () => {
    document.body.classList.remove('imprimiendo-pdf-doc');
    zona.innerHTML = '';
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  window.print();
}
