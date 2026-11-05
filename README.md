# does not send

Aplicação web para transferir arquivos entre telefone e computador na rede local (LAN).

- **Zero Dependência Externa:** Funciona 100% offline em rede local fechada, sem internet, sem nuvem e sem CDN.
- **Efêmero por Design:** Sem banco de dados, sem histórico persistente. Os arquivos ficam em armazenamento temporário (ou `tmpfs` em RAM) e são apagados imediatamente ao término da sessão.
- **Streaming de Ponta a Ponta:** Backend otimizado em Bun + Fastify consumindo streams sem buffering de arquivos inteiros na memória.
- **Privacidade & Segurança:** Tokens criptográficos aleatórios distintos para controle (`ownerToken`) e upload (`uploadToken`), cabeçalhos de isolamento (`nosniff`, `sandbox`), e porta exposta somente na LAN.

---

## Arquitetura

```
  ┌─────────────────────────────────────────────────────────────┐
  │                        REDE LOCAL                           │
  │                                                             │
  │  [Telefone / Navegador]               [Computador / Host]   │
  │          │                                     │            │
  │          │ 1. Escaneia QR                      │            │
  │          │ 2. POST /api/sessions/:id/files     │            │
  │          ├─────────────────────────► [Fastify Server (Bun)] │
  │          │ (Upload multipart com progresso)    │            │
  │          │                                     │ 3. Avisa via WS
  │          │                                     ├───────────►│
  │          │                                     │            │
  │          │                           4. Preview ou Baixar   │
  │          │                              individual / ZIP    │
  │          │                           ◄──────────────────────┤
  └──────────┴─────────────────────────────────────┴────────────┘
```

1. **Computador**: Acessa `/`, clica em **Nova Sessão** e visualiza o QR Code com a URL do uploadToken.
2. **Telefone**: Escaneia o QR Code, abrindo `/enviar/:id?token=...`. Seleciona fotos/vídeos/documentos com progresso real via `XMLHttpRequest`.
3. **Tempo Real**: Eventos de envio e conclusão são transmitidos em tempo real para o computador via WebSocket (`/api/sessions/:id/ws`).
4. **Download & Preview**: Pré-visualização inline protegida para imagens, áudio, vídeo e PDFs. Downloads individuais e ZIP sob demanda sem carregar na RAM.
5. **Encerramento**: Ao fechar a aba ou clicar em "Encerrar", o backend remove a sessão e limpa os arquivos temporários do disco.

---

## Requisitos

- [Bun](https://bun.sh) versão **1.4.4** ou superior (verifique com `bun --version`).
- Ou [Docker](https://docs.docker.com/) e Docker Compose.

---

## Instalação e Execução com Bun

### 1. Clonar e Instalar Dependências

```bash
# Dependências do backend
bun install

# Dependências do front-end
cd web && bun install && cd ..
```

### 2. Descobrir o IP da Máquina na Rede Local

Para permitir que o telefone acesse o servidor, você precisa do IP local:

- **Linux**: `ip route get 1 | awk '{print $7}'` ou `hostname -I | awk '{print $1}'`
- **macOS**: `ipconfig getifaddr en0` (ou `en1` no Wi-Fi)
- **Windows**: `ipconfig` (procure por Endereço IPv4 na placa Wi-Fi/Ethernet)

Exemplo de IP encontrado: `192.168.1.50`.

### 3. Compilar o Front-end e Iniciar

```bash
# Gerar os estáticos do front-end em web/dist
bun run build:web

# Iniciar o servidor apontando a URL pública para o QR Code
PUBLIC_BASE_URL=http://192.168.1.50:3000 PORT=3000 bun run start
```

Acesse `http://localhost:3000` (ou `http://192.168.1.50:3000`) no navegador do computador.

---

## Execução com Docker & Docker Compose

O Dockerfile utiliza compilação multi-stage com imagem oficial `oven/bun:1.4.4`, usuário não-root por segurança e volume `tmpfs` em memória RAM para os arquivos temporários.

### Iniciar com Docker Compose:

```bash
PUBLIC_BASE_URL=http://192.168.1.50:3000 PORT=3000 docker compose up -d --build
```

Verificar integridade do contêiner:
```bash
docker compose ps
```

Encerrar e descartar dados voláteis:
```bash
docker compose down
```

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PUBLIC_BASE_URL` | *Obrigatório* | URL acessível na rede para compor o link dos QR Codes (ex: `http://192.168.1.50:3000`) |
| `PORT` | `3000` | Porta TCP do servidor |
| `HOST` | `0.0.0.0` | Endereço de bind de rede |
| `TEMP_DIR` | `./tmp/uploads` | Diretório no disco para armazenamento temporário |
| `MAX_FILE_SIZE` | `5368709120` | Tamanho máximo por arquivo em bytes (padrão: 5GB) |
| `MAX_FILES_PER_SESSION`| `50` | Limite de arquivos por sessão |
| `SESSION_IDLE_TIMEOUT` | `1800000` | Tempo sem atividade para autodestruição da sessão (ms) (padrão: 30 min) |
| `ALLOWED_ORIGINS` | `*` | Origens aceitas pelo CORS (separadas por vírgula) |
| `DATABASE_URL` | *Opcional* | URL do Postgres (`postgres://usuario:senha@host:5432/banco`). Sem ela o banco fica desligado e o app funciona igual |
| `POSTGRES_PASSWORD` | — | Senha do usuário `app` no serviço `postgres` do Compose (somente ambiente/.env) |
| `TEST_DATABASE_URL` | *Opcional* | Banco **dedicado** a testes (nome terminado em `_test`). Sem ela, os testes de integração são pulados |

Credenciais nunca vão para o repositório: copie `.env.example` para `.env` (já no `.gitignore`) e troque a senha.

---

## Banco de Dados (Postgres + Drizzle)

O Postgres é infraestrutura **best-effort**: o app sobe, atende requisições e transfere arquivos mesmo com o banco
lento ou fora do ar. As migrações rodam em segundo plano no boot, com retry e backoff de 1s até 30s; o estado é
consultado por `db.isReady()` no contexto do app. O serviço não publica porta por padrão (rede interna do Compose).

### Subir apenas o banco

```bash
cp .env.example .env        # troque POSTGRES_PASSWORD
docker compose up -d postgres
docker compose ps           # aguarde o status (healthy)
```

O banco não é acessível a partir do host (sem porta publicada). Use o próprio contêiner:

```bash
docker compose exec postgres psql -U app -d doesnotsend
```

Para ferramentas gráficas ou um app rodando no host, crie um `docker-compose.override.yml` (não versionado):

```yaml
services:
  postgres:
    ports: ["127.0.0.1:5432:5432"]
```

Para recriar do zero (apaga o volume):

```bash
docker compose down -v
```

### Migrações

```bash
# 1. Altere src/db/schema.ts e gere o SQL versionado em drizzle/
bun run db:generate

# 2. Aplique manualmente (fora do app; falha rápido se o banco estiver fora).
#    DATABASE_URL vem do .env; com o banco só no Docker, rode dentro da rede do compose:
docker compose run --rm \
  -e DATABASE_URL=postgres://app:senha@postgres:5432/doesnotsend \
  -v "$PWD/drizzle:/app/drizzle:ro" \
  app bun run db:migrate
```

Em execução normal o app aplica as migrações pendentes sozinho no boot. Os arquivos `drizzle/*.sql` e
`drizzle/meta/` são versionados — não edite o SQL gerado à mão.

### Testes de banco

```bash
# Cria um banco de teste dedicado no serviço (uma vez)
docker compose up -d postgres
docker compose exec postgres psql -U app -d doesnotsend -c "CREATE DATABASE doesnotsend_test OWNER app"

# Roda os testes de integração (o setup recria os schemas public e drizzle).
# Requer o banco acessível do host (veja docker-compose.override.yml acima):
TEST_DATABASE_URL=postgres://app:senha@localhost:5432/doesnotsend_test bun run test:db
```

Sem `TEST_DATABASE_URL`, `bun run test` e `bun run test:db` funcionam normalmente (integração é pulada).
O setup recusa URLs que não terminem em `_test` para não apagar dados de outro banco.

---

## Testes & Garantia de Qualidade

### 1. Testes Automatizados (Backend e Front-end)

```bash
# Testes unitários e de integração do backend (Vitest)
bun run test

# Testes do front-end e componentes React (Vitest + Testing Library)
bun run test:web

# Checagem estática de tipagem estrita
bun run typecheck
bun run typecheck:web
```

### 2. Teste de Fumaça (End-to-End sem navegador)

O script sobe o servidor real, cria uma sessão, conecta no canal WebSocket, envia arquivos com `FormData`, confere os eventos e estados em tempo real, baixa arquivo e ZIP comparando o hash SHA-256 criptográfico, encerra a sessão e confere a exclusão completa do diretório temporário:

```bash
bun run smoke
```

---

## Solução de Problemas & Firewall

- **O telefone não abre a página do QR Code:**
  - Certifique-se de que o computador e o telefone estão conectados na **mesma rede Wi-Fi**.
  - Verifique o firewall do sistema operacional e libere o tráfego de entrada na porta TCP selecionada (ex: 3000):
    - *Linux (UFW):* `sudo ufw allow 3000/tcp`
    - *macOS:* Preferências do Sistema > Rede > Firewall (permitir conexões recebidas)
    - *Windows:* Painel de Controle > Firewall do Windows Defender > Permitir aplicativo
  - Confira se a variável `PUBLIC_BASE_URL` foi preenchida com o IP correto da LAN e não `localhost` ou `127.0.0.1`.

- **Falha no upload de arquivos grandes no telefone:**
  - Dispositivos móveis podem suspender o navegador em segundo plano. Mantenha a aba aberta durante a transferência.

- **Janela "Salvar como" não aparece ao baixar arquivos:**
  - Aplicações web não podem forçar nativamente a abertura da caixa de diálogo "Salvar como" no navegador do usuário por restrições de segurança do sandbox web. O arquivo é baixado usando o mecanismo nativo de downloads (`Content-Disposition: attachment` e atributo `download`).
  - Para escolher a pasta de destino e o nome de cada arquivo antes de salvar, ative nas configurações do navegador a opção **"Perguntar onde salvar cada arquivo antes de fazer download"** (Chrome/Edge/Brave: *Configurações > Downloads > Perguntar onde salvar cada arquivo antes de fazer download*; Firefox: *Configurações > Geral > Arquivos e Aplicativos > Sempre perguntar onde salvar arquivos*).

---

## Limitações Conhecidas

- **Rede Local Única:** Não há roteamento NAT transversal ou servidores TURN/STUN externos. O computador e o telefone precisam se enxergar na sub-rede IP da LAN.
- **Ausência de Persistência:** Não existe histórico ou recuperação de arquivos pós-reinicialização ou após o encerramento da sessão.
