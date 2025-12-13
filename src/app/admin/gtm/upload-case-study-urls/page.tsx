"use client";

import { useState, useRef, useEffect, DragEvent } from "react";
import { createClient } from "@supabase/supabase-js";

interface TargetCompany {
  id: string;
  domain: string;
  name: string | null;
}

const DB_FIELDS = [
  { key: "case_study_url", label: "case_study_url", required: true },
  { key: "customer_name", label: "customer_name", required: false },
] as const;

type FieldMapping = Record<string, string>;

export default function UploadCaseStudyURLsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [targetCompanies, setTargetCompanies] = useState<TargetCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const gtmUrl = process.env.NEXT_PUBLIC_GTM_SUPABASE_URL;
  const gtmAnonKey = process.env.NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!gtmUrl || !gtmAnonKey) return;

    const supabase = createClient(gtmUrl, gtmAnonKey);
    supabase
      .from("hq_target_companies")
      .select("id, domain, name")
      .order("domain")
      .then(({ data, error }) => {
        if (!error && data) {
          setTargetCompanies(data);
        }
      });
  }, [gtmUrl, gtmAnonKey]);

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const processFile = (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".csv")) {
      setResult({ success: false, message: "Please upload a CSV file" });
      return;
    }

    setFile(selectedFile);
    setResult(null);
    setFieldMapping({});

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());
      if (lines.length === 0) return;

      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      setCsvHeaders(headers);

      // Auto-detect mappings
      const autoMapping: FieldMapping = {};
      headers.forEach((header) => {
        const lowerHeader = header.toLowerCase();
        if (lowerHeader.includes("url") || lowerHeader.includes("link")) {
          if (!autoMapping["case_study_url"]) autoMapping["case_study_url"] = header;
        } else if (lowerHeader.includes("customer") || lowerHeader.includes("client") || lowerHeader.includes("name")) {
          if (!autoMapping["customer_name"]) autoMapping["customer_name"] = header;
        }
      });
      setFieldMapping(autoMapping);

      const rows = lines.slice(1, 6).map((line) => {
        const values = parseCSVLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, i) => {
          row[header] = values[i] || "";
        });
        return row;
      });

      setPreview(rows);
    };
    reader.readAsText(selectedFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    processFile(selectedFile);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleMappingChange = (dbField: string, csvColumn: string) => {
    setFieldMapping((prev) => ({
      ...prev,
      [dbField]: csvColumn,
    }));
  };

  const handleUpload = async () => {
    if (!file || !gtmUrl || !gtmAnonKey || !selectedCompanyId) return;

    // Validate required fields are mapped
    const missingRequired = DB_FIELDS.filter((f) => f.required && !fieldMapping[f.key]);
    if (missingRequired.length > 0) {
      setResult({
        success: false,
        message: `Please map required fields: ${missingRequired.map((f) => f.label).join(", ")}`,
      });
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const supabase = createClient(gtmUrl, gtmAnonKey);
      const selectedCompany = targetCompanies.find((c) => c.id === selectedCompanyId);

      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

      // Build index map from field mapping
      const indexMap: Record<string, number> = {};
      for (const [dbField, csvColumn] of Object.entries(fieldMapping)) {
        const idx = headers.indexOf(csvColumn);
        if (idx !== -1) {
          indexMap[dbField] = idx;
        }
      }

      const records = lines.slice(1).map((line) => {
        const values = parseCSVLine(line);

        const urlIdx = indexMap["case_study_url"];
        const customerIdx = indexMap["customer_name"];

        return {
          hq_target_company_id: selectedCompanyId,
          hq_target_company_domain: selectedCompany?.domain || null,
          case_study_url: urlIdx !== undefined ? values[urlIdx]?.trim() || null : null,
          customer_name: customerIdx !== undefined ? values[customerIdx]?.trim() || null : null,
          status: "pending",
        };
      }).filter((r) => r.case_study_url);

      const { data, error } = await supabase
        .from("case_study_urls")
        .insert(records)
        .select();

      if (error) {
        setResult({ success: false, message: `Error: ${error.message}` });
      } else {
        setResult({
          success: true,
          message: `Successfully uploaded ${data?.length || records.length} case study URLs for ${selectedCompany?.name || selectedCompany?.domain}`,
        });
        setFile(null);
        setPreview([]);
        setCsvHeaders([]);
        setFieldMapping({});
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (err) {
      setResult({
        success: false,
        message: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } finally {
      setUploading(false);
    }
  };

  const canUpload =
    selectedCompanyId &&
    DB_FIELDS.filter((f) => f.required).every((f) => fieldMapping[f.key]);

  if (!gtmUrl || !gtmAnonKey) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Case Study URLs</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">
            GTM Teaser DB not configured. Set NEXT_PUBLIC_GTM_SUPABASE_URL and NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Upload Case Study URLs</h1>
      <p className="text-gray-600 mb-6">Import case study URLs for a target company into the GTM Teaser Demo DB</p>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Target Company <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full max-w-md border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- Select a company --</option>
            {targetCompanies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name ? `${company.name} (${company.domain})` : company.domain}
              </option>
            ))}
          </select>
          {targetCompanies.length === 0 && (
            <p className="text-sm text-gray-500 mt-2">
              No target companies found. Upload target companies first.
            </p>
          )}
        </div>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="text-gray-600">
            {file ? (
              <span className="font-medium text-gray-900">{file.name}</span>
            ) : (
              <>
                <span className="font-medium">Drop CSV here</span> or click to browse
              </>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">CSV files only</p>
        </div>

        {csvHeaders.length > 0 && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Map CSV Columns to Database Fields</h3>
            <div className="space-y-3">
              {DB_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-4">
                  <label className="w-40 text-sm text-gray-700">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    value={fieldMapping[field.key] || ""}
                    onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    className="flex-1 max-w-xs border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select column --</option>
                    {csvHeaders.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {preview.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Preview (first 5 rows):</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {Object.keys(preview[0]).map((header) => {
                      const mappedTo = Object.entries(fieldMapping).find(([, v]) => v === header)?.[0];
                      return (
                        <th key={header} className="px-3 py-2 text-left font-medium text-gray-600 border-b">
                          {header}
                          {mappedTo && (
                            <span className="ml-2 text-xs text-blue-600 font-normal">
                              → {mappedTo}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b">
                      {Object.values(row).map((value, j) => (
                        <td key={j} className="px-3 py-2 text-gray-800 max-w-xs truncate">
                          {value || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {file && (
          <button
            onClick={handleUpload}
            disabled={uploading || !canUpload}
            className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? "Uploading..." : "Upload to GTM DB"}
          </button>
        )}

        {file && !canUpload && (
          <p className="mt-2 text-sm text-amber-600">
            {!selectedCompanyId
              ? "Please select a target company."
              : "Please map all required fields before uploading."}
          </p>
        )}

        {result && (
          <div
            className={`mt-4 p-3 rounded-lg ${result.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
          >
            <p className={`text-sm ${result.success ? "text-green-800" : "text-red-800"}`}>
              {result.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
