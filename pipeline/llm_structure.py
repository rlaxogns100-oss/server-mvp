#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LLM Structure Script
웹 서버 전용 - output/problems.json을 읽고 DeepSeek에 병렬로 보내서 MongoDB에 직접 저장
"""

import sys
import io

# UTF-8 인코딩 강제 설정 (Windows cp949 문제 해결)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

print("PY:", sys.executable, file=sys.stderr)

import json
import requests
from typing import List, Dict, Optional, Any
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import os
import re
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()


def load_problems_json(file_path: str) -> List[Dict]:
    """problems.json 파일을 로드합니다."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            problems = json.load(f)
        print(f"{len(problems)}개 문제를 로드했습니다.")
        return problems
    except FileNotFoundError:
        print(f"파일을 찾을 수 없습니다: {file_path}")
        return []
    except json.JSONDecodeError as e:
        print(f"JSON 파싱 오류: {e}")
        return []


def save_to_mongodb(problems: List[Dict], user_id: str, filename: str, parent_path: Optional[str] = None) -> bool:
    """문제 리스트를 MongoDB에 저장합니다."""
    try:
        # MongoDB 연결
        mongodb_uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/')
        mongodb_database = os.getenv('MONGODB_DATABASE', 'ZeroTyping')
        client = MongoClient(mongodb_uri)
        db = client[mongodb_database]

        # ObjectId 변환
        user_object_id = ObjectId(user_id)

        # 파일 정보 저장
        files_collection = db['files']
        file_doc = {
            'userId': user_object_id,
            'filename': filename,
            'parentPath': parent_path or '내 파일',  # 기본값: "내 파일"
            'problemCount': len(problems),
            'uploadDate': datetime.now()
        }

        file_result = files_collection.insert_one(file_doc)
        file_id = file_result.inserted_id
        print(f"[OK] 파일 정보 저장 완료: {file_id}")

        # 문제들 저장
        problems_collection = db['problems']
        problem_docs = []
        for problem in problems:
            doc = {
                'userId': user_object_id,
                'fileId': file_id,
                'id': problem.get('id'),
                'page': problem.get('page'),
                'content_blocks': problem.get('content_blocks', []),
                'options': problem.get('options', []),
                'createdAt': datetime.now()
            }
            problem_docs.append(doc)

        if problem_docs:
            problems_collection.insert_many(problem_docs)
            print(f"[OK] MongoDB에 {len(problem_docs)}개 문제 저장 완료")

        client.close()
        return True
    except Exception as e:
        print(f"[ERROR] MongoDB 저장 오류: {e}")
        return False


def call_llm_for_structure(problem: Dict) -> Optional[List[Dict]]:
    """문제 하나를 DeepSeek에 보내서 구조화된 형태로 변환합니다. 다중 문제인 경우 리스트 반환."""

    # DeepSeek API 키 설정
    api_key = os.getenv('DEEPSEEK_API_KEY')
    if not api_key:
        print("[ERROR] DEEPSEEK_API_KEY가 설정되지 않았습니다.")
        return None

    # 문제 내용 준비
    content_lines = problem.get('content', [])
    content_text = '\n'.join(content_lines)

    # 통합 프롬프트 (모든 문제에 동일 적용)
    prompt = f"""다음 내용을 분석하여 수학 문제를 추출하고 구조화하세요.

[입력 내용]
{content_text}

[1단계: 필터링]
다음에 해당하면 {{"filtered": true, "reason": "이유"}} 반환:
- 수학 문제가 아닌 경우: 목차, 표지, 안내문, 저작권 고지, 광고
- 메타데이터만 있는 경우: 정답률, 출처, 난이도, 페이지 번호 마크(<<<PAGE>>>)
- 불완전한 내용: 문제 번호만 있고 내용 없음, 의미 없는 단편 텍스트
- 노이즈: OCR 오류로 인한 깨진 문자열, 반복되는 무의미한 기호
- 섹션 헤더: ［서답형］, ［객관식］, ［주관식］, ［서답형1］, ［서답형2］, ［서답형3］, ［서답형4］, ［단답형］, ［서술형］, ［논술형］, ［문제］, ［정답］, ［해설］, ［1회차］, ［2회차］, ［A형］, ［B형］ 등
- 단일 단어/구문: 3글자 이하의 단독 텍스트, 특수문자로만 구성된 텍스트
- 특수문자만: ［］, （）, 【】, ※, ★, ● 등으로만 구성된 텍스트

[2단계: 문제 분할]
**⚠️ 중요: "다음 물음에 답하시오" 시그널 이후의 하위 문항은 절대 분할하지 말고 단일 문제의 한 형태로 취급하세요!**

두 개 이상의 독립적인 문제가 있으면 분할하여 배열로 반환:
- 분할 기준: 명확한 문제 번호 (1. 2. 3. / ①②③ / 단답형1, 단답형2 등)
- **절대 분할 금지**: "다음 물음에 답하시오" 시그널 이후의 (1), (2), (3) 형태 하위 문항들
- 단일 문제: 객체 하나 반환
- 다중 문제: [문제1, 문제2, ...] 배열 반환

[출력 형식]
# 필터링된 경우:
{{"filtered": true, "reason": "목차 페이지"}}

# 수학 문제인 경우 (단일):
{{"id":{problem.get('id', 1)},"page":{problem.get('page', 'null')},"content_blocks":[{{"type":"text|condition|image|table|sub_text|sub_condition|sub_image|sub_table","content":"내용"}}],"options":["선택지들"],"sub_options":["하위 문항 선택지들"]}}

# 수학 문제인 경우 (다중):
[{{"id":{problem.get('id', 1)},"page":{problem.get('page', 'null')},...}},{{"id":{problem.get('id', 1) + 1},...}}]

[content_blocks 규칙]
- "text": 문제 본문, 발문 (인라인 조건 포함)
- "condition": 줄바꿈 등을 통해 발문과 구분되게 제시되는 조건만
  예1: ㄱ, ㄴ, ㄷ 또는 (가), (나), (다) 형태로 나열된 조건들
  예2: "다음 조건을 만족시킬 때" 발문 후 별도로 제시된 조건 블록
  예3: <보기> 섹션의 ㄱ,ㄴ,ㄷ 항목들
  주의: 발문 내부의 (단, ...) 같은 인라인 조건은 text에 포함
- "image": 이미지 URL만 (마크다운 제거, 순수 URL만 반환. 예: "https://cdn.mathpix.com/...")
- "table": 표

[하위 문항 처리 규칙]
"다음 물음에 답하시오" 시그널 이후의 하위 문항이 있는 경우:
- "sub_text": 하위 문항의 발문 (예: "다음 중 옳은 것을 모두 고르시오")
- "sub_condition": 하위 문항의 조건들 (ㄱ, ㄴ, ㄷ 형태로 나열된 조건)
- "sub_image": 하위 문항 관련 이미지
- "sub_table": 하위 문항 관련 표
- "sub_options": 하위 문항의 선택지 (①~⑤ 형태)

**🚨 절대 중요**: "다음 물음에 답하시오" 시그널 이후의 (1), (2), (3) 형태 하위 문항이 있으면:
1. 절대로 분할하지 마세요!
2. 반드시 sub_text로 분류하세요!
3. 하나의 문제로 처리하세요!
4. ID는 하나만 사용하세요!
5. 시그널 이후 모든 하위 문항을 하나로 묶으세요!

[options 규칙]
- ①~⑤, (1)~(5) 형태의 객관식 선택지만
- 주관식은 빈 배열 []

[제외 대상]
정답률, 출처, 난이도, 메타데이터, 페이지 번호, 기타 문제가 아닌 모든 텍스트

순수 JSON만 반환하세요."""

    try:
        # DeepSeek API 호출
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 2000,
            "temperature": 0.1
        }

        response = requests.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers=headers,
            json=data,
            timeout=60
        )

        # UTF-8 인코딩 명시
        response.encoding = 'utf-8'

        if response.status_code == 200:
            result = response.json()
            response_text = result['choices'][0]['message']['content'].strip()

            try:
                # ```json 태그 제거 및 JSON 파싱
                if response_text.startswith("```json"):
                    response_text = response_text[7:]
                if response_text.endswith("```"):
                    response_text = response_text[:-3]
                response_text = response_text.strip()

                # LaTeX 백슬래시 이스케이프 처리 (json.loads 전)
                # \alpha → \\alpha, \frac → \\frac 등
                # 단, \n, \t, \", \\는 제외 (이미 JSON 이스케이프)
                def escape_latex_backslashes(text):
                    """JSON 문자열 내부의 LaTeX 백슬래시를 이중 백슬래시로 변환"""
                    result = []
                    i = 0
                    in_string = False
                    escape_next = False

                    while i < len(text):
                        char = text[i]

                        # 문자열 시작/종료 추적
                        if char == '"' and not escape_next:
                            in_string = not in_string
                            result.append(char)
                            i += 1
                            continue

                        # 문자열 내부에서 백슬래시 처리
                        if in_string and char == '\\' and not escape_next:
                            # 다음 문자 확인
                            if i + 1 < len(text):
                                next_char = text[i + 1]
                                # JSON 이스케이프 문자인지 확인
                                # 단, 다음이 'rac' (frac), 'eft' (left), 'ight' (right) 등 LaTeX 명령어인지도 확인
                                remaining = text[i+1:i+10]  # 앞으로 최대 9글자 확인

                                # JSON 이스케이프 vs LaTeX 명령어 구분
                                is_json_escape = False
                                if next_char == '"' or next_char == '\\' or next_char == '/':
                                    is_json_escape = True
                                elif next_char == 'n' and not remaining.startswith('n '):  # \n (개행)
                                    # LaTeX에서 \n은 거의 없음, 주로 JSON 개행
                                    is_json_escape = True
                                elif next_char == 't' and not (remaining.startswith('text') or remaining.startswith('times')):
                                    # \t (탭), LaTeX \text, \times는 제외
                                    is_json_escape = True
                                elif next_char in ('b', 'f', 'r', 'u'):
                                    # \b, \f, \r, \uXXXX (JSON 이스케이프)
                                    # 단, LaTeX \frac, \alpha 등과 충돌 가능
                                    # LaTeX 명령어 패턴 확인: 백슬래시 + 소문자 연속
                                    if next_char == 'f' and remaining.startswith('frac'):
                                        is_json_escape = False  # LaTeX \frac
                                    elif len(remaining) > 1 and remaining[1].isalpha():
                                        is_json_escape = False  # LaTeX 명령어 (연속된 알파벳)
                                    else:
                                        is_json_escape = True

                                if is_json_escape:
                                    result.append(char)
                                    escape_next = True
                                else:
                                    # LaTeX 명령어: 백슬래시 이중화
                                    result.append('\\\\')
                            else:
                                result.append(char)
                        else:
                            result.append(char)
                            escape_next = False

                        i += 1

                    return ''.join(result)

                response_text = escape_latex_backslashes(response_text)

                parsed = json.loads(response_text)

                # LaTeX 수식 후처리: tabular → array 변환 (KaTeX 호환)
                def post_process_latex(obj):
                    """재귀적으로 모든 문자열 필드에서 LaTeX tabular → array 변환"""
                    if isinstance(obj, dict):
                        for key, value in obj.items():
                            if isinstance(value, str):
                                # tabular 환경을 array로 변환
                                value = value.replace(r'\begin{tabular}', r'\begin{array}')
                                value = value.replace(r'\end{tabular}', r'\end{array}')

                                # 세로선 제거: {|c|c|} → {cc}, {lrc} 유지
                                value = re.sub(r'\{[\|]*([lrc]+)[\|]*\}', r'{\1}', value)

                                # cline 제거 (array 미지원)
                                value = re.sub(r'\\cline\{[^}]+\}', '', value)

                                # table 타입인 경우: 내부 $ 기호 제거
                                if obj.get('type') == 'table' and key == 'content':
                                    # array 환경 내부의 $ 제거
                                    def remove_dollars_in_array(match):
                                        array_content = match.group(0)
                                        array_content = array_content.replace('$', '')
                                        return array_content

                                    value = re.sub(
                                        r'\\begin\{array\}.*?\\end\{array\}',
                                        remove_dollars_in_array,
                                        value,
                                        flags=re.DOTALL
                                    )

                                obj[key] = value
                            elif isinstance(value, (dict, list)):
                                post_process_latex(value)
                    elif isinstance(obj, list):
                        for item in obj:
                            post_process_latex(item)
                    return obj

                parsed = post_process_latex(parsed)

                # 필터링된 경우
                if isinstance(parsed, dict) and parsed.get('filtered') == True:
                    print(f"필터링됨 (ID {problem.get('id')}): {parsed.get('reason', '이유 없음')}")
                    return None

                # 다중 문제인 경우 (배열)
                if isinstance(parsed, list):
                    print(f"다중 문제 감지 (ID {problem.get('id')}): {len(parsed)}개로 분할됨")
                    valid_problems = []
                    for idx, p in enumerate(parsed):
                        if isinstance(p, dict) and 'content_blocks' in p:
                            valid_problems.append(p)
                        else:
                            print(f"  문제 {idx+1} 형식 오류, 건너뜀")

                    if valid_problems:
                        return valid_problems
                    else:
                        print(f"  유효한 문제 없음")
                        return None

                # 단일 문제인 경우
                if isinstance(parsed, dict) and 'content_blocks' in parsed:
                    print(f"문제 {problem.get('id')} 구조화 완료")
                    return [parsed]  # 단일 문제도 리스트로 반환하여 일관성 유지

                print(f"잘못된 응답 형식 (ID {problem.get('id')})")
                return None

            except json.JSONDecodeError as e:
                print(f"JSON 파싱 오류 (ID {problem.get('id')}): {e}")
                print(f"응답: {response_text[:100]}...")
                return None

        else:
            print(f"API 호출 실패 (ID {problem.get('id')}): {response.status_code}")
            return None

    except Exception as e:
        print(f"LLM 호출 중 오류 (ID {problem.get('id')}): {e}")
        return None


def structure_problems_parallel(problems: List[Dict], max_workers: int = 30) -> List[Dict]:
    """문제들을 병렬로 구조화합니다."""
    print(f"{len(problems)}개 문제를 {max_workers}개 스레드로 병렬 처리 중...")
    start_time = time.time()

    structured_problems = []
    failed_problems = []
    failed_problem_ids = []  # 탈락한 문제 ID 추적

    # 병렬 처리
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 모든 문제에 대해 LLM 호출 시작
        future_to_problem = {
            executor.submit(call_llm_for_structure, problem): problem
            for problem in problems
        }

        # 완료된 작업들 처리
        completed_count = 0
        for future in as_completed(future_to_problem):
            problem = future_to_problem[future]
            original_id = problem.get('id')

            try:
                result = future.result()
                if result:
                    # result는 항상 리스트 (단일 문제도 [문제] 형태)
                    if isinstance(result, list):
                        structured_problems.extend(result)
                        completed_count += len(result)
                        print(f"Processing problem {completed_count}/{len(problems)}")
                        print(f"완료: {completed_count}/{len(problems)} - ID {original_id} ({len(result)}개 문제)")
                    else:
                        # 예외 처리: 혹시 단일 dict로 반환된 경우
                        structured_problems.append(result)
                        completed_count += 1
                        print(f"완료: {completed_count}/{len(problems)} - ID {original_id}")
                else:
                    failed_problems.append(problem)
                    failed_problem_ids.append(original_id)
                    print(f"구조화 실패: ID {original_id}")
            except Exception as e:
                failed_problems.append(problem)
                failed_problem_ids.append(original_id)
                print(f"처리 중 예외 (ID {original_id}): {e}")

    end_time = time.time()
    elapsed_time = end_time - start_time

    print(f"\n구조화 완료: {len(structured_problems)}개 성공, {len(failed_problems)}개 실패")
    print(f"총 처리 시간: {elapsed_time:.2f}초 ({elapsed_time/60:.2f}분)")
    if len(structured_problems) > 0:
        print(f"문제당 평균 처리 시간: {elapsed_time/len(structured_problems):.2f}초")

    # 탈락한 문제 ID 출력
    if failed_problem_ids:
        print(f"\n❌ 탈락한 문제 ID: {sorted(failed_problem_ids)}")
    else:
        print(f"\n✅ 모든 문제 구조화 성공!")

    # ID로 정렬 (문자열/숫자 혼합 대응)
    def safe_sort_key(x):
        id_val = x.get('id', 0)
        try:
            return (0, int(id_val))
        except (ValueError, TypeError):
            return (1, str(id_val))

    structured_problems.sort(key=safe_sort_key)

    return structured_problems


def find_sample_dirs():
    """history 폴더에서 샘플 폴더들을 찾기"""
    history_dir = Path("history")
    if not history_dir.exists():
        return []

    sample_dirs = []
    for sample_dir in history_dir.iterdir():
        if sample_dir.is_dir() and sample_dir.name.startswith("sample"):
            # problems.json 파일이 있는지 확인
            if (sample_dir / "problems.json").exists():
                sample_dirs.append(sample_dir)

    # 샘플 이름의 숫자 기준으로 정렬
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
        problems_file = sample_dir / "problems.json"
        print(f"  {idx}. {sample_dir.name} ({problems_file.name})")
    print("=" * 50)

    while True:
        try:
            choice = input("\n선택할 샘플 번호를 입력하세요 (0=종료): ").strip()
            if choice == '0':
                print("종료합니다.")
                sys.exit(0)

            choice_num = int(choice)
            if 1 <= choice_num <= len(sample_dirs):
                selected = sample_dirs[choice_num - 1]
                print(f"✅ '{selected.name}' 선택됨\n")
                return selected
            else:
                print(f"⚠️ 1~{len(sample_dirs)} 사이의 번호를 입력하세요.")
        except ValueError:
            print("⚠️ 숫자를 입력하세요.")
        except KeyboardInterrupt:
            print("\n\n종료합니다.")
            sys.exit(0)


def main():
    """메인 함수 - 테스트 모드"""
    print("LLM Structure Script 시작 (테스트 모드)")
    total_start_time = time.time()

    # 하드코딩된 사용자 정보
    user_id = "68dc0958ae87ae4a4885212b"  # 김태훈 선생님 ID
    parent_path = "내 파일"  # 기본 폴더

    # 대화형 샘플 선택
    selected_sample = select_sample_interactive()

    # 파일 경로 설정
    input_file = selected_sample / "problems.json"
    filename = f"{selected_sample.name}.json"

    # 입력 파일 존재 확인
    if not input_file.exists():
        print(f"입력 파일이 존재하지 않습니다: {input_file}")
        return

    # 문제 로드
    problems = load_problems_json(str(input_file))
    if not problems:
        print("로드할 문제가 없습니다.")
        return

    print(f"로드된 문제 수: {len(problems)}개")
    print(f"사용자 ID: {user_id}")
    print(f"파일명: {filename}")
    print(f"폴더 경로: {parent_path}")

    # 문제 구조화 (병렬 처리)
    structured_problems = structure_problems_parallel(problems, max_workers=30)

    if not structured_problems:
        print("구조화된 문제가 없습니다.")
        return

    # MongoDB에 저장
    save_success = save_to_mongodb(structured_problems, user_id, filename, parent_path)

    total_end_time = time.time()
    total_elapsed_time = total_end_time - total_start_time

    print(f"\n전체 작업 완료!")
    print(f"  원본: {len(problems)}개")
    print(f"  구조화 완료: {len(structured_problems)}개")
    print(f"  실패: {len(problems) - len(structured_problems)}개")
    print(f"  MongoDB 저장: {'성공' if save_success else '실패'}")
    print(f"  전체 실행 시간: {total_elapsed_time:.2f}초 ({total_elapsed_time/60:.2f}분)")


if __name__ == "__main__":
    main()
