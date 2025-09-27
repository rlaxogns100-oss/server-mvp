# make_exam2.py — 깔끔한 시험지 생성기
"""
복잡한 레이아웃 없이 문제를 순서대로 배치하는 단순한 시험지 생성 스크립트

주요 기능:
- problems_structured.json 입력
- 2단 컬럼 자동 배치
- 문제 블록화로 끊기지 방지
- 번호, 발문, 이미지, 표, 보기, 선택지 지원
"""

import os
import re
import json
import hashlib
import shutil
import subprocess
import urllib.request
from urllib.parse import urlparse
from pathlib import Path


# ==================== 설정 ====================

# 파일 경로
INPUT_FILE = Path("output/problems_structured.json")
OUTPUT_DIR = Path("output")
IMAGE_DIR = OUTPUT_DIR / "images"

# 시험지 메타데이터
EXAM_META = {
    "title": "시험지",
    "subtitle": "",
    "font_size": "11pt",
}

# 설정 파일이 있으면 로드
META_FILE = Path("exam_meta2.json")
if META_FILE.exists():
    try:
        EXAM_META.update(json.loads(META_FILE.read_text(encoding="utf-8")))
    except Exception:
        pass

# 이미지 크기 제한 (inch 단위)
IMAGE_SIZE_LIMITS = {
    "min_width": 1.0,
    "min_height": 0.5,
    "max_width": 4.0,
    "max_height": 3.0,
}


# ==================== 유틸리티 함수 ====================

def get_file_extension(url: str) -> str:
    """URL에서 이미지 파일 확장자 추출"""
    path = urlparse(url).path.lower()
    extensions = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")

    for ext in extensions:
        if path.endswith(ext):
            return ext
    return ".jpg"  # 기본값


def download_image(url: str, destination: Path) -> None:
    """URL에서 이미지 다운로드"""
    destination.parent.mkdir(parents=True, exist_ok=True)

    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request) as response:
        destination.write_bytes(response.read())


def get_image_latex_options(image_path: Path) -> str:
    """이미지 크기에 맞는 LaTeX 옵션 생성"""
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
        aspect_ratio = width_inch / height_inch

        # 최소 크기 적용
        if width_inch < IMAGE_SIZE_LIMITS["min_width"]:
            width_inch = IMAGE_SIZE_LIMITS["min_width"]
            height_inch = width_inch / aspect_ratio

        if height_inch < IMAGE_SIZE_LIMITS["min_height"]:
            height_inch = IMAGE_SIZE_LIMITS["min_height"]
            width_inch = height_inch * aspect_ratio

        # 최대 크기 적용
        if width_inch > IMAGE_SIZE_LIMITS["max_width"]:
            width_inch = IMAGE_SIZE_LIMITS["max_width"]
            height_inch = width_inch / aspect_ratio

        if height_inch > IMAGE_SIZE_LIMITS["max_height"]:
            height_inch = IMAGE_SIZE_LIMITS["max_height"]
            width_inch = height_inch * aspect_ratio

        # pt로 다시 변환
        width_pt = width_inch * 72
        height_pt = height_inch * 72

        return f"width={width_pt:.1f}pt,height={height_pt:.1f}pt"

    except Exception as e:
        print(f"[경고] 이미지 크기 분석 실패 {image_path}: {e}")
        return f"width={IMAGE_SIZE_LIMITS['min_width'] * 72:.1f}pt"


# ==================== 텍스트 처리 ====================

def convert_markdown_image_to_latex(match) -> str:
    """Markdown 이미지를 LaTeX includegraphics로 변환"""
    url = match.group(1)

    try:
        # URL 해시를 이용한 파일명 생성
        url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()
        file_path = IMAGE_DIR / f"img_{url_hash}{get_file_extension(url)}"

        # 이미지가 없으면 다운로드
        if not file_path.exists():
            print(f"이미지 다운로드: {url}")
            download_image(url, file_path)

        # 상대 경로로 변환
        relative_path = os.path.relpath(file_path, start=OUTPUT_DIR).replace("\\", "/")
        size_options = get_image_latex_options(file_path)

        return f"\\begin{{center}}\\includegraphics[{size_options}]{{{relative_path}}}\\end{{center}}"

    except Exception as e:
        print(f"[경고] 이미지 처리 실패 {url}: {e}")
        return f"[이미지 로드 실패: {url}]"


def clean_text_content(text: str) -> str:
    """텍스트 정제 및 LaTeX 형태로 변환"""
    if not text:
        return ""

    # Markdown 이미지를 LaTeX로 변환: ![](URL) -> \\includegraphics
    text = re.sub(r'!\\[\\]\\(([^)]+)\\)', convert_markdown_image_to_latex, text)

    # 불필요한 라벨 제거
    unwanted_patterns = [
        r'\\section\\*\\{\\[보기\\]\\}',
        r'\\section\\*\\{<보기>\\}',
        r'\\[\\s*보\\s*기\\s*\\]',
        r'\\(\\s*보\\s*기\\s*\\)',
        r'\\[\\d+\\.?\\d*점\\]',  # 배점 정보
        r'\\[\\d+\\.?\\d*점,\\s*부분점수\\s*있음\\]',
    ]

    for pattern in unwanted_patterns:
        text = re.sub(pattern, '', text)

    # LaTeX 테이블 환경 정리
    text = re.sub(r'\\\\begin\\{table\\}\\s*', '', text)
    text = re.sub(r'\\\\end\\{table\\}\\s*', '', text)

    # 여러 공백을 단일 공백으로 변환
    text = re.sub(r'\\s+', ' ', text).strip()

    return text


# ==================== 컨텐츠 블록 처리 ====================

def process_text_block(content: str) -> str:
    """텍스트 블록 처리"""
    return clean_text_content(content)


def process_image_block(content: str) -> str:
    """이미지 블록 처리"""
    # Markdown 형식: ![](URL)
    if content.startswith("![](") and content.endswith(")"):
        url = content[4:-1]  # URL 추출

        try:
            url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()
            file_path = IMAGE_DIR / f"img_{url_hash}{get_file_extension(url)}"

            if not file_path.exists():
                print(f"이미지 다운로드: {url}")
                download_image(url, file_path)

            relative_path = os.path.relpath(file_path, start=OUTPUT_DIR).replace("\\", "/")
            size_options = get_image_latex_options(file_path)

            return f"\\begin{{center}}\\includegraphics[{size_options}]{{{relative_path}}}\\end{{center}}"

        except Exception as e:
            print(f"[경고] 이미지 처리 실패 {url}: {e}")
            return f"[이미지 로드 실패: {url}]"

    return content


def process_table_block(content) -> str:
    """테이블 블록 처리"""
    if isinstance(content, str):
        # LaTeX 테이블을 center 환경으로 감싸기
        if "\\begin{tabular}" in content:
            return f"\\begin{{center}}\\n{content}\\n\\end{{center}}"
        return content

    return str(content)


def process_examples_block(content) -> str:
    """보기 블록 처리"""
    if isinstance(content, list):
        result = "\\textbf{[보기]}\\\\\n"
        korean_letters = ['가', '나', '다', '라', '마']

        for i, item in enumerate(content):
            if i < len(korean_letters):
                letter = korean_letters[i]
            else:
                letter = str(i+1)
            result += f"\\noindent ({letter}) {item}\\\\\n"

        return result

    return f"\\textbf{{[보기]}} {str(content)}"


def process_content_blocks(blocks: list) -> str:
    """content_blocks를 LaTeX 형태로 변환"""
    result_parts = []

    block_processors = {
        "text": process_text_block,
        "image": process_image_block,
        "table": process_table_block,
        "examples": process_examples_block,
    }

    for block in blocks:
        block_type = block.get("type", "text")
        content = block.get("content", "")

        processor = block_processors.get(block_type, lambda x: str(x))
        processed_content = processor(content)

        if processed_content and processed_content.strip():
            result_parts.append(processed_content)

    return "\\n\\n".join(result_parts)


# ==================== 선택지 처리 ====================

def clean_option_text(option: str) -> str:
    """선택지에서 기존 번호 제거"""
    patterns = [
        r'^[①-⑤]\\s*',           # ①②③④⑤
        r'^\\([1-5]\\)\\s*',      # (1)(2)(3)(4)(5)
        r'^[（(][1-5１-５][）)]\\s*',  # （１）（２）등
    ]

    cleaned = option.strip()
    for pattern in patterns:
        cleaned = re.sub(pattern, '', cleaned)

    return cleaned


def process_options(options: list) -> str:
    """선택지를 LaTeX enumerate로 변환"""
    if not options:
        return ""

    cleaned_options = [clean_option_text(opt) for opt in options]

    latex_lines = [
        "\\begin{enumerate}[label={\\textcircled{\\arabic*}}, leftmargin=*, itemsep=0.3em]"
    ]

    for option in cleaned_options:
        latex_lines.append(f"\\item {option}")

    latex_lines.append("\\end{enumerate}")

    return "\\n".join(latex_lines)


# ==================== LaTeX 문서 생성 ====================

def generate_document_preamble() -> str:
    """LaTeX 문서 프리앰블 생성"""
    return f"""\\documentclass[{EXAM_META['font_size']}]{{article}}
\\usepackage[utf8]{{inputenc}}
\\usepackage{{amsmath,amssymb}}
\\usepackage{{fontspec}}
\\usepackage{{graphicx}}
\\usepackage{{enumitem}}
\\usepackage{{xcolor}}
\\usepackage{{multicol}}
\\usepackage[a4paper, top=15mm, bottom=15mm, left=10mm, right=10mm]{{geometry}}

% 한글 폰트 설정
\\IfFontExistsTF{{Noto Sans KR}}{{\\setmainfont{{Noto Sans KR}}[Scale=1.0]}}{{\\setmainfont{{Malgun Gothic}}[Scale=1.0]}}

% 2단 컬럼 설정
\\setlength{{\\columnsep}}{{8mm}}
\\setlength{{\\columnseprule}}{{0.4pt}}

% 기본 설정
\\setlength{{\\parindent}}{{0pt}}
\\setlength{{\\parskip}}{{0.3em}}

\\begin{{document}}
"""


def generate_document_header() -> str:
    """문서 헤더 (제목 등) 생성"""
    header_parts = []

    # 제목이 있으면 추가
    if EXAM_META['title']:
        header_parts.append(f"\\begin{{center}}{{\\Large\\textbf{{{EXAM_META['title']}}}}}\\end{{center}}")

    if EXAM_META['subtitle']:
        header_parts.append(f"\\begin{{center}}{{{EXAM_META['subtitle']}}}\\end{{center}}")

    if header_parts:
        header_parts.append("\\vspace{1em}")

    # 2단 컬럼과 문제 번호 매기기 시작
    header_parts.extend([
        "\\begin{multicols}{2}",
        "\\begin{enumerate}[label={\\textbf{\\arabic*.}}, leftmargin=*, itemsep=0.5em]"
    ])

    return "\\n".join(header_parts)


def generate_single_problem(problem_data: dict) -> str:
    """개별 문제를 LaTeX 코드로 변환"""
    problem_parts = []

    # 문제 내용 처리
    content_blocks = problem_data.get("content_blocks", [])
    if content_blocks:
        content_text = process_content_blocks(content_blocks)
        if content_text:
            problem_parts.append(content_text)

    # 선택지 처리
    options = problem_data.get("options", [])
    if options:
        options_text = process_options(options)
        problem_parts.append(options_text)

    # minipage로 문제 블록화 (페이지/컬럼에서 끊기지 않게)
    if problem_parts:
        content = "\\n\\n".join(problem_parts)
        return f"\\item \\leavevmode\\begin{{minipage}}[t]{{\\linewidth}}{content}\\end{{minipage}}\\n\\n"

    return ""


def generate_document_footer() -> str:
    """문서 마무리"""
    return "\\end{enumerate}\\n\\end{multicols}\\n\\end{document}\\n"


# ==================== PDF 컴파일 ====================

def compile_latex_to_pdf(tex_file_path: Path) -> None:
    """LaTeX 파일을 PDF로 컴파일"""
    available_commands = []

    if shutil.which("tectonic"):
        available_commands.append([
            "tectonic", "-Z", "shell-escape",
            "-o", str(OUTPUT_DIR), str(tex_file_path)
        ])

    if shutil.which("xelatex"):
        available_commands.append([
            "xelatex", "-interaction=nonstopmode",
            "-output-directory", str(OUTPUT_DIR), str(tex_file_path)
        ])

    if not available_commands:
        raise SystemExit("❌ LaTeX 엔진(tectonic 또는 xelatex)이 필요합니다.")

    # 컴파일 시도
    for command in available_commands:
        print(f"[실행] {' '.join(command)}")
        result = subprocess.run(command)

        if result.returncode == 0 and (OUTPUT_DIR / "exam2.pdf").exists():
            print(f"✅ PDF 생성 완료: {OUTPUT_DIR / 'exam2.pdf'}")
            return

    raise SystemExit("❌ PDF 생성에 실패했습니다.")


# ==================== 메인 실행 ====================

def main() -> None:
    """메인 실행 함수"""
    print("=" * 60)
    print("깔끔한 시험지 생성기 v2.0")
    print("=" * 60)

    # 1. 입력 파일 확인
    if not INPUT_FILE.exists():
        raise SystemExit(f"❌ 입력 파일을 찾을 수 없습니다: {INPUT_FILE}")

    # 2. 출력 디렉토리 준비
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    # 3. 데이터 로드
    print(f"📄 데이터 로드: {INPUT_FILE}")
    problem_data = json.loads(INPUT_FILE.read_text(encoding="utf-8"))
    print(f"✅ {len(problem_data)}개 문제 로드 완료")

    # 4. LaTeX 문서 생성
    print("\\n🔄 LaTeX 문서 생성 중...")

    document_parts = [
        generate_document_preamble(),
        generate_document_header()
    ]

    # 각 문제 처리
    for problem in problem_data:
        problem_latex = generate_single_problem(problem)
        if problem_latex:
            document_parts.append(problem_latex)

    document_parts.append(generate_document_footer())

    # 5. LaTeX 파일 저장
    tex_file = OUTPUT_DIR / "exam2.tex"
    full_document = "\\n".join(document_parts)
    tex_file.write_text(full_document, encoding="utf-8")
    print(f"✅ LaTeX 파일 생성: {tex_file}")

    # 6. PDF 컴파일
    print("\\n🔄 PDF 컴파일 중...")
    compile_latex_to_pdf(tex_file)

    # 7. 완료 메시지
    print("\\n" + "=" * 60)
    print("🎉 시험지 생성 완료!")
    print(f"📁 출력 파일: {OUTPUT_DIR / 'exam2.pdf'}")
    print("=" * 60)


if __name__ == "__main__":
    main()