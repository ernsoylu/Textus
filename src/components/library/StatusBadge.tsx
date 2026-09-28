import { cn } from '@/lib/utils';
import type { AssetRow } from '@/types';

// Figma: "Status / Ready|Needs review|Failed" (node 8:76). FR-FILE-6 has four processing
// states; pending/processing share the "needs review" visual (amber) since Figma only
// designed three status colors, but the label stays accurate to the real state.
const STATUS: Record<AssetRow['processing_state'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-bg text-yellow' },
  processing: { label: 'Processing…', className: 'bg-yellow-bg text-yellow' },
  ready: { label: 'Ready', className: 'bg-green-bg text-green' },
  failed: { label: 'Failed', className: 'bg-red-bg text-red' },
};

export function StatusBadge({ state }: { state: AssetRow['processing_state'] }) {
  const { label, className } = STATUS[state];
  return <span className={cn('inline-block rounded-8 p-3 text-label', className)}>{label}</span>;
}
