import {
  pgTable,
  serial,
  bigserial,
  integer,
  text,
  boolean,
  numeric,
  date,
  timestamp,
  index,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  marketEnum,
  sourceEnum,
  eventTypeEnum,
  investorTypeEnum,
  formTypeEnum,
  changeTypeEnum,
  intentEnum,
  confidenceEnum,
} from './enums';

export * from './enums';

// ── 공통 컬럼 헬퍼 ─────────────────────────────────────────────────
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
/** 보유/거래 수량(분수 가능: DART·옵션). drizzle numeric → string. */
const sharesCol = (name: string) => numeric(name, { precision: 24, scale: 6 });
/** 금액(USD 등). */
const moneyCol = (name: string) => numeric(name, { precision: 24, scale: 2 });
/** 비율(%). */
const pctCol = (name: string) => numeric(name, { precision: 9, scale: 4 });

// ── investors ──────────────────────────────────────────────────────
/** 추적 대상 큐레이션 투자자. NPS 는 미국분/국내분을 parent_investor_id 로 묶음(ADR-0010). */
export const investors = pgTable(
  'investors',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    type: investorTypeEnum('type').notNull(),
    source: sourceEnum('source').notNull(),
    externalId: text('external_id').notNull(), // CIK(EDGAR) 또는 DART filer id
    isCurated: boolean('is_curated').notNull().default(true),
    parentInvestorId: integer('parent_investor_id').references((): AnyPgColumn => investors.id),
    createdAt: createdAt(),
  },
  (t) => [unique('uq_investors_source_external').on(t.source, t.externalId)],
);

// ── securities ─────────────────────────────────────────────────────
/** 증권 마스터. CUSIP/티커는 기업이벤트로 바뀔 수 있어 nullable + 시점 보강(ADR-0015). */
export const securities = pgTable(
  'securities',
  {
    id: serial('id').primaryKey(),
    cusip: text('cusip').unique(),
    figi: text('figi'),
    ticker: text('ticker'),
    name: text('name').notNull(),
    market: marketEnum('market').notNull(),
    currency: text('currency').notNull().default('USD'),
    sector: text('sector'),
    industry: text('industry'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_securities_ticker').on(t.ticker), index('idx_securities_market').on(t.market)],
);

// ── cusip_map ──────────────────────────────────────────────────────
/** 13F CUSIP → 티커/증권 해결(ADR-0009). */
export const cusipMap = pgTable('cusip_map', {
  cusip: text('cusip').primaryKey(),
  securityId: integer('security_id')
    .notNull()
    .references(() => securities.id),
  ticker: text('ticker'),
  confidence: confidenceEnum('confidence').notNull(),
  createdAt: createdAt(),
});

// ── corp_code_map ──────────────────────────────────────────────────
/** DART corpCode.xml → 증권 매핑. */
export const corpCodeMap = pgTable('corp_code_map', {
  corpCode: text('corp_code').primaryKey(),
  stockCode: text('stock_code'),
  securityId: integer('security_id')
    .notNull()
    .references(() => securities.id),
  createdAt: createdAt(),
});

// ── fx_rates ───────────────────────────────────────────────────────
/** 환율 — KR value_usd = 가격×수량×FX(ADR-0015). */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: serial('id').primaryKey(),
    date: date('date').notNull(),
    base: text('base').notNull().default('USD'),
    quote: text('quote').notNull().default('KRW'),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('uq_fx_rates_date_pair').on(t.date, t.base, t.quote)],
);

// ── filings ────────────────────────────────────────────────────────
/** 원공시 1건. (investor_id, accession_number) unique → 인제스트 멱등(ADR-0002). */
export const filings = pgTable(
  'filings',
  {
    id: serial('id').primaryKey(),
    investorId: integer('investor_id')
      .notNull()
      .references(() => investors.id),
    source: sourceEnum('source').notNull(),
    formType: formTypeEnum('form_type').notNull(),
    quarter: text('quarter'), // 13F 만 분기 보유; 사건 공시는 null
    reportDate: date('report_date'),
    filingDate: date('filing_date').notNull(),
    accessionNumber: text('accession_number').notNull(),
    rawUrl: text('raw_url').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_filings_investor_accession').on(t.investorId, t.accessionNumber),
    index('idx_filings_filing_date').on(t.filingDate),
    index('idx_filings_investor_form').on(t.investorId, t.formType),
  ],
);

// ── holdings (느린 레인 척추) ──────────────────────────────────────
/** 13F 전체 포트폴리오 스냅샷. 값 스케일 정규화(과거 ×1000)는 파서 책임. */
export const holdings = pgTable(
  'holdings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    filingId: integer('filing_id')
      .notNull()
      .references(() => filings.id),
    investorId: integer('investor_id')
      .notNull()
      .references(() => investors.id),
    securityId: integer('security_id')
      .notNull()
      .references(() => securities.id),
    quarter: text('quarter').notNull(),
    shares: sharesCol('shares').notNull(),
    valueUsd: moneyCol('value_usd'),
    pctOfPortfolio: pctCol('pct_of_portfolio'),
    putCall: text('put_call'), // 상장옵션(putCall) 포함(ADR-0015)
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_holdings_filing_security').on(t.filingId, t.securityId),
    index('idx_holdings_investor_quarter').on(t.investorId, t.quarter),
    index('idx_holdings_security_quarter').on(t.securityId, t.quarter),
  ],
);

// ── activity_events (빠른 레인 척추) ───────────────────────────────
/** Form 4·13D/G·DART 를 공통 형태로 정규화. (investor, accession, security) unique. */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    investorId: integer('investor_id')
      .notNull()
      .references(() => investors.id),
    securityId: integer('security_id')
      .notNull()
      .references(() => securities.id),
    source: sourceEnum('source').notNull(),
    formType: formTypeEnum('form_type').notNull(),
    eventType: eventTypeEnum('event_type').notNull(),
    eventDate: date('event_date').notNull(),
    filingDate: date('filing_date').notNull(),
    sharesDelta: sharesCol('shares_delta'),
    sharesAfter: sharesCol('shares_after'),
    pctOfCompanyAfter: pctCol('pct_of_company_after'),
    pricePerShare: numeric('price_per_share', { precision: 20, scale: 6 }),
    value: moneyCol('value'),
    intent: intentEnum('intent'),
    accessionNumber: text('accession_number').notNull(),
    rawUrl: text('raw_url').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_events_investor_accession_security').on(
      t.investorId,
      t.accessionNumber,
      t.securityId,
    ),
    index('idx_events_filing_date').on(t.filingDate),
    index('idx_events_type_filing_date').on(t.eventType, t.filingDate),
    index('idx_events_security').on(t.securityId),
  ],
);

// ── position_changes (13F 파생) ────────────────────────────────────
/** compute:changes 산출(LAG 기반 분기 diff). */
export const positionChanges = pgTable(
  'position_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    investorId: integer('investor_id')
      .notNull()
      .references(() => investors.id),
    securityId: integer('security_id')
      .notNull()
      .references(() => securities.id),
    quarter: text('quarter').notNull(),
    prevQuarter: text('prev_quarter'),
    changeType: changeTypeEnum('change_type').notNull(),
    sharesDelta: sharesCol('shares_delta'),
    valueDeltaUsd: moneyCol('value_delta_usd'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_changes_investor_security_quarter').on(t.investorId, t.securityId, t.quarter),
    index('idx_changes_security_quarter').on(t.securityId, t.quarter),
  ],
);

// ── consensus_scores (파생 랭킹) ───────────────────────────────────
/** compute:consensus 산출(보유 폭 + 최근 매수 가산 → score/rank). */
export const consensusScores = pgTable(
  'consensus_scores',
  {
    id: serial('id').primaryKey(),
    securityId: integer('security_id')
      .notNull()
      .references(() => securities.id),
    quarter: text('quarter').notNull(),
    holdersCount: integer('holders_count').notNull().default(0),
    netBuyersCount: integer('net_buyers_count').notNull().default(0),
    newBuyersCount: integer('new_buyers_count').notNull().default(0),
    netSellersCount: integer('net_sellers_count').notNull().default(0),
    recentActivityCount: integer('recent_activity_count').notNull().default(0),
    totalValueUsd: moneyCol('total_value_usd'),
    score: numeric('score', { precision: 12, scale: 4 }).notNull(),
    rank: integer('rank').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_consensus_security_quarter').on(t.securityId, t.quarter),
    index('idx_consensus_quarter_rank').on(t.quarter, t.rank),
  ],
);

// ── prices (Phase 2, 스키마 선반영) ────────────────────────────────
export const prices = pgTable(
  'prices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    securityId: integer('security_id')
      .notNull()
      .references(() => securities.id),
    date: date('date').notNull(),
    close: numeric('close', { precision: 20, scale: 6 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    source: text('source'),
    createdAt: createdAt(),
  },
  (t) => [unique('uq_prices_security_date').on(t.securityId, t.date)],
);

// ── benchmarks (Phase 2) ───────────────────────────────────────────
/** S&P500·KOSPI 등 초과수익 산출용 벤치마크 시계열(ADR-0011). */
export const benchmarks = pgTable(
  'benchmarks',
  {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    date: date('date').notNull(),
    close: numeric('close', { precision: 20, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('uq_benchmarks_symbol_date').on(t.symbol, t.date)],
);

// ── investor_performance (Phase 2) ─────────────────────────────────
/** filing_date 기준 forward return − benchmark = 초과수익(ADR-0011). */
export const investorPerformance = pgTable(
  'investor_performance',
  {
    id: serial('id').primaryKey(),
    investorId: integer('investor_id')
      .notNull()
      .references(() => investors.id),
    securityId: integer('security_id').references(() => securities.id),
    quarter: text('quarter'),
    horizon: text('horizon').notNull(), // '1Q' | '4Q'
    positionReturn: pctCol('position_return'),
    benchmarkReturn: pctCol('benchmark_return'),
    excessReturn: pctCol('excess_return'),
    winRate: pctCol('win_rate'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_performance_investor').on(t.investorId)],
);
