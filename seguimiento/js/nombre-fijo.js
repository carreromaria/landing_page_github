// ============================================================
// LINENCE — Nombre fijo al bajar por una ficha
// ------------------------------------------------------------
// Cuando el nombre grande de una ficha (lead, proyecto, cotización) sale por
// arriba de la pantalla, aparece una barra compacta con ese nombre pegada
// arriba; el contenido pasa por debajo de ella. Al volver a subir desaparece.
// La barra se crea sola dentro de la vista (no hace falta HTML) y no ocupa
// espacio mientras no se ve. Estilos: .ln-nombre-fijo* en css/linence-ui.css.
// ============================================================

/**
 * @param {Object} opciones
 * @param {HTMLElement} opciones.vista   el <main> de la ficha
 * @param {HTMLElement} opciones.titulo  el nombre grande (h1) que se observa
 * @param {HTMLElement} [opciones.codigo] elemento con el código (LIN-00003, L-00054...), opcional
 */
export function activarNombreFijo({ vista, titulo, codigo = null }) {
  if (!vista || !titulo || !('IntersectionObserver' in window)) return;

  const contenedor = document.createElement('div');
  contenedor.className = 'ln-nombre-fijo';
  contenedor.setAttribute('aria-hidden', 'true');
  contenedor.innerHTML =
    '<div class="ln-nombre-fijo-barra">' +
      '<span class="ln-nombre-fijo-codigo" style="display:none;"></span>' +
      '<span class="ln-nombre-fijo-texto"></span>' +
    '</div>';
  vista.insertBefore(contenedor, vista.firstChild);
  const chipCodigo = contenedor.querySelector('.ln-nombre-fijo-codigo');
  const texto = contenedor.querySelector('.ln-nombre-fijo-texto');

  new IntersectionObserver(([entrada]) => {
    // Visible solo cuando el nombre ya salió POR ARRIBA (no cuando la vista está oculta)
    const pasoPorArriba = !entrada.isIntersecting && entrada.boundingClientRect.top < 0;
    if (pasoPorArriba) {
      texto.textContent = titulo.textContent.trim();
      const cod = codigo ? codigo.textContent.trim() : '';
      const hayCodigo = cod && cod !== '—';
      chipCodigo.textContent = hayCodigo ? cod : '';
      chipCodigo.style.display = hayCodigo ? '' : 'none';
    }
    contenedor.classList.toggle('visible', pasoPorArriba);
  }).observe(titulo);
}
