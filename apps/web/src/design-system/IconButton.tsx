import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'ghost' | 'solid' | 'soft' | 'danger';

const VARIANTS: Record<Variant, string> = {
  ghost: 'bg-transparent text-gray-500 hover:bg-navy-050 hover:text-navy-700',
  solid: 'bg-brand text-white hover:bg-navy-800',
  soft: 'bg-navy-050 text-navy-700 hover:bg-navy-100',
  danger: 'bg-red-050 text-red-500 hover:bg-red-100',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Obrigatório: é o nome acessível do botão (RNF-15.9). */
  label: string;
  variant?: Variant;
  children: ReactNode;
}

export function IconButton({
  label,
  variant = 'ghost',
  type = 'button',
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'press relative inline-flex size-[35px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0',
        'transition-colors duration-[var(--dur-fast)] ease-out',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
