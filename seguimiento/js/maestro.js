// ============================================================
// LINENCE — Maestro (Catálogo + Tipos de proyecto)
// Lógica de la pantalla maestro.html
// ============================================================
// Maneja lo común: guardia de sesión, menú lateral, cierre de sesión y
// pestañas. Cada pestaña se inicia (carga sus datos) la primera vez que
// se abre. Las pestañas viven en el hash de la URL: #catalogo y #tipos.

import { observarSesionStaff, cerrarSesion } from './auth.js';
import { iniciarCatalogo } from './catalogo-servicios.js';
import { iniciarTipos } from './tipos-proyecto-admin.js';

// ---------- Pestañas ----------

const PESTANAS = {
  catalogo: { tab: 'tabCatalogo', panel: 'panelCatalogo', iniciar: iniciarCatalogo },
  tipos:    { tab: 'tabTipos',    panel: 'panelTipos',    iniciar: iniciarTipos }
};
const ORDEN = ['catalogo', 'tipos'];
const PESTANA_INICIAL = 'catalogo';

let sesionLista = false;

function pestanaDesdeHash() {
  const nombre = window.location.hash.replace('#', '');
  return PESTANAS[nombre] ? nombre : PESTANA_INICIAL;
}

function mostrarPestana(nombre) {
  ORDEN.forEach((n) => {
    const activa = n === nombre;
    const p = PESTANAS[n];
    const tab = document.getElementById(p.tab);
    tab.setAttribute('aria-selected', activa ? 'true' : 'false');
    tab.tabIndex = activa ? 0 : -1;
    document.getElementById(p.panel).hidden = !activa;
  });
  if (sesionLista) PESTANAS[nombre].iniciar();
}

window.addEventListener('hashchange', () => mostrarPestana(pestanaDesdeHash()));

// Flechas izquierda/derecha para cambiar de pestaña con el teclado
document.querySelector('.maestro-tabs')?.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const i = ORDEN.indexOf(pestanaDesdeHash());
  const siguiente = ORDEN[(i + (e.key === 'ArrowRight' ? 1 : ORDEN.length - 1)) % ORDEN.length];
  window.location.hash = siguiente;
  document.getElementById(PESTANAS[siguiente].tab).focus();
});

// Deja la pestaña correcta visible desde el primer momento
mostrarPestana(pestanaDesdeHash());

// ---------- Guardia de sesión (mismo patrón que crm.js / dashboard.js) ----------

const dashTopbarMobile = document.getElementById('dashTopbarMobile');

function actualizarVisibilidadTopbar() {
  dashTopbarMobile.style.display = window.innerWidth <= 900 ? 'flex' : 'none';
}
window.addEventListener('resize', actualizarVisibilidadTopbar);

observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = '';
  actualizarVisibilidadTopbar();
  document.getElementById('staffNombre').textContent = staff.nombre || '—';
  document.getElementById('staffRol').textContent = staff.rol || '—';
  sesionLista = true;
  PESTANAS[pestanaDesdeHash()].iniciar();
});

document.getElementById('btnCerrarSesion')?.addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Sidebar mobile (mismo patrón que crm.js) ----------

const dashSidebar = document.getElementById('dashSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const abrirSidebar = () => { dashSidebar.classList.add('abierto'); sidebarOverlay.classList.add('visible'); };
const cerrarSidebar = () => { dashSidebar.classList.remove('abierto'); sidebarOverlay.classList.remove('visible'); };
document.getElementById('btnAbrirSidebar')?.addEventListener('click', abrirSidebar);
document.getElementById('btnCerrarSidebar')?.addEventListener('click', cerrarSidebar);
sidebarOverlay?.addEventListener('click', cerrarSidebar);
