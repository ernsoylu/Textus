// Edge Function: delete-account (§8.6, §15 #9). The signed-in user deletes their own account and library.
//
// 'user' auth: the caller is identified by their JWT and can only ever delete themselves. Deleting the
// auth user cascades every table (all user_id foreign keys are ON DELETE CASCADE); storage objects are
// not covered by that, so they are swept right after — and by the daily `cleanup` job if this step fails.
// The service role is needed for auth.admin.deleteUser() and to remove other users' storage prefixes.
import { withSupabase } from '@supabase/server';
import { z } from 'zod';
import { removeUserObjects } from '../job-worker/cleanup.ts';

const RequestSchema = z.object({ confirm: z.literal('DELETE') });

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'confirmation_required' }, { status: 400 });

    const userId = ctx.userClaims!.id;
    const { error } = await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('delete-account: could not delete user', error.message); // technical detail stays server-side
      return Response.json({ error: 'delete_failed' }, { status: 500 });
    }

    let objectsRemoved = 0;
    try {
      objectsRemoved = await removeUserObjects(ctx.supabaseAdmin, userId);
    } catch (e) {
      console.error('delete-account: storage sweep failed; the cleanup job will finish it', e instanceof Error ? e.message : e);
    }
    return Response.json({ status: 'deleted', objectsRemoved });
  }),
};
