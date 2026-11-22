import type { Metadata } from "next";
import { MemberDetail } from "@/components/members/member-pages";

export const metadata: Metadata = { title: "Fiche adhérent" };

export default function AdminMemberPage({ params, searchParams }: PageProps<"/admin/adherents/[id]">) {
  return <MemberDetail space="admin" params={params} searchParams={searchParams} />;
}
