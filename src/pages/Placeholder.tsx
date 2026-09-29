// Honest "not built yet" state for nav destinations outside this first slice
// (Collections/Contributors/Serials/Notes/Import/Activity/Settings are later milestones —
// see ARCHITECTURE_AND_REQUIREMENTS.md §13). Not placeholder *data* — no fake rows are shown.
export function Placeholder({ title }: Readonly<{ title: string }>) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-heading text-fg">{title}</p>
      <p className="text-body text-muted">Not built yet.</p>
    </div>
  );
}
