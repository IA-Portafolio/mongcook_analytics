# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Moongcook Analytics — a restaurant management analytics dashboard for Chilean market, built on Toteat POS data. Spanish-language UI with CLP currency formatting.

## Commands

```bash
npm run dev        # Start Express server (tsx server.ts) which serves both API and Vite frontend
npm run build      # Production build (vite build)
npm run preview    # Preview production build
npm run lint       # Type-check only (tsc --noEmit) — no linter like ESLint
npm run clean      # Remove dist/
```

No test framework is configured.

## Architecture

Full-stack monolith: Express backend (`server.ts`) + React SPA (`src/`), SQLite database (`db.ts`).

**Backend** (`server.ts`):
- Express serves API endpoints and proxies to Vite dev server in development
- SQLite via better-sqlite3 with `moongcook.db`
- API routes: `/api/health`, `/api/metrics/summary`, `/api/metrics/comparative-type`, `/api/data/seed`
- Google Gemini AI integration via `@google/genai` (requires `GEMINI_API_KEY`)

**Frontend** (`src/`):
- Single-file app structure in `App.tsx` — contains all views and components
- Views: SummaryView (KPIs + charts), ComparativeTypeView (personal vs non-personal), ChannelView (by sales channel)
- Recharts for charts, Motion for animations, Lucide for icons
- Tailwind CSS v4 via Vite plugin (no separate config file)

**Database** (`db.ts`):
- `sales_data` table: date, product_name, family, channel, quantity, total_price, total_cost, is_personal
- `uploads` table: file upload tracking
- Indexes on date and channel columns

## Key Conventions

- Path alias: `@/*` maps to project root
- Custom fonts: Inter (sans), Playfair Display (serif), JetBrains Mono (mono)
- Brand colors: `#141414` (black), `#F27D26` (orange), `#E4E3E0` (cream)
- Currency/percent formatting utilities in `src/lib/utils.ts` (Chilean locale)
- Environment variables: `GEMINI_API_KEY`, `APP_URL`, `JWT_SECRET`, `DISABLE_HMR`
