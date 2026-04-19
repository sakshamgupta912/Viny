"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";

interface TrackData {
  title: string;
  artist: string;
  album: string;
  coverArt: string;
}

function extractDominantColor(imgUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve("#b829e3"); return; }
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // Bucket colors and pick the most vibrant one
      const buckets = new Map<string, { r: number; g: number; b: number; count: number; saturation: number }>();
      for (let i = 0; i < data.length; i += 16) { // sample every 4th pixel
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const sat = max === min ? 0 : (max - min) / (l > 127 ? (510 - max - min) : (max + min));
        // Skip very dark, very light, and very desaturated pixels
        if (l < 30 || l > 230 || sat < 0.2) continue;
        // Quantize to reduce buckets
        const qr = Math.round(r / 32) * 32;
        const qg = Math.round(g / 32) * 32;
        const qb = Math.round(b / 32) * 32;
        const key = `${qr},${qg},${qb}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.r += r; existing.g += g; existing.b += b;
          existing.count++; existing.saturation += sat;
        } else {
          buckets.set(key, { r, g, b, count: 1, saturation: sat });
        }
      }

      if (buckets.size === 0) { resolve("#b829e3"); return; }

      // Pick bucket with highest (count * avg_saturation) — vibrant AND common
      let best = { r: 184, g: 41, b: 227, score: 0 };
      for (const bucket of buckets.values()) {
        const score = bucket.count * (bucket.saturation / bucket.count);
        if (score > best.score) {
          best = {
            r: Math.round(bucket.r / bucket.count),
            g: Math.round(bucket.g / bucket.count),
            b: Math.round(bucket.b / bucket.count),
            score,
          };
        }
      }

      // Boost brightness & saturation so the accent is always vivid
      const rn = best.r / 255, gn = best.g / 255, bn = best.b / 255;
      const cmax = Math.max(rn, gn, bn), cmin = Math.min(rn, gn, bn);
      const delta = cmax - cmin;
      let h = 0;
      if (delta !== 0) {
        if (cmax === rn) h = ((gn - bn) / delta) % 6;
        else if (cmax === gn) h = (bn - rn) / delta + 2;
        else h = (rn - gn) / delta + 4;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
      // Force saturation >= 70% and lightness between 55-65% for a bright vivid color
      const boostedS = Math.max(70, Math.round(((delta === 0 ? 0 : delta / (1 - Math.abs(2 * ((cmax + cmin) / 2) - 1)))) * 100));
      const origL = Math.round(((cmax + cmin) / 2) * 100);
      const boostedL = Math.max(55, Math.min(65, origL));
      resolve(`hsl(${h}, ${Math.min(boostedS, 90)}%, ${boostedL}%)`);
    };
    img.onerror = () => resolve("#b829e3");
    img.src = imgUrl;
  });
}

interface UserData {
  name: string;
  image: string | null;
}

const DEFAULT_TRACK: TrackData = {
  title: "",
  artist: "",
  album: "",
  coverArt:
    "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=1000&auto=format&fit=crop",
};

export default function Home() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [track, setTrack] = useState<TrackData>(DEFAULT_TRACK);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [duration, setDuration] = useState(0);
  const [lastFetchedProgress, setLastFetchedProgress] = useState(0);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [themeColor, setThemeColor] = useState("#b829e3");
  const [tonearmFast, setTonearmFast] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const prevProgressRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionCooldownRef = useRef(0);

  // Sync fullscreen state with browser
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Poll Spotify for currently playing track
  const fetchInFlight = useRef(false);
  const fetchNowPlaying = useCallback(async () => {
    if (fetchInFlight.current) return;
    // Skip fetches during action cooldown to preserve optimistic UI
    if (Date.now() < actionCooldownRef.current) return;
    fetchInFlight.current = true;
    try {
      const res = await fetch("/api/spotify/now-playing");
      if (res.status === 401) {
        setAuthenticated(false);
        setIsPlaying(false);
        setUser(null);
        return;
      }
      setAuthenticated(true);
      const data = await res.json();

      if (data.user) {
        setUser(data.user);
      }

      if (data.isPlaying && data.title) {
        setIsPlaying(true);
        setTrack({
          title: data.title,
          artist: data.artist,
          album: data.album,
          coverArt: data.coverArt || DEFAULT_TRACK.coverArt,
        });
        setDuration(data.duration);
        setLastFetchedProgress(data.progress);
        setLastFetchTime(Date.now());
        setProgress((data.progress / data.duration) * 100);
      } else {
        setIsPlaying(false);
        if (data.lastPlayed?.coverArt) {
          setTrack({
            title: data.lastPlayed.title,
            artist: data.lastPlayed.artist,
            album: data.lastPlayed.album,
            coverArt: data.lastPlayed.coverArt,
          });
        }
      }
    } catch {
      // Network error — don't flip auth state, just skip this poll
    } finally {
      fetchInFlight.current = false;
    }
  }, []);

  const actionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePlayerAction = useCallback(async (action: "play" | "pause" | "next" | "previous") => {
    // Optimistic UI update immediately
    if (action === "pause") setIsPlaying(false);
    else if (action === "play") setIsPlaying(true);
    // Extend cooldown on every click so polls don't override
    actionCooldownRef.current = Date.now() + 1500;
    // Debounce the actual API call — only the last action within 300ms fires
    if (actionDebounceRef.current) clearTimeout(actionDebounceRef.current);
    actionDebounceRef.current = setTimeout(async () => {
      try {
        await fetch("/api/spotify/player", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      } catch { /* ignore */ }
      // Re-fetch after cooldown to sync with actual Spotify state
      setTimeout(fetchNowPlaying, 1200);
    }, 300);
  }, [fetchNowPlaying]);

  const handleLogout = async () => {
    setShowUserMenu(false);
    await fetch("/api/spotify/logout", { method: "POST", redirect: "manual" });
    setAuthenticated(false);
    setUser(null);
    setIsPlaying(false);
    setTrack(DEFAULT_TRACK);
  };

  // Smart polling — 3s normally, 1s when track is about to end (<5s remaining)
  const nearEndRef = useRef(false);
  const [nearEnd, setNearEnd] = useState(false);
  useEffect(() => {
    if (!isPlaying || !duration) {
      if (nearEndRef.current) {
        nearEndRef.current = false;
        setNearEnd(false);
      }
      return;
    }
    const check = setInterval(() => {
      const remaining = duration - (lastFetchedProgress + (Date.now() - lastFetchTime));
      const isNear = remaining < 5000;
      if (isNear !== nearEndRef.current) {
        nearEndRef.current = isNear;
        setNearEnd(isNear);
      }
    }, 500);
    return () => clearInterval(check);
  }, [isPlaying, duration, lastFetchedProgress, lastFetchTime]);

  useEffect(() => {
    const timeout = setTimeout(fetchNowPlaying, 0);
    const interval = setInterval(() => {
      fetchNowPlaying();
    }, nearEnd ? 1000 : 3000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [fetchNowPlaying, nearEnd]);

  // Extract dominant color from album art when it changes
  useEffect(() => {
    if (!track.coverArt) return;
    let cancelled = false;
    extractDominantColor(track.coverArt).then((color) => {
      if (!cancelled) setThemeColor(color);
    });
    return () => { cancelled = true; };
  }, [track.coverArt]);

  // Smooth client-side progress interpolation between polls
  useEffect(() => {
    if (!isPlaying || !duration) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastFetchTime;
      const currentProgress = lastFetchedProgress + elapsed;
      const pct = Math.min((currentProgress / duration) * 100, 100);
      setProgress(pct);
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, duration, lastFetchedProgress, lastFetchTime]);

  // Detect large progress jumps (seek or song change) for fast tonearm snap
  useEffect(() => {
    const delta = Math.abs(progress - prevProgressRef.current);
    if (delta > 5) {
      setTonearmFast(true);
      const timer = setTimeout(() => setTonearmFast(false), 400);
      return () => clearTimeout(timer);
    }
    prevProgressRef.current = progress;
  }, [progress]);

  // Calculate physical tonearm tracking angle (mimics real vinyl playback)
  // Rest dock: 2deg | Outer groove (song start): 10deg | Inner groove (song end): 28deg
  const tonearmAngle = isPlaying ? 10 + (progress / 100) * 18 : 2;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#050505] text-white font-sans flex items-center justify-center">
      {/* 1. Immersive Animated Canvas Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Ken Burns layer 1 — slow zoom + pan right */}
        <div
          className="absolute -inset-[30%] z-0 opacity-50 mix-blend-screen"
          style={{
            backgroundImage: `url(${track.coverArt})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(80px) saturate(250%) brightness(0.8)",
            animation: isPlaying
              ? "kenburns-1 25s ease-in-out infinite alternate"
              : "none",
            transform: isPlaying ? undefined : "scale(1.1)",
          }}
        />
        {/* Ken Burns layer 2 — slow zoom + pan left, offset timing */}
        <div
          className="absolute -inset-[30%] z-0 opacity-30 mix-blend-color-dodge"
          style={{
            backgroundImage: `url(${track.coverArt})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(100px) saturate(300%) hue-rotate(15deg) brightness(0.9)",
            animation: isPlaying
              ? "kenburns-2 30s ease-in-out infinite alternate"
              : "none",
            transform: isPlaying ? undefined : "scale(1.05)",
          }}
        />
        {/* Ken Burns layer 3 — subtle counter-rotation */}
        <div
          className="absolute -inset-[20%] z-0 opacity-20 mix-blend-screen"
          style={{
            backgroundImage: `url(${track.coverArt})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(120px) saturate(200%) hue-rotate(-20deg)",
            animation: isPlaying
              ? "kenburns-3 35s ease-in-out infinite alternate"
              : "none",
            transform: isPlaying ? undefined : "scale(1)",
          }}
        />
        {/* Theme color radial wash */}
        <div
          className="absolute inset-0 opacity-25 transition-colors duration-1000"
          style={{
            background: `radial-gradient(ellipse at 30% 50%, ${themeColor} 0%, transparent 70%)`,
          }}
        />
        {/* Secondary theme wash — opposite corner */}
        <div
          className="absolute inset-0 opacity-15 transition-colors duration-1000"
          style={{
            background: `radial-gradient(ellipse at 75% 70%, ${themeColor} 0%, transparent 60%)`,
          }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0 z-10"
          style={{
            background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
          }}
        />
        <div
          className="absolute inset-0 z-0 opacity-[0.04] mix-blend-overlay"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")',
          }}
        />
      </div>

      <div
        className="absolute left-1/2 top-1/2 z-0 pointer-events-none"
        style={{
          width: "min(80vw, 800px)",
          height: "min(80vw, 800px)",
          transform: "translate(-65%, -55%) rotate(-6deg) scale(1)",
          opacity: 0.25,
          animationName: "album-float",
          animationDuration: "20s",
          animationTimingFunction: "ease-in-out",
          animationIterationCount: "infinite",
          animationDirection: "alternate",
          animationFillMode: "forwards",
          animationPlayState: isPlaying ? "running" : "paused",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={track.coverArt}
          alt="Album Jacket"
          className="w-full h-full object-cover rounded-xl shadow-[0_0_50px_rgba(0,0,0,1)]"
        />
      </div>

      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_0%,#050505_85%)] opacity-80 pointer-events-none" />

      {/* 2. The Centerpiece: Massive Minimalist Turntable */}
      <div
        className="relative z-10 p-5 md:p-10 pb-3 md:pb-6 rounded-4xl md:rounded-[4rem] bg-white/2 backdrop-blur-3xl border border-white/2 shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col items-center justify-center group transition-transform duration-500 hover:scale-[1.02]"
      >
        <div className="absolute inset-0 rounded-4xl md:rounded-[4rem] bg-white/0 group-hover:bg-white/1 transition-colors duration-500 pointer-events-none" />

        <div className="relative group perspective-1000">
          {/* Metallic Platter Rim */}
          <div className="absolute inset-0 rounded-full bg-linear-to-tr from-gray-800 via-gray-400 to-gray-900 scale-[1.005] shadow-2xl pointer-events-none" />

          {/* 360-Degree Circular Progress Ring */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-20 scale-[1.008]"
            viewBox="0 0 100 100"
            style={{ transform: "rotate(-90deg)" }}
          >
            <circle
              cx="50"
              cy="50"
              r="49.5"
              fill="transparent"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="0.3"
            />
            <circle
              cx="50"
              cy="50"
              r="49.5"
              fill="transparent"
              stroke={themeColor}
              strokeWidth="0.35"
              strokeLinecap="round"
              strokeDasharray={311.018}
              strokeDashoffset={311.018 - (progress / 100) * 311.018}
              className="transition-all duration-100 ease-linear"
              style={{ filter: `drop-shadow(0 0 2px ${themeColor})`, opacity: 0.8 }}
            />
          </svg>

          {/* Vinyl Record Body */}
          <div
            className="relative w-80 h-80 md:w-140 md:h-140 rounded-full bg-[#080808] shadow-[inset_0_0_40px_rgba(0,0,0,1)] flex items-center justify-center border border-[#1a1a1a] overflow-hidden"
            style={{
              animation: "spin 4s linear infinite",
              animationPlayState: isPlaying ? "running" : "paused",
              backgroundImage:
                "repeating-radial-gradient(#111 0px, #050505 2px, #111 4px)",
            }}
          >
            {/* PVC Surface Dust & Micro-scratches Texture */}
            <div
              className="absolute inset-0 z-0 opacity-20 mix-blend-screen pointer-events-none"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noise%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%221.5%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noise)%22 opacity=%220.5%22/%3E%3C/svg%3E")',
              }}
            />

            {/* Dead Wax */}
            <div className="absolute w-[40%] h-[40%] rounded-full bg-[#0a0a0a] border border-[#1a1a1a] z-10" />

            {/* Record Label */}
            <div className="relative w-[30%] h-[30%] rounded-full overflow-hidden border-4 border-[#0a0a0a] shadow-[inset_0_0_15px_rgba(0,0,0,0.8)] flex items-center justify-center z-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={track.coverArt}
                alt="Album Cover"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/10 mix-blend-multiply" />
            </div>

            {/* Spindle */}
            <div className="absolute w-3 h-3 md:w-3.5 md:h-3.5 bg-linear-to-br bg-red-50 rounded-full border-[0.5px] border-black shadow-[0_2px_4px_rgba(0,0,0,0.5)] z-20" />
          </div>

          {/* Stationary Anisotropic Highlights */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none mix-blend-screen opacity-80"
            style={{
              background:
                "conic-gradient(from 150deg, transparent 0%, rgba(255,255,255,0.08) 8%, transparent 16%, transparent 50%, rgba(255,255,255,0.08) 58%, transparent 66%)",
              WebkitMaskImage:
                "radial-gradient(circle, transparent 15%, black 15.5%)",
              maskImage:
                "radial-gradient(circle, transparent 15%, black 15.5%)",
            }}
          />

          <div
            className="absolute inset-0 rounded-full pointer-events-none mix-blend-screen"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.05) 100%)",
            }}
          />

          {/* Tonearm Assembly */}
          <div className="absolute top-0 right-0 w-full h-full pointer-events-none z-30 filter drop-shadow-2xl">
            {/* Pivot */}
            <div className="absolute top-2 -right-2 md:top-6 md:-right-8 w-16 h-16 md:w-24 md:h-24 rounded-full bg-linear-to-br from-[#333] to-[#0a0a0a] border-2 border-[#222] shadow-[inset_0_2px_10px_rgba(255,255,255,0.1)] flex items-center justify-center z-40">
              <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-black shadow-inner flex items-center justify-center">
                <div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-gray-400 shadow-sm" />
              </div>
            </div>

            {/* Tracking Arm */}
            <div
              className="absolute top-10 right-4 md:top-16 md:right-0 w-3 h-48 md:w-4 md:h-88 origin-top z-30"
              style={{
                transform: `rotate(${tonearmAngle}deg)`,
                transition: `transform ${!isPlaying ? "1.2s" : tonearmFast ? "0.4s" : "3s"} cubic-bezier(0.25, 0.1, 0.25, 1)`,
              }}
            >
              {/* Rod */}
              <div className="w-full h-full bg-linear-to-r from-gray-500 via-gray-200 to-gray-600 rounded-full shadow-[2px_0_5px_rgba(0,0,0,0.5)]" />

              {/* Counterweight */}
              <div className="absolute -top-8 -left-2 md:-top-12 md:-left-2.5 w-7 h-10 md:w-9 md:h-16 bg-linear-to-br from-[#222] to-black rounded-sm shadow-md" />

              {/* Headshell & Cartridge */}
              <div
                className="absolute bottom-0 -left-2 md:-left-3 w-8 h-14 md:w-12 md:h-20 bg-linear-to-b from-[#1a1a1a] to-[#050505] rounded-sm shadow-[0_20px_20px_rgba(0,0,0,0.8)] border-t-[3px] md:border-t-[5px] border-gray-300 flex justify-center"
                style={{
                  transform: "rotate(24deg)",
                  transformOrigin: "top center",
                }}
              >
                {/* Stylus Status Light */}
                <div
                  className="w-1.5 h-3 md:w-2 md:h-4 mt-1 rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: isPlaying
                      ? themeColor
                      : "#ef4444",
                    boxShadow: isPlaying
                      ? `0 0 10px ${themeColor}`
                      : "0 0 8px #ef4444",
                    opacity: isPlaying ? 1 : 0.6,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        {authenticated === true && (
          <div className="relative z-40 flex items-center justify-center gap-6 md:gap-8 mt-3 md:mt-5">
            {/* Previous */}
            <button
              onClick={() => handlePlayerAction("previous")}
              className="text-white/30 hover:text-white/70 transition-colors duration-300"
              aria-label="Previous track"
            >
              <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>

            {/* Play / Pause */}
            <button
              onClick={() => handlePlayerAction(isPlaying ? "pause" : "play")}
              className="text-white/40 hover:text-white/80 transition-colors duration-300"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg className="w-5 h-5 md:w-6 md:h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg className="w-5 h-5 md:w-6 md:h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            {/* Next */}
            <button
              onClick={() => handlePlayerAction("next")}
              className="text-white/30 hover:text-white/70 transition-colors duration-300"
              aria-label="Next track"
            >
              <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* 3. Minimalist Track Information */}
      <div className="absolute bottom-6 left-8 md:bottom-10 md:left-16 z-20 flex flex-col max-w-2xl pointer-events-none">
        {authenticated === true && !isPlaying && (
          <>
            <div className="flex items-center gap-2 mb-4 opacity-50">
              <div className="w-2 h-2 rounded-full bg-[#1DB954] animate-pulse" />
              <span className="text-xs uppercase tracking-widest text-white/50 font-medium">
                Connected to Spotify
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter text-white/40 drop-shadow-lg mb-1 md:mb-2">
              Waiting to play
            </h1>
            <h2 className="text-xl md:text-3xl text-white/25 font-light tracking-wide drop-shadow-md">
              Play something on any device
            </h2>
          </>
        )}

        {authenticated === true && isPlaying && (
          <>
            <div
              className="flex items-end gap-0.75 h-4 mb-4 transition-opacity duration-500 opacity-100"
            >
              <div className="w-1.5 bg-white rounded-full animate-eq-1" />
              <div className="w-1.5 bg-white rounded-full animate-eq-2" />
              <div className="w-1.5 bg-white rounded-full animate-eq-3" />
              <div className="w-1.5 bg-white rounded-full animate-eq-4" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter text-white drop-shadow-lg mb-1 md:mb-2 truncate">
              {track.title}
            </h1>
            <h2 className="text-xl md:text-3xl text-white/60 font-light tracking-wide drop-shadow-md">
              {track.artist}
            </h2>
          </>
        )}

        {authenticated === false && (
          <>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter text-white/30 drop-shadow-lg mb-1 md:mb-2">
              Viny
            </h1>
            <h2 className="text-xl md:text-3xl text-white/20 font-light tracking-wide drop-shadow-md">
              Connect Spotify to get started
            </h2>
          </>
        )}
      </div>

      {/* 4. Spotify Connect Button (not authenticated) */}
      {authenticated === false && (
        <a
          href="/api/spotify/login"
          className="absolute bottom-8 right-8 md:bottom-16 md:right-16 z-20 flex items-center gap-3 px-6 py-3 rounded-full bg-[#1DB954] text-black font-semibold text-sm md:text-base transition-all hover:scale-105 hover:bg-[#1ed760] shadow-[0_0_30px_rgba(29,185,84,0.3)]"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Connect Spotify
        </a>
      )}

      {/* 5. User Avatar & Menu (authenticated) */}
      {authenticated === true && user && (
        <div ref={menuRef} className="absolute top-6 right-6 md:top-10 md:right-10 z-30">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-10 h-10 md:w-12 md:h-12 rounded-full overflow-hidden border-2 border-white/10 hover:border-white/30 transition-all hover:scale-110 shadow-lg bg-white/10 backdrop-blur-sm"
          >
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/60 text-sm font-bold">
                {user.name?.charAt(0)?.toUpperCase() || "?"}
              </div>
            )}
          </button>

          {showUserMenu && (
            <div className="absolute top-14 md:top-16 right-0 bg-[#1a1a1a]/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl min-w-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5">
                <p className="text-sm font-medium text-white truncate">{user.name}</p>
                <p className="text-xs text-white/40 mt-0.5">Spotify Connected</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full px-4 py-3 text-left text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" />
                </svg>
                Log out
              </button>
              <a
                  href="https://github.com/sakshamgupta912"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 border-t border-white/5 flex items-center justify-center gap-2 text-xs text-white/30 hover:text-white/50 transition-colors w-full"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  Made by Saksham Gupta
                </a>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Toggle */}
      <button
        onClick={toggleFullscreen}
        className="absolute bottom-6 right-6 md:bottom-10 md:right-10 z-20 text-white/20 hover:text-white/60 transition-colors duration-300"
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        {isFullscreen ? (
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.00001 18.0001L9.00001 17.0001C9.00001 15.8956 8.10458 15.0001 7.00001 15.0001H6.00001M15 18.0001V17.0001C15 15.8956 15.8954 15.0001 17 15.0001L18 15.0001M9 6.00012L9 7.00012C9 8.10469 8.10457 9.00012 7 9.00012L6 9.00012M15 6.00014L15 7.00014C15 8.10471 15.8954 9.00014 17 9.00014L18 9.00014"/>
          </svg>
        ) : (
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 15V16C6 17.1046 6.89543 18 8 18H9M18 15V16C18 17.1046 17.1046 18 16 18H15M6 9V8C6 6.89543 6.89543 6 8 6H9M18 9V8C18 6.89543 17.1046 6 16 6H15"/>
          </svg>
        )}
      </button>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes kenburns-1 {
          0% { transform: scale(1.0) translate(0%, 0%); }
          100% { transform: scale(1.3) translate(5%, -3%); }
        }
        @keyframes kenburns-2 {
          0% { transform: scale(1.1) translate(0%, 0%) rotate(0deg); }
          100% { transform: scale(1.35) translate(-6%, 4%) rotate(3deg); }
        }
        @keyframes kenburns-3 {
          0% { transform: scale(1.0) translate(0%, 0%) rotate(0deg); }
          100% { transform: scale(1.2) translate(3%, 5%) rotate(-2deg); }
        }
        @keyframes album-float {
          0% { transform: translate(-65%, -55%) rotate(-6deg) scale(1); }
          33% { transform: translate(-63%, -57%) rotate(-4deg) scale(1.03); }
          66% { transform: translate(-67%, -53%) rotate(-8deg) scale(1.01); }
          100% { transform: translate(-64%, -56%) rotate(-5deg) scale(1.04); }
        }
        @keyframes eq-1 { 0%, 100% { height: 6px; } 50% { height: 16px; } }
        @keyframes eq-2 { 0%, 100% { height: 16px; } 50% { height: 6px; } }
        @keyframes eq-3 { 0%, 100% { height: 10px; } 50% { height: 14px; } }
        @keyframes eq-4 { 0%, 100% { height: 14px; } 50% { height: 8px; } }
        .animate-eq-1 { animation: eq-1 0.7s ease-in-out infinite; }
        .animate-eq-2 { animation: eq-2 0.7s ease-in-out infinite 0.2s; }
        .animate-eq-3 { animation: eq-3 0.7s ease-in-out infinite 0.4s; }
        .animate-eq-4 { animation: eq-4 0.7s ease-in-out infinite 0.1s; }
      `,
        }}
      />
    </div>
  );
}
