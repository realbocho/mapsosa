import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get("mapsosa_kakao_state")?.value;
  const requestedNext = request.cookies.get("mapsosa_kakao_next")?.value ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const failureUrl = new URL(next, request.url);
  const fail = (reason: string) => {
    const url = new URL(failureUrl);
    url.searchParams.set("auth_error", reason);
    return NextResponse.redirect(url);
  };

  if (request.nextUrl.searchParams.has("error")) return fail("kakao_cancelled");
  if (!state || !expectedState || state !== expectedState) return fail("kakao_state_mismatch");
  if (!code) return fail("kakao_code_missing");

  const clientId = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;
  if (!clientId) return fail("kakao_not_configured");
  const callbackUrl = new URL("/auth/kakao/callback", request.url).toString();
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: callbackUrl,
        code,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }),
      cache: "no-store",
    });
  } catch {
    console.error("Kakao token endpoint could not be reached");
    return fail("kakao_token_unreachable");
  }
  const tokenData = tokenResponse.ok ? await tokenResponse.json() as { id_token?: string } : null;
  if (!tokenResponse.ok) {
    console.error("Kakao token exchange rejected", tokenResponse.status);
    return fail("kakao_token_rejected");
  }
  if (!tokenData?.id_token) {
    console.error("Kakao token response did not include an OpenID ID token");
    return fail("kakao_openid_missing");
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return fail("supabase_not_configured");

  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await supabase.auth.signInWithIdToken({ provider: "kakao", token: tokenData.id_token });
  if (error) {
    console.error("Supabase rejected Kakao ID token", error.status, error.code);
    return fail("supabase_rejected_kakao_token");
  }
  response.cookies.delete("mapsosa_kakao_state");
  response.cookies.delete("mapsosa_kakao_next");
  return response;
}
