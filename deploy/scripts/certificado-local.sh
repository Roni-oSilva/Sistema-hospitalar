#!/usr/bin/env bash
# Certificado HTTPS para a rede INTERNA do hospital, sem depender da internet
# (Let's Encrypt precisa de internet para emitir e para renovar).
#
# Na primeira vez cria a autoridade certificadora (CA) própria do hospital; depois, com ela, emite o
# certificado do servidor e grava em deploy/nginx/certs/ (onde o Nginx procura).
# O arquivo ca.crt (público) é instalado UMA vez em cada computador, tablet e TV como "autoridade confiável".
# A ca.key é o segredo que assina certificados: guarde fora do servidor (cofre da TI) depois de usar.
#
# Uso:   deploy/scripts/certificado-local.sh <nome-do-servidor> [ip ...]
# Exemplo: deploy/scripts/certificado-local.sh atendimento.hmu.internal 192.168.0.10
# Renovar: rode de novo antes do vencimento (a CA existente é reaproveitada; nada muda nos aparelhos).
set -euo pipefail

NAME="${1:?informe o nome do servidor, ex.: atendimento.hmu.internal}"
shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CA_DIR="${CA_DIR:-$ROOT/deploy/secrets/ca}"
OUT_DIR="${OUT_DIR:-$ROOT/deploy/nginx/certs}"
# 825 dias é o máximo que iPhone/iPad/Mac aceitam de CA privada; Windows, Android, Chrome e Firefox aceitam.
DAYS="${CERT_DAYS:-825}"

umask 077
mkdir -p "$CA_DIR" "$OUT_DIR"

if [[ ! -f "$CA_DIR/ca.key" ]]; then
  echo "Criando a autoridade certificadora interna (válida por 10 anos)…"
  openssl ecparam -name prime256v1 -genkey -noout -out "$CA_DIR/ca.key"
  openssl req -x509 -new -key "$CA_DIR/ca.key" -sha256 -days 3650 \
    -subj "/O=Hospital Municipal de Ulianopolis/CN=HMU Autoridade Certificadora Interna" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$CA_DIR/ca.crt"
fi

SAN="DNS:$NAME"
for ip in "$@"; do SAN+=",IP:$ip"; done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/key.pem"
openssl req -new -key "$tmp/key.pem" -subj "/CN=$NAME" -out "$tmp/req.csr"
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$SAN" >"$tmp/ext.cnf"
openssl x509 -req -in "$tmp/req.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -days "$DAYS" -sha256 -extfile "$tmp/ext.cnf" -out "$tmp/cert.pem" 2>/dev/null
openssl verify -CAfile "$CA_DIR/ca.crt" "$tmp/cert.pem" >/dev/null

cat "$tmp/cert.pem" "$CA_DIR/ca.crt" >"$OUT_DIR/fullchain.pem"
cp "$tmp/key.pem" "$OUT_DIR/privkey.pem"
chmod 644 "$OUT_DIR/fullchain.pem"
chmod 600 "$OUT_DIR/privkey.pem"

echo
echo "Certificado do servidor: $OUT_DIR/fullchain.pem (+ privkey.pem)"
echo "  nomes:  $SAN"
echo "  vence:  $(openssl x509 -in "$tmp/cert.pem" -noout -enddate | cut -d= -f2)  — renove antes disso"
echo
echo "Instale $CA_DIR/ca.crt (uma vez) em cada aparelho como autoridade raiz confiável:"
echo "  Windows: duplo clique > Instalar certificado > Máquina local > 'Autoridades de Certificação Raiz Confiáveis'"
echo "           (ou, como administrador: certutil -addstore -f Root ca.crt)"
echo "  Android: Configurações > Segurança > Criptografia e credenciais > Instalar certificado > Certificado CA"
echo "  Linux/Raspberry (Chromium): certutil -d sql:\$HOME/.pki/nssdb -A -t 'C,,' -n 'HMU CA' -i ca.crt"
echo "Depois: docker compose restart nginx"
