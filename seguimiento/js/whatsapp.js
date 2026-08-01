// ============================================================
// LINENCE — Seguimiento de Proyectos
// Notificaciones por WhatsApp (Fase 11 — preparación)
// ============================================================
// TODAVÍA NO HAY ENVÍO AUTOMÁTICO DE WHATSAPP.
//
// Por qué: no existe una API oficial gratuita de WhatsApp Business
// para envío automatizado. La API oficial de Meta (WhatsApp Cloud
// API) requiere una cuenta de negocio verificada y tiene costo por
// conversación pasado un umbral gratuito mensual. Las alternativas
// no oficiales (bots basados en WhatsApp Web) violan los términos
// de servicio de Meta y son inestables para uso comercial — no se
// usan en Linence.
//
// Qué SÍ hace este archivo mientras tanto: genera el enlace manual
// de wa.me para que el staff pueda compartir el avance por WhatsApp
// con un clic, y deja la función `notificarWhatsapp` ya escrita
// para conectar la API oficial más adelante SIN tener que tocar
// dashboard.js — solo se completa el cuerpo de esta función.

/**
 * Genera un enlace de wa.me con el mensaje pre-escrito, listo para
 * que el staff lo abra y lo envíe manualmente con un clic.
 * Esto es lo que se usa HOY, en la Fase 11.
 */
export function generarEnlaceWhatsappManual({ telefono, cliente, etapaNombre, enlaceProyecto }) {
  if (!telefono) return null;

  const telefonoLimpio = telefono.replace(/[^\d]/g, '');
  const mensaje = `Hola ${cliente || ''}, tu proyecto con Linence avanzó a la etapa "${etapaNombre}". Puedes revisar el avance aquí: ${enlaceProyecto}`;

  return `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * FUTURO (cuando se conecte la API oficial de WhatsApp Business):
 * Esta función quedará lista para llamarse desde dashboard.js
 * exactamente donde hoy se llama a notificarCambioEtapa() en
 * emailjs.js — mismo patrón, misma forma de uso.
 *
 * Implementación pendiente: normalmente se necesita un backend
 * (Cloud Function) que llame a la Graph API de Meta con un token
 * de acceso — no se puede hacer 100% desde el navegador de forma
 * segura, porque expondría el token. Cuando se decida avanzar con
 * esto, es el momento de introducir Cloud Functions en el proyecto.
 */
export async function notificarWhatsapp({ telefono, cliente, etapaNombre, enlaceProyecto }) {
  console.warn('Notificación automática por WhatsApp aún no está implementada (Fase 11 — solo preparación).');
  return { enviado: false, motivo: 'no_implementado' };
}
