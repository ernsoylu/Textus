import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

// Figma "notfound".
export function NotFound() {
  return (
    <div className="flex max-w-[424px] flex-col gap-3">
      <p className="text-small text-green">404</p>
      <p className="font-serif text-title text-fg">That page isn’t on the shelf.</p>
      <p className="text-body text-muted">The link may be old, or the item may have been deleted.</p>
      <div className="flex gap-2">
        <Link to="/library"><Button>Go to library</Button></Link>
        <Link to="/"><Button variant="secondary">Home</Button></Link>
      </div>
    </div>
  );
}
