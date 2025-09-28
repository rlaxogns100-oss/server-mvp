/* ========= Dashboard/File Explorer (folders-first, parent-drop only) ========= */
/* 공통 유틸 */
const A = (sel, root=document)=>Array.prototype.slice.call(root.querySelectorAll(sel));
const $ = (sel, root=document)=>root.querySelector(sel);
const toArr = x => Array.prototype.slice.call(x);
const setToArr = s => Array.from ? Array.from(s) : toArr(s);
const GB = 1024*1024*1024;

/* ---- State ---- */
window.__USAGE__ = window.__USAGE__ || { used: 2.4*GB, capacity: 15*GB };
window.__FS__    = window.__FS__ || {
  name:'root', type:'folder', children:[
    { name:'내 파일', type:'folder', children:[
      { name:'sample', type:'folder', children:[
        { name:'sample1', type:'file', size:2*1024*1024, dataSource:'problems1_structured.json' },
        { name:'sample2', type:'file', size:3*1024*1024, dataSource:'output/problems_llm_structured.json' },
        { name:'sample3', type:'file', size:2*1024*1024, dataSource:'problems2_structured.json' }
      ]}
    ]}
  ]
};
// 초기 상태에서 root에 머물되, '내 파일' 폴더는 펼쳐진 상태로 설정
window.__PATH__  = window.__PATH__ || [__FS__];
window.__SEL__   = window.__SEL__  || new Set();
// 초기 상태에서 '내 파일'과 'sample' 폴더를 펼쳐진 상태로 설정
window.__OPEN__  = window.__OPEN__ || new Set(['내 파일', 'sample']);
window.__DRAG_KEYS__ = [];

/* ---- Model helpers ---- */
function attachParents(node, parent=null){ node.__parent=parent; if(node.type==='folder'&&node.children) node.children.forEach(ch=>attachParents(ch,node)); }
function currentFolder(){ return __PATH__[__PATH__.length-1]; }
function pathOf(node){ const names=[]; for(let cur=node; cur&&cur.__parent; cur=cur.__parent) names.push(cur.name); return names.reverse().join('/'); }
function getNodeByPathKey(key){ const parts=key.split('/').filter(Boolean); let cur=__FS__; for(const p of parts){ if(!cur.children) return null; cur=cur.children.find(x=>x.name===p); if(!cur) return null; } return cur; }
function isDescendant(folderNode, maybeChild){ for(let cur=maybeChild; cur&&cur.__parent; cur=cur.__parent){ if(cur.__parent===folderNode) return true; } return false; }
function sumFolderSize(folder){ let t=0; (folder.children||[]).forEach(ch=>t+= (ch.type==='file'?(ch.size||5*1024*1024):sumFolderSize(ch))); return t; }

/* ---- Render ---- */
function createFolderHeader(node){
  const pathKey=pathOf(node), isOpen=__OPEN__.has(pathKey), hasKids=(node.children||[]).length>0;
  const el=document.createElement('div');
  el.className='tile small-tile folder-header drop-zone';
  el.dataset.type='folder'; el.dataset.path=pathKey; el.draggable=true;
  el.innerHTML = `
    <div class="icon folder">📂</div>
    <div><div class="name">${node.name}</div></div>
    <div class="chev">${hasKids ? (isOpen?'▾':'▸') : ''}</div>
    <div class="drop-indicator"></div>`;
  if(__SEL__.has(pathKey)) el.classList.add('selected');
  const chev=el.querySelector('.chev'); 
  if(chev){ chev.style.cursor='pointer'; chev.addEventListener('click',e=>{ e.stopPropagation(); toggleFolder(pathKey); }); }
  return el;
}
function createFolderBlock(node){
  const wrap=document.createElement('div'); wrap.className='folder-item';
  const header=createFolderHeader(node); wrap.appendChild(header);
  if(__OPEN__.has(pathOf(node)) && (node.children||[]).length){
    const kids=document.createElement('div'); kids.className='folder-children';
    const list=(node.children||[]).slice().sort((a,b)=> a.type!==b.type ? (a.type==='folder'?-1:1) : a.name.localeCompare(b.name,'ko'));
    list.forEach(ch=> kids.appendChild(ch.type==='folder' ? createFolderBlock(ch) : createFileTile(ch, true)) );
    wrap.appendChild(kids);
  }
  return wrap;
}
function createFileTile(node, child=false){
  const pathKey=pathOf(node);
  const el=document.createElement('div');
  el.className='tile small-tile'+(child?' child-tile':''); el.dataset.type='file'; el.dataset.path=pathKey; el.draggable=true;
  el.innerHTML = `<div class="icon">📄</div><div><div class="name">${node.name}</div></div>`;
  if(__SEL__.has(pathKey)) el.classList.add('selected'); return el;
}
function toggleFolder(pathKey){ __OPEN__.has(pathKey)?__OPEN__.delete(pathKey):__OPEN__.add(pathKey); renderDirectory(); }

function renderUsage(){
  const used=__USAGE__.used||0, cap=__USAGE__.capacity||15*GB, pct=Math.max(0,Math.min(100,Math.round(used/cap*100)));
  $('#usageFill') && ($('#usageFill').style.width=pct+'%');
  $('#usageText') && ($('#usageText').textContent = (g=>g>=1?g.toFixed(1)+'GB':Math.round(used/1024/1024)+'MB')(used/GB) + ' / ' + (cap/GB).toFixed(1)+'GB');
}
function renderBreadcrumb(){
  const bc=$('#breadcrumb'); if(!bc) return; bc.innerHTML='';
  __PATH__.forEach((node,idx)=>{
    // root 폴더는 브레드크럼에서 숨김
    if(idx === 0 && node.name === 'root') return;
    const s=document.createElement('span'); s.className='crumb'; s.textContent=node.name;
    s.addEventListener('click',()=>{ __PATH__=__PATH__.slice(0,idx+1); renderDirectory(); });
    bc.appendChild(s);
    const visibleIndex = __PATH__.filter((n,i)=>!(i===0 && n.name==='root')).indexOf(node);
    const visibleLength = __PATH__.filter((n,i)=>!(i===0 && n.name==='root')).length;
    if(visibleIndex < visibleLength-1){ const sep=document.createElement('span'); sep.className='sep'; sep.textContent='›'; bc.appendChild(sep); }
  });
}
function renderDirectory(){
  attachParents(__FS__);
  renderUsage(); renderBreadcrumb();
  const body = $('#fileGridBody'); if(!body) return; body.innerHTML='';


  const folder=currentFolder();
  const children=(folder.children||[]).slice().sort((a,b)=> a.type!==b.type ? (a.type==='folder'?-1:1) : a.name.localeCompare(b.name,'ko'));

  if(!children.length){
    const empty=document.createElement('div'); empty.className='tile small-tile'; empty.style.justifyContent='center';
    empty.innerHTML='이 폴더가 비어 있습니다. 상단의 <b>업로드</b> 또는 <b>새 폴더</b>를 사용하세요.'; body.appendChild(empty);
  }else{
    children.filter(c=>c.type==='folder').forEach(f=>body.appendChild(createFolderBlock(f)));
    children.filter(c=>c.type==='file').forEach(f=>body.appendChild(createFileTile(f,false)));
  }
  updateSelectionCounter();
}

/* ---- Selection & dblclick (delegated) ---- */
function updateSelectionCounter(){ const c=$('#selectionCounter'); if(c) c.textContent = '선택 ' + __SEL__.size + '개'; }
document.addEventListener('mousedown', e=>{
  const tile = e.target.closest?.('.small-tile');
  if(!tile || e.target.classList.contains('chev')) return;
  const pathKey = tile.dataset.path, multi = e.ctrlKey||e.metaKey; if(!pathKey) return;
  if(multi){ tile.classList.toggle('selected'); tile.classList.contains('selected')?__SEL__.add(pathKey):__SEL__.delete(pathKey); }
  else{ if(!tile.classList.contains('selected')){ A('#fileGridBody .small-tile.selected').forEach(t=>t.classList.remove('selected')); __SEL__.clear(); tile.classList.add('selected'); __SEL__.add(pathKey); } }
  updateSelectionCounter();
}, true);
document.addEventListener('dblclick', e=>{
  const tile = e.target.closest?.('.small-tile'); if(!tile) return;
  if(tile.classList.contains('folder-header')){
    const key = tile.dataset.path;
    const node = getNodeByPathKey(key);
    if(node && node.type==='folder'){ __PATH__.push(node); renderDirectory(); }
    return;
  }
  if(tile.dataset.type==='file'){ 
    const name=tile.querySelector('.name')?.textContent || '';
    const pathKey = tile.dataset.path;
    const node = getNodeByPathKey(pathKey);
    if(node && node.dataSource) {
      createTab(node.dataSource, name);
    } else {
      console.log('파일 열기:', name);
    }
  }
});
/* ---- Drag & Drop (delegated; targets: folder-header & up-tile) ---- */
function setDragImage(e,count){
  const ghost=document.createElement('div');
  ghost.style.cssText='position:absolute;top:-9999px;left:-9999px;padding:6px 10px;border:2px solid #3b82f6;border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(2,6,23,.08);font-weight:800;color:#1e40af;font-size:12px;';
  ghost.textContent='📦 '+count+'개 항목'; document.body.appendChild(ghost);
  try{ e.dataTransfer.setDragImage(ghost,12,12);}catch(_){}
  setTimeout(()=>ghost.remove(),0);
}
function highlightDrop(el,on){
  if(!el) return; el.classList.toggle('drag-over', !!on);
  const ind=el.querySelector?.('.drop-indicator'); if(ind) ind.style.display = on?'block':'none';
}
function getDragKeysFromDT(dt){
  try{ const j=dt.getData('application/json'); if(j){ const p=JSON.parse(j); if(p && Array.isArray(p.keys)) return p.keys; } }catch(_){}
  try{ const t=dt.getData('text/plain'); if(t) return t.split(/\r?\n/).filter(Boolean); }catch(_){}
  return window.__DRAG_KEYS__ || [];
}
document.addEventListener('dragstart', e=>{
  const tile = e.target.closest?.('.small-tile'); if(!tile) return;
  const pathKey=tile.dataset.path; if(!pathKey){ e.preventDefault(); return; }
  const sel=setToArr(__SEL__), keys = (sel.length && sel.includes(pathKey)) ? sel : [pathKey];
  try{
    e.dataTransfer.clearData(); e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('application/json', JSON.stringify({keys}));
    e.dataTransfer.setData('text/plain', keys.join('\n'));
  }catch(_){}
  window.__DRAG_KEYS__ = keys;
  try{ setDragImage(e, keys.length); }catch(_){}
  keys.forEach(k=>{ const el=$(`.small-tile[data-path="${CSS.escape(k)}"]`); if(el) el.classList.add('dragging'); });
});
document.addEventListener('dragend', ()=> A('#fileGridBody .small-tile.dragging').forEach(el=>el.classList.remove('dragging')));

/* 타겟: 폴더 헤더만 */
document.addEventListener('dragenter', e=>{
  const t = e.target.closest?.('#fileGridBody .folder-header'); if(!t) return;
  e.preventDefault(); highlightDrop(t,true);
});
document.addEventListener('dragover', e=>{
  const t = e.target.closest?.('#fileGridBody .folder-header'); if(!t) return;
  e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect='move'; highlightDrop(t,true);
});
document.addEventListener('dragleave', e=>{
  const t = e.target.closest?.('#fileGridBody .folder-header'); if(!t) return;
  highlightDrop(t,false);
});
document.addEventListener('drop', e=>{
  const t = e.target.closest?.('#fileGridBody .folder-header'); if(!t) return;
  e.preventDefault(); highlightDrop(t,false);
  const keys = e.dataTransfer ? getDragKeysFromDT(e.dataTransfer) : (window.__DRAG_KEYS__||[]);
  if(!keys.length) return;
  if(t.classList.contains('folder-header')){
    const folder = getNodeByPathKey(t.dataset.path);
    if(folder && folder.type==='folder') moveEntries(keys, folder);
  }
});

/* ---- Move ---- */
function moveEntries(pathKeys, targetFolder){
  if(!targetFolder || targetFolder.type!=='folder') return;
  const safe=[];
  pathKeys.forEach(k=>{
    const node=getNodeByPathKey(k); if(!node) return;
    if(node.type==='folder' && (node===targetFolder || isDescendant(node, targetFolder))){
      alert(`폴더 "${node.name}"을(를) 자신의 하위로 이동할 수 없습니다.`); return;
    }
    safe.push(node);
  });
  if(!safe.length) return;

  safe.forEach(node=>{
    const parent=node.__parent;
    parent.children = (parent.children||[]).filter(x=>x!==node);
    let base=node.name.replace(/\(\d+\)$/,''); let name=base, i=1;
    while((targetFolder.children||[]).some(ch=>ch.name===name)) name = `${base}(${i++})`;
    node.name=name;
    (targetFolder.children=targetFolder.children||[]).push(node);
    node.__parent=targetFolder;
    __SEL__.delete(pathOf(node)); __SEL__.add(pathOf(node));
  });
  renderDirectory();
}

/* ---- Toolbar & Upload ---- */
function bindToolbar(){
  const $id = id=>document.getElementById(id);
  $id('renameBtn')?.addEventListener('click', ()=>{
    if(__SEL__.size!==1) return alert('이름 변경은 1개만 가능합니다.');
    const key=setToArr(__SEL__)[0], node=getNodeByPathKey(key), parent=node.__parent;
    const nv=prompt('새 이름', node.name); if(!nv || nv===node.name) return;
    if((parent.children||[]).some(ch=>ch!==node && ch.name===nv)) return alert('동일 이름이 이미 있습니다.');
    node.name=nv; __SEL__.clear(); __SEL__.add(pathOf(node)); renderDirectory();
  });
  $id('deleteBtn')?.addEventListener('click', ()=>{
    if(!__SEL__.size) return alert('삭제할 항목을 선택하세요.');
    if(!confirm(`선택한 ${__SEL__.size}개 항목을 삭제할까요?`)) return;
    setToArr(__SEL__).forEach(k=>{
      const node=getNodeByPathKey(k); if(!node||!node.__parent) return;
      __USAGE__.used = Math.max(0, __USAGE__.used - (node.type==='file' ? (node.size||5*1024*1024) : sumFolderSize(node)));
      node.__parent.children=node.__parent.children.filter(x=>x!==node);
      __SEL__.delete(k);
    });
    renderDirectory();
  });
  $id('newFolderBtn')?.addEventListener('click', ()=>{
    const folder=currentFolder(); let base='새 폴더', name=base, i=1;
    while((folder.children||[]).some(ch=>ch.name===name)) name=`${base} (${i++})`;
    (folder.children=folder.children||[]).push({name, type:'folder', children:[]}); renderDirectory();
  });
}
function setupUpload(){
  const up=$('#uploadTile'), fin=$('#fileInput'), pc=$('#progressContainer'), pf=$('#progressFill'), pt=$('#progressText');
  if(!up || !fin) return;
  up.addEventListener('click', ()=>fin.click());
  fin.addEventListener('change', e=>handleFiles(e.target.files));
  ['dragenter','dragover'].forEach(ev=>up.addEventListener(ev,e=>{e.preventDefault();up.classList.add('drag-over');}));
  ['dragleave','drop'].forEach(ev=>up.addEventListener(ev,e=>{e.preventDefault();up.classList.remove('drag-over');}));
  up.addEventListener('drop', e=>handleFiles(e.dataTransfer.files));
  function handleFiles(list){
    const pdfs=toArr(list).filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name));
    if(!pdfs.length) return alert('PDF 파일만 업로드 가능합니다.');
    if(pc) pc.style.display='block';
    let i=0; (function next(){
      if(i>=pdfs.length){ setTimeout(()=>{ if(pc) pc.style.display='none'; }, 400); return; }
      const f=pdfs[i++]; if(pt) pt.textContent=f.name+' 업로드 중...'; if(pf) pf.style.width='0%';
      let p=0; const t=setInterval(()=>{
        p+=12; if(pf) pf.style.width=p+'%';
        if(p>=100){ clearInterval(t);
          // 항상 '내 파일' 폴더에 업로드
          const myFilesFolder = getNodeByPathKey('내 파일') || currentFolder();
          const raw=f.name.replace(/\.pdf$/i,''); let name=raw, n=1;
          while((myFilesFolder.children||[]).some(ch=>ch.name===name)) name=`${raw} (${n++})`;
          const size=f.size||5*1024*1024; (myFilesFolder.children=myFilesFolder.children||[]).push({name,type:'file',size});
          __USAGE__.used += size; renderDirectory(); next();
        }
      }, 100);
    })();
  }
}

/* ---- Problem Data ---- */
const PROBLEMS_DATA = {
  'problems1_structured.json': [
    {
      "id": 1,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "다음 표에서 가로, 세로, 대각선에 있는 세 다항식의 합이 모두 $3 x^{2}-6 x+9$ 가 되도록 나머지 칸에 써 넣으려 한다. (가)의 위치에 알맞은 다항식을 $f(x)$ 라 할 때, $f(2)$ 의 값은?"
        },
        {
          "type": "table",
          "content": [
            ["", "", "$3 x^{3}+4 x^{2}+x+6$"],
            ["$4 x^{3}+5 x^{2}+2 x+7$", "(가)", ""],
            ["", "", "$x^{3}+2 x^{2}-x+4$"]
          ]
        }
      ],
      "options": ["-5", "-4", "-1", "3", "11"]
    },
    {
      "id": 2,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$x+y+z=3, \\frac{1}{x}+\\frac{1}{y}+\\frac{1}{z}=\\frac{2}{3}$ 일 때, $x^{3}+y^{3}+z^{3}+3 x y z$ 의 값은? (단, $x y z \\neq 0$ 이다.)"
        }
      ],
      "options": ["3", "6", "9", "18", "27"]
    },
    {
      "id": 3,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "다항식 $x^{4}-2 x^{3}+a x^{2}+b x+c$ 가 $(x-1)^{3}$ 으로 나누어떨어질 때, 세 상수 $a, b, c$ 에 대하여 $a+2 b+3 c$ 의 값은?"
        }
      ],
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": 4,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 다항식 $F(x)=a x^{4}+b, G(x)=a x^{5}+b$ 에 대하여 두 다항식 모두 $a x+b$ 를 인수로 가진다. $F(x)$ 를 $a x+b$ 로 나누었을 때의 몫을 $Q_{1}(x), G(x)$ 를 $a x+b$ 로 나누었을 때의 몫을 $Q_{2}(x)$ 라 할 때, $Q_{2}(x)$ 를 $Q_{1}(x)$ 로 나누었을 때의 나머지의 값은? (단, $a, b$ 는 실수, $a b \\neq 0$ )"
        }
      ],
      "options": ["-1", "0", "1", "2", "3"]
    },
    {
      "id": 5,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$\\left(x^{2}-4 x\\right)^{2}-2 x^{2}+8 x-15$ 의 인수 중 일차항의 계수가 1 인 모든 일차식의 합을 $S(x)=p x+q$ 라 할 때 $p q$ 의 값은? (단, $p, q$ 는 상수)"
        }
      ],
      "options": ["-40", "-36", "-32", "-28", "-24"]
    },
    {
      "id": 6,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$\\frac{1600 \\times 1601+1}{1561}$ 의 값은?"
        }
      ],
      "options": ["1621", "1631", "1641", "1651", "1661"]
    },
    {
      "id": 7,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차 이상의 다항식 $f(x)$ 를 $(x-a)(x-b)$ 로 나눈 나머지를 $R(x)$ 라 할 때, [보기]에서 옳은 것만을 있는 대로 고른 것은? (단, $a, b$ 는 서로 다른 두 실수이다.)"
        },
        {
          "type": "examples",
          "content": [
            "ㄱ. $f(a)=R(a)$",
            "ᄂ. $f(a)-R(b)=f(b)-R(a)$",
            "ᄃ. $a f(b)-b f(a)=(a-b) R(0)$"
          ]
        }
      ],
      "options": ["ᄀ", "ᄂ", "ᄀ, ᄃ", "ᄂ, ᄃ", "ᄀ, ᄂ, ᄃ"]
    },
    {
      "id": 8,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 복소수 $\\alpha=5+3 i, \\beta=1-i$ 에 대하여 $\\alpha+\\frac{1}{\\bar{\\beta}}$ 의 값은? (단, $i=\\sqrt{-1}, \\bar{\\beta}$ 는 $\\beta$ 의 켤레복소수)"
        }
      ],
      "options": ["$\\frac{9+5 i}{2}$", "$\\frac{10+7 i}{2}$", "$\\frac{10+5 i}{2}$", "$\\frac{11+7 i}{2}$", "$\\frac{11+5 i}{2}$"]
    },
    {
      "id": 9,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "실수 $x, y$ 에 대하여 $x+y=-3, x y=1$ 을 만족할 때, $\\sqrt{\\frac{y}{x}}+\\sqrt{\\frac{x}{y}}$ 의 값은?"
        }
      ],
      "options": ["-3", "-1", "0", "1", "3"]
    },
    {
      "id": 10,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 이차방정식\n\n$x^{2}+a x+b=0 \\cdots \\text{ (ㄱ) }$\n\n$x^{2}+b x+a=0 \\cdots \\text{ (ㄴ) }$\n\n에 대하여 <보기> 에서 옳은 것만을 있는 대로 고른 것은? (단, $a, b$ 는 실수)"
        },
        {
          "type": "examples",
          "content": "ㄱ. $a b \\leq 0$ 이면 (ㄱ) 과 (ㄴ) 중 적어도 하나는 실근을 가진다.\n\nㄴ. $a+b \\leq 0$ 이면 (ㄱ) 과 (ㄴ) 중 적어도 하나는 실근을 가진다.\n\nᄃ. $a b \\leq a+b \\leq 0$ 이면 (ㄱ) 과 (ㄴ) 중 적어도 하나는 허근을 가진다."
        }
      ],
      "options": ["ᄀ", "ᄂ", "ᄀ, ᄂ", "ᄀ, ᄃ", "ᄀ, ᄂ, ᄃ"]
    },
    {
      "id": 11,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "$x$ 에 대한 이차방정식 $x^{2}+(2 k-1) x+a(k+4)+b+3=0$ 이 실수 $k$ 의 값에 관계없이 항상 1 을 근으로 가질 때, 상수 $a, b$ 에 대하여 $a+b$ 의 값은?"
        }
      ],
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": 12,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "삼각형의 세 변의 길이가 각각 $a, b, c$ 일 때, $x$ 에 대한 이차방정식 $a x^{2}-2 \\sqrt{b^{2} c+b c^{2}+c^{2} a} x+b^{2}+a b+c a=0$ 이 중근을 갖는다. 이 삼각형은 어떤 삼각형인가?"
        }
      ],
      "options": ["$a=b$ 인 이등변삼각형", "$b=c$ 인 이등변삼각형", "$a=c$ 인 이등변삼각형", "$a$ 가 빗변인 직각삼각형", "$b$ 가 빗변인 직각삼각형"]
    }
  ],
  'problems2_structured.json': [
    {
      "id": 1,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "세 다항식 $A, B, C$ 가 다음과 같을 때, $2(A-B)-(A-3 C)$ 를 계산한 값은? [3.0점]"
        },
        {
          "type": "text",
          "content": "$A=x^{3}-x^{2}-3 x+1$"
        },
        {
          "type": "text",
          "content": "$B=2 x^{3}+x^{2}+4 x-5$"
        },
        {
          "type": "text",
          "content": "$C=-x^{2}+9$"
        }
      ],
      "options": ["$-x^{3}+6 x^{2}-11 x+36$", "$-2 x^{3}-6 x^{2}+12 x+36$", "$-3 x^{3}+6 x^{2}-10 x+37$", "$-3 x^{3}-6 x^{2}-11 x+37$", "$-3 x^{3}-6 x^{2}-11 x+38$"]
    },
    {
      "id": 2,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$\\frac{3+i}{3-i}$ 를 $a+b i$ 의 꼴로 나타낼 때, $a+b$ 의 값은? (단, $i=\\sqrt{-1}$ 이고, $a, b$ 는 실수이다.) [3.1점]"
        }
      ],
      "options": ["$\\frac{7}{5}$", "$\\frac{8}{5}$", "$\\frac{9}{5}$", "2", "$\\frac{11}{5}$"]
    },
    {
      "id": 3,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차방정식 $x^{2}+x-a+2=0$ 이 서로 다른 두 허근을 가질 때, $a$ 의 값으로 가능한 것은? [3.2점]"
        }
      ],
      "options": ["$\\frac{3}{2}$", "$\\frac{7}{4}$", "2", "$\\frac{9}{4}$", "$\\frac{5}{2}$"]
    },
    {
      "id": 4,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "등식 $a x(x+1)+b(x+1)(x-2)+c x(x-2)=x^{2}+3 x-4$ 가 모든 실수 $x$ 에 대하여 성립하도록 하는 상수 $a, b, c$ 에 대하여 $2 a+b-c$ 의 값은? [3.3점]"
        }
      ],
      "options": ["2", "4", "6", "8", "10"]
    },
    {
      "id": 5,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차함수 $y=x^{2}+2 k x+k^{2}-2 k$ 의 그래프와 직선 $y=p x+q$ 가 $k$ 의 값에 관계없이 항상 접할 때, 실수 $p, q$ 에 대하여 $p+q$ 의 값은? (단, $p \\neq 0$ 이다.) [3.4점]"
        }
      ],
      "options": ["-2", "-1", "0", "1", "2"]
    },
    {
      "id": 6,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "아래 그림과 같이 이차함수 $y=-2 x^{2}+5 x$ 의 그래프와 접 하고 기울기가 음수인 직선이 점 $(0,4)$ 를 지날 때，이 직선의 기울기는？［3．5점］"
        },
        {
          "type": "image",
          "content": "https://cdn.mathpix.com/cropped/2025_09_21_803fdcb25b27b6e56c43g-1.jpg?height=312&width=466&top_left_y=467&top_left_x=165"
        },
        {
          "type": "text",
          "content": "$y=-2 x^{2}+5 x$"
        }
      ],
      "options": ["$4-4 \\sqrt{2}$", "$4-3 \\sqrt{2}$", "$5-4 \\sqrt{2}$", "$5-3 \\sqrt{2}$", "$6-4 \\sqrt{2}$"]
    },
    {
      "id": 7,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "복소수 $z=\\frac{1+\\sqrt{3} i}{2}$ 에 대하여［보기］에서 옳은 것의 개수는？（단，$i=\\sqrt{-1}$ 이고 $\\bar{z}$ 는 $z$ 의 켤레복소수이다．）［3．7점］"
        },
        {
          "type": "examples",
          "content": "ᄀ．$z^{3}=-1$\nᄂ．$z^{5}+z^{22}=-1$\nᄃ．임의의 자연수 $a, b$ 에 대하여 $a, b$ 의 차가 3 이면 $z^{a}+z^{b}=0$ 이다．\nㄹ． $\\bar{z}=z^{n}$ 을 만족하는 100 이하의 자연수 $n$ 의 개수는 16 개이다．"
        }
      ],
      "options": ["0 개", "1 개", "2 개", "3 개", "4 개"]
    },
    {
      "id": 8,
      "page": 2,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차방정식 $x^{2}-2 x-4=0$ 의 양수인 근을 $\\alpha$ 라 하자． $\\alpha(\\alpha^{2}-3 \\alpha-6)(\\alpha^{2}-\\alpha-5)$ 의 값을 $a+b \\sqrt{5}$ 라 할 때，$a+b$ 의 값은？（단，$a, b$ 는 정수이다．）［3．6점］"
        }
      ],
      "options": ["－30", "－28", "－26", "－24", "－22"]
    },
    {
      "id": 9,
      "page": 3,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 다항식 $P(x), Q(x)$ 에 대하여 $P(x)=a x^{2}-x-2$ 를 $x+2$ 로 나누었을 때 나머지와 $x-3$ 으로 나누었을 때 나머지가 서로 같다. 그리고 $Q(x)$ 를 $P(x)$ 로 나누었을 때 나머지가 $2 x-1$ 이고, $x-a$ 로 나누었을 때 나머지가 4 이다. $Q(x)$ 를 $x^{2}-a^{2}$ 으로 나누었을 때 나머지는? (단, $a \\neq 0$ 인 실수이다.) [3.8점]"
        }
      ],
      "options": ["$\\frac{7}{2} x-\\frac{1}{2}$", "$\\frac{7}{2} x+\\frac{1}{2}$", "$\\frac{5}{2} x+\\frac{1}{2}$", "$\\frac{1}{2} x-\\frac{7}{2}$", "$\\frac{1}{2} x+\\frac{5}{2}$"]
    },
    {
      "id": 10,
      "page": 3,
      "content_blocks": [
        {
          "type": "text",
          "content": "최고차항의 계수가 -2 인 삼차다항식 $P(x)$ 에 대하여 $P(2)=5, P(3)=10, P(4)=17$ 을 만족한다. 다음 등식 $P(x)=a(x-2)^{3}+b(x-2)^{2}+c(x-2)+d$ 가 $x$ 에 대한 항등식이 되도록 상수 $a, b, c, d$ 를 정할 때, $a+2 b+3 c+4 d$ 의 값은? [3.9점]"
        }
      ],
      "options": ["28", "29", "30", "31", "32"]
    },
    {
      "id": 11,
      "page": 3,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차함수 $y=x^{2}-2 a x+a^{2}-8$ 의 그래프와 직선 $y=-8 x-n$ 이 서로 다른 두 점에서 만나도록 하는 모든 자연 수 $n$ 의 개수를 $f(a)$ 라 할 때, $f(1)+f(2)+f(3)$ 의 값은? (단, $a$ 는 실수이다.) [4.0점]"
        }
      ],
      "options": ["20", "21", "22", "23", "24"]
    },
    {
      "id": 12,
      "page": 4,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차함수 $f(x)=-x^{2}+4 a x+a$ 의 그래프가 $x$ 축과 서로 다른 두 점에서 만날 때, 다음 [보기]중에서 옳은 것만을 있는 대로 고른 것은? (단, $a<-\\frac{1}{4}$ 또는 $a>0$ 이다.) [4.1점]"
        },
        {
          "type": "examples",
          "content": [
            "ᄀ. 함수 $y=f(x)$ 의 그래프와 $x$ 축이 만나는 교점의 $x$ 좌 표는 $2 a \\pm \\sqrt{4 a^{2}+a}$ 이다.",
            "ᄂ. 등식 $f(x)-f\\left(a^{2}-1-x\\right)=0$ 이 $x$ 에 대한 항등식이 되도록 하는 $a$ 의 개수는 2이다.",
            "ᄃ. $0 \\leq x \\leq 2$ 에서 이차함수 $y=f(x)$ 의 최솟값이 1 이 되도록 하는 모든 $a$ 의 값의 합은 $\\frac{13}{9}$ 이다."
          ]
        }
      ],
      "options": ["ᄀ", "ᄀ, ᄂ", "ᄂ, ᄃ", "ᄀ, ᄃ", "ᄀ, ᄂ, ᄃ"]
    },
    {
      "id": 13,
      "page": 4,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차방정식 $x^{2}-k x-1=0$ 의 두 근을 $\\alpha, \\beta$ 라 할 때, 두 근의 차는 $2 \\sqrt{2}$ 이고, $y=x^{2}+a x+b$ 의 그래프가 두 점 $(\\alpha^{2}-\\alpha-1, \\alpha),(\\beta^{2}-\\beta-1, \\beta)$ 를 지난다. 두 상수 $a, b$ 의 합 $a+b$ 의 값은? (단, $k>0$ 인 실수이다.)"
        }
      ],
      "options": ["2", "1", "0", "-1", "-2"]
    },
    {
      "id": 14,
      "page": 4,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차방정식 $x^{2}-(2 k-1) x+3 k=0$ 이 허근 $z$ 를 가질 때, $z^{4}$ 이 실수가 되도록 하는 모든 실수 $k$ 의 값의 합은?"
        }
      ],
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": 15,
      "page": 5,
      "content_blocks": [
        {
          "type": "text",
          "content": "$\\left\\{\\left(\\frac{-1+\\sqrt{3} i}{2}\\right)^{a}+\\left(\\frac{1-\\sqrt{3} i}{2}\\right)^{b}\\right\\}^{c}=k$ 라 할 때, 4 이하의 자연수 $a, b, c$ 에 대하여 $k$ 가 음의 정수가 되도록 하는 순서쌍 $(a, b, c)$ 의 개수는? (단, $i=\\sqrt{-1}$ 이다.) [4.4점]"
        }
      ],
      "options": ["3", "5", "7", "9", "11"]
    },
    {
      "id": 16,
      "page": 5,
      "content_blocks": [
        {
          "type": "text",
          "content": "다항식 $x^{13}+x^{7}+3$ 을 $x^{2}+x+1$, $x^{2}-x+1$, $(x^{3}+1)(x^{3}-1)$ 로 나눈 나머지를 각각 $r_{1}(x), r_{2}(x), r_{3}(x)$ 라 할 때, $r_{1}(x)+r_{2}(x)+r_{3}(x)$ 를 $x-2$ 로 나눈 나머지는?"
        }
      ],
      "options": ["20", "21", "22", "23", "24"]
    },
    {
      "id": 17,
      "page": 6,
      "content_blocks": [
        {
          "type": "text",
          "content": "다항식 $A$ 를 $x^{2}-3 x+1$ 로 나누었더니 몫이 $x^{2}-1$ 이고 나머지가 $-x+3$ 이라 할 때，다음 물음에 답하시오．［10점，부분점수 있음］"
        }
      ],
      "options": []
    },
    {
      "id": 18,
      "page": null,
      "content_blocks": [
        {
          "type": "text",
          "content": "（1）다항식 $A$ 를 풀이과정과 함께 구하고，$x$ 에 대하여 내림차 순으로 쓰시오．［2점］"
        },
        {
          "type": "text",
          "content": "（2）다항식 $A$ 를 다항식 $x^{2}+x-1$ 로 나누었을 때 몫을 $Q(x)$ ，나머지를 $R(x)$ 라 하자． $Q(x), R(x), Q(0), R(0)$ 을 각각 풀이과정과 함께 구하시오．［8점］"
        }
      ],
      "options": []
    },
    {
      "id": 19,
      "page": 6,
      "content_blocks": [
        {
          "type": "text",
          "content": "$-1 \\leq x \\leq 1$ 에서 이차함수 $f(x)=-x^{2}+2 a x-2 a+1$ 의 최댓값을 $g(a)$ 라 할 때，$g(a)$ 의 최솟값을 풀이과정과 함께 구하시오．［10점，부분점수 있음］"
        }
      ],
      "options": []
    },
    {
      "id": 20,
      "page": 7,
      "content_blocks": [
        {
          "type": "text",
          "content": "［서답형3］"
        },
        {
          "type": "text",
          "content": "$y=-\\left(-x^{2}+4 x-3\\right)^{2}+4\\left(-x^{2}+4 x-3\\right)-3$ 에 대하여 $0 \\leq x \\leq 5$ 에서의 최댓값을 $a$ ，최솟값을 $b$ 라 하고， $-3 \\leq x \\leq 1$ 에서 최댓값을 $c$ ，최솟값을 $d$ 라 할 때， $a+b+c+d$ 의 값을 풀이과정과 함께 구하시오．［10점，부분점 수 있음］"
        }
      ],
      "options": []
    },
    {
      "id": 21,
      "page": null,
      "content_blocks": [
        {
          "type": "text",
          "content": "다항식 $P(x)$ 를 $x^{2}-2 x$ 로 나눈 몫은 $Q(x)$ ，나머지는 $5 x+k$ 이고，$P(x)$ 를 $x^{4}+x^{3}-8 x^{2}+5 x-2$ 로 나누었을 때 나 머지는 $x^{3}+2 x^{2}-1$ 이다．$Q(x)$ 를 $x^{3}+3 x^{2}-2 x+1$ 로 나눈 나머지 $R(x)$ 에 대하여 $R(1)+k$ 의 값을 풀이과정과 함께 구 하시오．（단，$k$ 는 상수이다．）［10점，부분점수 있음］"
        }
      ],
      "options": []
    }
  ],
  'output/problems_llm_structured.json': [
    {
      "id": 1,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "다음 표에서 가로, 세로, 대각선에 있는 세 다항식의 합이 모두 $3 x^{2}-6 x+9$ 가 되도록 나머지 칸에 써 넣으려 한다. (가)의 위치에 알맞은 다항식을 $f(x)$ 라 할 때, $f(2)$ 의 값은?"
        },
        {
          "type": "table",
          "content": "| | $x^2-2x+3$ | $2x^2-x+1$ | |\n|---|---|---|---|\n| $x^2+4x-1$ | | | $x^2-3x+7$ |\n| | (가) | | |"
        }
      ],
      "options": ["-1", "0", "1", "2", "3"]
    },
    {
      "id": 2,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$x+y+z=3, \\frac{1}{x}+\\frac{1}{y}+\\frac{1}{z}=\\frac{2}{3}$ 일 때, $x^{3}+y^{3}+z^{3}+3 x y z$ 의 값은? (단, $x y z \\neq 0$ 이다.)"
        }
      ],
      "options": ["3", "6", "9", "18", "27"]
    },
    {
      "id": 3,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "다항식 $x^{4}-2 x^{3}+a x^{2}+b x+c$ 가 $(x-1)^{3}$ 으로 나누어떨어질 때, 세 상수 $a, b, c$ 에 대하여 $a+2 b+3 c$ 의 값은?"
        }
      ],
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": 4,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 다항식 $F(x)=a x^{4}+b, G(x)=a x^{5}+b$ 에 대하여 두 다항식 모두 $a x+b$ 를 인수로 가진다. $F(x)$ 를 $a x+b$ 로 나누었을 때의 몫을 $Q_{1}(x), G(x)$ 를 $a x+b$ 로 나누었을 때의 몫을 $Q_{2}(x)$ 라 할 때, $Q_{2}(x)$ 를 $Q_{1}(x)$ 로 나누었을 때의 나머지의 값은? (단, $a, b$ 는 실수, $a b \\neq 0$ )"
        }
      ],
      "options": ["-1", "0", "1", "2", "3"]
    },
    {
      "id": 5,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$\\left(x^{2}-4 x\\right)^{2}-2 x^{2}+8 x-15$ 의 인수 중 일차항의 계수가 1 인 모든 일차식의 합을 $S(x)=p x+q$ 라 할 때 $p q$ 의 값은? (단, $p, q$ 는 상수)"
        }
      ],
      "options": ["-40", "-36", "-32", "-28", "-24"]
    },
    {
      "id": 6,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$\\frac{1600 \\times 1601+1}{1561}$ 의 값은?"
        }
      ],
      "options": ["1621", "1631", "1641", "1651", "1661"]
    },
    {
      "id": 7,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "이차 이상의 다항식 $f(x)$ 를 $(x-a)(x-b)$ 로 나눈 나머지를 $R(x)$ 라 할 때, [보기]에서 옳은 것만을 있는 대로 고른 것은? (단, $a, b$ 는 서로 다른 두 실수이다.)"
        },
        {
          "type": "examples",
          "content": [
            "ㄱ. $R(x)$ 는 일차식이다.",
            "ㄴ. $f(a)=f(b)$ 이면 $R(x)$ 는 상수이다.",
            "ㄷ. $f(a)=f(b)$ 이면 $f(x)-R(x)$ 는 $(x-a)(x-b)$ 로 나누어떨어진다."
          ]
        }
      ],
      "options": ["ㄱ", "ㄴ", "ㄷ", "ㄱ, ㄴ", "ㄱ, ㄷ", "ㄴ, ㄷ", "ㄱ, ㄴ, ㄷ"]
    },
    {
      "id": 8,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 복소수 $\\alpha=5+3 i, \\beta=1-i$ 에 대하여 $\\alpha+\\frac{1}{\\bar{\\beta}}$ 의 값은? (단, $i=\\sqrt{-1}, \\bar{\\beta}$ 는 $\\beta$ 의 켤레복소수)"
        }
      ],
      "options": ["$\\frac{9+5 i}{2}$", "$\\frac{10+7 i}{2}$", "$\\frac{10+5 i}{2}$", "$\\frac{11+7 i}{2}$", "$\\frac{11+5 i}{2}$"]
    },
    {
      "id": 9,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "실수 $x, y$ 에 대하여 $x+y=-3, x y=1$ 을 만족할 때, $\\sqrt{\\frac{y}{x}}+\\sqrt{\\frac{x}{y}}$ 의 값은?"
        }
      ],
      "options": ["-3", "-1", "0", "1", "3"]
    },
    {
      "id": 10,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "두 이차방정식\n\n$$x^{2}+a x+b=0 \\cdots \\text { (ㄱ) }$$\n\n$$x^{2}+b x+a=0 \\cdots \\text { (ㄴ) }$$\n\n에 대하여 <보기> 에서 옳은 것만을 있는 대로 고른 것은? (단, $a, b$ 는 실수)"
        },
        {
          "type": "examples",
          "content": [
            "ㄱ. $a b \\leq 0$ 이면 (ㄱ) 과 (ㄴ) 중 적어도 하나는 실근을 가진다.",
            "ㄴ. $a+b \\leq 0$ 이면 (ㄱ) 과 (ㄴ) 중 적어도 하나는 실근을 가진다.",
            "ㄷ. $a b \\leq a+b \\leq 0$ 이면 (ㄱ) 과 (ㄴ) 중 적어도 하나는 허근을 가진다."
          ]
        }
      ],
      "options": ["ᄀ", "ᄂ", "ᄀ, ᄂ", "ᄀ, ᄃ", "ᄀ, ᄂ, ᄃ"]
    },
    {
      "id": 11,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "$x$ 에 대한 이차방정식 $x^{2}+(2 k-1) x+a(k+4)+b+3=0$ 이 실수 $k$ 의 값에 관계없이 항상 1 을 근으로 가질 때, 상수 $a, b$ 에 대하여 $a+b$ 의 값은?"
        }
      ],
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": 12,
      "page": 1,
      "content_blocks": [
        {
          "type": "text",
          "content": "삼각형의 세 변의 길이가 각각 $a, b, c$ 일 때, $x$ 에 대한 이차방정식 $a x^{2}-2 \\sqrt{b^{2} c+b c^{2}+c^{2} a} x+b^{2}+a b+c a=0$ 이 중근을 갖는다. 이 삼각형은 어떤 삼각형인가?"
        }
      ],
      "options": ["$a=b$ 인 이등변삼각형", "$b=c$ 인 이등변삼각형", "$a=c$ 인 이등변삼각형", "$a$ 가 빗변인 직각삼각형", "$b$ 가 빗변인 직각삼각형"]
    }
  ]
};

/* ---- Tab Management ---- */
let openTabs = [];
let activeTabId = null;

/* ---- Problem Selection ---- */
let selectedProblemsByFile = new Map(); // 파일별로 선택 상태 관리

/* ---- Exam Preview ---- */
let examProblems = []; // 시험지에 추가된 문항들 (순서대로)
let examProblemCounter = 1; // 시험지 내 문항 번호

/* ---- Resize Handle ---- */
let isResizing = false;
let startX = 0;
let startLeftWidth = 0;
let startRightWidth = 0;

function createTab(dataSource, fileName) {
  const tabId = dataSource;
  
  // 이미 열린 탭인지 확인
  const existingTab = openTabs.find(tab => tab.id === tabId);
  if (existingTab) {
    switchToTab(tabId);
    return;
  }
  
  // 새 탭 생성
  const tab = {
    id: tabId,
    name: fileName,
    dataSource: dataSource
  };
  
  openTabs.push(tab);
  activeTabId = tabId;
  renderTabs();
  loadProblemsFromFile(dataSource);
}

function switchToTab(tabId) {
  activeTabId = tabId;
  const tab = openTabs.find(t => t.id === tabId);
  if (tab) {
    renderTabs();
    loadProblemsFromFile(tab.dataSource);
  }
}

function closeTab(tabId) {
  openTabs = openTabs.filter(tab => tab.id !== tabId);
  
  if (activeTabId === tabId) {
    if (openTabs.length > 0) {
      activeTabId = openTabs[openTabs.length - 1].id;
      const lastTab = openTabs[openTabs.length - 1];
      loadProblemsFromFile(lastTab.dataSource);
    } else {
      activeTabId = null;
      clearProblems();
    }
  }
  
  renderTabs();
}

function renderTabs() {
  const tabsContainer = document.getElementById('problemTabs');
  if (!tabsContainer) return;
  
  tabsContainer.innerHTML = '';
  
  openTabs.forEach(tab => {
    const tabElement = document.createElement('div');
    tabElement.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
    tabElement.dataset.tabId = tab.id;
    
    const icon = document.createElement('div');
    icon.className = 'tab-icon';
    icon.textContent = tab.name.charAt(0).toUpperCase();
    
    const name = document.createElement('span');
    name.textContent = tab.name;
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    
    tabElement.appendChild(icon);
    tabElement.appendChild(name);
    tabElement.appendChild(closeBtn);
    
    tabElement.addEventListener('click', () => {
      switchToTab(tab.id);
    });
    
    tabsContainer.appendChild(tabElement);
  });
}

function clearProblems() {
  const column1 = document.getElementById('column1');
  const column2 = document.getElementById('column2');
  
  if (column1) column1.innerHTML = '';
  if (column2) column2.innerHTML = '';
}

function getCurrentFileSelectedProblems() {
  if (!activeTabId) return new Set();
  if (!selectedProblemsByFile.has(activeTabId)) {
    selectedProblemsByFile.set(activeTabId, new Set());
  }
  return selectedProblemsByFile.get(activeTabId);
}

function toggleProblemSelection(problemId) {
  const currentFileSelected = getCurrentFileSelectedProblems();
  
  // 파일별 고유 ID 생성 (파일명:문항ID)
  const uniqueProblemId = `${activeTabId}:${problemId}`;
  
  if (currentFileSelected.has(problemId)) {
    // 선택 해제
    currentFileSelected.delete(problemId);
    removeProblemFromExam(uniqueProblemId);
  } else {
    // 선택 추가
    currentFileSelected.add(problemId);
    
    // 현재 활성 탭의 문제 데이터에서 해당 문항 찾기
    if (activeTabId && PROBLEMS_DATA[activeTabId]) {
      const problemData = PROBLEMS_DATA[activeTabId].find(p => p.id === problemId);
      if (problemData) {
        addProblemToExam(uniqueProblemId, problemData);
      }
    }
  }
}

// 모두 선택 기능 제거됨

/* ---- Resize Functions ---- */
function initResizeHandle() {
  const resizeHandle = document.getElementById('resizeHandle');
  if (!resizeHandle) return;

  resizeHandle.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  
  // 초기 위치 설정
  updateResizeHandlePosition();
}

function updateResizeHandlePosition() {
  const resizeHandle = document.getElementById('resizeHandle');
  const main = document.querySelector('.main');
  if (!resizeHandle || !main) return;
  
  const mainRect = main.getBoundingClientRect();
  const leftColumn = document.querySelector('.preview-wrap');
  
  if (!leftColumn) {
    // DOM이 아직 준비되지 않은 경우, 기본 위치로 설정
    const defaultLeft = 324 + 18 + (mainRect.width - 324 - 36) / 2 - 3;
    resizeHandle.style.left = defaultLeft + 'px';
    return;
  }
  
  const leftColumnRect = leftColumn.getBoundingClientRect();
  
  // 핸들을 왼쪽 컬럼의 오른쪽 경계에 위치
  const handleLeft = leftColumnRect.right - mainRect.left - 3; // 3px는 핸들 너비의 절반
  resizeHandle.style.left = handleLeft + 'px';
}

function startResize(e) {
  isResizing = true;
  startX = e.clientX;
  
  const main = document.querySelector('.main');
  const computedStyle = getComputedStyle(main);
  const gridTemplateColumns = computedStyle.gridTemplateColumns.split(' ');
  
  // 현재 그리드 컬럼 비율 계산
  const leftWidth = parseFloat(gridTemplateColumns[1]) || 1;
  const rightWidth = parseFloat(gridTemplateColumns[2]) || 1;
  
  startLeftWidth = leftWidth;
  startRightWidth = rightWidth;
  
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function handleResize(e) {
  if (!isResizing) return;
  
  const deltaX = e.clientX - startX;
  const main = document.querySelector('.main');
  const mainRect = main.getBoundingClientRect();
  const availableWidth = mainRect.width - 324 - 36; // 대시보드와 간격 제외
  
  // 새로운 비율 계산
  const leftRatio = startLeftWidth / (startLeftWidth + startRightWidth);
  const rightRatio = startRightWidth / (startLeftWidth + startRightWidth);
  
  const newLeftRatio = leftRatio + (deltaX / availableWidth);
  const newRightRatio = rightRatio - (deltaX / availableWidth);
  
  // 최소/최대 비율 제한 (20% ~ 80%)
  const minRatio = 0.2;
  const maxRatio = 0.8;
  
  const clampedLeftRatio = Math.max(minRatio, Math.min(maxRatio, newLeftRatio));
  const clampedRightRatio = 1 - clampedLeftRatio;
  
  // 그리드 템플릿 업데이트
  main.style.gridTemplateColumns = `324px ${clampedLeftRatio}fr ${clampedRightRatio}fr`;
  
  // 핸들 위치 업데이트
  setTimeout(() => {
    updateResizeHandlePosition();
  }, 0);
}

function stopResize() {
  if (!isResizing) return;
  
  isResizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

/* ---- Exam Preview Functions ---- */
function addProblemToExam(uniqueProblemId, problemData) {
  // 이미 추가된 문항인지 확인
  if (examProblems.find(p => p.uniqueId === uniqueProblemId)) {
    return;
  }
  
  const examProblem = {
    id: examProblemCounter++,
    uniqueId: uniqueProblemId,
    data: problemData,
    addedAt: new Date()
  };
  
  examProblems.push(examProblem);
  renderExamProblems();
  updateExamStats();
}

function removeProblemFromExam(uniqueProblemId) {
  const index = examProblems.findIndex(p => p.uniqueId === uniqueProblemId);
  if (index !== -1) {
    examProblems.splice(index, 1);
    renderExamProblems();
    updateExamStats();
  }
}

function renderExamProblems() {
  const examProblemsContainer = document.getElementById('examProblems');
  if (!examProblemsContainer) return;
  
  if (examProblems.length === 0) {
    examProblemsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>왼쪽에서 문항을 선택하면 여기에 표시됩니다</p>
      </div>
    `;
    return;
  }
  
  // 페이지당 문항 수 (A4 기준으로 약 8-10개)
  const problemsPerPage = 8;
  const totalPages = Math.ceil(examProblems.length / problemsPerPage);
  
  examProblemsContainer.innerHTML = '';
  
  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const pageProblems = examProblems.slice(pageIndex * problemsPerPage, (pageIndex + 1) * problemsPerPage);
    
    const pageElement = document.createElement('div');
    pageElement.className = 'exam-page';
    
    // 첫 페이지에만 헤더 추가
    if (pageIndex === 0) {
      pageElement.innerHTML = `
        <div class="exam-page-header">
          <div class="exam-page-title">수학 시험지</div>
          <div class="exam-page-subtitle">2024학년도 1학기 중간고사</div>
        </div>
      `;
    }
    
    // 페이지 내용
    const contentElement = document.createElement('div');
    contentElement.className = 'exam-page-content';
    
    // 2열 레이아웃
    const column1 = document.createElement('div');
    column1.className = 'exam-page-column';
    const column2 = document.createElement('div');
    column2.className = 'exam-page-column';
    
    pageProblems.forEach((examProblem, index) => {
      const problemElement = createExamProblemElement(examProblem);
      
      if (index % 2 === 0) {
        column1.appendChild(problemElement);
      } else {
        column2.appendChild(problemElement);
      }
    });
    
    contentElement.appendChild(column1);
    contentElement.appendChild(column2);
    
    // 페이지 푸터
    const footerElement = document.createElement('div');
    footerElement.className = 'exam-page-footer';
    footerElement.innerHTML = `<span class="exam-page-number">${pageIndex + 1}페이지</span>`;
    
    pageElement.appendChild(contentElement);
    pageElement.appendChild(footerElement);
    
    examProblemsContainer.appendChild(pageElement);
  }
  
  // MathJax 렌더링
  if(window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

function createExamProblemElement(examProblem) {
  const div = document.createElement('div');
  div.className = 'exam-problem';
  div.dataset.examProblemId = examProblem.id;
  div.dataset.uniqueId = examProblem.uniqueId;
  
  const pnum = document.createElement('div');
  pnum.className = 'pnum';
  pnum.textContent = examProblem.id + '.';
  
  const pbody = document.createElement('div');
  pbody.className = 'pbody';
  
  // content_blocks 처리
  if(examProblem.data.content_blocks && Array.isArray(examProblem.data.content_blocks)) {
    examProblem.data.content_blocks.forEach(block => {
      if(block.type === 'text') {
        const textDiv = document.createElement('div');
        textDiv.innerHTML = block.content;
        pbody.appendChild(textDiv);
      } else if(block.type === 'table' && Array.isArray(block.content)) {
        const table = document.createElement('table');
        table.className = 'table';
        block.content.forEach(row => {
          const tr = document.createElement('tr');
          row.forEach(cell => {
            const td = document.createElement('td');
            td.innerHTML = cell;
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        pbody.appendChild(table);
      } else if(block.type === 'examples') {
        const examplesDiv = document.createElement('div');
        if(Array.isArray(block.content)) {
          block.content.forEach(example => {
            const exampleDiv = document.createElement('div');
            exampleDiv.innerHTML = example;
            examplesDiv.appendChild(exampleDiv);
          });
        } else {
          examplesDiv.innerHTML = block.content;
        }
        pbody.appendChild(examplesDiv);
      } else if(block.type === 'image') {
        const imgDiv = document.createElement('div');
        const img = document.createElement('img');
        img.src = block.content;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        imgDiv.appendChild(img);
        pbody.appendChild(imgDiv);
      }
    });
  }
  
  // options 처리
  if(examProblem.data.options && Array.isArray(examProblem.data.options)) {
    const optionsDiv = document.createElement('div');
    optionsDiv.style.marginTop = '8px';
    examProblem.data.options.forEach((option, index) => {
      const optionDiv = document.createElement('div');
      optionDiv.innerHTML = `(${index + 1}) ${option}`;
      optionsDiv.appendChild(optionDiv);
    });
    pbody.appendChild(optionsDiv);
  }
  
  div.appendChild(pnum);
  div.appendChild(pbody);
  
  return div;
}

function updateExamStats() {
  const totalProblemsElement = document.getElementById('totalProblems');
  const estimatedTimeElement = document.getElementById('estimatedTime');
  
  if (totalProblemsElement) {
    totalProblemsElement.textContent = examProblems.length;
  }
  
  if (estimatedTimeElement) {
    // 문항당 평균 2분으로 계산
    const estimatedMinutes = examProblems.length * 2;
    estimatedTimeElement.textContent = `${estimatedMinutes}분`;
  }
}

function clearExam() {
  examProblems = [];
  examProblemCounter = 1;
  renderExamProblems();
  updateExamStats();
  
  // 모든 파일의 선택 상태도 해제
  selectedProblemsByFile.clear();
  
  // 모든 파일의 문항들의 선택 상태 해제
  const allProblems = document.querySelectorAll('.problem');
  allProblems.forEach(problem => {
    problem.classList.remove('selected');
  });
}

/* ---- Problem Loading ---- */
function loadProblemsFromFile(dataSource) {
  console.log('문제 파일 로드:', dataSource);
  
  // 내장된 데이터에서 문제 로드
  const problems = PROBLEMS_DATA[dataSource];
  if (!problems) {
    console.error('알 수 없는 데이터 소스:', dataSource);
    alert('문제 데이터를 찾을 수 없습니다: ' + dataSource);
    return;
  }
  
  displayProblems(problems);
}

function displayProblems(problems) {
  const column1 = document.getElementById('column1');
  const column2 = document.getElementById('column2');
  
  if(!column1 || !column2) {
    console.error('컬럼 요소를 찾을 수 없습니다');
    return;
  }
  
  // 기존 문제들 제거
  column1.innerHTML = '';
  column2.innerHTML = '';
  
  // 현재 파일의 선택 상태를 한 번만 가져오기
  const currentFileSelected = getCurrentFileSelectedProblems();
  
  // 문제들을 2열로 분배
  problems.forEach((problem, index) => {
    const problemElement = createProblemElement(problem);
    
    // 현재 파일의 선택 상태 복원
    if (currentFileSelected.has(problem.id)) {
      problemElement.classList.add('selected');
    }
    
    if(index % 2 === 0) {
      column1.appendChild(problemElement);
    } else {
      column2.appendChild(problemElement);
    }
  });
  
  // MathJax 재렌더링
  if(window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

function createProblemElement(problem) {
  const div = document.createElement('div');
  div.className = 'problem';
  div.dataset.problem = problem.id;
  
  // 클릭 이벤트 추가
  div.addEventListener('click', () => {
    toggleProblemSelection(problem.id);
    div.classList.toggle('selected');
  });
  
  // 문제 번호
  const pnum = document.createElement('div');
  pnum.className = 'pnum';
  pnum.textContent = problem.id + '.';
  
  // 문제 내용
  const pbody = document.createElement('div');
  pbody.className = 'pbody';
  
  // content_blocks 처리
  if(problem.content_blocks && Array.isArray(problem.content_blocks)) {
    problem.content_blocks.forEach(block => {
      if(block.type === 'text') {
        const textDiv = document.createElement('div');
        textDiv.innerHTML = block.content;
        pbody.appendChild(textDiv);
      } else if(block.type === 'table' && Array.isArray(block.content)) {
        const table = document.createElement('table');
        table.className = 'table';
        block.content.forEach(row => {
          const tr = document.createElement('tr');
          row.forEach(cell => {
            const td = document.createElement('td');
            td.innerHTML = cell;
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        pbody.appendChild(table);
      } else if(block.type === 'examples') {
        const examplesDiv = document.createElement('div');
        if(Array.isArray(block.content)) {
          block.content.forEach(example => {
            const exampleDiv = document.createElement('div');
            exampleDiv.innerHTML = example;
            examplesDiv.appendChild(exampleDiv);
          });
        } else {
          examplesDiv.innerHTML = block.content;
        }
        pbody.appendChild(examplesDiv);
      } else if(block.type === 'image') {
        const imgDiv = document.createElement('div');
        const img = document.createElement('img');
        img.src = block.content;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        imgDiv.appendChild(img);
        pbody.appendChild(imgDiv);
      }
    });
  }
  
  // 선택지 추가
  if(problem.options && Array.isArray(problem.options)) {
    const optionsDiv = document.createElement('div');
    optionsDiv.style.marginTop = '8px';
    problem.options.forEach((option, index) => {
      const optionDiv = document.createElement('div');
      optionDiv.innerHTML = `(${index + 1}) ${option}`;
      optionsDiv.appendChild(optionDiv);
    });
    pbody.appendChild(optionsDiv);
  }
  
  div.appendChild(pnum);
  div.appendChild(pbody);
  
  return div;
}

/* ---- Search & misc ---- */
function filterGlobal(e){
  const q=(e.target.value||'').toLowerCase();
  A('#fileGridBody .small-tile').forEach(t=>{
    if(t.classList.contains('up-tile')) return;
    const name=t.querySelector('.name')?.textContent.toLowerCase()||'';
    t.style.display = name.includes(q) ? 'flex':'none';
  });
}
document.addEventListener('mousedown', e=>{
  if(e.target.closest('#fileGridBody .small-tile')) return;
  if(e.target.closest('.ex-toolbar,.ex-upload,.ex-breadcrumb')) return;
  __SEL__.clear(); A('#fileGridBody .small-tile.selected').forEach(t=>t.classList.remove('selected')); updateSelectionCounter();
}, true);

/* ---- Boot ---- */
function initDashboard(){
  if (window.__DASH_INIT__) return; window.__DASH_INIT__ = true;
  setupUpload(); bindToolbar(); renderDirectory();
  $('#globalSearch')?.addEventListener('input', filterGlobal);
  document.addEventListener('keydown', e=>{ if(e.key==='/' && !e.target.matches('input,textarea')){ e.preventDefault(); $('#globalSearch')?.focus(); } });
  
  // 모두 선택 기능 제거됨
  
  // 초기화 버튼 이벤트 리스너 추가
  const clearExamBtn = document.getElementById('clearExam');
  if (clearExamBtn) {
    clearExamBtn.addEventListener('click', clearExam);
  }
  
  // 리사이즈 핸들 초기화
  initResizeHandle();
  
  // 윈도우 리사이즈 시 핸들 위치 업데이트
  window.addEventListener('resize', updateResizeHandlePosition);
  
  // 초기 로드 시 sample1 데이터 표시
  setTimeout(() => {
    createTab('problems1_structured.json', 'sample1');
    // DOM이 완전히 로드된 후 핸들 위치 재설정
    setTimeout(() => {
      updateResizeHandlePosition();
    }, 100);
  }, 500);
}
document.addEventListener('DOMContentLoaded', initDashboard);
