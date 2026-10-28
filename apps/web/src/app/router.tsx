import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { RequireAuth } from '@/lib/auth';
import { AdminPage } from '@/features/admin/AdminPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage, SetPasswordPage } from '@/features/auth/PasswordPages';
import { BoardPage } from '@/features/board/BoardPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { DashboardsPage } from '@/features/dashboards/DashboardsPage';
import { HomePage } from '@/features/dashboards/HomePage';
import { DepartmentPage } from '@/features/departments/DepartmentPage';
import { DepartmentsPage } from '@/features/departments/DepartmentsPage';
import { TrashPage } from '@/features/departments/TrashPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { MyTasksPage } from '@/features/tasks/MyTasksPage';
import { TaskPage } from '@/features/tasks/TaskPage';
import { MyTicketsPage } from '@/features/tickets/MyTicketsPage';
import { OpenTicketPage } from '@/features/tickets/OpenTicketPage';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './pages/NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/entrar', element: <LoginPage /> },
  { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
  { path: '/definir-senha', element: <SetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'minhas-tarefas', element: <MyTasksPage /> },
      { path: 'tarefas/:code', element: <TaskPage /> },
      { path: 'projetos/:key', element: <BoardPage /> },
      { path: 'chamados', element: <MyTicketsPage /> },
      { path: 'chamados/novo', element: <OpenTicketPage /> },
      { path: 'departamentos', element: <DepartmentsPage /> },
      { path: 'departamentos/:id', element: <DepartmentPage /> },
      { path: 'departamentos/:id/calendario', element: <CalendarPage key="dept" /> },
      { path: 'departamentos/:id/painel', element: <DashboardsPage key="dept" /> },
      { path: 'departamentos/:id/lixeira', element: <TrashPage /> },
      { path: 'calendario', element: <CalendarPage key="geral" /> },
      { path: 'dashboards', element: <DashboardsPage key="geral" /> },
      { path: 'admin', element: <AdminPage /> },
      { path: 'perfil', element: <ProfilePage /> },
      { path: 'inicio', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
