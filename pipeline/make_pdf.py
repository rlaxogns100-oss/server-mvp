#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_pdf.py - MongoDB 문제로 PDF 시험지 생성
사용법: python make_pdf.py <problem_id1> <problem_id2> ...
"""

import sys
import io
from pathlib import Path
from pymongo import MongoClient
from bson import ObjectId
import os
from dotenv import load_dotenv
import subprocess
import shutil
import hashlib
import urllib.request
from urllib.parse import urlparse

# UTF-8 인코딩 강제 설정 (Windows cp949 문제 해결)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# .env 로드
load_dotenv()

# MongoDB 설정
MONGODB_URI = os.getenv('MONGODB_URI')
MONGODB_DATABASE = os.getenv('MONGODB_DATABASE', 'ZeroTyping')

BUILD = Path("build")
IMGDIR = BUILD / "images"

META = {
    "academy": "수학학원명",
    "grade": "고1",
    "series": "모의고사",
    "exam": "시험지",
    "footer_left": "수학학습실",
    "footer_right": "https://www.math114.net",
    "label_name": "이름",
    "label_date": "날짜",
    "label_time": "시간",
    "label_unit": "단원",
}

def _ext_from_url(u: str) -> str:
    """URL에서 파일 확장자 추출"""
    path = urlparse(u).path.lower()
    for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        if path.endswith(ext):
            return ext
    return ".jpg"

def _download(url: str, dst: Path):
    """URL에서 이미지 다운로드"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        dst.write_bytes(r.read())

def fetch_image(url: str) -> Path:
    """이미지 URL을 다운로드하고 로컬 경로 반환"""
    h = hashlib.md5(url.encode("utf-8")).hexdigest()
    fp = IMGDIR / f"img_{h}{_ext_from_url(url)}"
    try:
        if not fp.exists():
            _download(url, fp)
        return fp
    except Exception as e:
        print(f"[warn] 이미지 다운로드 실패: {url}, {e}")
        return None

def preamble_before_document():
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
\IfFontExistsTF{Noto Sans KR}{\setmainfont{Noto Sans KR}}{
  \IfFontExistsTF{Malgun Gothic}{\setmainfont{Malgun Gothic}}{
    \IfFontExistsTF{NanumGothic}{\setmainfont{NanumGothic}}{
      \setmainfont{DejaVu Sans}
    }
  }
}
\definecolor{examBlue}{HTML}{245BD1}
\definecolor{ruleGray}{gray}{0.6}
\pagestyle{fancy}
\fancyhf{}
\setlength{\headheight}{22pt}
\setlength{\headsep}{8pt}
\setlength{\footskip}{28pt}
\makeatletter
\renewcommand{\headrule}{\hbox to\headwidth{\color{examBlue}\leaders\hrule height \headrulewidth\hfill}}
\renewcommand{\footrule}{\hbox to\headwidth{\color{ruleGray}\leaders\hrule height \footrulewidth\hfill}}
\makeatother
\renewcommand{\headrulewidth}{0.8pt}
\renewcommand{\footrulewidth}{0.4pt}
""" +
("\\fancyhead[L]{"+META["grade"]+"}"
 "\\fancyhead[C]{"+META["series"]+"}"
 "\\fancyhead[R]{"+META["exam"]+"}"
 "\\fancyfoot[L]{"+META["footer_left"]+"}"
 "\\fancyfoot[C]{\\thepage}"
 "\\fancyfoot[R]{"+META["footer_right"]+"}\n") +
r"""
\setlength{\columnsep}{9mm}
\setlength{\columnseprule}{0.5pt}
\setlist[enumerate,1]{label=\textcolor{examBlue}{\Large\bfseries\arabic*.}, leftmargin=*, itemsep=0.2em, topsep=0em, parsep=0pt}
\begin{document}
"""
    )

def firstpage_big_header():
    L = []
    L.append(r"\thispagestyle{fancy}")
    L.append(r"\vspace*{-6mm}")
    L.append(r"\noindent{\bfseries\Large " + META["academy"] + r"}\hfill{\bfseries " + META["series"] + r"}")
    L.append(r"\begin{center}{\bfseries\LARGE " + META["exam"] + r"}\end{center}")
    L.append(r"{\color{examBlue}\rule{\linewidth}{0.9pt}}")
    L.append(r"\vspace{2mm}")
    L.append(r"\renewcommand{\arraystretch}{1.35}")
    L.append(r"\begin{tabularx}{\linewidth}{@{}lX lX lX lX@{}}")
    L.append(META["label_name"] + r" & \hrulefill & " +
             META["label_date"] + r" & \hrulefill & " +
             META["label_time"] + r" & \hrulefill & " +
             META["label_unit"] + r" & \hrulefill \\")
    L.append(r"\end{tabularx}")
    L.append(r"\vspace{8mm}")
    L.append(r"\begin{multicols}{2}")
    L.append(r"\begin{enumerate}")
    return "\n".join(L)

def tail_after_enumerate():
    return r"\end{enumerate}\end{multicols}\end{document}"

def content_block_to_tex(block):
    """content_block을 LaTeX로 변환"""
    try:
        block_type = block.get('type', '')
        content = block.get('content', '')

        if block_type == 'text':
            return content

        elif block_type == 'table':
            # array는 수식 모드 안에 있어야 함
            if '\\begin{array}' in content:
                return '$' + content + '$'
            return content

        elif block_type == 'condition':
            # tcolorbox로 검은색 테두리 박스 생성 (웹과 동일하게 [조건] 텍스트 없음)
            lines = []
            lines.append(r"\begin{tcolorbox}[colback=white, colframe=black, boxrule=0.5pt, arc=2pt, boxsep=3pt, left=4pt, right=4pt, top=3pt, bottom=3pt]")

            if isinstance(content, list):
                # 리스트인 경우 각 항목을 개별 줄로 처리
                for i, cond in enumerate(content):
                    if i > 0:
                        lines.append(r"\\" + "\n" + cond)
                    else:
                        lines.append(cond)
            else:
                # 단일 문자열인 경우 \n을 LaTeX 줄바꿈으로 변환
                content_formatted = content.replace('\n', r'\\' + '\n')
                lines.append(content_formatted)

            lines.append(r"\end{tcolorbox}")
            return "\n".join(lines)

        elif block_type == 'image':
            # 이미지 URL을 다운로드하고 로컬 경로로 변환
            local_path = fetch_image(content)
            if local_path:
                rel = os.path.relpath(local_path, start=BUILD).replace("\\", "/")
                return r"\includegraphics[width=0.8\linewidth]{" + rel + "}"
            else:
                return f"[이미지 로드 실패: {content[:50]}]"

        elif block_type == 'sub_text':
            return r"\vspace{1em}" + "\n" + content

        elif block_type == 'sub_table':
            # array는 수식 모드 안에 있어야 함
            if '\\begin{array}' in content:
                return r"\vspace{1em}" + "\n" + '$' + content + '$'
            return r"\vspace{1em}" + "\n" + content

        elif block_type == 'sub_condition':
            # tcolorbox로 검은색 테두리 박스 생성 (앞에 여백 추가, 웹과 동일하게 [하위조건] 텍스트 없음)
            lines = []
            lines.append(r"\vspace{1em}")
            lines.append(r"\begin{tcolorbox}[colback=white, colframe=black, boxrule=0.5pt, arc=2pt, boxsep=3pt, left=4pt, right=4pt, top=3pt, bottom=3pt]")

            if isinstance(content, list):
                # 리스트인 경우 각 항목을 개별 줄로 처리
                for i, cond in enumerate(content):
                    if i > 0:
                        lines.append(r"\\" + "\n" + cond)
                    else:
                        lines.append(cond)
            else:
                # 단일 문자열인 경우 \n을 LaTeX 줄바꿈으로 변환
                content_formatted = content.replace('\n', r'\\' + '\n')
                lines.append(content_formatted)

            lines.append(r"\end{tcolorbox}")
            return "\n".join(lines)

        elif block_type == 'sub_image':
            # 이미지 URL을 다운로드하고 로컬 경로로 변환 (앞에 여백 추가)
            local_path = fetch_image(content)
            if local_path:
                rel = os.path.relpath(local_path, start=BUILD).replace("\\", "/")
                return r"\vspace{1em}" + "\n" + r"\includegraphics[width=0.8\linewidth]{" + rel + "}"
            else:
                return r"\vspace{1em}" + "\n" + f"[이미지 로드 실패: {content[:50]}]"

        return ""

    except Exception as e:
        print(f"블록 변환 오류 ({block_type}): {e}")
        return f"[블록 처리 오류: {block_type}]"

def options_tex(opts):
    """선택지를 LaTeX로 변환"""
    if not opts:
        return ""

    lines = []
    lines.append(r"\vspace{0.5em}")
    lines.append(r"\begin{enumerate}[label={\textcircled{\arabic*}}, itemsep=0.2em, topsep=0.2em, leftmargin=*, align=left]")
    for opt in opts:
        lines.append(r"\item " + opt)
    lines.append(r"\end{enumerate}")
    return "\n".join(lines)

def problem_to_tex(problem):
    """문제 하나를 LaTeX로 변환"""
    L = []
    L.append(r"\item \leavevmode\begin{minipage}[t]{\linewidth}")

    # content_blocks 처리
    content_blocks = problem.get('content_blocks', [])
    if content_blocks:
        for block in content_blocks:
            tex = content_block_to_tex(block)
            if tex:
                L.append(tex)
    else:
        # content_blocks가 없으면 question 필드 사용
        question = problem.get('question', '')
        if question:
            L.append(question)

    # 선택지
    options = problem.get('options', [])
    if options:
        L.append(options_tex(options))

    # 여백
    L.append(r"\par\vspace{12\baselineskip}")
    L.append(r"\end{minipage}")

    return "\n".join(L)

def build_pdf(tex_path):
    """LaTeX 파일을 PDF로 컴파일"""
    cmds = []
    if shutil.which("tectonic"):
        cmds.append(["tectonic", "-Zshell-escape", "-o", str(BUILD), str(tex_path)])
    if shutil.which("xelatex"):
        cmds.append(["xelatex", "-interaction=nonstopmode", "-output-directory", str(BUILD), str(tex_path)])

    if not cmds:
        print("LaTeX 엔진(tectonic/xelatex)이 없습니다. 빈 PDF 생성...")
        # 빈 PDF 생성
        pdf_path = BUILD / "exam.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/Resources <<\n/Font <<\n/F1 <<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n>>\n>>\n>>\n/MediaBox [0 0 595 842]\n/Contents 4 0 R\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n50 800 Td\n(LaTeX engine not found) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000317 00000 n\ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n410\n%%EOF\n")
        print("빈 PDF 생성됨 (LaTeX 엔진 필요)")
        return

    ok = False
    for cmd in cmds:
        print(f"실행: {' '.join(cmd)}")
        try:
            # encoding 오류 방지: stdout/stderr를 무시하고 returncode만 체크하지 않음
            result = subprocess.run(cmd, capture_output=True)
            # PDF가 생성되었으면 성공 (returncode와 무관)
            if (BUILD / "exam.pdf").exists():
                ok = True
                print(f"PDF 생성 성공: {BUILD / 'exam.pdf'}")
                break
        except Exception as e:
            print(f"실행 오류: {e}")

    if not ok:
        print("PDF 생성 실패 - 빈 PDF 생성")
        pdf_path = BUILD / "exam.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/Resources <<\n/Font <<\n/F1 <<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n>>\n>>\n>>\n/MediaBox [0 0 595 842]\n/Contents 4 0 R\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n50 800 Td\n(PDF compilation failed) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000317 00000 n\ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n410\n%%EOF\n")

def main():
    try:
        # 커맨드라인 인자로 문제 ID 받기
        if len(sys.argv) < 2:
            print("사용법: python make_pdf.py <problem_id1> <problem_id2> ...")
            print("예: python make_pdf.py 68f078a2122c05354d2e3f65 68f078a2122c05354d2e3f66")
            return

        problem_ids = sys.argv[1:]  # 첫 번째 인자부터 모두 문제 ID로 사용
        print(f"입력받은 문제 ID: {len(problem_ids)}개")

        # MongoDB 연결
        client = MongoClient(MONGODB_URI)
        db = client[MONGODB_DATABASE]

        # 문제들 조회
        problems = []
        for pid in problem_ids:
            problem = db.problems.find_one({"_id": ObjectId(pid)})
            if problem:
                problems.append(problem)
                print(f"문제 찾음: {pid}")
            else:
                print(f"문제 없음: {pid}")

        if not problems:
            print("조회된 문제가 없습니다.")
            return

        print(f"총 {len(problems)}개 문제 로드됨")

        # build 폴더 및 images 폴더 생성
        BUILD.mkdir(parents=True, exist_ok=True)
        IMGDIR.mkdir(parents=True, exist_ok=True)

        # LaTeX 파일 생성
        tex_path = BUILD / "exam.tex"
        parts = []
        parts.append(preamble_before_document())
        parts.append(firstpage_big_header())

        # 모든 문제 추가
        for problem in problems:
            parts.append(problem_to_tex(problem))

        parts.append(tail_after_enumerate())

        # UTF-8로 저장
        tex_path.write_text("\n".join(parts), encoding="utf-8")
        print(f"LaTeX 파일 생성: {tex_path}")

        # PDF 생성
        build_pdf(tex_path)

        client.close()

    except Exception as e:
        print(f"오류 발생: {e}")
        # 에러 발생해도 빈 PDF 생성
        try:
            BUILD.mkdir(parents=True, exist_ok=True)
            pdf_path = BUILD / "exam.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/Resources <<\n/Font <<\n/F1 <<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n>>\n>>\n>>\n/MediaBox [0 0 595 842]\n/Contents 4 0 R\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n50 800 Td\n(Error generating PDF) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000317 00000 n\ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n410\n%%EOF\n")
            print("에러 PDF 생성 완료")
        except:
            pass

if __name__ == "__main__":
    main()
