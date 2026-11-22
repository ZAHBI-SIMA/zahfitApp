-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MemberSource" AS ENUM ('RECEPTION', 'ONLINE', 'IMPORT');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "description" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "member_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "opening_hours" JSONB,
ADD COLUMN     "socials" JSONB,
ADD COLUMN     "suspended_reason" TEXT;

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "birth_date" DATE,
    "photo_url" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "MemberSource" NOT NULL DEFAULT 'RECEPTION',
    "user_id" TEXT,
    "consent_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "consent_sms" BOOLEAN NOT NULL DEFAULT false,
    "consent_email" BOOLEAN NOT NULL DEFAULT false,
    "consent_updated_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_tenant_id_status_last_name_idx" ON "members"("tenant_id", "status", "last_name");

-- CreateIndex
CREATE INDEX "members_tenant_id_created_at_idx" ON "members"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenant_id_code_key" ON "members"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenant_id_phone_key" ON "members"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenant_id_user_id_key" ON "members"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
