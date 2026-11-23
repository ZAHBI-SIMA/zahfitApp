-- =============================================================================
-- ZAHFIT — Cours collectifs et planning (Sprint 7) : RLS et règles en base
-- =============================================================================

-- Isolation par salle, comme pour le reste des données métier.
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY rooms_tenant ON "rooms" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "class_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY class_types_tenant ON "class_types" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "class_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_series" FORCE ROW LEVEL SECURITY;
CREATE POLICY class_series_tenant ON "class_series" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

ALTER TABLE "class_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY class_sessions_tenant ON "class_sessions" FOR ALL
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- Cohérence des valeurs.
ALTER TABLE "rooms"
  ADD CONSTRAINT rooms_capacity CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 1000);
ALTER TABLE "class_types"
  ADD CONSTRAINT class_types_duration CHECK (duration_minutes BETWEEN 10 AND 480),
  ADD CONSTRAINT class_types_capacity CHECK (default_capacity BETWEEN 1 AND 500),
  ADD CONSTRAINT class_types_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "class_series"
  ADD CONSTRAINT class_series_weekday CHECK (weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT class_series_start_time CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT class_series_duration CHECK (duration_minutes BETWEEN 10 AND 480),
  ADD CONSTRAINT class_series_capacity CHECK (capacity BETWEEN 1 AND 500),
  ADD CONSTRAINT class_series_period CHECK (ends_on IS NULL OR ends_on >= starts_on);
ALTER TABLE "class_sessions"
  ADD CONSTRAINT class_sessions_period CHECK (ends_at > starts_at),
  ADD CONSTRAINT class_sessions_capacity CHECK (capacity BETWEEN 1 AND 500),
  ADD CONSTRAINT class_sessions_occurrence CHECK ((series_id IS NULL) = (occurrence_date IS NULL)),
  ADD CONSTRAINT class_sessions_cancel_reason CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL);

-- Un coach, ou une salle de cours, ne peut pas avoir deux séances qui se
-- chevauchent : garanti par la base, même en cas d'écritures simultanées.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "class_sessions"
  ADD CONSTRAINT class_sessions_coach_overlap
    EXCLUDE USING gist (coach_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status = 'SCHEDULED'),
  ADD CONSTRAINT class_sessions_room_overlap
    EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status = 'SCHEDULED' AND room_id IS NOT NULL);

-- Les clés étrangères contournent le RLS : ce déclencheur refuse un coach,
-- une salle de cours, un type ou une série appartenant à une AUTRE salle.
CREATE OR REPLACE FUNCTION app.check_class_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_memberships WHERE id = NEW.coach_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Coach hors de la salle' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM class_types WHERE id = NEW.class_type_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Type de cours hors de la salle' USING ERRCODE = '23503';
  END IF;
  IF NEW.room_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rooms WHERE id = NEW.room_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Salle de cours hors de la salle' USING ERRCODE = '23503';
  END IF;
  -- IF imbriqués : class_series n'a pas de colonne series_id, et SQL ne
  -- garantit pas l'ordre d'évaluation d'un AND.
  IF TG_TABLE_NAME = 'class_sessions' THEN
    IF NEW.series_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM class_series WHERE id = NEW.series_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Cours régulier hors de la salle' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER class_series_tenant_check BEFORE INSERT OR UPDATE ON "class_series"
  FOR EACH ROW EXECUTE FUNCTION app.check_class_tenant();
CREATE TRIGGER class_sessions_tenant_check BEFORE INSERT OR UPDATE ON "class_sessions"
  FOR EACH ROW EXECUTE FUNCTION app.check_class_tenant();
