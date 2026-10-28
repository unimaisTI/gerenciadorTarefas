import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export function Select({ options, placeholder, invalid = false, className, ...rest }: SelectProps) {
  return (
    <span className="relative block">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          'box-border h-10 w-full cursor-pointer appearance-none rounded-sm border bg-white pr-9 pl-[14px] text-base text-body outline-none',
          'focus:border-navy-400 disabled:cursor-not-allowed disabled:bg-gray-050',
          invalid ? 'border-red-400' : 'border-subtle',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        width="10"
        height="6"
        viewBox="0 0 10 6"
        fill="none"
        className="pointer-events-none absolute top-1/2 right-[14px] -translate-y-1/2"
      >
        <path d="M1 1l4 4 4-4" stroke="var(--gray-400)" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid = false, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        'box-border min-h-24 w-full rounded-sm border bg-white px-[14px] py-2.5 text-base text-body outline-none',
        'placeholder:text-faint focus:border-navy-400',
        invalid ? 'border-red-400' : 'border-subtle',
        className,
      )}
      {...rest}
    />
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, className, checked, ...rest }: CheckboxProps) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2.5 text-sm text-body', className)}>
      <input type="checkbox" checked={checked} className="peer sr-only" {...rest} />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-xs border transition-colors duration-[var(--dur-fast)]',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy-400',
          checked ? 'border-brand bg-brand' : 'border-strong-border bg-white',
        )}
      >
        {checked && (
          <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
            <path d="M1 4l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-body">
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span
        aria-hidden="true"
        className={cn(
          'box-border flex h-[22px] w-[38px] rounded-pill p-0.5 transition-colors duration-[var(--dur-base)]',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy-400',
          checked ? 'bg-brand' : 'bg-gray-300',
        )}
      >
        <span
          className={cn(
            'size-[18px] rounded-full bg-white shadow-sm transition-transform duration-[var(--dur-base)]',
            checked && 'translate-x-4',
          )}
        />
      </span>
      {label}
    </label>
  );
}
