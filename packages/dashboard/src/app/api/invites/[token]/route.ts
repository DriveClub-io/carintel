import { getSupabaseAdmin } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface InviteResponse {
  id: string;
  email: string;
  organization_id: string;
  organization_name: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

interface InviteError {
  error: string;
  code: "INVALID" | "EXPIRED" | "ACCEPTED";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse<InviteResponse | InviteError>> {
  try {
    const { token } = await params;

    if (!token || token.length !== 64) {
      return NextResponse.json(
        { error: "Invalid invite link", code: "INVALID" as const },
        { status: 400 }
      );
    }

    // Use admin client to bypass RLS
    const supabase = getSupabaseAdmin();

    const { data, error: fetchError } = await supabase
      .from("user_invites")
      .select(`
        id,
        email,
        organization_id,
        role,
        expires_at,
        accepted_at,
        organizations (name)
      `)
      .eq("token", token)
      .single();

    if (fetchError || !data) {
      return NextResponse.json(
        { error: "Invalid or expired invite link", code: "INVALID" as const },
        { status: 404 }
      );
    }

    const isExpired = new Date(data.expires_at) < new Date();
    if (isExpired) {
      return NextResponse.json(
        { error: "This invite has expired", code: "EXPIRED" as const },
        { status: 410 }
      );
    }

    if (data.accepted_at) {
      return NextResponse.json(
        { error: "This invite has already been accepted", code: "ACCEPTED" as const },
        { status: 410 }
      );
    }

    // Type assertion for the joined organizations data
    // Supabase returns object for single FK join, but TS may infer array
    const orgData = data.organizations as unknown as { name: string } | null;

    return NextResponse.json({
      id: data.id,
      email: data.email,
      organization_id: data.organization_id,
      organization_name: orgData?.name || "Unknown",
      role: data.role,
      expires_at: data.expires_at,
      accepted_at: data.accepted_at,
    });
  } catch (error) {
    console.error("Error fetching invite:", error);
    return NextResponse.json(
      { error: "Failed to load invite", code: "INVALID" as const },
      { status: 500 }
    );
  }
}
