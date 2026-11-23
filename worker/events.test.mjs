// Checks what POST /events stores, and what it refuses.
//
// The endpoint is open: the marketing pages and the app call it before anyone
// has signed in. The weekly metrics email is counted from the rows it writes,
// so these tests are about the marks the Worker adds to a row and the one
// family of event names it will not take from outside.
//
// Nothing here touches a real service. Every outgoing request the Worker makes
// is answered by the stand-in below. All keys and addresses are made-up
// placeholders.
//
//   node --test            from the repo root, runs every *.test.mjs
//
// Needs Node 22.12 or newer, which can load index.js as a module directly.
import { test } from "node:test";
import assert from "node:assert/strict";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key"
};
const EVENTS = `${ENV.SUPABASE_URL}/rest/v1/events`;

const SITE = "https://www.playfundai.com";
const PREVIEW = "https://abc123.playfund-app.pages.dev";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

let stored = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url !== EVENTS) throw new Error(`The Worker tried to reach ${url}, which this test does not expect`);
  stored.push(JSON.parse(init.body));
  return new Response(JSON.stringify([{}]), { status: 201, headers: { "Content-Type": "application/json" } });
};

const { default: worker } = await import("./index.js");

// One event, posted the way the page posts it: a text/plain beacon body.
// Returns the reply status and the row the Worker stored, if it stored one.
async function post({ origin = SITE, userAgent = BROWSER, event }) {
  stored = [];
  const headers = { "Content-Type": "text/plain" };
  if (origin) headers["Origin"] = origin;
  if (userAgent) headers["User-Agent"] = userAgent;
  const res = await worker.fetch(
    new Request("https://worker.invalid/events", { method: "POST", headers, body: JSON.stringify(event) }),
    ENV
  );
  return { status: res.status, row: stored[0] || null };
}

const PAGE_VIEW = { event_name: "site_page_view", session_id: "sess_1", properties: { path: "/", referrer: null } };

test("a page view from a browser on the live site is stored with no marks", async () => {
  const { status, row } = await post({ event: PAGE_VIEW });

  assert.equal(status, 200);
  assert.equal(row.event_name, "site_page_view");
  assert.equal(row.session_id, "sess_1");
  assert.deepEqual(row.properties, { path: "/", referrer: null });
});

test("a crawler's page view is stored, and marked", async () => {
  for (const userAgent of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "curl/8.7.1"
  ]) {
    const { row } = await post({ userAgent, event: PAGE_VIEW });
    assert.equal(row.properties._bot, true, userAgent);
    assert.equal("_preview" in row.properties, false, userAgent);
  }
});

test("a request with no User-Agent is marked as automated", async () => {
  const { row } = await post({ userAgent: null, event: PAGE_VIEW });

  assert.equal(row.properties._bot, true);
});

test("ordinary browsers are not mistaken for crawlers", async () => {
  for (const userAgent of [
    BROWSER,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"
  ]) {
    const { row } = await post({ userAgent, event: PAGE_VIEW });
    assert.equal("_bot" in row.properties, false, userAgent);
  }
});

test("a page view from a preview deploy is stored, and marked", async () => {
  const { row } = await post({ origin: PREVIEW, event: PAGE_VIEW });

  assert.equal(row.properties._preview, true);
  assert.equal("_bot" in row.properties, false);
});

test("the page cannot set or clear the marks itself", async () => {
  const claimed = { ...PAGE_VIEW, properties: { path: "/", _bot: false, _preview: "no" } };

  const live = await post({ event: claimed });
  assert.deepEqual(live.row.properties, { path: "/" });

  const crawler = await post({ origin: PREVIEW, userAgent: "curl/8.7.1", event: claimed });
  assert.equal(crawler.row.properties._bot, true);
  assert.equal(crawler.row.properties._preview, true);
});

test("mail events are refused, whatever follows the prefix", async () => {
  for (const event_name of ["email_sent", "email_opened", "email_delivered", "email_anything"]) {
    const { status, row } = await post({ event: { event_name, properties: { resend_email_id: "made-up" } } });
    assert.equal(status, 400, event_name);
    assert.equal(row, null, event_name);
  }
});

test("a request from another site is answered and not stored", async () => {
  for (const origin of ["https://elsewhere.invalid", null]) {
    const { status, row } = await post({ origin, event: PAGE_VIEW });
    assert.equal(status, 200);
    assert.equal(row, null);
  }
});
