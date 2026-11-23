"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  CalendarDays,
  ChartColumn,
  CreditCard,
  LayoutDashboard,
  QrCode,
  Settings,
  ShieldCheck,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { IconName, NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  building: Building2,
  users: Users,
  card: CreditCard,
  wallet: Wallet,
  qr: QrCode,
  calendar: CalendarDays,
  chart: ChartColumn,
  settings: Settings,
  shield: ShieldCheck,
  user: User,
  bell: Bell,
};

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        // Actif aussi sur les sous-pages (/admin/adherents/123), sauf pour l'accueil de l'espace.
        const isSpaceRoot = item.href.split("/").length === 2;
        const active = isSpaceRoot ? pathname === item.href : pathname.startsWith(item.href);
        const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";

        if (item.plannedSprint) {
          return (
            <li key={item.href}>
              <span
                aria-disabled
                className={cn(base, "cursor-not-allowed opacity-45")}
                title={`Disponible au Sprint ${item.plannedSprint}`}
              >
                <Icon className="size-4" aria-hidden />
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] uppercase tracking-wide">S{item.plannedSprint}</span>
              </span>
            </li>
          );
        }

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                base,
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
