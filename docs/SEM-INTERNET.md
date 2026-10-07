# Funcionar sem internet

## Resposta curta

O sistema **não precisa de internet**. Ele precisa de duas coisas dentro do hospital:

1. **Um servidor no próprio hospital** (um mini PC basta), onde ficam o sistema e o banco de dados.
2. **Uma rede local própria** (roteador do hospital, switch e cabos), ligada a um **nobreak**.

Com isso, quando a internet da operadora cair, recepção, triagem, consultórios e a TV do painel **continuam
funcionando normalmente**. Só param as coisas que vêm de fora: acesso de casa, atualizações e a cópia de backup
na nuvem.

> **Wi‑Fi não é internet.** O Wi‑Fi é o rádio da rede local; a internet é o link da operadora. Se a operadora cai,
> a rede local continua de pé — desde que o roteador seja do hospital e esteja no nobreak. Por isso os
> computadores fixos e a TV vão **no cabo**, e o Wi‑Fi fica só para tablets e celulares.

O que **não** funciona sem servidor: um computador sozinho, sem conseguir falar com o servidor, não atende
(a fila, o número ATD, a senha e "quem está com o paciente" são decididos no servidor central, para nunca haver
dois atendimentos com o mesmo número nem duas pessoas com o mesmo paciente). Para o caso raro de o **servidor ou a
rede local** caírem, existe a [contingência em papel](CONTINGENCIA.md).

## Como fica

```
                 internet da operadora (opcional)
                               │
                       [ modem da operadora ]
                               │   ← se a internet cair, daqui para baixo tudo continua
 ┌──────────────────── NOBREAK ┴──────────────────────────────────┐
 │  [ roteador do hospital ]──[ switch ]──[ SERVIDOR: sistema + banco ]  │
 └────────────┬───────────────────┬──────────────────┬──────────────┘
          cabo│               cabo│              cabo│        Wi‑Fi (só móveis)
     Recepção (PC +       Triagem (PC)       Consultórios (PC)      tablets
     impressora de senha)                         │
                                       mini PC ── HDMI ── TV do painel
```

## O que comprar

Faixas de preço pesquisadas em lojas online brasileiras em **outubro de 2026** (preços de PIX/à vista, varejo).
São referência para orçamento: confira no dia, e lembre que compra pública (licitação) tem outros valores.

| Item | Especificação recomendada | Faixa (R$) |
|---|---|---|
| **Servidor** | Mini PC Intel N150 (4 núcleos), 16 GB de RAM, SSD NVMe 512 GB, porta de rede gigabit. De preferência com 2 slots M.2 (para espelhar o disco depois). Ex.: Beelink EQ14, Kamrui E2 | 2.480 – 3.510 |
| **Nobreak** | Senoidal, 1500 VA, bivolt, **com porta USB** (desliga o servidor com segurança quando a bateria acaba). Liga servidor, switch e roteador | 2.290 – 2.880 |
| **Switch** | Gigabit não gerenciável, 16 portas (8 portas se forem poucos pontos), sem ventoinha | 480 – 660 (8 p.: 135 – 310) |
| **Roteador próprio** | Wi‑Fi 6 (AX1500/AX1800), portas gigabit. Faz o DHCP e o nome local da rede mesmo sem internet | 200 – 350 |
| **Aparelho da TV** | Mini PC com Windows (tem voz em português instalada, que funciona sem internet) — ou Raspberry Pi 5 4 GB (kit com fonte, case e cartão) com Linux | Raspberry: 900 – 1.200 · mini PC: 1.500 – 2.200* |
| **HDs de backup** | 2 HDs externos USB 3.0 de 1 TB (rodízio: um fica, outro vai para fora do prédio) | 300 – 420 cada |
| **Impressora de senha** | Térmica 80 mm não fiscal, USB (com Ethernet é melhor), com guilhotina. Ex.: Elgin i7 Plus/i8, Epson TM‑T20X | 480 – 1.040 |
| **Cabeamento** | Cabo Cat6 **100% cobre** (caixa 305 m; desconfie de caixas baratas, geralmente alumínio) + conectores RJ45 | 1.100 – 1.600 + 55 – 120 |

**Total do essencial: cerca de R$ 8.500 a R$ 13.000**, sem a mão de obra do cabeamento.
\* estimativa sem fonte de loja (a pesquisa não conseguiu abrir as páginas desses modelos).

Opcional, para quem quer ainda mais segurança:

| Item | Para quê | Faixa (R$) |
|---|---|---|
| Segundo SSD NVMe 500 GB | Espelhar o disco do servidor (se um SSD queimar, o outro segue) | 730 – 750 |
| Segundo mini PC igual ao servidor | Servidor reserva já instalado: se o principal queimar, troca-se em minutos | 2.480 – 3.510 |

Não precisa: placa de vídeo, servidor de rack, "nuvem" ou link de internet melhor — o sistema é leve (centenas de
atendimentos por dia cabem com folga num mini PC).

## Passo a passo para a TI

### 1. Rede

- **Roteador do hospital atrás do modem** da operadora (modem em modo bridge ou ligado na porta WAN do roteador).
  É o roteador do hospital que entrega os endereços (DHCP) — assim a rede funciona com a operadora fora.
- **IP fixo para o servidor**, fora da faixa do DHCP (exemplo usado neste guia: `192.168.0.10`).
- **Cabo** para o servidor, recepção, triagem, consultórios e o aparelho da TV. Wi‑Fi só para tablets e celulares.
- Rede da equipe **separada** da rede de pacientes/visitantes (outro SSID com isolamento ou VLAN).
- Access points em **modo bridge/AP** (sem NAT entre as estações e o servidor). Com NAT, todos os computadores
  aparecem para o sistema como um só IP: o limite de tentativas de login vale para todos juntos e a auditoria perde
  a origem.
- Etiquete os cabos e anote um desenho simples da rede.

### 2. Nome do servidor (sem depender do DNS da operadora)

Use um nome interno, por exemplo **`atendimento.hmu.internal`** (o final `.internal` é reservado para redes
privadas; evite `.local`, que é de outro protocolo). Ele precisa ser resolvido **dentro** do hospital:

- **No roteador**: cadastre uma entrada de DNS estática `atendimento.hmu.internal → 192.168.0.10` (a maioria dos
  roteadores tem essa opção; em último caso, o próprio servidor pode rodar o `dnsmasq`); **ou**
- **Em cada computador**: no Windows, edite como administrador `C:\Windows\System32\drivers\etc\hosts` e acrescente
  `192.168.0.10   atendimento.hmu.internal`. Funciona mesmo sem DNS nenhum.

Plano B: o endereço pelo IP (`https://192.168.0.10`) também funciona, porque o certificado e o `WEB_ORIGIN`
incluem o IP (passos 5 e 6). Deixe um atalho para ele na área de trabalho da recepção.

Se os navegadores usam **proxy** (da prefeitura ou da operadora), cadastre o nome e o IP do servidor como exceção
— senão o navegador manda os pedidos para o proxy, que fica do lado da internet.

### 3. Servidor

- Ubuntu Server LTS ou Debian, com Docker e o plugin `docker compose`.
- Na BIOS: **"Restore on AC power loss" = Power On** (religa sozinho quando a energia volta).
- `sudo systemctl enable docker` (o Docker sobe no boot e religa os contêineres sozinho).
- Copie `deploy/docker/daemon.json` para `/etc/docker/daemon.json` (logs com tamanho limitado e contêineres que
  continuam rodando quando o próprio Docker é atualizado). Se a faixa `172.31.0.0/16` existir na rede da prefeitura,
  troque-a por outra que não exista. Depois: `sudo systemctl restart docker`.
- Nobreak com o cabo USB no servidor e o **NUT** (`nut`) configurado para desligar o servidor com bateria baixa.
- Se for usar disco criptografado (recomendado em SECURITY.md), configure o **desbloqueio automático** (Clevis/TPM2)
  — com senha digitada no boot, o servidor não volta sozinho depois de faltar luz.

### 4. Hora certa sem internet

A hora importa: auditoria, tempo de espera, senha do dia, validade do certificado em cada computador e a rotação
dos backups. Sem internet, ninguém acerta o relógio sozinho — então o servidor vira o relógio da rede:

```bash
sudo apt install chrony
sudo cp deploy/chrony/hmu.conf /etc/chrony/conf.d/hmu.conf   # ajuste a linha "allow" para a faixa da rede
sudo systemctl restart chrony && chronyc tracking
```

Nos computadores Windows (como administrador):

```bat
w32tm /config /manualpeerlist:"192.168.0.10,0x8" /syncfromflags:manual /reliable:no /update
net stop w32time && net start w32time && w32tm /resync
```

As telas do sistema já usam a hora do servidor (não a de cada PC) para tempos de espera e para o relógio da TV.
Mesmo assim, os PCs precisam estar com a data certa, senão o navegador recusa o certificado.

### 5. Certificado HTTPS local (sem Let's Encrypt)

O HTTPS é obrigatório (senha e cookie de sessão não podem passar abertos pelo Wi‑Fi). O Let's Encrypt precisa de
internet para emitir e renovar; no hospital, use a autoridade certificadora própria:

```bash
deploy/scripts/certificado-local.sh atendimento.hmu.internal 192.168.0.10
```

- Instale o arquivo `deploy/secrets/ca/ca.crt` **uma vez** em cada computador, tablet e aparelho da TV (o script
  mostra como em Windows, Android e Linux).
- Guarde `deploy/secrets/ca/ca.key` **fora do servidor** (pendrive no cofre). Sem ela, um certificado novo obriga a
  reinstalar a autoridade em todos os aparelhos.
- O certificado vale **825 dias**. Ponha na agenda da TI renovar uns 60 dias antes (rodar o script de novo e
  `docker compose restart nginx`; nada muda nos aparelhos).
- Não use o navegador da Smart TV: em geral ele não deixa instalar a autoridade, e o painel não abre.

### 6. Instalar o sistema

Siga o [DEPLOY.md](DEPLOY.md). Pontos específicos para funcionar sem internet:

- `deploy/env/api.env`: `WEB_ORIGIN=https://atendimento.hmu.internal,https://192.168.0.10` (nome **e** IP).
- Arquivo `.env` ao lado do `docker-compose.yml`: `HMU_BIND_IP=192.168.0.10` (o sistema só atende na rede do
  hospital; as portas do Docker passam por cima do firewall `ufw`).
- **Sem internet no servidor**, instale pelo **kit offline** (próxima seção) em vez de construir as imagens lá.

### 7. Kit offline: instalar e atualizar com um pendrive

As imagens são construídas numa máquina **com** internet e levadas prontas. O CI do repositório gera o kit
automaticamente quando uma versão é marcada (tag `v2026.10.07`, por exemplo: artefato `kit-offline-…`). À mão:

```bash
# na máquina COM internet (mesma arquitetura do servidor: amd64)
V=2026.10.07
docker compose build --pull api web
docker tag hmu-api:latest hmu-api:$V && docker tag hmu-web:latest hmu-web:$V
docker pull postgres:16-alpine && docker pull nginx:1.27-alpine
docker save hmu-api:$V hmu-web:$V postgres:16-alpine nginx:1.27-alpine | gzip > hmu-imagens-$V.tar.gz
git archive -o hmu-repo-$V.tar.gz HEAD
sha256sum hmu-imagens-$V.tar.gz hmu-repo-$V.tar.gz > SHA256SUMS
```

```bash
# no servidor do hospital (SEM internet)
sha256sum -c SHA256SUMS
deploy/scripts/backup.sh                                     # sempre antes de atualizar
gunzip -c hmu-imagens-$V.tar.gz | docker load
# versão nova no arquivo .env ao lado do docker-compose.yml
grep -q '^HMU_VERSION=' .env 2>/dev/null && sed -i "s/^HMU_VERSION=.*/HMU_VERSION=$V/" .env || echo "HMU_VERSION=$V" >> .env
docker compose run --rm migrate
docker compose up -d --no-build --pull never
```

O kit fica em torno de **meio gigabyte** (imagens da API com 587 MB e da Web com 310 MB antes de comprimir, mais o
PostgreSQL e o Nginx): cabe em qualquer pendrive.

Para voltar à versão anterior: restaure o backup feito antes da atualização (se houve migration) e troque
`HMU_VERSION` para a versão anterior (guarde no servidor e no pendrive as **duas últimas** versões).

Na primeira instalação sem internet, leve também no pendrive os pacotes do Docker para a versão exata do sistema
operacional do servidor (`apt-get download` com as dependências, numa máquina com a mesma versão).

### 8. TV do painel

- Mini PC ligado na HDMI da TV, **no cabo de rede**, no nobreak se possível.
- Windows: rode `deploy/painel/painel-tv-windows.bat` na inicialização (instruções no próprio arquivo). Ele espera
  o servidor responder, abre o Chrome em tela cheia com som liberado e reabre se fechar. Instale a voz
  **Português (Brasil)** em Configurações > Hora e idioma > Fala (funciona sem internet).
- Linux/Raspberry Pi: `deploy/painel/painel-tv-linux.sh` + `painel-tv.desktop` (instruções no arquivo). A voz
  vem do `speech-dispatcher` + `espeak-ng` (mais robótica que a do Windows).
- Configure a chave do painel (`PUBLIC_PANEL_KEY`) no endereço: `/painel-chamada?key=…`.
- Se o navegador da TV bloquear o som depois de reiniciar, o painel mostra **"Toque aqui para ligar o som e a voz
  das chamadas"** — basta um toque. Com o script de quiosque isso não acontece.
- Se nenhuma voz funcionar, o painel avisa **"Voz indisponível — só aviso sonoro"** (o bipe e a tela continuam).

### 9. Tablets e celulares (Android)

- Wi‑Fi da equipe marcado como **"manter conectado mesmo sem internet"**; desligue dados móveis e a "troca
  inteligente de rede" — senão o Android abandona o Wi‑Fi sem internet e o tablet sai da rede do hospital.
- Instale o `ca.crt` (Configurações > Segurança > Instalar certificado > Certificado CA).

### 10. Impressora de senha

Instale a impressora térmica no computador da recepção **com o driver já baixado** (sem internet, o Windows não
encontra driver). O bilhete sai pelo botão "Imprimir senha" (senha, número do atendimento e horário — sem nome).

### 11. Backups sem depender de internet

```cron
# a cada 6 h e todo dia às 03:00 (frase-senha em arquivo só do root)
0 */6 * * * cd /opt/Sistema-hospitalar && BACKUP_PASSPHRASE_FILE=/root/.hmu-backup-pass deploy/scripts/backup.sh >> /var/log/hmu-backup.log 2>&1
```

- **HD externo** (2ª mídia): `deploy/scripts/copiar-hd-externo.sh /media/hd-backup` — confere cada cópia (SHA‑256),
  recusa copiar se o HD não estiver montado e avisa se o HD estiver com defeito.
- **Rodízio semanal** de dois HDs: um conectado ao servidor, outro guardado **fora do prédio** (Secretaria de
  Saúde, por exemplo). Os arquivos são cifrados; a **frase-senha nunca vai junto**.
- A frase-senha fica no servidor (o agendamento precisa dela) e também **impressa, em envelope lacrado no cofre**
  — não só num cofre de senhas na nuvem, que fica inacessível sem internet. O mesmo vale para `ca.key`,
  `deploy/secrets` e `deploy/env`.
- O `backup.sh` sempre mantém os 14 backups mais recentes (`BACKUP_KEEP_MIN`) e **suspende a rotação** se o relógio
  do servidor voltar para o passado.
- Teste a restauração todo mês ([DEPLOY.md](DEPLOY.md), seção 6).
- Com internet: copie também para fora (rclone/rsync) — é um extra, não a única cópia.

### 12. Acesso remoto (opcional, só quando houver internet)

Use VPN (WireGuard ou Tailscale) para suporte e administração. **Nunca** abra portas do sistema no roteador.
Durante a queda de internet a VPN também cai: tenha uma pessoa no hospital treinada em três coisas — reiniciar o
servidor, abrir `https://atendimento.hmu.internal/api/health` e trocar o HD de backup.

## Teste final antes de atender pacientes ("puxe o cabo")

Faça com dados fictícios, num horário sem atendimento:

- [ ] **Desligue o cabo da internet** do modem. Em cada computador: entrar no sistema, cadastrar um paciente,
      triar, chamar no painel — a TV mostra e **fala** a senha.
- [ ] Reinicie o aparelho da TV: o painel volta sozinho e continua falando.
- [ ] Tire o cabo de rede de um PC no meio de uma triagem: aparece a faixa vermelha **"Sem conexão com o servidor"**;
      o texto continua na tela. Recoloque: **"Conexão com o servidor restabelecida"**, salve.
- [ ] Desligue o servidor no botão do nobreak (simula falta de luz prolongada) e religue: em ~2 minutos tudo volta
      sozinho; a TV mostra "O sistema está iniciando" e depois volta ao painel.
- [ ] Confira se a hora de cada PC é igual à do servidor.
- [ ] Faça um backup, copie para o HD externo e restaure num banco de teste.

## O que a equipe vê quando a rede local falha

| Situação | O que aparece | O que fazer |
|---|---|---|
| PC perdeu a conexão com o servidor (cabo solto, Wi‑Fi caiu) | Faixa vermelha "Sem conexão com o servidor desde HH:MM" | Não fechar nem recarregar a tela. O que foi digitado fica guardado. Quando voltar, aparece "Conexão restabelecida": conferir e salvar |
| Alguém recarregou ou a sessão caiu no meio | Ao voltar: "Recuperamos o que tinha sido digitado e não foi salvo" | Conferir e salvar (ou "Descartar") |
| A resposta do servidor se perdeu ao salvar | Nada: o sistema reenvia sozinho, sem duplicar o registro | — |
| TV sem rede | "Reconectando…" no canto | Nada: as chamadas feitas nesse intervalo são anunciadas quando ela volta |
| Servidor reiniciando | Página "O sistema está iniciando" (recarrega sozinha) | Aguardar |
| Servidor ou rede fora por mais de 10 min | — | [Contingência em papel](CONTINGENCIA.md) |

## Como foi testado

Nesta versão, com Docker: as imagens de produção foram construídas e a pilha completa (PostgreSQL, API, Web e
Nginx com HTTPS da autoridade interna) rodou **com a saída para a internet bloqueada**. Passaram: o fluxo completo
no navegador (recepção → triagem → médico → painel), os testes de rede instável (resposta perdida sem duplicar,
servidor fora com recarga da tela, TV desconectada), a página "o sistema está iniciando", a troca do IP interno da
API sem reiniciar o Nginx, uma **queda de energia simulada** (tudo voltou sozinho e o banco se recuperou sem perder
nada), o kit offline (`docker save`/`docker load`) e backup + restauração.

Não dá para testar fora do hospital: o hardware real, a voz da TV no aparelho escolhido, os tablets Android, o DNS
do roteador e o nobreak. É para isso o "puxe o cabo" acima.
