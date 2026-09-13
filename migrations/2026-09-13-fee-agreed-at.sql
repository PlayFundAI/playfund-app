-- Gate transactions on PlayFund having actually set a club's rate.
--
-- Why a separate column rather than reusing fee_bps: fee_bps is
-- NOT NULL DEFAULT 500, so every club is born at 5% and there is no way to
-- tell "we negotiated 5%" from "nobody has discussed this yet". The Worker
-- blocks checkout while fee_agreed_at IS NULL, and stamps it when a PlayFund
-- admin saves the rate (PATCH /admin/clubs/:id with fee_bps).
--
-- Additive and reversible: no data is changed, existing clubs simply start
-- out ungated, which is the correct default for a pre-pilot system where no
-- rate has genuinely been agreed with anyone yet.
alter table clubs add column if not exists fee_agreed_at timestamptz;

-- Verify:
--   select code, name, fee_bps, fee_agreed_at from clubs order by created_at desc limit 5;
