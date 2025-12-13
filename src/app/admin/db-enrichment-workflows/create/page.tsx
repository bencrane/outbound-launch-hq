"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const REQUEST_TYPES = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const DESTINATION_TYPES = [
  { value: "api", label: "API" },
  { value: "n8n", label: "n8n Webhook" },
  { value: "pipedream", label: "Pipedream Endpoint" },
  { value: "clay", label: "Clay Webhook" },
];

export default function CreateDBEnrichmentWorkflowPage() {
  const [title, setTitle] = useState("");
  const [workflowSlug, setWorkflowSlug] = useState("");
  const [description, setDescription] = useState("");
  const [requestType, setRequestType] = useState("");
  const [destinationType, setDestinationType] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  const getProjectRef = (url: string): string => {
    // Extract project ref from URL like https://<project-ref>.supabase.co
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return match ? match[1] : "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!supabaseUrl || !supabaseAnonKey) {
      setError("Supabase not configured");
      return;
    }

    if (!workflowSlug) {
      setError("Workflow slug is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const projectRef = getProjectRef(supabaseUrl);

      // Generate edge function names
      const dispatcherFunctionName = `dispatch_${workflowSlug}_v1`;
      const receiverFunctionName = `ingest_${workflowSlug}_v1`;

      // Generate edge function URLs
      const dispatcherFunctionUrl = `https://${projectRef}.supabase.co/functions/v1/${dispatcherFunctionName}`;
      const receiverFunctionUrl = `https://${projectRef}.supabase.co/functions/v1/${receiverFunctionName}`;

      const { error: insertError } = await supabase
        .from("db_driven_enrichment_workflows")
        .insert({
          title,
          workflow_slug: workflowSlug,
          description: description || null,
          request_type: requestType || null,
          destination_type: destinationType || null,
          destination_endpoint_url: endpoint || null,
          dispatcher_function_name: dispatcherFunctionName,
          receiver_function_name: receiverFunctionName,
          dispatcher_function_url: dispatcherFunctionUrl,
          receiver_function_url: receiverFunctionUrl,
          status: "draft",
        });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setSuccess(true);
      // Reset form
      setTitle("");
      setWorkflowSlug("");
      setDescription("");
      setRequestType("");
      setDestinationType("");
      setEndpoint("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/db-enrichment-workflows"
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to DB-Driven Enrichment Workflows
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Create New DB-Driven Enrichment Workflow</h1>
      <p className="text-gray-600 mb-8">Set up a new database-driven enrichment workflow</p>

      {error && (
        <div className="max-w-2xl mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="max-w-2xl mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800">Workflow created successfully!</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
            Title
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter workflow title"
          />
        </div>

        <div>
          <label htmlFor="workflowSlug" className="block text-sm font-medium text-gray-700 mb-2">
            Workflow Slug
          </label>
          <input
            type="text"
            id="workflowSlug"
            value={workflowSlug}
            onChange={(e) => setWorkflowSlug(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., my-workflow-slug"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
            Brief Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter a brief description of this workflow"
          />
        </div>

        <div>
          <label htmlFor="requestType" className="block text-sm font-medium text-gray-700 mb-2">
            Request Type
          </label>
          <select
            id="requestType"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">-- Select request type --</option>
            {REQUEST_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="destinationType" className="block text-sm font-medium text-gray-700 mb-2">
            Destination Type
          </label>
          <select
            id="destinationType"
            value={destinationType}
            onChange={(e) => setDestinationType(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">-- Select destination type --</option>
            {DESTINATION_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="endpoint" className="block text-sm font-medium text-gray-700 mb-2">
            Endpoint URL
          </label>
          <input
            type="url"
            id="endpoint"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="https://..."
          />
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-gray-900 text-white font-medium rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Creating..." : "Create Workflow"}
          </button>
        </div>
      </form>
    </div>
  );
}
