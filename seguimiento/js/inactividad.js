// js/inactividad.js
// Cierre de sesión por inactividad — módulo ÚNICO para todo el panel LINENCE.
// Uso (en cada página, DESPUÉS de confirmar sesión activa):
//
//   import { iniciarControlInactividad } from './inactividad.js';
//   iniciarControlInactividad({ cerrarSesion, redirigirA: 'login.html' });
//
// Hoy lo inicia auth.js automáticamente dentro de observarSesionStaff(),
// así que ninguna página necesita llamarlo por su cuenta.

const CLAVE_ACTIVIDAD = 'linence_ultima_actividad';
const EVENTOS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

let iniciado = false;

export function iniciarControlInactividad({
  cerrarSesion,
  redirigirA = 'login.html',
  minutos = 1,
  avisoMinutos = 0.5
} = {}) {
  if (iniciado) return;          // evita duplicar si la página lo llama dos veces
  iniciado = true;

  const limiteMs = minutos * 60 * 1000;
  const avisoMs = avisoMinutos * 60 * 1000;
  let aviso = null;
  let cerrando = false;

  const ahora = () => Date.now();
  const leerUltima = () => Number(localStorage.getItem(CLAVE_ACTIVIDAD)) || ahora();

  // Registrar actividad (con pausa de 1 s para no escribir en cada movimiento).
  // Se guarda en localStorage para que varias pestañas abiertas compartan el mismo reloj.
  let ultimoRegistro = 0;
  function registrarActividad() {
    const t = ahora();
    if (t - ultimoRegistro < 1000) return;
    ultimoRegistro = t;
    localStorage.setItem(CLAVE_ACTIVIDAD, String(t));
    ocultarAviso();
  }

  function mostrarAviso() {
    if (aviso) return;
    aviso = document.createElement('div');
    aviso.setAttribute('role', 'alert');
    aviso.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;' +
      'background:#141213;color:#fff;border:1px solid #d6a52c;border-radius:10px;' +
      'padding:14px 18px;font-family:Poppins,sans-serif;font-size:14px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;gap:14px;align-items:center;max-width:92vw;';
    aviso.innerHTML =
      '<span>Tu sesión se cerrará en 1 minuto por inactividad.</span>' +
      '<button type="button" style="background:#d6a52c;color:#141213;border:0;border-radius:6px;' +
      'padding:8px 12px;font-family:inherit;font-weight:600;cursor:pointer;">Seguir conectado/a</button>';
    aviso.querySelector('button').addEventListener('click', () => {
      ultimoRegistro = 0;
      registrarActividad();
    });
    document.body.appendChild(aviso);
  }

  function ocultarAviso() {
    if (aviso) {
      aviso.remove();
      aviso = null;
    }
  }

  async function cerrarPorInactividad() {
    if (cerrando) return;
    cerrando = true;
    ocultarAviso();
    try {
      await cerrarSesion();
    } catch (e) {
      console.error('Error al cerrar sesión por inactividad:', e);
    }
    localStorage.removeItem(CLAVE_ACTIVIDAD);
    // Mismo mecanismo que ya usaba el panel: login.html lee este valor
    try { sessionStorage.setItem('linence_logout_reason', 'inactividad'); } catch (e) { /* no-op */ }
    window.location.href = redirigirA;
  }

  // Revisión cada 15 s. Se usa el reloj real (Date.now) y no un setTimeout largo,
  // porque los navegadores frenan los timers de pestañas en segundo plano
  // y al suspender el equipo.
  function revisar() {
    const inactivo = ahora() - leerUltima();
    if (inactivo >= limiteMs) cerrarPorInactividad();
    else if (inactivo >= avisoMs) mostrarAviso();
    else ocultarAviso();
  }

  EVENTOS.forEach(ev => window.addEventListener(ev, registrarActividad, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisar(); // al volver a la pestaña
  });
  window.addEventListener('storage', e => {
    if (e.key === CLAVE_ACTIVIDAD) ocultarAviso();         // actividad en otra pestaña
  });

  localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora()));
  setInterval(revisar, 15000);
}
