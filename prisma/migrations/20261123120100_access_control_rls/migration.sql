-- =============================================================================
-- ZAHFIT — Contrôle d'accès (Sprint 6) : RLS, règles et reprise des données
-- =============================================================================

-- Le journal des passages est une pièce de contrôle : ajout seul.
GRANT SELECT, INSERT ON TABLE "access_logs" TO zahfit_app;
REVOKE UPDATE, DELETE ON TABLE "access_logs" FROM zahfit_app;

ALTER TABLE "access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY access_logs_tenant ON "access_logs" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Cohérence garantie par la base.
ALTER TABLE "access_logs"
  -- une entrée autorisée concerne toujours un adhérent et un abonnement
  ADD CONSTRAINT access_logs_granted_target CHECK (NOT granted OR (member_id IS NOT NULL AND subscription_id IS NOT NULL)),
  ADD CONSTRAINT access_logs_granted_reason CHECK (granted = (reason = 'GRANTED'));
ALTER TABLE "tenants"
  ADD CONSTRAINT tenants_anti_passback CHECK (anti_passback_minutes BETWEEN 0 AND 720);
ALTER TABLE "members"
  ADD CONSTRAINT members_badge_pair CHECK ((badge_hash IS NULL) = (badge_hint IS NULL));

-- Les abonnements déjà vendus reçoivent les restrictions de leur formule,
-- désormais figées à la vente comme le prix.
UPDATE "subscriptions" s
SET allowed_days = p.allowed_days,
    access_from  = p.access_from,
    access_until = p.access_until,
    max_entries  = p.max_entries
FROM "membership_plans" p
WHERE p.id = s.plan_id;
