-- =============================================================================
-- ZAHFIT — Isolation multi-tenant par Row Level Security
-- =============================================================================
-- Principe : l'application se connecte avec le rôle `zahfit_app` (non
-- propriétaire des tables). Au début de chaque transaction, lib/db.ts pose :
--   app.tenant_id   : salle active de la requête
--   app.user_id     : utilisateur connecté
--   app.is_platform : 'on' uniquement pour les opérations Super Admin
-- Si rien n'est posé, les fonctions renvoient NULL / false et les politiques
-- ne laissent passer AUCUNE ligne : l'oubli est sûr par défaut.
-- =============================================================================

-- Rôle applicatif (créé par docker/postgres/init.sql en local ; ici en
-- filet de sécurité pour la CI et la production, sans mot de passe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zahfit_app') THEN
    CREATE ROLE zahfit_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- --- Fonctions de contexte --------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app.is_platform() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.is_platform', true), '') = 'on' $$;

GRANT USAGE ON SCHEMA app TO zahfit_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO zahfit_app;

-- --- Droits du rôle applicatif ---------------------------------------------
GRANT USAGE ON SCHEMA public TO zahfit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zahfit_app;
-- (absente de la base « shadow » utilisée par `prisma migrate dev`)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM zahfit_app;
  END IF;
END
$$;
-- Journal d'audit en ajout seul : ni modification ni suppression possible.
REVOKE UPDATE, DELETE ON TABLE "audit_logs" FROM zahfit_app;
-- Les tables créées par les migrations futures héritent des mêmes droits.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zahfit_app;

-- --- tenants ----------------------------------------------------------------
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

-- Lecture : la salle active, les salles dont je suis membre, ou tout (plateforme).
CREATE POLICY tenants_select ON "tenants" FOR SELECT USING (
  app.is_platform()
  OR id = app.current_tenant_id()
  OR EXISTS (
    SELECT 1 FROM "tenant_memberships" m
    WHERE m.tenant_id = "tenants".id
      AND m.user_id = app.current_user_id()
      AND m.status = 'ACTIVE'
  )
);
-- Création / suppression : Super Admin uniquement.
CREATE POLICY tenants_insert ON "tenants" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY tenants_delete ON "tenants" FOR DELETE USING (app.is_platform());
-- Modification : Super Admin, ou la salle active (infos de l'établissement).
CREATE POLICY tenants_update ON "tenants" FOR UPDATE
  USING (app.is_platform() OR id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR id = app.current_tenant_id());

-- --- tenant_memberships ----------------------------------------------------
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_tenant ON "tenant_memberships" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());
-- Un utilisateur voit toujours SES propres appartenances (sélecteur de salle).
CREATE POLICY memberships_self_read ON "tenant_memberships" FOR SELECT
  USING (user_id = app.current_user_id());

-- --- audit_logs -------------------------------------------------------------
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_select ON "audit_logs" FOR SELECT
  USING (app.is_platform() OR tenant_id = app.current_tenant_id());
-- Les événements plateforme (tenant_id NULL, ex. connexion) peuvent être
-- écrits depuis n'importe quel contexte, mais ne sont lisibles que par la plateforme.
CREATE POLICY audit_insert ON "audit_logs" FOR INSERT
  WITH CHECK (
    app.is_platform()
    OR tenant_id IS NULL
    OR tenant_id = app.current_tenant_id()
  );
