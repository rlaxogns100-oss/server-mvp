#!/bin/bash

# Linux 배포 스크립트
# 사용법: ./deploy.sh

echo "🚀 Exam Generator 서버 배포 시작..."

# 1. Python 3 설치 확인
echo "📋 Python 3 설치 확인..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3가 설치되지 않았습니다. 설치해주세요."
    echo "Ubuntu/Debian: sudo apt update && sudo apt install python3 python3-pip"
    echo "CentOS/RHEL: sudo yum install python3 python3-pip"
    exit 1
fi

# 2. Node.js 설치 확인
echo "📋 Node.js 설치 확인..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되지 않았습니다. 설치해주세요."
    echo "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "sudo apt-get install -y nodejs"
    exit 1
fi

# 3. 의존성 설치
echo "📦 Node.js 의존성 설치..."
npm install

# 4. Python 의존성 설치
echo "📦 Python 의존성 설치..."
pip3 install -r requirements.txt

# 5. 환경변수 파일 확인
echo "🔧 환경변수 파일 확인..."
if [ ! -f ".env" ]; then
    echo "⚠️  .env 파일이 없습니다. .env.example을 참고하여 생성해주세요."
    echo "필수 환경변수:"
    echo "  - MONGODB_URI"
    echo "  - MONGODB_DATABASE"
    echo "  - PYTHON_BIN=python3"
    echo "  - PORT=3000"
fi

# 6. 디렉토리 생성
echo "📁 필요한 디렉토리 생성..."
mkdir -p uploads output build

# 7. 실행 권한 설정
echo "🔐 Python 스크립트 실행 권한 설정..."
chmod +x pipeline/*.py

# 8. 서버 시작 테스트
echo "🧪 서버 시작 테스트..."
echo "서버를 시작하려면 다음 명령어를 실행하세요:"
echo "  npm start"
echo "  또는"
echo "  node app.cjs"

echo "✅ 배포 준비 완료!"
echo ""
echo "📝 다음 단계:"
echo "1. .env 파일 생성 및 환경변수 설정"
echo "2. MongoDB 서버 실행"
echo "3. npm start 또는 node app.cjs로 서버 시작"
echo "4. http://localhost:3000 에서 접속 확인"
