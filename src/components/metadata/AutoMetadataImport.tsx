import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { importMetadata } from '@/lib/autoMetadataImport';
import { MetadataProgress } from './MetadataProgress';

type Props = { work: Parameters<typeof importMetadata>[0]; record: Parameters<typeof importMetadata>[1]; enabled: boolean };

export function AutoMetadataImport({ work, record, enabled }: Readonly<Props>) {
  const query = useQueryClient();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const started = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    setPending(true);
    void importMetadata(work, record, setMessage).then((outcome) => {
      // The book was already in the library: this work folded into it, so show that one.
      if (outcome?.mergedInto) navigate(`/library/${outcome.mergedInto}`, { replace: true });
    }).finally(() => {
      setPending(false);
      void query.invalidateQueries({ queryKey: ['works'] });
    });
  }, [enabled, navigate, query, record, work]);

  return pending ? <MetadataProgress message={message || 'Searching for metadata…'} /> : message ? <p role="status" className="text-small text-muted">{message}</p> : null;
}
