// PUBLIC settings only. TMDB credentials remain in the existing Cloudflare Worker.
// This URL is fixed for every player. Browser overrides from v1 are not used.
export const CONFIG = Object.freeze({
  TMDB_PROXY_URL: 'https://movieline-tmdb.julia-correa-souza.workers.dev',
  DEFAULT_FAME: 'famous',
  VERSION: '2.0.0'
});
