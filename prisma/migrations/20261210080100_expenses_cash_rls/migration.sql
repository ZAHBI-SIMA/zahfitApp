-- =============================================================================
-- ZAHFIT — Dépenses et caisse (Sprint 10) : RLS et règles garanties par la base
-- =============================================================================

ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_categories_tenant ON "expense_categories" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY expenses_tenant ON "expenses" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "expense_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_attachments_tenant ON "expense_attachments" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_sessions_tenant ON "cash_sessions" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_movements_tenant ON "cash_movements" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Pièces comptables : on annule (dépense) ou on contre-passe (mouvement), on ne supprime pas.
REVOKE DELETE ON TABLE "expenses" FROM zahfit_app;
REVOKE DELETE ON TABLE "cash_sessions" FROM zahfit_app;
REVOKE DELETE, UPDATE ON TABLE "cash_movements" FROM zahfit_app;

-- --- Contraintes -------------------------------------------------------------

ALTER TABLE "expenses"
  ADD CONSTRAINT expenses_amount CHECK (amount_xof > 0),
  ADD CONSTRAINT expenses_void CHECK (status <> 'VOIDED' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL));

ALTER TABLE "expense_attachments"
  ADD CONSTRAINT expense_attachments_size CHECK (size_bytes BETWEEN 1 AND 5242880 AND octet_length(data) = size_bytes),
  ADD CONSTRAINT expense_attachments_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

ALTER TABLE "cash_sessions"
  ADD CONSTRAINT cash_sessions_float CHECK (opening_float_xof >= 0),
  ADD CONSTRAINT cash_sessions_counted CHECK (counted_xof IS NULL OR counted_xof >= 0),
  ADD CONSTRAINT cash_sessions_closed CHECK (
    status = 'OPEN'
    OR (closed_at IS NOT NULL AND closed_by_id IS NOT NULL AND counted_xof IS NOT NULL
        AND expected_xof IS NOT NULL AND difference_xof = counted_xof - expected_xof)
  ),
  ADD CONSTRAINT cash_sessions_validated CHECK (
    status <> 'VALIDATED' OR (validated_at IS NOT NULL AND validated_by_id IS NOT NULL)
  );

-- Une seule caisse ouverte à la fois par salle.
CREATE UNIQUE INDEX cash_sessions_one_open ON "cash_sessions" (tenant_id) WHERE status = 'OPEN';

ALTER TABLE "cash_movements"
  ADD CONSTRAINT cash_movements_sign CHECK (
    CASE kind
      WHEN 'PAYMENT' THEN amount_xof > 0
      WHEN 'DEPOSIT' THEN amount_xof > 0
      WHEN 'EXPENSE_VOID' THEN amount_xof > 0
      ELSE amount_xof < 0
    END
  ),
  ADD CONSTRAINT cash_movements_links CHECK (
    CASE kind
      WHEN 'PAYMENT' THEN payment_id IS NOT NULL
      WHEN 'REFUND' THEN payment_id IS NOT NULL
      WHEN 'EXPENSE' THEN expense_id IS NOT NULL
      WHEN 'EXPENSE_VOID' THEN expense_id IS NOT NULL
      ELSE payment_id IS NULL AND expense_id IS NULL
    END
  );

-- --- Déclencheurs ------------------------------------------------------------

-- Les clés étrangères contournent la RLS : on vérifie que tout reste dans la salle.
CREATE OR REPLACE FUNCTION app.check_expense_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    IF NOT EXISTS (SELECT 1 FROM expense_categories WHERE id = NEW.category_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Catégorie hors de la salle' USING ERRCODE = '23503';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = NEW.expense_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Dépense hors de la salle' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expenses_tenant_check BEFORE INSERT OR UPDATE OF category_id ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION app.check_expense_tenant();
CREATE TRIGGER expense_attachments_tenant_check BEFORE INSERT ON "expense_attachments"
  FOR EACH ROW EXECUTE FUNCTION app.check_expense_tenant();

-- Un mouvement n'entre que dans une caisse OUVERTE de la même salle.
-- FOR SHARE : une clôture concurrente attend la fin de cette transaction.
CREATE OR REPLACE FUNCTION app.check_cash_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  session_status text;
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT status INTO session_status FROM cash_sessions
      WHERE id = NEW.session_id AND tenant_id = NEW.tenant_id FOR SHARE;
    IF session_status IS NULL THEN
      RAISE EXCEPTION 'Caisse hors de la salle' USING ERRCODE = '23503';
    END IF;
    IF session_status <> 'OPEN' THEN
      RAISE EXCEPTION 'Caisse clôturée' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.payment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM payments WHERE id = NEW.payment_id AND tenant_id = NEW.tenant_id AND method = 'CASH') THEN
    RAISE EXCEPTION 'Paiement en espèces hors de la salle' USING ERRCODE = '23503';
  END IF;
  IF NEW.expense_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM expenses WHERE id = NEW.expense_id AND tenant_id = NEW.tenant_id AND method = 'CASH') THEN
    RAISE EXCEPTION 'Dépense en espèces hors de la salle' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_movements_check BEFORE INSERT ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION app.check_cash_movement();

-- Cycle de vie d'une caisse : OPEN → CLOSED → VALIDATED, sans retour.
-- À la clôture, la base recalcule elle-même le théorique (fond + mouvements).
CREATE OR REPLACE FUNCTION app.check_cash_session_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  computed integer;
BEGIN
  IF OLD.status = 'VALIDATED' THEN
    RAISE EXCEPTION 'Caisse validée : modification impossible' USING ERRCODE = '23514';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.opening_float_xof <> OLD.opening_float_xof
     OR NEW.opened_by_id <> OLD.opened_by_id OR NEW.opened_at <> OLD.opened_at THEN
    RAISE EXCEPTION 'Ouverture de caisse non modifiable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
    SELECT OLD.opening_float_xof + COALESCE(SUM(amount_xof), 0) INTO computed
      FROM cash_movements WHERE session_id = OLD.id;
    IF NEW.expected_xof IS DISTINCT FROM computed THEN
      RAISE EXCEPTION 'Théorique de caisse incohérent' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'CLOSED' THEN
    IF NEW.status <> 'VALIDATED'
       OR NEW.counted_xof IS DISTINCT FROM OLD.counted_xof
       OR NEW.expected_xof IS DISTINCT FROM OLD.expected_xof
       OR NEW.closing_note IS DISTINCT FROM OLD.closing_note THEN
      RAISE EXCEPTION 'Caisse clôturée : seule la validation est possible' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Transition de caisse interdite' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_sessions_lifecycle BEFORE UPDATE ON "cash_sessions"
  FOR EACH ROW EXECUTE FUNCTION app.check_cash_session_update();
