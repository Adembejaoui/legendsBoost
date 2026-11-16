/* eslint-disable @typescript-eslint/no-explicit-any -- test double */
/**
 * Minimal stateful stand-in for the Prisma calls made by the Riot sync:
 * conditional updateMany (equality, null, {lt}, OR), unique (orderId,
 * matchId) with skipDuplicates, and $transaction with rollback.
 */
export interface FakeMatchRow {
  id: string;
  orderId: string;
  matchId: string;
  [k: string]: unknown;
}

function matches(row: any, where: any): boolean {
  for (const [k, cond] of Object.entries(where ?? {})) {
    if (k === "OR") {
      if (!(cond as any[]).some((c) => matches(row, c))) return false;
      continue;
    }
    const v = row[k];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("lt" in (cond as any)) {
        if (!(v instanceof Date) || !(v < (cond as any).lt)) return false;
        continue;
      }
      if ("in" in (cond as any)) {
        if (!(cond as any).in.includes(v)) return false;
        continue;
      }
    }
    if (cond instanceof Date) {
      if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false;
    } else if ((v ?? null) !== cond) return false;
  }
  return true;
}

export function createFakeDb(seed: { order: any; account: any; matches?: FakeMatchRow[] }) {
  const state = {
    order: seed.order,
    account: seed.account ? { pendingMatchIds: [], ...seed.account } : null,
    matches: [...(seed.matches ?? [])] as FakeMatchRow[],
  };
  let seq = 0;
  const calls = { updateMany: [] as any[], createMany: [] as any[], transactions: 0, rollbacks: 0 };

  const api: any = {
    order: {
      findUnique: async () => (state.order ? { ...state.order, riotAccount: state.account && { ...state.account } } : null),
    },
    orderRiotAccount: {
      updateMany: async ({ where, data }: any) => {
        calls.updateMany.push({ where, data });
        if (!state.account || !matches(state.account, where)) return { count: 0 };
        state.account = { ...state.account, ...data };
        return { count: 1 };
      },
    },
    orderMatch: {
      findMany: async ({ where }: any) => state.matches.filter((m) => matches(m, where)),
      count: async ({ where }: any) => state.matches.filter((m) => matches(m, where)).length,
      createMany: async ({ data }: any) => {
        calls.createMany.push(data);
        let count = 0;
        for (const d of data) {
          if (state.matches.some((m) => m.orderId === d.orderId && m.matchId === d.matchId)) continue;
          state.matches.push({ id: `m${++seq}`, ...d });
          count++;
        }
        return { count };
      },
    },
    $transaction: async (cb: (tx: any) => Promise<unknown>) => {
      calls.transactions++;
      const snapshot = { account: state.account && { ...state.account }, matches: [...state.matches] };
      try {
        return await cb(api);
      } catch (e) {
        calls.rollbacks++;
        state.account = snapshot.account;
        state.matches = snapshot.matches;
        throw e;
      }
    },
  };
  return { db: api, state, calls };
}
