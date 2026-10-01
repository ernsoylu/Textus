import { supabase } from './supabase';

export const DUPLICATE_REASON_LABELS: Record<string, string> = {
  same_file: 'same file',
  identifier: 'same ISBN, DOI or other identifier',
  title_author: 'similar title, same author',
};

// The same SHA-256 upload/complete computes, so a file already in the library is found before it is uploaded.
// ponytail: reads the whole file into memory (uploads cap at 500 MB); stream through an incremental hasher if that hurts.
export async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The work (other than exceptWorkId) that already holds these bytes as a document. Assets are deduplicated per user
// by checksum (FR-FILE-3); this stops the same file from also becoming a second work.
export async function workWithFile(checksum: string, exceptWorkId?: string): Promise<string | undefined> {
  const { data, error } = await supabase.from('assets').select('record_assets(role, records(work_id))').eq('checksum_sha256', checksum).maybeSingle();
  if (error) throw error;
  return data?.record_assets.find((link) => link.role !== 'cover' && link.role !== 'thumbnail' && link.records && link.records.work_id !== exceptWorkId)?.records?.work_id;
}

// FR-CAT-7: likely-same works, strongest evidence first (see find_duplicate_works).
export async function findDuplicateWorks(workId: string) {
  const { data, error } = await supabase.rpc('find_duplicate_works', { p_work_id: workId });
  if (error) throw error;
  return data;
}
