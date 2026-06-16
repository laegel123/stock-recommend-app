import { describe, it, expect } from 'vitest';
import { InvestorType, Source } from '@app/shared';
import { investorSeeds } from '../../src/config/investors.seed';

/**
 * Phase 0 slice 3 — 큐레이션 투자자 시드의 결정적(DB 불필요) 계약 테스트.
 * 시드 값 자체의 무결성(슬러그·CIK 형식·source/type 정합·멱등 유니크 키·부모 링크)을
 * 컴파일/런타임으로 못박는다. CIK 가 실제 SEC 엔티티인지(네트워크)는 시드 작성 시 검증했고,
 * 테스트는 SEC 호출 없이 그린이어야 한다(하네스 결정성).
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CIK_RE = /^[0-9]{1,10}$/;

describe('investors.seed — 큐레이션 시드 계약(Phase 0 slice 3)', () => {
  it('10~20명의 큐레이션 투자자를 시드한다(PLAN Phase 0-3)', () => {
    expect(investorSeeds.length).toBeGreaterThanOrEqual(10);
    expect(investorSeeds.length).toBeLessThanOrEqual(20);
  });

  it('모든 slug 가 kebab-case 이며 유니크', () => {
    const slugs = investorSeeds.map((s) => s.slug);
    for (const slug of slugs) expect(slug, slug).toMatch(SLUG_RE);
    expect(new Set(slugs).size, '중복 slug 존재').toBe(slugs.length);
  });

  it('type/source 가 shared enum 값이며 서로 정합(edgar⇔us_13f_manager, dart⇔kr_disclosure_filer)', () => {
    for (const s of investorSeeds) {
      expect(InvestorType.options, `${s.slug}.type`).toContain(s.type);
      expect(Source.options, `${s.slug}.source`).toContain(s.source);
      if (s.source === 'edgar') expect(s.type, `${s.slug} edgar→type`).toBe('us_13f_manager');
      if (s.source === 'dart') expect(s.type, `${s.slug} dart→type`).toBe('kr_disclosure_filer');
    }
  });

  it('edgar 투자자의 external_id 는 숫자 CIK(≤10자리)', () => {
    for (const s of investorSeeds.filter((s) => s.source === 'edgar')) {
      expect(s.externalId, `${s.slug}.externalId`).toMatch(CIK_RE);
    }
  });

  it('(source, external_id) 가 유니크(DB uq_investors_source_external 미러, ADR-0002 멱등)', () => {
    const keys = investorSeeds.map((s) => `${s.source}:${s.externalId}`);
    expect(new Set(keys).size, '중복 (source, external_id)').toBe(keys.length);
  });

  it('모든 시드는 is_curated=true 이고 displayName 이 비어있지 않다', () => {
    for (const s of investorSeeds) {
      expect(s.isCurated, `${s.slug}.isCurated`).toBe(true);
      expect(s.displayName.trim().length, `${s.slug}.displayName`).toBeGreaterThan(0);
    }
  });

  it('parentSlug(NPS류 이중소스, ADR-0010)는 자기 자신이 아닌 존재하는 slug 를 가리킨다', () => {
    const bySlug = new Map(investorSeeds.map((s) => [s.slug, s]));
    for (const s of investorSeeds) {
      if (s.parentSlug === undefined) continue;
      expect(s.parentSlug, `${s.slug}.parentSlug 자기참조`).not.toBe(s.slug);
      expect(bySlug.has(s.parentSlug), `${s.slug}.parentSlug=${s.parentSlug} 미존재`).toBe(true);
    }
  });

  it('버크셔/NPS-US 가 검증된 CIK 로 포함된다(PLAN 앵커)', () => {
    const bySlug = new Map(investorSeeds.map((s) => [s.slug, s]));
    expect(bySlug.get('berkshire-hathaway')?.externalId).toBe('1067983');
    expect(bySlug.get('nps-us')?.externalId).toBe('1608046');
  });
});
