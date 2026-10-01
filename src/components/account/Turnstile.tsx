import { useEffect, useRef } from 'react';
import { turnstileSiteKey } from '@/lib/supabase';

// Cloudflare Turnstile for Supabase Auth's CAPTCHA (GOTRUE_SECURITY_CAPTCHA_PROVIDER=turnstile).
// Auth verifies the token server-side; tokens are single-use, so callers bump `resetKey` after each attempt.
// Without VITE_TURNSTILE_SITE_KEY (local development, tests) nothing renders and no token is sent.
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptLoad: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')));
    script.onerror = () => { scriptLoad = null; reject(new Error('Turnstile unavailable')); };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

export function Turnstile({ onToken, resetKey }: Readonly<{ onToken: (token: string | null) => void; resetKey: number }>) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !container.current) return;
      const id = api.render(container.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(null),
        'error-callback': () => callback.current(null),
      });
      widget.current = { api, id };
    }).catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey === 0 || !widget.current) return;
    widget.current.api.reset(widget.current.id);
  }, [resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
