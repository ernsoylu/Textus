import { checked } from './budget.ts';
import { HttpError } from './http.ts';

Deno.test('database errors preserve timeout status and never stringify arbitrary error codes', async () => {
  const original = console.error;
  const logs: string[] = [];
  console.error = (message: string) => logs.push(message);
  try {
    for (const [code, status] of [['57014', 503], ['23505', 500], [{ secret: 'private data' }, 500]] as const) {
      let caught: unknown;
      try { await checked(Promise.resolve({ data: null, error: { code } })); }
      catch (error) { caught = error; }
      if (!(caught instanceof HttpError) || caught.status !== status) throw new Error('Incorrect database error response');
    }
    if (JSON.parse(logs[2]).code !== 'unknown' || logs.some((line) => line.includes('private data'))) throw new Error('Unsafe error code logged');
    if (await checked(Promise.resolve({ data: 42, error: null })) !== 42) throw new Error('Successful result changed');
  } finally { console.error = original; }
});
