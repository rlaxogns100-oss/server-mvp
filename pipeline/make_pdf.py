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
import requests
import json

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
\IfFontExistsTF{Noto Sans CJK KR}{\setmainfont{Noto Sans CJK KR}}{
  \IfFontExistsTF{Noto Sans KR}{\setmainfont{Noto Sans KR}}{
    \IfFontExistsTF{NanumGothic}{\setmainfont{NanumGothic}}{
      \IfFontExistsTF{Nanum Gothic}{\setmainfont{Nanum Gothic}}{
        \setmainfont{DejaVu Sans}
      }
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
("\\fancyhead[L]{}"
 "\\fancyhead[C]{}"
 "\\fancyhead[R]{\\vspace*{-6pt}\\textcolor{ruleGray}{\\small 문항 추출기를 이용하여 제작한 시험지입니다. https://tzyping.com}}"
 "\\fancyfoot[L]{}"
 "\\fancyfoot[C]{\\thepage}"
 "\\fancyfoot[R]{https://tzyping.com}\n") +
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
    L.append(r"\noindent\hfill{\bfseries " + META["series"] + r"}")
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

def tail_close_lists():
    return r"\end{enumerate}\end{multicols}"

def extract_problem_text(problem):
    blocks = problem.get('content_blocks', []) or []
    pieces = []
    for b in blocks:
        t = (b.get('type') or '').lower()
        c = b.get('content') or ''
        if t in ('text','condition','table','sub_text','sub_condition','sub_table'):
            pieces.append(c)
    if not pieces and problem.get('content'):
        pieces.append(problem.get('content'))
    # options (as hints)
    opts = problem.get('options') or []
    if opts:
        pieces.append("선택지: " + " | ".join([str(o) for o in opts]))
    return "\n".join(pieces)

def _absolute_url_for_openai(u: str) -> str:
    """OpenAI용 절대 URL. http/https 아니면 그대로 반환하지 않음(스킵)."""
    if not u:
        return ''
    u = str(u).strip()
    if u.startswith('http://') or u.startswith('https://'):
        return u
    return ''

def _build_mm_for_openai(problem):
    """OpenAI chat.completions 멀티모달 포맷 구성."""
    text = extract_problem_text(problem)
    content = [{"type": "text", "text": f"문항 #{problem.get('id') or problem.get('problemNumber') or ''}\n{text}"}]
    for b in (problem.get('content_blocks') or []):
        t = (b.get('type') or '').lower()
        c = (b.get('content') or '').strip()
        if t in ('image', 'sub_image') and c:
            url = _absolute_url_for_openai(c)
            if url:
                content.append({"type": "image_url", "image_url": {"url": url}})
    return content

def fetch_answers_via_llm(problems):
    """OpenAI GPT 기반: 각 문항별 정답 + 100자 이내 짧은 해설 생성.
    - 이미지 URL이 있으면 vision 입력으로 전송
    - 키는 OPENAI_API_KEY / OPENAI_api / OPENAI_KEY 중 존재하는 것 사용
    """
    api_key = os.getenv('OPENAI_API_KEY') or os.getenv('OPENAI_api') or os.getenv('OPENAI_KEY')
    if not api_key:
        print('[INFO] OPENAI_API_KEY/OPENAI_api가 없어 정답지 생성을 건너뜁니다.')
        return []

    model = os.getenv('OPENAI_MODEL', 'gpt-4o')
    print('정답지 생성 중 (OpenAI:', model, ')')

    system_prompt = (
        '너는 한국 고등학교 수학 채점 보조이다. 각 문항에 대해 JSON 한 줄만 반환하라. '
        '{"id":문항번호, "answer":"최종 정답", "explanation":"100자 이내 짧은 해설(한국어, 필요 시 LaTeX 수식 허용)"}. '
        '불확실하면 answer는 "N/A"로 하고 explanation은 이유를 30자 이내로 적어라.'
    )

    answers = []
    for p in problems:
        pid = p.get('id') or p.get('problemNumber') or 0
        content = _build_mm_for_openai(p)
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content}
            ],
            "max_tokens": 220,
            "temperature": 0.1
        }
        try:
            r = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=60
            )
            r.encoding = 'utf-8'
            if r.status_code != 200:
                print(f"[WARN] OpenAI 호출 실패({pid}): {r.status_code} {r.text[:120]}")
                answers.append({"id": pid, "answer": "N/A", "explanation": "API 오류"})
                continue

            content_str = r.json()['choices'][0]['message']['content'].strip()
            if content_str.startswith('```'):
                content_str = content_str.split('\n', 1)[1]
                if content_str.endswith('```'):
                    content_str = content_str[:-3]
            try:
                parsed = json.loads(content_str)
                if isinstance(parsed, dict) and 'answer' in parsed:
                    ans = str(parsed.get('answer', '')).strip()
                    exp = str(parsed.get('explanation', '')).strip()
                    answers.append({"id": pid, "answer": ans, "explanation": exp})
                else:
                    answers.append({"id": pid, "answer": str(content_str), "explanation": ""})
            except Exception:
                answers.append({"id": pid, "answer": str(content_str), "explanation": ""})
        except Exception as e:
            print(f"[WARN] OpenAI 호출 예외({pid}):", e)
            answers.append({"id": pid, "answer": "N/A", "explanation": "예외 발생"})

    return answers

def _latex_escape_expl(s: str) -> str:
    """LaTeX에서 위험한 문자를 최소한으로 이스케이프(수식 보호를 위해 $와 \\는 유지)."""
    if not s:
        return ''
    rep = [
        ('%', r'\%'),
        ('&', r'\&'),
        ('#', r'\#'),
        ('_', r'\_'),
        ('~', r'\textasciitilde{}'),
        ('^', r'\textasciicircum{}'),
    ]
    for a, b in rep:
        s = s.replace(a, b)
    return s

def answers_page_tex(answers):
    if not answers:
        return ''
    # Sort by id
    try:
        answers = sorted(answers, key=lambda x: int(str(x.get('id'))))
    except Exception:
        pass

    L = []
    L.append(r"\newpage")
    L.append(r"\thispagestyle{fancy}")
    L.append(r"\begin{center}{\bfseries 정답 및 해설}\end{center}")
    L.append(r"\begin{enumerate}[label=\arabic*., leftmargin=*, itemsep=0.4em, topsep=0.2em]")
    for item in answers:
        ans = str(item.get('answer', '')).strip()
        exp = _latex_escape_expl(str(item.get('explanation', '')).strip())
        if len(exp) > 120:
            exp = exp[:120] + '…'
        line = (r"\item \textbf{정답:} " + ans)
        if exp:
            line += (r"\\{\small \textcolor{ruleGray}{해설: " + exp + r"}}")
        L.append(line)
    L.append(r"\end{enumerate}")
    return "\n".join(L)

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
            # 이미지 URL을 다운로드하고 로컬 경로로 변환 (문단 분리 + 센터 정렬로 블록 요소화)
            local_path = fetch_image(content)
            if local_path:
                rel = os.path.relpath(local_path, start=BUILD).replace("\\", "/")
                return (
                    r"\par\medskip\begin{center}"
                    + r"\includegraphics[width=0.8\linewidth]{" + rel + "}"
                    + r"\end{center}\par\medskip"
                )
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
            # 이미지 URL을 다운로드하고 로컬 경로로 변환 (앞에 여백 추가, 센터 정렬)
            local_path = fetch_image(content)
            if local_path:
                rel = os.path.relpath(local_path, start=BUILD).replace("\\", "/")
                return (
                    r"\vspace{1em}\begin{center}"
                    + r"\includegraphics[width=0.8\linewidth]{" + rel + "}"
                    + r"\end{center}"
                )
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

    # 여백 (절반으로 축소)
    L.append(r"\par\vspace{6\baselineskip}")
    L.append(r"\end{minipage}")

    return "\n".join(L)

def build_pdf(tex_path):
    """LaTeX 파일을 PDF로 컴파일"""
    pdf_path = BUILD / "exam.pdf"

    # 기존 PDF 파일 삭제 (이전 빌드 결과가 남아있으면 안됨)
    if pdf_path.exists():
        try:
            pdf_path.unlink()
            print(f"기존 PDF 파일 삭제: {pdf_path}")
        except Exception as e:
            print(f"기존 PDF 삭제 실패: {e}")

    # xelatex를 build 디렉토리에서 실행하도록 설정
    # 이렇게 하면 이미지 경로가 제대로 작동함 (images/xxx.jpg -> build/images/xxx.jpg)
    tex_filename = tex_path.name

    cmds = []
    if shutil.which("tectonic"):
        cmds.append({
            "cmd": ["tectonic", "-Zshell-escape", tex_filename],
            "cwd": BUILD
        })
    if shutil.which("xelatex"):
        cmds.append({
            "cmd": ["xelatex", "-interaction=nonstopmode", tex_filename],
            "cwd": BUILD
        })

    if not cmds:
        print("❌ LaTeX 엔진(tectonic/xelatex)이 없습니다.")
        print("설치 방법:")
        print("  Ubuntu/Debian: sudo apt-get install texlive-xetex texlive-fonts-recommended")
        print("  macOS: brew install --cask mactex")
        return

    ok = False
    for cmd_info in cmds:
        cmd = cmd_info["cmd"]
        cwd = cmd_info["cwd"]
        print(f"🔧 실행: {' '.join(cmd)} (작업 디렉토리: {cwd})")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=cwd)

            # stdout/stderr 출력 (디버깅용)
            if result.stdout:
                print(f"📄 LaTeX stdout:\n{result.stdout}")
            if result.stderr:
                print(f"⚠️  LaTeX stderr:\n{result.stderr}")

            # returncode 확인
            print(f"종료 코드: {result.returncode}")

            # PDF 파일 존재 여부 및 크기 확인
            if pdf_path.exists():
                file_size = pdf_path.stat().st_size
                print(f"📊 생성된 PDF 크기: {file_size} bytes")

                # 최소 크기 체크 (1KB 이상이어야 정상)
                if file_size > 1000:
                    ok = True
                    print(f"✅ PDF 생성 성공: {pdf_path}")
                    break
                else:
                    print(f"❌ PDF 파일이 너무 작음 ({file_size} bytes) - 빌드 실패로 간주")
                    # 잘못된 PDF 삭제
                    pdf_path.unlink()
            else:
                print(f"❌ PDF 파일이 생성되지 않음: {pdf_path}")

            # returncode가 0이 아니면 에러
            if result.returncode != 0:
                print(f"❌ LaTeX 컴파일 실패 (종료 코드: {result.returncode})")

        except Exception as e:
            print(f"❌ 실행 오류: {e}")
            import traceback
            traceback.print_exc()

    if not ok:
        print("❌ PDF 생성 실패 - 위 로그를 확인하세요")
        print("일반적인 문제:")
        print("  1. LaTeX 문법 오류")
        print("  2. 폰트가 설치되지 않음")
        print("  3. 이미지 파일을 찾을 수 없음")
        print("  4. LaTeX 패키지가 설치되지 않음")

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

        # 문제 섹션 종료 (정답 페이지는 별도 페이지로)
        parts.append(tail_close_lists())

        # 정답 생성 (DB 저장 없음, 즉시 생성)
        answers = fetch_answers_via_llm(problems)
        if answers:
            parts.append(answers_page_tex(answers))

        # 문서 종료
        parts.append(r"\end{document}")

        # UTF-8로 저장
        tex_path.write_text("\n".join(parts), encoding="utf-8")
        print(f"LaTeX 파일 생성: {tex_path}")

        # PDF 생성
        build_pdf(tex_path)

        client.close()

    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        # 에러 발생 시 종료 코드 1로 종료
        sys.exit(1)

if __name__ == "__main__":
    main()
