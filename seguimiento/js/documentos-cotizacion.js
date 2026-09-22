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
// FORMATO (igual a las plantillas Word): encabezado solo en la primera hoja,
// pie solo en la última (pegado al borde inferior), marca de agua en todas
// las hojas, y todo alineado al mismo margen lateral. Ver css/pdf-documentos.css.
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

/* Anchos de Poppins Regular (milésimas de em) para los caracteres 32..255.
   Sirven para calcular, sin depender de que la fuente ya esté cargada, si el
   título + código caben en el espacio junto al logo; si no caben, el tamaño
   baja de 16 pt hasta que calcen (los títulos largos, ej. "Acta de Entrega y
   Recepción Conforme"). */
const ANCHOS_POPPINS = [267,298,292,840,622,759,739,159,454,454,486,683,198,551,210,476,628,320,575,589,629,628,635,546,631,630,213,264,555,723,539,524,1013,674,613,772,707,513,504,778,692,246,530,599,432,861,703,786,579,788,608,587,541,675,676,976,621,584,541,423,658,423,629,733,257,676,676,607,676,620,329,676,640,246,248,515,246,1030,640,640,676,676,373,522,364,640,561,820,479,563,455,462,291,462,519,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,500,267,298,665,620,537,595,291,575,314,792,450,461,650,0,509,387,410,686,330,332,247,645,596,212,272,196,436,461,640,675,709,519,674,674,674,674,674,674,900,772,513,513,513,513,246,246,246,246,725,703,786,786,786,786,786,643,786,675,675,675,675,584,579,681,676,676,676,676,676,676,1097,607,620,620,620,620,246,246,246,246,638,640,640,640,640,640,640,657,640,640,640,640,640,563,676,563];

function anchoEnPulgadas(texto, pt) {
  let unidades = 0;
  for (const ch of String(texto)) {
    const c = ch.charCodeAt(0);
    unidades += (c >= 32 && c <= 255) ? ANCHOS_POPPINS[c - 32] : 700;
  }
  return unidades / 1000 * pt / 72;
}

/** Tamaño (pt) del título: 16 pt, o menos si título + código no caben junto al logo. */
function tamanoTituloEncabezado(titulo, folio) {
  const DISPONIBLE = 5.3; // pulgadas entre el margen izquierdo y el logo (con holgura para A4)
  const SEPARACION = 0.23;
  for (let pt = 16; pt > 10; pt -= 0.5) {
    if (anchoEnPulgadas(titulo, pt) + SEPARACION + anchoEnPulgadas(folio, pt) <= DISPONIBLE) return pt;
  }
  return 10;
}

/**
 * Encabezado de la primera hoja: franja negra/dorada, título + código,
 * datos de la empresa y logo. También incluye la marca de agua (que al
 * imprimir se repite en todas las hojas).
 */
export function htmlEncabezado(titulo, folio) {
  const t = String(titulo ?? '').toUpperCase();
  const f = String(folio ?? '');
  const pt = tamanoTituloEncabezado(t, f);
  return `
  <img class="ln-marca-agua" src="assets/img/marca-agua-linence.png" width="720" height="960" alt="">
  <div class="ln-encabezado">
    <svg class="ln-encabezado-fondo" viewBox="209550 0 7772400 1185641" preserveAspectRatio="none" aria-hidden="true">
      <rect x="114300" y="444500" width="7760598" height="741141" fill="#D6A52C"/>
      <polygon points="8216486,1179830 5825420,1179830 4498016,441280 0,441280 0,0 8216486,0" fill="#141213"/>
    </svg>
    <div class="ln-titulo-fila" style="font-size:${pt}pt">
      <span class="ln-titulo">${escapeHtml(t)}</span><span class="ln-codigo">${escapeHtml(f)}</span>
    </div>
    <div class="ln-datos-empresa">
      <div class="ln-fila-rut"><span>LINENCE SpA.</span><span>RUT: 78.446.739-2</span></div>
      <div>DIRECCIÓN: Av. Salvador Allende #500</div>
      <div>CORREO ELECTRÓNICO: contacto@linence.cl</div>
    </div>
    <img class="ln-logo" src="assets/img/logo-encabezado.png" width="162" height="95" alt="LINENCE">
  </div>
`;
}

/**
 * Pie de la última hoja: franja dorada/negra con los datos de contacto, y el
 * MISMO título y código del encabezado. El bloque .ln-espacio-pie lo usa JS
 * (prepararAlturasParaImprimir) para dejar el pie pegado al borde inferior.
 * @param {string} contenidoFijo HTML opcional que queda anclado justo ENCIMA
 *   del pie institucional (ej. el cuadro de notas y totales de la Cotización):
 *   se pega al fondo de la última hoja junto con el pie, no queda "suelto"
 *   más arriba. Debe tener class="pdf-pie" (o la que corresponda) para que
 *   prepararAlturasParaImprimir lo excluya del cuerpo normal y sume su alto
 *   al del pie al calcular el espacio.
 */
export function htmlPie(titulo = '', folio = '', contenidoFijo = '') {
  return `
  <div class="ln-espacio-pie"></div>
  ${contenidoFijo}
  <div class="ln-pie">
    <svg class="ln-pie-fondo" viewBox="221932 0 7772400 1644650" preserveAspectRatio="none" aria-hidden="true">
      <rect x="393700" y="355600" width="7760335" height="707390" fill="#141213"/>
      <polygon points="0,0 2391005,0 3718400,1000900 8216265,1000900 8216265,1644650 0,1644650" fill="#D6A52C"/>
    </svg>
    <img class="ln-pie-web" src="assets/img/pie-web.png" alt="">
    <img class="ln-pie-redes" src="assets/img/pie-redes.png" alt="">
    <img class="ln-pie-whatsapp" src="assets/img/pie-whatsapp.png" alt="">
    <span class="ln-pie-texto ln-pie-t1">Linence.cl</span>
    <span class="ln-pie-texto ln-pie-t2">Linence.cl</span>
    <span class="ln-pie-texto ln-pie-t3">+56 9 5703 9988</span>
    <span class="ln-pie-codigo">${escapeHtml(folio)}</span>
    <span class="ln-pie-titulo">${escapeHtml(String(titulo ?? '').toUpperCase())}</span>
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

  // El cuadro de notas + totales queda anclado al fondo de la última hoja,
  // pegado justo encima del pie institucional (ver htmlPie).
  const cuadroPie = `
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
  </div>`;

  return `${htmlEncabezado('Cotización', cotizacion.numero)}

  <table class="pdf-tabla-info">
    <tr>
      <th>PROYECTO:</th>
      <th>FECHA:</th>
      <th>FECHA DE ENTREGA:</th>
    </tr>
    <tr>
      <td>${escapeHtml(cotizacion.proyecto || '—')}</td>
      <td>${fecha}</td>
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
${htmlPie('Cotización', cotizacion.numero, cuadroPie)}`;
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

  // Encabezado solo en la primera hoja y pie solo en la última: el margen superior
  // e inferior de cada hoja lo da @page (ver css/pdf-documentos.css).
  const titulo = 'Descripción de cotización';
  const folio = folioDescripcion(cotizacion.numero);

  return `${htmlEncabezado(titulo, folio)}

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

${htmlPie(titulo, folio)}`;
}

// ---------- Impresión / "Guardar como PDF" ----------

const PX_POR_PULGADA = 96;
const ANCHO_HOJA_PX = 8.5 * PX_POR_PULGADA;        // Carta
const ALTO_HOJA_PX = 11 * PX_POR_PULGADA;
const MARGEN_VERTICAL_PX = 0.5 * PX_POR_PULGADA;   // margen de texto arriba y abajo de cada hoja
const ALTO_UTIL_PX = ALTO_HOJA_PX - 2 * MARGEN_VERTICAL_PX;
const ESPACIO_MINIMO_PIE_PX = 0;                   // separación mínima entre el texto y el pie
// pdf-pie: el cuadro de notas + totales de la Cotización, que también se ancla
// al fondo de la última hoja (ver htmlPie/htmlCotizacion), igual que el pie.
const NO_ES_CUERPO = ['ln-marca-agua', 'ln-encabezado', 'ln-espacio-pie', 'ln-pie', 'pdf-pie'];

/**
 * Deja el pie pegado al borde inferior de la ÚLTIMA hoja.
 *
 * El navegador no permite "alinear al fondo de la última hoja" solo con CSS,
 * así que se calcula: se arma, fuera de pantalla, una copia del cuerpo del
 * documento dentro de un contenedor con columnas del alto exacto del área de
 * texto de una hoja (el mismo motor de fragmentación que usa la impresión). La
 * posición donde termina el último texto dice cuánto espacio libre queda en la
 * última hoja, y ese espacio (menos el alto del pie) queda en la variable CSS
 * --ln-espacio-pie. Si el pie no cabe en esa hoja, se calcula para que caiga al
 * fondo de una hoja nueva.
 *
 * Debe llamarse con el documento VISIBLE en pantalla (así se puede medir), justo
 * antes de imprimir. Documentos sin encabezado/pie (portada, tarjetas) no se tocan.
 * @param {HTMLElement} plantilla el contenedor del documento (.pdf-doc o .hoja-documento)
 */
export function prepararAlturasParaImprimir(plantilla) {
  if (!plantilla) return;
  const encabezado = plantilla.querySelector('.ln-encabezado');
  const pie = plantilla.querySelector('.ln-pie');
  if (!encabezado || !pie) return;

  // Si existe (ej. Cotización), el cuadro de notas + totales se ancla al
  // fondo junto con el pie: cuenta como parte de lo reservado abajo.
  const bloqueFijo = plantilla.querySelector(':scope > .pdf-pie');
  const altoPie = pie.offsetHeight + (bloqueFijo ? bloqueFijo.offsetHeight : 0);
  const cuerpo = [...plantilla.children].filter(n => !NO_ES_CUERPO.some(c => n.classList.contains(c)));

  const sim = document.createElement('div');
  sim.className = 'ln-sim';
  sim.style.width = ANCHO_HOJA_PX + 'px';
  sim.style.height = ALTO_UTIL_PX + 'px';
  sim.style.columnWidth = ANCHO_HOJA_PX + 'px';

  const envoltorio = document.createElement('div');
  envoltorio.className = plantilla.className; // hereda los mismos estilos del documento
  envoltorio.style.width = ANCHO_HOJA_PX + 'px';

  // En la primera hoja el texto empieza bajo el encabezado (la altura del
  // espaciador superior ya está incluida en el margen de la columna).
  const reserva = document.createElement('div');
  reserva.style.height = encabezado.offsetHeight + 'px';
  envoltorio.appendChild(reserva);
  // .ln-salto-hoja fuerza un salto de HOJA al imprimir (break-before: page),
  // pero eso no significa nada dentro de esta simulación por COLUMNAS. Para
  // que la medición vea el mismo salto, en la copia clonada se fuerza el
  // salto de columna (equivalente, aquí, a una hoja nueva).
  const forzarSaltoDeColumna = (nodo) => {
    if (nodo.classList?.contains('ln-salto-hoja')) nodo.style.breakBefore = 'column';
    nodo.querySelectorAll?.('.ln-salto-hoja').forEach(el => { el.style.breakBefore = 'column'; });
  };
  cuerpo.forEach(n => {
    const clon = n.cloneNode(true);
    forzarSaltoDeColumna(clon);
    envoltorio.appendChild(clon);
  });
  const marca = document.createElement('div'); // marca el final del contenido
  marca.style.height = '0';
  envoltorio.appendChild(marca);

  sim.appendChild(envoltorio);
  document.body.appendChild(sim);

  let espacio = 0;
  try {
    const rSim = sim.getBoundingClientRect();
    const rMarca = marca.getBoundingClientRect();
    const yFinal = Math.min(Math.max(rMarca.top - rSim.top, 0), ALTO_UTIL_PX); // dentro de la última hoja
    espacio = (ALTO_UTIL_PX - yFinal) - altoPie;
    if (espacio < ESPACIO_MINIMO_PIE_PX) {
      // el pie no cabe debajo del texto: va al fondo de una hoja nueva
      espacio += ALTO_HOJA_PX;
    }
  } finally {
    sim.remove();
  }
  // 1 px de tolerancia para que un redondeo nunca empuje el pie a una hoja de más
  plantilla.style.setProperty('--ln-espacio-pie', Math.max(0, Math.floor(espacio) - 1) + 'px');
}

/**
 * Prepara la COPIA de impresión: envuelve el cuerpo en la tabla cuyos
 * espaciadores (thead/tfoot) el navegador repite en cada hoja.
 */
function estructurarCopiaParaImprimir(copia) {
  const encabezado = copia.querySelector(':scope > .ln-encabezado');
  if (!encabezado || !copia.querySelector(':scope > .ln-pie')) return;
  const cuerpo = [...copia.children].filter(n => !NO_ES_CUERPO.some(c => n.classList.contains(c)));
  const tabla = document.createElement('table');
  tabla.className = 'ln-paginado';
  tabla.innerHTML = '<thead><tr><td><div class="ln-espaciador"></div></td></tr></thead>'
    + '<tbody><tr><td class="ln-cuerpo"></td></tr></tbody>'
    + '<tfoot><tr><td><div class="ln-espaciador"></div></td></tr></tfoot>';
  const celda = tabla.querySelector('.ln-cuerpo');
  cuerpo.forEach(n => celda.appendChild(n));
  encabezado.after(tabla);
}

/**
 * Imprime un documento que está dentro de un modal propio de la página
 * (Documentación). En vez de imprimir "a través" del modal (cuyo fondo,
 * márgenes y bordes se colaban en el PDF), copia el documento a una zona de
 * impresión limpia, directamente en <body>, y solo se imprime eso. Las reglas
 * de css/pdf-documentos.css hacen el resto.
 * @param {HTMLElement} origen el documento visible en pantalla
 */
export async function imprimirDocumentoPdf(origen) {
  if (!origen) return;
  // Poppins tiene que estar cargada antes de medir (y de imprimir)
  try { await document.fonts.ready; } catch (e) { /* sin soporte: se sigue igual */ }
  prepararAlturasParaImprimir(origen); // se mide con el original, que sí está visible

  let zona = document.getElementById('zonaImpresionPdf');
  if (!zona) {
    zona = document.createElement('div');
    zona.id = 'zonaImpresionPdf';
    document.body.appendChild(zona);
  }
  const copia = origen.cloneNode(true); // conserva las variables de altura medidas
  copia.removeAttribute('id');
  estructurarCopiaParaImprimir(copia);
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
