# F1 Fantasy HQ

A static, no-backend tracker and strategist for the official **F1 Fantasy** game (fantasy.formula1.com), 2026 season.

Everything runs in the browser. Your team, chips used, price corrections, points log and cached photos/bios are stored in `localStorage` — nothing is uploaded anywhere.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Front page: next-race countdown, your team at a glance, chip plan summary, standings, season winners |
| `team.html` | Team builder: pick 5 drivers + 2 constructors under budget, set 2x Boost, tick chips used, log points, edit prices, export/import a JSON backup |
| `strategist.html` | Ranked transfer suggestions (single/double swaps, net of -10 hits), best 2x Boost, chip-this-weekend call, brute-force ideal team, value board |
| `calendar.html` | Full 23-round calendar with results, track profiles, lock-in times, and the chip planner (auto or manual per chip) |
| `teams.html` | All 11 teams with colours, car name, power unit, an original car illustration in team colours, Wikipedia logo/car photo and driver line-up |
| `drivers.html` | All drivers with photo, 2026 fantasy bio, live Wikipedia extract, price, average fantasy score and projection |

## Keeping it current

* **↻ Refresh live data** (top right) pulls drivers'/constructors' standings and race winners from the free Jolpica API (`api.jolpi.ca`, an Ergast-compatible mirror) and caches them locally.
* Driver photos, team logos and car photos load from Wikipedia's REST API and are cached for 7 days.
* **Prices** are not available from any open API. Prices marked `est.` are estimates — click a price on the My Team page to correct it from the official game. Corrections persist.
* `data/data.js` is the offline snapshot (generated 3 Sep 2026, after Round 12). Update `avgFp` (average fantasy points per weekend) there, or override it in the browser, to tune the projections.

## Publishing on GitHub Pages

1. Create a new repository (e.g. `f1-fantasy`) and push the contents of this folder to the `main` branch.
2. In the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
3. The site will be live at `https://<your-username>.github.io/f1-fantasy/` in a minute or two.

No build step. Opening `index.html` straight from disk also works (live refresh and Wikipedia images need an internet connection).

## Data sources used for the snapshot

* Jolpica (Ergast) API — 2026 standings, results, schedule
* formula1.com F1 Fantasy Strategist previews (Dutch GP, Italian & Spanish GPs) — prices, form notes
* gridside.app / f1pitwall.dev / intothechicane.com — 2026 chip and scoring rules
* Wikipedia — 2026 Formula One World Championship entry list and calendar

Not affiliated with Formula 1, the FIA, or any team. Team names, logos and photos belong to their owners.
