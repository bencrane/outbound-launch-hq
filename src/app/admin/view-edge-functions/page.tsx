"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

interface EnrichmentWorkflow {
  id: string;
  title: string;
  workflow_slug: string;
  dispatcher_function_name: string | null;
  receiver_function_name: string | null;
  storage_worker_function_name: string | null;
  global_logger_function_name: string | null;
  destination_endpoint_url: string | null;
  destination_type: string | null;
}

export default function ViewEdgeFunctionsPage() {
  const [workflows, setWorkflows] = useState<EnrichmentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  useEffect(() => {
    async function fetchData() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Supabase not configured");
        setLoading(false);
        return;
      }

      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: wfData, error: wfError } = await supabase
          .from("db_driven_enrichment_workflows")
          .select("id, title, workflow_slug, dispatcher_function_name, receiver_function_name, storage_worker_function_name, global_logger_function_name, destination_endpoint_url, destination_type")
          .order("title");

        if (wfError) {
          setError(wfError.message);
          setLoading(false);
          return;
        }

        setWorkflows(wfData || []);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    fetchData();
  }, [supabaseUrl, supabaseAnonKey]);

  const getCompleteness = (workflow: EnrichmentWorkflow) => {
    let count = 0;
    if (workflow.dispatcher_function_name) count++;
    if (workflow.storage_worker_function_name) count++;
    if (workflow.global_logger_function_name) count++;
    return count;
  };

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            ← Back to Admin
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Edge Function Assignments</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to Admin
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edge Function Assignments</h1>
          <p className="text-gray-600 text-sm mt-1">Read-only view of all workflow configurations</p>
        </div>
        <Link
          href="/admin/assign-edge-functions"
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Configure Assignments
        </Link>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {workflows.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No enrichment workflows found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {workflows.map((workflow) => {
            const completeness = getCompleteness(workflow);
            return (
              <div key={workflow.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">{workflow.title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono">{workflow.workflow_slug}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    completeness === 3 ? "bg-green-100 text-green-700" :
                    completeness > 0 ? "bg-yellow-100 text-yellow-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {completeness}/3 functions
                  </span>
                </div>

                <div className="p-4">
                  {/* Pipeline: Dispatcher → Destination → Storage Worker → Global Logger */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Dispatcher */}
                    <div className={`rounded-lg p-3 ${workflow.dispatcher_function_name ? "bg-blue-50 border border-blue-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Dispatcher
                      </div>
                      {workflow.dispatcher_function_name ? (
                        <code className="text-xs text-gray-800 bg-white px-2 py-1 rounded border block truncate" title={workflow.dispatcher_function_name}>
                          {workflow.dispatcher_function_name}
                        </code>
                      ) : (
                        <span className="text-xs text-gray-400">Not assigned</span>
                      )}
                    </div>

                    {/* Destination Endpoint */}
                    <div className={`rounded-lg p-3 ${workflow.destination_endpoint_url ? "bg-cyan-50 border border-cyan-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Destination
                      </div>
                      {workflow.destination_endpoint_url ? (
                        <div>
                          <code className="text-xs text-gray-800 bg-white px-2 py-1 rounded border block truncate" title={workflow.destination_endpoint_url}>
                            {workflow.destination_endpoint_url}
                          </code>
                          {workflow.destination_type && (
                            <span className="text-xs text-gray-500 mt-1 block">{workflow.destination_type}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Not configured</span>
                      )}
                    </div>

                    {/* Storage Worker */}
                    <div className={`rounded-lg p-3 ${workflow.storage_worker_function_name ? "bg-purple-50 border border-purple-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Storage Worker
                      </div>
                      {workflow.storage_worker_function_name ? (
                        <code className="text-xs text-gray-800 bg-white px-2 py-1 rounded border block truncate" title={workflow.storage_worker_function_name}>
                          {workflow.storage_worker_function_name}
                        </code>
                      ) : (
                        <span className="text-xs text-gray-400">Not assigned</span>
                      )}
                    </div>

                    {/* Global Logger */}
                    <div className={`rounded-lg p-3 ${workflow.global_logger_function_name ? "bg-orange-50 border border-orange-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Global Logger
                      </div>
                      {workflow.global_logger_function_name ? (
                        <code className="text-xs text-gray-800 bg-white px-2 py-1 rounded border block truncate" title={workflow.global_logger_function_name}>
                          {workflow.global_logger_function_name}
                        </code>
                      ) : (
                        <span className="text-xs text-gray-400">Not assigned</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
