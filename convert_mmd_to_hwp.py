#!/usr/bin/env python3
from __future__ import annotations

import sys
import io
import re
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional

# Console UTF-8 on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Third-party
from py_asciimath.translator.translator import Tex2ASCIIMath, ASCIIMath2MathML
from pyhwpx import Hwp
try:
    # Prefer latex2mathml for robust LaTeX→MathML conversion
    from latex2mathml.converter import convert as latex_to_mathml  # type: ignore
except Exception:
    latex_to_mathml = None  # type: ignore

try:
    import win32com.client  # type: ignore
except Exception:
    win32com = None  # type: ignore

import ctypes
from ctypes import wintypes
import subprocess
import tempfile


def has_korean(s: str) -> bool:
    return re.search(r"[\uac00-\ud7a3]", s) is not None

def to_short_path(path: Path) -> str:
    """Return Windows 8.3 short path if available (helps HWP with unicode paths)."""
    try:
        GetShortPathNameW = ctypes.windll.kernel32.GetShortPathNameW
        GetShortPathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        GetShortPathNameW.restype = wintypes.DWORD
        buffer = ctypes.create_unicode_buffer(260)
        r = GetShortPathNameW(str(path), buffer, 260)
        return buffer.value if r > 0 else str(path)
    except Exception:
        return str(path)


_block_dollars = re.compile(r"\$\$(.*?)\$\$", re.DOTALL)
_block_brackets = re.compile(r"\\\[(.*?)\\\]", re.DOTALL)
_inline_dollar = re.compile(r"(?<!\$)\$(.+?)\$(?!\$)", re.DOTALL)
_inline_paren = re.compile(r"\\\((.*?)\\\)", re.DOTALL)
_env_block = re.compile(
    r"\\begin\{(equation\*?|align\*?|aligned|gather\*?|eqnarray\*?)\}(.*?)\\end\{\1\}",
    re.DOTALL | re.IGNORECASE,
)
_page_marker = re.compile(r"^\s*<<<PAGE\s+\d+\s*>>>", re.MULTILINE)


def split_text_and_math_block(text: str) -> List[Tuple[str, str]]:
    """Split one block of text into ('text'|'math') segments. Supports $$ $$, \\[ \\], \\( \\), $ $, and common math envs."""
    segments: List[Tuple[str, str]] = []
    cursor = 0
    length = len(text)

    def append_text(s: str) -> None:
        if not s:
            return
        segments.append(("text", s))

    patterns = [
        ("$$", _block_dollars),
        ("\\[\\]", _block_brackets),
        ("\\(\\)", _inline_paren),
        ("env", _env_block),
        ("$", _inline_dollar),
    ]

    while cursor < length:
        next_candidates: List[Tuple[int, str, re.Match]] = []
        for tag, pat in patterns:
            m = pat.search(text, cursor)
            if m:
                next_candidates.append((m.start(), tag, m))
        if not next_candidates:
            append_text(text[cursor:])
            break
        next_candidates.sort(key=lambda x: x[0])
        start, tag, match = next_candidates[0]
        append_text(text[cursor:start])
        if tag == "env":
            math_src = match.group(2)
        else:
            math_src = match.group(1)
        segments.append(("math", math_src.strip()))
        cursor = match.end()
    return segments


def split_text_and_math_with_pages(text: str) -> List[Tuple[str, str]]:
    """
    Split by page markers (<<<PAGE N>>>) but keep each page as a whole block so
    multi-line 수식도 제대로 매칭되도록 처리.
    """
    segments: List[Tuple[str, str]] = []
    parts = _page_marker.split(text)
    # _page_marker.split drops the markers; we add pagebreak before each non-empty part except the first if it's empty
    for idx, part in enumerate(parts):
        if part is None or part == "":
            continue
        if idx > 0:
            segments.append(("pagebreak", ""))
        segments.extend(split_text_and_math_block(part))
    return segments


def tex_to_mathml_via_pandoc(tex: str) -> Optional[str]:
    """
    Convert a single LaTeX math expression to MathML using pandoc.
    Returns MathML string or None.
    """
    try:
        with tempfile.TemporaryDirectory() as td:
            md = Path(td) / "snippet.md"
            html = Path(td) / "out.html"
            # Use display math to avoid inline wrapping quirks
            md.write_text(f"$$\n{tex}\n$$\n", encoding="utf-8")
            args = [
                "pandoc",
                "--from", "markdown+tex_math_dollars+tex_math_single_backslash",
                "--to", "html",
                "--standalone",
                "--mathml",
                "-o", str(html),
                str(md),
            ]
            subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            content = html.read_text(encoding="utf-8", errors="ignore")
            m = re.search(r"<math[\\s\\S]*?</math>", content, re.IGNORECASE)
            if m:
                return m.group(0)
            return None
    except Exception:
        return None


def insert_text_via_com(hwp_com, text: str) -> None:
    """
    Insert plain text at the caret via COM. Preserves newlines.
    """
    if not text:
        return
    # HWP InsertText action
    p = hwp_com.HParameterSet.HInsertText
    hwp_com.HAction.GetDefault("InsertText", p.HSet)
    p.Text = text
    hwp_com.HAction.Execute("InsertText", p.HSet)


def save_as_hwpx(hwp_obj: Hwp, hwp_com, out_path: Path) -> bool:
    """Try save via pyhwpx then COM fallback."""
    # pyhwpx convenience
    try:
        if hasattr(hwp_obj, "save_as"):
            hwp_obj.save_as(str(out_path))
            return True
    except Exception:
        pass
    # COM fallback
    try:
        p = hwp_com.HParameterSet.HFileOpenSave
        hwp_com.HAction.GetDefault("FileSaveAs_S", p.HSet)
        p.Filename = to_short_path(out_path)
        p.Format = "HWPX"
        ok = bool(hwp_com.HAction.Execute("FileSaveAs_S", p.HSet))
        return ok
    except Exception:
        return False


def convert_mmd_to_hwpx(mmd_path: Path, out_hwpx: Path) -> Path:
    # Load source
    text = mmd_path.read_text(encoding="utf-8")
    # Build segments
    segments = split_text_and_math_with_pages(text)

    # Set up converters
    tex2asc = Tex2ASCIIMath(log=False, inplace=True)
    asc2mml = ASCIIMath2MathML(log=False, inplace=True)

    # Open HWP via pyhwpx
    hwp = Hwp()
    # Try to expose COM object (pyhwpx keeps it on .hwp or ._hwp commonly)
    hwp_com = getattr(hwp, "hwp", None) or getattr(hwp, "_hwp", None)
    if hwp_com is None and win32com is not None:
        # Fallback: attach directly (new instance)
        hwp_com = win32com.client.Dispatch("HWPFrame.HwpObject")
        try:
            hwp_com.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:
            pass

    tmp_dir = out_hwpx.parent
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # Process segments
    failed_equations: List[str] = []
    for kind, content in segments:
        if kind == "pagebreak":
            if hwp_com is not None:
                try:
                    hwp_com.HAction.Run("BreakPage")
                except Exception:
                    pass
            continue
        elif kind == "text":
            if hwp_com is not None:
                insert_text_via_com(hwp_com, content)
                # If Korean text exists, end the paragraph to avoid mixing with equations
                if has_korean(content):
                    try:
                        hwp_com.HAction.Run("BreakPara")
                    except Exception:
                        pass
            else:
                # Best-effort: pyhwpx may expose insert_text
                if hasattr(hwp, "insert_text"):
                    getattr(hwp, "insert_text")(content)
        else:  # math
            try:
                # Prefer pandoc (LaTeX -> MathML) for robustness
                mml_eq: Optional[str] = tex_to_mathml_via_pandoc(content)

                # Fallback 1: direct LaTeX -> MathML library
                if not mml_eq and latex_to_mathml is not None:
                    try:
                        mml_eq = latex_to_mathml(content)
                    except Exception:
                        mml_eq = None

                # Fallback 2: ASCIIMath(strict, with validation)
                if not mml_eq:
                    try:
                        asc_eq = tex2asc.translate(content, from_file=False, pprint=False)
                        if asc_eq and str(asc_eq).strip().upper() != "NULL":
                            mml_eq = asc2mml.translate(
                                asc_eq,
                                displaystyle=True,
                                dtd="mathml2",
                                dtd_validation=True,
                                from_file=False,
                                output="string",
                                network=False,
                                pprint=False,
                                to_file=None,
                                xml_declaration=True,
                                xml_pprint=True,
                            )
                    except Exception:
                        mml_eq = None

                # Fallback 3: ASCIIMath (permissive, no DTD)
                if not mml_eq:
                    try:
                        asc_eq = tex2asc.translate(content, from_file=False, pprint=False)
                        if asc_eq and str(asc_eq).strip().upper() != "NULL":
                            mml_eq = asc2mml.translate(
                                asc_eq,
                                displaystyle=True,
                                dtd=None,
                                dtd_validation=False,
                                from_file=False,
                                output="string",
                                network=False,
                                pprint=False,
                                to_file=None,
                                xml_declaration=True,
                                xml_pprint=True,
                            )
                    except Exception:
                        mml_eq = None

                if not mml_eq:
                    raise RuntimeError("MATH_CONVERSION_FAILED")

                # 3) Write temp mml and import
                # Ensure math is isolated on its own paragraph to avoid conflicts with preceding/trailing Korean text
                if hwp_com is not None:
                    try:
                        hwp_com.HAction.Run("BreakPara")
                    except Exception:
                        pass
                tmp_mml = tmp_dir / "mml_eq_tmp.mml"
                tmp_mml.write_text(mml_eq, encoding="utf-8")
                hwp.import_mathml(to_short_path(tmp_mml))
                if hwp_com is not None:
                    try:
                        hwp_com.HAction.Run("BreakPara")
                    except Exception:
                        pass
            except Exception:
                # Don't insert as plain text; record failure and continue.
                failed_equations.append(content)
        # For plain text segments, keep original flow; avoid forced break here

    # Save
    ok = False
    if hwp_com is not None:
        ok = save_as_hwpx(hwp, hwp_com, out_hwpx)
    else:
        # Fall back to pyhwpx only
        try:
            hwp.save_as(str(out_hwpx))
            ok = True
        except Exception:
            ok = False

    if not ok:
        print("Failed to save as HWPX automatically. Please save manually from Hanword.")
    try:
        # Close application if we own COM
        if hwp_com is not None:
            hwp_com.Quit()
    except Exception:
        pass

    # Write failure log if any
    if failed_equations:
        fail_log = out_hwpx.with_suffix(".fail.txt")
        Path(fail_log).write_text("\n\n".join(failed_equations), encoding="utf-8")
        print(f"[WARN] {len(failed_equations)} equations failed to convert. See: {fail_log}")

    return out_hwpx


def main() -> None:
    project_root = Path(__file__).resolve().parent
    default_inputs = [
        project_root / "history" / "hwp_test.mmd",
        project_root / "output" / "result.paged.filtered.mmd",
        project_root / "output" / "result.paged.mmd",
    ]
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    else:
        # Choose first existing default
        existing = [p for p in default_inputs if p.exists()]
        if not existing:
            print("No input .mmd provided and default files not found.")
            print("Usage: python convert_mmd_to_hwp.py <path/to/file.mmd>")
            sys.exit(1)
        src = existing[0]

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = project_root / "output" / f"from_mmd_{timestamp}.hwpx"
    print(f"Converting: {src}")
    result = convert_mmd_to_hwpx(src, out)
    print(f"Created: {result}")


if __name__ == "__main__":
    main()


