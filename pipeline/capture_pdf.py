#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
화면 캡쳐 PDF 생성 스크립트
브라우저의 특정 영역을 캡쳐해서 PDF로 생성합니다.
"""

import json
import sys
import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Image as RLImage
from reportlab.lib.units import mm
import io
import base64

class ScreenCapturePDF:
    def __init__(self):
        self.driver = None
        self.setup_driver()

    def setup_driver(self):
        """Chrome 드라이버 설정"""
        try:
            chrome_options = Options()
            chrome_options.add_argument('--headless')  # 브라우저 창 숨김
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--window-size=1920,1080')
            chrome_options.add_argument('--force-device-scale-factor=2')  # 고해상도

            self.driver = webdriver.Chrome(options=chrome_options)
            print("Chrome 드라이버 초기화 성공")

        except Exception as e:
            print(f"Chrome 드라이버 초기화 실패: {e}")
            raise

    def capture_page_areas(self, url, capture_data):
        """페이지의 특정 영역들을 캡쳐"""
        try:
            print(f"페이지 로딩: {url}")
            self.driver.get(url)

            # 페이지 로딩 대기
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )

            # 선택된 문제가 있는지 확인
            exam_problems_count = self.driver.execute_script("""
                return window.examProblems ? window.examProblems.length : 0;
            """)

            print(f"선택된 문제 수: {exam_problems_count}개")

            if exam_problems_count == 0:
                print("오류: 선택된 문제가 없습니다. 캡쳐를 중단합니다.")
                return []

            # MathJax 렌더링 대기
            time.sleep(3)

            # JavaScript 실행으로 MathJax 완료 대기
            self.driver.execute_script("""
                return new Promise((resolve) => {
                    if (window.MathJax && window.MathJax.typesetPromise) {
                        window.MathJax.typesetPromise().then(() => resolve(true));
                    } else {
                        setTimeout(() => resolve(true), 1000);
                    }
                });
            """)

            captured_images = []

            # 캡쳐할 영역들 처리
            for area_data in capture_data.get('areas', []):
                selector = area_data.get('selector', '#examProblems')

                try:
                    # 요소 찾기
                    element = WebDriverWait(self.driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                    )

                    # 요소로 스크롤
                    self.driver.execute_script("arguments[0].scrollIntoView(true);", element)
                    time.sleep(0.5)

                    # 캡쳐 영역 계산
                    location = element.location
                    size = element.size

                    print(f"캡쳐 영역: {selector} - 위치: {location}, 크기: {size}")

                    # 전체 페이지 스크린샷
                    screenshot = self.driver.get_screenshot_as_png()
                    screenshot_image = Image.open(io.BytesIO(screenshot))

                    # 디바이스 스케일 팩터 적용 (Retina 디스플레이 대응)
                    scale_factor = 2
                    left = location['x'] * scale_factor
                    top = location['y'] * scale_factor
                    right = left + size['width'] * scale_factor
                    bottom = top + size['height'] * scale_factor

                    # 영역 크롭
                    cropped_image = screenshot_image.crop((left, top, right, bottom))

                    # PNG로 저장 (임시)
                    temp_path = f"temp_capture_{len(captured_images)}.png"
                    cropped_image.save(temp_path, 'PNG', quality=95)

                    captured_images.append({
                        'path': temp_path,
                        'image': cropped_image,
                        'index': len(captured_images)
                    })

                    print(f"캡쳐 완료: {selector} -> {temp_path}")

                except Exception as e:
                    print(f"영역 캡쳐 실패 {selector}: {e}")
                    continue

            return captured_images

        except Exception as e:
            print(f"페이지 캡쳐 오류: {e}")
            return []

    def create_pdf_from_images(self, captured_images, output_path):
        """캡쳐된 이미지들로 PDF 생성"""
        try:
            print(f"PDF 생성 시작: {len(captured_images)}개 이미지")

            # PDF 문서 생성
            doc = SimpleDocTemplate(
                output_path,
                pagesize=A4,
                rightMargin=0,
                leftMargin=0,
                topMargin=0,
                bottomMargin=0
            )

            story = []
            A4_WIDTH = A4[0]
            A4_HEIGHT = A4[1]
            temp_files_to_delete = []  # 나중에 삭제할 임시 파일 목록

            for i, img_data in enumerate(captured_images):
                try:
                    image = img_data['image']

                    # 이미지 크기 계산
                    img_width, img_height = image.size
                    img_ratio = img_width / img_height
                    a4_ratio = A4_WIDTH / A4_HEIGHT

                    # A4에 맞게 크기 조정
                    if img_ratio > a4_ratio:
                        # 가로가 긴 경우
                        pdf_width = A4_WIDTH
                        pdf_height = A4_WIDTH / img_ratio
                    else:
                        # 세로가 긴 경우
                        pdf_height = A4_HEIGHT
                        pdf_width = A4_HEIGHT * img_ratio

                    # 임시 파일로 이미지 저장
                    temp_img_path = f"temp_pdf_img_{i}.png"
                    image.save(temp_img_path, 'PNG')
                    temp_files_to_delete.append(temp_img_path)  # 삭제 목록에 추가

                    # PDF에 이미지 추가
                    rl_image = RLImage(temp_img_path, width=pdf_width, height=pdf_height)
                    story.append(rl_image)

                    print(f"PDF 페이지 {i+1} 추가 완료")

                except Exception as e:
                    print(f"이미지 {i} PDF 추가 실패: {e}")
                    continue

            # PDF 빌드
            doc.build(story)

            # PDF 빌드 완료 후 임시 파일들 정리
            for temp_file in temp_files_to_delete:
                if os.path.exists(temp_file):
                    try:
                        os.remove(temp_file)
                        print(f"임시 파일 삭제: {temp_file}")
                    except Exception as e:
                        print(f"임시 파일 삭제 실패: {temp_file} - {e}")

            # 임시 캡쳐 파일들 정리
            for img_data in captured_images:
                if os.path.exists(img_data['path']):
                    try:
                        os.remove(img_data['path'])
                        print(f"캡쳐 파일 삭제: {img_data['path']}")
                    except Exception as e:
                        print(f"캡쳐 파일 삭제 실패: {img_data['path']} - {e}")

            print(f"PDF 생성 완료: {output_path}")
            return True

        except Exception as e:
            print(f"PDF 생성 오류: {e}")
            return False

    def generate_pdf(self, capture_config, output_path):
        """메인 PDF 생성 함수"""
        try:
            url = capture_config.get('url', 'http://localhost:3000')

            # 화면 캡쳐
            captured_images = self.capture_page_areas(url, capture_config)

            if not captured_images:
                raise Exception("캡쳐된 이미지가 없습니다")

            # PDF 생성
            success = self.create_pdf_from_images(captured_images, output_path)

            return success

        except Exception as e:
            print(f"PDF 생성 실패: {e}")
            return False
        finally:
            if self.driver:
                self.driver.quit()

def main():
    try:
        # 입력 데이터 읽기
        input_file = 'temp_capture_config.json'
        output_file = 'output/captured_exam.pdf'

        if not os.path.exists(input_file):
            print(f"입력 파일을 찾을 수 없습니다: {input_file}")
            sys.exit(1)

        with open(input_file, 'r', encoding='utf-8') as f:
            capture_config = json.load(f)

        # output 디렉토리 생성
        os.makedirs('output', exist_ok=True)

        # PDF 생성
        generator = ScreenCapturePDF()
        success = generator.generate_pdf(capture_config, output_file)

        if success:
            print("SUCCESS: 화면 캡쳐 PDF 생성 완료")

            # 임시 파일 삭제
            if os.path.exists(input_file):
                os.remove(input_file)
        else:
            print("ERROR: 화면 캡쳐 PDF 생성 실패")
            sys.exit(1)

    except Exception as e:
        print(f"스크립트 실행 오류: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()