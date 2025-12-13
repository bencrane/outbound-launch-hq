import Link from "next/link";

const outboundLaunchCards = [
  {
    name: "Dashboard",
    description: "View database stats and connection status",
    href: "/",
  },
  {
    name: "Upload Companies",
    description: "Import companies from CSV",
    href: "/admin/upload-companies",
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

const gtmTeaserCards = [
  {
    name: "Table Schema Viewer",
    description: "Explore GTM database table schemas",
    href: "/admin/gtm/schema",
  },
  {
    name: "Upload Target Companies",
    description: "Import target companies from CSV",
    href: "/admin/gtm/upload-target-companies",
  },
  {
    name: "Upload Case Study URLs",
    description: "Import case study URLs for target companies",
    href: "/admin/gtm/upload-case-study-urls",
  },
];

function CardGrid({ cards }: { cards: typeof outboundLaunchCards }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card) => (
        <Link
          key={card.href + card.name}
          href={card.href}
          className={`block bg-white rounded-lg shadow p-5 hover:shadow-lg transition-shadow border border-gray-200 hover:border-gray-300 ${card.href === "#" ? "opacity-50 cursor-default" : ""}`}
        >
          <h3 className="text-base font-semibold text-gray-900 mb-1">
            {card.name}
          </h3>
          <p className="text-sm text-gray-600">{card.description}</p>
        </Link>
      ))}
    </div>
  );
}

export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin</h1>
      <p className="text-gray-600 mb-8">System tools and configuration</p>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">
          Outbound Launch HQ DB
        </h2>
        <CardGrid cards={outboundLaunchCards} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">
          GTM Teaser Demo DB
        </h2>
        <CardGrid cards={gtmTeaserCards} />
      </section>
    </div>
  );
}
