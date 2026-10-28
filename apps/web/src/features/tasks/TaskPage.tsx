import { useParams } from 'react-router';
import { Card } from '@/design-system';
import { TaskDetail } from './TaskDetail';

/** RF-6.3: cada tarefa tem URL própria (ex.: /tarefas/TI-42 ou /tarefas/CH-128). */
export function TaskPage() {
  const { code = '' } = useParams();
  return (
    <Card flush className="bg-page">
      <TaskDetail code={code} />
    </Card>
  );
}
