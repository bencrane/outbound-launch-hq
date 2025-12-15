"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Admin", href: "/admin" },
  { name: "Dashboard", href: "/" },
  { name: "Workflows", href: "/workflows" },
  { name: "Manage Workflows", href: "/admin/manage-workflows" },
  { name: "Outbound Launch Companies", href: "/companies" },
  { name: "Enrichment Eligible Companies", href: "/hq-target-companies", muted: true },
  { name: "Pipeline Status", href: "/admin/pipeline-status" },
  { name: "Enrichment Results", href: "/enrichment-results" },
  { name: "People", href: "/people" },
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
