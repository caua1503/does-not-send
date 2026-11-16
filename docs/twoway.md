# Contrato frontend — Sessão de troca (twoway)

## Criar sessão

`POST /api/sessions`

```json
{ "mode": "twoway", "name": "Host", "device": "desktop" }
```

Resposta `201` acrescenta `mode`, `hostId` e `participants` aos campos atuais:

```json
{
  "id": "uuid",
  "mode": "twoway",
  "hostId": "uuid",
  "participants": [{ "id": "uuid", "name": "Host", "device": "desktop" }],
  "ownerToken": "...",
  "computerToken": "...",
  "qrToken": "...",
  "visualId": "ABC123",
  "shortId": "ABC123"
}
```

Sem `mode`, a sessão é `oneway` (contrato atual preservado).

## Entrar como participante

`POST /api/sessions/:id/participants`

```json
{ "name": "Ana", "device": "phone", "qrToken": "..." }
```

Ou `{ "name": "Ana", "device": "phone", "code": "123456" }`.

- `201`: `{ sessionId, mode, participant: { id, name, device }, credential }`
- `400`: nome vazio após sanitização
- `401`: QR/código inválido
- `404`: sessão inexistente
- `409` `WRONG_MODE` (oneway) ou `SESSION_FULL`
- `410`: sessão encerrada
- `429` + `Retry-After`: excesso de tentativas por IP

O `credential` é exibido uma única vez e vai no header `Authorization: Bearer` das
rotas HTTP e no `secret` do WebSocket.

## Rotas de itens

Com o `credential` do participante (ou token do host):

- `GET /api/sessions/:id/files` — histórico, inclusive itens anteriores à entrada.
- `POST /api/sessions/:id/files` — upload (`?kind=text` para texto).
- `GET /api/sessions/:id/files/:fileId/download`
- `GET /api/sessions/:id/files/:fileId/preview`
- `GET /api/sessions/:id/download.zip`
- `DELETE /api/sessions/:id/files/:fileId` — autor do item ou host; `204`.
- `DELETE /api/sessions/:id` — somente host; `403` para convidado.

Itens listados incluem `senderId`, `senderName` e `origin` (`phone` | `desktop`).

## WebSocket

`GET /api/sessions/:id/ws`, primeira mensagem:

```json
{ "type": "auth", "role": "guest", "secret": "<credential>" }
```

O host usa `role: "computer"` com `ownerToken`.

Eventos enviados pelo servidor:

```json
{ "type": "participants:list", "participants": [{ "id": "...", "name": "Ana", "device": "phone" }] }
{ "type": "participant:joined", "id": "...", "name": "Ana", "device": "phone" }
{ "type": "participant:left", "id": "..." }
{ "type": "item:added", "id": "...", "kind": "file", "name": "a.txt", "size": 3, "senderId": "...", "senderName": "Ana", "origin": "phone", "createdAt": "ISO" }
{ "type": "item:deleted", "id": "..." }
{ "type": "session:closed" }
```

`participants:list` chega ao socket que entrou; `participant:joined` vai aos demais;
`item:added` vai a todos, uma vez por item, inclusive ao autor.

No oneway nada muda: eventos `file:state-changed`/`file:progress` e
`{"type":"session_closed","reason":"..."}` continuam como antes.

## Limites e expiração

- `TWOWAY_MAX_PARTICIPANTS` (padrão 10)
- `TWOWAY_MAX_TOTAL_BYTES` (padrão 10 GiB); exceder responde `413`
- `TWOWAY_IDLE_TIMEOUT_MS` (padrão 30 min); a sessão inativa é encerrada,
  arquivos e participantes são apagados e o código deixa de valer

QR e código numérico permanecem válidos enquanto a sessão estiver aberta.
