import { Link } from 'react-router-dom';
import { useWorks } from '@/hooks/useWorks';
import { useContinueReading } from '@/hooks/useContinueReading';
import { useContributors } from '@/hooks/useContributors';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useAuth } from '@/hooks/useAuth';
import { greeting, relativeTime } from '@/lib/relativeTime';
import { RecordCard } from '@/components/library/RecordCard';
import { Button } from '@/components/ui/button';

function Welcome() {
  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <p className="text-small text-green">WELCOME</p>
      <p className="font-serif text-title text-fg">Your next chapter starts here.</p>
      <p className="text-body text-muted">Add a book, a paper, or an entire collection.</p>
      <div className="rounded-8 bg-raised p-6">
        <p className="text-heading text-fg">A library that feels like yours.</p>
        <p className="text-body text-muted">Bring your files, look up an identifier, or create your first record by hand.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/library/new"><Button>Upload files</Button></Link>
        <Link to="/import"><Button variant="secondary">Look up an identifier</Button></Link>
        <Link to="/library/new"><Button variant="ghost">Create manually</Button></Link>
      </div>
      <p className="text-small text-muted">PDF, EPUB, MOBI, AZW3 and CBZ supported.</p>
    </div>
  );
}

// Figma "home" and "welcome": a greeting, the book in progress, what was added lately, and a nudge
// when contributor identities are waiting for review. A brand-new library sees the welcome instead.
export function Overview() {
  const { session } = useAuth();
  const works = useWorks();
  const reading = useContinueReading();
  const contributors = useContributors();
  const recent = (works.data ?? []).slice(0, 4);
  const current = reading.data ? works.data?.find((w) => w.workId === reading.data!.workId) : undefined;
  const covers = useCoverUrls([...recent, ...(current ? [current] : [])].flatMap((w) => (w.coverPath ? [w.coverPath] : [])));
  const toReview = (contributors.data ?? []).filter((c) => c.status === 'provisional').length;
  const name: string = session?.user.user_metadata?.display_name || session?.user.email?.split('@')[0] || '';

  if (works.isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (works.error) return <p className="text-body text-red">Could not load your library: {works.error.message}</p>;
  if (!works.data?.length) return <Welcome />;

  return (
    <div className="flex max-w-[1000px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-small text-green">YOUR READING ROOM</p>
        <p className="font-serif text-title text-fg">{greeting(new Date().getHours())}{name ? `, ${name}` : ''}.</p>
        <p className="text-body text-muted">A little space for your next idea.</p>
      </div>

      {reading.data && current && (
        <section className="flex flex-wrap gap-6 rounded-8 bg-raised p-6" aria-label="Continue reading">
          <div className="w-[160px] shrink-0">
            {current.coverPath && covers.data?.get(current.coverPath) ? (
              <img src={covers.data.get(current.coverPath)} alt="" className="h-[230px] w-full rounded-4 object-cover" />
            ) : (
              <div className="flex h-[230px] flex-col justify-between rounded-4 bg-green-bg p-3">
                <p className="text-small text-muted">TEXTUS / LIBRARY</p>
                <p className="text-label text-fg">{current.title}</p>
                <p className="text-small text-fg">{current.byline}</p>
              </div>
            )}
          </div>
          <div className="flex min-w-[240px] flex-1 flex-col justify-center gap-3">
            <p className="text-small text-green">PICK UP WHERE YOU LEFT OFF</p>
            <p className="font-serif text-title text-fg">{current.title}</p>
            {current.byline && <p className="text-body text-fg">{current.byline}</p>}
            <div className="flex items-center justify-between text-body text-fg">
              <span>{Math.round(reading.data.progress)}% complete</span>
              {reading.data.lastReadAt && <span className="text-muted">Last read {relativeTime(reading.data.lastReadAt)}</span>}
            </div>
            <progress aria-label="Reading progress" value={reading.data.progress} max={100} className="h-1 w-full" />
            <div>
              <Link to={`/library/${reading.data.workId}/records/${reading.data.recordId}/assets/${reading.data.assetId}/read`}><Button>Continue reading</Button></Link>
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <p className="text-heading text-fg">Recently added</p>
        <div className="flex flex-wrap gap-6">
          {recent.map((w) => (
            <RecordCard key={w.workId} workId={w.workId} title={w.title} byline={w.byline} meta={w.meta} detail={w.detail} coverUrl={w.coverPath ? covers.data?.get(w.coverPath) : undefined} />
          ))}
        </div>
      </section>

      {toReview > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-8 bg-green-bg p-4">
          <p className="text-body text-fg">{toReview} contributor {toReview === 1 ? 'identity needs' : 'identities need'} a quick review.</p>
          <Link to="/contributors"><Button variant="secondary">Review identities</Button></Link>
        </div>
      )}
    </div>
  );
}
