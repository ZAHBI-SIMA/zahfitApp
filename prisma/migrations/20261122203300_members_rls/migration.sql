-- =============================================================================
-- ZAHFIT — RLS et recherche sur les adhérents
-- =============================================================================

-- Droits explicites (en plus des DEFAULT PRIVILEGES de la migration rls)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "members" TO zahfit_app;

-- Isolation : une salle ne voit que ses adhérents ; un adhérent connecté
-- voit sa propre fiche (espace adhérent), même sans salle active.
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;

CREATE POLICY members_tenant ON "members" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

CREATE POLICY members_self_read ON "members" FOR SELECT
  USING (user_id IS NOT NULL AND user_id = app.current_user_id());

-- Recherche « contient » rapide (nom, prénom, téléphone, code) : index trigrammes.
-- pg_trgm est une extension « trusted » : le propriétaire de la base peut l'activer.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "members_first_name_trgm" ON "members" USING gin ("first_name" gin_trgm_ops);
CREATE INDEX "members_last_name_trgm"  ON "members" USING gin ("last_name" gin_trgm_ops);
CREATE INDEX "members_phone_trgm"      ON "members" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "members_code_trgm"       ON "members" USING gin ("code" gin_trgm_ops);
