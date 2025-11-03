/* ========= Dashboard/File Explorer (folders-first, parent-drop only) ========= */
/* 공통 유틸 */
const A = (sel, root=document)=>Array.prototype.slice.call(root.querySelectorAll(sel));
const $ = (sel, root=document)=>root.querySelector(sel);
const toArr = x => Array.prototype.slice.call(x);
const setToArr = s => Array.from ? Array.from(s) : toArr(s);
const GB = 1024*1024*1024;

// 마크다운 표를 HTML로 변환
function renderMarkdownTable(text) {
  if (!text || typeof text !== 'string') return text;

  const tableRegex = /(?:^|\n)((?:\|[^\n]*\|(?:\n|$))+)/g;

  return text.replace(tableRegex, (match, tableBlock) => {
    const rows = tableBlock.trim().split('\n').map(row => row.trim()).filter(row => row.startsWith('|') && row.endsWith('|'));

    if (rows.length < 1) return match;

    let html = '<table class="table">';
    html += '<tbody>';

    // 구분선 위치 찾기
    let separatorIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].includes('---') || rows[i].includes('===')) {
        separatorIndex = i;
        break;
      }
    }

    // 구분선 이후의 데이터 행만 렌더링 (헤더 제외)
    const startIndex = separatorIndex >= 0 ? separatorIndex + 1 : 0;

    for (let i = startIndex; i < rows.length; i++) {
      const dataCells = rows[i].slice(1, -1).split('|').map(cell => cell.trim());

      html += '<tr>';
      dataCells.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    }

    html += '</tbody>';
    html += '</table>';

    return html;
  });
}

// condition 블록에 줄바꿈 추가
function formatConditionText(text) {
  if (!text) return '';

  // 기존 \n을 <br/>로 변환
  let result = text.replace(/\n/g, '<br/>');

  // (가), (나), (다) 형태 앞에 줄바꿈 추가 (이미 <br/>가 없는 경우에만)
  result = result.replace(/([^>])([(（])\s*([가-힣])\s*([)）])/g, '$1<br/>$2$3$4');

  // ㄱ., ㄴ., ㄷ. 형태 앞에 줄바꿈 추가 (이미 <br/>가 없는 경우에만)
  result = result.replace(/([^>])([ㄱ-ㅎ])\s*\./g, '$1<br/>$2.');

  return result;
}

/* ---- State ---- */
window.__USAGE__ = window.__USAGE__ || { used: 0, capacity: 15*GB };
if (!window.__FS__) {
  window.__FS__ = {
    name:'root', type:'folder', children:[
      { name:'내 파일', type:'folder', children:[] }
    ]
  };
} else {
  // '내 파일' 폴더가 없으면 추가
  if (!window.__FS__.children) {
    window.__FS__.children = [];
  }
  if (!window.__FS__.children.find(c => c.name === '내 파일')) {
    window.__FS__.children.push({ name:'내 파일', type:'folder', children:[] });
  }
}
// 초기 상태에서 root 폴더에서 시작, '내 파일' 폴더는 펼쳐진 상태로 설정
window.__PATH__  = window.__PATH__ || [window.__FS__]; // root
window.__SEL__   = window.__SEL__  || new Set();
// 초기 상태에서 '내 파일' 폴더를 펼쳐진 상태로 설정
window.__OPEN__  = window.__OPEN__ || new Set(['내 파일']);
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
  // 모바일 전용 열기 버튼(탭 지원)
  try{
    if (window.innerWidth <= 768) {
      const btn = document.createElement('button');
      btn.type='button';
      btn.className='open-btn';
      btn.textContent='열기';
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        // 탭 자동 전환: 문항 선택
        if (window.innerWidth <= 768 && window.switchMobileTab) {
          window.switchMobileTab('preview');
        }
        const name=el.querySelector('.name')?.textContent || '';
        const nodeRef = getNodeByPathKey(pathKey);
        if(nodeRef && nodeRef.dataSource){
          createTab(nodeRef.dataSource, name);
        } else if(nodeRef && nodeRef.fileId){
          if(window.viewFileProblems){ window.viewFileProblems(nodeRef.fileId, nodeRef.name); }
        }
      });
      el.appendChild(btn);
    }
  }catch(_){}
  if(__SEL__.has(pathKey)) el.classList.add('selected'); return el;
}
function toggleFolder(pathKey){ __OPEN__.has(pathKey)?__OPEN__.delete(pathKey):__OPEN__.add(pathKey); renderDirectory(); }

function renderUsage(){
  const used=__USAGE__.used||0, cap=__USAGE__.capacity||15*GB, pct=Math.max(0,Math.min(100,Math.round(used/cap*100)));
  $('#usageFill') && ($('#usageFill').style.width=pct+'%');
  $('#usageText') && ($('#usageText').textContent = (g=>g>=1?g.toFixed(1)+'GB':Math.round(used/1024/1024)+'MB')(used/GB) + ' / ' + (cap/GB).toFixed(1)+'GB');
}
function renderBreadcrumb(){
  // 브레드크럼 제거됨
}
function renderDirectory(){
  // '내 파일' 폴더 확인 및 추가 (항상 보장)
  if (!__FS__.children) {
    __FS__.children = [];
  }
  const myFilesFolder = __FS__.children.find(c => c.name === '내 파일');
  if (!myFilesFolder) {
    __FS__.children.push({ name:'내 파일', type:'folder', children:[] });
    __OPEN__.add('내 파일');
  }

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

// 전역으로 노출
window.renderDirectory = renderDirectory;

/* ---- Selection & dblclick (delegated) ---- */
function updateSelectionCounter(){ const c=$('#selectionCounter'); if(c) c.textContent = '선택 ' + __SEL__.size + '개'; }
document.addEventListener('mousedown', e=>{
  const tile = e.target.closest?.('.small-tile');
  // 화살표 클릭 시 무시
  if(!tile || e.target.classList.contains('chev')) return;
  const pathKey = tile.dataset.path, multi = e.ctrlKey||e.metaKey; if(!pathKey) return;
  if(multi){ tile.classList.toggle('selected'); tile.classList.contains('selected')?__SEL__.add(pathKey):__SEL__.delete(pathKey); }
  else{ if(!tile.classList.contains('selected')){ A('#fileGridBody .small-tile.selected').forEach(t=>t.classList.remove('selected')); __SEL__.clear(); tile.classList.add('selected'); __SEL__.add(pathKey); } }
  updateSelectionCounter();
}, true);
document.addEventListener('dblclick', e=>{
  const tile = e.target.closest?.('.small-tile'); if(!tile) return;
  // 폴더 더블클릭 기능 제거 (아코디언 방식만 사용)
  if(tile.dataset.type==='file'){
    const name=tile.querySelector('.name')?.textContent || '';
    const pathKey = tile.dataset.path;
    const node = getNodeByPathKey(pathKey);
    if(node && node.dataSource) {
      createTab(node.dataSource, name);
    } else if(node && node.fileId) {
      // DB 파일인 경우 - 파일명도 함께 전달
      if(window.viewFileProblems) {
        window.viewFileProblems(node.fileId, node.name);
      }
    } else {
      console.log('파일 열기:', name);
    }
  }
});

// 모바일/단일 클릭에서도 파일 열기 지원
document.addEventListener('click', e=>{
  const tile = e.target.closest?.('.small-tile'); if(!tile) return;
  if(tile.dataset.type!=='file') return;
  // 선택 처리 후에도 단일 클릭에서 열기 지원 (모바일 편의)
  const name=tile.querySelector('.name')?.textContent || '';
  const pathKey = tile.dataset.path;
  const node = getNodeByPathKey(pathKey);
  if(node && node.dataSource) {
    createTab(node.dataSource, name);
  } else if(node && node.fileId) {
    if(window.viewFileProblems) {
      window.viewFileProblems(node.fileId, node.name);
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
async function moveEntries(pathKeys, targetFolder){
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

  // 새로운 parentPath 계산
  const newParentPath = pathOf(targetFolder);

  for(const node of safe){
    const parent=node.__parent;
    parent.children = (parent.children||[]).filter(x=>x!==node);
    let base=node.name.replace(/\(\d+\)$/,''); let name=base, i=1;
    while((targetFolder.children||[]).some(ch=>ch.name===name)) name = `${base}(${i++})`;
    node.name=name;
    (targetFolder.children=targetFolder.children||[]).push(node);
    node.__parent=targetFolder;
    __SEL__.delete(pathOf(node)); __SEL__.add(pathOf(node));

    // DB에 저장된 파일/폴더인 경우 서버에 이동 요청
    if (node.fileId || node.folderId) {
      try {
        const itemId = node.fileId || node.folderId;
        const itemType = node.type; // 'file' or 'folder'
        const response = await fetch('/api/move-item', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: itemId,
            itemType: itemType,
            newParentPath: newParentPath
          })
        });
        const result = await response.json();
        if (!result.success) {
          console.error('항목 이동 실패:', result.message);
        } else {
          console.log('✅ 항목 이동 완료:', node.name);
        }
      } catch (error) {
        console.error('항목 이동 요청 오류:', error);
      }
    }
  }
  renderDirectory();
}

/* ---- Toolbar & Upload ---- */
function bindToolbar(){
  const $id = id=>document.getElementById(id);
  $id('renameBtn')?.addEventListener('click', async ()=>{
    if(__SEL__.size!==1) return alert('이름 변경은 1개만 가능합니다.');
    const key=setToArr(__SEL__)[0], node=getNodeByPathKey(key), parent=node.__parent;
    const nv=prompt('새 이름', node.name); if(!nv || nv===node.name) return;
    if((parent.children||[]).some(ch=>ch!==node && ch.name===nv)) return alert('동일 이름이 이미 있습니다.');

    // DB 파일인 경우 서버에 이름 변경 요청
    if (node.type === 'file' && node.fileId) {
      try {
        const response = await fetch(`/api/rename-file/${node.fileId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: nv })
        });
        const result = await response.json();

        if (!result.success) {
          alert(`파일 이름 변경 실패: ${result.message}`);
          return;
        }

        console.log(`✅ DB 파일 이름 변경 완료: ${node.name} → ${nv}`);
      } catch (error) {
        console.error('파일 이름 변경 오류:', error);
        alert(`파일 이름 변경 중 오류 발생: ${error.message}`);
        return;
      }
    }

    // DB 폴더인 경우 서버에 이름 변경 요청
    if (node.type === 'folder' && node.folderId) {
      try {
        const response = await fetch(`/api/rename-folder/${node.folderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: nv })
        });
        const result = await response.json();

        if (!result.success) {
          alert(`폴더 이름 변경 실패: ${result.message}`);
          return;
        }

        console.log(`✅ DB 폴더 이름 변경 완료: ${node.name} → ${nv}`);
      } catch (error) {
        console.error('폴더 이름 변경 오류:', error);
        alert(`폴더 이름 변경 중 오류 발생: ${error.message}`);
        return;
      }
    }

    // 로컬 파일 시스템에서도 이름 변경
    node.name=nv; __SEL__.clear(); __SEL__.add(pathOf(node)); renderDirectory();
  });
  $id('deleteBtn')?.addEventListener('click', async ()=>{
    if(!__SEL__.size) return alert('삭제할 항목을 선택하세요.');
    if(!confirm(`선택한 ${__SEL__.size}개 항목을 삭제할까요?`)) return;

    const keysToDelete = setToArr(__SEL__);

    for (const k of keysToDelete) {
      const node=getNodeByPathKey(k);
      if(!node||!node.__parent) continue;

      // DB 파일인 경우 서버에 삭제 요청
      if (node.type === 'file' && node.fileId) {
        try {
          const response = await fetch(`/api/delete-file/${node.fileId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
          });
          const result = await response.json();

          if (!result.success) {
            alert(`파일 삭제 실패: ${result.message}`);
            continue;
          }

          console.log(`✅ DB 파일 삭제 완료: ${node.name} (${result.deletedProblems}개 문제 삭제)`);
        } catch (error) {
          console.error('파일 삭제 오류:', error);
          alert(`파일 삭제 중 오류 발생: ${error.message}`);
          continue;
        }
      }

      // DB 폴더인 경우 서버에 삭제 요청
      if (node.type === 'folder' && node.folderId) {
        try {
          const response = await fetch(`/api/delete-folder/${node.folderId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
          });
          const result = await response.json();

          if (!result.success) {
            alert(`폴더 삭제 실패: ${result.message}`);
            continue;
          }

          console.log(`✅ DB 폴더 삭제 완료: ${node.name}`);
        } catch (error) {
          console.error('폴더 삭제 오류:', error);
          alert(`폴더 삭제 중 오류 발생: ${error.message}`);
          continue;
        }
      }

      // 로컬 파일 시스템에서 제거
      __USAGE__.used = Math.max(0, __USAGE__.used - (node.type==='file' ? (node.size||5*1024*1024) : sumFolderSize(node)));
      node.__parent.children=node.__parent.children.filter(x=>x!==node);
      __SEL__.delete(k);
    }

    renderDirectory();
  });
  $id('newFolderBtn')?.addEventListener('click', async ()=>{
    const myFilesFolder = getNodeByPathKey('내 파일');
    const folder = myFilesFolder || currentFolder();
    let base='새 폴더', name=base, i=1;
    while((folder.children||[]).some(ch=>ch.name===name)) name=`${base} (${i++})`;

    const parentPath = pathOf(folder);

    // DB에 폴더 생성 요청
    try {
      const response = await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: name, parentPath: parentPath })
      });
      const result = await response.json();

      if (!result.success) {
        alert(`폴더 생성 실패: ${result.message}`);
        return;
      }

      // 로컬 파일 시스템에 추가
      (folder.children=folder.children||[]).push({
        name,
        type:'folder',
        folderId: result.folder._id,
        children:[]
      });

      console.log(`✅ DB 폴더 생성 완료: ${name}`);
    } catch (error) {
      console.error('폴더 생성 오류:', error);
      alert(`폴더 생성 중 오류 발생: ${error.message}`);
      return;
    }

    // '내 파일' 폴더가 닫혀있으면 열기
    if(myFilesFolder && !__OPEN__.has('내 파일')) {
      __OPEN__.add('내 파일');
    }
    renderDirectory();
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

    // 실제 서버 업로드 처리
    uploadToServer(pdfs[0]);
  }
}

async function uploadToServer(file) {
  const pc = $('#progressContainer');
  const pf = $('#progressFill');
  const pt = $('#progressText');
  let eventSource = null;

  try {
    if(pc) pc.style.display = 'block';

    // 세션 ID 생성
    const sessionId = Date.now().toString();

    // SSE 연결 설정
    console.log(`🔗 클라이언트 SSE 연결 시작 - 세션 ID: ${sessionId}`);
    eventSource = new EventSource(`/api/progress/${sessionId}`);

    eventSource.onopen = function(event) {
      console.log(`✅ 클라이언트 SSE 연결 성공 - 세션 ID: ${sessionId}`);
    };

    eventSource.onmessage = function(event) {
      console.log(`📨 클라이언트 SSE 메시지 수신:`, event.data);
      try {
        const data = JSON.parse(event.data);
        console.log(`📊 파싱된 데이터:`, data);
        
        if(pt) {
          pt.textContent = data.message;
          console.log(`📝 진행상황 텍스트 업데이트: "${data.message}"`);
        }
        
        if(pf && data.progress !== undefined) {
          pf.style.width = data.progress + '%';
          console.log(`📊 진행률 바 업데이트: ${data.progress}%`);
        }
      } catch (error) {
        console.error(`❌ SSE 메시지 파싱 오류:`, error, `원본 데이터:`, event.data);
      }
    };

    eventSource.onerror = function(event) {
      console.error(`❌ 클라이언트 SSE 연결 오류 - 세션 ID: ${sessionId}:`, event);
    };

    // FormData로 파일 업로드
    const formData = new FormData();
    formData.append('pdf', file);

    const response = await fetch('/upload', {
      method: 'POST',
      headers: {
        'X-Session-Id': sessionId
      },
      body: formData
    });

    // SSE 연결 종료
    console.log(`🔌 클라이언트 SSE 연결 종료 - 세션 ID: ${sessionId}`);
    eventSource.close();

    if (!response.ok) {
      throw new Error(`업로드 실패: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // 최종 상태는 SSE에서 이미 업데이트됨

      // 1. problems 데이터를 PROBLEMS_DATA에 저장 (dataSource 키 사용)
      const dataSource = `db_file_${result.fileId}`;
      window.PROBLEMS_DATA = window.PROBLEMS_DATA || {};
      window.PROBLEMS_DATA[dataSource] = result.problems || [];

      // 2. 파일 목록 새로고침
      if (window.loadMyFiles) {
        await window.loadMyFiles();
      }

      // 3. 자동으로 새 탭 열기 (파일명 사용)
      if (window.createTab && result.problems) {
        setTimeout(() => {
          createTab(dataSource, result.filename || file.name);
        }, 300);
      }

      alert(`파일 처리 완료!\n${result.problemCount || 0}개의 문제가 추출되었습니다.`);

    } else {
      throw new Error(result.error || '알 수 없는 오류');
    }

  } catch (error) {
    console.error('업로드 오류:', error);
    if(pt) pt.textContent = '업로드 실패';
    if(pf) pf.style.width = '0%';

    // SSE 연결이 있다면 종료
    if (eventSource) {
      console.log(`🔌 클라이언트 SSE 연결 종료 (오류 시) - 세션 ID: ${sessionId}`);
      eventSource.close();
    }

    alert(`업로드 오류: ${error.message}`);
  } finally {
    setTimeout(() => {
      if(pc) pc.style.display = 'none';
    }, 1500);
  }
}

/* ---- Problem Data ---- */
let PROBLEMS_DATA = {};
window.PROBLEMS_DATA = PROBLEMS_DATA;
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

// 전역으로 노출
window.createTab = createTab;

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

// 전역으로 노출 및 전체 탭 정리 유틸
window.closeTab = closeTab;
function clearAllTabs(){
  openTabs = [];
  activeTabId = null;
  renderTabs();
  clearProblems();
}
window.clearAllTabs = clearAllTabs;

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
      if (window.__TABS_DRAGGING__) return; // 드래그 중 클릭 방지
      switchToTab(tab.id);
    });
    
    tabsContainer.appendChild(tabElement);
  });
  // 스와이프(드래그 스크롤) 활성화 - 한 번만 바인딩
  enableTabsDragScroll(tabsContainer);
  ensureTabsDragBar(tabsContainer);
}

// 수평 드래그 스크롤 헬퍼 (모바일/데스크톱 공용)
function enableTabsDragScroll(el){
  if (!el || el.dataset.swipeBound) return;
  el.dataset.swipeBound = '1';
  try { el.style.touchAction = 'pan-x'; } catch(_) {}

  let isDown = false; let startX = 0; let startLeft = 0; let moved = false;

  const onDown = (clientX)=>{ isDown = true; moved = false; startX = clientX; startLeft = el.scrollLeft; };
  const onMove = (clientX, ev)=>{ if(!isDown) return; const dx = startX - clientX; if (Math.abs(dx) > 2) { moved = true; window.__TABS_DRAGGING__ = true; } el.scrollLeft = startLeft + dx; if (ev && ev.cancelable) ev.preventDefault(); };
  const onUp = ()=>{ isDown = false; setTimeout(()=>{ window.__TABS_DRAGGING__ = false; }, 40); };

  // Touch
  el.addEventListener('touchstart', (e)=> onDown((e.touches[0]||e.changedTouches[0]).clientX), {passive:true});
  el.addEventListener('touchmove', (e)=> onMove((e.touches[0]||e.changedTouches[0]).clientX, e), {passive:false});
  el.addEventListener('touchend', onUp, {passive:true});
  el.addEventListener('touchcancel', onUp, {passive:true});

  // Mouse (데스크톱 지원)
  el.addEventListener('mousedown', (e)=> onDown(e.clientX));
  window.addEventListener('mousemove', (e)=>{ if(!isDown) return; onMove(e.clientX, e); });
  window.addEventListener('mouseup', onUp);
}

// 가로 드래그 바(thumb)로 탭 스크롤 제어
function ensureTabsDragBar(tabsEl){
  const parent = tabsEl.parentElement; if(!parent) return;
  let bar = parent.querySelector('.tabs-dragbar');
  if(!bar){
    bar = document.createElement('div'); bar.className='tabs-dragbar';
    const thumb = document.createElement('div'); thumb.className='thumb'; bar.appendChild(thumb);
    parent.appendChild(bar);
  }
  const thumb = bar.querySelector('.thumb');

  function refresh(){
    const trackW = bar.clientWidth || 1;
    const viewW = tabsEl.clientWidth || 1;
    const totalW = tabsEl.scrollWidth || 1;
    const maxScroll = Math.max(0, totalW - viewW);
    const minThumb = 24;
    const thumbW = Math.max(minThumb, Math.round((viewW/totalW)*trackW));
    const maxLeft = Math.max(0, trackW - thumbW);
    const left = maxScroll>0 ? Math.round((tabsEl.scrollLeft/maxScroll)*maxLeft) : 0;
    thumb.style.width = thumbW+'px';
    thumb.style.left = left+'px';
  }

  let dragging=false, startX=0, startLeft=0;
  function onDown(clientX){ dragging=true; startX=clientX; startLeft=parseInt(thumb.style.left||'0',10)||0; }
  function onMove(clientX, ev){ if(!dragging) return; const trackW = bar.clientWidth||1; const thumbW = thumb.clientWidth||24; const maxLeft = Math.max(0, trackW-thumbW); let newLeft = Math.min(maxLeft, Math.max(0, startLeft + (clientX-startX))); const viewW=tabsEl.clientWidth||1; const totalW=tabsEl.scrollWidth||1; const maxScroll=Math.max(0,totalW-viewW); const scrollLeft = maxLeft>0 ? (newLeft/maxLeft)*maxScroll : 0; tabsEl.scrollLeft = scrollLeft; thumb.style.left=newLeft+'px'; if(ev&&ev.cancelable) ev.preventDefault(); }
  function onUp(){ dragging=false; }

  // Thumb drag events
  thumb.addEventListener('mousedown',(e)=>onDown(e.clientX));
  window.addEventListener('mousemove',(e)=>onMove(e.clientX,e));
  window.addEventListener('mouseup',onUp);
  thumb.addEventListener('touchstart',(e)=>onDown((e.touches[0]||e.changedTouches[0]).clientX),{passive:true});
  thumb.addEventListener('touchmove',(e)=>onMove((e.touches[0]||e.changedTouches[0]).clientX,e),{passive:false});
  thumb.addEventListener('touchend',onUp,{passive:true});
  thumb.addEventListener('touchcancel',onUp,{passive:true});

  // Sync thumb when tabs scroll/resize
  tabsEl.addEventListener('scroll', refresh, {passive:true});
  window.addEventListener('resize', refresh);
  setTimeout(refresh,0);
}

function clearProblems() {
  const column1 = document.getElementById('column1');
  const column2 = document.getElementById('column2');
  if (column1) column1.innerHTML = '';
  if (column2) column2.innerHTML = '';
  // 프리뷰 영역 비어있음 표시
  showPreviewPlaceholder();
}

function getCurrentFileSelectedProblems() {
  if (!activeTabId) return new Set();
  if (!selectedProblemsByFile.has(activeTabId)) {
    selectedProblemsByFile.set(activeTabId, new Set());
  }
  return selectedProblemsByFile.get(activeTabId);
}

// 전역으로 노출
window.getCurrentFileSelectedProblems = getCurrentFileSelectedProblems;

function toggleProblemSelection(problem_id) {
  const currentFileSelected = getCurrentFileSelectedProblems();

  // 파일별 고유 ID 생성 (파일명:MongoDB_id)
  const uniqueProblemId = `${activeTabId}:${problem_id}`;

  if (currentFileSelected.has(problem_id)) {
    // 선택 해제
    currentFileSelected.delete(problem_id);
    removeProblemFromExam(uniqueProblemId);
  } else {
    // 선택 추가
    currentFileSelected.add(problem_id);

    // 현재 활성 탭의 문제 데이터에서 해당 문항 찾기
    if (activeTabId && PROBLEMS_DATA[activeTabId]) {
      const problemData = PROBLEMS_DATA[activeTabId].find(p => p._id === problem_id);
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
    const cbtn = document.getElementById('centerSignupBtn');
    if (cbtn) { cbtn.style.left = '50%'; cbtn.style.top = (mainRect.height/2) + 'px'; }
    return;
  }
  
  const leftColumnRect = leftColumn.getBoundingClientRect();
  
  // 핸들을 왼쪽 컬럼의 오른쪽 경계에 위치
  const handleLeft = leftColumnRect.right - mainRect.left - 3; // 3px는 핸들 너비의 절반
  resizeHandle.style.left = handleLeft + 'px';
  const cbtn = document.getElementById('centerSignupBtn');
  if (cbtn) { cbtn.style.left = handleLeft + 'px'; cbtn.style.top = (mainRect.height/2) + 'px'; }
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
  
  console.log('🔍 문제 추가 중:', uniqueProblemId, problemData);
  console.log('🔍 problemData._id:', problemData?._id);
  
  const examProblem = {
    id: examProblemCounter++,
    uniqueId: uniqueProblemId,
    data: problemData,
    addedAt: new Date()
  };
  
  examProblems.push(examProblem);
  console.log('🔍 examProblems 업데이트됨:', examProblems);
  renderExamProblems();
  updateExamStats();
}

// 전역에서 사용할 수 있도록 노출 (게스트 초기 세팅 등)
window.addProblemToExam = addProblemToExam;

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
    // DOM 업데이트 후 MathJax 렌더링
    setTimeout(() => {
      window.MathJax.typesetPromise().catch(err => console.error('MathJax 렌더링 오류:', err));
    }, 100);
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
        // LaTeX가 포함된 텍스트는 그대로 innerHTML로 설정
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
      } else if(block.type === 'table') {
        // 마크다운 표 형태의 문자열
        const tableDiv = document.createElement('div');
        tableDiv.className = 'table-block';
        tableDiv.innerHTML = renderMarkdownTable(block.content);
        pbody.appendChild(tableDiv);
      } else if(block.type === 'examples') {
        const examplesDiv = document.createElement('div');
        examplesDiv.className = 'examples-block';
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
      } else if(block.type === 'condition') {
        const conditionDiv = document.createElement('div');
        conditionDiv.className = 'condition-block';
        if(Array.isArray(block.content)) {
          block.content.forEach(cond => {
            const condDiv = document.createElement('div');
            condDiv.innerHTML = formatConditionText(cond);
            conditionDiv.appendChild(condDiv);
          });
        } else {
          conditionDiv.innerHTML = formatConditionText(block.content);
        }
        pbody.appendChild(conditionDiv);
      }
    });
  }
  
  // options 처리 (비어있지 않은 경우에만)
  if(examProblem.data.options && Array.isArray(examProblem.data.options) && examProblem.data.options.length > 0) {
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
  hidePreviewPlaceholder();
  displayProblems(problems);
}

function displayProblems(problems) {
  const column1 = document.getElementById('column1');
  const column2 = document.getElementById('column2');
  
  if(!column1 || !column2) {
    console.error('컬럼 요소를 찾을 수 없습니다');
    return;
  }
  
  hidePreviewPlaceholder();
  // 기존 문제들 제거
  column1.innerHTML = '';
  column2.innerHTML = '';
  
  // 현재 파일의 선택 상태를 한 번만 가져오기
  const currentFileSelected = getCurrentFileSelectedProblems();
  
  // 문제들을 2열로 분배
  problems.forEach((problem, index) => {
    const problemElement = createProblemElement(problem);

    // 현재 파일의 선택 상태 복원 (_id 사용)
    if (currentFileSelected.has(problem._id)) {
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
    // DOM 업데이트 후 MathJax 렌더링
    setTimeout(() => {
      window.MathJax.typesetPromise().catch(err => console.error('MathJax 렌더링 오류:', err));
    }, 100);
  }
}

// 전역으로 노출
window.displayProblems = displayProblems;

function createProblemElement(problem) {
  const div = document.createElement('div');
  div.className = 'problem';
  div.dataset.problem = problem._id; // MongoDB _id 사용 (고유 식별자)

  // 클릭 이벤트 추가
  div.addEventListener('click', () => {
    toggleProblemSelection(problem._id); // _id 전달
    div.classList.toggle('selected');
  });

  // 문제 번호 (표시용으로는 problem.id 사용)
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
        // LaTeX가 포함된 텍스트는 그대로 innerHTML로 설정
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
      } else if(block.type === 'table') {
        // 마크다운 표 형태의 문자열
        const tableDiv = document.createElement('div');
        tableDiv.className = 'table-block';
        tableDiv.innerHTML = renderMarkdownTable(block.content);
        pbody.appendChild(tableDiv);
      } else if(block.type === 'examples') {
        const examplesDiv = document.createElement('div');
        examplesDiv.className = 'examples-block';
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
      } else if(block.type === 'condition') {
        const conditionDiv = document.createElement('div');
        conditionDiv.className = 'condition-block';
        if(Array.isArray(block.content)) {
          block.content.forEach(cond => {
            const condDiv = document.createElement('div');
            condDiv.innerHTML = formatConditionText(cond);
            conditionDiv.appendChild(condDiv);
          });
        } else {
          conditionDiv.innerHTML = formatConditionText(block.content);
        }
        pbody.appendChild(conditionDiv);
      }
    });
  }

  // 선택지 추가 (비어있지 않은 경우에만)
  if(problem.options && Array.isArray(problem.options) && problem.options.length > 0) {
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

// 전역으로 노출
window.createProblemElement = createProblemElement;

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

  // 모바일 탭 설정
  setupMobileTabs();
  
  // 버튼 이벤트를 즉시 연결 (지연 없음)
  const generateBtn = document.getElementById('generatePdfBtn');
  const clearBtn = document.getElementById('clearExam');
  const settingsBtn = document.getElementById('settingsBtn');

  if (generateBtn) generateBtn.addEventListener('click', generatePdf);
  if (clearBtn) clearBtn.addEventListener('click', clearExam);
  if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);

  // DOM이 완전히 로드된 후 핸들 위치 재설정
  setTimeout(() => {
    updateResizeHandlePosition();
  }, 100);

  // 초기 프리뷰 비어있음 표시
  showPreviewPlaceholder();
}

/* ---- Mobile Tabs ---- */
function setupMobileTabs(){
  const tabsBar = document.getElementById('mobileTabs');
  if (!tabsBar) return;

  const explorer = document.querySelector('.explorer');
  const preview = document.querySelector('.preview-wrap');
  const exam = document.querySelector('.exam-preview');

  function apply(tab){
    if (window.innerWidth > 768){
      // 데스크톱: 모두 표시
      explorer?.classList.remove('mobile-hide');
      preview?.classList.remove('mobile-hide');
      exam?.classList.remove('mobile-hide');
      tabsBar.style.display = 'none';
      if (!activeTabId) showPreviewPlaceholder(); else hidePreviewPlaceholder();
      return;
    }
    tabsBar.style.display = 'flex';
    explorer?.classList.add('mobile-hide');
    preview?.classList.add('mobile-hide');
    exam?.classList.add('mobile-hide');
    if (tab==='explorer') explorer?.classList.remove('mobile-hide');
    if (tab==='preview') preview?.classList.remove('mobile-hide');
    if (tab==='exam') exam?.classList.remove('mobile-hide');
    if (tab==='preview' && !activeTabId) { showPreviewPlaceholder(); } else { hidePreviewPlaceholder(); }
    // 버튼 active
    A('#mobileTabs .tab-btn').forEach(b=>b.classList.remove('active'));
    const btn = tabsBar.querySelector(`.tab-btn[data-target="${tab}"]`);
    btn && btn.classList.add('active');
  }

  // 외부에서 사용 가능
  window.switchMobileTab = apply;

  // 초기 탭은 explorer
  apply('explorer');

  A('#mobileTabs .tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      apply(btn.dataset.target);
      // 미리보기나 시험지 전환 시 핸들 위치 갱신
      setTimeout(updateResizeHandlePosition, 50);
    });
  });

  // 리사이즈 시 모드 전환 반영
  window.addEventListener('resize', ()=>{
    const active = tabsBar.querySelector('.tab-btn.active')?.dataset.target || 'explorer';
    apply(active);
  });
}

/* ---- PDF 생성 (LaTeX 기반) ---- */
async function generatePdf() {
  if (examProblems.length === 0) {
    alert('시험지에 문항이 없습니다. 먼저 문항을 선택해주세요.');
    return;
  }

  // 즉시 모달 표시
  showProgressOverlay();
  updateModalProgress(0, '준비 중...', 'PDF 생성을 준비하고 있습니다...');

  try {
    // UI 업데이트 보장
    await sleep(10);

    updateModalProgress(10, '문제 데이터 준비 중...', '선택된 문제들을 서버로 전송합니다...');
    await sleep(100);

    // 문제 데이터 준비
    console.log('🔍 examProblems 배열:', examProblems);
    console.log('🔍 examProblems 길이:', examProblems.length);
    
    const examData = {
      problems: examProblems.map(problem => {
        console.log('🔍 개별 문제 데이터:', problem);
        console.log('🔍 problem.data:', problem.data);
        console.log('🔍 problem.data._id:', problem.data?._id);
        
        // _id가 없으면 경고 메시지 출력
        if (!problem.data?._id) {
          console.warn('⚠️ 문제에 _id가 없습니다:', problem);
          console.warn('⚠️ problem.data 구조:', JSON.stringify(problem.data, null, 2));
        }
        
        return {
          _id: problem.data?._id
        };
      }).filter(problem => problem._id), // _id가 있는 문제만 필터링
      settings: {
        answerType: pdfSettings.answerType,
        // 신규 개별 메타 플래그 전달 (레거시도 서버에서 병합됨)
        showMetaFile: !!pdfSettings.showMetaFile,
        showMetaPage: !!pdfSettings.showMetaPage,
        showMetaId: !!pdfSettings.showMetaId,
        showProblemMeta: !!pdfSettings.showProblemMeta // backward compat
      }
    };
    
    console.log('🔍 최종 examData:', examData);
    console.log('🔍 필터링된 문제 수:', examData.problems.length);

    updateModalProgress(25, '서버로 전송 중...', 'PDF 생성 요청을 서버로 전송합니다...');
    await sleep(200);

    // PDF 생성 API 호출
    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(examData)
    });

    updateModalProgress(50, 'PDF 생성 중...', 'LaTeX로 PDF를 생성하고 있습니다...');
    await sleep(500);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `서버 오류: ${response.status}`);
    }

    updateModalProgress(80, '결과 수신 중...', 'PDF 파일을 다운로드하고 있습니다...');
    await sleep(200);

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'PDF 생성에 실패했습니다');
    }

    updateModalProgress(95, '파일 저장 중...', 'PDF 파일을 브라우저에 저장 중...');
    await sleep(300);

    // Base64 데이터를 Blob으로 변환하여 다운로드
    const pdfData = result.pdfData;
    const binaryString = atob(pdfData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });

    // 다운로드 링크 생성
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // 파일명 생성
    const now = new Date();
    const fileName = `수학시험지_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.pdf`;

    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateModalProgress(100, '완료!', `${fileName} 다운로드가 완료되었습니다.`);
    await sleep(1500);

  } catch (error) {
    console.error('PDF 생성 중 오류:', error);
    updateModalProgress(0, '오류 발생', error.message || 'PDF 생성 중 문제가 발생했습니다.');
    await sleep(2000);
    alert('PDF 생성 중 오류가 발생했습니다: ' + error.message);
  } finally {
    hideProgressOverlay();
  }
}

/* ---- 모달 진행사항 관리 함수들 ---- */
function showProgressOverlay() {
  const overlay = document.getElementById('pdfOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    // 애니메이션을 위한 지연
    setTimeout(() => overlay.classList.add('show'), 10);
  }
}

function hideProgressOverlay() {
  const overlay = document.getElementById('pdfOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => overlay.style.display = 'none', 300);
  }
}

function updateModalProgress(percentage, title, details = '') {
  const progressFill = document.getElementById('progressFillModal');
  const progressPercentage = document.getElementById('progressPercentage');
  const progressTitle = document.getElementById('progressTitle');
  const progressText = document.getElementById('progressTextModal');
  const progressDetails = document.getElementById('progressDetails');

  if (progressFill) progressFill.style.width = `${percentage}%`;
  if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
  if (progressTitle) progressTitle.textContent = title;
  if (progressText) progressText.textContent = title;
  if (progressDetails) progressDetails.textContent = details;
}

// 기존 호환성 함수들 (작은 진행바용)
function updateProgress(percentage, message) {
  const progressFill = document.getElementById('progressFill');
  if (progressFill) progressFill.style.width = `${percentage}%`;

  const progressText = document.getElementById('progressText');
  if (progressText) progressText.textContent = `${percentage}% ${message}`;
}

function resetProgress() {
  const progressFill = document.getElementById('progressFill');
  if (progressFill) progressFill.style.width = '0%';

  const progressText = document.getElementById('progressText');
  if (progressText) progressText.textContent = '잠시만 기다려주세요...';
}

// 지연 함수
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---- 이미지 다운로드 기능 (모달 + 병렬 처리 버전) ---- */
async function downloadImages() {
  if (examProblems.length === 0) {
    alert('시험지에 문항이 없습니다. 먼저 문항을 선택해주세요.');
    return;
  }

  // 즉시 모달 표시
  showProgressOverlay();
  updateModalProgress(0, '이미지 다운로드 준비 중...', '시험지 페이지를 분석하고 있습니다...');

  try {
    // UI 업데이트 보장
    await sleep(10);

    const examPages = document.querySelectorAll('.exam-page');

    if (examPages.length === 0) {
      throw new Error('시험지 페이지를 찾을 수 없습니다.');
    }

    updateModalProgress(5, '페이지 분석 완료', `총 ${examPages.length}개 페이지를 이미지로 변환합니다`);
    await sleep(100);

    updateModalProgress(10, '이미지 생성 중...', '모든 페이지를 고화질로 변환하고 있습니다...');

    // 병렬 처리로 모든 페이지를 이미지로 변환
    const downloadPromises = Array.from(examPages).map(async (page, i) => {
      const canvas = await html2canvas(page, {
        scale: 2, // 고화질 유지
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: false,
        logging: false,
        removeContainer: false,
        foreignObjectRendering: false,
        imageTimeout: 500,
        onclone: (clonedDoc) => {
          const clonedPage = clonedDoc.querySelector('.exam-page');
          if (clonedPage) {
            clonedPage.style.boxShadow = 'none';
            clonedPage.style.transform = 'none';
          }
        }
      });

      // 고품질 PNG로 변환
      const dataUrl = canvas.toDataURL('image/png', 1.0);

      // 다운로드 링크 생성 및 실행
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 10);
      link.download = `시험지_${timestamp}_페이지_${i + 1}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 개별 페이지 완료 시 진행률 업데이트
      const progress = 10 + Math.round(((i + 1) / examPages.length) * 85);
      updateModalProgress(progress, '이미지 생성 중...', `페이지 ${i + 1}/${examPages.length} 다운로드 완료`);

      return `페이지 ${i + 1}`;
    });

    // 모든 다운로드 완료 대기
    await Promise.all(downloadPromises);

    updateModalProgress(100, '다운로드 완료!', `${examPages.length}개 이미지 파일이 다운로드되었습니다.`);
    await sleep(1000);

  } catch (error) {
    console.error('이미지 다운로드 중 오류:', error);
    updateModalProgress(0, '오류 발생', error.message || '이미지 다운로드 중 문제가 발생했습니다.');
    await sleep(2000);
    alert('이미지 다운로드 중 오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    hideProgressOverlay();
  }
}

// ====== PDF 설정 모달 ======
let pdfSettings = {
  template: 'exam1',
  answerType: 'none',
  // 신규: 개별 메타 표시 플래그
  showMetaFile: false,
  showMetaPage: false,
  showMetaId: false,
  // 레거시 호환: 전체 표시
  showProblemMeta: false
};

function openSettingsModal() {
  const overlay = document.getElementById('settingsModalOverlay');
  if (!overlay) return;
  
  // 현재 설정값으로 UI 초기화
  document.querySelectorAll('.template-card').forEach(card => {
    if (card.dataset.template === pdfSettings.template) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
  
  // 정답/해설 옵션 초기화
  document.querySelectorAll('.answer-option').forEach(option => {
    if (option.dataset.answerType === pdfSettings.answerType) {
      option.classList.add('selected');
    } else {
      option.classList.remove('selected');
    }
  });

  // 문항 정보 표기 체크박스 초기화 (개별)
  const cbFile = document.getElementById('metaFileCheckbox');
  const cbPage = document.getElementById('metaPageCheckbox');
  const cbId = document.getElementById('metaIdCheckbox');
  if (cbFile) cbFile.checked = !!pdfSettings.showMetaFile;
  if (cbPage) cbPage.checked = !!pdfSettings.showMetaPage;
  if (cbId) cbId.checked = !!pdfSettings.showMetaId;
  
  overlay.style.display = 'flex';
  
  // 닫기 이벤트 등록 (중복 방지)
  const closeBtn = document.getElementById('closeSettingsBtn');
  const cancelBtn = document.getElementById('cancelSettingsBtn');
  const applyBtn = document.getElementById('applySettingsBtn');
  
  if (closeBtn) {
    closeBtn.onclick = closeSettingsModal;
  }
  
  if (cancelBtn) {
    cancelBtn.onclick = closeSettingsModal;
  }
  
  if (applyBtn) {
    applyBtn.onclick = applySettings;
  }
  
  // 오버레이 클릭 시 닫기
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeSettingsModal();
    }
  };
  
  // 템플릿 카드 클릭 이벤트
  document.querySelectorAll('.template-card').forEach(card => {
    card.onclick = () => {
      // disabled 카드는 선택 불가
      if (card.classList.contains('disabled')) {
        return;
      }
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    };
  });
  
  // 정답/해설 옵션 클릭 이벤트 (단일 선택)
  document.querySelectorAll('.answer-option').forEach(option => {
    option.onclick = () => {
      document.querySelectorAll('.answer-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
    };
  });
}

function closeSettingsModal() {
  const overlay = document.getElementById('settingsModalOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

function applySettings() {
  // 선택된 템플릿 저장
  const selectedTemplate = document.querySelector('.template-card.selected:not(.disabled)');
  if (selectedTemplate) {
    pdfSettings.template = selectedTemplate.dataset.template;
  }
  
  // 선택된 정답/해설 옵션 저장
  const selectedAnswer = document.querySelector('.answer-option.selected');
  if (selectedAnswer) {
    pdfSettings.answerType = selectedAnswer.dataset.answerType;
  }

  // 문항 정보 표기 저장 (개별)
  const cbFile = document.getElementById('metaFileCheckbox');
  const cbPage = document.getElementById('metaPageCheckbox');
  const cbId = document.getElementById('metaIdCheckbox');
  pdfSettings.showMetaFile = !!(cbFile && cbFile.checked);
  pdfSettings.showMetaPage = !!(cbPage && cbPage.checked);
  pdfSettings.showMetaId = !!(cbId && cbId.checked);
  
  console.log('✅ PDF 설정 적용:', pdfSettings);
  
  // 모달 닫기
  closeSettingsModal();
  
  // 설정 적용 피드백
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    const originalHTML = settingsBtn.innerHTML;
    settingsBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    settingsBtn.style.background = '#10b981';
    settingsBtn.style.color = 'white';
    settingsBtn.style.borderColor = '#10b981';
    
    setTimeout(() => {
      settingsBtn.innerHTML = originalHTML;
      settingsBtn.style.background = '';
      settingsBtn.style.color = '';
      settingsBtn.style.borderColor = '';
    }, 1000);
  }
}

// 설정값을 외부에서 가져올 수 있도록 export
window.getPdfSettings = () => pdfSettings;

document.addEventListener('DOMContentLoaded', initDashboard);

/* ---- Preview placeholder helpers ---- */
function showPreviewPlaceholder(){
  const cont = document.getElementById('problemsPreview');
  if (!cont) return;
  if (!cont.querySelector('.preview-empty-container')){
    const wrap = document.createElement('div');
    wrap.className = 'preview-empty-container';
    wrap.innerHTML = '<div class="preview-empty"><div class="empty-icon">📂</div><div class="empty-text">선택한 파일의 문제가 표시됩니다.</div></div>';
    cont.appendChild(wrap);
  }
  cont.classList.add('empty');
}
function hidePreviewPlaceholder(){
  const cont = document.getElementById('problemsPreview'); if(!cont) return;
  const wrap = cont.querySelector('.preview-empty-container'); if(wrap) wrap.remove();
  cont.classList.remove('empty');
}
