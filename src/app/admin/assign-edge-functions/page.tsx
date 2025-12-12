"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface EnrichmentWorkflow {
  id: string;
  title: string;
  workflow_slug: string;
  dispatcher_function_name: string | null;
  dispatcher_function_url: string | null;
  storage_worker_function_name: string | null;
  storage_worker_function_url: string | null;
  global_logger_function_name: string | null;
  global_logger_function_url: string | null;
  destination_endpoint_url: string | null;
  destination_type: string | null;
}

type FunctionRole = "dispatcher" | "storage_worker" | "global_logger";

export default function ConfigureEdgeFunctionsPage() {
  const [edgeFunctions, setEdgeFunctions] = useState<EdgeFunction[]>([]);
  const [workflows, setWorkflows] = useState<EnrichmentWorkflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<FunctionRole | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);

    try {
      // Fetch edge functions from API
      const efResponse = await fetch("/api/edge-functions");
      const efData = await efResponse.json();

      if (!efResponse.ok) {
        setError(efData.error || "Failed to fetch edge functions");
        setLoading(false);
        return;
      }

      setEdgeFunctions(efData);

      // Fetch workflows from Supabase
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: wfData, error: wfError } = await supabase
          .from("db_driven_enrichment_workflows")
          .select("id, title, workflow_slug, dispatcher_function_name, dispatcher_function_url, storage_worker_function_name, storage_worker_function_url, global_logger_function_name, global_logger_function_url, destination_endpoint_url, destination_type")
          .order("title");

        if (wfError) {
          setError(wfError.message);
          setLoading(false);
          return;
        }

        setWorkflows(wfData || []);
      }

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  const selectedWorkflow = workflows.find(w => w.id === selectedWorkflowId);

  const handleAssign = async (role: FunctionRole, functionSlug: string) => {
    if (!selectedWorkflow || !supabaseUrl || !supabaseAnonKey) return;

    setSaving(role);
    setError(null);
    setSuccessMessage(null);

    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "";
      const functionUrl = functionSlug ? `https://${projectRef}.supabase.co/functions/v1/${functionSlug}` : null;

      const fieldMap: Record<FunctionRole, { name: string; url: string }> = {
        dispatcher: { name: "dispatcher_function_name", url: "dispatcher_function_url" },
        storage_worker: { name: "storage_worker_function_name", url: "storage_worker_function_url" },
        global_logger: { name: "global_logger_function_name", url: "global_logger_function_url" },
      };

      const { error: updateError } = await supabase
        .from("db_driven_enrichment_workflows")
        .update({
          [fieldMap[role].name]: functionSlug || null,
          [fieldMap[role].url]: functionUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedWorkflow.id);

      if (updateError) {
        setError(updateError.message);
        setSaving(null);
        return;
      }

      await fetchData();
      setSuccessMessage(`Updated ${getRoleLabel(role)}`);
      setTimeout(() => setSuccessMessage(null), 2000);
      setSaving(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSaving(null);
    }
  };

  const getRoleLabel = (role: FunctionRole): string => {
    switch (role) {
      case "dispatcher": return "Dispatcher";
      case "storage_worker": return "Storage Worker";
      case "global_logger": return "Global Logger";
    }
  };

  const RoleCard = ({ role, label, currentValue }: { role: FunctionRole; label: string; currentValue: string | null }) => {
    const [localValue, setLocalValue] = useState(currentValue || "");
    const isSaving = saving === role;

    useEffect(() => {
      setLocalValue(currentValue || "");
    }, [currentValue]);

    const hasChanged = localValue !== (currentValue || "");

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">{label}</label>
          {currentValue && (
            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Assigned</span>
          )}
        </div>
        <select
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2"
          disabled={isSaving}
        >
          <option value="">-- None --</option>
          {edgeFunctions.map((fn) => (
            <option key={fn.id} value={fn.slug}>{fn.slug}</option>
          ))}
        </select>
        {currentValue && (
          <p className="text-xs text-gray-500 truncate mb-2" title={currentValue}>
            {currentValue}
          </p>
        )}
        <button
          onClick={() => handleAssign(role, localValue)}
          disabled={!hasChanged || isSaving}
          className="w-full px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to Admin
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configure Edge Functions</h1>
          <p className="text-gray-600 text-sm mt-1">Assign edge functions to enrichment workflows</p>
        </div>
        <Link
          href="/admin/view-edge-functions"
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          View All Assignments
        </Link>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-green-800 text-sm">{successMessage}</p>
        </div>
      )}

      {loading ? (
        <div className="text-gray-600">Loading...</div>
      ) : (
        <div className="space-y-6">
          {/* Workflow Selector */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Enrichment Workflow
            </label>
            <select
              value={selectedWorkflowId}
              onChange={(e) => setSelectedWorkflowId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Select a workflow --</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>{wf.title}</option>
              ))}
            </select>
          </div>

          {/* Configuration Panel */}
          {selectedWorkflow && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
              <div className="mb-6">
                <h2 className="text-lg font-medium text-gray-900">{selectedWorkflow.title}</h2>
                <p className="text-sm text-gray-500 font-mono">{selectedWorkflow.workflow_slug}</p>
              </div>

              {/* Flow: Dispatcher → Destination → Storage Worker → Global Logger */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                  Workflow Pipeline
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <RoleCard
                    role="dispatcher"
                    label="1. Dispatcher"
                    currentValue={selectedWorkflow.dispatcher_function_name}
                  />

                  {/* Destination Endpoint (Read Only) */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">2. Destination</label>
                      {selectedWorkflow.destination_endpoint_url && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                          {selectedWorkflow.destination_type || "URL"}
                        </span>
                      )}
                    </div>
                    {selectedWorkflow.destination_endpoint_url ? (
                      <code className="text-xs text-gray-800 bg-gray-100 px-2 py-1.5 rounded block truncate mb-2" title={selectedWorkflow.destination_endpoint_url}>
                        {selectedWorkflow.destination_endpoint_url}
                      </code>
                    ) : (
                      <p className="text-xs text-gray-400 py-1.5 mb-2">Not configured</p>
                    )}
                    <p className="text-xs text-gray-400">(Set in workflow settings)</p>
                  </div>

                  <RoleCard
                    role="storage_worker"
                    label="3. Storage Worker"
                    currentValue={selectedWorkflow.storage_worker_function_name}
                  />
                  <RoleCard
                    role="global_logger"
                    label="4. Global Logger"
                    currentValue={selectedWorkflow.global_logger_function_name}
                  />
                </div>
              </div>
            </div>
          )}

          {!selectedWorkflow && selectedWorkflowId === "" && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-gray-500">Select a workflow above to configure its edge functions</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
