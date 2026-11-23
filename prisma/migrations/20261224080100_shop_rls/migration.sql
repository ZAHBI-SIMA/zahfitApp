-- =============================================================================
-- ZAHFIT — Boutique (Sprint 11) : RLS, stock tenu par la base, ventes figées
-- =============================================================================

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY products_tenant ON "products" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_tenant ON "stock_movements" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_tenant ON "sales" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_lines_tenant ON "sale_lines" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Pièces de vente et de stock : on annule ou on contre-passe, on ne supprime pas.
REVOKE DELETE ON TABLE "products" FROM zahfit_app;
REVOKE DELETE ON TABLE "sales" FROM zahfit_app;
REVOKE DELETE, UPDATE ON TABLE "sale_lines" FROM zahfit_app;
REVOKE DELETE, UPDATE ON TABLE "stock_movements" FROM zahfit_app;

-- --- Contraintes -------------------------------------------------------------

ALTER TABLE "products"
  ADD CONSTRAINT products_price CHECK (price_xof >= 0 AND (cost_xof IS NULL OR cost_xof >= 0)),
  ADD CONSTRAINT products_threshold CHECK (low_stock_threshold >= 0),
  -- jamais de stock négatif ; une prestation sans stock reste à 0
  ADD CONSTRAINT products_stock CHECK (stock_qty >= 0 AND (track_stock OR stock_qty = 0));

ALTER TABLE "stock_movements"
  ADD CONSTRAINT stock_movements_quantity CHECK (
    CASE kind
      WHEN 'RESTOCK' THEN quantity > 0
      WHEN 'SALE' THEN quantity < 0
      WHEN 'SALE_VOID' THEN quantity > 0
      ELSE quantity <> 0
    END
  ),
  ADD CONSTRAINT stock_movements_sale CHECK ((kind IN ('SALE', 'SALE_VOID')) = (sale_id IS NOT NULL)),
  ADD CONSTRAINT stock_movements_cost CHECK (unit_cost_xof IS NULL OR unit_cost_xof >= 0);

ALTER TABLE "sales"
  ADD CONSTRAINT sales_total CHECK (total_xof > 0),
  ADD CONSTRAINT sales_number CHECK (number ~ '^VTE-[0-9]{6,}$'),
  ADD CONSTRAINT sales_void CHECK (status <> 'VOIDED' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL));

ALTER TABLE "sale_lines"
  ADD CONSTRAINT sale_lines_amounts CHECK (
    quantity > 0 AND unit_price_xof >= 0 AND line_total_xof = unit_price_xof * quantity
  );

-- Caisse : les ventes en espèces y entrent (et leur annulation en sort).
ALTER TABLE "cash_movements" DROP CONSTRAINT cash_movements_sign;
ALTER TABLE "cash_movements" DROP CONSTRAINT cash_movements_links;
ALTER TABLE "cash_movements"
  ADD CONSTRAINT cash_movements_sign CHECK (
    CASE kind
      WHEN 'PAYMENT' THEN amount_xof > 0
      WHEN 'DEPOSIT' THEN amount_xof > 0
      WHEN 'EXPENSE_VOID' THEN amount_xof > 0
      WHEN 'SALE' THEN amount_xof > 0
      ELSE amount_xof < 0
    END
  ),
  ADD CONSTRAINT cash_movements_links CHECK (
    CASE kind
      WHEN 'PAYMENT' THEN payment_id IS NOT NULL AND expense_id IS NULL AND sale_id IS NULL
      WHEN 'REFUND' THEN payment_id IS NOT NULL AND expense_id IS NULL AND sale_id IS NULL
      WHEN 'EXPENSE' THEN expense_id IS NOT NULL AND payment_id IS NULL AND sale_id IS NULL
      WHEN 'EXPENSE_VOID' THEN expense_id IS NOT NULL AND payment_id IS NULL AND sale_id IS NULL
      WHEN 'SALE' THEN sale_id IS NOT NULL AND payment_id IS NULL AND expense_id IS NULL
      WHEN 'SALE_VOID' THEN sale_id IS NOT NULL AND payment_id IS NULL AND expense_id IS NULL
      ELSE payment_id IS NULL AND expense_id IS NULL AND sale_id IS NULL
    END
  );

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
  IF NEW.sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW.sale_id AND tenant_id = NEW.tenant_id AND method = 'CASH') THEN
    RAISE EXCEPTION 'Vente en espèces hors de la salle' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

-- --- Stock tenu par la base ----------------------------------------------------

-- Un produit naît à 0 : le stock initial est une réception (traçable).
-- Le stock ne change QUE par un mouvement : une mise à jour directe est refusée
-- (pg_trigger_depth() = 1 : appel direct ; 2 : depuis le déclencheur des mouvements).
CREATE OR REPLACE FUNCTION app.guard_product_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.stock_qty := 0;
  ELSIF NEW.stock_qty IS DISTINCT FROM OLD.stock_qty AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Le stock ne se modifie que par un mouvement' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_stock_guard BEFORE INSERT OR UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION app.guard_product_stock();

CREATE OR REPLACE FUNCTION app.apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW.sale_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Vente hors de la salle' USING ERRCODE = '23503';
  END IF;
  UPDATE products SET stock_qty = stock_qty + NEW.quantity
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id AND track_stock;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produit hors de la salle ou sans suivi de stock' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_movements_apply AFTER INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();

-- --- Ventes ----------------------------------------------------------------------

CREATE TRIGGER sales_tenant_check BEFORE INSERT OR UPDATE OF member_id ON "sales"
  FOR EACH ROW EXECUTE FUNCTION app.check_member_tenant();

CREATE OR REPLACE FUNCTION app.check_sale_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW.sale_id AND tenant_id = NEW.tenant_id AND status = 'COMPLETED') THEN
    RAISE EXCEPTION 'Vente hors de la salle ou annulée' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Produit hors de la salle' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sale_lines_check BEFORE INSERT ON "sale_lines"
  FOR EACH ROW EXECUTE FUNCTION app.check_sale_line();

-- Une vente est figée : seule l'annulation (COMPLETED → VOIDED) est possible.
CREATE OR REPLACE FUNCTION app.check_sale_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'Vente annulée : modification impossible' USING ERRCODE = '23514';
  END IF;
  IF NEW.number <> OLD.number OR NEW.total_xof <> OLD.total_xof OR NEW.method <> OLD.method
     OR NEW.sold_by_id <> OLD.sold_by_id OR NEW.created_at <> OLD.created_at
     OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'Vente figée : seule l''annulation est possible' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_lifecycle BEFORE UPDATE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION app.check_sale_update();
