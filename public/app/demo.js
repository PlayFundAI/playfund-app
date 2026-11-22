/* ═══════════════════════════════════════════════════════════════════════════
   PlayFund — demo mode

   The real app, driven by a fixture instead of the Worker. Loaded only when
   the URL carries a demo parameter (see the loader at the top of
   index.html's <head>), so a visit without one never fetches this layer.

   Why this exists
   ───────────────
   A demonstration must never write an athlete row, send an email or take a
   payment. In demo mode every call to the Worker and to the database is
   answered locally from a fixture, and the payment processor's two SDKs are
   replaced by stand-ins.

   How it stays that way
   ─────────────────────
   The loader in index.html runs first. It holds the app's start until this
   file reports that it is in place, writes a Content-Security-Policy that
   keeps scripts, frames, forms and connections on this origin (plus the two
   font hosts), and makes the request APIs refuse every other origin. If this
   file does not arrive, or stops part-way, the app never starts and the page
   says so. This file then puts the fixture in front of fetch, and passes
   anything it does not recognise back to the loader's guard, not the network.

   What it is NOT
   ──────────────
   A second copy of the product. Every screen, style, label and code path is
   the app's own. This file supplies data and swallows the network; it never
   draws a product screen. If a screen looks wrong in demo mode, it looks
   wrong in production too.

   URL
   ───
     ?demo=1                       the demo, club side first
     &club=Northside+Select        the club's name, for their meeting
     &city=Charlotte,+NC
     &dues=1200                    season dues per athlete (1,200 also works)
     &athletes=64                  roster size (funded/deciding/declined scale)
     &fee=800                      the club's rate in basis points
     &clubcode=NSS26               the club code families would type
     &guide=1                      presenter overlay, → to advance
     &auto=1                       advances itself, for screen recording
     &screen=club-overview         jump straight to one screen
     &chrome=0                     hide the demo badge and overlay (screenshots)
     &pending=1                    add an athlete awaiting club approval
     &athlete=a-marcus-bell        the parent's emailed link, as a family gets it
     &payout=none                  every payout figure withheld, to see the line
                                   of text a club is shown in place of a number
     &screen=admin-clubs           PlayFund staff screens, on the same made-up
                                   club: also admin-club-detail, admin-team-roster

   Keys with &guide=1: → or space next · ← back · r reset · g hide · 1-9 jump
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // This file is only safe to run behind the loader in index.html, which holds
  // the app's start and blocks outside requests before this file is fetched.
  // Without it, do not let the app start on the strength of this file alone.
  var boot = window.PF_DEMO_BOOT;
  if (!boot) {
    window.addEventListener('load', function (e) { e.stopImmediatePropagation(); }, true);
    try { window.stop(); } catch (e) {}
    document.documentElement.innerHTML =
      '<head><title>PlayFund</title></head><body><p>Demo mode could not start, so nothing was loaded.</p></body>';
    return;
  }
  if (boot.failed) return;

  var qs = new URLSearchParams(window.location.search);

  var WORKER = 'https://playfund-worker.playfund.workers.dev';
  var SUPA   = 'https://klnbdvwasnnqszlhawbl.supabase.co';

  // ─────────────────────────────────────────────────────────────────────────
  // Config
  //
  // Every value taken from the address is reduced to a plain one here, at the
  // point it is read. Nothing below this block reads the address.
  // ─────────────────────────────────────────────────────────────────────────

  // Names: letters, digits, spaces and . , - & ' and nothing else, with a
  // length cap. An ampersand is always followed by a space and an apostrophe
  // is shown as a typographic one, so neither means anything to a page that
  // writes the name as markup. A value with nothing left falls back.
  function text(name, dflt, max) {
    var v = qs.get(name);
    if (v == null) return dflt;
    v = String(v)
      .replace(/[^A-Za-z0-9\u00C0-\u024F .,'&-]/g, ' ')
      .replace(/&/g, ' & ')
      .replace(/'/g, '\u2019')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .replace(/[&\s]+$/, '');
    return v || dflt;
  }
  // Numbers: parsed with any thousands comma or currency sign removed, so
  // 1,200 and $1,200 both mean 1200. Not a number, or not above zero, falls
  // back. Otherwise it is held inside the range, or, when `strict`, falls
  // back if it is outside it.
  function number(name, dflt, min, max, strict) {
    var v = qs.get(name);
    if (v == null) return dflt;
    var n = Math.round(parseFloat(String(v).replace(/[,$\s]/g, '')));
    if (!isFinite(n) || n <= 0) return dflt;
    if (strict && (n < min || n > max)) return dflt;
    return Math.min(max, Math.max(min, n));
  }
  function flag(name, dflt) {
    var v = qs.get(name);
    if (v == null) return dflt;
    return v !== '0' && v !== 'false' && v !== 'no';
  }
  function emailAddress(name, dflt) {
    var v = String(qs.get(name) || '').trim();
    return v.length <= 80 && /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v) ? v : dflt;
  }
  function word(name, pattern) {
    var v = qs.get(name);
    return v != null && pattern.test(v) ? v : null;
  }

  // Defaults are the explainer film's numbers (video/src/script.ts), so the
  // film, the deck and this demo never disagree in front of a club.
  var cfg = {
    clubName: text('club', 'Riverside Soccer Club', 60),
    city:     text('city', 'Richmond, VA', 40),
    sport:    text('sport', 'Soccer', 24),
    code:     String(qs.get('clubcode') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'RIVER26',
    dues:     number('dues', 1000, 1, 50000),
    // A rate outside 1% to 20% is taken as a typing slip and the default is
    // shown, so a mistyped link cannot put a made-up rate on the dashboard.
    feeBps:   number('fee', 800, 100, 2000, true),
    athletes: number('athletes', 58, 3, 500),
    hold:     number('hold', 5200, 1000, 60000),
    adminName:  text('admin', 'Dana Whitfield', 60),
    adminEmail: emailAddress('email', 'treasurer@example.com'),
    screen:     word('screen', /^[a-z0-9-]{1,40}$/),
    role:       word('role', /^(parent|club)$/),
    method:     word('method', /^(full|bnpl)$/),
    hasAthlete: !!qs.get('athlete'),
    showChrome: flag('chrome', true),
    guide:      flag('guide', false),
    auto:       flag('auto', false),
    pending:    flag('pending', false),
    shot:       flag('shot', false),
    // Every payout figure withheld, as the app withholds one it cannot
    // confirm, so the line of text shown in its place can be looked at.
    payoutNone: word('payout', /^none$/) === 'none'
  };

  // Roster mix. Scales with &athletes= but keeps at least one of each bucket,
  // so the dashboard always shows all three rows.
  var total = cfg.athletes;
  var needsOption = Math.max(1, Math.round(total * 2 / 58));
  var deciding    = Math.max(1, Math.round(total * 6 / 58));
  var funded      = Math.max(1, total - needsOption - deciding);
  total = funded + deciding + needsOption;

  var SEASON = { start: '2027-03-07', end: '2027-05-30', due: '2027-02-21' };

  // ─────────────────────────────────────────────────────────────────────────
  // Fixture
  // ─────────────────────────────────────────────────────────────────────────
  // A payment reference is shown on the confirmation screen. Derived from the
  // id rather than random, so a screenshot taken today matches one taken in
  // the meeting — and deliberately not words, which is what slicing the
  // athlete's own id produced.
  function refFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 'pi_demo_' + h.toString(16) + (h % 97).toString(16) + 'a4';
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20261111);

  // Dues broken into the lines a parent actually recognises. Proportions are
  // the film's; they are rescaled to whatever dues the club has, with the
  // rounding remainder put on the first line so the four always sum to dues.
  function duesBreakdown(dues) {
    var parts = [
      { label: 'League registration', share: 0.42 },
      { label: 'Coaching',            share: 0.28 },
      { label: 'Uniform and kit',     share: 0.18 },
      { label: 'Tournament travel',   share: 0.12 }
    ];
    var out = parts.map(function (p) {
      return { label: p.label, amount: Math.round(dues * p.share) };
    });
    var drift = dues - out.reduce(function (s, f) { return s + f.amount; }, 0);
    out[0].amount += drift;
    return out;
  }

  var fees = duesBreakdown(cfg.dues);
  var duesCents = cfg.dues * 100;

  // ─────────────────────────────────────────────────────────────────────────
  // Money
  //
  // The one place in this file where a payment is divided. In the real app
  // these numbers are the payment processor's, read back after each payment,
  // and the page only ever shows the sum of them. Here the fixture plays the
  // processor, so it divides each payment once, when the payment is made,
  // and every figure the demo shows is a sum of those records: the headline
  // is the sum of the club shares, a team's figure is the sum for its
  // athletes, and paying for one more athlete moves the headline by exactly
  // that family's club share.
  //
  // The rule is the product's (worker/fees.mjs): a family that pays in full
  // carries card processing cost only, 2.9% plus 30c; a family on
  // installments carries the club's rate. worker/demo.test.mjs fails if the
  // two numbers below stop matching that file.
  // ─────────────────────────────────────────────────────────────────────────
  var PAY_IN_FULL_FEE_BPS = 290;
  var PAY_IN_FULL_FEE_FIXED_CENTS = 30;

  // `type` is 'full' or 'bnpl', as at checkout. Whole cents in and out, and
  // the fee and the club's share always add back up to the amount.
  function splitPayment(amountCents, type) {
    var fee = type === 'bnpl'
      ? Math.round(amountCents * cfg.feeBps / 10000)
      : Math.min(amountCents, Math.round(amountCents * PAY_IN_FULL_FEE_BPS / 10000) + PAY_IN_FULL_FEE_FIXED_CENTS);
    return { charge_cents: amountCents, application_fee_cents: fee, club_net_cents: amountCents - fee };
  }

  // The record of one family's payment: the team's dues at the moment of
  // paying, divided as above. Kept on the athlete and never worked out again.
  function paymentFor(a, type, when, reference) {
    var amount = teamOf(a).dues_cents;
    return Object.assign({
      id: 'pay-' + a.id,
      created_at: when,
      amount_cents: amount,
      status: 'succeeded',
      payment_method: type === 'bnpl' ? 'klarna' : 'card',
      installment_number: null,
      stripe_payment_intent: reference
    }, splitPayment(amount, type));
  }

  var teams = [
    { id: 't-12u', name: '12U Travel', age_group: '12U' },
    { id: 't-14u', name: '14U Select', age_group: '14U' },
    { id: 't-16u', name: '16U Elite',  age_group: '16U' }
  ].map(function (t) {
    return Object.assign(t, {
      dues_cents: duesCents,
      season_start: SEASON.start,
      season_end: SEASON.end,
      dues_due_date: SEASON.due,
      fees: fees,
      athletes: []
    });
  });

  // The first names match the film and the marketing shot, so a club that
  // watched the video sees the same roster it already saw.
  var ANCHORS = [
    { name: 'Maya Rivera',    team: 0, status: 'paid_full',   method: 'card'   },
    { name: 'Jordan Rivera',  team: 0, status: 'bnpl_active', method: 'klarna' },
    { name: 'Marcus Bell',    team: 1, status: 'unpaid', id: 'a-marcus-bell', email: 'ana.bell@example.com' },
    { name: 'Elena Bell',     team: 0, status: 'unpaid', id: 'a-elena-bell',  email: 'ana.bell@example.com' },
    { name: 'Ava Bennett',    team: 1, status: 'paid_full',   method: 'card'   },
    { name: 'Liam Carter',    team: 1, status: 'bnpl_active', method: 'klarna' },
    { name: 'Sophia Dawson',  team: 2, status: 'paid_full',   method: 'card'   },
    { name: 'Noah Foster',    team: 2, status: 'unpaid' },
    { name: 'Isabella Grant', team: 2, status: 'bnpl_active', method: 'klarna' }
  ];

  var FIRST = ['Mason', 'Harper', 'Carter', 'Layla', 'Owen', 'Aria', 'Wyatt', 'Nora',
    'Grant', 'Ellie', 'Jaxon', 'Riley', 'Ethan', 'Mia', 'Lucas', 'Ruby', 'Theo',
    'Nina', 'Felix', 'Iris', 'Dante', '清', 'Amara', 'Silas', 'Priya', 'Omar',
    'Leah', 'Nico', 'Zara', 'Hugo'].filter(function (n) { return /^[A-Za-z]+$/.test(n); });
  var LAST = ['Bennett', 'Dawson', 'Ellis', 'Foster', 'Hayes', 'Irving', 'Jennings',
    'Kemp', 'Lawson', 'Marsh', 'Nash', 'Ortiz', 'Pierce', 'Quinn', 'Reyes', 'Sloan',
    'Tate', 'Vance', 'Whitfield', 'Yates', 'Okafor', 'Delgado', 'Haddad', 'Novak'];

  var athletes = [];
  var seq = 0;
  function addAthlete(name, teamIdx, status, method, id, email) {
    var a = {
      id: id || ('a-demo-' + (++seq)),
      name: name,
      team_id: teams[teamIdx].id,
      club_id: 'c-demo',
      payment_status: status,
      payment_method: method || null,
      approval_status: 'approved',
      parent_email: email || null,
      enrolled_at: '2026-11-02T15:12:00.000Z',
      payments: []
    };
    if (status === 'paid_full' || status === 'bnpl_active') {
      a.payments = [paymentFor(a, status === 'paid_full' ? 'full' : 'bnpl', '2026-11-04T18:20:00.000Z', refFor(a.id))];
    }
    athletes.push(a);
    teams[teamIdx].athletes.push(a);
    return a;
  }

  var want = { paid_full: 0, bnpl_active: 0, unpaid: deciding, defaulted: needsOption };
  // Funded splits roughly half card, half installments — the mix the pilot
  // exists to learn, shown as a mix rather than a claim.
  want.bnpl_active = Math.round(funded * 0.55);
  want.paid_full = funded - want.bnpl_active;

  var got = { paid_full: 0, bnpl_active: 0, unpaid: 0, defaulted: 0 };
  ANCHORS.forEach(function (a) {
    if (got[a.status] >= want[a.status]) return;
    got[a.status]++;
    addAthlete(a.name, a.team, a.status, a.method, a.id, a.email);
  });

  var usedNames = {};
  athletes.forEach(function (a) { usedNames[a.name] = true; });
  function nextName() {
    for (var i = 0; i < 400; i++) {
      var n = FIRST[Math.floor(rand() * FIRST.length)] + ' ' + LAST[Math.floor(rand() * LAST.length)];
      if (!usedNames[n]) { usedNames[n] = true; return n; }
    }
    return 'Athlete ' + (++seq);
  }
  ['paid_full', 'bnpl_active', 'unpaid', 'defaulted'].forEach(function (status) {
    var method = status === 'paid_full' ? 'card' : status === 'bnpl_active' ? 'klarna' : null;
    while (got[status] < want[status]) {
      got[status]++;
      // Round-robin across teams so no team looks empty.
      addAthlete(nextName(), athletes.length % 3, status, method);
    }
  });

  if (cfg.pending) {
    var p = addAthlete('Tyler Nash', 1, 'unpaid', null, 'a-pending-1', 'nash.family@example.com');
    p.approval_status = 'pending';
  }

  var club = {
    id: 'c-demo',
    name: cfg.clubName,
    sport: cfg.sport,
    city: cfg.city,
    state: (cfg.city.split(',')[1] || '').trim() || null,
    code: cfg.code,
    active: true,
    fees_per_athlete: cfg.dues,
    fee_bps: cfg.feeBps,
    fee_agreed_at: '2026-11-01T00:00:00.000Z',
    teams: teams
  };

  function publicClub() {
    var c = Object.assign({}, club);
    delete c.fee_bps;
    delete c.fee_agreed_at;
    c.teams = teams.map(function (t) {
      var copy = Object.assign({}, t);
      delete copy.athletes;              // minors' data is never public
      copy.dues = t.dues_cents / 100;
      return copy;
    });
    return c;
  }
  // ─────────────────────────────────────────────────────────────────────────
  // Payout figures, in the shape the Worker sends them
  //
  // The app shows a figure only when the Worker says it is confirmed, and one
  // line of text otherwise. { verified: true, ... } with whole cents is a
  // figure; { verified: false } is none. The page marks each one with the
  // time it asked, and stops showing it a minute later unless it has asked
  // again, so these are always built fresh for each reply.
  // ─────────────────────────────────────────────────────────────────────────
  function isFunded(a) {
    return ['paid_full', 'bnpl_active', 'bnpl_complete'].indexOf(a.payment_status) !== -1;
  }
  // The sum of the payment records of a list of athletes.
  function payoutOf(list) {
    if (cfg.payoutNone) return { verified: false };
    var out = { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0 };
    list.forEach(function (a) {
      (a.payments || []).forEach(function (pay) {
        if (pay.status !== 'succeeded') return;
        out.club_net_cents += pay.club_net_cents;
        out.charge_cents += pay.charge_cents;
        out.payment_count += 1;
      });
    });
    return out;
  }
  function clubPayout() {
    var out = payoutOf(athletes);
    if (out.verified) out.checked_at = new Date().toISOString();
    return out;
  }
  // What PlayFund staff are shown about the last check of the club.
  function payoutCheck() {
    var when = new Date().toISOString();
    return cfg.payoutNone
      ? { status: 'failed', reason: 'demo', message: 'Demo: this is how a club looks when its check has not passed.', detail: null, checked_at: when }
      : { status: 'verified', reason: null, message: null, detail: null, checked_at: when };
  }

  function authorizedClub() {
    var c = Object.assign({}, club, { payout: clubPayout() });
    c.teams = teams.map(function (t) {
      return Object.assign({}, t, { dues: t.dues_cents / 100, payout: payoutOf(t.athletes) });
    });
    return c;
  }
  function stats() {
    return {
      total_athletes: athletes.length,
      funded_athletes: athletes.filter(isFunded).length
    };
  }
  // The reply to the staff list of clubs: one club, its teams, and the totals.
  function adminClubs() {
    var payout = clubPayout();
    var pendingApprovals = athletes.filter(function (a) { return a.approval_status === 'pending'; }).length;
    var fundedCount = athletes.filter(isFunded).length;
    var row = Object.assign({}, club, {
      stripe_connected: true,
      needs_fee: false,
      needs_stripe: false,
      pending_approvals: pendingApprovals,
      needs_action: pendingApprovals > 0,
      team_count: teams.length,
      athlete_count: athletes.length,
      funded_count: fundedCount,
      payout: payout,
      payout_check: payoutCheck(),
      teams: teams.map(function (t) {
        return {
          id: t.id, club_id: club.id, name: t.name, age_group: t.age_group, dues_cents: t.dues_cents,
          athlete_count: t.athletes.length,
          payout: payoutOf(t.athletes)
        };
      })
    });
    return {
      clubs: [row],
      totals: {
        clubs: 1,
        teams: teams.length,
        athletes: athletes.length,
        funded: fundedCount,
        // A total exists only when every club has a figure. There is one club.
        payout: payout.verified
          ? { verified: true, club_net_cents: payout.club_net_cents, charge_cents: payout.charge_cents, payment_count: payout.payment_count }
          : { verified: false, unverified_clubs: 1 }
      }
    };
  }
  function findAthlete(id) {
    for (var i = 0; i < athletes.length; i++) if (athletes[i].id === id) return athletes[i];
    return null;
  }
  function teamOf(a) {
    for (var i = 0; i < teams.length; i++) if (teams[i].id === a.team_id) return teams[i];
    return teams[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session the app believes it signed in with
  // ─────────────────────────────────────────────────────────────────────────
  function session() {
    return {
      access_token: 'demo.access.token',
      refresh_token: 'demo.refresh.token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: 'u-demo-club-admin',
        email: cfg.adminEmail,
        role: 'club_admin',
        club_id: club.id,
        team_id: null,
        display_name: cfg.adminName,
        club: { id: club.id, name: club.name, sport: club.sport, city: club.city, state: club.state, code: club.code }
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Network: every Worker and Supabase call is answered here
  // ─────────────────────────────────────────────────────────────────────────
  // Not the browser's fetch: the loader in index.html has already replaced
  // that with one that refuses every origin but this page's own. Anything the
  // fixture does not answer is handed to it, never to the network directly.
  var guardedFetch = window.fetch;

  function reply(body, status) {
    return new Response(JSON.stringify(body == null ? {} : body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  // A beat of latency, so "Signing in…" and "Looking up club…" are seen doing
  // their job rather than flashing past. Checkout gets a longer one.
  function after(ms, body, status) {
    return new Promise(function (res) {
      setTimeout(function () { res(reply(body, status)); }, ms);
    });
  }
  function headerOf(init, name) {
    var h = (init && init.headers) || null;
    if (!h) return '';
    try {
      if (typeof h.get === 'function') return h.get(name) || '';
    } catch (e) { /* not a Headers */ }
    var want = name.toLowerCase();
    for (var k in h) if (k.toLowerCase() === want) return String(h[k] || '');
    return '';
  }
  function bodyOf(init) {
    try { return JSON.parse((init && init.body) || '{}'); } catch (e) { return {}; }
  }

  var state = { linksSent: 0, remindersSent: 0 };

  function route(method, path, url, init) {
    var authed = !!headerOf(init, 'Authorization');
    var body = bodyOf(init);
    var m;

    // Analytics: swallowed. A demo must not land in the pilot's own numbers.
    if (path === '/events') return after(0, { ok: true });

    if (path === '/config') {
      return after(60, { stripePublishableKey: 'pk_demo_not_a_real_key' });
    }

    if (method === 'POST' && path === '/auth/login') {
      if (!body.email || !body.password) return after(200, { error: 'email and password required' }, 400);
      return after(420, session());
    }
    if (method === 'POST' && path === '/auth/refresh') return after(120, session());
    if (method === 'POST' && path === '/auth/forgot-password') return after(400, { ok: true });
    if (method === 'POST' && path === '/auth/signup') {
      return after(500, Object.assign(session(), {
        user: Object.assign(session().user, { role: 'parent', club_id: null })
      }));
    }

    if (method === 'GET' && path === '/parent/athletes') {
      var mine = athletes.filter(function (a) { return a.parent_email === 'ana.bell@example.com'; });
      return after(260, {
        athletes: mine.map(function (a) {
          var t = teamOf(a);
          return Object.assign({}, a, {
            team: { id: t.id, name: t.name, dues_cents: t.dues_cents, season_start: t.season_start, season_end: t.season_end },
            club: { id: club.id, name: club.name, code: club.code, city: club.city, state: club.state }
          });
        })
      });
    }

    if (method === 'GET' && (m = path.match(/^\/club\/([^/]+)\/stripe-status$/))) {
      return after(180, { connected: true, charges_enabled: true, details_submitted: true });
    }
    if (method === 'POST' && (m = path.match(/^\/club\/([^/]+)\/stripe-onboard$/))) {
      return after(300, { client_secret: 'demo_connect_secret' });
    }
    if (method === 'POST' && (m = path.match(/^\/club\/([^/]+)\/send-payment-links$/))) {
      var unpaid = athletes.filter(function (a) {
        return a.approval_status === 'approved' && a.payment_status === 'unpaid';
      });
      state.linksSent += unpaid.length;
      return after(700, { success: true, sent: unpaid.length, skipped: [] });
    }
    if (method === 'GET' && (m = path.match(/^\/club\/([^/]+)$/))) {
      var code = decodeURIComponent(m[1]).toUpperCase();
      if (code !== club.code) return after(220, { error: 'Club not found' }, 404);
      return authed
        ? after(320, { club: authorizedClub(), stats: stats() })
        : after(320, { club: publicClub() });
    }
    if (method === 'POST' && path === '/club/register') {
      return after(900, {
        club: { id: 'c-new-demo', name: body.name, code: 'DEMO' + Math.floor(rand() * 900 + 100), teams: body.teams || [] },
        invite_url: null,
        invite_error: null,
        message: 'Registration received. Check your email for a link to set up your account.'
      }, 201);
    }

    if (method === 'POST' && path === '/team') {
      var t = {
        id: 't-new-' + (++seq),
        name: body.name,
        age_group: body.age_group,
        dues_cents: body.dues_cents,
        season_start: body.season_start,
        season_end: body.season_end,
        dues_due_date: body.dues_due_date,
        fees: body.fees || [],
        athletes: []
      };
      teams.push(t);
      // Like any team in a reply, it carries its payout figure: nothing yet.
      return after(600, { team: Object.assign({}, t, { payout: payoutOf(t.athletes) }) }, 201);
    }

    if (method === 'POST' && path === '/athlete') {
      var tIdx = 0;
      for (var i = 0; i < teams.length; i++) if (teams[i].id === body.team_id) tIdx = i;
      var created = addAthlete(body.athlete_name, tIdx, 'unpaid', null, null, body.parent_email);
      // Self-serve registrations stay pending in production. Demo mode keeps
      // that honest: the athlete the club added is approved, one a parent
      // adds is not, and the approval wall is part of the story.
      created.approval_status = authed ? 'approved' : 'pending';
      return after(700, {
        athlete: created,
        payment_invite_sent: authed,
        club_can_accept_payments: true
      }, 201);
    }
    if (method === 'POST' && (m = path.match(/^\/athlete\/([^/]+)\/approve$/))) {
      var ap = findAthlete(m[1]);
      if (ap) ap.approval_status = 'approved';
      return after(450, { success: true, payment_invite_sent: true, club_can_accept_payments: true });
    }
    if (method === 'POST' && (m = path.match(/^\/athlete\/([^/]+)\/notify-club$/))) {
      return after(600, { success: true });
    }
    if (method === 'DELETE' && (m = path.match(/^\/athlete\/([^/]+)$/))) {
      var del = findAthlete(m[1]);
      if (del) {
        athletes.splice(athletes.indexOf(del), 1);
        var t2 = teamOf(del);
        if (t2.athletes.indexOf(del) !== -1) t2.athletes.splice(t2.athletes.indexOf(del), 1);
      }
      return after(400, { success: true });
    }
    if (method === 'POST' && (m = path.match(/^\/athlete\/([^/]+)\/checkout$/))) {
      var ca = findAthlete(m[1]);
      if (!ca) return after(300, { error: 'Athlete not found' }, 404);
      if (ca.approval_status === 'pending') {
        return after(300, { error: "This athlete is still waiting on the club to confirm they're on the roster before you can pay." }, 403);
      }
      pendingCheckout = { athleteId: ca.id, type: body.payment_type };
      return after(500, { client_secret: 'cs_demo_' + ca.id });
    }
    if (method === 'GET' && path === '/checkout/session-email') {
      return after(200, { email: 'ana.bell@example.com' });
    }
    if (method === 'GET' && path === '/athletes/status') {
      var ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      return after(180, {
        statuses: ids.map(function (id) {
          var a = findAthlete(id);
          return a ? { id: a.id, payment_status: a.payment_status, approval_status: a.approval_status } : null;
        }).filter(Boolean)
      });
    }
    if (method === 'GET' && (m = path.match(/^\/athlete\/([^/]+)$/))) {
      var ga = findAthlete(m[1]);
      if (!ga) return after(200, { error: 'Athlete not found' }, 404);
      var gt = teamOf(ga);
      return after(200, {
        athlete: Object.assign({}, ga, { team_name: gt.name, dues: gt.dues_cents / 100 }),
        // A family is sent what it paid, as in the real reply. How the
        // payment was divided is not part of it.
        payments: (ga.payments || []).map(function (pp) {
          return {
            id: pp.id, created_at: pp.created_at, amount_cents: pp.amount_cents, status: pp.status,
            payment_method: pp.payment_method, installment_number: pp.installment_number,
            stripe_payment_intent: pp.stripe_payment_intent, amount: pp.amount_cents / 100
          };
        })
      });
    }

    if (method === 'POST' && path === '/remind') {
      var rt = null;
      for (var j = 0; j < teams.length; j++) if (teams[j].id === body.team_id) rt = teams[j];
      var n = rt ? rt.athletes.filter(function (a) { return a.payment_status === 'unpaid'; }).length : 0;
      state.remindersSent += n;
      return after(800, { sent: n, skipped: [], total: n });
    }
    if (method === 'POST' && path === '/scholarship/apply') return after(700, { success: true });
    if (method === 'POST' && path === '/invite') return after(700, { success: true });
    if (method === 'POST' && path === '/contact') return after(600, { success: true });
    if (method === 'POST' && path === '/parent-request') return after(600, { success: true });

    if (method === 'GET' && path === '/admin/clubs') {
      return after(400, adminClubs());
    }
    // The payments list on a club's staff page: what each family was charged.
    if (method === 'GET' && (m = path.match(/^\/admin\/clubs\/([^/]+)\/payments$/))) {
      var listed = [];
      athletes.forEach(function (a) {
        (a.payments || []).forEach(function (pay) {
          listed.push({
            id: pay.id, created_at: pay.created_at, amount_cents: pay.amount_cents, status: pay.status,
            payment_method: pay.payment_method, installment_number: pay.installment_number, athlete_id: a.id,
            amount: pay.amount_cents / 100, athlete_name: a.name, team_name: teamOf(a).name
          });
        });
      });
      listed.sort(function (x, y) { return x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0; });
      return after(300, { payments: listed });
    }
    // "Check now" on a club's staff page.
    if (method === 'POST' && (m = path.match(/^\/admin\/clubs\/([^/]+)\/payout-check$/))) {
      return after(700, { payout_check: payoutCheck(), payout: clubPayout() });
    }

    // Supabase is only reached for auth lookups; nothing in the demo needs one.
    if (path.indexOf('/auth/v1/') === 0) return after(150, { id: 'u-demo-club-admin', email: cfg.adminEmail });

    console.warn('[demo] unrouted call, answered locally and NOT sent:', method, path);
    return after(150, { error: 'Not available in demo mode.' }, 501);
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    // Matched on the whole origin, so an address that only starts with the
    // Worker's name is not mistaken for it.
    var u = null;
    try { u = new URL(url, document.baseURI); } catch (e) { /* left to the guard */ }
    if (!u || (u.origin !== WORKER && u.origin !== SUPA)) {
      return guardedFetch(input, init);
    }
    return route(method, u.pathname, u, init);
  };

  // The app tidies its own one-time parameters out of the address with
  // history.replaceState, and takes the rest of the query with them. Left
  // alone, that would drop the demo parameter and make the next reload a
  // visit without it. Any address the app writes keeps the parameter.
  ['pushState', 'replaceState'].forEach(function (name) {
    var native = window.history[name];
    window.history[name] = function (state, title, url) {
      if (url != null) {
        try {
          var next = new URL(String(url), window.location.href);
          var kept = false;
          next.searchParams.forEach(function (v, k) { if (k.toLowerCase() === 'demo') kept = true; });
          if (!kept) { next.searchParams.set('demo', '1'); url = next.href; }
        } catch (e) { /* left as given */ }
      }
      return native.call(window.history, state, title, url);
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Stripe stand-ins
  //
  // js.stripe.com and connect.js are still <script> tags in <head>, but in
  // demo mode the loader's policy stops both from running, so these are the
  // only versions the app ever sees. They are still defined as getters whose
  // setter ignores the write, so nothing that runs later can put a real SDK
  // in their place.
  // ─────────────────────────────────────────────────────────────────────────
  var pendingCheckout = null;

  function fakeEmbeddedCheckout(opts) {
    var mounted = null;
    return {
      mount: function (selector) {
        mounted = document.querySelector(selector);
        if (!mounted) return;
        var type = (pendingCheckout && pendingCheckout.type) || 'full';
        var payer = pendingCheckout && findAthlete(pendingCheckout.athleteId);
        mounted.innerHTML = checkoutMarkup(type, payer ? teamOf(payer).dues_cents / 100 : cfg.dues);
        var pay = mounted.querySelector('[data-demo-pay]');
        if (pay) pay.addEventListener('click', function () {
          pay.disabled = true;
          pay.textContent = 'Processing…';
          // The fixture flips on the click, not when the theatre finishes:
          // anything that reads the club's payout in the next second — a
          // presenter who jumps straight back to the dashboard — must not be
          // able to catch the roster mid-payment.
          if (pendingCheckout) {
            var a = findAthlete(pendingCheckout.athleteId);
            if (a) markPaid(a, pendingCheckout.type);
          }
          setTimeout(function () {
            if (opts && typeof opts.onComplete === 'function') opts.onComplete();
          }, 900);
        });
        var decline = mounted.querySelector('[data-demo-decline]');
        // Opens the app's own screen for a family that was not approved, in
        // the app's own words. Nothing is invented here about the reason.
        if (decline) decline.addEventListener('click', function (e) {
          e.preventDefault();
          if (typeof window.showDeclineScreen === 'function') window.showDeclineScreen();
        });
      },
      destroy: function () { if (mounted) mounted.innerHTML = ''; },
      unmount: function () { if (mounted) mounted.innerHTML = ''; }
    };
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function checkoutMarkup(type, dues) {
    var head =
      '<div style="border:1px solid var(--line); border-radius:var(--r-lg); overflow:hidden;">' +
        '<div style="background:var(--paper-dim); padding:10px 14px; font-size:11.5px; font-weight:700; letter-spacing:0.03em; color:var(--ink-soft); display:flex; justify-content:space-between; align-items:center;">' +
          '<span>STAND-IN FOR THE PAYMENT SHEET</span><span style="color:var(--fund-green);">NO CARD IS CHARGED</span>' +
        '</div>';
    var foot = '</div>';

    // Installments. The approved line and nothing more: no per-payment
    // amounts and no dates, because the payment partner sets the schedule
    // and PlayFund is not told it.
    if (type === 'bnpl') {
      return head +
        '<div style="padding:18px 16px;">' +
          '<div style="font-size:13px; color:var(--ink-soft); margin-bottom:4px;">Here the family is handed to our payment partner. Installments are subject to approval by our payment partner.</div>' +
          '<div style="font-size:19px; font-weight:800; color:var(--ink); margin:14px 0 4px;">Commonly 4 interest-free payments, if approved</div>' +
          '<div style="font-size:12.5px; color:var(--ink-soft); margin-bottom:16px;">Season dues ' + money(dues) + '</div>' +
          '<button class="btn btn-primary" data-demo-pay style="width:100%;">Continue as if approved</button>' +
          '<div style="text-align:center; margin-top:12px;">' +
            '<a href="#" data-demo-decline style="font-size:12px; color:var(--ink-faint);">Show a family that is not approved</a>' +
          '</div>' +
        '</div>' + foot;
    }

    return head +
      '<div style="padding:18px 16px;">' +
        '<div style="font-size:13px; color:var(--ink-soft); margin-bottom:14px;">Card details live in the processor\'s own frame and never reach PlayFund. This is a drawing of it.</div>' +
        '<div class="field" style="margin-bottom:10px;"><label>Card number</label>' +
          '<input type="text" value="4242 4242 4242 4242" readonly style="background:var(--paper-dim); color:var(--ink-soft);"></div>' +
        '<div style="display:flex; gap:10px; margin-bottom:16px;">' +
          '<div class="field" style="flex:1;"><label>Expiry</label><input type="text" value="04 / 30" readonly style="background:var(--paper-dim); color:var(--ink-soft);"></div>' +
          '<div class="field" style="flex:1;"><label>CVC</label><input type="text" value="123" readonly style="background:var(--paper-dim); color:var(--ink-soft);"></div>' +
        '</div>' +
        '<button class="btn btn-primary" data-demo-pay style="width:100%;">Pay ' + money(dues) + '</button>' +
      '</div>' + foot;
  }

  function markPaid(a, type) {
    a.payment_status = type === 'bnpl' ? 'bnpl_active' : 'paid_full';
    a.payment_method = type === 'bnpl' ? 'klarna' : 'card';
    a.payments = [paymentFor(a, type === 'bnpl' ? 'bnpl' : 'full', new Date().toISOString(), refFor(a.id + '-paid'))];
  }

  var stripeStub = function () {
    return {
      initEmbeddedCheckout: function (opts) { return Promise.resolve(fakeEmbeddedCheckout(opts)); },
      elements: function () { return { create: function () { return { mount: function () {} }; } }; }
    };
  };
  function define(name, value) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return value; },
        set: function () { /* the real SDK is ignored in demo mode */ }
      });
    } catch (e) { window[name] = value; }
  }
  define('Stripe', stripeStub);

  // Club bank onboarding. Connect.js renders a custom element; the stand-in is
  // a div that says what the club would actually be asked for, and exits the
  // way the real one does.
  function fakeConnectInit() {
    return {
      create: function () {
        var el = document.createElement('div');
        var onExit = null;
        el.setOnExit = function (fn) { onExit = fn; };
        el.innerHTML =
          '<div style="border:1px solid var(--line); border-radius:var(--r-lg); overflow:hidden;">' +
            '<div style="background:var(--paper-dim); padding:10px 14px; font-size:11.5px; font-weight:700; letter-spacing:0.03em; color:var(--ink-soft);">STAND-IN FOR THE BANK CONNECTION</div>' +
            '<div style="padding:18px 16px;">' +
              '<div style="font-size:13.5px; color:var(--ink); font-weight:700; margin-bottom:8px;">What your treasurer is asked for</div>' +
              '<ul style="margin:0 0 16px; padding-left:18px; font-size:13px; color:var(--ink-soft); line-height:1.8;">' +
                '<li>The club\'s legal name and EIN</li>' +
                '<li>The account payouts land in</li>' +
                '<li>ID for anyone owning 25% or more, or, for a 501(c)(3), directors and officers</li>' +
              '</ul>' +
              '<div style="font-size:12.5px; color:var(--ink-faint); margin-bottom:16px;">Handled by our payment partner, in their own frame. PlayFund never sees it. You can stop and come back to it.</div>' +
              '<button class="btn btn-primary" data-demo-connect style="width:100%;">Finish connecting</button>' +
            '</div>' +
          '</div>';
        setTimeout(function () {
          var b = el.querySelector('[data-demo-connect]');
          if (b) b.addEventListener('click', function () { if (onExit) onExit(); });
        }, 0);
        return el;
      }
    };
  }
  define('stripeConnectReady', Promise.resolve(fakeConnectInit));
  define('StripeConnect', { init: fakeConnectInit, onLoad: function () {} });

  // The promise index.html builds in <head> still exists in its own closure
  // and still rejects on its 15s timer, because connect.js can no longer
  // reach the onLoad hook it was waiting for. Nothing reads it any more, so
  // the only thing it produces is a red line in the console during a demo.
  window.addEventListener('unhandledrejection', function (e) {
    var msg = String((e.reason && e.reason.message) || e.reason || '');
    if (/Stripe Connect failed to load/.test(msg)) e.preventDefault();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reset: every run of the demo starts from the same place
  // ─────────────────────────────────────────────────────────────────────────
  var PARENT_ATHLETES = 'playfund_parent_athletes';

  function seededParentAthletes() {
    return ['a-marcus-bell', 'a-elena-bell'].map(function (id) {
      var a = findAthlete(id);
      if (!a) return null;
      return {
        id: 'local-' + id,
        supabaseId: a.id,
        name: a.name,
        clubId: club.id,
        clubCode: club.code,
        teamId: a.team_id,
        paymentStatus: null,
        termWeeks: null,
        history: null,
        parentEmail: a.parent_email,
        approvalStatus: 'approved'
      };
    }).filter(Boolean);
  }

  // The app's own storage keys are shadowed in memory rather than written to.
  //
  // Two reasons. A real parent who ever opens a ?demo=1 link has their own
  // athlete list in localStorage under this exact key, and seeding the demo
  // over it would delete their registrations. And a demo that leaves nothing
  // behind resets by reloading the page, which is the one recovery a
  // presenter can perform without thinking.
  var SHADOWED = {
    'playfund_parent_athletes': 1,
    'pf_club_session': 1,
    'pf_parent_session': 1,
    'pf_club_verify_cache': 1,
    'pf_events_session_id': 1,
    'pf_admin_token': 1
  };
  var shadow = {};
  (function shadowStorage() {
    var proto = window.Storage && window.Storage.prototype;
    if (!proto) return;
    var get = proto.getItem, set = proto.setItem, del = proto.removeItem;
    proto.getItem = function (k) {
      if (SHADOWED[k]) return Object.prototype.hasOwnProperty.call(shadow, k) ? shadow[k] : null;
      return get.call(this, k);
    };
    proto.setItem = function (k, v) {
      if (SHADOWED[k]) { shadow[k] = String(v); return; }
      return set.call(this, k, v);
    };
    proto.removeItem = function (k) {
      if (SHADOWED[k]) { delete shadow[k]; return; }
      return del.call(this, k);
    };
  })();
  shadow[PARENT_ATHLETES] = JSON.stringify(seededParentAthletes());

  // ─────────────────────────────────────────────────────────────────────────
  // Badge, so nobody ever mistakes this for the live app
  // ─────────────────────────────────────────────────────────────────────────
  var CSS =
    '.pfd-badge{position:fixed;top:10px;left:10px;z-index:2000;background:#004643;color:#fff;' +
      'font:700 10.5px/1 Inter,sans-serif;letter-spacing:.08em;padding:6px 9px;border-radius:6px;' +
      'text-transform:uppercase;pointer-events:none;opacity:.85}' +
    '.pfd-guide{position:fixed;right:14px;bottom:14px;z-index:2000;width:330px;max-width:calc(100vw - 28px);' +
      'background:#04302E;color:#fff;border-radius:14px;padding:16px 18px 14px;' +
      'font-family:Inter,sans-serif;box-shadow:0 18px 50px rgba(0,70,67,.28)}' +
    '.pfd-guide.is-min{width:auto;padding:9px 13px}' +
    '.pfd-step{font:700 10.5px/1 Inter,sans-serif;letter-spacing:.08em;color:#8FD3B6;text-transform:uppercase;margin-bottom:8px}' +
    '.pfd-say{font-size:14.5px;font-weight:700;line-height:1.45;margin-bottom:8px}' +
    '.pfd-note{font-size:12.5px;line-height:1.55;color:rgba(255,255,255,.66)}' +
    '.pfd-do{font-size:12px;line-height:1.5;color:#8FD3B6;margin-top:10px}' +
    '.pfd-keys{font-size:10.5px;color:rgba(255,255,255,.42);margin-top:12px;border-top:1px solid rgba(255,255,255,.12);padding-top:9px}' +
    '.pfd-bar{height:3px;background:rgba(255,255,255,.14);border-radius:2px;margin-top:11px;overflow:hidden}' +
    '.pfd-bar i{display:block;height:100%;background:#5BA888;transition:width .3s ease}' +
    '.pfd-ring{outline:3px solid #5BA888;outline-offset:3px;border-radius:10px;transition:outline-color .2s}';

  function injectCSS() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Guide panel
  //
  // Each step has one line that makes its point. `go` performs the step, so
  // the whole demo can be driven with the → key; and if the screen is clicked
  // by hand instead, the observer below notices the screen it produced and
  // moves the panel along.
  // ─────────────────────────────────────────────────────────────────────────
  // What has reached the club, in dollars and cents, or null with &payout=none.
  function payout() {
    var p = payoutOf(athletes);
    return p.verified ? p.club_net_cents / 100 : null;
  }

  // The club as the app itself loads it: through the app's own request, as a
  // signed-in club. That is what puts a time on every payout figure in it.
  // The page will not show a figure it cannot date, so the fixture is never
  // put straight into the app's state.
  function loadClub() {
    try { sessionStorage.setItem('pf_club_session', JSON.stringify(session())); } catch (e) {}
    return window.fetchClub(club.code, session().access_token).then(function (loaded) {
      window.state.club = loaded;
      return loaded;
    });
  }
  // One of that club's teams, as the app is holding it.
  function appTeam(id) {
    var held = window.state.club && window.state.club.teams;
    return (held || []).filter(function (t) { return t.id === id; })[0] || null;
  }
  // Opens a team's roster, loading the club first if the app does not have it.
  function openTeam(id, then) {
    var ready = appTeam(id) ? Promise.resolve() : loadClub();
    return ready.then(function () {
      window.state.team = appTeam(id);
      if (!window.state.team) return;
      window.openRoster();
      if (typeof then === 'function') then();
    });
  }
  function waitFor(test, then, tries) {
    var left = tries == null ? 40 : tries;
    if (test()) { then(); return; }
    if (left > 0) setTimeout(function () { waitFor(test, then, left - 1); }, 120);
  }

  // Opens the screen a family reaches from their emailed link.
  //
  // The club has to be in the app's own clubCache first: getAthleteClubTeam
  // resolves an athlete's club and team through that cache and nothing else,
  // so entering the parent flow cold — a ?screen= link, or the decline step
  // before anyone has signed in as the club — throws on an undefined club.
  function parentLink(athleteId, then) {
    var a = findAthlete(athleteId);
    if (!a) return Promise.resolve();
    return window.fetchClub(club.code).then(function () {
      var list = JSON.parse(localStorage.getItem(PARENT_ATHLETES) || '[]');
      window.state.athletes = list;
      var local = list.filter(function (x) { return x.supabaseId === athleteId; })[0];
      if (!local) return;
      window.state.activeAthleteId = local.id;
      window.state.parentClub = authorizedClub();
      window.state.parentTeam = teamOf(a);
      window.openAthleteDetail(local.id);
      if (typeof then === 'function') then();
    });
  }

  // Waits for the element rather than assuming it is there. The step before
  // this one often opens a screen that is still resolving a (stubbed) network
  // call, so a presenter pressing → twice in quick succession would otherwise
  // find nothing to click and the demo would silently stall.
  function clickIn(selector, tries) {
    var left = tries == null ? 20 : tries;
    var el = document.querySelector(selector);
    if (el) { el.click(); return; }
    if (left > 0) setTimeout(function () { clickIn(selector, left - 1); }, 120);
  }

  // Every line below is on the shared screen, in a recording and in the
  // one-file build, so a club reads all of it. Nothing here is a note to the
  // presenter. `say` is the point of the step, `note` one supporting line,
  // and `doing` names what is on screen. Anything about fees, payout,
  // installments, credit or risk is the approved wording and no more.
  var steps = [
    {
      screen: 'club-select',
      say: 'Start where your treasurer starts.',
      note: 'Built for a volunteer treasurer, not a finance team.',
      doing: 'The club sign-in screen, filled in for ' + cfg.clubName + '.',
      go: function () {
        window.enterClubMode();
        setTimeout(function () {
          var e = document.getElementById('clubEmailInput');
          var p = document.getElementById('clubPasswordInput');
          if (e) e.value = cfg.adminEmail;
          if (p) p.value = 'demo-password';
        }, 60);
      }
    },
    {
      screen: 'club-overview',
      say: 'One number first: the club’s payout.',
      note: 'Under it, how many athletes are funded and the season’s dues.',
      doing: 'The club dashboard.',
      go: function () { window.submitClubLogin(); }
    },
    {
      screen: 'club-overview',
      say: 'Then who has paid and who has not.',
      note: 'Three rows: funded, still deciding, and needs another option.',
      doing: 'The three rows under the payout.',
      ring: '.status-buckets'
    },
    {
      screen: 'roster',
      say: 'Each team has a roster with every athlete’s payment status.',
      note: '',
      doing: 'The 14U Select roster.',
      go: function () { openTeam(teams[1].id); }
    },
    {
      screen: 'roster',
      say: 'One button emails a reminder to the families on this team who have not paid.',
      note: '',
      doing: 'The reminder button on the roster.',
      ring: '#rosterRemindBtn'
    },
    {
      screen: 'athlete-detail',
      say: 'Now the same season from the family’s side. This is the link they get by email.',
      note: 'Parents do not need to create an account to register and pay.',
      doing: 'Marcus Bell’s link, as his family opens it.',
      go: function () { parentLink('a-marcus-bell'); }
    },
    {
      screen: 'athlete-detail',
      say: 'The family sees what the dues cover, line by line.',
      note: 'That comes before the choice of how to pay.',
      doing: 'The “What this covers” panel.',
      ring: '#breakdownPanel'
    },
    {
      screen: 'embedded-checkout',
      say: 'Families can pay in full or in installments.',
      note: 'Commonly 4 interest-free payments, if approved. Installments are subject to approval by our payment partner.',
      doing: 'A stand-in for the payment sheet. No card is charged.',
      go: function () { window.openStripeCheckout('bnpl'); }
    },
    {
      screen: 'confirm-terms',
      say: 'The club gets its money up front.',
      note: 'Our payment partner handles the installments, so the club is not chasing payments.',
      doing: 'The family’s confirmation screen.',
      go: function () { clickIn('[data-demo-pay]'); }
    },
    {
      screen: 'club-overview',
      say: 'Back on the club’s side, a family that has paid counts as funded.',
      note: 'It leaves “Still deciding”, and the figure at the top goes up.',
      doing: 'The club dashboard again.',
      go: function () { loadClub().then(function () { window.openClubOverview(); }); }
    },
    {
      screen: 'decline',
      say: 'If a family is not approved, they still have options.',
      note: 'They can pay in full, or pay the club directly.',
      doing: 'What a family sees when it is not approved.',
      go: function () {
        parentLink('a-elena-bell', function () { window.showDeclineScreen(); });
      }
    },
    {
      screen: 'club-register-1',
      say: 'Last, what setting up asks of the club.',
      note: 'The club’s details come first. Bank details go to our payment partner, never to PlayFund.',
      doing: 'The first screen of club registration.',
      go: function () { window.showScreen('club-register-1'); }
    }
  ];

  var idx = -1;
  var guideEl = null;
  var ringEl = null;
  var minimised = false;

  function clearRing() {
    if (ringEl) ringEl.classList.remove('pfd-ring');
    ringEl = null;
  }

  function render() {
    if (!guideEl) return;
    if (minimised) {
      guideEl.classList.add('is-min');
      guideEl.innerHTML = '<div class="pfd-step" style="margin:0;">Demo guide &middot; press G</div>';
      return;
    }
    guideEl.classList.remove('is-min');
    var s = steps[Math.max(0, idx)];
    var n = Math.max(0, idx) + 1;
    guideEl.innerHTML =
      '<div class="pfd-step">Step ' + n + ' of ' + steps.length + '</div>' +
      '<div class="pfd-say"></div>' +
      '<div class="pfd-note"></div>' +
      '<div class="pfd-do"></div>' +
      '<div class="pfd-bar"><i style="width:' + Math.round(n / steps.length * 100) + '%"></i></div>' +
      '<div class="pfd-keys">→ next · ← back · R reset · G hide</div>';
    guideEl.querySelector('.pfd-say').textContent = s.say;
    var noteEl = guideEl.querySelector('.pfd-note');
    noteEl.textContent = s.note || '';
    noteEl.style.display = s.note ? '' : 'none';
    guideEl.querySelector('.pfd-do').textContent = idx < 0 ? 'Press → to begin.' : s.doing;
  }

  function goTo(i) {
    if (i < 0 || i >= steps.length) return;
    idx = i;
    clearRing();
    var s = steps[i];
    if (typeof s.go === 'function') {
      try { s.go(); } catch (e) { console.warn('[demo] step failed:', e); }
    }
    render();
    if (s.ring) {
      setTimeout(function () {
        var el = document.querySelector(s.ring);
        if (el && el.offsetParent !== null) {
          clearRing();
          ringEl = el;
          el.classList.add('pfd-ring');
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 320);
    }
  }
  function next() { goTo(idx + 1); }
  function prev() { goTo(idx - 1); }

  function reset() {
    clearRing();
    window.location.reload();
  }

  function mountGuide() {
    injectCSS();
    if (cfg.showChrome) {
      var badge = document.createElement('div');
      badge.className = 'pfd-badge';
      badge.textContent = 'Demo · no live data';
      document.body.appendChild(badge);
    }
    if (!cfg.guide || !cfg.showChrome) return;
    guideEl = document.createElement('div');
    guideEl.className = 'pfd-guide';
    document.body.appendChild(guideEl);
    render();

    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'r' || e.key === 'R') { reset(); }
      else if (e.key === 'g' || e.key === 'G') { minimised = !minimised; render(); }
      else if (/^[1-9]$/.test(e.key)) { goTo(parseInt(e.key, 10) - 1); }
    });

    // If the presenter clicks the screen themselves rather than pressing →,
    // keep the guide in step with where they actually are.
    var obs = new MutationObserver(function () {
      var active = document.querySelector('.screen.active');
      if (!active) return;
      var name = active.id.replace('screen-', '');
      if (idx + 1 < steps.length && steps[idx + 1].screen === name && steps[idx + 1].screen !== (steps[idx] || {}).screen) {
        idx = idx + 1;
        render();
      }
    });
    document.querySelectorAll('.screen').forEach(function (el) {
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    });

    if (cfg.auto) {
      var tick = setInterval(function () {
        if (idx + 1 >= steps.length) { clearInterval(tick); return; }
        next();
      }, cfg.hold);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Entry
  //
  // Runs after the app's own load handler, so it has the last word on which
  // screen the demo opens on.
  // ─────────────────────────────────────────────────────────────────────────
  // Screenshot mode. The phone card is normally at least a viewport tall, so
  // a capture of a short screen is mostly empty background and a capture of a
  // long one is cut off. Here the card is exactly as tall as its content, and
  // the page reports that height in the title — which is how demo/capture.mjs
  // learns what window size to ask Chrome for, without a headless driver.
  function shotMode() {
    var s = document.createElement('style');
    s.textContent =
      '#app{min-height:0 !important;border-radius:22px !important;opacity:1 !important}' +
      'body{padding:26px 22px !important;align-items:flex-start !important;background:#E8EEEE !important}' +
      '#splash{display:none !important}' +
      // Nothing may be mid-flight when the shutter opens.
      //
      // The app fades its header in and rises each screen from opacity 0.
      // Those are compositor-driven, and a headless Chrome running with
      // --disable-gpu does not always tick them: the transition sits at its
      // start value for the whole life of the page. An `opacity: 1
      // !important` does not rescue it either, because the running
      // transition is what getComputedStyle reports.
      //
      // The symptom was a phone with an empty header, no wordmark and no
      // back arrow, which reads as a broken export rather than a timing
      // problem. Turning transitions and animations off removes the
      // mechanism rather than fighting its result.
      '*,*::before,*::after{transition:none !important;animation:none !important}' +
      '#header{opacity:1 !important;transform:none !important}' +
      '.screen{overflow:visible !important;opacity:1 !important}' +
      '.footer-spacer{flex:0 0 18px !important}' +
      // Nothing is painted until the page says it is ready. The screenshot
      // pass runs no JavaScript of its own, so this is the only way to stop
      // it photographing a half-painted frame, which is what produced a
      // header with no wordmark and no back arrow.
      'html{visibility:hidden}html.pfd-shot-ready{visibility:visible}';
    document.head.appendChild(s);

    function report() {
      // The card, not the body: body keeps a 100vh floor, so measuring it
      // reports the window rather than the content and leaves a band of
      // empty background under every short screen.
      var app = document.getElementById('app');
      var h = app ? app.getBoundingClientRect().height : document.body.scrollHeight;
      document.title = 'shot:' + Math.ceil(h + 52);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          document.documentElement.classList.add('pfd-shot-ready');
        });
      });
    }

    // Wait for Anton and Inter before reporting a height or being
    // photographed. A webfont in its block period paints nothing at all, and
    // a capture that lands there comes out with an empty header and a height
    // measured from text that was not there. Intermittent, and it only shows
    // up on a cold profile, which is every run of demo/capture.mjs.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { setTimeout(report, 500); });
      setTimeout(report, 4000);                 // fonts blocked entirely
    } else {
      setTimeout(report, 2000);
    }
  }

  window.addEventListener('load', function () {
    document.title = 'PlayFund \u00b7 demo';
    setTimeout(function () {
      mountGuide();
      if (cfg.shot) setTimeout(shotMode, 500);

      var screen = cfg.screen;
      var role = cfg.role;

      if (screen) {
        // Some screens need their data put in place before they are shown.
        if (/^(club-overview|roster|send-links|add-team|add-athlete-admin|club-settings|invite-admin|club-stripe-onboarding)$/.test(screen)) {
          loadClub().then(function () {
            if (screen === 'club-overview') { window.openClubOverview(); return; }
            if (screen === 'roster') { openTeam(teams[1].id); return; }
            if (screen === 'add-athlete-admin') { window.state.team = appTeam(teams[1].id); window.showAddAthleteScreen(); return; }
            // The roster with the send-links confirmation over it. The dialog's
            // words are the app's own, which is the point: it is the product
            // that says families are emailed, not the deck.
            if (screen === 'send-links') {
              openTeam(teams[1].id, function () {
                setTimeout(function () {
                  // The backdrop is absolute, so on a phone, where the viewport is
                  // the whole screen, the sheet sits over what you are looking at.
                  // A screenshot window is as tall as the roster, which parks the
                  // sheet 2,000px below the fold. Pinning it to the viewport is
                  // what the club actually sees, not a liberty taken for the photo.
                  var st = document.createElement('style');
                  st.textContent = '#askBackdrop{position:fixed !important}';
                  document.head.appendChild(st);
                  window.ask({
                    title: 'Send payment links?',
                    body: "Every approved family who hasn't paid yet gets an email with a link to this team's dues.",
                    confirmLabel: 'Send links'
                  });
                }, 260);
              });
              return;
            }
            if (screen === 'club-stripe-onboarding') { window.startStripeOnboarding(); return; }
            window.showScreen(screen, true);
          });
          return;
        }
        // PlayFund staff screens, on the same made-up club. Opened the way the
        // app opens them for a signed-in member of staff, so every figure on
        // them arrives through the app's own request.
        if (/^(admin-clubs|admin-club-detail|admin-team-roster)$/.test(screen)) {
          try { sessionStorage.setItem('pf_admin_token', 'demo.admin.token'); } catch (e) {}
          window.enterAdminMode();
          if (screen !== 'admin-clubs') {
            waitFor(function () { return window.adminAllClubs && window.adminAllClubs.length; }, function () {
              var listed = window.adminAllClubs[0];
              if (screen === 'admin-club-detail') window.openAdminClubDetail(listed);
              else window.openAdminTeamRoster(listed, listed.teams[1] || listed.teams[0]);
            });
          }
          return;
        }
        if (/^(athlete-detail|confirm-now|confirm-terms|payment-history|payment-mgmt|decline|parent-home|combined-plan|scholarship-apply|embedded-checkout)$/.test(screen)) {
          parentLink('a-marcus-bell', function () {
            if (screen === 'athlete-detail') return;
            if (screen === 'parent-home') { window.renderAthleteList(); window.showScreen('parent-home', true); return; }
            if (screen === 'combined-plan') { window.openCombinedPlan(); return; }
            if (screen === 'decline') { window.showDeclineScreen(); return; }
            if (screen === 'scholarship-apply') { window.showScholarshipScreen(); return; }
            if (screen === 'payment-history') { window.openPaymentHistory(); return; }
            if (screen === 'embedded-checkout') { window.openStripeCheckout(cfg.method === 'full' ? 'full' : 'bnpl'); return; }
            if (screen === 'confirm-now' || screen === 'confirm-terms') {
              var a = findAthlete('a-marcus-bell');
              markPaid(a, screen === 'confirm-terms' ? 'bnpl' : 'full');
              window.recordAthletePayment(screen === 'confirm-terms' ? 'bnpl' : 'full', null, a.payments[0]);
              window.showScreen(screen, true);
              return;
            }
            window.showScreen(screen, true);
          });
          return;
        }
        // Any other screen is shown as it stands, if the app has one by
        // that name. An unknown name is ignored and the demo opens as usual.
        if (document.getElementById('screen-' + screen)) {
          window.showScreen(screen, true);
          return;
        }
      }

      if (cfg.hasAthlete) return;               // the app's own deep link wins

      if (role === 'parent') {
        window.enterParentMode();
        return;
      }
      if (role === 'club') {
        loadClub().then(function () { window.openClubOverview(); });
        return;
      }
      if (cfg.guide) goTo(0);
    }, 1200);                                    // after the splash has flown
  });

  // Handy at the console during a demo: PF_DEMO.club, PF_DEMO.payout()
  window.PF_DEMO = {
    cfg: cfg, club: club, teams: teams, athletes: athletes,
    stats: stats, payout: payout, markPaid: markPaid, reset: reset,
    splitPayment: splitPayment,
    next: next, prev: prev, goTo: goTo, steps: steps
  };

  // Last line on purpose. The loader in index.html lets the app start only
  // once this is set, so a failure anywhere above leaves the app unstarted.
  boot.ready = true;

  console.log('%c[demo] PlayFund demo mode is on. Requests are answered on this page or refused.', 'color:#5BA888;font-weight:700');
})();
