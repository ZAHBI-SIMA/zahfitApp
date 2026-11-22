import { SpaceFrame } from "@/components/shell/space-frame";

// Voir app/admin/layout.tsx
export const instant = false;

export default function ReceptionLayout({ children }: LayoutProps<"/reception">) {
  return <SpaceFrame space="reception">{children}</SpaceFrame>;
}
