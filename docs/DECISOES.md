# Decisões Técnicas

## 1. Runtime: Bun 1.4.4

**Escolha:** Bun como runtime principal.

**Spike (2026-10-30):**
- Fastify responde normalmente sob Bun ✅
- Upload streaming de 300MB: heap cresceu apenas 7MB (não proporcional ao arquivo) ✅
- Upload abortado: arquivo parcial permanece em disco — FileService faz limpeza explícita no catch ✅

**Decisão:** Bun é viável. Streaming funciona sem buffering em memória.

## 2. TypeScript 5.8.3

**Motivo:** typescript-eslint não suporta TS 7.x. Mantemos TS 5.8.3 para compatibilidade com tooling.

## 3. Upload Multipart

**Escolha:** `@fastify/multipart` com streaming.

**Motivo:** Plugin oficial do Fastify. Streams para disco sem carregar o arquivo inteiro em memória. Limites de tamanho configuráveis via plugin + validação no FileService.

**Comportamento:** O plugin limita `fileSize` por arquivo. Nossa camada adicional valida contagem de arquivos por sessão.

## 4. Nomes de Arquivo no Disco

**Escolha:** UUID gerado pelo servidor como nome no disco. Nome original sanitizado guardado apenas para exibição.

**Motivo:** Elimina path traversal, colisão de nomes e caracteres problemáticos em sistemas de arquivos.

## 5. Tokens de Sessão

**Escolha:** 256 bits (32 bytes hex = 64 chars) via `crypto.randomBytes`.

**Motivo:** Muito acima do mínimo de 128 bits pedido. Comparação em tempo constante via `timingSafeEqual`.

## 6. Expiração por Inatividade

**Escolha:** `setTimeout` com `unref()` por sessão.

**Motivo:** Simples, sem dependência externa. `unref()` evita que timers impeçam o encerramento do processo. Timer é resetado a cada heartbeat e atividade de upload.

## 7. Limpeza de Órfãos

**Escolha:** Na inicialização, listar `TEMP_DIR` e remover diretórios que não correspondem a sessões ativas.

**Motivo:** Servidor pode ter caído com sessões abertas. Limpeza automática evita acúmulo de lixo.

## 8. Respostas de Erro

**Escolha:** Erros 5xx retornam mensagem genérica "Internal Server Error". Nunca expõem stack trace, caminhos de arquivo ou detalhes internos.

**Motivo:** Segurança. Detalhes completos vão apenas para o log do servidor.

## 9. Autorização

**Escolha:** Sessão inexistente e token inválido retornam a mesma resposta 401 idêntica.

**Motivo:** Não revelar se uma sessão existe ou não (enumeração).

## 10. CORS

**Escolha:** `ALLOWED_ORIGINS` configurável. Padrão `*` para LAN.

**Motivo:** Em rede local, qualquer origem pode precisar acessar. Em produção, pode ser restrito.

## 11. ZIP Sob Demanda: `fflate`

**Escolha:** `fflate` com `Zip` e `ZipPassThrough` para streaming incremental.

**Spike (2026-10-30):**
- Arquivo de 50MB processado via `spike/zip-spike.ts` sob Bun 1.4.4.
- Variação de heap estável (< 10MB), comprovando ausência de buffering total em memória.
- Streaming direto para resposta HTTP sem criar arquivos temporários em disco.

**Motivo:**
- Código TypeScript/JavaScript puro, sem dependências nativas (C/C++) ou incompatibilidades com o Bun.
- Facilidade de cancelamento: se a requisição do cliente for abortada, todos os streams de arquivos e o empacotador são interrompidos imediatamente, liberando descritores de arquivos.
