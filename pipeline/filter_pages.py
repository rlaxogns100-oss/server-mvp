# filter_pages.py — 문제 페이지만 남기고, 정답/해설/빠른정답/정답표 페이지는 제거
# 입력:  result.paged.mmd 또는 result_paged.mmd
# 출력:  result.paged.filtered.mmd
from __future__ import annotations
import re, unicodedata, argparse
from dataclasses import dataclass
from pathlib import Path

# ----------------- 공통 정규식 / 전처리 -----------------
PAGE_MARK_RX = re.compile(r"^<<<PAGE\s+(\d+)\s*>>>$")

HEADING_LINE_RX = re.compile(
    r"""^\s{0,3}(?:\\section\*\{([^}]*)\}|#{1,4}\s*(.+))\s*$"""
)

INVIS_RX = re.compile(r"[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00A0]")
TRANS = str.maketrans({
    "（":"(", "）":")", "［":"[", "］":"]", "．":".", "。":".",
    "【":"[", "】":"]", "「":"[", "」":"]", "｢":"[", "｣":"]"
})
def norm(s:str)->str:
    s = s or ""
    s = INVIS_RX.sub("", s)
    s = unicodedata.normalize("NFKC", s)
    s = s.translate(TRANS)
    return s.strip()

# ----------------- 새로운 필터링 조건들 (v2에서 복사) -----------------

# 1. 해설 조건: '따라서, ~므로, [반례], ~에 의하여'의 variation
SOLUTION_PATTERNS = [
    # 따라서 패턴들
    (r'따라서', 10),
    (r'그러므로', 10),
    (r'그러므로\s*답은', 15),
    (r'따라서\s*답은', 15),
    
    # ~므로 패턴들
    (r'[가-힣]+므로', 8),
    (r'[가-힣]+므로\s*답은', 12),
    (r'[가-힣]+므로\s*정답은', 12),
    
    # [반례] 패턴들
    (r'\[반례\]', 15),
    (r'반례', 8),
    (r'반례를\s*들면', 10),
    (r'반례로', 8),
    
    # ~에 의하여 패턴들
    (r'[가-힣]+에\s*의하여', 8),
    (r'[가-힣]+에\s*의해', 8),
    (r'[가-힣]+에\s*따라', 8),
    (r'[가-힣]+에\s*따르면', 8),
    
    # 기타 해설 신호들
    (r'∴', 5),
    (r'이므로', 5),
    (r'그러므로', 5),
    (r'즉', 3),
    (r'정리하면', 5),
    (r'계산하면', 5),
    (r'대입하면', 5),
    (r'풀어보면', 5),
]

# 2. 문항 조건: inspect_signals.py의 종료 신호
QUESTION_END_RX = re.compile(
    r'(?:\?|？|물음표|구하시오|구하여라|구하라|하라|서술하시오|서술하라|설명하시오|설명하라|'
    r'계산하시오|계산하라|증명하시오|증명하라|보이시오|보이라|찾으시오|찾으라|'
    r'고르시오|고르라|선택하시오|선택하라|작성하시오|작성하라|기입하시오|기입하라|'
    r'쓰시오|하시오)'
    r'(?:\s*\([^)]*\))?'  # 끝 신호 후 소괄호 조건 허용
)

# 이미지 링크 패턴 (문항 끝 조건에서 제외)
IMAGE_LINK_RX = re.compile(r'!\[.*?\]\([^)]+\)|\\includegraphics(?:\[[^\]]*\])?\{[^}]+\}')

# [n점] 점수 표기
SCORE_BRACKET_RX    = re.compile(r'\[\s*\d+(?:\.\d+)?\s*점(?:[^\]]*)\]')

# 답안표/테이블 강 판정
def looks_like_answer_table(page_text:str)->bool:
    t = page_text
    has_tab = bool(re.search(r'\\begin\{tabular\}', t))
    choice_tokens = len(re.findall(r'\(\s*[1-5]\s*\)', t))
    amp = t.count('&'); bs = t.count('\\\\')
    letters = len(re.findall(r'[가-힣a-zA-Z]', t))
    symbols = len(re.findall(r'[0-9\(\)\[\]\{\}&\\\\=\+\-\*/\.,]+', t))
    # 강 조건(테이블 + 선택 토큰/구분자 다량 + 본문 적음)
    if has_tab and choice_tokens >= 6 and (amp+bs) >= 6 and letters <= 40:
        return True
    # 테이블 없어도, 선택토큰 다량 + 본문적음 + 구분자 존재
    if choice_tokens >= 10 and letters <= 30 and (amp+bs) >= 2:
        return True
    # 숫자/기호가 압도적으로 많고 선택토큰도 충분
    if letters <= 25 and symbols >= 120 and choice_tokens >= 6:
        return True
    return False

# ----------------- 페이지 분할 -----------------
def split_pages(text:str):
    pages=[]; cur=[]; pno=None
    for raw in text.splitlines():
        if m := PAGE_MARK_RX.match(norm(raw)):
            if pno is not None:
                pages.append((pno, cur)); cur=[]
            pno = int(m.group(1)); continue
        if pno is None: pno = 1
        cur.append(raw)
    if pno is not None: pages.append((pno, cur))
    return pages

@dataclass
class Stat:
    page:int
    lines:int
    question_ends:int
    solution_score:int
    question_score:int
    score_hits:int
    ans_table:bool
    keep:bool
    reason:str

# ----------------- 페이지 판정 -----------------
def classify_page(pno:int, raw_lines:list[str])->Stat:
    question_ends = 0
    solution_score = 0
    question_score = 0
    score_hits = 0

    # 페이지 전체 텍스트
    page_text = norm("\n".join(raw_lines))
    
    # 문항 종료 신호 검색 (이미지 링크 제외)
    for ln in raw_lines:
        det = norm(ln)
        if not det: continue

        # 이미지 링크가 아닌 경우에만 종료 신호로 인식
        if (QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det)):
            question_ends += 1

    # 해설 패턴 점수 계산
    for pattern, score in SOLUTION_PATTERNS:
        matches = re.findall(pattern, page_text, re.IGNORECASE)
        solution_score += len(matches) * score

    # 문항 점수 계산
    question_score += question_ends * 30  # 문항 종료 신호만
    question_score += score_hits * 3  # 점수 브라켓

    # 기타 신호들
    score_hits = len(SCORE_BRACKET_RX.findall(page_text))
    ans_table = looks_like_answer_table(page_text)

    # ---- 최우선 조건: 문항 종료 신호가 없으면 해설 페이지 ----
    if question_ends == 0:
        return Stat(pno, len(raw_lines), question_ends, solution_score,
                    question_score, score_hits, ans_table, False, "DROP_NO_QUESTION_END")

    # ---- 하드 드롭 규칙 ----
    # 1) 답안표/정답표 테이블 강 판정
    if ans_table:
        return Stat(pno, len(raw_lines), question_ends, solution_score,
                    question_score, score_hits, ans_table, False, "DROP_ANSWER_TABLE")

    # 2) 해설 점수가 문항 점수보다 높으면 DROP
    if solution_score > question_score:
        return Stat(pno, len(raw_lines), question_ends, solution_score,
                    question_score, score_hits, ans_table, False, "DROP_SOLUTION_OVER_QUESTION")

    # ---- 문제 페이지 판정 ----
    # 문항 종료 신호가 있으면 문제 페이지
    if question_ends >= 1:
        return Stat(pno, len(raw_lines), question_ends, solution_score,
                    question_score, score_hits, ans_table, True, "KEEP_QUESTION_END")

    # 기본적으로 보존 (보수적 접근)
    return Stat(pno, len(raw_lines), question_ends, solution_score,
                question_score, score_hits, ans_table, True, "KEEP_DEFAULT")

# ----------------- 샘플 찾기 -----------------
def find_sample_pdfs():
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
    import sys
    sample_dirs = find_sample_pdfs()

    if not sample_dirs:
        print("❌ history 폴더에서 샘플 폴더를 찾을 수 없습니다.")
        sys.exit(1)

    print("\n📁 사용 가능한 샘플:")
    print("=" * 50)
    for idx, sample_dir in enumerate(sample_dirs, 1):
        print(f"  {idx}. {sample_dir.name}")
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

# ----------------- 메인 -----------------
def main():
    parser = argparse.ArgumentParser(description="문제 페이지 필터링 스크립트")
    parser.add_argument("--sample", type=str, help="history 폴더의 샘플 번호 (예: sample1)")

    args = parser.parse_args()

    # 모드 결정
    if args.sample:
        # 테스트 모드: --sample 옵션 사용
        sample_path = Path(f"history/{args.sample}")
        if not sample_path.exists():
            raise SystemExit(f"샘플 폴더가 존재하지 않습니다: {sample_path}")

        src = None
        for cand in ("result.paged.mmd", "result_paged.mmd"):
            p = sample_path / cand
            if p.exists():
                src = p
                break

        if not src:
            raise SystemExit(f"{sample_path} 폴더에 result.paged.mmd 파일을 찾을 수 없습니다.")

        # 출력도 같은 샘플 폴더에 저장
        output_path = sample_path / "result.paged.filtered.mmd"
    else:
        # 서버 모드 또는 대화형 모드
        # 대화형 모드인지 확인 (stdin이 터미널인지)
        import sys
        if sys.stdin.isatty():
            # 대화형 모드: 샘플 선택
            selected_sample = select_sample_interactive()
            sample_path = Path(f"history/{selected_sample}")
            if not sample_path.exists():
                raise SystemExit(f"샘플 폴더가 존재하지 않습니다: {sample_path}")

            src = None
            for cand in ("result.paged.mmd", "result_paged.mmd"):
                p = sample_path / cand
                if p.exists():
                    src = p
                    break

            if not src:
                raise SystemExit(f"{sample_path} 폴더에 result.paged.mmd 파일을 찾을 수 없습니다.")

            output_path = sample_path / "result.paged.filtered.mmd"
        else:
            # 서버 모드: 기본 경로 사용
            src = None
            for cand in ("output/result.paged.mmd", "output/result_paged.mmd", "result.paged.mmd", "result_paged.mmd"):
                p = Path(cand)
                if p.exists():
                    src = p
                    break

            if not src:
                raise SystemExit("output/result.paged.mmd / result.paged.mmd 파일을 찾을 수 없습니다.")

            output_dir = Path("output")
            output_dir.mkdir(exist_ok=True)
            output_path = output_dir / "result.paged.filtered.mmd"

    pages = split_pages(src.read_text(encoding="utf-8"))
    kept = []
    for pno, lines in pages:
        st = classify_page(pno, lines)

        # 항상 터미널 로그 출력
        print(
            f"[PAGE {st.page:>2}] keep={st.keep:<5} reason={st.reason:<25} "
            f"(lines={st.lines:>3})  "
            f"qends={st.question_ends}  "
            f"q_score={st.question_score} sol_score={st.solution_score} "
            f"scoreTag={st.score_hits} ansTable={st.ans_table}"
        )

        if st.keep:
            kept.append(f"<<<PAGE {pno}>>>")
            kept.extend(lines)

    if not kept:
        print("[!] 모든 페이지가 제거됨 → 원본 유지")
        for pno, lines in pages:
            kept.append(f"<<<PAGE {pno}>>>")
            kept.extend(lines)

    output_path.write_text("\n".join(kept), encoding="utf-8")
    print(f"[OK] {output_path} 생성")

if __name__ == "__main__":
    main()
