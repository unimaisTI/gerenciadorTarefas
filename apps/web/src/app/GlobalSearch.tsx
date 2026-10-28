import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { SearchResultDto } from '@hub/shared';
import { Input } from '@/design-system';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

// RF-6.10: busca global por código, título e descrição.
export function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(text.trim());
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [text]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResultDto[]>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  const items = results.data ?? [];

  const go = (r: SearchResultDto) => {
    setOpen(false);
    setText('');
    void navigate(`/tarefas/${r.code}`);
  };

  return (
    <div className="relative">
      <Input
        type="search"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        id="global-search"
        aria-label="Busca global (/)"
        placeholder="Buscar por código, título ou descrição  (/)"
        icon={<Search size={16} strokeWidth={1.75} />}
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
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          if (e.key === 'Enter' && items[active]) go(items[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && debounced.length >= 2 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-12 right-0 left-0 z-40 m-0 max-h-96 list-none overflow-y-auto rounded-sm border border-subtle bg-card p-1 shadow-lg"
        >
          {results.isFetching && !items.length && <li className="p-2.5 text-sm text-muted">Buscando...</li>}
          {!results.isFetching && !items.length && <li className="p-2.5 text-sm text-muted">Nada encontrado.</li>}
          {items.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r);
              }}
              className={cn('cursor-pointer rounded-xs px-2.5 py-2', i === active && 'bg-navy-050')}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-navy-700">{r.code}</span>
                <span className="truncate text-strong">{r.title}</span>
              </div>
              <div className="truncate text-xs text-muted">{r.projectName}{r.snippet ? ` · ${r.snippet}` : ''}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
