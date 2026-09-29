// Edge Function: export (§8.4, FR-RES-1). Citations for records the caller owns, as BibTeX, RIS
// or CSL-JSON. 'user' auth: ctx.supabase is RLS-scoped, so ids the caller does not own simply
// come back missing — no separate ownership check, and no service-role access at all.
import { withSupabase } from '@supabase/server';
import { z } from 'zod';
import { buildSource, EXPORT_FORMATS, type RecordRowForCitation } from '../_shared/citations.ts';

const MAX_RECORDS = 500;
const RequestSchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1).max(MAX_RECORDS),
  format: z.enum(['bibtex', 'ris', 'csl-json']),
});

const CREDITS = 'record_contributors ( role, position, contributors ( kind, display_name, family_name, given_names, particle, suffix ) )';
const SELECT = `id, title, record_type, publication_date, publication_date_precision, publisher, edition, volume, issue_number, pages, metadata,
  works ( title, subtitle, abstract, language, work_type ),
  identifiers ( scheme, normalized_value ),
  ${CREDITS},
  container:container_record_id ( title, publisher, publication_date, publication_date_precision, works ( title ), ${CREDITS} )`;

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 });
    const { recordIds, format } = parsed.data;

    const { data, error } = await ctx.supabase.from('records').select(SELECT).in('id', recordIds).returns<RecordRowForCitation[]>();
    if (error) {
      console.error('export: query failed', error.message); // technical detail stays server-side
      return Response.json({ error: 'export_failed' }, { status: 500 });
    }
    if (!data.length) return Response.json({ error: 'not_found' }, { status: 404 });

    const byId = new Map(data.map((r) => [r.id, r]));
    const sources = recordIds.flatMap((id) => (byId.has(id) ? [buildSource(byId.get(id)!)] : []));
    const { render, extension, mime } = EXPORT_FORMATS[format];
    return Response.json({ format, filename: `textus-export.${extension}`, mime, content: render(sources), count: sources.length });
  }),
};
