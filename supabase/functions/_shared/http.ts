const MAX_RESPONSE_BYTES = 5_000_000;

export async function readCapped(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) throw new Error('provider response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('provider returned no body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('provider response too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export class HttpError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
