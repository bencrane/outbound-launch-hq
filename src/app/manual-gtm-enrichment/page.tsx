"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { Company } from "@/types/database";

// Workflow steps for the GTM enrichment pipeline
interface WorkflowStep {
  id: string;
  step: number;
  slug: string;
  title: string;
  edge_function_name?: string;
}

type SortField = "company_name" | "company_domain" | "created_at";
type SortDirection = "asc" | "desc";

interface CompanyWithProgress extends Company {
  last_completed_step?: number;
  last_completed_workflow_slug?: string;
  last_attempted_at?: string;
}

export default function ManualGTMEnrichmentPage() {
  const [companies, setCompanies] = useState<CompanyWithProgress[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [attemptsMap, setAttemptsMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null); // null = show all
  const [stepDataMap, setStepDataMap] = useState<Map<string, { hasRequiredData: boolean }>>(new Map());
  const [hideNoData, setHideNoData] = useState(false);
  const [isTestMode, setIsTestMode] = useState(() => {
    // Load from localStorage, default to true (test mode) if not set
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("n8n_test_mode");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  // Persist test mode toggle to localStorage
  useEffect(() => {
    localStorage.setItem("n8n_test_mode", String(isTestMode));
  }, [isTestMode]);

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const workspaceUrl = process.env.NEXT_PUBLIC_GTM_TEASER_DB_URL;
  const workspaceAnonKey = process.env.NEXT_PUBLIC_GTM_TEASER_DB_ANON_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  useEffect(() => {
    async function fetchData() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Supabase not configured");
        setLoading(false);
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      // Fetch workflow steps
      const { data: workflows, error: workflowError } = await supabase
        .from("db_driven_enrichment_workflows")
        .select("id, overall_step_number, workflow_slug, title, destination_config")
        .not("overall_step_number", "is", null)
        .neq("status", "deprecated")
        .order("overall_step_number", { ascending: true });

      if (workflowError) {
        console.error("Error fetching workflows:", workflowError);
      } else {
        setWorkflowSteps(
          (workflows || []).map((w) => ({
            id: w.id,
            step: w.overall_step_number,
            slug: w.workflow_slug,
            title: w.title,
            edge_function_name: w.destination_config?.edge_function_name,
          }))
        );
      }

      // Fetch companies enrolled in Case Study Champions play
      const { data: enrollmentsData, error: enrollmentsError } = await supabase
        .from("company_enrollments")
        .select("company_id")
        .eq("play_name", "case-study-champions")
        .eq("status", "active");

      if (enrollmentsError) {
        console.error("Error fetching enrollments:", enrollmentsError);
      }

      const enrolledCompanyIds = new Set(
        (enrollmentsData || []).map((e) => e.company_id)
      );

      // Fetch all companies, then filter to enrolled ones
      const { data: companiesData, error: companiesError } = await supabase
        .from("companies")
        .select("*");

      if (companiesError) {
        setError(companiesError.message);
        setLoading(false);
        return;
      }

      // Filter to only enrolled companies
      const enrolledCompanies = (companiesData || []).filter((c) =>
        enrolledCompanyIds.has(c.id)
      );

      // Fetch step completions
      const { data: completionsData, error: completionsError } = await supabase
        .from("company_play_step_completions")
        .select("company_id, step_number")
        .eq("play_name", "case-study-champions");

      if (completionsError) {
        console.error("Error fetching completions:", completionsError);
      }

      // Build map of company_id -> max completed step
      const completionsMap = new Map<string, number>();
      (completionsData || []).forEach((c) => {
        const current = completionsMap.get(c.company_id) || 0;
        if (c.step_number > current) {
          completionsMap.set(c.company_id, c.step_number);
        }
      });

      // Fetch last attempted from enrichment_results_log
      const { data: attemptsData, error: attemptsError } = await supabase
        .from("enrichment_results_log")
        .select("company_id, step_number, stored_at")
        .eq("play_name", "case-study-champions")
        .order("stored_at", { ascending: false });

      if (attemptsError) {
        console.error("Error fetching attempts:", attemptsError);
      }

      // Build map of company_id+step -> last attempted (we'll use current selected step)
      const attemptsMapLocal = new Map<string, string>();
      (attemptsData || []).forEach((a) => {
        const key = `${a.company_id}-${a.step_number}`;
        if (!attemptsMapLocal.has(key)) {
          attemptsMapLocal.set(key, a.stored_at);
        }
      });
      setAttemptsMap(attemptsMapLocal);

      // Merge companies with their progress
      const companiesWithProgress: CompanyWithProgress[] = enrolledCompanies.map((c) => {
        const lastCompletedStep = completionsMap.get(c.id) || 0;
        return {
          ...c,
          last_completed_step: lastCompletedStep,
        };
      });

      setCompanies(companiesWithProgress);
      setLoading(false);
    }

    fetchData();
  }, [supabaseUrl, supabaseAnonKey]);

  // Fetch step-specific data (e.g., case_studies_page_url for Step 4)
  useEffect(() => {
    async function fetchStepData() {
      if (!workspaceUrl || !workspaceAnonKey) return;

      // Step 4 needs case_studies_page_url from company_case_studies_page
      if (selectedStep === 4) {
        const workspace = createClient(workspaceUrl, workspaceAnonKey);
        const { data, error } = await workspace
          .from("company_case_studies_page")
          .select("company_domain, case_studies_page_url");

        if (error) {
          console.error("Error fetching step data:", error);
          return;
        }

        const newMap = new Map<string, { hasRequiredData: boolean }>();
        (data || []).forEach((row) => {
          newMap.set(row.company_domain, {
            hasRequiredData: row.case_studies_page_url !== null && row.case_studies_page_url !== ""
          });
        });
        setStepDataMap(newMap);
      } else {
        setStepDataMap(new Map());
      }
    }

    fetchStepData();
  }, [selectedStep, workspaceUrl, workspaceAnonKey]);

  // Filter and sort companies
  const sortedCompanies = useMemo(() => {
    // Filter by selected step (show companies ready for that step = completed previous step)
    let filtered = [...companies];
    if (selectedStep !== null) {
      // Companies ready for step N have last_completed_step = N-1
      const requiredPriorStep = selectedStep - 1;
      filtered = filtered.filter((c) => (c.last_completed_step ?? 0) === requiredPriorStep);

      // Filter out companies without required data if hideNoData is enabled
      if (hideNoData && stepDataMap.size > 0) {
        filtered = filtered.filter((c) => {
          const stepData = stepDataMap.get(c.company_domain || "");
          return stepData?.hasRequiredData !== false;
        });
      }
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === null || aVal === undefined) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === "asc" ? -1 : 1;

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [companies, sortField, sortDirection, selectedStep, hideNoData, stepDataMap]);

  // Count companies per step (for pill badges)
  const stepCounts = useMemo(() => {
    const counts: Record<number, number> = { 0: 0 }; // 0 = show all
    workflowSteps.forEach((ws) => {
      counts[ws.step] = 0;
    });

    companies.forEach((c) => {
      const lastStep = c.last_completed_step ?? 0;
      // Company is ready for step N if they completed step N-1
      workflowSteps.forEach((ws) => {
        if (lastStep === ws.step - 1) {
          counts[ws.step] = (counts[ws.step] || 0) + 1;
        }
      });
    });

    counts[0] = companies.length; // Show all count
    return counts;
  }, [companies, workflowSteps]);

  // Count companies with/without required data for current step
  const noDataCount = useMemo(() => {
    if (selectedStep !== 4 || stepDataMap.size === 0) return 0;

    const requiredPriorStep = selectedStep - 1;
    const readyCompanies = companies.filter((c) => (c.last_completed_step ?? 0) === requiredPriorStep);

    return readyCompanies.filter((c) => {
      const stepData = stepDataMap.get(c.company_domain || "");
      return stepData?.hasRequiredData === false;
    }).length;
  }, [selectedStep, companies, stepDataMap]);

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

  const handleConfirmSend = async () => {
    if (!supabaseAnonKey || selectedStep === null) return;

    const selectedCompanies = companies.filter((c) => selectedIds.has(c.id));

    // Get the workflow for this step
    const workflow = workflowSteps.find(ws => ws.step === selectedStep);
    if (!workflow) {
      setSendResult({
        success: false,
        message: `No workflow found for step ${selectedStep}.`
      });
      return;
    }

    // Get the edge function from the workflow config (DB is source of truth)
    const edgeFunctionName = workflow.edge_function_name;
    if (!edgeFunctionName) {
      setSendResult({
        success: false,
        message: `No edge_function_name configured in destination_config for step ${selectedStep}. Update the workflow config in the database.`
      });
      return;
    }

    const edgeFunctionUrl = `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/${edgeFunctionName}`;

    setSending(true);
    setShowConfirm(false);
    setSendResult(null);

    try {
      const response = await fetch(edgeFunctionUrl, {
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
          })),
          play_name: "case-study-champions",
          step_number: selectedStep,
          workflow: {
            id: workflow.id,
            slug: workflow.slug,
            title: workflow.title,
          },
          use_test_endpoint: isTestMode,
        }),
      });

      const responseData = await response.json();

      if (response.ok) {
        setSendResult({
          success: true,
          message: JSON.stringify(responseData, null, 2)
        });
        setSelectedIds(new Set());
        // Refresh data to show updated progress
        window.location.reload();
      } else {
        setSendResult({
          success: false,
          message: JSON.stringify(responseData, null, 2)
        });
      }
    } catch (err) {
      let errorMessage = "Unknown error";
      if (err instanceof Error) {
        errorMessage = err.message;
        if (err.name === "TypeError" && err.message === "Load failed") {
          errorMessage = `Network error: Unable to reach ${edgeFunctionName}.\n\nURL: ${edgeFunctionUrl}`;
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Manual GTM Enrichment Stages</h1>
        <p className="text-gray-600">Loading companies...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Manual GTM Enrichment Stages</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Manual GTM Enrichment Stages</h1>
        <div className="flex items-center gap-4">
          {/* Test/Prod Mode Toggle */}
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${isTestMode ? "text-amber-600" : "text-gray-400"}`}>
              Test
            </span>
            <button
              onClick={() => setIsTestMode(!isTestMode)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isTestMode ? "bg-amber-500" : "bg-green-500"
              }`}
              title={isTestMode ? "Test mode: Using webhook-test endpoint" : "Prod mode: Using webhook endpoint"}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isTestMode ? "translate-x-1" : "translate-x-6"
                }`}
              />
            </button>
            <span className={`text-sm font-medium ${!isTestMode ? "text-green-600" : "text-gray-400"}`}>
              Prod
            </span>
          </div>
          <span className="text-sm text-gray-500">
            {sortedCompanies.length} of {companies.length} record{companies.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Showing companies enrolled in <span className="font-medium text-purple-600">Case Study Champions</span>
      </p>

      {/* Step Filter Pills */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {/* Show All pill */}
          <button
            onClick={() => setSelectedStep(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedStep === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Show All
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
              selectedStep === null ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600"
            }`}>
              {stepCounts[0] || 0}
            </span>
          </button>

          {/* Step pills */}
          {workflowSteps.map((ws) => (
            <button
              key={ws.step}
              onClick={() => setSelectedStep(ws.step)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedStep === ws.step
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              title={ws.title}
            >
              {ws.step}. {ws.title.length > 20 ? ws.title.substring(0, 20) + "..." : ws.title}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                selectedStep === ws.step ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600"
              }`}>
                {stepCounts[ws.step] || 0}
              </span>
            </button>
          ))}
        </div>
        {selectedStep !== null && (
          <div className="mt-2 flex items-center gap-4">
            <p className="text-sm text-gray-500">
              Showing companies ready for step {selectedStep} (completed step {selectedStep - 1})
            </p>
            {selectedStep === 4 && noDataCount > 0 && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideNoData}
                  onChange={(e) => setHideNoData(e.target.checked)}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <span className="text-gray-600">
                  Hide {noDataCount} with no URL
                </span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* Action Bar - only show when a specific step is selected */}
      {selectedIds.size > 0 && selectedStep !== null && (
        <div className="mb-4 flex items-center gap-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="relative">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={sending}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "Sending..." : `Send to Step ${selectedStep}`}
            </button>

            {showConfirm && (
              <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-4">
                <p className="text-sm text-gray-700 mb-2">
                  Send {selectedIds.size} company{selectedIds.size !== 1 ? "ies" : ""} to{" "}
                  <span className="font-medium">
                    Step {selectedStep}: {workflowSteps.find(ws => ws.step === selectedStep)?.title}
                  </span>
                  ?
                </p>
                <p className={`text-xs mb-3 px-2 py-1 rounded ${
                  isTestMode
                    ? "bg-amber-100 text-amber-700"
                    : "bg-green-100 text-green-700"
                }`}>
                  {isTestMode ? "🧪 Using TEST endpoint (webhook-test)" : "🚀 Using PROD endpoint (webhook)"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmSend}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
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

      {/* Show message when items selected but Show All is active */}
      {selectedIds.size > 0 && selectedStep === null && (
        <div className="mb-4 flex items-center gap-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <span className="text-sm text-gray-600">
            {selectedIds.size} selected — Select a specific step to send to enrichment
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-500 hover:text-gray-700"
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
          <p className="text-gray-600">
            {companies.length === 0
              ? "No companies enrolled in Case Study Champions. Go to Companies → Mark Eligible For → Case Study Champions to enroll companies."
              : "No companies ready for this step."}
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
                  <th
                    onClick={() => handleSort("created_at")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Created
                    <SortIcon field="created_at" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Step
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Attempted
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
                      <span className="flex items-center gap-2">
                        {company.company_name || "—"}
                        {selectedStep === 4 && stepDataMap.size > 0 && (() => {
                          const stepData = stepDataMap.get(company.company_domain || "");
                          if (stepData?.hasRequiredData === false) {
                            return (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                                No URL
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </span>
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(company.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {company.last_completed_step === 0 ? (
                        <span className="text-gray-400">Not started</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Step {company.last_completed_step}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {selectedStep !== null ? (
                        (() => {
                          const attemptKey = `${company.id}-${selectedStep}`;
                          const lastAttempt = attemptsMap.get(attemptKey);
                          if (lastAttempt) {
                            return new Date(lastAttempt).toLocaleString();
                          }
                          return <span className="text-gray-400">—</span>;
                        })()
                      ) : (
                        <span className="text-gray-400">Select step</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Click outside to close confirm */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
