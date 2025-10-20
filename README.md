# Server MVP

PDF 처리 서버 프로젝트입니다.

## 기능
- PDF 업로드 및 OCR 처리
- 텍스트 추출 및 필터링
- AI 기반 문제 구조화
- 시험지 PDF 생성
- 사용자 인증 및 파일 관리

## Linux 배포 가이드

### 1. 환경 설정
```bash
# Python 3 설치 확인
python3 --version

# Node.js 설치 확인
node --version
npm --version

# 의존성 설치
npm install
```

### 2. 환경변수 설정
`.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
# MongoDB 설정
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=exam_generator

# Python 실행 경로 (Linux에서는 python3)
PYTHON_BIN=python3

# 서버 포트
PORT=3000

# Mathpix API 설정 (필요한 경우)
APP_ID=your_mathpix_app_id
APP_KEY=your_mathpix_app_key

# 기본 URL (화면 캡쳐용)
BASE_URL=http://localhost:3000
```

### 3. Python 의존성 설치
```bash
# Python 패키지 설치
pip3 install -r requirements.txt
```

### 4. 서버 실행
```bash
# 개발 모드
npm start

# 또는 직접 실행
node app.cjs
```

### 5. 서비스 등록 (선택사항)
systemd 서비스로 등록하여 자동 시작 설정:

```bash
# 서비스 파일 생성
sudo nano /etc/systemd/system/exam-generator.service
```

서비스 파일 내용:
```ini
[Unit]
Description=Exam Generator Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/your/project
ExecStart=/usr/bin/node app.cjs
Restart=always
Environment=NODE_ENV=production
Environment=PYTHON_BIN=python3

[Install]
WantedBy=multi-user.target
```

서비스 활성화:
```bash
sudo systemctl daemon-reload
sudo systemctl enable exam-generator
sudo systemctl start exam-generator
```

## 주요 변경사항 (Windows → Linux)

1. **Python 실행 명령어**: `python` → `python3`
2. **환경변수 지원**: `PYTHON_BIN` 환경변수로 Python 경로 설정 가능
3. **서버 바인딩**: `0.0.0.0`으로 모든 인터페이스에서 접근 가능
4. **의존성 추가**: `axios`, `form-data` 패키지 추가