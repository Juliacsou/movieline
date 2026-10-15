/** Editorial proxies for familiarity, not an official TMDB classification. */
export const FAME_PRESETS = Object.freeze({
  famous: Object.freeze({label:'Famosos', minVotes:3000, sort:'vote_count.desc', note:'Pelo menos 3.000 votos no TMDB.'}),
  hits: Object.freeze({label:'Famosos', minVotes:3000, sort:'vote_count.desc', note:'Pelo menos 3.000 votos no TMDB.'})
});
export function famePreset(value = 'famous') {
  if (!Object.hasOwn(FAME_PRESETS, value)) throw new Error('Selecione uma opção válida de popularidade.');
  return FAME_PRESETS[value];
}
