-- =============================================================================
-- ZAHFIT — Réservations et notifications (Sprint 8) : RLS et garanties en base
-- =============================================================================

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY bookings_tenant ON "bookings" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant ON "notifications" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Une seule réservation ACTIVE (confirmée ou en attente) par adhérent et par séance ;
-- une réservation annulée n'empêche pas de réserver à nouveau.
CREATE UNIQUE INDEX bookings_active_unique ON "bookings" (session_id, member_id) WHERE status <> 'CANCELLED';

ALTER TABLE "bookings"
  ADD CONSTRAINT bookings_cancel_fields CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  -- la présence ne se pointe que sur une place confirmée
  ADD CONSTRAINT bookings_attendance_confirmed CHECK (attendance IS NULL OR status = 'CONFIRMED');
ALTER TABLE "tenants"
  ADD CONSTRAINT tenants_booking_open_days CHECK (booking_open_days BETWEEN 1 AND 60),
  ADD CONSTRAINT tenants_booking_cancel_hours CHECK (booking_cancel_hours BETWEEN 0 AND 72);
ALTER TABLE "notifications"
  ADD CONSTRAINT notifications_email CHECK (email_status = 'NONE' OR email_subject IS NOT NULL);

-- CAPACITÉ GARANTIE PAR LA BASE : le compteur des places confirmées est tenu
-- par ce déclencheur, et la contrainte CHECK refuse tout dépassement — même
-- deux réservations simultanées, ou une insertion faite hors de l'application.
ALTER TABLE "class_sessions"
  ADD CONSTRAINT class_sessions_booked_count CHECK (booked_count BETWEEN 0 AND capacity);

CREATE OR REPLACE FUNCTION app.sync_booked_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  delta integer := 0;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'CONFIRMED' THEN delta := delta + 1; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'CONFIRMED' THEN delta := delta - 1; END IF;
  IF delta <> 0 THEN
    UPDATE class_sessions SET booked_count = booked_count + delta
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER bookings_sync_count AFTER INSERT OR UPDATE OF status OR DELETE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION app.sync_booked_count();

-- Une réservation ne peut pas viser une séance ou un adhérent d'une autre salle
-- (les clés étrangères contournent le RLS).
CREATE OR REPLACE FUNCTION app.check_booking_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM class_sessions WHERE id = NEW.session_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Séance hors de la salle' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Adhérent hors de la salle' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_tenant_check BEFORE INSERT OR UPDATE OF session_id, member_id, tenant_id ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION app.check_booking_tenant();
