import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { unzlibSync } from "fflate";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";

async function runSmoke() {
  console.log("=== INICIANDO SMOKE TEST ===");

  const originalEnv = { ...process.env };
  const tempDir = resolve("./tmp/smoke-uploads-" + Date.now());
  process.env.TEMP_DIR = tempDir;
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "34567";
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1:34567";

  const config = loadConfig();
  const app = await buildApp(config);

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    console.log(`[1] Servidor ouvindo em ${address}`);

    // 1. Criar sessão
    const createRes = await fetch(`${address}/api/sessions`, { method: "POST" });
    if (!createRes.ok) throw new Error(`Falha ao criar sessão: ${createRes.status}`);
    const session = (await createRes.json()) as {
      id: string;
      ownerToken: string;
      uploadToken: string;
    };
    console.log(`[2] Sessão criada: ${session.id}`);

    // 2. Conectar WebSocket com ownerToken
    const wsUrl = `${address.replace(/^http/, "ws")}/api/sessions/${session.id}/ws?token=${session.ownerToken}`;
    const ws = new WebSocket(wsUrl);

    const receivedEvents: Array<{ type: string; fileId: string; state?: string }> = [];
    const wsReadyPromise = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (err) => reject(new Error("Erro ao abrir WebSocket"));
    });

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        receivedEvents.push(data);
      } catch (e) {
        // ignore
      }
    };

    await wsReadyPromise;
    console.log("[3] WebSocket conectado com sucesso");

    // 3. Preparar 2 arquivos com conteúdo conhecido para validar hashes
    const file1Content = Buffer.from("Conteúdo do arquivo 1 de teste para fumaça.");
    const file1Hash = createHash("sha256").update(file1Content).digest("hex");

    const file2Content = Buffer.from("Segundo arquivo de teste com payload diferente.");
    const file2Hash = createHash("sha256").update(file2Content).digest("hex");

    const formData = new FormData();
    formData.append("files", new Blob([file1Content]), "documento.txt");
    formData.append("files", new Blob([file2Content]), "foto.png");

    // 4. Enviar arquivos usando uploadToken
    const uploadRes = await fetch(`${address}/api/sessions/${session.id}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.uploadToken}`,
      },
      body: formData,
    });

    if (uploadRes.status !== 201) {
      throw new Error(`Falha no upload: status ${uploadRes.status}`);
    }
    const uploadData = (await uploadRes.json()) as { files: Array<{ id: string; originalName: string }> };
    console.log(`[4] 2 arquivos enviados com sucesso via uploadToken`);

    // 5. Aguardar conclusão via WebSocket (espera até 5s)
    const startWait = Date.now();
    while (Date.now() - startWait < 5000) {
      const completedEvents = receivedEvents.filter(
        (e) => e.type === "file:state-changed" && e.state === "completed"
      );
      if (completedEvents.length >= 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const completed = receivedEvents.filter(
      (e) => e.type === "file:state-changed" && e.state === "completed"
    );
    if (completed.length < 2) {
      throw new Error(`WebSocket não reportou 2 arquivos concluídos a tempo`);
    }
    console.log(`[5] Eventos file:state-changed com 'completed' recebidos pelo WebSocket`);

    // 6. Validar lista de arquivos via GET /api/sessions/:id/files
    const listRes = await fetch(`${address}/api/sessions/${session.id}/files`, {
      headers: { Authorization: `Bearer ${session.ownerToken}` },
    });
    if (!listRes.ok) throw new Error("Falha ao listar arquivos");
    const listData = (await listRes.json()) as { files: Array<{ id: string; originalName: string }> };
    if (listData.files.length !== 2) {
      throw new Error(`Esperado 2 arquivos na listagem, obtido: ${listData.files.length}`);
    }
    console.log("[6] GET /api/sessions/:id/files validado");

    // 7. Download individual e comparação de hash
    const targetFile = listData.files.find((f) => f.originalName === "documento.txt")!;
    const downloadRes = await fetch(
      `${address}/api/sessions/${session.id}/files/${targetFile.id}/download?token=${session.ownerToken}`
    );
    if (!downloadRes.ok) throw new Error("Falha ao baixar arquivo individual");
    const downloadedBuf = Buffer.from(await downloadRes.arrayBuffer());
    const downloadedHash = createHash("sha256").update(downloadedBuf).digest("hex");
    if (downloadedHash !== file1Hash) {
      throw new Error(`Hash diverge no download individual! Esperado: ${file1Hash}, Obtido: ${downloadedHash}`);
    }
    console.log("[7] Download individual validado: SHA-256 idêntico ao original");

    // 8. Download de ZIP e conferência de conteúdo
    const zipRes = await fetch(`${address}/api/sessions/${session.id}/download.zip?token=${session.ownerToken}`);
    if (!zipRes.ok) throw new Error("Falha ao baixar ZIP");
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    if (zipBuf.length < 22) throw new Error("ZIP retornado parece corrompido ou vazio");
    console.log(`[8] Download do ZIP da sessão recebido (${zipBuf.length} bytes)`);

    // 9. Encerrar sessão via DELETE
    const deleteRes = await fetch(`${address}/api/sessions/${session.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.ownerToken}` },
    });
    if (deleteRes.status !== 204) throw new Error(`Falha ao encerrar sessão: ${deleteRes.status}`);
    console.log("[9] Sessão encerrada via DELETE");

    ws.close();

    // 10. Conferir que o diretório temporário da sessão foi excluído/limpo
    const sessionDir = resolve(tempDir, session.id);
    if (existsSync(sessionDir)) {
      const files = readdirSync(sessionDir);
      if (files.length > 0) {
        throw new Error(`Diretório da sessão não ficou vazio! Arquivos remanescentes: ${files.join(", ")}`);
      }
    }
    console.log("[10] Diretório temporário verificado e limpo");

    console.log("\n=========================");
    console.log("RESULTADO FINAL: OK");
    console.log("=========================");
    process.exit(0);
  } catch (err: any) {
    console.error("\n=========================");
    console.error(`RESULTADO FINAL: FALHOU - ${err.message || err}`);
    console.error("=========================");
    process.exit(1);
  } finally {
    await app.close();
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // cleanup error
      }
    }
    process.env = originalEnv;
  }
}

runSmoke();
