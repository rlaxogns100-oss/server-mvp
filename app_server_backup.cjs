const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
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

function renderMarkdown(text) {
  if (!text) return '';

  // 표 렌더링
  let html = renderMarkdownTable(text);

  // 코드 블록 처리
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // 인라인 코드 처리
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 강조 처리
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // 줄바꿈 처리
  html = html.replace(/\n/g, '<br>');

  return html;
}

// 서버 설정
const PORT = process.env.PORT || 3000;
let db;

// MongoDB 연결
async function connectToDatabase() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(process.env.MONGODB_DATABASE);
    console.log('✅ MongoDB 연결 성공');
  } catch (error) {
    console.error('❌ MongoDB 연결 실패:', error);
    process.exit(1);
  }
}

// 세션 저장소 (실제 운영에서는 Redis 등을 사용)
const sessions = new Map();

// 진행률 전송 함수
function sendProgress(sessionId, progress, message) {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    if (session.res && !session.res.destroyed) {
      try {
        session.res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
      } catch (error) {
        console.error('Progress 전송 오류:', error);
      }
    }
  }
}

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = 'uploads';
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix);
  }
});

const upload = multer({ storage: storage });

// PDF를 텍스트로 변환하는 함수 (Mathpix API 사용)
async function convertPdfToText(pdfPath, sessionId = null) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', ['pipeline/convert_pdf.py', '--input', pdfPath]);
    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      const lines = data.toString().split('\n').filter(line => line.trim() !== '');
      lines.forEach(line => {
        console.log(`Python convert_pdf stdout: ${line}`);
        if (sessionId) {
          // 진행률 메시지 파싱 (예: "Progress: 50%")
          const progressMatch = line.match(/Progress:\s*(\d+)%/);
          if (progressMatch) {
            const progress = parseInt(progressMatch[1]);
            sendProgress(sessionId, progress, `PDF 변환 중... (${progress}%)`);
          } else {
            sendProgress(sessionId, null, `PDF 변환 중... (${line})`);
          }
        }
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`Python convert_pdf stderr: ${data.toString()}`);
      if (sessionId) {
        sendProgress(sessionId, null, `PDF 변환 오류: ${data.toString()}`);
      }
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python convert_pdf 완료');
        if (sessionId) {
          sendProgress(sessionId, 40, 'PDF 변환 완료');
        }
        // Mathpix API를 직접 호출하는 대신, Python 스크립트가 생성한 결과 파일을 읽음
        const outputFilePath = path.join(path.dirname(pdfPath), 'result.paged.mmd');
        fs.readFile(outputFilePath, 'utf8', (err, data) => {
          if (err) {
            console.error('결과 파일 읽기 오류:', err);
            return reject(new Error('PDF 변환 결과 파일을 읽을 수 없습니다.'));
          }
          resolve(data);
        });
      } else {
        console.error(`Python convert_pdf 스크립트 오류: 종료 코드 ${code}`);
        reject(new Error(`PDF 변환 스크립트 실행 실패: ${stderr}`));
      }
    });
  });
}

// Python split 스크립트 실행 함수
async function runPythonSplit(sessionId = null) {
  return new Promise((resolve, reject) => {
    console.log('Python split 스크립트 실행 중...');
    
    if (sessionId) {
      sendProgress(sessionId, 50, '문제 분할 중...');
    }

    const pythonProcess = spawn('python', ['pipeline/split.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`Python split stdout: ${data.toString()}`);
      if (sessionId) {
        sendProgress(sessionId, 60, '문제 분할 중...');
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`Python split stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python split 완료');
        if (sessionId) {
          sendProgress(sessionId, 70, '문제 분할 완료');
        }
        resolve(stdout);
      } else {
        console.error(`Python split 스크립트 오류: 종료 코드 ${code}`);
        reject(new Error(`Python split 실행 오류: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python split 프로세스 오류:', error);
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
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`Python llm_structure stdout: ${data.toString()}`);
      if (sessionId) {
        sendProgress(sessionId, 80, 'AI 구조화 중...');
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`Python llm_structure stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python llm_structure 완료');
        if (sessionId) {
          sendProgress(sessionId, 90, 'AI 구조화 완료');
        }
        resolve(stdout);
      } else {
        console.error(`Python llm_structure 스크립트 오류: 종료 코드 ${code}`);
        reject(new Error(`Python llm_structure 실행 오류: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python llm_structure 프로세스 오류:', error);
      reject(new Error(`Python llm_structure 실행 오류: ${error.message}`));
    });
  });
}

// 서버 생성
const server = http.createServer(async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // 정적 파일 서빙
    if (pathname === '/' || pathname === '/index.html') {
      const filePath = path.join(__dirname, 'index.html');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    if (pathname === '/dashboard.html') {
      const filePath = path.join(__dirname, 'dashboard.js');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    if (pathname === '/main.css') {
      const filePath = path.join(__dirname, 'main.css');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(content);
      return;
    }

    if (pathname === '/dashboard.js') {
      const filePath = path.join(__dirname, 'dashboard.js');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(content);
      return;
    }

    // API 엔드포인트들
    if (pathname === '/api/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const { username, password, email, role } = JSON.parse(body);
          
          // 입력 검증
          if (!username || !password || !email) {
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
              message: '올바른 이메일 형식을 입력해주세요.'
            }));
            return;
          }

          // 비밀번호 길이 검증
          if (password.length < 6) {
            res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
            res.end(JSON.stringify({
              success: false,
              message: '비밀번호는 6자 이상이어야 합니다.'
            }));
            return;
          }

          const usersCollection = db.collection('users');

          // 중복 검사
          const existingUser = await usersCollection.findOne({ 
            $or: [
              { username: username },
              { email: email }
            ]
          });

          if (existingUser) {
            res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
            res.end(JSON.stringify({
              success: false,
              message: '이미 존재하는 사용자명 또는 이메일입니다.'
            }));
            return;
          }

          // 비밀번호 해시화
          const hashedPassword = await bcrypt.hash(password, 10);

          // 새 사용자 생성
          const newUser = {
            username,
            email,
            password: hashedPassword,
            role,
            createdAt: new Date(),
            updatedAt: new Date()
          };

          const result = await usersCollection.insertOne(newUser);

          res.writeHead(201, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: true,
            message: '회원가입이 완료되었습니다.',
            userId: result.insertedId
          }));

        } catch (error) {
          console.error('회원가입 오류:', error);
          res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '서버 오류가 발생했습니다.'
          }));
        }
      });
      return;
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const { username, password } = JSON.parse(body);
          
          if (!username || !password) {
            res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
            res.end(JSON.stringify({
              success: false,
              message: '사용자명과 비밀번호를 입력해주세요.'
            }));
            return;
          }

          const usersCollection = db.collection('users');
          const user = await usersCollection.findOne({ username });

          if (!user) {
            res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
            res.end(JSON.stringify({
              success: false,
              message: '사용자명 또는 비밀번호가 올바르지 않습니다.'
            }));
            return;
          }

          const isValidPassword = await bcrypt.compare(password, user.password);

          if (!isValidPassword) {
            res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
            res.end(JSON.stringify({
              success: false,
              message: '사용자명 또는 비밀번호가 올바르지 않습니다.'
            }));
            return;
          }

          // 세션 생성
          const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
          sessions.set(sessionId, {
            userId: user._id.toString(),
            username: user.username,
            role: user.role,
            createdAt: new Date()
          });

          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: true,
            message: '로그인 성공',
            sessionId: sessionId,
            user: {
              id: user._id,
              username: user.username,
              role: user.role
            }
          }));

        } catch (error) {
          console.error('로그인 오류:', error);
          res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '서버 오류가 발생했습니다.'
          }));
        }
      });
      return;
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const { sessionId } = JSON.parse(body);
          
          if (sessionId && sessions.has(sessionId)) {
            sessions.delete(sessionId);
          }

          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: true,
            message: '로그아웃 완료'
          }));

        } catch (error) {
          console.error('로그아웃 오류:', error);
          res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '서버 오류가 발생했습니다.'
          }));
        }
      });
      return;
    }

    if (pathname === '/api/user' && req.method === 'GET') {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '인증이 필요합니다.'
        }));
        return;
      }

      const session = sessions.get(sessionId);
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({
        success: true,
        user: {
          id: session.userId,
          username: session.username,
          role: session.role
        }
      }));
      return;
    }

    if (pathname === '/api/files' && req.method === 'GET') {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '인증이 필요합니다.'
        }));
        return;
      }

      const session = sessions.get(sessionId);
      const userId = session.userId;

      try {
        const files = await db.collection('files').find({ userId: new ObjectId(userId) }).toArray();
        const folders = await db.collection('folders').find({ userId: new ObjectId(userId) }).toArray();

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
          message: '파일 목록을 불러올 수 없습니다.'
        }));
      }
      return;
    }

    if (pathname === '/api/folders' && req.method === 'POST') {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '인증이 필요합니다.'
        }));
        return;
      }

      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const { folderName, parentPath } = JSON.parse(body);
          const session = sessions.get(sessionId);
          const userId = session.userId;

          if (!folderName) {
            res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
            res.end(JSON.stringify({
              success: false,
              message: '폴더명을 입력해주세요.'
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
            message: '폴더가 생성되었습니다.',
            folderId: result.insertedId
          }));

        } catch (error) {
          console.error('폴더 생성 오류:', error);
          res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '폴더 생성에 실패했습니다.'
          }));
        }
      });
      return;
    }

    if (pathname === '/api/problems' && req.method === 'GET') {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '인증이 필요합니다.'
        }));
        return;
      }

      const fileId = url.searchParams.get('fileId');
      
      if (!fileId) {
        res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '파일 ID가 필요합니다.'
        }));
        return;
      }

      try {
        const problems = await db.collection('problems').find({ fileId: new ObjectId(fileId) }).toArray();

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
          message: '문제 목록을 불러올 수 없습니다.'
        }));
      }
      return;
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({
          success: false,
          message: '인증이 필요합니다.'
        }));
        return;
      }

      const session = sessions.get(sessionId);
      const userId = session.userId;

      // 세션 정보를 진행률 전송용으로 저장
      sessions.set(sessionId, { ...session, res });

      upload.single('file')(req, res, async (err) => {
        if (err) {
          console.error('파일 업로드 오류:', err);
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '파일 업로드에 실패했습니다.'
          }));
          return;
        }

        if (!req.file) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '파일이 선택되지 않았습니다.'
          }));
          return;
        }

        const filePath = req.file.path;
        const originalName = req.file.originalname;
        console.log(`📁 파일 업로드 완료: ${originalName} -> ${filePath}`);

        try {
          // 진행률 전송 시작
          res.writeHead(200, {'Content-Type': 'text/event-stream'});
          res.write('data: {"progress": 0, "message": "파일 업로드 완료"}\n\n');

          // PDF를 텍스트로 변환
          console.log('\n🔄 PDF 변환 시작...');
          sendProgress(sessionId, 10, 'PDF 변환 중...');
          const pdfStartTime = Date.now();
          const extractedText = await convertPdfToText(filePath, sessionId);
          const pdfEndTime = Date.now();
          console.log(`✅ PDF 변환 완료 - 소요시간: ${((pdfEndTime - pdfStartTime) / 1000).toFixed(2)}초`);
          sendProgress(sessionId, 30, 'PDF 변환 완료');

          // Python split 스크립트 실행
          console.log('\n✂️ Python split 실행...');
          sendProgress(sessionId, 40, '문제 분할 중...');
          const splitStartTime = Date.now();
          await runPythonSplit(sessionId);
          const splitEndTime = Date.now();
          console.log(`✅ 문제 분할 완료 - 소요시간: ${((splitEndTime - splitStartTime) / 1000).toFixed(2)}초`);
          sendProgress(sessionId, 60, '문제 분할 완료');

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
          try {
            if (fs.existsSync(structuredProblemsPath)) {
              const structuredData = fs.readFileSync(structuredProblemsPath, 'utf8');
              problems = JSON.parse(structuredData);
              console.log(`✅ 구조화된 문제 ${problems.length}개 로드 완료`);
            } else if (fs.existsSync(originalProblemsPath)) {
              const originalData = fs.readFileSync(originalProblemsPath, 'utf8');
              problems = JSON.parse(originalData);
              console.log(`✅ 원본 문제 ${problems.length}개 로드 완료`);
            } else {
              console.log('⚠️ 결과 파일을 찾을 수 없습니다.');
            }
          } catch (fileError) {
            console.error('❌ 결과 파일 읽기 오류:', fileError);
          }

          // MongoDB에 저장
          let fileId = null;
          if (problems.length > 0) {
            try {
              const fileDoc = {
                userId: new ObjectId(userId),
                filename: originalName,
                filePath: filePath,
                parentPath: '내 파일', // 기본적으로 '내 파일' 폴더에 저장
                originalText: extractedText,
                problemCount: problems.length,
                uploadDate: new Date(),
                stats: {
                  originalTextLength: extractedText.length,
                  problemCount: problems.length
                }
              };
              
              const fileResult = await db.collection('files').insertOne(fileDoc);
              fileId = fileResult.insertedId;
              console.log(`✅ 파일 정보 저장 완료 - 파일 ID: ${fileId}`);
              
              // 문제들을 MongoDB에 저장
              if (problems.length > 0) {
                const problemDocs = problems.map((problem, index) => {
                  // 불필요한 기본 보기 메시지 필터링
                  let filteredOptions = [];
                  if (problem.options && Array.isArray(problem.options)) {
                    filteredOptions = problem.options.filter(option =>
                      option &&
                      !option.includes('보기 내용은 문제에 명시되지') &&
                      !option.includes('실제 문제의 보기를 여기에 작성하세요')
                    );
                  }

                  return {
                    fileId: fileId,
                    userId: new ObjectId(userId),
                    problemNumber: index + 1,
                    // 구조화된 문제의 전체 정보 저장
                    id: problem.id,
                    page: problem.page,
                    content_blocks: problem.content_blocks || [],
                    options: filteredOptions,
                    answer: problem.answer || '',
                    explanation: problem.explanation || '',
                    type: problem.type || 'multiple_choice',
                    difficulty: problem.difficulty || 'medium',
                    subject: problem.subject || '',
                    // 호환성을 위해 content 필드도 유지
                    content: problem.content || problem.text || '',
                    createdAt: new Date()
                  };
                });

                await db.collection('problems').insertMany(problemDocs);
                console.log(`✅ 문제 ${problems.length}개 저장 완료`);
              }
            } catch (dbError) {
              console.error('❌ MongoDB 저장 실패:', dbError);
              // DB 저장 실패해도 파일 처리는 성공으로 처리
            }
          }

          // JSON 응답 반환
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: true,
            message: '파일 처리가 완료되었습니다.',
            fileId: fileId,
            problemCount: problems.length,
            stats: {
              originalTextLength: extractedText.length,
              problemCount: problems.length
            }
          }));

        } catch (error) {
          console.error('❌ 파일 처리 오류:', error);
          res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({
            success: false,
            message: '파일 처리 중 오류가 발생했습니다: ' + error.message
          }));
        }
      });
      return;
    }

    // 404 처리
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Not Found');

  } catch (error) {
    console.error('서버 오류:', error);
    res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Internal Server Error');
  }
});

// 서버 시작
async function startServer() {
  await connectToDatabase();
  
  server.listen(PORT, () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📱 대시보드: http://localhost:${PORT}/dashboard.html`);
    console.log(`📄 메인 페이지: http://localhost:${PORT}/`);
  });
}

startServer().catch(console.error);

