import { useQuery } from '@tanstack/react-query';
import type { EpicDto, TaskTemplateDto } from '@hub/shared';
import { api } from '@/lib/api';

export const projectKeys = {
  epics: (id: string) => ['project-epics', id] as const,
  templates: (id: string) => ['project-templates', id] as const,
  recurrences: (id: string) => ['project-recurrences', id] as const,
  automations: (id: string) => ['project-automations', id] as const,
};

export function useEpics(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.epics(projectId ?? ''),
    queryFn: () => api.get<EpicDto[]>(`/projects/${projectId ?? ''}/epics`),
    enabled: Boolean(projectId),
  });
}

export function useTemplates(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.templates(projectId ?? ''),
    queryFn: () => api.get<TaskTemplateDto[]>(`/projects/${projectId ?? ''}/templates`),
    enabled: Boolean(projectId),
  });
}
