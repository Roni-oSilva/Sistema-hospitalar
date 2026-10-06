# HMU Atende — Sistema Digital de Atendimento

**Hospital Municipal de Ulianópolis (PA)** — do balcão ao consultório em um único atendimento:

```text
PACIENTE CHEGA → RECEPÇÃO → TRIAGEM → CLASSIFICAÇÃO DE RISCO → FILA MÉDICA → CONSULTÓRIO
              → ATENDIMENTO MÉDICO → MEDICAÇÃO/CONDUTA → FIM DO FLUXO INICIAL
```

O paciente é cadastrado **uma vez**; recepção, triagem e médico trabalham sobre o **mesmo atendimento**
(`ATD-2026-000001`), com filas em tempo real, linha do tempo completa e auditoria imutável.

> ⚠️ **Dados reais de saúde.** Nunca use dados reais em desenvolvimento, testes, seeds, logs, prints ou no GitHub.
> Leia [`docs/SECURITY.md`](docs/SECURITY.md) antes de colocar em produção.

## Documentação

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Análise do requisito, inconsistências resolvidas, decisões, módulos, estados, tempo real, concorrência, evolução futura |
| [DATABASE.md](docs/DATABASE.md) | Tabelas, relacionamentos, travas no banco (índices parciais, CHECKs, triggers), migrations, seed |
| [API.md](docs/API.md) | Endpoints, permissões exigidas, erros, tempo real |
| [SECURITY.md](docs/SECURITY.md) | Autenticação, sessões, RBAC, CSRF, auditoria, privacidade/LGPD, limitações conhecidas |
| [DEPLOY.md](docs/DEPLOY.md) | Docker, Nginx/HTTPS, migrations, 1º administrador, backup, restauração, recuperação de desastre |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Todas as variáveis de ambiente e a separação development / staging / production |

## Stack (e por quê)

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind 4 | rotas por perfil, build *standalone* para Docker |
| Backend | NestJS 11 + TypeScript | módulos, guards globais (autenticação/permissão), injeção de dependência |
| Banco | PostgreSQL 16 + Prisma 6 | transações, índices parciais, CHECKs e triggers garantem as regras mesmo fora da aplicação |
| Tempo real | Socket.IO | filas atualizam sozinhas; payloads só com IDs (nunca dados clínicos) |
| Validação | zod (pacote `@hospital/shared`) | **o mesmo schema** valida no navegador e na API |
| Proxy | Nginx | HTTPS, mesma origem para Web/API/WebSocket, logs sem dados pessoais |
| Redis | **não usado** | desnecessário com 1 instância da API; ver “Escalar” em DEPLOY.md |

## Estrutura

```text
apps/api          API NestJS (src/<módulo>), Prisma (prisma/schema.prisma, migrations, seed), testes e2e (test/)
apps/web          Next.js (src/app/<rotas>, src/components, src/lib)
packages/shared   enums, permissões, máquina de estados, validadores CPF/CNS, schemas zod, datas no fuso do hospital
e2e               teste de navegador (Playwright) do fluxo completo de 16 passos
deploy            nginx, SQL de menor privilégio, scripts de backup/restauração, exemplos de variáveis
docs              documentação
```

## Rodando localmente (desenvolvimento)

Pré-requisitos: Node 22+, PostgreSQL 16 (local ou `docker-compose.dev.yml`).

```bash
# 1. banco local (opção Docker) — a senha fica só no seu terminal
export DEV_DB_PASSWORD=$(openssl rand -hex 12)
npm run db:up

# 2. dependências
npm install

# 3. configuração (arquivos .env NUNCA vão para o git)
cp apps/api/.env.example apps/api/.env            # ajuste DATABASE_URL (banco hospital_dev)
cp apps/api/.env.test.example apps/api/.env.test  # banco hospital_test (apagado a cada execução da suíte)
cp apps/web/.env.example apps/web/.env.local

# 4. banco: migrations + seed de DESENVOLVIMENTO (dados 100% fictícios)
npm run build:shared
npm run db:migrate
npm run db:seed

# 5. subir tudo (shared em watch + API :4000 + Web :3000)
npm run dev
```

Acesse <http://localhost:3000>. Usuários do seed (senha `Desenvolvimento2026`, só em desenvolvimento):

| Usuário | Perfil | Tela inicial |
|---|---|---|
| `recepcao` | Recepção | `/recepcao` |
| `triagem` | Triagem | `/triagem` |
| `medico`, `medico2` | Médico | `/medico` |
| `admin` | Administrador | `/dashboard` |

Painel público (TV): <http://localhost:3000/painel-chamada>.

## Testes

```bash
npm test               # shared (unitários) + API (e2e em PostgreSQL real: os 13 fluxos críticos + segurança)
npm run test:e2e       # navegador: fluxo completo com 4 usuários simultâneos (precisa de `npm run dev` + seed)
npm run lint && npm run typecheck
```

A suíte da API **recria o schema** do banco de testes a cada execução e se recusa a rodar se o nome do banco não
terminar em `_test`. Os 13 testes do requisito estão em `apps/api/test/flow.e2e-spec.ts` (TESTE 1 a TESTE 13);
concorrência real (requisições paralelas), imutabilidade no banco, sessão, CSRF e tempo real em
`apps/api/test/security-integrity.e2e-spec.ts`.

## Build e produção

```bash
npm run build                      # shared + API + Web
docker compose up -d --build       # ver docs/DEPLOY.md (HTTPS, migrations, 1º administrador, backup)
```

## Princípios do produto

- **Segurança + velocidade + simplicidade + rastreabilidade.** Nenhum dos quatro é sacrificado pelos outros.
- **O software não decide pelo profissional:** sem diagnóstico, prescrição ou classificação de risco automáticos.
- **Acessibilidade apoia, não prioriza clinicamente:** PCD, idoso, gestante etc. aparecem nas filas, mas nunca
  mudam o nível de risco (desempate legal opcional, configurável e desligado por padrão).
- **Nada é apagado em silêncio:** correções geram versões; o banco recusa UPDATE/DELETE em históricos.
