#!/usr/bin/env bash
# Backup lógico CRIPTOGRAFADO do PostgreSQL (pg_dump formato custom + AES-256, chave derivada com PBKDF2),
# com verificação de integridade logo após gerar e rotação por idade. Ver docs/DEPLOY.md (Backup e restauração).
#
# Modos:
#   - Docker (padrão):      lê do serviço "db" do docker-compose.yml
#   - Direto (sem Docker):  defina BACKUP_DATABASE_URL=postgresql://usuario@host:5432/banco
#
# Variáveis:
#   BACKUP_PASSPHRASE_FILE  (obrigatória) arquivo com a frase-senha de criptografia — FORA do git e do servidor de banco
#   BACKUP_DIR              destino (padrão ./backups — ignorado pelo git)
#   RETENTION_DAYS          apaga backups locais mais antigos (padrão 30)
#   BACKUP_KEEP_MIN         mantém sempre ao menos estes mais recentes, qualquer que seja a data (padrão 14)
#   BACKUP_REQUIRE_MOUNT=1  exige que BACKUP_DIR seja um disco montado (evita gravar no disco do sistema se o HD saiu)
#   POSTGRES_DB / POSTGRES_OWNER  (modo Docker)
set -euo pipefail
umask 077

PASSFILE="${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE (arquivo com a frase-senha, fora do git)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB="${POSTGRES_DB:-hospital_production}"
OWNER="${POSTGRES_OWNER:-hospital_owner}"
ENC=(openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt)

[ -s "$PASSFILE" ] || { echo "arquivo de frase-senha vazio ou inexistente: $PASSFILE" >&2; exit 1; }
if [ "${BACKUP_REQUIRE_MOUNT:-0}" = "1" ] && ! mountpoint -q "$BACKUP_DIR"; then
  echo "ERRO: $BACKUP_DIR não é um disco montado (o HD de backup está conectado?). Nada foi gravado." >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"

if [ -n "${BACKUP_DATABASE_URL:-}" ]; then
  DB="$(basename "${BACKUP_DATABASE_URL%%\?*}")"
  dump() { pg_dump "$BACKUP_DATABASE_URL" -Fc --no-owner --no-privileges; }
  list() { pg_restore --list > /dev/null; }
else
  dump() { docker compose exec -T db pg_dump -U "$OWNER" -d "$DB" -Fc --no-owner --no-privileges; }
  list() { docker compose exec -T db pg_restore --list > /dev/null; }
fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/${DB}_${ts}.dump.enc"

dump | "${ENC[@]}" -pass file:"$PASSFILE" -out "$out"

# verificação: o arquivo descriptografa e é um dump legível pelo pg_restore
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:"$PASSFILE" -in "$out" | list
(cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")

# Rotação: apaga as cópias com mais de RETENTION_DAYS dias, mas SEMPRE mantém as BACKUP_KEEP_MIN mais recentes.
# A idade vem do relógio do servidor: se ele voltar para o passado (bateria da placa-mãe, sem NTP), a rotação para.
KEEP_MIN="${BACKUP_KEEP_MIN:-14}"
if [ -n "$(find "$BACKUP_DIR" -maxdepth 1 -name "${DB}_*.dump.enc" -newer "$out" -print -quit)" ]; then
  echo "AVISO: existem backups com data mais nova que o relógio deste servidor. Confira a hora (NTP/bateria da placa-mãe)." >&2
  echo "AVISO: rotação suspensa nesta execução; nenhum backup antigo foi apagado." >&2
else
  ls -1t "$BACKUP_DIR"/"${DB}"_*.dump.enc 2>/dev/null | tail -n +"$((KEEP_MIN + 1))" | while read -r old; do
    if [ -n "$(find "$old" -mtime +"$RETENTION_DAYS" -print)" ]; then rm -f -- "$old" "$old.sha256"; fi
  done
fi

echo "backup ok: $out ($(du -h "$out" | cut -f1))"
echo "lembrete: copie também para um HD externo (deploy/scripts/copiar-hd-externo.sh) e para fora do hospital (regra 3-2-1)."
