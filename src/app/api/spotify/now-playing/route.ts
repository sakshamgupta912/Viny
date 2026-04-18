import { NextRequest, NextResponse } from "next/server";

interface SpotifyImage {
  url: string;
  height: number;
  width: number;
}

interface SpotifyArtist {
  name: string;
}

interface SpotifyTrack {
  name: string;
  artists: SpotifyArtist[];
  album: {
    name: string;
    images: SpotifyImage[];
  };
  duration_ms: number;
}

interface SpotifyPlaybackResponse {
  is_playing: boolean;
  progress_ms: number;
  item: SpotifyTrack;
}

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

async function fetchNowPlaying(accessToken: string) {
  const res = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res;
}

async function fetchUserProfile(accessToken: string) {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    name: data.display_name,
    image: data.images?.[0]?.url || null,
  };
}

async function fetchRecentlyPlayed(accessToken: string) {
  const res = await fetch(
    "https://api.spotify.com/v1/me/player/recently-played?limit=1",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.items?.[0]?.track;
  if (!item) return null;
  const coverArt =
    item.album.images.sort((a: SpotifyImage, b: SpotifyImage) => b.width - a.width)[0]?.url || "";
  return {
    title: item.name,
    artist: item.artists.map((a: SpotifyArtist) => a.name).join(", "),
    album: item.album.name,
    coverArt,
  };
}

function parseTrackData(data: SpotifyPlaybackResponse) {
  const track = data.item;
  if (!track) return { isPlaying: false };

  // Pick the largest album image
  const coverArt =
    track.album.images.sort((a, b) => b.width - a.width)[0]?.url || "";

  return {
    isPlaying: data.is_playing,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    album: track.album.name,
    coverArt,
    progress: data.progress_ms,
    duration: track.duration_ms,
  };
}

export async function GET(request: NextRequest) {
  let accessToken = request.cookies.get("spotify_access_token")?.value;
  const refreshToken = request.cookies.get("spotify_refresh_token")?.value;

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  let res = await fetchNowPlaying(accessToken || "");

  // Token expired — try refresh
  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (!refreshed) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    accessToken = refreshed.access_token;
    res = await fetchNowPlaying(accessToken!);
    const user = await fetchUserProfile(accessToken!);

    // Build response with refreshed cookie
    const trackData =
      res.status === 204 || !res.ok
        ? { isPlaying: false, lastPlayed: await fetchRecentlyPlayed(accessToken!) }
        : parseTrackData(await res.json());

    const response = NextResponse.json({ ...trackData, user });
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

  if (res.status === 204 || !res.ok) {
    const user = await fetchUserProfile(accessToken!);
    const lastPlayed = await fetchRecentlyPlayed(accessToken!);
    return NextResponse.json({ isPlaying: false, user, lastPlayed });
  }

  const data: SpotifyPlaybackResponse = await res.json();
  const user = await fetchUserProfile(accessToken!);
  return NextResponse.json({ ...parseTrackData(data), user });
}
