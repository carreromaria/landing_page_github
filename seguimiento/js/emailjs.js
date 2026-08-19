// ============================================================
// LINENCE — Seguimiento de Proyectos
// Notificaciones por correo (EmailJS)
// ============================================================
// Se dispara desde dashboard.js justo después de un cambio de
// etapa exitoso. Si el envío falla, NO revierte el cambio de
// etapa — el proyecto ya avanzó, solo se pierde la notificación
// (se registra en consola para poder revisarlo).

// Datos de la cuenta EmailJS de Linence (Account → General):
const EMAILJS_PUBLIC_KEY  = "LBXBb3yvsJAMqS5p6";
const EMAILJS_SERVICE_ID  = "service_elfqmcm";
const EMAILJS_TEMPLATE_ID = "template_4pd7v5g";

let emailjsCargado = false;

function cargarSDK() {
  if (emailjsCargado) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    script.onload = () => {
      window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      emailjsCargado = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Envía la notificación de avance de etapa al cliente.
 * Nunca lanza una excepción que interrumpa el flujo del dashboard:
 * si falla, solo se registra en consola.
 */
export async function notificarCambioEtapa({ email, cliente, etapaNombre, codigo, token, tipoProyecto, porcentaje, fechaEstimadaTexto, direccionTexto }) {
  if (!email) {
    console.warn('El proyecto no tiene correo registrado, no se envía notificación.');
    return { enviado: false, motivo: 'sin_email' };
  }
  if (EMAILJS_PUBLIC_KEY.startsWith('REEMPLAZAR')) {
    console.warn('EmailJS no está configurado todavía (faltan las llaves en emailjs.js).');
    return { enviado: false, motivo: 'no_configurado' };
  }

  try {
    await cargarSDK();
    const enlace = `${window.location.origin}/seguimiento/proyecto.html?codigo=${encodeURIComponent(codigo)}&token=${encodeURIComponent(token)}`;

    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: email,
      cliente: cliente || 'Cliente Linence',
      etapa_nombre: etapaNombre,
      enlace_proyecto: enlace,
      codigo,
      nombre_proyecto: tipoProyecto || 'Tu proyecto',
      porcentaje: porcentaje ?? '',
      fecha_estimada: fechaEstimadaTexto || 'Por confirmar',
      direccion: direccionTexto || 'Por confirmar'
    });
    return { enviado: true };
  } catch (err) {
    console.error('No se pudo enviar la notificación por correo:', err);
    return { enviado: false, motivo: 'error_envio', error: err };
  }
}
