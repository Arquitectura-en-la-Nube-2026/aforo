// Takes the deck's purchase screenshots (steps 1-9) from the real web on dev, then reads the purchase's
// log lines with gcloud to build step 10. Writes ../shots/NN-*.png and ../shots/trace.js.
// Needs `make up` and `make redis-up`, gcloud logged in, and Playwright (see ../README.md).
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WEB = "https://aforo-web-68220265740.southamerica-east1.run.app";
const GW = "https://aforo-gateway-68220265740.southamerica-east1.run.app";
const PROJECT = "aforo-dev-teamf";
const EVENT = "8f1b2c3d-0000-4000-8000-000000000001";
const GENERAL = "a1a1a1a1-0000-4000-8000-000000000001";
const OUT = path.join(__dirname, "..", "shots");
const EMAIL = `demo+${Date.now()}@aforo.dev`; // the per-person maximum is 4: a fresh buyer each run
const t0 = Date.now();
const log = (step, msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${step}: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const available = async () =>
  (await (await fetch(`${GW}/api/v1/events/${EVENT}/availability`)).json()).sectors.find((s) => s.sectorId === GENERAL).available;

function readLogs(filter) {
  const out = execFileSync("gcloud", ["logging", "read", filter, `--project=${PROJECT}`, "--freshness=2h", "--order=asc", "--limit=50", "--format=json"], { encoding: "utf8" });
  return JSON.parse(out || "[]");
}
const hop = (e, extra = {}) => {
  const j = e.jsonPayload || {};
  return {
    t: e.timestamp.slice(11, 23),
    svc: (e.resource?.labels?.service_name || "").replace(/^aforo-/, ""),
    what: j.event === "queue_pass_received" ? "queue_pass_received (se registra, no se verifica)" : j.event || (j.message === "http.request" ? j.route : j.message) || "",
    st: j.status != null ? String(j.status) : j.published != null ? String(j.published) : "",
    ...extra,
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  // 16:10 like the deck frame, narrow enough that the app fills it, and 2x so it stays sharp on a projector
  const page = await browser.newPage({ viewport: { width: 1120, height: 700 }, deviceScaleFactor: 2, locale: "es-CO", timezoneId: "America/Bogota" });
  const calls = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === GW && r.request().method() !== "OPTIONS" && !u.pathname.endsWith("/stream"))
      calls.push({ m: r.request().method(), p: u.pathname, s: r.status(), cid: r.headers()["x-correlation-id"] });
  });
  const shot = async (n) => {
    await page.evaluate(() => document.fonts.ready);
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${n}.png` });
  };
  const run = {};
  try {
    // 1. Login
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Correo electrónico").fill(EMAIL);
    await page.getByLabel("Nombre").fill("Comprador Demo");
    await shot("01-login");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    log("1 login", EMAIL);

    // 2. Published events
    await page.goto(WEB);
    await page.getByText("Festival Estéreo 2026").first().waitFor();
    await shot("02-events");
    log("2 events", "listed");

    // 3. Join the queue and see the position
    await page.goto(`${WEB}/events/${EVENT}`);
    await page.getByRole("heading", { name: /Festival Estéreo 2026/ }).waitFor();
    const joinAt = Date.now();
    await page.getByRole("link", { name: "Entrar a la fila" }).or(page.getByRole("button", { name: "Entrar a la fila" })).first().click();
    await page.getByText(/Tu posición|Es tu turno/).first().waitFor({ timeout: 30_000 });
    await page.getByText("Reconectando").first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/03-queue.png` });
    log("3 queue", "position shown");

    // 4. Admitted
    await page.getByText("Es tu turno").first().waitFor({ timeout: 60_000 });
    run.admittedMs = Date.now() - joinAt;
    await shot("04-admitted");
    log("4 admitted", `${run.admittedMs} ms after joining`);
    await page.getByRole("link", { name: "Elegir mis entradas" }).or(page.getByRole("button", { name: "Elegir mis entradas" })).first().click();
    await page.getByRole("heading", { name: "Elige tus entradas" }).waitFor();

    // 5. Sector General, two tickets
    const before = await available();
    await page.getByRole("radio", { name: /General/ }).click();
    const qty = page.locator('[aria-labelledby="quantity-label"] [aria-live="polite"]');
    for (let i = 0; i < 5 && (await qty.innerText()).trim() !== "2"; i++) {
      const now = Number((await qty.innerText()).trim());
      await page.getByRole("button", { name: now < 2 ? "Agregar una entrada" : "Quitar una entrada" }).click();
    }
    await shot("05-buy");
    const reserveAt = new Date();
    await page.getByRole("button", { name: "Reservar entradas" }).click();

    // 6. PENDING_PAYMENT, availability down by two
    await page.waitForURL(/\/orders\/[0-9a-f-]+\/pay/, { timeout: 15_000 });
    run.orderId = page.url().match(/orders\/([0-9a-f-]+)/)[1];
    run.correlationId = calls.find((c) => c.m === "POST" && c.p === "/api/v1/orders")?.cid; // undefined when CORS hides the header
    run.availability = [before, await available()];
    await page.getByRole("button", { name: "Pagar ahora" }).waitFor();
    await shot("06-pay");
    log("6 reserved", `order ${run.orderId}, correlationId ${run.correlationId}, ${run.availability.join(" -> ")}`);

    // 7. Pay in the mock
    await page.getByRole("button", { name: "Pagar ahora" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/mock-gateway/checkout/"), { timeout: 20_000 });
    await shot("07-mock");
    const paidAt = new Date();
    await page.getByRole("link", { name: "Pay" }).click();
    await page.waitForURL((u) => u.origin === WEB && u.pathname === `/orders/${run.orderId}`, { timeout: 20_000 });

    // 8. PAID
    await page.getByText("Pago confirmado").first().waitFor({ timeout: 30_000 });
    run.paidMs = Date.now() - paidAt.getTime();
    await shot("08-paid");
    log("8 paid", `${run.paidMs} ms after Pay`);

    // 9. My orders
    await page.goto(`${WEB}/orders`);
    await page.getByText("Pagado").first().waitFor({ timeout: 15_000 });
    await shot("09-orders");
    log("9 orders", "listed as Pagado");

    // 10. The purchase in the logs (Cloud Logging lags, so retry for up to ~2 min)
    let lines = [], flush = [];
    for (let i = 0; i < 8 && lines.length < 3; i++) {
      await sleep(15_000);
      if (!run.correlationId) {
        // the browser cannot read X-Correlation-Id, so take it from the gateway's log of this order creation
        const created = readLogs(`resource.labels.service_name="aforo-gateway" AND jsonPayload.route="/api/v1/orders" AND jsonPayload.status=201 AND timestamp>="${new Date(reserveAt - 2000).toISOString()}" AND timestamp<="${new Date(+reserveAt + 30000).toISOString()}"`);
        run.correlationId = created[0]?.jsonPayload?.correlationId;
        if (!run.correlationId) continue;
      }
      lines = readLogs(`jsonPayload.correlationId="${run.correlationId}"`);
      flush = readLogs(`resource.labels.service_name="aforo-orders" AND jsonPayload.event="outbox_flushed" AND timestamp>="${paidAt.toISOString()}"`);
    }
    run.trace = { cid: run.correlationId, hops: [...lines.map((e) => hop(e)), ...flush.slice(0, 1).map((e) => hop(e, { what: "OrderPaid publicado por el outbox", async: true }))] };
    log("10 trace", `${lines.length} lines, ${flush.length} outbox flush`);
  } catch (error) {
    log("FAILED", error.message.split("\n")[0]);
    await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {});
    console.log("last calls:", JSON.stringify(calls.slice(-8)));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
  if (!process.exitCode) {
    run.capturedAt = new Date().toISOString();
    fs.writeFileSync(`${OUT}/trace.js`, `// Written by capture/capture.cjs on ${run.capturedAt}.\nwindow.AFORO_RUN = ${JSON.stringify(run, null, 2)};\n`);
    console.log(JSON.stringify(run, null, 2));
  }
})();
