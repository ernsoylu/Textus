export function MetadataProgress({ message }: Readonly<{ message?: string }>) {
  return message ? <output className="flex w-full flex-col gap-1 text-small text-muted">
    <span>{message}</span>
    <progress aria-label={message} className="h-2 w-full accent-green" />
  </output> : null;
}
