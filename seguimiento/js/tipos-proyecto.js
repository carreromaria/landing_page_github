// ============================================================
// LINENCE — Selector de tipo de proyecto (código de 3 letras)
// ============================================================
// Llena un <select> con los tipos activos, ej. "COC — Cocina".
// Si el lead/proyecto ya tenía un tipo que después se desactivó,
// igual aparece (marcado como inactivo) para no perder su valor.

import { listarTiposProyecto } from './firestore.js';

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export async function poblarSelectTipoProyecto(select, valorActual = '') {
  if (!select) return;
  let tipos = [];
  try {
    tipos = await listarTiposProyecto();
  } catch (err) {
    console.error('No pudimos cargar los tipos de proyecto:', err);
  }
  const visibles = tipos.filter(t => t.activo !== false || t.codigo === valorActual);
  select.innerHTML = '<option value="">Selecciona…</option>' + visibles.map(t =>
    `<option value="${escapar(t.codigo)}">${escapar(t.codigo)} — ${escapar(t.nombre)}${t.activo === false ? ' (inactivo)' : ''}</option>`
  ).join('');
  select.value = valorActual || '';
}
