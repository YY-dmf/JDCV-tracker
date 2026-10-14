'use strict';
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textOf = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; };
const pad = n => String(n).padStart(2, '0');
const dateShort = t => { const d = new Date(t); return `${pad(d.getMonth()+1)}${pad(d.getDate())}`; };
const dateLong = t => { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}`; };
const sizeLabel = n => n < 1024*1024 ? `${Math.ceil(n/1024)} KB` : `${(n/1024/1024).toFixed(1)} MB`;
const initialWidths = [67,110,145,72,78,235,175,36];
const defaultProfile = {name:'新用户',headline:'每一步，都算数。',tagline:'把机会认真记录，把成长慢慢积累。下一站，去更大的世界。',avatar:''};
let state = {version:2,jobs:[],memos:[],resumes:[],widths:[...initialWidths],profile:{...defaultProfile},jobPageSize:10,memoOrder:[]};
const applicationStates = ['pending','sent','processing','rejected'];
const applicationLabels = {pending:'待投递',sent:'已投递',processing:'流程中',rejected:'寄了'};
const applicationSymbols = {pending:'',sent:'√',processing:'◷',rejected:'×'};
let jobPage=1,memoPage=1,memoPageSize=6,memoLayoutFrame=0;
const expandedMemos=new Set();
let currentView = 'home', jdReturnView = 'home';
let db, filter = 'all', currentJobId = null, currentResumeId = null, menuJobId = null, activeEditor = null, selectionRange = null;
let saveChain = Promise.resolve(), saveVersion = 0, pendingSaves = 0, saveFailed = false, autosaveBlocked = false, ready = false, toastTimer, undoAction;
const imagePattern = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/;
const pdfPattern = /^data:application\/pdf;base64,[A-Za-z0-9+/=\r\n]+$/;

// Keep formatting only. Pasted/imported HTML never keeps scripts, links or remote resources.
function cleanHTML(value, multiline = true) {
  const template = document.createElement('template'); template.innerHTML = String(value || '');
  const clean = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    const out = document.createDocumentFragment();
    if (node.nodeType !== Node.ELEMENT_NODE) return out;
    const tag = node.tagName;
    if (['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','TEMPLATE'].includes(tag)) return out;
    if (tag === 'BR') return multiline ? document.createElement('br') : document.createTextNode(' ');
    let el;
    if (['B','STRONG','I','EM','S','STRIKE','U'].includes(tag)) el = document.createElement(tag.toLowerCase());
    else if (['DIV','P','LI','UL','OL'].includes(tag) && multiline) el = document.createElement(tag === 'P' ? 'div' : tag.toLowerCase());
    else el = document.createElement('span');
    const color = node.getAttribute('color') || node.style.color;
    if (color && CSS.supports('color', color) && !/var\(|url\(/i.test(color)) el.style.color = color;
    if (['bold','600','650','700','800','900'].includes(node.style.fontWeight)) el.style.fontWeight = 'bold';
    if (node.style.fontStyle === 'italic') el.style.fontStyle = 'italic';
    const decoration=node.style.textDecorationLine || node.style.textDecoration;
    const decorations=['underline','line-through'].filter(v=>decoration.includes(v));
    if(decorations.length) el.style.textDecoration = decorations.join(' ');
    node.childNodes.forEach(child => el.append(clean(child)));
    if (el.tagName === 'SPAN' && !el.getAttribute('style')) { while(el.firstChild) out.append(el.firstChild); return out; }
    return el;
  };
  const result = document.createElement('div'); template.content.childNodes.forEach(n => result.append(clean(n)));
  return result.innerHTML;
}

function toast(message, undo) {
  $('toast-message').textContent = message; $('toast').classList.add('visible');
  undoAction = undo || null; $('toast-undo').hidden = !undo;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').classList.remove('visible'); undoAction = null; }, undo ? 10000 : 4500);
}
$('toast-undo').onclick = () => { const action = undoAction; undoAction = null; if(action) action(); toast('已撤销'); };
function setStatus(message, error = false) { $('save-status').innerHTML = `<i></i> ${escapeHTML(message)}`; $('save-status').classList.toggle('error',error); }
function openDatabase() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('vcjdtracker-workspace',1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('数据库被其他页面占用'));
  });
}
function readState() {
  return new Promise((resolve,reject) => { const request = db.transaction('workspace').objectStore('workspace').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function writeState(snapshot) {
  return new Promise((resolve,reject) => {
    if(!db) { reject(new Error('浏览器存储不可用')); return; }
    const tx = db.transaction('workspace','readwrite'); tx.objectStore('workspace').put(snapshot,'current');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存中断'));
  });
}
function save() {
  const version = ++saveVersion; pendingSaves++; setStatus('正在保存…');
  // Serialize writes; the last transaction always contains the newest state.
  saveChain = saveChain.then(async () => {
    try { if(autosaveBlocked)throw new Error('原始数据读取失败'); await writeState(state); saveFailed = false; if(version === saveVersion) setStatus('已保存到本地'); }
    catch { saveFailed = true; setStatus('保存失败，请导出备份',true); toast('本地保存失败，请先导出备份，避免内容丢失。'); }
    finally { pendingSaves--; }
  });
  return saveChain;
}
window.addEventListener('beforeunload',e => { if(pendingSaves || saveFailed) { e.preventDefault(); e.returnValue = ''; } });

function confirmAction(message, label = '确定') {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog'); $('confirm-message').textContent = message; $('confirm-ok').textContent = label;
    const finish = result => { dialog.oncancel = null; $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; dialog.close(); resolve(result); };
    $('confirm-ok').onclick = () => finish(true); $('confirm-cancel').onclick = () => finish(false);
    dialog.oncancel = e => { e.preventDefault(); finish(false); }; dialog.showModal(); $('confirm-cancel').focus();
  });
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('.topbar nav a,.brand').forEach(a => a.onclick = e => {
  e.preventDefault(); history.pushState(null,'',a.getAttribute('href')); route();
});

function updateStats() {
  applicationStates.forEach(value => { $(`stat-${value}`).textContent = state.jobs.filter(j => j.application === value).length; });
  $('filter-all').textContent = state.jobs.length;
  $('resume-count').textContent = state.resumes.length; $('memo-count').textContent = state.memos.length;
}
function visibleJobs() {
  const query = $('search').value.trim().toLowerCase();
  return state.jobs.filter(j => (filter === 'all' || j.application === filter) && (!query || [j.company,j.role,j.status,j.notes].some(v => textOf(v).toLowerCase().includes(query))))
    .sort((a,b) => Number(b.application==='processing')-Number(a.application==='processing') || (b.date || b.createdAt) - (a.date || a.createdAt) || b.createdAt-a.createdAt);
}
function richCell(job, field, placeholder, extra='') {
  return `<div class="rich ${extra}" contenteditable="true" role="textbox" aria-label="${placeholder}" data-job="${job.id}" data-field="${field}" data-placeholder="${placeholder}" spellcheck="false">${job[field]}</div>`;
}
function applicationButton(job) {
  const current=job.application, next=applicationStates[(applicationStates.indexOf(current)+1)%applicationStates.length];
  return `<button class="apply-check" data-state="${current}" aria-label="${applicationLabels[current]}，点击切换为${applicationLabels[next]}" title="${applicationLabels[current]} · 点击切换为${applicationLabels[next]}" data-apply="${job.id}">${applicationSymbols[current]}</button>`;
}
let pendingJobRefresh=false;
function renderJobs() {
  pendingJobRefresh=false;
  const matched=visibleJobs(),size=state.jobPageSize||10,pages=Math.max(1,Math.ceil(matched.length/size));
  jobPage=Math.max(1,Math.min(jobPage,pages));
  const rows=matched.slice((jobPage-1)*size,jobPage*size);
  $('job-rows').innerHTML = rows.map(j => `<tr data-id="${j.id}"><td class="date-cell" title="${j.date ? dateLong(j.date) : '填写企业后自动生成日期'}">${j.date ? dateShort(j.date) : '—'}</td><td>${richCell(j,'company','企业','cell-company')}</td><td>${richCell(j,'role','岗位名称')}</td><td><a href="#jd/${j.id}" class="jd-link" aria-label="${escapeHTML(textOf(j.company)||'新记录')} JD 详情">详情 ↗</a></td><td>${applicationButton(j)}</td><td class="left-cell">${richCell(j,'status','记录每一个投递节点…')}</td><td class="left-cell">${richCell(j,'notes','添加备注…')}</td><td><button class="icon-button row-more" data-menu="${j.id}" aria-label="记录操作" title="记录操作">⋯</button></td></tr>`).join('');
  $('jobs-empty').hidden = rows.length > 0;
  const empty = $('jobs-empty');
  empty.querySelector('h3').textContent = state.jobs.length ? '没有找到匹配的记录' : '下一段旅程，从一个机会开始';
  empty.querySelector('p').textContent = state.jobs.length ? '试试其他关键词，或切换投递筛选。' : '记录感兴趣的岗位，让每一次投递都有迹可循。';
  $('add-first-job').hidden = state.jobs.length > 0;
  $('record-count').textContent = matched.length ? `第 ${(jobPage-1)*size+1}–${(jobPage-1)*size+rows.length} 条 / 匹配 ${matched.length} 条 · 共 ${state.jobs.length} 条` : `匹配 0 条 · 共 ${state.jobs.length} 条`;
  $('job-page-info').textContent=`${jobPage} / ${pages}`;
  $('job-prev').disabled=jobPage===1;$('job-next').disabled=jobPage===pages;
  $('job-page-size').value=[10,15,20].includes(size)?String(size):'custom';
  $('custom-size-wrap').hidden=$('job-page-size').value!=='custom';$('job-custom-size').value=size;
  updateStats();
  scheduleMemoLayout();
}
function resetFilters() { jobPage=1;filter = 'all'; $('search').value = ''; document.querySelectorAll('[data-filter]').forEach(b => { const active = b.dataset.filter === filter; b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active)); }); }
function revealJob(id,field) {
  const index=visibleJobs().findIndex(j=>j.id===id);if(index<0)return;
  jobPage=Math.floor(index/(state.jobPageSize||10))+1;renderJobs();
  if(field){const editor=document.querySelector(`[data-job="${id}"][data-field="${field}"]`);if(editor)caretAt(editor);}
}
function addJob(source) {
  if(!ready) return;
  const now = Date.now(); const job = source ? {...structuredClone(source),id:uid(),createdAt:now,date:textOf(source.company).trim() ? now : null} : {id:uid(),createdAt:now,date:null,company:'',role:'',application:'pending',status:'',notes:'',jd:'',images:[]};
  if(source) job.images=job.images.map(img=>({...img,id:uid()}));
  state.jobs.unshift(job); resetFilters(); revealJob(job.id,'company'); save();
}
['add-job','add-first-job','add-bottom-job'].forEach(id => $(id).onclick = () => addJob());
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { jobPage=1;filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(btn => { const active = b === btn; btn.classList.toggle('active',active); btn.setAttribute('aria-pressed',String(active)); }); renderJobs(); });
$('search').oninput = ()=>{jobPage=1;renderJobs();};
$('job-prev').onclick=()=>{jobPage--;renderJobs();};$('job-next').onclick=()=>{jobPage++;renderJobs();};
function changePageSize(size){state.jobPageSize=size;jobPage=1;renderJobs();save();}
$('job-page-size').onchange=e=>{if(e.target.value==='custom'){$('custom-size-wrap').hidden=false;$('job-custom-size').focus();}else changePageSize(Number(e.target.value));};
$('custom-size-wrap').onsubmit=e=>{e.preventDefault();const input=$('job-custom-size');if(input.reportValidity())changePageSize(Number(input.value));};
$('job-rows').addEventListener('click', e => {
  const check = e.target.closest('[data-apply]');
  if(check) {
    const j = state.jobs.find(j => j.id === check.dataset.apply);
    j.application = applicationStates[(applicationStates.indexOf(j.application)+1)%applicationStates.length]; save();
    const replacement=document.createElement('template');replacement.innerHTML=applicationButton(j);
    const next=replacement.content.firstElementChild;
    for(const attribute of next.attributes)check.setAttribute(attribute.name,attribute.value);
    check.textContent=next.textContent;
    pendingJobRefresh=true;updateStats();
  }
  const menu = e.target.closest('[data-menu]'); if(menu) { e.stopPropagation(); const rect = menu.getBoundingClientRect(); showMenu(menu.dataset.menu,rect.right,rect.bottom); }
});
// Keep the clicked state in place until the next click elsewhere.
document.addEventListener('click',e=>{
  if(!pendingJobRefresh||e.target.closest('[data-apply]'))return;
  queueMicrotask(()=>{
    if(!pendingJobRefresh)return;
    const oldRows=new Map([...$('job-rows').children].map(row=>[row.dataset.id,row]));
    const active=document.activeElement,selection=getSelection();
    const saved=selection.rangeCount?{anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset}:null;
    const restoreFocus=$('job-rows').contains(active);
    renderJobs();
    [...$('job-rows').children].forEach(row=>{const old=oldRows.get(row.dataset.id);if(old)row.replaceWith(old);});
    if(restoreFocus&&active.isConnected){active.focus({preventScroll:true});if(saved?.anchor?.isConnected&&saved.focus?.isConnected)selection.setBaseAndExtent(saved.anchor,saved.anchorOffset,saved.focus,saved.focusOffset);}
  });
},true);
$('job-rows').addEventListener('contextmenu',e => { const row = e.target.closest('tr'); if(row) { e.preventDefault(); showMenu(row.dataset.id,e.clientX,e.clientY); } });
function showMenu(id,x,y) { menuJobId=id; const menu=$('context-menu'); menu.hidden=false; menu.style.left=`${Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-10))}px`; menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-10))}px`; menu.querySelector('button').focus(); }
document.addEventListener('click',e => { if(!e.target.closest('#context-menu')) $('context-menu').hidden=true; });
document.addEventListener('keydown',e => { if(e.key==='Escape') { $('context-menu').hidden=true; $('floating-toolbar').hidden=true; } });
window.addEventListener('scroll',() => { $('context-menu').hidden=true; $('floating-toolbar').hidden=true; },true);
$('context-menu').onclick = e => {
  const action=e.target.closest('[data-row-action]')?.dataset.rowAction; if(!action) return;
  const job=state.jobs.find(j=>j.id===menuJobId); $('context-menu').hidden=true; if(!job) return;
  if(action==='add') addJob();
  if(action==='duplicate') addJob(job);
  if(action==='delete') { state.jobs=state.jobs.filter(j=>j.id!==job.id); renderJobs(); save(); toast('记录已删除',()=>{ state.jobs.push(job); renderJobs(); save(); }); }
};

function applyWidths() {
  $('job-cols').innerHTML=state.widths.map(w=>`<col style="width:${w}px">`).join('');
  $('jobs-table').style.width=`${state.widths.reduce((a,b)=>a+b,0)}px`;
  $('jobs-table').style.minWidth='100%';
}
document.querySelectorAll('#jobs-table th').forEach((th,index) => {
  if(index===7) return;
  const handle=document.createElement('span'); handle.className='resize-handle'; handle.title='拖动调整列宽，双击适应内容'; handle.setAttribute('aria-hidden','true'); th.append(handle);
  handle.addEventListener('pointerdown',e=>{
    e.preventDefault(); const start=e.clientX, widths=Array.from(document.querySelectorAll('#jobs-table th'),el=>el.getBoundingClientRect().width);
    state.widths=widths; applyWidths(); document.body.classList.add('resizing'); handle.setPointerCapture(e.pointerId);
    // Store a fixed initial width: state.widths is changed during pointer moves.
    const base=widths[index]; const stableMove=event=>{state.widths[index]=Math.max(index===0?58:65,Math.min(900,base+event.clientX-start)); applyWidths();};
    handle.addEventListener('pointermove',stableMove);
    const stableEnd=()=>{handle.removeEventListener('pointermove',stableMove); handle.removeEventListener('pointerup',stableEnd); handle.removeEventListener('pointercancel',stableEnd); document.body.classList.remove('resizing'); save();};
    handle.addEventListener('pointerup',stableEnd); handle.addEventListener('pointercancel',stableEnd);
  });
  handle.addEventListener('dblclick',()=>{
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'); ctx.font='12px "Microsoft YaHei"';
    const texts=[th.textContent,...Array.from($('job-rows').rows,row=>row.cells[index].innerText)];
    state.widths[index]=Math.max(65,Math.min(650,Math.max(...texts.map(t=>Math.max(...t.split('\n').map(line=>ctx.measureText(line).width))+34))));
    applyWidths(); save();
  });
});

function memoToggleHTML(id) {
  const open=expandedMemos.has(id),label=open?'收起这条笔记':'展开这条笔记';
  return `<button type="button" class="memo-toggle" data-toggle-memo="${id}" aria-expanded="${open}" aria-controls="memo-content-${id}" aria-label="${label}" title="${label}"><svg class="memo-expand-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg><svg class="memo-collapse-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h5V4m11 5h-5V4M9 20v-5H4m11 5v-5h5"/></svg></button>`;
}
function syncMemoToggle(entry) {
  const button=entry.querySelector('.memo-toggle');if(!button)return;
  const label=entry.open?'收起这条笔记':'展开这条笔记';
  button.setAttribute('aria-expanded',String(entry.open));button.setAttribute('aria-label',label);button.title=label;
}
function renderMemos() {
  const matched=visibleMemos(),pages=Math.max(1,Math.ceil(matched.length/memoPageSize));
  memoPage=Math.max(1,Math.min(memoPage,pages));
  const rows=matched.slice((memoPage-1)*memoPageSize,memoPage*memoPageSize);
  $('memo-list').innerHTML=rows.map(m=>`<details class="memo-card memo-entry" data-memo="${m.id}" ${expandedMemos.has(m.id)?'open':''}><summary><button class="memo-drag" type="button" data-drag-memo="${m.id}" title="拖动排序；Alt + 上下方向键也可移动" aria-label="拖动排序笔记"><svg viewBox="0 0 16 24" aria-hidden="true"><circle cx="5" cy="5" r="1.6"/><circle cx="11" cy="5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="11" cy="19" r="1.6"/></svg></button><span class="memo-tag"><span class="rich memo-title" contenteditable="true" role="textbox" aria-label="笔记标题" data-memo-title="${m.id}" data-placeholder="给这次思考起个标题…">${m.title}</span><small>${dateLong(m.createdAt)}</small></span>${memoToggleHTML(m.id)}</summary><div class="memo-content" id="memo-content-${m.id}"><div class="memo-lines">${m.lines.map(line=>memoLineHTML(m.id,line)).join('')}</div></div></details>`).join('') || `<div class="memo-empty"><span>“</span>${$('memo-search').value.trim()?'没有匹配的笔记标题':'从一个小小的想法开始记录。'}</div>`;
  $('memo-page-info').textContent=`${memoPage} / ${pages}`;
  $('memo-page-size').textContent=`每页 ${memoPageSize} 条 · 匹配 ${matched.length} 条`;
  $('memo-prev').disabled=memoPage===1;$('memo-next').disabled=memoPage===pages;
  updateStats();
}
function visibleMemos(){const query=$('memo-search').value.trim().toLowerCase();return state.memos.filter(m=>!query||textOf(m.title).toLowerCase().includes(query));}
function syncMemoOrder(){state.memoOrder=state.memos.map(m=>m.id);}
function revealMemo(id){const index=visibleMemos().findIndex(m=>m.id===id);if(index>=0)memoPage=Math.floor(index/memoPageSize)+1;renderMemos();}
function scheduleMemoLayout(){cancelAnimationFrame(memoLayoutFrame);memoLayoutFrame=requestAnimationFrame(fitMemoPage);}
function fitMemoPage(){
  if($('memos').hidden)return;
  const panel=$('memos'),list=$('memo-list'),tracker=$('tracking');
  const sideBySide=currentView==='home'&&innerWidth>850;
  const target=sideBySide?tracker.getBoundingClientRect().height:Math.max(480,Math.min(850,innerHeight-160));
  const height=panel.getBoundingClientRect().height;
  const fixed=height-list.getBoundingClientRect().height;
  const budget=Math.max(192,Math.floor(target-fixed));
  const size=Math.max(2,Math.floor((budget+8)/72));
  list.style.height=`${budget}px`;
  if(size!==memoPageSize){
    // Keep an active editor mounted while the person is typing.
    if(list.contains(document.activeElement))return;
    const anchor=(memoPage-1)*memoPageSize;memoPageSize=size;memoPage=Math.floor(anchor/size)+1;renderMemos();
  }
}
$('memo-search').oninput=()=>{memoPage=1;renderMemos();};
$('memo-prev').onclick=()=>{memoPage--;renderMemos();$('memo-list').scrollTop=0;};
$('memo-next').onclick=()=>{memoPage++;renderMemos();$('memo-list').scrollTop=0;};
$('memo-list').addEventListener('toggle',e=>{const entry=e.target.closest('.memo-entry');if(!entry)return;if(entry.open)expandedMemos.add(entry.dataset.memo);else expandedMemos.delete(entry.dataset.memo);syncMemoToggle(entry);},true);
$('memo-list').addEventListener('focusout',scheduleMemoLayout);
new ResizeObserver(scheduleMemoLayout).observe($('tracking'));
window.addEventListener('resize',scheduleMemoLayout);
function moveMemo(id,targetId,after=false){
  if(id===targetId)return;
  const source=state.memos.find(m=>m.id===id);if(!source||!state.memos.some(m=>m.id===targetId))return;
  state.memos=state.memos.filter(m=>m.id!==id);
  const index=state.memos.findIndex(m=>m.id===targetId)+(after?1:0);
  state.memos.splice(index,0,source);syncMemoOrder();revealMemo(id);save();
}
function stepMemo(id,step){const list=visibleMemos(),index=list.findIndex(m=>m.id===id),target=list[index+step];if(target)moveMemo(id,target.id,step>0);}
let memoDrag=null;
$('memo-list').addEventListener('pointerdown',e=>{
  const handle=e.target.closest('[data-drag-memo]');if(!handle||e.button!==0)return;
  e.preventDefault();handle.focus();handle.setPointerCapture(e.pointerId);
  memoDrag={id:handle.dataset.dragMemo,pointer:e.pointerId,startY:e.clientY,moved:false,target:null,after:false};
});
$('memo-list').addEventListener('pointermove',e=>{
  if(!memoDrag||memoDrag.pointer!==e.pointerId)return;
  if(Math.abs(e.clientY-memoDrag.startY)<4&&!memoDrag.moved)return;
  memoDrag.moved=true;
  document.body.classList.add('memo-dragging');
  document.querySelector(`[data-memo="${memoDrag.id}"]`)?.classList.add('memo-drag-source');
  document.querySelectorAll('.memo-drop').forEach(el=>el.classList.remove('memo-drop'));
  const bounds=$('memo-list').getBoundingClientRect();
  const candidates=[...$('memo-list').querySelectorAll('.memo-entry')].filter(el=>el.dataset.memo!==memoDrag.id);
  const target=e.clientX>=bounds.left&&e.clientX<=bounds.right&&e.clientY>=bounds.top&&e.clientY<=bounds.bottom
    ? candidates.reduce((best,el)=>{const r=el.getBoundingClientRect(),distance=Math.max(r.top-e.clientY,0,e.clientY-r.bottom);return !best||distance<best.distance?{el,distance}:best;},null)?.el:null;
  if(target&&target.dataset.memo!==memoDrag.id){memoDrag.target=target.dataset.memo;memoDrag.after=e.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;target.classList.add('memo-drop');target.dataset.dropAfter=String(memoDrag.after);}
  else memoDrag.target=null;
  const list=$('memo-list'),r=list.getBoundingClientRect();if(e.clientY>r.bottom-32)list.scrollTop+=12;else if(e.clientY<r.top+32)list.scrollTop-=12;
});
function finishMemoDrag(e,commit=false){
  if(!memoDrag||e.pointerId!==memoDrag.pointer)return;
  const drag=memoDrag;memoDrag=null;
  document.body.classList.remove('memo-dragging');
  document.querySelectorAll('.memo-drop,.memo-drag-source').forEach(el=>el.classList.remove('memo-drop','memo-drag-source'));
  if(commit&&drag.moved&&drag.target)moveMemo(drag.id,drag.target,drag.after);
}
$('memo-list').addEventListener('pointerup',e=>finishMemoDrag(e,true));
$('memo-list').addEventListener('pointercancel',e=>finishMemoDrag(e));
$('memo-list').addEventListener('lostpointercapture',e=>finishMemoDrag(e));
$('memo-list').addEventListener('keydown',e=>{const handle=e.target.closest('[data-drag-memo]');if(handle&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();stepMemo(handle.dataset.dragMemo,e.key==='ArrowUp'?-1:1);document.querySelector(`[data-drag-memo="${handle.dataset.dragMemo}"]`)?.focus();}});
function memoLineHTML(memoId,line) { return `<div class="memo-line" style="--depth:${line.depth}"><div class="rich" contenteditable="true" role="textbox" aria-label="笔记内容" data-memo-id="${memoId}" data-line="${line.id}" data-placeholder="记下一个想法…">${line.html}</div></div>`; }
function addMemo() { if(!ready) return; const m={id:uid(),createdAt:Date.now(),title:'',lines:[{id:uid(),depth:0,html:''}]}; state.memos.unshift(m);syncMemoOrder();$('memo-search').value='';memoPage=1;expandedMemos.add(m.id); renderMemos(); save(); document.querySelector(`[data-memo-title="${m.id}"]`).focus(); }
['add-memo','add-bottom-memo'].forEach(id=>$(id).onclick=addMemo);
$('memo-list').addEventListener('click',e=>{
  if(e.target.closest('[data-memo-title]')){e.preventDefault();return;}
  const toggle=e.target.closest('[data-toggle-memo]');
  if(toggle){
    e.preventDefault();e.stopPropagation();const entry=toggle.closest('.memo-entry');entry.open=!entry.open;
    if(entry.open)expandedMemos.add(entry.dataset.memo);else expandedMemos.delete(entry.dataset.memo);
    syncMemoToggle(entry);return;
  }

  if(e.target.closest('[data-drag-memo]')){e.preventDefault();return;}

});
let menuMemoId=null;
const memoMenu=document.createElement('div');
memoMenu.id='memo-context-menu';memoMenu.className='context-menu';memoMenu.setAttribute('role','menu');memoMenu.hidden=true;
memoMenu.innerHTML='<button type="button" data-memo-action="copy" role="menuitem">▣ 复制</button><button type="button" data-memo-action="delete" class="danger" role="menuitem">⌫ 删除</button>';
document.body.append(memoMenu);
$('memo-list').addEventListener('contextmenu',e=>{
  const entry=e.target.closest('.memo-entry');if(!entry||entry.open)return;
  e.preventDefault();menuMemoId=entry.dataset.memo;$('context-menu').hidden=true;memoMenu.hidden=false;
  const rect=entry.getBoundingClientRect(),x=e.clientX||rect.left,y=e.clientY||rect.top;
  memoMenu.style.left=`${Math.max(8,Math.min(x,innerWidth-memoMenu.offsetWidth-10))}px`;
  memoMenu.style.top=`${Math.max(8,Math.min(y,innerHeight-memoMenu.offsetHeight-10))}px`;
  memoMenu.querySelector('button').focus();
});
document.addEventListener('click',e=>{if(!e.target.closest('#memo-context-menu'))memoMenu.hidden=true;});
document.addEventListener('contextmenu',e=>{if(!e.target.closest('.memo-entry:not([open])'))memoMenu.hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){memoMenu.hidden=true;document.querySelector(`[data-drag-memo="${menuMemoId}"]`)?.focus();}});
window.addEventListener('scroll',()=>{memoMenu.hidden=true;},true);
memoMenu.onclick=e=>{
  const action=e.target.closest('[data-memo-action]')?.dataset.memoAction;
  const index=state.memos.findIndex(m=>m.id===menuMemoId),memo=state.memos[index];
  if(!action||!memo)return;memoMenu.hidden=true;
  if(action==='copy'){
    const copy={...structuredClone(memo),id:uid(),createdAt:Date.now(),lines:memo.lines.map(line=>({...line,id:uid()}))};
    state.memos.splice(index+1,0,copy);syncMemoOrder();revealMemo(copy.id);save();toast('已复制一条笔记');
  }else if(action==='delete'){
    state.memos.splice(index,1);expandedMemos.delete(memo.id);syncMemoOrder();renderMemos();save();
    toast('笔记已删除',()=>{state.memos.splice(Math.min(index,state.memos.length),0,memo);syncMemoOrder();revealMemo(memo.id);save();});
  }
};
function caretAt(el,end=true) { el.focus(); const range=document.createRange();range.selectNodeContents(el);range.collapse(!end);const s=getSelection();s.removeAllRanges();s.addRange(range); }
function indentMemo(editor,delta) {
  const memo=state.memos.find(m=>m.id===editor.dataset.memoId), index=memo.lines.findIndex(l=>l.id===editor.dataset.line), line=memo.lines[index];
  const maxDepth=index>0?Math.min(5,memo.lines[index-1].depth+1):0;
  line.depth=Math.max(0,Math.min(maxDepth,line.depth+delta)); editor.parentElement.style.setProperty('--depth',line.depth); save();
}
function handleMemoKey(e,editor) {
  const memo=state.memos.find(m=>m.id===editor.dataset.memoId), index=memo.lines.findIndex(l=>l.id===editor.dataset.line), line=memo.lines[index];
  if(e.key==='Tab') { e.preventDefault(); indentMemo(editor,e.shiftKey?-1:1); return; }
  if(e.key==='Enter') {
    e.preventDefault(); const selection=getSelection(); if(!selection.rangeCount)return; const range=selection.getRangeAt(0); range.deleteContents();
    const tail=document.createRange();tail.selectNodeContents(editor);tail.setStart(range.startContainer,range.startOffset); const fragment=tail.extractContents();const holder=document.createElement('div');holder.append(fragment);
    line.html=cleanHTML(editor.innerHTML,false); if(!textOf(line.html).trim()) { line.html='';editor.innerHTML=''; }
    const next={id:uid(),depth:line.depth,html:cleanHTML(holder.innerHTML,false)};memo.lines.splice(index+1,0,next);
    editor.parentElement.insertAdjacentHTML('afterend',memoLineHTML(memo.id,next));caretAt(document.querySelector(`[data-line="${next.id}"]`),false);save();
  }
  if(e.key==='Backspace' && getSelection().isCollapsed) {
    const range=getSelection().getRangeAt(0),before=range.cloneRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);
    if(before.toString()==='' && line.depth>0) {e.preventDefault();indentMemo(editor,-1);}
    else if(before.toString()==='' && index>0) {
      e.preventDefault();const prev=memo.lines[index-1],prevEl=document.querySelector(`[data-line="${prev.id}"]`);caretAt(prevEl); const marker=getSelection().getRangeAt(0).cloneRange();
      prevEl.insertAdjacentHTML('beforeend',cleanHTML(editor.innerHTML,false));prev.html=cleanHTML(prevEl.innerHTML,false);memo.lines.splice(index,1);editor.parentElement.remove();getSelection().removeAllRanges();getSelection().addRange(marker);save();
    }
  }
}

// Shared rich text tools: table/MEMO selection toolbar and the fill-in help bubble.
const formatButtons=Array.from($('format-toolbar').children).filter(el=>el.matches('button,.divider')).map(el=>el.outerHTML).join('');
$('jd-toolbar').innerHTML=formatButtons; $('floating-toolbar').innerHTML=formatButtons; $('memo-toolbar').innerHTML=formatButtons;
document.addEventListener('selectionchange',()=>{
  const selection=getSelection(); if(!selection.rangeCount)return;
  const anchor=selection.anchorNode?.nodeType===1?selection.anchorNode:selection.anchorNode?.parentElement;
  const editor=anchor?.closest('.rich');
  if(editor && editor.contains(selection.focusNode)) { activeEditor=editor;selectionRange=selection.getRangeAt(0).cloneRange(); }
  requestAnimationFrame(updateFloatingToolbar);
});
function updateFloatingToolbar() {
  const sel=getSelection(); const toolbar=$('floating-toolbar');
  if(!sel.isCollapsed && activeEditor?.isConnected && activeEditor.getClientRects().length && activeEditor.closest('#memo-list,#job-rows') && selectionRange && activeEditor.contains(sel.anchorNode) && activeEditor.contains(sel.focusNode) && !$('filling-help').matches(':popover-open')) {
    const rect=selectionRange.getBoundingClientRect();toolbar.hidden=false;
    const headerBottom=document.querySelector('.topbar').getBoundingClientRect().bottom;
    const top=rect.top-toolbar.offsetHeight-8>=headerBottom ? rect.top-toolbar.offsetHeight-8 : rect.bottom+8;
    toolbar.style.left=`${Math.max(8,Math.min(document.documentElement.clientWidth-toolbar.offsetWidth-8,rect.left))}px`;
    toolbar.style.top=`${Math.max(8,Math.min(innerHeight-toolbar.offsetHeight-8,top))}px`;
  } else if(!document.activeElement?.closest('.floating-toolbar')) toolbar.hidden=true;
}
document.addEventListener('mouseup',updateFloatingToolbar);
const fillingHelp=$('filling-help'),helpButton=$('filling-help-button');
function positionFillingHelp() {
  fillingHelp.style.maxWidth=`${document.documentElement.clientWidth-24}px`;
  const rect=helpButton.getBoundingClientRect(), width=fillingHelp.offsetWidth, height=fillingHelp.offsetHeight;
  const below=rect.bottom+10, top=below+height<=innerHeight-12 ? below : Math.max(12,rect.top-height-10);
  fillingHelp.style.left=`${Math.max(12,Math.min(document.documentElement.clientWidth-width-12,rect.right-width))}px`;
  fillingHelp.style.top=`${top}px`;
}
fillingHelp.addEventListener('toggle',e=>{
  const open=e.newState==='open';helpButton.setAttribute('aria-expanded',String(open));
  if(open){$('floating-toolbar').hidden=true;positionFillingHelp();}
});
window.addEventListener('resize',()=>{if(fillingHelp.matches(':popover-open'))positionFillingHelp();});
document.addEventListener('pointerdown',e=>{if(e.target.closest('.editor-toolbar button'))e.preventDefault();});
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-command],[data-color]');if(!button)return;
  if(!activeEditor?.isConnected || !selectionRange) {toast('先选中需要设置格式的文字');return;}
  activeEditor.focus();const selection=getSelection();selection.removeAllRanges();selection.addRange(selectionRange);
  document.execCommand('styleWithCSS',false,true);
  document.execCommand(button.dataset.command || 'foreColor',false,button.dataset.color || null);
  persistEditor(activeEditor);selectionRange=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
});
document.addEventListener('focusin',e=>{if(e.target.matches('.rich'))activeEditor=e.target;});
function persistEditor(editor) {
  const html=cleanHTML(editor.innerHTML, !editor.dataset.line && !editor.dataset.memoTitle && editor.dataset.field!=='role');
  if(editor.dataset.job) {
    const job=state.jobs.find(j=>j.id===editor.dataset.job);if(!job)return;job[editor.dataset.field]=html;
    if(editor.dataset.field==='company' && !job.date && textOf(html).trim()) {
      job.date=Date.now(); const row=editor.closest('tr'),cell=row.querySelector('.date-cell');cell.textContent=dateShort(job.date);cell.title=dateLong(job.date);
      const index=visibleJobs().findIndex(j=>j.id===job.id);
      if(index!==(jobPage-1)*(state.jobPageSize||10)+Array.from(row.parentElement.children).indexOf(row))revealJob(job.id,'company');
    }
  } else if(editor.dataset.memoTitle) {const m=state.memos.find(m=>m.id===editor.dataset.memoTitle);if(m){m.title=html;}}
  else if(editor.dataset.line) {const m=state.memos.find(m=>m.id===editor.dataset.memoId);const line=m?.lines.find(l=>l.id===editor.dataset.line);if(line)line.html=html;}
  else if(editor.id==='jd-editor') {const job=state.jobs.find(j=>j.id===currentJobId);if(job)job.jd=html;}
  save();
}
document.addEventListener('input',e=>{if(e.target.matches('.rich')&&!e.isComposing)persistEditor(e.target);});
document.addEventListener('compositionend',e=>{if(e.target.matches('.rich'))persistEditor(e.target);});
document.addEventListener('focusout',e=>{
  const editor=e.target;if(!editor.matches('.rich'))return;
  // Normalize empty contenteditable markers without interrupting IME input.
  if(!editor.textContent.trim() && !editor.querySelector('img')) {editor.innerHTML='';persistEditor(editor);}
});
document.addEventListener('keydown',e=>{
  const editor=e.target.closest('.rich');if(!editor||e.isComposing)return;
  if(editor.dataset.line){handleMemoKey(e,editor);return;}
  if(e.key==='Enter' && (editor.dataset.memoTitle || editor.dataset.field==='role')) {e.preventDefault();if(editor.dataset.memoTitle){const entry=editor.closest('.memo-entry');entry.open=true;expandedMemos.add(entry.dataset.memo);syncMemoToggle(entry);caretAt(entry.querySelector('.memo-lines .rich'),false);}else editor.blur();}
});
document.addEventListener('paste',async e=>{
  const editor=e.target.closest('.rich');if(!editor)return;e.preventDefault();
  const files=Array.from(e.clipboardData.files);
  if(editor.id==='jd-editor' && files.length){await addJDImages(files,currentJobId);return;}
  const plain=e.clipboardData.getData('text/plain'),html=e.clipboardData.getData('text/html');
  if(editor.dataset.line && /\r?\n/.test(plain)) {
    const parts=plain.replace(/\r/g,'').split('\n');const memo=state.memos.find(m=>m.id===editor.dataset.memoId);const index=memo.lines.findIndex(l=>l.id===editor.dataset.line);
    const selection=getSelection();if(!selection.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const tail=document.createRange();tail.selectNodeContents(editor);tail.setStart(range.startContainer,range.startOffset);const fragment=tail.extractContents();const holder=document.createElement('div');holder.append(fragment);
    document.execCommand('insertText',false,parts.shift());memo.lines[index].html=cleanHTML(editor.innerHTML,false);
    const lines=parts.map(part=>({id:uid(),depth:memo.lines[index].depth,html:escapeHTML(part)}));lines[lines.length-1].html+=cleanHTML(holder.innerHTML,false);memo.lines.splice(index+1,0,...lines);
    editor.parentElement.insertAdjacentHTML('afterend',lines.map(l=>memoLineHTML(memo.id,l)).join(''));caretAt(document.querySelector(`[data-line="${lines[lines.length-1].id}"]`));save();return;
  }
  const multiline=editor.id==='jd-editor'||['company','status','notes'].includes(editor.dataset.field);
  const content=html?cleanHTML(html,multiline):escapeHTML(plain).replace(/\r?\n/g,multiline?'<br>':' ');
  document.execCommand('insertHTML',false,content);persistEditor(editor);
});
document.addEventListener('dragover',e=>{if(e.target.closest('.rich'))e.preventDefault();});
document.addEventListener('drop',e=>{
  const editor=e.target.closest('.rich');if(!editor)return;e.preventDefault();
  if(editor.id==='jd-editor'&&e.dataTransfer.files.length){addJDImages(Array.from(e.dataTransfer.files),currentJobId);return;}
  editor.focus();document.execCommand('insertText',false,e.dataTransfer.getData('text/plain'));persistEditor(editor);
});

function openJD(id) {
  const job=state.jobs.find(j=>j.id===id);if(!job){toast('这条记录已不存在');return;}
  currentJobId=id;$('jd-title').textContent=textOf(job.role)||'JD 详情';$('jd-subtitle').textContent=`${textOf(job.company)||'待填写企业'}${job.date?' · '+dateLong(job.date):''}`;
  $('jd-editor').innerHTML=job.jd;renderJDImages();if(!$('jd-dialog').open)$('jd-dialog').showModal();
}
function setView(view) {
  currentView=view; document.body.dataset.view=view;
  $('resumes').hidden=view!=='resumes';
  $('tracking').hidden=!['home','tracking'].includes(view);
  $('memos').hidden=!['home','memos'].includes(view);
  document.querySelector('.stats').hidden=!['home','tracking'].includes(view);
  document.querySelector('.main-column').hidden=view==='memos';
  document.querySelector('.little-note').hidden=view!=='home';
  document.querySelectorAll('.topbar nav a').forEach(a=>{
    const active=a.hash===`#${view}`;a.classList.toggle('active',active);
    if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  $('context-menu').hidden=true;$('floating-toolbar').hidden=true;
  if(fillingHelp.matches(':popover-open'))fillingHelp.hidePopover();
  scheduleMemoLayout();
}
function route() {
  const match=location.hash.match(/^#jd\/([\w-]+)$/);
  if(match){if(!$('jd-dialog').open)jdReturnView=currentView;openJD(match[1]);return;}
  if($('jd-dialog').open)$('jd-dialog').close();
  const view=location.hash.slice(1);setView(['resumes','tracking','memos'].includes(view)?view:'home');
  window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',()=>{if(ready)route();});
window.addEventListener('popstate',()=>{if(ready)route();});
$('jd-dialog').addEventListener('close',()=>{
  if(location.hash.startsWith('#jd/')){history.replaceState(null,'',location.pathname+location.search+`#${jdReturnView}`);setView(jdReturnView);}
  currentJobId=null;
});
function readFile(file) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
async function validatedPDF(file) {
  if(file.size>20*1024*1024)throw new Error('单份 PDF 请控制在 20 MB 以内');
  const header=await file.slice(0,5).text();if(header!=='%PDF-')throw new Error('请选择有效的 PDF 简历');
  const data=await readFile(file);return 'data:application/pdf;base64,'+data.split(',')[1];
}
async function addJDImages(files,id) {
  const job=state.jobs.find(j=>j.id===id);if(!job)return;
  for(const file of files) {
    try {if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>10*1024*1024)throw new Error('请选择 10 MB 以内的 PNG、JPG、WebP 或 GIF 图片');
      const src=await readFile(file);const img=new Image();img.src=src;await img.decode();job.images.push({id:uid(),name:file.name||'粘贴的图片',src});
    }catch(err){toast(err.message||'图片读取失败');}
  }
  if(currentJobId===id)renderJDImages();save();
}
function renderJDImages() {const job=state.jobs.find(j=>j.id===currentJobId);$('jd-images').innerHTML=(job?.images||[]).map(img=>`<div class="jd-image"><img src="${img.src}" alt="${escapeHTML(img.name)}"><button data-remove-image="${img.id}">移除图片</button></div>`).join('');}
$('add-jd-image').onclick=()=>$('jd-image-input').click();
$('jd-image-input').onchange=async e=>{await addJDImages(Array.from(e.target.files),currentJobId);e.target.value='';};
$('jd-images').onclick=e=>{const b=e.target.closest('[data-remove-image]');if(!b)return;const job=state.jobs.find(j=>j.id===currentJobId),index=job.images.findIndex(i=>i.id===b.dataset.removeImage),img=job.images[index];job.images.splice(index,1);renderJDImages();save();toast('图片已移除',()=>{job.images.splice(index,0,img);if(currentJobId===job.id)renderJDImages();save();});};

const resumeURLs=new Map();
function dataBlob(data) {const [head,body]=data.split(',');const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));return new Blob([bytes],{type:head.slice(5).split(';')[0]});}
function renderResumes() {
  resumeURLs.forEach(url=>URL.revokeObjectURL(url));resumeURLs.clear();
  $('resume-list').innerHTML=state.resumes.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(r=>{
    const url=URL.createObjectURL(dataBlob(r.data));resumeURLs.set(r.id,url);
    return `<article class="resume-card"><span class="pdf-icon">PDF</span><div class="resume-info"><a class="resume-title" href="${url}" target="_blank" rel="noopener" title="预览 ${escapeHTML(r.name)}">${escapeHTML(r.name)}</a><small>${dateLong(r.updatedAt)} 更新 · ${sizeLabel(r.size)}</small></div><a class="download-link" href="${url}" download="${escapeHTML(r.name.replace(/\.pdf$/i,''))}.pdf" aria-label="下载 ${escapeHTML(r.name)}" title="下载简历">↓</a><button class="icon-button" data-edit-resume="${r.id}" aria-label="编辑 ${escapeHTML(r.name)}" title="修改名称、替换或删除">⋯</button></article>`;
  }).join('') || '<div class="resume-empty"><span class="pdf-icon">PDF</span><div><h3>为下一次机会，准备好你的简历</h3><p>上传 PDF，按求职方向整理每一个版本。</p></div><button class="soft-button" id="upload-empty-resume">＋ 选择 PDF</button></div>';
  if($('upload-empty-resume'))$('upload-empty-resume').onclick=()=>$('resume-input').click();updateStats();
}
$('upload-resume').onclick=()=>$('resume-input').click();
$('resume-input').onchange=async e=>{
  const files=Array.from(e.target.files);$('upload-resume').disabled=true;let count=0;
  for(const file of files) {try {const data=await validatedPDF(file);state.resumes.push({id:uid(),name:file.name.replace(/\.pdf$/i,''),updatedAt:Date.now(),size:file.size,data});count++;}catch(err){toast(`${file.name}：${err.message}`);}}
  renderResumes();await save();if(count&&!saveFailed)toast(`已保存 ${count} 份简历`);$('upload-resume').disabled=false;e.target.value='';
};
$('resume-list').onclick=e=>{const b=e.target.closest('[data-edit-resume]');if(!b)return;const r=state.resumes.find(r=>r.id===b.dataset.editResume);currentResumeId=r.id;$('resume-name').value=r.name;$('resume-file-info').textContent=`最近更新 ${dateLong(r.updatedAt)} · ${sizeLabel(r.size)}`;$('replace-resume-input').value='';$('resume-dialog').showModal();};
$('resume-form').onsubmit=async e=>{
  e.preventDefault();const name=$('resume-name').value.trim();if(!name){$('resume-name').focus();return;}
  const r=state.resumes.find(r=>r.id===currentResumeId),file=$('replace-resume-input').files[0],submit=e.submitter;submit.disabled=true;
  try {let data;if(file)data=await validatedPDF(file);r.name=name;if(data){r.data=data;r.size=file.size;}r.updatedAt=Date.now();renderResumes();await save();$('resume-dialog').close();if(!saveFailed)toast('简历已更新');}catch(err){toast(err.message);}finally{submit.disabled=false;}
};
$('delete-resume').onclick=async()=>{
  const r=state.resumes.find(r=>r.id===currentResumeId);if(!await confirmAction(`删除「${r.name}」？`, '删除'))return;
  state.resumes=state.resumes.filter(item=>item.id!==r.id);renderResumes();save();$('resume-dialog').close();toast('简历已删除',()=>{state.resumes.push(r);renderResumes();save();});
};

function validateState(input) {
  if(!input || ![1,2].includes(input.version) || !['jobs','memos','resumes'].every(k=>Array.isArray(input[k])))throw new Error('这不是有效的「不言求职记」备份');
  const check=(ok)=>{if(!ok)throw new Error('备份内容损坏或格式不完整，当前数据未被修改');};
  const timestamp=t=>Number.isFinite(t)&&t>0&&t<8640000000000000;
  const seen=new Set();const id=v=>{check(typeof v==='string'&&/^[\w-]{1,100}$/.test(v)&&!seen.has(v));seen.add(v);return v;};
  const rich=(v,multi=true)=>{check(typeof v==='string');return cleanHTML(v,multi);};
  const result={version:2,jobs:[],memos:[],resumes:[],widths:[...initialWidths],profile:{...defaultProfile},jobPageSize:10,memoOrder:[]};
  if(input.jobPageSize!==undefined){check(Number.isInteger(input.jobPageSize)&&input.jobPageSize>=1&&input.jobPageSize<=1000);result.jobPageSize=input.jobPageSize;}
  if(input.profile!==undefined){
    const profile=input.profile;
    check(profile && typeof profile.name==='string' && profile.name.trim().length>0 && profile.name.length<=30);
    check(typeof profile.headline==='string' && profile.headline.trim().length>0 && profile.headline.length<=80);
    check(typeof profile.tagline==='string' && profile.tagline.length<=240);
    check(typeof profile.avatar==='string' && (profile.avatar==='' || (profile.avatar.length<=3*1024*1024 && imagePattern.test(profile.avatar))));
    if(profile.avatar)check(atob(profile.avatar.split(',')[1]).length>0);
    result.profile={name:profile.name.trim(),headline:profile.headline.trim(),tagline:profile.tagline.trim(),avatar:profile.avatar};
  }
  result.jobs=input.jobs.map(j=>{
    check(j&&timestamp(j.createdAt)&&(j.date===null||timestamp(j.date))&&Array.isArray(j.images));
    check(input.version===1 ? typeof j.applied==='boolean' : applicationStates.includes(j.application));
    const application=input.version===1 ? (j.applied?'sent':'pending') : j.application;
    return {id:id(j.id),createdAt:j.createdAt,date:j.date,company:rich(j.company),role:rich(j.role,false),status:rich(j.status),notes:rich(j.notes),jd:rich(j.jd),application,images:j.images.map(img=>{check(img&&typeof img.src==='string'&&imagePattern.test(img.src)&&typeof img.name==='string');return {id:id(img.id),name:img.name,src:img.src};})};
  });
  result.memos=input.memos.map(m=>{check(m&&timestamp(m.createdAt)&&Array.isArray(m.lines)&&m.lines.length>0);return {id:id(m.id),createdAt:m.createdAt,title:rich(m.title,false),demo:!!m.demo,lines:m.lines.map(l=>{check(l&&Number.isInteger(l.depth)&&l.depth>=0&&l.depth<=5);return {id:id(l.id),depth:l.depth,html:rich(l.html,false)};})};});
  if(input.memoOrder!==undefined){check(Array.isArray(input.memoOrder)&&input.memoOrder.every(v=>typeof v==='string'));const rank=new Map(input.memoOrder.map((id,i)=>[id,i]));result.memos.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity)||b.createdAt-a.createdAt);}
  else result.memos.sort((a,b)=>b.createdAt-a.createdAt);
  result.memoOrder=result.memos.map(m=>m.id);
  result.resumes=input.resumes.map(r=>{check(r&&typeof r.name==='string'&&r.name.trim()&&timestamp(r.updatedAt)&&typeof r.data==='string'&&pdfPattern.test(r.data)&&Number.isFinite(r.size)&&r.size>=0);check(atob(r.data.split(',')[1].slice(0,12)).startsWith('%PDF-'));return {id:id(r.id),name:r.name,updatedAt:r.updatedAt,size:r.size,data:r.data};});
  if(Array.isArray(input.widths)&&input.widths.length===8&&input.widths.every(w=>Number.isFinite(w)&&w>=30&&w<=1200))result.widths=input.widths;
  return result;
}
function downloadBlob(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function exportData() {downloadBlob(new Blob([JSON.stringify({app:'buyan-career-workspace',exportedAt:new Date().toISOString(),state})],{type:'application/json'}),`不言求职记-备份-${dateLong(Date.now())}.json`);toast('完整备份已导出');}
$('backup-menu-button').onclick=()=>$('backup-dialog').showModal();$('export-data').onclick=exportData;$('export-footer').onclick=exportData;
$('import-data').onclick=()=>$('import-input').click();
$('import-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try {if(file.size>250*1024*1024)throw new Error('备份文件过大，请选择 250 MB 以内的文件');const raw=JSON.parse(await file.text());if(raw.app!=='buyan-career-workspace')throw new Error('请选择本工作台导出的备份');const next=validateState(raw.state);
    if(!await confirmAction(`备份包含 ${next.resumes.length} 份简历、${next.jobs.length} 条投递记录、${next.memos.length} 条笔记。恢复将替换当前全部内容，建议先导出当前备份。`, '恢复备份'))return;
    await saveChain; await writeState(next);state=next;saveFailed=false;autosaveBlocked=false;setStatus('已保存到本地');resetFilters();memoPage=1;expandedMemos.clear();$('memo-search').value='';renderAll();$('backup-dialog').close();toast('备份已恢复');
  }catch(err){toast(err instanceof SyntaxError?'备份文件不是有效的 JSON':err.message);}
};

// Profile edits stay in a draft until saved; avatar crops use the same source
// coordinate system for the preview and the final 512px image.
let profileDraft=null, profileSession=0, avatarRequest=0, profileSaving=false;
let cropImage=null, cropZoom=1, cropX=0, cropY=0, cropDrag=null;
const cropSize=512;
function nameInitial(name) {
  const value=name.trim() || defaultProfile.name;
  if(Intl.Segmenter){const parts=Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(value));return parts[parts.length-1].segment;}
  return Array.from(value).pop();
}
function showAvatar(container,profile) {
  container.replaceChildren();
  if(profile.avatar){const img=document.createElement('img');img.src=profile.avatar;img.alt=`${profile.name}的头像`;container.append(img);}
  else container.textContent=nameInitial(profile.name);
}
function renderProfile() {
  const profile=state.profile || defaultProfile;
  showAvatar($('profile-button'),profile);
  $('profile-button').title=`${profile.name} · 用户信息`;
  $('profile-button').setAttribute('aria-label',`${profile.name}的用户信息`);
  $('welcome-headline').textContent=profile.headline;
  $('welcome-tagline').textContent=profile.tagline;
  $('welcome-tagline').hidden=!profile.tagline;
}
function updateProfilePreview() {
  if(!profileDraft)return;
  profileDraft.name=$('profile-name').value;
  profileDraft.headline=$('profile-headline').value;
  profileDraft.tagline=$('profile-tagline').value;
  showAvatar($('profile-avatar-preview'),profileDraft);
  $('choose-avatar').textContent=profileDraft.avatar?'更换头像':'上传头像';
  $('remove-avatar').hidden=!profileDraft.avatar;
  $('headline-preview').textContent=profileDraft.headline || '你的大 slogan';
  $('tagline-preview').textContent=profileDraft.tagline;
  $('headline-count').textContent=`${profileDraft.headline.length} / 80`;
  $('tagline-count').textContent=`${profileDraft.tagline.length} / 240`;
}
$('profile-button').onclick=()=>{
  if(!ready)return;
  profileSession++;profileDraft={...(state.profile || defaultProfile)};
  $('profile-name').value=profileDraft.name;$('profile-headline').value=profileDraft.headline;$('profile-tagline').value=profileDraft.tagline;
  $('profile-name').setCustomValidity('');$('profile-headline').setCustomValidity('');$('profile-feedback').textContent='';
  $('profile-feedback').classList.remove('error');$('avatar-input').value='';updateProfilePreview();$('profile-dialog').showModal();
};
['profile-name','profile-headline','profile-tagline'].forEach(id=>$(id).addEventListener('input',()=>{
  $(id).setCustomValidity('');$('profile-feedback').textContent='';updateProfilePreview();
}));
$('profile-dialog').addEventListener('cancel',e=>{if(profileSaving)e.preventDefault();});
$('profile-dialog').addEventListener('close',()=>{
  profileSession++;avatarRequest++;profileDraft=null;
  if($('avatar-crop-dialog').open)$('avatar-crop-dialog').close();
  $('choose-avatar').disabled=false;
});
$('profile-form').onsubmit=async e=>{
  e.preventDefault();if(!profileDraft || profileSaving)return;
  for(const [id,message] of [['profile-name','请填写姓名'],['profile-headline','请填写大 slogan']]){
    if(!$(id).value.trim()){$(id).setCustomValidity(message);$(id).reportValidity();return;}
  }
  profileSaving=true;
  const buttons=Array.from($('profile-dialog').querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);
  $('profile-feedback').classList.remove('error');$('profile-feedback').textContent='正在保存…';
  state.profile={name:$('profile-name').value.trim(),headline:$('profile-headline').value.trim(),tagline:$('profile-tagline').value.trim(),avatar:profileDraft.avatar};
  renderProfile();await save();
  profileSaving=false;buttons.forEach(b=>b.disabled=false);
  if(saveFailed){$('profile-feedback').classList.add('error');$('profile-feedback').textContent='页面已更新，但本地保存失败。请重试保存，或导出备份。';return;}
  $('profile-dialog').close();toast('用户信息已保存');
};
$('choose-avatar').onclick=()=>$('avatar-input').click();
$('remove-avatar').onclick=()=>{profileDraft.avatar='';updateProfilePreview();$('profile-feedback').textContent='已恢复文字头像，保存后生效。';};
$('avatar-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file || !profileDraft)return;
  const session=profileSession,request=++avatarRequest;
  $('profile-feedback').classList.remove('error');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){
    $('profile-feedback').textContent='请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。';$('profile-feedback').classList.add('error');return;
  }
  const url=URL.createObjectURL(file);$('choose-avatar').disabled=true;$('profile-feedback').textContent='正在读取图片…';
  try{
    const img=new Image();img.src=url;await img.decode();
    if(session!==profileSession || request!==avatarRequest || !$('profile-dialog').open)return;
    cropImage=img;cropZoom=1;cropX=0;cropY=0;cropDrag=null;drawAvatarCrop();
    $('profile-feedback').textContent='';$('avatar-crop-dialog').showModal();
  }catch{
    if(session===profileSession && request===avatarRequest){$('profile-feedback').textContent='无法读取这张图片，请换一张后重试。';$('profile-feedback').classList.add('error');}
  }finally{URL.revokeObjectURL(url);if(session===profileSession && request===avatarRequest)$('choose-avatar').disabled=false;}
};
function cropBounds() {
  const scale=Math.max(cropSize/cropImage.naturalWidth,cropSize/cropImage.naturalHeight)*cropZoom;
  return {width:cropImage.naturalWidth*scale,height:cropImage.naturalHeight*scale,maxX:(cropImage.naturalWidth*scale-cropSize)/2,maxY:(cropImage.naturalHeight*scale-cropSize)/2};
}
function drawAvatarCrop() {
  if(!cropImage)return;
  const bounds=cropBounds();cropX=Math.max(-bounds.maxX,Math.min(bounds.maxX,cropX));cropY=Math.max(-bounds.maxY,Math.min(bounds.maxY,cropY));
  const ctx=$('avatar-canvas').getContext('2d');ctx.clearRect(0,0,cropSize,cropSize);
  ctx.fillStyle='#EDEAE4';ctx.fillRect(0,0,cropSize,cropSize);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(cropImage,(cropSize-bounds.width)/2+cropX,(cropSize-bounds.height)/2+cropY,bounds.width,bounds.height);
  $('avatar-zoom').value=cropZoom;$('avatar-zoom-value').textContent=`${Math.round(cropZoom*100)}%`;
  $('avatar-x').value=bounds.maxX?Math.round(cropX/bounds.maxX*100):0;
  $('avatar-y').value=bounds.maxY?Math.round(cropY/bounds.maxY*100):0;
  $('avatar-x').disabled=bounds.maxX<.01;$('avatar-y').disabled=bounds.maxY<.01;
}
$('avatar-zoom').oninput=e=>{cropZoom=Number(e.target.value);drawAvatarCrop();};
$('avatar-x').oninput=e=>{cropX=Number(e.target.value)/100*cropBounds().maxX;drawAvatarCrop();};
$('avatar-y').oninput=e=>{cropY=Number(e.target.value)/100*cropBounds().maxY;drawAvatarCrop();};
$('reset-avatar-crop').onclick=()=>{cropZoom=1;cropX=0;cropY=0;drawAvatarCrop();};
const avatarCanvas=$('avatar-canvas');
avatarCanvas.addEventListener('pointerdown',e=>{
  if(!cropImage || !e.isPrimary || e.button!==0)return;e.preventDefault();avatarCanvas.focus();
  cropDrag={pointer:e.pointerId,x:e.clientX,y:e.clientY,offsetX:cropX,offsetY:cropY};avatarCanvas.setPointerCapture(e.pointerId);
});
avatarCanvas.addEventListener('pointermove',e=>{
  if(!cropDrag || cropDrag.pointer!==e.pointerId)return;
  const factor=cropSize/avatarCanvas.getBoundingClientRect().width;
  cropX=cropDrag.offsetX+(e.clientX-cropDrag.x)*factor;cropY=cropDrag.offsetY+(e.clientY-cropDrag.y)*factor;drawAvatarCrop();
});
['pointerup','pointercancel','lostpointercapture'].forEach(type=>avatarCanvas.addEventListener(type,()=>{cropDrag=null;}));
avatarCanvas.addEventListener('keydown',e=>{
  if(!cropImage || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
  const step=e.shiftKey?25:5;cropX+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;cropY+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;drawAvatarCrop();
});
$('confirm-avatar-crop').onclick=()=>{
  if(!profileDraft || !cropImage)return;
  profileDraft.avatar=avatarCanvas.toDataURL('image/png');updateProfilePreview();$('avatar-crop-dialog').close();
  $('profile-feedback').textContent='头像已裁剪，点击「保存修改」即可应用。';
};
$('avatar-crop-dialog').addEventListener('close',()=>{cropImage=null;cropDrag=null;});
function renderAll(){renderResumes();renderJobs();renderMemos();applyWidths();renderProfile();}
async function init(){
  $('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  try {db=await openDatabase();const stored=await readState();if(stored)state=validateState(stored);setStatus('已保存到本地');}
  catch{saveFailed=true;autosaveBlocked=true;setStatus('本地读取失败',true);toast('原始数据读取失败，已暂停自动保存。可从备份恢复，或换用普通浏览窗口。');}
  ready=true;renderAll();route();
}
init();
