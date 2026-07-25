import { NextResponse } from "next/server";
import { COUNTER_COOKIE_NAME } from "@/lib/counter-cookie";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(COUNTER_COOKIE_NAME);
  return response;
}
