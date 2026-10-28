// ============================================================
// LINENCE — PDF generado en el servidor (celulares)
// ============================================================
// En iPhone/iPad el navegador agrega al PDF su propio pie (ruta, fecha y
// "Página X de Y") y le cambia los márgenes al imprimir. Para que el botón
// "Descargar PDF" salga limpio desde el celular, el documento ya armado se
// manda a la Cloud Function "generarPdfDocumento" (southamerica-west1), que
// lo convierte a PDF con Chrome usando el mismo HTML y CSS, y devuelve el
// archivo. En computador NADA de esto se usa: sigue la impresión de siempre.

import { auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const REGION_FUNCIONES = 'southamerica-west1';
const funciones = getFunctions(auth.app, REGION_FUNCIONES);
// 90 s: la primera llamada tras un rato sin uso tarda más (arranque en frío).
const generarPdfDocumento = httpsCallable(funciones, 'generarPdfDocumento', { timeout: 90000 });

/** true en teléfonos y tablets (iPhone, iPad, Android). El computador queda en false. */
export function esCelular() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod|Android/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad que se hace pasar por Mac
}

/**
 * Envía el documento al servidor y descarga el PDF resultante.
 * @param {{html:string, estilos:string[], baseHref:string}} documento  lo arma prepararDocumentosParaServidor()
 * @param {string} nombreArchivo  nombre del PDF, sin ".pdf"
 */
export async function descargarPdfServidor(documento, nombreArchivo) {
  if (!documento || !documento.html) throw new Error('Documento vacío');
  const respuesta = await generarPdfDocumento({
    html: documento.html,
    estilos: documento.estilos,
    baseHref: documento.baseHref,
    titulo: nombreArchivo || 'LINENCE'
  });
  const base64 = respuesta?.data?.pdfBase64;
  if (!base64) throw new Error('El servidor no devolvió el PDF');

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = (nombreArchivo || 'LINENCE') + '.pdf';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
