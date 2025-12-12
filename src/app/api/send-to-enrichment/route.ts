import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { webhookUrl, payload } = body;

    if (!webhookUrl) {
      return NextResponse.json(
        { error: "No webhook URL provided" },
        { status: 400 }
      );
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Webhook returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    let responseData;
    try {
      responseData = await response.json();
    } catch {
      responseData = { success: true };
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Error sending to enrichment:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
