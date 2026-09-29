import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { uploadIntent, uploadComplete } from '@/lib/functions';

export type UploadRole = 'primary' | 'supplement' | 'cover';

const REJECTION_MESSAGES: Record<string, string> = {
  missing: 'The upload did not arrive. Try again.',
  size_mismatch: 'The file was empty or too large (limit 500 MB).',
  unsupported_type: 'That file type isn’t supported. Textus accepts PDF, EPUB, MOBI, AZW3 and CBZ (covers: JPEG, PNG, WebP).',
};

// PUT to the signed staging URL with XHR, because fetch cannot report upload progress.
function putWithProgress(path: string, token: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = new URL(`/storage/v1/object/upload/sign/staging/${path}`, supabaseUrl);
    url.searchParams.set('token', token);
    xhr.open('PUT', url);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Upload failed: the connection was interrupted.'));
    xhr.send(file);
  });
}

// FR-FILE-1/2/5, §9.1: intent -> signed upload -> complete. uploadId makes this idempotent —
// a retry after a network failure reuses the same staging path instead of creating a new one.
export async function uploadFile(recordId: string, role: UploadRole, file: File, onProgress: (fraction: number) => void = () => undefined) {
  const uploadId = crypto.randomUUID();
  const intent = await uploadIntent({ uploadId, recordId, filename: file.name, size: file.size });
  await putWithProgress(intent.path, intent.token, file, onProgress);
  const result = await uploadComplete({ uploadId, recordId, role, filename: file.name });
  if (result.status === 'rejected') throw new Error(REJECTION_MESSAGES[result.reason] ?? 'Upload was rejected.');
  return result;
}

export function useUploadAsset(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, file }: { role: UploadRole; file: File }) => uploadFile(recordId, role, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['works'] }),
  });
}
