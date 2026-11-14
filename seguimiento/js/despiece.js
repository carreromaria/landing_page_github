// ===== LINENCE · Módulo Despiece =====
import { observarSesionStaff, cerrarSesion } from './auth.js';
import { obtenerDespiece, buscarDespiecePorLead, guardarDespiece as fsGuardar, marcarAvanceDespiece, listarDespiecesAsignados, obtenerLead } from './firestore.js';

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
const nombreColor = id => (PALETA.find(c => c.id === id) || PALETA[0]).n;
const cm = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function moduloNuevo(n) {
  return {id:'m' + Date.now() + Math.floor(Math.random() * 99), nombre:'Módulo ' + n,
    ancho:60, alto:53.5, prof:33, espI:1.5, espD:1.5, barra:6, divisiones:[], puertas:2, juego:0.5, sobre:0, manilla:'si',
    colores:{lat:'blanco',techo:'blanco',piso:'blanco',barra:'blanco',bandeja:'blanco',puerta:'gres'},
    vistas:{f:'Vista frontal (con puertas)',i:'Vista frontal interior (sin puertas)',l:'Vista lateral',p:'Perspectiva'},
    notas:'', avance:{}};
}
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
    if (d) { DOC_ID = d.id; D = {...D, ...d, avance: d.avance || {}}; D.modulos.forEach(m => { if (!m.divisiones) m.divisiones = Array.from({length: +m.bandejas || 0}, () => +m.altBandeja || 15); m.colores = {bandeja:'blanco', ...m.colores}; if (m.espI == null) m.espI = m.esp ?? 1.5; if (m.espD == null) m.espD = m.esp ?? 1.5; }); }
    else if (D.leadOrigenId) { const l = await obtenerLead(D.leadOrigenId); if (l) D.nombre = D.nombre || l.nombre || ''; }
  } catch (e) { console.error(e); $('dpEstado').textContent = 'No se pudo cargar el despiece'; }
}
async function guardarDespiece() {
  const id = DOC_ID || idDoc();
  if (!id) { alert('Indica el código LIN del proyecto o abre el despiece desde el lead.'); return false; }
  try {
    const {id: _x, actualizadoEn, ...datos} = D;
    await fsGuardar(id, datos, STAFF?.uid); DOC_ID = id; return true;
  } catch (e) { console.error(e); return false; }
}

// ===== Cálculo de piezas =====
function calcular(m) {
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
    g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#141213" stroke-width=".8"/>`;
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
function svgLateral(m) {
  const s = escala(m.prof, m.alto), w = m.prof * s, h = m.alto * s, x = (W - w) / 2 + 8, y = 34;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${R(x, y, w, h, m.colores.lat)}${dimH(x, x + w, y - 8, cm(m.prof))}${dimV(y, y + h, x - 14, cm(m.alto))}</svg>`;
}
function svgPersp(m) {
  const k = 0.42, s = Math.min((W - 80) / (m.ancho + m.prof * k), (H - 70) / (m.alto + m.prof * k));
  const w = m.ancho * s, h = m.alto * s, dx = m.prof * s * k, dy = m.prof * s * k * 0.8, x = 20, y = 40 + dy, c = m.colores, n = +m.puertas || 0;
  const poly = (pts, col) => `<polygon points="${pts}" fill="${hex(col)}" stroke="#141213" stroke-width=".8"/>`;
  let g = poly(`${x},${y} ${x+w},${y} ${x+w+dx},${y-dy} ${x+dx},${y-dy}`, c.techo) + poly(`${x+w},${y} ${x+w+dx},${y-dy} ${x+w+dx},${y+h-dy} ${x+w},${y+h}`, c.lat);
  if (n === 0) g += R(x, y, w, h, c.lat);
  for (let i = 0; i < n; i++) g += R(x + i * w / n + .5, y, w / n - 1, h + m.sobre * s, c.puerta);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}

// ===== Hoja del documento =====
function hojaModulo(m, i) {
  const pz = calcular(m), conPuertas = +m.puertas > 0;
  const filas = pz.map(p => `<tr><td><span class="dot" style="background:${hex(m.colores[p.k])}"></span>${p.n}</td><td>${p.c}</td><td>${cm(p.a)} × ${cm(p.b)}</td><td>${nombreColor(m.colores[p.k])}</td><td class="col-listo"><input type="checkbox" data-av="${m.id}|${p.k}" ${D.avance?.[m.id + '_' + p.k] ? 'checked' : ''}></td></tr>`).join('');
  const puerta = pz.find(p => p.puerta);
  return `<div class="${i ? 'dp-mod-sep' : ''}">
  <div class="dp-cab"><div><b>${esc(m.nombre)} – ${esc(D.nombre || 'Proyecto')}</b><small>Plano constructivo, medidas y despiece${D.codigo ? ' · ' + esc(D.codigo) : ''}</small></div><div class="dp-marca">LINENCE</div></div>
  <div class="dp-vistas">
    <div class="dp-v"><h4>${esc(m.vistas.f)}</h4>${svgFrontal(m, false)}</div>
    <div class="dp-v"><h4>${esc(m.vistas.i)}</h4>${svgFrontal(m, true)}</div>
    <div class="dp-v"><h4>${esc(m.vistas.l)}</h4>${svgLateral(m)}</div>
    <div class="dp-v"><h4>${esc(m.vistas.p)}</h4>${svgPersp(m)}</div>
  </div>
  <div class="dp-datos">
    <div><h3>Medidas generales</h3><table><tr><td>Ancho</td><td>${cm(m.ancho)} cm</td></tr><tr><td>Alto</td><td>${cm(m.alto)} cm</td></tr><tr><td>Fondo</td><td>${cm(m.prof)} cm</td></tr><tr><td>Melamina</td><td>${m.espI === m.espD ? cm(m.espI * 10) + ' mm' : 'Izq. ' + cm(m.espI * 10) + ' mm · Der. ' + cm(m.espD * 10) + ' mm'}</td></tr>${m.divisiones.length ? `<tr><td>Bandejas</td><td>${m.divisiones.length} u. · divisiones ${m.divisiones.map(cm).join(' / ')} cm</td></tr>` : ''}${conPuertas ? `<tr><td>Puerta</td><td>${cm(puerta.a)} × ${cm(puerta.b)} cm (${m.puertas} u.)</td></tr>` : ''}${m.sobre > 0 ? `<tr><td>Sobresale</td><td>${cm(m.sobre)} cm</td></tr>` : ''}${conPuertas ? `<tr><td>Manilla</td><td>${m.manilla === 'si' ? 'Con manilla' : 'Sin manilla'}</td></tr>` : ''}</table></div>
    <div><h3>Despiece (medidas de fabricación, cm)</h3><table><tr><th>Pieza</th><th>Cant.</th><th>Medidas</th><th>Color</th><th class="col-listo">Listo</th></tr>${filas}</table></div>
  </div>
  ${m.notas ? `<div class="dp-notas"><b>Notas</b>\n${esc(m.notas)}</div>` : ''}</div>`;
}
function pintarHoja() { $('dpHoja').innerHTML = D.modulos.map(hojaModulo).join(''); }

// ===== Panel editor =====
const CAMPOS = {mNombre:'nombre', mAncho:'ancho', mAlto:'alto', mProf:'prof', mEspI:'espI', mEspD:'espD', mBarra:'barra', mPuertas:'puertas', mJuego:'juego', mSobre:'sobre', mManilla:'manilla', mNotas:'notas'};
function pintarEditor() {
  $('pNombre').value = D.nombre; $('pCodigo').value = D.codigo; $('pLead').value = D.leadOrigenId; $('pAsignado').value = D.asignadoA || '';
  $('dpTabs').innerHTML = D.modulos.map((m, i) => `<button class="dp-tab ${i === idx ? 'on' : ''}" data-i="${i}">${esc(m.nombre)}</button>`).join('') + '<button class="dp-tab" data-i="+">+ Módulo</button>';
  for (const [id, k] of Object.entries(CAMPOS)) $(id).value = M()[k];
  for (const k of ['f', 'i', 'l', 'p']) $('v_' + k).value = M().vistas[k];
  pintarBandejas();
  $('dpColores').innerHTML = PIEZAS.filter(p => p.k !== 'bandeja' || M().divisiones.length > 0).map(p => `<div class="dp-pz"><span>${p.n}</span><div class="dp-sw">${PALETA.map(c => `<button title="${c.n}" data-pz="${p.k}" data-c="${c.id}" class="${M().colores[p.k] === c.id ? 'on' : ''}" style="background:${c.h}"></button>`).join('')}</div></div>`).join('');
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
for (const k of ['f', 'i', 'l', 'p']) $('v_' + k).addEventListener('input', e => { M().vistas[k] = e.target.value; refrescar(); });
[['pNombre', 'nombre'], ['pCodigo', 'codigo'], ['pLead', 'leadOrigenId'], ['pAsignado', 'asignadoA']].forEach(([id, k]) => $(id).addEventListener('input', e => { D[k] = e.target.value.trim(); refrescar(); }));
$('btnAddBandeja').addEventListener('click', () => { M().divisiones.push(M().divisiones.length ? 15 : 35); pintarEditor(); refrescar(); });
$('dpBandejas').addEventListener('input', e => { const i = e.target.dataset.div; if (i == null) return; M().divisiones[+i] = parseFloat(e.target.value) || 0; refrescar(); });
$('dpBandejas').addEventListener('change', () => pintarEditor());
$('dpBandejas').addEventListener('click', e => { const b = e.target.closest('[data-quitar]'); if (!b) return; M().divisiones.splice(+b.dataset.quitar, 1); pintarEditor(); refrescar(); });
$('dpTabs').addEventListener('click', e => { const i = e.target.dataset.i; if (i == null) return; if (i === '+') { D.modulos.push(moduloNuevo(D.modulos.length + 1)); idx = D.modulos.length - 1; } else idx = +i; pintarEditor(); refrescar(); });
$('dpColores').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; M().colores[b.dataset.pz] = b.dataset.c; pintarEditor(); refrescar(); });
$('btnBorrarMod').addEventListener('click', () => { if (D.modulos.length < 2) return alert('El despiece necesita al menos un módulo.'); if (!confirm('¿Quitar este módulo del despiece?')) return; D.modulos.splice(idx, 1); idx = 0; pintarEditor(); refrescar(); });
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
  await cargarDespiece(); idx = 0; pintarEditor(); refrescar();
});
