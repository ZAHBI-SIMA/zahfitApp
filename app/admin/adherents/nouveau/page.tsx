import type { Metadata } from "next";
import { NewMember } from "@/components/members/member-pages";

export const metadata: Metadata = { title: "Nouvel adhérent" };

export default function AdminNewMemberPage() {
  return <NewMember space="admin" />;
}
