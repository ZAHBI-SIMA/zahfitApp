import type { Metadata } from "next";
import { NewMember } from "@/components/members/member-pages";

export const metadata: Metadata = { title: "Nouvel adhérent" };

export default function ReceptionNewMemberPage() {
  return <NewMember space="reception" />;
}
