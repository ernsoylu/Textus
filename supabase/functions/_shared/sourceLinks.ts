// All locations come from owned SQL rows, never from book text or model-generated URLs.
export function readerLink(workId: string, recordId: string, assetId: string, page?: number | null, cfi?: string | null, base = '') {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  else if (cfi) query.set('cfi', cfi);
  return `${base.replace(/\/$/, '')}/library/${workId}/records/${recordId}/assets/${assetId}/read?${query}`;
}
