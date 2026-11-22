import Link from "next/link";
import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-muted px-4 py-12">
      <Link href="/" aria-label="Accueil ZAHFIT" className="text-primary dark:text-foreground">
        <Logo />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
