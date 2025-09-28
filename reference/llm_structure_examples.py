#!/usr/bin/env python3
"""
LLM Structure Script for Reference Examples
problems1.json과 problems2.json을 읽고 deepseek에 병렬로 보내서 구조화된 형태로 변환합니다.
"""

import json
import requests
from typing import List, Dict, Optional, Any
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import time


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


def save_problems_json(problems: List[Dict], file_path: str) -> None:
    """문제 리스트를 JSON 파일로 저장합니다."""
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(problems, f, ensure_ascii=False, indent=2)
        print(f"{len(problems)}개 문제를 저장했습니다: {file_path}")
    except Exception as e:
        print(f"저장 오류: {e}")


def call_llm_for_structure(problem: Dict) -> Optional[Dict]:
    """문제 하나를 deepseek에 보내서 구조화된 형태로 변환합니다."""

    # DeepSeek API 키 설정
    api_key = "sk-2cccd6ea60f44299b914271d7ea900f8"

    # 문제 내용 준비
    content_lines = problem.get('content', [])
    content_text = '\n'.join(content_lines)

    # classification이 "start-start"인 경우 필터링 체크 추가
    if problem.get('classification') == 'start-start':
        prompt = f"""이 내용이 수학 문제인지 확인하고 구조화하세요:

{content_text}

수학 문제가 아니면 {{"is_math_problem": false}} 반환
수학 문제면 다음 JSON 형식:
{{"id":{problem.get('id', 1)},"page":{problem.get('page', 'null')},"content_blocks":[{{"type":"text|examples|image|table","content":"내용"}}],"options":["선택지들"]}}"""
    else:
        prompt = f"""수학 문제를 JSON으로 구조화하세요:

{content_text}

JSON 형식:
{{"id":{problem.get('id', 1)},"page":{problem.get('page', 'null')},"content_blocks":[{{"type":"text|examples|image|table","content":"내용"}}],"options":["선택지들"]}}

중요 규칙:
- 실제 수학 문제 내용만 포함 (정답률, 출처, 메타데이터 제외)
- type: text=문제내용, examples=보기,조건리스트, image=이미지URL, table=표
- 선지는 options
- 노이즈 데이터 완전히 제거하고 순수 JSON만 반환"""

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

                structured_problem = json.loads(response_text)

                # start-start 항목의 필터링 처리
                if isinstance(structured_problem, dict):
                    if structured_problem.get('is_math_problem') == False:
                        print(f"수학 문제가 아님 (ID {problem.get('id')})")
                        return None
                    elif 'content_blocks' in structured_problem:
                        print(f"문제 {problem.get('id')} 구조화 완료")
                        return structured_problem
                    else:
                        print(f"잘못된 응답 형식: ID {problem.get('id')}")
                        return None
                else:
                    print(f"잘못된 응답 형식: ID {problem.get('id')}")
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
            try:
                result = future.result()
                if result:
                    structured_problems.append(result)
                    completed_count += 1
                    print(f"완료: {completed_count}/{len(problems)} - ID {problem.get('id')}")
                else:
                    failed_problems.append(problem)
                    print(f"구조화 실패: ID {problem.get('id')}")
            except Exception as e:
                failed_problems.append(problem)
                print(f"처리 중 예외 (ID {problem.get('id')}): {e}")

    end_time = time.time()
    elapsed_time = end_time - start_time

    print(f"구조화 완료: {len(structured_problems)}개 성공, {len(failed_problems)}개 실패")
    print(f"총 처리 시간: {elapsed_time:.2f}초 ({elapsed_time/60:.2f}분)")
    if len(structured_problems) > 0:
        print(f"문제당 평균 처리 시간: {elapsed_time/len(structured_problems):.2f}초")

    # ID로 정렬
    structured_problems.sort(key=lambda x: x.get('id', 0))

    return structured_problems


def process_file(input_file: str, output_file: str):
    """단일 파일을 처리합니다."""
    print(f"\n=== {input_file} 처리 시작 ===")
    
    # 입력 파일 존재 확인
    if not Path(input_file).exists():
        print(f"입력 파일이 존재하지 않습니다: {input_file}")
        return

    # 문제 로드
    problems = load_problems_json(input_file)
    if not problems:
        print("로드할 문제가 없습니다.")
        return

    print(f"로드된 문제 수: {len(problems)}개")

    # 문제 구조화 (병렬 처리)
    structured_problems = structure_problems_parallel(problems, max_workers=30)

    if not structured_problems:
        print("구조화된 문제가 없습니다.")
        return

    # 결과 저장
    save_problems_json(structured_problems, output_file)

    print(f"=== {input_file} 처리 완료 ===")
    print(f"  원본: {len(problems)}개")
    print(f"  구조화 완료: {len(structured_problems)}개")
    print(f"  실패: {len(problems) - len(structured_problems)}개")


def main():
    """메인 함수"""
    print("LLM Structure Script for Reference Examples 시작")
    total_start_time = time.time()

    # 처리할 파일들
    files_to_process = [
        ("problems1.json", "problems1_structured.json"),
        ("problems2.json", "problems2_structured.json")
    ]

    for input_file, output_file in files_to_process:
        process_file(input_file, output_file)

    total_end_time = time.time()
    total_elapsed_time = total_end_time - total_start_time

    print(f"\n전체 작업 완료!")
    print(f"전체 실행 시간: {total_elapsed_time:.2f}초 ({total_elapsed_time/60:.2f}분)")


if __name__ == "__main__":
    main()
