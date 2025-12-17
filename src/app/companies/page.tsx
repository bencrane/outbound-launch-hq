"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

interface Company {
  id: string;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  created_at: string;
}

interface Enrollment {
  id: string;
  company_id: string;
  play_name: string;
  status: string;
  enrolled_at: string;
}

type SortField = "company_name" | "company_domain" | "created_at";
type SortDirection = "asc" | "desc";

// Available plays/campaigns
const AVAILABLE_PLAYS = [
  { value: "case-study-champions", label: "Case Study Champions" },
];

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEnrollDropdown, setShowEnrollDropdown] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [filterPlay, setFilterPlay] = useState<string | null>(null); // null = show all

  const supabaseUrl = process.env.NEXT_PUBLIC_HQ_URL || process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_HQ_ANON_KEY || process.env.NEXT_PUBLIC_OUTBOUND_LAUNCH_DB_ANON_KEY;

  const fetchData = async () => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setError("Supabase not configured");
      setLoading(false);
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Fetch companies
    const { data: companiesData, error: companiesError } = await supabase
      .from("companies")
      .select("*");

    if (companiesError) {
      setError(companiesError.message);
      setLoading(false);
      return;
    }

    // Fetch enrollments
    const { data: enrollmentsData, error: enrollmentsError } = await supabase
      .from("company_enrollments")
      .select("*");

    if (enrollmentsError) {
      console.error("Error fetching enrollments:", enrollmentsError);
    }

    setCompanies(companiesData || []);
    setEnrollments(enrollmentsData || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [supabaseUrl, supabaseAnonKey]);

  // Build enrollment map: company_id -> list of play names
  const enrollmentMap = useMemo(() => {
    const map = new Map<string, string[]>();
    enrollments.forEach((e) => {
      const plays = map.get(e.company_id) || [];
      plays.push(e.play_name);
      map.set(e.company_id, plays);
    });
    return map;
  }, [enrollments]);

  // Filter and sort companies
  const sortedCompanies = useMemo(() => {
    let filtered = [...companies];

    // Filter by play enrollment
    if (filterPlay === "not-enrolled") {
      filtered = filtered.filter((c) => !enrollmentMap.has(c.id));
    } else if (filterPlay) {
      filtered = filtered.filter((c) => enrollmentMap.get(c.id)?.includes(filterPlay));
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === null || aVal === undefined) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === "asc" ? -1 : 1;

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [companies, sortField, sortDirection, filterPlay, enrollmentMap]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === sortedCompanies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedCompanies.map((c) => c.id)));
    }
  };

  const handleSelectRow = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleEnroll = async (playName: string) => {
    if (!supabaseUrl || !supabaseAnonKey) return;

    setEnrolling(true);
    setShowEnrollDropdown(false);
    setActionResult(null);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Filter out companies already enrolled in this play
    const companiesToEnroll = Array.from(selectedIds).filter(
      (id) => !enrollmentMap.get(id)?.includes(playName)
    );

    if (companiesToEnroll.length === 0) {
      setActionResult({
        success: false,
        message: "All selected companies are already enrolled in this play.",
      });
      setEnrolling(false);
      return;
    }

    const enrollmentRecords = companiesToEnroll.map((companyId) => ({
      company_id: companyId,
      play_name: playName,
      status: "active",
    }));

    const { error: insertError } = await supabase
      .from("company_enrollments")
      .insert(enrollmentRecords);

    if (insertError) {
      setActionResult({
        success: false,
        message: `Error enrolling companies: ${insertError.message}`,
      });
    } else {
      setActionResult({
        success: true,
        message: `Successfully enrolled ${companiesToEnroll.length} companies in "${AVAILABLE_PLAYS.find(p => p.value === playName)?.label || playName}"`,
      });
      setSelectedIds(new Set());
      // Refresh data
      await fetchData();
    }

    setEnrolling(false);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-gray-400 ml-1">↕</span>;
    }
    return (
      <span className="text-blue-600 ml-1">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const isAllSelected = sortedCompanies.length > 0 && selectedIds.size === sortedCompanies.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < sortedCompanies.length;

  // Count companies per play
  const playCounts = useMemo(() => {
    const counts: Record<string, number> = { "not-enrolled": 0 };
    AVAILABLE_PLAYS.forEach((p) => {
      counts[p.value] = 0;
    });

    companies.forEach((c) => {
      const plays = enrollmentMap.get(c.id);
      if (!plays || plays.length === 0) {
        counts["not-enrolled"]++;
      } else {
        plays.forEach((p) => {
          counts[p] = (counts[p] || 0) + 1;
        });
      }
    });

    return counts;
  }, [companies, enrollmentMap]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Companies</h1>
        <p className="text-gray-600">Loading companies...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Companies</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
        <span className="text-sm text-gray-500">
          {sortedCompanies.length} of {companies.length} companies
        </span>
      </div>

      {/* Filter Pills */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterPlay(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterPlay === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
              filterPlay === null ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600"
            }`}>
              {companies.length}
            </span>
          </button>

          <button
            onClick={() => setFilterPlay("not-enrolled")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterPlay === "not-enrolled"
                ? "bg-orange-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Not Enrolled
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
              filterPlay === "not-enrolled" ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600"
            }`}>
              {playCounts["not-enrolled"] || 0}
            </span>
          </button>

          {AVAILABLE_PLAYS.map((play) => (
            <button
              key={play.value}
              onClick={() => setFilterPlay(play.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filterPlay === play.value
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {play.label}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                filterPlay === play.value ? "bg-green-500 text-white" : "bg-gray-200 text-gray-600"
              }`}>
                {playCounts[play.value] || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Action Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="relative">
            <button
              onClick={() => setShowEnrollDropdown(!showEnrollDropdown)}
              disabled={enrolling}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {enrolling ? "Enrolling..." : "Mark Eligible For..."}
            </button>

            {showEnrollDropdown && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                {AVAILABLE_PLAYS.map((play) => (
                  <button
                    key={play.value}
                    onClick={() => handleEnroll(play.value)}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 first:rounded-t-lg last:rounded-b-lg"
                  >
                    {play.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Result message */}
      {actionResult && (
        <div className={`mb-4 p-3 rounded-lg ${actionResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          <p className={`text-sm ${actionResult.success ? "text-green-800" : "text-red-800"}`}>
            {actionResult.message}
          </p>
          <button
            onClick={() => setActionResult(null)}
            className="text-sm underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {sortedCompanies.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600">No companies found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = isSomeSelected;
                      }}
                      onChange={handleSelectAll}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSort("company_name")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Company Name
                    <SortIcon field="company_name" />
                  </th>
                  <th
                    onClick={() => handleSort("company_domain")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Domain
                    <SortIcon field="company_domain" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    LinkedIn
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Enrolled In
                  </th>
                  <th
                    onClick={() => handleSort("created_at")}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  >
                    Created
                    <SortIcon field="created_at" />
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedCompanies.map((company) => {
                  const companyPlays = enrollmentMap.get(company.id) || [];
                  return (
                    <tr
                      key={company.id}
                      className={`hover:bg-gray-50 ${selectedIds.has(company.id) ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(company.id)}
                          onChange={() => handleSelectRow(company.id)}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {company.company_name || "—"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {company.company_domain ? (
                          <a
                            href={`https://${company.company_domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {company.company_domain}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {company.company_linkedin_url ? (
                          <a
                            href={company.company_linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {companyPlays.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {companyPlays.map((play) => (
                              <span
                                key={play}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                              >
                                {AVAILABLE_PLAYS.find((p) => p.value === play)?.label || play}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(company.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Click outside to close dropdown */}
      {showEnrollDropdown && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowEnrollDropdown(false)}
        />
      )}
    </div>
  );
}
