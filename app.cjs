const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
require('dotenv').config();

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

async function convertPdfToText(pdfPath) {
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
      return await waitForConversion(pdfId);
    } else {
      throw new Error('PDF ID를 받지 못했습니다.');
    }
  } catch (error) {
    console.error('PDF 변환 오류:', error.message);
    throw error;
  }
}

async function waitForConversion(pdfId) {
  const maxAttempts = 60; // 2분간 대기
  const delay = 2000; // 2초마다 확인

  console.log(`변환 대기 시작: ${pdfId}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 먼저 상태 확인
      const statusResponse = await axios.get(`https://api.mathpix.com/v3/pdf/${pdfId}`, {
        headers: {
          'app_id': MATHPIX_APP_ID,
          'app_key': MATHPIX_APP_KEY,
        }
      });

      console.log(`시도 ${attempt}/${maxAttempts} - 상태:`, statusResponse.data?.status);

      // 변환이 완료되었으면 결과 요청
      if (statusResponse.data?.status === 'completed') {
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
      if (statusResponse.data?.status === 'processing' || statusResponse.data?.status === 'split') {
        console.log(`변환 진행 중... (${attempt}/${maxAttempts}) - 상태: ${statusResponse.data.status}`);
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

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PDF 업로드</title>
        <style>
          body { font-family: Arial; padding: 50px; }
          .upload-area { border: 2px dashed #ccc; padding: 50px; text-align: center; margin: 20px 0; }
          input[type="file"] { margin: 10px 0; }
          button { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; }
          button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <h1>PDF 파일 업로드</h1>
        <div class="upload-area">
          <form action="/upload" method="post" enctype="multipart/form-data">
            <p>PDF 파일을 선택하세요</p>
            <input type="file" name="pdf" accept=".pdf" required>
            <br>
            <button type="submit">업로드</button>
          </form>
        </div>
      </body>
      </html>
    `);
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
        // OCR 진행 중 화면 표시
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.write(`
          <html>
          <head>
            <title>PDF 변환 중</title>
            <style>
              body { font-family: Arial; padding: 20px; }
              .loading { text-align: center; margin: 50px 0; }
              .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
              .result { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
              pre { white-space: pre-wrap; word-wrap: break-word; max-height: 500px; overflow-y: auto; background: #f1f1f1; padding: 15px; border-radius: 3px; }
            </style>
          </head>
          <body>
            <h1>PDF OCR 변환</h1>
            <div class="loading">
              <div class="spinner"></div>
              <p>PDF를 텍스트로 변환하는 중입니다...</p>
              <p>잠시만 기다려 주세요.</p>
            </div>
        `);

        // PDF 변환 실행
        const extractedText = await convertPdfToText(req.file.path);

        // 원본 파일 저장
        const originalPath = 'output/result.paged.mmd';
        fs.writeFileSync(originalPath, extractedText, 'utf8');

        // Python 필터링 스크립트 실행
        await runPythonFilter();

        // 필터링된 파일 읽기
        const filteredPath = 'output/result.paged.filtered.mmd';
        const filteredText = fs.readFileSync(filteredPath, 'utf8');

        // 로딩 화면 숨기고 결과 표시
        res.write(`
            <script>
              document.querySelector('.loading').style.display = 'none';
            </script>
            <div class="result">
              <h2>✅ 변환 및 필터링 완료!</h2>

              <h3>📊 처리 결과</h3>
              <ul>
                <li><strong>원본 텍스트:</strong> ${extractedText.length.toLocaleString()} 문자</li>
                <li><strong>필터링된 텍스트:</strong> ${filteredText.length.toLocaleString()} 문자</li>
                <li><strong>저장 위치:</strong>
                  <ul>
                    <li>원본: ${originalPath}</li>
                    <li>필터링: ${filteredPath}</li>
                  </ul>
                </li>
              </ul>

              <h3>🔍 필터링된 내용 미리보기:</h3>
              <pre>${filteredText.substring(0, 2000)}${filteredText.length > 2000 ? '\n\n... (더 많은 내용이 있습니다)' : ''}</pre>

              <p><a href="/">새 파일 업로드</a></p>
            </div>
          </body>
          </html>
        `);
        res.end();

        // 업로드된 파일 정리
        fs.unlinkSync(req.file.path);

      } catch (error) {
        console.error('변환 오류:', error);
        res.write(`
            <script>
              document.querySelector('.loading').style.display = 'none';
            </script>
            <div class="result">
              <h2>❌ 변환 실패</h2>
              <p>PDF 변환 중 오류가 발생했습니다:</p>
              <p><strong>오류:</strong> ${error.message}</p>
              <p>Mathpix API 키를 확인하고 다시 시도해주세요.</p>
              <p><a href="/">다시 시도</a></p>
            </div>
          </body>
          </html>
        `);
        res.end();

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