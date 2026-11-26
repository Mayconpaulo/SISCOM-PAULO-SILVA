import React from 'react';
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * shadcn/ui-pattern composable Button primitive using class-variance-authority.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium select-none cursor-pointer transition-[transform,background,border-color,color,box-shadow,opacity] duration-150 active:scale-[0.975] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
  {
    variants: {
      variant: {
        primary: 'siscom-btn siscom-btn-primary',
        gold: 'siscom-btn siscom-btn-gold',
        secondary: 'siscom-btn siscom-btn-secondary',
        danger: 'siscom-btn siscom-btn-danger',
        ghost:
          'text-[#B8C6BE] hover:text-[#F4E6C4] hover:bg-white/[0.07] border border-transparent',
      },
      size: {
        sm: '!min-h-[36px] !px-3 text-xs',
        md: '!min-h-[42px] !px-4 text-sm',
        lg: '!min-h-[46px] !px-5 text-sm',
        icon: '!min-h-[40px] !w-[40px] sm:!min-h-[38px] sm:!w-[38px] !p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);

Button.displayName = 'Button';
