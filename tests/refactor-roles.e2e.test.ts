import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import type { WebSocket } from "ws";
import {
  BASE_URL,
  ROOT,
  authenticateWs,
  closeWs,
  connectWs,
  createSession,
  downloadFile,
  downloadZip,
  getSessionInfo,
  issueLoginCode,
  joinByCode,
  openWs,
  pairSession,
  sha256,
  startRealServer,
  uploadFile,
  waitForClose,
  waitForMessage,
  type CreatedSession,
  type RealServerHandle,
} from "./helpers/realServer.js";

let server: RealServerHandle;
// HTML routes depend on the built SPA; a clean checkout without `web/dist` only skips them.
const hasWebDist = existsSync(join(ROOT, "web/dist/index.html"));

beforeAll(async () => {
  server = await startRealServer();
});

afterAll(async () => {
  await server?.stop();
});

async function createPaired(): Promise<{
  session: CreatedSession;
  phoneCredential: string;
}> {
  const session = await createSession();
  const paired = await pairSession(session.id, session.qrToken);
  return { session, phoneCredential: paired.phoneCredential };
}

describe("Cenário 1 — papéis antigos (computer/phone)", () => {
  it(
    "autentica, heartbeat, presença, upload do phone e evento no computer, e reconecta",
    async () => {
      const { session, phoneCredential } = await createPaired();
      const sockets: WebSocket[] = [];
      try {
        const computer = await connectWs(session.id, "computer", session.ownerToken);
        sockets.push(computer);
        const phone = await connectWs(session.id, "phone", phoneCredential);
        sockets.push(phone);

        // Heartbeat nos dois lados
        const ackComp = waitForMessage(computer, (m) => m.type === "heartbeat_ack");
        computer.send(JSON.stringify({ type: "heartbeat" }));
        await ackComp;
        const ackPhone = waitForMessage(phone, (m) => m.type === "heartbeat_ack");
        phone.send(JSON.stringify({ type: "heartbeat" }));
        await ackPhone;

        // Presença
        const info = await getSessionInfo(session.id, session.ownerToken);
        expect(info.computerPresent).toBe(true);
        expect(info.phonePresent).toBe(true);

        // Upload pelo phone → evento completed no computer
        const completed = waitForMessage(
          computer,
          (m) => m.type === "file:state-changed" && m.state === "completed",
        );
        const content = randomBytes(4096);
        const uploaded = await uploadFile(session.id, phoneCredential, content, "old-role.bin");
        const evt = await completed;
        expect(evt.fileId).toBe(uploaded.id);
        expect(evt.size).toBe(content.length);

        // Fecha o phone e reconecta com a mesma credencial
        await closeWs(phone);
        sockets.splice(sockets.indexOf(phone), 1);

        const phone2 = await connectWs(session.id, "phone", phoneCredential);
        sockets.push(phone2);
        const info2 = await getSessionInfo(session.id, session.ownerToken);
        expect(info2.phonePresent).toBe(true);

        const completed2 = waitForMessage(
          computer,
          (m) =>
            m.type === "file:state-changed" && m.state === "completed" && m.fileId !== uploaded.id,
        );
        const content2 = randomBytes(2048);
        const uploaded2 = await uploadFile(session.id, phoneCredential, content2, "reconnect.bin");
        const evt2 = await completed2;
        expect(evt2.fileId).toBe(uploaded2.id);
      } finally {
        await Promise.all(sockets.map((ws) => closeWs(ws)));
      }
    },
    20_000,
  );
});

describe("Cenário 2 — papéis novos (host/guest)", () => {
  it(
    "autentica host/guest, heartbeat, presença, upload do guest e reconexão",
    async () => {
      const { session, phoneCredential } = await createPaired();
      const sockets: WebSocket[] = [];
      try {
        const host = await connectWs(session.id, "host", session.ownerToken);
        sockets.push(host);
        const guest = await connectWs(session.id, "guest", phoneCredential);
        sockets.push(guest);

        const ackHost = waitForMessage(host, (m) => m.type === "heartbeat_ack");
        host.send(JSON.stringify({ type: "heartbeat" }));
        await ackHost;
        const ackGuest = waitForMessage(guest, (m) => m.type === "heartbeat_ack");
        guest.send(JSON.stringify({ type: "heartbeat" }));
        await ackGuest;

        const info = await getSessionInfo(session.id, session.ownerToken);
        expect(info.computerPresent).toBe(true);
        expect(info.phonePresent).toBe(true);

        const completed = waitForMessage(
          host,
          (m) => m.type === "file:state-changed" && m.state === "completed",
        );
        const content = randomBytes(4096);
        const uploaded = await uploadFile(session.id, phoneCredential, content, "new-role.bin");
        const evt = await completed;
        expect(evt.fileId).toBe(uploaded.id);

        await closeWs(guest);
        sockets.splice(sockets.indexOf(guest), 1);
        const guest2 = await connectWs(session.id, "guest", phoneCredential);
        sockets.push(guest2);

        const completed2 = waitForMessage(
          host,
          (m) =>
            m.type === "file:state-changed" && m.state === "completed" && m.fileId !== uploaded.id,
        );
        const uploaded2 = await uploadFile(
          session.id,
          phoneCredential,
          randomBytes(1024),
          "new-role-2.bin",
        );
        expect((await completed2).fileId).toBe(uploaded2.id);
      } finally {
        await Promise.all(sockets.map((ws) => closeWs(ws)));
      }
    },
    20_000,
  );
});

describe("Cenário 3 — mistura de papéis antigos e novos", () => {
  it(
    "host + phone numa sessão e computer + guest em outra, slots corretos e eventos no host/computer",
    async () => {
      const a = await createPaired();
      const b = await createPaired();
      const sockets: WebSocket[] = [];
      try {
        const host = await connectWs(a.session.id, "host", a.session.ownerToken);
        sockets.push(host);
        const phone = await connectWs(a.session.id, "phone", a.phoneCredential);
        sockets.push(phone);
        const computer = await connectWs(b.session.id, "computer", b.session.ownerToken);
        sockets.push(computer);
        const guest = await connectWs(b.session.id, "guest", b.phoneCredential);
        sockets.push(guest);

        const infoA = await getSessionInfo(a.session.id, a.session.ownerToken);
        expect(infoA.computerPresent).toBe(true);
        expect(infoA.phonePresent).toBe(true);
        const infoB = await getSessionInfo(b.session.id, b.session.ownerToken);
        expect(infoB.computerPresent).toBe(true);
        expect(infoB.phonePresent).toBe(true);

        const evtA = waitForMessage(
          host,
          (m) => m.type === "file:state-changed" && m.state === "completed",
        );
        const upA = await uploadFile(a.session.id, a.phoneCredential, randomBytes(512), "mix-a.bin");
        expect((await evtA).fileId).toBe(upA.id);

        const evtB = waitForMessage(
          computer,
          (m) => m.type === "file:state-changed" && m.state === "completed",
        );
        const upB = await uploadFile(b.session.id, b.phoneCredential, randomBytes(512), "mix-b.bin");
        expect((await evtB).fileId).toBe(upB.id);
      } finally {
        await Promise.all(sockets.map((ws) => closeWs(ws)));
      }
    },
    20_000,
  );
});

describe("Cenário 4 — entradas inválidas", () => {
  it(
    "role desconhecido, role vazio e credencial errada fecham com 4001 e o servidor continua vivo",
    async () => {
      const { session, phoneCredential } = await createPaired();

      for (const [role, secret] of [
        ["admin", session.ownerToken],
        ["", session.ownerToken],
        ["computer", "wrong-secret"],
        ["phone", "wrong-secret"],
        ["host", phoneCredential],
      ] as const) {
        const ws = await openWs(session.id);
        const closed = waitForClose(ws);
        ws.send(JSON.stringify({ type: "auth", role, secret }));
        const { code } = await closed;
        expect(code).toBe(4001);
      }

      const health = await fetch(`${BASE_URL}/health`);
      expect(health.status).toBe(200);
    },
    20_000,
  );

  it("aceita dois sockets host na mesma sessão (multi-aba)", async () => {
    const session = await createSession();
    const sockets: WebSocket[] = [];
    try {
      const host1 = await connectWs(session.id, "host", session.ownerToken);
      sockets.push(host1);
      const host2 = await openWs(session.id);
      sockets.push(host2);
      const ack = await authenticateWs(host2, "computer", session.ownerToken);
      expect(ack.type).toBe("auth_ok");

      const info = await getSessionInfo(session.id, session.ownerToken);
      expect(info.computerPresent).toBe(true);

      const health = await fetch(`${BASE_URL}/health`);
      expect(health.status).toBe(200);
    } finally {
      await Promise.all(sockets.map((ws) => closeWs(ws)));
    }
  });
});

describe("Cenário 5 — transferência de arquivos", () => {
  it(
    "(a) guest envia ~1MB e host baixa com hash igual",
    async () => {
      const { session, phoneCredential } = await createPaired();
      const content = randomBytes(1024 * 1024);
      const uploaded = await uploadFile(session.id, phoneCredential, content, "medium.bin");
      const downloaded = await downloadFile(session.id, uploaded.id, session.ownerToken);
      expect(sha256(downloaded)).toBe(sha256(content));
    },
    60_000,
  );

  it("(b) host envia arquivo e baixa com hash igual", async () => {
    const { session } = await createPaired();
    const content = randomBytes(64 * 1024);
    const uploaded = await uploadFile(session.id, session.ownerToken, content, "from-host.bin");
    const downloaded = await downloadFile(session.id, uploaded.id, session.ownerToken);
    expect(sha256(downloaded)).toBe(sha256(content));
  });

  it(
    "(c) guest envia ~8MB e host baixa com hash igual",
    async () => {
      const { session, phoneCredential } = await createPaired();
      const content = randomBytes(8 * 1024 * 1024);
      const uploaded = await uploadFile(session.id, phoneCredential, content, "big.bin");
      const downloaded = await downloadFile(session.id, uploaded.id, session.ownerToken);
      expect(sha256(downloaded)).toBe(sha256(content));
    },
    60_000,
  );

  it(
    "(d) 5 uploads simultâneos, todos baixáveis com hashes corretos",
    async () => {
      const { session, phoneCredential } = await createPaired();
      const contents = Array.from({ length: 5 }, () => randomBytes(32 * 1024));
      const uploaded = await Promise.all(
        contents.map((c, i) => uploadFile(session.id, phoneCredential, c, `parallel-${i}.bin`)),
      );
      for (let i = 0; i < 5; i++) {
        const downloaded = await downloadFile(session.id, uploaded[i]!.id, session.ownerToken);
        expect(sha256(downloaded)).toBe(sha256(contents[i]!));
      }
    },
    60_000,
  );

  it("(e) ZIP com 2 arquivos bate com os conteúdos enviados", async () => {
    const { session, phoneCredential } = await createPaired();
    const a = randomBytes(4096);
    const b = randomBytes(8192);
    await uploadFile(session.id, phoneCredential, a, "zip-a.txt");
    await uploadFile(session.id, phoneCredential, b, "zip-b.txt");

    const zip = await downloadZip(session.id, session.ownerToken);
    const entries = unzipSync(zip);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(["zip-a.txt", "zip-b.txt"]);
    expect(sha256(Buffer.from(entries["zip-a.txt"]!))).toBe(sha256(a));
    expect(sha256(Buffer.from(entries["zip-b.txt"]!))).toBe(sha256(b));
  });
});

describe("Cenário 6 — rotas, SPA fallback e QR reutilizável", () => {
  it.skipIf(!hasWebDist)(
    "serve o mesmo HTML em /entrar e /enviar, inclusive para id inexistente",
    async () => {
      const session = await createSession();
      const pages = [
        `/entrar/${session.id}`,
        `/enviar/${session.id}`,
        `/entrar/id-inexistente`,
      ];
      const bodies: string[] = [];
      for (const path of pages) {
        const res = await fetch(`${BASE_URL}${path}`);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("content-type"), path).toContain("text/html");
        bodies.push(await res.text());
      }
      expect(bodies[0]).toBe(bodies[1]);
    },
    20_000,
  );

  it("API não vaza existência de sessão", async () => {
    const pair = await fetch(`${BASE_URL}/api/sessions/id-inexistente/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qrToken: "qr-invalido" }),
    });
    expect(pair.status).toBe(404);
    expect(pair.headers.get("content-type")).toContain("application/json");

    const info = await fetch(`${BASE_URL}/api/sessions/id-inexistente`, {
      headers: { authorization: `Bearer ${randomBytes(16).toString("hex")}` },
    });
    expect(info.status).toBe(401);
  });

  it(
    "QR reutilizável: 3 pareamentos, credenciais distintas, último autentica e primeira falha",
    async () => {
      const session = await createSession();
      const credentials: string[] = [];
      for (let i = 0; i < 3; i++) {
        const paired = await pairSession(session.id, session.qrToken);
        expect(paired.phoneCredential).toBeTruthy();
        credentials.push(paired.phoneCredential);
      }
      expect(new Set(credentials).size).toBe(3);

      const sockets: WebSocket[] = [];
      try {
        const guest = await connectWs(session.id, "guest", credentials[2]!);
        sockets.push(guest);
        const info = await getSessionInfo(session.id, session.ownerToken);
        expect(info.phonePresent).toBe(true);

        const stale = await openWs(session.id);
        sockets.push(stale);
        const closed = waitForClose(stale);
        stale.send(JSON.stringify({ type: "auth", role: "guest", secret: credentials[0]! }));
        expect((await closed).code).toBe(4001);
      } finally {
        await Promise.all(sockets.map((ws) => closeWs(ws)));
      }
    },
    20_000,
  );
});

describe("Cenário 7 — login por ID + código", () => {
  it(
    "host recebe login_code, guest entra pelo código, uso único e limite por sessão rotaciona",
    async () => {
      const session = await createSession();
      const sockets: WebSocket[] = [];
      try {
        const host = await connectWs(session.id, "host", session.ownerToken);
        sockets.push(host);

        const firstCode = waitForMessage(host, (m) => m.type === "login_code");
        const issued = await issueLoginCode(session.id, session.ownerToken);
        expect(issued.status).toBe(202);
        const { code } = (await firstCode) as { code: string };
        expect(code).toMatch(/^\d{6}$/);

        const joined = await joinByCode(session.visualId.toLowerCase(), code);
        expect(joined.status).toBe(200);
        const { phoneCredential } = (await joined.json()) as { phoneCredential: string };

        const guest = await connectWs(session.id, "guest", phoneCredential);
        sockets.push(guest);

        // Código é de uso único
        expect((await joinByCode(session.visualId.toLowerCase(), code)).status).toBe(401);

        // Código errado
        const wrong = code === "000000" ? "000001" : "000000";
        expect((await joinByCode(session.visualId.toLowerCase(), wrong)).status).toBe(401);

        // Limite por sessão: novo código, 5 erros, rotação
        const secondCode = waitForMessage(host, (m) => m.type === "login_code");
        expect((await issueLoginCode(session.id, session.ownerToken)).status).toBe(202);
        const { code: fresh } = (await secondCode) as { code: string };

        const rotated = waitForMessage(
          host,
          (m) => m.type === "login_code" && m.code !== fresh,
        );
        for (let i = 0; i < 5; i++) {
          const missCode = fresh === "000000" ? "000001" : "000000";
          expect((await joinByCode(session.visualId.toLowerCase(), missCode)).status).toBe(401);
        }
        const { code: rotatedCode } = (await rotated) as { code: string };
        expect(rotatedCode).not.toBe(fresh);

        expect((await joinByCode(session.visualId.toLowerCase(), fresh)).status).toBe(401);
        expect((await joinByCode(session.visualId.toLowerCase(), rotatedCode)).status).toBe(200);
      } finally {
        await Promise.all(sockets.map((ws) => closeWs(ws)));
      }
    },
    30_000,
  );

  it(
    "rate limit por IP termina em 429 com Retry-After e servidor segue vivo",
    async () => {
      const session = await createSession();
      const hitCodes = { sessionId: session.visualId.toLowerCase(), code: "999999" };
      let blocked: Response | null = null;
      for (let i = 0; i < 15; i++) {
        const res = await fetch(`${BASE_URL}/api/sessions/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(hitCodes),
        });
        if (res.status === 429) {
          blocked = res;
          break;
        }
        expect(res.status).toBe(401);
      }
      expect(blocked).not.toBeNull();
      expect(blocked!.headers.get("retry-after")).toMatch(/^\d+$/);

      const health = await fetch(`${BASE_URL}/health`);
      expect(health.status).toBe(200);
    },
    30_000,
  );
});

describe("Cenário 9 — banco/admin sem banco", () => {
  it.skipIf(!hasWebDist)("painel /admin serve o shell HTML", async () => {
    const page = await fetch(`${BASE_URL}/admin`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    await page.text();
  });

  it("painel sem Postgres: login, 503 db_unavailable e servidor vivo", async () => {
    const login = await fetch(`${BASE_URL}/admin/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
      },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    await login.text();
    const cookie = setCookie!.split(";")[0]!;
    expect(cookie).toContain("=");

    const summary = await fetch(`${BASE_URL}/admin/api/summary`, { headers: { cookie } });
    expect(summary.status).toBe(503);
    expect(summary.headers.get("cache-control")).toContain("no-store");
    const body = (await summary.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("db_unavailable");

    const health = await fetch(`${BASE_URL}/health`);
    expect(health.status).toBe(200);
  });
});
