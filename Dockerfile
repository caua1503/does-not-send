# Stage 1: Build front-end
FROM oven/bun:1.4.4 AS web-builder
WORKDIR /app/web

# Instalar dependências do front-end
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile

# Copiar código-fonte do front-end e gerar build
COPY web/ ./
RUN bun run build

# Stage 2: Runtime da aplicação
FROM oven/bun:1.4.4-slim AS runner
WORKDIR /app

# Criar usuário não-root por segurança
RUN groupadd -g 1001 bunjs && useradd -u 1001 -g bunjs -m bunjs

# Instalar apenas dependências de produção do backend
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copiar backend e artefatos compilados do frontend
COPY src/ ./src/
COPY tsconfig.json ./
COPY --from=web-builder /app/web/dist ./web/dist

# Criar pasta temporária com permissão do usuário
RUN mkdir -p /tmp/uploads && chown -R bunjs:bunjs /app /tmp/uploads

USER bunjs

ENV HOST=0.0.0.0
ENV PORT=3000
ENV TEMP_DIR=/tmp/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "--bun", "run", "src/server.ts"]
