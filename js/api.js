import { CONFIG } from '../config.js';
import { famePreset } from './presets.js';
import { shuffle, matchesCategory, normalizeMovie, settingsFrom, validateCategory } from './engine.js';
import { readLocal } from './storage.js';

/** A public endpoint is not a secret. Never accept a player-supplied override. */
export function proxyURL() {
  const value = String(CONFIG.TMDB_PROXY_URL || '').replace(/\/+$/, '');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('A configuração pública do Worker deve ser uma URL HTTPS sem credenciais.');
  return value;
}
export class APIError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'APIError'; this.status = status; }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function requestJSON(url, options = {}, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) }); }
    catch {
      if (attempt < retries) { await pause(700); continue; }
      throw new APIError('Não foi possível conectar. Verifique sua internet e as origens permitidas (CORS) no Worker.');
    }
    let body;
    try { body = await response.json(); }
    catch { throw new APIError('O servidor retornou uma resposta inválida. Confira a publicação dos arquivos e do Worker.', response.status); }
    if (response.ok) return body;
    const retryHeader = response.headers.get('Retry-After');
    const wait = Math.max(1, Number(retryHeader) || (retryHeader ? (Date.parse(retryHeader)-Date.now())/1000 : 1));
    // Do not retry too soon when the service explicitly asks for a long cooldown.
    if ((response.status === 429 || response.status >= 500) && attempt < retries && wait <= 5) {
      await pause(wait * 1000); continue;
    }
    let message = body.error || body.message || `Falha HTTP ${response.status}.`;
    if (message === 'Filtro não permitido.')
      message = 'Atualize o código do Worker movieline-tmdb para a v2 no Cloudflare e publique novamente. A v1 não aceita os novos filtros.';
    if (response.status === 429) message += ` Aguarde ${Math.ceil(wait)} segundo(s) antes de tentar novamente.`;
    throw new APIError(message, response.status);
  }
}
export async function tmdbRequest(base, path, params = {}) {
  const url = new URL(base + path);
  Object.entries(params).forEach(([key,value]) => {
    if (value !== '' && value != null) url.searchParams.set(key, String(value));
  });
  return requestJSON(url);
}
export function validateCategories(data) {
  const rows = Array.isArray(data) ? data : data?.categories;
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Esperado um catálogo com até 1.000 categorias.');
  const categories = rows.map(validateCategory);
  if (new Set(categories.map(c => c.id)).size !== categories.length) throw new Error('Há identificadores de categoria duplicados.');
  return categories;
}
export async function loadPublishedCategories() {
  return validateCategories(await requestJSON(new URL('../categories.json', import.meta.url), {cache:'no-cache'}));
}
export async function loadCategories() {
  const preview = readLocal('categories');
  return preview !== null ? {categories:validateCategories(preview), source:'preview'} :
    {categories:await loadPublishedCategories(), source:'published'};
}

export function splitDateRange(start, end) {
  const a = Date.parse(start), b = Date.parse(end), day = 86400000;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const middle = a + Math.floor((b - a) / day / 2) * day;
  return [[start, new Date(middle).toISOString().slice(0,10)],
    [new Date(middle + day).toISOString().slice(0,10), end]];
}
const newWindow = (start,end) => ({start,end,pages:null,first:null});
function streamsFor(settings, categories, today) {
  const chosen = categories.filter(c => settings.include.includes(c.id));
  const streams = [];
  const discover = params => ({kind:'discover',params,windows:[newWindow('1870-01-01',today)],done:false});
  if (!chosen.length) return [discover({})];
  for (const [kind,param] of [['genre','with_genres'],['company','with_companies']]) {
    const ids = [...new Set(chosen.filter(c => c.kind === kind).flatMap(c => c.tmdb_ids))];
    if (ids.length) streams.push(discover({[param]:ids.join('|')}));
  }
  const ids = shuffle([...new Set(chosen.filter(c => c.kind === 'curated').flatMap(c => c.tmdb_ids))]);
  if (ids.length) streams.push({kind:'curated',ids,offset:0,done:false});
  return shuffle(streams);
}

/** Demand-paginated movie deck. No film database, no 20-film or 500-page global cap. */
export class MoviePool {
  constructor(settings, categories, base = proxyURL(), snapshot = null) {
    this.settings = settingsFrom(settings); this.categories = structuredClone(categories);
    this.base = base; this.mode = 'tmdb'; this.asOf = new Date().toISOString().slice(0,10);
    this.cycle = 1; this.cursor = 0; this.queue = []; this.seen = new Set();
    this.lastId = null; this.emitted = 0; this.coverageLimited = false;
    this.excluded = categories.filter(c => this.settings.exclude.includes(c.id));
    this.preset = famePreset(this.settings.fame);
    this.streams = streamsFor(this.settings, categories, this.asOf);
    this._lock = Promise.resolve(); this._prefetch = null;
    if (snapshot) {
      if (snapshot.version !== 2) throw new Error('Esta sessão pertence a outra versão. Inicie uma nova partida.');
      for (const key of ['asOf','cycle','cursor','queue','streams','lastId','emitted','coverageLimited'])
        this[key] = structuredClone(snapshot[key]);
      this.seen = new Set(snapshot.seen);
    }
  }
  snapshot() {
    return structuredClone({version:2,settings:this.settings,categories:this.categories,asOf:this.asOf,
      cycle:this.cycle,cursor:this.cursor,queue:this.queue,streams:this.streams,seen:[...this.seen],
      lastId:this.lastId,emitted:this.emitted,coverageLimited:this.coverageLimited});
  }
  // Restore on the currently deployed endpoint, never a URL recovered from browser storage.
  static restore(snapshot, base = proxyURL()) { return new MoviePool(snapshot.settings,snapshot.categories,base,snapshot); }
  _serial(task) {
    const next = this._lock.then(task);
    this._lock = next.catch(() => {});
    return next;
  }
  _params(source, window, page) {
    return {...source.params,page,sort_by:this.preset.sort,'vote_count.gte':this.preset.minVotes,
      'primary_release_date.gte':window.start,'primary_release_date.lte':window.end,
      without_genres:[...new Set(this.excluded.filter(c=>c.kind==='genre').flatMap(c=>c.tmdb_ids))].join(','),
      without_companies:[...new Set(this.excluded.filter(c=>c.kind==='company').flatMap(c=>c.tmdb_ids))].join(',')};
  }
  _normalize(results) {
    return results.map(normalizeMovie).filter(m => m && m.vote_count >= this.preset.minVotes &&
      !this.excluded.some(c => matchesCategory(m,c)));
  }
  async _batch(source) {
    if (source.kind === 'curated') {
      const ids = source.ids.slice(source.offset, source.offset + 3);
      const rows = await Promise.all(ids.map(id => tmdbRequest(this.base,`/movie/${id}`).catch(error => {
        if (error.status === 404) return null;
        throw error;
      })));
      // Commit the cursor only after every non-missing request succeeds.
      source.offset += ids.length; source.done = source.offset >= source.ids.length;
      return this._normalize(rows);
    }
    const window = source.windows[0];
    if (!window) { source.done = true; return []; }
    if (window.pages === null) {
      const data = await tmdbRequest(this.base,'/discover/movie',this._params(source,window,1));
      if (!Array.isArray(data.results) || !Number.isFinite(Number(data.total_pages)))
        throw new APIError('O TMDB retornou uma página de filmes inválida.');
      const total = Math.max(0, Math.floor(Number(data.total_pages)));
      if (total > 500) {
        const halves = splitDateRange(window.start,window.end);
        if (halves) {
          source.windows.splice(0,1,...shuffle(halves).map(([a,b])=>newWindow(a,b)));
          return [];
        }
        // A single release day with >10k results cannot be date-partitioned further.
        // Do not claim complete coverage in this rare upstream-limited case.
        this.coverageLimited = true;
      }
      window.pages = shuffle(Array.from({length:Math.min(total,500)},(_,i)=>i+1));
      window.first = this._normalize(data.results);
    }
    if (!window.pages.length) {
      source.windows.shift(); source.done = !source.windows.length; return [];
    }
    const page = window.pages[0];
    let movies;
    if (page === 1) movies = window.first;
    else {
      const data = await tmdbRequest(this.base,'/discover/movie',this._params(source,window,page));
      if (!Array.isArray(data.results)) throw new APIError('O TMDB retornou uma lista de filmes inválida.');
      movies = this._normalize(data.results);
    }
    // Failed page requests leave the next page and deck untouched for a safe retry.
    window.pages.shift(); if (page === 1) window.first = null;
    if (!window.pages.length) { source.windows.shift(); source.done = !source.windows.length; }
    else if (source.windows.length > 1) source.windows.push(source.windows.shift());
    return movies;
  }
  async _fill(target = 1, minBatches = 0, budget = 80) {
    let batches = 0;
    while ((this.queue.length < target || batches < minBatches) && this.streams.some(s=>!s.done)) {
      if (batches >= budget) {
        if (!this.queue.length) throw new APIError('Ainda procurando filmes nestes filtros. Tente novamente ou amplie as categorias e a popularidade.');
        break;
      }
      const active = this.streams.filter(s=>!s.done), source = active[this.cursor % active.length];
      const movies = await this._batch(source);
      this.cursor++; batches++;
      for (const movie of shuffle(movies)) {
        if (!this.seen.has(movie.id)) { this.seen.add(movie.id); this.queue.push(movie); }
      }
    }
  }
  prepare() {
    return this._serial(async()=>{
      await this._fill(36, Math.max(2,this.streams.length));
      this.queue = shuffle(this.queue);
    });
  }
  prefetch() {
    if (this.queue.length >= 8) return Promise.resolve();
    if (this._prefetch) return this._prefetch;
    this._prefetch = this._serial(()=>this._fill(20,0,4)).finally(()=>{this._prefetch=null;});
    return this._prefetch;
  }
  next(allowCycle = this.settings.films === null) {
    return this._serial(async()=>{
      let restarted = false;
      for (;;) {
        await this._fill();
        if (!this.queue.length) {
          if (!allowCycle || restarted || this.emitted < 1) return null;
          restarted = true; this.cycle++; this.emitted = 0;
          this.seen = new Set(this.lastId === null ? [] : [this.lastId]);
          this.streams = streamsFor(this.settings,this.categories,this.asOf); this.cursor = 0;
          continue;
        }
        let movie = this.queue[0];
        if (!movie.company_known && this.excluded.some(c=>c.kind==='company')) {
          try { movie = normalizeMovie(await tmdbRequest(this.base,`/movie/${movie.id}`)); }
          catch (error) { if (error.status !== 404) throw error; movie = null; }
        }
        this.queue.shift();
        if (!movie || movie.vote_count < this.preset.minVotes || this.excluded.some(c=>matchesCategory(movie,c))) continue;
        this.lastId = movie.id; this.emitted++; return movie;
      }
    });
  }
}
