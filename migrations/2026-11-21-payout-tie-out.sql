-- Payout figures that tie to the payment processor, or are not shown.
--
-- Until now the app worked a club's payout out again on every page load, from
-- the team's current dues and the club's current rate. A later change to
-- either changed the figure for payments already made, and nothing compared
-- the figure with what the processor actually moved.
--
-- This adds two things. Both are additive: no existing column or row changes.
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

-- The API in front of the database keeps a list of tables and columns. Ask it
-- to read the list again so the new ones are usable straight away.
notify pgrst, 'reload schema';

-- Verify:
--   select column_name from information_schema.columns
--     where table_name = 'payments' and column_name like '%cents' order by 1;
--   select count(*) from payout_checks;
