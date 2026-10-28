import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { MeDto, Viewer } from '@hub/shared';
import { LoadingScreen } from '@/design-system';
import { ApiRequestError, UNAUTHENTICATED_EVENT, api } from './api';

interface AuthState {
  me: MeDto;
  viewer: Viewer;
}

const AuthContext = createContext<AuthState | null>(null);

export const ME_KEY = ['me'] as const;

export function toViewer(me: MeDto): Viewer {
  return {
    id: me.id,
    role: me.role,
    departmentIds: me.memberships.map((m) => m.departmentId),
    managedDepartmentIds: me.memberships.filter((m) => m.isManager).map((m) => m.departmentId),
    seesAllDepartments: me.seesAllDepartments || me.role === 'admin',
  };
}

export function useMeQuery() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<MeDto>('/auth/me');
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Protege as rotas internas (etapa 3): sem sessão, vai para o login e volta depois. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMeQuery();
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onUnauthenticated = () => {
      queryClient.setQueryData(ME_KEY, null);
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => {
      window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    };
  }, [queryClient]);

  const value = useMemo(() => (me.data ? { me: me.data, viewer: toViewer(me.data) } : null), [me.data]);

  if (me.isPending) return <LoadingScreen />;
  if (!value) {
    const next = location.pathname + location.search;
    return <Navigate to={`/entrar${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora de RequireAuth');
  return ctx;
}
