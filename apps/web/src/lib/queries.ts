import { useQuery } from '@tanstack/react-query';
import type {
  DepartmentDto,
  DirectoryUserDto,
  ProjectDto,
  TicketTypeDto,
} from '@hub/shared';
import { api, qs } from './api';

/** Chaves do cache do TanStack Query, num lugar só para a invalidação não se perder. */
export const keys = {
  me: ['me'] as const,
  departments: ['departments'] as const,
  department: (id: string) => ['departments', id] as const,
  members: (id: string) => ['departments', id, 'members'] as const,
  ticketTypes: (id: string) => ['departments', id, 'ticket-types'] as const,
  directory: ['directory'] as const,
  projects: (departmentId?: string) => ['projects', departmentId ?? 'all'] as const,
  projectsAny: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  projectAny: ['project'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  taskAny: ['task'] as const,
  task: (code: string) => ['task', code] as const,
  comments: (taskId: string) => ['task', 'comments', taskId] as const,
  history: (taskId: string) => ['task', 'history', taskId] as const,
  myTasks: ['my-tasks'] as const,
  ticketsAny: ['tickets'] as const,
  myTickets: (tab: string) => ['tickets', 'mine', tab] as const,
  notifications: ['notifications'] as const,
  home: ['home'] as const,
  calendarAny: ['calendar'] as const,
  users: ['users'] as const,
};

export function useDepartments(includeArchived = false) {
  return useQuery({
    queryKey: [...keys.departments, includeArchived],
    queryFn: () => api.get<DepartmentDto[]>(`/departments${qs({ includeArchived })}`),
    staleTime: 60_000,
  });
}

export function useDirectory() {
  return useQuery({
    queryKey: keys.directory,
    queryFn: () => api.get<DirectoryUserDto[]>('/users/directory'),
    staleTime: 5 * 60_000,
  });
}

export function useProjects(departmentId?: string) {
  return useQuery({
    queryKey: keys.projects(departmentId),
    queryFn: () => api.get<ProjectDto[]>(`/projects${qs({ departmentId })}`),
  });
}

export function useTicketTypes(departmentId: string | undefined, all = false) {
  return useQuery({
    queryKey: [...keys.ticketTypes(departmentId ?? ''), all],
    queryFn: () => api.get<TicketTypeDto[]>(`/departments/${departmentId ?? ''}/ticket-types${qs({ all })}`),
    enabled: Boolean(departmentId),
  });
}
