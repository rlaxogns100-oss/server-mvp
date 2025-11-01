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
import base64
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
    """OpenAI용 절대 URL. 상대경로는 PUBLIC_BASE_URL과 결합."""
    if not u:
        return ''
    u = str(u).strip()
    # 이미 절대 URL이면 그대로 반환
    if u.startswith('http://') or u.startswith('https://'):
        return u
    # 상대경로인 경우 PUBLIC_BASE_URL과 결합
    PUBLIC_BASE_URL = os.getenv('PUBLIC_BASE_URL', '')
    if not PUBLIC_BASE_URL:
        print(f"[WARN] PUBLIC_BASE_URL이 설정되지 않아 상대 이미지 경로를 변환할 수 없습니다: {u}")
        return ''
    # URL 결합 (중복 슬래시 제거)
    base = PUBLIC_BASE_URL.rstrip('/')
    path = u if u.startswith('/') else '/' + u
    return base + path

def _build_mm_for_openai(problem):
    """OpenAI chat.completions 멀티모달 포맷 구성 - content_blocks 순서대로 전부 전송."""
    content = []
    pid = problem.get('id') or problem.get('problemNumber') or ''
    
    # content_blocks 전체를 순서대로 처리
    content_blocks = problem.get('content_blocks') or []
    print(f'[DEBUG] 문항 {pid}: content_blocks 총 {len(content_blocks)}개')
    
    for idx, b in enumerate(content_blocks):
        block_type = (b.get('type') or '').lower()
        block_content = (b.get('content') or '').strip()
        
        if block_type in ('text', 'condition', 'table', 'sub_text', 'sub_condition', 'sub_table'):
            if block_content:
                content.append({"type": "text", "text": block_content})
                print(f'[DEBUG]   블록 {idx}: {block_type} - 텍스트 {len(block_content)}자')
        
        elif block_type in ('image', 'sub_image'):
            if block_content:
                url = _absolute_url_for_openai(block_content)
                if url:
                    content.append({"type": "image_url", "image_url": {"url": url}})
                    print(f'[DEBUG]   블록 {idx}: {block_type} - 이미지 URL: {url[:80]}...')
                else:
                    print(f'[WARN]   블록 {idx}: {block_type} - 상대경로 스킵: {block_content[:80]}')
    
    # 선택지 추가
    options = problem.get('options') or []
    if options:
        options_text = "선택지:\n" + "\n".join([f"({i+1}) {opt}" for i, opt in enumerate(options)])
        content.append({"type": "text", "text": options_text})
        print(f'[DEBUG]   선택지: {len(options)}개')
    
    print(f'[DEBUG] 최종 content 블록 수: {len(content)}개 (텍스트 + 이미지 + 선택지)')
    return content

def _build_mm_for_gemini(problem):
    """Gemini generateContent parts 구성 (텍스트 + inline 이미지)."""
    parts = []
    # 텍스트 파츠: content_blocks 중 텍스트성 요소를 합쳐 하나로
    text_chunks = []
    blocks = problem.get('content_blocks') or []
    for b in blocks:
        t = (b.get('type') or '').lower()
        c = (b.get('content') or '').strip()
        if t in ('text', 'condition', 'table', 'sub_text', 'sub_condition', 'sub_table') and c:
            text_chunks.append(c)
    if text_chunks:
        parts.append({"text": "\n".join(text_chunks)})
    # 이미지 파츠: 다운로드 후 base64 inline_data로 첨부
    for b in blocks:
        t = (b.get('type') or '').lower()
        c = (b.get('content') or '').strip()
        if t in ('image', 'sub_image') and c:
            local_path = fetch_image(_absolute_url_for_openai(c) or c)
            try:
                if local_path and local_path.exists():
                    data = local_path.read_bytes()
                    b64 = base64.b64encode(data).decode('utf-8')
                    ext = str(local_path).lower()
                    mime = 'image/jpeg'
                    if ext.endswith('.png'):
                        mime = 'image/png'
                    elif ext.endswith('.gif'):
                        mime = 'image/gif'
                    elif ext.endswith('.webp'):
                        mime = 'image/webp'
                    parts.append({"inline_data": {"mime_type": mime, "data": b64}})
            except Exception as _:
                pass
    # 선택지 파츠
    opts = problem.get('options') or []
    if opts:
        parts.append({"text": "선택지:\n" + "\n".join([f"({i+1}) {opt}" for i, opt in enumerate(opts)])})
    return parts

def fetch_answers_via_llm(problems):
    """OpenAI GPT 기반: 각 문항별 정답 + 깔끔한 해설 생성.
    - 이미지 URL이 있으면 vision 입력으로 전송
    - 키는 OPENAI_API_KEY / OPENAI_api / OPENAI_KEY 중 존재하는 것 사용
    """
    print('[DEBUG] fetch_answers_via_llm 호출됨')
    print(f'[DEBUG] 입력 문제 수: {len(problems)}')
    
    provider = (os.getenv('LLM_PROVIDER') or 'openai').lower()
    if provider == 'gemini':
        return fetch_answers_via_gemini(problems)

    api_key = os.getenv('OPENAI_API_KEY') or os.getenv('OPENAI_api') or os.getenv('OPENAI_KEY')
    if not api_key:
        print('[ERROR] ❌ OPENAI_API_KEY가 설정되지 않았습니다!')
        print('[ERROR] .env 파일에 OPENAI_api 또는 OPENAI_API_KEY를 추가하세요.')
        return []
    
    print(f'[DEBUG] ✅ OpenAI API 키 확인됨 (길이: {len(api_key)})')
    model = os.getenv('OPENAI_MODEL', 'gpt-5-nano')
    print(f'[INFO] 정답지 생성 중 (모델: {model}, 문항 수: {len(problems)})')

    system_prompt = (
        '너는 한국 고등학교 수학 문제를 푸는 전문가다.\n'
        '주어진 문제를 정확히 풀고 최종 정답만 한국어로 제시하라.\n'
        '선택지가 있으면 반드시 그 중에서 고르되, 주관식이면 숫자나 수식으로만 답하라.\n\n'
        '출력 형식 (JSON 한 줄):\n'
        '{"id": 문항번호, "answer": "정답"}'
    )

    answers = []
    for idx, p in enumerate(problems, 1):
        pid = p.get('id') or p.get('problemNumber') or 0
        print(f'[DEBUG] 문항 {idx}/{len(problems)} (ID: {pid}) 처리 중...')
        content = _build_mm_for_openai(p)
        print(f'[DEBUG] 멀티모달 content 구성 완료 (블록 수: {len(content)})')
        
        # 전송 내용 상세 로깅
        text_blocks = [c for c in content if c.get('type') == 'text']
        image_blocks = [c for c in content if c.get('type') == 'image_url']
        print(f'[DEBUG] 전송 내용: 텍스트 {len(text_blocks)}개, 이미지 {len(image_blocks)}개')
        if text_blocks:
            total_text_len = sum(len(c['text']) for c in text_blocks)
            print(f'[DEBUG] 총 텍스트 길이: {total_text_len}자')
            for i, tb in enumerate(text_blocks):
                preview = tb['text'][:100].replace('\n', ' ')
                print(f'[DEBUG]   텍스트 블록 {i+1}: "{preview}..."')
        if image_blocks:
            for i, ib in enumerate(image_blocks):
                print(f'[DEBUG]   이미지 블록 {i+1}: {ib["image_url"]["url"][:100]}...')
        # GPT-5/o-시리즈는 특정 파라미터만 지원
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content}
            ]
        }
        
        # 모델에 따라 적절한 파라미터 사용
        if model.startswith('gpt-5') or model.startswith('o1') or model.startswith('o3') or model.startswith('o4'):
            # GPT-5/o-시리즈: 충분한 토큰/시간 확보 (공격적으로 완화)
            payload["max_completion_tokens"] = 8000
        else:
            # GPT-4o 등 일반 모델: max_tokens, temperature 모두 지원
            payload["max_tokens"] = 1200  # 복잡한 문제를 위해 여유 있게 설정
            payload["temperature"] = 0.3  # 약간 높여서 문제 해결 능력 향상
        try:
            print(f'[DEBUG] OpenAI API 호출 중... (timeout: 120s)')
            r = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=120
            )
            r.encoding = 'utf-8'
            print(f'[DEBUG] API 응답 상태: {r.status_code}')
            
            if r.status_code != 200:
                print(f"[WARN] ❌ OpenAI 호출 실패 (문항 {pid}): {r.status_code}")
                print(f"[WARN] 응답 내용: {r.text[:200]}")
                answers.append({"id": pid, "answer": "N/A", "explanation": "API 오류"})
                continue

            resp_json = r.json()
            print(f'[DEBUG] 전체 응답 구조: {resp_json}')
            
            content_str = resp_json['choices'][0]['message']['content'].strip()
            print(f'[DEBUG] LLM 응답 내용 (전체): {content_str}')
            
            if not content_str:
                print(f'[WARN] 빈 응답 수신 (문항 {pid})')
                answers.append({"id": pid, "answer": "N/A", "explanation": "빈 응답"})
                continue
            
            # Markdown 코드 블록 제거 (```json ... ```)
            if content_str.startswith('```'):
                lines = content_str.split('\n')
                # 첫 줄 (```json 등) 제거
                if len(lines) > 1:
                    content_str = '\n'.join(lines[1:])
                # 마지막 줄 (```) 제거
                if content_str.endswith('```'):
                    content_str = content_str[:-3].strip()
            
            try:
                # JSON 파싱 시도 (strict=False로 이스케이프 문제 완화)
                parsed = json.loads(content_str, strict=False)
                if isinstance(parsed, dict) and 'answer' in parsed:
                    ans = str(parsed.get('answer', '')).strip()
                    print(f'[DEBUG] ✅ 정답 파싱 성공: {ans[:30]}')
                    answers.append({"id": pid, "answer": ans})
                else:
                    print(f'[WARN] JSON 파싱 결과에 answer 키 없음')
                    # answer만 추출 시도
                    try:
                        import re
                        ans_match = re.search(r'"answer"\s*:\s*"([^"]+)"', content_str)
                        if ans_match:
                            ans = ans_match.group(1)
                            print(f'[DEBUG] ⚠️ 정규식으로 정답 추출: {ans}')
                            answers.append({"id": pid, "answer": ans})
                        else:
                            answers.append({"id": pid, "answer": "N/A"})
                    except:
                        answers.append({"id": pid, "answer": "N/A"})
            except json.JSONDecodeError as parse_err:
                print(f'[WARN] JSON 파싱 실패: {parse_err}')
                # 정규식으로 answer 추출 시도
                try:
                    import re
                    ans_match = re.search(r'"answer"\s*:\s*"([^"]+)"', content_str)
                    if ans_match:
                        ans = ans_match.group(1)
                        print(f'[DEBUG] ⚠️ 정규식으로 정답 추출 성공: {ans}')
                        answers.append({"id": pid, "answer": ans})
                    else:
                        print(f'[WARN] 정규식 추출도 실패, 원본 반환')
                        answers.append({"id": pid, "answer": "N/A"})
                except Exception as regex_err:
                    print(f'[ERROR] 정규식 추출 실패: {regex_err}')
                    answers.append({"id": pid, "answer": "N/A"})
            except Exception as parse_err:
                print(f'[ERROR] 예외 발생: {parse_err}')
                answers.append({"id": pid, "answer": "N/A"})
        except Exception as e:
            print(f"[ERROR] ❌ OpenAI 호출 예외 (문항 {pid}): {e}")
            import traceback
            traceback.print_exc()
            answers.append({"id": pid, "answer": "N/A", "explanation": "예외 발생"})

    print('=' * 60)
    print(f'[INFO] ✅ 정답지 생성 완료: 총 {len(answers)}개 답안')
    print('=' * 60)
    return answers

def fetch_answers_via_gemini(problems):
    """Google Gemini API 사용: 2.5-pro 등 멀티모달(텍스트+이미지) 입력 지원.
    - env: GEMINI (API Key), GEMINI_MODEL (기본: gemini-2.5-pro)
    - 이미지: inline_data(base64)로 전송
    """
    print('[DEBUG] fetch_answers_via_gemini 호출됨')
    print(f'[DEBUG] 입력 문제 수: {len(problems)}')

    api_key = os.getenv('GEMINI') or os.getenv('GOOGLE_API_KEY')
    if not api_key:
        print('[ERROR] ❌ GEMINI API 키가 없습니다 (.env: GEMINI)')
        return []
    model = os.getenv('GEMINI_MODEL', 'gemini-2.5-pro')
    print(f'[INFO] 정답지 생성 중 (Gemini 모델: {model}, 문항 수: {len(problems)})')

    system_prompt = (
        '너는 한국 고등학교 수학 문제를 푸는 전문가다.\n'
        '주어진 문제를 정확히 풀고 최종 정답만 한국어로 제시하라.\n\n'
        '출력 형식 (JSON 한 줄):\n'
        '{"id": 문항번호, "answer": "정답"}'
    )

    answers = []
    for idx, p in enumerate(problems, 1):
        pid = p.get('id') or p.get('problemNumber') or 0
        print(f'[DEBUG] (Gemini) 문항 {idx}/{len(problems)} (ID: {pid}) 처리 중...')
        parts = _build_mm_for_gemini(p)
        print(f'[DEBUG] (Gemini) parts 수: {len(parts)} (텍스트/이미지 합산)')

        payload = {
            "system_instruction": {"role": "system", "parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"maxOutputTokens": 8000, "temperature": 0.3}
        }

        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            print('[DEBUG] Gemini API 호출 중... (timeout: 120s)')
            r = requests.post(url, json=payload, timeout=120)
            print(f'[DEBUG] API 응답 상태: {r.status_code}')
            if r.status_code != 200:
                print(f"[WARN] ❌ Gemini 호출 실패 (문항 {pid}): {r.status_code}")
                print(f"[WARN] 응답 내용: {r.text[:250]}")
                answers.append({"id": pid, "answer": "N/A", "explanation": "API 오류"})
                continue

            resp = r.json()
            # candidates[0].content.parts[*].text 결합
            cand = (resp.get('candidates') or [{}])[0]
            parts_out = (cand.get('content') or {}).get('parts') or []
            content_str = "".join([p.get('text', '') for p in parts_out]).strip()
            print(f'[DEBUG] LLM 응답 내용 (Gemini 전체): {content_str[:400]}')

            if not content_str:
                answers.append({"id": pid, "answer": "N/A", "explanation": "빈 응답"})
                continue

            if content_str.startswith('```'):
                lines = content_str.split('\n')
                if len(lines) > 1:
                    content_str = '\n'.join(lines[1:])
                if content_str.endswith('```'):
                    content_str = content_str[:-3].strip()

            try:
                parsed = json.loads(content_str, strict=False)
                if isinstance(parsed, dict) and 'answer' in parsed:
                    ans = str(parsed.get('answer', '')).strip()
                    print(f'[DEBUG] ✅ 정답 파싱 성공(Gemini): {ans[:30]}')
                    answers.append({"id": pid, "answer": ans})
                else:
                    import re
                    m = re.search(r'"answer"\s*:\s*"([^"]+)"', content_str)
                    if m:
                        ans = m.group(1)
                        print(f'[DEBUG] ⚠️ 정규식 정답 추출(Gemini): {ans}')
                        answers.append({"id": pid, "answer": ans})
                    else:
                        answers.append({"id": pid, "answer": "N/A"})
            except json.JSONDecodeError as parse_err:
                print(f'[WARN] JSON 파싱 실패(Gemini): {parse_err}')
                import re
                m = re.search(r'"answer"\s*:\s*"([^"]+)"', content_str)
                if m:
                    ans = m.group(1)
                    print(f'[DEBUG] ⚠️ 정규식 정답 추출 성공(Gemini): {ans}')
                    answers.append({"id": pid, "answer": ans})
                else:
                    answers.append({"id": pid, "answer": "N/A"})
        except requests.exceptions.Timeout:
            print(f"[ERROR] ❌ Gemini 호출 예외 (문항 {pid}): Read timed out")
            answers.append({"id": pid, "answer": "N/A", "explanation": "타임아웃"})
        except Exception as e:
            print(f"[ERROR] ❌ Gemini 호출 예외 (문항 {pid}): {e}")
            answers.append({"id": pid, "answer": "N/A", "explanation": f"네트워크 오류: {e}"})

    print('=' * 60)
    print(f'[INFO] ✅ 정답지 생성 완료(Gemini): 총 {len(answers)}개 답안')
    print('=' * 60)
    return answers

### DeepSeek provider code removed (using OpenAI gpt-5-nano only)

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
        line = (r"\item \textbf{정답:} " + ans)
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

def problem_to_tex(problem, idx=None, show_meta=False):
    """문제 하나를 LaTeX로 변환"""
    L = []
    # 단 첫 문제(1번) 상단 간격 보정
    if idx == 1:
        L.append(r"\vspace{1em}")

    # 번호와 발문 블록 시작
    L.append(r"\item \leavevmode\begin{minipage}[t]{\linewidth}")

    # 문항 메타 표기 (발문 바로 윗줄, 우측 정렬, 아이템 박스 내에 포함)
    if show_meta:
        show_meta_file = os.getenv('SHOW_META_FILE', '0') == '1'
        show_meta_page = os.getenv('SHOW_META_PAGE', '0') == '1'
        show_meta_id = os.getenv('SHOW_META_ID', '0') == '1'

        meta_file = str(problem.get('file') or problem.get('source_file') or problem.get('origin_filename') or 'null')
        meta_page = str(problem.get('page') or problem.get('pageNumber') or 'null')
        raw_id = problem.get('problemNumber') or (idx if idx is not None else problem.get('_id'))
        meta_id = str(raw_id) if raw_id is not None else 'null'

        meta_parts = []
        if show_meta_file:
            meta_parts.append(f"file:{meta_file}")
        if show_meta_page:
            meta_parts.append(f"page:{meta_page}")
        if show_meta_id:
            meta_parts.append(f"id:{meta_id}")

        if meta_parts:
            meta_text = " ".join(meta_parts)
            safe_meta = _latex_escape_expl(meta_text)
            # 번호 기준선보다 한 줄 위에 메타를 표시하기 위해 음수 vspace 사용
            L.append(r"\vspace*{-\baselineskip}")
            L.append(r"\makebox[\linewidth][r]{\small\color{ruleGray} " + safe_meta + r"}")
            L.append(r"\vspace{0.3em}")

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
                # 파일명 보강: 문제의 fileid로 files 컬렉션에서 filename 조회
                try:
                    file_id_val = problem.get('fileid') or problem.get('file_id') or problem.get('fileId') or problem.get('source_file_id')
                    filename_val = None
                    if file_id_val:
                        try:
                            fid = ObjectId(str(file_id_val))
                            fdoc = db.files.find_one({"_id": fid})
                            if fdoc:
                                filename_val = fdoc.get('filename') or fdoc.get('name') or fdoc.get('originalname')
                        except Exception as e:
                            print(f"[WARN] 파일명 조회 실패 (fileid={file_id_val}): {e}")
                    if filename_val:
                        problem['file'] = filename_val
                except Exception as _:
                    pass
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
        SHOW_META = os.getenv('SHOW_META', '0') == '1'
        for i, problem in enumerate(problems, 1):
            parts.append(problem_to_tex(problem, idx=i, show_meta=SHOW_META))

        # 문제 섹션 종료 (정답 페이지는 별도 페이지로)
        parts.append(tail_close_lists())

        # 정답 생성은 환경설정(톱니바퀴)에서 선택된 경우에만 진행
        answers = []
        ANSWERS_MODE = os.getenv('ANSWERS_MODE', 'none')
        if ANSWERS_MODE == 'answers-only':
            print('=' * 60)
            print('정답 페이지 생성 시작 (answers-only 모드)')
            print('=' * 60)
            answers = fetch_answers_via_llm(problems)
            print(f'[DEBUG] fetch_answers_via_llm 결과: {len(answers)}개 답안')
            if answers:
                print('[DEBUG] 정답 페이지 LaTeX 추가 중...')
                parts.append(answers_page_tex(answers))
                print('[DEBUG] 정답 페이지 추가 완료')
            else:
                print('[WARN] 정답이 없어 정답 페이지를 생성하지 않습니다. API 키 및 네트워크를 확인하세요.')
        else:
            print('[INFO] ANSWERS_MODE!=answers-only 이므로 정답 페이지를 생성하지 않습니다.')

        # 문서 종료
        parts.append(r"\end{document}")

        # UTF-8로 저장
        tex_path.write_text("\n".join(parts), encoding="utf-8")
        print(f"LaTeX 파일 생성: {tex_path}")

        # PDF 생성
        build_pdf(tex_path)
        
        # 생성된 정답 출력 (로그 마지막에 표시)
        if answers:
            print("\n" + "=" * 60)
            print("📝 생성된 정답 목록")
            print("=" * 60)
            for ans_item in answers:
                ans_id = ans_item.get('id', '?')
                ans_val = ans_item.get('answer', 'N/A')
                print(f"문항 {ans_id}: {ans_val}")
            print("=" * 60 + "\n")

        client.close()

    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        # 에러 발생 시 종료 코드 1로 종료
        sys.exit(1)

if __name__ == "__main__":
    main()
