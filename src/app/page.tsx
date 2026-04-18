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
  const menuRef = useRef<HTMLDivElement>(null);

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
  const fetchNowPlaying = useCallback(async () => {
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
      setAuthenticated(false);
    }
  }, []);

  const handleLogout = async () => {
    setShowUserMenu(false);
    await fetch("/api/spotify/logout", { method: "POST", redirect: "manual" });
    setAuthenticated(false);
    setUser(null);
    setIsPlaying(false);
    setTrack(DEFAULT_TRACK);
  };

  // Initial fetch + poll every 3 seconds
  useEffect(() => {
    const timeout = setTimeout(fetchNowPlaying, 0);
    const interval = setInterval(fetchNowPlaying, 3000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [fetchNowPlaying]);

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

  // Calculate physical tonearm tracking angle
  // Rest dock: 12deg | Start of record: 22deg | End of record (inner groove): 40deg
  const tonearmAngle = isPlaying ? 22 + (progress / 100) * 18 : 12;

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
        className="absolute left-1/2 top-1/2 z-0 pointer-events-none transition-transform duration-3000 ease-out"
        style={{
          width: "min(80vw, 800px)",
          height: "min(80vw, 800px)",
          transform: `translate(-65%, -55%) ${isPlaying ? "rotate(-6deg) scale(1)" : "rotate(-10deg) scale(0.95)"}`,
          opacity: 0.15,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={track.coverArt}
          alt="Album Jacket"
          className="w-full h-full object-cover rounded-xl shadow-[0_0_50px_rgba(0,0,0,1)]"
        />
      </div>

      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_0%,#050505_85%)] opacity-100 pointer-events-none" />

      {/* 2. The Centerpiece: Massive Minimalist Turntable */}
      <div
        className="relative z-10 p-4 md:p-8 rounded-full md:rounded-[4rem] bg-white/2 backdrop-blur-3xl border border-white/2 shadow-[0_0_100px_rgba(0,0,0,0.8)] flex items-center justify-center group transition-transform duration-500 hover:scale-[1.02]"
      >
        <div className="absolute inset-0 rounded-[4rem] bg-white/0 group-hover:bg-white/1 transition-colors duration-500 pointer-events-none" />

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
            <div className="absolute w-4 h-4 md:w-5 md:h-5 bg-linear-to-br from-gray-300 to-gray-600 rounded-full border border-black shadow-[0_2px_4px_rgba(0,0,0,0.5)] z-20" />
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
              className="absolute top-10 right-4 md:top-16 md:right-0 w-3 h-48 md:w-4 md:h-88 origin-top transition-transform duration-1500 z-30"
              style={{
                transform: `rotate(${tonearmAngle}deg)`,
                transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
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
      </div>

      {/* 3. Minimalist Track Information */}
      <div className="absolute bottom-8 left-8 md:bottom-16 md:left-16 z-20 flex flex-col max-w-2xl pointer-events-none">
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
            </div>
          )}
        </div>
      )}

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
