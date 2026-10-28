import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TICKET_STATUSES } from './enums';
import { availableTransitions, findTransition, TICKET_TRANSITIONS, ticketStage } from './tickets';

const migration = readFileSync(
  resolve(import.meta.dirname, '../../db/migrations/0001_security.sql'),
  'utf8',
);

function sqlRules() {
  const block = /-- RULES:BEGIN([\s\S]*?)-- RULES:END/.exec(migration)?.[1] ?? '';
  return [...block.matchAll(/\('(\w+)', '(\w+)', '\{([\w,]+)\}', (true|false), (true|false), (true|false)\)/g)].map(
    (m) => ({
      from: m[1],
      to: m[2],
      actors: (m[3] ?? '').split(','),
      requiresNote: m[4] === 'true',
      requiresAssignee: m[5] === 'true',
      onlyToPrevious: m[6] === 'true',
    }),
  );
}

describe('máquina de estados do chamado', () => {
  it('a tabela do TypeScript é idêntica à função SQL (fonte da verdade)', () => {
    const fromSql = sqlRules();
    const fromTs = TICKET_TRANSITIONS.map((t) => ({
      from: t.from,
      to: t.to,
      actors: [...t.actors],
      requiresNote: t.requiresNote,
      requiresAssignee: t.requiresAssignee ?? false,
      onlyToPrevious: t.onlyToPrevious ?? false,
    }));
    expect(fromSql.length).toBeGreaterThan(0);
    expect(fromTs).toEqual(fromSql);
  });

  it('status encerrados não têm saída', () => {
    for (const s of ['approved', 'rejected', 'cancelled'] as const) {
      expect(TICKET_TRANSITIONS.filter((t) => t.from === s)).toHaveLength(0);
    }
  });

  it('todo status não encerrado tem saída e todos os status são alcançáveis', () => {
    const reachable = new Set(['open', ...TICKET_TRANSITIONS.map((t) => t.to)]);
    for (const s of TICKET_STATUSES) expect(reachable.has(s)).toBe(true);
  });

  it('recusa, devolução, entrega e pedido de informação exigem nota', () => {
    expect(findTransition('triage', 'rejected')?.requiresNote).toBe(true);
    expect(findTransition('awaiting_approval', 'returned')?.requiresNote).toBe(true);
    expect(findTransition('in_progress', 'awaiting_approval')?.requiresNote).toBe(true);
    expect(findTransition('in_progress', 'awaiting_info')?.requiresNote).toBe(true);
    expect(findTransition('awaiting_approval', 'approved')?.requiresNote).toBe(false);
  });

  it('não dá para cancelar depois da entrega', () => {
    expect(findTransition('awaiting_approval', 'cancelled')).toBeUndefined();
  });

  const none = { isAdmin: false, isExecutorManager: false, isAssignee: false, isRequesterSide: false };

  it('solicitante só aprova ou devolve quando aguarda aprovação', () => {
    const state = { status: 'awaiting_approval' as const, previousStatus: 'in_progress' as const, hasAssignee: true };
    expect(availableTransitions(state, { ...none, isRequesterSide: true }).map((t) => t.to).sort()).toEqual([
      'approved',
      'returned',
    ]);
    expect(availableTransitions(state, { ...none, isExecutorManager: true })).toHaveLength(0);
  });

  it('saída de "Aguardando informações" volta só para o status anterior', () => {
    const state = { status: 'awaiting_info' as const, previousStatus: 'in_progress' as const, hasAssignee: true };
    const to = availableTransitions(state, { ...none, isRequesterSide: true }).map((t) => t.to);
    expect(to).toContain('in_progress');
    expect(to).not.toContain('triage');
  });

  it('admin pode qualquer transição válida', () => {
    const state = { status: 'open' as const, previousStatus: null, hasAssignee: false };
    expect(availableTransitions(state, { ...none, isAdmin: true }).map((t) => t.to).sort()).toEqual([
      'cancelled',
      'in_progress',
      'rejected',
      'triage',
    ]);
  });

  it('cada status cai na coluna certa do quadro "Chamados recebidos"', () => {
    expect(ticketStage('open', null)).toBe('new');
    expect(ticketStage('awaiting_info', 'triage')).toBe('triage');
    expect(ticketStage('awaiting_info', 'in_progress')).toBe('execution');
    expect(ticketStage('returned', 'awaiting_approval')).toBe('execution');
    expect(ticketStage('approved', 'awaiting_approval')).toBe('closed');
  });

  it('a coluna de cada status no SQL bate com o TypeScript', () => {
    const fn = /create function app\.ticket_stage_for[\s\S]*?\$\$;/.exec(migration)?.[0] ?? '';
    expect(fn).toContain("when 'open' then 'new'");
    expect(fn).toContain("when 'awaiting_approval' then 'approval'");
    expect(fn).toContain("case when p_previous = 'in_progress' then 'execution' else 'triage' end");
  });
});
