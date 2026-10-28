import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'inverse';
type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, string> = {
  sm: 'h-[30px] px-[14px] text-button',
  md: 'h-[35px] px-[18px] text-button',
  lg: 'h-10 px-6 text-base',
};

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white border-brand hover:bg-navy-800 hover:border-navy-800',
  // Vermelho é racionado: uma ação "accent" por tela, no máximo (RNF-15.5).
  accent: 'bg-accent text-white border-accent hover:bg-red-600 hover:border-red-600',
  outline: 'bg-transparent text-navy-700 border-navy-700 hover:bg-navy-050',
  ghost: 'bg-transparent text-navy-700 border-transparent hover:bg-navy-050',
  inverse: 'bg-white text-navy-700 border-white hover:bg-navy-050',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  block = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'press inline-flex items-center justify-center gap-2.5 rounded-pill border font-semibold leading-none',
        'cursor-pointer transition-colors duration-[var(--dur-fast)] ease-out',
        'disabled:cursor-not-allowed disabled:opacity-45',
        SIZES[size],
        VARIANTS[variant],
        block && 'flex w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
