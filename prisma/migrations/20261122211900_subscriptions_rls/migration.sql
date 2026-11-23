-- =============================================================================
-- ZAHFIT — RLS des formules, abonnements et paiements (Sprint 3)
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON TABLE "membership_plans", "subscriptions", "payments" TO zahfit_app;
-- Rien n'est jamais supprimé : formules retirées (is_active), abonnements
-- annulés (status), paiements remboursés (status). L'historique reste intact.
REVOKE DELETE ON TABLE "membership_plans", "subscriptions", "payments" FROM zahfit_app;

ALTER TABLE "membership_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_tenant ON "membership_plans" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant ON "subscriptions" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON "payments" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Cohérence métier garantie par la base, pas seulement par le code.
ALTER TABLE "membership_plans"
  ADD CONSTRAINT plans_price_positive CHECK (price_xof >= 0),
  ADD CONSTRAINT plans_duration_positive CHECK (duration_value > 0),
  ADD CONSTRAINT plans_freeze_positive CHECK (max_freeze_days >= 0),
  ADD CONSTRAINT plans_entries_positive CHECK (max_entries IS NULL OR max_entries > 0);
ALTER TABLE "subscriptions"
  ADD CONSTRAINT subscriptions_dates_ordered CHECK (end_date >= start_date);
ALTER TABLE "payments"
  ADD CONSTRAINT payments_amount_positive CHECK (amount_xof > 0);
