import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get("mapsosa_kakao_state")?.value;
  const requestedNext = request.cookies.get("mapsosa_kakao_next")?.value ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const failureUrl = new URL(next, request.url);
  failureUrl.searchParams.set("auth_error", "kakao_login_failed");

  if (!state || !expectedState || state !== expectedState || !code) return NextResponse.redirect(failureUrl);

  const clientId = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;
  const callbackUrl = new URL("/auth/kakao/callback", request.url).toString();
  const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId ?? "",
      redirect_uri: callbackUrl,
      code,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }),
    cache: "no-store",
  });
  const tokenData = tokenResponse.ok ? await tokenResponse.json() as { id_token?: string } : null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!tokenData?.id_token || !supabaseUrl || !supabaseKey) return NextResponse.redirect(failureUrl);

  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await supabase.auth.signInWithIdToken({ provider: "kakao", token: tokenData.id_token });
  if (error) return NextResponse.redirect(failureUrl);
  response.cookies.delete("mapsosa_kakao_state");
  response.cookies.delete("mapsosa_kakao_next");
  return response;
}
