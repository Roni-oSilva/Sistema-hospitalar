-- Extensão para busca por nome (índice trigram). pg_trgm é "trusted": o dono do banco pode criá-la.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "attendance_kind" AS ENUM ('ATENDIMENTO', 'RETORNO');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('EMERGENCIA', 'MUITO_URGENTE', 'URGENTE', 'POUCO_URGENTE', 'NAO_URGENTE');

-- CreateEnum
CREATE TYPE "queue_kind" AS ENUM ('TRIAGEM', 'MEDICA');

-- CreateEnum
CREATE TYPE "queue_status" AS ENUM ('WAITING', 'CALLED', 'IN_SERVICE', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sex" AS ENUM ('MASCULINO', 'FEMININO', 'INTERSEXO', 'NAO_INFORMADO');

-- CreateEnum
CREATE TYPE "phone_type" AS ENUM ('TELEFONE', 'CELULAR');

-- CreateEnum
CREATE TYPE "disability_type" AS ENUM ('FISICA', 'AUDITIVA', 'VISUAL', 'INTELECTUAL', 'PSICOSSOCIAL', 'MULTIPLA', 'NAO_INFORMADO');

-- CreateEnum
CREATE TYPE "accessibility_flag" AS ENUM ('PCD', 'IDOSO', 'GESTANTE', 'CRIANCA', 'MOBILIDADE_REDUZIDA', 'NECESSITA_ACOMPANHANTE', 'NECESSITA_INTERPRETE', 'NECESSITA_LIBRAS', 'NECESSITA_AUXILIO_VISUAL', 'NECESSITA_AUXILIO_COMUNICACAO', 'OUTRA');

-- CreateEnum
CREATE TYPE "accessibility_need" AS ENUM ('CADEIRA_DE_RODAS', 'MULETAS', 'ANDADOR', 'BENGALA', 'AUXILIO_LOCOMOCAO', 'INTERPRETE_LIBRAS', 'AUXILIO_COMUNICACAO', 'ACOMPANHANTE', 'AUXILIO_VISUAL', 'OUTRA');

-- CreateEnum
CREATE TYPE "outcome" AS ENUM ('MEDICADO', 'ALTA', 'RETORNO', 'ENCAMINHAMENTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "triage_status" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "consultation_status" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "medical_note_type" AS ENUM ('COMPLEMENTO', 'CORRECAO');

-- CreateEnum
CREATE TYPE "timeline_event_type" AS ENUM ('ENTRADA', 'TRIAGEM_INICIADA', 'TRIAGEM_DEVOLVIDA', 'TRIAGEM_FINALIZADA', 'CLASSIFICACAO_ALTERADA', 'ACESSIBILIDADE_ATUALIZADA', 'CHAMADO', 'RECHAMADO', 'DEVOLVIDO_A_FILA', 'ATENDIMENTO_INICIADO', 'DIAGNOSTICO_REGISTRADO', 'MEDICACAO_REGISTRADA', 'REGISTRO_CORRIGIDO', 'COMPLEMENTO_REGISTRADO', 'ATENDIMENTO_FINALIZADO', 'ATENDIMENTO_CANCELADO');

-- CreateEnum
CREATE TYPE "timeline_category" AS ENUM ('GENERAL', 'CLINICAL');

-- CreateEnum
CREATE TYPE "clinical_record_type" AS ENUM ('TRIAGEM', 'CONSULTA');

-- CreateEnum
CREATE TYPE "access_event" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'LOGOUT', 'SESSION_EXPIRED', 'PASSWORD_CHANGED', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "sectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "sector_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "professional_register" TEXT,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "notifications_read_at" TIMESTAMPTZ(3),
    "sector_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sequence_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_number" SERIAL NOT NULL,
    "full_name" TEXT NOT NULL,
    "social_name" TEXT,
    "normalized_name" TEXT NOT NULL,
    "cpf" TEXT,
    "cns" TEXT,
    "rg" TEXT,
    "birth_date" DATE NOT NULL,
    "sex" "sex" NOT NULL,
    "nationality" TEXT NOT NULL DEFAULT 'Brasileira',
    "birthplace" TEXT,
    "mother_name" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "type" "phone_type" NOT NULL,
    "number" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "zip_code" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_guardians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "relationship" TEXT NOT NULL,
    "phone" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patient_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_accessibility" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "flags" "accessibility_flag"[],
    "disability_type" "disability_type",
    "needs" "accessibility_need"[],
    "other_need_description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patient_accessibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "ticket_date" DATE NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" "attendance_kind" NOT NULL DEFAULT 'ATENDIMENTO',
    "reason" TEXT,
    "status" "attendance_status" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "current_risk_level" "risk_level",
    "risk_classified_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triage_started_at" TIMESTAMPTZ(3),
    "triage_finished_at" TIMESTAMPTZ(3),
    "first_called_at" TIMESTAMPTZ(3),
    "consultation_started_at" TIMESTAMPTZ(3),
    "medication_registered_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_sector_code" TEXT,
    "client_ip" TEXT,
    "user_agent" TEXT,
    "device_label" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_accessibility" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "flags" "accessibility_flag"[],
    "disability_type" "disability_type",
    "needs" "accessibility_need"[],
    "other_need_description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_accessibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "from_status" "attendance_status",
    "to_status" "attendance_status" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "sector_code" TEXT,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "type" "timeline_event_type" NOT NULL,
    "category" "timeline_category" NOT NULL DEFAULT 'GENERAL',
    "actor_id" UUID,
    "sector_code" TEXT,
    "detail" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "status" "triage_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_by_id" UUID,
    "finished_at" TIMESTAMPTZ(3),
    "chief_complaint" TEXT,
    "symptoms" TEXT,
    "symptom_onset" TEXT,
    "allergies" TEXT,
    "medications_in_use" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "triage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_vitals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "triage_id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_id" UUID NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "heart_rate" INTEGER,
    "respiratory_rate" INTEGER,
    "spo2" INTEGER,
    "temperature_c" DECIMAL(4,1),
    "glucose" INTEGER,
    "weight_kg" DECIMAL(5,1),
    "height_cm" DECIMAL(4,1),
    "pain_scale" INTEGER,

    CONSTRAINT "triage_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_classifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "triage_id" UUID NOT NULL,
    "level" "risk_level" NOT NULL,
    "previous_level" "risk_level",
    "protocol" TEXT,
    "observation" TEXT,
    "reason" TEXT,
    "classified_by_id" UUID NOT NULL,
    "classified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "kind" "queue_kind" NOT NULL,
    "status" "queue_status" NOT NULL DEFAULT 'WAITING',
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "enqueued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_user_id" UUID,
    "room_id" UUID,
    "called_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue_entry_id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "called_by_id" UUID NOT NULL,
    "call_number" INTEGER NOT NULL,
    "is_recall" BOOLEAN NOT NULL DEFAULT false,
    "out_of_order" BOOLEAN NOT NULL DEFAULT false,
    "called_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_consultations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "status" "consultation_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "chief_complaint" TEXT,
    "history" TEXT,
    "examination" TEXT,
    "conduct" TEXT,
    "outcome" "outcome",
    "final_notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medical_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consultation_id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "type" "medical_note_type" NOT NULL,
    "content" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consultation_id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_id" UUID,
    "removal_reason" TEXT,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consultation_id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "prescribed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "medication" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by_id" UUID,
    "cancel_reason" TEXT,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_record_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "record_type" "clinical_record_type" NOT NULL,
    "record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_record_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "target_role" TEXT,
    "attendance_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "username" TEXT,
    "sector_code" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "patient_id" UUID,
    "attendance_id" UUID,
    "attendance_code" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "username_attempted" TEXT,
    "event" "access_event" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_code_key" ON "sectors"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "patients_record_number_key" ON "patients"("record_number");

-- CreateIndex
CREATE UNIQUE INDEX "patients_cpf_key" ON "patients"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "patients_cns_key" ON "patients"("cns");

-- CreateIndex
CREATE INDEX "idx_patients_normalized_name_trgm" ON "patients" USING GIN ("normalized_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patients_birth_date_idx" ON "patients"("birth_date");

-- CreateIndex
CREATE INDEX "patients_normalized_name_birth_date_idx" ON "patients"("normalized_name", "birth_date");

-- CreateIndex
CREATE INDEX "patient_contacts_patient_id_idx" ON "patient_contacts"("patient_id");

-- CreateIndex
CREATE INDEX "patient_contacts_number_idx" ON "patient_contacts"("number");

-- CreateIndex
CREATE INDEX "patient_addresses_patient_id_idx" ON "patient_addresses"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_guardians_patient_id_key" ON "patient_guardians"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_accessibility_patient_id_key" ON "patient_accessibility"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_code_key" ON "attendances"("code");

-- CreateIndex
CREATE INDEX "attendances_status_arrived_at_idx" ON "attendances"("status", "arrived_at");

-- CreateIndex
CREATE INDEX "attendances_patient_id_arrived_at_idx" ON "attendances"("patient_id", "arrived_at");

-- CreateIndex
CREATE INDEX "attendances_arrived_at_idx" ON "attendances"("arrived_at");

-- CreateIndex
CREATE INDEX "attendances_finished_at_idx" ON "attendances"("finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_year_sequence_key" ON "attendances"("year", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_ticket_date_ticket_number_key" ON "attendances"("ticket_date", "ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_accessibility_attendance_id_key" ON "attendance_accessibility"("attendance_id");

-- CreateIndex
CREATE INDEX "attendance_status_history_attendance_id_created_at_idx" ON "attendance_status_history"("attendance_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_events_attendance_id_occurred_at_idx" ON "attendance_events"("attendance_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "triage_attendance_id_key" ON "triage"("attendance_id");

-- CreateIndex
CREATE INDEX "triage_vitals_attendance_id_measured_at_idx" ON "triage_vitals"("attendance_id", "measured_at");

-- CreateIndex
CREATE INDEX "triage_vitals_triage_id_idx" ON "triage_vitals"("triage_id");

-- CreateIndex
CREATE INDEX "risk_classifications_attendance_id_classified_at_idx" ON "risk_classifications"("attendance_id", "classified_at");

-- CreateIndex
CREATE INDEX "queue_kind_status_priority_score_enqueued_at_idx" ON "queue"("kind", "status", "priority_score", "enqueued_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_attendance_id_kind_key" ON "queue"("attendance_id", "kind");

-- CreateIndex
CREATE INDEX "queue_calls_called_at_idx" ON "queue_calls"("called_at" DESC);

-- CreateIndex
CREATE INDEX "queue_calls_attendance_id_idx" ON "queue_calls"("attendance_id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_consultations_attendance_id_key" ON "medical_consultations"("attendance_id");

-- CreateIndex
CREATE INDEX "medical_consultations_doctor_id_started_at_idx" ON "medical_consultations"("doctor_id", "started_at");

-- CreateIndex
CREATE INDEX "medical_notes_consultation_id_created_at_idx" ON "medical_notes"("consultation_id", "created_at");

-- CreateIndex
CREATE INDEX "diagnoses_consultation_id_idx" ON "diagnoses"("consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_consultation_id_key" ON "prescriptions"("consultation_id");

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_position_idx" ON "prescription_items"("prescription_id", "position");

-- CreateIndex
CREATE INDEX "clinical_record_versions_attendance_id_idx" ON "clinical_record_versions"("attendance_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_record_versions_record_type_record_id_version_key" ON "clinical_record_versions"("record_type", "record_id", "version");

-- CreateIndex
CREATE INDEX "notifications_target_role_created_at_idx" ON "notifications"("target_role", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_patient_id_created_at_idx" ON "audit_logs"("patient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_attendance_id_created_at_idx" ON "audit_logs"("attendance_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "access_logs_created_at_idx" ON "access_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "access_logs_user_id_created_at_idx" ON "access_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "access_logs_ip_created_at_idx" ON "access_logs"("ip", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_addresses" ADD CONSTRAINT "patient_addresses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_accessibility" ADD CONSTRAINT "patient_accessibility_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_accessibility" ADD CONSTRAINT "patient_accessibility_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_accessibility" ADD CONSTRAINT "attendance_accessibility_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_accessibility" ADD CONSTRAINT "attendance_accessibility_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_status_history" ADD CONSTRAINT "attendance_status_history_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_status_history" ADD CONSTRAINT "attendance_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage" ADD CONSTRAINT "triage_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage" ADD CONSTRAINT "triage_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage" ADD CONSTRAINT "triage_finished_by_id_fkey" FOREIGN KEY ("finished_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_vitals" ADD CONSTRAINT "triage_vitals_triage_id_fkey" FOREIGN KEY ("triage_id") REFERENCES "triage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_vitals" ADD CONSTRAINT "triage_vitals_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_vitals" ADD CONSTRAINT "triage_vitals_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_classifications" ADD CONSTRAINT "risk_classifications_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_classifications" ADD CONSTRAINT "risk_classifications_triage_id_fkey" FOREIGN KEY ("triage_id") REFERENCES "triage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_classifications" ADD CONSTRAINT "risk_classifications_classified_by_id_fkey" FOREIGN KEY ("classified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue" ADD CONSTRAINT "queue_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue" ADD CONSTRAINT "queue_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue" ADD CONSTRAINT "queue_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_calls" ADD CONSTRAINT "queue_calls_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_calls" ADD CONSTRAINT "queue_calls_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_calls" ADD CONSTRAINT "queue_calls_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_calls" ADD CONSTRAINT "queue_calls_called_by_id_fkey" FOREIGN KEY ("called_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_consultations" ADD CONSTRAINT "medical_consultations_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_consultations" ADD CONSTRAINT "medical_consultations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_notes" ADD CONSTRAINT "medical_notes_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "medical_consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_notes" ADD CONSTRAINT "medical_notes_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_notes" ADD CONSTRAINT "medical_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "medical_consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_removed_by_id_fkey" FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "medical_consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribed_by_id_fkey" FOREIGN KEY ("prescribed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_record_versions" ADD CONSTRAINT "clinical_record_versions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_record_versions" ADD CONSTRAINT "clinical_record_versions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
