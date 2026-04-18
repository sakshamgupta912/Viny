<div align="center">

<img src="src/app/icon.svg" alt="Viny Logo" width="80" />

# 🎵 Viny

**A vinyl record player visualizer powered by Spotify**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)](LICENSE)

</div>

---

## ✨ About

**Viny** brings the nostalgic aesthetic of a vinyl record player to your screen. Connect your Spotify account and watch your currently playing track come to life — complete with album art, dominant color extraction, and a spinning vinyl animation.

## 🚀 Features

- 🎧 **Spotify Integration** — Real-time now-playing data via Spotify Web API
- 🎨 **Dynamic Theming** — Extracts dominant colors from album art for a vibrant, adaptive UI
- 💿 **Vinyl Animation** — Smooth spinning record visualization
- ⚡ **Built with Next.js 16** — App Router, server components, and API routes
- 🎯 **Fully Typed** — End-to-end TypeScript

## 📸 Preview

> Connect your Spotify account and start playing a track to see Viny in action!

## 🛠️ Tech Stack

| Technology | Purpose |
|:--|:--|
| **Next.js 16** | Framework & API routes |
| **React 19** | UI rendering |
| **Tailwind CSS 4** | Styling |
| **TypeScript 5** | Type safety |
| **Spotify Web API** | Music data |

## 📦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v18+)
- A [Spotify Developer](https://developer.spotify.com/dashboard) application

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/viny.git
cd viny

# Install dependencies
npm install
```

### Environment Variables

Create a `.env.local` file in the root directory:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback/spotify
```

### Run

```bash
# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see Viny in action.

## 📁 Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Main vinyl visualizer
│   ├── globals.css         # Global styles
│   ├── favicon.ico         # App icon
│   └── api/
│       ├── auth/callback/spotify/   # OAuth callback
│       └── spotify/
│           ├── login/               # Spotify login
│           ├── logout/              # Spotify logout
│           └── now-playing/         # Now playing endpoint
public/                     # Static assets
```

## 📜 License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.

Copyright © 2026 **Saksham Gupta**

---

<div align="center">

Made with ❤️ and 🎶

</div>
