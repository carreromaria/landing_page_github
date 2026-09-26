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
let estilosBuscadorInyectados = false;

function asegurarEstilosBuscador() {
  if (estilosBuscadorInyectados) return;
  estilosBuscadorInyectados = true;
  const style = document.createElement('style');
  style.id = 'ln-dropdown-estilos-buscador';
  style.textContent = `
    .ln-dropdown-buscador-item{
      position: sticky; top: 0; z-index: 1;
      padding: 6px 8px 8px; margin: 0 0 2px;
      background: inherit;
      border-bottom: 1px solid rgba(0,0,0,.08);
      list-style: none;
    }
    .ln-dropdown-buscador{
      width: 100%; box-sizing: border-box;
      padding: 7px 10px; font: inherit; font-size: 13px;
      border: 1px solid rgba(0,0,0,.18); border-radius: 6px;
      outline: none; background: #fff; color: inherit;
    }
    .ln-dropdown-buscador:focus{ border-color: var(--gold, #D6A52C); }
  `;
  document.head.appendChild(style);
}

function crearDropdown(config) {
  const {
    contenedor,
    placeholder = 'Selecciona…',
    opciones: opcionesIniciales = [],
    opcionesAsync = null,
    valorInicial = '',
    ancho = 'auto', // 'auto' | 'full'
    deshabilitado = false,
    buscar = false, // true = agrega una cajita de búsqueda que filtra la lista en vivo
    placeholderBuscar = 'Buscar…',
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

  // Cajita de búsqueda: vive como primer <li> de la lista (así se porta a
  // body y se posiciona junto con el resto, sin lógica aparte), pero
  // pintarLista() nunca la toca al repintar las opciones — si no, se
  // perdería el foco y lo que el usuario va escribiendo.
  let inputBuscar = null;
  let terminoBusqueda = '';
  if (buscar) {
    asegurarEstilosBuscador();
    const liBuscar = document.createElement('li');
    liBuscar.className = 'ln-dropdown-buscador-item';
    inputBuscar = document.createElement('input');
    inputBuscar.type = 'text';
    inputBuscar.className = 'ln-dropdown-buscador';
    inputBuscar.placeholder = placeholderBuscar;
    inputBuscar.autocomplete = 'off';
    liBuscar.appendChild(inputBuscar);
    lista.appendChild(liBuscar);
  }

  raiz.appendChild(trigger);
  raiz.appendChild(lista);
  contenedor.appendChild(raiz);

  // La lista se abre "flotando" sobre TODO el documento (portal a
  // document.body) en vez de quedar encerrada dentro de raiz. Si no se
  // hiciera esto, un ancestro con scroll propio (ej. la tabla de ítems de
  // Cotizaciones, con overflow-x:auto para desplazarse de lado en
  // teléfono/tablet) le recorta la lista: por CSS, un contenedor con
  // overflow-x distinto de "visible" fuerza a overflow-y a "auto" aunque
  // nunca se haya pedido, así que cualquier hijo position:absolute que se
  // salga por abajo queda invisible. Al vivir en <body> con position:fixed
  // y coordenadas calculadas desde el trigger, la lista deja de depender
  // de ese recorte, esté donde esté el dropdown en la página.
  let listaEnBody = false;

  function posicionarLista() {
    const r = trigger.getBoundingClientRect();
    const anchoCompleto = ancho === 'full';
    lista.style.position = 'fixed';
    lista.style.margin = '0';
    if (anchoCompleto) {
      lista.style.left = r.left + 'px';
      lista.style.right = 'auto';
      lista.style.width = r.width + 'px';
      lista.style.minWidth = '';
    } else {
      lista.style.left = 'auto';
      lista.style.right = (window.innerWidth - r.right) + 'px';
      lista.style.width = '';
      lista.style.minWidth = Math.max(r.width, 190) + 'px';
    }
    // Si no cabe hacia abajo pero sí hacia arriba, se abre hacia arriba.
    const alturaLista = lista.offsetHeight || 260;
    const espacioAbajo = window.innerHeight - r.bottom;
    const espacioArriba = r.top;
    if (espacioAbajo < alturaLista + 12 && espacioArriba > espacioAbajo) {
      lista.style.top = Math.max(8, r.top - alturaLista - 6) + 'px';
    } else {
      lista.style.top = (r.bottom + 6) + 'px';
    }
  }

  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // sin tildes, para que "cotizacion" encuentre "Cotización"
  }

  function opcionesVisibles() {
    if (!buscar || !terminoBusqueda) return opciones;
    const termino = normalizar(terminoBusqueda);
    return opciones.filter(o => normalizar(o.texto).includes(termino));
  }

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
    // Nunca toca el <li> del buscador (si existe): solo sus <li> de opciones/estado.
    lista.querySelectorAll('li:not(.ln-dropdown-buscador-item)').forEach(li => li.remove());

    if (cargandoAsync) {
      lista.insertAdjacentHTML('beforeend', `<li class="ln-dropdown-estado">Cargando…</li>`);
      return;
    }
    if (!opciones.length) {
      lista.insertAdjacentHTML('beforeend', `<li class="ln-dropdown-estado">Sin opciones disponibles</li>`);
      return;
    }
    const visibles = opcionesVisibles();
    if (!visibles.length) {
      lista.insertAdjacentHTML('beforeend', `<li class="ln-dropdown-estado">Sin resultados para tu búsqueda</li>`);
      return;
    }
    lista.insertAdjacentHTML('beforeend', visibles.map((op) => `
      <li role="option"
          data-valor="${String(op.valor).replace(/"/g, '&quot;')}"
          aria-selected="${String(op.valor) === String(valorActual)}"
          class="${String(op.valor) === String(valorActual) ? 'seleccionado' : ''}${op.deshabilitado ? ' deshabilitada' : ''}">
        ${op.texto}
      </li>
    `).join(''));
  }

  async function abrir() {
    if (raiz.classList.contains('ln-dropdown--deshabilitado')) return;
    abierto = true;
    raiz.classList.add('abierto');
    trigger.setAttribute('aria-expanded', 'true');
    indiceResaltado = opciones.findIndex(o => String(o.valor) === String(valorActual));

    if (!listaEnBody) {
      document.body.appendChild(lista);
      lista.classList.add('ln-dropdown-lista--flotante');
      listaEnBody = true;
    }
    lista.hidden = false;
    if (inputBuscar) {
      inputBuscar.value = '';
      terminoBusqueda = '';
    }
    pintarLista();
    posicionarLista();
    window.addEventListener('scroll', posicionarLista, true);
    window.addEventListener('resize', posicionarLista);

    if (opcionesAsync) {
      cargandoAsync = true;
      pintarLista();
      posicionarLista();
      try {
        opciones = (await opcionesAsync()) || [];
      } catch (err) {
        console.error('Error cargando opciones del dropdown:', err);
        opciones = [];
      }
      cargandoAsync = false;
      pintarLista();
      posicionarLista();
    }
    resaltar(indiceResaltado);
    if (inputBuscar) setTimeout(() => inputBuscar.focus(), 0);
  }

  function cerrar() {
    abierto = false;
    lista.hidden = true;
    raiz.classList.remove('abierto');
    trigger.setAttribute('aria-expanded', 'false');
    indiceResaltado = -1;
    window.removeEventListener('scroll', posicionarLista, true);
    window.removeEventListener('resize', posicionarLista);
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

  if (inputBuscar) {
    inputBuscar.addEventListener('input', () => {
      terminoBusqueda = inputBuscar.value;
      pintarLista();
      resaltar(0);
      posicionarLista();
    });
    inputBuscar.addEventListener('keydown', (e) => {
      const items = lista.querySelectorAll('li[data-valor]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        resaltar(Math.min(indiceResaltado + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        resaltar(Math.max(indiceResaltado - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const li = items[indiceResaltado];
        if (li && !li.classList.contains('deshabilitada')) {
          seleccionar(li.dataset.valor);
          cerrar();
          trigger.focus();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cerrar();
        trigger.focus();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!raiz.contains(e.target) && !lista.contains(e.target)) cerrar();
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
    destruir() {
      window.removeEventListener('scroll', posicionarLista, true);
      window.removeEventListener('resize', posicionarLista);
      raiz.remove();
      lista.remove();
    },
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
    buscar: config.buscar || false,
    placeholderBuscar: config.placeholderBuscar || 'Buscar…',
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
