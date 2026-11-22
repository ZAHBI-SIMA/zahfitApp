import { SpaceFrame } from "@/components/shell/space-frame";

// Voir app/admin/layout.tsx
export const instant = false;

export default function MemberLayout({ children }: LayoutProps<"/member">) {
  return <SpaceFrame space="member">{children}</SpaceFrame>;
}
