import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const clientId = process.env.KAKAO_REST_API_KEY;
  if (!clientId) return NextResponse.redirect(new URL("/?auth_error=kakao_not_configured", request.url));

  const state = crypto.randomUUID();
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const callbackUrl = new URL("/auth/kakao/callback", request.url).toString();
  const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid",
    state,
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  const cookieOptions = { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set("mapsosa_kakao_state", state, cookieOptions);
  response.cookies.set("mapsosa_kakao_next", next, cookieOptions);
  return response;
}
