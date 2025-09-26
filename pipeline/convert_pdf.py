import os, sys, io, json, time, requests
from pathlib import Path
from dotenv import load_dotenv
from pypdf import PdfReader, PdfWriter
import concurrent.futures
import threading
from typing import List, Tuple

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
        s = requests.get(url, headers=headers, timeout=60).json()
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
        for future in concurrent.futures.as_completed(future_to_page):
            page_idx = future_to_page[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                print(f"[ERROR] 페이지 {page_idx + 1} 처리 실패: {e}")
                raise
    
    # 페이지 순서대로 정렬
    results.sort(key=lambda x: x[0])
    return results

def main():
    if len(sys.argv) < 2:
        die("사용법: python convert_pdf_parallel.py <input.pdf> [max_workers]")
    
    pdf_path = Path(sys.argv[1]).resolve()
    if not pdf_path.exists():
        die(f"파일 없음: {pdf_path}")
    
    # 최대 워커 수 설정 (기본값: 8 - 최적화됨)
    max_workers = 8
    if len(sys.argv) > 2:
        try:
            max_workers = int(sys.argv[2])
        except ValueError:
            print("[WARN] 잘못된 max_workers 값, 기본값 8 사용")
    
    load_dotenv()
    app_id  = os.getenv("APP_ID")
    app_key = os.getenv("APP_KEY")
    if not app_id or not app_key:
        die("APP_ID/APP_KEY 환경변수(.env)가 필요합니다.")
    headers = {"app_id": app_id, "app_key": app_key}

    reader = PdfReader(str(pdf_path))
    num_pages = len(reader.pages)
    print(f"[*] 입력: {pdf_path.name}  총 {num_pages}p")
    print(f"[*] 병렬 처리: {max_workers}개 스레드")
    
    start_time = time.time()
    
    # 병렬 처리로 페이지들 변환
    results = process_pages_parallel(pdf_path, headers, max_workers)
    
    # 결과 합치기
    combined = []
    for page_idx, mmd in results:
        page_no = page_idx + 1
        combined.append(f"<<<PAGE {page_no}>>>")
        combined.append(mmd)
    
    # 저장
    Path("result.paged.mmd").write_text("\n".join(combined), encoding="utf-8")
    
    end_time = time.time()
    duration = end_time - start_time
    
    print(f"[OK] result.paged.mmd 생성 완료!")
    print(f"[OK] 총 소요 시간: {duration:.2f}초")
    print(f"[OK] 평균 페이지당: {duration/num_pages:.2f}초")

if __name__ == "__main__":
    main()
