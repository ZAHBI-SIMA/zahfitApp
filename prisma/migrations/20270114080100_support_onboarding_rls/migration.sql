-- =============================================================================
-- ZAHFIT — Support et onboarding (Sprint 14) : RLS, historique immuable
-- =============================================================================

-- --- Tickets -------------------------------------------------------------------
-- La salle crée ses tickets, les lit, peut les clore ou les rouvrir ; seule
-- ZahDigit attribue, priorise et fait avancer le traitement.

ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY support_tickets_read ON "support_tickets" FOR SELECT
  USING (app.is_platform() OR tenant_id = app.current_tenant_id());
CREATE POLICY support_tickets_insert ON "support_tickets" FOR INSERT
  WITH CHECK (
    app.is_platform()
    OR (tenant_id = app.current_tenant_id() AND status = 'OPEN' AND assigned_to_id IS NULL
        AND created_by_id = app.current_user_id())
  );
CREATE POLICY support_tickets_update ON "support_tickets" FOR UPDATE
  USING (app.is_platform() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_platform() OR tenant_id = app.current_tenant_id());

-- La séquence du numéro (#123) doit être utilisable par l'application.
GRANT USAGE, SELECT ON SEQUENCE "support_tickets_number_seq" TO zahfit_app;

ALTER TABLE "support_tickets"
  ADD CONSTRAINT support_tickets_subject CHECK (length(btrim(subject)) BETWEEN 3 AND 160),
  ADD CONSTRAINT support_tickets_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL));

CREATE OR REPLACE FUNCTION app.check_support_ticket_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Ticket clos : ouvrez un nouveau ticket' USING ERRCODE = '23514';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.number <> OLD.number OR NEW.created_by_id <> OLD.created_by_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Identité du ticket non modifiable' USING ERRCODE = '23514';
  END IF;
  IF NOT app.is_platform() THEN
    -- Côté salle : seulement clore, ou rouvrir un ticket qui attend sa réponse.
    IF NEW.subject <> OLD.subject OR NEW.category <> OLD.category OR NEW.priority <> OLD.priority
       OR NEW.assigned_to_id IS DISTINCT FROM OLD.assigned_to_id
       OR NEW.first_response_at IS DISTINCT FROM OLD.first_response_at
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
      RAISE EXCEPTION 'Réservé à l''équipe ZahDigit' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      NEW.status = 'CLOSED'
      OR (NEW.status = 'OPEN' AND OLD.status IN ('WAITING_CUSTOMER', 'RESOLVED'))
    ) THEN
      RAISE EXCEPTION 'Changement de statut réservé à l''équipe ZahDigit' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER support_tickets_update_guard BEFORE UPDATE ON "support_tickets"
  FOR EACH ROW EXECUTE FUNCTION app.check_support_ticket_update();

-- --- Messages ------------------------------------------------------------------
-- Historique immuable. Les notes internes ZahDigit sont INVISIBLES pour la
-- salle : c'est la base qui les filtre, pas l'interface.

ALTER TABLE "support_ticket_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_ticket_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY support_messages_read ON "support_ticket_messages" FOR SELECT
  USING (app.is_platform() OR (tenant_id = app.current_tenant_id() AND kind <> 'INTERNAL_NOTE'));
CREATE POLICY support_messages_insert ON "support_ticket_messages" FOR INSERT
  WITH CHECK (
    (app.is_platform() AND from_platform)
    OR (tenant_id = app.current_tenant_id() AND NOT from_platform AND kind <> 'INTERNAL_NOTE'
        AND author_id = app.current_user_id())
  );
REVOKE UPDATE, DELETE ON TABLE "support_ticket_messages" FROM zahfit_app;
REVOKE DELETE ON TABLE "support_tickets" FROM zahfit_app;

ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT support_messages_body CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  ADD CONSTRAINT support_messages_status CHECK ((kind = 'STATUS_CHANGE') = (status_to IS NOT NULL));

CREATE OR REPLACE FUNCTION app.check_support_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM support_tickets WHERE id = NEW.ticket_id AND tenant_id = NEW.tenant_id AND status <> 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Ticket introuvable ou clos' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER support_messages_insert_guard BEFORE INSERT ON "support_ticket_messages"
  FOR EACH ROW EXECUTE FUNCTION app.check_support_message();

-- --- Accès du support (« se connecter en tant que ») ----------------------------
-- Ouvert uniquement par la plateforme, pour soi-même, 2 heures au plus.
-- La salle le voit toujours ; personne ne peut l'effacer ni le réécrire :
-- seule la fin (ended_at) peut être posée, une fois.

ALTER TABLE "support_accesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_accesses" FORCE ROW LEVEL SECURITY;
CREATE POLICY support_accesses_read ON "support_accesses" FOR SELECT
  USING (app.is_platform() OR tenant_id = app.current_tenant_id());
CREATE POLICY support_accesses_insert ON "support_accesses" FOR INSERT
  WITH CHECK (app.is_platform() AND platform_user_id = app.current_user_id());
CREATE POLICY support_accesses_update ON "support_accesses" FOR UPDATE
  USING (app.is_platform()) WITH CHECK (app.is_platform());
REVOKE DELETE ON TABLE "support_accesses" FROM zahfit_app;

ALTER TABLE "support_accesses"
  ADD CONSTRAINT support_accesses_reason CHECK (length(btrim(reason)) >= 10),
  ADD CONSTRAINT support_accesses_duration CHECK (
    expires_at > started_at AND expires_at <= started_at + interval '2 hours'
  ),
  ADD CONSTRAINT support_accesses_end CHECK (ended_at IS NULL OR ended_at >= started_at),
  ADD CONSTRAINT support_accesses_staff CHECK (target_role <> 'MEMBER');

CREATE OR REPLACE FUNCTION app.check_support_access_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL
     OR NEW.tenant_id <> OLD.tenant_id OR NEW.platform_user_id <> OLD.platform_user_id
     OR NEW.target_user_id <> OLD.target_user_id OR NEW.target_role <> OLD.target_role
     OR NEW.reason <> OLD.reason OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.started_at <> OLD.started_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'Un accès du support ne se modifie pas (seule sa fin est enregistrée)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER support_accesses_update_guard BEFORE UPDATE ON "support_accesses"
  FOR EACH ROW EXECUTE FUNCTION app.check_support_access_update();

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO zahfit_app;

-- --- Onboarding ------------------------------------------------------------------
-- Les salles existantes sont déjà en service : pas d'assistant de démarrage.
UPDATE "tenants" SET onboarding_done_at = now() WHERE onboarding_done_at IS NULL;
