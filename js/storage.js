const PREFIX = 'movieline:v2:';
export function readLocal(key, fallback = null) {
  try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}
export function writeLocal(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}
export function removeLocal(key) { try { localStorage.removeItem(PREFIX + key); } catch {} }
export function saveSession(game, pool) {
  return writeLocal('session', { version: 2, savedAt: Date.now(), game, pool: pool.snapshot() });
}
export function loadSession() {
  const saved = readLocal('session');
  if (!saved || saved.version !== 2 || Date.now() - saved.savedAt > 7 * 86400000 ||
      !saved.game || !Array.isArray(saved.game.timeline) || !saved.pool ||
      !['placing','revealed'].includes(saved.game.phase)) {
    removeLocal('session'); return null;
  }
  return saved;
}
