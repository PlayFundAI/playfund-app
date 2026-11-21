-- Payout figures that tie to the payment processor, or are not shown.
--
-- Until now the app worked a club's payout out again on every page load, from
-- the team's current dues and the club's current rate. A later change to
-- either changed the figure for payments already made, and nothing compared
-- the figure with what the processor actually moved.
--
-- This adds four things. No existing column or row changes.
--
-- 1. On `payments`, what the processor says about each successful payment,
--    written by the Worker from the processor's own Charge, Transfer and
--    Application fee objects. Never worked out from a rate.
--
-- 2. `payout_checks`, one row per club: the result of the last comparison of
--    that club's payment rows with the processor's records for its account.
--    The Worker shows a figure only while this row says "verified", is recent,
--    and still describes exactly the payment rows in the database.
--
-- 3. `save_payout_check`, the one way that row is written. It refuses to
--    replace a newer result with an older one. Without that, a check that was
--    already running when a refund was reported could finish afterwards and
--    put the old figure back.
--
-- 4. A rule that one payment can have only one "succeeded" row, so that the
--    same payment delivered twice at the same moment cannot be recorded twice.
--
-- Apply this BEFORE the Worker change that uses it is merged. The Worker is
-- written to cope if it is deployed first (payments are still recorded exactly
-- as before, and no payout figure is shown), but figures cannot appear until
-- this has run.
--
-- Safe to run more than once.

alter table payments add column if not exists stripe_charge_id text;
alter table payments add column if not exists stripe_transfer_id text;
alter table payments add column if not exists stripe_application_fee_id text;
alter table payments add column if not exists stripe_destination_account text;
-- The charge, the fee taken back by PlayFund, and what the club's account
-- keeps. club_net_cents is always charge_cents - application_fee_cents; it is
-- stored so that a row can be checked against itself.
alter table payments add column if not exists charge_cents integer;
alter table payments add column if not exists application_fee_cents integer;
alter table payments add column if not exists club_net_cents integer;
alter table payments add column if not exists processor_recorded_at timestamptz;

-- club_id is text with no foreign key on purpose: it holds clubs.id as text,
-- so this file does not depend on the type of that column, and a check row
-- left behind by a deleted club is harmless.
create table if not exists payout_checks (
  club_id                text primary key,
  status                 text not null check (status in ('verified', 'failed')),
  -- A short code and a sentence of detail when status is 'failed'. Internal:
  -- shown to PlayFund staff only, never to a club.
  reason                 text,
  detail                 text,
  checked_at             timestamptz not null,
  -- A result may only be replaced by a check that started at or after this
  -- time. For an ordinary check it is the time the check started. When the
  -- processor reports a refund, dispute or reversal it is set a little into
  -- the future, so that no check already under way can undo it.
  not_before             timestamptz not null,
  -- The processor account the check was made against. A figure is not shown
  -- if the club's account has changed since.
  stripe_account_id      text,
  payment_count          integer not null default 0,
  charge_cents           integer not null default 0,
  application_fee_cents  integer not null default 0,
  club_net_cents         integer not null default 0,
  -- A hash of exactly which payment records were checked. See
  -- payoutFingerprint in worker/payouts.mjs.
  fingerprint            text
);

-- Only the Worker reads or writes this table, with the service key. Row level
-- security with no policies keeps every other key out, and the grants below
-- say the same thing a second way.
alter table payout_checks enable row level security;
revoke all on payout_checks from anon, authenticated;
grant select, insert, update, delete on payout_checks to service_role;

-- Save one club's result. Returns true if it was saved, false if a newer
-- result was already there and this one was dropped. One statement, so two
-- checks finishing at the same moment cannot both win.
--
-- p is the whole row as JSON. p_force is for a refund, dispute or reversal
-- reported by the processor, which always replaces whatever is there.
create or replace function save_payout_check(p jsonb, p_force boolean default false)
returns boolean
language sql
as $$
  with written as (
    insert into payout_checks as c (
      club_id, status, reason, detail, checked_at, not_before, stripe_account_id,
      payment_count, charge_cents, application_fee_cents, club_net_cents, fingerprint
    )
    values (
      p->>'club_id',
      p->>'status',
      p->>'reason',
      p->>'detail',
      (p->>'checked_at')::timestamptz,
      (p->>'not_before')::timestamptz,
      p->>'stripe_account_id',
      coalesce((p->>'payment_count')::integer, 0),
      coalesce((p->>'charge_cents')::integer, 0),
      coalesce((p->>'application_fee_cents')::integer, 0),
      coalesce((p->>'club_net_cents')::integer, 0),
      p->>'fingerprint'
    )
    on conflict (club_id) do update set
      status = excluded.status,
      reason = excluded.reason,
      detail = excluded.detail,
      checked_at = excluded.checked_at,
      not_before = excluded.not_before,
      stripe_account_id = excluded.stripe_account_id,
      payment_count = excluded.payment_count,
      charge_cents = excluded.charge_cents,
      application_fee_cents = excluded.application_fee_cents,
      club_net_cents = excluded.club_net_cents,
      fingerprint = excluded.fingerprint
    where p_force or c.not_before <= excluded.not_before
    returning 1
  )
  select exists (select 1 from written);
$$;

-- Only the Worker may call it.
revoke execute on function save_payout_check(jsonb, boolean) from public, anon, authenticated;
grant execute on function save_payout_check(jsonb, boolean) to service_role;

-- One payment, one "succeeded" row. If the table already holds the same
-- payment twice this rule cannot be added, and that is reported as a notice
-- instead of stopping the rest of this file. (The payout check reports such a
-- club to staff either way, and shows it no figure.)
do $$
begin
  create unique index if not exists payments_one_succeeded_row_per_intent
    on payments (stripe_payment_intent)
    where status = 'succeeded';
exception
  when unique_violation then
    raise notice 'payments already has one payment recorded as succeeded on more than one row. The one-row-per-payment rule was not added.';
end
$$;

-- The API in front of the database keeps a list of tables and columns. Ask it
-- to read the list again so the new ones are usable straight away.
notify pgrst, 'reload schema';

-- Verify:
--   select column_name from information_schema.columns
--     where table_name = 'payments' and column_name like '%cents' order by 1;
--   select count(*) from payout_checks;
--   select save_payout_check('{"club_id":"migration-test","status":"failed","reason":"test","checked_at":"2026-01-01T00:00:00Z","not_before":"2026-01-01T00:00:00Z"}'::jsonb);
--     should return true. Then remove the test row:
--   delete from payout_checks where club_id = 'migration-test';
