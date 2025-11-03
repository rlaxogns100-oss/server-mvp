/* ========= Preview/Exam Related JavaScript ========= */

// (기존) 부트 이후 MathJax 호출 부분 안전화
function safeTypeset(){ if(window.MathJax && window.MathJax.typesetPromise){ window.MathJax.typesetPromise(); } }

// 공통 유틸 함수 (dashboard.js와 중복되지만 독립성을 위해 유지)
// function toArr(x){ return Array.prototype.slice.call(x); } // dashboard.js와 중복으로 주석 처리

// 사용자 상태 관리
let currentUser = null;

/* ---- Boot ---- */
document.addEventListener('DOMContentLoaded', function(){
  console.log('DOM 로드 완료');
  if (!window.__DASH_INIT__) {
    console.log('대시보드 초기화');
    initDashboard();
  } // 중복 초기화 방지
  console.log('미리보기 바인딩');
  bindPreview();
  console.log('인증 바인딩');
  bindAuth();
  console.log('내 파일 바인딩');
  bindMyFiles();
  console.log('MathJax 타입셋');
  safeTypeset();
  // 비로그인 모드 UI 목업 렌더 (게스트 전용)
  setTimeout(()=>{ try{ renderNonLoginMockIfGuest(); }catch(_){ } }, 50);
  console.log('모든 초기화 완료');
});

/* ---- Preview/Exam 관련 기능 ---- */
function bindPreview(){
  console.log('bindPreview 시작');

  const selectAllProblems = document.getElementById('selectAllProblems');
  const createExamBtn = document.getElementById('createExamBtn');

  if (selectAllProblems) {
    console.log('selectAllProblems 요소 찾음');
    selectAllProblems.addEventListener('change', function(){
      var checked = document.getElementById('selectAllProblems').checked;
      // toArr(document.querySelectorAll('.problem-checkbox')).forEach(function(cb){ cb.checked = checked; });
      Array.from(document.querySelectorAll('.problem-checkbox')).forEach(function(cb){ cb.checked = checked; });
      setTimeout(safeTypeset, 100);
    });
  } else {
    console.log('selectAllProblems 요소를 찾을 수 없음');
  }

  if (createExamBtn) {
    console.log('createExamBtn 요소 찾음');
    createExamBtn.addEventListener('click', function(){
      // var n = toArr(document.querySelectorAll('.problem-checkbox:checked')).length;
      var n = Array.from(document.querySelectorAll('.problem-checkbox:checked')).length;
      if(!n) return alert('시험지를 제작하려면 최소 1개 이상의 문제를 선택해주세요.');
      updateBuildLog('시험지 제작 시작: ' + n + '개 문항');
      setTimeout(function(){ updateBuildLog('✅ 시험지 제작 완료 ('+n+'개 문항)'); alert('시험지가 제작되었습니다! ('+n+'개 문항)'); }, 1200);
    });
  } else {
    console.log('createExamBtn 요소를 찾을 수 없음');
  }

  console.log('bindPreview 완료');
}

function updateBuildLog(msg){ console.log(msg); }

/* ---- 내 파일 관련 기능 ---- */
function bindMyFiles() {
  console.log('bindMyFiles 시작');
  
  // 내 파일 로드 함수
  async function loadMyFiles() {
    try {
      const response = await fetch('/api/my-files');
      const result = await response.json();

      if (result.success) {
        displayMyFiles(result.files, result.folders);
      } else {
        console.error('파일 로드 실패:', result.message);
        // 로그인되지 않은 경우 빈 폴더 표시
        if (result.message === '로그인이 필요합니다.') {
          displayMyFiles([], []);
        }
      }
    } catch (error) {
      console.error('파일 로드 오류:', error);
      // 오류 발생 시에도 빈 폴더 표시
      displayMyFiles([], []);
    }
  }
  
  // 파일 및 폴더 목록 표시
  function displayMyFiles(files, folders) {
    // '내 파일' 폴더에 파일들과 폴더들을 추가
    if (window.__FS__ && window.__FS__.children) {
      let myFilesFolder = window.__FS__.children.find(c => c.name === '내 파일');
      if (!myFilesFolder) {
        myFilesFolder = { name: '내 파일', type: 'folder', children: [] };
        window.__FS__.children.push(myFilesFolder);
      }

      // 기존 파일들 제거
      myFilesFolder.children = [];

      // 경로별로 폴더와 파일을 그룹화하여 트리 구조 생성
      const pathMap = new Map();
      pathMap.set('내 파일', myFilesFolder);

      // 폴더 생성
      if (folders && folders.length > 0) {
        folders.forEach(folder => {
          const parentFolder = pathMap.get(folder.parentPath) || myFilesFolder;
          const folderNode = {
            name: folder.name,
            type: 'folder',
            folderId: folder._id,
            children: []
          };

          if (!parentFolder.children) {
            parentFolder.children = [];
          }
          parentFolder.children.push(folderNode);

          // 경로 맵에 추가
          const folderPath = folder.parentPath === '내 파일'
            ? `내 파일/${folder.name}`
            : `${folder.parentPath}/${folder.name}`;
          pathMap.set(folderPath, folderNode);
        });
      }

      // 파일 추가
      if (files && files.length > 0) {
        files.forEach(file => {
          const parentFolder = pathMap.get(file.parentPath) || myFilesFolder;

          if (!parentFolder.children) {
            parentFolder.children = [];
          }

          parentFolder.children.push({
            name: file.filename,
            type: 'file',
            fileId: file._id,
            problemCount: file.problemCount,
            uploadDate: file.uploadDate
          });
        });
      }

      // 파일 시스템 다시 렌더링
      if (window.renderDirectory) {
        window.renderDirectory();
      }
    }
  }
  
  
  // 파일 문제 보기
  window.viewFileProblems = async function(fileId, fileName) {
    try {
      const response = await fetch(`/api/my-problems/${fileId}`);
      const result = await response.json();

      if (result.success) {
        displayFileProblems(result.problems, fileId, fileName);
      } else {
        alert('문제 로드 실패: ' + result.message);
      }
    } catch (error) {
      console.error('문제 로드 오류:', error);
      alert('문제 로드 중 오류가 발생했습니다.');
    }
  };
  
  // 파일 문제 표시 (현재 저장되는 필드만 사용)
  function displayFileProblems(problems, fileId, fileName) {
    // 문제 데이터를 PROBLEMS_DATA에 저장
    const dataSource = `db_file_${fileId}`;
    window.PROBLEMS_DATA = window.PROBLEMS_DATA || {};
    window.PROBLEMS_DATA[dataSource] = problems.map((problem, index) => ({
      // 현재 저장되는 필드만 사용
      id: problem.id || (index + 1),
      _id: problem._id, // MongoDB _id 추가
      page: problem.page,
      options: problem.options || [],
      content_blocks: problem.content_blocks || []
    }));

    // 탭 생성 (기존 createTab 함수 사용, 파일명 전달)
    if (window.createTab) {
      window.createTab(dataSource, fileName || `파일_${fileId}`);
    } else {
      // createTab이 없으면 직접 문제 표시
      if (window.displayProblems) {
        window.displayProblems(window.PROBLEMS_DATA[dataSource]);
      }
    }
  }
  
  // 로그인 성공 시 파일 목록 자동 로드
  window.loadMyFiles = loadMyFiles;
  
  // 초기 로드
  loadMyFiles();
}

/* ---- 인증 관련 기능 ---- */
function bindAuth() {
  console.log('인증 기능 초기화 시작');

  // DOM 요소들
  const elements = {
    showLoginFormBtn: document.getElementById('showLoginFormBtn'),
    showRegisterFormBtn: document.getElementById('showRegisterFormBtn'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    userInfo: document.getElementById('userInfo'),
    userProfileArea: document.getElementById('userProfileArea'),
    logoutBtn: document.getElementById('logoutBtn'),
    authButtons: document.getElementById('authButtons'),
    showLoginBtn: document.getElementById('showLoginBtn'),
    showRegisterBtn: document.getElementById('showRegisterBtn'),
    loginBtn: document.getElementById('loginBtn'),
    registerBtn: document.getElementById('registerBtn'),
    modalOverlay: document.getElementById('modalOverlay')
  };

  // 모든 폼 숨기고 초기 버튼 표시
  function hideAllForms() {
    console.log('hideAllForms 호출됨');
    if (elements.loginForm) elements.loginForm.style.display = 'none';
    if (elements.registerForm) elements.registerForm.style.display = 'none';
    if (elements.userInfo) elements.userInfo.style.display = 'none';
    if (elements.authButtons) elements.authButtons.style.display = 'flex';
    if (elements.modalOverlay) elements.modalOverlay.style.display = 'none';
  }

  // 로그인 폼 표시
  function displayLoginForm(event) {
    if (event) event.preventDefault();
    console.log('로그인 폼 표시');
    if (elements.loginForm) elements.loginForm.style.display = 'flex';
    if (elements.registerForm) elements.registerForm.style.display = 'none';
    if (elements.authButtons) elements.authButtons.style.display = 'none';
    if (elements.userInfo) elements.userInfo.style.display = 'none';
    if (elements.modalOverlay) elements.modalOverlay.style.display = 'block';
  }

  // 회원가입 폼 표시
  function displayRegisterForm(event) {
    if (event) event.preventDefault();
    console.log('회원가입 폼 표시');
    if (elements.registerForm) elements.registerForm.style.display = 'flex';
    if (elements.loginForm) elements.loginForm.style.display = 'none';
    if (elements.authButtons) elements.authButtons.style.display = 'none';
    if (elements.userInfo) elements.userInfo.style.display = 'none';
    if (elements.modalOverlay) elements.modalOverlay.style.display = 'block';
  }

  // 사용자 정보 표시
  function displayUserInfo(user) {
    console.log('사용자 정보 표시:', user);
    if (elements.userInfo) {
      elements.userInfo.style.display = 'flex';
      
      // 요금제 뱃지 설정 (임시로 Basic, 추후 서버에서 받아올 수 있음)
      const planBadge = document.getElementById('planBadge');
      const userPlan = user.plan || 'basic'; // 기본값은 basic
      if (planBadge) {
        planBadge.textContent = userPlan === 'pro' ? 'Pro' : 'Basic';
        planBadge.className = 'plan-badge ' + userPlan;
      }
      
      document.getElementById('userName').textContent = user.username;
      document.getElementById('userRole').textContent = user.role === 'teacher' ? '선생님' : '학생';
    }
    if (elements.loginForm) elements.loginForm.style.display = 'none';
    if (elements.registerForm) elements.registerForm.style.display = 'none';
    if (elements.authButtons) elements.authButtons.style.display = 'none';
    if (elements.modalOverlay) elements.modalOverlay.style.display = 'none';

    // 대시보드 활성화
    enableDashboard();
  }

  // 대시보드 활성화/비활성화
  function enableDashboard() {
    const dashboard = document.getElementById('dashboard');
    const overlay = document.getElementById('loginRequiredOverlay');
    if (dashboard) dashboard.classList.remove('disabled');
    if (overlay) overlay.style.display = 'none';
  }

  function disableDashboard() {
    const dashboard = document.getElementById('dashboard');
    const overlay = document.getElementById('loginRequiredOverlay');
    if (dashboard) dashboard.classList.add('disabled');
    if (overlay) overlay.style.display = 'none'; // 기본 오버레이 숨김 (목업 표시용)
    // 게스트 전용 목업 표시
    try{ renderNonLoginMockIfGuest(); }catch(_){ }
  }

  // 이벤트 리스너 등록
  function setupEventListeners() {
    // 로그인 폼 표시 버튼
    if (elements.showLoginFormBtn) {
      console.log('showLoginFormBtn 요소 찾음');
      elements.showLoginFormBtn.addEventListener('click', displayLoginForm);
    } else {
      console.log('showLoginFormBtn 요소를 찾을 수 없음');
    }

    // 회원가입 폼 표시 버튼
    if (elements.showRegisterFormBtn) {
      console.log('showRegisterFormBtn 요소 찾음');
      elements.showRegisterFormBtn.addEventListener('click', displayRegisterForm);
    } else {
      console.log('showRegisterFormBtn 요소를 찾을 수 없음');
    }

    // 폼 간 전환 버튼들
    if (elements.showLoginBtn) {
      console.log('showLoginBtn 요소 찾음');
      elements.showLoginBtn.addEventListener('click', displayLoginForm);
    } else {
      console.log('showLoginBtn 요소를 찾을 수 없음');
    }

    if (elements.showRegisterBtn) {
      console.log('showRegisterBtn 요소 찾음');
      elements.showRegisterBtn.addEventListener('click', displayRegisterForm);
    } else {
      console.log('showRegisterBtn 요소를 찾을 수 없음');
    }

    // 로그인 처리
    if (elements.loginBtn) {
      console.log('loginBtn 요소 찾음');
      elements.loginBtn.addEventListener('click', async function(event) {
        event.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
          alert('이메일과 비밀번호를 입력해주세요.');
          return;
        }

        try {
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
          const data = await response.json();

          if (data.success) {
            currentUser = data.user;
            displayUserInfo(currentUser);
            alert('로그인 성공!');
            // 로그인 성공 시 내 파일 목록 로드
            if (window.loadMyFiles) {
              window.loadMyFiles();
            }
          } else {
            alert('로그인 실패: ' + data.message);
          }
        } catch (error) {
          console.error('로그인 중 오류 발생:', error);
          alert('로그인 중 오류가 발생했습니다.');
        }
      });
    } else {
      console.log('loginBtn 요소를 찾을 수 없음');
    }

    // 역할 선택 버튼 처리
    let selectedRole = null;
    const roleBtns = document.querySelectorAll('.role-btn');
    roleBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        roleBtns.forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        selectedRole = this.getAttribute('data-role');
      });
    });

    // 회원가입 처리
    if (elements.registerBtn) {
      console.log('registerBtn 요소 찾음');
      elements.registerBtn.addEventListener('click', async function(event) {
        event.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;

        if (!username || !email || !password || !selectedRole) {
          alert('모든 필드를 입력해주세요.');
          return;
        }

        try {
          const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, role: selectedRole })
          });
          const data = await response.json();

          if (data.success) {
            currentUser = data.user;
            displayUserInfo(currentUser);
            alert('회원가입 성공! 로그인되었습니다.');
            // 회원가입 성공 시 내 파일 목록 로드 (초기에는 비어있음)
            if (window.loadMyFiles) {
              window.loadMyFiles();
            }
          } else {
            alert('회원가입 실패: ' + data.message);
          }
        } catch (error) {
          console.error('회원가입 중 오류 발생:', error);
          alert('회원가입 중 오류가 발생했습니다.');
        }
      });
    } else {
      console.log('registerBtn 요소를 찾을 수 없음');
    }

    // 프로필 영역(로그아웃 버튼 제외) 클릭 시 요금제 안내 창으로 이동
    if (elements.userProfileArea) {
      console.log('userProfileArea 요소 찾음 - 클릭 이벤트 등록');
      elements.userProfileArea.addEventListener('click', function() {
        // 요금제 안내 페이지로 이동
        window.open('/pricing.html', '_blank');
      });
    } else {
      console.log('userProfileArea 요소를 찾을 수 없음');
    }

    // 로그아웃 처리
    if (elements.logoutBtn) {
      console.log('logoutBtn 요소 찾음');
      elements.logoutBtn.addEventListener('click', async function(event) {
        event.stopPropagation(); // 부모 요소로 이벤트 전파 방지
        try {
          // 서버에 로그아웃 요청
          await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('로그아웃 요청 오류:', error);
        }

        currentUser = null;
        hideAllForms();
        disableDashboard();

        // 로그아웃 시 모든 열린 탭 닫기
        if (window.openTabs) {
          window.openTabs = [];
          window.activeTabId = null;
          if (window.renderTabs) {
            window.renderTabs();
          }
          if (window.clearProblems) {
            window.clearProblems();
          }
        }

        // 로그아웃 시 내 파일 폴더 비우기
        if (window.loadMyFiles) {
          window.loadMyFiles();
        }

        alert('로그아웃되었습니다.');
      });
    } else {
      console.log('logoutBtn 요소를 찾을 수 없음');
    }

    // 모달 오버레이 클릭 시 폼 닫기
    if (elements.modalOverlay) {
      elements.modalOverlay.addEventListener('click', function() {
        hideAllForms();
      });
    }

    // ESC 키로 폼 닫기
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (elements.loginForm && elements.loginForm.style.display === 'flex') {
          hideAllForms();
        }
        if (elements.registerForm && elements.registerForm.style.display === 'flex') {
          hideAllForms();
        }
      }
    });
  }

  // 초기화 실행
  setupEventListeners();
  hideAllForms();

  // 초기 로그인 상태 확인 - 로그인 안 되어 있으면 대시보드 비활성화
  if (!currentUser) {
    disableDashboard();
  }

  console.log('인증 기능 초기화 완료');
}

/* ===== 비로그인 목업 화면 ===== */
function renderNonLoginMockIfGuest(){
  // 이미 렌더했거나 로그인 상태면 스킵
  if (window.__NLOGIN_RENDERED__) return;
  if (typeof currentUser !== 'undefined' && currentUser) return;

  const explorerCard = document.getElementById('dashboard');
  const previewWrap = document.querySelector('.preview-wrap');
  const examPreview = document.querySelector('.exam-preview');
  if (!explorerCard || !previewWrap || !examPreview) return;

  window.__NLOGIN_RENDERED__ = true;

  // 1) 탐색기: 샘플 폴더/파일 구성
  try{
    window.__FS__ = window.__FS__ || { name:'ROOT', type:'root', children:[] };
    let my = (window.__FS__.children||[]).find(c=>c.name==='내 파일');
    if(!my){ my = { name:'내 파일', type:'folder', children:[] }; (window.__FS__.children||[]).push(my); }
    my.children = [
      { name:'수업자료', type:'folder', children:[
        { name:'도형_연습.pdf', type:'file', problemCount:18 },
        { name:'함수_기초.pdf', type:'file', problemCount:12 }
      ]},
      { name:'모의고사', type:'folder', children:[
        { name:'6월모의.pdf', type:'file', problemCount:25 }
      ]},
      { name:'sample8.pdf', type:'file', problemCount:28 },
      { name:'presentation_sample.pdf', type:'file', problemCount:9 }
    ];
    if (window.renderDirectory) window.renderDirectory();
  }catch(_){ }

  // 2) 미리보기: sample8 이미지 문제 일부 채워 넣기
  (async function(){
    let problems=[];
    try{
      const r = await fetch('/history/sample8/problems.json');
      problems = await r.json();
    }catch(_){
      // fetch 실패 시 최소 폴백 3개 (이미지 포함)
      problems = [
        { id:1, content:["![](https://cdn.mathpix.com/cropped/2025_10_07_60cb6ef9d99c6842c3bcg-1.jpg?height=466&width=674&top_left_y=798&top_left_x=268)"]},
        { id:2, content:["![](https://cdn.mathpix.com/cropped/2025_10_07_60cb6ef9d99c6842c3bcg-1.jpg?height=440&width=677&top_left_y=1951&top_left_x=268)"]},
        { id:7, content:["![](https://cdn.mathpix.com/cropped/2025_10_07_fe33e71c165f3c72b963g-1.jpg?height=634&width=672&top_left_y=1517&top_left_x=233)"]}
      ];
    }
    const imageItems = [];
    problems.forEach(p=>{
      if (!p || !p.content) return;
      const imgLine = p.content.find(x=>typeof x==='string' && x.includes('http') && x.includes('cdn.mathpix'));
      if (imgLine){
        const m = imgLine.match(/!\[]\(([^)]+)\)/); // markdown 이미지 추출
        if (m && m[1]) imageItems.push({ id:p.id, url:m[1] });
      }
    });
    const chosen = imageItems.slice(0,6); // 화면 채우기용 6개

    // 탭 모양
    try{
      const tabs = document.getElementById('problemTabs');
      if (tabs){
        tabs.innerHTML = '<div class="tab active"><div class="tab-icon">📄</div><span>sample8.pdf</span></div>';
      }
    }catch(_){ }

    // 미리보기 그리드 채움 (일부 선택 표시)
    const c1 = document.getElementById('column1');
    const c2 = document.getElementById('column2');
    if (c1 && c2){ c1.innerHTML=''; c2.innerHTML=''; }
    chosen.forEach((it, idx)=>{
      const el = document.createElement('div');
      el.className = 'problem' + (idx%3===0 ? ' selected':'');
      el.innerHTML = '<div class="pbody"><img src="'+it.url+'" alt="problem" style="max-width:100%;display:block;border:1px solid #e5e7eb;border-radius:8px;background:#fff"/></div>';
      if (idx%2===0) c1 && c1.appendChild(el); else c2 && c2.appendChild(el);
    });

    // 3) 시험지 미리보기 구성 (선택된 것만)
    try{
      const selected = chosen.filter((_,i)=>i%3===0);
      const exam = document.getElementById('examProblems');
      const statsN = document.getElementById('totalProblems');
      const eta = document.getElementById('estimatedTime');
      if (exam){
        exam.innerHTML = '';
        const page = document.createElement('div');
        page.className = 'exam-page';
        page.innerHTML = '<div class="exam-page-header"><div class="exam-page-title">수학 시험지</div><div class="exam-page-subtitle">샘플 미리보기</div></div>'+
          '<div class="exam-page-content"><div class="exam-page-column">'+
          selected.map((s,i)=>'<div class="exam-problem"><div style="font-weight:800;margin-bottom:6px">'+(i+1)+'.</div><img src="'+s.url+'" style="max-width:100%;border:1px solid #e5e7eb;border-radius:6px"/></div>').join('')+
          '</div><div class="exam-page-column"></div></div>'+
          '<div class="exam-page-footer"><span class="exam-page-number">1</span></div>';
        exam.appendChild(page);
      }
      if (statsN) statsN.textContent = String((chosen.filter((_,i)=>i%3===0)).length);
      if (eta) eta.textContent = '4분';
    }catch(_){ }

    // 4) 섹션 비활성화 (회색 처리 + 인터랙션 차단)
    try{
      explorerCard.classList.add('nologin-dim');
      previewWrap.classList.add('nologin-dim');
      examPreview.classList.add('nologin-dim');
      ;['.explorer .ex-dashboard','.preview-wrap','.exam-preview'].forEach(sel=>{
        const host = document.querySelector(sel);
        if (!host) return;
        if (host.querySelector('.section-mask')) return;
        const mask = document.createElement('div'); mask.className='section-mask'; host.style.position='relative'; host.appendChild(mask);
      });
    }catch(_){ }

    // 5) 말풍선 (작고 닫기 가능)
    try{
      spawnHint('#uploadTile','Pdf 파일을 업로드하면 ai가 자동으로 문제를 추출해요');
      spawnHint('.preview-wrap','추출한 문제를 원클릭으로 선택해요');
      spawnHint('.exam-preview','원하는 양식을 골라서 시험지 완성!');
    }catch(_){ }
  })();
}

function spawnHint(targetSel, text){
  const host = document.querySelector(targetSel); if(!host) return;
  const b = document.createElement('div'); b.className='hint-bubble'; b.innerHTML = '<div class="hint-close">×</div>'+text;
  host.style.position = host.style.position || 'relative';
  // 기본 위치: 상단 좌측 살짝 띄워서
  b.style.top = '8px'; b.style.left = '8px';
  const close = b.querySelector('.hint-close'); close.addEventListener('click',()=> b.remove());
  host.appendChild(b);
}