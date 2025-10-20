#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_pdf.py - 문제 ID로 PDF 생성 테스트 스크립트
"""

import sys
import io
import json
import os
import subprocess
from pathlib import Path
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

# UTF-8 인코딩 강제 설정
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 환경 변수 로드
load_dotenv()

def get_problems_from_db(problem_ids):
    """MongoDB에서 문제 ID로 문제 데이터 조회"""
    try:
        # MongoDB 연결
        mongodb_uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/')
        mongodb_database = os.getenv('MONGODB_DATABASE', 'ZeroTyping')
        client = MongoClient(mongodb_uri)
        db = client[mongodb_database]
        
        # ObjectId로 변환
        object_ids = []
        for pid in problem_ids:
            try:
                object_ids.append(ObjectId(pid))
            except Exception as e:
                print(f"⚠️ 잘못된 ObjectId 형식: {pid} - {e}")
                continue
        
        # problems 컬렉션에서 조회
        problems_collection = db['problems']
        problems = list(problems_collection.find({'_id': {'$in': object_ids}}))
        
        client.close()
        print(f"📊 DB에서 {len(problems)}개 문제 조회 완료")
        return problems
        
    except Exception as e:
        print(f"❌ DB 조회 오류: {e}")
        return []

def create_pdf_with_ids(problem_ids):
    """문제 ID를 표시하는 PDF 생성"""
    # build 폴더 생성
    build_dir = Path("build")
    build_dir.mkdir(exist_ok=True)

    # PDF 파일 경로
    pdf_path = build_dir / "exam.pdf"

    # MongoDB에서 문제 데이터 조회
    problems = get_problems_from_db(problem_ids)
    
    if not problems:
        print("⚠️ 조회된 문제가 없습니다. 빈 PDF 생성...")
        problems = []

    # 문제 ID 텍스트 생성
    content_lines = []
    y_position = 750

    for i, problem in enumerate(problems, 1):
        problem_id = str(problem.get('_id', 'Unknown'))
        content_lines.append(f"/F1 12 Tf\n50 {y_position} Td\n(Problem {i}: {problem_id}) Tj")
        y_position -= 30  # 간격을 더 넓게 조정

    content_stream = "\nBT\n" + "\n".join(content_lines) + "\nET\n"
    content_bytes = content_stream.encode('latin-1')
    content_length = len(content_bytes)

    # PDF 구조 생성
    pdf_content = f"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
/MediaBox [0 0 595 842]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length {content_length}
>>
stream
{content_stream}endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000317 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
{317 + content_length + 20}
%%EOF
""".encode('latin-1')

    # PDF 파일 저장
    pdf_path.write_bytes(pdf_content)
    print(f"✅ PDF 생성 완료: {pdf_path}")
    return pdf_path

def main():
    try:
        print("🔍 MongoDB에서 문제 _id 조회하여 PDF 생성 시작...")

        # 커맨드라인 인자로 문제 ID 받기
        if len(sys.argv) > 1:
            problem_ids = sys.argv[1:]
            print(f"📝 받은 문제 ID: {len(problem_ids)}개")
            for i, pid in enumerate(problem_ids, 1):
                print(f"  {i}. {pid}")
        else:
            print("⚠️ 사용법: python test_pdf.py <problem_id1> <problem_id2> ...")
            print("예시: python test_pdf.py 507f1f77bcf86cd799439011 507f1f77bcf86cd799439012")
            return 1

        pdf_path = create_pdf_with_ids(problem_ids)
        print(f"📄 PDF 파일 위치: {pdf_path.absolute()}")
        print(f"📊 파일 크기: {pdf_path.stat().st_size} bytes")
        print("✅ 테스트 완료!")
        return 0
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
