// ============================================================
// LINENCE — Notas y materiales del cliente (solo leads Ganados)
// ============================================================
// Listas tipo "Notas del iPhone": cada sección tiene un título libre y
// una lista de ítems con casilla. Las COMPRAS (una por lugar: Imperial,
// Chinos Centros, Placa Centro…) van separadas de las NOTAS; el tipo se
// elige al crear la sección y ya no se mezcla. Al marcar un ítem se tacha.
//
// Este archivo NO habla con Firestore: recibe la función `guardar`
// desde crm.js (que a su vez usa firestore.js). Así se respeta la
// regla del proyecto de que toda operación de datos pasa por firestore.js.
//
// Estructura guardada en el lead (campo `listasMateriales`):
//   [{ id, titulo, tipo: 'nota' | 'compra', creadaEn, actualizadaEn,
//      items: [{ id, texto, cantidad, hecho }] }]
// En las notas de tipo 'compra' cada ítem lleva un campo de cantidad al inicio.

const PAUSA_GUARDADO_MS = 700;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function nuevoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().slice(0, 12);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function autoajustar(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/**
 * @param {Object} opciones
 * @param {HTMLElement} opciones.contenedor  Donde se dibuja la sección.
 * @param {(leadId:string, listas:Array)=>Promise<void>} opciones.guardar
 * @param {(mensaje:string, tipo?:string)=>void} [opciones.avisar]  Toast de error.
 */
export function crearNotasMateriales({ contenedor, guardar, avisar }) {
  let leadId = null;
  let listas = [];
  let temporizador = null;
  let hayPendiente = false;

  // ---------- Guardado ----------

  function marcarEstado(texto) {
    const el = contenedor.querySelector('.nm-estado');
    if (el) el.textContent = texto;
  }

  async function guardarAhora() {
    clearTimeout(temporizador);
    temporizador = null;
    if (!hayPendiente || !leadId) return;
    hayPendiente = false;
    const idLead = leadId;
    const copia = JSON.parse(JSON.stringify(listas));
    marcarEstado('Guardando…');
    try {
      await guardar(idLead, copia);
      marcarEstado('Guardado ✓');
    } catch (err) {
      console.error('No pudimos guardar las notas y materiales:', err);
      hayPendiente = true;
      marcarEstado('No se pudo guardar');
      avisar?.('No se pudieron guardar las notas. Revisa tu conexión e intenta de nuevo.', 'error');
    }
  }

  function programarGuardado() {
    hayPendiente = true;
    marcarEstado('Guardando…');
    clearTimeout(temporizador);
    temporizador = setTimeout(guardarAhora, PAUSA_GUARDADO_MS);
  }

  function tocarNota(nota) {
    nota.actualizadaEn = new Date().toISOString();
  }

  // ---------- Dibujo ----------

  function htmlItem(item, esCompra) {
    const cantidad = esCompra
      ? `<input type="text" class="nm-cant" data-campo="cantidad" maxlength="14"
                value="${escapeHtml(item.cantidad || '')}" placeholder="Cant." aria-label="Cantidad" autocomplete="off">`
      : '';
    return `
      <div class="nm-item${item.hecho ? ' nm-hecho' : ''}" data-item-id="${escapeHtml(item.id)}">
        <button type="button" class="nm-check" data-accion="marcar" role="checkbox"
                aria-checked="${item.hecho ? 'true' : 'false'}" aria-label="Marcar como listo"></button>
        ${cantidad}
        <textarea class="nm-item-texto" data-campo="item" rows="1"
                  placeholder="Escribe aquí…" aria-label="Texto del ítem">${escapeHtml(item.texto)}</textarea>
        <button type="button" class="nm-item-borrar" data-accion="borrar-item" aria-label="Eliminar ítem">×</button>
      </div>`;
  }

  function textoContador(nota) {
    const hechos = nota.items.filter(i => i.hecho).length;
    return `${hechos}/${nota.items.length}`;
  }

  function htmlNota(nota) {
    const esCompra = nota.tipo === 'compra';
    const cantidadNueva = esCompra
      ? `<input type="text" class="nm-cant nm-nueva-cant" data-campo="nueva-cant" maxlength="14"
                placeholder="Cant." aria-label="Cantidad del ítem nuevo" autocomplete="off">`
      : '';
    const placeholderTitulo = esCompra
      ? 'Dónde se compra (ej. Compras en Imperial)'
      : 'Título de la nota (ej. Notas del cliente)';
    return `
      <div class="nm-nota ${esCompra ? 'nm-nota-compra' : 'nm-nota-nota'}" data-nota-id="${escapeHtml(nota.id)}">
        <div class="nm-nota-cabecera">
          <span class="nm-nota-icono" aria-hidden="true">${esCompra ? '🛒' : '✎'}</span>
          <input type="text" class="nm-titulo" data-campo="titulo" maxlength="80"
                 value="${escapeHtml(nota.titulo)}" placeholder="${placeholderTitulo}"
                 aria-label="Título de la sección" autocomplete="off">
          <span class="nm-contador" aria-label="Ítems listos">${textoContador(nota)}</span>
          <button type="button" class="nm-nota-borrar" data-accion="borrar-nota" aria-label="Eliminar sección">Eliminar</button>
        </div>
        <div class="nm-cuerpo">
          <div class="nm-items">${nota.items.map(i => htmlItem(i, esCompra)).join('')}</div>
          <div class="nm-agregar">
            ${cantidadNueva}
            <input type="text" class="nm-nuevo-item" data-campo="nuevo-item"
                   placeholder="+ Agregar ítem…" aria-label="Agregar ítem" autocomplete="off">
            <button type="button" class="btn-secundario nm-btn-agregar" data-accion="agregar-item">Agregar</button>
          </div>
        </div>
      </div>`;
  }

  function dibujar() {
    contenedor.innerHTML = `
      <div class="crm-bitacora-titulo">Notas y materiales</div>
      <div class="nm-lista">
        ${listas.length
          ? listas.map(htmlNota).join('')
          : '<p class="crm-nota-vacia nm-vacio">Aún no hay secciones. Crea una compra por cada lugar donde se compra (Imperial, Chinos Centros, Placa Centro…) y una nota aparte para lo que haya que recordar de este cliente.</p>'}
      </div>
      <div class="nm-pie">
        <span class="nm-pie-acciones">
          <a href="#" class="crm-cotizacion-nueva-opcion" data-accion="nueva-compra">+ Nueva compra</a>
          <a href="#" class="crm-cotizacion-nueva-opcion" data-accion="nueva-nota">+ Nueva nota</a>
        </span>
        <span class="nm-estado" aria-live="polite"></span>
      </div>`;
    contenedor.querySelectorAll('.nm-item-texto').forEach(autoajustar);
  }

  function actualizarContador(notaEl, nota) {
    const el = notaEl?.querySelector('.nm-contador');
    if (el) el.textContent = textoContador(nota);
  }

  function buscarNota(el) {
    const idNota = el.closest('.nm-nota')?.dataset.notaId;
    return listas.find(n => n.id === idNota) || null;
  }

  function buscarItem(nota, el) {
    const idItem = el.closest('.nm-item')?.dataset.itemId;
    return nota?.items.find(i => i.id === idItem) || null;
  }

  function enfocar(selector) {
    const el = contenedor.querySelector(selector);
    if (el) el.focus();
    return el;
  }

  // ---------- Acciones ----------

  function agregarItem(notaEl, texto, cantidad = '', despuesDe = null) {
    const nota = buscarNota(notaEl);
    const limpio = (texto || '').trim();
    if (!nota || !limpio) return null;
    const item = { id: nuevoId(), texto: limpio, hecho: false };
    if (nota.tipo === 'compra') item.cantidad = (cantidad || '').trim();
    if (despuesDe) {
      const pos = nota.items.findIndex(i => i.id === despuesDe);
      nota.items.splice(pos + 1, 0, item);
    } else {
      nota.items.push(item);
    }
    tocarNota(nota);
    programarGuardado();
    return item;
  }

  contenedor.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton || !contenedor.contains(boton)) return;
    const accion = boton.dataset.accion;

    if (accion === 'nueva-nota' || accion === 'nueva-compra') {
      e.preventDefault();
      const ahora = new Date().toISOString();
      const tipo = accion === 'nueva-compra' ? 'compra' : 'nota';
      const nota = { id: nuevoId(), titulo: '', tipo, items: [], creadaEn: ahora, actualizadaEn: ahora };
      listas.push(nota);
      programarGuardado();
      dibujar();
      enfocar(`[data-nota-id="${nota.id}"] .nm-titulo`);
      return;
    }

    const notaEl = boton.closest('.nm-nota');
    const nota = buscarNota(boton);
    if (!nota) return;

    if (accion === 'marcar') {
      const item = buscarItem(nota, boton);
      if (!item) return;
      item.hecho = !item.hecho;
      const fila = boton.closest('.nm-item');
      fila.classList.toggle('nm-hecho', item.hecho);
      boton.setAttribute('aria-checked', item.hecho ? 'true' : 'false');
      actualizarContador(notaEl, nota);
      tocarNota(nota);
      programarGuardado();
    } else if (accion === 'borrar-item') {
      const item = buscarItem(nota, boton);
      if (!item) return;
      nota.items = nota.items.filter(i => i.id !== item.id);
      tocarNota(nota);
      programarGuardado();
      boton.closest('.nm-item').remove();
      actualizarContador(notaEl, nota);
    } else if (accion === 'borrar-nota') {
      const nombre = nota.titulo.trim() || 'esta nota';
      if (!window.confirm(`¿Eliminar "${nombre}" con todos sus ítems? No se puede deshacer.`)) return;
      listas = listas.filter(n => n.id !== nota.id);
      programarGuardado();
      dibujar();
    } else if (accion === 'agregar-item') {
      const input = notaEl.querySelector('.nm-nuevo-item');
      const cant = notaEl.querySelector('.nm-nueva-cant');
      const item = agregarItem(notaEl, input.value, cant ? cant.value : '');
      if (!item) { input.focus(); return; }
      const idNota = nota.id;
      dibujar();
      enfocar(`[data-nota-id="${idNota}"] .nm-nuevo-item`);
    }
  });

  contenedor.addEventListener('input', (e) => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    if (campo === 'titulo') {
      const nota = buscarNota(e.target);
      if (!nota) return;
      nota.titulo = e.target.value;
      tocarNota(nota);
      programarGuardado();
    } else if (campo === 'cantidad') {
      const nota = buscarNota(e.target);
      const item = buscarItem(nota, e.target);
      if (!item) return;
      item.cantidad = e.target.value;
      tocarNota(nota);
      programarGuardado();
    } else if (campo === 'item') {
      const nota = buscarNota(e.target);
      const item = buscarItem(nota, e.target);
      if (!item) return;
      item.texto = e.target.value.replace(/\n/g, ' ');
      autoajustar(e.target);
      tocarNota(nota);
      programarGuardado();
    }
  });

  contenedor.addEventListener('keydown', (e) => {
    const campo = e.target.dataset?.campo;
    if (!campo) return;

    if (campo === 'nuevo-item' && e.key === 'Enter') {
      e.preventDefault();
      const notaEl = e.target.closest('.nm-nota');
      const idNota = notaEl.dataset.notaId;
      const cant = notaEl.querySelector('.nm-nueva-cant');
      if (!agregarItem(notaEl, e.target.value, cant ? cant.value : '')) return;
      dibujar();
      enfocar(`[data-nota-id="${idNota}"] ${cant ? '.nm-nueva-cant' : '.nm-nuevo-item'}`);
    }

    // Enter en una cantidad: pasa al texto del mismo ítem
    if (campo === 'nueva-cant' && e.key === 'Enter') {
      e.preventDefault();
      e.target.closest('.nm-nota').querySelector('.nm-nuevo-item')?.focus();
    }
    if (campo === 'cantidad' && e.key === 'Enter') {
      e.preventDefault();
      e.target.closest('.nm-item').querySelector('.nm-item-texto')?.focus();
    }

    if (campo === 'titulo' && e.key === 'Enter') {
      e.preventDefault();
      e.target.closest('.nm-nota').querySelector('.nm-nuevo-item')?.focus();
    }

    if (campo === 'item') {
      const nota = buscarNota(e.target);
      const item = buscarItem(nota, e.target);
      if (!item) return;

      // Enter: crea un ítem nuevo justo debajo (como en Notas del iPhone)
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!item.texto.trim()) return;
        const nuevo = { id: nuevoId(), texto: '', hecho: false };
        if (nota.tipo === 'compra') nuevo.cantidad = '';
        const pos = nota.items.findIndex(i => i.id === item.id);
        nota.items.splice(pos + 1, 0, nuevo);
        tocarNota(nota);
        programarGuardado();
        const idNota = nota.id;
        dibujar();
        enfocar(`[data-nota-id="${idNota}"] [data-item-id="${nuevo.id}"] ${nota.tipo === 'compra' ? '.nm-cant' : '.nm-item-texto'}`);
      }

      // Retroceso en un ítem vacío: lo elimina y vuelve al anterior
      if (e.key === 'Backspace' && !e.target.value && !item.cantidad) {
        e.preventDefault();
        const pos = nota.items.findIndex(i => i.id === item.id);
        nota.items.splice(pos, 1);
        tocarNota(nota);
        programarGuardado();
        const idNota = nota.id;
        const anterior = nota.items[pos - 1];
        dibujar();
        if (anterior) {
          const el = enfocar(`[data-nota-id="${idNota}"] [data-item-id="${anterior.id}"] .nm-item-texto`);
          if (el) el.setSelectionRange(el.value.length, el.value.length);
        } else {
          enfocar(`[data-nota-id="${idNota}"] .nm-nuevo-item`);
        }
      }
    }
  });

  // Si cierran la pestaña o cambian de app con algo sin guardar, se guarda igual
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') guardarAhora();
  });
  window.addEventListener('pagehide', () => { guardarAhora(); });

  // ---------- API pública ----------

  return {
    /** Muestra la sección solo si el lead está Ganado. */
    mostrar(lead) {
      guardarAhora(); // por si había cambios pendientes del lead anterior
      if (!lead || lead.etapa !== 'Ganado') {
        leadId = null;
        listas = [];
        contenedor.innerHTML = '';
        contenedor.style.display = 'none';
        return;
      }
      leadId = lead.id;
      listas = JSON.parse(JSON.stringify(Array.isArray(lead.listasMateriales) ? lead.listasMateriales : []));
      // Las secciones antiguas eran todas 'nota': si el título dice "Compra(s)…",
      // se muestran como compra (con cantidad) para no tener que rehacerlas.
      listas.forEach(n => {
        if (n.tipo !== 'compra') n.tipo = /^\s*compras?\b/i.test(n.titulo || '') ? 'compra' : 'nota';
      });
      hayPendiente = false;
      contenedor.style.display = '';
      dibujar();
    },
    /** Se llama al salir de la ficha, para no perder lo último que se escribió. */
    ocultar() {
      guardarAhora();
    }
  };
}
