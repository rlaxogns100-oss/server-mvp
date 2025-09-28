#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF 생성 스크립트
시험지 데이터를 받아서 PDF로 생성합니다.
"""

import json
import sys
import os
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import re
from datetime import datetime

class ExamPDFGenerator:
    def __init__(self):
        # 한글 폰트 등록 시도
        self.setup_fonts()
        self.setup_styles()

    def setup_fonts(self):
        """한글 폰트 설정"""
        try:
            # Windows 시스템 폰트 경로들
            font_paths = [
                "C:/Windows/Fonts/malgun.ttf",  # 맑은 고딕
                "C:/Windows/Fonts/gulim.ttf",   # 굴림
                "C:/Windows/Fonts/batang.ttf",  # 바탕
            ]

            self.korean_font = None
            for font_path in font_paths:
                if os.path.exists(font_path):
                    try:
                        pdfmetrics.registerFont(TTFont('Korean', font_path))
                        self.korean_font = 'Korean'
                        print(f"한글 폰트 등록 성공: {font_path}")
                        break
                    except Exception as e:
                        print(f"폰트 등록 실패: {font_path} - {e}")
                        continue

            if not self.korean_font:
                print("한글 폰트를 찾을 수 없습니다. 기본 폰트를 사용합니다.")
                self.korean_font = 'Helvetica'

        except Exception as e:
            print(f"폰트 설정 오류: {e}")
            self.korean_font = 'Helvetica'

    def setup_styles(self):
        """스타일 설정"""
        self.styles = getSampleStyleSheet()

        # 제목 스타일
        self.title_style = ParagraphStyle(
            'CustomTitle',
            parent=self.styles['Title'],
            fontName=self.korean_font,
            fontSize=20,
            spaceAfter=30,
            alignment=TA_CENTER,
            textColor=colors.black
        )

        # 부제목 스타일
        self.subtitle_style = ParagraphStyle(
            'CustomSubtitle',
            parent=self.styles['Normal'],
            fontName=self.korean_font,
            fontSize=14,
            spaceAfter=20,
            alignment=TA_CENTER,
            textColor=colors.grey
        )

        # 문제 번호 스타일
        self.problem_number_style = ParagraphStyle(
            'ProblemNumber',
            parent=self.styles['Normal'],
            fontName=self.korean_font,
            fontSize=12,
            spaceBefore=10,
            spaceAfter=5,
            leftIndent=0,
            fontStyle='bold'
        )

        # 문제 내용 스타일
        self.problem_content_style = ParagraphStyle(
            'ProblemContent',
            parent=self.styles['Normal'],
            fontName=self.korean_font,
            fontSize=11,
            spaceAfter=10,
            leftIndent=15,
            alignment=TA_JUSTIFY,
            leading=16
        )

        # 선택지 스타일
        self.option_style = ParagraphStyle(
            'Option',
            parent=self.styles['Normal'],
            fontName=self.korean_font,
            fontSize=10,
            spaceAfter=3,
            leftIndent=25,
            leading=14
        )

    def clean_latex(self, text):
        """LaTeX 수식 정리"""
        if not text:
            return ""

        # 기본적인 LaTeX 수식 처리
        # 복잡한 수식은 단순화
        text = re.sub(r'\$\$([^$]+)\$\$', r'[\1]', text)  # 디스플레이 수식
        text = re.sub(r'\$([^$]+)\$', r'(\1)', text)      # 인라인 수식

        # 기본적인 LaTeX 명령어 처리
        replacements = [
            (r'\\frac\{([^}]+)\}\{([^}]+)\}', r'(\1)/(\2)'),
            (r'\\sqrt\{([^}]+)\}', r'√(\1)'),
            (r'\\times', '×'),
            (r'\\div', '÷'),
            (r'\\pm', '±'),
            (r'\\leq', '≤'),
            (r'\\geq', '≥'),
            (r'\\neq', '≠'),
            (r'\\alpha', 'α'),
            (r'\\beta', 'β'),
            (r'\\gamma', 'γ'),
            (r'\\pi', 'π'),
            (r'\\theta', 'θ'),
            (r'\\infty', '∞'),
            (r'\\sum', 'Σ'),
            (r'\\int', '∫'),
            (r'\\left\(', '('),
            (r'\\right\)', ')'),
            (r'\\left\[', '['),
            (r'\\right\]', ']'),
            (r'\\\\', '\n'),
        ]

        for pattern, replacement in replacements:
            text = re.sub(pattern, replacement, text)

        # 남은 백슬래시 제거
        text = re.sub(r'\\[a-zA-Z]+', '', text)
        text = re.sub(r'[{}]', '', text)

        return text.strip()

    def process_content_block(self, block):
        """content_block 처리"""
        if block['type'] == 'text':
            return self.clean_latex(block['content'])
        elif block['type'] == 'table':
            # 표는 간단히 텍스트로 변환
            if isinstance(block['content'], list):
                rows = []
                for row in block['content']:
                    if isinstance(row, list):
                        rows.append(' | '.join(str(cell) for cell in row))
                    else:
                        rows.append(str(row))
                return '\n'.join(rows)
            return str(block['content'])
        elif block['type'] == 'examples':
            if isinstance(block['content'], list):
                return '\n'.join(f"  {item}" for item in block['content'])
            return str(block['content'])
        else:
            return str(block.get('content', ''))

    def generate_pdf(self, problems_data, output_path):
        """PDF 생성"""
        try:
            print(f"PDF 생성 시작: {len(problems_data)}개 문제")

            # PDF 문서 생성
            doc = SimpleDocTemplate(
                output_path,
                pagesize=A4,
                rightMargin=2*cm,
                leftMargin=2*cm,
                topMargin=2*cm,
                bottomMargin=2*cm
            )

            # 스토리 리스트
            story = []

            # 제목 추가
            story.append(Paragraph("수학 시험지", self.title_style))
            story.append(Paragraph(f"{datetime.now().strftime('%Y년 %m월 %d일')}", self.subtitle_style))
            story.append(Spacer(1, 20))

            problems_per_page = 4  # 페이지당 문제 수

            for i, problem_data in enumerate(problems_data):
                try:
                    # 문제 번호
                    problem_num = i + 1
                    story.append(Paragraph(f"{problem_num}.", self.problem_number_style))

                    # 문제 내용 처리
                    content_parts = []

                    if 'content_blocks' in problem_data and problem_data['content_blocks']:
                        for block in problem_data['content_blocks']:
                            content = self.process_content_block(block)
                            if content.strip():
                                content_parts.append(content)

                    # 문제 내용 합치기
                    if content_parts:
                        full_content = ' '.join(content_parts)
                        story.append(Paragraph(self.clean_latex(full_content), self.problem_content_style))

                    # 선택지 추가
                    if 'options' in problem_data and problem_data['options']:
                        for j, option in enumerate(problem_data['options']):
                            option_text = f"({j+1}) {self.clean_latex(str(option))}"
                            story.append(Paragraph(option_text, self.option_style))

                    # 문제 간 간격
                    story.append(Spacer(1, 15))

                    # 페이지 나누기 (일정 개수마다)
                    if (i + 1) % problems_per_page == 0 and i < len(problems_data) - 1:
                        story.append(PageBreak())

                except Exception as e:
                    print(f"문제 {i+1} 처리 중 오류: {e}")
                    # 오류가 있어도 계속 진행
                    story.append(Paragraph(f"문제 {i+1}: 처리 오류", self.problem_content_style))
                    story.append(Spacer(1, 15))

            # PDF 빌드
            doc.build(story)
            print(f"PDF 생성 완료: {output_path}")
            return True

        except Exception as e:
            print(f"PDF 생성 오류: {e}")
            return False

def main():
    try:
        # 입력 데이터 읽기
        input_file = 'temp_exam_data.json'
        output_file = 'output/generated_exam.pdf'

        if not os.path.exists(input_file):
            print(f"입력 파일을 찾을 수 없습니다: {input_file}")
            sys.exit(1)

        with open(input_file, 'r', encoding='utf-8') as f:
            exam_data = json.load(f)

        if 'problems' not in exam_data:
            print("problems 데이터가 없습니다.")
            sys.exit(1)

        # output 디렉토리 생성
        os.makedirs('output', exist_ok=True)

        # PDF 생성
        generator = ExamPDFGenerator()
        success = generator.generate_pdf(exam_data['problems'], output_file)

        if success:
            print("SUCCESS: PDF 생성 완료")

            # 임시 파일 삭제
            if os.path.exists(input_file):
                os.remove(input_file)

        else:
            print("ERROR: PDF 생성 실패")
            sys.exit(1)

    except Exception as e:
        print(f"스크립트 실행 오류: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()