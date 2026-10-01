import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { findSources } from '@/lib/functions';
import { Button } from '@/components/ui/button';
export function SourceSearch() {
  const [question, setQuestion] = useState('');
  const search = useMutation({ mutationFn: () => findSources(question) });
  return <section className="flex flex-col gap-3" aria-label="Find supporting sources">
    <p className="text-body text-fg">Find supporting sources in your library</p>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search.mutate(); }}>
      <input aria-label="Question for your library" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} className="min-w-0 flex-1 rounded-8 border border-border bg-dim p-2" />
      <Button disabled={question.trim().length < 3 || search.isPending}>Find sources</Button>
    </form>
    {search.isPending && <p role="status">Searching indexed passages…</p>}
    {search.error && <p role="alert">Could not retrieve sources. You can still use passage search.</p>}
    {search.data && <>
      <p role="status" className="text-small text-muted">{search.data.verified ? 'Quotes checked against stored text; assess their relevance before citing.' : 'Full-text matches; support was not verified by the model.'} {search.data.coverage.indexedAssets}/{search.data.coverage.eligibleAssets} files fully indexed.{search.data.coverage.partial ? ' Coverage is partial.' : ''}</p>
      {search.data.warning && <p className="text-small text-muted">{search.data.warning}</p>}
      {!search.data.sources.length && <p role="status">No supporting passage found in indexed text. This does not establish that your library contains none.</p>}
      <ul className="flex flex-col gap-3">{search.data.sources.map((source, i) => <li key={`${source.assetId}:${i}`}>
        <a href={source.link} className="text-green underline">{source.title}{source.byline ? ` · ${source.byline}` : ''}{source.year ? ` (${source.year})` : ''}{source.page ? ` · page ${source.pageLabel ?? source.page}` : ''}</a>
        <blockquote className="text-small text-fg">{source.quote}</blockquote>
      </li>)}</ul>
    </>}
  </section>;
}
