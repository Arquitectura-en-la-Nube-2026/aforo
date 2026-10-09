"""Builds docs/atlas/index.html from data/*.json and template.html.

    python3 docs/atlas/build.py                 # writes docs/atlas/index.html (standalone page)
    python3 docs/atlas/build.py --artifact OUT  # also writes the bare page used for the published copy
"""
import json, os, re, sys
H = os.path.dirname(os.path.abspath(__file__))
L = lambda f: json.load(open(os.path.join(H, "data", f)))
svc, asy, plat, dec, dlv = L("services.json"), L("async.json"), L("platform.json"), L("decisions.json"), L("deliveries.json")

SCHEDS = ["sched-catalog-housekeeping", "sched-orders-housekeeping", "sched-inventory-housekeeping"]
def fix_ref(i, owner=None):
    if i == "sched-housekeeping":
        if owner:
            m = {"svc-catalog": SCHEDS[0], "svc-orders": SCHEDS[1], "svc-inventory": SCHEDS[2]}
            return [m.get(owner, SCHEDS[0])]
        return SCHEDS
    return [i]

comps = {}
def merge(c):
    old = comps.get(c["id"])
    if not old:
        comps[c["id"]] = c; return
    for k, v in c.items():
        if k == "dependsOn":
            seen = {(d["id"], d.get("how", "")) for d in old.get("dependsOn", [])}
            old.setdefault("dependsOn", []).extend(d for d in v if (d["id"], d.get("how", "")) not in seen)
        elif isinstance(v, list):
            cur = old.get(k) or []
            old[k] = cur + [x for x in v if x not in cur]
        elif isinstance(v, dict):
            cur = old.get(k) or {}
            for kk, vv in v.items():
                if vv and not cur.get(kk): cur[kk] = vv
            old[k] = cur
        elif v and not old.get(k):
            old[k] = v

for c in svc["components"]: merge(c)
for c in plat["components"]: merge(c)
for c in asy["components"]:
    if c["id"] in ("svc-catalog", "svc-inventory", "svc-orders", "svc-queue"):
        merge({"id": c["id"], "dependsOn": c.get("dependsOn", [])})
    else:
        merge(c)

# Edge direction: "A dependsOn B". The schedulers call services; services do not depend on schedulers.
for c in comps.values():
    deps = []
    for d in c.get("dependsOn", []):
        if d["id"] == "sched-housekeeping":
            continue  # scheduler -> service edges already exist from the async map
        deps.append(d)
    c["dependsOn"] = deps


# Gotchas that quoted docs fixed in PRs #42 and #43 (Oct 9): drop or rewrite them.
DROP = ["README status", "environment-up-down.md#L73", "contracts/events/README.md#L85", "infra/README.md#L26", "contracts/README.md still says"]
REWRITE = {
    "Not only queue reaches it": "Queue and gateway both reach it through Direct VPC egress: the gateway keeps its per-IP quota counters there (ADR-0001 amendment).",
    "common.yml and e2e.yml are still TODO": "There is no common.yml or e2e.yml: packages/common is built inside each unit's workflow but its own tests do not run in CI, and the acceptance runs are the scripts in docs/evidence.",
}
for c in comps.values():
    g = []
    for x in c.get("gotchas", []) or []:
        if any(d in x for d in DROP):
            continue
        for k, v in REWRITE.items():
            if x.startswith(k) or k in x:
                x = v
        g.append(x)
    c["gotchas"] = g

flow = comps.pop("flow-purchase", None)

for d in dec["decisions"]:
    aff = []
    for a in d.get("affects", []):
        for x in fix_ref(a):
            if x not in aff: aff.append(x)
    d["affects"] = aff

LANES = [
    {"id": "client", "label": "Browser"},
    {"id": "edge", "label": "Entry"},
    {"id": "core", "label": "Services"},
    {"id": "data", "label": "Data"},
    {"id": "faas", "label": "Functions"},
    {"id": "async", "label": "Messaging & time"},
    {"id": "platform", "label": "Platform"},
    {"id": "delivery", "label": "Delivery"},
]
known = {l["id"] for l in LANES}
for c in comps.values():
    if c.get("layer") not in known: c["layer"] = "platform"

# Order inside lanes: keep a readable order per kind
ORDER = ["svc-catalog", "svc-queue", "svc-orders", "svc-inventory", "lib-common",
         "data-cloudsql", "db-catalog", "db-orders", "db-inventory", "data-memorystore", "data-firestore",
         "fn-prewarmer", "fn-mock-payment-gateway", "fn-dlq-monitor"]
def key(c):
    i = ORDER.index(c["id"]) if c["id"] in ORDER else 100
    return (i, c.get("kind", ""), c["id"])
clist = sorted(comps.values(), key=key)

FLOW = [
    ("Log in with an email", "The web posts to the gateway, which issues an 8-hour HS256 session; there is no password (D-06).", ["app-web", "svc-gateway", "infra-secrets"]),
    ("See three events, open the one on sale", "Server-side rendered pages read the catalog through the gateway; availability comes from inventory.", ["app-web", "svc-gateway", "svc-catalog", "db-catalog", "svc-inventory", "db-inventory"]),
    ("Join the waiting room", "The queue keeps positions in Redis; it learned about the event earlier from catalog's EventPublished on Pub/Sub.", ["app-web", "svc-gateway", "svc-queue", "data-memorystore", "topic-event-published"]),
    ("Admitted, pass countdown", "The queue's admission tick moves buyers from waiting to admitted and pushes it over SSE.", ["svc-queue", "data-memorystore", "svc-gateway", "app-web"]),
    ("Pick a sector and two tickets", "POST /orders with an Idempotency-Key and the queue pass (forwarded and logged, never verified, D-07).", ["app-web", "svc-gateway", "svc-orders"]),
    ("Order pending, availability drops by two", "Orders asks inventory for a reservation; the conditional decrement guards the seats, and a Cloud Task is set for the expiry.", ["svc-orders", "db-orders", "svc-inventory", "db-inventory", "tq-reservation-expiry"]),
    ("Pay in the mock and come back", "Orders calls the mock through its adapter (timeouts, retry, circuit breaker); the browser goes to the mock's page through the gateway.", ["svc-orders", "fn-mock-payment-gateway", "data-firestore", "svc-gateway", "app-web"]),
    ("Paid in under five seconds", "The mock sends a signed webhook via Cloud Tasks; orders applies it once (inbox), confirms the reservation and publishes OrderPaid through the outbox.", ["fn-mock-payment-gateway", "tq-payment-webhooks", "svc-gateway", "svc-orders", "db-orders", "svc-inventory", "topic-order-paid"]),
    ("Listed in my orders", "GET /orders through the gateway.", ["app-web", "svc-gateway", "svc-orders"]),
    ("Follow it by correlationId", "The gateway sets X-Correlation-Id; every service logs it and the outbox envelope carries it across Pub/Sub.", ["obs-logging", "lib-common", "svc-gateway", "svc-orders", "svc-inventory", "topic-order-paid"]),
]
flow_steps = [{"title": t, "detail": d, "components": [x for x in cs if x in comps]} for t, d, cs in FLOW]

ds = {s["id"]: s for s in dlv["scenarios"]}
dd = {d["id"]: d for d in dec["decisions"]}
SC = [
    ("E-01", "yes", "Met on dev", "Pre-warming by the prewarmer function (min 1 instance, at most 1 h), scale to zero, waiting-room pacing", "Load balancer tuning; 2–3 warm instances (dev uses 1)", "Warm 3 s after publishing; join at the opening 550 ms vs 4 070 ms cold; back to 0 at the close", "docs/evidence/e01-prewarming"),
    ("E-02", "partial", "Overselling met; p95 only when metered", "Conditional decrement in inventory, waiting-room admission, capped connection pools (ADR-0005)", "Load tests at full scale", "200 buyers on 10 seats: 10 created, 0 oversold. Inventory p95 808 ms all at once, 75 ms at 20/s", "docs/evidence/e02-concurrency"),
    ("E-03", "no", "Not demonstrated", "Health checks; Cloud Run spreads instances across zones", "Regional failover drills, standby database", "No run on dev", ""),
    ("E-04", "no", "Dropped in Delivery 3", "None", "Multi-tenant isolation between organizers", "Out of the slice", ""),
    ("E-05", "yes", "DLQ alert met", "Structured logs with correlationId across HTTP and the bus; dlq-monitor + log-based alert", "Distributed tracing; error-rate and latency alerts (the ≤ 60 s alert)", "3 consumers × 5 attempts → 3 DLQs; dlq-monitor at +1 min 36 s; incident and email at +3 min 30 s", "docs/evidence/e05-observability"),
    ("E-06", "yes", "Met on dev", "Timeouts, retry with backoff, circuit breaker in orders; fault injection in the mock", "Bulkheads per dependency", "503 PAYMENT_UNAVAILABLE; opened on the 5th failure; ~10 ms fast failures; closed again without a deploy", "docs/evidence/e06-circuit-breaker"),
    ("E-07", "partial", "Billing pending", "Scale to zero; make up/down stops Cloud SQL; Memorystore created per demo", "Per-window Edge; TTL on transient data", "Off state verified (Cloud SQL stopped, no Redis, schedulers paused); billing screenshots pending", "docs/evidence/e07-cost"),
    ("E-08", "no", "Not demonstrated", "Private Cloud Run with IAM invoker, gateway token check, HMAC webhook, input validation", "Edge WAF and CAPTCHA", "No run on dev; queue pass not verified (D-07)", ""),
]
scen = []
for i, met, lbl, tac, drop, res, ev in SC:
    s = ds.get(i, {})
    scen.append({"id": i, "name": s.get("name", dd.get(i, {}).get("title", i)), "attribute": s.get("attribute", ""),
                 "target": s.get("measure", ""), "tactic": tac, "dropped": drop, "result": res, "evidence": ev or "—",
                 "met": met, "metLabel": lbl})

notes = [
    {"from": "Security", "text": "CI's service account github-ci is Owner of the project, and any workflow run in this repository (any branch) can act as it through Workload Identity Federation. Accepted for the prototype; production would narrow it to the deploy roles and restrict the login to main. Documented in infra/README.md."},
    {"from": "Gateway", "text": "RATE_LIMIT_DEFAULT_PER_MIN is set by Terraform but the gateway does not read it: only the per-route quotas exist. The gateway README says so."},
    {"from": "Gateway", "text": "Catalog and inventory calls time out at 2.5 s, above the 2 s default in contracts/conventions.md; orders 15 s, mock pages 10 s and queue 8 s are deliberate (gateway README)."},
    {"from": "Orders", "text": "Orders implements its own inbox (InboxRepository, claim in the same transaction as the effect) instead of @aforo/common's consumeOnce. Same guarantee; documented in packages/common/README.md."},
    {"from": "CI", "text": "No automated contract tests and no e2e suite: contracts are linted, and the acceptance runs are the scripts in docs/evidence. packages/common's own tests do not run in CI."},
    {"from": "Quality scenarios", "text": "E-02's p95 target is met only when buyers arrive metered (75 ms); 200 at once gives 808 ms. E-07 billing screenshots are pending. E-03 and E-08 are not demonstrated; E-04 was dropped in Delivery 3."},
    {"from": "Past deliveries", "text": "Delivery 3 uses its own D-01..D-06 and ADR-03/04, which collide with the repo's D-01..D-21 and ADR-0001..0007: cite them with their delivery. Delivery 3 promises not applied in the slice: a database fallback for queue positions, the window sizing (100 connections, standby, replica) and Firestore for notifications (here it backs the payment mock)."},
    {"from": "Platform", "text": "A default auto-mode VPC exists in the project outside Terraform (created with the project); nothing uses it."},
]

data = {
    "meta": ["GCP aforo-dev-teamf · southamerica-east1", f"{len(clist)} components", f"{len(dec['decisions'])} decisions", "State as of Oct 9, 2026 · main b19409a · dev off"],
    "lanes": LANES, "components": clist, "decisions": dec["decisions"], "flow": flow_steps,
    "flowCard": flow, "scenarios": scen,
    "lineage": {"deliveries": dlv.get("deliveries", []), "targetComponents": dlv.get("targetComponents", []), "requirements": dlv.get("requirements", [])},
    "notes": notes, "start": "svc-orders",
}
js = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
tpl = open(os.path.join(H, "template.html")).read()
out = tpl.replace("/*DATA*/null/*END*/", js)
HEAD = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
# The template starts with <title>, fonts and <style>; split it so the head holds them.
cut = out.index("<div class=\"wrap\">")
page = HEAD + out[:cut] + "</head>\n<body>\n" + out[cut:] + "\n</body>\n</html>\n"
open(os.path.join(H, "index.html"), "w").write(page)
if "--artifact" in sys.argv:
    open(sys.argv[sys.argv.index("--artifact") + 1], "w").write(out)
ids = set(comps)
dangling = sorted({d["id"] for c in clist for d in c.get("dependsOn", []) if d["id"] not in ids})
print("components", len(clist), "decisions", len(dec["decisions"]), "bytes", len(out), "dangling", dangling)
