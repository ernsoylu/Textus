import { Button } from '@/components/ui/button';

// FR-READ-11: after a jump (contents, search, page overview, a note), one tap returns to where reading was.
export function ReturnButton({ label, onReturn, onDismiss }: Readonly<{ label: string; onReturn: () => void; onDismiss: () => void }>) {
  return (
    <div className="absolute bottom-3 left-3 z-20 flex items-center rounded-8 border border-border bg-raised shadow-lg">
      <Button variant="ghost" className="min-h-11 px-3" onClick={onReturn}>↩ {label}</Button>
      <Button variant="ghost" className="min-h-11 min-w-11 px-2" aria-label="Dismiss" onClick={onDismiss}>×</Button>
    </div>
  );
}
