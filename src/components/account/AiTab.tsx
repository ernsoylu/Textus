import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiModels, aiStatus } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export function AiTab() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [selection, setSelection] = useState<string>();
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: aiStatus, refetchInterval: 30_000 });
  const models = useQuery({ queryKey: ['ai', 'models'], queryFn: aiModels, enabled: !!status.data?.reachable });
  const save = useMutation({ mutationFn: async () => {
    const { error } = await supabase.from('ai_settings').upsert({ user_id: session!.user.id, generation_model: selection || null });
    if (error) throw error;
    await client.invalidateQueries({ queryKey: ['ai'] });
  } });
  return <div className="flex flex-col gap-4">
    <p className="text-body text-muted">AI runs on your administrator’s local Ollama server. Suggestions need your review; your files remain readable without AI.</p>
    {status.isLoading && <p role="status">Checking availability…</p>}
    {status.error && <p role="alert">Could not check AI availability.</p>}
    {status.data && <>
      <p role="status" className="text-body text-fg">{!status.data.enabled ? 'AI is disabled by the administrator.' : status.data.reachable ? 'Local AI is available.' : 'The local AI server is currently unreachable.'}</p>
      {status.data.reachable && <>
        <label className="text-small text-fg">Generation model
          <select aria-label="Generation model" className="mt-2 w-full rounded-8 border border-border bg-dim p-3" value={selection ?? status.data.selectedModel} onChange={(e) => setSelection(e.target.value)}>
            {!(models.data?.models.some((m) => m.name === status.data?.selectedModel)) && <option value={status.data.selectedModel}>{status.data.selectedModel} (unavailable)</option>}
            {models.data?.models.map((model) => <option key={model.name} value={model.name}>{model.name} {model.parameterSize ? `· ${model.parameterSize}` : ''}</option>)}
          </select>
        </label>
        {models.error && <p role="alert">Could not load approved models.</p>}
        <Button onClick={() => save.mutate()} disabled={!selection || save.isPending}>Save model</Button>
        {save.isSuccess && <p role="status">Model saved.</p>}
        {save.error && <p role="alert">Could not save the model.</p>}
      </>}
      <p className="text-small text-muted">Embedding model: {status.data.embedModel}. The administrator manages this model and reindexing.</p>
    </>}
  </div>;
}
