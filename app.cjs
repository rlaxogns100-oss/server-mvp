const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
require('dotenv').config();

// 마크다운 렌더링 함수들
function renderMarkdownTable(text) {
  // 완전한 마크다운 표 블록을 찾아서 HTML로 변환
  const tableRegex = /(?:^|\n)((?:\|[^\n]*\|(?:\n|$))+)/g;

  return text.replace(tableRegex, (match, tableBlock) => {
    const rows = tableBlock.trim().split('\n').map(row => row.trim()).filter(row => row.startsWith('|') && row.endsWith('|'));

    if (rows.length < 2) return match;

    let html = '<table class="markdown-table">';

    // 헤더 행 처리
    const headerCells = rows[0].slice(1, -1).split('|').map(cell => cell.trim());
    html += '<thead><tr>';
    headerCells.forEach(cell => {
      html += `<th>${cell}</th>`;
    });
    html += '</tr></thead>';

    // 구분선 확인 및 건너뛰기
    let dataStartIndex = 1;
    if (rows.length > 1 && (rows[1].includes('---') || rows[1].includes('==='))) {
      dataStartIndex = 2;
    }

    // 데이터 행들 처리
    if (dataStartIndex < rows.length) {
      html += '<tbody>';
      for (let i = dataStartIndex; i < rows.length; i++) {
        const dataCells = rows[i].slice(1, -1).split('|').map(cell => cell.trim());
        html += '<tr>';
        dataCells.forEach(cell => {
          html += `<td>${cell}</td>`;
        });
        html += '</tr>';
      }
      html += '</tbody>';
    }

    html += '</table>';
    return html;
  });
}

function processImagePaths(text) {
  // ![alt text](image_path) 형태의 이미지를 HTML img 태그로 변환
  return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    // 상대 경로인 경우 /images/ 경로로 변환
    if (!src.startsWith('http') && !src.startsWith('/')) {
      src = `/images/${src}`;
    }
    return `<img src="${src}" alt="${alt}" />`;
  });
}

function escapeLatexInHtml(text) {
  // HTML 속성이나 태그 내부의 LaTeX는 건드리지 않고, 텍스트 내의 LaTeX만 처리
  return text.replace(/\$\$([^$]+)\$\$/g, (match, formula) => {
    // 이미 처리된 HTML 태그 내부가 아닌 경우에만 처리
    return `<span class="math-display">$$${formula}$$</span>`;
  }).replace(/\$([^$\n]+)\$/g, (match, formula) => {
    // 인라인 수식 처리
    return `<span class="math-inline">$${formula}$</span>`;
  });
}

function renderContent(content) {
  if (!content) return content;

  // 문자열인 경우 처리
  if (typeof content === 'string') {
    let processed = content;
    processed = renderMarkdownTable(processed);
    processed = processImagePaths(processed);
    processed = escapeLatexInHtml(processed);
    return processed;
  }

  // 배열인 경우 각 요소 처리
  if (Array.isArray(content)) {
    return content.map(item => renderContent(item));
  }

  return content;
}

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('PDF 파일만 업로드 가능합니다.'), false);
    }
  }
});

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

if (!fs.existsSync('output')) {
  fs.mkdirSync('output');
}

// Mathpix API 설정 (.env에서 로드)
const MATHPIX_APP_ID = process.env.APP_ID;
const MATHPIX_APP_KEY = process.env.APP_KEY;

// 디버그: 환경변수 확인
console.log('현재 작업 디렉토리:', process.cwd());
console.log('APP_ID 로드됨:', MATHPIX_APP_ID ? '✓' : '✗');
console.log('APP_KEY 로드됨:', MATHPIX_APP_KEY ? '✓' : '✗');

async function convertPdfToText(pdfPath, sessionId = null) {
  try {
    // API 키 확인
    if (!MATHPIX_APP_ID || !MATHPIX_APP_KEY) {
      throw new Error('.env 파일에 APP_ID와 APP_KEY가 설정되지 않았습니다.');
    }

    console.log(`PDF 변환 시작: ${pdfPath}`);

    const formData = new FormData();
    formData.append('file', fs.createReadStream(pdfPath));
    formData.append('options_json', JSON.stringify({
      conversion_formats: { md: true },
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      rm_spaces: true
    }));

    const response = await axios.post('https://api.mathpix.com/v3/pdf', formData, {
      headers: {
        ...formData.getHeaders(),
        'app_id': MATHPIX_APP_ID,
        'app_key': MATHPIX_APP_KEY,
      },
      timeout: 60000
    });

    if (response.data && response.data.pdf_id) {
      const pdfId = response.data.pdf_id;
      console.log(`PDF ID 생성: ${pdfId}`);

      // 변환 완료 대기
      return await waitForConversion(pdfId, sessionId);
    } else {
      throw new Error('PDF ID를 받지 못했습니다.');
    }
  } catch (error) {
    console.error('PDF 변환 오류:', error.message);
    throw error;
  }
}

async function waitForConversion(pdfId, sessionId = null) {
  const maxAttempts = 60; // 2분간 대기
  const delay = 2000; // 2초마다 확인

  console.log(`변환 대기 시작: ${pdfId}`);
  
  // 즉시 시작 메시지 전송
  if (sessionId) {
    sendProgress(sessionId, 20, 'PDF 변환 중...');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 먼저 상태 확인
      const statusResponse = await axios.get(`https://api.mathpix.com/v3/pdf/${pdfId}`, {
        headers: {
          'app_id': MATHPIX_APP_ID,
          'app_key': MATHPIX_APP_KEY,
        }
      });

      const statusData = statusResponse.data;
      console.log(`시도 ${attempt}/${maxAttempts} - 상태:`, statusData?.status);

      // 변환이 완료되었으면 결과 요청
      if (statusData?.status === 'completed') {
        if (sessionId) {
          sendProgress(sessionId, 40, 'PDF 변환 완료');
        }

        const resultResponse = await axios.get(`https://api.mathpix.com/v3/pdf/${pdfId}.md`, {
          headers: {
            'app_id': MATHPIX_APP_ID,
            'app_key': MATHPIX_APP_KEY,
          }
        });

        if (resultResponse.status === 200 && resultResponse.data) {
          console.log('PDF 변환 완료');
          return resultResponse.data;
        }
      }

      // 아직 변환 중이면 대기
      if (statusData?.status === 'processing' || statusData?.status === 'split') {
        console.log(`변환 진행 중... (${attempt}/${maxAttempts}) - 상태: ${statusData.status}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // 오류 상태인 경우
      if (statusResponse.data?.status === 'error') {
        throw new Error(`변환 실패: ${statusResponse.data?.message || 'Unknown error'}`);
      }

    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`PDF 아직 준비 안됨... (${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error(`변환 확인 중 오류 (시도 ${attempt}):`, error.message);

      // 마지막 시도가 아니면 계속
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error('변환 시간 초과 (2분)');
}

async function runPythonFilter() {
  return new Promise((resolve, reject) => {
    console.log('Python 필터링 스크립트 실행 중...');

    const pythonProcess = spawn('python', ['pipeline/filter_pages.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python stdout:', data.toString().trim());
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python 필터링 완료');
        resolve(stdout);
      } else {
        console.error(`Python 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`필터링 스크립트 실행 실패: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python 프로세스 오류:', error.message);
      reject(new Error(`Python 실행 오류: ${error.message}`));
    });
  });
}

async function runPythonSplit() {
  return new Promise((resolve, reject) => {
    console.log('Python split 스크립트 실행 중...');

    const pythonProcess = spawn('python', ['pipeline/split.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python stdout:', data.toString().trim());
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python split 완료');
        resolve(stdout);
      } else {
        console.error(`Python split 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`Split 스크립트 실행 실패: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python split 프로세스 오류:', error.message);
      reject(new Error(`Python split 실행 오류: ${error.message}`));
    });
  });
}

async function runPythonLLMStructure(sessionId = null) {
  return new Promise((resolve, reject) => {
    console.log('Python LLM structure 스크립트 실행 중...');

    // 즉시 시작 메시지 전송
    if (sessionId) {
      sendProgress(sessionId, 70, 'AI 구조화 준비 중...');
    }

    const pythonProcess = spawn('python', ['pipeline/llm_structure.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      console.log('Python LLM stdout:', output);

      // 진행상황 파싱 - 줄 단위로 처리
      if (sessionId) {
        const lines = output.split('\n');
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          console.log('Processing line:', trimmedLine);
          
          // 시작 메시지 감지 - 더 많은 패턴 추가
          if (trimmedLine.includes('LLM Structure Script 시작') || 
              trimmedLine.includes('개 문제를 로드했습니다') ||
              trimmedLine.includes('로드된 문제 수:') ||
              trimmedLine.includes('개 문제를') && trimmedLine.includes('스레드로 병렬 처리')) {
            sendProgress(sessionId, 70, 'AI 구조화 시작...');
          }
          
          // 패턴 1: "Processing problem 3/34"
          const progressMatch = trimmedLine.match(/Processing problem (\d+)\/(\d+)/);
          if (progressMatch) {
            const current = parseInt(progressMatch[1]);
            const total = parseInt(progressMatch[2]);
            const progress = Math.floor((current / total) * 20) + 70; // 70-90% 범위
            console.log(`Progress update: ${current}/${total} (${progress}%)`);
            sendProgress(sessionId, progress, `AI 구조화 중... (${current}/${total})`);
          }
          
          // 패턴 2: "완료: 3/34 - ID 17"
          const completeMatch = trimmedLine.match(/완료: (\d+)\/(\d+) - ID (\d+)/);
          if (completeMatch) {
            const current = parseInt(completeMatch[1]);
            const total = parseInt(completeMatch[2]);
            const problemId = completeMatch[3];
            const progress = Math.floor((current / total) * 20) + 70;
            console.log(`Complete update: ${current}/${total} - ID ${problemId} (${progress}%)`);
            sendProgress(sessionId, progress, `AI 구조화 중... (${current}/${total}) - 문제 ${problemId} 완료`);
          }
          
          // 패턴 3: "문제 17 구조화 완료"
          const problemCompleteMatch = trimmedLine.match(/문제 (\d+) 구조화 완료/);
          if (problemCompleteMatch) {
            const problemId = problemCompleteMatch[1];
            console.log(`Problem complete: ${problemId}`);
            sendProgress(sessionId, null, `AI 구조화 중... - 문제 ${problemId} 완료`);
          }
          
          // 패턴 4: "34개 문제를 30개 스레드로 병렬 처리 중..."
          const parallelMatch = trimmedLine.match(/(\d+)개 문제를 (\d+)개 스레드로 병렬 처리 중/);
          if (parallelMatch) {
            const totalProblems = parseInt(parallelMatch[1]);
            const threads = parseInt(parallelMatch[2]);
            console.log(`Parallel processing: ${totalProblems} problems with ${threads} threads`);
            sendProgress(sessionId, 70, `AI 구조화 시작... (${totalProblems}개 문항, ${threads}개 스레드)`);
          }
          
          // 완료 메시지 감지
          if (trimmedLine.includes('구조화 완료:') || 
              trimmedLine.includes('전체 작업 완료!') ||
              trimmedLine.includes('개 문제를 저장했습니다')) {
            sendProgress(sessionId, 90, 'AI 구조화 완료!');
          }
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python LLM stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python LLM structure 완료');
        resolve(stdout);
      } else {
        console.error(`Python LLM structure 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`LLM structure 스크립트 실행 실패: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python LLM structure 프로세스 오류:', error.message);
      reject(new Error(`Python LLM structure 실행 오류: ${error.message}`));
    });
  });
}

async function runPythonPDFGenerator(examData) {
  return new Promise((resolve, reject) => {
    console.log('Python PDF 생성 스크립트 실행 중...');

    // 임시 파일에 시험지 데이터 저장
    const tempFilePath = 'temp_exam_data.json';
    try {
      fs.writeFileSync(tempFilePath, JSON.stringify(examData, null, 2), 'utf8');
    } catch (error) {
      reject(new Error(`임시 파일 생성 실패: ${error.message}`));
      return;
    }

    const pythonProcess = spawn('python', ['pipeline/generate_pdf.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python PDF stdout:', data.toString().trim());
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python PDF stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      // 임시 파일 정리
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.warn('임시 파일 삭제 실패:', e.message);
        }
      }

      if (code === 0) {
        console.log('Python PDF 생성 완료');
        resolve(stdout);
      } else {
        console.error(`Python PDF 생성 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`PDF 생성 스크립트 실행 실패: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python PDF 생성 프로세스 오류:', error.message);

      // 임시 파일 정리
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.warn('임시 파일 삭제 실패:', e.message);
        }
      }

      reject(new Error(`Python PDF 생성 실행 오류: ${error.message}`));
    });
  });
}

async function runPythonScreenCapture(captureConfig) {
  return new Promise((resolve, reject) => {
    console.log('Python 화면 캡쳐 스크립트 실행 중...');

    // 임시 파일에 캡쳐 설정 저장
    const tempFilePath = 'temp_capture_config.json';
    try {
      fs.writeFileSync(tempFilePath, JSON.stringify(captureConfig, null, 2), 'utf8');
    } catch (error) {
      reject(new Error(`임시 파일 생성 실패: ${error.message}`));
      return;
    }

    const pythonProcess = spawn('python', ['pipeline/capture_pdf.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python Capture stdout:', data.toString().trim());
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python Capture stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      // 임시 파일 정리
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.warn('임시 파일 삭제 실패:', e.message);
        }
      }

      if (code === 0) {
        console.log('Python 화면 캡쳐 완료');
        resolve(stdout);
      } else {
        console.error(`Python 화면 캡쳐 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`화면 캡쳐 스크립트 실행 실패: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python 화면 캡쳐 프로세스 오류:', error.message);

      // 임시 파일 정리
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.warn('임시 파일 삭제 실패:', e.message);
        }
      }

      reject(new Error(`Python 화면 캡쳐 실행 오류: ${error.message}`));
    });
  });
}

// 진행상황 전송을 위한 글로벌 변수
const progressClients = new Map();

// 진행상황 전송 함수
function sendProgress(sessionId, progress, message) {
  const client = progressClients.get(sessionId);
  console.log(`📡 sendProgress 호출 - 세션: ${sessionId}, 진행률: ${progress}%, 메시지: "${message}"`);
  console.log(`📡 클라이언트 상태 - 존재: ${!!client}, 파괴됨: ${client?.destroyed}`);
  
  if (client && !client.destroyed) {
    try {
      // progress가 null이면 이전 진행률 유지
      const data = { message };
      if (progress !== null) {
        data.progress = progress;
      }
      const sseData = `data: ${JSON.stringify(data)}\n\n`;
      console.log(`📡 SSE 데이터 전송: ${sseData.trim()}`);
      client.write(sseData);
      console.log(`✅ SSE 전송 성공 (${sessionId})`);
    } catch (error) {
      console.log(`❌ SSE 전송 오류 (${sessionId}):`, error.message);
      // 오류 발생시 클라이언트 제거
      progressClients.delete(sessionId);
    }
  } else {
    console.log(`❌ SSE 클라이언트 없음 또는 파괴됨 (${sessionId})`);
  }
}

const server = http.createServer((req, res) => {
  // 이미지 파일 서빙
  if (req.method === 'GET' && req.url.startsWith('/images/')) {
    const imagePath = path.join(process.cwd(), req.url);

    if (fs.existsSync(imagePath)) {
      const ext = path.extname(imagePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(imagePath).pipe(res);
      return;
    } else {
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('Image not found');
      return;
    }
  }

  if (req.method === 'GET' && req.url === '/') {
    // Serve index.html
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('index.html not found');
        return;
      }
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(data);
    });
  } else if (req.method === 'GET' && req.url.startsWith('/api/progress/')) {
    // SSE 엔드포인트
    const sessionId = req.url.split('/').pop();
    console.log(`🔗 SSE 연결 요청 - 세션 ID: ${sessionId}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // 클라이언트 등록
    progressClients.set(sessionId, res);
    console.log(`✅ SSE 클라이언트 등록 완료 - 세션 ID: ${sessionId}, 총 클라이언트 수: ${progressClients.size}`);

    // 연결 종료 시 정리
    req.on('close', () => {
      console.log(`🔌 SSE 연결 종료 - 세션 ID: ${sessionId}`);
      progressClients.delete(sessionId);
      console.log(`🗑️ SSE 클라이언트 제거 완료 - 세션 ID: ${sessionId}, 남은 클라이언트 수: ${progressClients.size}`);
    });

    // 초기 메시지
    const initialMessage = { progress: 0, message: '연결됨' };
    console.log(`📤 SSE 초기 메시지 전송: ${JSON.stringify(initialMessage)}`);
    res.write(`data: ${JSON.stringify(initialMessage)}\n\n`);
  } else if (req.method === 'GET' && req.url === '/api/problems') {
    // Return problems data as JSON for the frontend
    const structuredPath = 'output/problems_llm_structured.json';
    const originalPath = 'output/problems.json';
    let problems = [];

    if (fs.existsSync(structuredPath)) {
      try {
        const problemsText = fs.readFileSync(structuredPath, 'utf8');
        problems = JSON.parse(problemsText);
      } catch (error) {
        console.error('구조화된 문제 파일 읽기 오류:', error);
      }
    }

    if (problems.length === 0 && fs.existsSync(originalPath)) {
      try {
        const problemsText = fs.readFileSync(originalPath, 'utf8');
        problems = JSON.parse(problemsText);
      } catch (error) {
        console.error('원본 문제 파일 읽기 오류:', error);
      }
    }

    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({ success: true, problems: problems }));
  } else if (req.method === 'GET' && req.url === '/problems') {
    // 분할된 문제들을 보여주는 페이지 (구조화된 문제 우선)
    const structuredPath = 'output/problems_llm_structured.json';
    const originalPath = 'output/problems.json';
    let problems = [];
    let isStructured = false;

    if (fs.existsSync(structuredPath)) {
      try {
        const problemsText = fs.readFileSync(structuredPath, 'utf8');
        problems = JSON.parse(problemsText);
        isStructured = true;
        console.log(`구조화된 문제 ${problems.length}개 표시`);
      } catch (error) {
        console.error('구조화된 문제 파일 읽기 오류:', error);
      }
    }

    if (!isStructured && fs.existsSync(originalPath)) {
      try {
        const problemsText = fs.readFileSync(originalPath, 'utf8');
        problems = JSON.parse(problemsText);
        console.log(`원본 문제 ${problems.length}개 표시`);
      } catch (error) {
        console.error('원본 문제 파일 읽기 오류:', error);
      }
    }

    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>분할된 문제들</title>
        <script type="text/javascript" async
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">
        </script>
        <script>
          window.MathJax = {
            tex: {
              inlineMath: [['$', '$'], ['\\(', '\\)']],
              displayMath: [['$$', '$$'], ['\\[', '\\]']],
              processEscapes: true,
              processEnvironments: true
            },
            options: {
              skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
              ignoreHtmlClass: 'tex2jax_ignore',
              processHtmlClass: 'tex2jax_process'
            }
          };
        </script>
        <style>
          body { font-family: Arial; padding: 20px; margin: 0; }
          .header { background: #f8f9fa; padding: 20px; margin: -20px -20px 20px -20px; }
          .nav { margin: 20px 0; }
          .nav a { margin: 0 10px; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 3px; }
          .nav a:hover { background: #0056b3; }
          .problem { border: 1px solid #ddd; margin: 15px 0; padding: 20px; border-radius: 8px; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .problem-header { background: #e9ecef; padding: 10px; margin: -20px -20px 15px -20px; border-radius: 8px 8px 0 0; }
          .problem-content { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
          .problem-content pre { white-space: pre-wrap; font-family: 'Courier New', monospace; margin: 0; line-height: 1.4; }
          .stats { background: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .no-problems { text-align: center; padding: 50px; color: #6c757d; }

          /* 표 스타일링 */
          table.markdown-table { border-collapse: collapse; width: 100%; margin: 10px 0; }
          table.markdown-table th, table.markdown-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          table.markdown-table th { background-color: #f2f2f2; font-weight: bold; }

          /* 이미지 스타일링 */
          img { max-width: 100%; height: auto; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📚 분할된 문제들</h1>
          <div class="nav">
            <a href="/">새 파일 업로드</a>
          </div>
        </div>

        ${problems.length > 0 ? `
          <div class="stats">
            <strong>📊 총 ${problems.length}개의 문제가 ${isStructured ? '구조화되어' : '분할되어'} 있습니다.</strong>
            ${isStructured ? '<span style="color: #28a745; font-weight: bold;">✨ LLM으로 구조화된 문제</span>' : '<span style="color: #ffc107;">📝 기본 분할된 문제</span>'}
          </div>

          ${problems.map((problem, index) => {
            if (isStructured && problem.content_blocks) {
              // 구조화된 문제 표시
              return `
                <div class="problem">
                  <div class="problem-header">
                    <h3 style="margin: 0; color: #495057;">문제 ${problem.id} ${problem.page && problem.page !== 'null' ? `(페이지 ${problem.page})` : ''}</h3>
                    <small style="color: #6c757d;">🤖 AI 구조화된 문제</small>
                  </div>
                  <div class="problem-content">
                    ${problem.content_blocks.map(block => {
                      if (block.type === 'text') {
                        return `<div style="margin: 10px 0; line-height: 1.6;">${renderContent(block.content)}</div>`;
                      } else if (block.type === 'image') {
                        return `<div style="margin: 15px 0; text-align: center;"><img src="${block.content}" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 5px;"/></div>`;
                      } else if (block.type === 'examples' || block.type === 'table') {
                        return `<div style="background: #f8f9fa; padding: 10px; margin: 10px 0; border-left: 4px solid #007bff; border-radius: 3px;"><strong>${block.type === 'examples' ? '📋 보기/조건' : '📊 표'}:</strong><br/>${renderContent(block.content)}</div>`;
                      }
                      return `<div style="margin: 10px 0;">${renderContent(block.content)}</div>`;
                    }).join('')}
                    ${problem.options && problem.options.length > 0 ? `
                      <div style="background: #e9ecef; padding: 15px; margin: 15px 0; border-radius: 5px;">
                        <strong>📝 선택지:</strong>
                        <ul style="margin: 10px 0; padding-left: 20px;">
                          ${problem.options.map(option => `<li style="margin: 5px 0;">${renderContent(option)}</li>`).join('')}
                        </ul>
                      </div>
                    ` : ''}
                  </div>
                </div>
              `;
            } else {
              // 기본 원본 문제 표시
              return `
                <div class="problem">
                  <div class="problem-header">
                    <h3 style="margin: 0; color: #495057;">문제 ${problem.id} ${problem.page ? `(페이지 ${problem.page})` : ''}</h3>
                    <small style="color: #6c757d;">분류: ${problem.classification || 'N/A'} | 줄 수: ${problem.content ? problem.content.length : 'N/A'}</small>
                  </div>
                  <div class="problem-content">
                    <pre>${problem.content ? renderContent(problem.content.join('\n')) : 'No content'}</pre>
                  </div>
                </div>
              `;
            }
          }).join('')}
        ` : `
          <div class="no-problems">
            <h2>📭 분할된 문제가 없습니다</h2>
            <p>먼저 PDF 파일을 업로드하여 문제를 분할해주세요.</p>
            <a href="/" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 3px;">PDF 업로드하기</a>
          </div>
        `}
        <script>
          // MathJax 렌더링 다시 실행
          if (window.MathJax) {
            MathJax.typesetPromise().then(() => {
              console.log('MathJax 렌더링 완료');
            }).catch((err) => console.log('MathJax 오류:', err));
          }
        </script>
      </body>
      </html>
    `);
  } else if (req.method === 'GET' && (req.url.endsWith('.js') || req.url.endsWith('.css'))) {
    // 정적 파일 서빙 (JS, CSS)
    const filePath = path.join(__dirname, req.url);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.js': 'application/javascript',
        '.css': 'text/css'
      };
      const contentType = mimeTypes[ext] || 'text/plain';

      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
    }
  } else if (req.method === 'POST' && req.url === '/api/capture-pdf') {
    // 화면 캡쳐 PDF 생성 API
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const captureData = JSON.parse(body);

        console.log('📸 화면 캡쳐 PDF 생성 요청 수신');

        // 캡쳐 설정 구성
        const captureConfig = {
          url: captureData.url || 'http://localhost:3000',
          areas: captureData.areas || [
            {
              selector: '#examProblems',
              name: 'exam_content'
            }
          ]
        };

        // Python 화면 캡쳐 호출
        const result = await runPythonScreenCapture(captureConfig);

        // 생성된 PDF 파일 확인
        const pdfPath = 'output/captured_exam.pdf';
        if (fs.existsSync(pdfPath)) {
          // PDF 파일을 base64로 인코딩하여 반환
          const pdfBuffer = fs.readFileSync(pdfPath);
          const pdfBase64 = pdfBuffer.toString('base64');

          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8'
          });
          res.end(JSON.stringify({
            success: true,
            message: '화면 캡쳐 PDF 생성 완료',
            pdfData: pdfBase64,
            filename: 'captured_exam.pdf'
          }));
        } else {
          throw new Error('PDF 파일이 생성되지 않았습니다');
        }

      } catch (error) {
        console.error('화면 캡쳐 PDF 생성 API 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          message: '화면 캡쳐 PDF 생성 중 오류가 발생했습니다'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/generate-pdf') {
    // 텍스트 기반 PDF 생성 API (백업용)
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const examData = JSON.parse(body);

        console.log('🔧 텍스트 PDF 생성 요청 수신:', examData.problems?.length || 0, '개 문제');

        // Python PDF 생성기 호출
        const result = await runPythonPDFGenerator(examData);

        // 생성된 PDF 파일 확인
        const pdfPath = 'output/generated_exam.pdf';
        if (fs.existsSync(pdfPath)) {
          // PDF 파일을 base64로 인코딩하여 반환
          const pdfBuffer = fs.readFileSync(pdfPath);
          const pdfBase64 = pdfBuffer.toString('base64');

          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8'
          });
          res.end(JSON.stringify({
            success: true,
            message: 'PDF 생성 완료',
            pdfData: pdfBase64,
            filename: 'generated_exam.pdf'
          }));
        } else {
          throw new Error('PDF 파일이 생성되지 않았습니다');
        }

      } catch (error) {
        console.error('PDF 생성 API 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          message: 'PDF 생성 중 오류가 발생했습니다'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/upload') {
    const uploadSingle = upload.single('pdf');
    uploadSingle(req, res, async (err) => {
      if (err) {
        res.writeHead(400, {'Content-Type': 'text/html; charset=utf-8'});
        res.end(`
          <html>
          <body>
            <h2>업로드 실패</h2>
            <p>${err.message}</p>
            <a href="/">다시 시도</a>
          </body>
          </html>
        `);
        return;
      }

      if (!req.file) {
        res.writeHead(400, {'Content-Type': 'text/html; charset=utf-8'});
        res.end(`
          <html>
          <body>
            <h2>파일이 없습니다</h2>
            <p>PDF 파일을 선택해주세요.</p>
            <a href="/">다시 시도</a>
          </body>
          </html>
        `);
        return;
      }

      try {
        const startTime = Date.now();
        const sessionId = req.headers['x-session-id'] || Date.now().toString();

        console.log(`\n🚀 파일 업로드 시작: ${req.file.originalname}`);
        console.log(`📁 파일 크기: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

        // 파일 업로드 완료 알림
        sendProgress(sessionId, 10, '파일 업로드 완료');

        // PDF 변환 실행
        console.log('\n📄 PDF 변환 시작...');
        sendProgress(sessionId, 15, 'PDF 변환 중...');
        const pdfStartTime = Date.now();
        const extractedText = await convertPdfToText(req.file.path, sessionId);
        const pdfEndTime = Date.now();
        console.log(`✅ PDF 변환 완료 - 소요시간: ${((pdfEndTime - pdfStartTime) / 1000).toFixed(2)}초`);
        console.log(`📝 변환된 텍스트 길이: ${extractedText.length.toLocaleString()} 문자`);

        // 원본 파일 저장
        console.log('\n💾 원본 파일 저장...');
        sendProgress(sessionId, 45, '텍스트 저장 중...');
        const saveStartTime = Date.now();
        const originalPath = 'output/result.paged.mmd';
        fs.writeFileSync(originalPath, extractedText, 'utf8');
        const saveEndTime = Date.now();
        console.log(`✅ 파일 저장 완료 - 소요시간: ${((saveEndTime - saveStartTime) / 1000).toFixed(2)}초`);

        // Python 필터링 스크립트 실행
        console.log('\n🔍 Python 필터링 실행...');
        sendProgress(sessionId, 50, '텍스트 필터링 중...');
        const filterStartTime = Date.now();
        await runPythonFilter();
        const filterEndTime = Date.now();
        console.log(`✅ 필터링 완료 - 소요시간: ${((filterEndTime - filterStartTime) / 1000).toFixed(2)}초`);

        // Python split 스크립트 실행
        console.log('\n✂️ Python split 실행...');
        sendProgress(sessionId, 60, '문제 분할 중...');
        const splitStartTime = Date.now();
        await runPythonSplit();
        const splitEndTime = Date.now();
        console.log(`✅ 문제 분할 완료 - 소요시간: ${((splitEndTime - splitStartTime) / 1000).toFixed(2)}초`);

        // Python LLM structure 스크립트 실행
        console.log('\n🤖 Python LLM structure 실행...');
        sendProgress(sessionId, 70, 'AI 구조화 중...');
        const llmStartTime = Date.now();
        await runPythonLLMStructure(sessionId);
        const llmEndTime = Date.now();
        console.log(`✅ AI 구조화 완료 - 소요시간: ${((llmEndTime - llmStartTime) / 1000).toFixed(2)}초`);
        sendProgress(sessionId, 90, 'AI 구조화 완료');

        // 구조화된 문제들 읽기 (우선순위: structured > original)
        let problems = [];
        const structuredProblemsPath = 'output/problems_llm_structured.json';
        const originalProblemsPath = 'output/problems.json';

        console.log('\n📊 결과 파일 로딩...');
        sendProgress(sessionId, 95, '결과 저장 중...');
        const loadStartTime = Date.now();
        if (fs.existsSync(structuredProblemsPath)) {
          const problemsText = fs.readFileSync(structuredProblemsPath, 'utf8');
          problems = JSON.parse(problemsText);
          console.log(`✅ 구조화된 문제 ${problems.length}개 로드`);
        } else if (fs.existsSync(originalProblemsPath)) {
          const problemsText = fs.readFileSync(originalProblemsPath, 'utf8');
          problems = JSON.parse(problemsText);
          console.log(`✅ 원본 문제 ${problems.length}개 로드`);
        }
        const loadEndTime = Date.now();
        sendProgress(sessionId, 100, '처리 완료!');

        // 전체 처리 시간 요약
        const totalTime = Date.now() - startTime;
        console.log('\n' + '='.repeat(60));
        console.log('🎉 전체 처리 완료!');
        console.log('='.repeat(60));
        console.log(`📁 파일명: ${req.file.originalname}`);
        console.log(`📝 추출된 텍스트: ${extractedText.length.toLocaleString()} 문자`);
        console.log(`🔢 분할된 문제 수: ${problems.length}개`);
        console.log(`⏱️ 총 소요시간: ${(totalTime / 1000).toFixed(2)}초 (${(totalTime / 60000).toFixed(1)}분)`);
        console.log('='.repeat(60) + '\n');

        // JSON 응답 반환
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '파일 처리 완료',
          problems: problems,
          stats: {
            originalTextLength: extractedText.length,
            problemCount: problems.length,
            filename: req.file.originalname
          }
        }));

        // 업로드된 파일 정리
        fs.unlinkSync(req.file.path);

      } catch (error) {
        const totalTime = Date.now() - (startTime || Date.now());
        const sessionId = req.headers['x-session-id'] || Date.now().toString();

        // 에러 진행상황 알림
        sendProgress(sessionId, 0, `오류: ${error.message}`);

        console.log('\n' + '='.repeat(60));
        console.log('❌ 처리 실패!');
        console.log('='.repeat(60));
        console.log(`📁 파일명: ${req.file.originalname}`);
        console.log(`❌ 오류: ${error.message}`);
        console.log(`⏱️ 실패까지 소요시간: ${(totalTime / 1000).toFixed(2)}초`);
        console.log('='.repeat(60) + '\n');

        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          message: 'PDF 변환 중 오류가 발생했습니다'
        }));

        // 실패 시에도 업로드된 파일 정리
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      }
    });
  } else {
    res.writeHead(404, {'Content-Type': 'text/html; charset=utf-8'});
    res.end('<h1>404 - 페이지를 찾을 수 없습니다</h1>');
  }
});

const PORT = 3000;
//server.listen(PORT, () => {
//  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);

server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('listening on 0.0.0.0:3000');
});