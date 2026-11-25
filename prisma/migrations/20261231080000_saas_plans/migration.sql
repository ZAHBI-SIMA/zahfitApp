-- CreateEnum
CREATE TYPE "SaasFeature" AS ENUM ('ONLINE_PAYMENTS', 'ACCESS_CONTROL', 'CLASSES', 'MESSAGING', 'ADVANCED_REPORTS', 'SHOP');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "saas_plan_id" UUID NOT NULL DEFAULT '00000000-0000-7000-8000-000000000003';

-- CreateTable
CREATE TABLE "saas_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthly_price_xof" INTEGER NOT NULL,
    "setup_fee_xof" INTEGER NOT NULL DEFAULT 0,
    "features" "SaasFeature"[],
    "max_members" INTEGER,
    "max_staff" INTEGER,
    "max_whatsapp_per_month" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saas_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saas_plans_code_key" ON "saas_plans"("code");

-- Forfaits par défaut (cahier des charges, section 5). Tarifs INDICATIFS,
-- modifiables par le Super Admin. Insérés avant la clé étrangère : les salles
-- existantes reçoivent Premium (aucune fonctionnalité retirée au déploiement).
INSERT INTO "saas_plans" ("id", "code", "name", "description", "monthly_price_xof", "setup_fee_xof", "features",
                          "max_members", "max_staff", "max_whatsapp_per_month", "sort_order", "updated_at") VALUES
  ('00000000-0000-7000-8000-000000000001', 'STARTER', 'Starter',
   'Adhérents, abonnements, paiements manuels, caisse et dépenses.',
   15000, 100000, '{}', 150, 3, 0, 1, CURRENT_TIMESTAMP),
  ('00000000-0000-7000-8000-000000000002', 'BUSINESS', 'Business',
   'Starter + paiement Mobile Money en ligne, contrôle d''accès QR Code, planning et réservations.',
   30000, 150000, '{ONLINE_PAYMENTS,ACCESS_CONTROL,CLASSES}', 500, 10, 0, 2, CURRENT_TIMESTAMP),
  ('00000000-0000-7000-8000-000000000003', 'PREMIUM', 'Premium',
   'Business + WhatsApp et SMS, statistiques avancées, boutique.',
   50000, 200000, '{ONLINE_PAYMENTS,ACCESS_CONTROL,CLASSES,MESSAGING,ADVANCED_REPORTS,SHOP}', 2000, 25, 2000, 3, CURRENT_TIMESTAMP);

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_saas_plan_id_fkey" FOREIGN KEY ("saas_plan_id") REFERENCES "saas_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

