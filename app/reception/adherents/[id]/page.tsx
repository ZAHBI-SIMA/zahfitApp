import type { Metadata } from "next";
import { MemberDetail } from "@/components/members/member-pages";

export const metadata: Metadata = { title: "Fiche adhérent" };

export default function ReceptionMemberPage({ params, searchParams }: PageProps<"/reception/adherents/[id]">) {
  return <MemberDetail space="reception" params={params} searchParams={searchParams} />;
}
