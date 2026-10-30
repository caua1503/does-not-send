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

---

## Limitações Conhecidas

- **Rede Local Única:** Não há roteamento NAT transversal ou servidores TURN/STUN externos. O computador e o telefone precisam se enxergar na sub-rede IP da LAN.
- **Ausência de Persistência:** Não existe histórico ou recuperação de arquivos pós-reinicialização ou após o encerramento da sessão.
