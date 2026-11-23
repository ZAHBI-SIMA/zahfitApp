-- =============================================================================
-- ZAHFIT — WhatsApp, SMS et renouvellement en un clic (Sprint 9) : RLS et règles
-- =============================================================================

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_tenant ON "messages" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "renewal_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "renewal_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY renewal_links_tenant ON "renewal_links" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Le journal des envois est une pièce de contrôle (coûts) : pas de suppression.
REVOKE DELETE ON TABLE "messages" FROM zahfit_app;

ALTER TABLE "messages"
  ADD CONSTRAINT messages_cost CHECK (cost_xof >= 0),
  ADD CONSTRAINT messages_attempts CHECK (attempts >= 0),
  -- un SMS de secours remplace toujours un message WhatsApp
  ADD CONSTRAINT messages_fallback_channel CHECK (fallback_of_id IS NULL OR channel = 'SMS');

-- Un message ou un lien ne peut pas viser un adhérent / un abonnement d'une autre salle.
CREATE OR REPLACE FUNCTION app.check_member_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.member_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Adhérent hors de la salle' USING ERRCODE = '23503';
  END IF;
  IF TG_TABLE_NAME = 'renewal_links' THEN
    IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE id = NEW.subscription_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Abonnement hors de la salle' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_tenant_check BEFORE INSERT ON "messages"
  FOR EACH ROW EXECUTE FUNCTION app.check_member_tenant();
CREATE TRIGGER renewal_links_tenant_check BEFORE INSERT ON "renewal_links"
  FOR EACH ROW EXECUTE FUNCTION app.check_member_tenant();
