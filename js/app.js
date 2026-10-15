import { CONFIG } from '../config.js?v=6';
import { settingsFrom, makeGame, confirmMovie, advanceMovie, finishGame } from './engine.js';
import { loadCategories, proxyURL, MoviePool } from './api.js';
import { readLocal, writeLocal, removeLocal, saveSession, loadSession } from './storage.js';
import { icon, hydrateIcons, escapeHTML, poster, handleImages, toast, creditsHTML } from './ui.js?v=6';
const $ = id => document.getElementById(id);
let categories = [], include = new Set(), exclude = new Set(), editMode = 'include';
let game = null, pool = null, busy = false, sound = readLocal('sound',false), audioContext;
let saved = loadSession(), lastRange = '', drag = null, hoverSlot = null, suppressClick = false;
let geometry = {offset:20,card:146,slot:116,width:0,stride:262};
let storageWarning = false;
hydrateIcons();
const formValues = readLocal('settings');
if (formValues) {
  $('films-input').value = formValues.filmValue || 20; $('lives-input').value = formValues.lifeValue || 5;
  $('films-infinite').checked = !!formValues.filmInfinite; $('lives-infinite').checked = !!formValues.lifeInfinite;
  include = new Set(formValues.include || []); exclude = new Set(formValues.exclude || []);
}
function showScreen(name) {
  if(name!=='game' && $('reveal-popup').open)$('reveal-popup').close();
  ['setup','game','results'].forEach(s => $(s+'-screen').hidden = s !== name);
  document.body.dataset.screen = name;
}
function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function modal(html) { $('dialog-content').innerHTML = html; hydrateIcons($('info-dialog')); $('info-dialog').showModal(); }
$('info-dialog').querySelector('.dialog-close').addEventListener('click', () => $('info-dialog').close());
$('info-dialog').addEventListener('click', e => { if (e.target === $('info-dialog')) { const r = e.target.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close(); } });
$('help-button').addEventListener('click', () => modal(`<h2>Um filme de cada vez.</h2><div class="help-step"><b>1</b><p><strong>Monte sua sessão.</strong> Escolha filmes, vidas e categorias. Em Incluir, você combina opções; em Excluir, remove o que não quer.</p></div><div class="help-step"><b>2</b><p><strong>Encontre o lugar do filme.</strong> Um filme-base já aparece com seu ano. Arraste o novo cartaz para antes, depois ou entre filmes. Também vale tocar nos botões + da linha.</p></div><div class="help-step"><b>3</b><p><strong>Confirme e descubra.</strong> Acertou? O filme fica na linha. Errou? Perde uma vida e o filme é descartado. Depois, avance para o próximo.</p></div><p class="modal-note"><strong>Mesmo ano? Sem pegadinha.</strong> Qualquer posição que mantenha os anos em ordem é aceita. A regra usa o ano da data principal de lançamento do TMDB, sem filtro regional do Brasil.</p><p><strong>Catálogo:</strong> O Movieline seleciona automaticamente filmes conhecidos, com pelo menos 1.000 votos no TMDB. É um critério aproximado de reconhecimento. O filme-base não conta na meta. Cada tentativa conta como um filme, acertando ou errando. Sem limite de filmes, o catálogo é reembaralhado apenas quando o ciclo se esgota. Você pode encerrar a qualquer momento.</p><p><strong>Teclado:</strong> Tab navega; Enter ativa botões; escolha um botão + com Tab e ative com Enter. A roda do mouse e dois dedos percorrem a linha horizontal.</p>`));
$('credits-button').addEventListener('click', () => modal(creditsHTML()));
function updateSound() {
  $('sound-button').innerHTML = icon(sound ? 'sound-on' : 'sound-off');
  $('sound-button').setAttribute('aria-pressed',String(sound));
  $('sound-button').setAttribute('aria-label',sound ? 'Desativar sons' : 'Ativar sons');
}
function beep(correct) {
  if (!sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume();
    const now = audioContext.currentTime;
    (correct ? [523.25,659.25,783.99] : [220,164.81]).forEach((frequency,i) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.type='sine'; oscillator.frequency.value=frequency;
      const t=now+i*.105;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.06,t+.015);gain.gain.exponentialRampToValueAtTime(.001,t+.19);
      oscillator.start(t);oscillator.stop(t+.2);
    });
  } catch { /* Optional audio must never interrupt gameplay. */ }
}
$('sound-button').addEventListener('click',()=>{sound=!sound;writeLocal('sound',sound);updateSound();if(sound)beep(true);});
updateSound();
function persistSetup() {
  writeLocal('settings',{filmValue:$('films-input').value,lifeValue:$('lives-input').value,
    filmInfinite:$('films-infinite').checked,lifeInfinite:$('lives-infinite').checked,include:[...include],exclude:[...exclude]});
}
function settings() { return settingsFrom({fame:CONFIG.DEFAULT_FAME,films:$('films-infinite').checked?null:$('films-input').value,
  lives:$('lives-infinite').checked?null:$('lives-input').value,include:[...include],exclude:[...exclude]}); }
function updateSetup() {
  for (const kind of ['films','lives']) {
    const infinite=$(kind+'-infinite').checked; $(kind+'-input').disabled=infinite;
    $(kind+'-input').parentElement.classList.toggle('infinite',infinite);
    const btn=$(kind+'-infinity-button');btn.setAttribute('aria-pressed',String(infinite));
    btn.setAttribute('aria-label',(infinite?'Desativar':'Ativar')+' '+(kind==='films'?'filmes':'vidas')+' infinitos');
    document.querySelectorAll(`[data-step^="${kind}:"]`).forEach(b=>b.disabled=infinite);
  }
  $('session-recap').textContent = $('films-infinite').checked ? 'Filmes infinitos' : `${$('films-input').value || '—'} filmes`;
  $('filter-summary').textContent = include.size || exclude.size ?
    `${include.size ? include.size+' incluída(s), combinadas entre si' : 'Todos os filmes'}${exclude.size ? ' · '+exclude.size+' excluída(s)' : ''}. Exclusões prevalecem.` : 'Todos os gêneros estão convidados. Toque para filtrar.';
  persistSetup();
}
function renderCategories() {
  const enabled = categories.filter(c=>c.enabled);
  const groups = [['COLEÇÕES',enabled.filter(c=>c.kind!=='genre')],['GÊNEROS',enabled.filter(c=>c.kind==='genre')]];
  $('category-list').innerHTML = groups.filter(([,rows])=>rows.length).map(([title,rows])=>
    `<div class="category-group-title">${title}</div><div class="category-chips">${rows.map(c=> {
      const state = include.has(c.id)?'included':exclude.has(c.id)?'excluded':'';
      return `<button type="button" class="category-chip ${state}" data-category="${escapeHTML(c.id)}" title="${escapeHTML(c.description)}" aria-label="${escapeHTML(c.label)}, ${state==='included'?'incluída':state==='excluded'?'excluída':'neutra'}" aria-pressed="${!!state}"><span class="chip-state">${state==='excluded'?'−':'+'}</span>${escapeHTML(c.label)}</button>`;
    }).join('')}</div>`).join('') || '<p style="font-size:12px">Nenhuma categoria ativa. O modo sem filtros continua disponível.</p>';
}
$('category-list').addEventListener('click',e=>{
  const el=e.target.closest('[data-category]');if(!el)return;
  const id=el.dataset.category, selected=editMode==='include'?include:exclude, other=editMode==='include'?exclude:include;
  selected.has(id)?selected.delete(id):selected.add(id);other.delete(id);
  renderCategories();updateSetup();
  // Keep keyboard focus on the same chip without moving the category viewport.
  $('category-list').querySelector(`[data-category="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
});
for(const mode of ['include','exclude']) $('mode-'+mode).addEventListener('click',()=>{
  editMode=mode;for(const other of ['include','exclude']){$('mode-'+other).classList.toggle('active',other===mode);$('mode-'+other).setAttribute('aria-pressed',String(other===mode));}
});
$('clear-filters').addEventListener('click',()=>{include.clear();exclude.clear();renderCategories();updateSetup();});
for(const kind of ['films','lives']) {
  $(kind+'-infinite').addEventListener('change',updateSetup);$(kind+'-input').addEventListener('input',updateSetup);
  $(kind+'-infinity-button').addEventListener('click',()=>{const check=$(kind+'-infinite');check.checked=!check.checked;check.dispatchEvent(new Event('change',{bubbles:true}));});
}
document.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{
  const [kind,delta]=b.dataset.step.split(':');const input=$(kind+'-input');input.value=Math.max(1,(Number(input.value)||1)+Number(delta));updateSetup();
}));
function persistGame() {
  if(!game||!pool||game.phase==='finished')return;
  game.viewScrollLeft=$('timeline-scroll').scrollLeft;
  if(!saveSession(game,pool)&&!storageWarning){storageWarning=true;toast('O navegador não permitiu salvar esta sessão. Mantenha a aba aberta para continuar.');}
}
function prefetchMovies() {
  if (!pool || !game || game.phase === 'finished' || game.endReason) return;
  const active = pool;
  active.prefetch().then(()=>{if(pool===active)persistGame();}).catch(()=>{
    // Queued films remain playable. A failed load is retried explicitly when needed.
    if(pool===active)persistGame();
  });
}
window.addEventListener('pagehide',persistGame);
function applySettingsToForm(s) {
  $('films-infinite').checked=s.films===null;$('lives-infinite').checked=s.lives===null;
  if(s.films!==null)$('films-input').value=s.films;
  if(s.lives!==null)$('lives-input').value=s.lives;
  include=new Set(s.include);exclude=new Set(s.exclude);renderCategories();updateSetup();
}
function setStarting(value,fromResults) {
  for(const id of (fromResults?['play-again','new-game','review-timeline']:['start-button','resume-button']))$(id).disabled=value;
  const button=$(fromResults?'play-again':'start-button');
  button.classList.toggle('loading',value);button.setAttribute('aria-busy',String(value));
}
async function startSession(previousSettings=null,previousCategories=null) {
  if(busy)return;
  const fromResults=!!previousSettings,errorId=fromResults?'results-error':'setup-error';
  busy=true;setStarting(true,fromResults);showError(errorId);
  try {
    const s=previousSettings?settingsFrom(previousSettings):settings();
    const newPool=new MoviePool(s,previousCategories||categories.filter(c=>c.enabled),proxyURL());
    await newPool.prepare();
    const baseMovie=await newPool.next(false),current=await newPool.next(false);
    if(!baseMovie||!current)throw new Error('N\u00e3o encontramos dois filmes v\u00e1lidos com esses filtros. Escolha outras categorias.');
    // Do not discard the previous result until a new playable session is ready.
    pool=newPool;game=makeGame(s,baseMovie,current);game.viewScrollLeft=0;
    showScreen('game');lastRange='';$('timeline-scroll').scrollLeft=0;renderGame();
    $('timeline-scroll').scrollLeft=Math.max(0,(geometry.width-$('timeline-scroll').clientWidth)/2);
    applySettingsToForm(s);persistGame();$('candidate').focus({preventScroll:true});prefetchMovies();
  }catch(error){showError(errorId,error.message);}
  finally{busy=false;setStarting(false,fromResults);}
}
$('setup-form').addEventListener('submit',e=>{e.preventDefault();startSession();});
$('resume-button').hidden=!saved;
$('resume-button').addEventListener('click',()=>{
  if(busy)return;
  try{
    saved=loadSession();if(!saved)throw new Error('A sess\u00e3o salva n\u00e3o est\u00e1 dispon\u00edvel.');
    game=saved.game;pool=MoviePool.restore(saved.pool);
    const oldPosition=Number.isFinite(game.viewScrollLeft)?Math.max(0,game.viewScrollLeft):0;
    showScreen('game');lastRange='';$('timeline-scroll').scrollLeft=0;renderGame();
    $('timeline-scroll').scrollLeft=oldPosition;renderTimeline(true);
    if(game.phase==='revealed')openReveal();else $('candidate').focus({preventScroll:true});
    prefetchMovies();
  }catch(error){showError('setup-error',error.message);removeLocal('session');$('resume-button').hidden=true;showScreen('setup');}
});
function timelineGeometry() {
  const viewport=$('timeline-scroll'), style=getComputedStyle(viewport);
  const card=parseInt(style.getPropertyValue('--card-width')), slot=parseInt(style.getPropertyValue('--slot-width'));
  const content=game.timeline.length*(card+slot)+slot+40;
  const width=Math.max(viewport.clientWidth,content);
  geometry={card,slot,stride:card+slot,width,offset:(width-content)/2+20};
  $('timeline-track').style.width=width+'px';
}
function slotLabel(index) {
  const prev=game.timeline[index-1],next=game.timeline[index];
  return prev&&next?`Entre ${prev.title} e ${next.title}`:prev?`Depois de ${prev.title}`:`Antes de ${next.title}`;
}
function lockedSlot(index){
  const prev=game?.timeline?.[index-1],next=game?.timeline?.[index];
  return !!(prev&&next&&prev.year===next.year);
}
function renderTimeline(force=false) {
  if(!game||$('game-screen').hidden)return;
  const viewport=$('timeline-scroll'), oldScroll=viewport.scrollLeft;
  timelineGeometry();
  const {stride,card,slot,offset}=geometry;
  const first=Math.max(0,Math.floor((oldScroll-offset)/stride)-2);
  const last=Math.min(game.timeline.length,Math.ceil((oldScroll+viewport.clientWidth-offset)/stride)+2);
  const key=`${first}:${last}:${geometry.width}:${game.timeline.length}:${game.slot}:${game.phase}`;
  if(!force&&key===lastRange)return;lastRange=key;
  let html='';
  for(let i=first;i<=last;i++){
    const blocked=lockedSlot(i);
    const selected=!blocked&&game.phase==='placing'&&game.slot===i;
    let slotMarkup='';
    if(blocked){
      slotMarkup='<div class="slot-spacer" aria-hidden="true"></div>';
    }else{
      const slotContent=selected?`${poster(game.current,'slot-movie-poster')}<span class="slot-question">?</span><div class="slot-movie-title">${escapeHTML(game.current.title)}</div>`:'<b aria-hidden="true">+</b>';
      slotMarkup=`<button class="slot-button${selected?' film-frame':''}" ${selected?'data-current="true"':''} ${game.phase!=='placing'?'disabled':''} aria-label="${escapeHTML(slotLabel(i))}${selected?', posição selecionada':''}">${slotContent}</button>`;
    }
    html+=`<div class="timeline-slot ${selected?'selected':''} ${blocked?'slot-locked':''}" ${blocked?'':'data-slot="'+i+'"'} style="left:${offset+i*stride}px">${slotMarkup}</div>`;
    if(i<game.timeline.length){
      const m=game.timeline[i],justPlaced=game.reveal?.correct&&m.instance===`turn-${game.attempted}`;
      html+=`<div class="timeline-unit" data-instance="${escapeHTML(m.instance)}" style="left:${offset+slot+i*stride}px"><article class="film-frame movie-card ${justPlaced?'new-card':''}">${poster(m)}${m.instance==='base'?'<span class="base-label">BASE</span>':''}<div class="card-year">${m.year}</div><div class="card-title" title="${escapeHTML(m.title)}">${escapeHTML(m.title)}</div></article><span class="timeline-dot"></span></div>`;
    }
  }
  $('timeline-track').innerHTML=html;handleImages($('timeline-track'));
  viewport.scrollLeft=oldScroll; // Selection/drag never changes horizontal position.
}
function renderCandidate() {
  const revealed=game.phase!=='placing',m=game.current;
  $('candidate').innerHTML=`${poster(m)}<div class="candidate-copy"><small>FILME DA VEZ</small><h3 title="${escapeHTML(m.title)}">${escapeHTML(m.title)}</h3><span class="candidate-year">${revealed?m.year:'?'}</span></div>`;
  $('candidate').setAttribute('aria-label',revealed?`${m.title}, ${m.year}`:`${m.title}. Arraste para a linha ou toque em um espaço para escolher a posição.`);
  $('candidate').setAttribute('aria-disabled',String(revealed));handleImages($('candidate'));
}
function renderStats() {
  $('stat-progress').textContent=`${game.attempted} / ${game.settings.films===null?'\u221e':game.settings.films}`;
  $('stat-score').textContent=game.correct;$('stat-lives').textContent=game.lives===null?'\u221e':game.lives;
  $('round-label').textContent=`${game.attempted} filmes respondidos${pool.cycle>1?' \u00b7 Ciclo '+pool.cycle:''}`;
  for(const id of ['stat-progress','stat-score','stat-lives'])$(id).title=$(id).textContent;
  const infinite=game.settings.films===null;document.querySelector('.progress-rail').hidden=infinite;
  $('progress-fill').style.width=infinite?'0%':Math.min(100,100*game.attempted/game.settings.films)+'%';
}
function renderGame() {
  renderStats();renderTimeline(true);renderCandidate();showError('game-error');
  const revealed=game.phase!=='placing';$('turn-panel').className=`turn-panel${revealed?' revealed':''}`;
  $('confirm-button').hidden=revealed;$('confirm-button').disabled=game.slot===null;
  $('review-answer').hidden=!revealed;
  $('placement-label').textContent=game.slot===null?'Escolha uma posi\u00e7\u00e3o na linha.':slotLabel(game.slot);
  if(!revealed&&$('reveal-popup').open)$('reveal-popup').close();
}
function nextButtonLabel(label=null) {
  $('popup-next-button').innerHTML=`<span>${label||(game?.endReason?'Ver resultado':'Próximo filme')}</span>`;
}
function openReveal() {
  if(!game||game.phase!=='revealed'||busy)return;
  const correct=game.reveal.correct,m=game.reveal.movie,popup=$('reveal-popup');
  popup.classList.toggle('is-correct',correct);popup.classList.toggle('is-wrong',!correct);
  $('reveal-title').textContent=correct?'ACERTOU':'ERROU';
  $('reveal-film-name').textContent=m.title;$('reveal-film-year').textContent=m.year;
  $('reveal-film-year').setAttribute('aria-label','Ano correto: '+m.year);
  $('reveal-detail').textContent=correct?(game.streak>1?game.streak+' acertos seguidos':'Na ordem certa.'):(game.lives===null?'Sua linha continua intacta.':'− 1 vida');
  showError('reveal-error');nextButtonLabel();$('popup-next-button').disabled=false;$('reveal-close').disabled=false;
  if(!popup.open)popup.showModal();$('popup-next-button').focus({preventScroll:true});
}
$('review-answer').addEventListener('click',openReveal);
$('reveal-close').addEventListener('click',()=>{if(!busy)$('reveal-popup').close();});
$('reveal-popup').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('reveal-popup').addEventListener('keydown',e=>{
  if(e.key!=='Tab')return;
  const items=[...e.currentTarget.querySelectorAll('button:not(:disabled)')].filter(el=>el.getClientRects().length);
  if(!items.length){e.preventDefault();return;}
  const first=items[0],last=items[items.length-1],active=document.activeElement;
  if(e.shiftKey&&(active===first||!e.currentTarget.contains(active))){e.preventDefault();last.focus({preventScroll:true});}
  else if(!e.shiftKey&&active===last){e.preventDefault();first.focus({preventScroll:true});}
});

$('reveal-popup').addEventListener('close',()=>{
  if(document.body.dataset.screen==='game'&&game?.phase==='revealed')$('review-answer').focus({preventScroll:true});
});
function selectSlot(index) {
  if(!game||game.phase!=='placing'||busy)return;
  const slot=Math.max(0,Math.min(game.timeline.length,index));
  if(lockedSlot(slot))return;
  game.slot=slot;
  renderTimeline(true);$('confirm-button').disabled=false;$('placement-label').textContent=slotLabel(game.slot);
  $('live-region').textContent=`Posição escolhida: ${slotLabel(game.slot)}. Confirme quando estiver pronto.`;
  persistGame();
}
$('timeline-track').addEventListener('click',e=>{
  if(suppressClick)return;const el=e.target.closest('[data-slot]');if(el)selectSlot(Number(el.dataset.slot));
});
// Keyboard users activate the same + buttons; no separate movement shortcuts.
$('candidate').addEventListener('keydown',e=>{
  if(!game||game.phase!=='placing'||busy||!['Enter',' '].includes(e.key))return;
  e.preventDefault();
  const viewport=$('timeline-scroll').getBoundingClientRect();
  const visible=[...$('timeline-track').querySelectorAll('.slot-button:not(:disabled)')]
    .filter(el=>{const r=el.getBoundingClientRect();return r.right>viewport.left&&r.left<viewport.right;});
  visible[0]?.focus({preventScroll:true});
});
$('timeline-scroll').addEventListener('wheel',e=>{
  if(e.ctrlKey)return;const v=e.currentTarget;
  if(v.scrollWidth<=v.clientWidth)return;
  const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  if(delta){e.preventDefault();v.scrollLeft+=delta*(e.deltaMode===1?24:e.deltaMode===2?v.clientWidth:1);}
},{passive:false});
$('timeline-scroll').addEventListener('scroll',()=>requestAnimationFrame(()=>{if(game)game.viewScrollLeft=$('timeline-scroll').scrollLeft;renderTimeline();if(drag?.active)updateDragHover(drag.x,drag.y);}));
$('scroll-left').addEventListener('click',()=>$('timeline-scroll').scrollBy({left:-$('timeline-scroll').clientWidth*.65,behavior:'smooth'}));
$('scroll-right').addEventListener('click',()=>$('timeline-scroll').scrollBy({left:$('timeline-scroll').clientWidth*.65,behavior:'smooth'}));
new ResizeObserver(()=>{lastRange='';renderTimeline(true);}).observe($('timeline-scroll'));
function updateDragHover(x,y){
  const rect=$('timeline-scroll').getBoundingClientRect();let index=null;
  if(y>=rect.top-15&&y<=rect.bottom+10&&x>=rect.left&&x<=rect.right){
    const relative=x-rect.left+$('timeline-scroll').scrollLeft-geometry.offset;
    index=Math.max(0,Math.min(game.timeline.length,Math.round((relative-geometry.slot/2)/geometry.stride)));
    if(lockedSlot(index))index=null;
  }
  if(hoverSlot!==index){document.querySelector('.drop-hover')?.classList.remove('drop-hover');hoverSlot=index;}
  if(index!==null)$('timeline-track').querySelector(`[data-slot="${index}"]`)?.classList.add('drop-hover');
}
document.addEventListener('pointerdown',e=>{
  if(!game||game.phase!=='placing'||busy||drag||e.button!==0)return;
  const handle=e.target.closest('#candidate, [data-current]');if(!handle)return;
  // Capture on a stable parent: virtualized cards can be replaced during scrolling.
  const capture=$('game-screen');
  drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false,handle:capture};
  try{capture.setPointerCapture(e.pointerId);}catch{drag=null;}
});
document.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;drag.x=e.clientX;drag.y=e.clientY;
  if(!drag.active&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<7)return;
  // touch-action:none already prevents pan on drag handles; do not suppress the next tap.
  if(e.pointerType!=='touch')e.preventDefault();
  if(!drag.active){
    drag.active=true;suppressClick=true;$('candidate').classList.add('dragging');
    const ghost=document.createElement('div');ghost.className='drag-ghost';ghost.innerHTML=`${poster(game.current)}<div class="card-title">${escapeHTML(game.current.title)}</div>`;document.body.appendChild(ghost);handleImages(ghost);drag.ghost=ghost;
  }
  drag.ghost.style.left=e.clientX-66+'px';drag.ghost.style.top=e.clientY-90+'px';updateDragHover(e.clientX,e.clientY);
},{passive:false});
function endDrag(e,cancel=false){
  if(!drag||e.pointerId!==drag.id)return;
  const shouldPlace=drag.active&&!cancel&&hoverSlot!==null,index=hoverSlot;
  const active=drag;drag=null;
  active.ghost?.remove();if(active.handle.hasPointerCapture(active.id))active.handle.releasePointerCapture(active.id);
  $('candidate').classList.remove('dragging');document.querySelector('.drop-hover')?.classList.remove('drop-hover');
  drag=null;hoverSlot=null;if(shouldPlace)selectSlot(index);
  setTimeout(()=>suppressClick=false,0);
}
document.addEventListener('pointerup',e=>endDrag(e));document.addEventListener('pointercancel',e=>endDrag(e,true));
document.addEventListener('lostpointercapture',e=>{if(drag?.id===e.pointerId)endDrag(e,true);});
window.addEventListener('blur',()=>{if(drag)endDrag({pointerId:drag.id},true);});
$('confirm-button').addEventListener('click',()=>{
  if(busy||!game||game.phase!=='placing'||game.slot===null)return;
  const correct=confirmMovie(game);beep(correct);renderGame();persistGame();openReveal();
});
// A quick tap immediately after a drag can lose its compatibility click on touch devices.
// Activate on a stationary touch release; the phase guard prevents duplicate confirmations.
let confirmTouch=null;
$('confirm-button').addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch')confirmTouch={id:e.pointerId,x:e.clientX,y:e.clientY};
});
$('confirm-button').addEventListener('pointercancel',()=>{confirmTouch=null;});
$('confirm-button').addEventListener('pointerup',e=>{
  const t=confirmTouch;confirmTouch=null;
  if(e.pointerType!=='touch'||!t||t.id!==e.pointerId||Math.hypot(e.clientX-t.x,e.clientY-t.y)>10)return;
  const r=e.currentTarget.getBoundingClientRect();
  if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){
    e.preventDefault();e.currentTarget.click();
  }
});
async function goToNextMovie(){
  if(busy||!game||game.phase!=='revealed')return;
  if(game.endReason){showResults(game.endReason);return;}
  busy=true;$('popup-next-button').disabled=true;$('reveal-close').disabled=true;
  $('popup-next-button').setAttribute('aria-busy','true');showError('reveal-error');nextButtonLabel('Carregando...');
  const activeGame=game,activePool=pool,previousCycle=pool.cycle;
  try{
    const next=await activePool.next();
    if(game!==activeGame||activeGame.phase==='finished')return;
    if(!next){showResults('exhausted');return;}
    advanceMovie(game,next);renderGame();persistGame();
    if(pool.cycle>previousCycle)toast('Novo ciclo. Os filmes podem se repetir.');
    $('candidate').focus({preventScroll:true});prefetchMovies();
  }catch(error){
    if(game===activeGame&&activeGame.phase!=='finished'){
      showError('reveal-error',error.message);nextButtonLabel('Tentar novamente');persistGame();
    }
  }finally{
    busy=false;$('popup-next-button').disabled=false;$('reveal-close').disabled=false;$('popup-next-button').setAttribute('aria-busy','false');
  }
}
$('popup-next-button').addEventListener('click',goToNextMovie);
$('end-button').addEventListener('click',()=>{
  if(busy||!game)return;
  modal('<h2>Encerrar sess\u00e3o?</h2><div class="dialog-actions"><button class="outline-button" id="keep-playing">Continuar</button><button class="primary-button" id="confirm-end">Encerrar</button></div>');
  $('keep-playing').addEventListener('click',()=>$('info-dialog').close());
  $('confirm-end').addEventListener('click',()=>{$('info-dialog').close();showResults(game.endReason||'manual');});
});
function showResults(reason){
  finishGame(game,reason);removeLocal('session');saved=null;$('resume-button').hidden=true;showScreen('results');showError('results-error');
  const copy={completed:['Sess\u00e3o completa!',''],lives:['Fim das vidas',''],manual:['Sess\u00e3o encerrada',''],exhausted:['Fim do cat\u00e1logo','Todos os filmes dispon\u00edveis nestes filtros foram usados.']};
  const [title,description]=copy[reason]||copy.manual;
  $('results-title').textContent=title;$('results-description').textContent=description;$('results-description').hidden=!description;
  $('results-score').textContent=game.correct;$('results-accuracy').textContent=game.attempted?Math.round(100*game.correct/game.attempted)+'%':'\u2014';
  $('results-streak').textContent=game.bestStreak;$('results-detail').textContent=`${game.attempted} filme${game.attempted===1?'':'s'} \u00b7 ${game.attempted-game.correct} erro${game.attempted-game.correct===1?'':'s'}`;
  $('play-again').focus({preventScroll:true});
}
$('play-again').addEventListener('click',()=>{
  if(!busy&&game)startSession(structuredClone(game.settings),structuredClone(pool.categories));
});
$('new-game').addEventListener('click',()=>{
  if(busy)return;
  game=null;pool=null;removeLocal('session');saved=null;$('resume-button').hidden=true;
  showScreen('setup');showError('setup-error');showError('game-error');$('start-button').focus({preventScroll:true});
});
$('review-timeline').addEventListener('click',()=>{
  if(busy||!game)return;
  modal(`<h2>Sua linha do tempo</h2><div class="review-list">${game.timeline.map(m=>`<div><b>${m.year}</b><span>${escapeHTML(m.title)}</span></div>`).join('')}</div>`);
});
async function initialize(){
  $('start-button').disabled=true;
  try{
    const loaded=await loadCategories();categories=loaded.categories;
    const active=new Set(categories.filter(c=>c.enabled).map(c=>c.id));
    include=new Set([...include].filter(id=>active.has(id)));exclude=new Set([...exclude].filter(id=>active.has(id)));
    renderCategories();updateSetup();proxyURL();
    $('start-button').disabled=false;
  }catch(error){showError('setup-error','Não foi possível carregar o catálogo de categorias. '+error.message);}
}
showScreen('setup');initialize();
