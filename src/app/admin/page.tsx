import Link from "next/link";

const adminCards = [
  {
    name: "Dashboard",
    description: "View database stats and connection status",
    href: "/",
  },
  {
    name: "Table Schema Viewer",
    description: "Explore database table schemas",
    href: "/admin/schema",
  },
  {
    name: "Supabase Edge Functions",
    description: "View all edge functions deployed in Supabase",
    href: "/admin/supabase-edge-functions",
  },
  {
    name: "Assign Edge Functions to Enrichment Workflow",
    description: "Link edge functions to enrichment workflows",
    href: "/admin/assign-edge-functions",
  },
  {
    name: "DB-Driven Enrichment Workflows",
    description: "Manage database-driven enrichment workflows",
    href: "/admin/db-enrichment-workflows",
  },
  {
    name: "View + Configure Enrichment Workflows",
    description: "View and edit all enrichment workflows",
    href: "/admin/view-enrichment-workflows",
  },
  {
    name: "Data Coverage",
    description: "See which companies have data in which tables",
    href: "/admin/data-coverage",
  },
  {
    name: "Archive",
    description: "Archived and deprecated tools",
    href: "/admin/archive",
  },
];

export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin</h1>
      <p className="text-gray-600 mb-8">System tools and configuration</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border border-gray-200 hover:border-gray-300"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {card.name}
            </h2>
            <p className="text-sm text-gray-600">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
