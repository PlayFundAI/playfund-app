/* ═══════════════════════════════════════════════════════════════════════════
   PlayFund — demo mode

   The real app, driven by a fixture instead of the Worker. Loaded only when
   the URL carries ?demo=1 (see the injector in index.html's <head>), so
   production never ships this layer.

   Why this exists
   ───────────────
   The Worker runs on LIVE Stripe keys (pk_live_… in worker/wrangler.toml).
   Demonstrating the deployed app against production would write real athlete
   rows, send real email to a club admin and a parent, and — on the one button
   the whole demo is about — charge a real card. Demo mode removes all three:
   every call to the Worker and to Supabase is answered locally, and Stripe's
   two SDKs are replaced by stand-ins.

   What it is NOT
   ──────────────
   A second copy of the product. Every screen, style, label and code path is
   the app's own. This file supplies data and swallows the network; it never
   draws a product screen. If a screen looks wrong in demo mode, it looks
   wrong in production too.

   URL
   ───
     ?demo=1                       the demo, club side first
     &club=Northside+Select        the club's real name, for their meeting
     &city=Charlotte,+NC
     &dues=1200                    season dues per athlete
     &athletes=64                  roster size (funded/deciding/declined scale)
     &fee=800                      PlayFund's rate in basis points (8%)
     &clubcode=NSS26               the club code families would type
     &guide=1                      presenter overlay, → to advance
     &auto=1                       advances itself, for screen recording
     &screen=club-overview         jump straight to one screen
     &chrome=0                     hide the demo badge and overlay (screenshots)
     &pending=1                    add an athlete awaiting club approval
     &athlete=a-marcus-bell        the parent's emailed link, as a family gets it

   Keys with &guide=1: → or space next · ← back · r reset · g hide · 1-9 jump
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var qs = new URLSearchParams(window.location.search);
  if (!qs.get('demo')) return;

  var WORKER = 'https://playfund-worker.playfund.workers.dev';
  var SUPA   = 'https://klnbdvwasnnqszlhawbl.supabase.co';

  // ─────────────────────────────────────────────────────────────────────────
  // Config
  // ─────────────────────────────────────────────────────────────────────────
  function num(v, dflt) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
    return isFinite(n) && n > 0 ? n : dflt;
  }
  function flag(name, dflt) {
    var v = qs.get(name);
    if (v == null) return dflt;
    return v !== '0' && v !== 'false' && v !== 'no';
  }

  // Defaults are the explainer film's numbers (video/src/script.ts), so the
  // film, the deck and this demo never disagree in front of a club.
  var cfg = {
    clubName: qs.get('club') || 'Riverside Soccer Club',
    city:     qs.get('city')  || 'Richmond, VA',
    sport:    qs.get('sport') || 'Soccer',
    code:    (qs.get('clubcode') || 'RIVER26').toUpperCase(),
    dues:     Math.round(num(qs.get('dues'), 1000)),
    feeBps:   Math.round(num(qs.get('fee'), 800)),
    adminName:  qs.get('admin') || 'Dana Whitfield',
    adminEmail: qs.get('email') || 'treasurer@riversidesc.org',
    showChrome: flag('chrome', true),
    guide:      flag('guide', false),
    auto:       flag('auto', false),
    pending:    flag('pending', false)
  };

  // Roster mix. Scales with &athletes= but keeps at least one of each bucket,
  // because a club has to see that a decline is visible from day one.
  var total = Math.round(num(qs.get('athletes'), 58));
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
      a.payments = [{
        id: 'pay-' + a.id,
        created_at: '2026-11-04T18:20:00.000Z',
        amount_cents: duesCents,
        status: 'succeeded',
        payment_method: a.payment_method,
        installment_number: null,
        stripe_payment_intent: refFor(a.id)
      }];
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
  function authorizedClub() {
    var c = Object.assign({}, club);
    c.teams = teams.map(function (t) {
      return Object.assign({}, t, { dues: t.dues_cents / 100 });
    });
    return c;
  }
  function stats() {
    var fundedN = 0, frontedCents = 0, collectedCents = 0;
    athletes.forEach(function (a) {
      if (['paid_full', 'bnpl_active', 'bnpl_complete'].indexOf(a.payment_status) !== -1) {
        fundedN++;
        frontedCents += Math.round(duesCents * (1 - cfg.feeBps / 10000));
        collectedCents += duesCents;
      }
    });
    return {
      total_athletes: athletes.length,
      funded_athletes: fundedN,
      fronted_cents: frontedCents,
      collected_cents: collectedCents
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
  var realFetch = window.fetch ? window.fetch.bind(window) : null;

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

  var state = { declineNext: false, linksSent: 0, remindersSent: 0 };

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
      return after(600, { team: t }, 201);
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
      if (state.declineNext && body.payment_type === 'bnpl') {
        state.declineNext = false;
        return after(900, {
          error: "Installments aren't available for this amount. You can still pay in full, or ask your club about their own payment plan.",
          reason: 'bnpl_unavailable'
        }, 409);
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
        payments: (ga.payments || []).map(function (pp) {
          return Object.assign({}, pp, { amount: pp.amount_cents / 100 });
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
      return after(400, { clubs: [Object.assign({}, club, { stats: stats() })] });
    }

    // Supabase is only reached for auth lookups; nothing in the demo needs one.
    if (path.indexOf('/auth/v1/') === 0) return after(150, { id: 'u-demo-club-admin', email: cfg.adminEmail });

    console.warn('[demo] unrouted call, answered locally and NOT sent:', method, path);
    return after(150, { error: 'Not available in demo mode.' }, 501);
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (url.indexOf(WORKER) !== 0 && url.indexOf(SUPA) !== 0) {
      return realFetch ? realFetch(input, init) : Promise.reject(new Error('no fetch'));
    }
    var u;
    try { u = new URL(url); } catch (e) { return Promise.resolve(reply({ error: 'bad url' }, 400)); }
    var base = url.indexOf(WORKER) === 0 ? WORKER : SUPA;
    var path = u.pathname.slice(new URL(base).pathname.replace(/\/$/, '').length) || u.pathname;
    return route(method, path, u, init);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Stripe stand-ins
  //
  // defineProperty rather than assignment: js.stripe.com and connect.js are
  // still <script> tags in <head>, and whichever of us runs last would
  // otherwise win. These getters win either way, and the demo works with both
  // SDKs blocked — which is what makes it safe to present without wifi.
  // ─────────────────────────────────────────────────────────────────────────
  var pendingCheckout = null;

  function fakeEmbeddedCheckout(opts) {
    var mounted = null;
    return {
      mount: function (selector) {
        mounted = document.querySelector(selector);
        if (!mounted) return;
        var type = (pendingCheckout && pendingCheckout.type) || 'full';
        mounted.innerHTML = checkoutMarkup(type);
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
        if (decline) decline.addEventListener('click', function (e) {
          e.preventDefault();
          state.declineNext = true;
          if (typeof window.openStripeCheckout === 'function') window.openStripeCheckout('bnpl');
        });
      },
      destroy: function () { if (mounted) mounted.innerHTML = ''; },
      unmount: function () { if (mounted) mounted.innerHTML = ''; }
    };
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function checkoutMarkup(type) {
    var head =
      '<div style="border:1px solid var(--line); border-radius:var(--r-lg); overflow:hidden;">' +
        '<div style="background:var(--paper-dim); padding:10px 14px; font-size:11.5px; font-weight:700; letter-spacing:0.03em; color:var(--ink-soft); display:flex; justify-content:space-between; align-items:center;">' +
          '<span>STAND-IN FOR THE PAYMENT SHEET</span><span style="color:var(--fund-green);">NO CARD IS CHARGED</span>' +
        '</div>';
    var foot = '</div>';

    if (type === 'bnpl') {
      var each = cfg.dues / 4;
      return head +
        '<div style="padding:18px 16px;">' +
          '<div style="font-size:13px; color:var(--ink-soft); margin-bottom:4px;">Our payment partner would ask for name, address and date of birth here, then make an instant decision.</div>' +
          '<div style="font-size:19px; font-weight:800; color:var(--ink); margin:14px 0 4px;">4 payments of ' + money(each) + '</div>' +
          '<div style="font-size:12.5px; color:var(--ink-soft); margin-bottom:14px;">Every two weeks &middot; ' + money(cfg.dues) + ' total</div>' +
          '<div style="display:flex; gap:6px; margin-bottom:16px;">' +
            [0, 1, 2, 3].map(function (i) {
              return '<div style="flex:1; border:1px solid var(--line); border-radius:var(--r-chip); padding:9px 6px; text-align:center;">' +
                '<div style="font-size:12.5px; font-weight:700; color:var(--ink);">' + money(each) + '</div>' +
                '<div style="font-size:10.5px; color:var(--ink-faint);">' + ['Mar 1', 'Mar 15', 'Mar 29', 'Apr 12'][i] + '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<button class="btn btn-primary" data-demo-pay style="width:100%;">Agree and continue</button>' +
          '<div style="text-align:center; margin-top:12px;">' +
            '<a href="#" data-demo-decline style="font-size:12px; color:var(--ink-faint);">Show a declined family instead</a>' +
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
        '<button class="btn btn-primary" data-demo-pay style="width:100%;">Pay ' + money(cfg.dues) + '</button>' +
      '</div>' + foot;
  }

  function markPaid(a, type) {
    a.payment_status = type === 'bnpl' ? 'bnpl_active' : 'paid_full';
    a.payment_method = type === 'bnpl' ? 'klarna' : 'card';
    a.payments = [{
      id: 'pay-' + a.id,
      created_at: new Date().toISOString(),
      amount_cents: duesCents,
      status: 'succeeded',
      payment_method: a.payment_method,
      installment_number: null,
      stripe_payment_intent: refFor(a.id + '-paid')
    }];
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
    'pf_events_session_id': 1
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
  // Presenter guide
  //
  // Each step says the one line to say and the one thing to click. `go` does
  // the click for you, so the whole demo can be driven with the → key; and if
  // you click it yourself instead, the observer below notices the screen it
  // produced and moves the guide along.
  // ─────────────────────────────────────────────────────────────────────────
  function payout() {
    return Math.round(stats().fronted_cents / 100);
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

  var steps = [
    {
      screen: 'club-select',
      say: 'Start where your treasurer starts.',
      note: 'Built for a volunteer with high turnover, not a finance team. Toast’s onboarding runs four to six weeks; Square’s takes minutes.',
      doing: 'Sign in as ' + cfg.clubName + '.',
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
      say: 'One number: what is landing in your account.',
      note: money(payout()) + ' for ' + funded + ' funded athletes, before a ball is kicked. The fee conversation belongs in this meeting, not on their dashboard.',
      doing: 'Press → to sign in.',
      go: function () { window.submitClubLogin(); }
    },
    {
      screen: 'club-overview',
      say: 'And the part nobody else shows you: who has not paid.',
      note: 'Installments are approved by our partner, so some families are declined — the ones who needed flexibility most. Visible from day one, not discovered in March.',
      doing: 'Point at the three rows under the payout.',
      ring: '.status-buckets'
    },
    {
      screen: 'roster',
      say: 'Per athlete, in your language, not the system’s.',
      note: '“Awaiting payment”, not “In Progress - Checkout”. Card or installments, the club is paid the same either way.',
      doing: 'Open 14U Select.',
      go: function () {
        window.state.team = teams[1];
        window.openRoster();
      }
    },
    {
      screen: 'roster',
      say: 'Nobody has to make the awkward phone call.',
      note: 'Reminders go out automatically before every charge. This button is the manual nudge on top of that. Collections are socially awkward because the treasurer knows the families.',
      doing: 'Hover the reminder button, then move on.',
      ring: '#rosterRemindBtn'
    },
    {
      screen: 'athlete-detail',
      say: 'Now the same season from the family’s side. This is the link they get by email.',
      note: 'No account, no app. Roughly a quarter of people abandon at forced registration, and app fatigue dominated the parent survey.',
      doing: 'Open Marcus Bell’s link.',
      go: function () { parentLink('a-marcus-bell'); }
    },
    {
      screen: 'athlete-detail',
      say: 'The receipt leads. What the season actually costs, itemised.',
      note: 'Hidden and unpredictable cost was the second-biggest theme in 514 free-text answers; travel was the most-named cost at 42%.',
      doing: 'Point at “What this covers”.',
      ring: '#breakdownPanel'
    },
    {
      screen: 'embedded-checkout',
      say: 'Or spread it. The split sits at the price, not behind a payment-method menu.',
      note: 'Four payments, two weeks apart. Terms are set by our payment partner, not by PlayFund, and some plans may affect a family’s credit — we say so on this screen.',
      doing: 'Choose installments.',
      go: function () { window.openStripeCheckout('bnpl'); }
    },
    {
      screen: 'confirm-terms',
      say: 'The family is on a schedule. You were paid in full, today.',
      note: 'Our partner carries the credit risk for the pilot. PlayFund does not underwrite and does not front its own capital.',
      doing: 'Agree and continue.',
      go: function () { clickIn('[data-demo-pay]'); }
    },
    {
      screen: 'club-overview',
      say: 'And back on your side, the money has already moved.',
      note: 'Marcus just left “Still deciding” and the payout went up by ' + money(cfg.dues * (1 - cfg.feeBps / 10000)) + '. That is the whole loop.',
      doing: 'Switch back to the club view.',
      go: function () {
        window.state.club = authorizedClub();
        window.openClubOverview();
      }
    },
    {
      screen: 'decline',
      say: 'When a family is declined, it is a fork, not a wall.',
      note: 'Split with another payer, a smaller deposit, or the club’s own plan. Flywire’s authorised-payer feature took payment-plan defaults from 34% to under 1%.',
      doing: 'Show the declined path.',
      go: function () {
        parentLink('a-elena-bell', function () { window.showDeclineScreen(); });
      }
    },
    {
      screen: 'club-register-1',
      say: 'Getting set up is one sitting, and you can stop halfway.',
      note: 'The payout number appears before we ask for bank details. Most volunteer treasurers will not have the EIN to hand and will need to come back.',
      doing: 'Open club registration.',
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
    guideEl.querySelector('.pfd-note').textContent = s.note;
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
      var hold = Math.round(num(qs.get('hold'), 5200));
      var tick = setInterval(function () {
        if (idx + 1 >= steps.length) { clearInterval(tick); return; }
        next();
      }, hold);
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
      '#app{min-height:0 !important;border-radius:22px !important}' +
      'body{padding:26px 22px !important;align-items:flex-start !important;background:#E8EEEE !important}' +
      '#splash{display:none !important}' +
      '.screen{overflow:visible !important}' +
      '.footer-spacer{flex:0 0 18px !important}';
    document.head.appendChild(s);
    setTimeout(function () {
      // The card, not the body: body keeps a 100vh floor, so measuring it
      // reports the window rather than the content and leaves a band of
      // empty background under every short screen.
      var app = document.getElementById('app');
      var h = app ? app.getBoundingClientRect().height : document.body.scrollHeight;
      document.title = 'shot:' + Math.ceil(h + 52);
    }, 2000);
  }

  window.addEventListener('load', function () {
    document.title = 'PlayFund — demo';
    setTimeout(function () {
      mountGuide();
      if (flag('shot', false)) setTimeout(shotMode, 500);

      var screen = qs.get('screen');
      var role = qs.get('role');

      if (screen) {
        // Some screens need their data put in place before they are shown.
        if (/^(club-overview|roster|add-team|add-athlete-admin|club-settings|invite-admin|club-stripe-onboarding)$/.test(screen)) {
          window.state.club = authorizedClub();
          try { sessionStorage.setItem('pf_club_session', JSON.stringify(session())); } catch (e) {}
          if (screen === 'club-overview') { window.openClubOverview(); return; }
          if (screen === 'roster') { window.state.team = teams[1]; window.openRoster(); return; }
          if (screen === 'club-stripe-onboarding') { window.startStripeOnboarding(); return; }
        }
        if (/^(athlete-detail|confirm-now|confirm-terms|payment-history|payment-mgmt|decline|parent-home|combined-plan|scholarship-apply|embedded-checkout)$/.test(screen)) {
          parentLink('a-marcus-bell', function () {
            if (screen === 'athlete-detail') return;
            if (screen === 'parent-home') { window.renderAthleteList(); window.showScreen('parent-home', true); return; }
            if (screen === 'combined-plan') { window.openCombinedPlan(); return; }
            if (screen === 'decline') { window.showDeclineScreen(); return; }
            if (screen === 'scholarship-apply') { window.showScholarshipScreen(); return; }
            if (screen === 'payment-history') { window.openPaymentHistory(); return; }
            if (screen === 'embedded-checkout') { window.openStripeCheckout(qs.get('method') === 'full' ? 'full' : 'bnpl'); return; }
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
        window.showScreen(screen, true);
        return;
      }

      if (qs.get('athlete')) return;            // the app's own deep link wins

      if (role === 'parent') {
        window.enterParentMode();
        return;
      }
      if (role === 'club') {
        window.state.club = authorizedClub();
        try { sessionStorage.setItem('pf_club_session', JSON.stringify(session())); } catch (e) {}
        window.openClubOverview();
        return;
      }
      if (cfg.guide) goTo(0);
    }, 1200);                                    // after the splash has flown
  });

  // Handy at the console during a demo: PF_DEMO.club, PF_DEMO.payout()
  window.PF_DEMO = {
    cfg: cfg, club: club, teams: teams, athletes: athletes,
    stats: stats, payout: payout, markPaid: markPaid, reset: reset,
    next: next, prev: prev, goTo: goTo, steps: steps
  };

  console.log('%c[demo] PlayFund demo mode is on. No request leaves this page.', 'color:#5BA888;font-weight:700');
})();
