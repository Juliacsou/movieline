// PUBLIC settings only. TMDB credentials remain in the existing Cloudflare Worker.
// This URL is fixed for every player. Browser overrides from v1 are not used.
export const CONFIG = Object.freeze({
  TMDB_PROXY_URL: 'https://movieline-tmdb.julia-correa-souza.workers.dev',
  // Creator-only selection: 'famous' (1,000+ TMDB votes) or 'hits' (3,000+).
  // Players cannot change this. 'famous' includes very famous movies as well.
  DEFAULT_FAME: 'famous',
  VERSION: '9.0.0'
});
