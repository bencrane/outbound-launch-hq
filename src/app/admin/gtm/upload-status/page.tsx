"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

interface CompanyUploadStatus {
  id: string;
  company_name: string | null;
  company_domain: string | null;
  case_study_count: number;
}

export default function GTMUploadStatusPage() {
  const [companies, setCompanies] = useState<CompanyUploadStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const gtmUrl = process.env.NEXT_PUBLIC_GTM_SUPABASE_URL;
  const gtmAnonKey = process.env.NEXT_PUBLIC_GTM_SUPABASE_ANON_KEY;

  useEffect(() => {
    async function fetchData() {
      if (!gtmUrl || !gtmAnonKey) {
        setLoading(false);
        return;
      }

      const supabase = createClient(gtmUrl, gtmAnonKey);

      // Get all target companies
      const { data: companiesData } = await supabase
        .from("hq_target_companies")
        .select("id, company_name, company_domain")
        .order("company_domain");

      // Get case study counts per company
      const { data: caseStudies } = await supabase
        .from("case_study_urls")
        .select("hq_target_company_id");

      // Count case studies per company
      const countMap = new Map<string, number>();
      caseStudies?.forEach((cs) => {
        const count = countMap.get(cs.hq_target_company_id) || 0;
        countMap.set(cs.hq_target_company_id, count + 1);
      });

      const result: CompanyUploadStatus[] = (companiesData || []).map((c) => ({
        id: c.id,
        company_name: c.company_name,
        company_domain: c.company_domain,
        case_study_count: countMap.get(c.id) || 0,
      }));

      setCompanies(result);
      setLoading(false);
    }

    fetchData();
  }, [gtmUrl, gtmAnonKey]);

  const totalCaseStudies = companies.reduce((sum, c) => sum + c.case_study_count, 0);

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to Admin
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">GTM Upload Status</h1>
      <p className="text-gray-600 mb-6">Overview of uploaded data in GTM Teaser Demo DB</p>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 max-w-md">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">{companies.length}</div>
              <div className="text-sm text-gray-500">Target Companies</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">{totalCaseStudies}</div>
              <div className="text-sm text-gray-500">Case Study URLs</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Case Studies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {companies.map((company) => (
                  <tr key={company.id}>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {company.company_name || "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {company.company_domain || "—"}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {company.case_study_count > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {company.case_study_count} uploaded
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
