---
name: add-investor
description: Add a curated large investor to the seed config (CIK/slug/type/source) with validation. Use when adding a tracked investor (e.g., a famous 13F manager or a Korean DART filer) to the recommendation universe.
---

# /add-investor — 큐레이션 투자자 추가

목적: 추적 대상 거대 투자자를 `apps/api/src/config/investors.seed.ts` 에 추가한다.

## 입력 받기
- `slug` (kebab-case, 예: `pershing-square`)
- `display_name` (예: "Pershing Square")
- `type`: `us_13f_manager` | `kr_disclosure_filer`
- `source`: `edgar` | `dart`
- `external_id`: EDGAR **CIK**(숫자, 예: `1336528`) 또는 DART filer id
- (선택) `country`, `description`, `image_url`

## 절차
1. `external_id` 검증:
   - EDGAR CIK 는 숫자. `https://data.sec.gov/submissions/CIK{10자리 0패딩}.json` 으로 존재·이름 확인(`User-Agent` 필수).
   - 중복(slug/external_id) 이 시드에 이미 있는지 확인.
2. `investors.seed.ts` 배열에 항목 추가(`is_curated: true`).
3. **국민연금류 이중 소스**(미국 13F + 국내 DART)면 두 행을 만들고 `parent_investor_id` 로 연결(ADR-0010).
4. 가능하면 시드 검증 테스트(슬러그 유니크·CIK 형식)를 **먼저** 추가/갱신(TDD, ADR-0014).

## 가드레일
- CUSIP/유료 데이터 재배포 금지(ADR-0013 / ARCHITECTURE §12).
- 커밋 메시지: `feat(seed): add <slug> to curated investors`.
