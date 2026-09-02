// ============================================================
// LINENCE — Dropdown reutilizable
// Guardar en: js/components/dropdown-linence.js
//
// Mismo look & feel que "Cambiar etapa" del CRM, ahora como
// componente genérico. Namespace de clases: "ln-dropdown-*"
// (no choca con crm.css, dashboard.css ni ningún otro archivo).
//
// ---------- Modo 1: mejorar un <select> existente (recomendado) ----------
// Deja intacta toda la lógica que ya lee `select.value` o escucha
// 'change', porque el <select> original sigue vivo (oculto) y
// sincronizado por detrás.
//
//   import { mejorarSelect } from './components/dropdown-linence.js';
//
//   mejorarSelect('#filtroCanal');
//   mejorarSelect('#eRegion', { onCambio: (valor) => cargarComunas(valor) });
//
// ---------- Modo 2: standalone (sin <select> de por medio) ----------
//   import { crearDropdown } from './components/dropdown-linence.js';
//
//   const dd = crearDropdown({
//     contenedor: document.getElementById('miWrap'),
//     placeholder: 'Selecciona…',
//     opciones: [{ valor: 'a', texto: 'Opción A' }],
//     onCambio: (valor, opcion) => { ... }
//   });
//
// ---------- Opciones asíncronas (ej: lista de vendedores desde Firestore) ----------
//   mejorarSelect('#lVendedor', {
//     opcionesAsync: async () => {
//       const vendedores = await obtenerVendedores();
//       return vendedores.map(v => ({ valor: v.id, texto: v.nombre }));
//     }
//   });
// ============================================================

let contadorId = 0;

function crearDropdown(config) {
  const {
    contenedor,
    placeholder = 'Selecciona…',
    opciones: opcionesIniciales = [],
    opcionesAsync = null,
    valorInicial = '',
    ancho = 'auto', // 'auto' | 'full'
    deshabilitado = false,
    onCambio = () => {},
  } = config;

  contadorId += 1;
  const idBase = `lnDropdown${contadorId}`;

  let opciones = opcionesIniciales.slice();
  let valorActual = valorInicial;
  let abierto = false;
  let indiceResaltado = -1;
  let cargandoAsync = false;

  const raiz = document.createElement('div');
  raiz.className = `ln-dropdown${ancho === 'full' ? ' ln-dropdown--full' : ''}`;
  if (deshabilitado) raiz.classList.add('ln-dropdown--deshabilitado');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ln-dropdown-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.id = `${idBase}Trigger`;

  const valorSpan = document.createElement('span');
  valorSpan.className = 'ln-dropdown-valor';
  trigger.appendChild(valorSpan);

  const flecha = document.createElement('span');
  flecha.className = 'ln-dropdown-flecha';
  flecha.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  trigger.appendChild(flecha);

  const lista = document.createElement('ul');
  lista.className = 'ln-dropdown-lista';
  lista.setAttribute('role', 'listbox');
  lista.id = `${idBase}Lista`;
  lista.hidden = true;
  trigger.setAttribute('aria-controls', lista.id);

  raiz.appendChild(trigger);
  raiz.appendChild(lista);
  contenedor.appendChild(raiz);

  function textoDe(valor) {
    const op = opciones.find(o => String(o.valor) === String(valor));
    return op ? op.texto : '';
  }

  function pintarValor() {
    const hayValor = valorActual !== '' && valorActual !== null && valorActual !== undefined;
    valorSpan.textContent = hayValor ? (textoDe(valorActual) || placeholder) : placeholder;
    trigger.classList.toggle('ln-dropdown-placeholder', !hayValor || !textoDe(valorActual));
  }

  function pintarLista() {
    if (cargandoAsync) {
      lista.innerHTML = `<li class="ln-dropdown-estado">Cargando…</li>`;
      return;
    }
    if (!opciones.length) {
      lista.innerHTML = `<li class="ln-dropdown-estado">Sin opciones disponibles</li>`;
      return;
    }
    lista.innerHTML = opciones.map((op) => `
      <li role="option"
          data-valor="${String(op.valor).replace(/"/g, '&quot;')}"
          aria-selected="${String(op.valor) === String(valorActual)}"
          class="${String(op.valor) === String(valorActual) ? 'seleccionado' : ''}${op.deshabilitado ? ' deshabilitada' : ''}">
        ${op.texto}
      </li>
    `).join('');
  }

  async function abrir() {
    if (raiz.classList.contains('ln-dropdown--deshabilitado')) return;
    abierto = true;
    lista.hidden = false;
    raiz.classList.add('abierto');
    trigger.setAttribute('aria-expanded', 'true');
    indiceResaltado = opciones.findIndex(o => String(o.valor) === String(valorActual));

    if (opcionesAsync) {
      cargandoAsync = true;
      pintarLista();
      try {
        opciones = (await opcionesAsync()) || [];
      } catch (err) {
        console.error('Error cargando opciones del dropdown:', err);
        opciones = [];
      }
      cargandoAsync = false;
    }
    pintarLista();
    resaltar(indiceResaltado);
  }

  function cerrar() {
    abierto = false;
    lista.hidden = true;
    raiz.classList.remove('abierto');
    trigger.setAttribute('aria-expanded', 'false');
    indiceResaltado = -1;
  }

  function resaltar(indice) {
    const items = lista.querySelectorAll('li[data-valor]');
    items.forEach(li => li.classList.remove('resaltada'));
    if (indice >= 0 && items[indice]) {
      items[indice].classList.add('resaltada');
      items[indice].scrollIntoView({ block: 'nearest' });
    }
    indiceResaltado = indice;
  }

  function seleccionar(valor, { emitir = true } = {}) {
    const opcionElegida = opciones.find(o => String(o.valor) === String(valor));
    valorActual = valor;
    pintarValor();
    pintarLista();
    if (emitir) onCambio(valorActual, opcionElegida || null);
  }

  trigger.addEventListener('click', () => {
    if (abierto) cerrar(); else abrir();
  });

  trigger.addEventListener('keydown', (e) => {
    if (!abierto && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      abrir();
      return;
    }
    if (!abierto) return;

    const items = lista.querySelectorAll('li[data-valor]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      resaltar(Math.min(indiceResaltado + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      resaltar(Math.max(indiceResaltado - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const li = items[indiceResaltado];
      if (li && !li.classList.contains('deshabilitada')) {
        seleccionar(li.dataset.valor);
        cerrar();
        trigger.focus();
      }
    } else if (e.key === 'Home') {
      resaltar(0);
    } else if (e.key === 'End') {
      resaltar(items.length - 1);
    } else if (e.key.length === 1) {
      const i = opciones.findIndex(o => o.texto.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) resaltar(i);
    }
  });

  lista.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-valor]');
    if (!li || li.classList.contains('deshabilitada')) return;
    seleccionar(li.dataset.valor);
    cerrar();
  });

  document.addEventListener('click', (e) => {
    if (!raiz.contains(e.target)) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto) {
      cerrar();
      trigger.focus();
    }
  });

  pintarValor();
  pintarLista();

  return {
    get valor() { return valorActual; },
    set(valor, opts) { seleccionar(valor, opts); },
    setOpciones(nuevasOpciones) { opciones = nuevasOpciones || []; pintarValor(); pintarLista(); },
    deshabilitar(bool) {
      raiz.classList.toggle('ln-dropdown--deshabilitado', !!bool);
      if (bool) cerrar();
    },
    marcarError(bool) { raiz.classList.toggle('ln-dropdown--error', !!bool); },
    abrir,
    cerrar,
    destruir() { raiz.remove(); },
    elemento: raiz,
  };
}

// ------------------------------------------------------------
// mejorarSelect: progressive enhancement de un <select> existente
// ------------------------------------------------------------

function mejorarSelect(selectOrSelector, config = {}) {
  const select = typeof selectOrSelector === 'string'
    ? document.querySelector(selectOrSelector)
    : selectOrSelector;

  if (!select) {
    console.warn('mejorarSelect: no se encontró el <select>', selectOrSelector);
    return null;
  }

  const esRequerido = select.required;

  function leerOpcionesDelSelect() {
    return Array.from(select.options)
      // Si el select es requerido y su primera opción es el placeholder
      // ("Selecciona…", value=""), no la mostramos como opción real:
      // ya se usa como placeholder del trigger.
      .filter((op, i) => !(esRequerido && i === 0 && op.value === ''))
      .map(op => ({ valor: op.value, texto: op.textContent, deshabilitado: op.disabled }));
  }

  select.classList.add('ln-dropdown-select-fuente');
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');

  const contenedor = document.createElement('div');
  select.parentNode.insertBefore(contenedor, select.nextSibling);

  const placeholderPorDefecto = (select.options[0] && select.options[0].value === '')
    ? select.options[0].textContent
    : 'Selecciona…';

  const instancia = crearDropdown({
    contenedor,
    placeholder: config.placeholder || placeholderPorDefecto,
    opciones: leerOpcionesDelSelect(),
    opcionesAsync: config.opcionesAsync || null,
    valorInicial: select.value,
    ancho: config.ancho || 'full',
    deshabilitado: select.disabled,
    onCambio: (valor) => {
      escribiendoDesdeDropdown = true;
      select.value = valor;
      escribiendoDesdeDropdown = false;
      // Algunos filtros (ej. el kanban del CRM) escuchan 'input' en vez
      // de 'change' — disparamos ambos para no depender de cuál usa
      // cada pantalla.
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (config.onCambio) config.onCambio(valor);
    },
  });

  // Mucho del código existente asigna el valor directo del select
  // (select.value = '...') en vez de pasar por un evento — pasa, por
  // ejemplo, al abrir el modal "Editar" y precargar los datos. Para que
  // el dropdown visual quede sincronizado en esos casos SIN tocar esa
  // lógica, interceptamos el setter nativo de "value".
  let escribiendoDesdeDropdown = false;
  const descriptorNativo = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return descriptorNativo.get.call(select); },
    set(v) {
      descriptorNativo.set.call(select, v);
      if (!escribiendoDesdeDropdown) instancia.set(select.value, { emitir: false });
    },
  });

  // Si algo (otro script) toca las <option> o el atributo disabled
  // del select directamente, el dropdown se re-sincroniza solo.
  const observer = new MutationObserver((mutaciones) => {
    let huboOpciones = false;
    let huboAtributos = false;
    mutaciones.forEach(m => {
      if (m.type === 'childList') huboOpciones = true;
      if (m.type === 'attributes' && m.attributeName === 'disabled') huboAtributos = true;
    });
    if (huboOpciones) instancia.setOpciones(leerOpcionesDelSelect());
    if (huboAtributos) instancia.deshabilitar(select.disabled);
  });
  observer.observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });

  // Si el select vive dentro de un <form>, re-sincronizar tras reset()
  if (select.form) {
    select.form.addEventListener('reset', () => {
      setTimeout(() => {
        instancia.setOpciones(leerOpcionesDelSelect());
        instancia.set(select.value, { emitir: false });
        instancia.deshabilitar(select.disabled);
      }, 0);
    });
  }

  // Para código legado que necesite tocar el dropdown directamente:
  // document.getElementById('eRegion')._lnDropdown.set('13')
  select._lnDropdown = instancia;

  return instancia;
}

export { crearDropdown, mejorarSelect };
