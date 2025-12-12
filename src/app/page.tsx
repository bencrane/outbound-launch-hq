import { supabase } from "@/lib/supabase";

async function getTableCounts() {
  if (!supabase) {
    return {
      companies: 0,
      people: 0,
      pdlCompanies: 0,
      notConfigured: true,
      errors: [],
    };
  }

  const [companiesResult, peopleResult, pdlResult] = await Promise.all([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("people").select("*", { count: "exact", head: true }),
    supabase.from("pdl_companies").select("*", { count: "exact", head: true }),
  ]);

  return {
    companies: companiesResult.count ?? 0,
    people: peopleResult.count ?? 0,
    pdlCompanies: pdlResult.count ?? 0,
    notConfigured: false,
    errors: [companiesResult.error, peopleResult.error, pdlResult.error].filter(
      Boolean
    ),
  };
}

export default async function Dashboard() {
  const counts = await getTableCounts();
  const hasErrors = counts.errors.length > 0;
  const notConfigured = counts.notConfigured;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="mb-8">
        <div
          className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${
            notConfigured
              ? "bg-yellow-100 text-yellow-800"
              : hasErrors
                ? "bg-red-100 text-red-800"
                : "bg-green-100 text-green-800"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full mr-2 ${
              notConfigured
                ? "bg-yellow-500"
                : hasErrors
                  ? "bg-red-500"
                  : "bg-green-500"
            }`}
          ></span>
          {notConfigured
            ? "Supabase Not Configured"
            : hasErrors
              ? "Supabase Connection Error"
              : "Supabase Connected"}
        </div>
      </div>

      {notConfigured && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="text-yellow-800 font-medium">Setup Required</h3>
          <p className="mt-1 text-sm text-yellow-700">
            Copy <code className="bg-yellow-100 px-1 rounded">.env.local.example</code> to{" "}
            <code className="bg-yellow-100 px-1 rounded">.env.local</code> and add your Supabase credentials.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            Companies
          </h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {counts.companies.toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            People
          </h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {counts.people.toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            PDL Companies
          </h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {counts.pdlCompanies.toLocaleString()}
          </p>
        </div>
      </div>

      {hasErrors && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium">Connection Errors:</h3>
          <ul className="mt-2 text-sm text-red-700">
            {counts.errors.map((error, i) => (
              <li key={i}>{error?.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
