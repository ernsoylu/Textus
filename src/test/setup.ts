import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Tests use mocked API responses and must not depend on a developer's .env.local.
vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'unit-test-anon-key');

// jsdom has no <dialog> behaviour; model just enough of it for components that use showModal().
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
