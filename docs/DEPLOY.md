# Implantação, backup e recuperação

Cenário de referência: um servidor Linux **dentro do hospital**, com Docker, acessado pela rede interna via HTTPS.
É isso que faz o sistema **funcionar sem internet** — guia completo (rede, nome local, hora, TV, compras, testes) em
[SEM-INTERNET.md](SEM-INTERNET.md). Um servidor na nuvem pararia o hospital sempre que a internet caísse.
Se o servidor ou a rede local caírem, siga a [contingência em papel](CONTINGENCIA.md).

## 1. Ambientes separados

| Ambiente | Banco | `APP_ENV` | Dados |
|---|---|---|---|
| development | `hospital_dev` (máquina do desenvolvedor) | `development` | seed **fictício** |
| test | `hospital_test` (recriado a cada execução) | `test` | fictícios gerados pelos testes |
| staging | `hospital_staging` (servidor de homologação) | `staging` | **fictícios** ou anonimizados — nunca cópia de produção |
| production | `hospital_production` | `production` | reais |

Cada ambiente tem servidor/banco, credenciais e chaves **próprias**. A API recusa iniciar com combinações perigosas
(ver ENVIRONMENT.md).

## 2. Primeira implantação (Docker)

```bash
git clone <repo> && cd Sistema-hospitalar

# 2.1 segredos (fora do git)
mkdir -p deploy/secrets deploy/nginx/certs
# só letras e números (hex): '/', '+' e '=' do base64 quebrariam o DATABASE_URL
openssl rand -hex 24 > deploy/secrets/db_owner_password.txt
openssl rand -hex 24 > deploy/secrets/app_password.txt
chmod 600 deploy/secrets/*

# 2.2 certificado TLS — HTTPS é obrigatório. Na rede do hospital, use a autoridade interna (não depende de internet):
deploy/scripts/certificado-local.sh atendimento.hmu.internal 192.168.0.10   # nome interno + IP fixo do servidor
#     e instale deploy/secrets/ca/ca.crt em cada computador, tablet e aparelho da TV (ver SEM-INTERNET.md, passo 5)
#     (Let's Encrypt só serve com domínio público e internet para renovar a cada 90 dias)

# 2.3 variáveis (copie os exemplos e preencha com as senhas acima e o endereço real)
cp deploy/env/api.env.example deploy/env/api.env       # WEB_ORIGIN=https://atendimento.hmu.internal,https://192.168.0.10
cp deploy/env/migrate.env.example deploy/env/migrate.env
cp deploy/env/bootstrap.env.example deploy/env/bootstrap.env
echo "HMU_BIND_IP=192.168.0.10" > .env                 # atende só na rede do hospital

# 2.4 subir banco e imagens
#     COM internet no servidor:
docker compose up -d db
docker compose build api web
#     SEM internet no servidor: carregue o kit offline (SEM-INTERNET.md, passo 7) e use sempre --no-build:
#       gunzip -c hmu-imagens-<versão>.tar.gz | docker load && echo "HMU_VERSION=<versão>" >> .env
#       docker compose up -d --no-build --pull never db

# 2.5 migrations (usuário DONO) e usuário de menor privilégio para a API
docker compose run --rm migrate
docker compose exec -T db psql -U hospital_owner -d hospital_production \
  -v app_password="$(cat deploy/secrets/app_password.txt)" -v owner=hospital_owner -f - < deploy/sql/app-role.sql

# 2.6 dados de referência + 1º administrador (senha temporária, troca obrigatória) — depois apague bootstrap.env
docker compose run --rm bootstrap && rm deploy/env/bootstrap.env

# 2.7 aplicação
docker compose up -d                       # (sem internet: docker compose up -d --no-build --pull never)
curl --cacert deploy/secrets/ca/ca.crt https://192.168.0.10/api/health      # {"status":"ok"}
```

Depois, entre como o administrador, troque a senha, configure consultórios, parâmetros (nome do hospital,
protocolo, metas de espera) e crie os usuários de cada pessoa. Na TV da recepção, abra
`https://<servidor>/painel-chamada?key=<PUBLIC_PANEL_KEY>` em tela cheia e clique em “Ativar som e voz”.

## 3. Atualizações

```bash
deploy/scripts/backup.sh            # sempre antes
git pull && docker compose build api web        # com internet; sem internet: kit offline (SEM-INTERNET.md, passo 7)
docker compose run --rm migrate     # aplica migrations novas (somente adiciona; nunca edite as antigas)
docker compose exec -T db psql -U hospital_owner -d hospital_production -v app_password="$(cat deploy/secrets/app_password.txt)" -v owner=hospital_owner -f - < deploy/sql/app-role.sql
docker compose up -d                 # troca API e Web (o Nginx acompanha sozinho: não precisa reiniciá-lo)
```

Marque a versão das imagens (`HMU_VERSION` no `.env`) a cada atualização e guarde as duas últimas: assim dá para
voltar atrás mesmo sem internet.

Se uma versão nova trouxer **permissão nova**, o bootstrap cria a permissão no catálogo, mas **não** a concede a
perfis já existentes (para não desfazer ajustes do administrador): conceda em “Perfis e permissões”.
Rollback: troque `HMU_VERSION` para a versão anterior e `docker compose up -d --no-build`; migrations são aditivas —
se uma migration precisar ser desfeita, restaure o backup feito antes da atualização.

## 4. Build sem Docker

```bash
npm ci && npm run build
APP_ENV=production DATABASE_URL=... WEB_ORIGIN=https://... node apps/api/dist/main.js
NODE_ENV=production node apps/web/.next/standalone/apps/web/server.js   # copie .next/static e public ao lado
```
Coloque o Nginx (`deploy/nginx/nginx.conf`) na frente, com `TRUST_PROXY=1`. Atenção: `NEXT_PUBLIC_SOCKET_URL` é
gravado **no build** da Web e precisa estar **vazio** em produção (mesma origem). Um `apps/web/.env.local` de
desenvolvimento com `http://localhost:4000` faria cada computador procurar o tempo real nele mesmo.

## 5. Backup

`deploy/scripts/backup.sh` gera um dump do PostgreSQL **cifrado com AES-256** (PBKDF2), confere se ele
descriptografa e é legível, grava o SHA-256 e apaga cópias locais antigas.

```bash
# a frase-senha fica num arquivo só do root (o agendamento precisa dela) E impressa em envelope lacrado no cofre
# (não só num cofre de senhas na nuvem: sem internet ele fica inacessível). Perder a frase = perder o backup.
BACKUP_PASSPHRASE_FILE=/root/.hmu-backup-pass deploy/scripts/backup.sh
deploy/scripts/copiar-hd-externo.sh /media/hd-backup     # 2ª cópia, em HD externo, conferida por SHA-256
```

Agende no `cron` do servidor (ex.: a cada 6 h e diário às 03:00):

```cron
0 */6 * * * cd /opt/Sistema-hospitalar && BACKUP_PASSPHRASE_FILE=/root/.hmu-backup-pass deploy/scripts/backup.sh >> /var/log/hmu-backup.log 2>&1
```

**Regra 3-2-1** sem depender de internet: 3 cópias (servidor + 2 HDs externos em rodízio semanal), 2 mídias, 1 fora
do hospital (o HD da semana anterior, guardado em outro prédio). Com internet, uma cópia na nuvem é um extra.
A rotação sempre mantém os 14 backups mais recentes (`BACKUP_KEEP_MIN`) e para se o relógio do servidor voltar
para o passado; `BACKUP_REQUIRE_MOUNT=1` impede gravar no disco do sistema quando `BACKUP_DIR` é um HD desconectado.
Objetivos sugeridos: RPO ≤ 6 h com dumps; para RPO de minutos, habilite arquivamento de WAL (PITR, ex.: pgBackRest).

## 6. Restauração

Sempre em um **banco novo** — nunca por cima do atual:

```bash
BACKUP_PASSPHRASE_FILE=/root/.hmu-backup-pass \
  deploy/scripts/restore.sh backups/hospital_production_20261006T030000Z.dump.enc hospital_restore_20261006
```

O script confere o SHA-256, cria o banco e restaura em transação única. Depois: confira contagens (pacientes,
atendimentos, auditoria), aplique `deploy/sql/app-role.sql` no banco restaurado e só então troque o
`DATABASE_URL` e reinicie a API. Os triggers de imutabilidade são recriados junto (verificado).

## 7. Recuperação de desastre

1. Servidor perdido: provisione outro com Docker (de preferência o **servidor reserva**, já instalado), carregue o
   **kit offline** (imagens + `deploy/env`, `deploy/secrets` e a autoridade certificadora — guardados cifrados fora do
   servidor), restaure o último backup (seção 6), aplique `migrate` (caso o backup seja de versão anterior) e suba a
   aplicação. Com a mesma autoridade (`ca.key`), os aparelhos não precisam de nada novo.
2. Banco corrompido/apagado: pare a API, restaure em banco novo, aponte a API para ele.
3. Comprometimento de credenciais: troque senhas do banco e `PUBLIC_PANEL_KEY`, encerre todas as sessões
   (`UPDATE sessions SET revoked_at = now()` como dono do banco), force troca de senha dos usuários afetados e
   analise `audit_logs`/`access_logs`.
4. **Teste a restauração mensalmente** (restaurar em `hospital_restore_*` e conferir contagens). Backup não
   testado não é backup.

Durante indisponibilidade, mantenha um procedimento de contingência em papel (ficha de atendimento) e digite
depois, registrando o horário real nas observações.

## 8. Escalar

Uma instância da API atende com folga um hospital municipal. Para várias instâncias atrás do Nginx: adicione Redis
com `@socket.io/redis-adapter` (eventos entre instâncias) e o armazenamento Redis do `@nestjs/throttler`; as
sessões já ficam no PostgreSQL (nada a mudar).
