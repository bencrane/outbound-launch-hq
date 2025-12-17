"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Admin", href: "/admin" },
  { name: "Dashboard", href: "/" },
  { name: "Companies", href: "/companies" },
  { name: "Manual GTM Enrichment Stages", href: "/manual-gtm-enrichment" },
  { name: "Pipeline Monitor", href: "/admin/pipeline-monitor" },
  { name: "End-to-End GTM Enrichment", href: "/send-to-pipeline" },
  { name: "Manage Workflows", href: "/admin/manage-workflows" },
  { name: "Pipeline Status", href: "/admin/pipeline-status" },
  { name: "Enrichment Results", href: "/enrichment-results" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen p-4">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Outbound HQ</h1>
      </div>
      <nav>
        <ul className="space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const isMuted = "muted" in item && item.muted;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block px-4 py-2 rounded transition-colors ${
                    isActive
                      ? "bg-gray-700 text-white"
                      : isMuted
                      ? "text-gray-500 hover:bg-gray-800 hover:text-gray-400"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
