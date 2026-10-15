/** Editorial proxies for familiarity, not an official TMDB classification. */
export const FAME_PRESETS = Object.freeze({
  famous: Object.freeze({label:'Famosos', minVotes:1000, sort:'vote_count.desc', note:'Pelo menos 1.000 votos no TMDB.'}),
  hits: Object.freeze({label:'Muito famosos', minVotes:3000, sort:'vote_count.desc', note:'Pelo menos 3.000 votos no TMDB.'}),
  broad: Object.freeze({label:'Catálogo amplo', minVotes:50, sort:'vote_count.desc', note:'Pelo menos 50 votos no TMDB.'})
});
export function famePreset(value = 'famous') {
  if (!Object.hasOwn(FAME_PRESETS, value)) throw new Error('Selecione uma opção válida de popularidade.');
  return FAME_PRESETS[value];
}
