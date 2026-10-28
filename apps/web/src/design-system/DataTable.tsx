import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  /** Valor usado para ordenar (RF-5.13); sem ele a coluna não ordena. */
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  caption?: string;
}

function cellText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, caption }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [rows, sort, columns]);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'u-label border-b border-subtle bg-sunken px-5 py-3 font-medium whitespace-nowrap',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-inherit uppercase"
                      onClick={() => {
                        setSort(active && sort.dir === 1 ? { key: c.key, dir: -1 } : active ? null : { key: c.key, dir: 1 });
                      }}
                    >
                      {c.header}
                      {active ? (
                        sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => { onRowClick(r); } : undefined}
              className={cn('transition-colors duration-[var(--dur-fast)] hover:bg-navy-050', onRowClick && 'cursor-pointer')}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'border-b border-subtle px-5 py-3.5 text-body',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    c.className,
                  )}
                >
                  {c.render ? c.render(r) : cellText((r as Record<string, unknown>)[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pages, onChange }: PaginationProps) {
  const btn =
    'h-[35px] cursor-pointer rounded-pill border border-subtle bg-white px-4 text-sm font-medium text-navy-700 disabled:cursor-not-allowed disabled:text-faint';
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-[15px] px-5 py-[15px]">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => { onChange(page - 1); }}>
        Anterior
      </button>
      <span className="text-sm text-muted">
        Página {page} de {Math.max(1, pages)}
      </span>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => { onChange(page + 1); }}>
        Próxima
      </button>
    </nav>
  );
}
