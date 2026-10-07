# API (NestJS + Prisma). Contexto de build: raiz do repositório.
#   docker build -f apps/api/Dockerfile -t hmu-api .

# ── dependências (todas, para compilar)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci -w @hospital/shared -w @hospital/api --include-workspace-root=false

# ── compilação
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @hospital/shared && npm run build -w @hospital/api

# ── imagem final: só dependências de produção, usuário sem privilégios
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev -w @hospital/shared -w @hospital/api --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npx prisma generate
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
# Migrations e criação do 1º administrador são comandos SEPARADOS (ver docs/DEPLOY.md), nunca automáticos no start.
CMD ["node", "dist/main.js"]
