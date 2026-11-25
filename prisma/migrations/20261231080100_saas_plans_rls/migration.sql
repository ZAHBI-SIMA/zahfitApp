-- =============================================================================
-- ZAHFIT — Forfaits SaaS (Sprint 12) : lecture pour tous, écriture plateforme
-- =============================================================================

-- Les forfaits ne sont pas secrets (une salle lit le sien) ; seul le Super
-- Admin les crée ou les modifie. Un forfait n'est jamais supprimé : on le retire.
ALTER TABLE "saas_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_plans_read ON "saas_plans" FOR SELECT USING (true);
CREATE POLICY saas_plans_insert ON "saas_plans" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY saas_plans_update ON "saas_plans" FOR UPDATE USING (app.is_platform()) WITH CHECK (app.is_platform());
REVOKE DELETE ON TABLE "saas_plans" FROM zahfit_app;

ALTER TABLE "saas_plans"
  ADD CONSTRAINT saas_plans_code CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  ADD CONSTRAINT saas_plans_prices CHECK (monthly_price_xof >= 0 AND setup_fee_xof >= 0),
  ADD CONSTRAINT saas_plans_limits CHECK (
    (max_members IS NULL OR max_members >= 0)
    AND (max_staff IS NULL OR max_staff >= 1)
    AND (max_whatsapp_per_month IS NULL OR max_whatsapp_per_month >= 0)
  );

-- Une salle peut modifier ses paramètres (RLS), mais jamais son propre forfait.
CREATE OR REPLACE FUNCTION app.guard_tenant_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.saas_plan_id IS DISTINCT FROM OLD.saas_plan_id AND NOT app.is_platform() THEN
    RAISE EXCEPTION 'Seul ZahDigit peut changer le forfait d''une salle' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_plan_guard BEFORE UPDATE OF saas_plan_id ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_plan();
