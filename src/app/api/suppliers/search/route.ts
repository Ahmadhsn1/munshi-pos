import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await getCurrentUserContext();

  if (!context || !context.permissions.has("purchases.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  const supabase = await createClient();

  let query = supabase.from("suppliers").select("id, name, phone").eq("is_active", true).limit(10);

  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  const { data: suppliers } = await query;

  return NextResponse.json({ suppliers: suppliers ?? [] });
}
