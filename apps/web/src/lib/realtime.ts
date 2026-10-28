import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { keys } from './queries';

/**
 * RF-5.10 e RF-8.7: escuta os eventos da API (SSE) e invalida o cache do que mudou.
 * O evento só traz ids; os dados vêm de novo da API, já filtrados pelo servidor.
 */
export function useRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events', { withCredentials: true });
    source.addEventListener('task', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { projectId: string; taskId?: string };
      void queryClient.invalidateQueries({ queryKey: keys.board(data.projectId) });
      void queryClient.invalidateQueries({ queryKey: keys.taskAny });
      void queryClient.invalidateQueries({ queryKey: keys.myTasks });
      void queryClient.invalidateQueries({ queryKey: keys.calendarAny });
      void queryClient.invalidateQueries({ queryKey: keys.ticketsAny });
    });
    source.addEventListener('notification', () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      void queryClient.invalidateQueries({ queryKey: keys.home });
    });
    return () => {
      source.close();
    };
  }, [queryClient]);
}
