import type { InvestorType, Source } from '@app/shared';

/**
 * 큐레이션 투자자 시드(Phase 0 slice 3, PLAN Phase 0-3 / `/add-investor` 스킬).
 *
 * 추적 대상 거대 투자자를 `investors` 테이블에 적재하기 위한 단일 진실원.
 * `external_id`(EDGAR CIK)는 모두 SEC `data.sec.gov/submissions/CIK{10자리}.json`
 * 으로 **엔티티명·13F-HR 제출 이력을 확인**해 기입했다(중립 카피·정보 집계, ADR-0013).
 *
 * 부모 링크(`parentSlug`)는 국민연금처럼 한 투자자가 미국분(EDGAR)·국내분(DART)을
 * 따로 공시할 때 두 행을 한 투자자로 묶기 위한 것(ADR-0010). Phase 0 은 EDGAR 전용이라
 * NPS 국내분(DART)·부모 링크는 Phase 2(DART 인제스트, 키 확보 후 검증)에서 추가한다.
 * 스키마(`investors.parent_investor_id`)와 러너는 이미 그에 대비되어 있다.
 */
export interface InvestorSeed {
  /** kebab-case 식별자(예: `pershing-square`). 시드/URL 안정 키. */
  slug: string;
  /** 표시명(공시 엔티티명 기반, 중립 카피). */
  displayName: string;
  /** 투자자 유형(shared `InvestorType` 미러). */
  type: InvestorType;
  /** 공시 출처(shared `Source` 미러). */
  source: Source;
  /** EDGAR CIK(숫자 문자열, 0패딩 없이) 또는 DART filer/corp id. */
  externalId: string;
  /** Phase 0 시드는 모두 큐레이션. */
  isCurated: boolean;
  /** 이중소스 묶음의 부모 slug(ADR-0010, NPS류). 1차 시드엔 없음. */
  parentSlug?: string;
}

/**
 * 미국 13F 운용사 큐레이션(SEC 검증 완료). 버핏·국민연금 미국분 + 유명 가치/액티비스트/매크로.
 * 합의 랭킹은 `parent_investor_id` 로 이중집계를 방지한다(ADR-0010).
 */
export const investorSeeds: InvestorSeed[] = [
  {
    slug: 'berkshire-hathaway',
    displayName: 'Berkshire Hathaway',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1067983', // SEC: BERKSHIRE HATHAWAY INC
    isCurated: true,
  },
  {
    slug: 'nps-us',
    displayName: 'National Pension Service (US)',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1608046', // SEC: National Pension Service — 미국분(국내분은 Phase 2 DART)
    isCurated: true,
  },
  {
    slug: 'pershing-square',
    displayName: 'Pershing Square Capital Management',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1336528', // SEC: Pershing Square Capital Management, L.P.
    isCurated: true,
  },
  {
    slug: 'scion-asset-management',
    displayName: 'Scion Asset Management',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1649339', // SEC: Scion Asset Management, LLC
    isCurated: true,
  },
  {
    slug: 'appaloosa',
    displayName: 'Appaloosa',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1656456', // SEC: Appaloosa LP
    isCurated: true,
  },
  {
    slug: 'baupost-group',
    displayName: 'Baupost Group',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1061768', // SEC: BAUPOST GROUP LLC/MA
    isCurated: true,
  },
  {
    slug: 'greenlight-capital',
    displayName: 'Greenlight Capital',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1079114', // SEC: GREENLIGHT CAPITAL INC
    isCurated: true,
  },
  {
    slug: 'bridgewater-associates',
    displayName: 'Bridgewater Associates',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1350694', // SEC: Bridgewater Associates, LP
    isCurated: true,
  },
  {
    slug: 'renaissance-technologies',
    displayName: 'Renaissance Technologies',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1037389', // SEC: RENAISSANCE TECHNOLOGIES LLC
    isCurated: true,
  },
  {
    slug: 'tiger-global',
    displayName: 'Tiger Global Management',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1167483', // SEC: TIGER GLOBAL MANAGEMENT LLC
    isCurated: true,
  },
  {
    slug: 'third-point',
    displayName: 'Third Point',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1040273', // SEC: Third Point LLC
    isCurated: true,
  },
  {
    slug: 'icahn-capital',
    displayName: 'Icahn Capital',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '921669', // SEC: ICAHN CARL C
    isCurated: true,
  },
  {
    slug: 'duquesne-family-office',
    displayName: 'Duquesne Family Office',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1536411', // SEC: Duquesne Family Office LLC
    isCurated: true,
  },
  {
    slug: 'lone-pine-capital',
    displayName: 'Lone Pine Capital',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1061165', // SEC: LONE PINE CAPITAL LLC
    isCurated: true,
  },
  {
    slug: 'himalaya-capital',
    displayName: 'Himalaya Capital Management',
    type: 'us_13f_manager',
    source: 'edgar',
    externalId: '1709323', // SEC: Himalaya Capital Management LLC
    isCurated: true,
  },
];
