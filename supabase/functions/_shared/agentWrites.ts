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
import { completeStaged, handleFromUrl, MAX_UPLOAD_SIZE, SafeFilename } from '../upload/index.ts';
import { parsePublicUrl } from './publicUrl.ts';
const RequestId = { requestId: z.string().uuid() };
export const CreateFromIdentifier = z.object({ ...RequestId, scheme: z.enum(IDENTIFIER_SCHEMES), value: z.string().min(1).max(300) }).strict();
export const AddFileFromUrl = z.object({ ...RequestId, recordId: z.string().uuid(), url: z.string().url().max(2048).refine((url) => !!parsePublicUrl(url), 'Public URL required'), role: z.enum(['primary','supplement','cover']).default('primary') }).strict();
// Owner-supplied catalog entry (no identifier, so no provider data): names become provisional contributors unless an
// owned contributorId is given (§6.3: names alone never merge identities).
export const CreateWork = z.object({ ...RequestId, title: z.string().trim().min(1).max(500), workType: z.enum(WORK_TYPES).default('book'), language: z.string().max(30).optional(),
  authors: z.array(z.union([z.object({ name: z.string().trim().min(1).max(300) }).strict(), z.object({ contributorId: z.string().uuid() }).strict()])).max(24).default([]) }).strict();
export const UploadFile = z.object({ ...RequestId, recordId: z.string().uuid(), filename: SafeFilename, size: z.number().int().positive().max(MAX_UPLOAD_SIZE), role: z.enum(['primary','supplement','cover']).default('primary') }).strict();
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
  // create_work + two upload_file calls per book; 120/min matches the per-token MCP limit for bulk uploads.
  await rateLimit(admin, `agent-write:${principal.user_id}`, 120);
  const { requestId, ...args } = input;
  let preview: unknown = null;
  if (tool === 'create_work_from_identifier') {
    const prepared = await identifierPreview(principal, client, admin, input, args);
    if ('result' in prepared) return prepared.result;
    preview = prepared.preview;
  } else if (tool === 'create_work') {
    preview = await workPreview(client, CreateWork.parse(input));
  } else if (tool === 'tag_work' || tool === 'add_to_collection') {
    preview = await targetPreview(client, tool, args);
  } else {
    const record = await checked(client.from('records').select('id,title,works(title)').eq('id', args.recordId).maybeSingle());
    if (!record) throw new HttpError('not_found', 404);
    const parent = z.union([z.object({ title: z.string() }),z.array(z.object({ title: z.string() }))]).parse(record.works);
    preview = { recordTitle: record.title ?? (Array.isArray(parent) ? parent[0]?.title : parent.title) };
  }
  const actor = `agent:${principal.token_id}`; // book history attributes these writes to the agent token
  const action = await checked(admin.rpc('request_agent_action', { p_token: principal.token_id, p_request: requestId, p_tool: tool, p_arguments: args, p_preview: preview }).setHeader('x-textus-actor', actor));
  if (action.status === 'done') return action.result;
  // read_write requests are approved on request; only a withdrawn, expired or pre-existing pending request stops here.
  if (action.status !== 'approved' || new Date(action.expires_at).getTime() <= Date.now()) return { status: action.status === 'approved' ? 'expired' : action.status, actionId: action.id, arguments: action.arguments, preview: action.preview, message: 'This request was withdrawn or expired and will not run. Use a new requestId to try again.' };
  const uploadContext = { supabase: client, supabaseAdmin: admin, userId: principal.user_id, agentAction: { id: action.id, tokenId: principal.token_id } };
  if (tool === 'upload_file') return await uploadFile(uploadContext, UploadFile.omit({ requestId: true }).parse(action.arguments));
  if (tool !== 'add_file_from_url') return await checked(admin.rpc('execute_agent_action', { p_action: action.id, p_token: principal.token_id }).setHeader('x-textus-actor', actor));
  // Reuse the pinned public-address downloader and immutable/replayable upload pipeline.
  const response = await handleFromUrl(new Request('https://internal/upload/from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action.arguments, uploadId: action.id }) }), uploadContext, deadline());
  const result = await response.json();
  // Storage/public-fetch failures leave the request approved, so repeating the same requestId retries safely.
  return result;
}

type UploadContext = { supabase: SupabaseClient; supabaseAdmin: SupabaseClient; userId: string; agentAction: { id: string; tokenId: string } };

// §9.1 for bytes the agent holds: the first call issues a signed staging URL (like upload/intent); once the agent has
// PUT the file there, the same requestId and arguments verify, publish and link it (like upload/complete).
async function uploadFile(ctx: UploadContext, args: Omit<z.infer<typeof UploadFile>, 'requestId'>) {
  const id = ctx.agentAction.id, folder = `${ctx.userId}/${id}`;
  const staging = ctx.supabaseAdmin.storage.from('staging');
  const [{ data: uploaded }, { data: frozen }] = await Promise.all([staging.exists(`${folder}/upload`), staging.exists(`${folder}/frozen`)]);
  if (uploaded || frozen) return await (await completeStaged(ctx, { uploadId: id, recordId: args.recordId, role: args.role, filename: args.filename }, deadline())).json();
  const replay = await checked(ctx.supabaseAdmin.rpc('begin_upload', { p_user: ctx.userId, p_id: id, p_record: args.recordId, p_intent: { filename: args.filename, size: args.size, source: 'agent' } }));
  if (replay) return replay;
  const { data, error } = await staging.createSignedUploadUrl(`${folder}/upload`);
  if (error || !data) throw new HttpError('storage_error', 500);
  // Signed URLs from the service client point at the internal gateway; agents need the public API origin.
  const origin = Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL');
  const uploadUrl = new URL(`/storage/v1/object/upload/sign/staging/${data.path}`, origin);
  uploadUrl.searchParams.set('token', data.token);
  return { status: 'upload_required', uploadId: id, method: 'PUT', uploadUrl: uploadUrl.href, headers: { 'Content-Type': 'application/octet-stream' }, expiresInSeconds: 7200,
    message: 'PUT the exact file bytes to uploadUrl (no Authorization header), then call upload_file again with the same requestId and arguments to finish.' };
}

async function workPreview(client: SupabaseClient, input: z.infer<typeof CreateWork>) {
  const ids = input.authors.flatMap((a) => 'contributorId' in a ? [a.contributorId] : []);
  const owned = ids.length ? await checked(client.from('contributors').select('id,kind,display_name,family_name,given_names,particle,suffix,sort_name,match_key').in('id', ids)) ?? [] : [];
  const credits = input.authors.map((author) => {
    if ('contributorId' in author) {
      const c = owned.find((row: { id: string }) => row.id === author.contributorId);
      if (!c) throw new HttpError('not_found', 404);
      return { contributor_id: c.id, kind: c.kind, display_name: c.display_name, family_name: c.family_name, given_names: c.given_names, particle: c.particle, suffix: c.suffix, sort_name: c.sort_name, match_key: c.match_key, role: 'author', credited_as: null, affiliation: null, identifiers: {} };
    }
    const parts = parseName(author.name).parts;
    if (!parts || isJunk(author.name)) throw new HttpError('invalid_contributor');
    const p = parts.kind === 'person' ? parts : null;
    return { kind: parts.kind, display_name: parts.displayName, family_name: p?.familyName ?? null, given_names: p?.givenNames ?? null, particle: p?.particle ?? null, suffix: p?.suffix ?? null, sort_name: parts.sortName, match_key: parts.matchKey, role: 'author', credited_as: author.name === parts.displayName ? null : author.name, affiliation: null, identifiers: {} };
  });
  return { work: { title: input.title, subtitle: null, abstract: null, language: input.language ?? null, work_type: input.workType }, record: { record_type: FIRST_RECORD_TYPE[input.workType] ?? 'issue' }, identifiers: [], credits, tags: [], lockCredits: false };
}

async function identifierPreview(principal: AgentPrincipal, client: SupabaseClient, admin: SupabaseClient, input: { requestId: string } & Record<string, unknown>, args: Record<string, unknown>) {
  const parsed = CreateFromIdentifier.parse(input), id = parseIdentifier(parsed.scheme, parsed.value);
  if (!id.ok) throw new HttpError('invalid_identifier');
  args.value = id.normalized;
  const previous = await checked(admin.from('agent_actions').select('id').eq('user_id', principal.user_id).eq('token_id', principal.token_id).eq('request_id', input.requestId).maybeSingle());
  if (!previous) {
    // Already catalogued: answer like create_catalog would, without spending a provider lookup.
    const known = await checked(client.from('identifiers').select('record_id,records(work_id)').eq('scheme', parsed.scheme).eq('normalized_value', id.normalized).limit(1).maybeSingle());
    const knownRecord = Array.isArray(known?.records) ? known.records[0] : known?.records;
    if (known && knownRecord) return { result: { status: 'existing', workId: knownRecord.work_id, recordId: known.record_id } };
    const response = await lookupAcrossProviders({ supabase: client, supabaseAdmin: admin }, parsed.scheme, id.normalized);
    const metadata = await response.json();
    if (metadata.status !== 'success') return { result: metadata };
    return { preview: catalogPreview(metadata.data, parsed.scheme, id.normalized) };
  }
  return { preview: null };
}

async function targetPreview(client: SupabaseClient, tool: string, args: Record<string, unknown>) {
  const work = await checked(client.from('works').select('title').eq('id', args.workId).maybeSingle());
  const target = await checked(client.from(tool === 'tag_work' ? 'tags' : 'collections').select('name').eq('id', tool === 'tag_work' ? args.tagId : args.collectionId).maybeSingle());
  if (!work || !target) throw new HttpError('not_found', 404);
  return { workTitle: work.title, targetName: target.name };
}
