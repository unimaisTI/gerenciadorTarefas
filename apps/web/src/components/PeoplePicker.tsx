import { X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { DirectoryUserDto, UserRef } from '@hub/shared';
import { Avatar, Input } from '@/design-system';
import { cn } from '@/lib/cn';
import { useDirectory } from '@/lib/queries';

export interface PeoplePickerProps {
  label: string;
  value: UserRef | null;
  onChange: (user: UserRef | null) => void;
  /** Restringe às pessoas desses departamentos (ex.: responsável = membro do executor). */
  departmentIds?: readonly string[];
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/** Seletor de pessoas com avatar (componente novo da seção 15). Busca por nome. */
export function PeoplePicker({
  label,
  value,
  onChange,
  departmentIds,
  autoFocus,
  disabled,
  placeholder = 'Buscar pessoa',
}: PeoplePickerProps) {
  const directory = useDirectory();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(Boolean(autoFocus));
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const q = norm(text.trim());
    return (directory.data ?? [])
      .filter((u: DirectoryUserDto) => !departmentIds || u.departmentIds.some((d) => departmentIds.includes(d)))
      .filter((u) => !q || norm(u.name).includes(q))
      .slice(0, 8);
  }, [directory.data, text, departmentIds]);

  if (value) {
    return (
      <div className="flex h-10 items-center gap-2.5 rounded-sm border border-subtle bg-white px-2.5">
        <Avatar name={value.name} src={value.avatarUrl} size={24} />
        <span className="flex-1 truncate text-sm">{value.name}</span>
        {!disabled && (
          <button
            type="button"
            aria-label={`Remover ${value.name}`}
            onClick={() => {
              onChange(null);
            }}
            className="flex cursor-pointer border-0 bg-transparent p-1 text-faint hover:text-navy-700"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  const pick = (u: DirectoryUserDto) => {
    onChange({ id: u.id, name: u.name, avatarUrl: u.avatarUrl });
    setText('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => { setOpen(false); }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          if (e.key === 'Enter') {
            e.preventDefault();
            const u = options[active];
            if (u) pick(u);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-11 right-0 left-0 z-40 m-0 max-h-64 list-none overflow-y-auto rounded-sm border border-subtle bg-card p-1 shadow-lg"
        >
          {!options.length && <li className="p-2.5 text-sm text-muted">Ninguém encontrado.</li>}
          {options.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(u);
              }}
              className={cn('flex cursor-pointer items-center gap-2.5 rounded-xs px-2 py-1.5', i === active && 'bg-navy-050')}
            >
              <Avatar name={u.name} src={u.avatarUrl} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-strong">{u.name}</span>
                {u.jobTitle && <span className="block truncate text-xs text-muted">{u.jobTitle}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
