import { checkMcpOrigin, hashAgentToken, requireAgentScope } from './agentAuth.ts';
Deno.test('agent Origin and write scopes fail closed; token hashes are deterministic', async () => {
  const old = Deno.env.get('MCP_ALLOWED_ORIGINS');
  Deno.env.set('MCP_ALLOWED_ORIGINS', 'https://textus.example');
  try {
    checkMcpOrigin(new Request('https://api.example/mcp'));
    checkMcpOrigin(new Request('https://api.example/mcp', { headers: { Origin: 'https://textus.example' } }));
    for (const origin of ['null', 'https://evil.example', 'https://textus.example/path', 'https://textus.example:443']) {
      let rejected = false; try { checkMcpOrigin(new Request('https://api.example/mcp', { headers: { Origin: origin } })); } catch { rejected = true; }
      if (!rejected) throw new Error('invalid Origin accepted');
    }
    let denied = false; try { requireAgentScope({ token_id: 'test', user_id: 'owner', scope: 'read' }, 'read_write'); } catch { denied = true; }
    if (!denied) throw new Error('read token authorized writes');
    const a = await hashAgentToken('tx_' + 'a'.repeat(64));
    if (!/^[0-9a-f]{64}$/.test(a) || a !== await hashAgentToken('tx_' + 'a'.repeat(64))) throw new Error('invalid token hash');
  } finally { if (old === undefined) Deno.env.delete('MCP_ALLOWED_ORIGINS'); else Deno.env.set('MCP_ALLOWED_ORIGINS', old); }
});
