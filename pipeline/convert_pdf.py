#!/usr/bin/env python3
"""
최적화된 PDF 변환 스크립트
argparse를 사용한 개선된 CLI 인터페이스
"""

import os, sys, io, json, time, requests
from pathlib import Path
from dotenv import load_dotenv
from pypdf import PdfReader, PdfWriter
import concurrent.futures
import threading
from typing import List, Tuple
import argparse

API_URL = "https://api.mathpix.com/v3/pdf"

def die(msg: str):
    print(f"[ERROR] {msg}")
    sys.exit(1)

def extract_single_page_bytes(pdf_path: Path, page_idx: int) -> bytes:
    """원본 PDF에서 page_idx(0-base) 한 페이지만 떼어 PDF 바이트 반환"""
    reader = PdfReader(str(pdf_path))
    if not (0 <= page_idx < len(reader.pages)):
        raise IndexError("page_index out of range")
    writer = PdfWriter()
    writer.add_page(reader.pages[page_idx])
    bio = io.BytesIO()
    writer.write(bio)
    return bio.getvalue()

def mathpix_upload_and_get_id(pdf_bytes: bytes, headers: dict) -> str:
    """한 페이지 PDF 업로드 → pdf_id 반환"""
    options = {
        "conversion_formats": {"tex.zip": False},
        "math_inline_delimiters": ["$", "$"],
        "rm_spaces": True,
    }
    files = {"file": ("page.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    data  = {"options_json": json.dumps(options)}
    r = requests.post(API_URL, headers=headers, files=files, data=data, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"Upload failed: {r.status_code} {r.text[:200]}")
    pdf_id = r.json().get("pdf_id")
    if not pdf_id:
        raise RuntimeError(f"No pdf_id in response: {r.text[:200]}")
    return pdf_id

def poll_until_done(pdf_id: str, headers: dict, interval=2, timeout=300):
    """변환 완료까지 폴링"""
    url = f"{API_URL}/{pdf_id}"
    t0 = time.time()
    while True:
        s = requests.get(url, headers=headers, timeout=300).json()
        st = s.get("status")
        if st == "completed":
            return
        if st in ("error", "failed"):
            raise RuntimeError(f"Processing error: {s}")
        if time.time() - t0 > timeout:
            raise TimeoutError("Mathpix processing timeout")
        time.sleep(interval)

def download_mmd(pdf_id: str, headers: dict) -> str:
    """해당 pdf_id의 mmd 텍스트 다운로드"""
    url = f"{API_URL}/{pdf_id}.mmd"
    r = requests.get(url, headers=headers, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"mmd download failed: {r.status_code}")
    return r.text

def process_single_page(page_data: Tuple[int, bytes, dict]) -> Tuple[int, str]:
    """단일 페이지 처리 (병렬 처리용)"""
    page_idx, pdf_bytes, headers = page_data
    page_no = page_idx + 1
    
    print(f"[*] page {page_no} 업로드 시작...")
    
    try:
        # 업로드
        pdf_id = mathpix_upload_and_get_id(pdf_bytes, headers)
        print(f"[*] page {page_no} 업로드 완료 (pdf_id={pdf_id})")
        
        # 대기
        print(f"[*] page {page_no} 변환 대기 중...")
        poll_until_done(pdf_id, headers)
        
        # 다운로드
        print(f"[*] page {page_no} mmd 다운로드 중...")
        mmd = download_mmd(pdf_id, headers)
        
        print(f"[OK] page {page_no} 완료!")
        return page_idx, mmd
        
    except Exception as e:
        print(f"[ERROR] page {page_no} 실패: {e}")
        raise

def process_pages_parallel(pdf_path: Path, headers: dict, max_workers: int = 3) -> List[Tuple[int, str]]:
    """페이지들을 병렬로 처리"""
    reader = PdfReader(str(pdf_path))
    num_pages = len(reader.pages)
    
    print(f"[*] {num_pages}개 페이지를 {max_workers}개 스레드로 병렬 처리...")
    
    # 페이지 데이터 준비
    page_data_list = []
    for i in range(num_pages):
        pdf_bytes = extract_single_page_bytes(pdf_path, i)
        page_data_list.append((i, pdf_bytes, headers))
    
    # 병렬 처리
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 모든 작업 제출
        future_to_page = {
            executor.submit(process_single_page, page_data): page_data[0] 
            for page_data in page_data_list
        }
        
        # 결과 수집
        completed_count = 0
        total_pages = len(future_to_page)
        start_time = time.time()

        for future in concurrent.futures.as_completed(future_to_page):
            page_idx = future_to_page[future]
            try:
                result = future.result()
                results.append(result)
                completed_count += 1

                # 진행상황 및 예상 시간 출력 (1페이지마다)
                elapsed_time = time.time() - start_time
                avg_time_per_page = elapsed_time / completed_count
                remaining_pages = total_pages - completed_count
                estimated_remaining_time = avg_time_per_page * remaining_pages

                percentage = int((completed_count / total_pages) * 100)
                print(f"[PDF진행] {completed_count}/{total_pages} 페이지 ({percentage}%) - 예상 남은 시간: {int(estimated_remaining_time)}초")

            except Exception as e:
                print(f"[ERROR] 페이지 {page_idx + 1} 처리 실패: {e}")
                raise
    
    # 페이지 순서대로 정렬
    results.sort(key=lambda x: x[0])
    return results

def find_sample_dirs():
    """history 폴더에서 샘플 폴더들을 찾기"""
    history_dir = Path("history")
    if not history_dir.exists():
        return []

    sample_dirs = []
    for sample_dir in history_dir.iterdir():
        if sample_dir.is_dir() and sample_dir.name.startswith("sample"):
            sample_dirs.append(sample_dir)

    # 샘플 이름의 숫자 기준으로 정렬 (sample1, sample2, ..., sample10, ...)
    def get_sample_number(path):
        import re
        match = re.search(r'sample(\d+)', path.name)
        return int(match.group(1)) if match else 0

    return sorted(sample_dirs, key=get_sample_number)

def select_sample_interactive():
    """대화형으로 샘플 선택"""
    sample_dirs = find_sample_dirs()

    if not sample_dirs:
        print("❌ history 폴더에서 샘플 폴더를 찾을 수 없습니다.")
        sys.exit(1)

    print("\n📁 사용 가능한 샘플:")
    print("=" * 50)
    for idx, sample_dir in enumerate(sample_dirs, 1):
        pdf_files = list(sample_dir.glob("*.pdf"))
        if pdf_files:
            print(f"  {idx}. {sample_dir.name} ({pdf_files[0].name})")
        else:
            print(f"  {idx}. {sample_dir.name} (PDF 없음)")
    print("=" * 50)

    while True:
        try:
            choice = input("\n선택할 샘플 번호를 입력하세요 (0=종료): ").strip()
            if choice == '0':
                print("종료합니다.")
                sys.exit(0)

            choice_num = int(choice)
            if 1 <= choice_num <= len(sample_dirs):
                selected = sample_dirs[choice_num - 1].name
                print(f"✅ '{selected}' 선택됨\n")
                return selected
            else:
                print(f"⚠️ 1~{len(sample_dirs)} 사이의 번호를 입력하세요.")
        except ValueError:
            print("⚠️ 숫자를 입력하세요.")
        except KeyboardInterrupt:
            print("\n\n종료합니다.")
            sys.exit(0)

def main():
    parser = argparse.ArgumentParser(description="최적화된 PDF 변환 스크립트")
    parser.add_argument("--pdf", type=str, help="변환할 PDF 파일 경로 (서버 모드)")
    parser.add_argument("--sample", type=str, help="history 폴더의 샘플 번호 (테스트 모드)")
    parser.add_argument("--workers", type=int, default=8, help="병렬 처리 워커 수 (기본값: 8)")

    args = parser.parse_args()

    # 모드 결정
    if args.pdf:
        # 서버 모드: --pdf 옵션 사용
        pdf_path = Path(args.pdf).resolve()
        if not pdf_path.exists():
            die(f"파일 없음: {pdf_path}")
        sample_path = None  # 출력은 루트 폴더
    elif args.sample:
        # 테스트 모드: --sample 옵션 사용
        sample_path = Path(f"history/{args.sample}")
        if not sample_path.exists():
            die(f"샘플 폴더가 존재하지 않습니다: {sample_path}")

        pdf_files = list(sample_path.glob("*.pdf"))
        if not pdf_files:
            die(f"샘플 폴더에 PDF 파일이 없습니다: {sample_path}")

        pdf_path = pdf_files[0]
    else:
        # 대화형 모드: 샘플 선택
        selected_sample = select_sample_interactive()
        sample_path = Path(f"history/{selected_sample}")

        if not sample_path.exists():
            die(f"샘플 폴더가 존재하지 않습니다: {sample_path}")

        pdf_files = list(sample_path.glob("*.pdf"))
        if not pdf_files:
            die(f"샘플 폴더에 PDF 파일이 없습니다: {sample_path}")

        pdf_path = pdf_files[0]

    # 환경 변수 로드
    load_dotenv()
    app_id  = os.getenv("APP_ID")
    app_key = os.getenv("APP_KEY")
    if not app_id or not app_key:
        die("APP_ID/APP_KEY 환경변수(.env)가 필요합니다.")
    headers = {"app_id": app_id, "app_key": app_key}

    reader = PdfReader(str(pdf_path))
    num_pages = len(reader.pages)
    print(f"[*] 입력: {pdf_path.name}  총 {num_pages}p")
    print(f"[*] 병렬 처리: {args.workers}개 스레드")

    start_time = time.time()

    # 병렬 처리로 페이지들 변환
    results = process_pages_parallel(pdf_path, headers, args.workers)

    # 결과 합치기
    combined = []
    for page_idx, mmd in results:
        page_no = page_idx + 1
        combined.append(f"<<<PAGE {page_no}>>>")
        combined.append(mmd)

    # 출력 파일 경로 결정
    if sample_path:
        # 테스트/대화형 모드: 샘플 폴더에 저장
        output_file = sample_path / "result.paged.mmd"
    else:
        # 서버 모드: output 폴더에 저장
        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / "result.paged.mmd"

    # 저장
    output_file.write_text("\n".join(combined), encoding="utf-8")

    end_time = time.time()
    duration = end_time - start_time

    print(f"[OK] {output_file} 생성 완료!")
    print(f"[OK] 총 소요 시간: {duration:.2f}초")
    print(f"[OK] 평균 페이지당: {duration/num_pages:.2f}초")

if __name__ == "__main__":
    main()
