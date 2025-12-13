"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

interface TableInfo {
  table_name: string;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

export default function GTMSchemaViewerPage() {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gtmUrl = process.env.NEXT_PUBLIC_GTM_SUPABASE_URL;
  const gtmAnonKey = process.env.NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY;

  useEffect(() => {
    async function fetchTables() {
      if (!gtmUrl || !gtmAnonKey) {
        setError("GTM Teaser DB not configured. Set NEXT_PUBLIC_GTM_SUPABASE_URL and NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY.");
        setLoading(false);
        return;
      }

      const supabase = createClient(gtmUrl, gtmAnonKey);

      const { data, error: fetchError } = await supabase.rpc("get_public_tables");

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const tableNames = (data as TableInfo[])?.map((t) => t.table_name) || [];
      setTables(tableNames.sort());
      setLoading(false);
    }

    fetchTables();
  }, [gtmUrl, gtmAnonKey]);

  useEffect(() => {
    async function fetchSchema() {
      if (!selectedTable || !gtmUrl || !gtmAnonKey) {
        setColumns([]);
        return;
      }

      setLoadingSchema(true);
      const supabase = createClient(gtmUrl, gtmAnonKey);

      const { data, error: fetchError } = await supabase.rpc("get_table_columns", {
        target_table: selectedTable,
      });

      if (fetchError) {
        setError(fetchError.message);
        setLoadingSchema(false);
        return;
      }

      setColumns((data as ColumnInfo[]) || []);
      setLoadingSchema(false);
    }

    fetchSchema();
  }, [selectedTable, gtmUrl, gtmAnonKey]);

  const generateCreateTableSQL = () => {
    if (!selectedTable || columns.length === 0) return "";

    const columnDefs = columns.map((col) => {
      let def = `  ${col.column_name} ${col.data_type.toUpperCase()}`;
      if (col.character_maximum_length) {
        def = `  ${col.column_name} ${col.data_type.toUpperCase()}(${col.character_maximum_length})`;
      }
      if (col.is_nullable === "NO") {
        def += " NOT NULL";
      }
      if (col.column_default) {
        def += ` DEFAULT ${col.column_default}`;
      }
      return def;
    });

    return `CREATE TABLE ${selectedTable} (\n${columnDefs.join(",\n")}\n);`;
  };

  const handleCopySQL = async () => {
    const sql = generateCreateTableSQL();
    if (!sql) return;

    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
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

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        GTM Teaser DB - Table Schema Viewer
      </h1>
      <p className="text-gray-600 mb-8">
        Select a table to view its schema definition
      </p>

      <div className="mb-6">
        <label
          htmlFor="table-select"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Select Table
        </label>
        <select
          id="table-select"
          value={selectedTable}
          onChange={(e) => setSelectedTable(e.target.value)}
          disabled={loading || tables.length === 0}
          className="block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        >
          <option value="">
            {loading ? "Loading tables..." : tables.length === 0 ? "No tables available" : "-- Select a table --"}
          </option>
          {tables.map((table) => (
            <option key={table} value={table}>
              {table}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          {error.includes("get_public_tables") && (
            <div className="mt-3 text-sm text-red-700">
              <p className="font-medium">Setup required:</p>
              <p className="mt-1">
                Run these SQL functions in your GTM Teaser Supabase SQL editor:
              </p>
              <pre className="mt-2 bg-red-100 p-3 rounded text-xs overflow-x-auto">
{`-- Function to get all public tables
CREATE OR REPLACE FUNCTION get_public_tables()
RETURNS TABLE(table_name text) AS $$
BEGIN
  RETURN QUERY
  SELECT t.table_name::text
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get columns for a specific table
CREATE OR REPLACE FUNCTION get_table_columns(target_table text)
RETURNS TABLE(
  column_name text,
  data_type text,
  is_nullable text,
  column_default text,
  character_maximum_length integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.column_default::text,
    c.character_maximum_length::integer
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = target_table
  ORDER BY c.ordinal_position;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`}
              </pre>
            </div>
          )}
        </div>
      )}

      {selectedTable && !error && (
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
            <h2 className="font-medium text-gray-900">
              {selectedTable} schema
            </h2>
            <button
              onClick={handleCopySQL}
              disabled={loadingSchema || columns.length === 0}
              className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-gray-900 text-white hover:bg-gray-800"
            >
              {copied ? "Copied!" : "Copy SQL"}
            </button>
          </div>
          <div className="p-4">
            {loadingSchema ? (
              <div className="text-gray-600">Loading schema...</div>
            ) : (
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                {generateCreateTableSQL()}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
