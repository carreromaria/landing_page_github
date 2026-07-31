// ============================================================
// LINENCE — Seguimiento de Proyectos
// Controlador de la página login.html
// ============================================================

import { iniciarSesionStaff, observarSesionStaff } from './auth.js';

const form = document.getElementById('loginForm');
const btn = document.getElementById('loginBtn');
const errorBox = document.getElementById('loginError');

function mostrarError(mensaje){
  errorBox.textContent = mensaje;
  errorBox.classList.add('visible');
}
function ocultarError(){
  errorBox.classList.remove('visible');
}

function mensajeParaError(err){
  if (err.message === 'CUENTA_NO_AUTORIZADA'){
    return 'Tu cuenta no está autorizada para acceder al panel. Contacta a un administrador.';
  }
  const codigosConocidos = {
    'auth/invalid-email': 'El correo ingresado no es válido.',
    'auth/user-disabled': 'Esta cuenta fue deshabilitada.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'La contraseña ingresada es incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
  };
  return codigosConocidos[err.code] || 'No pudimos iniciar sesión. Intenta nuevamente.';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  ocultarError();
  btn.disabled = true;
  btn.textContent = 'Ingresando…';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    await iniciarSesionStaff(email, password);
    window.location.href = 'dashboard.html';
  } catch (err) {
    console.error(err);
    mostrarError(mensajeParaError(err));
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

// Si ya hay una sesión de staff válida, saltar directo al dashboard.
observarSesionStaff((staff) => {
  if (staff) window.location.href = 'dashboard.html';
});
