-- =============================================================================
-- ZAHFIT — Facturation ZahDigit (Sprint 13) : RLS, factures figées, initialisation
-- =============================================================================

-- Une salle LIT son abonnement, ses factures et ses paiements ; seule la
-- plateforme (Super Admin, tâches planifiées, webhook) les modifie. La salle
-- peut seulement CRÉER une tentative de paiement en attente pour sa facture.

ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_subscriptions_read ON "tenant_subscriptions" FOR SELECT
  USING (app.is_platform() OR tenant_id = app.current_tenant_id());
CREATE POLICY tenant_subscriptions_insert ON "tenant_subscriptions" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY tenant_subscriptions_update ON "tenant_subscriptions" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());

ALTER TABLE "saas_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_invoices_read ON "saas_invoices" FOR SELECT
  USING (app.is_platform() OR tenant_id = app.current_tenant_id());
CREATE POLICY saas_invoices_insert ON "saas_invoices" FOR INSERT WITH CHECK (app.is_platform());
CREATE POLICY saas_invoices_update ON "saas_invoices" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());

ALTER TABLE "saas_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_payments_read ON "saas_payments" FOR SELECT
  USING (app.is_platform() OR tenant_id = app.current_tenant_id());
CREATE POLICY saas_payments_insert ON "saas_payments" FOR INSERT
  WITH CHECK (app.is_platform() OR (tenant_id = app.current_tenant_id() AND status = 'PENDING'));
CREATE POLICY saas_payments_update ON "saas_payments" FOR UPDATE
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR (tenant_id = app.current_tenant_id() AND status = 'PENDING'));

ALTER TABLE "platform_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_counters_platform ON "platform_counters" FOR ALL
  USING (app.is_platform()) WITH CHECK (app.is_platform());

-- Pièces comptables : jamais supprimées (une facture s'annule).
REVOKE DELETE ON TABLE "tenant_subscriptions" FROM zahfit_app;
REVOKE DELETE ON TABLE "saas_invoices" FROM zahfit_app;
REVOKE DELETE ON TABLE "saas_payments" FROM zahfit_app;
REVOKE DELETE ON TABLE "platform_counters" FROM zahfit_app;

-- --- Contraintes -------------------------------------------------------------

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT tenant_subscriptions_trial CHECK (status <> 'TRIALING' OR trial_ends_on IS NOT NULL),
  ADD CONSTRAINT tenant_subscriptions_period CHECK (
    current_period_start IS NULL OR (current_period_end IS NOT NULL AND current_period_end >= current_period_start)
  );

ALTER TABLE "saas_invoices"
  ADD CONSTRAINT saas_invoices_number CHECK (number ~ '^ZD-[0-9]{6,}$'),
  ADD CONSTRAINT saas_invoices_amount CHECK (amount_xof > 0),
  ADD CONSTRAINT saas_invoices_dates CHECK (due_on >= issued_on),
  ADD CONSTRAINT saas_invoices_period CHECK (
    kind <> 'MONTHLY' OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
  ),
  ADD CONSTRAINT saas_invoices_paid CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  ADD CONSTRAINT saas_invoices_void CHECK (status <> 'VOID' OR void_reason IS NOT NULL);

-- Une seule facture d'installation par salle.
CREATE UNIQUE INDEX saas_invoices_one_setup ON "saas_invoices" (tenant_id) WHERE kind = 'SETUP';

ALTER TABLE "saas_payments"
  ADD CONSTRAINT saas_payments_amount CHECK (amount_xof > 0),
  ADD CONSTRAINT saas_payments_paid CHECK (status <> 'SUCCEEDED' OR paid_at IS NOT NULL);

-- Un paiement vise une facture OUVERTE de la même salle, pour son montant exact.
CREATE OR REPLACE FUNCTION app.check_saas_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM saas_invoices
    WHERE id = NEW.invoice_id AND tenant_id = NEW.tenant_id AND status = 'OPEN' AND amount_xof = NEW.amount_xof
  ) THEN
    RAISE EXCEPTION 'Facture introuvable, déjà réglée ou montant différent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER saas_payments_check BEFORE INSERT ON "saas_payments"
  FOR EACH ROW EXECUTE FUNCTION app.check_saas_payment();

-- Une facture émise est figée : seuls le règlement, l'annulation et les relances la modifient.
CREATE OR REPLACE FUNCTION app.check_saas_invoice_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number <> OLD.number OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind
     OR NEW.amount_xof <> OLD.amount_xof OR NEW.plan_code <> OLD.plan_code
     OR NEW.issued_on <> OLD.issued_on OR NEW.due_on <> OLD.due_on
     OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end THEN
    RAISE EXCEPTION 'Facture émise : contenu non modifiable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'OPEN' AND (NEW.status <> OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'Facture déjà réglée ou annulée' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER saas_invoices_lifecycle BEFORE UPDATE ON "saas_invoices"
  FOR EACH ROW EXECUTE FUNCTION app.check_saas_invoice_update();

-- --- Initialisation -------------------------------------------------------------

INSERT INTO "platform_counters" ("key", "value") VALUES ('saas_invoice', 0);

-- Salles existantes : abonnement actif à partir d'aujourd'hui, sans facture rétroactive.
INSERT INTO "tenant_subscriptions" ("id", "tenant_id", "status", "current_period_start", "current_period_end", "updated_at")
SELECT gen_random_uuid(), id, 'ACTIVE', CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_TIMESTAMP
FROM "tenants" WHERE deleted_at IS NULL;
