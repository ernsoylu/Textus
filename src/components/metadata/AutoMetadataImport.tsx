import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { importMetadata } from '@/lib/autoMetadataImport';

type Props = { work: Parameters<typeof importMetadata>[0]; record: Parameters<typeof importMetadata>[1]; enabled: boolean };

export function AutoMetadataImport({ work, record, enabled }: Readonly<Props>) {
  const query = useQueryClient();
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void importMetadata(work, record, setMessage).then(() => query.invalidateQueries({ queryKey: ['works'] }));
  }, [enabled, query, record, work]);

  return message ? <p role="status" className="text-small text-muted">{message}</p> : null;
}
