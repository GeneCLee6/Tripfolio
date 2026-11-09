import { describe, expect, it } from 'vitest';
import { SplitError, allocate, splitExpense, type SplitInput, type SplitMethod } from '../../../shared/money/split';

/** Deterministic PRNG (mulberry32) so the property loops are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Order in which leftover units must be handed out: payer first, then wrap; zero weights skipped. */
function expectedOrder(ids: string[], payerId: string, weights: number[]): number[] {
  const start = Math.max(0, ids.indexOf(payerId));
  const order: number[] = [];
  for (let k = 0; k < ids.length; k++) {
    const i = (start + k) % ids.length;
    if (weights[i]! > 0) order.push(i);
  }
  return order;
}

/** Check floor + remainder rule against an independent computation with rational weights. */
function assertRemainderRule(input: SplitInput, weights: number[], got: number[]): void {
  const ids = input.participants.map((p) => p.memberId);
  const W = sum(weights);
  // Exact floors computed with BigInt on integer weights.
  const floors = weights.map((w) => Number((BigInt(input.amountMinor) * BigInt(w)) / BigInt(W)));
  const leftover = input.amountMinor - sum(floors);
  const order = expectedOrder(ids, input.payerId, weights);
  const expected = [...floors];
  for (let k = 0; k < leftover; k++) expected[order[k % order.length]!]! += 1;
  expect(got).toEqual(expected);
}

describe('splitExpense', () => {
  it('NZD 100 / 3 gives the extra cent to the payer (domain notes §6)', () => {
    const shares = splitExpense({
      amountMinor: 10000,
      payerId: 'c',
      method: 'equal',
      participants: [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }],
    });
    expect(shares).toEqual([
      { memberId: 'a', shareMinor: 3333 },
      { memberId: 'b', shareMinor: 3333 },
      { memberId: 'c', shareMinor: 3334 },
    ]);
  });

  it('leftover units start at the payer and wrap around in participant order', () => {
    const shares = splitExpense({
      amountMinor: 1003,
      payerId: 'c',
      method: 'equal',
      participants: ['a', 'b', 'c', 'd', 'e'].map((memberId) => ({ memberId })),
    });
    // floor = 200, leftover 3 -> c, d, e
    expect(shares.map((s) => s.shareMinor)).toEqual([200, 200, 201, 201, 201]);
    const wrap = splitExpense({
      amountMinor: 1004,
      payerId: 'd',
      method: 'equal',
      participants: ['a', 'b', 'c', 'd', 'e'].map((memberId) => ({ memberId })),
    });
    // leftover 4 -> d, e, a, b
    expect(wrap.map((s) => s.shareMinor)).toEqual([201, 201, 200, 201, 201]);
  });

  it('starts at the first participant when the payer is not a participant or is the pool', () => {
    const parts = ['a', 'b', 'c'].map((memberId) => ({ memberId }));
    expect(splitExpense({ amountMinor: 101, payerId: 'z', method: 'equal', participants: parts }).map((s) => s.shareMinor)).toEqual([34, 34, 33]);
    expect(splitExpense({ amountMinor: 101, payerId: 'pool', method: 'equal', participants: parts }).map((s) => s.shareMinor)).toEqual([34, 34, 33]);
  });

  it('works for 0-decimal currencies (IDR whole rupiah)', () => {
    // IDR 1,000,000 over 3: 333,333 x 3 + 1 leftover to the payer
    const shares = splitExpense({
      amountMinor: 1_000_000,
      payerId: 'b',
      method: 'equal',
      participants: ['a', 'b', 'c'].map((memberId) => ({ memberId })),
    });
    expect(shares.map((s) => s.shareMinor)).toEqual([333_333, 333_334, 333_333]);
  });

  it('shares: a couple counts 2, a child 0.5', () => {
    const shares = splitExpense({
      amountMinor: 10000,
      payerId: 'a',
      method: 'shares',
      participants: [
        { memberId: 'a', weight: 2 },
        { memberId: 'b', weight: 1 },
        { memberId: 'kid', weight: 0.5 },
      ],
    });
    // 10000 * 2/3.5 = 5714.28, 2857.14, 1428.57 -> floors 5714, 2857, 1428 (sum 9999) -> +1 payer a
    expect(shares.map((s) => s.shareMinor)).toEqual([5715, 2857, 1428]);
  });

  it('shares: zero weight never receives a leftover unit', () => {
    const shares = splitExpense({
      amountMinor: 101,
      payerId: 'z',
      method: 'shares',
      participants: [
        { memberId: 'z', weight: 0 },
        { memberId: 'a', weight: 1 },
        { memberId: 'b', weight: 1 },
      ],
    });
    expect(shares.map((s) => s.shareMinor)).toEqual([0, 51, 50]);
  });

  it('percent: tolerates a sum of 99.99 / 100.01 and still sums exactly', () => {
    const a = splitExpense({
      amountMinor: 10000,
      payerId: 'a',
      method: 'percent',
      participants: [
        { memberId: 'a', percent: 33.33 },
        { memberId: 'b', percent: 33.33 },
        { memberId: 'c', percent: 33.33 },
      ],
    });
    expect(a.map((s) => s.shareMinor)).toEqual([3334, 3333, 3333]);
    const b = splitExpense({
      amountMinor: 999,
      payerId: 'b',
      method: 'percent',
      participants: [
        { memberId: 'a', percent: 50.01 },
        { memberId: 'b', percent: 50 },
      ],
    });
    expect(sum(b.map((s) => s.shareMinor))).toBe(999);
  });

  it('percent: rejects sums outside 100 ± 0.01', () => {
    const run = (): unknown =>
      splitExpense({
        amountMinor: 1000,
        payerId: 'a',
        method: 'percent',
        participants: [
          { memberId: 'a', percent: 50 },
          { memberId: 'b', percent: 49.9 },
        ],
      });
    expect(run).toThrow(SplitError);
    try {
      run();
    } catch (e) {
      expect((e as SplitError).code).toBe('percent-sum');
    }
  });

  it('exact: must sum to the total, otherwise throws a typed error', () => {
    expect(
      splitExpense({
        amountMinor: 5000,
        payerId: 'a',
        method: 'exact',
        participants: [
          { memberId: 'a', amountMinor: 3500 },
          { memberId: 'b', amountMinor: 1500 },
        ],
      }).map((s) => s.shareMinor),
    ).toEqual([3500, 1500]);
    try {
      splitExpense({
        amountMinor: 5000,
        payerId: 'a',
        method: 'exact',
        participants: [
          { memberId: 'a', amountMinor: 3500 },
          { memberId: 'b', amountMinor: 1499 },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      expect((e as SplitError).code).toBe('exact-sum');
    }
  });

  it('self: payer takes 100%, pool cannot be a self payer', () => {
    expect(splitExpense({ amountMinor: 1234, payerId: 'b', method: 'self', participants: [] })).toEqual([
      { memberId: 'b', shareMinor: 1234 },
    ]);
    expect(() => splitExpense({ amountMinor: 1, payerId: 'pool', method: 'self', participants: [] })).toThrow(SplitError);
  });

  it('rejects invalid input with typed codes', () => {
    const codeOf = (input: SplitInput): string => {
      try {
        splitExpense(input);
        return 'none';
      } catch (e) {
        return (e as SplitError).code;
      }
    };
    expect(codeOf({ amountMinor: 1.5, payerId: 'a', method: 'equal', participants: [{ memberId: 'a' }] })).toBe('invalid-amount');
    expect(codeOf({ amountMinor: -1, payerId: 'a', method: 'equal', participants: [{ memberId: 'a' }] })).toBe('invalid-amount');
    expect(codeOf({ amountMinor: 1, payerId: 'a', method: 'equal', participants: [] })).toBe('no-participants');
    expect(codeOf({ amountMinor: 1, payerId: 'a', method: 'equal', participants: [{ memberId: 'a' }, { memberId: 'a' }] })).toBe('duplicate-participant');
    expect(codeOf({ amountMinor: 1, payerId: 'a', method: 'shares', participants: [{ memberId: 'a', weight: -1 }] })).toBe('invalid-weight');
    expect(codeOf({ amountMinor: 1, payerId: 'a', method: 'shares', participants: [{ memberId: 'a', weight: 0 }] })).toBe('zero-total-weight');
    expect(codeOf({ amountMinor: 1, payerId: 'a', method: 'percent', participants: [{ memberId: 'a' }] })).toBe('invalid-percent');
    expect(codeOf({ amountMinor: 1, payerId: 'a', method: 'exact', participants: [{ memberId: 'a' }] })).toBe('invalid-exact');
  });

  it('zero amount gives zero shares', () => {
    const s = splitExpense({ amountMinor: 0, payerId: 'a', method: 'equal', participants: [{ memberId: 'a' }, { memberId: 'b' }] });
    expect(s.map((x) => x.shareMinor)).toEqual([0, 0]);
  });

  describe('property: all methods x 2-8 participants keep the sum and the remainder rule', () => {
    const methods: SplitMethod[] = ['equal', 'shares', 'percent', 'exact', 'self'];
    for (const method of methods) {
      for (let n = 2; n <= 8; n++) {
        it(`${method} with ${n} participants`, () => {
          const rand = rng(n * 1000 + methods.indexOf(method));
          for (let iter = 0; iter < 200; iter++) {
            const ids = Array.from({ length: n }, (_, i) => `m${i}`);
            const amountMinor = Math.floor(rand() * 10_000_000) + (iter % 7);
            // payer: participant, outsider, or pool
            const pick = rand();
            const payerId = pick < 0.7 ? ids[Math.floor(rand() * n)]! : pick < 0.85 ? 'outsider' : 'pool';
            if (method === 'equal') {
              const input: SplitInput = { amountMinor, payerId, method, participants: ids.map((memberId) => ({ memberId })) };
              const got = splitExpense(input).map((s) => s.shareMinor);
              expect(sum(got)).toBe(amountMinor);
              assertRemainderRule(input, ids.map(() => 1), got);
            } else if (method === 'shares') {
              // weights in half steps (0, 0.5 ... 3), at least one positive
              const halves = ids.map(() => Math.floor(rand() * 7));
              if (!halves.some((h) => h > 0)) halves[0] = 2;
              const input: SplitInput = {
                amountMinor,
                payerId,
                method,
                participants: ids.map((memberId, i) => ({ memberId, weight: halves[i]! / 2 })),
              };
              const got = splitExpense(input).map((s) => s.shareMinor);
              expect(sum(got)).toBe(amountMinor);
              assertRemainderRule(input, halves, got);
            } else if (method === 'percent') {
              // integer basis points summing to 10000 (= 100.00%)
              const cuts = ids.slice(1).map(() => Math.floor(rand() * 10001)).sort((a, b) => a - b);
              const bps = [...cuts, 10000].map((c, i) => c - (i === 0 ? 0 : cuts[i - 1]!));
              const input: SplitInput = {
                amountMinor,
                payerId,
                method,
                participants: ids.map((memberId, i) => ({ memberId, percent: bps[i]! / 100 })),
              };
              const got = splitExpense(input).map((s) => s.shareMinor);
              expect(sum(got)).toBe(amountMinor);
              if (bps.some((b) => b > 0)) assertRemainderRule(input, bps, got);
            } else if (method === 'exact') {
              const cuts = ids.slice(1).map(() => Math.floor(rand() * (amountMinor + 1))).sort((a, b) => a - b);
              const parts = [...cuts, amountMinor].map((c, i) => c - (i === 0 ? 0 : cuts[i - 1]!));
              const got = splitExpense({
                amountMinor,
                payerId,
                method,
                participants: ids.map((memberId, i) => ({ memberId, amountMinor: parts[i]! })),
              }).map((s) => s.shareMinor);
              expect(got).toEqual(parts);
              expect(sum(got)).toBe(amountMinor);
            } else {
              const payer = payerId === 'pool' ? ids[0]! : payerId;
              const got = splitExpense({ amountMinor, payerId: payer, method, participants: ids.map((memberId) => ({ memberId })) });
              expect(got).toEqual([{ memberId: payer, shareMinor: amountMinor }]);
            }
          }
        });
      }
    }
  });
});

describe('allocate', () => {
  it('distributes proportionally and always sums to the total', () => {
    expect(allocate(10, [1n, 1n, 1n], 0)).toEqual([4, 3, 3]);
    expect(allocate(10, [1n, 1n, 1n], 2)).toEqual([3, 3, 4]);
    expect(allocate(7, [3n, 1n], 0)).toEqual([6, 1]);
  });
  it('rejects zero total weight', () => {
    expect(() => allocate(1, [0n, 0n], 0)).toThrow(RangeError);
  });
});
