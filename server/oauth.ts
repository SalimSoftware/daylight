import { createHash, randomBytes } from 'node:crypto';

export function createOAuthTransactions(now = Date.now) {
  const pending = new Map<string, { verifier: string; expires: number }>();
  return {
    create() {
      for (const [state, value] of pending) if (value.expires <= now()) pending.delete(state);
      if (pending.size >= 100) throw new Error('Too many pending sign-ins.');
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      pending.set(state, { verifier, expires: now() + 10 * 60_000 });
      return { state, challenge: createHash('sha256').update(verifier).digest('base64url') };
    },
    consume(state: string | null, browserState: string | undefined) {
      if (!state || !browserState || state !== browserState) return null;
      const value = pending.get(state);
      pending.delete(state);
      return value && value.expires > now() ? value.verifier : null;
    },
  };
}
