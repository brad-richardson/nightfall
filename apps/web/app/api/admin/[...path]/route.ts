import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev-admin-secret-do-not-use-in-prod";

/**
 * Server-side proxy for admin API requests.
 * This keeps ADMIN_SECRET secure on the server and never exposes it to the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const endpoint = `/api/admin/${path.join("/")}`;

  try {
    const body = await request.json().catch(() => ({}));

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_SECRET}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error(`Admin proxy error for ${endpoint}:`, error);
    return NextResponse.json(
      { ok: false, error: "proxy_error" },
      { status: 500 }
    );
  }
}
