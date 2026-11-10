import { type AdminConfig } from "../utils/config.js";
import { safeStringEqual } from "./sessions.js";

const ARGON2_OPTIONS = { algorithm: "argon2id", memoryCost: 19_456, timeCost: 2 } as const;

export interface AdminAuthHooks {
  /** Called at most once, when production falls back to the dev credentials. */
  warn(message: string): void;
}

/**
 * Argon2id password check for the admin login. The password hash is computed
 * once at boot; unknown users are verified against a throwaway hash so that
 * response time does not reveal whether the user exists.
 */
export class AdminAuth {
  private constructor(
    private readonly user: string,
    private readonly passwordHash: string,
    private readonly dummyHash: string,
  ) {}

  static async create(admin: AdminConfig, hooks: AdminAuthHooks): Promise<AdminAuth> {
    if (process.env.NODE_ENV !== "production" && admin.password === "admin") {
      hooks.warn(
        "ADMIN_PASSWORD ausente: /admin usa a senha padrão de desenvolvimento (não use em produção)",
      );
    }
    const [passwordHash, dummyHash] = await Promise.all([
      Bun.password.hash(admin.password, ARGON2_OPTIONS),
      Bun.password.hash(crypto.randomUUID(), ARGON2_OPTIONS),
    ]);
    return new AdminAuth(admin.user, passwordHash, dummyHash);
  }

  async verify(username: string, password: string): Promise<boolean> {
    const userMatches = safeStringEqual(username, this.user);
    let passwordMatches: boolean;
    try {
      passwordMatches = await Bun.password.verify(
        password,
        userMatches ? this.passwordHash : this.dummyHash,
      );
    } catch {
      passwordMatches = false;
    }
    return userMatches && passwordMatches;
  }
}
