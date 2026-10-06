-- ============================================================================
-- Integridade, concorrência e imutabilidade (o que o Prisma não expressa).
-- Estas regras valem mesmo para quem acessar o banco por fora da aplicação.
-- Documentação: docs/DATABASE.md
-- ============================================================================

-- ─────────────── 1. ÍNDICES PARCIAIS (concorrência e unicidade condicional) ───────────────

-- Um paciente não pode ter dois atendimentos abertos ao mesmo tempo (evita atendimento duplicado).
CREATE UNIQUE INDEX "uq_attendances_one_active_per_patient"
  ON "attendances" ("patient_id")
  WHERE "status" NOT IN ('ATENDIMENTO_FINALIZADO', 'CANCELADO');

-- Apenas um endereço vigente por paciente (os anteriores ficam como histórico).
CREATE UNIQUE INDEX "uq_patient_addresses_one_current"
  ON "patient_addresses" ("patient_id")
  WHERE "is_current";

-- Apenas um diagnóstico principal ativo por consulta.
CREATE UNIQUE INDEX "uq_diagnoses_one_primary"
  ON "diagnoses" ("consultation_id")
  WHERE "is_primary" AND "removed_at" IS NULL;

-- Um médico só pode ter um paciente chamado/em atendimento por vez, e um consultório só atende um por vez.
CREATE UNIQUE INDEX "uq_queue_medical_one_active_per_doctor"
  ON "queue" ("assigned_user_id")
  WHERE "kind" = 'MEDICA' AND "status" IN ('CALLED', 'IN_SERVICE');

CREATE UNIQUE INDEX "uq_queue_medical_one_active_per_room"
  ON "queue" ("room_id")
  WHERE "kind" = 'MEDICA' AND "status" IN ('CALLED', 'IN_SERVICE');

-- ─────────────── 2. CHECK CONSTRAINTS ───────────────

ALTER TABLE "users"
  ADD CONSTRAINT "ck_users_username_lowercase" CHECK ("username" = lower("username"));

ALTER TABLE "patients"
  ADD CONSTRAINT "ck_patients_cpf" CHECK ("cpf" IS NULL OR "cpf" ~ '^[0-9]{11}$'),
  ADD CONSTRAINT "ck_patients_cns" CHECK ("cns" IS NULL OR "cns" ~ '^[0-9]{15}$'),
  ADD CONSTRAINT "ck_patients_birth_date" CHECK ("birth_date" >= DATE '1900-01-01');

ALTER TABLE "patient_contacts"
  ADD CONSTRAINT "ck_patient_contacts_number" CHECK ("number" ~ '^[0-9]{10,11}$');

ALTER TABLE "attendances"
  ADD CONSTRAINT "ck_attendances_code_format" CHECK ("code" ~ '^ATD-[0-9]{4}-[0-9]{6,}$'),
  ADD CONSTRAINT "ck_attendances_finished" CHECK ("status" <> 'ATENDIMENTO_FINALIZADO' OR "finished_at" IS NOT NULL),
  ADD CONSTRAINT "ck_attendances_cancelled" CHECK ("status" <> 'CANCELADO' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)),
  -- Nenhum paciente chega à fila/atendimento médico sem classificação de risco feita por um profissional.
  ADD CONSTRAINT "ck_attendances_classified_before_medical" CHECK (
    "status" NOT IN ('AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO')
    OR "current_risk_level" IS NOT NULL
  );

ALTER TABLE "triage"
  ADD CONSTRAINT "ck_triage_finished" CHECK ("status" <> 'FINISHED' OR ("finished_at" IS NOT NULL AND "finished_by_id" IS NOT NULL));

-- Faixas de plausibilidade dos sinais vitais (espelham VITAL_LIMITS em @hospital/shared).
ALTER TABLE "triage_vitals"
  ADD CONSTRAINT "ck_vitals_ranges" CHECK (
    ("systolic"         IS NULL OR "systolic"         BETWEEN 30 AND 300) AND
    ("diastolic"        IS NULL OR "diastolic"        BETWEEN 20 AND 200) AND
    ("heart_rate"       IS NULL OR "heart_rate"       BETWEEN 10 AND 300) AND
    ("respiratory_rate" IS NULL OR "respiratory_rate" BETWEEN 3 AND 90) AND
    ("spo2"             IS NULL OR "spo2"             BETWEEN 30 AND 100) AND
    ("temperature_c"    IS NULL OR "temperature_c"    BETWEEN 25 AND 45) AND
    ("glucose"          IS NULL OR "glucose"          BETWEEN 10 AND 1500) AND
    ("weight_kg"        IS NULL OR "weight_kg"        BETWEEN 0.3 AND 500) AND
    ("height_cm"        IS NULL OR "height_cm"        BETWEEN 20 AND 260) AND
    ("pain_scale"       IS NULL OR "pain_scale"       BETWEEN 0 AND 10)
  ),
  ADD CONSTRAINT "ck_vitals_bp_pair" CHECK (("systolic" IS NULL) = ("diastolic" IS NULL)),
  ADD CONSTRAINT "ck_vitals_bp_order" CHECK ("systolic" IS NULL OR "systolic" > "diastolic"),
  ADD CONSTRAINT "ck_vitals_not_empty" CHECK (
    num_nonnulls("systolic", "heart_rate", "respiratory_rate", "spo2", "temperature_c", "glucose", "weight_kg", "height_cm", "pain_scale") > 0
  );

ALTER TABLE "queue"
  ADD CONSTRAINT "ck_queue_assigned" CHECK ("status" NOT IN ('CALLED', 'IN_SERVICE') OR "assigned_user_id" IS NOT NULL),
  ADD CONSTRAINT "ck_queue_room" CHECK ("kind" <> 'MEDICA' OR "status" NOT IN ('CALLED', 'IN_SERVICE') OR "room_id" IS NOT NULL);

ALTER TABLE "medical_consultations"
  ADD CONSTRAINT "ck_consultation_finished" CHECK ("status" <> 'FINISHED' OR ("outcome" IS NOT NULL AND "finished_at" IS NOT NULL));

ALTER TABLE "diagnoses"
  ADD CONSTRAINT "ck_diagnoses_removal" CHECK (
    ("removed_at" IS NULL AND "removed_by_id" IS NULL AND "removal_reason" IS NULL)
    OR ("removed_at" IS NOT NULL AND "removed_by_id" IS NOT NULL AND "removal_reason" IS NOT NULL)
  );

ALTER TABLE "prescription_items"
  ADD CONSTRAINT "ck_prescription_items_cancel" CHECK (
    ("canceled_at" IS NULL AND "canceled_by_id" IS NULL AND "cancel_reason" IS NULL)
    OR ("canceled_at" IS NOT NULL AND "canceled_by_id" IS NOT NULL AND "cancel_reason" IS NOT NULL)
  );

-- ─────────────── 3. IMUTABILIDADE (append-only e nunca-apagar) ───────────────

CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável: a tabela "%" é somente-inserção (operação % não permitida).', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registros da tabela "%" não podem ser apagados (use inativação/cancelamento lógico).', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- Somente-inserção: nem UPDATE, nem DELETE, nem TRUNCATE.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_logs', 'access_logs', 'attendance_status_history', 'attendance_events',
    'risk_classifications', 'triage_vitals', 'queue_calls', 'clinical_record_versions', 'medical_notes'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_modification()', 'trg_' || t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification()', 'trg_' || t || '_no_truncate', t);
  END LOOP;
END $$;

-- Nunca apagar (pode haver UPDATE controlado): cadastro, atendimento e registros clínicos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'patients', 'patient_accessibility', 'attendances', 'attendance_accessibility', 'triage',
    'queue', 'medical_consultations', 'diagnoses', 'prescriptions', 'prescription_items',
    'patient_addresses', 'rooms', 'sectors', 'roles', 'permissions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_delete()', 'trg_' || t || '_no_delete', t);
  END LOOP;
END $$;

-- Identificação do atendimento é imutável e a máquina de estados é validada também no banco.
CREATE OR REPLACE FUNCTION attendances_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code"
     OR NEW."year" IS DISTINCT FROM OLD."year"
     OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
     OR NEW."ticket_date" IS DISTINCT FROM OLD."ticket_date"
     OR NEW."ticket_number" IS DISTINCT FROM OLD."ticket_number"
     OR NEW."patient_id" IS DISTINCT FROM OLD."patient_id"
     OR NEW."arrived_at" IS DISTINCT FROM OLD."arrived_at"
     OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" THEN
    RAISE EXCEPTION 'Os campos de identificação do atendimento % são imutáveis.', OLD."code"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT ((OLD."status"::text, NEW."status"::text) IN (
      ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM'),
      ('AGUARDANDO_TRIAGEM', 'CANCELADO'),
      ('EM_TRIAGEM', 'AGUARDANDO_MEDICO'),
      ('EM_TRIAGEM', 'AGUARDANDO_TRIAGEM'),
      ('EM_TRIAGEM', 'CANCELADO'),
      ('AGUARDANDO_MEDICO', 'EM_ATENDIMENTO'),
      ('AGUARDANDO_MEDICO', 'CANCELADO'),
      ('EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA'),
      ('EM_ATENDIMENTO', 'ATENDIMENTO_FINALIZADO'),
      ('MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO')
    )) THEN
      RAISE EXCEPTION 'Transição de status inválida no atendimento %: % → %', OLD."code", OLD."status", NEW."status"
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_attendances_guard" BEFORE UPDATE ON "attendances"
  FOR EACH ROW EXECUTE FUNCTION attendances_guard();

CREATE OR REPLACE FUNCTION patients_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."record_number" IS DISTINCT FROM OLD."record_number" THEN
    RAISE EXCEPTION 'O número do prontuário é imutável.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_patients_guard" BEFORE UPDATE ON "patients"
  FOR EACH ROW EXECUTE FUNCTION patients_guard();

-- VERSÃO ANTERIOR → CORREÇÃO → NOVO REGISTRO:
-- qualquer mudança de CONTEÚDO em triagem/consulta exige version+1 e o snapshot da versão anterior já arquivado
-- (a aplicação grava o snapshot na mesma transação, antes do UPDATE).
CREATE OR REPLACE FUNCTION enforce_clinical_versioning() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec_type clinical_record_type := TG_ARGV[0]::clinical_record_type;
  bookkeeping text[] := ARRAY['version', 'updated_at', 'status', 'finished_at', 'finished_by_id', 'started_by_id', 'started_at'];
BEGIN
  IF (to_jsonb(NEW) - bookkeeping) IS DISTINCT FROM (to_jsonb(OLD) - bookkeeping) THEN
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'Alteração clínica exige incremento de versão (%: % → %).', TG_TABLE_NAME, OLD."version", NEW."version"
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "clinical_record_versions"
      WHERE "record_type" = rec_type AND "record_id" = OLD."id" AND "version" = OLD."version"
    ) THEN
      RAISE EXCEPTION 'Alteração clínica sem a versão anterior arquivada (%).', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_triage_versioning" BEFORE UPDATE ON "triage"
  FOR EACH ROW EXECUTE FUNCTION enforce_clinical_versioning('TRIAGEM');

CREATE TRIGGER "trg_medical_consultations_versioning" BEFORE UPDATE ON "medical_consultations"
  FOR EACH ROW EXECUTE FUNCTION enforce_clinical_versioning('CONSULTA');
