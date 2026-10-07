#!/usr/bin/env bash
# Painel de chamada (TV) em Raspberry Pi OS ou mini PC com Linux.
#  - espera o servidor do hospital responder (depois de faltar luz, ele pode ligar mais devagar);
#  - abre o Chromium em TELA CHEIA, com som e voz liberados sem precisar tocar na tela;
#  - se o navegador fechar, abre de novo; a tela nunca apaga.
#
# Preparação (uma vez):
#   sudo apt install chromium speech-dispatcher espeak-ng      # voz em português instalada no aparelho
#   sudo cp ca.crt /usr/local/share/ca-certificates/hmu-ca.crt && sudo update-ca-certificates
#   certutil -d sql:$HOME/.pki/nssdb -A -t 'C,,' -n 'HMU CA' -i ca.crt   # o Chromium usa este cadastro
#   cp deploy/painel/painel-tv.desktop ~/.config/autostart/            # abre sozinho ao ligar
#   (ajuste HMU_PAINEL_URL abaixo ou no arquivo .desktop; em Raspberry Pi, use "Autologin" no raspi-config)
set -u
ENDERECO="${HMU_PAINEL_URL:-https://atendimento.hmu.internal/painel-chamada?key=COLOQUE_A_CHAVE_DO_PAINEL}"
SAUDE="${ENDERECO%%/painel-chamada*}/api/health"
NAVEGADOR="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -n "$NAVEGADOR" ] || { echo "Chromium não encontrado (sudo apt install chromium)" >&2; exit 1; }

xset s off -dpms s noblank 2>/dev/null || true # tela nunca apaga (X11; no Wayland, desligue o descanso de tela nas configurações)

until curl -fsS --max-time 5 "$SAUDE" >/dev/null 2>&1; do sleep 10; done

while true; do
  "$NAVEGADOR" --kiosk --autoplay-policy=no-user-gesture-required --enable-speech-dispatcher \
    --noerrdialogs --disable-session-crashed-bubble --no-first-run --check-for-update-interval=31536000 \
    "$ENDERECO"
  sleep 5
done
