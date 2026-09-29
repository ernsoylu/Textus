import { Link } from 'react-router-dom';
import { useSerials } from '@/hooks/useSerials';
import { SerialCompleteness } from '@/components/library/SerialCompleteness';
import { Button } from '@/components/ui/button';

// FR-SER-1/2: journals and magazines, each with what is held and what is missing.
export function Serials() {
  const { data, isLoading, error } = useSerials();
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-heading text-fg">Serials</p>
        <Link to="/library/new"><Button>Add serial</Button></Link>
      </div>
      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load serials: {error.message}</p>}
      {data?.length === 0 && <p className="text-body text-muted">No serials yet. Add a work of type “serial”, then its issues.</p>}
      {data?.map((s) => (
        <section key={s.id} className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <Link to={`/library/${s.id}`} className="text-label text-fg underline">{s.title}</Link>
          <SerialCompleteness issues={s.issues} />
        </section>
      ))}
    </div>
  );
}
