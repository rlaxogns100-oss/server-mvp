# 관리자 페이지 v2

## ⚠️ 중요사항
- **본 서버에 영향을 주지 않도록 완전히 분리된 구조**
- 기존 `/admin` 및 `/api/admin/*` 라우트와 충돌하지 않음
- 새로운 경로: `/admin/v2` 및 `/api/admin/v2/*`

## 폴더 구조

```
admin/
├── README.md              # 이 파일
├── modules/               # 백엔드 모듈
│   ├── filters.cjs        # 필터 쿼리 파서
│   ├── cache.cjs          # 캐시 관리 (60s TTL)
│   ├── aggregations.cjs   # 통계 집계 로직
│   ├── billing.cjs        # 단가/쿼터 설정
│   ├── funnel.cjs         # 퍼널 분석
│   └── cohort.cjs         # 코호트 분석
└── v2.html                # 새 관리자 UI
```

## API 엔드포인트

### 인증
- 기존과 동일: `X-Admin-Password` 헤더 사용

### 통계 API
- `GET /api/admin/v2/stats` - 종합 통계 (필터 적용)
- `GET /api/admin/v2/timeseries` - 시계열 데이터
- `GET /api/admin/v2/tables` - 테이블 데이터 (페이징)
- `GET /api/admin/v2/funnel` - 퍼널 분석
- `GET /api/admin/v2/cohort` - 코호트 분석

### Export API
- `GET /api/admin/v2/export/users.csv` - 사용자 CSV
- `GET /api/admin/v2/export/usage.csv` - 사용량 CSV

## 필터 파라미터

모든 API는 다음 쿼리 파라미터를 지원:

```
?from=ISO8601          # 시작 날짜
&to=ISO8601            # 종료 날짜
&role=teacher|student  # 사용자 역할
&plan=basic|pro        # 플랜
&paid=true|false       # 유료 여부
&minPdf=N              # 최소 PDF 생성 수
&maxPdf=N              # 최대 PDF 생성 수
&minPages=N            # 최소 페이지 수
&maxPages=N            # 최대 페이지 수
&minTokens=N           # 최소 토큰 수
&maxTokens=N           # 최대 토큰 수
&org=orgId             # 기관 ID
&utm=channel           # UTM 채널
&activeOnly=1          # 활성 사용자만
&errorOnly=1           # 에러 경험자만
&search=query          # 이메일/이름 검색
&page=N                # 페이지 번호 (tables만)
&pageSize=N            # 페이지 크기 (tables만)
&sort=field            # 정렬 필드 (tables만)
```

## MongoDB 인덱스

성능을 위해 다음 인덱스 필요:

```javascript
// users
db.users.createIndex({ createdAt: 1 })
db.users.createIndex({ role: 1 })
db.users.createIndex({ plan: 1 })
db.users.createIndex({ isPaid: 1 })
db.users.createIndex({ organizationId: 1 })
db.users.createIndex({ email: 1 })

// files (변환)
db.files.createIndex({ userId: 1, uploadDate: 1 })
db.files.createIndex({ uploadDate: 1 })

// problems
db.problems.createIndex({ fileId: 1 })
db.problems.createIndex({ userId: 1 })

// subscriptions (유료 구독)
db.subscriptions.createIndex({ userId: 1 })
db.subscriptions.createIndex({ status: 1 })
db.subscriptions.createIndex({ nextBillingAt: 1 })
db.subscriptions.createIndex({ createdAt: 1 })

// events (사용량 추적)
db.events.createIndex({ userId: 1, createdAt: 1, type: 1 })
db.events.createIndex({ organizationId: 1 })

// pipeline_runs (파이프라인 실행 로그)
db.pipeline_runs.createIndex({ createdAt: 1, stage: 1, status: 1 })
db.pipeline_runs.createIndex({ userId: 1 })

// payments (결제 내역)
db.payments.createIndex({ userId: 1, status: 1, createdAt: 1 })
```

## 단계적 구현 계획

### Phase 1: 기본 인프라 ✅
- [x] 폴더 구조 생성
- [ ] 필터 파서 구현
- [ ] 캐시 시스템 구현
- [ ] 기본 통계 집계 로직

### Phase 2: 기본 API
- [ ] /stats 엔드포인트
- [ ] /timeseries 엔드포인트
- [ ] /tables 엔드포인트

### Phase 3: UI
- [ ] 필터 UI
- [ ] 카드 (통계)
- [ ] 그래프 (추이)
- [ ] 테이블 (사용자 리스트)

### Phase 4: 고급 기능
- [ ] CSV Export
- [ ] 퍼널 분석
- [ ] 코호트 분석

### Phase 5: 최적화
- [ ] MongoDB 인덱스 생성 스크립트
- [ ] 캐시 최적화
- [ ] 성능 테스트

## 테스트 체크리스트

- [ ] 기존 `/admin` 페이지 정상 작동
- [ ] 기존 `/api/admin/stats` API 정상 작동
- [ ] 새 v2 API 정상 작동
- [ ] 필터 기능 테스트
- [ ] CSV Export 테스트
- [ ] 성능 테스트 (큰 데이터셋)
- [ ] 보안 테스트 (인증)

## 보안 고려사항

1. **인증**: 모든 v2 API는 `X-Admin-Password` 헤더 필수
2. **레이트 리밋**: 과도한 요청 방지
3. **캐시**: 동일 쿼리 60초 캐시
4. **입력 검증**: 모든 필터 파라미터 검증
5. **SQL Injection 방지**: MongoDB aggregation pipeline 사용

## 비용 계산

### LLM 비용 (예시)
- GPT-4: $0.03/1K input tokens, $0.06/1K output tokens
- GPT-3.5: $0.0015/1K input tokens, $0.002/1K output tokens

### 스토리지 비용 (예시)
- S3: $0.023/GB-월
- MongoDB Atlas: $0.08/GB-월

## 성능 목표

- API 응답 시간: < 500ms (캐시 hit)
- API 응답 시간: < 3s (캐시 miss, 복잡한 aggregation)
- UI 로딩 시간: < 2s
- CSV Export: < 10s (10K rows)

