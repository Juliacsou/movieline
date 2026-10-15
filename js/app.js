import { CONFIG } from '../config.js';
import { settingsFrom, makeGame, confirmMovie, advanceMovie, finishGame } from './engine.js';
import { loadCategories, proxyURL, MoviePool } from './api.js';
import { readLocal, writeLocal, removeLocal, saveSession, loadSession } from './storage.js';
import { icon, hydrateIcons, escapeHTML, poster, handleImages, toast, creditsHTML } from './ui.js';
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
  ['setup','game','results'].forEach(s => $(s+'-screen').hidden = s !== name);
  document.body.dataset.screen = name;
}
function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function modal(html) { $('dialog-content').innerHTML = html; hydrateIcons($('info-dialog')); $('info-dialog').showModal(); }
$('info-dialog').querySelector('.dialog-close').addEventListener('click', () => $('info-dialog').close());
$('info-dialog').addEventListener('click', e => { if (e.target === $('info-dialog')) { const r = e.target.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close(); } });
$('help-button').addEventListener('click', () => modal(`<h2>Um filme de cada vez.</h2><div class="help-step"><b>1</b><p><strong>Monte sua sessão.</strong> Escolha filmes, vidas e categorias. Em Incluir, você combina opções; em Excluir, remove o que não quer.</p></div><div class="help-step"><b>2</b><p><strong>Encontre o lugar do filme.</strong> Um filme-base já aparece com seu ano. Arraste o novo cartaz para antes, depois ou entre filmes. Também vale tocar nos espaços ou usar as setas de posição.</p></div><div class="help-step"><b>3</b><p><strong>Confirme e descubra.</strong> Acertou? O filme fica na linha. Errou? Perde uma vida e o filme é descartado. Depois, avance para o próximo.</p></div><p class="modal-note"><strong>Mesmo ano? Sem pegadinha.</strong> Qualquer posição que mantenha os anos em ordem é aceita. A regra usa o ano da data principal de lançamento do TMDB, sem filtro regional do Brasil.</p><p><strong>Catálogo:</strong> O Movieline seleciona automaticamente filmes conhecidos, com pelo menos 1.000 votos no TMDB. É um critério aproximado de reconhecimento. O filme-base não conta na meta. Cada tentativa conta como um filme, acertando ou errando. Sem limite de filmes, o catálogo é reembaralhado apenas quando o ciclo se esgota. Você pode encerrar a qualquer momento.</p><p><strong>Teclado:</strong> Tab navega; Enter ativa botões; com o cartaz em foco, ← e → escolhem a posição. A roda do mouse e dois dedos percorrem a linha horizontal.</p>`));
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
$('setup-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  showError('setup-error');busy=true;$('start-button').classList.add('loading');$('start-button').disabled=true;
  try {
    const s=settings();const active=categories.filter(c=>c.enabled);const base=proxyURL();
    const newPool=new MoviePool(s,active,base);
    await newPool.prepare();
    const baseMovie=await newPool.next(false), current=await newPool.next(false);
    if(!baseMovie||!current)throw new Error('Não encontramos dois filmes válidos com esses filtros. Experimente outras categorias.');
    pool=newPool;game=makeGame(s,baseMovie,current);showScreen('game');lastRange='';renderGame();persistGame();
    $('candidate').focus({preventScroll:true});prefetchMovies();
  } catch(error){showError('setup-error',error.message);}
  finally{busy=false;$('start-button').classList.remove('loading');$('start-button').disabled=false;}
});
$('resume-button').hidden=!saved;
$('resume-button').addEventListener('click',()=>{
  try {
    saved=loadSession();if(!saved)throw new Error('A sessão salva expirou ou não está disponível.');
    game=saved.game;pool=MoviePool.restore(saved.pool);showScreen('game');lastRange='';renderGame();prefetchMovies();
  } catch(error){showError('setup-error',error.message);removeLocal('session');$('resume-button').hidden=true;}
});
function timelineGeometry() {
  const viewport=$('timeline-scroll'), style=getComputedStyle(document.documentElement);
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
    const selected=game.phase==='placing'&&game.slot===i;
    const slotContent=selected?`${poster(game.current,'slot-movie-poster')}<span class="slot-question">?</span><div class="slot-movie-title">${escapeHTML(game.current.title)}</div>`:'<b>+</b><small>COLOQUE<br>AQUI</small>';
    html+=`<div class="timeline-slot ${selected?'selected':''}" data-slot="${i}" style="left:${offset+i*stride}px"><button class="slot-button" ${selected?'data-current="true"':''} ${game.phase!=='placing'?'disabled':''} aria-label="${escapeHTML(slotLabel(i))}${selected?', posição selecionada':''}">${slotContent}</button></div>`;
    if(i<game.timeline.length){
      const m=game.timeline[i],justPlaced=game.reveal?.correct&&m.instance===`turn-${game.attempted}`;
      html+=`<div class="timeline-unit" data-instance="${escapeHTML(m.instance)}" style="left:${offset+slot+i*stride}px"><article class="movie-card ${justPlaced?'new-card':''}">${poster(m)}${m.instance==='base'?'<span class="base-label">FILME-BASE</span>':''}<div class="card-year">${m.year}</div><div class="card-title">${escapeHTML(m.title)}</div></article><span class="timeline-dot"></span></div>`;
    }
  }
  $('timeline-track').innerHTML=html;handleImages($('timeline-track'));
  viewport.scrollLeft=oldScroll; // Selection/drag never changes horizontal position.
}
function renderCandidate() {
  const revealed=game.phase!=='placing',m=game.current;
  $('candidate').innerHTML=`${poster(m)}<div class="candidate-copy"><small>${revealed?'ANO REVELADO':'SEU FILME'}</small>${escapeHTML(m.title)}<span class="candidate-year">${revealed?m.year:'?'}</span></div>`;
  $('candidate').setAttribute('aria-label',revealed?`${m.title}, ${m.year}`:`${m.title}. Arraste para a linha ou use as setas para escolher a posição.`);
  $('candidate').setAttribute('aria-disabled',String(revealed));handleImages($('candidate'));
}
function renderStats() {
  $('stat-progress').textContent=`${game.attempted} / ${game.settings.films===null?'∞':game.settings.films}`;
  $('stat-score').textContent=game.correct;
  $('stat-lives').textContent=`♥ ${game.lives===null?'∞':game.lives}`;
  $('round-label').textContent=`SESSÃO TMDB${pool.cycle>1?' · CICLO '+pool.cycle:''}`;
  $('progress-fill').style.width=game.settings.films===null?'0%':Math.min(100,100*game.attempted/game.settings.films)+'%';
}
function renderGame() {
  renderStats();renderTimeline(true);renderCandidate();showError('game-error');
  const revealed=game.phase!=='placing',correct=game.reveal?.correct;
  $('turn-panel').className=`turn-panel ${revealed?'revealed '+(correct?'correct':'wrong'):''}`;
  $('confirm-button').hidden=revealed;$('confirm-button').disabled=game.slot===null;
  $('next-button').hidden=!revealed;$('next-button').disabled=false;
  document.querySelector('.position-buttons').hidden=revealed;
  if(!revealed){
    $('turn-eyebrow').textContent='EM QUE ANO ESSA HISTÓRIA COMEÇOU?';$('turn-title').textContent='Onde esse filme se encaixa?';
    $('turn-instruction').innerHTML='Arraste o cartaz para um espaço da linha do tempo.<br>O ano só aparece depois de confirmar.';
    $('placement-label').textContent=game.slot===null?'Escolha uma posição acima':slotLabel(game.slot);
    $('turn-small-note').textContent='Pode mudar de ideia antes de confirmar.';
  }else{
    $('turn-eyebrow').textContent=correct?'LUZES PARA VOCÊ!':'CORTA! NÃO FOI DESSA VEZ.';
    $('turn-title').textContent=correct?`Acertou! É de ${game.current.year}.`:`Esse filme é de ${game.current.year}.`;
    $('turn-instruction').textContent=correct?'Mais um clássico no lugar certo. Seu filme agora faz parte da linha do tempo.':
      game.lives===null?'O filme foi descartado. No modo de vidas infinitas, a sessão continua.':'Você perdeu uma vida. O filme foi descartado, mas a sua linha continua intacta.';
    $('placement-label').textContent=correct?(game.streak>1?`${game.streak} acertos seguidos. Que sequência!`:'Muito bem. Pode chamar o próximo!'):'Posição correta: '+slotLabel(game.reveal.insertion);
    $('next-button').innerHTML=`${game.endReason?'Ver resultado':'Próximo filme'}${icon('arrow-right')}`;
    $('turn-small-note').textContent=game.endReason?'Sua sessão chegou ao fim.':'Sem pressa. Quando estiver pronto, avance.';
    $('live-region').textContent=$('turn-title').textContent+' '+$('turn-instruction').textContent;
  }
}
function selectSlot(index,scroll=false) {
  if(!game||game.phase!=='placing'||busy)return;
  game.slot=Math.max(0,Math.min(game.timeline.length,index));
  renderTimeline(true);$('confirm-button').disabled=false;$('placement-label').textContent=slotLabel(game.slot);
  $('live-region').textContent=`Posição escolhida: ${slotLabel(game.slot)}. Confirme quando estiver pronto.`;
  if(scroll){
    const el=$('timeline-scroll'),x=geometry.offset+game.slot*geometry.stride;
    if(x<el.scrollLeft||x+geometry.slot>el.scrollLeft+el.clientWidth)
      el.scrollTo({left:Math.max(0,x-el.clientWidth/2+geometry.slot/2),behavior:'smooth'});
  }
  persistGame();
}
$('timeline-track').addEventListener('click',e=>{
  if(suppressClick)return;const el=e.target.closest('[data-slot]');if(el)selectSlot(Number(el.dataset.slot));
});
$('position-left').addEventListener('click',()=>selectSlot(game.slot===null?0:game.slot-1,true));
$('position-right').addEventListener('click',()=>selectSlot(game.slot===null?game.timeline.length:game.slot+1,true));
$('candidate').addEventListener('keydown',e=>{
  if(!game||game.phase!=='placing')return;
  if(['ArrowLeft','ArrowRight','Enter',' '].includes(e.key)){
    e.preventDefault();if(e.key==='ArrowLeft')selectSlot(game.slot===null?0:game.slot-1,true);
    else if(e.key==='ArrowRight')selectSlot(game.slot===null?game.timeline.length:game.slot+1,true);
    else if(game.slot===null)selectSlot(Math.ceil(game.timeline.length/2),true);else $('confirm-button').focus({preventScroll:true});
  }
});
$('timeline-scroll').addEventListener('wheel',e=>{
  if(e.ctrlKey)return;const v=e.currentTarget;
  if(v.scrollWidth<=v.clientWidth)return;
  const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  if(delta){e.preventDefault();v.scrollLeft+=delta*(e.deltaMode===1?24:e.deltaMode===2?v.clientWidth:1);}
},{passive:false});
$('timeline-scroll').addEventListener('scroll',()=>requestAnimationFrame(()=>{renderTimeline();if(drag?.active)updateDragHover(drag.x,drag.y);}));
$('scroll-left').addEventListener('click',()=>$('timeline-scroll').scrollBy({left:-$('timeline-scroll').clientWidth*.65,behavior:'smooth'}));
$('scroll-right').addEventListener('click',()=>$('timeline-scroll').scrollBy({left:$('timeline-scroll').clientWidth*.65,behavior:'smooth'}));
new ResizeObserver(()=>{lastRange='';renderTimeline(true);}).observe($('timeline-scroll'));
function updateDragHover(x,y){
  const rect=$('timeline-scroll').getBoundingClientRect();let index=null;
  if(y>=rect.top-15&&y<=rect.bottom+10&&x>=rect.left&&x<=rect.right){
    const relative=x-rect.left+$('timeline-scroll').scrollLeft-geometry.offset;
    index=Math.max(0,Math.min(game.timeline.length,Math.round((relative-geometry.slot/2)/geometry.stride)));
  }
  if(hoverSlot!==index){document.querySelector('.drop-hover')?.classList.remove('drop-hover');hoverSlot=index;}
  if(index!==null)$('timeline-track').querySelector(`[data-slot="${index}"]`)?.classList.add('drop-hover');
}
document.addEventListener('pointerdown',e=>{
  if(!game||game.phase!=='placing'||busy||e.button!==0)return;
  const handle=e.target.closest('#candidate, [data-current]');if(!handle)return;
  drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false,handle};
  handle.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;drag.x=e.clientX;drag.y=e.clientY;
  if(!drag.active&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<7)return;
  e.preventDefault();
  if(!drag.active){
    drag.active=true;suppressClick=true;$('candidate').classList.add('dragging');
    const ghost=document.createElement('div');ghost.className='drag-ghost';ghost.innerHTML=`${poster(game.current)}<div class="card-title">${escapeHTML(game.current.title)}</div>`;document.body.appendChild(ghost);handleImages(ghost);drag.ghost=ghost;
  }
  drag.ghost.style.left=e.clientX-66+'px';drag.ghost.style.top=e.clientY-90+'px';updateDragHover(e.clientX,e.clientY);
},{passive:false});
function endDrag(e,cancel=false){
  if(!drag||e.pointerId!==drag.id)return;
  const shouldPlace=drag.active&&!cancel&&hoverSlot!==null,index=hoverSlot;
  drag.ghost?.remove();if(drag.handle.hasPointerCapture(drag.id))drag.handle.releasePointerCapture(drag.id);
  $('candidate').classList.remove('dragging');document.querySelector('.drop-hover')?.classList.remove('drop-hover');
  drag=null;hoverSlot=null;if(shouldPlace)selectSlot(index,false);
  setTimeout(()=>suppressClick=false,0);
}
document.addEventListener('pointerup',e=>endDrag(e));document.addEventListener('pointercancel',e=>endDrag(e,true));
$('confirm-button').addEventListener('click',()=>{
  if(busy||!game||game.phase!=='placing'||game.slot===null)return;
  const correct=confirmMovie(game);beep(correct);renderGame();persistGame();$('next-button').focus({preventScroll:true});
});
$('next-button').addEventListener('click',async()=>{
  if(busy||!game||game.phase!=='revealed')return;
  if(game.endReason){showResults(game.endReason);return;}
  busy=true;$('next-button').disabled=true;showError('game-error');
  const activeGame=game, activePool=pool, previousCycle=pool.cycle;
  try{
    const next=await activePool.next();
    if(game!==activeGame || activeGame.phase==='finished')return;
    if(!next){showResults('exhausted');return;}
    advanceMovie(game,next);renderGame();persistGame();
    if(pool.cycle>previousCycle)toast('Novo ciclo! Você percorreu o catálogo acessível nestes filtros. Os filmes agora podem se repetir.');
    $('candidate').focus({preventScroll:true});prefetchMovies();
  }catch(error){if(game===activeGame && activeGame.phase!=='finished'){showError('game-error',error.message+' Clique em Próximo filme para tentar novamente.');persistGame();}}
  finally{busy=false;$('next-button').disabled=false;}
});
$('end-button').addEventListener('click',()=>{
  modal('<h2>Fechar a cortina?</h2><p>Você pode encerrar agora e ver seu resultado. A tentativa atual só conta se já foi confirmada.</p><div class="dialog-actions"><button class="outline-button" id="keep-playing">Continuar jogando</button><button class="primary-button" id="confirm-end">Encerrar sessão</button></div>');
  $('keep-playing').addEventListener('click',()=>$('info-dialog').close());
  $('confirm-end').addEventListener('click',()=>{$('info-dialog').close();showResults(game.endReason||'manual');});
});
function showResults(reason){
  finishGame(game,reason);removeLocal('session');saved=null;$('resume-button').hidden=true;showScreen('results');
  const copy={completed:['Sessão completa!','Você chegou ao último filme. Pode aplaudir!'],lives:['Corta! Por hoje é só.','As vidas acabaram, mas sempre existe uma próxima sessão.'],manual:['Foi uma boa sessão.','Sua sessão foi encerrada. O cinema continua por aqui.'],exhausted:['Você zerou o catálogo!','Os filmes disponíveis nestes filtros acabaram antes da meta. Amplie as categorias ou use o modo infinito.']};
  const [title,description]=copy[reason]||copy.manual;
  $('results-title').textContent=title;$('results-description').textContent=description;
  $('results-score').textContent=game.correct;$('results-accuracy').textContent=game.attempted?Math.round(100*game.correct/game.attempted)+'%':'—';
  $('results-streak').textContent=game.bestStreak;
  $('results-detail').textContent=`${game.attempted} filme(s) respondido(s) · ${game.attempted-game.correct} erro(s) · ${game.timeline.length} filme(s) na linha, incluindo o filme-base.`;
}
$('play-again').addEventListener('click',()=>{game=null;pool=null;showScreen('setup');showError('setup-error');});
$('review-timeline').addEventListener('click',()=>modal(`<h2>Sua história em filmes</h2><p>${game.timeline.length} filmes na ordem, incluindo o filme-base.</p><div class="review-list">${game.timeline.map(m=>`<div><b>${m.year}</b><span>${escapeHTML(m.title)}</span></div>`).join('')}</div>`));
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
