"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { DBDrivenEnrichmentWorkflow } from "@/types/database";

interface HQTargetCompany {
  id: string;
  company_name: string | null;
  company_domain: string | null;
}

interface EnrichmentLog {
  id: string;
  company_id: string;
  company_domain: string;
  workflow_id: string | null;
  workflow_slug: string;
  workflow_title: string | null;
  status: string;
  result_table: string | null;
  result_record_id: string | null;
  error_message: string | null;
  logged_at: string;
}

export default function CompanyEnrichmentStatusPage() {
  const [companies, setCompanies] = useState<HQTargetCompany[]>([]);
  const [workflows, setWorkflows] = useState<DBDrivenEnrichmentWorkflow[]>([]);
  const [enrichmentLogs, setEnrichmentLogs] = useState<EnrichmentLog[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gtmUrl = process.env.NEXT_PUBLIC_GTM_SUPABASE_URL;
  const gtmAnonKey = process.env.NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  // Fetch companies and workflows on mount
  useEffect(() => {
    async function fetchInitialData() {
      if (!gtmUrl || !gtmAnonKey || !supabaseUrl || !supabaseAnonKey) {
        setError("Database configuration missing");
        setLoading(false);
        return;
      }

      try {
        const gtmSupabase = createClient(gtmUrl, gtmAnonKey);
        const hqSupabase = createClient(supabaseUrl, supabaseAnonKey);

        // Fetch companies from GTM DB and workflows from HQ DB in parallel
        const [companiesRes, workflowsRes] = await Promise.all([
          gtmSupabase
            .from("hq_target_companies")
            .select("id, company_name, company_domain")
            .order("company_name", { ascending: true }),
          hqSupabase
            .from("db_driven_enrichment_workflows")
            .select("*")
            .eq("status", "active")
            .order("title", { ascending: true }),
        ]);

        if (companiesRes.error) {
          setError(`Error fetching companies: ${companiesRes.error.message}`);
          setLoading(false);
          return;
        }

        if (workflowsRes.error) {
          setError(`Error fetching workflows: ${workflowsRes.error.message}`);
          setLoading(false);
          return;
        }

        setCompanies(companiesRes.data || []);
        setWorkflows(workflowsRes.data || []);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    fetchInitialData();
  }, [gtmUrl, gtmAnonKey, supabaseUrl, supabaseAnonKey]);

  // Fetch enrichment logs when company is selected
  useEffect(() => {
    async function fetchEnrichmentLogs() {
      if (!selectedCompanyId || !supabaseUrl || !supabaseAnonKey) {
        setEnrichmentLogs([]);
        return;
      }

      setLoadingLogs(true);

      try {
        const hqSupabase = createClient(supabaseUrl, supabaseAnonKey);

        const { data, error: fetchError } = await hqSupabase
          .from("enrichment_logs")
          .select("*")
          .eq("company_id", selectedCompanyId)
          .order("logged_at", { ascending: false });

        if (fetchError) {
          console.error("Error fetching enrichment logs:", fetchError);
          // Table might not exist yet - that's OK
          setEnrichmentLogs([]);
        } else {
          setEnrichmentLogs(data || []);
        }
      } catch (err) {
        console.error("Error fetching enrichment logs:", err);
        setEnrichmentLogs([]);
      } finally {
        setLoadingLogs(false);
      }
    }

    fetchEnrichmentLogs();
  }, [selectedCompanyId, supabaseUrl, supabaseAnonKey]);

  // Create a map of workflow_slug -> logs for the selected company
  const workflowLogsMap = useMemo(() => {
    const map = new Map<string, EnrichmentLog[]>();
    for (const log of enrichmentLogs) {
      const existing = map.get(log.workflow_slug) || [];
      existing.push(log);
      map.set(log.workflow_slug, existing);
    }
    return map;
  }, [enrichmentLogs]);

  // Get selected company details
  const selectedCompany = useMemo(() => {
    return companies.find((c) => c.id === selectedCompanyId);
  }, [companies, selectedCompanyId]);

  // Group workflows by category
  const workflowsByCategory = useMemo(() => {
    const grouped = new Map<string, DBDrivenEnrichmentWorkflow[]>();
    for (const workflow of workflows) {
      const category = workflow.category || "Uncategorized";
      const existing = grouped.get(category) || [];
      existing.push(workflow);
      grouped.set(category, existing);
    }
    return grouped;
  }, [workflows]);

  // Calculate summary stats
  const stats = useMemo(() => {
    let completed = 0;
    let notStarted = 0;
    let failed = 0;

    for (const workflow of workflows) {
      const logs = workflowLogsMap.get(workflow.workflow_slug);
      if (!logs || logs.length === 0) {
        notStarted++;
      } else {
        const hasSuccess = logs.some((l) => l.status === "success");
        const hasFailed = logs.some((l) => l.status === "failed");
        if (hasSuccess) {
          completed++;
        } else if (hasFailed) {
          failed++;
        } else {
          notStarted++;
        }
      }
    }

    return { completed, notStarted, failed, total: workflows.length };
  }, [workflows, workflowLogsMap]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Company Enrichment Status
        </h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Company Enrichment Status
        </h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Company Enrichment Status
      </h1>
      <p className="text-gray-600 mb-6">
        View which enrichment workflows a company has been through
      </p>

      {/* Company Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select a Company
        </label>
        <select
          value={selectedCompanyId}
          onChange={(e) => setSelectedCompanyId(e.target.value)}
          className="block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">-- Select a company --</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.company_name || company.company_domain || company.id}
            </option>
          ))}
        </select>
      </div>

      {/* Selected Company Info */}
      {selectedCompany && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <h2 className="font-semibold text-gray-900">
            {selectedCompany.company_name || "Unnamed Company"}
          </h2>
          {selectedCompany.company_domain && (
            <p className="text-sm text-gray-600">
              Domain: {selectedCompany.company_domain}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">ID: {selectedCompany.id}</p>
        </div>
      )}

      {/* Summary Stats */}
      {selectedCompanyId && (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-700">
              {stats.completed}
            </div>
            <div className="text-sm text-green-600">Completed</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-700">
              {stats.notStarted}
            </div>
            <div className="text-sm text-gray-600">Not Started</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-700">{stats.failed}</div>
            <div className="text-sm text-red-600">Failed</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-700">{stats.total}</div>
            <div className="text-sm text-blue-600">Total Workflows</div>
          </div>
        </div>
      )}

      {/* Workflow List */}
      {selectedCompanyId && (
        <div className="space-y-6">
          {loadingLogs ? (
            <div className="text-gray-600">Loading enrichment history...</div>
          ) : (
            Array.from(workflowsByCategory.entries()).map(
              ([category, categoryWorkflows]) => (
                <div key={category}>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-200">
                    {category}
                  </h3>
                  <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                            Status
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Workflow
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Last Run
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Result Table
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Runs
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {categoryWorkflows.map((workflow) => {
                          const logs = workflowLogsMap.get(workflow.workflow_slug);
                          const latestLog = logs?.[0];
                          const hasSuccess = logs?.some(
                            (l) => l.status === "success"
                          );
                          const hasFailed =
                            !hasSuccess &&
                            logs?.some((l) => l.status === "failed");

                          return (
                            <tr key={workflow.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 whitespace-nowrap">
                                {hasSuccess ? (
                                  <span
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100"
                                    title="Completed successfully"
                                  >
                                    <svg
                                      className="w-4 h-4 text-green-600"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  </span>
                                ) : hasFailed ? (
                                  <span
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100"
                                    title="Failed"
                                  >
                                    <svg
                                      className="w-4 h-4 text-red-600"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                      />
                                    </svg>
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100"
                                    title="Not started"
                                  >
                                    <svg
                                      className="w-4 h-4 text-gray-400"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M20 12H4"
                                      />
                                    </svg>
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm font-medium text-gray-900">
                                  {workflow.title}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {workflow.workflow_slug}
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                {latestLog ? (
                                  <span
                                    title={new Date(
                                      latestLog.logged_at
                                    ).toLocaleString()}
                                  >
                                    {new Date(
                                      latestLog.logged_at
                                    ).toLocaleDateString()}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                {latestLog?.result_table || (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm">
                                {logs && logs.length > 0 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                    {logs.length}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">0</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )
          )}

          {workflows.length === 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-gray-600">No active enrichment workflows found.</p>
            </div>
          )}

          {enrichmentLogs.length === 0 && workflows.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800 text-sm">
                No enrichment logs found for this company. This could mean:
              </p>
              <ul className="text-yellow-700 text-sm mt-2 list-disc list-inside">
                <li>The company hasn&apos;t been through any enrichment workflows yet</li>
                <li>
                  The enrichment_logs table doesn&apos;t exist (needs to be created)
                </li>
                <li>
                  The global enrichment logger isn&apos;t configured for your workflows
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {!selectedCompanyId && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600">
            Select a company above to view its enrichment status.
          </p>
        </div>
      )}
    </div>
  );
}
