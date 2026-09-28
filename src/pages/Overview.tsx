import { Link } from 'react-router-dom';
import { useWorks } from '@/hooks/useWorks';
import { Button } from '@/components/ui/button';

export function Overview() {
  const { data } = useWorks();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-serif text-title text-fg">A considered home for a curious mind.</p>
        <p className="text-body text-muted">Books, papers and periodicals. One private library.</p>
      </div>
      <p className="text-body text-fg">{data ? `${data.length} work${data.length === 1 ? '' : 's'} in your library.` : ' '}</p>
      <Link to="/library">
        <Button variant="secondary">Go to library</Button>
      </Link>
    </div>
  );
}
