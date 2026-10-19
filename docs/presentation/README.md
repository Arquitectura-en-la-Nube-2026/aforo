# Delivery 4 presentation

> Owner: Platform (Julián). For the 20-minute defense (week of Oct 19, 2026).

Two pages, in **Spanish** (the class language, like `docs/design/`). This README stays in English
like the rest of the repo. Open both from the repo checkout: they load the logo from
`apps/web/public/brand/` and fall back to the screenshots in `docs/evidence/`.

| File | Screen | What it is |
| ---- | ------ | ---------- |
| [index.html](index.html) | The shared screen | A 16:9 slide deck (25 slides) in the logo's palette. No clock or timings on it |
| [presenter.html](presenter.html) | The presenter's laptop | Current and next slide, speaker notes, the 20-minute clock with section budgets, the operator's timed command list with timers for the slow demos, and the honest answers to the hard questions |

The console's operator panel follows the slide on screen, not the clock: each live command has a
slide where it is prepared and a slide where it is due. Due commands show as gold "Ahora" cards
with copy buttons (red when the deck has moved two slides past them), the next one as a blue
"Prepárate" card, and each new one raises a banner with a beep (toggle 🔔). "Hecho" (or `H`)
marks it and starts its timer, and the timers announce their milestones (dead letters, alert,
window open/close, reservations expiring). Paste the `correlationId` printed by `make poison` and
the previous orders revision into the two fields and the E-05 and rollback commands fill in.

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

## Speakers

Shown on the console with a hand-off cue on each speaker's last slide. Julián also operates the
terminal and the console for the whole talk.

| Min | Block | Slides | Speaker |
| --: | ----- | ------ | ------- |
| 0–1 | Opening | 1–3 | Luis Esteban |
| 1–6 | Live purchase demo | 4–6 | Sergio |
| 6–8:30 | C&C: view, purchase, styles | 7–10 | Julián |
| 8:30–11 | Patterns, design vs. built, E-02 | 11–13 | Daniel Felipe |
| 11–14:30 | Deployment, persistence, IaC, blue/green | 14–18 | Juan José |
| 14:30–17 | FaaS, E-01, E-05 | 19–21 | Cristian |
| 17–19 | Cloud-native verdict | 22–24 | Daniel Felipe |
| 19–20 | Questions (moderates) | 25 | Juan José |

The demo timing is a shortened version of [../runbooks/demo.md](../runbooks/demo.md): `make
poison` at ≈ 6:00, right after the live demo (so its alert, ≈ 3:30 later, never lands during it), the E-01 script at **≈ 9:00** during the patterns slide (opens 3 min later, closes
5 min after that, so the queue is still at minimum 1 when Cristian reaches E-01 around 15:30 and
drops to 0 around minute 17). E-06 and
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
