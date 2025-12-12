"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

interface CompanyCoverage {
  company_domain: string;
  company_name: string | null;
  tables: {
    companies: boolean;
    enrichment_leadmagic_companies: boolean;
    people: boolean;
  };
}

interface TableStats {
  name: string;
  count: number;
  description: string;
}

type FilterMode = "all" | "has_all" | "missing_any" | "specific";

export default function DataCoveragePage() {
  const [coverage, setCoverage] = useState<CompanyCoverage[]>([]);
  const [tableStats, setTableStats] = useState<TableStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [specificTableFilter, setSpecificTableFilter] = useState<string>("");
  const [specificTableHas, setSpecificTableHas] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState("");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    async function fetchData() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Supabase not configured");
        setLoading(false);
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      try {
        // Fetch data from all relevant tables
        const [companiesResult, leadmagicResult, peopleResult] = await Promise.all([
          supabase.from("companies").select("company_domain, company_name"),
          supabase.from("enrichment_leadmagic_companies").select("company_domain, company_name"),
          supabase.from("people").select("company_domain, company_name"),
        ]);

        // Build a map of all unique domains
        const domainMap = new Map<string, CompanyCoverage>();

        // Process companies table
        const companiesData = companiesResult.data || [];
        companiesData.forEach((row) => {
          if (row.company_domain) {
            const domain = row.company_domain.toLowerCase();
            if (!domainMap.has(domain)) {
              domainMap.set(domain, {
                company_domain: domain,
                company_name: row.company_name,
                tables: {
                  companies: false,
                  enrichment_leadmagic_companies: false,
                  people: false,
                },
              });
            }
            domainMap.get(domain)!.tables.companies = true;
            if (row.company_name && !domainMap.get(domain)!.company_name) {
              domainMap.get(domain)!.company_name = row.company_name;
            }
          }
        });

        // Process leadmagic table
        const leadmagicData = leadmagicResult.data || [];
        leadmagicData.forEach((row) => {
          if (row.company_domain) {
            const domain = row.company_domain.toLowerCase();
            if (!domainMap.has(domain)) {
              domainMap.set(domain, {
                company_domain: domain,
                company_name: row.company_name,
                tables: {
                  companies: false,
                  enrichment_leadmagic_companies: false,
                  people: false,
                },
              });
            }
            domainMap.get(domain)!.tables.enrichment_leadmagic_companies = true;
            if (row.company_name && !domainMap.get(domain)!.company_name) {
              domainMap.get(domain)!.company_name = row.company_name;
            }
          }
        });

        // Process people table (unique domains)
        const peopleData = peopleResult.data || [];
        const peopleDomains = new Set<string>();
        peopleData.forEach((row) => {
          if (row.company_domain) {
            const domain = row.company_domain.toLowerCase();
            peopleDomains.add(domain);
            if (!domainMap.has(domain)) {
              domainMap.set(domain, {
                company_domain: domain,
                company_name: row.company_name,
                tables: {
                  companies: false,
                  enrichment_leadmagic_companies: false,
                  people: false,
                },
              });
            }
            domainMap.get(domain)!.tables.people = true;
            if (row.company_name && !domainMap.get(domain)!.company_name) {
              domainMap.get(domain)!.company_name = row.company_name;
            }
          }
        });

        // Convert map to array and sort by domain
        const coverageArray = Array.from(domainMap.values()).sort((a, b) =>
          a.company_domain.localeCompare(b.company_domain)
        );

        setCoverage(coverageArray);

        // Calculate table stats
        setTableStats([
          {
            name: "companies",
            count: companiesData.length,
            description: "Core company records",
          },
          {
            name: "enrichment_leadmagic_companies",
            count: leadmagicData.length,
            description: "LeadMagic enriched companies",
          },
          {
            name: "people",
            count: peopleData.length,
            description: "People/contacts",
          },
        ]);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    fetchData();
  }, [supabaseUrl, supabaseAnonKey]);

  const filteredCoverage = useMemo(() => {
    let filtered = [...coverage];

    // Apply search filter
    if (searchFilter) {
      const search = searchFilter.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.company_domain.toLowerCase().includes(search) ||
          c.company_name?.toLowerCase().includes(search)
      );
    }

    // Apply coverage filter
    switch (filterMode) {
      case "has_all":
        filtered = filtered.filter(
          (c) =>
            c.tables.companies &&
            c.tables.enrichment_leadmagic_companies &&
            c.tables.people
        );
        break;
      case "missing_any":
        filtered = filtered.filter(
          (c) =>
            !c.tables.companies ||
            !c.tables.enrichment_leadmagic_companies ||
            !c.tables.people
        );
        break;
      case "specific":
        if (specificTableFilter) {
          filtered = filtered.filter((c) => {
            const hasTable = c.tables[specificTableFilter as keyof typeof c.tables];
            return specificTableHas ? hasTable : !hasTable;
          });
        }
        break;
    }

    return filtered;
  }, [coverage, filterMode, specificTableFilter, specificTableHas, searchFilter]);

  // Calculate coverage stats
  const coverageStats = useMemo(() => {
    const total = coverage.length;
    const hasAll = coverage.filter(
      (c) =>
        c.tables.companies &&
        c.tables.enrichment_leadmagic_companies &&
        c.tables.people
    ).length;
    const hasCompanies = coverage.filter((c) => c.tables.companies).length;
    const hasLeadmagic = coverage.filter((c) => c.tables.enrichment_leadmagic_companies).length;
    const hasPeople = coverage.filter((c) => c.tables.people).length;

    return { total, hasAll, hasCompanies, hasLeadmagic, hasPeople };
  }, [coverage]);

  const TableBadge = ({ has, label }: { has: boolean; label: string }) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        has
          ? "bg-green-100 text-green-800"
          : "bg-gray-100 text-gray-400"
      }`}
    >
      {has ? "✓" : "✗"} {label}
    </span>
  );

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            ← Back to Admin
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Data Coverage</h1>
        <p className="text-gray-600">Analyzing data coverage...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            ← Back to Admin
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Data Coverage</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
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

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Data Coverage</h1>
      <p className="text-gray-600 mb-6">
        See which company domains have data across different tables
      </p>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{coverageStats.total}</div>
          <div className="text-sm text-gray-500">Unique Domains</div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">{coverageStats.hasAll}</div>
          <div className="text-sm text-gray-500">Full Coverage</div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{coverageStats.hasCompanies}</div>
          <div className="text-sm text-gray-500">In Companies</div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="text-2xl font-bold text-purple-600">{coverageStats.hasLeadmagic}</div>
          <div className="text-sm text-gray-500">In LeadMagic</div>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="text-2xl font-bold text-orange-600">{coverageStats.hasPeople}</div>
          <div className="text-sm text-gray-500">Have People</div>
        </div>
      </div>

      {/* Table Stats */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Table Record Counts</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tableStats.map((stat) => (
            <div key={stat.name} className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <div>
                <div className="font-mono text-sm text-gray-900">{stat.name}</div>
                <div className="text-xs text-gray-500">{stat.description}</div>
              </div>
              <div className="text-lg font-semibold text-gray-900">
                {stat.count.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Domain or name..."
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Coverage Filter</label>
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Domains</option>
              <option value="has_all">Full Coverage (all tables)</option>
              <option value="missing_any">Missing Data (any table)</option>
              <option value="specific">Specific Table...</option>
            </select>
          </div>

          {filterMode === "specific" && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Table</label>
                <select
                  value={specificTableFilter}
                  onChange={(e) => setSpecificTableFilter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select table...</option>
                  <option value="companies">companies</option>
                  <option value="enrichment_leadmagic_companies">enrichment_leadmagic_companies</option>
                  <option value="people">people</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Condition</label>
                <select
                  value={specificTableHas ? "has" : "missing"}
                  onChange={(e) => setSpecificTableHas(e.target.value === "has")}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="has">Has data</option>
                  <option value="missing">Missing data</option>
                </select>
              </div>
            </>
          )}

          <div className="text-sm text-gray-500">
            Showing {filteredCoverage.length} of {coverage.length} domains
          </div>
        </div>
      </div>

      {/* Coverage Table */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Domain
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Company Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Data Coverage
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredCoverage.slice(0, 500).map((item) => (
                <tr key={item.company_domain} className="hover:bg-gray-50">
                  <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.company_domain}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-600">
                    {item.company_name || "—"}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <div className="flex gap-2">
                      <TableBadge has={item.tables.companies} label="companies" />
                      <TableBadge has={item.tables.enrichment_leadmagic_companies} label="leadmagic" />
                      <TableBadge has={item.tables.people} label="people" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredCoverage.length > 500 && (
          <div className="px-6 py-3 bg-gray-50 text-sm text-gray-500 text-center">
            Showing first 500 of {filteredCoverage.length} results
          </div>
        )}
      </div>
    </div>
  );
}
