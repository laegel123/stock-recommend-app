import { describe, it, expect } from 'vitest';
import { toInvestorRow, resolveParentLinks } from '../../src/db/seed';
import { investorSeeds, type InvestorSeed } from '../../src/config/investors.seed';

/**
 * 시드 러너의 순수 변환 로직(DB 불필요) 검증.
 * 실제 upsert(seedInvestors)는 Postgres 가 필요하므로 여기선 다루지 않고,
 * 매핑(toInvestorRow)·부모 링크 해결(resolveParentLinks)만 결정적으로 못박는다.
 */

describe('seed runner — 순수 변환(DB 불필요)', () => {
  it('toInvestorRow 는 시드를 investors insert payload 로 매핑(부모 링크 제외)', () => {
    const seed = investorSeeds[0]!;
    const row = toInvestorRow(seed);
    expect(row).toMatchObject({
      slug: seed.slug,
      displayName: seed.displayName,
      type: seed.type,
      source: seed.source,
      externalId: seed.externalId,
      isCurated: true,
    });
    // 부모 링크는 1차 패스 제외(2차 패스에서 id 해결 후 update) — ADR-0010
    expect('parentInvestorId' in row).toBe(false);
  });

  it('resolveParentLinks 는 parentSlug 를 부모 id 로 해결(ADR-0010)', () => {
    const seeds: InvestorSeed[] = [
      {
        slug: 'nps-us',
        displayName: 'National Pension Service (US)',
        type: 'us_13f_manager',
        source: 'edgar',
        externalId: '1608046',
        isCurated: true,
      },
      {
        slug: 'nps-kr',
        displayName: 'National Pension Service (KR)',
        type: 'kr_disclosure_filer',
        source: 'dart',
        externalId: 'dart-nps',
        isCurated: true,
        parentSlug: 'nps-us',
      },
    ];
    const slugToId = new Map([
      ['nps-us', 10],
      ['nps-kr', 11],
    ]);
    expect(resolveParentLinks(seeds, slugToId)).toEqual([{ id: 11, parentInvestorId: 10 }]);
  });

  it('parentSlug 없는 시드는 링크를 만들지 않는다(Phase 0 EDGAR-only)', () => {
    const slugToId = new Map(investorSeeds.map((s, i) => [s.slug, i + 1]));
    expect(resolveParentLinks(investorSeeds, slugToId)).toEqual([]);
  });

  it('slug→id 해결 실패 시 throw(부분 시드 방지)', () => {
    const seeds: InvestorSeed[] = [
      {
        slug: 'child',
        displayName: 'Child',
        type: 'kr_disclosure_filer',
        source: 'dart',
        externalId: 'x',
        isCurated: true,
        parentSlug: 'missing-parent',
      },
    ];
    expect(() => resolveParentLinks(seeds, new Map([['child', 1]]))).toThrow();
  });
});
