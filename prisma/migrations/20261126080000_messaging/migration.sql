-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID,
    "member_id" UUID,
    "channel" "MessageChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "to_phone" TEXT,
    "to_masked" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cost_xof" INTEGER NOT NULL DEFAULT 0,
    "fallback_of_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "renewal_subscription_id" UUID,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renewal_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "messages_fallback_of_id_key" ON "messages"("fallback_of_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_created_at_idx" ON "messages"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_status_created_at_idx" ON "messages"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_provider_provider_message_id_key" ON "messages"("provider", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "renewal_links_token_hash_key" ON "renewal_links"("token_hash");

-- CreateIndex
CREATE INDEX "renewal_links_tenant_id_subscription_id_idx" ON "renewal_links"("tenant_id", "subscription_id");

-- CreateIndex
CREATE INDEX "renewal_links_renewal_subscription_id_idx" ON "renewal_links"("renewal_subscription_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fallback_of_id_fkey" FOREIGN KEY ("fallback_of_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_links" ADD CONSTRAINT "renewal_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_links" ADD CONSTRAINT "renewal_links_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_links" ADD CONSTRAINT "renewal_links_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

