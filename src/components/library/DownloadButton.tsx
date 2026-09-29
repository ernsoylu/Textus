import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

// FR-READ-6: formats with no in-browser reader (MOBI/AZW3/CBZ, …) are downloadable.
// Private bucket (invariant 7): a 300 s signed URL that forces a download, never getPublicUrl().
export function DownloadButton({ bucket, storagePath }: Readonly<{ bucket: string; storagePath: string }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300, { download: true });
    setBusy(false);
    if (signError || !data) return setError('Could not prepare the download.');
    window.location.assign(data.signedUrl);
  }

  return (
    <>
      <Button variant="secondary" isLoading={busy} onClick={handleClick}>Download</Button>
      {error && <span className="text-small text-red">{error}</span>}
    </>
  );
}
