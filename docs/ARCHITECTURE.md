# Arquitetura

## 1. Análise do requisito — inconsistências encontradas e como foram resolvidas

| # | No requisito | Problema | Decisão |
|---|---|---|---|
| 1 | Fila de triagem com 🔴🟠🟡 (seção 10) | A cor de risco só existe **depois** da triagem | Fila de triagem por **ordem de chegada**; a cor aparece só se o paciente já foi classificado (ex.: devolvido à fila) |
| 2 | 7 estados (seção 21) | Falta o momento “chamado, ainda não entrou” | Mantidos os 7 estados; a chamada vive na **fila** (`queue.status = CALLED`). Isso torna “chamar” um *claim* atômico (teste 13) |
| 3 | “CONSULTÓRIO 01” na fila médica | Ninguém atribui consultório antes da chamada | Fila médica **única**; o médico escolhe o consultório em que está ao chamar |
| 4 | “senha” e “número do atendimento” no painel; exemplo `ATD-000123` | Dois identificadores e formatos diferentes | **Senha** = sequência diária (`007`, reinicia à meia-noite de Belém); **ATD** = anual `ATD-AAAA-NNNNNN` |
| 5 | Tabelas `user_roles`, mas não `role_permissions`; sem sessões, timeline, contadores | RBAC e sessão revogável não fecham | Acrescentadas `role_permissions`, `sessions`, `attendance_events`, `sequence_counters`, `clinical_record_versions`, `system_settings`, `sectors`, `rooms` |
| 6 | Acessibilidade só no cadastro, mas a triagem “registra necessidades” | Gestação e necessidades mudam por visita | **Perfil permanente** no paciente + **snapshot por atendimento** (a triagem ajusta a visita e, opcionalmente, o cadastro) |
| 7 | Prioridade legal (idoso/PCD/gestante) × classificação clínica | Lei 10.048 dá prioridade, o requisito proíbe virar emergência | Acessibilidade **nunca** muda o nível; desempate **dentro do mesmo nível** é parâmetro do hospital (desligado por padrão) |
| 8 | Cancelar a qualquer momento | Cancelar após o médico iniciar deixaria consulta órfã | Cancelamento só **antes** do atendimento médico; depois, finaliza-se com desfecho “Outro” + observação |
| 9 | “Medicação registrada” como estado | Atendimento sem medicação (alta, encaminhamento) | `EM_ATENDIMENTO → ATENDIMENTO_FINALIZADO` também é permitido; `MEDICACAO_REGISTRADA` marca a 1ª conduta/medicação |
| 10 | Redis “quando necessário” | Uma instância da API não precisa | Sem Redis; adicionar o adapter Redis do Socket.IO ao escalar horizontalmente |
| 11 | Recepção “não deve ter acesso irrestrito a dados clínicos” × timeline única | A mesma timeline mostra eventos clínicos | Eventos têm categoria (GENERAL/CLINICAL); recepção vê as etapas, **sem** classificação, diagnóstico ou medicação |
| 12 | Busca mostra “CPF: ***********” | Recepção precisa conferir identidade | Listas mostram CPF mascarado (`***.***.***-25`); o cadastro completo exige `patients:view-documents` |

## 2. Visão geral

```text
 Navegador (recepção / triagem / médico / admin)      TV (painel público)
        │  HTTPS — mesma origem                              │
        ▼                                                    ▼
      Nginx ── /           → Web  (Next.js, só interface)
            ── /api/*      → API  (NestJS: regras, autorização, auditoria)
            ── /socket.io/ → API  (Socket.IO: "algo mudou")
                                  │
                                  ▼
                            PostgreSQL 16 (regras críticas também no banco)
```

- **Web** não acessa o banco nem guarda segredos: toda decisão de segurança é da API.
- **Mesma origem** (Nginx) ⇒ cookie de sessão `__Host-` + `SameSite=Lax`, sem CORS em produção.
- **`@hospital/shared`**: enums, permissões, máquina de estados, validadores e schemas zod usados pelos dois lados.

## 3. Módulos da API (`apps/api/src`)

| Módulo | Responsabilidade |
|---|---|
| `config` | variáveis de ambiente validadas; recusa combinações perigosas (dev → banco de produção) |
| `auth` | login, sessões opacas, troca de senha, guard global (negar por padrão), rate limit, logs de acesso |
| `audit` | trilha de auditoria (gravada na mesma transação da mudança) |
| `patients` | busca, cadastro, atualização com controle de versão, detecção de duplicidade |
| `attendances` | criação (números atômicos), lista do dia, linha do tempo filtrada, acessibilidade da visita, cancelamento |
| `triage` | fila, *claim*, sinais vitais, classificação, correção, finalização, devolução |
| `medical` | fila médica, chamar (próximo/específico), rechamar, devolver, consulta, diagnóstico, prescrição, desfecho, histórico |
| `realtime` | gateway autenticado + namespace público `/painel` |
| `public` | painel de chamada (só senha, ATD e consultório) |
| `dashboard` / `reports` | contadores, indicadores e relatórios agregados |
| `admin` / `settings` | usuários, perfis, setores, consultórios, parâmetros, auditoria |
| `notifications` | avisos internos por perfil (sem dados clínicos) |
| `common` | Prisma, contadores, erros amigáveis, logger sem PII, middleware de requisição/CSRF |

## 4. Estados do atendimento

```text
AGUARDANDO_TRIAGEM ──► EM_TRIAGEM ──► AGUARDANDO_MEDICO ──► EM_ATENDIMENTO ──► MEDICACAO_REGISTRADA
        │   ▲               │                 │                    │                     │
        │   └── devolver ───┘                 │                    └──────────┬──────────┘
        ▼                   ▼                 ▼                               ▼
     CANCELADO          CANCELADO          CANCELADO                ATENDIMENTO_FINALIZADO
```

Fila (`queue`) por atendimento e tipo (TRIAGEM, MEDICA): `WAITING → CALLED → IN_SERVICE → DONE` (ou `CANCELLED`).
A tabela de transições existe em **dois lugares de propósito**: `packages/shared/src/status-machine.ts` (mensagens
amigáveis) e o trigger `attendances_guard` (garantia no banco). Toda transição grava `attendance_status_history`.

## 5. Concorrência — como cada risco foi tratado

| Risco | Mecanismo |
|---|---|
| Dois médicos chamam o mesmo paciente | `UPDATE queue … WHERE id = (SELECT … ORDER BY priority_score, enqueued_at LIMIT 1 FOR UPDATE SKIP LOCKED)` |
| Mesmo médico clica duas vezes / duas abas | *advisory lock* por médico e por consultório antes de tocar a fila (ordem fixa, sem deadlock) |
| Médico/consultório com dois pacientes | índices **parciais únicos** em `queue` (`CALLED`/`IN_SERVICE`) |
| Dois profissionais iniciam a mesma triagem | `UPDATE … WHERE status = 'WAITING'`; quem perde recebe “já está em triagem com Fulano” |
| Atendimento duplicado | índice parcial único: 1 atendimento ativo por paciente |
| Números ATD/senha repetidos | `INSERT … ON CONFLICT DO UPDATE … RETURNING` (sem buracos; testado com 20 criações paralelas) |
| Cadastro duplicado | CPF/CNS únicos + alerta de nome + nascimento iguais (confirmação explícita, auditada) |
| Atualização perdida / conflito de edição | coluna `version` + `UPDATE … WHERE version = esperada` → `409 EDIT_CONFLICT` |
| Paciente “preso” com colega ausente | “assumir” só após 15 min sem atividade, registrado na auditoria |

## 6. Tempo real

- Socket.IO autenticado pelo **mesmo cookie** de sessão; cada socket entra só nas salas que a permissão permite
  (`sector:recepcao`, `sector:triagem`, `sector:medico`, `sector:admin`).
- Eventos carregam apenas **IDs/tipo** (`queue.changed`, `attendance.changed`, `notification.new`); a tela rebusca
  pela API, que valida a permissão de novo. Nenhum dado clínico trafega no canal.
- Sessão expirada/revogada derruba o socket (revalidação a cada minuto). WebSocket não conta como atividade.
- Sem conexão, as filas passam a se atualizar a cada 15 s e o topo da tela avisa.
- Painel público: namespace `/painel`, sem login, opcionalmente protegido por chave; recebe **só** senha, ATD e consultório.

## 6.1 Operação sem internet e rede instável

O servidor fica **dentro do hospital**; nada no sistema chama serviços de fora (fontes empacotadas, CSP `'self'`,
telemetria desligada). A queda da internet não muda nada. O que o código trata é a **rede local** oscilando
(detalhes de implantação em [SEM-INTERNET.md](SEM-INTERNET.md)):

| Risco | Como foi tratado |
|---|---|
| Resposta perdida depois de o servidor gravar | `Idempotency-Key` + reenvio automático (até ~15 s) — `IdempotencyInterceptor` devolve a resposta original |
| Texto perdido ao recarregar ou ao expirar a sessão durante a queda | rascunho local por usuário (`lib/drafts.ts`, sessionStorage) em triagem, consulta e cadastro, restaurado só se a versão no servidor for a mesma |
| Tela que some quando uma atualização falha | telas só bloqueiam sem dados (`LoadError`); com dados, aviso discreto e o formulário continua |
| Ação que dispara sozinha minutos depois | React Query com `networkMode: 'always'` (falha na hora, com mensagem) |
| Ninguém percebe que caiu | faixa "Sem conexão com o servidor desde HH:MM", verificação a cada 5 s, atualização ao voltar |
| Relógio errado nos PCs sem internet | telas usam a hora do servidor (cabeçalho `Date`, `lib/clock.ts`) |
| TV muda depois de reiniciar / chamadas perdidas | painel pede um toque quando o navegador bloqueia o som; anuncia chamadas recentes recebidas na reconexão (sem repetir) |
| Nginx preso no IP antigo / 502 parado | `resolver` do Docker a cada 10 s; página "o sistema está iniciando" que se recarrega |

## 7. Decisões de interface

Modo “operar”: escaneabilidade e velocidade acima de expressão. Identidade visual da referência aprovada
(Montserrat + Poppins; marinho, verde-limão, azul-gelo). As 5 cores de risco são do protocolo, validadas para
daltonismo (vermelho × laranja ΔE 19,9) e sempre acompanhadas de **forma** (octógono, triângulo, losango, quadrado,
círculo) e **texto**. Um único “Finalizar triagem” salva queixa, sinais vitais e classificação e envia à fila.
Atalhos: `/` busca, `Alt+N` novo paciente, `Alt+T` próxima triagem, `Alt+C` chamar próximo, `Ctrl+S` salvar,
`Ctrl+Enter` finalizar triagem, `1`–`5` nível de risco. Tamanho de texto ajustável por usuário.

## 8. Preparado para o futuro (não implementado)

Laboratório, farmácia, internação, leitos, enfermagem, imagem, transferências, documentos, RNDS/FHIR, app e totem
entram como **novos módulos** sobre o mesmo atendimento:

- `queue.kind` aceita novas filas (`LABORATORIO`, `FARMACIA`…) reaproveitando *claim*, chamada e painel;
- `attendance_events` aceita novos tipos de evento sem mudar a timeline;
- `clinical_record_versions.record_type` versiona novos registros clínicos;
- permissões são dados (`permissions`/`role_permissions`): novos perfis sem mudar código de autorização;
- FHIR/RNDS: os modelos `Patient`, `Encounter` (atendimento), `Observation` (sinais vitais), `Condition`
  (diagnóstico) e `MedicationRequest` (prescrição) mapeiam 1:1 para as tabelas atuais;
- totem/app: a criação de atendimento já registra dispositivo e usa o mesmo serviço.
