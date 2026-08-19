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
export function generarEnlaceWhatsappManual({ telefono, cliente, etapaNombre, enlaceProyecto, direccionTexto }) {
  if (!telefono) return null;

  const telefonoLimpio = telefono.replace(/[^\d]/g, '');
  let mensaje = `Hola ${cliente || ''}, tu proyecto con Linence avanzó a la etapa "${etapaNombre}".`;
  if (direccionTexto) mensaje += `\nDirección de instalación: ${direccionTexto}`;
  mensaje += `\nPuedes revisar el avance aquí: ${enlaceProyecto}`;

  return `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Genera un enlace de wa.me con el mensaje de BIENVENIDA a la plataforma,
 * para clientes nuevos que recién reciben su enlace de seguimiento
 * (distinto del mensaje de avance de etapa).
 */
export function generarEnlaceWhatsappBienvenida({ telefono, cliente, enlaceProyecto, direccionTexto }) {
  if (!telefono) return null;

  const telefonoLimpio = telefono.replace(/[^\d]/g, '');
  const nombre = cliente || '';

  const mensaje = `Hola, ${nombre}. 👋

Esperamos que te encuentres muy bien.

Nos complace darte la bienvenida al sistema de seguimiento de proyectos de LINENCE. A partir de este momento podrás conocer el avance de tu proyecto en cada una de sus etapas, desde el inicio de la fabricación hasta su instalación y entrega.
${direccionTexto ? `\nDirección de instalación registrada: ${direccionTexto}\n` : ''}

Para consultar el estado de tu proyecto, solo debes ingresar al siguiente enlace:

🔗 ${enlaceProyecto}

En esta plataforma podrás revisar:

• Estado actual del proyecto.
• Porcentaje de avance.
• Etapas completadas y en proceso.
• Fotografías del avance (cuando corresponda).
• Fecha estimada de instalación.
• Actualizaciones realizadas por nuestro equipo.

Además, te notificaremos al email cada vez que tu proyecto avance de etapa, para que siempre estés informado durante todo el proceso.

Agradecemos la confianza que has depositado en LINENCE. Será un placer acompañarte hasta la entrega de tu proyecto.

LINENCE
Línea y Esencia`;

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
