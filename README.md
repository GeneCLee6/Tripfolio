# Tripfolio · 旅誌

A trip planner and shared wallet for one group of friends (friends-only app; this repository is public).

Plan a trip the way a travel agency presents one: day-by-day itinerary, stops on a map with driving times, lodging and bookings, must-eat / must-buy picks with prices and photos. Share a read-only page with friends and family. On the road, everyone in the group logs expenses (multi-currency, shared fund, flexible splits) and the app settles who owes whom. After the trip, the same page flips into a recap.

- Friends only, no accounts required (invite link + "who are you"), optional Google sign-in later.
- Traditional Chinese first, English second; every UI string in both.
- Offline-first PWA: itinerary, map tiles and expense logging work without signal.
- Free tier only: Cloudflare Workers + D1 + R2 + Durable Objects, MapLibre + OpenFreeMap, Photon, OpenRouteService.

## Status

Planning complete and implementation under way (2026-11-09): Phases A–B done, parts of C–H merged; see `docs/NEXT.md` for the exact position. Planning docs are under `docs/`:

| Doc | Purpose |
| --- | --- |
| `docs/PRD/00-prd.md` | Product requirements, milestones M0–M3 |
| `docs/PRD/01-travel-domain-notes.md` | What a tour operator would remind you of (domain notes) |
| `docs/PRD/e1…e11` | Epics with acceptance criteria and tasks |
| `docs/ROADMAP.md` | Batch order (one batch = one PR) |
| `docs/NEXT.md` | Where we are and how to work a batch |
| `docs/ARCHITECTURE.md` | Worker, D1, R2, TripDO, external providers, offline |
| `docs/DESIGN.md`, `docs/design/mockup.html` | Design tokens, i18n rules, visual mock-up |

Documentation other than this README is written in Traditional Chinese.
