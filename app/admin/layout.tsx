import { SpaceFrame } from "@/components/shell/space-frame";

// Entrée dans un espace protégé = vérification de session (et redirection
// éventuelle) : on n'exige pas une navigation « instantanée » depuis
// l'extérieur. Les navigations entre pages de l'espace restent validées.
export const instant = false;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <SpaceFrame space="admin">{children}</SpaceFrame>;
}
