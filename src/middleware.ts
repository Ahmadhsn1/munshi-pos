import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COUNTER_COOKIE_NAME } from "@/lib/counter-cookie";

const PUBLIC_PATHS = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the JWT against the Auth server on every call. getSession() only reads
  // the cookie's embedded claims without revalidating -- using it here would let a
  // tampered/stale cookie pass route protection. This is a documented @supabase/ssr footgun,
  // not a style preference.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isPublicPath) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // The counter-login cookie identifies "who's at the counter" and must never outlive the real
  // owner/manager session it's layered on top of -- drop it the moment that session is gone.
  if (!user && request.cookies.has(COUNTER_COOKIE_NAME)) {
    response.cookies.delete(COUNTER_COOKIE_NAME);
  }

  return response;
}

export const config = {
  // /api/* is deliberately excluded. Route Handlers do their own auth (getActingUserContext /
  // getUser) and return proper 401/403 JSON on failure -- they must never get the page-guard's
  // redirect-to-/login treatment, which turns a POST into a redirected response whose body is
  // login-page HTML instead of JSON (silently breaks res.json() client-side, e.g. during signup,
  // where there's understandably no session yet to redirect on).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
