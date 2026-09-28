import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Figma: "Component library · Textus" → Actions (node 8:5).
// Primary/Secondary/Ghost/Danger are distinct components there; Disabled, Focus and
// Loading are interaction states of the same button, not separate variants here.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-8 px-3 py-3 text-label transition-colors disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-green text-dim hover:bg-green/90',
        secondary: 'bg-raised text-fg hover:bg-raised/80',
        ghost: 'bg-transparent text-fg hover:bg-raised/60',
        danger: 'bg-red text-dim hover:bg-red/90',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, isLoading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant }), isLoading && 'bg-green-bg text-green', className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
