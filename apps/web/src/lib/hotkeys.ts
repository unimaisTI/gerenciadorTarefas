import { useEffect, useRef } from 'react';

/** Está digitando? (atalhos de uma tecla não podem disparar dentro de campos). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Atalho de uma tecla, como no Jira (ex.: "c" cria tarefa, "/" busca). Ignorado enquanto a pessoa
 * digita, com Ctrl/Cmd/Alt e quando há um diálogo aberto por cima.
 */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      ref.current(e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [key, enabled]);
}

export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '/', description: 'Buscar (código, título ou descrição)' },
  { keys: 'c', description: 'Criar tarefa (no quadro)' },
  { keys: 'b', description: 'Alternar entre quadro e backlog' },
  { keys: 'f', description: 'Ir para os filtros do quadro' },
  { keys: '?', description: 'Mostrar esta lista de atalhos' },
  { keys: 'Esc', description: 'Fechar painel ou janela' },
];
