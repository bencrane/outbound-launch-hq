"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function SupabaseEdgeFunctionsPage() {
  const [functions, setFunctions] = useState<EdgeFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFunctions();
  }, []);

  async function fetchFunctions() {
    try {
      const response = await fetch("/api/edge-functions");
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to fetch edge functions");
        setLoading(false);
        return;
      }

      setFunctions(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL || "";
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "";

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

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Supabase Edge Functions</h1>
      <p className="text-gray-600 mb-8">All edge functions deployed in your Supabase project</p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-gray-600">Loading edge functions...</div>
      ) : functions.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No edge functions found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {functions.map((fn) => (
                <tr key={fn.id}>
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium">{fn.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fn.slug}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                      https://{projectRef}.supabase.co/functions/v1/{fn.slug}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fn.version}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      fn.status === "ACTIVE"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}>
                      {fn.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(fn.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(fn.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
