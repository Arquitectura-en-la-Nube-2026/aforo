import { escapeHtml } from './util';

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 1rem;text-align:center}
.amount{font-size:2rem;font-weight:700;margin:.5rem 0 1.5rem}
a.btn{display:block;padding:.9rem;margin:.6rem 0;border-radius:8px;color:#fff;text-decoration:none;font-weight:600}
.pay{background:#1a7f37}.decline{background:#b42318}
small{color:#666}
</style>
</head>
<body>
${body}
</body>
</html>`;

export function checkoutPage(p: { paymentId: string; amountCents: number; publicBaseUrl: string }): string {
  const base = `${p.publicBaseUrl}/checkout/${encodeURIComponent(p.paymentId)}/complete`;
  const amount = new Intl.NumberFormat('en-US').format(p.amountCents / 100);
  return page(
    'Mock payment',
    `<h1>Mock payment gateway</h1>
<p class="amount">COP ${escapeHtml(amount)}</p>
<a class="btn pay" href="${escapeHtml(base)}?outcome=APPROVED">Pay</a>
<a class="btn decline" href="${escapeHtml(base)}?outcome=DECLINED">Decline</a>
<small>Payment ${escapeHtml(p.paymentId)}</small>`,
  );
}

export const alreadyCompletedPage = (status: string): string =>
  page('Mock payment', `<h1>Payment already ${escapeHtml(status.toLowerCase())}</h1><p>You can close this page.</p>`);

export const errorPage = (message: string): string =>
  page('Mock payment error', `<h1>Something went wrong</h1><p>${escapeHtml(message)}</p><p>Please try again.</p>`);
