// Checks what the weekly metrics email says, given what weekly_metrics()
// returned.
//
// The counting is done in the database (migrations/). This file is about the
// wording around the numbers: that a visit is called a visit, that the open
// rate is the one that cannot pass 100%, and that a number we do not have is
// not printed as a zero.
//
// Nothing here touches a real service. The digest is run through the Worker's
// scheduled handler, and the database call and the send are both answered by
// the stand-in below. All keys and numbers are made up.
//
//   node --test            from the repo root, runs every *.test.mjs
//
// Needs Node 22.12 or newer, which can load index.js as a module directly.
import { test } from "node:test";
import assert from "node:assert/strict";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  RESEND_API_KEY: "placeholder-not-a-key"
};

let metrics = null;
let sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (url === `${ENV.SUPABASE_URL}/rest/v1/rpc/weekly_metrics`) return reply(metrics);
  if (url === "https://api.resend.com/emails") {
    sent.push(JSON.parse(init.body));
    return reply({ id: "email_placeholder" });
  }
  if (url === `${ENV.SUPABASE_URL}/rest/v1/events`) return reply([{}], 201);
  throw new Error(`The Worker tried to reach ${url}, which this test does not expect`);
};

const { default: worker } = await import("./index.js");

const WEEK = {
  period: { days: 7, start: "2026-11-15T14:00:00+00:00", end: "2026-11-22T14:00:00+00:00" },
  site: {
    now: { visitors: 44, page_views: 61, clicks: 33 },
    prev: { visitors: 27, page_views: 32, clicks: 18 },
    pages: [{ path: "/", views: 51, visitors: 41 }],
    clicks: [{ label: "For clubs", path: "/", clicks: 6 }],
    referrers: [{ source: "direct or unknown", visitors: 41 }, { source: "www.google.com", visitors: 2 }],
    excluded: 0
  },
  email: {
    now: { sent: 4, delivered: 4, opened: 9, unique_opened: 6, opened_of_sent: 3, clicked: 1, bounced: 0, complained: 0 },
    prev: { sent: 2, delivered: 2, opened: 2, unique_opened: 1, opened_of_sent: 1, clicked: 0, bounced: 0, complained: 0 },
    by_kind: [{ kind: "Payment reminder", sent: 4, unique_opened: 6, clicked: 1, bounced: 0 }]
  },
  app: []
};

// The digest for one week of numbers, as the text a reader sees. `change` is
// merged over WEEK one level down, so a test states only what differs.
async function digest(change = {}) {
  metrics = { ...WEEK };
  for (const [section, value] of Object.entries(change)) metrics[section] = { ...WEEK[section], ...value };
  sent = [];
  const waiting = [];
  await worker.scheduled({ cron: "0 14 * * 1" }, ENV, { waitUntil: (p) => waiting.push(p) });
  await Promise.all(waiting);
  assert.equal(sent.length, 1, "exactly one email goes out");
  const text = sent[0].html
    .replace(/<\/(td|th|div|p|h2)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ");
  return { mail: sent[0], text };
}

test("it goes to the admin mailbox, dated by the window it covers", async () => {
  const { mail } = await digest();

  assert.deepEqual(mail.to, ["admin@playfundai.com"]);
  assert.equal(mail.subject, "PlayFund weekly metrics, Nov 15 to Nov 22");
});

test("sessions are called visits, and the email says what a visit is", async () => {
  const { text } = await digest();

  assert.match(text, /Visits\s+44\s+was 27/);
  assert.match(text, /Where visits came from/);
  assert.match(text, /A visit is one browser tab, not one person/);
  assert.match(text, /Counts include our own team/);
  assert.doesNotMatch(text, /Visitors/i);
});

test("rows left out of the website numbers are counted in a note", async () => {
  const none = await digest();
  assert.doesNotMatch(none.text, /left out of the website numbers/);

  const some = await digest({ site: { excluded: 12 } });
  assert.match(some.text, /12 page views and clicks from crawlers or preview links left out of the website numbers/);
});

test("the open rate is opens of this window's mail over this window's sends", async () => {
  // Six pieces of mail were opened, three of them sent this week. Four sent.
  const { text } = await digest();

  assert.match(text, /Open rate\s+75%\s*,\s*3 of 4 sent/);
  assert.match(text, /Unique opens\s+6\s+was 1/);
});

test("no open rate is shown without the number it needs", async () => {
  // What a database still on the first weekly_metrics() returns.
  const { text } = await digest({ email: { now: { sent: 1, delivered: 0, opened: 5, unique_opened: 5, clicked: 0, bounced: 0, complained: 0 } } });

  assert.doesNotMatch(text, /Open rate\s+\d/);
  assert.doesNotMatch(text, /500%/);
});

test("no open rate is shown in a week with no sends", async () => {
  const { text } = await digest({ email: { now: { ...WEEK.email.now, sent: 0, delivered: 0, opened_of_sent: 0 } } });

  assert.doesNotMatch(text, /Open rate\s+\d/);
});

test("sends with no delivery events read as not tracked, not as zero", async () => {
  const untracked = await digest({ email: { now: { ...WEEK.email.now, delivered: 0 } } });
  assert.match(untracked.text, /Delivered\s+not tracked/);
  assert.match(untracked.text, /Delivered is not tracked/);

  const tracked = await digest();
  assert.match(tracked.text, /Delivered\s+4\s+was 2/);
  assert.doesNotMatch(tracked.text, /not tracked/);
});

test("opens of mail with no recorded send are named and explained", async () => {
  const { text } = await digest({ email: { by_kind: [{ kind: "no send recorded", sent: 0, unique_opened: 2, clicked: 0, bounced: 0 }] } });

  assert.match(text, /No send recorded\s+0\s+2/);
  assert.match(text, /mail from before sends were logged/);
});
