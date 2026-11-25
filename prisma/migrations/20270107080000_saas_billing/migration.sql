-- CreateEnum
CREATE TYPE "SaasSubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaasInvoiceKind" AS ENUM ('SETUP', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SaasInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "SaasSubscriptionStatus" NOT NULL,
    "trial_ends_on" DATE,
    "current_period_start" DATE,
    "current_period_end" DATE,
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "SaasInvoiceKind" NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "amount_xof" INTEGER NOT NULL,
    "status" "SaasInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "payment_method" "PaymentMethod",
    "payment_reference" TEXT,
    "void_reason" TEXT,
    "reminders_sent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_xof" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_tenant_id_key" ON "tenant_subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "saas_invoices_number_key" ON "saas_invoices"("number");

-- CreateIndex
CREATE INDEX "saas_invoices_status_due_on_idx" ON "saas_invoices"("status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "saas_invoices_tenant_id_kind_period_start_key" ON "saas_invoices"("tenant_id", "kind", "period_start");

-- CreateIndex
CREATE INDEX "saas_payments_tenant_id_created_at_idx" ON "saas_payments"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saas_payments_provider_provider_ref_key" ON "saas_payments"("provider", "provider_ref");

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "saas_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

