// ============================================================
// LINENCE — Seguimiento de Proyectos
// Utilidades compartidas
// ============================================================

/** Lee parámetros de la URL actual. */
export function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    codigo: params.get('codigo'),
    token: params.get('token')
  };
}

/** Convierte un Timestamp de Firestore (o Date) a texto legible en español. */
export function formatearFecha(valor, conHora = false) {
  if (!valor) return '';
  const fecha = valor.toDate ? valor.toDate() : new Date(valor);
  const opciones = { day: 'numeric', month: 'long', year: 'numeric' };
  let texto = fecha.toLocaleDateString('es-CL', opciones);
  if (conHora) {
    texto += ' · ' + fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  }
  return texto;
}

/** Genera un token aleatorio largo para enlaces de clientes (usado en el dashboard, Fase 7). */
export function generarToken() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  // Fallback por si el navegador no soporta randomUUID
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
