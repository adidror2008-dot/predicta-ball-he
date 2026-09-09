# PredictaBall

Create "PredictaBall" — a Hebrew, RTL, mobile-first football web app. Dark theme only.

**THIS IS STEP 1 OF A MULTI-STEP BUILD, AND IT IS ONLY THE UI SHELL.**
No backend. No Supabase/Lovable Cloud. No edge functions. No API calls. No data fetching library setup. No mock, seed, demo or placeholder data of any kind. Build exactly what is listed below and nothing else — do not add features, pages, or "helpful" extras I did not ask for.

---

## IRON RULES — permanent. They apply to this message and to every future message in this project.

1. Every string the user sees is in Hebrew. `<html dir="rtl" lang="he">`.
2. Tailwind logical utilities ONLY: `ms-` `me-` `ps-` `pe-` `start-` `end-`. Never `ml-` `mr-` `pl-` `pr-`.
3. Numbers, scores and times render LTR inside RTL text — wrap them in `<span dir="ltr">`. Dates `DD/MM/YYYY`, 24-hour times, timezone `Asia/Jerusalem`.
4. **NEVER invent, mock, seed, guess or "fill in" data.** No data → a clean Hebrew empty state. An empty panel is always better than wrong information. This rule is absolute and outranks making a screen look finished.
5. Never put an API key in client code. No `.env` file. Never a `VITE_`-prefixed secret.
6. Colors come from design tokens only. Never a raw hex value inside a component.
7. Every list has BOTH a loading skeleton AND a Hebrew empty state. A blank or white screen is never acceptable.
8. No `console.log` anywhere in `src/`.
9. Flags and logos never mirror in RTL.

---

## Design tokens
Define once as CSS variables in `index.css` and as semantic tokens in the Tailwind config:
- background (navy): `#0A121C`
- surface / card: `#122B42`
- brand green gradient: `#16B866` → `#43E68C`
- foreground / primary text: `#FFFFFF`
- muted / secondary text: `#8FB0C6`
- result status colors: win = green, draw = neutral gray, loss = red. **Never use team colors for status.**
Cards are `rounded-2xl` with a subtle shadow and smooth transitions.

## Fonts
Load from Google Fonts in `index.html`: **Heebo** (400/500/700) and **Poppins** (600/800).
Tailwind: `font-sans` = Heebo, `font-brand` = Poppins.
**Poppins has no Hebrew glyphs — use it for the brand name "PredictaBall" only, never for interface text.**

## Brand assets
Create these two files in `public/` with exactly this content, unmodified:

`public/predictaball_logo.svg`:
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 440" width="1280" height="440"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#122B42"/><stop offset="1" stop-color="#0A121C"/></linearGradient><linearGradient id="grn" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#16B866"/><stop offset="1" stop-color="#43E68C"/></linearGradient></defs><rect x="0" y="0" width="1280" height="440" rx="56" fill="url(#bg)"/><circle cx="1050" cy="120" r="220" fill="#43E68C" opacity="0.05"/><g transform="translate(70,88) scale(0.52)"><path d="M250 300 C335 285, 360 190, 402 150" fill="none" stroke="url(#grn)" stroke-width="30" stroke-linecap="round"/><path d="M374.8 156.6 L402 150 L394.1 176.9" fill="none" stroke="url(#grn)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/><circle cx="185" cy="350" r="78" fill="#FFFFFF" stroke="#0A121C" stroke-width="6"/><g stroke="#0A121C" stroke-width="7" stroke-linecap="round" fill="none"><line x1="185" y1="322" x2="185" y2="272"/><line x1="211.6" y1="341.4" x2="259.2" y2="325.9"/><line x1="201.5" y1="372.7" x2="230.9" y2="413.1"/><line x1="168.5" y1="372.7" x2="139.1" y2="413.1"/><line x1="158.4" y1="341.4" x2="110.8" y2="325.9"/></g><polygon points="185,322 211.6,341.4 201.5,372.7 168.5,372.7 158.4,341.4" fill="#0A121C"/></g><text x="345" y="240" font-family="'Poppins','Montserrat','Arial Black',sans-serif" font-size="132" font-weight="800" letter-spacing="-2"><tspan fill="#FFFFFF">Predicta</tspan><tspan fill="url(#grn)">Ball</tspan></text><text x="352" y="312" font-family="'Poppins','Montserrat','Arial',sans-serif" font-size="42" font-weight="600" letter-spacing="10" fill="#8FB0C6">PREDICT · PLAY · WIN</text></svg>

`public/predictaball_icon.svg`:
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#173049"/><stop offset="1" stop-color="#0B1420"/></linearGradient><linearGradient id="grn" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#16B866"/><stop offset="1" stop-color="#43E68C"/></linearGradient></defs><rect x="0" y="0" width="512" height="512" rx="116" fill="url(#bg)"/><circle cx="360" cy="180" r="150" fill="#43E68C" opacity="0.06"/><path d="M250 300 C335 285, 360 190, 402 150" fill="none" stroke="url(#grn)" stroke-width="30" stroke-linecap="round"/><path d="M374.8 156.6 L402 150 L394.1 176.9" fill="none" stroke="url(#grn)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/><circle cx="185" cy="350" r="78" fill="#FFFFFF" stroke="#0A121C" stroke-width="6"/><g stroke="#0A121C" stroke-width="7" stroke-linecap="round" fill="none"><line x1="185" y1="322" x2="185" y2="272"/><line x1="211.6" y1="341.4" x2="259.2" y2="325.9"/><line x1="201.5" y1="372.7" x2="230.9" y2="413.1"/><line x1="168.5" y1="372.7" x2="139.1" y2="413.1"/><line x1="158.4" y1="341.4" x2="110.8" y2="325.9"/></g><polygon points="185,322 211.6,341.4 201.5,372.7 168.5,372.7 158.4,341.4" fill="#0A121C"/></svg>

---

## Screens

**Bottom navigation, 3 tabs:** `משחקים` · `חדשות` · `הגדרות`
Routes: `/` (matches), `/match/:id`, `/news`, `/settings`.

### Matches screen (`/`)
- Competition chips row at the top, horizontally scrollable when they overflow. Render from an empty array for now — no hardcoded competition names.
- A competition with no matches appears dimmed with the label `אין משחקים כרגע`.
- Match card component (minimal): two team names, two logo slots (neutral placeholder circle when there is no logo file — NOT a guessed logo), score or kickoff time, date, status badge. All depth lives on the match page, not the card.
- Chronological list grouped by date with a `עכשיו` marker component — the marker renders only when matches exist.
- Manual refresh button (lucide `RotateCw`) in the header. In this step it is inert: it must never trigger any network request.
- Skeleton while loading, empty state `אין משחקים להצגה כרגע`.
- Remember the active tab and scroll position in `sessionStorage`.

### Match page (`/match/:id`) — 6 tabs, every one an empty state in this step
1. `הרכבים` → `טרם פורסם הרכב רשמי`
2. `אירועים` → `אין אירועים להצגה`
3. `סטטיסטיקות` → `אין סטטיסטיקות להצגה`
4. `דירוגים` → `אין דירוגים להצגה`
5. `טבלה` → `הטבלה תתעדכן עם תחילת העונה`
6. `תחזית` → `אין מספיק נתונים לתחזית`

### News screen (`/news`)
News-site style card layout (image slot, headline, summary, relative time). Skeleton + empty state `אין חדשות להצגה כרגע`.

### Settings screen (`/settings`)
- Notifications block: one master toggle plus three sub-toggles — `הרכב רשמי פורסם`, `המשחק מתחיל בעוד שעה`, `המשחק הסתיים`. Sub-toggles are visually dimmed and disabled while the master is off. Toggles hold local UI state only; nothing is persisted or sent anywhere yet.
- A permanent note under them: `באייפון יש להוסיף את האפליקציה למסך הבית כדי לקבל התראות.`
- Followed competitions list with an X to remove each. Empty state: `לא נבחרו תחרויות למעקב`.
- `אודות` section: the logo, the brand name, the slogan `כדורגל · חיזוי · כיף`, a short Hebrew paragraph explaining that the app gives an explained statistical forecast for every match, a sources line, and a `עודכן לאחרונה` row that renders `—` while there is no data.

### App-wide
- **Error Boundary at the root**: centered card, title `משהו השתבש`, line `נסה לרענן את הדף`, button `רענן`. Never show a stack trace to the user.
- **Offline banner**: fixed top banner when `navigator.onLine === false` reading `אין חיבור לאינטרנט — מוצגים נתונים שמורים`, auto-hiding when the connection returns.
- **PWA manifest** using `predictaball_icon.svg`, dark theme color `#0A121C`, so the app can be added to the home screen. No service worker in this step.

---

Finish by running type-check and build, confirm both pass, and show me a 390px-wide screenshot. Then stop and wait — I will send step 2.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://predicta-ball-he.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a9163e81-d4e2-4a11-ab5a-c420296e1843).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
