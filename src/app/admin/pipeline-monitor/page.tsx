"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

interface WorkflowOption {
  id: string;
  title: string;
  workflow_slug: string;
  overall_step_number: number;
  destination_config: {
    destinations: Array<{
      db: "workspace" | "hq";
      table: string;
      fields: Record<string, string> | null;
    }>;
  } | null;
}

interface ResultLogEntry {
  id: string;
  company_domain: string;
  play_name: string;
  step_number: number;
  status: "success" | "error";
  result_table: string | null;
  error_message: string | null;
  stored_at: string;
}

interface CompletionEntry {
  id: string;
  company_id: string;
  play_name: string;
  step_number: number;
  workflow_slug: string;
  completed_at: string;
}

interface DestinationRecord {
  id: string;
  company_domain?: string;
  company_name?: string;
  created_at?: string;
  scraped_at?: string;
  [key: string]: unknown;
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const then = new Date(dateString);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function PipelineMonitorPage() {
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Data states
  const [resultsLog, setResultsLog] = useState<ResultLogEntry[]>([]);
  const [completions, setCompletions] = useState<CompletionEntry[]>([]);
  const [destinationData, setDestinationData] = useState<Map<string, DestinationRecord[]>>(new Map());

  const [loading, setLoading] = useState(true);

  const hqUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const hqKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;
  const workspaceUrl = process.env.NEXT_PUBLIC_WORKSPACE_URL;
  const workspaceKey = process.env.NEXT_PUBLIC_WORKSPACE_ANON_KEY;

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);

  // Fetch workflows on mount
  useEffect(() => {
    async function fetchWorkflows() {
      if (!hqUrl || !hqKey) return;

      const supabase = createClient(hqUrl, hqKey);
      const { data, error } = await supabase
        .from("db_driven_enrichment_workflows")
        .select("id, title, workflow_slug, overall_step_number, destination_config")
        .not("overall_step_number", "is", null)
        .neq("status", "deprecated")
        .order("overall_step_number", { ascending: true });

      if (!error && data) {
        setWorkflows(data as WorkflowOption[]);
        if (data.length > 0) {
          setSelectedWorkflowId(data[0].id);
        }
      }
      setLoading(false);
    }

    fetchWorkflows();
  }, [hqUrl, hqKey]);

  // Fetch activity data
  const fetchActivityData = useCallback(async () => {
    if (!hqUrl || !hqKey) return;

    const hqClient = createClient(hqUrl, hqKey);

    // Fetch results log (last 20, filtered by step if workflow selected)
    const resultsQuery = hqClient
      .from("enrichment_results_log")
      .select("*")
      .order("stored_at", { ascending: false })
      .limit(20);

    if (selectedWorkflow) {
      resultsQuery.eq("step_number", selectedWorkflow.overall_step_number);
    }

    const { data: resultsData } = await resultsQuery;
    setResultsLog((resultsData as ResultLogEntry[]) || []);

    // Fetch completions (last 20, filtered by step if workflow selected)
    const completionsQuery = hqClient
      .from("company_play_step_completions")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(20);

    if (selectedWorkflow) {
      completionsQuery.eq("step_number", selectedWorkflow.overall_step_number);
    }

    const { data: completionsData } = await completionsQuery;
    setCompletions((completionsData as CompletionEntry[]) || []);

    // Fetch destination table data
    if (selectedWorkflow?.destination_config?.destinations) {
      const newDestinationData = new Map<string, DestinationRecord[]>();

      for (const dest of selectedWorkflow.destination_config.destinations) {
        const client =
          dest.db === "workspace" && workspaceUrl && workspaceKey
            ? createClient(workspaceUrl, workspaceKey)
            : hqClient;

        const { data: destData } = await client
          .from(dest.table)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10);

        if (destData) {
          newDestinationData.set(`${dest.db}:${dest.table}`, destData as DestinationRecord[]);
        }
      }

      setDestinationData(newDestinationData);
    } else {
      setDestinationData(new Map());
    }

    setLastRefresh(new Date());
  }, [hqUrl, hqKey, workspaceUrl, workspaceKey, selectedWorkflow]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchActivityData();

    if (autoRefresh) {
      const interval = setInterval(fetchActivityData, 5000);
      return () => clearInterval(interval);
    }
  }, [fetchActivityData, autoRefresh]);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Pipeline Activity Monitor</h1>
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const recentResultsCount = resultsLog.filter(
    (r) => new Date().getTime() - new Date(r.stored_at).getTime() < 60000
  ).length;

  const recentCompletionsCount = completions.filter(
    (c) => new Date().getTime() - new Date(c.completed_at).getTime() < 60000
  ).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Activity Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Workflow Selector */}
          <select
            value={selectedWorkflowId || ""}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                Step {w.overall_step_number}: {w.title}
              </option>
            ))}
          </select>

          {/* Auto-refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              autoRefresh
                ? "bg-green-100 text-green-700 border border-green-300"
                : "bg-gray-100 text-gray-600 border border-gray-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoRefresh ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`}
            />
            Auto-refresh {autoRefresh ? "ON" : "OFF"}
          </button>

          {/* Manual Refresh */}
          <button
            onClick={fetchActivityData}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Results Log Panel */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              enrichment_results_log
              <span className="ml-2 text-xs font-normal text-gray-500">(HQ)</span>
            </h2>
            {recentResultsCount > 0 && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                {recentResultsCount} in last min
              </span>
            )}
          </div>
          <div className="p-4 max-h-80 overflow-y-auto">
            {resultsLog.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No records yet</p>
            ) : (
              <div className="space-y-2">
                {resultsLog.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between p-2 rounded-lg text-sm ${
                      entry.status === "success"
                        ? "bg-green-50 border border-green-100"
                        : "bg-red-50 border border-red-100"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${
                          entry.status === "success"
                            ? "bg-green-500 text-white"
                            : "bg-red-500 text-white"
                        }`}
                      >
                        {entry.status === "success" ? "✓" : "✗"}
                      </span>
                      <span className="font-medium text-gray-900">{entry.company_domain}</span>
                      <span className="text-gray-500">Step {entry.step_number}</span>
                    </div>
                    <span className="text-gray-400 text-xs">{timeAgo(entry.stored_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Completions Panel */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              company_play_step_completions
              <span className="ml-2 text-xs font-normal text-gray-500">(HQ)</span>
            </h2>
            {recentCompletionsCount > 0 && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                {recentCompletionsCount} in last min
              </span>
            )}
          </div>
          <div className="p-4 max-h-80 overflow-y-auto">
            {completions.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No records yet</p>
            ) : (
              <div className="space-y-2">
                {completions.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-2 rounded-lg text-sm bg-green-50 border border-green-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs bg-green-500 text-white">
                        ✓
                      </span>
                      <span className="font-medium text-gray-900">{entry.workflow_slug}</span>
                      <span className="text-gray-500">Step {entry.step_number}</span>
                    </div>
                    <span className="text-gray-400 text-xs">{timeAgo(entry.completed_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Destination Tables */}
      {selectedWorkflow?.destination_config?.destinations && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Destination Tables</h2>
          <div className="grid grid-cols-1 gap-6">
            {selectedWorkflow.destination_config.destinations.map((dest) => {
              const key = `${dest.db}:${dest.table}`;
              const records = destinationData.get(key) || [];
              const recentCount = records.filter((r) => {
                const timestamp = r.created_at || r.scraped_at;
                if (!timestamp) return false;
                return new Date().getTime() - new Date(timestamp).getTime() < 60000;
              }).length;

              return (
                <div
                  key={key}
                  className="bg-white rounded-lg border border-gray-200 shadow-sm"
                >
                  <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">
                      {dest.table}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        ({dest.db === "workspace" ? "Workspace" : "HQ"})
                      </span>
                    </h3>
                    {recentCount > 0 && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                        {recentCount} in last min
                      </span>
                    )}
                  </div>
                  <div className="p-4 max-h-80 overflow-y-auto">
                    {records.length === 0 ? (
                      <p className="text-gray-400 text-sm text-center py-4">No records yet</p>
                    ) : (
                      <div className="space-y-2">
                        {records.map((record) => {
                          const timestamp = record.created_at || record.scraped_at;
                          return (
                            <div
                              key={record.id}
                              className="flex items-center justify-between p-2 rounded-lg text-sm bg-blue-50 border border-blue-100"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs bg-blue-500 text-white">
                                  ✓
                                </span>
                                <span className="font-medium text-gray-900">
                                  {record.company_domain || record.company_name || record.id.slice(0, 8)}
                                </span>
                                {record.company_name && record.company_domain && (
                                  <span className="text-gray-500">{record.company_name}</span>
                                )}
                              </div>
                              {timestamp && (
                                <span className="text-gray-400 text-xs">{timeAgo(timestamp)}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No destination config warning */}
      {selectedWorkflow && !selectedWorkflow.destination_config?.destinations && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">
            <strong>Note:</strong> This workflow has no destination_config defined. Destination
            table monitoring is not available.
          </p>
        </div>
      )}
    </div>
  );
}
