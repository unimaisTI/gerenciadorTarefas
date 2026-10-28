import { describe, expect, it } from 'vitest';
import { permissions, type Viewer } from './permissions';

const TI = 'ti';
const CTRL = 'ctrl';
const base = { seesAllDepartments: false, managedDepartmentIds: [] as string[] };

const admin: Viewer = { ...base, id: 'a', role: 'admin', departmentIds: [TI] };
const gestorTi: Viewer = { ...base, id: 'g', role: 'gestor', departmentIds: [TI], managedDepartmentIds: [TI] };
const colabTi: Viewer = { ...base, id: 'c', role: 'colaborador', departmentIds: [TI] };
const observador: Viewer = { ...base, id: 'o', role: 'observador', departmentIds: [TI, CTRL] };
const diretoria: Viewer = { ...observador, id: 'd', seesAllDepartments: true };

// Matriz da seção 2, linha a linha.
describe('matriz de permissões', () => {
  it('usuários e departamentos: só admin', () => {
    for (const v of [gestorTi, colabTi, observador]) {
      expect(permissions.manageUsers(v)).toBe(false);
      expect(permissions.manageDepartments(v)).toBe(false);
    }
    expect(permissions.manageUsers(admin)).toBe(true);
  });

  it('membros, projetos e colunas: admin e gestor do departamento', () => {
    expect(permissions.addMembers(gestorTi, TI)).toBe(true);
    expect(permissions.addMembers(gestorTi, CTRL)).toBe(false);
    expect(permissions.manageProjects(colabTi, TI)).toBe(false);
    expect(permissions.configureColumns(admin, CTRL)).toBe(true);
  });

  it('tarefas: observador não edita', () => {
    expect(permissions.editTasks(colabTi, TI)).toBe(true);
    expect(permissions.editTasks(colabTi, CTRL)).toBe(false);
    expect(permissions.editTasks(observador, TI)).toBe(false);
  });

  it('exclusão: colaborador só as que criou', () => {
    expect(permissions.deleteTask(colabTi, TI, 'c')).toBe(true);
    expect(permissions.deleteTask(colabTi, TI, 'outro')).toBe(false);
    expect(permissions.deleteTask(gestorTi, TI, 'outro')).toBe(true);
    expect(permissions.deleteTask(observador, TI, 'o')).toBe(false);
  });

  it('chamados: abrir e comentar todos menos observador; atribuir só gestor do executor', () => {
    expect(permissions.openTicket(colabTi)).toBe(true);
    expect(permissions.openTicket(observador)).toBe(false);
    expect(permissions.comment(observador)).toBe(false);
    expect(permissions.assignTicket(gestorTi, TI)).toBe(true);
    expect(permissions.assignTicket(colabTi, TI)).toBe(false);
  });

  it('relatórios: departamento para gestor e observador; instituição para admin e observador autorizado', () => {
    expect(permissions.viewDepartmentReports(gestorTi, TI)).toBe(true);
    expect(permissions.viewDepartmentReports(colabTi, TI)).toBe(false);
    expect(permissions.viewDepartmentReports(observador, CTRL)).toBe(true);
    expect(permissions.viewInstitutionReports(observador)).toBe(false);
    expect(permissions.viewInstitutionReports(diretoria)).toBe(true);
    expect(permissions.viewAuditLog(gestorTi)).toBe(false);
    expect(permissions.viewAuditLog(admin)).toBe(true);
  });
});
