"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { DBDrivenEnrichmentWorkflow } from "@/types/database";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<DBDrivenEnrichmentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  useEffect(() => {
    async function fetchWorkflows() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Supabase not configured");
        setLoading(false);
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { data, error: fetchError } = await supabase
        .from("db_driven_enrichment_workflows")
        .select("*")
        .order("category", { ascending: true })
        .order("title", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setWorkflows(data || []);
      setLoading(false);
    }

    fetchWorkflows();
  }, [supabaseUrl, supabaseAnonKey]);

  // Extract function name from URL for cleaner display
  const getFunctionName = (url: string | null) => {
    if (!url) return "—";
    const match = url.match(/\/functions\/v1\/(.+)$/);
    return match ? match[1] : url;
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Workflows</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Workflows</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  // Group workflows by category
  const workflowsByCategory = workflows.reduce((acc, workflow) => {
    const category = workflow.category || "Uncategorized";
    if (!acc[category]) acc[category] = [];
    acc[category].push(workflow);
    return acc;
  }, {} as Record<string, DBDrivenEnrichmentWorkflow[]>);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enrichment Workflows</h1>
          <p className="text-sm text-gray-500 mt-1">Configuration overview for all workflows</p>
        </div>
        <span className="text-sm text-gray-500">
          {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {Object.entries(workflowsByCategory).map(([category, categoryWorkflows]) => (
        <div key={category} className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">{category}</h2>
          <div className="space-y-4">
            {categoryWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* Header */}
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">{workflow.title}</h3>
                    <p className="text-xs text-gray-500 font-mono">{workflow.workflow_slug}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      workflow.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {workflow.status}
                  </span>
                </div>

                {/* Config Details */}
                <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  {/* Source */}
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Source Table
                    </div>
                    <div className="font-mono text-gray-900 bg-blue-50 px-2 py-1 rounded text-xs">
                      {workflow.source_table_name || "—"}
                    </div>
                    {workflow.source_table_company_fk && (
                      <div className="text-xs text-gray-500 mt-1">
                        FK: {workflow.source_table_company_fk}
                      </div>
                    )}
                  </div>

                  {/* Destination Endpoint */}
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Destination ({workflow.destination_type || "API"})
                    </div>
                    <div className="font-mono text-gray-900 bg-purple-50 px-2 py-1 rounded text-xs truncate" title={workflow.destination_endpoint_url || ""}>
                      {workflow.destination_endpoint_url
                        ? workflow.destination_endpoint_url.length > 50
                          ? workflow.destination_endpoint_url.substring(0, 50) + "..."
                          : workflow.destination_endpoint_url
                        : "—"}
                    </div>
                  </div>

                  {/* Storage Worker */}
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Storage Worker
                    </div>
                    <div className="font-mono text-gray-900 bg-green-50 px-2 py-1 rounded text-xs">
                      {getFunctionName(workflow.storage_worker_function_url)}
                    </div>
                  </div>
                </div>

                {/* Select Columns (collapsible detail) */}
                {workflow.source_table_select_columns && (
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                    <div className="text-xs text-gray-500">
                      <span className="font-medium">Select: </span>
                      <span className="font-mono">{workflow.source_table_select_columns}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {workflows.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600">No workflows configured.</p>
        </div>
      )}
    </div>
  );
}
