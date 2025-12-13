"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

interface EnrichmentWorkflow {
  id: string;
  title: string;
  workflow_slug: string;
  description: string | null;
  category: string | null;
  request_type: string | null;
  destination_type: string | null;
  destination_endpoint_url: string | null;
  dispatcher_function_name: string;
  receiver_function_name: string;
  dispatcher_function_url: string;
  receiver_function_url: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ColumnConfig {
  key: keyof EnrichmentWorkflow;
  label: string;
  defaultWidth: number;
}

const COLUMNS: ColumnConfig[] = [
  { key: "title", label: "Title", defaultWidth: 150 },
  { key: "workflow_slug", label: "Slug", defaultWidth: 120 },
  { key: "category", label: "Category", defaultWidth: 100 },
  { key: "description", label: "Description", defaultWidth: 200 },
  { key: "request_type", label: "Request Type", defaultWidth: 100 },
  { key: "destination_type", label: "Destination", defaultWidth: 100 },
  { key: "destination_endpoint_url", label: "Endpoint URL", defaultWidth: 200 },
  { key: "dispatcher_function_name", label: "Dispatcher Fn", defaultWidth: 150 },
  { key: "receiver_function_name", label: "Receiver Fn", defaultWidth: 150 },
  { key: "status", label: "Status", defaultWidth: 80 },
];

const REQUEST_TYPES = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const DESTINATION_TYPES = ["api", "n8n", "pipedream", "clay"];
const STATUS_TYPES = ["draft", "active", "inactive"];
const CATEGORY_TYPES = ["Outbound Launch HQ", "GTM Teaser HQ"];

export default function ViewEnrichmentWorkflowsPage() {
  const [workflows, setWorkflows] = useState<EnrichmentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedWorkflow, setEditedWorkflow] = useState<EnrichmentWorkflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingAll, setEditingAll] = useState(false);
  const [editedWorkflows, setEditedWorkflows] = useState<Map<string, EnrichmentWorkflow>>(new Map());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    Object.fromEntries(COLUMNS.map(col => [col.key, col.defaultWidth]))
  );
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(COLUMNS.map(col => col.key))
  );
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  useEffect(() => {
    fetchWorkflows();
  }, []);

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
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setWorkflows(data || []);
    setLoading(false);
  }

  const handleEdit = (workflow: EnrichmentWorkflow) => {
    setEditingId(workflow.id);
    setEditedWorkflow({ ...workflow });
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditedWorkflow(null);
  };

  const handleSave = async () => {
    if (!editedWorkflow || !supabaseUrl || !supabaseAnonKey) return;

    setSaving(true);
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { error: updateError } = await supabase
      .from("db_driven_enrichment_workflows")
      .update({
        title: editedWorkflow.title,
        workflow_slug: editedWorkflow.workflow_slug,
        category: editedWorkflow.category,
        description: editedWorkflow.description,
        request_type: editedWorkflow.request_type,
        destination_type: editedWorkflow.destination_type,
        destination_endpoint_url: editedWorkflow.destination_endpoint_url,
        dispatcher_function_name: editedWorkflow.dispatcher_function_name,
        receiver_function_name: editedWorkflow.receiver_function_name,
        dispatcher_function_url: editedWorkflow.dispatcher_function_url,
        receiver_function_url: editedWorkflow.receiver_function_url,
        status: editedWorkflow.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editedWorkflow.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setWorkflows(workflows.map(w => w.id === editedWorkflow.id ? editedWorkflow : w));
    setEditingId(null);
    setEditedWorkflow(null);
    setSaving(false);
  };

  const handleFieldChange = (field: keyof EnrichmentWorkflow, value: string) => {
    if (!editedWorkflow) return;
    setEditedWorkflow({ ...editedWorkflow, [field]: value });
  };

  const handleEditAll = () => {
    setEditingAll(true);
    const map = new Map<string, EnrichmentWorkflow>();
    workflows.forEach(w => map.set(w.id, { ...w }));
    setEditedWorkflows(map);
  };

  const handleCancelAll = () => {
    setEditingAll(false);
    setEditedWorkflows(new Map());
  };

  const handleFieldChangeAll = (workflowId: string, field: keyof EnrichmentWorkflow, value: string) => {
    setEditedWorkflows(prev => {
      const next = new Map(prev);
      const workflow = next.get(workflowId);
      if (workflow) {
        next.set(workflowId, { ...workflow, [field]: value });
      }
      return next;
    });
  };

  const handleSaveAll = async () => {
    if (!supabaseUrl || !supabaseAnonKey) return;

    setSaving(true);
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
      const updates = Array.from(editedWorkflows.values()).map(w => ({
        id: w.id,
        title: w.title,
        workflow_slug: w.workflow_slug,
        category: w.category,
        description: w.description,
        request_type: w.request_type,
        destination_type: w.destination_type,
        destination_endpoint_url: w.destination_endpoint_url,
        dispatcher_function_name: w.dispatcher_function_name,
        receiver_function_name: w.receiver_function_name,
        dispatcher_function_url: w.dispatcher_function_url,
        receiver_function_url: w.receiver_function_url,
        status: w.status,
        updated_at: new Date().toISOString(),
      }));

      const { error: updateError } = await supabase
        .from("db_driven_enrichment_workflows")
        .upsert(updates);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      setWorkflows(Array.from(editedWorkflows.values()));
      setEditingAll(false);
      setEditedWorkflows(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleResizeStart = (e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    setResizing(columnKey);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[columnKey];
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing) return;
      const diff = e.clientX - resizeStartX.current;
      const newWidth = Math.max(50, resizeStartWidth.current + diff);
      setColumnWidths(prev => ({ ...prev, [resizing]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    if (resizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  const toggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  };

  const visibleColumnConfigs = COLUMNS.filter(col => visibleColumns.has(col.key));

  const renderCell = (workflow: EnrichmentWorkflow, field: keyof EnrichmentWorkflow, isEditing: boolean, isEditingAll: boolean) => {
    const value = isEditingAll
      ? editedWorkflows.get(workflow.id)?.[field]
      : (isEditing ? editedWorkflow?.[field] : workflow[field]);

    const handleChange = isEditingAll
      ? (val: string) => handleFieldChangeAll(workflow.id, field, val)
      : (val: string) => handleFieldChange(field, val);

    if (!isEditing && !isEditingAll) {
      return <span className="text-sm text-gray-900">{value || "-"}</span>;
    }

    if (field === "category") {
      return (
        <select
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
        >
          <option value="">--</option>
          {CATEGORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    }

    if (field === "request_type") {
      return (
        <select
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
        >
          <option value="">--</option>
          {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    }

    if (field === "destination_type") {
      return (
        <select
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
        >
          <option value="">--</option>
          {DESTINATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    }

    if (field === "status") {
      return (
        <select
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
        >
          {STATUS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    }

    if (field === "description") {
      return (
        <textarea
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
          rows={2}
        />
      );
    }

    return (
      <input
        type="text"
        value={value || ""}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
      />
    );
  };

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin"
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to Admin
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">View + Configure Enrichment Workflows</h1>
      <p className="text-gray-600 mb-8">View and edit all enrichment workflows</p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setShowColumnMenu(!showColumnMenu)}
            className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
            Columns
          </button>
          {showColumnMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 p-2 min-w-[200px]">
              {COLUMNS.map(col => (
                <label key={col.key} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {editingAll ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save All"}
            </button>
            <button
              onClick={handleCancelAll}
              disabled={saving}
              className="px-4 py-2 text-sm bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleEditAll}
            disabled={editingId !== null}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Edit All
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-gray-600">Loading workflows...</div>
      ) : workflows.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No enrichment workflows found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="bg-white border border-gray-200 rounded-lg" style={{ tableLayout: "fixed" }}>
            <thead className="bg-gray-50">
              <tr>
                {visibleColumnConfigs.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase relative"
                    style={{ width: columnWidths[col.key] }}
                  >
                    <div className="truncate pr-2">{col.label}</div>
                    <div
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-blue-300"
                      onMouseDown={(e) => handleResizeStart(e, col.key)}
                    />
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {workflows.map((workflow) => {
                const isEditing = editingId === workflow.id;
                const rowHighlight = isEditing || editingAll ? "bg-blue-50" : "";
                return (
                  <tr key={workflow.id} className={rowHighlight}>
                    {visibleColumnConfigs.map((col) => (
                      <td
                        key={col.key}
                        className="px-4 py-3 overflow-hidden"
                        style={{ width: columnWidths[col.key] }}
                      >
                        <div className={editingAll || isEditing ? "" : "truncate"}>
                          {renderCell(workflow, col.key, isEditing, editingAll)}
                        </div>
                      </td>
                    ))}
                    <td className="px-4 py-3 whitespace-nowrap w-20">
                      {editingAll ? (
                        <span className="text-xs text-gray-400">-</span>
                      ) : isEditing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50"
                            title="Save"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </button>
                          <button
                            onClick={handleCancel}
                            className="p-1 text-gray-600 hover:text-gray-800"
                            title="Cancel"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(workflow)}
                          className="p-1 text-gray-600 hover:text-gray-800"
                          title="Edit"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
