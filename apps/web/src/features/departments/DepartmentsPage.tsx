import { Building2 } from 'lucide-react';
import { Link } from 'react-router';
import { Card, EmptyState, Spinner } from '@/design-system';
import { useAuth } from '@/lib/auth';
import { useDepartments } from '@/lib/queries';
import { DeptChip, PageHeader } from '@/lib/ui';

export function DepartmentsPage() {
  const { viewer } = useAuth();
  const departments = useDepartments();
  const list = (departments.data ?? []).filter((d) => viewer.seesAllDepartments || viewer.departmentIds.includes(d.id));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Departamentos" subtitle="Projetos, quadros, calendário e painel de cada departamento." />
      {departments.isPending ? (
        <Spinner />
      ) : !list.length ? (
        <Card>
          <EmptyState icon={<Building2 size={32} strokeWidth={1.5} />} title="Você ainda não pertence a um departamento" description="Fale com o administrador." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((d) => (
            <Link key={d.id} to={`/departamentos/${d.id}`} className="no-underline">
              <Card className="h-full transition-transform duration-[var(--dur-base)] hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-center gap-2.5">
                  <DeptChip acronym={d.acronym} color={d.color} />
                  <h2 className="m-0 text-lg font-semibold">{d.name}</h2>
                </div>
                {d.description && <p className="mt-2.5 mb-0 text-sm text-muted">{d.description}</p>}
                <p className="mt-2.5 mb-0 text-xs text-muted">
                  {d.memberCount} membros{d.managers.length ? ` · Gestão: ${d.managers.map((m) => m.name).join(', ')}` : ''}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
