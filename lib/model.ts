// Token launch radar, model version radar-3.
//
// One frozen DefiLlama snapshot goes in; one ranked board of pre-token protocols comes out,
// plus the extra analysis the dashboard renders. The board itself is deliberately kept to the
// shape the gate expects: every watchlist slug, up to EARLY_ROWS extra pre-token protocols
// from below the watchlist floor, one implied value per row, ranks in implied-value order.
//
// How the implied value is built (one shared formula, no name is ever special-cased):
//
//   implied = round( tvl_usd * BASE * growthMult * maturityMult )
//
// BASE is not a guess. The snapshot carries 144 protocols that already have a token; their
// market-cap / TVL ratios have a median of 0.1691, and BASE is that median rounded to 0.17.
// A pre-token protocol is therefore priced the way this same market prices a dollar of TVL
// in protocols it can already trade. growthMult rewards a rising TVL and discounts a falling
// one, with the raw 7-day change clamped so one wild week cannot dominate. maturityMult
// grows with the protocol's age, because a protocol that has run for years without a token
// is a different bet from one that appeared last month.
//
// radar-3 adds three things the ranked board does not need but a reader does, all computed
// from the same ten snapshot fields and shipped only in the dashboard's data:
//   - a launch-readiness score per row (age, scale against the floor, momentum, chain reach);
//   - one plain risk flag per row, the first that applies, never a score in disguise;
//   - per-category calibration stats: how many live-token protocols a category has and the
//     median multiple the market pays there, beside how many pre-token protocols it holds.

/** One protocol exactly as the sealed snapshot carries it: ten fields, no more. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document: its date, its source line, the watchlist floor and the protocols. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The constants of the shared implied-value formula, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.17,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's name; the dashboard prints it next to the formula it runs. */
export const MODEL_VERSION = 'radar-3';

/** Extra pre-token rows the radar carries from below the watchlist floor. */
export const EARLY_ROWS = 160;

/** Live-token rows the dashboard's market view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One step of a farm plan before it is flattened to a single string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json, the deliverable the scorer reads. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row as the dashboard receives it: the board's figures plus radar-3's analysis. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  readiness: number;
  tier: 'ready' | 'building' | 'early';
  risk_note: string;
  category_median_multiple: number | null;
  farm_steps: string[];
}

/** A protocol that already trades: the dashboard shows the market's value, not the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Calibration evidence for one category, from the snapshot's own live-token protocols. */
export interface CategoryStat {
  category: string;
  live_count: number;
  pre_token_count: number;
  median_multiple: number | null;
}

/** Everything data.js carries: the board, the live set, the model, and the calibration. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryStat[];
}

/** Raised when the input is not a snapshot this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A value that is a finite number, or the fallback when it is anything else. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from a protocol's listing date to the snapshot date; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The median of a list of numbers, or null for an empty list. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Per-category calibration: for every category, the median market-cap / TVL ratio of its
 * live-token protocols and how many protocols of each kind it holds. Categories are named
 * by the snapshot; a protocol with no category sits in the null bucket and is not reported.
 */
export function categoryStats(snapshot: Snapshot): CategoryStat[] {
  const buckets = new Map<string, { ratios: number[]; live: number; pre: number }>();
  for (const p of snapshot.protocols) {
    if (p.category === null) continue;
    let bucket = buckets.get(p.category);
    if (bucket === undefined) {
      bucket = { ratios: [], live: 0, pre: 0 };
      buckets.set(p.category, bucket);
    }
    if (isPreToken(p)) {
      bucket.pre += 1;
    } else {
      bucket.live += 1;
      if (p.tvl_usd > 0 && p.mcap_usd !== null) bucket.ratios.push(p.mcap_usd / p.tvl_usd);
    }
  }
  const stats: CategoryStat[] = [];
  for (const [category, bucket] of buckets) {
    stats.push({
      category,
      live_count: bucket.live,
      pre_token_count: bucket.pre,
      median_multiple: medianOf(bucket.ratios),
    });
  }
  stats.sort((a, b) => b.live_count + b.pre_token_count - (a.live_count + a.pre_token_count) || (a.category < b.category ? -1 : 1));
  return stats;
}

/** The pieces of one protocol's implied value under the shared formula. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finiteOr(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/**
 * Launch readiness, 0 to 100, for the dashboard only. It answers a different question from
 * the implied value: not "what would the token be worth" but "how much evidence is there
 * that a launch is a live possibility at all". Age carries the most weight (a token is a
 * decision a team makes after it has something to show), then scale against the watchlist
 * floor, then this week's momentum, then chain reach.
 */
export function readinessScore(protocol: SnapshotProtocol, asOf: string, floorUsd: number): number {
  const age = ageDays(asOf, protocol.listed_at) ?? MODEL.unknown_age_days;
  const agePart = (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * 40;
  const scalePart = (Math.min(protocol.tvl_usd / floorUsd, 2) / 2) * 30;
  const growth = Math.min(Math.max(finiteOr(protocol.change_7d, 0), 0), 20);
  const momentumPart = (growth / 20) * 20;
  const reachPart = (Math.min(protocol.chains.length, 4) / 4) * 10;
  return Math.round(agePart + scalePart + momentumPart + reachPart);
}

/** The readiness tier a score falls in: the dashboard groups and filters by it. */
export function readinessTier(score: number): 'ready' | 'building' | 'early' {
  if (score >= 60) return 'ready';
  if (score >= 35) return 'building';
  return 'early';
}

/**
 * One plain risk flag for a row: the first that applies, in the order a farmer would want
 * to hear them. It is a reading of the snapshot's own fields, never a hidden score.
 */
export function riskNote(protocol: SnapshotProtocol, asOf: string): string {
  if (protocol.change_7d !== null && protocol.change_7d <= -20) {
    return `TVL fell ${Math.abs(protocol.change_7d)}% in the snapshot's last 7 days: momentum is against it this week.`;
  }
  const age = ageDays(asOf, protocol.listed_at);
  if (age !== null && age < 90) {
    return `Listed only ${age} days before the snapshot: a very new protocol with a short record.`;
  }
  if (protocol.listed_at === null) {
    return 'The snapshot gives no listing date for it, so its age and track record cannot be checked from this data.';
  }
  if (protocol.tvl_usd < 10_000_000) {
    return 'Small TVL next to the rest of the board: an early position, sized like one.';
  }
  if (protocol.chains.length <= 1) {
    return 'Runs on a single chain in the snapshot: no second market to fall back on.';
  }
  if (protocol.change_7d === null) {
    return 'The snapshot reports no 7-day TVL change for it, so there is no momentum reading either way.';
  }
  return 'No flag from the snapshot: size, age, momentum and chain reach all read ordinary.';
}

/** DefiLlama's version marker: a name ending in a release number is another protocol's pool. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the snapshot records no token for the protocol at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank the protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

/** The ranked board: watchlist first as the floor, then the early radar, all by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar picks by the model's own implied value, not by raw TVL: a smaller
  // protocol that is growing and has had years to build outranks a larger shrinking one,
  // and a radar that sorted by size alone would never show it.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A farm step flattened to one string, held inside the gate's 20..600 character window. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, stepped by the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long a position should be held, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The one concrete opening action for a protocol's category, in a farmer's words. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps built from its own record — its chains, its category,
 * its size, its age and this week's momentum — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const reach =
    p.chains.length > 1
      ? ` It runs on ${p.chains.length} chains; farm it on ${chain}, where its record starts, and ignore the rest until the first position is counted.`
      : '';
  const momentum =
    p.change_7d === null
      ? 'The snapshot reports no 7-day TVL change for it, so size the position at the low end until a trend is visible.'
      : p.change_7d >= 0
        ? `Its TVL grew ${p.change_7d}% in the last 7 days of the snapshot: momentum is on your side, but do not chase it with a larger position than the plan states.`
        : `Its TVL fell ${Math.abs(p.change_7d)}% in the last 7 days of the snapshot: start with half the stated capital and add the rest only if the trend turns.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.${reach}`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Before depositing anything, open ${p.name}'s own documentation and check whether it runs a points or rewards programme and which actions it counts; if it counts none of the actions below, follow its list instead of this one.`,
      cost: 'nothing to read, and never pay for access to a points page',
      time: '15 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, rotating a deposit, a borrow, a swap and a vote where ${p.name} offers them, so the wallet reads as a real user and not a one-off visitor. ${momentum}`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and re-check the position after any week in which TVL moves more than 20% either way.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Watch ${p.name}'s official announcements for a token, snapshot or claim date; when one is published, claim only from the link the protocol itself publishes, then write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols for the dashboard's market view, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row in dashboard form, with radar-3's readiness, risk flag and calibration. */
export function radarRow(row: BoardRow, snapshot: Snapshot, medians: Map<string, number | null>): RadarRow {
  const protocol = snapshot.protocols.find((p) => p.slug === row.slug)!;
  const readiness = readinessScore(protocol, snapshot.as_of, snapshot.floor_usd);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    readiness,
    tier: readinessTier(readiness),
    risk_note: riskNote(protocol, snapshot.as_of),
    category_median_multiple: row.category === null ? null : (medians.get(row.category) ?? null),
    farm_steps: row.farm_steps,
  };
}

/** The whole dashboard dataset: board, live set, model and per-category calibration. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const categories = categoryStats(snapshot);
  const medians = new Map(categories.map((c) => [c.category, c.median_multiple]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: liveRows(snapshot).length,
    rows: board.map((row) => radarRow(row, snapshot, medians)),
    live: liveRows(snapshot),
    categories,
  };
  return { board, radar };
}

/** Parse a snapshot file's text, refusing anything that is not the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board fails the gate, or null when it passes: coverage, ranks, order, values, plans. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
