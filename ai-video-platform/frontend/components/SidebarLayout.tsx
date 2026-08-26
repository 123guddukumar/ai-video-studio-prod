"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  FolderOpen,
  Plus,
  Clapperboard,
  Zap,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/projects", icon: FolderOpen, label: "Projects" },
  { href: "/projects/new", icon: Plus, label: "New Video" },
];

export default function SidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col"
        style={{
          width: 240,
          background: "linear-gradient(180deg, #0a1020 0%, #080c14 100%)",
          borderRight: "1px solid #1e2d45",
          padding: "24px 16px",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-3 mb-8 px-2">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              width: 36,
              height: 36,
            }}
          >
            <Clapperboard size={18} color="white" />
          </div>
          <div>
            <div className="font-bold text-sm text-white">AI VIDEO</div>
            <div style={{ fontSize: 10, color: "#4b5563", letterSpacing: "0.1em" }}>
              STUDIO
            </div>
          </div>
        </Link>

        {/* Nav items */}
        <nav className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const isActive =
              href === "/projects"
                ? pathname.startsWith("/projects") && pathname !== "/projects/new"
                : pathname === href || (href === "/projects/new" && pathname === "/projects/new");

            return (
              <Link
                key={href}
                href={href}
                className={clsx("nav-item", isActive && "active")}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="rounded-xl p-3 mt-4"
          style={{ background: "rgba(59,130,246,0.05)", border: "1px solid #1e2d45" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Zap size={12} style={{ color: "#3b82f6" }} />
            <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>DEV MODE</span>
          </div>
          <p style={{ fontSize: 11, color: "#4b5563" }}>Single-user · Local storage</p>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto" style={{ background: "#080c14" }}>
        {children}
      </main>
    </div>
  );
}
