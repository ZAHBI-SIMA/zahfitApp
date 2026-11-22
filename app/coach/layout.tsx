import { SpaceFrame } from "@/components/shell/space-frame";

// Voir app/admin/layout.tsx
export const instant = false;

export default function CoachLayout({ children }: LayoutProps<"/coach">) {
  return <SpaceFrame space="coach">{children}</SpaceFrame>;
}
