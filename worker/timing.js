// Dates around a team's season: the registration payment deadline, and
// whether a bank payment made today is cutting it close.
//
// Every date here is a calendar date as text, "YYYY-MM-DD", the same shape
// the database stores. Nothing here reads a clock: the caller passes today.
//
// Numbers live in timing-config.js.
import {
  BANK_CUTOFF_BUSINESS_DAYS,
  DEFAULT_DEADLINE_DAYS_BEFORE_SEASON
} from "./timing-config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// "2026-09-01" to a UTC timestamp, or null for anything that is not a real
// calendar date. "2026-02-30" is refused rather than rolled into March.
function parseDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
}

export function isDate(iso) {
  return parseDate(iso) !== null;
}

function addDays(iso, days) {
  return new Date(parseDate(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

// The deadline a team gets when the club does not pick one, and the latest
// one a club may pick. Null when there is no usable season start.
export function defaultDeadline(seasonStart) {
  if (!isDate(seasonStart)) return null;
  return addDays(seasonStart, -DEFAULT_DEADLINE_DAYS_BEFORE_SEASON);
}

// Works out the deadline to store for a team, or says why it cannot.
// Returns { deadline } or { error }. A deadline left blank becomes the
// default. One later than the default is refused. Earlier is fine.
export function resolveDeadline(seasonStart, requestedDeadline) {
  if (!isDate(seasonStart)) {
    return { error: "A season start date is required. The registration payment deadline is set from it." };
  }
  const latest = defaultDeadline(seasonStart);
  if (requestedDeadline === undefined || requestedDeadline === null || requestedDeadline === "") {
    return { deadline: latest };
  }
  if (!isDate(requestedDeadline)) {
    return { error: "The registration payment deadline is not a valid date." };
  }
  if (requestedDeadline > latest) {
    return {
      error: `The registration payment deadline can be no later than ${latest}, which is ${DEFAULT_DEADLINE_DAYS_BEFORE_SEASON} days before the season starts. Pick that date or an earlier one.`,
      latest
    };
  }
  return { deadline: requestedDeadline };
}

// Whole business days from one date up to another: Monday to Friday, counting
// each day after `from` up to and including `to`. Zero or less when `to` is
// not after `from`. Bank holidays are counted as business days, so the real
// figure can be one lower in a holiday week.
export function businessDaysUntil(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start === null || end === null) return null;
  let count = 0;
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

// True when a bank payment made today is inside the window where it may not
// reach the club before the season starts. False when the team has no season
// start, because there is then nothing to be late for.
export function bankTakesLongerNote(today, seasonStart) {
  const days = businessDaysUntil(today, seasonStart);
  if (days === null) return false;
  return days < BANK_CUTOFF_BUSINESS_DAYS;
}

// Today's calendar date where the clubs are. The Worker's own clock is UTC,
// which is already tomorrow on a US evening.
export function todayInUS(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// The timing fields a page needs for one team, added to the team as stored.
export function withTiming(team, today) {
  return {
    ...team,
    payment_deadline: team.dues_due_date || null,
    latest_payment_deadline: defaultDeadline(team.season_start),
    bank_takes_longer: bankTakesLongerNote(today, team.season_start)
  };
}
