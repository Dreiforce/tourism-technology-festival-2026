# AGENTS.md

Guide for coding agents (and humans) working in this repo. Read this before changing code.

## What this is

Familienzeit: a hackathon project (Tourism Technology Festival 2026, Challenge 06) that helps families plan holidays in Serfaus–Fiss–Ladis. See [README.md](README.md) for the pitch.

| Folder | What | Stack |
|---|---|---|
| `reise-canvas-prototyp/dist/` | **Reise-Canvas, the main app.** Default page on GitHub Pages. | Static HTML/CSS/JS, no build, no dependencies |
| `reise-canvas-prototyp/server/`, `scripts/`, `tests/`, `docs/` | Optional worker that serves the canvas plus Apple/Google Wallet export ([docs/wallet.md](reise-canvas-prototyp/docs/wallet.md)) | Worker modules, WebCrypto, `node:test` |
| `familienzeit/` | Activity planner with an admin panel and a catalogue worker | Static site + `server/worker.mjs` |
| `familienfenster-prototyp/dist/` | Early design prototype | Static |
| `scripts/` | `build-pages.mjs` (GitHub Pages build), `check-activities.mjs` (live check of the catalogues) | Node 24 |
| `resources/` | Presentation and team photo | – |

## Run it

```sh
# Reise-Canvas alone (no build step):
python -m http.server 8765 --directory reise-canvas-prototyp/dist

# Everything as deployed on GitHub Pages:
node scripts/build-pages.mjs
python -m http.server 8000 --directory dist/pages     # / redirects to /reise-canvas-prototyp/

# Reise-Canvas with the wallet worker (credentials optional, see docs/wallet.md):
node reise-canvas-prototyp/scripts/dev.mjs              # http://localhost:8788

# Tests (wallet + worker):
node --test reise-canvas-prototyp/tests/*.test.mjs   # the 2 openssl signing tests need a working openssl CLI

# Live check of the activity catalogues (source links respond, activity still offered):
node scripts/check-activities.mjs            # exit code 1 if something is off
node scripts/check-activities.mjs --stamp    # also writes `checked` dates into the Reise-Canvas catalogue
```

Pushing to `main` deploys GitHub Pages ([pages.yml](.github/workflows/pages.yml)). `build-pages.mjs` appends `?v=<commit>` to the prototypes' scripts and styles, because Pages caches files for 10 minutes. Without it, browsers mix old and new files after a deploy and the app breaks.

## Reise-Canvas architecture

Plain classic `<script defer>` files that share one global scope. **Load order matters** ([index.html](reise-canvas-prototyp/dist/index.html)):

1. `i18n.js`: `messages` (`key: [de, en]`), `t(key, ...args)`, `language`, `locale()`. Every user-facing string goes here in both languages.
2. `scene.js`: SVG drawing. Landscapes, seasons (`sceneSeason`, `winterize`), weather sky (`skyWeather`, snow/rain), figures (`avatarFigure`, `humanArt`, wheelchair, pram and walking aids), mascots Murmli & Berta, `poster()` (front of the postcard) and `postcardBack()` (the finale).
3. `face.js`: face parts for the Mii-style editor (`faceOf()` defaults reproduce the original look, `faceArt()`, `headSvg()`).
4. `planner.js`: groups (`groupSet`, `adultGroups`, childcare), opening hours (`suggestedTime`), and the **trip planner** (`slotOptions`, `planTrip`).
5. `weather.js`: Open-Meteo. Forecast up to 15 days ahead, otherwise the same day last year (`fetchWeatherDays`).
6. `app.js`: state, the 6 steps (family, place, dates, wishes, groups, done), rendering, drag & drop, postcard flip, PNG export, the trip plan UI.
7. `mii.js`: the Mii-style character editor dialog (opened by tapping any figure on any step).
8. `wallet.js`: "Plan mitnehmen" on the last step. It sends the trip plan (`currentTrip()`) to the wallet worker. The pass format only knows `am`/`pm`, so evening entries travel as `pm`.

`catalog.json` holds the activities. Fields: `hours` rules with `from`/`to`/`days`/`open`/`close`/`last`, `min`/`max` age, `pets`, `category`, optional `interests`, `accessibility` (`stroller`/`stepFree`/…: `yes|limited|no`), `weather` (`sun` = fair weather only, `both`), `coords`, `checked`. Accessibility, weather and coordinates were copied by title from `familienzeit/static/catalog.json`.

### Trip planner in short

For each day × slot (morning, afternoon, evening events) × group, an activity is a candidate only if it is open that day, fits every child's age, the dog, nobody's accessibility needs are confirmed `no`, it isn't already planned, and it isn't an outdoor-only activity on a day with a forecast thunderstorm (forecast rain costs a lot of points; last year's rain, used when there's no forecast yet, only a little). Score: people in the group who like it, weighted by **fairness** (people with fewer favourite moments so far count more), plus bonuses for one-day events, weatherproof activities on bad days, confirmed access, mascot activities for kids and the home village; minus points for repeating a category in a day, distance and cold days for fair-weather activities. The user's swaps and removals are stored in `state.picks`, and the rest re-plans around them.

## Conventions

- **No frameworks, no bundler, no npm dependencies** in the Reise-Canvas. Stdlib and the platform first.
- Match the existing dense code style (short helpers, template-literal rendering, `$=id=>getElementById`).
- Escape user text with `html()` before it goes into HTML or SVG.
- **Accessibility**: real buttons and labels, `aria-pressed`/`aria-expanded`, keyboard paths for drag & drop (the dropdowns on the groups step), and honour `prefers-reduced-motion` for every new animation.
- **Data honesty**: never invent opening hours, prices, ages or accessibility. Unknown stays unknown, and the UI says "beim Anbieter nachfragen".
- The page must work at phone width (375 px) without horizontal scrolling.
- Fonts (Caveat, Fraunces) are self-hosted in `dist/fonts/`. The PNG export inlines them as data URLs, because an SVG drawn as an image can't load web fonts. Everything placed into SVG must be XML-safe: run it through `html()`, a raw `&` breaks the export.
- Original artwork only. The mascots and figures are our own simple drawings.
- Windows checkouts convert to CRLF. Compare files with `tr -d '\r'` if checksums disagree.

## Verify before you push

1. `node -e` syntax check, or simply load the page and watch the console.
2. Click through: add people (+ Kind opens age buttons), tap a figure (editor), pick dates (weather note), split groups (drag), finish (card flips), "Reiseplan erstellen" (trip plan; try ⇄ and Streichen).
3. Check desktop and mobile widths. There must be no console errors.
4. `node scripts/build-pages.mjs` must succeed.
