import type { FastifyBaseLogger } from 'fastify';
import postgres from 'postgres';

/**
 * Tempo real (RF-5.10, RF-8.7). Os triggers publicam ids no canal `hub_events`;
 * aqui eles viram eventos SSE só para quem pode ver o projeto. O navegador então
 * busca os dados de novo pela API, sob RLS: o evento em si não carrega conteúdo.
 */
type Send = (event: string, data: unknown) => void;

interface HubEvent {
  t: 'task' | 'notif';
  p?: string;
  id?: string;
  u?: string;
}

export class Realtime {
  private clients = new Map<string, Set<Send>>();
  private audienceCache = new Map<string, { users: Set<string>; at: number }>();
  private sql: postgres.Sql | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    this.sql = postgres(this.databaseUrl, { max: 2, onnotice: () => undefined });
    await this.sql.listen('hub_events', (payload) => {
      void this.dispatch(payload).catch((error: unknown) => {
        this.log.error(error, "realtime: falha ao repassar evento");
      });
    });
  }

  async stop(): Promise<void> {
    await this.sql?.end({ timeout: 2 });
  }

  subscribe(userId: string, send: Send): () => void {
    let set = this.clients.get(userId);
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(send);
    return () => {
      set.delete(send);
      if (set.size === 0) this.clients.delete(userId);
    };
  }

  private async audience(projectId: string): Promise<Set<string>> {
    const cached = this.audienceCache.get(projectId);
    if (cached && Date.now() - cached.at < 10_000) return cached.users;
    if (!this.sql) return new Set();
    const rows = await this.sql<{ id: string }[]>`select app.project_audience(${projectId}) as id`;
    const users = new Set(rows.map((r) => r.id));
    this.audienceCache.set(projectId, { users, at: Date.now() });
    return users;
  }

  private emit(userId: string, event: string, data: unknown) {
    this.clients.get(userId)?.forEach((send) => {
      send(event, data);
    });
  }

  private async dispatch(raw: string) {
    const event = JSON.parse(raw) as HubEvent;
    if (event.t === 'notif' && event.u) {
      this.emit(event.u, 'notification', {});
    } else if (event.t === 'task' && event.p && this.clients.size > 0) {
      const users = await this.audience(event.p);
      for (const userId of users) this.emit(userId, 'task', { projectId: event.p, taskId: event.id });
    }
  }
}
