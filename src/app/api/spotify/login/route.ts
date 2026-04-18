import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3000";
  const redirectUri = `${baseUrl}/api/auth/callback/spotify`;

  const scopes = [
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-read-recently-played",
  ].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId!,
    scope: scopes,
    redirect_uri: redirectUri,
  });

  return NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
}
