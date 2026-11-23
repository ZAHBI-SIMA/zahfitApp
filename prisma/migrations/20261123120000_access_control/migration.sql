-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('QR', 'BADGE');

-- CreateEnum
CREATE TYPE "AccessReason" AS ENUM ('GRANTED', 'INVALID_CODE', 'EXPIRED_CODE', 'UNKNOWN_BADGE', 'MEMBER_ARCHIVED', 'NO_SUBSCRIPTION', 'SUBSCRIPTION_EXPIRED', 'NOT_STARTED', 'PAYMENT_PENDING', 'SUBSCRIPTION_FROZEN', 'SUBSCRIPTION_CANCELLED', 'DAY_NOT_ALLOWED', 'OUTSIDE_HOURS', 'GYM_CLOSED', 'QUOTA_REACHED', 'PASSBACK');

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "badge_hash" TEXT,
ADD COLUMN     "badge_hint" TEXT,
ADD COLUMN     "badge_issued_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "access_from" TEXT,
ADD COLUMN     "access_until" TEXT,
ADD COLUMN     "allowed_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "max_entries" INTEGER;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "anti_passback_minutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "access_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "member_id" UUID,
    "subscription_id" UUID,
    "method" "AccessMethod" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "reason" "AccessReason" NOT NULL,
    "scanned_by_id" TEXT,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "client_event_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_logs_tenant_id_occurred_at_idx" ON "access_logs"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "access_logs_tenant_id_member_id_occurred_at_idx" ON "access_logs"("tenant_id", "member_id", "occurred_at");

-- CreateIndex
CREATE INDEX "access_logs_subscription_id_granted_idx" ON "access_logs"("subscription_id", "granted");

-- CreateIndex
CREATE UNIQUE INDEX "access_logs_tenant_id_client_event_id_key" ON "access_logs"("tenant_id", "client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenant_id_badge_hash_key" ON "members"("tenant_id", "badge_hash");

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

