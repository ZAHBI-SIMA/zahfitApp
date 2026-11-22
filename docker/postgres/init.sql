-- Exécuté une seule fois, à la création du volume Postgres.
--
-- Deux rôles distincts :
--   zahfit_owner : propriétaire des tables, utilisé UNIQUEMENT pour les migrations.
--   zahfit_app   : utilisé par l'application. N'est PAS propriétaire des tables,
--                  donc les politiques RLS s'appliquent toujours à lui.
CREATE ROLE zahfit_app LOGIN PASSWORD 'zahfit_app_dev' NOSUPERUSER NOBYPASSRLS;

-- Base dédiée aux tests d'intégration (même schéma, données jetables).
CREATE DATABASE zahfit_test OWNER zahfit_owner;

GRANT CONNECT ON DATABASE zahfit TO zahfit_app;
GRANT CONNECT ON DATABASE zahfit_test TO zahfit_app;
