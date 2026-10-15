import { famePreset } from './presets.js';
/** Pure rules. No DOM, network or persistence dependencies. */
export function positiveInteger(value, name = 'Valor') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name}: use um número inteiro maior que zero.`);
  return n;
}
export function settingsFrom(input) {
  const fame = input.fame || 'famous';
  famePreset(fame);
  return {
    fame,
    films: input.films === null ? null : positiveInteger(input.films, 'Filmes'),
    lives: input.lives === null ? null : positiveInteger(input.lives, 'Vidas'),
    include: [...new Set(input.include || [])], exclude: [...new Set(input.exclude || [])]
  };
}
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function matchesCategory(movie, category) {
  if (!category) return false;
  const ids = category.tmdb_ids || [];
  if (category.kind === 'genre') return ids.some(id => (movie.genre_ids || []).includes(id));
  if (category.kind === 'company') return ids.some(id => (movie.company_ids || []).includes(id));
  return category.kind === 'curated' && ids.includes(movie.id);
}
export function matchesFilters(movie, settings, categories) {
  const included = categories.filter(c => settings.include.includes(c.id));
  const excluded = categories.filter(c => settings.exclude.includes(c.id));
  return (!included.length || included.some(c => matchesCategory(movie, c))) &&
    !excluded.some(c => matchesCategory(movie, c));
}
export function validSlot(timeline, year, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > timeline.length || !Number.isInteger(year)) return false;
  return (slot === 0 || timeline[slot - 1].year <= year) &&
    (slot === timeline.length || year <= timeline[slot].year);
}
export function idealSlot(timeline, year) {
  const i = timeline.findIndex(m => m.year > year);
  return i < 0 ? timeline.length : i;
}
export function makeGame(settings, base, current) {
  if (!base || !current) throw new Error('São necessários pelo menos dois filmes para jogar.');
  return { settings: settingsFrom(settings), timeline: [{ ...base, instance: 'base' }], current,
    slot: null, attempted: 0, correct: 0, streak: 0, bestStreak: 0,
    lives: settings.lives, phase: 'placing', reveal: null, startedAt: Date.now(), endReason: null };
}
export function confirmMovie(game) {
  if (game.phase !== 'placing' || !game.current || game.slot === null) return false;
  const movie = game.current;
  const correct = validSlot(game.timeline, movie.year, game.slot);
  const insertion = idealSlot(game.timeline, movie.year);
  game.attempted += 1;
  if (correct) {
    game.correct += 1; game.streak += 1;
    game.bestStreak = Math.max(game.bestStreak, game.streak);
    game.timeline.splice(game.slot, 0, { ...movie, instance: `turn-${game.attempted}` });
  } else {
    game.streak = 0;
    if (game.lives !== null) game.lives = Math.max(0, game.lives - 1);
  }
  game.reveal = { correct, movie: { ...movie }, insertion };
  game.phase = 'revealed';
  // A final mistake that consumes the last life is a loss, even on the last question.
  game.endReason = game.lives === 0 ? 'lives' :
    game.settings.films !== null && game.attempted >= game.settings.films ? 'completed' : null;
  return correct;
}
export function advanceMovie(game, movie) {
  if (game.phase !== 'revealed' || game.endReason || !movie) return false;
  game.current = movie; game.slot = null; game.reveal = null; game.phase = 'placing';
  return true;
}
export function finishGame(game, reason = 'manual') {
  game.phase = 'finished'; game.endReason = reason;
  return game;
}
export function normalizeMovie(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = String(raw.release_date || '');
  const year = Number(date.slice(0, 4));
  if (!Number.isSafeInteger(raw.id) || raw.id < 1 || typeof raw.title !== 'string' || !raw.title.trim() || raw.adult || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isInteger(year) || year < 1870 || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0,10) !== date || date > new Date().toISOString().slice(0, 10)) return null;
  return { id: raw.id, title: raw.title, original_title: raw.original_title || raw.title,
    year, release_date: date, poster_path: raw.poster_path || null,
    genre_ids: raw.genre_ids || (raw.genres || []).map(g => g.id),
    company_ids: raw.company_ids || (raw.production_companies || []).map(c => c.id),
    company_known: Array.isArray(raw.company_ids) || Array.isArray(raw.production_companies),
    vote_count: Number(raw.vote_count) || 0, popularity: Number(raw.popularity) || 0 };
}
export function validateCategory(raw) {
  const id = String(raw.id || '').trim();
  const label = String(raw.label || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new Error('Identificador: 2 a 64 letras minúsculas, números ou hífens.');
  if (label.length < 2 || label.length > 64) throw new Error('Nome: de 2 a 64 caracteres.');
  if (!['genre','company','curated'].includes(raw.kind)) throw new Error('Tipo de categoria inválido.');
  if (!Array.isArray(raw.tmdb_ids) || !raw.tmdb_ids.length || raw.tmdb_ids.length > 500 ||
    raw.tmdb_ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Informe entre 1 e 500 IDs numéricos válidos do TMDB.');
  return { id, label, kind: raw.kind, tmdb_ids: [...new Set(raw.tmdb_ids)],
    description: String(raw.description || '').slice(0, 500), enabled: raw.enabled !== false,
    sort_order: Number.isInteger(raw.sort_order) ? raw.sort_order : 100 };
}
