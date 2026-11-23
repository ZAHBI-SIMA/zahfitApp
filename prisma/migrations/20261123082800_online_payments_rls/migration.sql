-- =============================================================================
-- ZAHFIT — Paiement en ligne (Sprint 5)
-- =============================================================================

-- Notifications des prestataires : traitées en contexte PLATEFORME uniquement
-- (le webhook ne connaît pas encore la salle) ; jamais supprimées.
GRANT SELECT, INSERT, UPDATE ON TABLE "payment_webhook_events" TO zahfit_app;
REVOKE DELETE ON TABLE "payment_webhook_events" FROM zahfit_app;
ALTER TABLE "payment_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_platform ON "payment_webhook_events" FOR ALL
  USING (app.is_platform()) WITH CHECK (app.is_platform());

-- Page publique d'une salle : traduit un slug en identifiant, pour une salle
-- ACTIVE uniquement. SECURITY DEFINER : seule cette information franchit le
-- RLS ; tout le reste se lit ensuite dans le contexte de la salle.
CREATE OR REPLACE FUNCTION app.public_tenant_id(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT id FROM tenants WHERE slug = p_slug AND status = 'ACTIVE' AND deleted_at IS NULL $$;
REVOKE ALL ON FUNCTION app.public_tenant_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_tenant_id(text) TO zahfit_app;
