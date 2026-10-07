# API

Base: `/api` (mesma origem do site, via Nginx). JSON. Datas em ISO-8601 UTC.

## Convenções

- **Autenticação**: cookie de sessão `httpOnly` (`__Host-hosp_session` em produção) definido por `POST /api/auth/login`.
- **Anti-CSRF**: toda requisição `POST`/`PUT`/`DELETE` deve enviar `X-Requested-With: hospital-web`; se houver
  `Origin`, ela precisa estar em `WEB_ORIGIN`. Sem isso: `403 CSRF_BLOCKED`.
- **Permissões**: cada endpoint declara a permissão exigida (negar por padrão). Ver catálogo em
  `packages/shared/src/permissions.ts` e a matriz em SECURITY.md.
- **Concorrência**: edições enviam `expectedVersion`; se o registro mudou, `409 EDIT_CONFLICT`.
- **Idempotência**: gravações autenticadas podem enviar `Idempotency-Key` (o site envia em toda gravação, menos
  `/auth/*`). Reenviar a mesma chave com o mesmo conteúdo em até 10 min devolve a resposta original (cabeçalho
  `Idempotent-Replay: true`) sem gravar de novo; um reenvio que chega durante a primeira tentativa espera por ela; a
  mesma chave com outro conteúdo → `422 IDEMPOTENCY_KEY_REUSED`. Respostas de erro não são lembradas.

### Erros (nunca técnicos)

```json
{ "code": "VALIDATION_ERROR", "message": "Verifique os dados informados.", "fieldErrors": { "cpf": "CPF inválido." }, "requestId": "…" }
```

| HTTP | `code` (exemplos) |
|---|---|
| 401 | `UNAUTHENTICATED`, `SESSION_IDLE`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `CSRF_BLOCKED`, `PASSWORD_CHANGE_REQUIRED` |
| 404 | `NOT_FOUND` |
| 409 | `EDIT_CONFLICT`, `ALREADY_TAKEN`, `ACTIVE_ATTENDANCE_EXISTS`, `DUPLICATE_DOCUMENT`, `POSSIBLE_DUPLICATE`, `QUEUE_EMPTY`, `DOCTOR_BUSY`, `ROOM_BUSY`, `INVALID_STATE` |
| 422 | `VALIDATION_ERROR`, `CLASSIFICATION_REQUIRED`, `MEDICATION_REQUIRED`, `CONDUCT_REQUIRED`, regras de negócio |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR` (detalhe só no log, correlacionado pelo `requestId`) |

## Endpoints

### Autenticação

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| POST | `/auth/login` | pública (rate limit) | `{username, password}` → cookie; `{mustChangePassword}` |
| POST | `/auth/logout` | autenticado | revoga a sessão no servidor |
| GET | `/auth/me` | autenticado | usuário, perfis, permissões, expiração da sessão |
| GET | `/auth/session` | autenticado | estado da sessão **sem** renovar a inatividade |
| POST | `/auth/change-password` | autenticado | `{currentPassword, newPassword}`; encerra as demais sessões |

### Pacientes

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/patients/search?q=` (ou `cpf`, `cns`, `name`, `birthDate`, `recordNumber`, `phone`) | `patients:search` | documentos mascarados; indica atendimento em andamento |
| GET | `/patients/:id` | `patients:read` | documentos completos só com `patients:view-documents` |
| GET | `/patients/:id/attendances` | `patients:read` + `attendances:read` | visitas (sem conteúdo clínico) |
| POST | `/patients` | `patients:write` | cadastro; `409 DUPLICATE_DOCUMENT` / `POSSIBLE_DUPLICATE` (`confirmNotDuplicate: true` para confirmar) |
| PUT | `/patients/:id` | `patients:write` | atualização com `expectedVersion` |

### Atendimentos

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| POST | `/attendances` | `attendances:create` | `{patientId, reason?, kind?, accessibility?, deviceLabel?}` → `ATD-AAAA-NNNNNN` + senha |
| GET | `/attendances?date=&status=&search=` | `attendances:read` | lista do dia (risco só para perfis clínicos) |
| GET | `/attendances/:id` | `attendances:read` | situação, horários, consultório |
| GET | `/attendances/:id/timeline` | `attendances:read` | linha do tempo (detalhes clínicos só para perfis clínicos) |
| PUT | `/attendances/:id/accessibility` | `accessibility:write` | acessibilidade da visita (`updatePatientProfile` opcional) |
| POST | `/attendances/:id/cancel` | cancel/triagem/médico conforme a etapa | `{reason}` — só antes do atendimento médico |

### Triagem

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/triage/queue` | `triage:queue` | aguardando (ordem de chegada) e em triagem |
| POST | `/triage/:attendanceId/start` | `triage:perform` | *claim* atômico; `{takeover: true}` após 15 min sem atividade |
| GET | `/triage/:attendanceId` | `triage:read` | dados da triagem + permissões da tela |
| PUT | `/triage/:attendanceId` | `triage:perform` | queixa/sintomas/alergias… (`expectedVersion`; `correctionReason` após finalizar) |
| POST | `/triage/:attendanceId/vitals` | `triage:perform` | nova aferição (não apaga as anteriores) |
| POST | `/triage/:attendanceId/classify` | `triage:classify` | `{level, observation?, reason?}` — `reason` obrigatório em reclassificação |
| POST | `/triage/:attendanceId/finish` | `triage:perform` | exige classificação; envia à fila médica |
| POST | `/triage/:attendanceId/release` | `triage:perform` | devolve à fila mantendo a posição |

### Médico

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/medical/queue` | `medical:queue` | aguardando (por prioridade + chegada), meu paciente, em atendimento |
| POST | `/medical/queue/call-next` | `medical:call` | `{roomId}` — chama o próximo (atômico) |
| POST | `/medical/attendances/:id/call` | `medical:call` | `{roomId, takeover?}` — chamada específica (registra fora de ordem) |
| POST | `/medical/attendances/:id/recall` | `medical:call` | chamar novamente (vai ao painel) |
| POST | `/medical/attendances/:id/release` | `medical:call` | não compareceu: volta à fila |
| POST | `/medical/attendances/:id/start` | `medical:attend` | paciente entrou: inicia o atendimento |
| GET | `/medical/attendances/:id` | `consultation:read` | prontuário do atendimento (auditado) |
| PUT | `/medical/attendances/:id/consultation` | `medical:attend` | queixa/história/exame/conduta (`expectedVersion`; `correctionReason` após finalizar) |
| POST | `/medical/attendances/:id/diagnoses` | `medical:attend` | `{code?, description, isPrimary}` |
| POST | `/medical/attendances/:id/diagnoses/:diagnosisId/remove` | `medical:attend` | remoção lógica com motivo |
| POST | `/medical/attendances/:id/prescription/items` | `medical:attend` | medicamento, dose, via, frequência, duração, observação |
| POST | `/medical/attendances/:id/prescription/items/:itemId/cancel` | `medical:attend` | cancelamento lógico com motivo |
| POST | `/medical/attendances/:id/finish` | `medical:attend` | `{outcome, finalNotes?}` |
| POST | `/medical/attendances/:id/notes` | `consultation:read` (+ regra de autoria) | complemento |
| GET | `/medical/attendances/:id/history` | `clinical-history:read` | atendimentos anteriores finalizados (auditado) |
| GET | `/medical/attendances/:id/versions/:versionId` | `consultation:read` | conteúdo de uma versão anterior (auditado) |

### Público, indicadores e administração

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/public/panel?key=` | pública | últimas chamadas: **só** senha, ATD e consultório |
| GET | `/health` | pública | `{status: "ok"}` |
| GET | `/dashboard/summary` | leitura de atendimentos/filas/indicadores | contadores do dia |
| GET | `/dashboard/indicators?date=` | `indicators:read` | tempos médios, por hora, por risco, desfechos |
| GET | `/reports/overview?from=&to=` | `reports:read` | relatórios agregados (≤ 1 ano; grupos < 3 viram “<3”) |
| GET/POST/PUT | `/admin/users…` | `users:read` / `users:write` | listar, criar (senha temporária), editar, redefinir senha, encerrar sessões |
| GET / PUT | `/admin/roles`, `/admin/roles/:code/permissions` | `roles:read` / `roles:write` | matriz de permissões |
| GET / PUT / POST | `/admin/sectors…`, `/rooms`, `/admin/rooms…` | `facilities:*` (médico lista consultórios) | setores e consultórios |
| GET / PUT | `/admin/settings`, `/admin/settings/:key` | `settings:read` / `settings:write` | parâmetros |
| GET | `/settings/public` | autenticado | nome do hospital, protocolo, metas de espera |
| GET | `/admin/audit-logs`, `/admin/access-logs` | `audit:read` | trilha de auditoria (consultá-la também é auditado) |
| GET / POST | `/notifications`, `/notifications/read-all` | autenticado | avisos do perfil |

## Tempo real (Socket.IO, caminho `/socket.io`)

| Namespace | Autenticação | Eventos |
|---|---|---|
| `/` | cookie de sessão | `queue.changed {kind}`, `attendance.changed {attendanceId, status}`, `notification.new` |
| `/painel` | pública (ou `auth.key` se `PUBLIC_PANEL_KEY`) | `panel.call {ticket, code, room, calledAt, recall}` |
