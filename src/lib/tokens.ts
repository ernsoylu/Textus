// A 256-bit secret shown once; only its SHA-256 hash and short prefix are stored (agent and worker tokens).
export async function newSecretToken(prefix: 'tx_' | 'tw_') {
  const token = prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return { token, hash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''), prefix: token.slice(0, 9) };
}
