@echo off
rem ============================================================================================
rem  Painel de chamada (TV) em um mini PC com Windows.
rem  - espera o servidor do hospital responder (depois de faltar luz, ele pode ligar mais devagar);
rem  - abre o Chrome em TELA CHEIA, com som e voz liberados sem precisar tocar na tela;
rem  - se o Chrome fechar, abre de novo.
rem  Instalação: ajuste ENDERECO abaixo e coloque um atalho deste arquivo em  shell:startup
rem  (Win+R, digite shell:startup, Enter). Configure o Windows para entrar sozinho no usuário da TV.
rem  Voz em português SEM internet: Configurações > Hora e idioma > Fala > adicionar vozes > Português (Brasil).
rem ============================================================================================
setlocal
set "ENDERECO=https://atendimento.hmu.internal/painel-chamada?key=COLOQUE_A_CHAVE_DO_PAINEL"
set "SAUDE=https://atendimento.hmu.internal/api/health"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

:espera
powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 '%SAUDE%').StatusCode -eq 200) { exit 0 } } catch {} ; exit 1"
if errorlevel 1 (
  timeout /t 10 /nobreak >nul
  goto espera
)

:abre
"%CHROME%" --kiosk --autoplay-policy=no-user-gesture-required --no-first-run --disable-session-crashed-bubble --disable-features=Translate --user-data-dir="%LOCALAPPDATA%\HMU-Painel" "%ENDERECO%"
timeout /t 5 /nobreak >nul
goto abre
