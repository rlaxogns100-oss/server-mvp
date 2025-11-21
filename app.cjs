const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

// 이메일 전송 설정 (HWP 요청 알림용)
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587', 10);
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER;
const HWP_NOTIFY_EMAILS = (process.env.HWP_NOTIFY_EMAILS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

// 토스페이먼츠 자동결제(빌링) 설정
// - TOSS_BILLING_CLIENT_KEY: API 개별 연동 "클라이언트 키" (테스트/라이브)
// - TOSS_BILLING_SECRET_KEY: API 개별 연동 "시크릿 키"   (테스트/라이브)
const TOSS_BILLING_CLIENT_KEY = process.env.TOSS_BILLING_CLIENT_KEY || '';
const TOSS_BILLING_SECRET_KEY = process.env.TOSS_BILLING_SECRET_KEY || '';

let mailTransporter = null;
if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465, // 465면 TLS, 그 외엔 STARTTLS
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
} else {
  console.warn('⚠️ 이메일 환경변수(EMAIL_HOST/EMAIL_USER/EMAIL_PASS)가 설정되지 않아 HWP 알림 메일이 비활성화됩니다.');
}

async function sendHwpRequestNotification(hwpDoc) {
  try {
    if (!mailTransporter) return;
    if (!Array.isArray(HWP_NOTIFY_EMAILS) || HWP_NOTIFY_EMAILS.length === 0) return;

    const subject = `[HWP 요청] 새 요청 접수 (${hwpDoc.username || '게스트'})`;
    const textLines = [
      '새로운 HWP 변환 요청이 접수되었습니다.',
      '',
      `요청 ID: ${hwpDoc._id?.toString?.() || hwpDoc.id || '-'}`,
      `요청자 이메일: ${hwpDoc.email || '-'}`,
      `요청자 이름: ${hwpDoc.username || '-'}`,
      `문항 개수: ${(hwpDoc.problemIds || []).length}`,
      '',
      '관리자 페이지에서 상세 내용을 확인하고 처리해주세요.'
    ];

    await mailTransporter.sendMail({
      from: EMAIL_FROM,
      to: HWP_NOTIFY_EMAILS,
      subject,
      text: textLines.join('\n')
    });
  } catch (e) {
    console.error('HWP 요청 알림 메일 발송 실패:', e);
  }
}

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

// 파일명 정규화: mojibake 감지 시에만 latin1→utf8 변환 후 NFC 정규화
function normalizeFilename(name) {
  if (!name) return name;
  const toNFC = (s) => (typeof s.normalize === 'function' ? s.normalize('NFC') : s);

  // 흔한 모지바케 패턴들: Ã, Â, �(U+FFFD)
  const looksMojibake = /[ÃÂ�]/.test(name);

  // latin1→utf8 재해석 후보
  let converted;
  try {
    converted = Buffer.from(name, 'latin1').toString('utf8');
  } catch (_) {
    converted = name;
  }

  // 한글(자모/완성형) 개수 비교로 품질 판단
  const countCJK = (s) => (s && s.match(/[\u3131-\u318E\uAC00-\uD7A3\u1100-\u11FF]/g) || []).length;
  const cjkOriginal = countCJK(name);
  const cjkConverted = countCJK(converted);

  if (looksMojibake || cjkConverted > cjkOriginal) {
    return toNFC(converted);
  }
  return toNFC(name);
}

// multer storage 설정 - 한글 파일명 인코딩 처리
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // 파일명 정규화는 여기서 한 번만 수행
    const normalizedName = normalizeFilename(file.originalname);
    file.originalname = normalizedName;

    // 디스크에는 타임스탬프로 저장 (충돌 방지)
    const timestamp = Date.now();
    const ext = path.extname(normalizedName);
    cb(null, `${timestamp}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

// Mathpix API 설정은 이제 Python 스크립트에서 처리

// MongoDB 설정
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE;

// 디버그: 환경변수 확인
console.log('현재 작업 디렉토리:', process.cwd());
console.log('MONGODB_URI 로드됨:', MONGODB_URI ? '✓' : '✗');
console.log('MONGODB_DATABASE 로드됨:', MONGODB_DATABASE ? '✓' : '✗');

// MongoDB 연결
let db;
let client;

async function connectToMongoDB() {
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI가 설정되지 않았습니다.');
    }
    
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(MONGODB_DATABASE);
    console.log('✅ MongoDB 연결 성공');
    
    // 연결 테스트
    await db.admin().ping();
    console.log('✅ MongoDB 핑 성공');
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB 연결 실패:', error.message);
    throw error;
  }
}

// 쿠키 파싱 함수
function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.trim().split('=');
      if (parts.length === 2) {
        cookies[parts[0]] = decodeURIComponent(parts[1]);
      }
    });
  }
  return cookies;
}

// 세션 ID 생성 함수
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 세션 저장소 (메모리)
const sessions = new Map();

// 서버 시작 시 MongoDB 연결 (환경변수 확인 후)
if (MONGODB_URI && MONGODB_DATABASE) {
  connectToMongoDB().catch(console.error);
} else {
  console.log('⚠️ MongoDB 환경변수가 설정되지 않았습니다. 로그인/회원가입 기능이 비활성화됩니다.');
}

async function convertPdfToText(pdfPath, sessionId = null) {
  return new Promise((resolve, reject) => {
    console.log(`PDF 변환 시작 (Python): ${pdfPath}`);

    // 진행상황 전송
    if (sessionId) {
      sendProgress(sessionId, 20, 'PDF 변환 중...');
    }

    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
    const pythonProcess = spawn(PYTHON_BIN, ['pipeline/convert_pdf.py', '--pdf', pdfPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';
    let totalEstimatedTime = null;  // 전체 예상 시간 (한 번만 계산)

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      console.log('Python Convert stdout:', output);

      // 진행상황 파싱
      if (sessionId) {
        // [PDF진행] 패턴 파싱: [PDF진행] 10/200 페이지 (5%) - 예상 남은 시간: 380초
        const progressMatch = output.match(/\[PDF진행\]\s+(\d+)\/(\d+)\s+페이지\s+\((\d+)%\)\s+-\s+예상 남은 시간:\s+(\d+)초/);
        if (progressMatch) {
          const [, current, total, percentage] = progressMatch;

          // 전체 예상 시간은 처음 한 번만 계산
          if (totalEstimatedTime === null) {
            const totalPages = parseInt(total);
            // 전체 파이프라인 예상 시간 (초 단위)
            const pdfTime = totalPages * 0.7;      // PDF 변환: 페이지당 0.7초
            const filterTime = 0;                  // 필터링: 0초 (무시)
            const splitTime = 0;                   // 분할: 0초 (무시)
            const llmTime = totalPages * 2;        // AI 구조화: 페이지당 2초

            let totalSeconds = pdfTime + filterTime + splitTime + llmTime;

            // 10초 미만이면 10초로 설정
            if (totalSeconds < 10) totalSeconds = 10;

            // 10초 단위로 버림
            totalSeconds = Math.floor(totalSeconds / 10) * 10;

            // 분과 초로 변환
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            totalEstimatedTime = seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`;
          }

          const progress = 15 + Math.floor(parseInt(percentage) * 0.25); // 15%~40% 범위
          sendProgress(sessionId, progress, `PDF 변환 중 ${current}/${total}페이지 | 전체 예상: 약 ${totalEstimatedTime}`);
        }

        // 변환 완료 메시지
        if (output.includes('페이지당')) {
          sendProgress(sessionId, 40, 'PDF 변환 완료');
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python Convert stderr:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python PDF 변환 완료');

        // output/result.paged.mmd 파일 읽기
        try {
          const resultPath = 'output/result.paged.mmd';
          if (fs.existsSync(resultPath)) {
            const result = fs.readFileSync(resultPath, 'utf8');
            resolve(result);
          } else {
            reject(new Error('변환 결과 파일을 찾을 수 없습니다: ' + resultPath));
          }
        } catch (error) {
          reject(new Error(`결과 파일 읽기 실패: ${error.message}`));
        }
      } else {
        console.error(`Python PDF 변환 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`PDF 변환 스크립트 실행 실패: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python 프로세스 오류:', error.message);
      reject(new Error(`Python 실행 오류: ${error.message}`));
    });
  });
}


async function runPythonFilter() {
  const startTime = Date.now();
  const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
  const scriptPath = path.resolve(__dirname, 'pipeline/filter_pages.py');
  return new Promise((resolve, reject) => {
    console.log('Python 필터링 스크립트 실행 중...');

    const pythonProcess = spawn(PYTHON_BIN, ['pipeline/filter_pages.py'], {
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
  const startTime = Date.now();
  const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
  const scriptPath = path.resolve(__dirname, 'pipeline/split.py');
  return new Promise((resolve, reject) => {
    console.log('Python split 스크립트 실행 중...');

    const pythonProcess = spawn(PYTHON_BIN, ['pipeline/split.py'], {
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

async function runPythonLLMStructure(sessionId = null, userId = null, filename = 'problems.json') {
  const startTime = Date.now(); // ✅ 항상 먼저 선언
  const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
  return new Promise((resolve, reject) => {
    console.log('Python LLM structure 스크립트 실행 중...');

    // 즉시 시작 메시지 전송
    if (sessionId) {
      sendProgress(sessionId, 70, 'AI 구조화 준비 중...');
    }

    // userId와 filename을 커맨드라인 인자로 전달 (한글 지원)
    const args = ['pipeline/llm_structure.py'];
    if (userId) {
      args.push('--user-id', userId);
    }
    if (filename) {
      args.push('--filename', filename);
    }

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1'
    };

    const pythonProcess = spawn(PYTHON_BIN, args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
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
  const startTime = Date.now();
  const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
  const scriptPath = path.resolve(__dirname, 'pipeline/generate_pdf.py');
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

    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
    const pythonProcess = spawn(PYTHON_BIN, ['pipeline/generate_pdf.py'], {
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
  const startTime = Date.now();
  const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
  const scriptPath = path.resolve(__dirname, 'pipeline/capture_pdf.py');
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

    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
    const pythonProcess = spawn(PYTHON_BIN, ['pipeline/capture_pdf.py'], {
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
  // URL 파싱 (쿼리스트링 제거된 pathname 사용)
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
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

  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/') {
    const isHeadRequest = req.method === 'HEAD';
    // 방문자 추적
    (async () => {
      try {
        if (db) {
          const visitData = {
            timestamp: new Date(),
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'] || 'Unknown',
            userId: null // 익명 방문자
          };

          // Cookie에서 userId 추출 시도
          const cookies = req.headers.cookie;
          if (cookies) {
            const sessionMatch = cookies.match(/sessionId=([^;]+)/);
            if (sessionMatch) {
              const sessionId = sessionMatch[1];
              const session = await db.collection('sessions').findOne({ sessionId });
              if (session && session.userId) {
                visitData.userId = session.userId;
              }
            }
          }

          await db.collection('visits').insertOne(visitData);
          console.log(`📊 방문 기록: ${visitData.ip} (userId: ${visitData.userId || '익명'})`);
        }
      } catch (error) {
        console.error('방문자 추적 오류:', error);
        // 추적 실패해도 페이지는 정상 제공
      }
    })();

    // Serve index.html (HEAD 요청은 바디 없이 헤더만 전송)
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end(isHeadRequest ? '' : 'index.html not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate'
      });
      res.end(isHeadRequest ? '' : data);
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
  } else if (req.method === 'GET' && pathname.endsWith('.html')) {
    // 정적 HTML 파일 서빙 (쿼리스트링 무시)
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate'
      });
      fs.createReadStream(filePath, 'utf8').pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
    }
  } else if (req.method === 'GET' && (req.url.includes('.js') || req.url.includes('.css') || req.url.includes('.ico'))) {
    // 정적 파일 서빙 (쿼리스트링 무시)
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const pathname = urlObj.pathname; // '/app.js?v=123' -> '/app.js'
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.ico': 'image/x-icon'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType + '; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
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
          url: captureData.url || process.env.BASE_URL || 'http://localhost:3000',
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

        // 생성된 PDF 파일 확인 (파일 시스템 동기화를 위한 대기)
        const pdfPath = 'build/exam.pdf';

        // 파일이 완전히 쓰여질 때까지 대기 (최대 5초)
        let attempts = 0;
        let pdfStats = null;
        while (attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));

          if (fs.existsSync(pdfPath)) {
            pdfStats = fs.statSync(pdfPath);
            console.log(`📄 PDF 파일 크기: ${pdfStats.size} bytes (시도 ${attempts + 1}/10)`);

            // 파일 크기가 1KB 이상이면 정상적으로 생성된 것으로 간주
            if (pdfStats.size > 1000) {
              break;
            }
          }
          attempts++;
        }

        if (fs.existsSync(pdfPath)) {
          const pdfStats = fs.statSync(pdfPath);

          if (pdfStats.size < 1000) {
            throw new Error(`PDF 파일이 비어있거나 손상되었습니다 (크기: ${pdfStats.size} bytes)`);
          }

          console.log(`✅ PDF 파일 읽기 시작 (크기: ${pdfStats.size} bytes)`);

          // PDF 파일을 base64로 인코딩하여 반환
          const pdfBuffer = fs.readFileSync(pdfPath);
          const pdfBase64 = pdfBuffer.toString('base64');

          console.log(`✅ Base64 인코딩 완료 (길이: ${pdfBase64.length})`);

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
  } else if (req.method === 'POST' && req.url === '/api/register') {
    // 회원가입 API
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { username, email, password, role } = JSON.parse(body);

        // 입력 검증
        if (!username || !email || !password || !role) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '모든 필드를 입력해주세요.'
          }));
          return;
        }

        // 이메일 형식 검증
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '올바른 이메일 형식이 아닙니다.'
          }));
          return;
        }

        // 비밀번호 길이 검증
        if (password.length < 6) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '비밀번호는 최소 6자 이상이어야 합니다.'
          }));
          return;
        }

        // 역할 검증
        if (!['teacher', 'student'].includes(role)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '올바른 역할을 선택해주세요.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스 연결이 없습니다. 서버 관리자에게 문의하세요.'
          }));
          return;
        }

        const usersCollection = db.collection('users');

        // 중복 검사
        const existingUser = await usersCollection.findOne({
          $or: [{ email }, { username }]
        });

        if (existingUser) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: existingUser.email === email ? '이미 사용 중인 이메일입니다.' : '이미 사용 중인 사용자명입니다.'
          }));
          return;
        }

        // 비밀번호 해시화
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 사용자 생성
        const now = new Date();
        const newUser = {
          username,
          email,
          password: hashedPassword,
          role,
          // 기본 요금제/결제 상태 (카드사 심사 전이므로 모두 basic + 미결제 상태)
          plan: 'basic',
          isPaid: false,
          isTrial: false,
          createdAt: now,
          updatedAt: now,
          signupUserAgent: req.headers['user-agent'] || null
        };

        const result = await usersCollection.insertOne(newUser);

        // 자동 로그인 제거: 세션 생성/쿠키 설정 없이 성공 메시지만 반환
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          message: '회원가입이 완료되었습니다.'
        }));

      } catch (error) {
        console.error('회원가입 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '회원가입 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/login') {
    // 로그인 API
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { email, password } = JSON.parse(body);

        // 입력 검증
        if (!email || !password) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '이메일과 비밀번호를 입력해주세요.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스 연결이 없습니다. 서버 관리자에게 문의하세요.'
          }));
          return;
        }

        const usersCollection = db.collection('users');

        // 사용자 찾기
        const user = await usersCollection.findOne({ email });

        if (!user) {
          res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '이메일 또는 비밀번호가 올바르지 않습니다.'
          }));
          return;
        }

        // 비밀번호 검증
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '이메일 또는 비밀번호가 올바르지 않습니다.'
          }));
          return;
        }

        // 세션 생성
        const sessionId = generateSessionId();
        sessions.set(sessionId, {
          userId: user._id.toString(),
          username: user.username,
          role: user.role,
          plan: user.plan || 'basic',
          createdAt: new Date()
        });

        // 로그인 성공
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=${24 * 60 * 60}`
        });
        res.end(JSON.stringify({
          success: true,
          message: '로그인 성공',
          sessionId: sessionId,
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            plan: user.plan || 'basic',
            isPaid: !!user.isPaid
          }
        }));

      } catch (error) {
        console.error('로그인 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '로그인 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/logout') {
    // 쿠키에서 세션 ID 가져오기
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.sessionId;
    
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
    
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'sessionId=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({
      success: true,
      message: '로그아웃 성공'
    }));
  } else if (req.method === 'POST' && req.url === '/api/plan') {
    // 요금제 변경 API (basic/pro만, 결제 없이 상태만 기록)
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;
        const session = sessionId && sessions.get(sessionId);

        if (!session) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '잘못된 요청 형식입니다.'
          }));
          return;
        }

        const plan = (parsed.plan || '').toLowerCase();
        const allowedPlans = ['basic', 'pro'];
        if (!allowedPlans.includes(plan)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '허용되지 않는 요금제입니다.'
          }));
          return;
        }

        const usersCollection = db.collection('users');
        const userId = new ObjectId(session.userId);

        const updateDoc = {
          plan,
          updatedAt: new Date()
          // isPaid는 실제 결제 연동 이후에만 true로 설정 (현재는 모두 false 유지)
        };

        const result = await usersCollection.updateOne(
          { _id: userId },
          { $set: updateDoc }
        );

        if (result.matchedCount === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '사용자를 찾을 수 없습니다.'
          }));
          return;
        }

        // 메모리 세션에도 반영 (선택 사항)
        const sess = sessions.get(sessionId);
        if (sess) {
          sess.plan = plan;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          plan
        }));
      } catch (error) {
        console.error('요금제 변경 오류:', error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          message: '요금제 변경 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/billing/issue') {
    // 토스 자동결제(빌링) - 카드 등록 성공 후 빌링키 발급 및 사용자 DB에 저장
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;
        const session = sessionId && sessions.get(sessionId);

        if (!session) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        if (!TOSS_BILLING_SECRET_KEY) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '자동결제용 토스 시크릿 키가 설정되지 않았습니다. (TOSS_BILLING_SECRET_KEY)'
          }));
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '잘못된 요청 형식입니다.'
          }));
          return;
        }

        const authKey = parsed.authKey;
        const customerKey = parsed.customerKey;

        if (!authKey || !customerKey) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: 'authKey와 customerKey가 필요합니다.'
          }));
          return;
        }

        const basicToken = Buffer.from(TOSS_BILLING_SECRET_KEY + ':').toString('base64');

        try {
          const tossRes = await axios.post(
            'https://api.tosspayments.com/v1/billing/authorizations/issue',
            {
              authKey,
              customerKey
            },
            {
              headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/json'
              },
              timeout: 10000
            }
          );

          const billingData = tossRes.data || {};
          const billingKey = billingData.billingKey;

          if (!billingKey) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: false,
              message: '토스페이먼츠에서 billingKey를 반환하지 않았습니다.',
              raw: billingData
            }));
            return;
          }

          const usersCollection = db.collection('users');
          const userId = new ObjectId(session.userId);

          await usersCollection.updateOne(
            { _id: userId },
            {
              $set: {
                billingKey,
                billingCustomerKey: customerKey,
                billingCardInfo: billingData.card || null,
                billingStatus: 'registered',
                billingUpdatedAt: new Date()
              }
            }
          );

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            billingKey,
            customerKey
          }));
        } catch (err) {
          console.error('빌링키 발급 오류:', err.response?.data || err.message || err);

          const status = err.response?.status || 500;
          const data = err.response?.data || {
            message: '빌링키 발급 중 오류가 발생했습니다.'
          };

          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            ...data
          }));
        }
      } catch (error) {
        console.error('빌링키 발급 처리 오류:', error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          message: '빌링키 발급 처리 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/billing/charge-now') {
    // 토스 자동결제(빌링) - 발급된 billingKey로 즉시 한 번 결제 (테스트/데모용)
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;
        const session = sessionId && sessions.get(sessionId);

        if (!session) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        if (!TOSS_BILLING_SECRET_KEY) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '자동결제용 토스 시크릿 키가 설정되지 않았습니다. (TOSS_BILLING_SECRET_KEY)'
          }));
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '잘못된 요청 형식입니다.'
          }));
          return;
        }

        const defaultAmount = 9900;
        const amount = Number(parsed.amount || defaultAmount);

        const usersCollection = db.collection('users');
        const userId = new ObjectId(session.userId);
        const user = await usersCollection.findOne({ _id: userId });

        const billingKey = parsed.billingKey || user?.billingKey;
        const customerKey = parsed.customerKey || user?.billingCustomerKey;

        if (!billingKey || !customerKey) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            message: '등록된 결제 카드가 없습니다. 먼저 카드 등록을 완료해주세요.'
          }));
          return;
        }

        const orderId = parsed.orderId || `ZTYPING_SUB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const basicToken = Buffer.from(TOSS_BILLING_SECRET_KEY + ':').toString('base64');

        try {
          const tossRes = await axios.post(
            `https://api.tosspayments.com/v1/billing/${billingKey}`,
            {
              customerKey,
              amount,
              orderId,
              orderName: 'ZeroTyping Pro 월 정기결제',
              currency: 'KRW'
            },
            {
              headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/json'
              },
              timeout: 10000
            }
          );

          const payment = tossRes.data || {};

          // 결제가 성공했으면 사용자 플랜/결제 상태 업데이트
          await usersCollection.updateOne(
            { _id: userId },
            {
              $set: {
                plan: 'pro',
                isPaid: true,
                billingStatus: 'active',
                lastPaidAt: payment.approvedAt ? new Date(payment.approvedAt) : new Date()
              }
            }
          );

          // 세션에도 반영
          const sess = sessions.get(sessionId);
          if (sess) {
            sess.plan = 'pro';
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            payment
          }));
        } catch (err) {
          console.error('정기결제 승인 오류:', err.response?.data || err.message || err);

          const status = err.response?.status || 500;
          const data = err.response?.data || {
            message: '정기결제 승인 중 오류가 발생했습니다.'
          };

          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            ...data
          }));
        }
      } catch (error) {
        console.error('정기결제 처리 오류:', error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          message: '정기결제 처리 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/api/my-files') {
    // 사용자 파일 및 폴더 목록 조회 (로그인 필요)
    (async () => {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies.sessionId;

      // 세션 확인
      let userId = null;
      if (sessionId && sessions.has(sessionId)) {
        userId = sessions.get(sessionId).userId;
      }

      // 로그인하지 않은 경우 빈 배열 반환
      if (!userId) {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          files: [],
          folders: [],
          message: '로그인이 필요합니다.'
        }));
        return;
      }

      if (!db) {
        res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '데이터베이스에 연결할 수 없습니다.'
        }));
        return;
      }

      try {
        // 해당 사용자의 파일 목록 조회
        const files = await db.collection('files').find({
          userId: new ObjectId(userId)
        }).sort({ uploadDate: -1 }).toArray();

        // 해당 사용자의 폴더 목록 조회
        const folders = await db.collection('folders').find({
          userId: new ObjectId(userId)
        }).sort({ createdAt: 1 }).toArray();

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          files: files,
          folders: folders
        }));
      } catch (error) {
        console.error('파일 목록 조회 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '파일 목록 조회 중 오류가 발생했습니다.'
        }));
      }
    })();
  } else if (req.method === 'GET' && req.url.startsWith('/api/my-problems/')) {
    // 특정 파일의 문제 목록 조회 (로그인 필요)
    (async () => {
      const fileId = req.url.split('/').pop();
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies.sessionId;

      // 세션 확인
      let userId = null;
      if (sessionId && sessions.has(sessionId)) {
        userId = sessions.get(sessionId).userId;
      }

      if (!userId) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '로그인이 필요합니다.'
        }));
        return;
      }

      if (!db) {
        res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '데이터베이스에 연결할 수 없습니다.'
        }));
        return;
      }

      try {
        // 해당 파일의 문제 목록 조회 (사용자 확인)
        const problems = await db.collection('problems').find({
          fileId: new ObjectId(fileId),
          userId: new ObjectId(userId)
        }).sort({ id: 1 }).toArray();

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          problems: problems
        }));
      } catch (error) {
        console.error('문제 목록 조회 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '문제 목록 조회 중 오류가 발생했습니다.'
        }));
      }
    })();
  } else if (req.method === 'DELETE' && req.url.startsWith('/api/delete-file/')) {
    // 파일 삭제 API (로그인 필요)
    (async () => {
      const fileId = req.url.split('/').pop();
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies.sessionId;

      // 세션 확인
      let userId = null;
      if (sessionId && sessions.has(sessionId)) {
        userId = sessions.get(sessionId).userId;
      }

      if (!userId) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '로그인이 필요합니다.'
        }));
        return;
      }

      if (!db) {
        res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '데이터베이스에 연결할 수 없습니다.'
        }));
        return;
      }

      try {
        // 파일 소유자 확인
        const file = await db.collection('files').findOne({
          _id: new ObjectId(fileId),
          userId: new ObjectId(userId)
        });

        if (!file) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '파일을 찾을 수 없거나 삭제 권한이 없습니다.'
          }));
          return;
        }

        // 해당 파일의 모든 문제 삭제
        const problemsDeleteResult = await db.collection('problems').deleteMany({
          fileId: new ObjectId(fileId),
          userId: new ObjectId(userId)
        });

        // 파일 삭제
        const fileDeleteResult = await db.collection('files').deleteOne({
          _id: new ObjectId(fileId),
          userId: new ObjectId(userId)
        });

        console.log(`✅ 파일 삭제 완료 - 파일 ID: ${fileId}, 삭제된 문제 수: ${problemsDeleteResult.deletedCount}`);

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '파일과 관련 문제가 삭제되었습니다.',
          deletedProblems: problemsDeleteResult.deletedCount
        }));
      } catch (error) {
        console.error('파일 삭제 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '파일 삭제 중 오류가 발생했습니다.'
        }));
      }
    })();
  } else if (req.method === 'POST' && req.url === '/api/create-folder') {
    // 폴더 생성 API
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { folderName, parentPath } = JSON.parse(body);
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;

        let userId = null;
        if (sessionId && sessions.has(sessionId)) {
          userId = sessions.get(sessionId).userId;
        }

        if (!userId) {
          res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        const folderDoc = {
          userId: new ObjectId(userId),
          name: folderName,
          parentPath: parentPath || '내 파일',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await db.collection('folders').insertOne(folderDoc);

        console.log(`✅ 폴더 생성 완료 - ${folderName}`);

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          folder: { _id: result.insertedId, ...folderDoc }
        }));
      } catch (error) {
        console.error('폴더 생성 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '폴더 생성 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'DELETE' && req.url.startsWith('/api/delete-folder/')) {
    // 폴더 삭제 API
    (async () => {
      const folderId = req.url.split('/').pop();
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies.sessionId;

      let userId = null;
      if (sessionId && sessions.has(sessionId)) {
        userId = sessions.get(sessionId).userId;
      }

      if (!userId) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '로그인이 필요합니다.'
        }));
        return;
      }

      if (!db) {
        res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '데이터베이스에 연결할 수 없습니다.'
        }));
        return;
      }

      try {
        const result = await db.collection('folders').deleteOne({
          _id: new ObjectId(folderId),
          userId: new ObjectId(userId)
        });

        if (result.deletedCount === 0) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '폴더를 찾을 수 없습니다.'
          }));
          return;
        }

        console.log(`✅ 폴더 삭제 완료 - ${folderId}`);

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '폴더가 삭제되었습니다.'
        }));
      } catch (error) {
        console.error('폴더 삭제 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '폴더 삭제 중 오류가 발생했습니다.'
        }));
      }
    })();
  } else if (req.method === 'PUT' && req.url.startsWith('/api/rename-folder/')) {
    // 폴더 이름 변경 API
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const folderId = req.url.split('/').pop();
        const { newName } = JSON.parse(body);
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;

        let userId = null;
        if (sessionId && sessions.has(sessionId)) {
          userId = sessions.get(sessionId).userId;
        }

        if (!userId) {
          res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        const result = await db.collection('folders').updateOne(
          {
            _id: new ObjectId(folderId),
            userId: new ObjectId(userId)
          },
          {
            $set: {
              name: newName.trim(),
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '폴더를 찾을 수 없습니다.'
          }));
          return;
        }

        console.log(`✅ 폴더 이름 변경 완료 - ${folderId} → ${newName}`);

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '폴더 이름이 변경되었습니다.',
          newName: newName.trim()
        }));
      } catch (error) {
        console.error('폴더 이름 변경 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '폴더 이름 변경 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'PUT' && req.url.startsWith('/api/rename-file/')) {
    // 파일 이름 변경 API (로그인 필요)
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const fileId = req.url.split('/').pop();
        const { newName } = JSON.parse(body);
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;

        // 세션 확인
        let userId = null;
        if (sessionId && sessions.has(sessionId)) {
          userId = sessions.get(sessionId).userId;
        }

        if (!userId) {
          res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!newName || newName.trim() === '') {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '새 파일명을 입력해주세요.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        // 파일 소유자 확인 및 이름 변경
        const result = await db.collection('files').updateOne(
          {
            _id: new ObjectId(fileId),
            userId: new ObjectId(userId)
          },
          {
            $set: {
              filename: newName.trim(),
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '파일을 찾을 수 없거나 수정 권한이 없습니다.'
          }));
          return;
        }

        console.log(`✅ 파일 이름 변경 완료 - 파일 ID: ${fileId}, 새 이름: ${newName}`);

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '파일 이름이 변경되었습니다.',
          newName: newName.trim()
        }));
      } catch (error) {
        console.error('파일 이름 변경 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '파일 이름 변경 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'PUT' && req.url.startsWith('/api/move-item')) {
    // 파일 또는 폴더 이동 API (parentPath 업데이트)
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { itemId, itemType, newParentPath } = JSON.parse(body);
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;

        // 세션 확인
        let userId = null;
        if (sessionId && sessions.has(sessionId)) {
          userId = sessions.get(sessionId).userId;
        }

        if (!userId) {
          res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '로그인이 필요합니다.'
          }));
          return;
        }

        if (!db) {
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '데이터베이스에 연결할 수 없습니다.'
          }));
          return;
        }

        // 컬렉션 선택
        const collection = itemType === 'file' ? 'files' : 'folders';

        // 아이템 소유자 확인 및 parentPath 업데이트
        const result = await db.collection(collection).updateOne(
          {
            _id: new ObjectId(itemId),
            userId: new ObjectId(userId)
          },
          {
            $set: {
              parentPath: newParentPath,
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '항목을 찾을 수 없거나 수정 권한이 없습니다.'
          }));
          return;
        }

        console.log(`✅ ${itemType} 이동 완료 - ID: ${itemId}, 새 경로: ${newParentPath}`);

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '항목이 이동되었습니다.'
        }));
      } catch (error) {
        console.error('항목 이동 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '항목 이동 중 오류가 발생했습니다.'
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/generate-pdf') {
    // PDF 생성 API
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const examData = JSON.parse(body);

        console.log('🔧 PDF 생성 요청 수신:', examData.problems?.length || 0, '개 문제');
        console.log('🔧 examData 전체:', JSON.stringify(examData, null, 2));

        // Python PDF 생성기 호출
        const result = await runPythonPDFGenerator(examData);

        // 생성된 PDF 파일 확인 (파일 시스템 동기화를 위한 대기)
        const pdfPath = 'build/exam.pdf';

        // 파일이 완전히 쓰여질 때까지 대기 (최대 5초)
        let attempts = 0;
        let pdfStats = null;
        while (attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));

          if (fs.existsSync(pdfPath)) {
            pdfStats = fs.statSync(pdfPath);
            console.log(`📄 PDF 파일 크기: ${pdfStats.size} bytes (시도 ${attempts + 1}/10)`);

            // 파일 크기가 1KB 이상이면 정상적으로 생성된 것으로 간주
            if (pdfStats.size > 1000) {
              break;
            }
          }
          attempts++;
        }

        if (fs.existsSync(pdfPath)) {
          const pdfStats = fs.statSync(pdfPath);

          if (pdfStats.size < 1000) {
            throw new Error(`PDF 파일이 비어있거나 손상되었습니다 (크기: ${pdfStats.size} bytes)`);
          }

          console.log(`✅ PDF 파일 읽기 시작 (크기: ${pdfStats.size} bytes)`);

          // PDF 파일을 base64로 인코딩하여 반환
          const pdfBuffer = fs.readFileSync(pdfPath);
          const pdfBase64 = pdfBuffer.toString('base64');

          console.log(`✅ Base64 인코딩 완료 (길이: ${pdfBase64.length})`);

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
    // 쿠키에서 세션 ID 가져오기
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.sessionId;
    // Bearer 헤더 허용 (프런트에서 전달 가능한 보조 수단)
    const authHeader = req.headers['authorization'] || '';
    const bearer = authHeader.startsWith('Bearer ')? authHeader.slice(7).trim(): null;
    
    // 세션 확인
    let userId = null;
    if (sessionId && sessions.has(sessionId)) {
      userId = sessions.get(sessionId).userId;
    } else if (bearer && sessions.has(bearer)) {
      userId = sessions.get(bearer).userId;
    }
    
    if (!userId) {
      res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({
        success: false,
        message: '로그인이 필요합니다.'
      }));
      return;
    }

    const uploadSingle = upload.single('pdf');
    uploadSingle(req, res, async (err) => {
      if (err) {
        // 파일 크기 제한 초과 시 413 반환
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ success: false, message: '업로드 용량 제한(10MB)을 초과했습니다.' }));
          return;
        }
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

        // 원본 파일 저장 (Python 스크립트가 output 폴더에 저장하므로 중복 저장 제거)
        console.log('\n💾 원본 파일 저장...');
        sendProgress(sessionId, 45, '텍스트 저장 중...');
        const saveStartTime = Date.now();
        // output 폴더가 없으면 생성
        if (!fs.existsSync('output')) {
          fs.mkdirSync('output', { recursive: true });
        }
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
        await runPythonLLMStructure(sessionId, userId, req.file.originalname);
        const llmEndTime = Date.now();
        console.log(`✅ AI 구조화 완료 - 소요시간: ${((llmEndTime - llmStartTime) / 1000).toFixed(2)}초`);
        sendProgress(sessionId, 90, 'AI 구조화 완료');

        // MongoDB에서 저장된 파일과 문제 데이터 조회
        let problemCount = 0;
        let fileId = null;
        let problems = [];
        try {
          if (db) {
            // 가장 최근에 업로드된 파일 조회
            const recentFile = await db.collection('files').findOne(
              { userId: userId ? new ObjectId(userId) : { $exists: false } },
              { sort: { uploadDate: -1 } }
            );
            if (recentFile) {
              fileId = recentFile._id.toString();
              problemCount = recentFile.problemCount || 0;
              console.log(`✅ MongoDB에서 파일 ID ${fileId} 확인, 문제 ${problemCount}개`);

              // 해당 파일의 문제들 조회
              problems = await db.collection('problems').find({
                fileId: new ObjectId(fileId),
                userId: new ObjectId(userId)
              }).sort({ id: 1 }).toArray();
              console.log(`✅ MongoDB에서 문제 ${problems.length}개 로드 완료`);
              if (problems.length > 0) {
                console.log(`   첫 번째 문제 _id: ${problems[0]._id}`);
                console.log(`   첫 번째 문제 전체:`, JSON.stringify(problems[0], null, 2).substring(0, 300));
              }
            }
          }
        } catch (error) {
          console.error('MongoDB 데이터 조회 오류:', error);
        }

        sendProgress(sessionId, 100, '처리 완료!');

        // 전체 처리 시간 요약
        const totalTime = Date.now() - startTime;
        console.log('\n' + '='.repeat(60));
        console.log('🎉 전체 처리 완료!');
        console.log('='.repeat(60));
        console.log(`📁 파일명: ${req.file.originalname}`);
        console.log(`📝 추출된 텍스트: ${extractedText.length.toLocaleString()} 문자`);
        console.log(`🔢 분할된 문제 수: ${problemCount}개`);
        console.log(`⏱️ 총 소요시간: ${(totalTime / 1000).toFixed(2)}초 (${(totalTime / 60000).toFixed(1)}분)`);
        console.log('='.repeat(60) + '\n');

        // MongoDB 저장은 llm_structure.py에서 직접 처리됨
        console.log(`✅ 파일 처리 완료 - MongoDB에 직접 저장됨`);

        // JSON 응답 반환 (problems 배열과 fileId 포함)
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: true,
          message: '파일 처리 완료',
          problemCount: problemCount,
          fileId: fileId,
          filename: req.file.originalname,
          problems: problems,
          stats: {
            originalTextLength: extractedText.length,
            problemCount: problemCount,
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

  // ===== 관리자 페이지 =====
  } else if (req.method === 'GET' && req.url === '/admin') {
    // 관리자 페이지 제공
    const adminHtml = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate'
    });
    res.end(adminHtml);

  } else if (req.method === 'POST' && req.url === '/api/admin/auth') {
    // 관리자 인증
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { password } = JSON.parse(body);
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

      if (password === ADMIN_PASSWORD) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: false, message: '비밀번호가 올바르지 않습니다.' }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/api/admin/stats') {
    // 관리자 통계 API
    const adminPassword = req.headers['x-admin-password'];
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

    if (adminPassword !== ADMIN_PASSWORD) {
      res.writeHead(401, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: '인증이 필요합니다.' }));
      return;
    }

    (async () => {
      try {
      if (!db) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: 'Database not connected' }));
        return;
      }

      // 오늘 날짜 (자정)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 7일 전
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // 기본 통계
      const totalUsers = await db.collection('users').countDocuments();
      const todayUsers = await db.collection('users').countDocuments({
        createdAt: { $gte: today }
      });

      const totalConversions = await db.collection('files').countDocuments();
      const todayConversions = await db.collection('files').countDocuments({
        uploadDate: { $gte: today }
      });

      const totalProblems = await db.collection('problems').countDocuments();
      const avgProblemsPerFile = totalConversions > 0 ? Math.round(totalProblems / totalConversions) : 0;

      // 방문자 통계 (visits 컬렉션이 있다면)
      let todayVisitors = 0;
      let activeUsers = 0;
      try {
        todayVisitors = await db.collection('visits').countDocuments({
          timestamp: { $gte: today }
        });

        // 최근 24시간 내 활동 사용자
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        activeUsers = await db.collection('visits').distinct('userId', {
          timestamp: { $gte: oneDayAgo }
        }).then(arr => arr.length);
      } catch (e) {
        // visits 컬렉션이 없으면 0으로 표시
      }

      // 최근 7일 변환 추이
      const conversionTrendData = await db.collection('files').aggregate([
        { $match: { uploadDate: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$uploadDate" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]).toArray();

      // 최근 7일 가입 추이
      const userTrendData = await db.collection('users').aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]).toArray();

      // 7일치 레이블 생성
      const labels = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toISOString().split('T')[0]);
      }

      // 데이터 매핑
      const conversionData = labels.map(label => {
        const found = conversionTrendData.find(item => item._id === label);
        return found ? found.count : 0;
      });

      const userData = labels.map(label => {
        const found = userTrendData.find(item => item._id === label);
        return found ? found.count : 0;
      });

      // 최근 가입자 (최근 10명)
      const recentUsers = await db.collection('users')
        .find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();

      // TOP 사용자 (변환 수 기준)
      const topUsers = await db.collection('files').aggregate([
        {
          $group: {
            _id: "$userId",
            conversionCount: { $sum: 1 }
          }
        },
        { $sort: { conversionCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "userInfo"
          }
        },
        { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } }
      ]).toArray();

      const response = {
        stats: {
          totalUsers,
          todayUsers,
          totalConversions,
          todayConversions,
          totalProblems,
          avgProblemsPerFile,
          todayVisitors,
          activeUsers
        },
        charts: {
          conversionTrend: {
            labels: labels.map(l => l.substring(5)), // MM-DD 형식
            data: conversionData
          },
          userTrend: {
            labels: labels.map(l => l.substring(5)),
            data: userData
          }
        },
        tables: {
          recentUsers: recentUsers.map(u => ({
            username: u.username || 'N/A',
            email: u.email || 'N/A',
            role: u.role || 'student',
            createdAt: new Date(u.createdAt).toLocaleDateString('ko-KR')
          })),
          topUsers: topUsers.map(item => ({
            username: item.userInfo?.username || 'Unknown',
            email: item.userInfo?.email || 'N/A',
            conversionCount: item.conversionCount
          }))
        }
      };

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(response));

      } catch (error) {
        console.error('관리자 통계 API 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '통계 데이터를 불러오는 중 오류가 발생했습니다.' }));
      }
    })();

  // ===== 관리자 페이지 v2 =====
  } else if (req.method === 'GET' && req.url === '/admin/v2') {
    // 관리자 v2 페이지 제공
    const adminV2Html = fs.readFileSync(path.join(__dirname, 'admin/v2.html'), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate'
    });
    res.end(adminV2Html);

  } else if (req.method === 'GET' && req.url.startsWith('/api/admin/v2/')) {
    // 관리자 v2 API
    const adminPassword = req.headers['x-admin-password'];
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

    if (adminPassword !== ADMIN_PASSWORD) {
      res.writeHead(401, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: '인증이 필요합니다.' }));
      return;
    }

    // URL 파싱
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const params = url.searchParams;

    // v2 모듈 로드
    const filters = require('./admin/modules/filters.cjs');
    const cache = require('./admin/modules/cache.cjs');
    const aggregations = require('./admin/modules/aggregations.cjs');

    (async () => {
      try {
        if (!db) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: 'Database not connected' }));
          return;
        }

        // 입력 검증
        const validationError = filters.validateParams(params);
        if (validationError) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify(validationError));
          return;
        }

        // 필터 파싱
        const parsedFilters = filters.parseFilters(params);
        const cacheKey = filters.generateCacheKey({ url: req.url, filters: parsedFilters });

        // stats API
        if (pathname === '/api/admin/v2/stats') {
          const result = await cache.getOrFetch(cacheKey, async () => {
            return await aggregations.aggregateStats(db, parsedFilters);
          });

          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: true, stats: result }));

        // timeseries API
        } else if (pathname === '/api/admin/v2/timeseries') {
          const interval = params.get('interval') || 'day';
          const result = await cache.getOrFetch(cacheKey, async () => {
            return await aggregations.aggregateTimeseries(db, parsedFilters, interval);
          });

          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: true, timeseries: result }));

        // tables API
        } else if (pathname === '/api/admin/v2/tables') {
          const result = await cache.getOrFetch(cacheKey, async () => {
            return await aggregations.aggregateTables(db, parsedFilters);
          });

          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: true, tables: result }));

        // hwp-requests API (GET) - 관리자 알림 목록
        } else if (pathname === '/api/admin/v2/hwp-requests') {
          try {
            const list = await db.collection('hwp_requests')
              .find({})
              .sort({ createdAt: -1 })
              .limit(100)
              .toArray();
            const requests = list.map(x => ({
              id: x._id.toString(),
              username: x.username || '-',
              createdAt: x.createdAt ? new Date(x.createdAt).toLocaleString('ko-KR') : '-',
              email: x.email || '-',
              status: x.status || 'NONE',
              pdfUrl: x.pdfPath ? `/admin/requests/${x._id.toString()}.pdf` : null
            }));

            res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
            res.end(JSON.stringify({ success:true, requests }));
          } catch (e) {
            console.error('관리자 HWP 요청 목록 오류:', e);
            res.writeHead(500, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ error:'서버 오류' }));
          }

        // CSV export
        } else if (pathname === '/api/admin/v2/export/users.csv') {
          // 캐시 사용 안 함 (매번 최신 데이터)
          const result = await aggregations.aggregateTables(db, { ...parsedFilters, pagination: { page: 1, pageSize: 10000 } });

          // CSV 생성
          const csv = ['Username,Email,Role,Plan,IsPaid,CreatedAt,LastActivity,PDFCount'];
          result.users.forEach(u => {
            csv.push(`"${u.username}","${u.email}","${u.role}","${u.plan}","${u.isPaid}","${u.createdAt}","${u.lastActivity}","${u.pdfCount}"`);
          });

          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="users.csv"'
          });
          res.end(csv.join('\n'));

        } else {
          res.writeHead(404, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: 'API endpoint not found' }));
        }

      } catch (error) {
        console.error('관리자 v2 API 오류:', error);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.', message: error.message }));
      }
    })();

  // ===== HWP 요청 API =====
  } else if (req.method === 'POST' && req.url === '/api/hwp-request') {
    // 한글파일(HWP) 생성 요청 수신
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try{
        const { email, problemIds, pdfData } = JSON.parse(body || '{}');
        if (!email || !Array.isArray(problemIds) || problemIds.length === 0){
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ success:false, message:'이메일과 문제 목록이 필요합니다.' }));
          return;
        }
        if (problemIds.length > 20){
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ success:false, message:'한 번에 최대 20개 문제까지만 요청할 수 있습니다.' }));
          return;
        }
        // 세션에서 사용자 정보
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;
        let sessionUser = null;
        if (sessionId && sessions.has(sessionId)) {
          sessionUser = sessions.get(sessionId);
        }
        if (!db){
          res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ success:false, message:'Database not connected' }));
          return;
        }
        const col = db.collection('hwp_requests');
        const doc = {
          userId: sessionUser ? new ObjectId(sessionUser.userId) : null,
          username: sessionUser ? sessionUser.username : null,
          email: String(email),
          problemIds: problemIds.map(String),
          status: 'NULL',
          assignee: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          pdfPath: null
        };
        const ins = await col.insertOne(doc);
        const reqId = ins.insertedId.toString();
        // PDF 저장 (선택)
        if (pdfData && typeof pdfData === 'string'){
          const dir = path.join(process.cwd(), 'output', 'hwp_requests');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `${reqId}.pdf`);
          try{
            const buf = Buffer.from(pdfData, 'base64');
            fs.writeFileSync(filePath, buf);
            await col.updateOne({ _id: new ObjectId(reqId) }, { $set: { pdfPath: filePath, updatedAt: new Date() } });
          }catch(e){
            console.warn('요청 PDF 저장 실패:', e.message);
          }
        }

        // 관리자 알림 메일 전송 (실패해도 요청 자체는 성공 처리)
        try {
          const savedDoc = await col.findOne({ _id: new ObjectId(reqId) });
          if (savedDoc) {
            await sendHwpRequestNotification(savedDoc);
          }
        } catch (e) {
          console.warn('HWP 요청 알림 메일 처리 중 경고:', e.message);
        }

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success:true, id: reqId }));
      }catch(err){
        console.error('HWP 요청 수신 오류:', err);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success:false, message:'요청 처리 중 오류가 발생했습니다.' }));
      }
    });

  } else if (req.method === 'GET' && req.url.startsWith('/admin/requests/')) {
    // 저장된 요청 PDF 파일 제공
    const parts = req.url.split('/');
    const filename = parts.pop();
    const filePath = path.join(process.cwd(), 'output', 'hwp_requests', filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, {'Content-Type':'text/plain'});
      res.end('Not found');
    }

  } else if (req.method === 'GET' && req.url === '/api/admin/v2/hwp-requests') {
    // 관리자: 요청 목록 (비동기 IIFE로 처리)
    (async () => {
      const adminPassword = req.headers['x-admin-password'];
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
      if (adminPassword !== ADMIN_PASSWORD) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: '인증이 필요합니다.' }));
        return;
      }
      if (!db){
        res.writeHead(503, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error:'Database not connected' }));
        return;
      }
      try{
        const list = await db.collection('hwp_requests').find({}).sort({ createdAt: -1 }).limit(100).toArray();
        const requests = list.map(x => ({
          id: x._id.toString(),
          username: x.username || '-',
          createdAt: x.createdAt ? new Date(x.createdAt).toLocaleString('ko-KR') : '-',
          email: x.email || '-',
          status: (x.status === 'NONE' ? 'NULL' : (x.status || 'NULL')),
          assignee: x.assignee || null,
          pdfUrl: x.pdfPath ? `/admin/requests/${x._id.toString()}.pdf` : null
        }));
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success:true, requests }));
      }catch(err){
        console.error('HWP 요청 목록 오류:', err);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error:'서버 오류' }));
      }
    })();

  } else if (req.method === 'PUT' && req.url.startsWith('/api/admin/v2/hwp-requests/')) {
    // 관리자: 상태 변경
    const adminPassword = req.headers['x-admin-password'];
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    if (adminPassword !== ADMIN_PASSWORD) {
      res.writeHead(401, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: '인증이 필요합니다.' }));
      return;
    }
    let body='';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try{
        const m = req.url.match(/\/api\/admin\/v2\/hwp-requests\/([^/]+)\/status/);
        if (!m){ res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error:'not found' })); return; }
        const id = m[1];
        const { status, assignee } = JSON.parse(body || '{}');

        // 상태/담당자 유효성
        const allowedStatus = ['NULL','작업 중','작업 완료'];
        if (status && !allowedStatus.includes(status)){
          res.writeHead(400, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ success:false, message:'올바르지 않은 상태' }));
          return;
        }
        const allowedAssignees = [null,'김태훈','성민준','장서연'];
        if (typeof assignee !== 'undefined' && !allowedAssignees.includes(assignee)){
          res.writeHead(400, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ success:false, message:'올바르지 않은 담당자' }));
          return;
        }

        if (!db){
          res.writeHead(503, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ success:false, message:'Database not connected' }));
          return;
        }
        const updateFields = { updatedAt: new Date() };
        if (status) updateFields.status = status;
        if (typeof assignee !== 'undefined') updateFields.assignee = assignee;

        const r = await db.collection('hwp_requests').updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success:true }));
      }catch(err){
        console.error('HWP 상태 변경 오류:', err);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success:false, message:'서버 오류' }));
      }
    });

  } else {
    res.writeHead(404, {'Content-Type': 'text/html; charset=utf-8'});
    res.end('<h1>404 - 페이지를 찾을 수 없습니다</h1>');
  }
});

// Python PDF 생성기 함수
async function runPythonPDFGenerator(examData) {
  const startTime = Date.now();
  const scriptPath = path.resolve(__dirname, 'pipeline/make_pdf.py');

  return new Promise((resolve, reject) => {
    console.log('Python 테스트 PDF 생성 스크립트 실행 중...');
    console.log('examData:', JSON.stringify(examData, null, 2));

    // examData.problems에서 _id 추출 (안전하게)
    const problemIds = [];
    if (examData.problems && Array.isArray(examData.problems)) {
      for (const p of examData.problems) {
        if (p._id) {
          problemIds.push(p._id.toString());
        }
      }
    }

    console.log(`📝 추출된 문제 ID: ${problemIds.length}개`);
    if (problemIds.length > 0) {
      console.log(`   ${problemIds.join(', ')}`);
    }

    // Python 실행 인자 확인
    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
    const pythonArgs = [scriptPath, ...problemIds];
    console.log(`🐍 Python 실행 명령어:`, PYTHON_BIN, pythonArgs);

    // test_pdf.py에 문제 ID들을 커맨드라인 인자로 전달
    const answersType = (examData.settings && examData.settings.answerType) || 'none';
    // 개별 메타 표시 플래그 (신규)
    const showMetaFile = !!(examData.settings && (examData.settings.showMetaFile));
    const showMetaPage = !!(examData.settings && (examData.settings.showMetaPage));
    const showMetaId   = !!(examData.settings && (examData.settings.showMetaId));
    // 레거시 호환: showProblemMeta가 true면 전체 표시로 간주
    const legacyShowMeta = !!(examData.settings && examData.settings.showProblemMeta);
    const showMetaAny = legacyShowMeta || showMetaFile || showMetaPage || showMetaId;
    const mergedEnv = {
      ...process.env,
      ANSWERS_MODE: answersType === 'answers-only' ? 'answers-only' : 'none',
      SHOW_META: showMetaAny ? '1' : '0',
      SHOW_META_FILE: (legacyShowMeta || showMetaFile) ? '1' : '0',
      SHOW_META_PAGE: (legacyShowMeta || showMetaPage) ? '1' : '0',
      SHOW_META_ID:   (legacyShowMeta || showMetaId)   ? '1' : '0'
    };

    const pythonProcess = spawn(PYTHON_BIN, pythonArgs, {
      cwd: process.cwd(),
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe']
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
      const totalTime = Date.now() - startTime;

      if (code === 0) {
        console.log('Python 테스트 PDF 생성 완료');
        resolve({ stdout, totalTime });
      } else {
        console.error(`Python PDF 생성 스크립트 실행 실패: 종료 코드 ${code}`);
        reject(new Error(`python exited ${code} (${totalTime}ms)\n${stderr || stdout}`));
      }
    });

    pythonProcess.on('error', (err) => {
      const totalTime = Date.now() - startTime;
      console.error('Python PDF 생성 프로세스 오류:', err.message);
      reject(new Error(`spawn failed (${totalTime}ms): ${err.message}`));
    });
  });
}

const PORT = 3000;
//server.listen(PORT, () => {
//  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);

server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('listening on 0.0.0.0:3000');
});