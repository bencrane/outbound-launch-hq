"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { DBDrivenEnrichmentWorkflow } from "@/types/database";

interface HQTargetCompany {
  id: string;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  ai_determined_case_studies_main_page_url: string | null;
  created_at: string;
}

type SortField = "company_name" | "company_domain" | "created_at";
type SortDirection = "asc" | "desc";

export default function HQTargetCompaniesPage() {
  const [companies, setCompanies] = useState<HQTargetCompany[]>([]);
  const [workflows, setWorkflows] = useState<DBDrivenEnrichmentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEnrichmentMenu, setShowEnrichmentMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  const gtmUrl = process.env.NEXT_PUBLIC_GTM_SUPABASE_URL;
  const gtmAnonKey = process.env.NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  useEffect(() => {
    async function fetchData() {
      if (!gtmUrl || !gtmAnonKey) {
        setError("GTM Teaser DB not configured");
        setLoading(false);
        return;
      }

      const gtmSupabase = createClient(gtmUrl, gtmAnonKey);

      // Fetch companies from GTM DB
      const { data: companiesData, error: fetchError } = await gtmSupabase
        .from("hq_target_companies")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setCompanies(companiesData || []);

      // Fetch workflows from Outbound Launch DB (only active GTM Teaser HQ workflows)
      if (supabaseUrl && supabaseAnonKey) {
        const outboundSupabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: workflowsData } = await outboundSupabase
          .from("db_driven_enrichment_workflows")
          .select("*")
          .eq("status", "active")
          .eq("category", "GTM Teaser HQ");
        setWorkflows(workflowsData || []);
      }

      setLoading(false);
    }

    fetchData();
  }, [gtmUrl, gtmAnonKey, supabaseUrl, supabaseAnonKey]);

  const sortedCompanies = useMemo(() => {
    const sorted = [...companies];

    sorted.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === null || aVal === undefined) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === "asc" ? -1 : 1;

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [companies, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === sortedCompanies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedCompanies.map((c) => c.id)));
    }
  };

  const handleSelectRow = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSendToEnrichment = async (workflow: DBDrivenEnrichmentWorkflow) => {
    const dispatcherUrl = workflow.dispatcher_function_url;

    if (!dispatcherUrl) {
      setSendResult({ success: false, message: "No dispatcher function URL configured for this workflow" });
      setShowEnrichmentMenu(false);
      return;
    }

    const selectedCompanies = companies.filter((c) => selectedIds.has(c.id));

    setSending(true);
    setShowEnrichmentMenu(false);
    setSendResult(null);

    try {
      const response = await fetch(dispatcherUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          companies: selectedCompanies.map((c) => ({
            company_id: c.id,
            company_name: c.company_name,
            company_domain: c.company_domain,
            company_linkedin_url: c.company_linkedin_url,
          })),
          workflow: {
            id: workflow.id,
            title: workflow.title,
            workflow_slug: workflow.workflow_slug,
            destination_type: workflow.destination_type,
            destination_endpoint_url: workflow.destination_endpoint_url,
            receiver_function_url: workflow.receiver_function_url,
          },
        }),
      });

      if (response.ok) {
        setSendResult({
          success: true,
          message: `Sent ${selectedCompanies.length} companies to "${workflow.title}" via dispatcher`
        });
        setSelectedIds(new Set());
      } else {
        const errorText = await response.text();
        let errorDetails = `Status: ${response.status} ${response.statusText}`;
        if (errorText) {
          try {
            const errorJson = JSON.parse(errorText);
            errorDetails += `\n\nResponse: ${JSON.stringify(errorJson, null, 2)}`;
          } catch {
            errorDetails += `\n\nResponse: ${errorText}`;
          }
        }
        errorDetails += `\n\nURL: ${dispatcherUrl}`;
        setSendResult({ success: false, message: errorDetails });
      }
    } catch (err) {
      let errorMessage = "Unknown error";
      if (err instanceof Error) {
        errorMessage = err.message;
        if (err.name === "TypeError" && err.message === "Load failed") {
          errorMessage = `Network error: Unable to reach the dispatcher function.\n\nPossible causes:\n• The edge function may not be deployed\n• CORS may be blocking the request\n• The function URL may be incorrect\n\nURL: ${dispatcherUrl}`;
        } else if (err.stack) {
          errorMessage += `\n\nStack trace:\n${err.stack}`;
        }
      }
      setSendResult({ success: false, message: errorMessage });
    } finally {
      setSending(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-gray-400 ml-1">↕</span>;
    }
    return (
      <span className="text-blue-600 ml-1">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const isAllSelected = sortedCompanies.length > 0 && selectedIds.size === sortedCompanies.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < sortedCompanies.length;

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Eligible Companies</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Eligible Companies</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enrichment Eligible Companies</h1>
          <p className="text-sm text-gray-500 mt-1">Companies ready for case study enrichment</p>
        </div>
        <span className="text-sm text-gray-500">
          {companies.length} record{companies.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Action Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="relative">
            <button
              onClick={() => setShowEnrichmentMenu(!showEnrichmentMenu)}
              disabled={sending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "Sending..." : "Send to Enrichment"}
            </button>

            {showEnrichmentMenu && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                {workflows.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">
                    No active enrichment workflows.
                    <br />
                    <span className="text-xs">Add workflows in Admin → DB-Driven Enrichment Workflows</span>
                  </div>
                ) : (
                  <div className="py-2">
                    {workflows.map((workflow) => (
                      <div key={workflow.id} className="px-4 py-2 hover:bg-gray-50">
                        <div className="font-medium text-sm text-gray-900">{workflow.title}</div>
                        {workflow.description && (
                          <div className="text-xs text-gray-500 mb-2">{workflow.description}</div>
                        )}
                        {!workflow.dispatcher_function_url ? (
                          <div className="text-xs text-red-500">No dispatcher function assigned</div>
                        ) : (
                          <button
                            onClick={() => handleSendToEnrichment(workflow)}
                            className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                          >
                            Send
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Result message */}
      {sendResult && (
        <div className={`mb-4 p-3 rounded-lg ${sendResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          <pre className={`whitespace-pre-wrap text-sm font-mono ${sendResult.success ? "text-green-800" : "text-red-800"}`}>
            {sendResult.message}
          </pre>
          <button
            onClick={() => setSendResult(null)}
            className="text-sm underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {sortedCompanies.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600">No target companies found.</p>
          <p className="text-sm text-gray-500 mt-2">
            Upload companies via Admin → GTM Teaser Demo DB → Upload Target Companies
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = isSomeSelected;
                      }}
                      onChange={handleSelectAll}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSort("company_name")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Company Name
                    <SortIcon field="company_name" />
                  </th>
                  <th
                    onClick={() => handleSort("company_domain")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Domain
                    <SortIcon field="company_domain" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    LinkedIn
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Case Studies URL
                  </th>
                  <th
                    onClick={() => handleSort("created_at")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Created
                    <SortIcon field="created_at" />
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedCompanies.map((company) => (
                  <tr
                    key={company.id}
                    className={`hover:bg-gray-50 ${selectedIds.has(company.id) ? "bg-blue-50" : ""}`}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(company.id)}
                        onChange={() => handleSelectRow(company.id)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded cursor-pointer"
                      />
                    </td>
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
                      {company.company_linkedin_url ? (
                        <a
                          href={company.company_linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                      {company.ai_determined_case_studies_main_page_url ? (
                        <a
                          href={company.ai_determined_case_studies_main_page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {company.ai_determined_case_studies_main_page_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(company.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {showEnrichmentMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowEnrichmentMenu(false)}
        />
      )}
    </div>
  );
}
