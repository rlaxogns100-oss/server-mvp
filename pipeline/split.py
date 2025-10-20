# split.py - 최적화된 문제 분할 스크립트
# 기존 호출 방식과 호환되도록 수정된 버전

from pathlib import Path
import re
import sys
import json
import argparse

# =============================================================================
# 정규식 패턴 정의 섹션
# =============================================================================

# 페이지 마크 패턴: "<<<PAGE 1>>>", "<<<PAGE 2>>>" 등의 형태를 감지
PAGE_MARK = re.compile(r"^<<<PAGE\s+(\d+)\s*>>>$")

# 문항 시작 패턴: 다양한 형태의 문항 번호를 감지
# 소문제(17.1, 17.2 등)는 별도 문제로 인식하지 않음
QUESTION_RX = re.compile(
    r'^\s*(?:'
    r'(?:\d{1,3})\s*(?:[.)]|[．。]|번)(?!\s*\d)'   # 1. 1) 1． 1。 1번 (소문제 제외)
    r'|'
    r'[①-⑳][.)]?'                        # ①. ①) ① 등
    r'|'
    r'(?:단답형|서답형|주관식)\s*\d+'     # 단답형1, 서답형1, 주관식1
    r'|'
    r'\\section\*\{단답형\s*\d+\s*[\)}]'     # \section*{단답형 1}, \section*{단답형 2 )}, \section*{단답형 3)} 등 (띄어쓰기 허용)
    r'|'
    r'[A-K]\d+'                          # A32, B15, C8 등
    r')'
)

# 발문 끝 신호 패턴: 문항이 끝났음을 나타내는 다양한 표현들을 감지
QUESTION_END_RX = re.compile(
    r'(?:\?|？|물음표|'
    r'구\s*하\s*시\s*오|구\s*하\s*여\s*라|구\s*하\s*라|하\s*라|'
    r'서\s*술\s*하\s*시\s*오|서\s*술\s*하\s*라|설\s*명\s*하\s*시\s*오|설\s*명\s*하\s*라|'
    r'계\s*산\s*하\s*시\s*오|계\s*산\s*하\s*라|증\s*명\s*하\s*시\s*오|증\s*명\s*하\s*라|'
    r'보\s*이\s*시\s*오|보\s*이\s*라|찾\s*으\s*시\s*오|찾\s*으\s*라|'
    r'고\s*르\s*시\s*오|고\s*르\s*라|선\s*택\s*하\s*시\s*오|선\s*택\s*하\s*라|'
    r'작\s*성\s*하\s*시\s*오|작\s*성\s*하\s*라|기\s*입\s*하\s*시\s*오|기\s*입\s*하\s*라|'
    r'쓰\s*시\s*오|하\s*시\s*오)'
    r'(?:\s*\([^)]*\))?'  # 끝 신호 후 소괄호 조건 허용
)

# 이미지 링크 패턴: 마크다운 및 LaTeX 형태의 이미지를 감지
IMAGE_LINK_RX = re.compile(
    r'!\[.*?\]\([^)]+\)'  # 마크다운 이미지
    r'|'
    r'\\includegraphics(?:\[[^\]]*\])?\{[^}]+\}'  # LaTeX \includegraphics
    r'|'
    r'\\begin\{figure\}'  # LaTeX figure 시작
    r'|'
    r'\\end\{figure\}'  # LaTeX figure 종료
    r'|'
    r'\\caption(?:setup)?\{[^}]*\}'  # LaTeX caption
)

# 보기 패턴: 문제의 보기 섹션을 감지
VIEW_TOKEN_RX = re.compile(r'(?:'
    r'<\s*보\s*기\s*>|<보기>|<보 기>|<\s*보기\s*>|'
    r'\[\s*보\s*기\s*\]|\[보기\]|\[보 기\]|'
    r'［\s*보\s*기\s*］|［보기］|'
    r'〈\s*보\s*기\s*〉|〈보기〉|'
    r'<<\s*보\s*기\s*>>|<<보기>>|'
    r'보\s*기\s*>|보기>|'
    r'<\s*보\s*기|<보기|'
    r'^\s*보\s*기\s*$|'
    r'\\section\*\{[^}]*보\s*기[^}]*\}|'
    
    # 보기 항목들 - 다양한 형식
    r'^\s*[\(（]\s*[ㄱ-ㅎ]\s*[\)）]|'  # (ㄱ), (ㄴ), (ㄷ) 등
    r'^\s*[ㄱ-ㅎ]\s*[\.\．\)）]|'      # ㄱ. ㄴ. ㄷ) 등
    r'^\s*[ㄱ-ㅎ]\s*$|'               # 줄바꿈 후 ㄱ, ㄴ, ㄷ 등
    r'^\s*[\(（]\s*[가-힣]\s*[\)）]|'  # (가), (나), (다) 등
    r'^\s*[가-힣]\s*[\.\．\)）]|'      # 가. 나. 다) 등
    r'^\s*[\(（]\s*[A-Z]\s*[\)）]|'    # (A), (B), (C) 등
    r'^\s*[A-Z]\s*[\.\．\)）]|'        # A. B. C) 등
    r'^\s*[\(（]\s*[a-z]\s*[\)）]|'    # (a), (b), (c) 등
    r'^\s*[a-z]\s*[\.\．\)）]|'        # a. b. c) 등
    r'^\s*[\(（]\s*[ⅰⅱⅲⅳⅴ]\s*[\)）]|'  # (ⅰ), (ⅱ), (ⅲ) 등
    r'^\s*[ⅰⅱⅲⅳⅴ]\s*[\.\．\)）]|'      # ⅰ. ⅱ. ⅲ) 등
    r'^\s*[\(（]\s*[①②③④⑤]\s*[\)）]|'     # (①), (②), (③) 등
    r'^\s*[①②③④⑤]\s*[\.\．\)）]|'         # ①. ②. ③) 등
    
    # 특수 문자들
    r'^\s*[ᄀ-ᄒ]\s*[\.\．\)）]|'      # ᄀ. ᄂ. ᄃ) 등 (자음)
    r'^\s*[\u3131-\u314e]\s*[\.\．\)）]' # 다른 한글 자모
    r')')

# 선지 패턴: 객관식 문제의 선택지들을 감지
CHOICE_LINE_RX = re.compile(
    r'^\s*(?:'
    r'[\u2460-\u2464]'                  # ①, ②, ③, ④, ⑤
    r'|[1-5\uff11\uff12\uff13\uff14\uff15]\s*[\.\uff0e\)]'  # 1. 2) 3. 등
    r'|[\(（]\s*[1-5\uff11\uff12\uff13\uff14\uff15]\s*[\)）]'  # (1) （2） 등
    r'|[\u1100-\u1112]\s*[\.\uff0e\)]'  # ㄱ. ㄴ) 등
    r'|[\u3131-\u314e]\s*[\.\uff0e\)]'  # ᄀ. ᄂ) 등
    r')'
)

# 추가 조건 패턴: 문항에 추가적인 조건이 있을 때 감지
ADDITIONAL_CONDITION_RX = re.compile(r'\(\s*단\s*[,:]')

# 배점 표기 패턴: 문제의 점수 표기를 감지
SCORE_BRACKET_RX = re.compile(
    r'\[\s*\d+(?:\.\d+)?\s*점(?:[^\]]*)\]'  # [4.7점], [5.2점], [3점]
    r'|'
    r'\(\s*\d+(?:\.\d+)?\s*점(?:[^\)]*)\)'  # (4.7점), (5.2점)
    r'|'
    r'\d+(?:\.\d+)?\s*점'  # 4.7점, 5.2점 (괄호 없이)
)

# 표 패턴: LaTeX 표 환경을 감지
TABLE_RX = re.compile(r'\\begin\{tabular\}|\\end\{tabular\}|^\s*\\hline|^\s*&.*&')

# 보이지 않는 문자 패턴: 유니코드의 보이지 않는 문자들을 감지
INVIS_RX = re.compile(r"[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00A0]")

# =============================================================================
# 유틸리티 함수 섹션
# =============================================================================

def norm_for_detection(line: str) -> str:
    """텍스트 줄을 패턴 감지용으로 정규화하는 함수"""
    if not line:
        return ""
    line = INVIS_RX.sub("", line)
    return line.strip()

def safe_preview(text: str, limit: int = 80) -> str:
    """텍스트를 안전하게 미리보기용으로 자르는 함수"""
    if not text:
        return ""
    snippet = text[:limit]
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        snippet.encode(encoding)
        return snippet
    except UnicodeEncodeError:
        return snippet.encode("unicode_escape").decode()

# =============================================================================
# 핵심 처리 함수 섹션
# =============================================================================

def find_actual_end_line(lines, signal_line, current_page, start_signals, end_signals):
    """종료 신호 이후 추가 조건들을 확인하여 실제 종료 줄을 찾는 핵심 함수"""
    N = len(lines)
    j = signal_line

    # 종료 신호 줄 자체에 조건 키워드가 있는지 확인
    signal_det = norm_for_detection(lines[signal_line - 1].rstrip('\n'))
    CONDITION_KEYWORD_RX = re.compile(
        r'다음\s+조건'
        r'|'
        r'조건을\s+만족'
        r'|'
        r'아래\s+조건'
    )

    # 종료 신호에 조건 키워드가 있으면 기본적으로 추가 내용 상태로 시작
    in_additional_content = bool(CONDITION_KEYWORD_RX.search(signal_det))
    if in_additional_content:
        print(f"    [DEBUG] 종료 신호에 조건 키워드 감지, 추가 내용 상태로 시작: 줄 {signal_line}")

    last_choice_line_index = None
    last_subquestion_line_index = None
    last_additional_line_index = None

    if signal_line == 1:
        print(f"    [DEBUG] 페이지 첫 번째 줄에서 종료 신호, 해당 줄이 종료줄: {signal_line}")
        return signal_line - 1

    # 다음 시작신호/종료신호 찾기 (탐색 범위 제한)
    next_start_line = None
    next_end_line = None
    
    for signal in start_signals:
        if signal['line'] > signal_line:
            next_start_line = signal['line']
            break
    
    for signal in end_signals:
        if signal['line'] > signal_line:
            next_end_line = signal['line']
            break
    
    max_search_line = N
    if next_start_line is not None and next_end_line is not None:
        max_search_line = min(next_start_line, next_end_line)
    elif next_start_line is not None:
        max_search_line = next_start_line
    elif next_end_line is not None:
        max_search_line = next_end_line

    while j < max_search_line:
        line = lines[j].rstrip("\n")
        det = norm_for_detection(line)

        if PAGE_MARK.match(det):
            print(f"    [DEBUG] 페이지 변경 감지, 중단: 줄 {j+1}")
            break

        if QUESTION_RX.match(det):
            print(f"    [DEBUG] 다음 문항 시작 신호 감지, 중단: 줄 {j+1}")
            break

        has_additional_content = False

        if ADDITIONAL_CONDITION_RX.search(det):
            has_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 추가 조건 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        if SCORE_BRACKET_RX.search(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 배점 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        if VIEW_TOKEN_RX.search(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 보기 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        if IMAGE_LINK_RX.search(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 이미지 링크 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        if CHOICE_LINE_RX.match(det):
            # (1)~(5) 패턴 발견 시 무조건 추가 내용으로 포함
            has_additional_content = True
            in_additional_content = True
            last_choice_line_index = j
            last_additional_line_index = j
            print(f"    [DEBUG] (1)~(5) 패턴 감지 (선지/소문제): 줄 {j+1}: {safe_preview(det, 50)}...")

            # (5) 패턴 발견 시 즉시 종료 (선지의 마지막)
            # 단, 다음 줄이 이미지인 경우 이미지까지만 포함
            if re.search(r'\(5\)|（5）', det):
                # 다음 줄이 이미지인지 확인
                if j + 1 < N:
                    next_line = lines[j + 1].rstrip('\n')
                    next_det = norm_for_detection(next_line)

                    # 다음 줄이 이미지면 하나만 더 포함
                    if IMAGE_LINK_RX.search(next_det):
                        print(f"    [DEBUG] (5) 패턴 후 이미지 감지, 이미지 포함: 줄 {j+2}")
                        return j + 1  # 이미지까지 포함 (0-based)

                # 이미지 아니면 즉시 종료
                print(f"    [DEBUG] (5) 패턴 발견, 즉시 종료: 줄 {j+1}")
                return j

        if TABLE_RX.match(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 표 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        if re.match(r"^(?:\\\[|\\\]|\\begin\{aligned\}|\\end\{aligned\}|&.*&)$", det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 수식 환경 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        if has_additional_content:
            in_additional_content = True

        if in_additional_content:
            if det.strip():
                last_additional_line_index = j
            print(f"    [DEBUG] 추가 내용 상태 유지, 계속 진행: 줄 {j+1}")
            j += 1
            continue

        if det.strip() and not has_additional_content:
            candidates = [idx for idx in (last_choice_line_index, last_subquestion_line_index, last_additional_line_index) if idx is not None]
            if candidates:
                print(f"    [DEBUG] 추가 내용 발견, 마지막 추가 내용 줄을 종료줄로 사용: {max(candidates) + 1}")
                return max(candidates)
            print(f"    [DEBUG] 추가 내용 없음, 종료 신호 줄이 종료줄: {signal_line}")
            return signal_line - 1

        print(f"    [DEBUG] 줄 {j+1}: has_content={has_additional_content}, in_content={in_additional_content}, det='{safe_preview(det, 30)}...'")
        j += 1

    if last_additional_line_index is not None:
        print(f"    [DEBUG] 페이지 끝, 마지막 추가 내용 줄을 종료줄로 사용: {last_additional_line_index + 1}")
        return last_additional_line_index
    if in_additional_content:
        print(f"    [DEBUG] 페이지 끝, 추가 내용 상태에서 종료: {j}")
        return j - 1
    print(f"    [DEBUG] 페이지 끝, 추가 내용 없음, 종료 신호 줄이 종료줄: {signal_line}")
    return signal_line - 1

def calculate_problems_with_algorithm(input_file: Path):
    """시작 줄과 종료 줄 정보를 바탕으로 문제 분할 알고리즘을 적용하는 핵심 함수"""
    print(f"\n=== 알고리즘으로 문제 분할 계산 ===")
    
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    print("1단계: 시작 줄과 종료 줄 정보 수집")
    start_lines = []
    end_lines = []
    current_page = 1
    
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')
        det = norm_for_detection(line)
        
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))
            continue
        
        if QUESTION_RX.match(det):
            start_lines.append(i)
            print(f"  시작줄 발견: 줄 {i}")
        
        if QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det):
            if not (CHOICE_LINE_RX.match(det) and not QUESTION_RX.match(det)):
                actual_end_line = find_actual_end_line(lines, i, current_page, [], [])
                end_lines.append(actual_end_line + 1)
                print(f"  종료줄 발견: 줄 {actual_end_line + 1} (신호: {i})")
    
    print(f"수집 완료: 시작줄 {len(start_lines)}개, 종료줄 {len(end_lines)}개")
    
    print("\n2단계: 유한 상태 기계 알고리즘 적용")
    print("알고리즘 설명:")
    print("- condition=0: 문제를 기다리는 상태")
    print("- condition=1: 문제가 시작된 상태 (종료줄을 기다림)")
    print("0번째 줄이 종료 줄이었다고 가정하고 시작")
    
    condition = 0
    last_end_line = 0
    last_start_line = 0
    problems = []
    total_lines = len(lines)
    
    for line_num in range(1, total_lines + 1):
        is_start = line_num in start_lines
        is_end = line_num in end_lines
        
        if is_start and is_end:
            print(f"  줄 {line_num}: 시작줄과 종료줄이 같은 줄, condition=0으로 변경")
            condition = 0
            problem_range = (last_end_line + 1, line_num)
            problems.append(problem_range)
            print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (시작=종료줄 {line_num})")
            last_end_line = line_num
            continue
        
        if condition == 0:
            if is_start:
                print(f"  줄 {line_num}: 시작줄 발견, condition=1로 전이")
                last_start_line = line_num
                condition = 1
            elif is_end:
                print(f"  줄 {line_num}: 종료줄 발견, condition=0 유지")
                problem_range = (last_end_line + 1, line_num)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (종료줄 {line_num})")
                last_end_line = line_num
                condition = 0
                
        elif condition == 1:
            if is_start:
                print(f"  줄 {line_num}: 새 시작줄 발견, 이전 문제 종료 후 새 문제 시작")
                problem_range = (last_start_line, line_num - 1)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (새 시작줄 {line_num} 전)")
                last_start_line = line_num
                condition = 1
            elif is_end:
                print(f"  줄 {line_num}: 종료줄 발견, 현재 문제 종료, condition=0으로 전이")
                problem_range = (last_start_line, line_num)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (시작줄 {last_start_line}~종료줄 {line_num})")
                last_end_line = line_num
                condition = 0
            elif line_num == total_lines:
                print(f"  줄 {line_num}: 마지막 줄 도달, 현재 문제 종료")
                problem_range = (last_start_line, line_num)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (마지막 시작줄 {last_start_line}~마지막줄 {line_num})")
                last_end_line = line_num
                condition = 0
    
    if condition == 1:
        print("3단계: 마지막 시작줄 처리")
        problem_range = (last_start_line, total_lines)
        problems.append(problem_range)
        print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (마지막 시작줄 {last_start_line}~마지막줄 {total_lines})")
    
    print(f"\n총 {len(problems)}개 문제로 분할됨")
    return problems

def save_problems_to_json(problems, input_file: Path, output_file: Path):
    """분할된 문제들을 JSON 파일로 저장하는 함수"""
    print("\n=== 문제 분할 결과를 JSON으로 저장 ===")
    
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    print("1단계: 시작/종료 줄 정보 재수집 (페이지 정보 포함)")
    start_lines = []
    end_lines = []
    current_page = 1
    
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')
        det = norm_for_detection(line)
        
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))
            continue
        
        if QUESTION_RX.match(det):
            start_lines.append({'line': i, 'page': current_page})
        
        if QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det):
            if not (CHOICE_LINE_RX.match(det) and not QUESTION_RX.match(det)):
                actual_end_line = find_actual_end_line(lines, i, current_page, [], [])
                end_lines.append({'line': actual_end_line + 1, 'page': current_page})
    
    print(f"수집 완료: 시작줄 {len(start_lines)}개, 종료줄 {len(end_lines)}개")
    
    print("2단계: 문제 내용 추출 및 JSON 데이터 생성")
    problems_data = []
    
    for i, (start_line, end_line) in enumerate(problems, 1):
        print(f"  문제 {i} 처리 중: 줄 {start_line}~{end_line}")
        
        problem_content = []
        for line_idx in range(start_line - 1, end_line):
            if 0 <= line_idx < len(lines):
                problem_content.append(lines[line_idx].rstrip('\n'))
        
        problem_page = None
        current_page_scan = 1
        for line_idx in range(start_line):
            if line_idx < len(lines):
                det_scan = norm_for_detection(lines[line_idx].rstrip('\n'))
                page_match_scan = PAGE_MARK.match(det_scan)
                if page_match_scan:
                    current_page_scan = int(page_match_scan.group(1))
        problem_page = current_page_scan
        
        is_start_start = start_line in [s['line'] for s in start_lines]
        is_start_end = end_line in [e['line'] for e in end_lines]
        
        if is_start_start and is_start_end:
            classification = "start-end"
        elif is_start_start:
            classification = "start-start"
        elif is_start_end:
            classification = "end-end"
        else:
            classification = "unknown"
        
        problem_data = {
            "id": i,
            "classification": classification,
            "content": problem_content,
            "page": problem_page
        }
        
        problems_data.append(problem_data)
        print(f"    분류: {classification}, 페이지: {problem_page}, 내용 길이: {len(problem_content)}줄")
    
    print("3단계: JSON 파일로 저장")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(problems_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n문제 분할 결과가 {output_file}에 저장되었습니다.")
    print(f"총 {len(problems_data)}개 문제가 JSON 파일로 저장됨")
    
    file_size = output_file.stat().st_size
    print(f"파일 크기: {file_size:,} bytes ({file_size/1024:.1f} KB)")

# =============================================================================
# 메인 실행 함수 섹션 (기존 호출 방식과 호환)
# =============================================================================

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

def main():
    """
    기존 호출 방식과 호환되는 main 함수
    app.cjs에서 pipeline/split.py를 직접 호출할 때 사용
    """
    parser = argparse.ArgumentParser(description="문제 분할 스크립트")
    parser.add_argument("--sample", type=str, help="history 폴더의 샘플 번호 (예: sample1)")

    args = parser.parse_args()

    print("=" * 80)
    print("최적화된 문제 분할 스크립트")
    print("=" * 80)

    # 모드 결정
    if args.sample:
        # 테스트 모드: --sample 옵션 사용
        sample_path = Path(f"history/{args.sample}")
        if not sample_path.exists():
            print(f"샘플 폴더가 존재하지 않습니다: {sample_path}")
            return

        input_file = None
        for cand in ("result.paged.filtered.mmd",):
            p = sample_path / cand
            if p.exists():
                input_file = p
                break

        if not input_file:
            print(f"{sample_path} 폴더에 result.paged.filtered.mmd 파일을 찾을 수 없습니다.")
            return

        output_file = sample_path / "problems.json"
    else:
        # 서버 모드 또는 대화형 모드
        if sys.stdin.isatty():
            # 대화형 모드: 샘플 선택
            selected_sample = select_sample_interactive()
            sample_path = Path(f"history/{selected_sample}")
            if not sample_path.exists():
                print(f"샘플 폴더가 존재하지 않습니다: {sample_path}")
                return

            input_file = None
            for cand in ("result.paged.filtered.mmd",):
                p = sample_path / cand
                if p.exists():
                    input_file = p
                    break

            if not input_file:
                print(f"{sample_path} 폴더에 result.paged.filtered.mmd 파일을 찾을 수 없습니다.")
                return

            output_file = sample_path / "problems.json"
        else:
            # 서버 모드: 기본 경로 사용
            input_file = None
            for cand in ("output/result.paged.filtered.mmd", "result.paged.filtered.mmd"):
                p = Path(cand)
                if p.exists():
                    input_file = p
                    break

            if not input_file:
                print("입력 파일을 찾을 수 없습니다.")
                print("다음 경로 중 하나에 파일이 있어야 합니다:")
                print("  - output/result.paged.filtered.mmd")
                print("  - result.paged.filtered.mmd")
                return

            output_file = Path("output/problems.json")
            output_file.parent.mkdir(parents=True, exist_ok=True)

    print(f"[*] 입력: {input_file}")

    # 문제 분할 실행
    problems = calculate_problems_with_algorithm(input_file)

    if problems:
        # JSON 파일로 저장
        save_problems_to_json(problems, input_file, output_file)

        print(f"\n[성공] 문제 분할이 성공적으로 완료되었습니다!")
        print(f"   결과 파일: {output_file}")
        print(f"   총 {len(problems)}개의 문제가 분할되어 저장되었습니다.")
    else:
        print("\n[실패] 문제 분할에 실패했습니다.")
        print("   시작 줄이나 종료 줄이 제대로 감지되지 않았을 수 있습니다.")

if __name__ == "__main__":
    main()