var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");
function err(message, status = 400) {
  return json({ error: message }, status);
}
__name(err, "err");
async function supabase(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "apikey": env.SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "return=minimal"
    },
    body: body ? JSON.stringify(body) : void 0
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
}
__name(supabase, "supabase");
function toStripeFormParams(obj, prefix) {
  const params = [];
  for (const [key, value] of Object.entries(obj)) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      params.push(...toStripeFormParams(value, paramKey));
    } else {
      params.push([paramKey, String(value)]);
    }
  }
  return params;
}
__name(toStripeFormParams, "toStripeFormParams");
async function stripe(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params ? new URLSearchParams(toStripeFormParams(params)).toString() : void 0
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
__name(stripe, "stripe");
async function supabaseSignIn(env, email, password) {
  const res = await fetch(
    `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    }
  );
  return { ok: res.ok, data: await res.json() };
}
__name(supabaseSignIn, "supabaseSignIn");
async function verifyStripeSignature(body, sigHeader, secret) {
  const encoder = new TextEncoder();
  const parts = sigHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t=")).slice(2);
  const signature = parts.find((p) => p.startsWith("v1=")).slice(3);
  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === signature;
}
__name(verifyStripeSignature, "verifyStripeSignature");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (method === "POST" && path === "/remind") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { team_id, club_code } = body;
      if (!team_id) return err("team_id required");
      const athRes = await supabase(
        env,
        "GET",
        `/athletes?select=id,name,parent_email,payment_status&team_id=eq.${team_id}&or=(payment_status.eq.unpaid,payment_status.is.null)`
      );
      const athletes = athRes.data || [];
      if (!athletes.length) return json({ sent: 0, message: "No unpaid athletes found" });
      const teamRes = await supabase(
        env,
        "GET",
        `/teams?select=id,name,dues_cents,club_id&id=eq.${team_id}`
      );
      const team = teamRes.data?.[0];
      if (!team) return err("Team not found", 404);
      const clubRes = await supabase(
        env,
        "GET",
        `/clubs?select=id,name,code&id=eq.${team.club_id}`
      );
      const club = clubRes.data?.[0];
      if (!club) return err("Club not found", 404);
      const RESEND_API_KEY = env.RESEND_API_KEY;
      if (!RESEND_API_KEY) return err("RESEND_API_KEY not configured", 500);
      const APP_URL = env.APP_URL || "https://jacksonwatkins30.github.io/playfund-app";
      const dues = (team.dues_cents || 0) / 100;
      let sent = 0;
      const skipped = [];
      for (const athlete of athletes) {
        if (!athlete.parent_email) {
          skipped.push(athlete.name);
          continue;
        }
        const payUrl = `${APP_URL}?code=${club.code}&athlete=${athlete.id}`;
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;margin:0;padding:0;background:#F4F7F6;}
        </style></head><body style="margin:0;padding:0;background:#F4F7F6;">
        <table cellpadding="0" cellspacing="0" width="100%" style="background:#F4F7F6;"><tr><td align="center" style="padding:32px 16px;">
        <table cellpadding="0" cellspacing="0" width="520" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr><td style="background:#004643;padding:18px 28px;">
            <span style="font-size:20px;font-weight:800;color:#fff;">Play</span><span style="font-size:20px;font-weight:800;color:#5BA888;">Fund</span>
            <span style="float:right;font-size:12px;color:rgba(255,255,255,0.6);">${club.name}</span>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#5BA888;">Action needed</p>
            <h2 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#004643;">${athlete.name}'s registration is still open.</h2>
            <p style="margin:0 0 20px;font-size:15px;color:#6B7280;line-height:1.6;">
              ${club.name} is waiting for ${athlete.name}'s registration to be completed.
              The season is coming up — take a moment to register and choose how you'd like to pay.
            </p>
            <table cellpadding="0" cellspacing="0" width="100%" style="background:#F4F7F6;border-radius:10px;margin-bottom:20px;">
              <tr><td style="padding:16px;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="font-size:13px;color:#6B7280;">Season dues</td>
                    <td align="right" style="font-size:16px;font-weight:800;color:#004643;">$${dues.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="font-size:13px;color:#6B7280;padding-top:6px;">Team</td>
                    <td align="right" style="font-size:13px;font-weight:700;color:#004643;padding-top:6px;">${team.name}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td width="48%" style="padding:14px;background:#004643;border-radius:10px;text-align:center;">
                <p style="margin:0 0 4px;font-size:11px;color:#5BA888;font-weight:700;text-transform:uppercase;">Pay in full</p>
                <p style="margin:0 0 10px;font-size:20px;font-weight:800;color:#fff;">$${dues.toLocaleString()}</p>
                <a href="${payUrl}&method=full" style="display:inline-block;background:#5BA888;color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;">Pay now</a>
              </td>
              <td width="4%"></td>
              <td width="48%" style="padding:14px;background:#F4F7F6;border-radius:10px;text-align:center;">
                <p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;font-weight:700;text-transform:uppercase;">Installments</p>
                <p style="margin:0 0 10px;font-size:20px;font-weight:800;color:#004643;">$${Math.round(dues / 4)}<span style="font-size:13px;font-weight:500;color:#9CA3AF;">/mo</span></p>
                <a href="${payUrl}&method=bnpl" style="display:inline-block;background:#004643;color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;">Set up plan</a>
              </td>
            </tr></table>
            <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;">
              Questions? Reply to this email or contact ${club.name} directly.
            </p>
          </td></tr>
        </table>
        </td></tr></table>
        </body></html>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${club.name} via PlayFund <hello@getplayfund.com>`,
            to: [athlete.parent_email],
            subject: `Reminder: ${athlete.name}'s registration for ${club.name}`,
            html
          })
        });
        if (res.ok) sent++;
        else console.error("Resend failed for", athlete.parent_email, await res.text());
      }
      return json({ sent, skipped, total: athletes.length });
    }
    if (method === "POST" && path === "/auth/signup") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { email, password, athlete_ids } = body;
      if (!email || !password) return err("email and password required");
      if (password.length < 8) return err("Password must be at least 8 characters");
      const signupRes = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: {
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: email.toLowerCase().trim(), password })
      });
      const signupData = await signupRes.json();
      let userId = signupData?.user?.id || signupData?.id;
      let accessToken = signupData?.session?.access_token;
      if (!userId) {
        const { ok, data } = await supabaseSignIn(env, email, password);
        if (!ok) return err("Email already in use. Try signing in instead.", 409);
        userId = data.user.id;
        accessToken = data.access_token;
      }
      const existingProfile = await supabase(env, "GET", `/user_profiles?id=eq.${userId}&select=id,role`);
      if (!existingProfile.data?.length) {
        await supabase(env, "POST", "/user_profiles", {
          id: userId,
          role: "parent",
          display_name: null
        });
      }
      if (athlete_ids?.length) {
        for (const aid of athlete_ids) {
          await supabase(env, "PATCH", `/athletes?id=eq.${aid}`, {
            parent_user_id: userId
          });
        }
      }
      return json({
        success: true,
        user: { id: userId, email, role: "parent" },
        access_token: accessToken
      }, 201);
    }
    if (method === "POST" && path === "/auth/login") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { email, password } = body;
      if (!email || !password) return err("email and password required");
      const { ok, data } = await supabaseSignIn(env, email, password);
      if (!ok) return err("Invalid email or password", 401);
      const profileRes = await supabase(
        env,
        "GET",
        `/user_profiles?id=eq.${data.user.id}&select=role,club_id,team_id,display_name`
      );
      const profile = profileRes.data?.[0] || {};
      const allowedRoles = ["club_admin", "team_admin", "playfund_admin", "parent"];
      if (!allowedRoles.includes(profile.role)) {
        return err("This account does not have admin access", 403);
      }
      let clubData = null;
      let teamData = null;
      if (profile.role === "club_admin" && profile.club_id) {
        const clubRes = await supabase(
          env,
          "GET",
          `/clubs?id=eq.${profile.club_id}&select=id,name,sport,city,state,code`
        );
        clubData = clubRes.data?.[0] || null;
      }
      if (profile.role === "team_admin" && profile.team_id) {
        const teamRes = await supabase(
          env,
          "GET",
          `/teams?id=eq.${profile.team_id}&select=id,name,age_group,dues_cents,club_id`
        );
        teamData = teamRes.data?.[0] || null;
        if (teamData?.club_id) {
          const clubRes = await supabase(
            env,
            "GET",
            `/clubs?id=eq.${teamData.club_id}&select=id,name,sport,city,state,code`
          );
          clubData = clubRes.data?.[0] || null;
        }
      }
      return json({
        access_token: data.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          role: profile.role,
          club_id: profile.club_id,
          team_id: profile.team_id || null,
          display_name: profile.display_name,
          club: clubData,
          team: teamData
        }
      });
    }
    if (method === "PATCH" && path.startsWith("/admin/clubs/")) {
      const clubId = path.split("/")[3];
      if (!clubId) return err("Club ID required");
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) return err("Authorization required", 401);
      const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
      });
      if (!userRes.ok) return err("Invalid token", 401);
      const userData = await userRes.json();
      const profileRes = await supabase(env, "GET", `/user_profiles?id=eq.${userData.id}&select=role`);
      if (profileRes.data?.[0]?.role !== "playfund_admin") return err("Forbidden", 403);
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { fee_bps } = body;
      if (!Number.isInteger(fee_bps) || fee_bps < 0 || fee_bps > 10000) {
        return err("fee_bps must be an integer between 0 and 10000");
      }
      const updateRes = await supabase(env, "PATCH", `/clubs?id=eq.${clubId}`, { fee_bps });
      if (!updateRes.ok) return err("Failed to update fee", 500);
      return json({ success: true, fee_bps });
    }
    if (method === "GET" && path === "/admin/clubs") {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) return err("Authorization required", 401);
      const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
      });
      if (!userRes.ok) return err("Invalid token", 401);
      const userData = await userRes.json();
      const profileRes = await supabase(env, "GET", `/user_profiles?id=eq.${userData.id}&select=role`);
      if (profileRes.data?.[0]?.role !== "playfund_admin") return err("Forbidden", 403);
      const clubsRes = await supabase(
        env,
        "GET",
        "/clubs?select=id,name,sport,city,state,code,active,fee_bps&order=name.asc"
      );
      if (!clubsRes.ok) return err("Failed to fetch clubs", 500);
      const clubs = clubsRes.data || [];
      const enriched = await Promise.all(clubs.map(async (club) => {
        const teamsRes = await supabase(
          env,
          "GET",
          `/teams?select=id,name,age_group,dues_cents&club_id=eq.${club.id}&active=eq.true`
        );
        const teams = teamsRes.data || [];
        const teamIds = teams.map((t) => t.id);
        let athletes = [];
        if (teamIds.length) {
          const athRes = await supabase(
            env,
            "GET",
            `/athletes?select=id,payment_status,team_id&team_id=in.(${teamIds.join(",")})`
          );
          athletes = athRes.data || [];
        }
        const funded = athletes.filter(
          (a) => ["paid_full", "bnpl_active", "bnpl_complete"].includes(a.payment_status)
        ).length;
        let fronted_cents = 0;
        athletes.forEach((a) => {
          if (["paid_full", "bnpl_active", "bnpl_complete"].includes(a.payment_status)) {
            const team = teams.find((t) => t.id === a.team_id);
            if (team) fronted_cents += Math.round(team.dues_cents * 0.95);
          }
        });
        let collected_cents = 0;
        if (athletes.length) {
          const athleteIds = athletes.map((a) => a.id);
          const paymentsRes = await supabase(
            env,
            "GET",
            `/payments?select=amount_cents&athlete_id=in.(${athleteIds.join(",")})&status=eq.succeeded`
          );
          collected_cents = (paymentsRes.data || []).reduce((sum, p) => sum + (p.amount_cents || 0), 0);
        }
        const teamsWithCounts = teams.map((t) => ({
          ...t,
          athlete_count: athletes.filter((a) => a.team_id === t.id).length
        }));
        return {
          ...club,
          team_count: teams.length,
          athlete_count: athletes.length,
          funded_count: funded,
          fronted_cents,
          collected_cents,
          teams: teamsWithCounts
        };
      }));
      const totals = enriched.reduce((acc, c) => ({
        clubs: acc.clubs + 1,
        teams: acc.teams + c.team_count,
        athletes: acc.athletes + c.athlete_count,
        funded: acc.funded + c.funded_count,
        fronted_cents: acc.fronted_cents + c.fronted_cents,
        collected_cents: acc.collected_cents + c.collected_cents
      }), { clubs: 0, teams: 0, athletes: 0, funded: 0, fronted_cents: 0, collected_cents: 0 });
      return json({ clubs: enriched, totals });
    }
    if (method === "GET" && path === "/parent/athletes") {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) return err("Authorization required", 401);
      const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
      });
      if (!userRes.ok) return err("Invalid token", 401);
      const userData = await userRes.json();
      const userId = userData.id;
      const athRes = await supabase(
        env,
        "GET",
        `/athletes?select=id,name,age,payment_status,payment_method,team_id,club_id,parent_email&parent_user_id=eq.${userId}`
      );
      const athletes = athRes.data || [];
      const enriched = await Promise.all(athletes.map(async (a) => {
        let team = null, club = null;
        if (a.team_id) {
          const tr = await supabase(env, "GET", `/teams?id=eq.${a.team_id}&select=id,name,dues_cents,season_start,season_end`);
          team = tr.data?.[0] || null;
        }
        if (a.club_id) {
          const cr = await supabase(env, "GET", `/clubs?id=eq.${a.club_id}&select=id,name,code,city,state`);
          club = cr.data?.[0] || null;
        }
        return { ...a, team, club };
      }));
      return json({ athletes: enriched });
    }
    if (method === "GET" && path === "/debug") {
      const res = await supabase(env, "GET", "/clubs?select=id,name,code,active");
      return json({ supabase_url: env.SUPABASE_URL, result: res });
    }
    if (method === "POST" && path.startsWith("/club/") && path.endsWith("/stripe-onboard")) {
      const clubId = path.split("/")[2];
      if (!clubId) return err("Club ID required");
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) return err("Authorization required", 401);
      const callerRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
      });
      if (!callerRes.ok) return err("Invalid token", 401);
      const callerData = await callerRes.json();
      const callerProfileRes = await supabase(env, "GET", `/user_profiles?id=eq.${callerData.id}&select=role,club_id`);
      const callerProfile = callerProfileRes.data?.[0];
      const isAllowed = callerProfile && (callerProfile.role === "playfund_admin" || callerProfile.role === "club_admin" && callerProfile.club_id === clubId);
      if (!isAllowed) return err("Forbidden", 403);
      const clubRes = await supabase(env, "GET", `/clubs?id=eq.${clubId}&select=id,name,admin_email,stripe_account_id`);
      const club = clubRes.data?.[0];
      if (!club) return err("Club not found", 404);
      let accountId = club.stripe_account_id;
      if (!accountId) {
        const acctRes = await stripe(env, "POST", "/accounts", {
          type: "express",
          email: club.admin_email || void 0,
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } }
        });
        if (!acctRes.ok) return err("Failed to create Stripe account: " + (acctRes.data?.error?.message || "unknown error"), 500);
        accountId = acctRes.data.id;
        await supabase(env, "PATCH", `/clubs?id=eq.${clubId}`, { stripe_account_id: accountId });
      }
      const APP_URL = env.APP_URL || "https://jacksonwatkins30.github.io/playfund-app";
      const linkRes = await stripe(env, "POST", "/account_links", {
        account: accountId,
        refresh_url: `${APP_URL}?stripe_onboard=refresh&club_id=${clubId}`,
        return_url: `${APP_URL}?stripe_onboard=complete&club_id=${clubId}`,
        type: "account_onboarding"
      });
      if (!linkRes.ok) return err("Failed to create onboarding link: " + (linkRes.data?.error?.message || "unknown error"), 500);
      return json({ url: linkRes.data.url, stripe_account_id: accountId });
    }
    if (method === "GET" && path.startsWith("/club/") && path.endsWith("/stripe-status")) {
      const clubId = path.split("/")[2];
      if (!clubId) return err("Club ID required");
      const clubRes = await supabase(env, "GET", `/clubs?id=eq.${clubId}&select=stripe_account_id`);
      const club = clubRes.data?.[0];
      if (!club) return err("Club not found", 404);
      if (!club.stripe_account_id) return json({ connected: false, charges_enabled: false, details_submitted: false });
      const acctRes = await stripe(env, "GET", `/accounts/${club.stripe_account_id}`);
      if (!acctRes.ok) return err("Failed to fetch Stripe account status", 500);
      return json({
        connected: true,
        charges_enabled: !!acctRes.data.charges_enabled,
        details_submitted: !!acctRes.data.details_submitted
      });
    }
    if (method === "GET" && path.startsWith("/club/")) {
      const code = path.split("/")[2]?.toUpperCase();
      if (!code) return err("Club code required");
      const clubRes = await supabase(
        env,
        "GET",
        `/clubs?select=id,name,sport,city,state,code,active&code=eq.${code}`
      );
      if (!clubRes.ok || !clubRes.data?.length) return err("Club not found", 404);
      const club = clubRes.data[0];
      const teamsRes = await supabase(
        env,
        "GET",
        `/teams?select=id,name,age_group,dues_cents,season_start,season_end,dues_due_date&club_id=eq.${club.id}&active=eq.true&order=age_group.asc`
      );
      const teams = teamsRes.data || [];
      const teamIds = teams.map((t) => t.id);
      let athletes = [];
      if (teamIds.length) {
        const athletesRes = await supabase(
          env,
          "GET",
          `/athletes?team_id=in.(${teamIds.join(",")})&select=id,name,age,team_id,payment_status,payment_method,enrolled_at&order=name.asc`
        );
        athletes = athletesRes.data || [];
      }
      const teamsWithAthletes = teams.map((team) => ({
        ...team,
        dues: team.dues_cents / 100,
        athletes: athletes.filter((a) => a.team_id === team.id)
      }));
      const totalAthletes = athletes.length;
      const fundedAthletes = athletes.filter(
        (a) => ["paid_full", "bnpl_active", "bnpl_complete"].includes(a.payment_status)
      ).length;
      let fronted_cents = 0;
      athletes.forEach((a) => {
        if (["paid_full", "bnpl_active", "bnpl_complete"].includes(a.payment_status)) {
          const team = teams.find((t) => t.id === a.team_id);
          if (team) fronted_cents += Math.round(team.dues_cents * 0.95);
        }
      });
      let collected_cents = 0;
      if (athletes.length) {
        const athleteIds = athletes.map((a) => a.id);
        const paymentsRes = await supabase(
          env,
          "GET",
          `/payments?select=amount_cents&athlete_id=in.(${athleteIds.join(",")})&status=eq.succeeded`
        );
        collected_cents = (paymentsRes.data || []).reduce((sum, p) => sum + (p.amount_cents || 0), 0);
      }
      return json({
        club: { ...club, teams: teamsWithAthletes },
        stats: { total_athletes: totalAthletes, funded_athletes: fundedAthletes, fronted_cents, collected_cents }
      });
    }
    if (method === "POST" && path === "/invite") {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) return err("Authorization required", 401);
      const callerRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
      });
      if (!callerRes.ok) return err("Invalid token", 401);
      const callerData = await callerRes.json();
      const callerProfileRes = await supabase(env, "GET", `/user_profiles?id=eq.${callerData.id}&select=role,club_id`);
      const callerProfile = callerProfileRes.data?.[0];
      if (!callerProfile) return err("Forbidden", 403);
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { email, display_name, role, club_id, team_id } = body;
      if (!email || !role) return err("email and role required");
      if (!["club_admin", "team_admin"].includes(role)) return err("Invalid role");
      if (role === "team_admin" && !team_id) return err("team_id required for team_admin");
      if (!club_id) return err("club_id required");
      if (callerProfile.role === "club_admin") {
        if (callerProfile.club_id !== club_id) return err("Forbidden", 403);
        if (role !== "team_admin") return err("Forbidden", 403);
      } else if (callerProfile.role !== "playfund_admin") {
        return err("Forbidden", 403);
      }
      const inviteRes = await fetch(`${env.SUPABASE_URL}/auth/v1/invite`, {
        method: "POST",
        headers: {
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });
      const inviteData = await inviteRes.json();
      if (!inviteRes.ok) {
        const existRes = await supabase(
          env,
          "GET",
          `/user_profiles?select=id&id=in.(select id from auth.users where email=eq.${encodeURIComponent(email)})`
        );
        if (!existRes.data?.length) {
          return err(inviteData.message || "Failed to invite user", 400);
        }
      }
      const userId = inviteData?.id;
      if (!userId) return err("Could not retrieve user ID after invite", 500);
      const existingProfile = await supabase(
        env,
        "GET",
        `/user_profiles?id=eq.${userId}&select=id,role`
      );
      if (existingProfile.data?.length) {
        await supabase(env, "PATCH", `/user_profiles?id=eq.${userId}`, {
          role,
          club_id,
          team_id: team_id || null,
          display_name: display_name || null
        });
      } else {
        await supabase(env, "POST", "/user_profiles", {
          id: userId,
          role,
          club_id,
          team_id: team_id || null,
          display_name: display_name || null
        });
      }
      return json({ success: true, message: `Invite sent to ${email}` }, 201);
    }
    if (method === "POST" && path === "/club/register") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { name, sport, city, state, admin_email, admin_name, athlete_count, fees, teams } = body;
      if (!name || !sport || !admin_email) return err("name, sport, and admin_email required");
      const baseCode = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      let code = baseCode + "1";
      let suffix = 1;
      while (suffix <= 99) {
        const existsRes = await supabase(env, "GET", `/clubs?code=eq.${code}&select=id`);
        if (!existsRes.data?.length) break;
        suffix++;
        code = baseCode + suffix;
      }
      const feesPerAthlete = fees && fees.length ? fees.reduce((sum, f) => sum + (parseFloat(f.amount) || 0), 0) : 0;
      const insertData = {
        name: name.trim(),
        sport: sport.trim(),
        city: city || null,
        state: state || null,
        code,
        pin_hash: crypto.randomUUID(),
        active: false
      };
      if (admin_email) insertData.admin_email = admin_email.toLowerCase().trim();
      if (admin_name) insertData.admin_name = admin_name.trim();
      if (athlete_count) insertData.athlete_count = parseInt(athlete_count) || null;
      if (feesPerAthlete) insertData.fees_per_athlete = Math.round(feesPerAthlete);
      if (body.season_start) insertData.season_start = body.season_start;
      if (body.season_end) insertData.season_end = body.season_end;
      const clubRes = await supabase(env, "POST", "/clubs", insertData);
      if (!clubRes.ok) return err("Failed to create club: " + JSON.stringify(clubRes.data), 500);
      const club = clubRes.data[0];
      let createdTeams = [];
      if (teams && teams.length) {
        for (const t of teams) {
          const tRes = await supabase(env, "POST", "/teams", {
            club_id: club.id,
            name: t.name,
            age_group: t.age_group || null,
            dues_cents: Math.round((t.dues || 0) * 100),
            active: true
          });
          if (tRes.ok && tRes.data[0]) createdTeams.push(tRes.data[0]);
        }
      }
      let inviteUrl = null;
      if (admin_email) {
        try {
          const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
            method: "POST",
            headers: {
              "apikey": env.SUPABASE_SERVICE_KEY,
              "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              type: "invite",
              email: admin_email.toLowerCase().trim(),
              options: {
                redirect_to: env.APP_URL || "https://jacksonwatkins30.github.io/playfund-app"
              }
            })
          });
          const linkData = await linkRes.json();
          inviteUrl = linkData?.action_link || null;
          if (linkData?.id) {
            await supabase(env, "POST", "/user_profiles", {
              id: linkData.id,
              role: "club_admin",
              club_id: club.id,
              display_name: admin_name || null
            });
          }
        } catch (e) {
          console.error("Generate invite link error:", e);
        }
      }
      return json({
        club: { ...club, teams: createdTeams },
        invite_url: inviteUrl,
        message: "Registration received. A PlayFund team member will reach out to complete setup."
      }, 201);
    }
    if (method === "POST" && path === "/team") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { club_id, club_code, name, age_group, dues_cents, fees, season_start, season_end, dues_due_date } = body;
      if (!name || !dues_cents) return err("name and dues_cents are required");
      let resolvedClubId = club_id;
      if (!resolvedClubId && club_code) {
        const clubRes = await supabase(env, "GET", `/clubs?select=id&code=eq.${club_code.toUpperCase()}`);
        if (!clubRes.data?.length) return err("Club not found", 404);
        resolvedClubId = clubRes.data[0].id;
      }
      if (!resolvedClubId) return err("club_id or club_code required");
      const insertData = {
        club_id: resolvedClubId,
        name: name.trim(),
        age_group: age_group || null,
        dues_cents: Math.round(dues_cents),
        season_start: season_start || null,
        season_end: season_end || null,
        dues_due_date: dues_due_date || null,
        active: true
      };
      if (fees && fees.length) insertData.fees = JSON.stringify(fees);
      const insertRes = await supabase(env, "POST", "/teams", insertData);
      if (!insertRes.ok) return err("Failed to create team", 500);
      return json({ team: insertRes.data[0] }, 201);
    }
    if (method === "POST" && path === "/athlete") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { club_code, team_id, athlete_name, athlete_age, parent_email, parent_phone } = body;
      if (!club_code || !team_id || !athlete_name || !parent_email) {
        return err("club_code, team_id, athlete_name, and parent_email are required");
      }
      const clubRes = await supabase(
        env,
        "GET",
        `/clubs?code=eq.${club_code.toUpperCase()}&select=id`
      );
      if (!clubRes.data?.length) return err("Invalid club code", 404);
      const clubId = clubRes.data[0].id;
      const teamRes = await supabase(
        env,
        "GET",
        `/teams?id=eq.${team_id}&club_id=eq.${clubId}&select=id,dues_cents`
      );
      if (!teamRes.data?.length) return err("Team not found for this club", 404);
      const insertRes = await supabase(env, "POST", "/athletes", {
        club_id: clubId,
        team_id,
        name: athlete_name.trim(),
        age: athlete_age || null,
        parent_email: parent_email.toLowerCase().trim(),
        parent_phone: parent_phone || null,
        payment_status: "unpaid",
        enrolled_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!insertRes.ok) return err("Failed to register athlete", 500);
      return json({ athlete: insertRes.data[0] }, 201);
    }
    if (method === "GET" && path.startsWith("/athlete/")) {
      const athleteId = path.split("/")[2];
      if (!athleteId) return err("Athlete ID required");
      const athleteRes = await supabase(
        env,
        "GET",
        `/athletes?id=eq.${athleteId}&select=id,name,age,payment_status,payment_method,enrolled_at,team_id,club_id`
      );
      if (!athleteRes.data?.length) return err("Athlete not found", 404);
      const athlete = athleteRes.data[0];
      const paymentsRes = await supabase(
        env,
        "GET",
        `/payments?athlete_id=eq.${athleteId}&select=id,created_at,amount_cents,status,payment_method,installment_number&order=created_at.asc`
      );
      const payments = (paymentsRes.data || []).map((p) => ({
        ...p,
        amount: p.amount_cents / 100
      }));
      const teamRes = await supabase(
        env,
        "GET",
        `/teams?id=eq.${athlete.team_id}&select=name,dues_cents`
      );
      const team = teamRes.data?.[0] || {};
      return json({
        athlete: {
          ...athlete,
          team_name: team.name,
          dues: (team.dues_cents || 0) / 100
        },
        payments
      });
    }
    if (method === "POST" && path === "/webhook/stripe") {
      const rawBody = await request.text();
      const sig = request.headers.get("stripe-signature");
      const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
      if (!valid) return err("Invalid Stripe signature", 401);
      const event = JSON.parse(rawBody);
      const eventId = event.id;
      const eventType = event.type;
      const metadata = event.data?.object?.metadata || {};
      const athleteId = metadata.athlete_id;
      if (!athleteId) {
        console.log("Stripe event missing athlete_id metadata:", eventId);
        return json({ received: true });
      }
      if (eventType === "payment_intent.succeeded") {
        const pi = event.data.object;
        const amountCents = pi.amount_received;
        const paymentMethod = pi.payment_method_types?.[0] || "card";
        const existing = await supabase(
          env,
          "GET",
          `/payments?stripe_event_id=eq.${eventId}&select=id`
        );
        if (existing.data?.length) {
          return json({ received: true, duplicate: true });
        }
        await supabase(env, "POST", "/payments", {
          athlete_id: athleteId,
          stripe_payment_intent: pi.id,
          stripe_event_id: eventId,
          amount_cents: amountCents,
          status: "succeeded",
          payment_method: paymentMethod,
          notes: `Stripe event ${eventId}`
        });
        const athleteRes = await supabase(
          env,
          "GET",
          `/athletes?id=eq.${athleteId}&select=team_id,payment_status`
        );
        const athlete = athleteRes.data?.[0];
        if (!athlete) return json({ received: true });
        const teamRes = await supabase(
          env,
          "GET",
          `/teams?id=eq.${athlete.team_id}&select=dues_cents`
        );
        const duesCents = teamRes.data?.[0]?.dues_cents || 0;
        const totalPaidRes = await supabase(
          env,
          "GET",
          `/payments?athlete_id=eq.${athleteId}&status=eq.succeeded&select=amount_cents`
        );
        const totalPaid = (totalPaidRes.data || []).reduce((sum, p) => sum + p.amount_cents, 0);
        let newStatus = "bnpl_active";
        if (paymentMethod === "klarna") {
          newStatus = totalPaid >= duesCents ? "bnpl_complete" : "bnpl_active";
        } else {
          newStatus = totalPaid >= duesCents ? "paid_full" : "bnpl_active";
        }
        await supabase(
          env,
          "PATCH",
          `/athletes?id=eq.${athleteId}`,
          { payment_status: newStatus, payment_method: paymentMethod }
        );
      } else if (eventType === "payment_intent.payment_failed") {
        const pi = event.data.object;
        await supabase(env, "POST", "/payments", {
          athlete_id: athleteId,
          stripe_payment_intent: pi.id,
          stripe_event_id: eventId,
          amount_cents: pi.amount || 0,
          status: "failed",
          payment_method: pi.payment_method_types?.[0] || "card",
          notes: pi.last_payment_error?.message || "Payment failed"
        });
      }
      return json({ received: true });
    }
    return err("Not found", 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
