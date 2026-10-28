import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router';
import { Card, EmptyState } from '@/design-system';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={<FileQuestion size={32} strokeWidth={1.5} />}
        title="Página não encontrada"
        description="O endereço pode estar errado ou o item foi removido."
        action={<Link to="/">Voltar ao início</Link>}
      />
    </Card>
  );
}
