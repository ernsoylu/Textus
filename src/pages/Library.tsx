import { Link } from 'react-router-dom';
import { useWorks } from '@/hooks/useWorks';
import { RecordCard } from '@/components/library/RecordCard';
import { Button } from '@/components/ui/button';

export function Library() {
  const { data, isLoading, error } = useWorks();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-heading text-fg">Library</p>
        <Link to="/library/new">
          <Button>Add work</Button>
        </Link>
      </div>

      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load your library: {error.message}</p>}
      {data && data.length === 0 && (
        <p className="text-body text-muted">Nothing here yet. Add your first work to get started.</p>
      )}

      <div className="flex flex-wrap gap-6">
        {data?.map((item) => <RecordCard key={item.workId} {...item} />)}
      </div>
    </div>
  );
}
