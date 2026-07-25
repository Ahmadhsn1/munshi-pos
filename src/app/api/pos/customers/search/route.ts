import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActingUserContext } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("sales.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ customers: [] });
  }

  const supabase = await createClient();

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("is_active", true)
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(10);

  return NextResponse.json({ customers: customers ?? [] });
}
