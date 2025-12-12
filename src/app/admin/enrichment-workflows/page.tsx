"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import type { EnrichmentWorkflow } from "@/types/database";

type WorkflowFormData = {
  name: string;
  description: string;
  pipedream_webhook_url: string;
  n8n_webhook_url_test: string;
  n8n_webhook_url_prod: string;
  is_active: boolean;
};

const emptyForm: WorkflowFormData = {
  name: "",
  description: "",
  pipedream_webhook_url: "",
  n8n_webhook_url_test: "",
  n8n_webhook_url_prod: "",
  is_active: true,
};

export default function EnrichmentWorkflowsPage() {
  const [workflows, setWorkflows] = useState<EnrichmentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<WorkflowFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const getSupabase = () => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey);
  };

  const fetchWorkflows = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase not configured");
      setLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("enrichment_workflows")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setWorkflows(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;

    setSaving(true);
    setError(null);

    const payload = {
      name: formData.name,
      description: formData.description || null,
      pipedream_webhook_url: formData.pipedream_webhook_url || null,
      n8n_webhook_url_test: formData.n8n_webhook_url_test || null,
      n8n_webhook_url_prod: formData.n8n_webhook_url_prod || null,
      is_active: formData.is_active,
    };

    if (editingId) {
      const { error: updateError } = await supabase
        .from("enrichment_workflows")
        .update(payload)
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
      } else {
        setShowForm(false);
        setEditingId(null);
        setFormData(emptyForm);
        await fetchWorkflows();
      }
    } else {
      const { error: insertError } = await supabase
        .from("enrichment_workflows")
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
      } else {
        setShowForm(false);
        setFormData(emptyForm);
        await fetchWorkflows();
      }
    }

    setSaving(false);
  };

  const handleEdit = (workflow: EnrichmentWorkflow) => {
    setFormData({
      name: workflow.name,
      description: workflow.description || "",
      pipedream_webhook_url: workflow.pipedream_webhook_url || "",
      n8n_webhook_url_test: workflow.n8n_webhook_url_test || "",
      n8n_webhook_url_prod: workflow.n8n_webhook_url_prod || "",
      is_active: workflow.is_active,
    });
    setEditingId(workflow.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this workflow?")) return;

    const supabase = getSupabase();
    if (!supabase) return;

    const { error: deleteError } = await supabase
      .from("enrichment_workflows")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      await fetchWorkflows();
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(emptyForm);
    setError(null);
  };

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            ← Back to Admin
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Workflows</h1>
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
          <h1 className="text-2xl font-bold text-gray-900">Enrichment Workflows</h1>
          <p className="text-gray-600 mt-1">Configure n8n webhook endpoints for data enrichment</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Add Workflow
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          {error.includes("enrichment_workflows") && error.includes("does not exist") && (
            <div className="mt-3 text-sm text-red-700">
              <p className="font-medium">Setup required:</p>
              <p className="mt-1">Run this SQL in your Supabase SQL editor:</p>
              <pre className="mt-2 bg-red-100 p-3 rounded text-xs overflow-x-auto">
{`CREATE TABLE enrichment_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  pipedream_webhook_url TEXT,
  n8n_webhook_url_test TEXT,
  n8n_webhook_url_prod TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE enrichment_workflows ENABLE ROW LEVEL SECURITY;

-- Allow all operations (since this is a solo operator tool)
CREATE POLICY "Allow all" ON enrichment_workflows FOR ALL USING (true);`}
              </pre>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="mb-6 bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? "Edit Workflow" : "New Workflow"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Workflow Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Company Enrichment"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Brief description of what this workflow does"
              />
            </div>

            <div className="border-t border-gray-200 pt-4 mt-4">
              <p className="text-sm font-medium text-gray-900 mb-3">Pipedream (Primary)</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pipedream Webhook URL
                </label>
                <input
                  type="url"
                  value={formData.pipedream_webhook_url}
                  onChange={(e) => setFormData({ ...formData, pipedream_webhook_url: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="https://eo1234567.m.pipedream.net"
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mt-4">
              <p className="text-sm font-medium text-gray-900 mb-3">n8n (Optional - passed to Pipedream)</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    n8n Webhook URL (Test)
                  </label>
                  <input
                    type="url"
                    value={formData.n8n_webhook_url_test}
                    onChange={(e) => setFormData({ ...formData, n8n_webhook_url_test: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="https://your-n8n-instance.com/webhook-test/..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    n8n Webhook URL (Production)
                  </label>
                  <input
                    type="url"
                    value={formData.n8n_webhook_url_prod}
                    onChange={(e) => setFormData({ ...formData, n8n_webhook_url_prod: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="https://your-n8n-instance.com/webhook/..."
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">
                Active (show in enrichment menu)
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Update Workflow" : "Create Workflow"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {workflows.length === 0 && !showForm ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600">No enrichment workflows configured yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            Add your first workflow
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className={`bg-white rounded-lg shadow border p-4 ${
                workflow.is_active ? "border-gray-200" : "border-gray-200 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{workflow.name}</h3>
                    {!workflow.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {workflow.description && (
                    <p className="text-sm text-gray-600 mt-1">{workflow.description}</p>
                  )}
                  <div className="mt-3 space-y-1">
                    {workflow.pipedream_webhook_url && (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded">
                          Pipedream
                        </span>
                        <code className="text-xs text-gray-500 truncate max-w-md">
                          {workflow.pipedream_webhook_url}
                        </code>
                      </div>
                    )}
                    {workflow.n8n_webhook_url_test && (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">
                          n8n Test
                        </span>
                        <code className="text-xs text-gray-500 truncate max-w-md">
                          {workflow.n8n_webhook_url_test}
                        </code>
                      </div>
                    )}
                    {workflow.n8n_webhook_url_prod && (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">
                          n8n Prod
                        </span>
                        <code className="text-xs text-gray-500 truncate max-w-md">
                          {workflow.n8n_webhook_url_prod}
                        </code>
                      </div>
                    )}
                    {!workflow.pipedream_webhook_url && !workflow.n8n_webhook_url_test && !workflow.n8n_webhook_url_prod && (
                      <p className="text-xs text-gray-400 italic">No webhook URLs configured</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(workflow)}
                    className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(workflow.id)}
                    className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
