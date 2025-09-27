# make_exam.py — 시험지 생성 메인 스크립트
#
# 전체 작동 흐름:
# 1. problems_structured.json 로드
# 2. 각 문제별 용적(공간) 계산
# 3. 컬럼 그룹핑 (1페이지 헤더 패널티 적용)
# 4. LaTeX 코드 생성 및 텍스트 정제
# 5. PDF 컴파일 (tectonic/xelatex)

import os, re, math, json, hashlib, shutil, subprocess, urllib.request, unicodedata
from urllib.parse import urlparse
from pathlib import Path

# ===== 파일 경로 설정 =====
DATA = Path("output/problems_structured.json")  # 입력: 구조화된 문제 데이터
BUILD  = Path("output")                         # 출력: LaTeX 파일 및 PDF 생성
IMGDIR = BUILD / "images"                       # 이미지 다운로드 저장 경로

# ===== 시험지 메타데이터 설정 =====
# exam_meta.json 파일이 있으면 해당 값으로 덮어쓰기
META = {
    "academy": "수학학원명",        # 학원명 (헤더 좌측)
    "grade":   "고1",              # 학년 (헤더 좌측)
    "series":  "모의고사(N회)",     # 시리즈명 (헤더 중앙)
    "exam":    "1학기 중간고사",    # 시험명 (헤더 우측)
    "footer_left":  "수학학습실",   # 푸터 좌측
    "footer_right": "https://www.math114.net",  # 푸터 우측
    "label_name": "이름",          # 학생 정보 라벨
    "label_date": "날짜",
    "label_time": "시간",
    "label_unit": "단원",
}
META_FILE = Path("exam_meta.json")
if META_FILE.exists():
    try: META.update(json.loads(META_FILE.read_text(encoding="utf-8")))
    except Exception: pass

# ===== 레이아웃 파라미터 설정 =====
CHARS_PER_LINE           = 36         # 한 줄당 문자 수 (용적 계산 기준)
COLUMN_CAP_LINES         = 60         # 일반 컬럼 최대 줄 수
FIRSTPAGE_HEADER_PENALTY = 8          # 1페이지 좌/우 컬럼에서 헤더로 인해 감소하는 줄 수
OPTION_GRID_THRESHOLD    = 34         # 선택지 그리드 배치 기준 (문자 수)
OPTION_VSPACE_1COL       = "0.2em"    # 1열 선택지 간 세로 간격

# 이미지 크기 제한 (inch 단위)
IMAGE_WIDTH_FRAC         = 0.4        # 사용하지 않음 (레거시)
IMAGE_MIN_WIDTH_INCH     = 1.2        # 최소 가로 크기
IMAGE_MIN_HEIGHT_INCH    = 0.6        # 최소 세로 크기
IMAGE_MAX_WIDTH_INCH     = 2.0        # 최대 가로 크기
IMAGE_MAX_HEIGHT_INCH    = 2.5        # 최대 세로 크기

SPACER_FIXED_LINES       = 12         # 모든 문항 하단 고정 여백 줄 수

# ===== 유틸리티 함수들 =====
def _ext_from_url(u: str) -> str:
    """URL에서 이미지 파일 확장자 추출 (기본값: .jpg)"""
    path = urlparse(u).path.lower()
    for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        if path.endswith(ext):
            return ext
    return ".jpg"  # 확장자를 찾을 수 없으면 기본값

def _download(url: str, dst: Path):
    """URL에서 파일 다운로드 후 지정된 경로에 저장"""
    dst.parent.mkdir(parents=True, exist_ok=True)  # 디렉토리 생성
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        dst.write_bytes(r.read())


def get_image_size_options(image_path):
    """이미지 실제 크기를 분석하여 LaTeX includegraphics 옵션 생성

    PyMuPDF를 사용해 이미지 크기를 분석하고,
    최소/최대 크기 제한을 적용하여 적절한 크기로 조정

    Args:
        image_path: 이미지 파일 경로

    Returns:
        str: LaTeX includegraphics 옵션 (예: "width=144.0pt,height=86.4pt")
    """
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(image_path)
        page = doc[0]
        width_pt = page.rect.width
        height_pt = page.rect.height
        doc.close()
        
        # pt를 inch로 변환 (1 inch = 72 pt)
        width_inch = width_pt / 72
        height_inch = height_pt / 72
        
        # 비율 유지하면서 크기 제한 적용
        aspect_ratio = width_inch / height_inch
        
        # Step 1: 최소 크기 확인 및 적용 (우선순위)
        if width_inch < IMAGE_MIN_WIDTH_INCH:
            width_inch = IMAGE_MIN_WIDTH_INCH
            height_inch = width_inch / aspect_ratio
        
        if height_inch < IMAGE_MIN_HEIGHT_INCH:
            height_inch = IMAGE_MIN_HEIGHT_INCH
            width_inch = height_inch * aspect_ratio
        
        # Step 2: 최대 크기 확인 및 적용
        if width_inch > IMAGE_MAX_WIDTH_INCH:
            width_inch = IMAGE_MAX_WIDTH_INCH
            height_inch = width_inch / aspect_ratio
        
        if height_inch > IMAGE_MAX_HEIGHT_INCH:
            height_inch = IMAGE_MAX_HEIGHT_INCH
            width_inch = height_inch * aspect_ratio
        
        # inch를 pt로 변환
        width_pt = width_inch * 72
        height_pt = height_inch * 72
        
        return f"width={width_pt:.1f}pt,height={height_pt:.1f}pt"
        
    except Exception as e:
        print(f"[warn] 이미지 크기 분석 실패 {image_path}: {e}")
        # 기본값 사용
        return f"width={IMAGE_MIN_WIDTH_INCH * 72:.1f}pt"

# ===== 텍스트 분석용 정규표현식 =====
# 수식과 LaTeX 명령어를 제외하고 실제 텍스트 길이만 계산하기 위함
MATH_BLOCK  = re.compile(r'\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]')  # $$...$$, \[...\]
MATH_INLINE = re.compile(r'\$[^$]*\$|\\\([^)]*\\\)')              # $...$, \(...\)
CMD         = re.compile(r'\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?')   # LaTeX 명령어

def _plain_len(s: str) -> int:
    """텍스트에서 LaTeX 명령어와 수식을 제외한 실제 문자 수 계산

    수식과 LaTeX 명령어는 실제 출력에서 공간을 적게 차지하므로
    용적 계산 시 제외하거나 축소하여 계산

    Args:
        s: 분석할 텍스트

    Returns:
        int: 실제 표시될 문자 수
    """
    s = CMD.sub('', s or "")              # LaTeX 명령어 제거
    s = MATH_BLOCK.sub('  ', s)          # 블록 수식 → 2글자로 축소
    s = MATH_INLINE.sub(' ', s)          # 인라인 수식 → 1글자로 축소
    s = re.sub(r'\s+', ' ', s).strip()   # 여러 공백 → 단일 공백
    return len(s)

def est_text_lines(s):
    """텍스트가 차지할 줄 수 추정

    36자/줄 기준으로 계산하며, 빈 텍스트가 아니면 최소 1줄

    Args:
        s: 텍스트 문자열

    Returns:
        int: 추정 줄 수
    """
    n = _plain_len(s)
    return 0 if n == 0 else max(1, math.ceil(n / CHARS_PER_LINE))

def est_opt_lines(opts):
    """선택지들이 차지할 총 줄 수 추정

    각 선택지마다:
    - 기본 1줄 (선택지 번호 및 시작)
    - 내용 길이의 80% 추가 (선택지는 보통 짧아서 80% 적용)

    Args:
        opts: 선택지 리스트

    Returns:
        int: 총 추정 줄 수
    """
    if not opts:
        return 0
    tot = 0
    for o in opts:
        tot += 1 + math.ceil(0.8 * est_text_lines(o))
    return tot


def estimate_units(item):
    """기존 형식 문제의 용적 계산 (레거시 지원용)

    Args:
        item: 문제 데이터 (question, options 키 포함)

    Returns:
        tuple: (기본_줄수, 여백_줄수, 총_줄수)
    """
    base = est_text_lines(item.get("question", ""))     # 문제 본문
    base += est_opt_lines(item.get("options") or [])    # 선택지들
    spacer = SPACER_FIXED_LINES                        # 고정 여백
    return base, spacer, base + spacer

def estimate_units_structured(item):
    """structured 형식의 문제 용적 계산

    content_blocks의 각 블록 타입별로 다른 방식으로 용적 계산:
    - text: 일반 텍스트 줄 수 계산
    - image: 고정 3줄
    - table: 줄바꿈 기준 줄 수 (최소 3줄)
    - examples: 조건별 1줄씩

    Args:
        item: structured 형식 문제 데이터

    Returns:
        tuple: (기본_줄수, 여백_줄수, 총_줄수)
    """
    base = 0

    # content_blocks 처리 - 블록 타입별 용적 계산
    for block in item.get("content_blocks", []):
        block_type = block.get("type", "text")
        content = block.get("content", "")

        if block_type == "text":
            base += est_text_lines(content)
        elif block_type == "image":
            base += 3  # 이미지는 고정 3줄로 계산
        elif block_type == "table":
            # 테이블은 줄바꿈 기준으로 줄 수 계산
            if isinstance(content, str):
                base += max(3, len(content.split('\n')))
            else:
                base += 3  # 기본값
        elif block_type == "examples":
            # 보기는 각 조건당 1줄로 계산
            if isinstance(content, list):
                base += len(content)
            else:
                base += est_text_lines(str(content))

    # 선택지 처리
    base += est_opt_lines(item.get("options") or [])

    spacer = SPACER_FIXED_LINES
    return base, spacer, base + spacer

# 복합문제 처리 로직 - 현재 주석처리
# def estimate_units_composite(item):
#     """복합 문제의 용적 계산"""
#     base = 0
#
#     # 메인 문제
#     base += est_text_lines(item.get("main_question", ""))
#     base += est_opt_lines(item.get("main_options") or [])
#
#     # 각 소문제
#     for sub in item.get("sub_problems", []):
#         base += est_text_lines(sub.get("question", ""))
#         base += est_opt_lines(sub.get("options") or [])
#
#     spacer = SPACER_FIXED_LINES
#     return base, spacer, base + spacer

# ===== 컬럼 그룹핑 시스템 =====
def group_columns_with_caps(items):
    """문제들을 컬럼별로 그룹핑 (용적 기반)

    1페이지 좌/우 컬럼은 헤더로 인해 용적이 8줄 감소
    일반 컬럼은 60줄 용적을 가짐

    Args:
        items: 용적이 계산된 문제 리스트

    Returns:
        tuple: (그룹_리스트, 용적_리스트)
    """
    groups = []; caps = []  # 그룹과 각 그룹의 용적 한도
    col_idx = 0             # 현재 컬럼 인덱스
    cur = []; cur_h = 0     # 현재 그룹과 누적 높이

    def cap_for(col_idx: int) -> int:
        """컬럼 인덱스에 따른 용적 한도 계산"""
        if col_idx in (0, 1):  # 1페이지 좌/우 컬럼
            return max(20, COLUMN_CAP_LINES - FIRSTPAGE_HEADER_PENALTY)
        return COLUMN_CAP_LINES  # 일반 컬럼

    for it in items:
        u = it["_units_total"]
        cap = cap_for(col_idx)
        if cur_h + u > cap and cur:   # 새 칼럼
            groups.append(cur); caps.append(cap); cur=[]; cur_h=0; col_idx += 1
            cap = cap_for(col_idx)
        cur.append(it); cur_h += u
    if cur:
        groups.append(cur); caps.append(cap_for(col_idx))
    return groups, caps

# ===== 컬럼 컴팩션 시스템 (현재 비활성화) =====
def compact_groups(groups, caps):
    """컬럼 간 여유 공간 활용하여 문제 재배치 (현재 사용하지 않음)

    인접한 컬럼에서 현재 컬럼으로 문제를 당겨와서
    페이지 활용도를 높이는 기능 (순서 유지 문제로 비활성화)

    Args:
        groups: 컬럼별 그룹 리스트
        caps: 각 컬럼의 용적 한도

    Returns:
        tuple: (재배치된_그룹_리스트, 용적_리스트)
    """
    new = [list(g) for g in groups]  # 깊은 복사

    for i in range(len(new) - 1):
        cur = new[i]     # 현재 컬럼
        nxt = new[i + 1] # 다음 컬럼
        cap = caps[i]    # 현재 컬럼 용적 한도
        cur_h = sum(it["_units_total"] for it in cur)  # 현재 컬럼 사용량

        # 1) 다음 칼럼의 앞쪽부터 가능한 만큼 당겨오기
        moved = True
        while moved and nxt:
            moved = False
            if cur_h + nxt[0]["_units_total"] <= cap:
                it = nxt.pop(0)
                cur.append(it)
                cur_h += it["_units_total"]
                moved = True

        # 2) slack에 가장 잘 맞는 항목 하나 더 당겨오기 (순서 유지)
        if nxt:
            slack = cap - cur_h
            # 순서를 유지하면서 첫 번째로 맞는 항목을 선택
            for j, it in enumerate(nxt):
                u = it["_units_total"]
                if u <= slack:
                    it = nxt.pop(j)
                    cur.append(it)
                    break

    # 빈 칼럼 제거
    keep=[]; keep_caps=[]
    for g,cap in zip(new,caps):
        if g: keep.append(g); keep_caps.append(cap)
    return keep, keep_caps

# ===== 선택지 배치 시스템 =====
# 복잡한 선택지 패턴 감지용 정규표현식
MATH_OR_COMPLEX = re.compile(r'\$\$|\\\[|\\begin\{tabular|\\(frac|dfrac|displaystyle)')
HANGUL_RX       = re.compile(r'[가-힣]')  # 한글 감지

def circled(n: int) -> str:
    """숫자를 원형 기호로 변환 (①②③④⑤)"""
    return chr(0x2460 + (n - 1))
def use_3x2(opts) -> bool:
    """선택지를 3×2 그리드로 배치할지 결정

    조건:
    - 선택지가 정확히 5개
    - 한글이 포함되지 않음
    - 복잡한 수식이 포함되지 않음
    - 선택지 길이가 15~34자 범위

    Args:
        opts: 선택지 리스트

    Returns:
        bool: 3×2 그리드 사용 여부
    """
    if len(opts) != 5:
        return False
    if any(HANGUL_RX.search(o or "") for o in opts):
        return False  # 한글 포함 시 1열 배치
    if any(MATH_OR_COMPLEX.search(o or "") for o in opts):
        return False  # 복잡한 수식 포함 시 1열 배치

    # 선택지 길이 기준 판단
    max_len = max((_plain_len(o or "") for o in opts), default=0)
    return max_len <= OPTION_GRID_THRESHOLD and max_len > 15

# ===== 텍스트 정제 시스템 =====
# 불필요한 라벨/패턴 제거용 정규표현식
BOGI_LABEL_LINE_RX = re.compile(
    r'^\s*(?:\\section\*\{)?\s*[\[\(<（【]?\s*보\s*기\s*[\]\)>）】]?\s*\}?\s*$',
    re.IGNORECASE
)  # [보기], (보기), \section*{보기} 등 보기 라벨 제거
CONDITION_LABEL_LINE_RX = re.compile(
    r'^\s*(?:\\section\*\{)?\s*[\[\(<（【]?\s*조\s*건\s*[\]\)>）】]?\s*\}?\s*$',
    re.IGNORECASE
)
TCBOX_GARBAGE_RX = re.compile(
    r'(?:^|\s)(enhanced|breakable|colback|colframe|boxrule|arc=|left=|right=|top=|bottom=|title=|boxed title|attach boxed title|xshift|yshift)\b'
)
# 배점/부분점수 필터링 (점수 관련 패턴만, 일반적인 "점"은 제외)
SCORE_PATTERN_RX = re.compile(
    r'(?:배점|부분점수|점수)\s*[:\-]?\s*\d+',
    re.IGNORECASE
)

def _merge_math_lines(text: str) -> str:
    """여러 줄에 걸친 수식을 한 줄로 합치기

    PDF 추출 과정에서 수식이 여러 줄로 분리되는 경우가 있어
    이를 하나로 합쳐서 LaTeX에서 올바르게 처리되도록 함

    Args:
        text: 처리할 텍스트

    Returns:
        str: 수식이 합쳐진 텍스트
    """
    lines = text.split('\n')
    merged = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            merged.append('')
            i += 1
            continue
            
        # 수식이 시작되는 줄인지 확인
        if line.startswith('$') and not line.endswith('$'):
            # 수식이 여러 줄에 걸쳐 있는 경우
            math_content = line
            j = i + 1
            
            # 다음 줄들을 확인하여 수식이 끝날 때까지 합치기
            while j < len(lines) and not lines[j].strip().endswith('$'):
                math_content += ' ' + lines[j].strip()
                j += 1
            
            # 마지막 줄도 포함
            if j < len(lines):
                math_content += ' ' + lines[j].strip()
                j += 1
            
            merged.append(math_content)
            i = j
        else:
            merged.append(line)
            i += 1
    
    return '\n'.join(merged)

def _convert_markdown_table_to_latex(text: str) -> str:
    """Markdown 표를 LaTeX tabular 환경으로 변환

    |---|---|--- 형태의 Markdown 표를
    LaTeX의 tabular 환경으로 변환하여 PDF에서 올바르게 렌더링

    Args:
        text: Markdown 표가 포함된 텍스트

    Returns:
        str: LaTeX tabular로 변환된 텍스트
    """
    lines = text.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Markdown 표 시작 감지 (|로 시작하는 줄)
        if line.startswith('|') and '|' in line[1:]:
            table_lines = []
            separator_found = False
            
            # 표의 모든 줄 수집
            while i < len(lines):
                current_line = lines[i].strip()
                if not current_line.startswith('|'):
                    break
                    
                # 구분선 감지 (|---|---|)
                if re.match(r'^\|[\s\-\|]+\|$', current_line):
                    separator_found = True
                    i += 1
                    continue
                    
                table_lines.append(current_line)
                i += 1
            
            if len(table_lines) >= 1 and separator_found:
                # LaTeX tabular 환경으로 변환
                latex_table = _markdown_table_to_latex(table_lines)
                result.append(latex_table)
                continue
        
        result.append(lines[i])
        i += 1
    
    return '\n'.join(result)

def _markdown_table_to_latex(table_lines: list) -> str:
    """Markdown 표를 LaTeX tabular로 변환"""
    if not table_lines:
        return ""
    
    # 첫 번째 줄에서 열 개수 확인
    first_line = table_lines[0]
    columns = first_line.count('|') - 1  # 양끝 | 제외
    
    # LaTeX tabular 환경 생성
    latex_lines = []
    latex_lines.append(r"\begin{center}")
    latex_lines.append(r"\begin{tabular}{" + "|c" * columns + "|}")
    latex_lines.append(r"\hline")
    
    for line in table_lines:
        # | 제거하고 셀 분리
        cells = [cell.strip() for cell in line.split('|')[1:-1]]
        
        # LaTeX 행 생성
        latex_row = " & ".join(cells) + r" \\"
        latex_lines.append(latex_row)
        latex_lines.append(r"\hline")
    
    latex_lines.append(r"\end{tabular}")
    latex_lines.append(r"\end{center}")
    latex_lines.append("")  # 빈 줄 추가
    
    return '\n'.join(latex_lines)

def _sanitize_structured_content_block(block_data):
    """structured 형식의 content_blocks를 LaTeX 형태로 변환

    각 블록 타입별로 적절한 처리를 수행:
    - text: 기존 텍스트 정제 로직 적용
    - image: 그대로 전달 (추후 LaTeX 변환 필요)
    - table: 문자열로 변환
    - examples: 한글 조건 형태로 변환

    Args:
        block_data: content_blocks 리스트

    Returns:
        str: LaTeX 형태로 변환된 텍스트
    """
    result_parts = []

    for block in block_data:
        block_type = block.get("type", "text")
        content = block.get("content", "")

        if block_type == "text":
            # 기존 텍스트 정제 로직 적용
            sanitized = _sanitize_question_text(content)
            if sanitized.strip():
                result_parts.append(sanitized)

        elif block_type == "image":
            # 이미지 처리 (현재는 그대로 전달, 추후 LaTeX 변환 필요)
            result_parts.append(content)

        elif block_type == "table":
            # 테이블 처리
            if isinstance(content, str):
                result_parts.append(content)
            else:
                result_parts.append(str(content))

        elif block_type == "examples":
            # 보기 처리 - (가)(나)(다) 형태로 변환
            if isinstance(content, list):
                examples_text = "\n".join(f"({chr(0xAC00 + i)}) {item}" for i, item in enumerate(content))
                result_parts.append(examples_text)
            else:
                result_parts.append(str(content))

    return "\n\n".join(result_parts)

def _sanitize_question_text(block: str) -> str:
    """문제 텍스트 정제 및 LaTeX 형태로 변환

    수행하는 작업들:
    - 수식 줄바꿈 문제 해결
    - Markdown 표를 LaTeX tabular로 변환
    - 이미지 마커를 includegraphics로 변환
    - 불필요한 라벨 및 명령어 제거
    - 배점 정보 제거
    - 테이블 환경 정리

    Args:
        block: 원본 텍스트

    Returns:
        str: 정제된 LaTeX 텍스트
    """
    if not block: return block
    
    # 수식 줄바꿈 문제 해결
    block = _merge_math_lines(block)
    
    # Markdown 표를 LaTeX tabular로 변환
    block = _convert_markdown_table_to_latex(block)
    
    # 이미지 마커 처리 (@@IMAGE:url@@를 \includegraphics로 변환)
    def replace_image_marker(match):
        url = match.group(1)
        try:
            # URL에서 이미지 다운로드
            h = hashlib.md5(url.encode("utf-8")).hexdigest()
            fp = IMGDIR / f"img_{h}{_ext_from_url(url)}"
            if not fp.exists(): 
                _download(url, fp)
            rel = os.path.relpath(fp, start=BUILD).replace("\\","/")
            size_opts = get_image_size_options(fp)
            return f"\\begin{{center}}\\includegraphics[{size_opts}]{{{rel}}}\\end{{center}}"
        except Exception as e:
            print(f"[warn] 이미지 처리 실패 {url}: {e}")
            return ""
    
    # 이미지 마커를 LaTeX로 변환
    block = re.sub(r'@@IMAGE:([^@]+)@@', replace_image_marker, block)
    
    out=[]
    in_table = False
    table_lines = []
    
    for ln in block.splitlines():
        det = unicodedata.normalize("NFKC", ln)
        if BOGI_LABEL_LINE_RX.match(det): 
            continue
        if CONDITION_LABEL_LINE_RX.match(det):
            continue
        if TCBOX_GARBAGE_RX.search(det) and not det.lstrip().startswith('\\'):
            continue
        # 배점/부분점수 제거
        det = SCORE_PATTERN_RX.sub('', det)
        # 잘못된 LaTeX 구문 제거
        if det.strip().startswith('\\section*{[') and '보기' in det:
            continue
        if det.strip() == '\\section*{<보기>}':
            continue
        # \section*{숫자. ...} 패턴 제거 (문항번호 중복 방지)
        if det.strip().startswith('\\section*{') and re.match(r'\\section*\{\d+\.', det.strip()):
            continue
        # \captionsetup 명령어 제거 (정의되지 않은 명령어)
        if det.strip().startswith('\\captionsetup'):
            continue
        # \begin{table}과 \end{table} 제거 (float 문제 방지)
        if det.strip() == '\\begin{table}':
            continue
        if det.strip() == '\\end{table}':
            continue
        # \caption 명령어를 텍스트로 변환 (표 제목 표시)
        if det.strip().startswith('\\caption'):
            # \caption{[표1]} → [표1] 텍스트로 변환하고 중앙 정렬
            caption_text = re.sub(r'\\caption\{([^}]+)\}', r'\1', det.strip())
            out.append("")  # 위쪽 빈 줄
            out.append(r"\begin{center}")
            out.append(caption_text)
            out.append(r"\end{center}")
            out.append("")  # 아래쪽 빈 줄
            continue
        
        # [표1], [그림1] 등 이미지 설명 텍스트 처리
        if re.match(r'^\[(?:표|그림)\d+\]$', det.strip()):
            # 위아래에 줄바꿈 추가하고 중앙 정렬
            out.append("")  # 위쪽 빈 줄
            out.append(r"\begin{center}")
            out.append(det.strip())
            out.append(r"\end{center}")
            out.append("")  # 아래쪽 빈 줄
            continue
        
        # 테이블 처리
        if det.strip().startswith('\\begin{tabular}'):
            in_table = True
            table_lines = [det]
            continue
        elif det.strip().startswith('\\end{tabular}'):
            in_table = False
            table_lines.append(det)
            # 테이블을 별도 공간으로 처리
            out.append(r"\begin{center}")
            out.extend(table_lines)
            out.append(r"\end{center}")
            out.append("")  # 테이블 후 빈 줄
            table_lines = []
            continue
        elif in_table:
            table_lines.append(det)
            continue
        
        if det.strip():  # 빈 줄이 아닌 경우만 추가
            out.append(det)
    
    # @@CONDITION@@ 플레이스홀더 처리
    result = "\n".join(out)
    result = re.sub(r'@@CONDITION\d+@@', lambda m: m.group(0), result)
    return result

def _convert_numbers_to_math(text:str)->str:
    """선택지의 숫자만 수식으로 변환 (문제 본문은 제외)"""
    if not text: return text
    # 이 함수는 현재 사용하지 않음 - 문제 본문의 숫자를 수식으로 변환하면 안됨
    return text

# ===== LaTeX 생성 시스템 =====
def preamble_before_document() -> str:
    """LaTeX 문서의 프리앰블 생성

    한글 폰트, 레이아웃, 헤더/푸터 등 기본 설정을 포함
    모든 텍스트를 굵게 표시하고 수식도 굵게 처리

    Returns:
        str: LaTeX 프리앰블 코드
    """
    return (
r"""\documentclass[10.5pt]{article}
\usepackage{amsmath,amssymb}
\usepackage{fontspec}
\usepackage{xcolor}
\usepackage{graphicx}
\usepackage{tabularx}
\usepackage{enumitem}
\usepackage{multicol}
\usepackage{fancyhdr}
\usepackage[many]{tcolorbox}
\usepackage[a4paper, top=16mm, bottom=20mm, left=13mm, right=13mm]{geometry}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
% Slightly scale up main font without changing class size
\IfFontExistsTF{Noto Sans KR}{\setmainfont{Noto Sans KR}[Scale=1.05,BoldFont={* Bold},AutoFakeBold=2]}{\setmainfont{Malgun Gothic}[Scale=1.05,BoldFont={* Bold},AutoFakeBold=2]}
% Make all text bold by default
\renewcommand{\mddefault}{\bfdefault}
% Also bolden math content globally
\AtBeginDocument{\boldmath}
% Use solid black for strong print
\definecolor{examBlue}{HTML}{000000}
\definecolor{ruleGray}{gray}{0.0}
\pagestyle{fancy}
\fancyhf{}
% Bump headheight to avoid fancyhdr warnings with larger text
\setlength{\headheight}{24pt}
\setlength{\headsep}{8pt}
\setlength{\footskip}{28pt}
\makeatletter
\renewcommand{\headrule}{\hbox to\headwidth{\color{examBlue}\leaders\hrule height \headrulewidth\hfill}}
\renewcommand{\footrule}{\hbox to\headwidth{\color{ruleGray}\leaders\hrule height \footrulewidth\hfill}}
\makeatother
% Slightly thicker header/footer rules
\renewcommand{\headrulewidth}{1.2pt}
\renewcommand{\footrulewidth}{0.8pt}
""" +
("\\fancyhead[L]{"+META["grade"]+"}"
 "\\fancyhead[C]{"+META["series"]+"}"
 "\\fancyhead[R]{"+META["exam"]+"}"
 "\\fancyfoot[L]{"+META["footer_left"]+"}"
 "\\fancyfoot[C]{\\bfseries\\thepage}"
 "\\fancyfoot[R]{"+META["footer_right"]+"}\n") +
r"""
\setlength{\columnsep}{9mm}
% Slightly thicker column separator
\setlength{\columnseprule}{0.8pt}
% Thicker hrule fill for label lines
\newcommand{\thickhrulefill}{\leavevmode\leaders\hrule height 1.0pt \hfill\kern0pt}
\setlist[enumerate,1]{label=\textcolor{examBlue}{\Large\bfseries\arabic*.}, leftmargin=*, itemsep=0.2em, topsep=0em, parsep=0pt}
\begin{document}
"""
    )

def firstpage_big_header() -> str:
    """1페이지 상단 헤더 생성

    학원명, 시험명, 학생 정보 입력란 등을 포함한
    시험지 상단 헤더 부분

    Returns:
        str: LaTeX 헤더 코드
    """
    L = []
    L.append(r"\thispagestyle{fancy}")
    L.append(r"\vspace*{-6mm}")
    L.append(r"\noindent{\bfseries\Large " + META["academy"] + r"}\hfill{\bfseries " + META["series"] + r"}")
    L.append(r"\begin{center}{\bfseries\LARGE " + META["exam"] + r"}\end{center}")
    L.append(r"{\color{examBlue}\rule{\linewidth}{1.2pt}}")
    L.append(r"\vspace{2mm}")
    L.append(r"\renewcommand{\arraystretch}{1.35}")
    L.append(r"\begin{tabularx}{\linewidth}{@{}lX lX lX lX@{}}")
    L.append(META["label_name"] + r" & \thickhrulefill & " +
             META["label_date"] + r" & \thickhrulefill & " +
             META["label_time"] + r" & \thickhrulefill & " +
             META["label_unit"] + r" & \thickhrulefill \\")
    L.append(r"\end{tabularx}")
    L.append(r"\vspace{8mm}")
    L.append(r"\begin{multicols}{2}")
    L.append(r"\begin{enumerate}")
    return "\n".join(L)

def tail_after_enumerate() -> str:
    """LaTeX 문서 마무리 코드

    Returns:
        str: 문서 마무리용 LaTeX 코드
    """
    return r"\end{enumerate}\end{multicols}\end{document}"

def options_tex(opts):
    """선택지를 LaTeX 형태로 변환

    선택지 개수와 길이에 따라:
    - 3×2 그리드: 짧은 선택지 5개
    - 1열 배치: 긴 선택지, 수식 포함, 한글 포함

    Args:
        opts: 선택지 리스트

    Returns:
        str: LaTeX 선택지 코드
    """
    if not opts: return ""
    opts = [o.strip() for o in opts if o.strip()]
    if not opts: return ""
    # 선지에서 （숫자） 패턴 제거 (LaTeX에서 자동으로 번호를 생성하므로)
    import re
    opts = [re.sub(r'^[（(]\s*\d+\s*[）)]\s*', '', o) for o in opts]
    # 선지의 숫자도 수식으로 변환
    # opts = [_convert_numbers_to_math(o) for o in opts]  # 숫자 변환 비활성화
    if use_3x2(opts):
        row1 = " & ".join(f"{circled(i+1)}~{opts[i]}" for i in range(3))
        row2 = " & ".join(f"{circled(i+1)}~{opts[i]}" for i in range(3,5))
        return "\n".join([
            r"\begin{center}",
            r"\renewcommand{\arraystretch}{1.2}",
            r"\setlength{\tabcolsep}{0.6em}",
            r"\begin{tabularx}{\linewidth}{@{}X X X@{}}",
            row1 + r"\\",
            row2 + r" & \\",
            r"\end{tabularx}",
            r"\end{center}",
        ])
    lines=[]
    lines.append("\\begin{enumerate}[label={\\bfseries\\textcircled{\\arabic*}}, itemsep="
                 + OPTION_VSPACE_1COL + ", topsep=0.2em, leftmargin=*, align=left]")
    for o in opts:
        lines.append("\\item " + o)
    lines.append("\\end{enumerate}")
    return "\n".join(lines)

# 복합문제 렌더링 로직 - 현재 주석처리
# def composite_item_tex(item):
#     """복합 문제 렌더링"""
#     L = []
#     L.append(r"\item \leavevmode\begin{minipage}[t]{\linewidth}")
#
#     # 메인 문제
#     main_q = (item.get("main_question") or "").strip()
#     if main_q:
#         main_q = _sanitize_question_text(main_q)
#         L.append(main_q)
#
#
#     # 메인 문제 선택지
#     main_op = options_tex(item.get("main_options") or [])
#     if main_op: L.append(main_op)
#
#     # 메인 문제와 소문제 사이 여백 (2줄)
#     L.append(r"\par\vspace{2\baselineskip}")
#
#     # 각 소문제를 개별 문제처럼 처리
#     for i, sub in enumerate(item.get("sub_problems", [])):
#         # 소문제 번호와 내용
#         sub_question = sub.get('question', '').strip()
#         if sub_question:
#             L.append(f"\\textbf{{({i+1})}} {sub_question}")
#
#
#         # 소문제 선택지
#         sub_op = options_tex(sub.get("options") or [])
#         if sub_op: L.append(sub_op)
#
#         # 소문제 간 여백 (마지막 소문제가 아닌 경우, 6줄)
#         if i < len(item.get("sub_problems", [])) - 1:
#             L.append(r"\par\vspace{6\baselineskip}")
#
#     # 블록 여백
#     n = int(item.get("_spacer_lines", SPACER_FIXED_LINES))
#     L.append(r"\par\vspace{" + str(n) + r"\baselineskip}")
#     L.append(r"\end{minipage}")
#     return "\n".join(L)

def structured_item_tex(item):
    """structured 형식 문제를 LaTeX 코드로 변환

    content_blocks의 각 블록을 처리하고
    선택지와 여백을 추가하여 완성된 문제 항목 생성

    Args:
        item: structured 형식 문제 데이터

    Returns:
        str: LaTeX 문제 코드
    """
    L = []
    L.append(r"\item \leavevmode\begin{minipage}[t]{\linewidth}")

    # content_blocks 처리
    content_blocks = item.get("content_blocks", [])
    if content_blocks:
        content_text = _sanitize_structured_content_block(content_blocks)
        if content_text.strip():
            L.append(content_text)

    # 선택지 처리
    op = options_tex(item.get("options") or [])
    if op:
        L.append(op)

    # 블록 여백
    n = int(item.get("_spacer_lines", SPACER_FIXED_LINES))
    L.append(r"\par\vspace{" + str(n) + r"\baselineskip}")
    L.append(r"\end{minipage}")
    return "\n".join(L)

def single_item_tex(item):
    """기존 형식 문제를 LaTeX 코드로 변환 (레거시 지원용)

    question과 options 키를 가진 기존 형식 문제 처리

    Args:
        item: 기존 형식 문제 데이터

    Returns:
        str: LaTeX 문제 코드
    """
    L = []
    L.append(r"\item \leavevmode\begin{minipage}[t]{\linewidth}")

    q = (item.get("question") or "").strip()
    if q:
        q = _sanitize_question_text(q)
        L.append(q)

    op = options_tex(item.get("options") or [])
    if op:
        L.append(op)

    # 블록 여백
    n = int(item.get("_spacer_lines", SPACER_FIXED_LINES))
    L.append(r"\par\vspace{" + str(n) + r"\baselineskip}")
    L.append(r"\end{minipage}")
    return "\n".join(L)

def item_tex(item, is_structured=False):
    """문제 형식에 따라 적절한 렌더링 함수 선택

    Args:
        item: 문제 데이터
        is_structured: structured 형식 여부

    Returns:
        str: LaTeX 문제 코드
    """
    if is_structured:
        return structured_item_tex(item)
    # 복합문제 처리는 현재 주석처리
    # elif item.get("type") == "composite":
    #     return composite_item_tex(item)
    else:
        return single_item_tex(item)

def build_pdf(tex:Path):
    cmds=[]
    if shutil.which("tectonic"): cmds.append(["tectonic","-Zshell-escape","-o",str(BUILD),str(tex)])
    if shutil.which("xelatex"):  cmds.append(["xelatex","-interaction=nonstopmode","-output-directory",str(BUILD),str(tex)])
    if not cmds: raise SystemExit("LaTeX 엔진(tectonic/xelatex) 중 하나가 필요합니다.")
    ok=False
    for c in cmds:
        print("[i]"," ".join(c))
        r=subprocess.run(c)
        if r.returncode==0 and (BUILD/"exam.pdf").exists(): ok=True; break
    if not ok: raise SystemExit("PDF 생성 실패")
    print("[✓] PDF 생성 →", BUILD/"exam.pdf")

def build_pdf_robust(tex: Path):
    """LaTeX 파일을 PDF로 컴파일

    tectonic과 xelatex을 순서대로 시도하여
    PDF 생성이 성공할 때까지 시도

    Args:
        tex: LaTeX 파일 경로

    Raises:
        SystemExit: PDF 생성 실패 시
    """
    cmds=[]
    if shutil.which("tectonic"): cmds.append(["tectonic","-Zshell-escape","-o",str(BUILD),str(tex)])
    if shutil.which("xelatex"):  cmds.append(["xelatex","-interaction=nonstopmode","-output-directory",str(BUILD),str(tex)])
    if not cmds: raise SystemExit("LaTeX 엔진(tectonic/xelatex) 둘 다 필요합니다")
    for c in cmds:
        print("[i]"," ".join(c), flush=True)
        r=subprocess.run(c)
        if (BUILD/"exam.pdf").exists():
            print("[OK] PDF 생성 완료", BUILD/"exam.pdf")
            return
    if (BUILD/"exam.pdf").exists():
        print("[OK] PDF 생성 완료", BUILD/"exam.pdf")
        return
    raise SystemExit("PDF 생성 실패")

def main():
    """메인 실행 함수

    전체 처리 흐름:
    1. problems_structured.json 로드
    2. 각 문제별 용적 계산
    3. 컬럼 그룹핑 (1페이지 헤더 패널티 적용)
    4. LaTeX 파일 생성
    5. PDF 컴파일
    """
    # 1. 입력 파일 확인 및 로드
    if not DATA.exists():
        raise SystemExit(f"❌ 입력 파일을 찾을 수 없습니다: {DATA}")

    print(f"📄 입력 파일: {DATA}")
    items = json.loads(DATA.read_text(encoding="utf-8"))
    is_structured = True  # structured 형식 고정
    BUILD.mkdir(parents=True, exist_ok=True)
    IMGDIR.mkdir(parents=True, exist_ok=True)

    # 2. 각 문제별 용적 계산 및 메타데이터 추가
    enriched = []
    for it in items:
        t = dict(it)  # 원본 데이터 복사

        if is_structured:
            # structured 형식 용적 계산
            base, spacer, total = estimate_units_structured(t)
        # 복합문제 처리는 현재 주석처리
        # elif it.get("type") == "composite":
        #     base, spacer, total = estimate_units_composite(t)
        else:
            # 기존 형식 용적 계산 (레거시 지원)
            base, spacer, total = estimate_units(it)

        # 용적 정보 추가
        t["_units_base"] = base    # 기본 내용 줄 수
        t["_spacer_lines"] = spacer  # 여백 줄 수
        t["_units_total"] = total    # 총 줄 수
        enriched.append(t)

    # 3. 컬럼 그룹핑 (1페이지 헤더 패널티 적용)
    groups, caps = group_columns_with_caps(enriched)
    # 컴팩션은 순서 유지를 위해 비활성화
    # groups, caps = compact_groups(groups, caps)

    # 4. LaTeX 파일 생성
    tex = BUILD / "exam.tex"
    parts = [preamble_before_document(), firstpage_big_header()]

    # 각 컬럼 그룹별로 문제 추가
    for gi, g in enumerate(groups):
        for it in g:
            parts.append(item_tex(it, is_structured=is_structured))
        if gi != len(groups) - 1:
            parts.append(r"\columnbreak")  # 컬럼 구분

    parts.append(tail_after_enumerate())
    tex.write_text("\n".join(parts), encoding="utf-8")

    # 5. PDF 컴파일
    build_pdf_robust(tex)

if __name__ == "__main__":
    main()
