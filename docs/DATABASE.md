# Banco de dados

PostgreSQL 16, Prisma 6. Esquema: `apps/api/prisma/schema.prisma`. Migrations: `apps/api/prisma/migrations`.

## Convenções

- Tabelas/colunas em `snake_case` (consultas SQL diretas por DBAs e relatórios); chaves **UUID** (`gen_random_uuid()`),
  exceto logs append-only (`BIGINT` identidade, ordem natural).
- **CPF e CNS nunca são chave**: são colunas `UNIQUE` opcionais (só dígitos, validadas por CHECK).
- Datas/horas em UTC (`timestamptz`); o “dia do hospital” (senha diária, “hoje”, ano do ATD) é calculado em `America/Belem`.
- Registros clínicos **não são apagados** (FKs `RESTRICT` + trigger); remoções são lógicas, com motivo.

## Tabelas

| Grupo | Tabelas |
|---|---|
| Acesso | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions` |
| Estrutura | `sectors`, `rooms` (consultórios), `system_settings`, `sequence_counters` |
| Pacientes | `patients`, `patient_contacts`, `patient_addresses` (histórico; 1 vigente), `patient_guardians`, `patient_accessibility` |
| Atendimento | `attendances`, `attendance_accessibility` (snapshot da visita), `attendance_status_history`, `attendance_events` (linha do tempo) |
| Triagem | `triage`, `triage_vitals` (série de aferições), `risk_classifications` (histórico de classificações) |
| Filas | `queue` (1 por atendimento e tipo), `queue_calls` (cada chamada, alimenta o painel) |
| Médico | `medical_consultations`, `medical_notes` (complementos/correções), `diagnoses`, `prescriptions`, `prescription_items` |
| Versões | `clinical_record_versions` (VERSÃO ANTERIOR de triagem/consulta antes de cada alteração) |
| Avisos | `notifications` |
| Auditoria | `audit_logs` (ações), `access_logs` (login, falhas, bloqueios, expiração) |

Relacionamentos principais: `patients 1─N attendances 1─1 triage / medical_consultations`, `attendances 1─N queue,
queue_calls, attendance_events, attendance_status_history, triage_vitals, risk_classifications, clinical_record_versions`.

## Regras garantidas pelo banco (migration `*_integridade_e_imutabilidade`)

**Índices parciais únicos**
- `uq_attendances_one_active_per_patient` — um atendimento em andamento por paciente.
- `uq_queue_medical_one_active_per_doctor` / `…_per_room` — um paciente chamado/em atendimento por médico e por consultório.
- `uq_patient_addresses_one_current`, `uq_diagnoses_one_primary`.

**CHECKs** — formato de CPF/CNS/telefone/código ATD; faixas plausíveis de sinais vitais (iguais às do zod);
pressão completa e sistólica > diastólica; finalizado ⇒ `finished_at`; cancelado ⇒ data e motivo;
**`ck_attendances_classified_before_medical`: ninguém chega ao médico sem classificação feita por profissional**;
remoção lógica de diagnóstico/cancelamento de item sempre com autor e motivo.

**Triggers**
- `forbid_modification` (UPDATE/DELETE/TRUNCATE) em: `audit_logs`, `access_logs`, `attendance_status_history`,
  `attendance_events`, `risk_classifications`, `triage_vitals`, `queue_calls`, `clinical_record_versions`, `medical_notes`.
- `forbid_delete` em cadastro, atendimento, filas e registros clínicos.
- `attendances_guard` — identificação do atendimento imutável e **máquina de estados validada no banco**.
- `patients_guard` — número do prontuário imutável.
- `enforce_clinical_versioning` — qualquer mudança de conteúdo em `triage`/`medical_consultations` exige
  `version + 1` **e** o snapshot da versão anterior já arquivado em `clinical_record_versions`.

Os testes em `apps/api/test/security-integrity.e2e-spec.ts` tentam burlar cada uma dessas regras via SQL direto.

## Índices de desempenho

Busca por nome: GIN trigram (`pg_trgm`) em `patients.normalized_name` (sem acento, minúsculas, inclui nome social).
Filas: `queue (kind, status, priority_score, enqueued_at)`. Listas do dia: `attendances (status, arrived_at)`,
`(arrived_at)`. Auditoria: por data, usuário, paciente, atendimento e entidade. Consultas da API usam `include`
(sem N+1) e listas são limitadas/paginadas.

## Migrations

```bash
npm run db:migrate     # desenvolvimento: aplica e cria novas migrations (prisma migrate dev)
npm run db:deploy      # staging/produção: só aplica as existentes (prisma migrate deploy)
```

- Migrations rodam com o **dono** do banco; a API roda com `hospital_app` (ver `deploy/sql/app-role.sql`).
- Índices parciais, CHECKs e triggers ficam em SQL nas migrations (o Prisma não os modela).
- Nunca edite uma migration já aplicada em staging/produção — crie outra.

## Seed

`npm run db:seed` — **somente desenvolvimento** (recusa outros `APP_ENV`). Cria perfis, permissões, setores,
parâmetros, 3 consultórios, 5 usuários `(DEV)` e 8 pacientes **fictícios**, sem CPF/CNS (nem números inventados
que poderiam coincidir com pessoas reais). Não cria atendimentos.

Em staging/produção, dados de referência + 1º administrador vêm de `npm run admin:bootstrap` (ver DEPLOY.md).

## Retenção (LGPD × prontuário)

Prontuário deve ser guardado por no mínimo 20 anos (Lei 13.787/2018). Por isso não há exclusão de pacientes nem
de registros clínicos; pedidos de eliminação de dados devem ser avaliados pelo encarregado (DPO) à luz da
obrigação legal de guarda. Sessões encerradas há mais de 30 dias podem ser removidas (`SessionService.purgeOld`).
