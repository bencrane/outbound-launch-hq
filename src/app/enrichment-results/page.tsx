"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { DBDrivenEnrichmentWorkflow, Company } from "@/types/database";

interface TableInfo {
  table_name: string;
}

interface EnrichedCompany {
  company_id: string;
  company_domain: string | null;
  created_at: string;
}

export default function EnrichmentResultsPage() {
  const [workflows, setWorkflows] = useState<DBDrivenEnrichmentWorkflow[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [enrichedCompanyIds, setEnrichedCompanyIds] = useState<Set<string>>(new Set());
  const [enrichedData, setEnrichedData] = useState<EnrichedCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    async function fetchInitialData() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Supabase not configured");
        setLoading(false);
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      try {
        // Fetch workflows, tables, and companies in parallel
        const [workflowsRes, tablesRes, companiesRes] = await Promise.all([
          supabase.from("db_driven_enrichment_workflows").select("*"),
          supabase.rpc("get_public_tables"),
          supabase.from("companies").select("*"),
        ]);

        if (workflowsRes.error) {
          console.error("Workflows error:", workflowsRes.error);
        }
        if (tablesRes.error) {
          console.error("Tables error:", tablesRes.error);
        }
        if (companiesRes.error) {
          setError(companiesRes.error.message);
          setLoading(false);
          return;
        }

        setWorkflows(workflowsRes.data || []);
        setCompanies(companiesRes.data || []);

        // Filter tables to likely enrichment result tables
        const allTables = (tablesRes.data as TableInfo[])?.map((t) => t.table_name) || [];
        const enrichmentTables = allTables.filter(
          (t) =>
            t.includes("enrichment") ||
            t.includes("zenrows") ||
            t.includes("pdl") ||
            t.includes("scraped") ||
            t.includes("leadmagic")
        );
        setTables(enrichmentTables.length > 0 ? enrichmentTables : allTables);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    fetchInitialData();
  }, [supabaseUrl, supabaseAnonKey]);

  async function fetchEnrichmentResults() {
    if (!selectedTable || !supabaseUrl || !supabaseAnonKey) return;

    setLoadingResults(true);
    setError(null);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
      // Try to fetch company_id and company_domain from the selected table
      const { data, error: fetchError } = await supabase
        .from(selectedTable)
        .select("company_id, company_domain, created_at")
        .order("created_at", { ascending: false });

      if (fetchError) {
        // If company_id doesn't exist, try just company_domain
        const { data: domainData, error: domainError } = await supabase
          .from(selectedTable)
          .select("company_domain, created_at")
          .order("created_at", { ascending: false });

        if (domainError) {
          setError(`Could not query table: ${domainError.message}`);
          setLoadingResults(false);
          return;
        }

        // Match by domain
        const domains = new Set(
          (domainData || [])
            .map((d: { company_domain: string | null }) => d.company_domain)
            .filter(Boolean)
        );
        const matchedIds = new Set(
          companies
            .filter((c) => c.company_domain && domains.has(c.company_domain))
            .map((c) => c.id)
        );
        setEnrichedCompanyIds(matchedIds);
        setEnrichedData(
          (domainData || []).map((d: { company_domain: string | null; created_at: string }) => ({
            company_id: "",
            company_domain: d.company_domain,
            created_at: d.created_at,
          }))
        );
      } else {
        const ids = new Set((data || []).map((d: EnrichedCompany) => d.company_id).filter(Boolean));
        setEnrichedCompanyIds(ids);
        setEnrichedData(data || []);
      }

      setLoadingResults(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoadingResults(false);
    }
  }

  useEffect(() => {
    if (selectedTable) {
      fetchEnrichmentResults();
    } else {
      setEnrichedCompanyIds(new Set());
      setEnrichedData([]);
    }
  }, [selectedTable]);

  // Get enriched companies (those that exist in both companies table and result table)
  const enrichedCompanies = companies.filter(
    (c) =>
      enrichedCompanyIds.has(c.id) ||
      (c.company_domain &&
        enrichedData.some((e) => e.company_domain === c.company_domain))
  );

  // Get companies not yet enriched
  const notEnrichedCompanies = companies.filter(
    (c) =>
      !enrichedCompanyIds.has(c.id) &&
      (!c.company_domain ||
        !enrichedData.some((e) => e.company_domain === c.company_domain))
  );

  const selectedWorkflowData = workflows.find((w) => w.id === selectedWorkflow);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Results</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Enrichment Results</h1>
      <p className="text-gray-600 mb-8">
        View which companies have successfully completed enrichment workflows
      </p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Workflow Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enrichment Workflow
          </label>
          <select
            value={selectedWorkflow}
            onChange={(e) => setSelectedWorkflow(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">-- Select a workflow --</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.title}
              </option>
            ))}
          </select>
          {selectedWorkflowData && (
            <p className="mt-2 text-sm text-gray-500">
              {selectedWorkflowData.description || "No description"}
            </p>
          )}
        </div>

        {/* Result Table Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Result Table (where enriched data is stored)
          </label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">-- Select a table --</option>
            {tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Results Summary */}
      {selectedTable && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-3xl font-bold text-green-700">{enrichedCompanies.length}</div>
            <div className="text-sm text-green-600">Companies Enriched</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-3xl font-bold text-gray-700">{notEnrichedCompanies.length}</div>
            <div className="text-sm text-gray-600">Not Yet Enriched</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-700">{enrichedData.length}</div>
            <div className="text-sm text-blue-600">Records in Result Table</div>
          </div>
        </div>
      )}

      {/* Enriched Companies Table */}
      {selectedTable && !loadingResults && (
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h2 className="font-medium text-gray-900">
              Enriched Companies ({enrichedCompanies.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            {enrichedCompanies.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No companies have been enriched in this table yet.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Company Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Domain
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Enriched At
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {enrichedCompanies.map((company) => {
                    const enrichmentRecord = enrichedData.find(
                      (e) =>
                        e.company_id === company.id ||
                        e.company_domain === company.company_domain
                    );
                    return (
                      <tr key={company.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {company.company_name || "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {company.company_domain ? (
                            <a
                              href={`https://${company.company_domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {company.company_domain}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {enrichmentRecord?.created_at
                            ? new Date(enrichmentRecord.created_at).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {loadingResults && (
        <div className="text-center py-8 text-gray-600">Loading enrichment results...</div>
      )}
    </div>
  );
}
