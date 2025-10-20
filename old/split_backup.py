# split2.py - 시작 줄과 종료 줄을 독립적으로 찾아서 문제를 자동 분할하는 스크립트
# 
# 이 스크립트의 주요 목적:
# 1. 시험 문제 문서에서 각 문항의 시작점과 종료점을 자동으로 감지
# 2. 감지된 시작/종료점을 바탕으로 문제를 자동으로 분할
# 3. 분할된 문제들을 JSON 형태로 저장하여 후속 처리 가능하게 함
#
# 전체 처리 흐름:
# 1. 정규식 패턴들을 정의하여 문항 시작/종료 신호를 감지할 준비
# 2. 문서를 한 줄씩 스캔하여 시작 줄들을 찾아 리스트로 저장
# 3. 문서를 한 줄씩 스캔하여 종료 신호를 찾고, 추가 조건들을 확인하여 실제 종료 줄 결정
# 4. 시작 줄과 종료 줄 정보를 바탕으로 알고리즘을 적용하여 문제들을 분할
# 5. 분할된 문제들을 JSON 파일로 저장

from pathlib import Path
import re
import sys
import json

# =============================================================================
# 정규식 패턴 정의 섹션
# =============================================================================

# 페이지 마크 패턴: "<<<PAGE 1>>>", "<<<PAGE 2>>>" 등의 형태를 감지
# 페이지 번호를 캡처 그룹으로 추출하여 현재 페이지를 추적하는 데 사용
PAGE_MARK = re.compile(r"^<<<PAGE\s+(\d+)\s*>>>$")

# 문항 시작 패턴: 다양한 형태의 문항 번호를 감지
# - 숫자 + 구분자: "1.", "1)", "1．", "1。", "1번"
# - 원문자: "①", "②", "③" 등
# - 유형 + 숫자: "단답형1", "서답형1", "주관식1"
# - LaTeX 섹션: "\section*{단답형 1}", "\section*{단답형 2}", "\section*{단답형 3)}" 등
# - 영문 + 숫자: "A32", "B15", "C8" 등
QUESTION_RX = re.compile(
    r'^\s*(?:'
    r'(?:\d{1,3})\s*(?:[.)]|[．。]|번)'   # 1. 1) 1． 1。 1번
    r'|'
    r'[①-⑳][.)]?'                        # ①. ①) ① 등
    r'|'
    r'(?:단답형|서답형|주관식)\s*\d+'     # 단답형1, 서답형1, 주관식1
    r'|'
    r'\\section\*\{단답형\s*\d+[\)}]'     # \section*{단답형 1}, \section*{단답형 2}, \section*{단답형 3)} 등
    r'|'
    r'[A-K]\d+'                          # A32, B15, C8 등
    r')'
)

# 발문 끝 신호 패턴: 문항이 끝났음을 나타내는 다양한 표현들을 감지
# - 물음표: "?", "？", "물음표"
# - 명령형 표현: "구하시오", "구하여라", "구하라", "하라" 등 (띄어쓰기 허용)
# - 설명 요청: "서술하시오", "설명하시오" 등 (띄어쓰기 허용)
# - 계산 요청: "계산하시오" 등 (띄어쓰기 허용)
# - 증명 요청: "증명하시오" 등 (띄어쓰기 허용)
# - 기타: "보이시오", "찾으시오", "고르시오", "선택하시오", "작성하시오", "기입하시오", "쓰시오", "하시오"
# - 끝 신호 후 소괄호 조건도 허용: "구하시오 (단, a는 자연수)"
QUESTION_END_RX = re.compile(
    r'(?:\?|？|물음표|'
    # 띄어쓰기 변형들 추가
    r'구\s*하\s*시\s*오|구\s*하\s*여\s*라|구\s*하\s*라|하\s*라|'
    r'서\s*술\s*하\s*시\s*오|서\s*술\s*하\s*라|설\s*명\s*하\s*시\s*오|설\s*명\s*하\s*라|'
    r'계\s*산\s*하\s*시\s*오|계\s*산\s*하\s*라|증\s*명\s*하\s*시\s*오|증\s*명\s*하\s*라|'
    r'보\s*이\s*시\s*오|보\s*이\s*라|찾\s*으\s*시\s*오|찾\s*으\s*라|'
    r'고\s*르\s*시\s*오|고\s*르\s*라|선\s*택\s*하\s*시\s*오|선\s*택\s*하\s*라|'
    r'작\s*성\s*하\s*시\s*오|작\s*성\s*하\s*라|기\s*입\s*하\s*시\s*오|기\s*입\s*하\s*라|'
    r'쓰\s*시\s*오|하\s*시\s*오)'
    r'(?:\s*\([^)]*\))?'  # 끝 신호 후 소괄호 조건 허용
)

# 이미지 링크 패턴: 마크다운 형태의 이미지 링크를 감지
# "![alt text](image_url)" 형태의 이미지 링크는 종료 신호로 인식하지 않음
IMAGE_LINK_RX = re.compile(r'!\[.*?\]\([^)]+\)')

# 보기 패턴: 문제의 보기 섹션을 감지 (띄어쓰기 허용)
# - HTML 태그: "<보기>", "< 보기 >" 등
# - 대괄호: "[보기]", "[ 보기 ]" 등
# - 꺾쇠: "〈보기〉", "〈 보기 〉" 등
# - 이중 꺾쇠: "<<보기>>", "<< 보기 >>" 등
# - LaTeX 섹션: "\section*{보기}" 또는 "\section*{보 기}"
VIEW_TOKEN_RX = re.compile(r'(?:'
    # 보기 패턴들 (띄어쓰기 허용)
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
# - 원문자: ①, ②, ③, ④, ⑤
# - 숫자 + 구분자: "1.", "2)", "3." 등 (일반 숫자와 전각 숫자 모두)
# - 괄호 + 숫자: "(1)", "（2）" 등
# - 한글 자모: "ㄱ.", "ㄴ)" 등
# - 한글 자음: "ᄀ.", "ᄂ)" 등
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
# "(단, ...)" 형태의 조건문을 감지하여 추가 내용으로 처리
ADDITIONAL_CONDITION_RX = re.compile(r'\(\s*단\s*[,:]')

# 선택지 줄 패턴 (보기 항목 감지용)
CHOICE_LINE_RX_EXTENDED = re.compile(
    r'^\s*(?:'
    r'[\u2460-\u2464]'                  # ①, ②, ③, ④, ⑤
    r'|[1-5\uff11\uff12\uff13\uff14\uff15]\s*[\.\uff0e\)]'  # 1. 2) 3. 등
    r'|[\(（]\s*[1-5\uff11\uff12\uff13\uff14\uff15]\s*[\)）]'  # (1) （2） 등
    r'|[\u1100-\u1112]\s*[\.\uff0e\)]'  # ㄱ. ㄴ) 등
    r'|[\u3131-\u314e]\s*[\.\uff0e\)]'  # ᄀ. ᄂ) 등
    r')'
)

# 표 패턴: LaTeX 표 환경을 감지
# - 표 시작/종료: "\begin{tabular}", "\end{tabular}"
# - 표 구분선: "\hline"
# - 표 셀: "& ... &" 형태
TABLE_RX = re.compile(r'\\begin\{tabular\}|\\end\{tabular\}|^\s*\\hline|^\s*&.*&')

# 보이지 않는 문자 패턴: 유니코드의 보이지 않는 문자들을 감지
# 텍스트 정규화 시 이러한 문자들을 제거하여 패턴 매칭의 정확성을 높임
INVIS_RX = re.compile(r"[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00A0]")

# =============================================================================
# 유틸리티 함수 섹션
# =============================================================================

def norm_for_detection(line: str) -> str:
    """
    텍스트 줄을 패턴 감지용으로 정규화하는 함수
    
    Args:
        line (str): 정규화할 텍스트 줄
        
    Returns:
        str: 정규화된 텍스트 (보이지 않는 문자 제거, 앞뒤 공백 제거)
        
    처리 과정:
    1. 빈 줄인 경우 빈 문자열 반환
    2. 보이지 않는 유니코드 문자들(제로 너비 공백, 방향성 마커 등) 제거
    3. 앞뒤 공백 제거
    
    이 함수는 패턴 매칭의 정확성을 높이기 위해 사용되며,
    문서에서 추출한 원본 텍스트를 정규화하여 일관된 형태로 만듭니다.
    """
    if not line:
        return ""
    # 보이지 않는 문자들을 제거하여 패턴 매칭의 정확성 향상
    line = INVIS_RX.sub("", line)
    # 앞뒤 공백을 제거하여 정규화
    return line.strip()

def safe_preview(text: str, limit: int = 80) -> str:
    """
    텍스트를 안전하게 미리보기용으로 자르는 함수
    
    Args:
        text (str): 미리보기할 텍스트
        limit (int): 최대 표시할 문자 수 (기본값: 80)
        
    Returns:
        str: 잘린 텍스트 (인코딩 오류 시 이스케이프 처리)
        
    처리 과정:
    1. 빈 텍스트인 경우 빈 문자열 반환
    2. 지정된 길이만큼 텍스트 자르기
    3. 현재 터미널 인코딩으로 인코딩 시도
    4. 인코딩 실패 시 유니코드 이스케이프 처리하여 안전하게 표시
    
    이 함수는 디버그 출력이나 로그에서 한글 텍스트를 안전하게 표시하기 위해 사용됩니다.
    """
    if not text:
        return ""
    snippet = text[:limit]
    # 현재 터미널의 인코딩을 가져오거나 UTF-8을 기본값으로 사용
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        # 현재 인코딩으로 인코딩 시도
        snippet.encode(encoding)
        return snippet
    except UnicodeEncodeError:
        # 인코딩 실패 시 유니코드 이스케이프 처리하여 안전하게 표시
        return snippet.encode("unicode_escape").decode()

# =============================================================================
# 핵심 처리 함수 섹션
# =============================================================================

def find_actual_end_line(lines, signal_line, current_page, start_signals, end_signals):
    """
    종료 신호 이후 추가 조건들을 확인하여 실제 종료 줄을 찾는 핵심 함수
    
    이 함수는 문항의 종료 신호(예: "구하시오")가 발견된 후,
    그 뒤에 오는 추가적인 내용들(선지, 보기, 표, 수식 등)을 확인하여
    문항이 실제로 어디서 끝나는지 정확히 판단합니다.
    
    Args:
        lines (list): 전체 문서의 줄들 (0-based 인덱스)
        signal_line (int): 종료 신호가 발견된 줄 번호 (1-based)
        current_page (int): 현재 페이지 번호
        start_signals (list): 시작 신호들의 리스트
        end_signals (list): 종료 신호들의 리스트
        
    Returns:
        int: 실제 종료 줄 번호 (0-based 인덱스)
        
    처리 과정:
    1. 종료 신호 다음 줄부터 순차적으로 스캔
    2. 탐색 범위를 다음 시작/종료 신호로 제한
    3. 페이지 변경, 다음 문항 시작 등 중단 조건 확인
    4. 추가 내용(선지, 보기, 표, 수식 등) 감지 및 추적
    5. 선지 (5) 발견 시 즉시 종료
    6. 추가 내용이 없으면 원래 종료 신호 줄을 종료줄로 사용
    7. 추가 내용이 있으면 마지막 추가 내용 줄을 종료줄로 사용
    """
    N = len(lines)  # 전체 줄 수
    j = signal_line  # 종료 신호 다음 줄부터 시작 (0-based)
    
    # 추가 내용 추적을 위한 변수들
    in_additional_content = False  # 현재 추가 내용 상태에 있는지 여부
    last_choice_line_index = None  # 마지막 선지 줄 인덱스
    last_subquestion_line_index = None  # 마지막 소문제 줄 인덱스
    last_additional_line_index = None  # 마지막 추가 내용 줄 인덱스

    # 특수 케이스: 페이지 첫 번째 줄에서 종료 신호가 나온 경우 처리
    if signal_line == 1:
        print(f"    [DEBUG] 페이지 첫 번째 줄에서 종료 신호, 해당 줄이 종료줄: {signal_line}")
        return signal_line - 1  # 0-based로 변환

    # 다음 시작신호/종료신호 찾기 (탐색 범위 제한)
    next_start_line = None
    next_end_line = None
    
    # 현재 신호 이후의 시작신호 찾기
    for signal in start_signals:
        if signal['line'] > signal_line:
            next_start_line = signal['line']
            break
    
    # 현재 신호 이후의 종료신호 찾기
    for signal in end_signals:
        if signal['line'] > signal_line:
            next_end_line = signal['line']
            break
    
    # 탐색 범위 제한: min(다음 시작신호, 다음 종료신호) 또는 파일 끝
    max_search_line = N
    if next_start_line is not None and next_end_line is not None:
        max_search_line = min(next_start_line, next_end_line)
    elif next_start_line is not None:
        max_search_line = next_start_line
    elif next_end_line is not None:
        max_search_line = next_end_line

    # 종료 신호 다음 줄부터 순차적으로 스캔 (탐색 범위 제한)
    while j < max_search_line:
        line = lines[j].rstrip("\n")  # 현재 줄의 개행 문자 제거
        det = norm_for_detection(line)  # 패턴 감지용으로 정규화

        # 중단 조건 1: 페이지가 바뀌면 즉시 중단
        if PAGE_MARK.match(det):
            print(f"    [DEBUG] 페이지 변경 감지, 중단: 줄 {j+1}")
            break

        # 중단 조건 2: 다음 문항 시작 신호 감지 - 즉시 중단
        if QUESTION_RX.match(det):
            print(f"    [DEBUG] 다음 문항 시작 신호 감지, 중단: 줄 {j+1}")
            break

        # 현재 줄에서 추가 내용이 있는지 확인하는 플래그
        has_additional_content = False

        # 추가 내용 감지 1: 소괄호 속 추가 조건
        # "(단, a는 자연수)" 같은 조건문을 감지
        if ADDITIONAL_CONDITION_RX.search(det):
            has_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 추가 조건 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        # 추가 내용 감지 2: 보기 토큰
        # "<보기>", "[보기]" 등의 보기 섹션을 감지
        if VIEW_TOKEN_RX.search(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 보기 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        # 추가 내용 감지 3: 이미지 링크
        # "![alt text](image_url)" 형태의 이미지를 감지
        if IMAGE_LINK_RX.search(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 이미지 링크 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        # 추가 내용 감지 4: 선지 처리 및 소문제 구분
        if CHOICE_LINE_RX.match(det):
            # 선지 (5) 패턴을 먼저 확인하여 바로 종료
            if re.search(r'\(5\)|（5）', det):
                print(f"    [DEBUG] 선지 (5) 발견, 즉시 종료: 줄 {j+1}")
                return j  # 0-based로 반환
            
            if QUESTION_END_RX.search(det):
                # 소문제: （1）다항식... 형태 (종료 신호도 포함)
                # 소문제는 예외조건이 아니므로 추가 내용으로 처리하지 않음
                print(f"    [DEBUG] 소문제 감지 (예외조건 아님): 줄 {j+1}: {safe_preview(det, 50)}...")
                # 소문제는 예외조건이 아니므로 has_additional_content를 True로 설정하지 않음
                # 따라서 이전 종료신호에서 여기서 멈춤

            else:
                # 선지 개수 확인을 위해 다음 몇 줄을 미리 확인
                choice_count = 0
                temp_j = j
                while temp_j < min(j + 10, max_search_line):  # 최대 10줄까지 확인
                    temp_line = lines[temp_j].rstrip("\n")
                    temp_det = norm_for_detection(temp_line)
                    
                    # 페이지 변경이나 다음 문항 시작 시 중단
                    if PAGE_MARK.match(temp_det) or QUESTION_RX.match(temp_det):
                        break
                    
                    # 선지 패턴 확인: (1), (2), (3), (4), (5) 또는 （1）, （2）, （3）, （4）, （5）
                    if re.match(r'^\s*[（(]\s*[1-5１２３４５]\s*[）)]', temp_det):
                        choice_count += 1
                        if choice_count >= 4:  # 4개 이상이면 선지로 간주
                            break
                    
                    temp_j += 1
                
                if choice_count >= 4:
                    # 일반 선지: (1), (2), (3), (4), (5) 형태
                    has_additional_content = True
                    in_additional_content = True
                    last_choice_line_index = j
                    last_additional_line_index = j
                    print(f"    [DEBUG] 선지 감지 (총 {choice_count}개): 줄 {j+1}: {safe_preview(det, 50)}...")
                else:
                    # 소문제: 3개 이하의 선택지
                    has_additional_content = True
                    in_additional_content = True
                    last_subquestion_line_index = j
                    last_additional_line_index = j
                    print(f"    [DEBUG] 소문제 감지 (총 {choice_count}개): 줄 {j+1}: {safe_preview(det, 50)}...")

        # 추가 내용 감지 5: 표
        # LaTeX 표 환경을 감지
        if TABLE_RX.match(det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 표 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        # 추가 내용 감지 6: 수식 환경
        # LaTeX 수식 환경을 감지
        if re.match(r"^(?:\\\[|\\\]|\\begin\{aligned\}|\\end\{aligned\}|&.*&)$", det):
            has_additional_content = True
            in_additional_content = True
            last_additional_line_index = j
            print(f"    [DEBUG] 수식 환경 감지: 줄 {j+1}: {safe_preview(det, 50)}...")

        # 추가 내용이 감지되면 상태를 업데이트
        if has_additional_content:
            in_additional_content = True

        # 추가 내용 상태에 있는 경우 계속 진행
        if in_additional_content:
            if det.strip():  # 빈 줄이 아닌 경우에만 마지막 인덱스 업데이트
                last_additional_line_index = j
            print(f"    [DEBUG] 추가 내용 상태 유지, 계속 진행: 줄 {j+1}")
            j += 1
            continue

        # 추가 내용이 아닌 일반 텍스트가 나오면 종료 판단
        if det.strip() and not has_additional_content:
            # 지금까지 모은 추가 내용이 있으면 마지막 추가 내용 줄을 종료줄로 사용
            candidates = [idx for idx in (last_choice_line_index, last_subquestion_line_index, last_additional_line_index) if idx is not None]
            if candidates:
                print(f"    [DEBUG] 추가 내용 발견, 마지막 추가 내용 줄을 종료줄로 사용: {max(candidates) + 1}")
                return max(candidates)
            # 추가 내용이 없으면 원래 종료 신호 줄을 종료줄로 사용
            print(f"    [DEBUG] 추가 내용 없음, 종료 신호 줄이 종료줄: {signal_line}")
            return signal_line - 1  # 종료 신호가 나온 줄 (0-based로 변환)

        # 디버그 출력: 현재 줄의 상태 정보
        print(f"    [DEBUG] 줄 {j+1}: has_content={has_additional_content}, in_content={in_additional_content}, det='{safe_preview(det, 30)}...'")
        j += 1

    # 루프 종료 후 최종 처리
    if last_additional_line_index is not None:
        # 추가 내용이 있었으면 마지막 추가 내용 줄을 종료줄로 사용
        print(f"    [DEBUG] 페이지 끝, 마지막 추가 내용 줄을 종료줄로 사용: {last_additional_line_index + 1}")
        return last_additional_line_index
    if in_additional_content:
        # 추가 내용 상태였으면 현재 위치의 이전 줄을 종료줄로 사용
        print(f"    [DEBUG] 페이지 끝, 추가 내용 상태에서 종료: {j}")
        return j - 1
    # 추가 내용이 없었으면 원래 종료 신호 줄을 종료줄로 사용
    print(f"    [DEBUG] 페이지 끝, 추가 내용 없음, 종료 신호 줄이 종료줄: {signal_line}")
    return signal_line - 1  # 종료 신호가 나온 줄 (0-based로 변환)

def find_start_lines():
    """
    문서에서 문항의 시작 줄들을 찾는 함수
    
    이 함수는 전체 문서를 한 줄씩 스캔하여 문항이 시작되는 지점들을 감지합니다.
    문항 시작 신호는 QUESTION_RX 정규식 패턴으로 정의된 다양한 형태의
    문항 번호나 유형 표시를 감지합니다.
    
    Returns:
        list: 시작 줄 정보들의 리스트
               각 항목은 {'page': int, 'line': int, 'content': str, 'normalized': str} 형태
        
    처리 과정:
    1. 입력 파일 존재 여부 확인
    2. 파일을 UTF-8로 읽어서 줄 단위로 분할
    3. 각 줄을 순차적으로 스캔
    4. 페이지 마크 감지 시 현재 페이지 업데이트
    5. 문항 시작 신호 감지 시 시작 줄 정보 저장
    6. 발견된 시작 줄들의 리스트 반환
    """
    input_file = Path("output/result.paged.filtered.mmd")
    
    # 입력 파일 존재 여부 확인
    if not input_file.exists():
        print(f"파일이 존재하지 않습니다: {input_file}")
        return []
    
    print("=== 시작 줄 찾기 ===")
    
    # 파일을 UTF-8로 읽어서 줄 단위로 분할
    # errors='ignore' 옵션으로 인코딩 오류가 있어도 무시하고 계속 진행
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    # 결과를 저장할 리스트와 상태 변수들
    start_lines = []  # 발견된 시작 줄들의 정보를 저장할 리스트
    current_page = 1  # 현재 페이지 번호 (페이지 마크가 없으면 1페이지로 가정)
    last_recorded_end_line = 0  # 마지막으로 기록된 종료 줄 (현재는 사용하지 않음)
    
    # 각 줄을 순차적으로 스캔 (1-based 인덱스로 시작)
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')  # 줄 끝의 개행 문자 제거
        det = norm_for_detection(line)  # 패턴 감지용으로 정규화
        
        # 페이지 마크 확인
        # "<<<PAGE 1>>>" 형태의 페이지 마크를 감지하여 현재 페이지 업데이트
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))  # 페이지 번호 추출
            print(f"[페이지] 페이지 {current_page}로 변경")
            continue  # 페이지 마크는 시작 줄이 아니므로 다음 줄로
        
        # 문항 시작 신호 확인
        # QUESTION_RX 패턴에 매치되는 줄을 문항 시작으로 인식
        if QUESTION_RX.match(det):
            # 시작 줄 정보를 딕셔너리 형태로 저장
            start_line_info = {
                'page': current_page,  # 현재 페이지 번호
                'line': i,  # 1-based 줄 번호
                'content': safe_preview(line, 100) + ('...' if len(line) > 100 else ''),  # 원본 내용 (100자 제한)
                'normalized': safe_preview(det, 100) + ('...' if len(det) > 100 else '')  # 정규화된 내용 (100자 제한)
            }
            start_lines.append(start_line_info)
            print(f"[시작줄] 페이지 {current_page}, 줄 {i}: {safe_preview(line, 80)}{'...' if len(line) > 80 else ''}")
    
    print(f"\n총 {len(start_lines)}개의 시작 줄 발견")
    return start_lines

def find_end_lines():
    """
    문서에서 문항의 종료 줄들을 찾는 함수
    
    이 함수는 전체 문서를 한 줄씩 스캔하여 문항이 끝나는 지점들을 감지합니다.
    종료 신호(예: "구하시오", "?" 등)를 찾은 후, find_actual_end_line 함수를
    호출하여 추가적인 내용들(선지, 보기, 표 등)을 고려한 실제 종료 줄을 결정합니다.
    
    Returns:
        list: 종료 줄 정보들의 리스트
               각 항목은 {'page': int, 'line': int, 'signal_line': int, 'content': str, 'normalized': str} 형태
        
    처리 과정:
    1. 입력 파일 존재 여부 확인
    2. 파일을 UTF-8로 읽어서 줄 단위로 분할
    3. 각 줄을 순차적으로 스캔
    4. 페이지 마크 감지 시 현재 페이지 업데이트
    5. 종료 신호 감지 시 find_actual_end_line 함수로 실제 종료 줄 결정
    6. 중복 처리 방지를 위해 이미 처리된 종료 줄은 건너뛰기
    7. 발견된 종료 줄들의 리스트 반환
    """
    input_file = Path("output/result.paged.filtered.mmd")
    
    # 입력 파일 존재 여부 확인
    if not input_file.exists():
        print(f"파일이 존재하지 않습니다: {input_file}")
        return []
    
    print("\n=== 종료 줄 찾기 ===")
    
    # 파일을 UTF-8로 읽어서 줄 단위로 분할
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    # 먼저 시작 줄과 종료 신호들을 수집 (탐색 범위 제한을 위해 필요)
    start_signals = []
    end_signals = []
    current_page = 1
    
    # 시작 줄과 종료 신호 수집
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')
        det = norm_for_detection(line)
        
        # 페이지 마크 확인
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))
            continue
        
        # 문항 시작 신호 확인
        if QUESTION_RX.match(det):
            start_signals.append({
                'page': current_page,
                'line': i
            })
        
        # 문항 종료 신호 확인 (이미지 링크 제외)
        if QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det):
            # 소문제와 같은 선택지 형태의 문장은 종료 신호로 사용하지 않음
            if not (CHOICE_LINE_RX.match(det) and not QUESTION_RX.match(det)):
                end_signals.append({
                    'page': current_page,
                    'line': i
                })
    
    print(f"수집 완료: 시작신호 {len(start_signals)}개, 종료신호 {len(end_signals)}개")
    
    # 결과를 저장할 리스트와 상태 변수들
    end_lines = []  # 발견된 종료 줄들의 정보를 저장할 리스트
    current_page = 1  # 현재 페이지 번호
    last_recorded_end_line = 0  # 마지막으로 기록된 종료 줄 (중복 처리 방지용)
    
    # 각 줄을 순차적으로 스캔 (1-based 인덱스로 시작)
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')  # 줄 끝의 개행 문자 제거
        det = norm_for_detection(line)  # 패턴 감지용으로 정규화
        
        # 페이지 마크 확인
        # "<<<PAGE 1>>>" 형태의 페이지 마크를 감지하여 현재 페이지 업데이트
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))  # 페이지 번호 추출
            print(f"[페이지] 페이지 {current_page}로 변경")
            continue  # 페이지 마크는 종료 줄이 아니므로 다음 줄로
        
        # 중복 처리 방지: 이미 처리된 종료 줄보다 이전인 경우 건너뛰기
        # 이는 같은 종료 신호가 여러 번 감지되는 것을 방지합니다
        if i <= last_recorded_end_line:
            continue

        # 문항 종료 신호 확인
        # QUESTION_END_RX 패턴에 매치되고 이미지 링크가 아닌 경우 종료 신호로 인식
        if QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det):
            # 소문제와 같은 선택지 형태의 문장은 종료 신호로 사용하지 않음
            # 예: "(1) 다음 중 옳은 것은?" 같은 경우는 종료 신호가 아님
            if CHOICE_LINE_RX.match(det) and not QUESTION_RX.match(det):
                print(f"[건너뛰기] 소문제 형태의 선택지, 종료 신호로 인식하지 않음: 줄 {i}")
                continue
                
            print(f"[종료신호] 페이지 {current_page}, 줄 {i}: {safe_preview(line, 80)}{'...' if len(line) > 80 else ''}")
            
            # 종료 신호 발견 시, 추가 조건들을 확인하여 실제 종료 줄 찾기
            # find_actual_end_line 함수가 핵심 로직을 담당합니다
            actual_end_line = find_actual_end_line(lines, i, current_page, start_signals, end_signals)
            
            # 종료 줄 정보를 딕셔너리 형태로 저장
            end_line_info = {
                'page': current_page,  # 현재 페이지 번호
                'line': actual_end_line + 1,  # 0-based를 1-based로 변환한 실제 종료 줄
                'signal_line': i,  # 원래 종료 신호가 발견된 줄
                'content': safe_preview(lines[actual_end_line], 100).rstrip('\n') + ('...' if len(lines[actual_end_line].rstrip('\n')) > 100 else ''),  # 실제 종료 줄의 내용
                'normalized': safe_preview(norm_for_detection(lines[actual_end_line]), 100) + ('...' if len(norm_for_detection(lines[actual_end_line])) > 100 else '')  # 정규화된 내용
            }
            end_lines.append(end_line_info)
            
            # 중복 처리 방지를 위해 마지막으로 기록된 종료 줄 업데이트
            last_recorded_end_line = max(last_recorded_end_line, actual_end_line + 1)
            print(f"[종료줄] 페이지 {current_page}, 줄 {actual_end_line + 1} (신호: {i}): {safe_preview(lines[actual_end_line], 80).rstrip()}{'...' if len(lines[actual_end_line].rstrip()) > 80 else ''}")
    
    print(f"\n총 {len(end_lines)}개의 종료 줄 발견")
    return end_lines

def calculate_problems_with_algorithm():
    """
    시작 줄과 종료 줄 정보를 바탕으로 문제 분할 알고리즘을 적용하는 핵심 함수
    
    이 함수는 발견된 시작 줄과 종료 줄 정보를 바탕으로 유한 상태 기계(Finite State Machine)
    알고리즘을 사용하여 문제들을 자동으로 분할합니다.
    
    알고리즘의 핵심 아이디어:
    - condition=0: 문제를 기다리는 상태 (시작 줄이나 종료 줄을 기다림)
    - condition=1: 문제가 시작된 상태 (종료 줄을 기다림)
    
    상태 전이 규칙:
    1. condition=0에서 시작줄 발견 → condition=1로 전이, 시작줄 기록
    2. condition=0에서 종료줄 발견 → 종료줄까지 1문제로 분할, condition=0 유지
    3. condition=1에서 시작줄 발견 → 이전 문제 종료 후 새 문제 시작, condition=1 유지
    4. condition=1에서 종료줄 발견 → 현재 문제 종료, condition=0으로 전이
    5. 시작줄=종료줄인 경우 → 즉시 1문제로 분할, condition=0으로 전이
    
    Returns:
        list: 분할된 문제들의 리스트
               각 항목은 (시작줄, 종료줄) 튜플 형태 (1-based 인덱스)
        
    처리 과정:
    1. 문서에서 시작 줄과 종료 줄 정보 수집
    2. 유한 상태 기계 알고리즘 적용
    3. 각 상태 전이에 따라 문제 분할 수행
    4. 분할된 문제들의 리스트 반환
    """
    input_file = Path("output/result.paged.filtered.mmd")
    
    # 입력 파일 존재 여부 확인
    if not input_file.exists():
        print(f"파일이 존재하지 않습니다: {input_file}")
        return []
    
    print("\n=== 알고리즘으로 문제 분할 계산 ===")
    
    # 파일을 UTF-8로 읽어서 줄 단위로 분할
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    # 시작 줄과 종료 줄 정보를 수집하는 단계
    print("1단계: 시작 줄과 종료 줄 정보 수집")
    start_lines = []  # 시작 줄 번호들을 저장할 리스트 (1-based)
    end_lines = []    # 종료 줄 번호들을 저장할 리스트 (1-based)
    current_page = 1  # 현재 페이지 번호
    
    # 각 줄을 순차적으로 스캔하여 시작/종료 신호 감지
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')
        det = norm_for_detection(line)
        
        # 페이지 마크 확인 및 페이지 번호 업데이트
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))
            continue
        
        # 문항 시작 신호 확인
        if QUESTION_RX.match(det):
            start_lines.append(i)
            print(f"  시작줄 발견: 줄 {i}")
        
        # 문항 종료 신호 확인 (이미지 링크 제외)
        if QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det):
            # 소문제 형태의 선택지는 종료 신호로 사용하지 않음
            if not (CHOICE_LINE_RX.match(det) and not QUESTION_RX.match(det)):
                # 종료 신호 발견 시, 추가 조건들을 확인하여 실제 종료 줄 찾기
                # start_signals와 end_signals를 빈 리스트로 전달 (이 단계에서는 아직 수집 중)
                actual_end_line = find_actual_end_line(lines, i, current_page, [], [])
                end_lines.append(actual_end_line + 1)  # 0-based를 1-based로 변환
                print(f"  종료줄 발견: 줄 {actual_end_line + 1} (신호: {i})")
    
    print(f"수집 완료: 시작줄 {len(start_lines)}개, 종료줄 {len(end_lines)}개")
    
    # 유한 상태 기계 알고리즘 적용 단계
    print("\n2단계: 유한 상태 기계 알고리즘 적용")
    print("알고리즘 설명:")
    print("- condition=0: 문제를 기다리는 상태")
    print("- condition=1: 문제가 시작된 상태 (종료줄을 기다림)")
    print("0번째 줄이 종료 줄이었다고 가정하고 시작")
    
    # 알고리즘 상태 변수들
    condition = 0  # 현재 상태 (0: 대기, 1: 문제 진행 중)
    last_end_line = 0  # 마지막 종료 줄 번호
    last_start_line = 0  # 마지막 시작 줄 번호
    problems = []  # 분할된 문제들을 저장할 리스트
    total_lines = len(lines)  # 전체 줄 수
    
    # 각 줄에 대해 상태 기계 알고리즘 적용
    for line_num in range(1, total_lines + 1):
        is_start = line_num in start_lines  # 현재 줄이 시작줄인지 확인
        is_end = line_num in end_lines      # 현재 줄이 종료줄인지 확인
        
        # 특수 케이스: 시작줄과 종료줄이 같은 줄인 경우
        # 이는 한 줄로 이루어진 문제를 의미합니다
        if is_start and is_end:
            print(f"  줄 {line_num}: 시작줄과 종료줄이 같은 줄, condition=0으로 변경")
            condition = 0
            # 해당 줄을 종료줄로 처리하여 1문제로 분할
            problem_range = (last_end_line + 1, line_num)
            problems.append(problem_range)
            print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (시작=종료줄 {line_num})")
            last_end_line = line_num
            continue
        
        # 상태 0: 문제를 기다리는 상태
        if condition == 0:
            if is_start:
                # 시작줄이 나오면 상태를 1로 전이하고 시작줄 기록
                print(f"  줄 {line_num}: 시작줄 발견, condition=1로 전이")
                last_start_line = line_num
                condition = 1
            elif is_end:
                # 종료줄이 나오면 마지막 종료줄+1부터 현재 종료줄까지 1문제로 분할
                print(f"  줄 {line_num}: 종료줄 발견, condition=0 유지")
                problem_range = (last_end_line + 1, line_num)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (종료줄 {line_num})")
                last_end_line = line_num
                condition = 0
                
        # 상태 1: 문제가 시작된 상태 (종료줄을 기다림)
        elif condition == 1:
            if is_start:
                # 새로운 시작줄이 나오면 이전 문제를 종료하고 새 문제 시작
                print(f"  줄 {line_num}: 새 시작줄 발견, 이전 문제 종료 후 새 문제 시작")
                problem_range = (last_start_line, line_num - 1)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (새 시작줄 {line_num} 전)")
                last_start_line = line_num
                condition = 1  # 새 문제가 시작되므로 상태 1 유지
            elif is_end:
                # 종료줄이 나오면 현재 문제를 종료하고 상태를 0으로 전이
                print(f"  줄 {line_num}: 종료줄 발견, 현재 문제 종료, condition=0으로 전이")
                problem_range = (last_start_line, line_num)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (시작줄 {last_start_line}~종료줄 {line_num})")
                last_end_line = line_num
                condition = 0
            elif line_num == total_lines:
                # 마지막 줄에 도달했고 아직 종료줄이 없으면 마지막 줄까지 1문제로 분할
                print(f"  줄 {line_num}: 마지막 줄 도달, 현재 문제 종료")
                problem_range = (last_start_line, line_num)
                problems.append(problem_range)
                print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (마지막 시작줄 {last_start_line}~마지막줄 {line_num})")
                last_end_line = line_num
                condition = 0
    
    # 마지막에 시작줄이 남아있는 경우 처리
    # 이는 문서 끝까지 종료줄이 없었던 경우를 처리합니다
    if condition == 1:
        print("3단계: 마지막 시작줄 처리")
        problem_range = (last_start_line, total_lines)
        problems.append(problem_range)
        print(f"  문제 {len(problems)}: 줄 {problem_range[0]}~{problem_range[1]} (마지막 시작줄 {last_start_line}~마지막줄 {total_lines})")
    
    print(f"\n총 {len(problems)}개 문제로 분할됨")
    return problems

def save_problems_to_json(problems):
    """
    분할된 문제들을 JSON 파일로 저장하는 함수
    
    이 함수는 calculate_problems_with_algorithm 함수에서 분할된 문제들을
    JSON 형태로 저장하여 후속 처리나 분석이 가능하도록 합니다.
    
    Args:
        problems (list): 분할된 문제들의 리스트
                         각 항목은 (시작줄, 종료줄) 튜플 형태
        
    처리 과정:
    1. 원본 문서를 다시 읽어서 문제 내용 추출
    2. 시작/종료 줄 정보를 다시 수집하여 페이지 정보 획득
    3. 각 문제의 내용을 추출하고 분류 정보 생성
    4. JSON 형태로 구조화하여 파일로 저장
    
    JSON 구조:
    {
        "id": 문제 번호,
        "classification": 분류 ("start-end", "start-start", "end-end", "unknown"),
        "content": [문제 내용의 줄들],
        "page": 페이지 번호
    }
    """
    input_file = Path("output/result.paged.filtered.mmd")
    
    # 입력 파일 존재 여부 확인
    if not input_file.exists():
        print(f"파일이 존재하지 않습니다: {input_file}")
        return
    
    print("\n=== 문제 분할 결과를 JSON으로 저장 ===")
    
    # 원본 문서를 다시 읽어서 문제 내용 추출을 위한 준비
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    # 시작 줄과 종료 줄 정보를 다시 수집 (페이지 정보 포함)
    # 이는 각 문제의 페이지 정보를 정확히 파악하기 위함입니다
    print("1단계: 시작/종료 줄 정보 재수집 (페이지 정보 포함)")
    start_lines = []  # 시작 줄 정보 (줄 번호와 페이지 번호 포함)
    end_lines = []    # 종료 줄 정보 (줄 번호와 페이지 번호 포함)
    current_page = 1  # 현재 페이지 번호
    
    for i, line in enumerate(lines, 1):
        line = line.rstrip('\n')
        det = norm_for_detection(line)
        
        # 페이지 마크 확인 및 페이지 번호 업데이트
        page_match = PAGE_MARK.match(det)
        if page_match:
            current_page = int(page_match.group(1))
            continue
        
        # 문항 시작 신호 확인
        if QUESTION_RX.match(det):
            start_lines.append({'line': i, 'page': current_page})
        
        # 문항 종료 신호 확인 (이미지 링크 제외)
        if QUESTION_END_RX.search(det) and not IMAGE_LINK_RX.search(det):
            # 소문제 형태의 선택지는 종료 신호로 사용하지 않음
            if not (CHOICE_LINE_RX.match(det) and not QUESTION_RX.match(det)):
                # 종료 신호 발견 시, 추가 조건들을 확인하여 실제 종료 줄 찾기
                # start_signals와 end_signals를 빈 리스트로 전달 (이 단계에서는 아직 수집 중)
                actual_end_line = find_actual_end_line(lines, i, current_page, [], [])
                end_lines.append({'line': actual_end_line + 1, 'page': current_page})
    
    print(f"수집 완료: 시작줄 {len(start_lines)}개, 종료줄 {len(end_lines)}개")
    
    # 각 문제의 내용을 추출하고 JSON 데이터로 변환
    print("2단계: 문제 내용 추출 및 JSON 데이터 생성")
    problems_data = []
    
    for i, (start_line, end_line) in enumerate(problems, 1):
        print(f"  문제 {i} 처리 중: 줄 {start_line}~{end_line}")
        
        # 문제 내용 추출 (1-based 인덱스를 0-based로 변환하여 추출)
        problem_content = []
        for line_idx in range(start_line - 1, end_line):  # 0-based 인덱스로 변환
            if 0 <= line_idx < len(lines):
                # 각 줄의 개행 문자를 제거하여 내용만 추출
                problem_content.append(lines[line_idx].rstrip('\n'))
        
        # 페이지 정보 찾기
        # 시작 줄의 페이지 정보를 찾아서 해당 문제의 페이지로 설정
        problem_page = None
        for start_info in start_lines:
            if start_info['line'] == start_line:
                problem_page = start_info['page']
                break
        
        # 문항 분류 신호 결정
        # 문제의 시작과 종료가 어떤 신호로 이루어졌는지에 따라 분류
        is_start_start = start_line in [s['line'] for s in start_lines]  # 시작줄로 시작하는지
        is_start_end = end_line in [e['line'] for e in end_lines]        # 종료줄로 끝나는지
        
        if is_start_start and is_start_end:
            classification = "start-end"    # 시작줄로 시작하고 종료줄로 끝남
        elif is_start_start:
            classification = "start-start"  # 시작줄로 시작하고 시작줄로 끝남 (다음 문제와 연결)
        elif is_start_end:
            classification = "end-end"      # 종료줄로 시작하고 종료줄로 끝남 (이전 문제와 연결)
        else:
            classification = "unknown"      # 분류 불가능한 경우
        
        # 문제 데이터를 딕셔너리 형태로 구성
        problem_data = {
            "id": i,                        # 문제 번호 (1부터 시작)
            "classification": classification, # 문제 분류
            "content": problem_content,     # 문제 내용 (줄 단위 리스트)
            "page": problem_page           # 페이지 번호
        }
        
        problems_data.append(problem_data)
        print(f"    분류: {classification}, 페이지: {problem_page}, 내용 길이: {len(problem_content)}줄")
    
    # JSON 파일로 저장
    print("3단계: JSON 파일로 저장")
    output_file = Path("output/problems.json")
    
    # ensure_ascii=False로 한글이 유니코드 이스케이프되지 않도록 설정
    # indent=2로 가독성 좋게 들여쓰기 적용
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(problems_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n문제 분할 결과가 {output_file}에 저장되었습니다.")
    print(f"총 {len(problems_data)}개 문제가 JSON 파일로 저장됨")
    
    # 저장된 파일의 크기 정보 출력
    file_size = output_file.stat().st_size
    print(f"파일 크기: {file_size:,} bytes ({file_size/1024:.1f} KB)")

# =============================================================================
# 메인 실행 함수 섹션
# =============================================================================

def main():
    """
    split2.py의 메인 실행 함수
    
    이 함수는 전체 문제 분할 프로세스를 순차적으로 실행합니다:
    1. 시작 줄 찾기
    2. 종료 줄 찾기  
    3. 알고리즘을 사용한 문제 분할
    4. JSON 파일로 결과 저장
    5. 결과 요약 및 상세 정보 출력
    
    전체 처리 흐름:
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │   시작 줄 찾기   │───▶│   종료 줄 찾기   │───▶│  문제 분할 알고리즘 │
    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                                           │
                                                           ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │   결과 요약 출력  │◀───│  JSON 파일 저장  │◀───│   분할된 문제들   │
    └─────────────────┘    └─────────────────┘    └─────────────────┘
    """
    print("=" * 80)
    print("시작 줄과 종료 줄을 독립적으로 찾아서 문제를 자동 분할하는 프로그램")
    print("=" * 80)
    
    # 1단계: 시작 줄 찾기
    print("\n[1단계] 문항의 시작 줄들을 찾는 중...")
    start_lines = find_start_lines()
    
    # 2단계: 종료 줄 찾기
    print("\n[2단계] 문항의 종료 줄들을 찾는 중...")
    end_lines = find_end_lines()
    
    # 3단계: 알고리즘을 사용한 문제 분할
    print("\n[3단계] 유한 상태 기계 알고리즘을 사용하여 문제를 분할하는 중...")
    problems = calculate_problems_with_algorithm()
    
    # 4단계: JSON 파일로 결과 저장
    if problems:
        print("\n[4단계] 분할된 문제들을 JSON 파일로 저장하는 중...")
        save_problems_to_json(problems)
    else:
        print("\n[4단계] 분할된 문제가 없어서 JSON 파일 저장을 건너뜁니다.")
    
    # 5단계: 결과 요약 및 상세 정보 출력
    print("\n" + "=" * 80)
    print("처리 완료 - 결과 요약")
    print("=" * 80)
    print(f"[통계] 통계 정보:")
    print(f"   - 시작 줄: {len(start_lines)}개")
    print(f"   - 종료 줄: {len(end_lines)}개")
    print(f"   - 분할된 문제: {len(problems)}개")
    
    # 시작 줄 상세 정보 출력
    if start_lines:
        print(f"\n[시작줄] 시작 줄 상세 정보 ({len(start_lines)}개):")
        for i, item in enumerate(start_lines, 1):
            print(f"   {i:2d}. 페이지 {item['page']:2d}, 줄 {item['line']:3d}: {item['content']}")
    else:
        print("\n[경고] 시작 줄이 발견되지 않았습니다.")
    
    # 종료 줄 상세 정보 출력
    if end_lines:
        print(f"\n[종료줄] 종료 줄 상세 정보 ({len(end_lines)}개):")
        for i, item in enumerate(end_lines, 1):
            print(f"   {i:2d}. 페이지 {item['page']:2d}, 줄 {item['line']:3d} (신호: {item['signal_line']:3d}): {item['content']}")
    else:
        print("\n[경고] 종료 줄이 발견되지 않았습니다.")
    
    # 분할된 문제 상세 정보 출력
    if problems:
        print(f"\n[문제] 분할된 문제 상세 정보 ({len(problems)}개):")
        for i, (start, end) in enumerate(problems, 1):
            print(f"   문제 {i:2d}: 줄 {start:3d}~{end:3d} (총 {end-start+1:2d}줄)")
    else:
        print("\n[경고] 분할된 문제가 없습니다.")
    
    # 최종 상태 출력
    print("\n" + "=" * 80)
    if problems:
        print("[성공] 문제 분할이 성공적으로 완료되었습니다!")
        print(f"   결과 파일: output/problems.json")
        print(f"   총 {len(problems)}개의 문제가 분할되어 저장되었습니다.")
    else:
        print("[실패] 문제 분할에 실패했습니다.")
        print("   시작 줄이나 종료 줄이 제대로 감지되지 않았을 수 있습니다.")
    print("=" * 80)

# =============================================================================
# 스크립트 실행 진입점
# =============================================================================

if __name__ == "__main__":
    """
    스크립트가 직접 실행될 때만 main() 함수를 호출합니다.
    
    이는 이 파일이 다른 모듈에서 import될 때는 main()이 실행되지 않고,
    직접 실행할 때만 실행되도록 하는 Python의 표준 관례입니다.
    """
    main()
