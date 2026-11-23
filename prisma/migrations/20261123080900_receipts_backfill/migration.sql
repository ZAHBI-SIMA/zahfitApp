-- =============================================================================
-- ZAHFIT — Reçus des paiements encaissés avant le Sprint 4
-- Numérotés par salle, dans l'ordre chronologique, puis compteur aligné.
-- =============================================================================

WITH numbered AS (
  SELECT p.id, p.tenant_id, p.kind,
         row_number() OVER (PARTITION BY p.tenant_id ORDER BY p.created_at, p.id) AS n
  FROM payments p
  WHERE p.status = 'SUCCEEDED'
    AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)
)
INSERT INTO receipts (id, tenant_id, number, payment_id, issued_at)
SELECT gen_random_uuid(),
       tenant_id,
       CASE WHEN kind = 'REFUND' THEN 'AV-' ELSE 'REC-' END || lpad(n::text, 6, '0'),
       id,
       now()
FROM numbered;

UPDATE tenants t
SET receipt_seq = (SELECT count(*) FROM receipts r WHERE r.tenant_id = t.id);
