import type { Session } from "../types.js";

export class SessionRepository {
  private sessions: Map<string, Session> = new Map();

  create(session: Session): void {
    this.sessions.set(session.id, session);
  }

  getById(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  update(session: Session): void {
    if (!this.sessions.has(session.id)) {
      throw new Error(`Session not found: ${session.id}`);
    }
    this.sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  getAllActive(): Session[] {
    return this.getAll().filter((s) => s.state === "active");
  }

  getActiveIds(): Set<string> {
    return new Set(this.getAllActive().map((s) => s.id));
  }

  clear(): void {
    this.sessions.clear();
  }
}
