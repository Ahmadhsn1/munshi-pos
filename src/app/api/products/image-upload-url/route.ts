import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActingUserContext } from "@/lib/permissions";

// Issues a short-lived signed Storage upload URL rather than proxying the file bytes through
// this route -- the client uploads directly to Storage, this only decides (and controls) the
// object path. Path is always {tenant_id}/{...}, computed server-side from the caller's own
// validated tenant, never client-supplied -- matches the storage RLS policy's path-prefix check
// in 20260725000023_product_images_storage.sql even though the admin client bypasses it anyway.
export const runtime = "nodejs";

const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
});

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  const context = await getActingUserContext();

  if (!context || !context.permissions.has("products.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const path = `${context.tenantId}/${randomUUID()}-${sanitizeFileName(parsed.data.fileName)}`;
  const admin = createAdminClient();

  const { data, error } = await admin.storage.from("product-images").createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
