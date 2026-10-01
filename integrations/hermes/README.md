Textus uses the pinned official TypeScript MCP SDK with stateless Streamable HTTP and JSON responses. AI and MCP are disabled by default. The administrator sets `MCP_ENABLED=true` after deployment checks; AI remains independently optional.

In Textus Settings → Agents, create a read token and copy it once. Save it as `TEXTUS_AGENT_TOKEN` in the private Hermes environment (mode 600). Add this to Hermes `config.yaml`:

```yaml
mcp_servers:
  textus:
    url: https://base.textus.bff.bz/functions/v1/mcp
    transport: http
    headers:
      Authorization: "Bearer ${TEXTUS_AGENT_TOKEN}"
    strict_redirect_headers: true
    connect_timeout: 15
    tool_timeout: 55
```

Install `textus/SKILL.md` as `~/.hermes/skills/textus/SKILL.md`. Restart/reload Hermes, list Textus tools, and search your library. Revoke the token in Textus to stop access immediately. Expired, revoked or disabled-owner tokens never authenticate from a cache. Internal owner JWTs expire after five minutes and are never sent to the agent. Per-token/owner rates, Origin validation, bounded bodies/results and owner RLS apply to every tool request.
