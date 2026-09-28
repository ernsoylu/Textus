import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { uploadIntent, uploadComplete } from '@/lib/functions';

const REJECTION_MESSAGES: Record<string, string> = {
  missing: 'The upload did not arrive. Try again.',
  size_mismatch: 'The file was empty or too large.',
  unsupported_type: "That file type isn't supported.",
};

// FR-FILE-1/2/5, §9.1: intent -> signed upload -> complete. uploadId makes this idempotent —
// a retry after a network failure reuses the same staging path instead of creating a new one.
async function upload(recordId: string, role: 'primary' | 'supplement' | 'cover', file: File) {
  const uploadId = crypto.randomUUID();
  const intent = await uploadIntent({ uploadId, recordId, filename: file.name, size: file.size });

  const { error: uploadError } = await supabase.storage.from('staging').uploadToSignedUrl(intent.path, intent.token, file);
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const result = await uploadComplete({ uploadId, recordId, role });
  if (result.status === 'rejected') {
    throw new Error(REJECTION_MESSAGES[result.reason] ?? 'Upload was rejected.');
  }
  return result;
}

export function useUploadAsset(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, file }: { role: 'primary' | 'supplement' | 'cover'; file: File }) => upload(recordId, role, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['works'] }),
  });
}
