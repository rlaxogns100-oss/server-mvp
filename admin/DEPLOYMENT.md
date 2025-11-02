# 관리자 페이지 v2 - 배포 가이드

## ✅ 완료된 기능

### 백엔드
- ✅ 필터 쿼리 파서 (`admin/modules/filters.cjs`)
- ✅ 캐시 시스템 (`admin/modules/cache.cjs`)
- ✅ 통계 집계 로직 (`admin/modules/aggregations.cjs`)
- ✅ 단가 설정 (`admin/modules/billing.cjs`)
- ✅ MongoDB 인덱스 스크립트 (`admin/create_indexes.js`)

### API 엔드포인트
- ✅ `GET /admin/v2` - 관리자 v2 페이지
- ✅ `GET /api/admin/v2/stats` - 종합 통계
- ✅ `GET /api/admin/v2/timeseries` - 시계열 데이터
- ✅ `GET /api/admin/v2/tables` - 테이블 데이터 (페이징)
- ✅ `GET /api/admin/v2/export/users.csv` - CSV 내보내기

### 프론트엔드
- ✅ 인증 시스템
- ✅ 필터 UI (날짜, 역할, 플랜, 사용량, 검색)
- ✅ 통계 카드 (8개)
  - 총 사용자 / 유료 사용자
  - MRR / ARR
  - ARPU
  - 오늘 매출 / 실패 결제
  - PDF 생성 / 페이지 수
  - LLM 사용량 / 비용
  - 파이프라인 성공률 / 지연
  - 에러율
- ✅ 그래프 (2개)
  - 가입자/유료/체험 추이
  - 매출 추이
- ✅ 사용자 테이블 (페이징)
- ✅ CSV Export 버튼

## 🚀 배포 방법

### 1. MongoDB 인덱스 생성 (권장)

성능 최적화를 위해 인덱스를 생성하세요. **기존 서버에 영향을 주지 않습니다.**

```bash
node admin/create_indexes.js
```

### 2. 서버 재시작

```bash
# PM2 사용 시
pm2 restart app

# 일반 Node.js
npm start
```

### 3. 접속

브라우저에서 접속:
- v2 페이지: `http://your-domain.com/admin/v2`
- v1 페이지 (기존): `http://your-domain.com/admin` (영향 없음)

### 4. 로그인

관리자 비밀번호 입력 (환경변수 `ADMIN_PASSWORD` 또는 기본값 `admin123`)

## 📋 사용 방법

### 필터 적용
1. 날짜 범위 선택 (기본: 최근 7일)
2. 사용자 역할 선택 (전체/선생님/학생/관리자)
3. 플랜 선택 (전체/Basic/Pro/Trial)
4. 최소/최대 PDF 수 입력
5. 검색어 입력 (이메일/이름)
6. "적용" 버튼 클릭

### CSV 내보내기
1. 필터 적용
2. "CSV 내보내기" 버튼 클릭
3. `users.csv` 파일 다운로드

### 데이터 새로고침
- 60초 캐시 적용 (성능 최적화)
- 최신 데이터가 필요하면 "적용" 버튼 재클릭

## ⚠️ 주의사항

### 기존 서버 영향 없음
- ✅ 기존 `/admin` 페이지: 정상 작동
- ✅ 기존 `/api/admin/stats`: 정상 작동
- ✅ 모든 기존 기능: 영향 없음

### 성능 고려사항
1. **캐시**: 동일 쿼리 60초 캐시
2. **인덱스**: `create_indexes.js` 실행 권장
3. **페이지 크기**: 테이블은 최대 50개/페이지
4. **CSV Export**: 최대 10,000개 행

### 보안
- 모든 v2 API는 `X-Admin-Password` 헤더 필수
- v1과 동일한 인증 시스템 사용
- 비밀번호는 localStorage에 저장 (자동 로그인)

## 🐛 문제 해결

### 1. "Database not connected" 오류
- MongoDB 연결 확인
- `MONGODB_URI` 환경변수 확인

### 2. 통계가 0으로 표시
- MongoDB 컬렉션 확인 (users, files, problems)
- 날짜 필터 확인 (데이터 범위 내인지)

### 3. 느린 응답 속도
- `node admin/create_indexes.js` 실행
- 캐시 확인 (60초 TTL)

### 4. CSV 다운로드 실패
- 브라우저 팝업 차단 확인
- 필터가 너무 많은 데이터를 포함하는지 확인

## 📊 미구현 기능 (향후 추가 가능)

- ❌ 퍼널 분석 (`/api/admin/v2/funnel`)
- ❌ 코호트 분석 (`/api/admin/v2/cohort`)
- ❌ 실패 작업 테이블
- ❌ 고사용량 사용자 테이블
- ❌ 유료 고객 테이블
- ❌ 실시간 알림

이러한 기능은 필요 시 `admin/modules/` 에 추가 모듈을 만들어 구현할 수 있습니다.

## 🧪 테스트 체크리스트

배포 전에 다음을 확인하세요:

- [ ] 기존 `/admin` 페이지 정상 작동
- [ ] 기존 `/api/admin/stats` API 정상 응답
- [ ] `/admin/v2` 페이지 로드
- [ ] v2 인증 성공
- [ ] 통계 카드 표시
- [ ] 그래프 표시
- [ ] 테이블 표시
- [ ] 필터 적용
- [ ] CSV 다운로드
- [ ] 페이지네이션 작동

## 📞 지원

문제가 발생하면:
1. 브라우저 개발자 도구 콘솔 확인
2. 서버 로그 확인
3. MongoDB 연결 상태 확인
4. 인덱스 생성 여부 확인

## 🔄 롤백 방법

만약 문제가 발생하면:

```bash
# app.cjs에서 v2 라우트 제거 (2394-2498줄)
# 또는 /admin/v2 접속 안 하기 (기존 /admin 사용)
```

기존 시스템은 전혀 영향받지 않으므로 안전합니다.

