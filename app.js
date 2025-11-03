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
    if (overlay) overlay.style.display = 'flex';
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