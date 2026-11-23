import type { Metadata } from "next";
import { SubscriptionsReport } from "@/components/subscriptions/subscriptions-report";

export const metadata: Metadata = { title: "Abonnements" };

export default function AdminSubscriptionsPage({ searchParams }: PageProps<"/admin/abonnements">) {
  return <SubscriptionsReport space="admin" searchParams={searchParams} />;
}
