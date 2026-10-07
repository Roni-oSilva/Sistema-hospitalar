# Web (Next.js, saída standalone). Contexto de build: raiz do repositório.
#   docker build -f apps/web/Dockerfile -t hmu-web .
# Em produção o Nginx serve /api e /socket.io na MESMA origem: NEXT_PUBLIC_SOCKET_URL fica vazio.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci -w @hospital/shared -w @hospital/web --include-workspace-root=false

FROM deps AS build
ARG NEXT_PUBLIC_SOCKET_URL=""
ARG NEXT_PUBLIC_HOSPITAL_TIMEZONE="America/Belem"
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SOCKET_URL=${NEXT_PUBLIC_SOCKET_URL} NEXT_PUBLIC_HOSPITAL_TIMEZONE=${NEXT_PUBLIC_HOSPITAL_TIMEZONE}
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @hospital/shared && npm run build -w @hospital/web

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/web/server.js"]
