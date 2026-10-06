-- ============================================================================
-- Usuário de MENOR PRIVILÉGIO para a API (hospital_app).
-- Execute depois das migrations (e de novo após migrations que criem tabelas), com um usuário que possa criar
-- roles (superusuário/DBA ou o dono criado pela imagem oficial do Postgres), informando quem é o DONO das tabelas:
--
--   psql "$ADMIN_DATABASE_URL" -v app_password="$(cat deploy/secrets/app_password.txt)" -v owner=hospital_owner \
--        -f deploy/sql/app-role.sql
--
-- A API não precisa (e não deve) criar/alterar tabelas, desligar triggers ou apagar registros clínicos.
-- As travas de imutabilidade (triggers) continuam valendo; estes GRANTs são a segunda camada.
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?owner}
\else
  \set owner :USER
\endif

SELECT 'CREATE ROLE hospital_app LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hospital_app') \gexec

ALTER ROLE hospital_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO hospital_app;
GRANT USAGE ON SCHEMA public TO hospital_app;

-- leitura e escrita controlada em todas as tabelas da aplicação
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hospital_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hospital_app;

-- DELETE somente onde a aplicação substitui conjuntos não clínicos
GRANT DELETE ON patient_contacts, patient_guardians, user_roles, role_permissions, sessions TO hospital_app;

-- tabelas somente-inserção: nem UPDATE (defesa em profundidade, além dos triggers)
REVOKE UPDATE ON audit_logs, access_logs, attendance_events, attendance_status_history, risk_classifications,
  triage_vitals, queue_calls, clinical_record_versions, medical_notes FROM hospital_app;

-- histórico de migrations: só o dono mexe
REVOKE ALL ON _prisma_migrations FROM hospital_app;

-- tabelas futuras criadas pelo dono já nascem com os mesmos privilégios básicos
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO hospital_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hospital_app;
