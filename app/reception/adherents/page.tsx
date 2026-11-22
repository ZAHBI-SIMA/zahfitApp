import type { Metadata } from "next";
import { MembersIndex } from "@/components/members/member-pages";

export const metadata: Metadata = { title: "Adhérents" };

export default function ReceptionMembersPage({ searchParams }: PageProps<"/reception/adherents">) {
  return <MembersIndex space="reception" searchParams={searchParams} />;
}
