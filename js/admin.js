import { CONFIG } from '../config.js';
import { famePreset } from './presets.js';
import { validateCategory } from './engine.js';
import { loadCategories, loadPublishedCategories, validateCategories, proxyURL, tmdbRequest } from './api.js';
import { writeLocal, removeLocal } from './storage.js';
import { hydrateIcons, escapeHTML, toast, creditsHTML } from './ui.js';
const $=id=>document.getElementById(id);
let categories=[],published=[];
hydrateIcons();
function status(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);}
function dialog(html){$('admin-dialog-content').innerHTML=html;$('admin-dialog').showModal();}
$('close-dialog').addEventListener('click',()=>$('admin-dialog').close());
$('credits-button').addEventListener('click',()=>dialog(creditsHTML()));
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===button)));
  document.querySelectorAll('.admin-tab').forEach(p=>p.hidden=p.id!=='tab-'+button.dataset.tab);
}));
try{$('proxy-url').value=proxyURL();}catch(error){status('connection-status',error.message,true);}
$('test-connection').addEventListener('click',async()=>{
  const button=$('test-connection');button.disabled=true;
  status('connection-status','Consultando a conexão fixa e testando duas páginas do catálogo...');
  $('rate-limit-status').hidden=true;
  try{
    const base=proxyURL(), health=await tmdbRequest(base,'/health');
    if(health.service!=='movieline-tmdb')throw new Error('O endereço respondeu, mas não é o Worker do Movieline.');
    if(!health.configured)throw new Error('O Worker está online, mas o segredo do TMDB não foi configurado.');
    if(Number(String(health.version||'1').split('.')[0])<2)
      throw new Error('O Worker ainda está na v1. Atualize seu código para a v2 no Cloudflare e clique em Deploy. Mantenha o segredo existente.');
    const preset=famePreset(CONFIG.DEFAULT_FAME);
    const params={'vote_count.gte':preset.minVotes,sort_by:preset.sort};
    const first=await tmdbRequest(base,'/discover/movie',{...params,page:1});
    if(!Array.isArray(first.results))throw new Error('Resposta de catálogo inválida.');
    let checked=first.results.length, pages=1;
    if(first.total_pages>1){
      const second=await tmdbRequest(base,'/discover/movie',{...params,page:2});
      if(!Array.isArray(second.results))throw new Error('A segunda página retornou uma resposta inválida.');
      const unique=new Set([...first.results,...second.results].map(m=>m.id));
      if(unique.size<=new Set(first.results.map(m=>m.id)).size)throw new Error('As duas páginas retornaram apenas os mesmos filmes. Verifique a paginação do Worker.');
      checked=unique.size;pages=2;
    }
    const total=Number(first.total_results)||0;
    status('connection-status',`Conexão ativa para todos os jogadores. ${checked} filmes distintos verificados em ${pages} página(s). O TMDB informa ${total.toLocaleString('pt-BR')} resultados no filtro Famosos, antes das categorias e da validação de datas. O jogo busca outras páginas automaticamente: não está limitado ao lote deste teste. Não precisa salvar nenhuma URL.`);
    $('rate-limit-status').hidden=false;
    $('rate-limit-status').textContent=health.rate_limit?'Proteção de taxa ativa no Worker.':'A conexão funciona, mas o binding RATE_LIMITER ainda não está ativo. Configure-o antes de divulgar amplamente. Isso não altera a quantidade de filmes do jogo.';
  }catch(error){status('connection-status',error.message,true);}finally{button.disabled=false;}
});
function renderCategories(){
  const term=$('category-search').value.toLocaleLowerCase('pt-BR');
  const kinds={genre:'Gênero',company:'Produtora',curated:'Lista de filmes'};
  $('admin-category-list').innerHTML=categories.filter(c=>c.label.toLocaleLowerCase('pt-BR').includes(term))
    .sort((a,b)=>a.sort_order-b.sort_order||a.label.localeCompare(b.label,'pt-BR')).map(c=>
    `<div class="admin-category-row"><div><b>${escapeHTML(c.label)}${c.enabled?'':' · INATIVA'}</b><p>${kinds[c.kind]} · ${c.tmdb_ids.length} ID(s) · ${escapeHTML(c.id)}</p></div><button class="outline-button" data-edit="${escapeHTML(c.id)}">Editar</button></div>`).join('')||'<p style="padding:20px">Nenhuma categoria encontrada. Use Nova categoria.</p>';
}
async function reload(){
  try{
    const loaded=await loadCategories();categories=loaded.categories;renderCategories();
    $('admin-mode').textContent=loaded.source==='preview'?'PRÉVIA LOCAL':'PUBLICADO';
    $('catalog-warning').textContent=loaded.source==='preview'?
      'Você está editando uma prévia apenas neste navegador. Para publicar para todos, exporte categories.json e substitua esse arquivo no GitHub. Nenhum banco de dados é usado.':
      'Categorias carregadas do arquivo público categories.json. Edições aqui criam uma prévia local; exporte o JSON e envie ao GitHub para publicar para todos. Não há gravação remota pelo painel.';
  }catch(error){status('admin-status',error.message+' Confira categories.json ou remova a prévia local.',true);}
}
async function saveRows(rows){
  if(!writeLocal('categories',validateCategories(rows)))throw new Error('Não foi possível salvar a prévia no navegador.');
  await reload();
}
function editor(id=null){
  const c=categories.find(x=>x.id===id),isNew=!c;
  dialog(`<form class="category-form" id="category-form"><h2>${isNew?'Nova categoria':'Editar categoria'}</h2><p class="form-note">Gênero usa IDs de gêneros; produtora usa IDs de empresas; lista usa IDs de filmes do TMDB. Separe IDs por vírgula. Aqui são salvos apenas os critérios, não os dados dos filmes.</p><label>Nome exibido<input name="label" value="${escapeHTML(c?.label||'')}" maxlength="64" required></label><div class="form-row"><label>Identificador<input name="id" value="${escapeHTML(c?.id||'')}" pattern="[a-z0-9][a-z0-9-]{1,63}" ${isNew?'':'readonly'} required placeholder="minha-categoria"></label><label>Tipo<select name="kind">${[['genre','Gênero'],['company','Produtora'],['curated','Lista de filmes']].map(([v,l])=>`<option value="${v}" ${c?.kind===v?'selected':''}>${l}</option>`).join('')}</select></label></div><label>IDs do TMDB<textarea name="tmdb_ids" required placeholder="862, 12, 2062">${(c?.tmdb_ids||[]).join(', ')}</textarea></label><label>Descrição e critério<textarea name="description" maxlength="500">${escapeHTML(c?.description||'')}</textarea></label><div class="form-row"><label>Ordem na tela<input name="sort_order" type="number" step="1" value="${c?.sort_order??100}"></label><label class="checkbox-label"><input name="enabled" type="checkbox" ${c?.enabled!==false?'checked':''}>Categoria ativa</label></div><div id="category-error" class="admin-status error" role="alert"></div><div class="dialog-actions"><button type="button" class="outline-button" id="cancel-edit">Cancelar</button><button type="submit" class="primary-button">Salvar prévia local</button></div>${!isNew?'<button type="button" id="delete-category" class="danger-button">Excluir desta prévia</button>':''}</form>`);
  $('cancel-edit').addEventListener('click',()=>$('admin-dialog').close());
  $('category-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;
    try{
      const data=new FormData(e.target);const category=validateCategory({id:data.get('id'),label:data.get('label'),kind:data.get('kind'),
        tmdb_ids:String(data.get('tmdb_ids')).split(/[,\s]+/).filter(Boolean).map(Number),description:data.get('description'),sort_order:Number(data.get('sort_order')),enabled:data.get('enabled')==='on'});
      if(isNew&&categories.some(c=>c.id===category.id))throw new Error('Já existe uma categoria com esse identificador.');
      await saveRows(isNew?[...categories,category]:categories.map(x=>x.id===category.id?category:x));
      $('admin-dialog').close();toast('Prévia salva. Exporte o JSON para publicar no GitHub.');
    }catch(error){status('category-error',error.message,true);}finally{button.disabled=false;}
  });
  if(!isNew)$('delete-category').addEventListener('click',async()=>{
    if(!confirm(`Excluir "${c.label}" desta prévia? Nada será apagado do TMDB ou de outros jogos.`))return;
    try{await saveRows(categories.filter(x=>x.id!==c.id));$('admin-dialog').close();toast('Categoria excluída apenas da prévia.');}
    catch(error){status('category-error',error.message,true);}
  });
}
$('new-category').addEventListener('click',()=>editor());
$('admin-category-list').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)editor(b.dataset.edit);});
$('category-search').addEventListener('input',renderCategories);
$('seed-categories').addEventListener('click',async()=>{
  const button=$('seed-categories');button.disabled=true;
  try{
    published=await loadPublishedCategories();
    const missing=published.filter(c=>!categories.some(x=>x.id===c.id));
    if(!missing.length){toast('Nenhuma categoria publicada está ausente.');return;}
    await saveRows([...categories,...missing]);toast(missing.length+' categoria(s) adicionada(s) à prévia.');
  }catch(error){status('admin-status',error.message,true);}finally{button.disabled=false;}
});
$('reset-preview').addEventListener('click',async()=>{
  if(!confirm('Descartar as alterações locais e voltar ao arquivo publicado? Exporte antes para guardar uma cópia.'))return;
  removeLocal('categories');await reload();toast('Agora este navegador usa o catálogo publicado.');
});
$('export-categories').addEventListener('click',()=>{
  const data={version:2,categories},url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='categories.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import-categories').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>1000000)throw new Error('Importe um JSON de até 1 MB.');
    const validated=validateCategories(JSON.parse(await file.text()));
    const existing=new Set(categories.map(c=>c.id)),missing=validated.filter(c=>!existing.has(c.id));
    if(!missing.length){toast('Nenhum ID novo encontrado. Para alterar uma categoria, use Editar.');return;}
    if(!confirm(`Adicionar ${missing.length} categorias à prévia? As existentes não serão sobrescritas.`))return;
    await saveRows([...categories,...missing]);toast(missing.length+' categorias importadas apenas neste navegador.');
  }catch(error){status('admin-status',error.message,true);}finally{e.target.value='';}
});
reload();
