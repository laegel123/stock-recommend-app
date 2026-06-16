import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { investors } from './schema';
import { createDb, type Db } from './client';
import { investorSeeds, type InvestorSeed } from '../config/investors.seed';

/**
 * 큐레이션 투자자 시드 러너(Phase 0 slice 3).
 *
 * 멱등(ADR-0002): `(source, external_id)` 충돌 시 갱신만 하므로 재실행해도 중복 행이 없다.
 * 부모 링크(ADR-0010, NPS류)는 2차 패스에서 slug→id 해결 후 `parent_investor_id` 를 채운다.
 *
 * 순수 변환(`toInvestorRow`·`resolveParentLinks`)은 DB 없이 단위 테스트로 못박고,
 * `seedInvestors` 만 실제 Postgres 연결을 사용한다.
 */

/** 시드 1건 → `investors` insert payload(부모 링크 제외 — 1차 패스). */
export function toInvestorRow(seed: InvestorSeed) {
  return {
    slug: seed.slug,
    displayName: seed.displayName,
    type: seed.type,
    source: seed.source,
    externalId: seed.externalId,
    isCurated: seed.isCurated,
  };
}

/** `parentSlug` 를 실제 부모 id 로 해결(ADR-0010). 미해결이면 부분 시드를 막기 위해 throw. */
export function resolveParentLinks(
  seeds: InvestorSeed[],
  slugToId: Map<string, number>,
): Array<{ id: number; parentInvestorId: number }> {
  const links: Array<{ id: number; parentInvestorId: number }> = [];
  for (const seed of seeds) {
    if (seed.parentSlug === undefined) continue;
    const id = slugToId.get(seed.slug);
    const parentId = slugToId.get(seed.parentSlug);
    if (id === undefined || parentId === undefined) {
      throw new Error(
        `parent 링크 해결 실패: ${seed.slug} → ${seed.parentSlug} (slug→id 매핑 누락)`,
      );
    }
    links.push({ id, parentInvestorId: parentId });
  }
  return links;
}

/** 시드를 멱등 upsert + 부모 링크 적용. 적재/링크 건수를 반환. */
export async function seedInvestors(
  db: Db,
  seeds: InvestorSeed[] = investorSeeds,
): Promise<{ upserted: number; linked: number }> {
  // 1차: (source, external_id) 기준 멱등 upsert
  for (const seed of seeds) {
    await db
      .insert(investors)
      .values(toInvestorRow(seed))
      .onConflictDoUpdate({
        target: [investors.source, investors.externalId],
        set: {
          slug: seed.slug,
          displayName: seed.displayName,
          type: seed.type,
          isCurated: seed.isCurated,
        },
      });
  }

  // 2차: parentSlug → parent_investor_id (ADR-0010, NPS 이중집계 방지)
  const rows = await db.select({ id: investors.id, slug: investors.slug }).from(investors);
  const slugToId = new Map(rows.map((r) => [r.slug, r.id]));
  const links = resolveParentLinks(seeds, slugToId);
  for (const link of links) {
    await db
      .update(investors)
      .set({ parentInvestorId: link.parentInvestorId })
      .where(eq(investors.id, link.id));
  }

  return { upserted: seeds.length, linked: links.length };
}

/** `pnpm db:seed` 직접 실행 시에만 DB 연결(import 시엔 연결·시드 없음). */
const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const db = createDb();
  seedInvestors(db)
    .then(async (r) => {
      console.log(`✓ investors seeded — upserted=${r.upserted}, parent-linked=${r.linked}`);
      await db.$client.end();
      process.exit(0);
    })
    .catch(async (err: unknown) => {
      console.error('✗ investor seed failed:', err);
      await db.$client.end().catch(() => undefined);
      process.exit(1);
    });
}
