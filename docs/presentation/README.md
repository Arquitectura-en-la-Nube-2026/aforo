# Delivery 4 presentation

> Owner: Platform (Julián). For the 20-minute defense (week of Oct 19, 2026).

Two pages, in **Spanish** (the class language, like `docs/design/`). This README stays in English
like the rest of the repo. Open both from the repo checkout: they load the logo from
`apps/web/public/brand/` and fall back to the screenshots in `docs/evidence/`.

| File | Screen | What it is |
| ---- | ------ | ---------- |
| [index.html](index.html) | The shared screen | A 16:9 slide deck (25 slides) in the logo's palette. No clock or timings on it |
| [presenter.html](presenter.html) | The presenter's laptop | Current and next slide, speaker notes, the 20-minute clock with section budgets, the operator's timed command list with timers for the slow demos, and the honest answers to the hard questions |

Open `presenter.html` in another window of the same browser: it follows the deck and its `←` `→`
(or buttons) drive it. They talk through `BroadcastChannel`, so no server is needed.

**Deck keys:** `→` / `Space` / clicker next (builds first, then the next slide), `←` back, `F`
fullscreen, `Home` / `End`. `#/<slide-id>/<build>` deep-links a slide.

## What the talk covers

The professor asked for **(a) the prototype's functionality** and **(b) the architecture**: C&C and
deployment views, infrastructure included, with proof that the system is cloud-native.

| Min | Section | Slides |
| --: | ------- | ------ |
| 0–1 | Inicio | Title, the problem (E-01, E-02, E-07), what was built |
| 1–6 | Funcionalidad | Live purchase; fallback: the nine screens and step 10 (the purchase in the logs) |
| 6–11 | C&C | Built view; the purchase over it; styles; where each pattern lives; design vs. built; E-02 live |
| 11–17 | Despliegue | GCP resources under `make down` / `up` / `redis-up` / sales window; persistence; IaC ownership; blue/green; FaaS; E-01 and E-05 live |
| 17–19 | Nativo de la nube | What the running system shows, what it does not, verdict |
| 19–20 | Cierre | Questions |

The demo timing is a shortened version of [../runbooks/demo.md](../runbooks/demo.md): `make
poison` at 0:00, the E-01 script at **6:00** (opens 3 min later, closes 5 min after that, so the
queue is at minimum 1 when the deployment section starts and drops to 0 around minute 14). E-06 and
the fails-well checks are shown from their recorded numbers only.

## Refreshing the purchase screenshots

[capture/capture.cjs](capture/capture.cjs) buys two tickets on `dev` through the real web as a new
buyer and saves steps 1–9 at 2× pixel density in `shots/`. Then it reads that purchase's log lines
with `gcloud logging read` for step 10 and writes `shots/trace.js`, which the deck uses for step 10,
the payment time and the availability numbers. Without that file the deck shows the Oct 8–9 run.

```bash
make up && make redis-up          # >= 15 min before; needs Terraform
npm i playwright                  # once, in a scratch folder if preferred
node docs/presentation/capture/capture.cjs
make down                         # unless the rehearsal follows
```

Every other number in the deck comes from `docs/evidence/` (runs of Oct 8–9). The deck does not
read GCP live.
