# API Reference

## Base URL

Configurável via `PUBLIC_BASE_URL`. Padrão: `http://<HOST>:<PORT>`.

## Autenticação

Rotas protegidas aceitam o token via header HTTP:

```
Authorization: Bearer <token>
```

Para endpoints consumidos diretamente pelo navegador (`<img>`, `<video>`, `<iframe>`, `<a>` e WebSocket), o **ownerToken** pode ser fornecido via query param `?token=<token>`.

Dois tipos de token:
- **ownerToken**: acesso completo (listar, preview, download individual e ZIP, WebSocket, encerrar)
- **uploadToken**: somente enviar arquivos

---

## Rotas

### GET /health

Health check. Sem autenticação.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2026-10-30T12:00:00.000Z"
}
```

---

### POST /api/sessions

Cria uma nova sessão.

**Response 201:**
```json
{
  "id": "uuid-da-sessao",
  "ownerToken": "hex-64-chars",
  "uploadToken": "hex-64-chars",
  "createdAt": "2026-10-30T12:00:00.000Z"
}
```

---

### GET /api/sessions/:id

Info da sessão. Requer **ownerToken**.

**Response 200:**
```json
{
  "id": "uuid",
  "state": "active",
  "createdAt": "2026-10-30T12:00:00.000Z",
  "lastActivity": "2026-10-30T12:05:00.000Z",
  "fileCount": 3
}
```

**Response 401:** `{ "error": "Unauthorized", "statusCode": 401 }`

---

### DELETE /api/sessions/:id

Encerra sessão e apaga arquivos. Requer **ownerToken**.

**Response 204:** (sem corpo)

---

### POST /api/sessions/:id/heartbeat

Reseta timer de inatividade. Requer **ownerToken**.

**Response 200:**
```json
{ "ok": true }
```

---

### POST /api/sessions/:id/files

Upload de arquivos. Requer **uploadToken**. Content-Type: `multipart/form-data`.

Cada `part` do multipart é um arquivo. O campo `name` é livre; o `filename` é sanitizado.

**Response 201:**
```json
{
  "files": [
    {
      "id": "uuid-do-arquivo",
      "originalName": "foto.jpg",
      "size": 1048576
    }
  ]
}
```

**Response 413:** Arquivo ou quantidade acima do limite.

---

### GET /api/sessions/:id/files

Lista arquivos da sessão. Requer **ownerToken**.

**Response 200:**
```json
{
  "files": [
    {
      "id": "uuid",
      "originalName": "foto.jpg",
      "mimeType": "image/jpeg",
      "size": 1048576,
      "bytesReceived": 1048576,
      "state": "completed",
      "createdAt": "2026-10-30T12:00:00.000Z"
    }
  ]
}
```

---

### GET /api/sessions/:id/ws?token=\<ownerToken\>

Canal WebSocket em tempo real para acompanhamento da sessão. Requer **ownerToken** na query param `token`.

- Sem polling: eventos disparados diretamente do emissor interno da sessão.
- Isolamento: conexões só recebem eventos da própria sessão.
- Desconexão limpa: listeners desregistrados ao fechar ou desconectar.

**Close Codes do WebSocket:**
| Código | Motivo |
|--------|--------|
| 4000   | Sessão encerrada (`Session closed`) |
| 4001   | Não autorizado (`Unauthorized`) |

**Mensagens transmitidas:**
- `file:state-changed`:
```json
{
  "type": "file:state-changed",
  "sessionId": "uuid",
  "fileId": "uuid",
  "state": "receiving" | "completed" | "failed",
  "originalName": "foto.jpg",
  "size": 1048576,
  "bytesReceived": 1048576
}
```
- `file:progress`:
```json
{
  "type": "file:progress",
  "sessionId": "uuid",
  "fileId": "uuid",
  "bytesReceived": 524288,
  "size": 1048576
}
```

---

### GET /api/sessions/:id/files/:fileId/preview

Pré-visualização segura inline do arquivo. Requer **ownerToken** (header ou `?token=`).

- **Tipos permitidos inline:** imagens (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`), vídeos (`.mp4`, `.webm`, `.ogg`, `.mov`, `.avi`), áudios (`.mp3`, `.wav`, `.flac`, `.aac`, `.opus`, `.oga`) e `.pdf`.
- **Validação:** Verificação por lista de permissão de extensão e assinatura de magic bytes (PNG, JPEG, GIF, WEBP, PDF, MP3, WebM).
- **Tipos bloqueados inline:** `.html`, `.svg`, `.js`, etc., são forçados como download (`Content-Disposition: attachment`).
- **Range Requests:** Suporte a cabeçalho `Range: bytes=start-end` para vídeo e áudio (resposta HTTP 206 Partial Content e `Accept-Ranges: bytes`).

**Cabeçalhos de Segurança:**
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: sandbox`
- `Content-Disposition: inline; filename="<originalName>"` (ou `attachment` se não permitido inline)

**Response 200 / 206:** Stream do arquivo pré-visualizado.
**Response 404:** Arquivo não encontrado ou incompleto.

---

### GET /api/sessions/:id/files/:fileId/download

Download individual do arquivo em streaming. Requer **ownerToken** (header ou `?token=`).

**Headers da Resposta:**
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename*=UTF-8''<encoded>; filename="<encoded>"` (compatível com RFC 5987 para caracteres com acento e espaços)
- `Content-Length: <size>`

**Response 200:** Stream do conteúdo binário.
**Response 404:** Arquivo não encontrado ou sessão inválida.

---

### GET /api/sessions/:id/download.zip

Download sob demanda de todos os arquivos concluídos da sessão em um único arquivo ZIP. Requer **ownerToken** (header ou `?token=`).

- **Streaming:** Gerado on-the-fly via `fflate` sem salvar o ZIP intermediário em disco nem mantê-lo inteiro na memória.
- **Desduplicação de nomes:** Arquivos com nomes idênticos são renomeados como `nome (1).ext`.
- **Tratamento de aborto:** Caso o cliente aborte a requisição, todos os streams de leitura em aberto e o empacotador são interrompidos e liberados imediatamente.

**Headers da Resposta:**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="session-<id>.zip"`

**Response 200:** Stream chunked do arquivo ZIP.

---

## Códigos de Erro

| Código | Significado |
|--------|-------------|
| 401    | Token ausente, inválido, de outra sessão, ou sessão expirada/encerrada |
| 404    | Recurso não encontrado (arquivo incompleto, etc.) |
| 413    | Arquivo muito grande ou limite de arquivos por sessão excedido |
| 500    | Erro interno (sem detalhes na resposta) |

---

## Eventos Internos (TypeScript)

Emissor tipado em `src/utils/events.ts`. Estes eventos serão consumidos pelo WebSocket no prompt 2.

### `file:state-changed`

```typescript
interface FileStateChangedEvent {
  type: "file:state-changed";
  sessionId: string;
  fileId: string;
  state: "receiving" | "completed" | "failed";
  originalName: string;
  size: number;
  bytesReceived: number;
}
```

### `file:progress`

```typescript
interface FileProgressEvent {
  type: "file:progress";
  sessionId: string;
  fileId: string;
  bytesReceived: number;
  size: number;
}
```

Assinatura por sessão:
```typescript
import { fileEvents } from "./utils/events.js";

fileEvents.onFileEvent("file:state-changed", sessionId, (event) => { ... });
fileEvents.onFileEvent("file:progress", sessionId, (event) => { ... });
```

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `HOST` | `0.0.0.0` | Endereço de bind |
| `PORT` | `3000` | Porta |
| `TEMP_DIR` | `./tmp/uploads` | Diretório temporário |
| `MAX_FILE_SIZE` | `5368709120` (5GB) | Tamanho máximo por arquivo (bytes) |
| `MAX_FILES_PER_SESSION` | `50` | Máximo de arquivos por sessão |
| `SESSION_IDLE_TIMEOUT` | `1800000` (30min) | Timeout de inatividade (ms) |
| `ALLOWED_ORIGINS` | `*` | Origens CORS (separadas por vírgula) |
| `PUBLIC_BASE_URL` | *obrigatório* | URL pública para QR codes |

---

## Cabeçalhos de Segurança

Todas as respostas incluem:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0`
- `Content-Security-Policy: default-src 'none'`
- `Referrer-Policy: no-referrer`
