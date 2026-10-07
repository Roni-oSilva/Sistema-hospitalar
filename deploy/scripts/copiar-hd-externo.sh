#!/usr/bin/env bash
# Copia os backups CIFRADOS para um HD externo USB (2ª mídia, sem depender de internet) e confere cada cópia.
# Rodízio sugerido: dois HDs; um fica conectado ao servidor e o outro guardado FORA do prédio, trocando toda semana.
# Os arquivos já saem cifrados pelo backup.sh: o HD pode ser transportado. A frase-senha NUNCA vai junto.
#
# Uso:  deploy/scripts/copiar-hd-externo.sh /media/hd-backup        (o HD precisa estar MONTADO nesse caminho)
# Variáveis:
#   BACKUP_DIR      origem (padrão ./backups, a mesma do backup.sh)
#   KEEP_ON_DISK    quantos backups manter no HD (padrão 60; os mais antigos saem primeiro)
set -euo pipefail
umask 077

DEST="${1:?informe onde o HD externo está montado, ex.: /media/hd-backup}"
SRC="${BACKUP_DIR:-./backups}"
KEEP="${KEEP_ON_DISK:-60}"

# sem HD conectado, o caminho existe mas é uma pasta do próprio servidor: copiar ali não protegeria nada
if ! mountpoint -q "$DEST"; then
  echo "ERRO: não há disco montado em $DEST. Conecte o HD externo (e monte-o) antes de copiar." >&2
  exit 1
fi

target="$DEST/hmu-backups"
mkdir -p "$target"

# só os KEEP backups mais recentes (o nome traz a data do backup: ordenar pelo nome é estável em qualquer HD)
mapfile -t recent < <(find "$SRC" -maxdepth 1 -name '*.dump.enc' -printf '%f\n' | sort -r | head -n "$KEEP")

copied=0
for name in "${recent[@]}"; do
  [ -e "$target/$name" ] && continue
  if [ ! -e "$SRC/$name.sha256" ]; then
    echo "AVISO: $name não tem .sha256 (backup incompleto?); ignorado." >&2
    continue
  fi
  if ! (cd "$SRC" && sha256sum -c --quiet -- "$name.sha256" >/dev/null 2>&1); then
    echo "AVISO: o backup $name no SERVIDOR não confere com o seu .sha256 (arquivo danificado); não foi copiado." >&2
    continue
  fi
  cp -- "$SRC/$name" "$SRC/$name.sha256" "$target/"
  # confere a cópia NO HD (não a original): só conta como copiado se estiver íntegro
  if ! (cd "$target" && sha256sum -c --quiet -- "$name.sha256"); then
    echo "ERRO: a cópia de $name no HD não confere. O HD pode estar com defeito; troque-o." >&2
    rm -f -- "$target/$name" "$target/$name.sha256"
    exit 1
  fi
  copied=$((copied + 1))
done

# rotação no HD: mantém os KEEP mais recentes (pelo nome)
find "$target" -maxdepth 1 -name '*.dump.enc' -printf '%f\n' | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$target/$old" "$target/$old.sha256"
done

sync
total="$(find "$target" -maxdepth 1 -name '*.dump.enc' | wc -l)"
echo "$(date '+%d/%m/%Y %H:%M') copiados: $copied; no HD: $total backup(s); espaço livre: $(df -h --output=avail "$DEST" | tail -1 | tr -d ' ')" | tee -a "$target/registro-copias.txt"
echo "Para levar o HD: sudo umount $DEST (só depois desconecte o cabo)."
