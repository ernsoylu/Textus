import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// Figma: "Input / Default", "Input / Focus", "Input / Error" (node 8:20) — one
// component, three states, matching how real form fields actually behave.
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, id, ...props }, ref) => (
    <div className="flex flex-col gap-2">
      <input
        ref={ref}
        id={id}
        className={cn(
          'w-full rounded-8 border bg-dim p-4 text-body text-fg placeholder:text-muted focus-visible:outline-none',
          error ? 'border-red' : 'border-muted focus:border-green',
          className,
        )}
        aria-invalid={!!error || undefined}
        aria-describedby={error && id ? `${id}-error` : undefined}
        {...props}
      />
      {error && (
        <p id={id ? `${id}-error` : undefined} className="text-small text-red">
          {error}
        </p>
      )}
    </div>
  ),
);
Input.displayName = 'Input';
