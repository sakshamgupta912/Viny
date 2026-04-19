import { NextRequest, NextResponse } from "next/server";

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;
  return res.json();
}

const ACTIONS: Record<string, { endpoint: string; method: string }> = {
  play: { endpoint: "https://api.spotify.com/v1/me/player/play", method: "PUT" },
  pause: { endpoint: "https://api.spotify.com/v1/me/player/pause", method: "PUT" },
  next: { endpoint: "https://api.spotify.com/v1/me/player/next", method: "POST" },
  previous: { endpoint: "https://api.spotify.com/v1/me/player/previous", method: "POST" },
};

export async function POST(request: NextRequest) {
  let accessToken = request.cookies.get("spotify_access_token")?.value;
  const refreshToken = request.cookies.get("spotify_refresh_token")?.value;

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { action } = await request.json();
  const config = ACTIONS[action];
  if (!config) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  let res = await fetch(config.endpoint, {
    method: config.method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // Token expired — try refresh
  if ((res.status === 401 || res.status === 403) && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (!refreshed) {
      return NextResponse.json({ error: "Token refresh failed" }, { status: 401 });
    }

    accessToken = refreshed.access_token;
    res = await fetch(config.endpoint, {
      method: config.method,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set("spotify_access_token", accessToken!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: refreshed.expires_in,
      path: "/",
    });
    if (refreshed.refresh_token) {
      response.cookies.set("spotify_refresh_token", refreshed.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }
    return response;
  }

  return NextResponse.json({ ok: res.ok });
}
