import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  invalid?: boolean;
  /** Variante translúcida, só para a tela de login (RNF-15.4). */
  glass?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ icon, invalid = false, glass = false, className, ref, ...rest }: InputProps) {
  return (
    <span className="relative block">
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 left-[14px] flex -translate-y-1/2',
            glass ? 'text-white/75' : 'text-faint',
          )}
        >
          {icon}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'box-border h-10 w-full rounded-sm border text-base outline-none',
          'transition-colors duration-[var(--dur-fast)] ease-out',
          icon ? 'pr-[14px] pl-10' : 'px-[14px]',
          glass
            ? 'border-white/40 bg-white/12 text-white placeholder:text-white/60'
            : 'border-subtle bg-white text-body placeholder:text-faint focus:border-navy-400',
          invalid && 'border-red-400',
          className,
        )}
        {...rest}
      />
    </span>
  );
}
