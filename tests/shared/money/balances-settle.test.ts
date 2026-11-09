import { describe, expect, it } from 'vitest';
import { BalanceError, computeBalances, poolBalance, type BalanceExpense, type BalancesInput } from '../../../shared/money/balances';
import { SettleError, suggestSettlements } from '../../../shared/money/settle';
import { splitExpense } from '../../../shared/money/split';

const members = (ids: string[]) => ids.map((id) => ({ id }));

function equalExpense(payerId: string, baseMinor: number, ids: string[]): BalanceExpense {
  return {
    payerId,
    baseMinor,
    shares: splitExpense({ amountMinor: baseMinor, payerId, method: 'equal', participants: ids.map((memberId) => ({ memberId })) }),
  };
}

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

describe('computeBalances', () => {
  it('basic: payer gets back, others owe; nets sum to zero', () => {
    const ids = ['a', 'b', 'c'];
    const b = computeBalances({
      members: members(ids),
      expenses: [equalExpense('a', 9000, ids)],
      poolContributions: [],
      settlements: [],
      poolRefund: 'proportional',
    });
    expect(b.map((r) => r.netMinor)).toEqual([6000, -3000, -3000]);
    expect(b[0]).toMatchObject({ paidMinor: 9000, owedMinor: 3000 });
  });

  it('settlements move the balance (from: +, to: -)', () => {
    const ids = ['a', 'b'];
    const b = computeBalances({
      members: members(ids),
      expenses: [equalExpense('a', 1000, ids)],
      poolContributions: [],
      settlements: [{ from: 'b', to: 'a', amountMinor: 300 }],
      poolRefund: 'equal',
    });
    expect(b.map((r) => r.netMinor)).toEqual([200, -200]);
    expect(b[1]).toMatchObject({ settledOutMinor: 300, settledInMinor: 0 });
    expect(b[0]).toMatchObject({ settledOutMinor: 0, settledInMinor: 300 });
  });

  const poolCase = (poolRefund: 'proportional' | 'equal'): BalancesInput => ({
    members: members(['a', 'b', 'c']),
    // a puts in 600, b 300, c nothing; pool pays 600 for all three
    poolContributions: [
      { memberId: 'a', baseMinor: 400 },
      { memberId: 'a', baseMinor: 200 },
      { memberId: 'b', baseMinor: 300 },
    ],
    expenses: [equalExpense('pool', 600, ['a', 'b', 'c'])],
    settlements: [],
    poolRefund,
  });

  it('pool: proportional refund of the remaining balance', () => {
    const input = poolCase('proportional');
    expect(poolBalance(input)).toBe(300);
    const b = computeBalances(input);
    expect(b.map((r) => r.poolInMinor)).toEqual([600, 300, 0]);
    // remaining 300 refunded 2:1
    expect(b.map((r) => r.poolBackMinor)).toEqual([200, 100, 0]);
    // net = poolIn - poolBack - owed(200 each)
    expect(b.map((r) => r.netMinor)).toEqual([200, 0, -200]);
    expect(b.reduce((s, r) => s + r.netMinor, 0)).toBe(0);
  });

  it('pool: equal refund among contributors', () => {
    const b = computeBalances(poolCase('equal'));
    expect(b.map((r) => r.poolBackMinor)).toEqual([150, 150, 0]);
    expect(b.map((r) => r.netMinor)).toEqual([250, -50, -200]);
  });

  it('pool: proportional refund with a remainder follows member order', () => {
    const b = computeBalances({
      members: members(['a', 'b', 'c']),
      poolContributions: ['a', 'b', 'c'].map((memberId) => ({ memberId, baseMinor: 1000 })),
      expenses: [equalExpense('pool', 2999, ['a', 'b', 'c'])],
      settlements: [],
      poolRefund: 'proportional',
    });
    expect(b.map((r) => r.poolBackMinor)).toEqual([1, 0, 0]);
    expect(b.reduce((s, r) => s + r.netMinor, 0)).toBe(0);
  });

  it('pool: an overdrawn pool charges the deficit to contributors', () => {
    const b = computeBalances({
      members: members(['a', 'b']),
      poolContributions: [{ memberId: 'a', baseMinor: 100 }],
      expenses: [equalExpense('pool', 300, ['a', 'b'])],
      settlements: [],
      poolRefund: 'proportional',
    });
    expect(b.map((r) => r.poolBackMinor)).toEqual([-200, 0]);
    expect(b.map((r) => r.netMinor)).toEqual([150, -150]);
  });

  it('pool with 0-decimal base (IDR)', () => {
    const ids = ['a', 'b', 'c'];
    const b = computeBalances({
      members: members(ids),
      poolContributions: ids.map((memberId) => ({ memberId, baseMinor: 500_000 })),
      expenses: [equalExpense('pool', 1_000_000, ids), equalExpense('a', 100_000, ids)],
      settlements: [],
      poolRefund: 'proportional',
    });
    expect(b.reduce((s, r) => s + r.poolBackMinor, 0)).toBe(500_000);
    expect(b.reduce((s, r) => s + r.netMinor, 0)).toBe(0);
  });

  it('rejects unknown members and inconsistent shares', () => {
    const base = { members: members(['a']), poolContributions: [], settlements: [], poolRefund: 'equal' as const };
    expect(() => computeBalances({ ...base, expenses: [equalExpense('x', 100, ['a'])] })).toThrow(BalanceError);
    expect(() =>
      computeBalances({ ...base, expenses: [{ payerId: 'a', baseMinor: 100, shares: [{ memberId: 'a', shareMinor: 99 }] }] }),
    ).toThrow(BalanceError);
  });
});

describe('suggestSettlements', () => {
  it('greedy pairs the largest creditor with the largest debtor', () => {
    const t = suggestSettlements([
      { memberId: 'a', netMinor: 500 },
      { memberId: 'b', netMinor: -300 },
      { memberId: 'c', netMinor: -200 },
    ]);
    expect(t).toEqual([
      { from: 'b', to: 'a', amountMinor: 300 },
      { from: 'c', to: 'a', amountMinor: 200 },
    ]);
  });

  it('breaks ties by member id', () => {
    const t = suggestSettlements([
      { memberId: 'd', netMinor: 100 },
      { memberId: 'c', netMinor: 100 },
      { memberId: 'b', netMinor: -100 },
      { memberId: 'a', netMinor: -100 },
    ]);
    expect(t).toEqual([
      { from: 'a', to: 'c', amountMinor: 100 },
      { from: 'b', to: 'd', amountMinor: 100 },
    ]);
  });

  it('returns nothing when everyone is settled and throws on a non-zero sum', () => {
    expect(suggestSettlements([{ memberId: 'a', netMinor: 0 }])).toEqual([]);
    expect(() => suggestSettlements([{ memberId: 'a', netMinor: 1 }])).toThrow(SettleError);
  });

  for (let n = 2; n <= 8; n++) {
    it(`zeroes every balance with at most n-1 transfers (${n} members, random trips)`, () => {
      const rand = rng(42 + n);
      for (let iter = 0; iter < 100; iter++) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`);
        const expenses: BalanceExpense[] = [];
        for (let k = 0; k < 1 + Math.floor(rand() * 10); k++) {
          const payer = rand() < 0.2 ? 'pool' : ids[Math.floor(rand() * n)]!;
          const parts = ids.filter(() => rand() < 0.7);
          if (parts.length === 0) parts.push(ids[0]!);
          expenses.push(equalExpense(payer, 1 + Math.floor(rand() * 100_000), parts));
        }
        const balances = computeBalances({
          members: members(ids),
          expenses,
          poolContributions: ids.filter(() => rand() < 0.6).map((memberId) => ({ memberId, baseMinor: Math.floor(rand() * 50_000) })),
          settlements: [],
          poolRefund: rand() < 0.5 ? 'proportional' : 'equal',
        });
        const transfers = suggestSettlements(balances);
        const after = new Map(balances.map((b) => [b.memberId, b.netMinor]));
        for (const tr of transfers) {
          expect(tr.amountMinor).toBeGreaterThan(0);
          after.set(tr.from, after.get(tr.from)! + tr.amountMinor);
          after.set(tr.to, after.get(tr.to)! - tr.amountMinor);
        }
        for (const v of after.values()) expect(v).toBe(0);
        expect(transfers.length).toBeLessThanOrEqual(n - 1);
        // deterministic
        expect(suggestSettlements(balances)).toEqual(transfers);
      }
    });
  }

  it('recording suggested transfers as settlements zeroes computeBalances', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const input: BalancesInput = {
      members: members(ids),
      expenses: [equalExpense('a', 12345, ids), equalExpense('b', 6789, ['b', 'c']), equalExpense('pool', 4000, ids)],
      poolContributions: [
        { memberId: 'c', baseMinor: 3000 },
        { memberId: 'd', baseMinor: 2000 },
      ],
      settlements: [],
      poolRefund: 'proportional',
    };
    const transfers = suggestSettlements(computeBalances(input));
    const after = computeBalances({ ...input, settlements: transfers });
    expect(after.map((r) => r.netMinor)).toEqual([0, 0, 0, 0]);
  });
});
