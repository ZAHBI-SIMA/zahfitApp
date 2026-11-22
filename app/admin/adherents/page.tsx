import type { Metadata } from "next";
import { MembersIndex } from "@/components/members/member-pages";

export const metadata: Metadata = { title: "Adhérents" };

export default function AdminMembersPage({ searchParams }: PageProps<"/admin/adherents">) {
  return <MembersIndex space="admin" searchParams={searchParams} />;
}
