export interface Company {
  id: string;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  person_linkedin_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PDLCompany {
  id: string;
  name: string | null;
  website: string | null;
  linkedin_url: string | null;
  industry: string | null;
  country: string | null;
  region: string | null;
  locality: string | null;
  size: string | null;
  founded: number | null;
}

export interface LeadMagicCompany {
  id: string;
  company_linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  industry: string | null;
  employee_count_min: number | null;
  employee_count_max: number | null;
  country: string | null;
  data: string | null; // JSON string with full enrichment data
  created_at: string;
}

// Parsed structure of the LeadMagic 'data' JSON field
export interface LeadMagicEnrichmentData {
  url: string | null;
  hashtag: string | null;
  message: string | null;
  revenue: number | null;
  tagline: string | null;
  industry: string | null;
  logo_url: string | null;
  companyId: number | null;
  foundedOn: {
    day: number | null;
    year: number | null;
    month: number | null;
  } | null;
  locations: Array<{
    city: string | null;
    line1: string | null;
    line2: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    postalCode: string | null;
    description: string | null;
    headquarter: boolean;
    localizedName: string | null;
    geographicArea: string | null;
  }>;
  websiteUrl: string | null;
  companyName: string | null;
  competitors: string[];
  description: string | null;
  headquarter: {
    city: string | null;
    line1: string | null;
    line2: string | null;
    country: string | null;
    postalCode: string | null;
    description: string | null;
    geographicArea: string | null;
  } | null;
  twitter_url: string | null;
  facebook_url: string | null;
  founded_year: string | null;
  linkedin_url: string | null;
  specialities: string[];
  stock_ticker: string | null;
  employeeCount: number | null;
  followerCount: number | null;
  total_funding: string | null; // e.g., "150K", "82M"
  universalName: string | null;
  employee_range: string | null;
  funding_rounds: number | null;
  credits_consumed: number | null;
  ownership_status: string | null;
  last_funding_date: string | null; // e.g., "Apr 2020", "Feb 2025"
  revenue_formatted: string | null;
  acquisitions_count: number | null;
  employeeCountRange: {
    end: number | null;
    start: number | null;
  } | null;
  last_funding_round: string | null; // e.g., "Series B"
  last_funding_amount: number | null; // actual number in dollars
}

// Extended type with parsed data for use in UI
export interface LeadMagicCompanyWithParsedData extends LeadMagicCompany {
  parsedData: LeadMagicEnrichmentData | null;
}

// Helper to parse the data JSON field
export function parseLeadMagicData(dataStr: string | null): LeadMagicEnrichmentData | null {
  if (!dataStr) return null;
  try {
    return JSON.parse(dataStr) as LeadMagicEnrichmentData;
  } catch {
    return null;
  }
}

// Helper to parse funding string like "150K", "82M" to number
export function parseFundingAmount(fundingStr: string | null): number | null {
  if (!fundingStr || fundingStr === "0") return 0;

  const match = fundingStr.match(/^([\d.]+)([KMB])?$/i);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const suffix = match[2]?.toUpperCase();

  switch (suffix) {
    case "K":
      return num * 1000;
    case "M":
      return num * 1000000;
    case "B":
      return num * 1000000000;
    default:
      return num;
  }
}

export interface EnrichmentWorkflow {
  id: string;
  name: string;
  description: string | null;
  pipedream_webhook_url: string | null;
  n8n_webhook_url_test: string | null;
  n8n_webhook_url_prod: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DBDrivenEnrichmentWorkflow {
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
  storage_worker_function_url: string | null;
  source_table_name: string | null;
  source_table_company_fk: string | null;
  source_table_select_columns: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: Company;
        Insert: Omit<Company, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Company, "id">>;
      };
      people: {
        Row: Person;
        Insert: Omit<Person, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Person, "id">>;
      };
      pdl_companies: {
        Row: PDLCompany;
        Insert: Omit<PDLCompany, "id">;
        Update: Partial<Omit<PDLCompany, "id">>;
      };
      enrichment_workflows: {
        Row: EnrichmentWorkflow;
        Insert: Omit<EnrichmentWorkflow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<EnrichmentWorkflow, "id">>;
      };
      enrichment_leadmagic_companies: {
        Row: LeadMagicCompany;
        Insert: Omit<LeadMagicCompany, "id" | "created_at">;
        Update: Partial<Omit<LeadMagicCompany, "id">>;
      };
    };
  };
}
