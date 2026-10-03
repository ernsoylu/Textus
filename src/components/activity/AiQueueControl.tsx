import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

// Pauses or starts the owner's AI background work (embeddings, AI metadata) so questions get the shared GPU.
export function AiQueueControl() {
  const { session } = useAuth();
  const client = useQueryClient();
  const setting = useQuery({ queryKey: ['ai', 'queue'], queryFn: async () => {
    const { data, error } = await supabase.from('ai_settings').select('ai_queue_paused').maybeSingle();
    if (error) throw error;
    return data?.ai_queue_paused ?? false;
  } });
  const toggle = useMutation({ mutationFn: async (paused: boolean) => {
    const { error } = await supabase.from('ai_settings').upsert({ user_id: session!.user.id, ai_queue_paused: paused });
    if (error) throw error;
    await Promise.all([client.invalidateQueries({ queryKey: ['ai', 'queue'] }), client.invalidateQueries({ queryKey: ['activity'] })]);
  } });
  const paused = setting.data;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-8 border border-border bg-dim p-4">
      <p role="status" className="text-body text-fg">
        {setting.isLoading ? 'Checking the AI queue…' : paused ? 'AI queue paused. Books wait for AI search; questions get the AI server.' : 'AI queue running. Books are prepared for AI search in the background.'}
      </p>
      {setting.isSuccess && <Button variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(!paused)}>{paused ? 'Start AI queue' : 'Pause AI queue'}</Button>}
      {(setting.error || toggle.error) && <p role="alert" className="text-body text-red">Could not update the AI queue.</p>}
    </div>
  );
}
