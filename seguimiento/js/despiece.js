// ===== LINENCE · Módulo Despiece =====
import { observarSesionStaff, cerrarSesion } from './auth.js';
import { listarTiposProyectoActivos, listarServiciosActivos, obtenerProyecto, listarUsuariosStaff, obtenerDespiece, buscarDespiecePorLead, guardarDespiece as fsGuardar, marcarAvanceDespiece, listarDespiecesAsignados, obtenerLead } from './firestore.js';

const PALETA = [
  {id:'blanco',n:'Blanco',h:'#f2efe9'},{id:'marfil',n:'Marfil',h:'#e6dcc8'},
  {id:'gres',n:'Gres',h:'#a89f94'},{id:'roble',n:'Roble',h:'#b88a56'},
  {id:'nogal',n:'Nogal',h:'#6b4a33'},{id:'grafito',n:'Grafito',h:'#4a4744'},
  {id:'negro',n:'Negro',h:'#141213'},{id:'dorado',n:'Dorado',h:'#d6a52c'}
];
const PIEZAS = [
  {k:'lat',n:'Lateral exterior'},{k:'techo',n:'Techo interior'},{k:'piso',n:'Piso interior'},
  {k:'barra',n:'Barra de fijación'},{k:'bandeja',n:'Bandeja'},{k:'puerta',n:'Puerta'}
];
const q = new URLSearchParams(location.search);
let MODO_TALLER = false; // se define por el rol del usuario (taller); la seguridad real va en firestore.rules
let STAFF = null, DOC_ID = null;
const $ = id => document.getElementById(id);
const hex = id => (PALETA.find(c => c.id === id) || PALETA[0]).h;
const col = (m, k) => m.colores[k] || m.colores[String(k).replace(/^s\d+_/, '')] || 'blanco';
const nombreColor = id => (PALETA.find(c => c.id === id) || PALETA[0]).n;
const cm = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function moduloNuevo(n) {
  return {id:'m' + Date.now() + Math.floor(Math.random() * 99), nombre:'Módulo ' + n,
    ancho:60, alto:53.5, prof:33, espI:1.5, espD:1.5, barra:6, recI:0, recD:0, golas:[], golaSup:0, paralEsp:1.5, secciones:[], divisiones:[], puertas:2, juego:0.5, sobre:0, manilla:'si',
    colores:{lat:'blanco',techo:'blanco',piso:'blanco',barra:'blanco',bandeja:'blanco',gola:'blanco',rec:'blanco',puerta:'gres'},
    vistas:{f:'Vista frontal (con puertas)',i:'Vista frontal interior (sin puertas)',l:'Vista lateral',p:'Perspectiva',s:'Vista superior (barra)'},
    fondo:'si', fondoTipo:'sobrepuesto', fondoEsp:0.3, categoriaCodigo:'', categoriaNombre:'', subcategoriaId:'', subcategoriaNombre:'', plantilla:'', notas:'', subtitulo:'Plano constructivo, medidas y despiece', avance:{}};
}
// ===== Plantillas de despiece: cada mueble tiene su propia receta =====
// Se agregan aquí a medida que María indica cómo se construye cada mueble.
const PLANTILLAS = {
  aereo: {nombre:'Mueble aéreo', claves:['aereo']},
  bajo:  {nombre:'Mueble bajo', claves:['bajo']}
};
const DEFECTOS = {
  aereo: {ancho:60, alto:53.5, prof:33, espI:1.5, espD:1.5, recI:0, recD:0, barra:6, puertas:2, juego:0.5, sobre:0, golas:[]},
  bajo:  {ancho:120, alto:80.5, prof:58, espI:1.5, espD:1.5, recI:0.3, recD:0.3, barra:6, golaSup:0, paralEsp:1.5, secciones:[{ancho:null, puertas:2, elementos:[]}], puertas:2, juego:0.5, sobre:0, golas:[]}
};
const anchoInt = m => m.ancho - (m.espI + (m.recI || 0)) - (m.espD + (m.recD || 0));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plantillaPara = nombre => Object.entries(PLANTILLAS).find(([, p]) => p.claves.some(c => norm(nombre).includes(c)))?.[0] || '';
let TIPOS = [], CATALOGO = [];
let D = {nombre:'', codigo:q.get('codigo') || '', leadOrigenId:q.get('lead') || '', asignadoA:'', modulos:[moduloNuevo(1)], avance:{}};
let idx = 0;
const M = () => D.modulos[idx];

// ===== CAPA DE DATOS (Firestore, colección `despieces`) =====
const idDoc = () => D.codigo || (D.leadOrigenId ? 'lead_' + D.leadOrigenId : null);
async function cargarDespiece() {
  try {
    let d = null;
    if (q.get('id')) d = await obtenerDespiece(q.get('id'));
    else if (D.codigo) d = await obtenerDespiece(D.codigo);
    if (!d && D.leadOrigenId) d = await buscarDespiecePorLead(D.leadOrigenId);
    if (d) { DOC_ID = d.id; D = {...D, ...d, avance: d.avance || {}}; D.modulos.forEach(m => { if (m.plantilla === undefined) m.plantilla = 'aereo'; // módulos anteriores: eran el aéreo
    if (!m.categoriaCodigo) m.categoriaCodigo = ''; if (!m.subcategoriaNombre) m.subcategoriaNombre = ''; if (!m.divisiones) m.divisiones = Array.from({length: +m.bandejas || 0}, () => +m.altBandeja || 15); m.colores = {bandeja:'blanco', gola:'blanco', rec:'blanco', ...m.colores}; m.fondo = m.fondo || 'no'; m.fondoTipo = m.fondoTipo || 'sobrepuesto'; m.fondoEsp = m.fondoEsp ?? 0.3; m.golas = m.golas || []; m.golaSup = m.golaSup || 0; m.paralEsp = m.paralEsp ?? 1.5; if (m.plantilla === 'bajo' && !m.secciones) m.secciones = [{ancho:null, puertas:+m.puertas || 0, golas:m.golas, divisiones:m.divisiones || []}];
    (m.secciones || []).forEach(s => { if (!s.elementos) s.elementos = (s.golas || []).map(a => ({t:'gola', sep:0, alto:+a || 0})).concat((s.divisiones || []).map(d => ({t:'bandeja', sep:+d || 0}))); }); m.recI = m.recI || 0; m.recD = m.recD || 0; m.vistas = {s:'Vista superior (barra)', ...m.vistas}; if (m.espI == null) m.espI = m.esp ?? 1.5; if (m.espD == null) m.espD = m.esp ?? 1.5; }); }
    else if (D.leadOrigenId) { const l = await obtenerLead(D.leadOrigenId); if (l) D.nombre = D.nombre || l.nombre || ''; }
  } catch (e) { console.error(e); $('dpEstado').textContent = 'No se pudo cargar el despiece'; }
}
async function guardarDespiece() {
  const id = DOC_ID || idDoc();
  if (!id) { alert('Indica el código LIN del proyecto o abre el despiece desde el lead.'); return false; }
  try {
    const {id: _x, actualizadoEn, _origenNombre, ...datos} = D;
    await fsGuardar(id, datos, STAFF?.uid); DOC_ID = id; return true;
  } catch (e) { console.error(e); return false; }
}

// ===== Datos que vienen del sistema (CRM / Proyecto / Usuarios) =====
async function traerOrigen() {
  if (MODO_TALLER) return;
  try {
    let leadId = D.leadOrigenId, nombre = '';
    D.tipoProyectoCodigo = D.tipoProyectoCodigo || '';
    if (D.codigo) {
      const p = await obtenerProyecto(D.codigo);
      if (p) { nombre = p.cliente || ''; D.tipoProyectoCodigo = p.tipoProyectoCodigo || D.tipoProyectoCodigo; leadId = leadId || p.leadOrigenId || ''; }
    }
    if (leadId) { const l = await obtenerLead(leadId); if (l) { D.tipoProyectoCodigo = D.tipoProyectoCodigo || l.tipoProyectoCodigo || ''; D.leadOrigenId = leadId; nombre = l.nombre || nombre; if (!D.codigo && l.proyectoVinculado) D.codigo = l.proyectoVinculado; } }
    if (nombre) D.nombre = nombre;
    D._origenNombre = !!nombre;
  } catch (e) { console.error(e); }
}
async function poblarListas() {
  if (MODO_TALLER) return;
  try { [TIPOS, CATALOGO] = await Promise.all([listarTiposProyectoActivos(), listarServiciosActivos()]); } catch (e) { console.error(e); }
  D.modulos.forEach(m => { if (!m.categoriaCodigo && !m.subcategoriaId && D.tipoProyectoCodigo) aplicarCategoria(m, D.tipoProyectoCodigo); });
}
function aplicarCategoria(m, codigo) {
  m.categoriaCodigo = codigo; m.categoriaNombre = TIPOS.find(t => t.codigo === codigo)?.nombre || m.categoriaNombre || '';
}
async function poblarUsuarios() {
  const sel = $('pAsignado'); let us = [];
  if (!MODO_TALLER) { try { us = await listarUsuariosStaff(); } catch (e) { console.error(e); } }
  us.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  sel.innerHTML = '<option value="">Sin asignar</option>' + us.filter(u => u.email).map(u => `<option value="${esc(u.email)}">${esc(u.nombre || u.email)}${u.rol ? ' · ' + esc(u.rol) : ''}</option>`).join('');
  if (D.asignadoA && !us.some(u => u.email === D.asignadoA)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(D.asignadoA)}">${esc(D.asignadoA)}</option>`);
  sel.value = D.asignadoA || '';
}

// ===== Cálculo de piezas =====
function calcular(m) {
  if (!m.plantilla) return [];
  const p = m.plantilla === 'bajo' ? calcularBajo(m) : calcularAereo(m);
  if (m.fondo === 'si') {
    const eT = Math.min(m.espI, m.espD), emb = m.fondoTipo === 'embutido', iw = m.plantilla === 'bajo' ? anchoInt(m) : m.ancho - m.espI - m.espD;
    const f = emb ? {a:iw, b:m.alto - (m.plantilla === 'bajo' ? eT : 2 * eT)} : {a:m.ancho, b:m.alto};
    const i = p.findIndex(x => /puerta$/.test(x.k)); p.splice(i < 0 ? p.length : i, 0, {k:'fondo', n:'Fondo (ancho × alto)', c:1, ...f});
  }
  return p;
}
function anchosSecciones(m) {
  const ns = m.secciones.length, tot = anchoInt(m) - m.paralEsp * (ns - 1);
  const typed = m.secciones.slice(0, -1).map(s => +s.ancho || 0);
  return [...typed, tot - typed.reduce((a, b) => a + b, 0)];
}
function layoutSec(m, s) {
  const eP = Math.min(m.espI, m.espD), zona = m.alto - eP - m.barra - m.golaSup; let c = 0, topGola = 0; const out = [];
  s.elementos.forEach(e => { c += +e.sep || 0; const h = e.t === 'gola' ? (+e.alto || 0) : eP; const ok = c + h <= zona + 1e-6; out.push({t:e.t, bottom:c, top:c + h, ok}); if (ok && e.t === 'gola') topGola = Math.max(topGola, c + h); c += h; });
  return {out, zona, libre:zona - c, topGola};
}
// Las puertas de una sección sin golas terminan donde empiezan los cajones de las secciones vecinas.
function refPuerta(m) {
  return Math.max(0, ...m.secciones.map(sc => { const g = layoutSec(m, sc).out.filter(o => o.ok && o.t === 'gola'); return g.length ? Math.max(...g.map(o => o.bottom)) : 0; }));
}
function calcularBajo(m) {
  const iw = anchoInt(m), eP = Math.min(m.espI, m.espD), ns = m.secciones.length, an = anchosSecciones(m), sec = ns > 1;
  const p = [
    {k:'piso',n:'Piso',c:1,a:m.ancho,b:m.prof},
    {k:'lat',n:'Lateral',c:2,a:m.alto - eP,b:m.prof}
  ];
  const nr = (m.recI > 0) + (m.recD > 0);
  if (nr) p.push({k:'rec',n:'Lateral de recubrimiento',c:nr,a:m.alto,b:m.prof});
  if (m.barra > 0) p.push({k:'barra',n:'Listón de fijación',c:1,a:iw,b:m.barra});
  if (m.golaSup > 0) p.push({k:'golaSup',n:'Gola superior',c:1,a:iw,b:m.golaSup});
  if (ns > 1) p.push({k:'paral',n:'Paral',c:ns - 1,a:m.alto - eP - m.barra - m.golaSup,b:m.prof});
  m.secciones.forEach((s, i) => {
    const t = sec ? ' · Sección ' + (i + 1) : '', ln = (x) => sec ? 'Sección ' + (i + 1) + ' · ' + x : x, L = layoutSec(m, s);
    let ng = 0; s.elementos.filter(e => e.t === 'gola').forEach(e => p.push({k:`s${i + 1}_gola`,lbl:ln('Gola'),n:'Gola ' + (++ng) + t,c:1,a:an[i],b:+e.alto || 0}));
    const nb = s.elementos.filter(e => e.t === 'bandeja').length;
    if (nb) p.push({k:`s${i + 1}_bandeja`,lbl:ln('Bandeja'),n:'Bandeja' + t,c:nb,a:an[i],b:m.prof});
    if (+s.puertas > 0) {
      const izq = i === 0 ? m.espI + m.recI : m.paralEsp / 2, der = i === ns - 1 ? m.espD + m.recD : m.paralEsp / 2;
      p.push({k:`s${i + 1}_puerta`,lbl:ln('Puerta'),n:'Puerta' + t,c:+s.puertas,a:m.alto - m.golaSup - (L.topGola > 0 ? eP + L.topGola : (refPuerta(m) > 0 ? eP + refPuerta(m) : 0)) - 2 * m.juego,b:(an[i] + izq + der) / s.puertas - m.juego,puerta:true});
    }
  });
  return p;
}
function calcularAereo(m) {
  const iw = m.ancho - m.espI - m.espD, n = +m.puertas || 0;
  const p = [
    {k:'lat',n:'Lateral exterior',c:2,a:m.alto,b:m.prof},
    {k:'techo',n:'Techo interior',c:1,a:iw,b:m.prof},
    {k:'piso',n:'Piso interior',c:1,a:iw,b:m.prof},
    {k:'barra',n:'Barra de fijación',c:1,a:iw,b:m.barra}
  ].filter(x => x.b > 0);
  if (m.divisiones.length > 0) p.splice(4, 0, {k:'bandeja',n:'Bandeja',c:m.divisiones.length,a:iw,b:m.prof});
  if (n > 0) p.push({k:'puerta',n:'Puerta',c:n,
    a:m.sobre > 0 ? m.alto + m.sobre : m.alto - 2 * m.juego, b:m.ancho / n - m.juego, puerta:true});
  return p;
}

// ===== Dibujo SVG =====
const W = 260, H = 230;
function dimH(x1, x2, y, t) { return `<g stroke="#141213" stroke-width=".8" fill="#141213"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y-3}" x2="${x1}" y2="${y+3}"/><line x1="${x2}" y1="${y-3}" x2="${x2}" y2="${y+3}"/><text x="${(x1+x2)/2}" y="${y-4}" font-size="10" text-anchor="middle" stroke="none" font-family="Poppins,sans-serif">${t} cm</text></g>`; }
function dimV(y1, y2, x, t) { return `<g stroke="#141213" stroke-width=".8" fill="#141213"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x-3}" y1="${y1}" x2="${x+3}" y2="${y1}"/><line x1="${x-3}" y1="${y2}" x2="${x+3}" y2="${y2}"/><text transform="translate(${x-5},${(y1+y2)/2}) rotate(-90)" font-size="10" text-anchor="middle" stroke="none" font-family="Poppins,sans-serif">${t} cm</text></g>`; }
const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(c)}" stroke="#141213" stroke-width=".8"/>`;
const escala = (w, h) => Math.min((W - 70) / w, (H - 60) / h);

function svgFrontal(m, interior) {
  const s = escala(m.ancho, m.alto), w = m.ancho * s, h = m.alto * s, x = (W - w) / 2 + 8, y = 34, eI = m.espI * s, eD = m.espD * s, c = m.colores;
  let g = '';
  if (interior) {
    g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${m.fondo === 'si' ? hex(col(m, 'fondo')) : '#fff'}" stroke="#141213" stroke-width=".8"/>`;
    const eT = Math.min(eI, eD); g += R(x, y, eI, h, c.lat) + R(x + w - eD, y, eD, h, c.lat) + R(x + eI, y, w - eI - eD, eT, c.techo) + R(x + eI, y + h - eT, w - eI - eD, eT, c.piso);
    if (m.barra > 0) g += R(x + eI, y + eT, w - eI - eD, m.barra * s, c.barra);
    const eTcm = Math.min(m.espI, m.espD);
    let nivel = 0; // cm desde el piso interior hasta el inicio del espacio actual
    m.divisiones.forEach((d, i) => {
      const fondo = nivel + d; if (fondo + eTcm > m.alto - 2 * eTcm) return; // no cabe: no se dibuja
      g += R(x + eI, y + h - eT - fondo * s - eT, w - eI - eD, eT, c.bandeja);
      g += dimV(y + h - eT - fondo * s, y + h - eT - nivel * s, x + w + 14, cm(d));
      nivel = fondo + eTcm;
    });
    g += dimH(x + eI, x + w - eD, y + h + 16, cm(m.ancho - m.espI - m.espD));
  } else {
    const n = +m.puertas || 0, so = m.sobre * s;
    if (n === 0) g += R(x, y, w, h, c.lat);
    for (let i = 0; i < n; i++) g += R(x + i * w / n + 0.5, y, w / n - 1, h + so, c.puerta);
    g += dimH(x, x + w, y + h + 16, cm(m.ancho));
  }
  g += dimH(x, x + w, y - 8, cm(m.ancho)) + dimV(y, y + h, x - 14, cm(m.alto));
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
function txt(x, y, t, a) { return `<text x="${x}" y="${y}" font-size="9" text-anchor="${a || 'middle'}" fill="#141213" font-family="Poppins,sans-serif">${t}</text>`; }
function frenteBajo(m, x, y, s) {
  const C = k => col(m, k), w = m.ancho * s, h = m.alto * s, eP = Math.min(m.espI, m.espD) * s, rI = m.recI * s, rD = m.recD * s, eI = m.espI * s, eD = m.espD * s;
  const an = anchosSecciones(m), pe = m.paralEsp * s, yZ = y + m.golaSup * s, piso = y + h - eP, ref = refPuerta(m); let g = '', sx = x;
  m.secciones.forEach((sc, i) => {
    const izq = i === 0 ? rI + eI : pe / 2, der = i === m.secciones.length - 1 ? rD + eD : pe / 2, sp = Math.max(an[i], 0) * s + izq + der;
    const L = layoutSec(m, sc), n = +sc.puertas || 0;
    L.out.forEach(o => { if (o.ok && o.t === 'gola') g += R(sx, piso - o.top * s, sp, (o.top - o.bottom) * s, C(`s${i + 1}_gola`)); });
    const yb = L.topGola > 0 ? piso - L.topGola * s : (ref > 0 ? piso - ref * s : y + h), hd = Math.max(yb - yZ, 0);
    for (let k = 0; k < n; k++) g += R(sx + k * sp / n + .5, yZ, sp / n - 1, hd, C(`s${i + 1}_puerta`));
    sx += sp;
  });
  if (m.golaSup > 0) g += R(x, y, w, m.golaSup * s, C('golaSup'));
  return g;
}
function svgFrontalBajo(m, interior) {
  const s = escala(m.ancho, m.alto), w = m.ancho * s, h = m.alto * s, x = (W - w) / 2 + 8, y = 34, C = k => col(m, k);
  const eP = Math.min(m.espI, m.espD) * s, rI = m.recI * s, rD = m.recD * s, eI = m.espI * s, eD = m.espD * s, iw = anchoInt(m) * s, x0 = x + rI + eI;
  const an = anchosSecciones(m), pe = m.paralEsp * s, yZ = y + (interior ? (m.barra + m.golaSup) * s : m.golaSup * s), piso = y + h - eP;
  let g = '';
  if (interior) {
    g += `<rect x="${x0}" y="${y}" width="${iw}" height="${h - eP}" fill="${m.fondo === 'si' ? hex(col(m, 'fondo')) : '#fff'}" stroke="#141213" stroke-width=".8"/>` + R(x, piso, w, eP, C('piso'));
    if (rI) g += R(x, y, rI, h, C('rec')); g += R(x + rI, y, eI, h - eP, C('lat')) + R(x + w - rD - eD, y, eD, h - eP, C('lat')); if (rD) g += R(x + w - rD, y, rD, h, C('rec'));
    if (m.barra > 0) g += R(x0, y, iw, m.barra * s, C('barra'));
    if (m.golaSup > 0) g += R(x0, y + m.barra * s, iw, m.golaSup * s, C('golaSup'));
    let sx = x0;
    m.secciones.forEach((sc, i) => {
      const sw = Math.max(an[i], 0) * s, L = layoutSec(m, sc);
      L.out.forEach(o => { if (!o.ok) return; g += o.t === 'gola' ? R(sx, piso - o.top * s, sw, (o.top - o.bottom) * s, C(`s${i + 1}_gola`)) : R(sx, piso - o.top * s, sw, (o.top - o.bottom) * s, C(`s${i + 1}_bandeja`)); });
      sx += sw;
      if (i < m.secciones.length - 1) { g += R(sx, yZ, pe, piso - yZ, C('paral')); sx += pe; }
    });
    g += dimH(x0, x0 + iw, y + h + 16, cm(anchoInt(m)));
  } else {
    g += frenteBajo(m, x, y, s);
    g += dimH(x, x + w, y + h + 16, cm(m.ancho));
  }
  g += dimH(x, x + w, y - 8, cm(m.ancho)) + dimV(y, y + h, x - 14, cm(m.alto));
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
function svgSuperior(m) {
  const s = escala(m.ancho, m.prof), w = m.ancho * s, h = m.prof * s, x = (W - w) / 2 + 8, y = 34, C = k => col(m, k);
  const eI = m.espI * s, eD = m.espD * s, rI = m.recI * s, rD = m.recD * s, iw = anchoInt(m) * s, eP = Math.min(m.espI, m.espD) * s, pe = m.paralEsp * s, an = anchosSecciones(m);
  let g = R(x + rI + eI, y, iw, h, 'blanco').replace('stroke-width=".8"', 'stroke-width=".4" stroke-dasharray="3 2"');
  if (rI) g += R(x, y, rI, h, C('rec')); g += R(x + rI, y, eI, h, C('lat')) + R(x + w - rD - eD, y, eD, h, C('lat')); if (rD) g += R(x + w - rD, y, rD, h, C('rec'));
  let sx = x + rI + eI; m.secciones.forEach((sc, i) => { sx += Math.max(an[i], 0) * s; if (i < m.secciones.length - 1) { g += R(sx, y, pe, h, C('paral')); sx += pe; } });
  if (m.barra > 0) g += R(x + rI + eI, y, iw, eP, C('barra')) + txt(x + w / 2, y + eP + 11, 'Listón de fijación ' + cm(anchoInt(m)) + ' × ' + cm(m.barra) + ' cm');
  g += dimH(x, x + w, y - 8, cm(m.ancho)) + dimV(y, y + h, x - 14, cm(m.prof)) + txt(x + w / 2, y + h + 14, 'Parte trasera arriba · frente abajo');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
function svgLateral(m) {
  const s = escala(m.prof, m.alto), w = m.prof * s, h = m.alto * s, x = (W - w) / 2 + 8, y = 34;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${R(x, y, w, h, m.colores.lat)}${dimH(x, x + w, y - 8, cm(m.prof))}${dimV(y, y + h, x - 14, cm(m.alto))}</svg>`;
}
function svgPersp(m) {
  const k = 0.42, s = Math.min((W - 80) / (m.ancho + m.prof * k), (H - 70) / (m.alto + m.prof * k));
  const w = m.ancho * s, h = m.alto * s, dx = m.prof * s * k, dy = m.prof * s * k * 0.8, x = 20, y = 40 + dy, c = m.colores, n = m.plantilla === 'bajo' ? m.secciones.length : (+m.puertas || 0), cp = col(m, m.plantilla === 'bajo' ? 's1_puerta' : 'puerta');
  const poly = (pts, col) => `<polygon points="${pts}" fill="${hex(col)}" stroke="#141213" stroke-width=".8"/>`;
  let g = poly(`${x},${y} ${x+w},${y} ${x+w+dx},${y-dy} ${x+dx},${y-dy}`, m.plantilla === 'bajo' ? c.lat : c.techo) + poly(`${x+w},${y} ${x+w+dx},${y-dy} ${x+w+dx},${y+h-dy} ${x+w},${y+h}`, c.lat);
  if (m.plantilla === 'bajo') g += R(x, y, w, h, 'blanco') + frenteBajo(m, x, y, s);
  else { if (n === 0) g += R(x, y, w, h, c.lat); for (let i = 0; i < n; i++) g += R(x + i * w / n + .5, y, w / n - 1, h + m.sobre * s, cp); }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}

// ===== Hoja del documento =====
function vistasHtml(m) {
  const v = (t, svg) => `<div class="dp-v"><h4>${esc(t)}</h4>${svg}</div>`;
  if (m.plantilla === 'bajo') return v(m.vistas.f, svgFrontalBajo(m, false)) + v(m.vistas.i, svgFrontalBajo(m, true)) + v(m.vistas.l, svgLateral(m)) + v(m.vistas.p, svgPersp(m)) + v(m.vistas.s || 'Vista superior (barra)', svgSuperior(m));
  return v(m.vistas.f, svgFrontal(m, false)) + v(m.vistas.i, svgFrontal(m, true)) + v(m.vistas.l, svgLateral(m)) + v(m.vistas.p, svgPersp(m));
}
const rutaMueble = m => [m.categoriaNombre, m.subcategoriaNombre].filter(Boolean).map(esc).join(' › ');
function hojaModulo(m, i) {
  if (!m.plantilla) return `<div class="${i ? 'dp-mod-sep' : ''}"><div class="dp-cab"><div><b>${esc(m.nombre)} – ${esc(D.nombre || 'Proyecto')}</b><small>${rutaMueble(m) || 'Sin categoría'}</small></div><div class="dp-marca">LINENCE</div></div><p class="dp-vacio">${m.subcategoriaId ? `El despiece de «${esc(m.subcategoriaNombre)}» aún no está configurado.` : 'Elige la categoría y el mueble (subcategoría) para ver su plano y despiece.'}</p></div>`;
  const EDIT = MODO_TALLER ? '' : 'contenteditable="true" spellcheck="false"';
  const pz = calcular(m), conPuertas = +m.puertas > 0;
  const filas = pz.map(p => `<tr><td><span class="dot" style="background:${hex(col(m, p.k))}"></span>${p.n}</td><td>${p.c}</td><td>${cm(p.a)} × ${cm(p.b)}</td><td>${nombreColor(col(m, p.k))}</td><td class="col-listo"><input type="checkbox" data-av="${m.id}|${p.k}" ${D.avance?.[m.id + '_' + p.k] ? 'checked' : ''}></td></tr>`).join('');
  const puerta = pz.find(p => p.puerta);
  return `<div class="${i ? 'dp-mod-sep' : ''}">
  <div class="dp-cab"><div><b><span class="dp-edit" ${EDIT} data-mod="${m.id}" data-f="nombre" title="Clic para renombrar">${esc(m.nombre)}</span> – ${esc(D.nombre || 'Proyecto')}</b><small><span class="dp-edit" ${EDIT} data-mod="${m.id}" data-f="subtitulo" title="Clic para editar">${esc(m.subtitulo || 'Plano constructivo, medidas y despiece')}</span>${rutaMueble(m) ? ' · ' + rutaMueble(m) : ''}${D.codigo ? ' · ' + esc(D.codigo) : ''}</small></div><div class="dp-marca">LINENCE</div></div>
  <div class="dp-vistas">${vistasHtml(m)}</div>
  <div class="dp-datos">
    <div><h3>Medidas generales</h3><table><tr><td>Ancho</td><td>${cm(m.ancho)} cm</td></tr><tr><td>Alto</td><td>${cm(m.alto)} cm</td></tr><tr><td>Fondo</td><td>${cm(m.prof)} cm</td></tr>${m.fondo === 'si' ? `<tr><td>Fondo</td><td>${m.fondoTipo === 'embutido' ? 'Embutido' : 'Sobrepuesto'} · ${cm(m.fondoEsp * 10)} mm</td></tr>` : ''}<tr><td>Melamina</td><td>${m.espI === m.espD ? cm(m.espI * 10) + ' mm' : 'Izq. ' + cm(m.espI * 10) + ' mm · Der. ' + cm(m.espD * 10) + ' mm'}</td></tr>${m.plantilla === 'bajo' ? `${m.recI > 0 || m.recD > 0 ? `<tr><td>Recubrimiento</td><td>Izq. ${cm(m.recI * 10)} mm · Der. ${cm(m.recD * 10)} mm</td></tr>` : ''}<tr><td>Ancho interior</td><td>${cm(anchoInt(m))} cm</td></tr><tr><td>Secciones</td><td>${m.secciones.length} · anchos ${anchosSecciones(m).map(cm).join(' / ')} cm</td></tr>${m.golaSup > 0 ? `<tr><td>Gola superior</td><td>${cm(m.golaSup)} cm de alto</td></tr>` : ''}${m.secciones.length > 1 ? `<tr><td>Paral</td><td>${cm(m.paralEsp * 10)} mm</td></tr>` : ''}` : ''}${m.plantilla !== 'bajo' && m.divisiones.length ? `<tr><td>Bandejas</td><td>${m.divisiones.length} u. · divisiones ${m.divisiones.map(cm).join(' / ')} cm</td></tr>` : ''}${conPuertas ? `<tr><td>Puerta</td><td>${cm(puerta.a)} × ${cm(puerta.b)} cm (${m.puertas} u.)</td></tr>` : ''}${m.sobre > 0 ? `<tr><td>Sobresale</td><td>${cm(m.sobre)} cm</td></tr>` : ''}${conPuertas ? `<tr><td>Manilla</td><td>${m.manilla === 'si' ? 'Con manilla' : 'Sin manilla'}</td></tr>` : ''}</table></div>
    <div><h3>Despiece (medidas de fabricación, cm)</h3><table><tr><th>Pieza</th><th>Cant.</th><th>Medidas</th><th>Color</th><th class="col-listo">Listo</th></tr>${filas}</table></div>
  </div>
  ${m.notas ? `<div class="dp-notas"><b>Notas</b>\n${esc(m.notas)}</div>` : ''}</div>`;
}
function pintarHoja() { $('dpHoja').innerHTML = D.modulos.map(hojaModulo).join(''); }

// ===== Panel editor =====
const CAMPOS = {mNombre:'nombre', mAncho:'ancho', mAlto:'alto', mProf:'prof', mEspI:'espI', mEspD:'espD', mRecI:'recI', mRecD:'recD', mFondo:'fondo', mFondoTipo:'fondoTipo', mFondoEsp:'fondoEsp', mGolaSup:'golaSup', mParalEsp:'paralEsp', mBarra:'barra', mPuertas:'puertas', mJuego:'juego', mSobre:'sobre', mManilla:'manilla', mNotas:'notas'};
function pintarEditor() {
  $('pNombre').value = D.nombre; $('pNombre').readOnly = !!D._origenNombre; $('pCodigo').readOnly = !!q.get('codigo') || !!(D.codigo && D._origenNombre); $('pLead').readOnly = !!D.leadOrigenId && !!D._origenNombre; $('pCodigo').value = D.codigo; $('pLead').value = D.leadOrigenId; if ($('pAsignado').value !== (D.asignadoA || '')) $('pAsignado').value = D.asignadoA || '';
  $('dpTabs').innerHTML = D.modulos.map((m, i) => `<button class="dp-tab ${i === idx ? 'on' : ''}" data-i="${i}">${esc(m.nombre)}</button>`).join('') + '<button class="dp-tab" data-i="+">+ Módulo</button>';
  $('mCat').innerHTML = '<option value="">Selecciona categoría</option>' + TIPOS.map(t => `<option value="${esc(t.codigo)}">${esc(t.nombre)}</option>`).join('');
  if (M().categoriaCodigo && !TIPOS.some(t => t.codigo === M().categoriaCodigo)) $('mCat').insertAdjacentHTML('beforeend', `<option value="${esc(M().categoriaCodigo)}">${esc(M().categoriaNombre || M().categoriaCodigo)}</option>`);
  $('mCat').value = M().categoriaCodigo || '';
  const grupos = {}; CATALOGO.forEach(s => (grupos[s.categoria || 'Sin categoría'] ||= []).push(s));
  $('mSub').innerHTML = '<option value="">Selecciona el mueble</option>' + Object.entries(grupos).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('')}</optgroup>`).join('');
  if (M().subcategoriaId && !CATALOGO.some(s => s.id === M().subcategoriaId)) $('mSub').insertAdjacentHTML('beforeend', `<option value="${esc(M().subcategoriaId)}">${esc(M().subcategoriaNombre)}</option>`);
  $('mSub').value = M().subcategoriaId || '';
  $('mPlantillaInfo').textContent = M().plantilla ? 'Despiece: ' + PLANTILLAS[M().plantilla].nombre : (M().subcategoriaId ? 'Este mueble aún no tiene su despiece configurado.' : '');
  for (const [id, k] of Object.entries(CAMPOS)) $(id).value = M()[k];
  for (const k of ['f', 'i', 'l', 'p', 's']) $('v_' + k).value = M().vistas[k] || '';
  $('dpEditor').dataset.pl = M().plantilla || '';
  pintarBandejas(); pintarSecciones();
  const vistos = {}; calcular(M()).forEach(p => { if (!vistos[p.k]) vistos[p.k] = p.lbl || p.n; });
  $('dpColores').innerHTML = Object.entries(vistos).map(([k, nombre]) => `<div class="dp-pz"><span>${nombre}</span><div class="dp-sw">${PALETA.map(c => `<button title="${c.n}" data-pz="${k}" data-c="${c.id}" class="${col(M(), k) === c.id ? 'on' : ''}" style="background:${c.h}"></button>`).join('')}</div></div>`).join('');
}
function pintarSecciones() {
  const m = M(); if (m.plantilla !== 'bajo') { $('dpSecciones').innerHTML = ''; return; }
  const an = anchosSecciones(m), ns = m.secciones.length;
  $('dpSecciones').innerHTML = m.secciones.map((s, i) => {
    const ult = i === ns - 1, L = layoutSec(m, s); let ng = 0, nb = 0;
    const filas = s.elementos.map((e, k) => {
      const g = e.t === 'gola', n = g ? ++ng : ++nb, ok = L.out[k].ok;
      return `<div class="dp-el"><div class="dp-fila"><label>${g ? 'Gola (cajón)' : 'Bandeja'} ${n} · separación (cm)<input type="number" step="0.1" min="0" data-s="${i}" data-e="${k}" data-k="sep" value="${e.sep}"></label>${g ? `<label>Alto de la gola (cm)<input type="number" step="0.1" min="0.5" data-s="${i}" data-e="${k}" data-k="alto" value="${e.alto}"></label>` : '<span></span>'}</div><div class="dp-el-acc"><button class="dp-btn dp-sec" data-mv="up" data-s="${i}" data-e="${k}" title="Subir">▲</button><button class="dp-btn dp-sec" data-mv="down" data-s="${i}" data-e="${k}" title="Bajar">▼</button><button class="dp-btn dp-sec" data-del="el" data-s="${i}" data-e="${k}" title="Quitar">✕</button></div>${ok ? '' : '<small class="dp-aviso">No cabe en el alto de esta sección.</small>'}</div>`;
    }).join('');
    return `<div class="dp-sec-card"><div class="dp-sec-cab"><b>Sección ${i + 1}</b>${ns > 1 ? `<button class="dp-btn dp-sec" data-del="sec" data-s="${i}">Quitar sección</button>` : ''}</div>
    <div class="dp-fila"><label>Ancho libre (cm)${ult && ns > 1 ? ' · resto' : ''}<input type="number" step="0.1" min="1" data-s="${i}" data-k="ancho" value="${ult ? Math.round(an[i] * 10) / 10 : s.ancho}" ${ult ? 'readonly' : ''}></label><label>Puertas<input type="number" min="0" max="4" data-s="${i}" data-k="puertas" value="${s.puertas}"></label></div>
    ${an[i] <= 0 ? '<small class="dp-aviso">Los anchos no caben en el módulo.</small>' : ''}
    <small class="dp-nota">Se arma desde el piso hacia arriba. «Separación» es el espacio libre bajo la pieza. La gola es siempre un cajón o gaveta (no lleva puerta); las puertas cubren la parte de arriba.</small>${filas}
    <div class="dp-fila"><button class="dp-btn dp-sec" data-add="gola" data-s="${i}">+ Gola</button><button class="dp-btn dp-sec" data-add="bandeja" data-s="${i}">+ Bandeja</button></div>
    <small class="dp-nota">Alto útil de la sección: ${cm(L.zona)} cm · libre arriba: ${cm(Math.max(L.libre, 0))} cm</small></div>`;
  }).join('');
}
function pintarBandejas() {
  const m = M(), esT = Math.min(m.espI, m.espD), interior = m.alto - 2 * esT;
  let usado = 0, html = '';
  m.divisiones.forEach((d, i) => {
    usado += d + esT; const cabe = usado <= interior + 1e-6;
    html += `<div class="dp-div"><label>División ${i + 1} (cm)<input type="number" step="0.1" min="1" data-div="${i}" value="${d}"></label><button class="dp-btn dp-sec" data-quitar="${i}" title="Quitar bandeja ${i + 1}">✕</button></div>${cabe ? '' : '<small class="dp-aviso">Esta bandeja no cabe en el alto del módulo.</small>'}`;
  });
  const libre = interior - usado;
  $('dpBandejas').innerHTML = html + (m.divisiones.length ? `<small class="dp-nota">Espacio libre superior: ${cm(Math.max(libre, 0))} cm · cada división es el espacio libre bajo su bandeja.</small>` : '');
}
function enlaces() {
  const a = [];
  if (D.codigo) a.push(`<a href="dashboard.html?codigo=${encodeURIComponent(D.codigo)}">Proyecto</a>`);
  if (D.leadOrigenId) a.push(`<a href="crm.html?lead=${encodeURIComponent(D.leadOrigenId)}">Lead</a>`);
  if (D.codigo) a.push(`<a href="documentacion.html?codigo=${encodeURIComponent(D.codigo)}">Documentación</a>`);
  $('dpEnlaces').innerHTML = MODO_TALLER ? '' : a.join('');
  $('btnWsp').href = 'https://wa.me/?text=' + encodeURIComponent(`Despiece ${D.nombre || ''} ${D.codigo || ''}: ${location.href}`);
}
const refrescar = () => { pintarHoja(); enlaces(); };

// ===== Eventos =====
for (const [id, k] of Object.entries(CAMPOS)) $(id).addEventListener('input', e => {
  const num = e.target.type === 'number'; M()[k] = num ? (parseFloat(e.target.value) || 0) : e.target.value; refrescar();
  if (k === 'nombre') pintarEditor();
});
for (const k of ['f', 'i', 'l', 'p', 's']) $('v_' + k).addEventListener('input', e => { M().vistas[k] = e.target.value; refrescar(); });
[['pNombre', 'nombre'], ['pCodigo', 'codigo'], ['pLead', 'leadOrigenId'], ['pAsignado', 'asignadoA']].forEach(([id, k]) => $(id).addEventListener('input', e => { D[k] = e.target.value.trim(); refrescar(); }));
$('btnAddSec').addEventListener('click', () => {
  const m = M(), an = anchosSecciones(m), ult = m.secciones.length - 1;
  m.secciones[ult].ancho = Math.max(Math.round((an[ult] - m.paralEsp) / 2 * 10) / 10, 1);
  m.secciones.push({ancho:null, puertas:1, elementos:[]}); pintarEditor(); refrescar();
});
$('dpSecciones').addEventListener('input', e => {
  const t = e.target.dataset, m = M(); if (t.s == null || !t.k) return; const v = parseFloat(e.target.value) || 0, s = m.secciones[+t.s];
  if (t.e != null) s.elementos[+t.e][t.k] = v; else s[t.k] = v;
  refrescar();
});
$('dpSecciones').addEventListener('change', () => pintarEditor());
$('dpSecciones').addEventListener('click', e => {
  const b = e.target.closest('button'), m = M(); if (!b) return; const s = m.secciones[+b.dataset.s], k = +b.dataset.e;
  if (b.dataset.add === 'gola') s.elementos.push({t:'gola', sep:0, alto:20});
  else if (b.dataset.add === 'bandeja') s.elementos.push({t:'bandeja', sep:s.elementos.length ? 15 : 35});
  else if (b.dataset.del === 'el') s.elementos.splice(k, 1);
  else if (b.dataset.mv) { const d = b.dataset.mv === 'up' ? -1 : 1; if (k + d < 0 || k + d >= s.elementos.length) return; [s.elementos[k], s.elementos[k + d]] = [s.elementos[k + d], s.elementos[k]]; }
  else if (b.dataset.del === 'sec') { if (!confirm('¿Quitar esta sección?')) return; m.secciones.splice(+b.dataset.s, 1); m.secciones[m.secciones.length - 1].ancho = null; }
  else return;
  pintarEditor(); refrescar();
});
$('btnAddBandeja').addEventListener('click', () => { M().divisiones.push(M().divisiones.length ? 15 : 35); pintarEditor(); refrescar(); });
$('dpBandejas').addEventListener('input', e => { const i = e.target.dataset.div; if (i == null) return; M().divisiones[+i] = parseFloat(e.target.value) || 0; refrescar(); });
$('dpBandejas').addEventListener('change', () => pintarEditor());
$('dpBandejas').addEventListener('click', e => { const b = e.target.closest('[data-quitar]'); if (!b) return; M().divisiones.splice(+b.dataset.quitar, 1); pintarEditor(); refrescar(); });
$('dpTabs').addEventListener('click', e => { const i = e.target.dataset.i; if (i == null) return; if (i === '+') { D.modulos.push(moduloNuevo(D.modulos.length + 1)); idx = D.modulos.length - 1; } else idx = +i; pintarEditor(); refrescar(); });
$('dpColores').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; M().colores[b.dataset.pz] = b.dataset.c; pintarEditor(); refrescar(); });
$('mCat').addEventListener('change', e => { aplicarCategoria(M(), e.target.value); pintarEditor(); refrescar(); });
$('mSub').addEventListener('change', e => {
  const s = CATALOGO.find(x => x.id === e.target.value), m = M();
  const previa = m.plantilla; m.subcategoriaId = s?.id || ''; m.subcategoriaNombre = s?.nombre || ''; m.plantilla = s ? plantillaPara(s.nombre) : '';
  if (m.plantilla && m.plantilla !== previa) Object.assign(m, JSON.parse(JSON.stringify(DEFECTOS[m.plantilla])), {divisiones: []});
  if (s && /^Módulo \d+$/.test(m.nombre)) m.nombre = s.nombre;
  if (s && !m.categoriaCodigo) { const t = TIPOS.find(t => t.nombre === s.categoria); if (t) aplicarCategoria(m, t.codigo); }
  pintarEditor(); refrescar();
});
$('btnDuplicarMod').addEventListener('click', () => {
  const copia = JSON.parse(JSON.stringify(M()));
  copia.id = 'm' + Date.now() + Math.floor(Math.random() * 99);
  copia.nombre = (copia.nombre + ' (copia)').replace(/( \(copia\))+$/, ' (copia)');
  D.modulos.splice(idx + 1, 0, copia); idx += 1; pintarEditor(); refrescar();
  $('dpEstado').textContent = 'Módulo duplicado: cambia lo que necesites y guarda';
});
$('btnBorrarMod').addEventListener('click', () => { if (D.modulos.length < 2) return alert('El despiece necesita al menos un módulo.'); if (!confirm('¿Quitar este módulo del despiece?')) return; D.modulos.splice(idx, 1); idx = 0; pintarEditor(); refrescar(); });
$('dpHoja').addEventListener('input', e => {
  const f = e.target.dataset?.f; if (!f) return;
  const m = D.modulos.find(x => x.id === e.target.dataset.mod); if (!m) return;
  m[f] = e.target.textContent.replace(/\s+/g, ' ').trim();
  pintarEditor(); // solo actualiza el panel; la hoja no se redibuja para no perder el cursor
});
$('dpHoja').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.f) e.preventDefault(); });
$('dpHoja').addEventListener('change', async e => { const a = e.target.dataset.av; if (!a) return; const [id, k] = a.split('|'); const clave = id + '_' + k; D.avance = D.avance || {}; D.avance[clave] = e.target.checked; try { await marcarAvanceDespiece(DOC_ID || idDoc(), clave, e.target.checked); } catch (err) { console.error(err); e.target.checked = !e.target.checked; $('dpEstado').textContent = 'No se pudo guardar el avance'; } });
$('btnGuardar').addEventListener('click', async () => { $('dpEstado').textContent = (await guardarDespiece()) ? 'Guardado' : 'No se pudo guardar'; });
$('btnPDF').addEventListener('click', () => window.print()); // destino "Guardar como PDF"
$('btnCompartir').addEventListener('click', async () => {
  const d = {title:'Despiece ' + (D.nombre || ''), text:'Despiece LINENCE ' + (D.codigo || ''), url:location.href};
  try { if (navigator.share) await navigator.share(d); else { await navigator.clipboard.writeText(location.href); $('dpEstado').textContent = 'Enlace copiado'; } } catch (e) {}
});
$('btnPNG').addEventListener('click', async () => {
  const svgs = [...$('dpHoja').querySelectorAll('.dp-v svg')];
  for (let i = 0; i < svgs.length; i++) {
    const xml = new XMLSerializer().serializeToString(svgs[i]), img = new Image();
    await new Promise(r => { img.onload = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
    const c = document.createElement('canvas'); c.width = W * 3; c.height = H * 3;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    const a = document.createElement('a'); a.download = `despiece-${D.codigo || 'borrador'}-vista${i + 1}.png`; a.href = c.toDataURL('image/png'); a.click();
  }
});

// ===== Inicio (sesión de staff / taller) =====
observarSesionStaff(async (staff) => {
  if (!staff) { location.href = 'login.html'; return; }
  STAFF = staff;
  MODO_TALLER = staff.rol === 'taller';
  $('staffNombre').textContent = staff.nombre || '—'; $('staffRol').textContent = staff.rol || '—';
  $('btnCerrarSesion').onclick = async () => { await cerrarSesion(); location.href = 'login.html'; };
  $('dashCargando').style.display = 'none'; $('dashLayout').style.display = '';
  if (MODO_TALLER) {
    document.body.classList.add('dp-modo-taller');
    const lista = await listarDespiecesAsignados(staff.email);
    if (!q.get('id') && !q.get('codigo')) {
      if (lista.length === 1) q.set('id', lista[0].id);
      else if (lista.length > 1) { $('dpHoja').innerHTML = '<h3>Tus despieces asignados</h3>' + lista.map(d => `<p><a href="despiece.html?id=${encodeURIComponent(d.id)}">${esc(d.nombre || d.id)} · ${esc(d.codigo || '')}</a></p>`).join(''); return; }
      else { $('dpHoja').innerHTML = '<p>Aún no tienes despieces asignados.</p>'; return; }
    }
  }
  await cargarDespiece(); await traerOrigen(); await poblarListas(); await poblarUsuarios(); idx = 0; pintarEditor(); refrescar();
});
