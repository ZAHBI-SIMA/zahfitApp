import type { Metadata } from "next";
import { SubscriptionsReport } from "@/components/subscriptions/subscriptions-report";

export const metadata: Metadata = { title: "Abonnements" };

export default function ReceptionSubscriptionsPage({ searchParams }: PageProps<"/reception/abonnements">) {
  return <SubscriptionsReport space="reception" searchParams={searchParams} />;
}
