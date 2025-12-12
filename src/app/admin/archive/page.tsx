import Link from "next/link";

const archivedCards = [
  {
    name: "Old Send for Enrichment Paths",
    description: "Configure n8n workflow endpoints for data enrichment",
    href: "/admin/enrichment-workflows",
  },
];

export default function ArchivePage() {
  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin"
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to Admin
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Archive</h1>
      <p className="text-gray-600 mb-8">Archived and deprecated tools</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {archivedCards.map((card) => (
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
