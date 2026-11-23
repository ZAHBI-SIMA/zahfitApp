-- =============================================================================
-- ZAHFIT — Reçus et remboursements (Sprint 4)
-- =============================================================================

-- Un reçu est une pièce comptable : ni modifiable, ni supprimable.
GRANT SELECT, INSERT ON TABLE "receipts" TO zahfit_app;
REVOKE UPDATE, DELETE ON TABLE "receipts" FROM zahfit_app;

ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY receipts_tenant ON "receipts" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Cohérence garantie par la base.
ALTER TABLE "payments"
  ADD CONSTRAINT payments_refund_link CHECK ((kind = 'REFUND') = (refund_of_id IS NOT NULL)),
  ADD CONSTRAINT payments_refund_reason CHECK (kind <> 'REFUND' OR reason IS NOT NULL);
ALTER TABLE "tenants"
  ADD CONSTRAINT tenants_deposit_percent CHECK (min_deposit_percent BETWEEN 10 AND 100);
