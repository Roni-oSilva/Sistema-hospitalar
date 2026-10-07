# Variáveis de ambiente

Nenhum segredo fica no código. Desenvolvimento usa `apps/api/.env`, `apps/api/.env.test` e `apps/web/.env.local`
(todos fora do git; copie dos `*.example`). Staging/produção usam `deploy/env/*.env` (fora do git) ou o cofre de
segredos do servidor.

## API (`apps/api`)

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `APP_ENV` | sim | `development` | `development` \| `test` \| `staging` \| `production` |
| `DATABASE_URL` | **sim** | — | PostgreSQL. Em produção, o usuário de menor privilégio `hospital_app` |
| `WEB_ORIGIN` | **sim** | — | origem(ns) do site, separadas por vírgula (CORS + anti-CSRF). Produção: `https://` |
| `PORT` | não | `4000` | porta HTTP |
| `COOKIE_SECURE` | não | `true` em staging/produção | `false` só em desenvolvimento local (http) |
| `TRUST_PROXY` | não | `0` | proxies confiáveis para `X-Forwarded-For` (Nginx na frente = `1`) |
| `HOSPITAL_TIMEZONE` | não | `America/Belem` | fuso do “dia do hospital” |
| `LOG_LEVEL` | não | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PUBLIC_PANEL_KEY` | recomendada em produção | — | chave da TV (`/painel-chamada?key=…`), ≥ 16 caracteres |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` | não | `19456` / `2` | custo do hash de senha |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | não | `5` / `15` | bloqueio por tentativas |
| `RATE_LIMIT_PER_MINUTE` / `LOGIN_RATE_LIMIT_PER_MINUTE` | não | `900` / `20` | limites por sessão/IP |
| `BOOTSTRAP_ADMIN_USERNAME` / `_PASSWORD` / `_NAME` | só no bootstrap | — | 1º administrador (apague depois) |
| `SEED_DEV_PASSWORD` | não (dev) | `Desenvolvimento2026` | senha dos usuários fictícios do seed |

Travas na inicialização: a API **não sobe** se `APP_ENV=production` apontar para banco com `dev`/`test` no nome,
se `development`/`test` apontar para `prod`/`staging`, ou se produção não usar HTTPS e cookie seguro.

## Web (`apps/web`) — lidas no **build**

| Variável | Padrão | Descrição |
|---|---|---|
| `API_INTERNAL_URL` | `http://localhost:4000` | para onde o Next encaminha `/api` em desenvolvimento (produção: Nginx) |
| `NEXT_PUBLIC_SOCKET_URL` | vazio | desenvolvimento: `http://localhost:4000`; produção: **vazio** (mesma origem) |
| `NEXT_PUBLIC_HOSPITAL_TIMEZONE` | `America/Belem` | fuso exibido nas telas |

## Testes

| Variável | Onde | Descrição |
|---|---|---|
| `DATABASE_URL` | `apps/api/.env.test` ou CI | banco **`*_test`** (a suíte recria o schema) |
| `E2E_BASE_URL` | e2e | padrão `http://localhost:3000` |
| `E2E_PASSWORD` | e2e | senha dos usuários do seed (padrão `Desenvolvimento2026`) |
| `PW_CHROMIUM_PATH` | e2e | caminho de um Chromium já instalado (opcional) |
| `E2E_PANEL_KEY` | e2e | chave do painel, quando a API de teste tem `PUBLIC_PANEL_KEY` (homologação) |

## Implantação (Docker / scripts)

| Arquivo / variável | Uso |
|---|---|
| `deploy/secrets/db_owner_password.txt` | senha do dono do banco (secret do Docker) |
| `deploy/secrets/app_password.txt` | senha do `hospital_app` (usada no `app-role.sql` e no `DATABASE_URL` da API) |
| `deploy/env/api.env`, `migrate.env`, `bootstrap.env` | variáveis de cada serviço (copiar dos `.example`) |
| `POSTGRES_DB` / `POSTGRES_OWNER` | nome do banco e do dono no `docker-compose.yml` |
| `BACKUP_PASSPHRASE_FILE` | frase-senha dos backups cifrados (guardar fora do servidor do banco) |
| `BACKUP_DIR`, `RETENTION_DAYS`, `BACKUP_DATABASE_URL`, `RESTORE_ADMIN_URL` | opções dos scripts de backup/restauração |
| `DEV_DB_PASSWORD` | senha do Postgres do `docker-compose.dev.yml` (só desenvolvimento, só no terminal) |
| `HMU_VERSION` (`.env` ao lado do compose) | versão das imagens `hmu-api`/`hmu-web` (padrão `latest`); permite voltar atrás sem internet |
| `HMU_BIND_IP` (`.env` ao lado do compose) | IP da rede do hospital em que o Nginx atende (padrão: todas as interfaces) |
| `BACKUP_KEEP_MIN` | `backup.sh`: mantém sempre ao menos estes backups mais recentes (padrão 14) |
| `BACKUP_REQUIRE_MOUNT=1` | `backup.sh`: recusa gravar se `BACKUP_DIR` não for um disco montado |
| `KEEP_ON_DISK` | `copiar-hd-externo.sh`: quantos backups manter no HD externo (padrão 60) |
| `CA_DIR`, `OUT_DIR`, `CERT_DAYS` | `certificado-local.sh`: onde fica a autoridade interna, onde gravar o certificado e a validade (padrão 825 dias) |
