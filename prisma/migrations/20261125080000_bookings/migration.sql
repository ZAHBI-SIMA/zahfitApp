-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MEMBER_WELCOME', 'BOOKING_CONFIRMED', 'BOOKING_WAITLISTED', 'WAITLIST_PROMOTED', 'BOOKING_CANCELLED', 'SESSION_CANCELLED', 'SUBSCRIPTION_EXPIRING', 'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'PAYMENT_CONFIRMED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('NONE', 'PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "class_sessions" ADD COLUMN     "booked_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "booking_cancel_hours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "booking_open_days" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "attendance" "AttendanceStatus",
    "attendance_marked_at" TIMESTAMPTZ(3),
    "attendance_marked_by_id" TEXT,
    "booked_by_id" TEXT,
    "promoted_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" TEXT,
    "member_id" UUID,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "email_status" "EmailStatus" NOT NULL DEFAULT 'NONE',
    "email_to" TEXT,
    "email_subject" TEXT,
    "email_text" TEXT,
    "email_attempts" INTEGER NOT NULL DEFAULT 0,
    "email_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_session_id_status_created_at_idx" ON "bookings"("session_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_member_id_status_idx" ON "bookings"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_email_status_created_at_idx" ON "notifications"("email_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_dedupe_key_key" ON "notifications"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

