// Acceptance steps 1-9 on dev through the real web, as a buyer would. Screenshots in ./shots.
const { chromium } = require("playwright");
const WEB = "https://aforo-web-68220265740.southamerica-east1.run.app";
const GW = "https://aforo-gateway-68220265740.southamerica-east1.run.app";
const EVENT = "8f1b2c3d-0000-4000-8000-000000000001";
const GENERAL = "a1a1a1a1-0000-4000-8000-000000000001";
const shots = `${__dirname}/shots`;
const t0 = Date.now();
const log = (step, msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${step}: ${msg}`);
const available = async () =>
  (await (await fetch(`${GW}/api/v1/events/${EVENT}/availability`)).json()).sectors.find((s) => s.sectorId === GENERAL).available;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-CO" });
  const calls = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === GW && r.request().method() !== "OPTIONS" && !u.pathname.endsWith("/stream"))
      calls.push({ m: r.request().method(), p: u.pathname, s: r.status(), cid: r.headers()["x-correlation-id"] });
  });
  const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
  try {
    // 1. Login
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Correo electrónico").fill("claude-test@aforo.dev");
    await page.getByLabel("Nombre").fill("Claude Test");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    log("1 login", `session ok, now at ${new URL(page.url()).pathname}`);
    await shot("01-login");

    // 2. Three published events; open the one whose sale is open
    await page.goto(WEB);
    await page.getByText("Festival Estéreo 2026").first().waitFor();
    const cards = await page.getByText(/Venta abierta|Próximamente|Venta cerrada/).allInnerTexts();
    log("2 events", `sale badges: ${cards.join(", ")}`);
    await shot("02-events");
    await page.goto(`${WEB}/events/${EVENT}`);
    await page.getByRole("heading", { name: /Festival Estéreo 2026/ }).waitFor();
    await shot("02b-detail");

    // 3. Join the queue and see the position
    await page.getByRole("link", { name: "Entrar a la fila" }).or(page.getByRole("button", { name: "Entrar a la fila" })).first().click();
    await page.getByText(/Tu posición|Es tu turno/).first().waitFor({ timeout: 30_000 });
    log("3 queue", (await page.locator("main").innerText()).split("\n").slice(0, 6).join(" | "));
    await shot("03-queue");

    // 4. Admitted: buy enabled, pass countdown
    await page.getByText("Es tu turno").first().waitFor({ timeout: 60_000 });
    log("4 admitted", (await page.locator("main").innerText()).split("\n").slice(0, 5).join(" | "));
    await shot("04-admitted");
    await page.getByRole("link", { name: "Elegir mis entradas" }).or(page.getByRole("button", { name: "Elegir mis entradas" })).first().click();
    await page.getByRole("heading", { name: "Elige tus entradas" }).waitFor();

    // 5. Sector General, two tickets, confirm
    const before = await available();
    await page.getByRole("radio", { name: /General/ }).click();
    const qty = page.locator('[aria-labelledby="quantity-label"] [aria-live="polite"]');
    for (let i = 0; i < 5 && (await qty.innerText()).trim() !== "2"; i++) {
      const now = Number((await qty.innerText()).trim());
      await page.getByRole("button", { name: now < 2 ? "Agregar una entrada" : "Quitar una entrada" }).click();
    }
    log("5 buy", `General, quantity ${(await qty.innerText()).trim()}, availability before ${before}`);
    await shot("05-buy");
    await page.getByRole("button", { name: "Reservar entradas" }).click();

    // 6. PENDING_PAYMENT and availability dropped by two
    await page.waitForURL(/\/orders\/[0-9a-f-]+\/pay/, { timeout: 15_000 });
    const orderId = page.url().match(/orders\/([0-9a-f-]+)/)[1];
    const create = calls.find((c) => c.m === "POST" && c.p === "/api/v1/orders");
    const after = await available();
    log("6 reserved", `order ${orderId}, POST /orders ${create?.s}, correlationId ${create?.cid}, availability ${before} -> ${after}`);
    await page.getByRole("button", { name: "Pagar ahora" }).waitFor();
    await shot("06-pay");

    // 7. Pay in the mock and come back to the order
    await page.getByRole("button", { name: "Pagar ahora" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/mock-gateway/checkout/"), { timeout: 20_000 });
    log("7 mock", `checkout page ${new URL(page.url()).pathname}`);
    await shot("07-mock");
    const paidClick = Date.now();
    await page.getByRole("link", { name: "Pay" }).click();
    await page.waitForURL((u) => u.origin === WEB && u.pathname === `/orders/${orderId}`, { timeout: 20_000 });

    // 8. PAID in under five seconds
    await page.getByText("Pago confirmado").first().waitFor({ timeout: 30_000 });
    const ms = Date.now() - paidClick;
    log("8 paid", `"Pago confirmado" ${ms} ms after clicking Pay (target < 5000)`);
    await shot("08-paid");

    // 9. In "Mis pedidos" with its status
    await page.goto(`${WEB}/orders`);
    await page.getByText("Pagado").first().waitFor({ timeout: 15_000 });
    log("9 orders", (await page.locator("main").innerText()).split("\n").slice(0, 8).join(" | "));
    await shot("09-orders");

    console.log(JSON.stringify({ orderId, correlationId: create?.cid, paidMs: ms, availability: [before, after] }));
  } catch (error) {
    log("FAILED", error.message.split("\n")[0]);
    await shot("99-failure").catch(() => {});
    console.log("last calls:", JSON.stringify(calls.slice(-8)));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
