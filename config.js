// PUBLIC settings only. TMDB credentials remain in the existing Cloudflare Worker.
// This URL is fixed for every player. Browser overrides from v1 are not used.
export const CONFIG = Object.freeze({
  TMDB_PROXY_URL: 'https://movieline-tmdb.julia-correa-souza.workers.dev',
  // Creator-only selection. Players cannot change this.
  // Movieline currently admits only movies with at least 3,000 TMDB votes.
  DEFAULT_FAME: 'hits',
  VERSION: '13.0.0'
});
