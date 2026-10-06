#!/usr/bin/env bash
# Restauração de um backup gerado por backup.sh, SEMPRE em um banco NOVO e VAZIO (nunca por cima do atual).
# Depois de conferir os dados, aponte a aplicação para o banco restaurado. Ver docs/DEPLOY.md.
#
#   deploy/scripts/restore.sh backups/hospital_production_20261006T030000Z.dump.enc hospital_restore_20261006
#
# Modos: Docker (padrão, serviço "db") ou direto com RESTORE_ADMIN_URL=postgresql://dono@host:5432/postgres
set -euo pipefail

file="${1:?uso: restore.sh <arquivo.dump.enc> <banco_destino_novo>}"
target="${2:?informe o nome do banco de destino (novo)}"
PASSFILE="${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE}"
OWNER="${POSTGRES_OWNER:-hospital_owner}"

[[ "$target" =~ ^[a-z0-9_]+$ ]] || { echo "nome de banco inválido: $target" >&2; exit 1; }

# integridade do arquivo
if [ -f "$file.sha256" ]; then (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256"); else echo "aviso: sem .sha256 para conferir"; fi

if [ -n "${RESTORE_ADMIN_URL:-}" ]; then
  base="${RESTORE_ADMIN_URL%/*}"
  psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$target\""
  restore() { pg_restore -d "$base/$target" --no-owner --no-privileges --single-transaction --exit-on-error; }
else
  docker compose exec -T db psql -U "$OWNER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$target\" OWNER \"$OWNER\""
  restore() { docker compose exec -T db pg_restore -U "$OWNER" -d "$target" --no-owner --no-privileges --single-transaction --exit-on-error; }
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:"$PASSFILE" -in "$file" | restore

echo "restauração concluída no banco NOVO \"$target\"."
echo "próximos passos: conferir contagens (pacientes/atendimentos/auditoria), aplicar deploy/sql/app-role.sql nele e só então trocar o DATABASE_URL."
