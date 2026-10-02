Textus uses the pinned official TypeScript MCP SDK with stateless Streamable HTTP and JSON responses. AI and MCP are disabled by default. The administrator sets `MCP_ENABLED=true` after deployment checks; AI remains independently optional.

In Textus Settings → Agents, create a named token and copy it once. Read access is the default; expiry choices are 7, 30 or 90 days, or permanent. Each token acts within your own account and can be revoked independently. Save it as `TEXTUS_AGENT_TOKEN` in the private Hermes environment (mode 600). Add this to Hermes `config.yaml`:

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

Write tools are separately disabled unless the administrator sets `MCP_WRITES_ENABLED=true`. Keep Hermes on a read token by default. A deliberately issued `read_write` token can create works from identifiers, import public URLs, tag and add to collections; these apply immediately. Each change appears in the book's history under the token's name, a repeated requestId returns the same result, and revoking the token stops it at once (checked again at the final database write).
