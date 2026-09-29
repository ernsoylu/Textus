import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { importMetadata } from '@/lib/autoMetadataImport';
import { MetadataProgress } from './MetadataProgress';

type Props = { work: Parameters<typeof importMetadata>[0]; record: Parameters<typeof importMetadata>[1]; enabled: boolean };

export function AutoMetadataImport({ work, record, enabled }: Readonly<Props>) {
  const query = useQueryClient();
  const [message, setMessage] = useState('');
  const started = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    setPending(true);
    void importMetadata(work, record, setMessage).finally(() => {
      setPending(false);
      void query.invalidateQueries({ queryKey: ['works'] });
    });
  }, [enabled, query, record, work]);

  return pending ? <MetadataProgress message={message || 'Searching for metadata…'} /> : message ? <p role="status" className="text-small text-muted">{message}</p> : null;
}
