import { PageSkeleton } from "@/components/shell/page-header";

/**
 * Squelette commun des `loading.tsx` des espaces. Chaque dossier de page a
 * le sien : un segment imbriqué (`/member/qr`, `/admin/adherents/[id]`…)
 * a besoin de SA frontière <Suspense>, car celle du parent est déjà affichée
 * lors d'une navigation interne et React garderait l'ancien écran. Le menu
 * reste en place ; seul le contenu attend la vérification de session.
 */
export default function SpaceLoading() {
  return <PageSkeleton />;
}
