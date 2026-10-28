import type { Role } from './enums';

/**
 * Matriz de permissões da seção 2. Usada pela API (primeira barreira) e pela interface
 * (esconder botões). A barreira final é o RLS no banco: as duas camadas precisam concordar.
 */
export interface Viewer {
  id: string;
  role: Role;
  /** Departamentos em que é membro. */
  departmentIds: readonly string[];
  /** Departamentos em que é gestor responsável (department_members.is_manager). */
  managedDepartmentIds: readonly string[];
  /** Observador autorizado a ver toda a instituição (RF-10.7, RF-14.9). */
  seesAllDepartments: boolean;
}

export const isAdmin = (v: Viewer) => v.role === 'admin';

/** Observador é somente leitura. */
export const canWrite = (v: Viewer) => v.role !== 'observador';

export const isMember = (v: Viewer, departmentId: string) =>
  isAdmin(v) || v.departmentIds.includes(departmentId);

export const isManagerOf = (v: Viewer, departmentId: string) =>
  isAdmin(v) || v.managedDepartmentIds.includes(departmentId);

export const permissions = {
  manageUsers: (v: Viewer) => isAdmin(v),
  manageDepartments: (v: Viewer) => isAdmin(v),
  addMembers: (v: Viewer, departmentId: string) => isManagerOf(v, departmentId),
  manageProjects: (v: Viewer, departmentId: string) => isManagerOf(v, departmentId),
  configureColumns: (v: Viewer, departmentId: string) => isManagerOf(v, departmentId),
  editTasks: (v: Viewer, departmentId: string) => canWrite(v) && isMember(v, departmentId),
  /** Colaborador só exclui as tarefas que criou. */
  deleteTask: (v: Viewer, departmentId: string, reporterId: string) =>
    isManagerOf(v, departmentId) ||
    (canWrite(v) && isMember(v, departmentId) && reporterId === v.id),
  restoreTask: (v: Viewer, departmentId: string) => isManagerOf(v, departmentId),
  openTicket: (v: Viewer) => canWrite(v),
  assignTicket: (v: Viewer, executorDepartmentId: string) => isManagerOf(v, executorDepartmentId),
  comment: (v: Viewer) => canWrite(v),
  viewDepartmentReports: (v: Viewer, departmentId: string) =>
    isAdmin(v) ||
    v.seesAllDepartments ||
    isManagerOf(v, departmentId) ||
    (v.role === 'observador' && isMember(v, departmentId)),
  viewInstitutionReports: (v: Viewer) => isAdmin(v) || v.seesAllDepartments,
  /** RF-10.7: área de Dashboards para admin, observadores autorizados e gestores. */
  viewDashboards: (v: Viewer) =>
    isAdmin(v) || v.seesAllDepartments || v.managedDepartmentIds.length > 0,
  viewAuditLog: (v: Viewer) => isAdmin(v),
  manageGeneralEvents: (v: Viewer) => isAdmin(v),
  manageDepartmentEvents: (v: Viewer, departmentId: string) => isManagerOf(v, departmentId),
} as const;
