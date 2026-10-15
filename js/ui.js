export const ICONS = {
 'film':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M7 12h10"/>',
 'heart':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
 'arrow-right':'<path d="M4 12h16M13 5l7 7-7 7"/>',
 'arrow-left':'<path d="M20 12H4m7-7-7 7 7 7"/>',
 'help':'<circle cx="12" cy="12" r="9"/><path d="M9.5 8.6a2.6 2.6 0 1 1 4.2 2c-1.1.7-1.7 1.1-1.7 2.8M12 17h.01"/>',
 'settings':'<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3-1.5-2v-3L20 8.5l-2-3-2 .5-2-1-.5-2z"/><circle cx="11.3" cy="12" r="3"/>',
 'sound-off':'<path d="M11 5 6 9H3v6h3l5 4V5zM16 9l5 6m0-6-5 6"/>',
 'sound-on':'<path d="M11 5 6 9H3v6h3l5 4V5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 'ticket':'<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6zM15 6v2m0 3v2m0 3v2"/>',
 'close':'<path d="m6 6 12 12M18 6 6 18"/>',
 'check':'<path d="m5 12 4 4L19 6"/>',
 'mouse':'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
 'refresh':'<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
 'lock':'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>'
};
export function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.film}</svg>`; }
export function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function poster(movie, extra = '') {
  // Never insert external markup. Only TMDB relative image paths are accepted.
  const path = /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(movie.poster_path || '') ? movie.poster_path : '';
  const tones = ['#284b43','#964334','#465665','#736541','#735748'];
  return `<div class="movie-poster ${extra}" style="background-color:${tones[movie.id % tones.length]}"><div class="poster-fallback">${icon('film')}<span>${escapeHTML(movie.title)}</span><small>CARTAZ OFFLINE</small></div>${path ? `<img draggable="false" src="https://image.tmdb.org/t/p/w342${path}" alt="Cartaz de ${escapeHTML(movie.title)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>`;
}
export function handleImages(root = document) {
  root.querySelectorAll('.movie-poster img').forEach(img => {
    img.addEventListener('error', () => img.classList.add('failed'), {once:true});
    if (img.complete && img.naturalWidth === 0) img.classList.add('failed');
  });
}
let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = message; el.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, 5200);
}
export const TMDB_LOGO = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg';
export function creditsHTML() {
  return `<h2>Nos bastidores</h2><p><strong>Movieline</strong> é um jogo da AltiGames. Identidade visual e ilustração do cinema criadas para o jogo.</p><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer"><img class="tmdb-logo" src="${TMDB_LOGO}" alt="The Movie Database (TMDB)" width="94" height="68"></a><p class="tmdb-notice" lang="en">This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Dados e cartazes são fornecidos pelo TMDB. Os direitos das imagens pertencem a seus respectivos titulares.</p><p>O modo gratuito da API destina-se a uso não comercial. Um projeto comercial precisa de licença adequada do TMDB.</p><h3>Como as categorias funcionam</h3><p>Gêneros usam os IDs do TMDB. Disney, Pixar e Marvel Studios usam créditos de produtoras, não disponibilidade em streaming. <strong>Oscar: Melhor Filme</strong> é uma seleção editorial inicial de sete vencedores, não uma lista completa de todos os filmes premiados.</p>`;
}
