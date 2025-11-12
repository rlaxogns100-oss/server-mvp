#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
터미널에서 파일을 선택해 바로 PDF를 생성하는 로컬 테스트 스크립트
- JSON 파일: 문제 리스트를 직접 읽어 PDF 생성
- TXT 파일: 한 줄당 하나의 MongoDB 문제 ID를 읽어 DB에서 조회 후 PDF 생성
"""

import sys
import io
import os
import json
from pathlib import Path
import argparse

# Windows 콘솔 인코딩 문제 완화
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def _import_make_pdf_module():
    """pipeline/make_pdf.py를 모듈로 로드"""
    import importlib.util
    here = Path(__file__).resolve().parent
    target = here / "make_pdf.py"
    spec = importlib.util.spec_from_file_location("make_pdf_mod", str(target))
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def _choose_file_via_dialog(title: str, patterns: tuple[str, ...]):
    """가능하면 파일 대화상자를 띄우고, 실패 시 입력 프롬프트로 대체"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        filetypes = [("지원 파일", " ".join(patterns))]
        path = filedialog.askopenfilename(title=title, filetypes=filetypes)
        root.destroy()
        if path:
            return path
    except Exception:
        pass
    return input(f"파일 경로를 입력하세요 ({', '.join(patterns)}): ").strip().strip('"')


def _load_problems_from_json(json_path: Path):
    """JSON에서 문제 목록 로드: 배열이거나 {'problems': [...]} 형식 모두 허용"""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("problems", "items", "data"):
            if isinstance(data.get(key), list):
                return list(data[key])
        raise ValueError("JSON에서 문제 배열을 찾을 수 없습니다 (problems/items/data 키 확인).")
    if isinstance(data, list):
        return list(data)
    raise ValueError("지원하지 않는 JSON 형식입니다 (리스트 또는 problems 키 필요).")


def _load_ids_from_txt(txt_path: Path):
    """TXT에서 문제 ID 목록 로드 (공백/주석 제외)"""
    ids = []
    for line in txt_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("//"):
            continue
        ids.append(s)
    if not ids:
        raise ValueError("TXT에서 문제 ID를 찾지 못했습니다.")
    return ids


def _fetch_problems_from_mongo(ids: list[str], mongodb_uri: str, mongodb_db: str):
    """MongoDB에서 문제 문서를 조회"""
    try:
        from pymongo import MongoClient
        from bson import ObjectId
    except Exception as e:
        raise RuntimeError("pymongo 또는 bson 패키지가 필요합니다. (pip install pymongo)") from e

    client = MongoClient(mongodb_uri)
    db = client[mongodb_db]
    problems = []
    for pid in ids:
        try:
            doc = db.problems.find_one({"_id": ObjectId(pid)})
        except Exception:
            doc = None
        if doc:
            # files 컬렉션에서 filename 보강
            try:
                file_id_val = doc.get('fileid') or doc.get('file_id') or doc.get('fileId') or doc.get('source_file_id')
                filename_val = None
                if file_id_val:
                    try:
                        fid = ObjectId(str(file_id_val))
                        fdoc = db.files.find_one({"_id": fid})
                        if fdoc:
                            filename_val = fdoc.get('filename') or fdoc.get('name') or fdoc.get('originalname')
                    except Exception:
                        pass
                if filename_val:
                    doc['file'] = filename_val
            except Exception:
                pass
            problems.append(doc)
        else:
            print(f"[WARN] 문제 없음: {pid}")
    client.close()
    if not problems:
        raise RuntimeError("조회된 문제가 없습니다.")
    return problems


def _build_with_module(mod, problems: list[dict], answers_mode: str):
    """make_pdf 모듈 기능을 사용해 tex 생성 및 PDF 빌드"""
    mod.BUILD.mkdir(parents=True, exist_ok=True)
    mod.IMGDIR.mkdir(parents=True, exist_ok=True)

    tex_path = mod.BUILD / "exam.tex"
    parts: list[str] = []
    parts.append(mod.preamble_before_document())
    parts.append(mod.firstpage_big_header())

    show_meta = os.getenv('SHOW_META', '0') == '1'
    for i, problem in enumerate(problems, 1):
        parts.append(mod.problem_to_tex(problem, idx=i, show_meta=show_meta))

    parts.append(mod.tail_close_lists())

    answers = []
    if answers_mode == "answers-only":
        print("=" * 60)
        print("정답 페이지 생성 시작 (answers-only 모드)")
        print("=" * 60)
        answers = mod.fetch_answers_via_llm(problems)
        if answers:
            parts.append(mod.answers_page_tex(answers))
        else:
            print("[WARN] 정답 생성 실패 또는 비어 있음")

    parts.append(r"\end{document}")
    tex_path.write_text("\n".join(parts), encoding="utf-8")
    print(f"LaTeX 파일 생성: {tex_path}")
    mod.build_pdf(tex_path)

    if answers:
        print("\n" + "=" * 60)
        print("📝 생성된 정답 목록")
        print("=" * 60)
        for ans_item in answers:
            ans_id = ans_item.get('id', '?')
            ans_val = ans_item.get('answer', 'N/A')
            print(f"문항 {ans_id}: {ans_val}")
        print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="로컬에서 파일 선택으로 PDF 생성 테스트")
    parser.add_argument("--file", "-f", type=str, help="입력 파일 경로 (.json 또는 .txt)")
    parser.add_argument("--answers", action="store_true", help="LLM을 사용해 정답 페이지 생성")
    parser.add_argument("--nogui", action="store_true", help="파일 대화상자 없이 경로 입력")
    parser.add_argument("--mongo", action="store_true", help="TXT가 아니라도 강제로 MongoDB 모드 사용")
    args = parser.parse_args()

    mod = _import_make_pdf_module()

    answers_mode = "answers-only" if args.answers else "none"
    if answers_mode == "answers-only":
        os.environ['ANSWERS_MODE'] = 'answers-only'

    in_path = Path(args.file) if args.file else None
    if not in_path:
        if args.nogui:
            chosen = input("입력 파일 경로를 입력하세요 (.json / .txt): ").strip().strip('"')
        else:
            chosen = _choose_file_via_dialog("입력 파일 선택 (.json 또는 .txt)", (".json", ".txt"))
        in_path = Path(chosen) if chosen else None

    if not in_path:
        print("입력 파일이 선택되지 않았습니다.")
        sys.exit(1)
    if not in_path.exists():
        print(f"입력 파일이 존재하지 않습니다: {in_path}")
        sys.exit(1)

    problems: list[dict]
    if in_path.suffix.lower() == ".json" and not args.mongo:
        problems = _load_problems_from_json(in_path)
        print(f"JSON 문제 로드: {len(problems)}개")
    else:
        ids = _load_ids_from_txt(in_path) if in_path.suffix.lower() == ".txt" or args.mongo else _load_ids_from_txt(in_path)
        mongodb_uri = os.getenv('MONGODB_URI')
        mongodb_db = os.getenv('MONGODB_DATABASE', 'ZeroTyping')
        if not mongodb_uri:
            print("MONGODB_URI가 설정되지 않았습니다 (.env 필요).")
            sys.exit(1)
        problems = _fetch_problems_from_mongo(ids, mongodb_uri, mongodb_db)
        print(f"MongoDB 문제 로드: {len(problems)}개")

    _build_with_module(mod, problems, answers_mode)


if __name__ == "__main__":
    main()



