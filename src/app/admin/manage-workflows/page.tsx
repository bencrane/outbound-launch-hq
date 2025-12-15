"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

interface Workflow {
  id: string;
  title: string | null;
  workflow_slug: string | null;
  description: string | null;
  request_type: string | null;
  destination_type: string | null;
  destination_endpoint_url: string | null;
  dispatcher_function_name: string | null;
  receiver_function_name: string | null;
  dispatcher_function_url: string | null;
  receiver_function_url: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  storage_worker_function_name: string | null;
  storage_worker_function_url: string | null;
  global_logger_function_name: string | null;
  global_logger_function_url: string | null;
  category: string | null;
  source_table_name: string | null;
  source_table_company_fk: string | null;
  source_table_select_columns: string | null;
  destination_table_name: string | null;
  destination_field_mappings: Record<string, string> | null;
  raw_payload_table_name: string | null;
  array_field_configs: unknown[] | null;
  raw_payload_field: string | null;
  source_record_array_field: string | null;
  play_id: string | null;
  phase_type: string | null;
  phase_number: number | null;
  phase_step_number: number | null;
  overall_step_number: number | null;
  provider: string | null;
}

// Fields organized by category for better UX
const fieldGroups = [
  {
    name: "Identity",
    fields: ["id", "title", "workflow_slug", "description", "status", "category"],
  },
  {
    name: "Pipeline Sequencing (NEW)",
    fields: ["play_id", "phase_type", "phase_number", "phase_step_number", "overall_step_number", "provider"],
  },
  {
    name: "Source Configuration",
    fields: ["source_table_name", "source_table_company_fk", "source_table_select_columns", "source_record_array_field"],
  },
  {
    name: "Destination Configuration",
    fields: ["destination_type", "destination_endpoint_url", "destination_table_name", "destination_field_mappings"],
  },
  {
    name: "Edge Functions",
    fields: [
      "dispatcher_function_name",
      "dispatcher_function_url",
      "receiver_function_name",
      "receiver_function_url",
      "storage_worker_function_name",
      "storage_worker_function_url",
      "global_logger_function_name",
      "global_logger_function_url",
    ],
  },
  {
    name: "Raw Payload & Arrays",
    fields: ["raw_payload_table_name", "raw_payload_field", "array_field_configs"],
  },
  {
    name: "Metadata",
    fields: ["request_type", "created_at", "updated_at"],
  },
];

const readOnlyFields = ["id", "created_at", "updated_at"];

const jsonFields = ["destination_field_mappings", "array_field_configs"];

export default function ManageWorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [editedValues, setEditedValues] = useState<Partial<Workflow>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Inline status editing
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editingStatusValue, setEditingStatusValue] = useState<string>("");
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  useEffect(() => {
    async function fetchWorkflows() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Database configuration missing");
        setLoading(false);
        return;
      }

      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error: fetchError } = await supabase
          .from("db_driven_enrichment_workflows")
          .select("*")
          .order("overall_step_number", { ascending: true, nullsFirst: false }) // numbered steps first, nulls at bottom
          .order("phase_number", { ascending: true, nullsFirst: false })
          .order("phase_step_number", { ascending: true, nullsFirst: false })
          .order("status", { ascending: true }); // tiebreaker: active before deprecated/inactive

        if (fetchError) {
          setError(fetchError.message);
        } else {
          setWorkflows(data || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchWorkflows();
  }, [supabaseUrl, supabaseAnonKey]);

  const handleEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setEditedValues({});
    setSaveMessage(null);
  };

  const handleFieldChange = (field: keyof Workflow, value: string) => {
    let parsedValue: unknown = value;

    // Handle empty strings
    if (value === "" || value === "null") {
      parsedValue = null;
    }
    // Handle number fields
    else if (["phase_number", "phase_step_number", "overall_step_number"].includes(field)) {
      parsedValue = value === "" ? null : parseInt(value, 10);
      if (isNaN(parsedValue as number)) parsedValue = null;
    }
    // Handle JSON fields
    else if (jsonFields.includes(field)) {
      try {
        parsedValue = value ? JSON.parse(value) : null;
      } catch {
        // Keep as string if invalid JSON - will show error on save
        parsedValue = value;
      }
    }

    setEditedValues((prev) => ({
      ...prev,
      [field]: parsedValue,
    }));
  };

  const handleSave = async () => {
    if (!editingWorkflow || !supabaseUrl || !supabaseAnonKey) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      // Only send changed fields
      const updates = { ...editedValues, updated_at: new Date().toISOString() };

      const { error: updateError } = await supabase
        .from("db_driven_enrichment_workflows")
        .update(updates)
        .eq("id", editingWorkflow.id);

      if (updateError) {
        setSaveMessage(`Error: ${updateError.message}`);
      } else {
        setSaveMessage("Saved successfully!");
        // Update local state
        setWorkflows((prev) =>
          prev.map((w) =>
            w.id === editingWorkflow.id ? { ...w, ...editedValues } : w
          )
        );
        setEditingWorkflow({ ...editingWorkflow, ...editedValues } as Workflow);
        setEditedValues({});
      }
    } catch (err) {
      setSaveMessage(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setSaving(false);
    }
  };

  const getFieldValue = (workflow: Workflow, field: string): string => {
    const value = workflow[field as keyof Workflow];
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  const getCurrentValue = (field: string): string => {
    if (!editingWorkflow) return "";
    if (field in editedValues) {
      const val = editedValues[field as keyof Workflow];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val, null, 2);
      return String(val);
    }
    return getFieldValue(editingWorkflow, field);
  };

  const hasChanges = Object.keys(editedValues).length > 0;

  // Save status inline
  const handleSaveStatus = async (workflowId: string) => {
    if (!supabaseUrl || !supabaseAnonKey) return;

    setSavingStatusId(workflowId);

    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error: updateError } = await supabase
        .from("db_driven_enrichment_workflows")
        .update({ status: editingStatusValue, updated_at: new Date().toISOString() })
        .eq("id", workflowId);

      if (!updateError) {
        // Update local state
        setWorkflows((prev) =>
          prev.map((w) =>
            w.id === workflowId ? { ...w, status: editingStatusValue } : w
          )
        );
        // Also update editingWorkflow if it's the same one
        if (editingWorkflow?.id === workflowId) {
          setEditingWorkflow({ ...editingWorkflow, status: editingStatusValue });
        }
      }
    } finally {
      setSavingStatusId(null);
      setEditingStatusId(null);
      setEditingStatusValue("");
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Manage Enrichment Workflows</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Manage Enrichment Workflows</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Workflow List */}
      <div className={`${editingWorkflow ? "w-1/3" : "w-full"} transition-all`}>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Manage Enrichment Workflows</h1>
        <p className="text-gray-600 mb-4">
          {workflows.length} workflows found. Click to edit.
        </p>

        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Step</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Phase</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {workflows.map((workflow) => (
                <tr
                  key={workflow.id}
                  onClick={() => handleEdit(workflow)}
                  className={`cursor-pointer hover:bg-blue-50 ${
                    editingWorkflow?.id === workflow.id ? "bg-blue-100" : ""
                  }`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-sm">
                    {workflow.overall_step_number ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-sm font-medium text-gray-900">
                    {workflow.title || "Untitled"}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600 font-mono text-xs">
                    {workflow.workflow_slug}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {workflow.phase_type || workflow.category || "-"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                        workflow.status === "active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {workflow.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {editingStatusId === workflow.id ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={editingStatusValue}
                          onChange={(e) => setEditingStatusValue(e.target.value)}
                          className="text-xs border border-gray-300 rounded px-1 py-0.5"
                          autoFocus
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                          <option value="deprecated">deprecated</option>
                        </select>
                        <button
                          onClick={() => handleSaveStatus(workflow.id)}
                          disabled={savingStatusId === workflow.id}
                          className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50"
                          title="Save"
                        >
                          {savingStatusId === workflow.id ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => { setEditingStatusId(null); setEditingStatusValue(""); }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="Cancel"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingStatusId(workflow.id);
                          setEditingStatusValue(workflow.status || "inactive");
                        }}
                        className="p-1 text-gray-400 hover:text-blue-600"
                        title="Edit status"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Panel */}
      {editingWorkflow && (
        <div className="w-2/3 bg-white rounded-lg shadow border border-gray-200 p-4 h-[calc(100vh-8rem)] overflow-y-auto">
          <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pb-2 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              Edit: {editingWorkflow.title || editingWorkflow.workflow_slug}
            </h2>
            <div className="flex items-center gap-3">
              {saveMessage && (
                <span
                  className={`text-sm ${
                    saveMessage.startsWith("Error") ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {saveMessage}
                </span>
              )}
              <button
                onClick={() => setEditingWorkflow(null)}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
              >
                Close
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className={`px-4 py-1.5 text-sm font-medium rounded ${
                  hasChanges && !saving
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          {fieldGroups.map((group) => (
            <div key={group.name} className="mb-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b-2 border-gray-300 uppercase tracking-wide">
                {group.name}
              </h3>
              <div className="grid gap-5">
                {group.fields.map((field) => {
                  const isReadOnly = readOnlyFields.includes(field);
                  const isJson = jsonFields.includes(field);
                  const isLongField =
                    field.includes("url") ||
                    field.includes("columns") ||
                    isJson;
                  const isEdited = field in editedValues;

                  return (
                    <div key={field} className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        {field.replace(/_/g, " ")}
                        {isEdited && (
                          <span className="ml-2 text-blue-600 normal-case">(edited)</span>
                        )}
                      </label>
                      {isJson || isLongField ? (
                        <textarea
                          value={getCurrentValue(field)}
                          onChange={(e) =>
                            handleFieldChange(field as keyof Workflow, e.target.value)
                          }
                          disabled={isReadOnly}
                          rows={isJson ? 5 : 3}
                          className={`w-full px-3 py-2 text-sm font-mono border rounded-md shadow-sm ${
                            isReadOnly
                              ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                              : isEdited
                              ? "border-blue-400 bg-blue-50 focus:ring-2 focus:ring-blue-300"
                              : "border-gray-300 focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                          }`}
                        />
                      ) : (
                        <input
                          type="text"
                          value={getCurrentValue(field)}
                          onChange={(e) =>
                            handleFieldChange(field as keyof Workflow, e.target.value)
                          }
                          disabled={isReadOnly}
                          className={`w-full px-3 py-2 text-sm border rounded-md shadow-sm ${
                            isReadOnly
                              ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                              : isEdited
                              ? "border-blue-400 bg-blue-50 focus:ring-2 focus:ring-blue-300"
                              : "border-gray-300 focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
