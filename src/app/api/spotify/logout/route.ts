import { NextResponse } from "next/server";

export async function POST() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3000";
  const response = NextResponse.redirect(new URL("/", baseUrl));

  response.cookies.set("spotify_access_token", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  response.cookies.set("spotify_refresh_token", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });

  return response;
}
