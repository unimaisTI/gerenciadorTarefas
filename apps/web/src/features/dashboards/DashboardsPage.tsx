import { useQueryClient } from '@tanstack/react-query';
import { FileDown, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { addDays, formatDate, permissions, todayIso } from '@hub/shared';
import { Button, Card, EmptyState, Field, Input, Select, Switch, Tabs } from '@/design-system';
import logoBranca from '@/assets/logo-unimais-branca.png';
import { useAuth } from '@/lib/auth';
import { useDepartments, useProjects } from '@/lib/queries';
import { PageHeader } from '@/lib/ui';
import { DashboardView, type DashboardTab } from './DashboardView';

type PeriodPreset = 'week' | 'month' | 'last_month' | 'quarter' | 'year' | 'custom';

function presetRange(p: PeriodPreset, today = todayIso()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = (yy: number, mm: number) => `${String(yy)}-${pad(mm)}-01`;
  const monthEnd = (yy: number, mm: number) => addDays(mm === 12 ? `${String(yy + 1)}-01-01` : monthStart(yy, mm + 1), -1);
  switch (p) {
    case 'week': {
      const day = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
      const from = addDays(today, 1 - day);
      return { from, to: addDays(from, 6) };
    }
    case 'last_month': {
      const yy = m === 1 ? y - 1 : y;
      const mm = m === 1 ? 12 : m - 1;
      return { from: monthStart(yy, mm), to: monthEnd(yy, mm) };
    }
    case 'quarter': {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: monthStart(y, q), to: monthEnd(y, q + 2) };
    }
    case 'year':
      return { from: `${String(y)}-01-01`, to: `${String(y)}-12-31` };
    default:
      return { from: monthStart(y, m), to: monthEnd(y, m) };
  }
}

const TAB_LABELS: Record<DashboardTab, string> = {
  geral: 'Geral',
  departamento: 'Por departamento',
  chamados: 'Chamados',
  pessoas: 'Pessoas',
  fluxo: 'Fluxo',
};

/**
 * Área de Dashboards (RF-10.7 a RF-10.16). Com :id na rota, vira o painel do departamento
 * (RF-10.2 a RF-10.6).
 */
export function DashboardsPage() {
  const { id: fixedDepartment } = useParams();
  const { viewer } = useAuth();
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const [tab, setTab] = useState<DashboardTab>(fixedDepartment ? 'departamento' : 'geral');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [custom, setCustom] = useState(() => presetRange('month'));
  const [departmentId, setDepartmentId] = useState(fixedDepartment ?? '');
  const [projectId, setProjectId] = useState('');
  const [presenting, setPresenting] = useState(false);
  const [rotate, setRotate] = useState(true);
  const [rotateSeconds, setRotateSeconds] = useState(30);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const projects = useProjects(departmentId || undefined);

  const range = preset === 'custom' ? custom : presetRange(preset);
  const filters = useMemo(
    () => ({ ...range, departmentId: departmentId || undefined, projectId: projectId || undefined }),
    [range.from, range.to, departmentId, projectId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Gestor vê a aba Geral e o próprio departamento em detalhe (RF-10.7).
  const allowedDepts = (departments.data ?? []).filter((d) => permissions.viewDepartmentReports(viewer, d.id));
  const institution = permissions.viewInstitutionReports(viewer) || permissions.viewDashboards(viewer);
  const tabs = (Object.keys(TAB_LABELS) as DashboardTab[]).filter((t) => (fixedDepartment ? t !== 'geral' : institution || t !== 'geral'));

  // RF-10.13: troca de aba automática no modo apresentação.
  useEffect(() => {
    if (!presenting || !rotate) return;
    const timer = setInterval(() => {
      setTab((current) => tabs[(tabs.indexOf(current) + 1) % tabs.length] ?? current);
      setUpdatedAt(new Date());
    }, rotateSeconds * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [presenting, rotate, rotateSeconds, tabs]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
    };
    document.addEventListener('keydown', onKey);
    void document.documentElement.requestFullscreen().catch(() => undefined);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [presenting]);

  useEffect(() => {
    const t = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      setUpdatedAt(new Date());
    }, 5 * 60_000);
    return () => {
      clearInterval(t);
    };
  }, [queryClient]);

  if (!fixedDepartment && !institution && !allowedDepts.length) {
    return <Card><EmptyState title="Sem acesso aos painéis" description="Os painéis são para gestores, diretoria e administração." /></Card>;
  }

  const deptName = departments.data?.find((d) => d.id === (fixedDepartment ?? departmentId))?.name;
  const footer = (
    <p className="m-0 text-xs text-muted">
      Período: {formatDate(range.from)} a {formatDate(range.to)} · Atualizado às{' '}
      {updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
    </p>
  );

  const content = (
    <>
      <Tabs label="Painéis" active={tab} onChange={setTab} tabs={tabs.map((t) => ({ id: t, label: TAB_LABELS[t] }))} />
      <DashboardView filters={filters} tab={tab} big={presenting} />
      {footer}
    </>
  );

  if (presenting) {
    return (
      <div className="fixed inset-0 z-[70] overflow-y-auto bg-page p-[30px]">
        <div className="mb-5 flex items-center justify-between gap-5">
          <h1 className="m-0 text-[40px] font-bold">{deptName ? `Painel · ${deptName}` : 'Dashboards UNIMAIS'}</h1>
          <div className="flex items-center gap-5">
            <span className="rounded-sm bg-brand px-[15px] py-2.5">
              <img src={logoBranca} alt="UNIMAIS" className="h-8 w-auto" />
            </span>
            <Button variant="outline" icon={<Minimize2 size={14} />} onClick={() => { setPresenting(false); }}>
              Sair
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-5 [&_.u-label]:text-sm [&_h2]:text-h4">{content}</div>
      </div>
    );
  }

  return (
    <div className="dashboard-print flex flex-col gap-5">
      <PageHeader
        title={fixedDepartment ? `Painel · ${deptName ?? ''}` : 'Dashboards'}
        subtitle="Indicadores calculados no banco; atualizam a cada 5 minutos."
        actions={
          <>
            <Button variant="outline" icon={<FileDown size={14} />} onClick={() => { window.print(); }}>
              Exportar PDF
            </Button>
            <Button icon={<Maximize2 size={14} />} onClick={() => { setPresenting(true); }}>
              Apresentar
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-[15px] print:hidden">
          <Field label="Período" className="w-48">
            <Select
              value={preset}
              options={[
                { value: 'week', label: 'Esta semana' },
                { value: 'month', label: 'Este mês' },
                { value: 'last_month', label: 'Mês anterior' },
                { value: 'quarter', label: 'Trimestre' },
                { value: 'year', label: 'Ano' },
                { value: 'custom', label: 'Intervalo livre' },
              ]}
              onChange={(e) => {
                setPreset(e.target.value as PeriodPreset);
              }}
            />
          </Field>
          {preset === 'custom' && (
            <>
              <Field label="De">
                <Input type="date" value={custom.from} onChange={(e) => { setCustom({ ...custom, from: e.target.value }); }} />
              </Field>
              <Field label="Até">
                <Input type="date" value={custom.to} onChange={(e) => { setCustom({ ...custom, to: e.target.value }); }} />
              </Field>
            </>
          )}
          {!fixedDepartment && (
            <Field label="Departamento" className="w-52">
              <Select
                placeholder={institution ? 'Toda a instituição' : 'Escolha'}
                value={departmentId}
                options={allowedDepts.map((d) => ({ value: d.id, label: d.name }))}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setProjectId('');
                }}
              />
            </Field>
          )}
          <Field label="Projeto" className="w-52">
            <Select
              placeholder="Todos"
              value={projectId}
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              onChange={(e) => {
                setProjectId(e.target.value);
              }}
            />
          </Field>
          <div className="flex items-center gap-2.5">
            <Switch checked={rotate} onChange={setRotate} label="Alternar abas ao apresentar" />
            <Input
              type="number"
              min={10}
              max={600}
              aria-label="Segundos por aba"
              className="w-20"
              value={rotateSeconds}
              onChange={(e) => {
                setRotateSeconds(Math.max(10, Number(e.target.value) || 30));
              }}
            />
            <span className="text-xs text-muted">s</span>
          </div>
        </div>
      </Card>
      {content}
    </div>
  );
}
