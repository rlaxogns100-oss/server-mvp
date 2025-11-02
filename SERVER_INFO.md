# AWS 서버 정보

## 🔐 SSH 접속 정보

### 서버 주소
- **Public IP**: [AWS 콘솔에서 확인 필요]
- **Private IP**: `172.31.37.180`
- **사용자명**: `ubuntu`
- **SSH 키 파일**: [.pem 파일 경로]

### SSH 접속 명령어
```bash
ssh -i [키파일경로]/[키파일명].pem ubuntu@[Public IP]
```

## 📍 프로젝트 정보

### 프로젝트 경로
```
/home/ubuntu/[프로젝트 디렉토리]
```

### 서버 실행 포트
- **포트**: `3000`
- **바인딩**: `0.0.0.0:3000` (모든 인터페이스)

### 서버 실행 방법
```bash
cd [프로젝트 경로]
npm start
# 또는
node app.cjs
```

## 🔧 환경 변수 (.env)

서버의 `.env` 파일에 설정되어야 할 변수들:

```env
# MongoDB 설정
MONGODB_URI=mongodb://[호스트]:27017
MONGODB_DATABASE=[데이터베이스명]

# Python 실행 경로
PYTHON_BIN=python3

# 서버 포트
PORT=3000

# Mathpix API (필요시)
APP_ID=[Mathpix App ID]
APP_KEY=[Mathpix App Key]

# DeepSeek API (필요시)
DEEPSEEK_API_KEY=[DeepSeek API Key]

# 기본 URL
BASE_URL=http://[도메인 또는 IP]:3000
```

## 🗄️ 데이터베이스 정보

- **MongoDB URI**: [실제 MongoDB 연결 정보]
- **Database 이름**: [실제 데이터베이스명]
- **MongoDB 위치**: 로컬 또는 외부 호스트

## 🌐 네트워크 설정

### 보안 그룹 (Security Group) 설정 필요 포트
- **포트 22** (SSH): 관리자 접속용
- **포트 3000** (HTTP): 애플리케이션 포트
- **포트 80/443** (HTTP/HTTPS): 웹 서버 (Nginx 등 사용 시)

### 도메인/URL
- **서버 URL**: `http://[도메인 또는 Public IP]:3000`
- **대시보드**: `http://[도메인 또는 Public IP]:3000/dashboard.html`

## 📦 서버 요구사항

### 설치된 소프트웨어
- **Node.js**: [버전 확인 필요]
- **Python 3**: [버전 확인 필요]
- **MongoDB**: [버전 및 설치 위치 확인 필요]

### 확인 명령어
```bash
node --version
npm --version
python3 --version
mongod --version
```

## 🔄 프로세스 관리

### 현재 실행 방법
[PM2, systemd, nohup 등 사용 여부 확인 필요]

### 예시: PM2 사용 시
```bash
pm2 start app.cjs --name project-name
pm2 save
pm2 startup
```

### 예시: systemd 서비스
```bash
sudo systemctl status [서비스명]
sudo systemctl start [서비스명]
sudo systemctl enable [서비스명]
```

## 📁 프로젝트 구조

```
[프로젝트 경로]/
├── app.cjs              # 메인 서버 파일
├── package.json         # Node.js 의존성
├── requirements.txt     # Python 의존성
├── .env                 # 환경 변수 (비공개)
├── pipeline/            # Python 스크립트들
│   ├── convert_pdf.py
│   ├── llm_structure.py
│   └── make_pdf.py
├── uploads/             # 업로드된 파일 저장
├── output/              # 출력 파일
└── build/               # 빌드 파일 (PDF 생성용)
```

## 🔍 서버 상태 확인

### 디스크 사용량
```bash
df -h
```
- 전체 용량: 19GB
- 사용 중: 7.0GB (38%)
- 여유 공간: 12GB

### 메모리 사용량
```bash
free -h
```

### 실행 중인 프로세스
```bash
ps aux | grep node
ps aux | grep python
```

## ⚠️ 주의사항

1. **.env 파일은 Git에 커밋하지 않기** (비밀키 포함)
2. **포트 충돌 확인**: 다른 프로젝트와 포트가 겹치지 않도록 주의
3. **방화벽 설정**: AWS Security Group에서 필요한 포트 오픈 확인
4. **로그 관리**: 서버 로그 저장 위치 및 로테이션 설정 확인

## 📝 추가 정보

- **서버 OS**: Ubuntu 24.04.3 LTS
- **서버 타입**: AWS EC2
- **최종 업데이트**: [날짜]

---

**중요**: 위 정보 중 `[대괄호]`로 표시된 부분은 실제 값으로 채워서 전달해야 합니다.


