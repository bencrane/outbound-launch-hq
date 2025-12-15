"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

interface Company {
  id: string;
  company_name: string | null;
  company_domain: string | null;
}

interface Workflow {
  id: string;
  title: string | null;
  workflow_slug: string;
  overall_step_number: number | null;
  phase_type: string | null;
  provider: string | null;
  status: string | null;
}

interface EnrichmentLog {
  workflow_slug: string;
  status: string;
}

export default function PipelineStatusPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [logs, setLogs] = useState<EnrichmentLog[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const gtmUrl = process.env.NEXT_PUBLIC_GTM_SUPABASE_URL;
  const gtmKey = process.env.NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY;
  const hqUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const hqKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  // Fetch companies and workflows on mount
  useEffect(() => {
    async function fetchData() {
      if (!gtmUrl || !gtmKey || !hqUrl || !hqKey) {
        setLoading(false);
        return;
      }

      const gtm = createClient(gtmUrl, gtmKey);
      const hq = createClient(hqUrl, hqKey);

      const [companiesRes, workflowsRes] = await Promise.all([
        gtm.from("hq_target_companies").select("id, company_name, company_domain").order("company_name"),
        hq.from("db_driven_enrichment_workflows")
          .select("id, title, workflow_slug, overall_step_number, phase_type, provider, status")
          .not("overall_step_number", "is", null) // Only pipeline steps (those with step numbers)
          .neq("status", "deprecated") // Exclude deprecated workflows
          .order("overall_step_number", { ascending: true }),
      ]);

      setCompanies(companiesRes.data || []);
      setWorkflows(workflowsRes.data || []);
      setLoading(false);
    }

    fetchData();
  }, [gtmUrl, gtmKey, hqUrl, hqKey]);

  // Fetch logs when company selected
  useEffect(() => {
    async function fetchLogs() {
      if (!selectedCompanyId || !hqUrl || !hqKey) {
        setLogs([]);
        return;
      }

      setLoadingLogs(true);
      const hq = createClient(hqUrl, hqKey);

      const { data } = await hq
        .from("enrichment_logs")
        .select("workflow_slug, status")
        .eq("company_id", selectedCompanyId);

      setLogs(data || []);
      setLoadingLogs(false);
    }

    fetchLogs();
  }, [selectedCompanyId, hqUrl, hqKey]);

  // Map of workflow_slug -> has successful log
  const completedWorkflows = useMemo(() => {
    const completed = new Set<string>();
    for (const log of logs) {
      if (log.status === "success") {
        completed.add(log.workflow_slug);
      }
    }
    return completed;
  }, [logs]);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);

  // Stats
  const completedCount = workflows.filter((w) => completedWorkflows.has(w.workflow_slug)).length;
  const totalCount = workflows.length;

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Company Enrichment Pipeline</h1>
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Company Enrichment Pipeline</h1>
      <p className="text-gray-600 mb-6">Select a company to see which pipeline steps have been completed.</p>

      {/* Company Selector */}
      <select
        value={selectedCompanyId}
        onChange={(e) => setSelectedCompanyId(e.target.value)}
        className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg shadow-sm mb-6 text-sm"
      >
        <option value="">-- Select a company --</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.company_name || c.company_domain || c.id}
          </option>
        ))}
      </select>

      {/* Selected Company Info */}
      {selectedCompany && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
          <div className="font-semibold text-gray-900">{selectedCompany.company_name}</div>
          <div className="text-sm text-gray-500">{selectedCompany.company_domain}</div>
          <div className="mt-2 text-sm">
            <span className="font-medium text-green-600">{completedCount}</span>
            <span className="text-gray-500"> / {totalCount} steps completed</span>
          </div>
        </div>
      )}

      {/* Pipeline Steps */}
      {selectedCompanyId && (
        <div className="space-y-1">
          {loadingLogs ? (
            <p className="text-gray-500 py-4">Loading pipeline status...</p>
          ) : (
            workflows.map((workflow) => {
              const isCompleted = completedWorkflows.has(workflow.workflow_slug);

              return (
                <div
                  key={workflow.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                    isCompleted ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
                  }`}
                >
                  {/* Status Icon */}
                  <div className="flex-shrink-0">
                    {isCompleted ? (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="9" strokeWidth={2} />
                      </svg>
                    )}
                  </div>

                  {/* Step Number */}
                  <div className="w-8 text-center">
                    <span className={`text-sm font-mono ${isCompleted ? "text-green-700" : "text-gray-400"}`}>
                      {workflow.overall_step_number ?? "-"}
                    </span>
                  </div>

                  {/* Workflow Info */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${isCompleted ? "text-green-900" : "text-gray-700"}`}>
                      {workflow.title}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {workflow.phase_type} | {workflow.provider}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`flex-shrink-0 inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                      workflow.status === "active"
                        ? "bg-green-100 text-green-800"
                        : workflow.status === "deprecated"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {workflow.status}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {!selectedCompanyId && (
        <div className="text-center py-12 text-gray-500">
          Select a company above to view pipeline status
        </div>
      )}
    </div>
  );
}
