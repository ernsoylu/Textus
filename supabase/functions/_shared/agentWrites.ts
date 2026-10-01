import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checked, deadline } from './budget.ts';
import { requireAgentScope, type AgentPrincipal } from './agentAuth.ts';
import { HttpError } from './http.ts';
import { rateLimit } from './limits.ts';
import { IDENTIFIER_SCHEMES, parseIdentifier, validAuthorityIds } from './identifier.ts';
import { isJunk, parseName } from './names.ts';
import { FIRST_RECORD_TYPE, WORK_TYPES } from './recordTypes.ts';
import { lookupAcrossProviders } from '../metadata-lookup/index.ts';
import { handleFromUrl } from '../upload/index.ts';
import { parsePublicUrl } from './publicUrl.ts';
const RequestId = { requestId: z.string().uuid() };
export const CreateFromIdentifier = z.object({ ...RequestId, scheme: z.enum(IDENTIFIER_SCHEMES), value: z.string().min(1).max(300) }).strict();
export const AddFileFromUrl = z.object({ ...RequestId, recordId: z.string().uuid(), url: z.string().url().max(2048).refine((url) => !!parsePublicUrl(url), 'Public URL required'), role: z.enum(['primary','supplement','cover']).default('primary') }).strict();
export const TagWork = z.object({ ...RequestId, workId: z.string().uuid(), tagId: z.string().uuid() }).strict();
export const AddToCollection = z.object({ ...RequestId, workId: z.string().uuid(), collectionId: z.string().uuid() }).strict();
const Metadata = z.object({ title: z.string().trim().min(1).max(500), subtitle: z.string().max(500).nullish(), abstract: z.string().max(10000).nullish(), language: z.string().max(30).nullish(), publisher: z.string().max(500).nullish(), edition: z.string().max(200).nullish(), container_title: z.string().max(500).nullish(), standard_scheme: z.enum(['iso','iec','astm','asme','bs']).nullish(), standard_reference: z.string().max(1000).nullish(), standard_status: z.string().max(500).nullish(), publication_date: z.string().max(30).nullish(), publication_date_precision: z.enum(['year','month','day']).nullish(), volume: z.string().max(100).nullish(), issue_number: z.string().max(100).nullish(), pages: z.string().max(100).nullish(), source_provider: z.string().max(100), work_type: z.enum(WORK_TYPES), contributors: z.array(z.object({ name: z.string().max(300), role: z.enum(['author','editor']), affiliation: z.string().max(500).optional(), identifiers: z.record(z.string()).optional() })).max(24).optional() });
export function catalogPreview(raw: unknown, scheme: string, value: string) {
  const data = Metadata.parse(raw);
  const credits = (data.contributors ?? []).flatMap((person) => {
    const parts = parseName(person.name).parts;
    if (!parts || isJunk(person.name)) return [];
    const p = parts.kind === 'person' ? parts : null;
    return [{ kind: parts.kind, display_name: parts.displayName, family_name: p?.familyName ?? null, given_names: p?.givenNames ?? null, particle: p?.particle ?? null, suffix: p?.suffix ?? null, sort_name: parts.sortName, match_key: parts.matchKey, role: person.role, credited_as: person.name, affiliation: person.affiliation ?? null, identifiers: validAuthorityIds(person.identifiers) }];
  });
  return { work: { title: data.title, subtitle: data.subtitle ?? null, abstract: data.abstract ?? null, language: data.language ?? null, work_type: data.work_type }, record: { record_type: FIRST_RECORD_TYPE[data.work_type] ?? 'issue', publisher: data.publisher ?? null, edition: data.edition ?? null, metadata: { container_title: data.container_title ?? null, standard_scheme: data.standard_scheme ?? null, standard_reference: data.standard_reference ?? null, standard_status: data.standard_status ?? null }, publication_date: data.publication_date ?? null, publication_date_precision: data.publication_date_precision ?? null, volume: data.volume ?? null, issue_number: data.issue_number ?? null, pages: data.pages ?? null, metadata_source: data.source_provider, metadata_fetched_at: new Date().toISOString() }, identifiers: [{ scheme, value }], credits, tags: [], lockCredits: false };
}
export async function agentWrite(principal: AgentPrincipal, client: SupabaseClient, admin: SupabaseClient, tool: string, input: { requestId: string } & Record<string, unknown>) {
  requireAgentScope(principal, 'read_write');
  if (Deno.env.get('MCP_WRITES_ENABLED') !== 'true') throw new HttpError('agent_writes_disabled', 503);
  await rateLimit(admin, `agent-write:${principal.user_id}`, 10);
  const { requestId, ...args } = input;
  let preview: unknown = null;
  if (tool === 'create_work_from_identifier') {
    const parsed = CreateFromIdentifier.parse(input), id = parseIdentifier(parsed.scheme, parsed.value);
    if (!id.ok) throw new HttpError('invalid_identifier');
    args.value = id.normalized;
    const previous = await checked(admin.from('agent_actions').select('id').eq('user_id', principal.user_id).eq('token_id', principal.token_id).eq('request_id', requestId).maybeSingle());
    if (!previous) {
      const response = await lookupAcrossProviders({ supabase: client, supabaseAdmin: admin }, parsed.scheme, id.normalized);
      const metadata = await response.json();
      if (metadata.status !== 'success') return metadata;
      preview = catalogPreview(metadata.data, parsed.scheme, id.normalized);
    }
  } else if (tool === 'tag_work' || tool === 'add_to_collection') {
    const work = await checked(client.from('works').select('title').eq('id', args.workId).maybeSingle());
    const target = await checked(client.from(tool === 'tag_work' ? 'tags' : 'collections').select('name').eq('id', tool === 'tag_work' ? args.tagId : args.collectionId).maybeSingle());
    if (!work || !target) throw new HttpError('not_found', 404);
    preview = { workTitle: work.title, targetName: target.name };
  } else {
    const record = await checked(client.from('records').select('id,title,works(title)').eq('id', args.recordId).maybeSingle());
    if (!record) throw new HttpError('not_found', 404);
    const parent = z.union([z.object({ title: z.string() }),z.array(z.object({ title: z.string() }))]).parse(record.works);
    preview = { recordTitle: record.title ?? (Array.isArray(parent) ? parent[0]?.title : parent.title) };
  }
  const action = await checked(admin.rpc('request_agent_action', { p_token: principal.token_id, p_request: requestId, p_tool: tool, p_arguments: args, p_preview: preview }));
  if (action.status === 'done') return action.result;
  if (action.status !== 'approved' || new Date(action.expires_at).getTime() <= Date.now()) return { status: action.status === 'approved' ? 'expired' : action.status, actionId: action.id, arguments: action.arguments, preview: action.preview, approvalUrl: `${Deno.env.get('TEXTUS_SITE_URL') ?? ''}/settings?tab=agents`, message: 'The owner must review this exact action in Textus. After approval, repeat this tool with the same requestId and arguments. An agent-supplied confirmation cannot approve it.' };
  if (tool !== 'add_file_from_url') return await checked(admin.rpc('execute_agent_action', { p_action: action.id, p_token: principal.token_id }));
  // Reuse the pinned public-address downloader and immutable/replayable upload pipeline.
  const response = await handleFromUrl(new Request('http://internal/upload/from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action.arguments, uploadId: action.id }) }), { supabase: client, supabaseAdmin: admin, userId: principal.user_id, agentAction: { id: action.id, tokenId: principal.token_id } }, deadline());
  const result = await response.json();
  // Storage/public-fetch failures leave approval intact, allowing the same action to retry safely.
  return result;
}
