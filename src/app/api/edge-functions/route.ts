import { NextResponse } from "next/server";

export async function GET() {
  const accessToken = process.env.NEXT_SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Supabase access token not configured" },
      { status: 500 }
    );
  }

  if (!supabaseUrl) {
    return NextResponse.json(
      { error: "Supabase URL not configured" },
      { status: 500 }
    );
  }

  // Extract project ref from URL
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  const projectRef = match ? match[1] : null;

  if (!projectRef) {
    return NextResponse.json(
      { error: "Could not extract project ref from Supabase URL" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/functions`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Supabase API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const functions = await response.json();
    return NextResponse.json(functions);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
