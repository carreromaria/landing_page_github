// ============================================================
// LINENCE — Seguimiento de Proyectos
// Controlador de dashboard.html
// ============================================================

import { observarSesionStaff, cerrarSesion } from './auth.js';
import { listarProyectos, crearProyecto } from './firestore.js';
import { generarToken, formatearFecha } from './utils.js';
import { ETAPAS } from './etapas.js';

let TODOS_LOS_PROYECTOS = [];
let STAFF_ACTUAL = null;

// ---------- Guardia de sesión ----------
observarSesionStaff((staff) => {
  if (!staff) {
    window.location.href = 'login.html';
    return;
  }
  STAFF_ACTUAL = staff;
  document.getElementById('staffNombre').textContent = staff.nombre || staff.email;
  document.getElementById('staffRol').textContent = staff.rol === 'admin' ? 'Administrador' : 'Staff';
  document.getElementById('dashCargando').style.display = 'none';
  document.getElementById('dashLayout').style.display = 'flex';
  cargarProyectos();
});

document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
  await cerrarSesion();
  window.location.href = 'login.html';
});

// ---------- Cargar y renderizar listado ----------
async function cargarProyectos() {
  const lista = document.getElementById('listaProyectos');
  lista.innerHTML = '<div class="dash-vacio">Cargando proyectos…</div>';
  try {
    TODOS_LOS_PROYECTOS = await listarProyectos();
    renderLista();
  } catch (err) {
    console.error(err);
    lista.innerHTML = '<div class="dash-vacio">No pudimos cargar los proyectos. Intenta recargar la página.</div>';
  }
}

function renderLista() {
  const textoBusqueda = document.getElementById('buscador').value.trim().toLowerCase();
  const estadoFiltro = document.getElementById('filtroEstado').value;

  const filtrados = TODOS_LOS_PROYECTOS.filter(p => {
    const coincideTexto = !textoBusqueda ||
      p.codigo.toLowerCase().includes(textoBusqueda) ||
      (p.cliente || '').toLowerCase().includes(textoBusqueda);
    const coincideEstado = !estadoFiltro || p.estadoEtapaActual === estadoFiltro;
    return coincideTexto && coincideEstado;
  });

  const lista = document.getElementById('listaProyectos');
  const vacio = document.getElementById('dashVacio');

  if (!filtrados.length) {
    lista.innerHTML = '';
    vacio.style.display = 'block';
    vacio.textContent = TODOS_LOS_PROYECTOS.length
      ? 'Ningún proyecto coincide con tu búsqueda.'
      : 'Aún no hay proyectos creados. Haz clic en "+ Nuevo proyecto" para agregar el primero.';
    return;
  }
  vacio.style.display = 'none';

  lista.innerHTML = filtrados.map(p => {
    const etapa = ETAPAS[p.etapaActualIndex] || ETAPAS[0];
    const estadoLegible = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada' }[p.estadoEtapaActual] || p.estadoEtapaActual;
    return `
      <div class="fila-proyecto" data-codigo="${p.codigo}">
        <span class="codigo">${p.codigo}</span>
        <span class="cliente-nombre">${p.cliente || '—'}</span>
        <span class="tipo-col">${p.tipoProyecto || '—'}</span>
        <span><span class="badge-estado ${p.estadoEtapaActual}">${etapa.nombre}</span></span>
        <span class="porcentaje-mini">${etapa.porcentaje}%</span>
        <span>${estadoLegible}</span>
      </div>`;
  }).join('');

  lista.querySelectorAll('.fila-proyecto').forEach(fila => {
    fila.addEventListener('click', () => {
      // La vista de detalle (editar etapas, fotos, observaciones) se
      // construye en la Fase 8. Por ahora solo mostramos el código.
      alert('El detalle editable de "' + fila.dataset.codigo + '" se habilita en la próxima fase.');
    });
  });
}

document.getElementById('buscador').addEventListener('input', renderLista);
document.getElementById('filtroEstado').addEventListener('change', renderLista);

// ---------- Modal: nuevo proyecto ----------
const modalNuevo = document.getElementById('modalNuevo');
const formNuevo = document.getElementById('formNuevoProyecto');
const modalError = document.getElementById('modalError');
const btnGuardar = document.getElementById('btnGuardarNuevo');

document.getElementById('btnNuevoProyecto').addEventListener('click', () => {
  formNuevo.reset();
  modalError.classList.remove('visible');
  modalNuevo.classList.add('open');
});
document.getElementById('btnCancelarNuevo').addEventListener('click', () => {
  modalNuevo.classList.remove('open');
});
modalNuevo.addEventListener('click', (e) => {
  if (e.target === modalNuevo) modalNuevo.classList.remove('open');
});

formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  modalError.classList.remove('visible');

  const codigo = document.getElementById('fCodigo').value.trim().toUpperCase();
  const fechaEstimadaValor = document.getElementById('fFechaEstimada').value;

  if (!/^LIN-\d+$/.test(codigo)) {
    modalError.textContent = 'El código debe tener el formato LIN- seguido de números (igual al del formulario de cotización).';
    modalError.classList.add('visible');
    return;
  }

  const yaExiste = TODOS_LOS_PROYECTOS.some(p => p.codigo === codigo);
  if (yaExiste) {
    modalError.textContent = 'Ya existe un proyecto con ese código.';
    modalError.classList.add('visible');
    return;
  }

  const datos = {
    cliente: document.getElementById('fCliente').value.trim(),
    telefono: document.getElementById('fTelefono').value.trim(),
    email: document.getElementById('fEmail').value.trim(),
    tipoProyecto: document.getElementById('fTipoProyecto').value.trim(),
    responsable: document.getElementById('fResponsable').value.trim(),
    direccion: document.getElementById('fDireccion').value.trim(),
    fechaEstimadaInstalacion: fechaEstimadaValor ? new Date(fechaEstimadaValor) : null,
    observaciones: document.getElementById('fObservaciones').value.trim(),
    token: generarToken()
  };

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Creando…';

  try {
    await crearProyecto(codigo, datos, STAFF_ACTUAL.uid);
    modalNuevo.classList.remove('open');
    mostrarEnlaceGenerado(codigo, datos.token);
    await cargarProyectos();
  } catch (err) {
    console.error(err);
    modalError.textContent = 'No pudimos crear el proyecto. Intenta nuevamente.';
    modalError.classList.add('visible');
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Crear proyecto';
  }
});

// ---------- Modal: enlace generado ----------
const modalExito = document.getElementById('modalExito');

function mostrarEnlaceGenerado(codigo, token) {
  const url = `${window.location.origin}/seguimiento/proyecto.html?codigo=${encodeURIComponent(codigo)}&token=${encodeURIComponent(token)}`;
  document.getElementById('enlaceGeneradoInput').value = url;
  modalExito.classList.add('open');
}

document.getElementById('btnCopiarEnlace').addEventListener('click', () => {
  const input = document.getElementById('enlaceGeneradoInput');
  input.select();
  navigator.clipboard?.writeText(input.value);
  const btn = document.getElementById('btnCopiarEnlace');
  btn.textContent = '¡Copiado!';
  setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
});

document.getElementById('btnCerrarExito').addEventListener('click', () => {
  modalExito.classList.remove('open');
});
