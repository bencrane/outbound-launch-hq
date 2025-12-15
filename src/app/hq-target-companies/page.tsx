"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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

interface CompanyWorkflowStatus {
  company_id: string;
  last_completed_step: number;
  workflow_slug: string | null;
}

interface PipelineWorkflow {
  overall_step_number: number;
  title: string | null;
  workflow_slug: string;
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

  // Eligibility filter state
  const [selectedWorkflowFilter, setSelectedWorkflowFilter] = useState<string | null>(null);
  const [eligibilityCounts, setEligibilityCounts] = useState<Record<string, number>>({});
  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [showOnlyEligible, setShowOnlyEligible] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(["GTM Teaser HQ"]));
  const enrichmentMenuRef = useRef<HTMLDivElement>(null);

  // Pipeline step filter state
  const [companyStatuses, setCompanyStatuses] = useState<CompanyWorkflowStatus[]>([]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineWorkflow[]>([]);
  const [selectedStepFilter, setSelectedStepFilter] = useState<number | null>(null); // null = show all, 0 = no steps completed

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

      // Fetch all active workflows from Outbound Launch DB
      if (supabaseUrl && supabaseAnonKey) {
        const outboundSupabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: workflowsData } = await outboundSupabase
          .from("db_driven_enrichment_workflows")
          .select("*")
          .eq("status", "active");
        setWorkflows(workflowsData || []);

        // Fetch pipeline steps (workflows with step numbers)
        const { data: stepsData } = await outboundSupabase
          .from("db_driven_enrichment_workflows")
          .select("overall_step_number, title, workflow_slug")
          .not("overall_step_number", "is", null)
          .neq("status", "deprecated")
          .order("overall_step_number", { ascending: true });
        setPipelineSteps((stepsData || []) as PipelineWorkflow[]);

        // Fetch company workflow statuses
        const { data: statusData } = await outboundSupabase
          .from("company_workflow_status")
          .select("company_id, last_completed_step, workflow_slug");
        setCompanyStatuses((statusData || []) as CompanyWorkflowStatus[]);
      }

      setLoading(false);
    }

    fetchData();
  }, [gtmUrl, gtmAnonKey, supabaseUrl, supabaseAnonKey]);

  // Fetch eligibility counts when workflow filter changes
  const fetchEligibilityCounts = useCallback(async (workflow: DBDrivenEnrichmentWorkflow) => {
    if (!gtmUrl || !gtmAnonKey) return;
    if (!workflow.source_table_name || !workflow.source_table_company_fk) {
      console.warn("Workflow missing source_table_name or source_table_company_fk");
      return;
    }

    setLoadingEligibility(true);
    const gtmSupabase = createClient(gtmUrl, gtmAnonKey);

    try {
      // Get all company IDs that have records in the source table
      const { data, error: fetchError } = await gtmSupabase
        .from(workflow.source_table_name)
        .select(workflow.source_table_company_fk);

      if (fetchError) {
        console.error("Error fetching eligibility:", fetchError);
        setLoadingEligibility(false);
        return;
      }

      // Count records per company
      const counts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const row of data) {
          const rowObj = row as unknown as Record<string, unknown>;
          const companyId = rowObj[workflow.source_table_company_fk as string] as string | undefined;
          if (companyId) {
            counts[companyId] = (counts[companyId] || 0) + 1;
          }
        }
      }

      setEligibilityCounts(counts);
    } catch (err) {
      console.error("Error fetching eligibility counts:", err);
    } finally {
      setLoadingEligibility(false);
    }
  }, [gtmUrl, gtmAnonKey]);

  // Trigger eligibility fetch when workflow filter changes
  useEffect(() => {
    if (selectedWorkflowFilter) {
      const workflow = workflows.find(w => w.id === selectedWorkflowFilter);
      if (workflow) {
        fetchEligibilityCounts(workflow);
      }
    } else {
      setEligibilityCounts({});
      setShowOnlyEligible(false);
    }
  }, [selectedWorkflowFilter, workflows, fetchEligibilityCounts]);

  // Close enrichment menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (enrichmentMenuRef.current && !enrichmentMenuRef.current.contains(event.target as Node)) {
        setShowEnrichmentMenu(false);
      }
    }
    if (showEnrichmentMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showEnrichmentMenu]);

  // Map company_id to last_completed_step for quick lookup
  const companyStepMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const status of companyStatuses) {
      map.set(status.company_id, status.last_completed_step);
    }
    return map;
  }, [companyStatuses]);

  const sortedCompanies = useMemo(() => {
    let filtered = [...companies];

    // Apply pipeline step filter
    if (selectedStepFilter !== null) {
      if (selectedStepFilter === 0) {
        // Show companies with NO completed steps
        filtered = filtered.filter(c => !companyStepMap.has(c.id));
      } else {
        // Show companies where last_completed_step equals the selected step
        filtered = filtered.filter(c => companyStepMap.get(c.id) === selectedStepFilter);
      }
    }

    // Apply eligibility filter if enabled
    if (showOnlyEligible && selectedWorkflowFilter) {
      filtered = filtered.filter(c => (eligibilityCounts[c.id] || 0) > 0);
    }

    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === null || aVal === undefined) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === "asc" ? -1 : 1;

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [companies, sortField, sortDirection, showOnlyEligible, selectedWorkflowFilter, eligibilityCounts, selectedStepFilter, companyStepMap]);

  // Count eligible companies
  const eligibleCount = useMemo(() => {
    if (!selectedWorkflowFilter) return 0;
    return companies.filter(c => (eligibilityCounts[c.id] || 0) > 0).length;
  }, [companies, eligibilityCounts, selectedWorkflowFilter]);

  // Get unique categories from workflows
  const categories = useMemo(() => {
    const cats = new Set<string>();
    workflows.forEach(w => {
      if (w.category) cats.add(w.category);
    });
    return Array.from(cats).sort();
  }, [workflows]);

  // Filter workflows by selected categories
  const filteredWorkflows = useMemo(() => {
    if (selectedCategories.size === 0) return workflows;
    return workflows.filter(w => w.category && selectedCategories.has(w.category));
  }, [workflows, selectedCategories]);

  // Toggle category selection
  const toggleCategory = (category: string) => {
    const newCategories = new Set(selectedCategories);
    if (newCategories.has(category)) {
      newCategories.delete(category);
    } else {
      newCategories.add(category);
    }
    setSelectedCategories(newCategories);
    // Clear workflow filter if the selected workflow is no longer visible
    if (selectedWorkflowFilter) {
      const workflow = workflows.find(w => w.id === selectedWorkflowFilter);
      if (workflow && workflow.category && !newCategories.has(workflow.category)) {
        setSelectedWorkflowFilter(null);
        setShowOnlyEligible(false);
      }
    }
  };

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
    // Master orchestrator URL - all workflows route through this single endpoint
    const masterOrchestratorUrl = "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_orchestrator_v1";

    const selectedCompanies = companies.filter((c) => selectedIds.has(c.id));

    setSending(true);
    setShowEnrichmentMenu(false);
    setSendResult(null);

    try {
      const response = await fetch(masterOrchestratorUrl, {
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
          workflow: {
            id: workflow.id,
          },
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setSendResult({
          success: true,
          message: `Dispatched ${result.success_count || 0} of ${result.records_found || 0} records to "${workflow.title}"\n\nSource: ${result.source_table || "N/A"}`
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
        errorDetails += `\n\nURL: ${masterOrchestratorUrl}`;
        setSendResult({ success: false, message: errorDetails });
      }
    } catch (err) {
      let errorMessage = "Unknown error";
      if (err instanceof Error) {
        errorMessage = err.message;
        if (err.name === "TypeError" && err.message === "Load failed") {
          errorMessage = `Network error: Unable to reach the master orchestrator.\n\nPossible causes:\n• The edge function may not be deployed\n• CORS may be blocking the request\n\nURL: ${masterOrchestratorUrl}`;
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">End-to-End GTM Enrichment</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">End-to-End GTM Enrichment</h1>
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
          <h1 className="text-2xl font-bold text-gray-900">End-to-End GTM Enrichment</h1>
          <p className="text-sm text-gray-500 mt-1">Filter by pipeline step, select companies, send to next workflow</p>
        </div>
        <span className="text-sm text-gray-500">
          {companies.length} record{companies.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Pipeline Step Filter */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-blue-800 font-medium">Last Completed Step:</span>

          {/* All companies button */}
          <button
            onClick={() => setSelectedStepFilter(null)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              selectedStepFilter === null
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
            }`}
          >
            All
          </button>

          {/* No steps completed */}
          <button
            onClick={() => setSelectedStepFilter(0)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              selectedStepFilter === 0
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
            }`}
          >
            Ready for Step 1
            <span className="ml-1.5 text-xs opacity-75">
              ({companies.filter(c => !companyStepMap.has(c.id)).length})
            </span>
          </button>

          {/* Step pills */}
          {pipelineSteps.map((step) => {
            const count = companies.filter(c => companyStepMap.get(c.id) === step.overall_step_number).length;
            return (
              <button
                key={step.overall_step_number}
                onClick={() => setSelectedStepFilter(step.overall_step_number)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  selectedStepFilter === step.overall_step_number
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
                }`}
              >
                Step {step.overall_step_number}: {step.title || step.workflow_slug}
                <span className="ml-1.5 text-xs opacity-75">({count})</span>
              </button>
            );
          })}
        </div>

        {selectedStepFilter !== null && selectedStepFilter > 0 && (
          <p className="text-xs text-blue-700 mt-2">
            Showing companies ready for Step {selectedStepFilter + 1}
          </p>
        )}
      </div>

      {/* Eligibility Filter */}
      <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
        {/* Category Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 font-medium">Categories:</span>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  selectedCategories.has(category)
                    ? "bg-gray-700 text-white border-gray-700"
                    : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
                }`}
              >
                {category}
              </button>
            ))}
            {categories.length === 0 && (
              <span className="text-xs text-gray-400">No categories found</span>
            )}
          </div>
        </div>

        {/* Workflow Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600 font-medium">Show Records Eligible For:</span>
          <div className="flex flex-wrap gap-2">
            {filteredWorkflows.length === 0 && (
              <span className="text-xs text-gray-400">No workflows in selected categories</span>
            )}
            {filteredWorkflows.map((workflow) => {
              const isSelected = selectedWorkflowFilter === workflow.id;
              const workflowEligibleCount = isSelected ? eligibleCount : null;

              return (
                <button
                  key={workflow.id}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedWorkflowFilter(null);
                      setShowOnlyEligible(false);
                    } else {
                      setSelectedWorkflowFilter(workflow.id);
                    }
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    isSelected
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                  }`}
                >
                  {workflow.title || workflow.workflow_slug}
                  {isSelected && workflowEligibleCount !== null && (
                    <span className="ml-2 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded">
                      {workflowEligibleCount}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

          {selectedWorkflowFilter && (
            <>
              {loadingEligibility ? (
                <span className="text-sm text-gray-500 ml-2">Checking...</span>
              ) : (
                <label className="flex items-center gap-2 text-sm ml-auto">
                  <input
                    type="checkbox"
                    checked={showOnlyEligible}
                    onChange={(e) => setShowOnlyEligible(e.target.checked)}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <span className="text-gray-700">
                    Hide ineligible ({companies.length - eligibleCount})
                  </span>
                </label>
              )}
            </>
          )}
        </div>
      </div>

      {/* Action Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="relative" ref={enrichmentMenuRef}>
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
                  {selectedWorkflowFilter && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Records
                    </th>
                  )}
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
                    {selectedWorkflowFilter && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {loadingEligibility ? (
                          <span className="text-gray-400">...</span>
                        ) : (eligibilityCounts[company.id] || 0) > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {eligibilityCounts[company.id]}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            0
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
