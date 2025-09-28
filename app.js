/* ========= Preview/Exam Related JavaScript ========= */

// (기존) 부트 이후 MathJax 호출 부분 안전화
function safeTypeset(){ if(window.MathJax && window.MathJax.typesetPromise){ window.MathJax.typesetPromise(); } }

// 공통 유틸 함수 (dashboard.js와 중복되지만 독립성을 위해 유지)
function toArr(x){ return Array.prototype.slice.call(x); }

/* ---- Boot ---- */
document.addEventListener('DOMContentLoaded', function(){
  if (!window.__DASH_INIT__) { initDashboard(); } // 중복 초기화 방지
  bindPreview();
  safeTypeset();
});

/* ---- Preview/Exam 관련 기능 ---- */
function bindPreview(){
  document.getElementById('selectAllProblems').addEventListener('change', function(){
    var checked = document.getElementById('selectAllProblems').checked;
    toArr(document.querySelectorAll('.problem-checkbox')).forEach(function(cb){ cb.checked = checked; });
    setTimeout(safeTypeset, 100);
  });
  document.getElementById('createExamBtn').addEventListener('click', function(){
    var n = toArr(document.querySelectorAll('.problem-checkbox:checked')).length;
    if(!n) return alert('시험지를 제작하려면 최소 1개 이상의 문제를 선택해주세요.');
    updateBuildLog('시험지 제작 시작: ' + n + '개 문항');
    setTimeout(function(){ updateBuildLog('✅ 시험지 제작 완료 ('+n+'개 문항)'); alert('시험지가 제작되었습니다! ('+n+'개 문항)'); }, 1200);
  });
}

function updateBuildLog(msg){ console.log(msg); }