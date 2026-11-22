import { SpaceFrame } from "@/components/shell/space-frame";

// Voir app/admin/layout.tsx
export const instant = false;

export default function SuperAdminLayout({ children }: LayoutProps<"/super-admin">) {
  return <SpaceFrame space="super-admin">{children}</SpaceFrame>;
}
