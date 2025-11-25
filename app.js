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
  // 비로그인 초기 상태: sample8 1~4번을 JSON에서 읽어 미리보기 표시 (DB 미사용)
  setTimeout(()=>{ try{ if(!currentUser){ guestPreviewSample8First4(); } }catch(_){ } }, 150);
  // 섹션 버튼 노출 제거 (요구사항 변경)
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

// 인라인 회원가입 폼 처리 (오버레이 하단)
document.addEventListener('click', function(e){
  const t = e.target;
  // 회원가입 제출 → 정식 회원가입 모달로 이동(필드 채워서)
  if (t && t.id === 'inlineRegisterBtn'){
    const wrap = document.getElementById('inlineRegisterForm');
    if (!wrap) return;
    const username = document.getElementById('inlineRegisterUsername')?.value || '';
    const email = document.getElementById('inlineRegisterEmail')?.value || '';
    const password = document.getElementById('inlineRegisterPassword')?.value || '';
    if (!username || !email || !password){ alert('모든 필드를 입력해주세요.'); return; }

    // 정식 회원가입 폼에 값 채우고 모달 오픈
    try{
      const ru = document.getElementById('registerUsername'); if (ru) ru.value = username;
      const re = document.getElementById('registerEmail'); if (re) re.value = email;
      const rp = document.getElementById('registerPassword'); if (rp) rp.value = password;
      const rf = document.getElementById('registerForm'); if (rf) rf.style.display = 'flex';
      const lf = document.getElementById('loginForm'); if (lf) lf.style.display = 'none';
      const mo = document.getElementById('modalOverlay'); if (mo) mo.style.display = 'block';
    }catch(err){ console.error('회원가입 폼 표시 오류', err); }
  }
  // 로그인 폼 열기
  if (t && t.id === 'inlineShowLoginBtn'){
    try{ document.getElementById('showLoginFormBtn')?.click(); }catch(_){ }
  }
});

function updateBuildLog(msg){ console.log(msg); }

// ----- Guide bubbles (guest) -----
function createOrMoveBubble(targetEl, id, html, offsetY){
  if (!targetEl) return;
  let el = document.getElementById(id);
  if (!el){
    el = document.createElement('div');
    el.id = id;
    el.className = 'guide-bubble';
    el.innerHTML = '<button class="close" aria-label="close">×</button>' + html;
    document.body.appendChild(el);
    el.querySelector('.close').addEventListener('click', ()=>{ el.remove(); });
  }
  const r = targetEl.getBoundingClientRect();
  const isMobile = (window.innerWidth || document.documentElement.clientWidth) <= 768;
  const baseOffset = (typeof offsetY==='number') ? offsetY : (isMobile ? 56 : 80);
  const top = Math.max(10, r.top - baseOffset);
  const left = r.left + (r.width/2);
  el.style.top = top + 'px';
  el.style.left = left + 'px';
  el.style.transform = 'translateX(-50%)';
}

function showGuestGuideBubbles(){
  try{
    if (window.currentUser) return;
    const isMobile = (window.innerWidth || document.documentElement.clientWidth) <= 768;
    if (isMobile) { removeGuestGuideBubbles(); return; }
    const up = document.getElementById('uploadTile');
    const prev = document.getElementById('problemsPreview') || document.querySelector('.preview-wrap');
    const exam = document.querySelector('.exam-preview');
    // 텍스트(줄바꿈 포함)
    const t1 = '형식불문! pdf 파일을 업로드하면<br>ai가 자동으로 문제만 추출합니다.';
    const t2 = '원하는 파일의 원하는 문제를<br>원클릭으로 선택하세요!';
    const t3 = '마음에 드는 레이아웃을 선택하고<br>생성하면 학습지 완성!';
    up && createOrMoveBubble(up, 'guideBubbleUpload', t1, 80);
    prev && createOrMoveBubble(prev, 'guideBubblePreview', t2, 80);
    exam && createOrMoveBubble(exam, 'guideBubbleExam', t3, 80);
  }catch(_){ }
}

function removeGuestGuideBubbles(){
  try{
    ['guideBubbleUpload','guideBubblePreview','guideBubbleExam']
      .forEach(id=>document.getElementById(id)?.remove());
  }catch(_){ }
}

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

      // 비로그인 게스트: 예시 폴더/파일 시드
      try{
        if (!currentUser && myFilesFolder && Array.isArray(myFilesFolder.children) && myFilesFolder.children.length===0){
          // 루트에 예시 파일들
          myFilesFolder.children.push(
            { name: '도형의 방정식_고난도.pdf', type: 'file' },
            { name: 'OO고1_25년_중간고사.pdf', type: 'file' },
            { name: '함수그래프_기본.pdf', type: 'file' }
          );
          // 예시 폴더 (모의고사 제거, 수업자료 기본 열린 상태)
          myFilesFolder.children.push(
            { name: '수업자료', type: 'folder', children: [
              { name: '기하벡터_연습.pdf', type: 'file' }
            ]}
          );
          try{ if (window.__OPEN__) window.__OPEN__.add('내 파일/수업자료'); }catch(_){ }
        }
      }catch(_){ }

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
  
  // 초기 로드:
  // - 로그인 사용자는 서버에서 실제 파일 목록을 가져오고
  // - 비로그인 게스트는 DB 호출 없이 예시 파일/폴더만 바로 렌더링한다.
  if (window.currentUser) {
    loadMyFiles();
  } else {
    displayMyFiles([], []);
  }
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
    planBadge: document.getElementById('planBadge'),
    planBadgeLabel: document.getElementById('planBadgeLabel'),
    planDropdown: document.getElementById('planDropdown'),
    planMenu: document.getElementById('planMenu'),
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
      const userPlan = user.plan && user.plan.toLowerCase() === 'pro' ? 'pro' : 'basic';
      if (elements.planBadge) {
        elements.planBadge.classList.remove('basic', 'pro');
        elements.planBadge.classList.add(userPlan);
      }
      if (elements.planBadgeLabel) {
        elements.planBadgeLabel.textContent = userPlan === 'pro' ? 'Pro' : 'Basic';
      }
      document.querySelectorAll('.plan-option').forEach(option => {
        option.classList.toggle('active', option.getAttribute('data-plan') === userPlan);
      });
      
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
    const inlineReg = document.getElementById('inlineRegisterForm');
    if (inlineReg) inlineReg.style.display = 'none';
    if (dashboard) dashboard.classList.remove('guest-locked');
    try{ document.getElementById('guestLockCenter').style.display='none'; }catch(_){ }
    try{ if (window.setResizeMode) window.setResizeMode(false); }catch(_){ }
    // 게스트 비활성화 상태 해제
    try{ document.querySelector('.preview-wrap')?.classList.remove('guest-disabled'); }catch(_){ }
    try{ document.querySelector('.exam-preview')?.classList.remove('guest-disabled'); }catch(_){ }
    // 게스트 예시 탭/데이터 정리
    try{
      if (window.PROBLEMS_DATA){ delete window.PROBLEMS_DATA['guest1']; delete window.PROBLEMS_DATA['guest2']; }
      if (typeof window.clearAllTabs === 'function') window.clearAllTabs();
      if (typeof window.clearProblems === 'function') window.clearProblems();
      try{ document.getElementById('clearExam')?.click(); }catch(_){ }
    }catch(_){ }
  }

  function disableDashboard() {
    const dashboard = document.getElementById('dashboard');
    const overlay = document.getElementById('loginRequiredOverlay');
    if (dashboard) dashboard.classList.remove('disabled'); // 게스트도 탐색기 표시
    if (overlay) overlay.style.display = 'none'; // 오버레이 사용 안 함
    const inlineReg = document.getElementById('inlineRegisterForm');
    if (inlineReg) inlineReg.style.display = 'block';
    if (dashboard) dashboard.classList.add('guest-locked');
    try{ document.getElementById('guestLockCenter').style.display='flex'; }catch(_){ }
    try{ if (window.setResizeMode) window.setResizeMode(true); }catch(_){ }
    // 게스트 잠금 상태에서 가이드 버블 3개 표시 (중앙 잠금 박스가 없어도 항상 동작하도록 분리)
    try{
      requestAnimationFrame(()=>{
        showGuestGuideBubbles();
      });
    }catch(_){ }
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
            try{ window.authSessionId = data.sessionId || window.authSessionId; }catch(_){ }
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
            // 자동 로그인 제거: 사용자 정보/세션 저장 안 함
            alert('회원가입이 완료되었습니다. 로그인 후 이용해 주세요.');
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

    // 요금제 드롭다운 토글 및 옵션 동작
    const planOptions = document.querySelectorAll('.plan-option');
    if (elements.planBadge && elements.planDropdown) {
      elements.planBadge.addEventListener('click', function(event) {
        event.stopPropagation();
        elements.planDropdown.classList.toggle('open');
        if (elements.planMenu) {
          elements.planMenu.style.display = elements.planDropdown.classList.contains('open') ? 'flex' : 'none';
        }
      });

      planOptions.forEach(option => {
        option.addEventListener('click', function(event) {
          event.stopPropagation();
          const selectedPlan = this.getAttribute('data-plan');
          if (elements.planBadge) {
            elements.planBadge.classList.remove('basic', 'pro');
            elements.planBadge.classList.add(selectedPlan);
          }
          if (elements.planBadgeLabel) {
            elements.planBadgeLabel.textContent = selectedPlan === 'pro' ? 'Pro' : 'Basic';
          }
          planOptions.forEach(opt => opt.classList.toggle('active', opt === option));
          elements.planDropdown.classList.remove('open');
          if (elements.planMenu) elements.planMenu.style.display = 'none';
          window.open(`/pricing.html#${selectedPlan}`, '_blank');
        });
      });

      document.addEventListener('click', function(event) {
        if (!elements.planDropdown.contains(event.target)) {
          elements.planDropdown.classList.remove('open');
          if (elements.planMenu) elements.planMenu.style.display = 'none';
        }
      });
    }
    if (!elements.userProfileArea) {
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

        // 로그아웃 직후에도 로그인 모달을 화면 중앙에 다시 띄운다.
        try {
          displayLoginForm();
        } catch(_){}

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
    // → 로그인 전에는 절대 닫히지 않도록 currentUser 여부로 제어
    if (elements.modalOverlay) {
      elements.modalOverlay.addEventListener('click', function() {
        if (!currentUser) return;
        hideAllForms();
      });
    }

    // ESC 키로 폼 닫기
    // → 로그인 전에는 ESC로도 닫히지 않도록 currentUser 여부로 제어
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (!currentUser) return;
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

  // 초기 진입 시: 로그인하지 않은 사용자는
  // 1) 대시보드를 게스트 모드로 잠그고
  // 2) 바로 로그인 모달을 띄운다.
  if (!currentUser) {
    disableDashboard();
    displayLoginForm();
  } else {
    // 로그인된 상태라면 모든 폼을 감춘다.
    hideAllForms();
  }

  console.log('인증 기능 초기화 완료');
}

// 게스트 전용: sample8 1~4번 문제를 JSON에서 읽어와 미리보기 영역에 표시
async function guestPreviewSample8First4(){
  try{
    const res = await fetch('/history/sample8/problems_llm_structured.json', { cache: 'no-store' });
    const data = await res.json();
    const first4 = (Array.isArray(data)?data:[])
      .filter(p=>[1,2,3,4].includes(p.id))
      .map(p=>{ return Object.assign({}, p, { _id: 'sample8-'+p.id }); });
    if (first4.length){
      // 탭 두 개 생성 (사진용): 선택된 탭/선택 안된 탭 제목 적용
      try{
        window.PROBLEMS_DATA = window.PROBLEMS_DATA || {};
        window.PROBLEMS_DATA['guest1'] = first4;
        window.PROBLEMS_DATA['guest2'] = first4;
        if (typeof window.createTab === 'function'){
          window.createTab('guest1', '도형의 방정식_고난도');
          window.createTab('guest2', 'OO고1_25년_중간고사');
          // 첫 번째 탭을 활성으로 전환
          if (typeof window.switchToTab === 'function') window.switchToTab('guest1');
        } else if (typeof window.displayProblems === 'function') {
          window.displayProblems(first4);
        }
      }catch(_){ if (typeof window.displayProblems === 'function') window.displayProblems(first4); }
      // 1,4번만 선택 표시
      setTimeout(()=>{
        try{
          const s1=document.querySelector('.problem[data-problem="sample8-1"]');
          const s4=document.querySelector('.problem[data-problem="sample8-4"]');
          s1 && s1.classList.add('selected');
          s4 && s4.classList.add('selected');
        }catch(_){ }
        // 영역 흑백 + 비활성화
        try{ document.querySelector('.preview-wrap')?.classList.add('guest-disabled'); }catch(_){ }
        // 시험지 미리보기에 1,4번 추가 + 흑백 비활성화
        try{
          if (window.addProblemToExam){
            const p1 = first4.find(p=>p.id===1);
            const p4 = first4.find(p=>p.id===4);
            p1 && window.addProblemToExam('guest:sample8-1', p1);
            p4 && window.addProblemToExam('guest:sample8-4', p4);
          }
          document.querySelector('.exam-preview')?.classList.add('guest-disabled');
        }catch(_){ }
      }, 50);

      // 모바일 자동 탭 전환 제거 (요청 사항)
    }
  }catch(err){ console.error('guestPreviewSample8First4 실패:', err); }
}