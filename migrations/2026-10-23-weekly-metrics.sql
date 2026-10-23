-- Aggregation behind the weekly metrics email (runWeeklyMetrics in
-- worker/index.js, sent Mondays to admin@playfundai.com).
--
-- It lives in the database rather than the worker because the worker only has
-- the PostgREST interface, which cannot GROUP BY. The alternative was fetching
-- every row for the week and counting them in JS, which works at today's ~150
-- rows a week and stops working quietly later.
--
-- Two periods are returned, the window asked for and the window before it, so
-- the email can show direction instead of a bare number.

create or replace function weekly_metrics(p_days int default 7)
returns jsonb
language sql
stable
as $$
with bounds as (
  select now() - make_interval(days => p_days)     as this_start,
         now() - make_interval(days => p_days * 2) as prev_start,
         now()                                     as this_end
),
-- Every event in both windows, tagged with which one it belongs to, so each
-- block below filters instead of re-scanning.
scoped as (
  select e.event_name,
         e.session_id,
         e.properties,
         case when e.created_at >= b.this_start then 'now' else 'prev' end as period
  from events e, bounds b
  where e.created_at >= b.prev_start
),
site_totals as (
  select period,
         count(distinct session_id)                                   as visitors,
         count(*) filter (where event_name = 'site_page_view')         as page_views,
         count(*) filter (where event_name = 'site_click')             as clicks
  from scoped
  where event_name in ('site_page_view', 'site_click')
  group by period
),
site_pages as (
  select properties->>'path' as path,
         count(*)                   as views,
         count(distinct session_id) as visitors
  from scoped
  where period = 'now' and event_name = 'site_page_view'
  group by 1 order by views desc limit 15
),
site_clicks as (
  select properties->>'label' as label,
         properties->>'path'  as path,
         count(*)                   as clicks
  from scoped
  where period = 'now' and event_name = 'site_click'
  group by 1, 2 order by clicks desc limit 15
),
site_referrers as (
  select coalesce(nullif(properties->>'referrer', ''), 'direct or unknown') as source,
         count(distinct session_id) as visitors
  from scoped
  where period = 'now' and event_name = 'site_page_view'
  group by 1 order by visitors desc limit 10
),
-- Opens are counted two ways on purpose. A single email opened six times is
-- six email_opened rows, so the raw count says how much attention the mail
-- got and the distinct count says how many pieces of mail were opened at all.
-- Only the second can be read against sends.
email_totals as (
  select period,
         count(*) filter (where event_name = 'email_sent')       as sent,
         count(*) filter (where event_name = 'email_delivered')  as delivered,
         count(*) filter (where event_name = 'email_opened')     as opened,
         count(distinct case when event_name = 'email_opened'
                            then properties->>'resend_email_id' end) as unique_opened,
         count(*) filter (where event_name = 'email_clicked')    as clicked,
         count(*) filter (where event_name = 'email_bounced')    as bounced,
         count(*) filter (where event_name = 'email_complained') as complained
  from scoped
  where event_name like 'email\_%'
  group by period
),
email_kinds as (
  select coalesce(properties->>'kind', 'unlabelled') as kind,
         count(*) filter (where event_name = 'email_sent')    as sent,
         count(distinct case when event_name = 'email_opened'
                            then properties->>'resend_email_id' end) as unique_opened,
         count(*) filter (where event_name = 'email_clicked') as clicked,
         count(*) filter (where event_name = 'email_bounced') as bounced
  from scoped
  where period = 'now' and event_name like 'email\_%'
  group by 1 order by sent desc, unique_opened desc
),
-- Everything that is not site traffic and not mail: the product funnel. Left
-- open rather than enumerated so an event added later shows up on its own
-- instead of being silently dropped.
app_events as (
  select event_name,
         count(*) filter (where period = 'now')  as n,
         count(*) filter (where period = 'prev') as prev_n
  from scoped
  where event_name not like 'site\_%' and event_name not like 'email\_%'
  group by 1 order by n desc, event_name
)
select jsonb_build_object(
  'period', jsonb_build_object(
    'days', p_days,
    'start', (select this_start from bounds),
    'end',   (select this_end   from bounds)
  ),
  'site', jsonb_build_object(
    'now',       coalesce((select to_jsonb(s) - 'period' from site_totals s where period = 'now'),  '{}'::jsonb),
    'prev',      coalesce((select to_jsonb(s) - 'period' from site_totals s where period = 'prev'), '{}'::jsonb),
    'pages',     coalesce((select jsonb_agg(to_jsonb(p)) from site_pages p),     '[]'::jsonb),
    'clicks',    coalesce((select jsonb_agg(to_jsonb(c)) from site_clicks c),    '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(to_jsonb(r)) from site_referrers r), '[]'::jsonb)
  ),
  'email', jsonb_build_object(
    'now',     coalesce((select to_jsonb(e) - 'period' from email_totals e where period = 'now'),  '{}'::jsonb),
    'prev',    coalesce((select to_jsonb(e) - 'period' from email_totals e where period = 'prev'), '{}'::jsonb),
    'by_kind', coalesce((select jsonb_agg(to_jsonb(k)) from email_kinds k), '[]'::jsonb)
  ),
  'app', coalesce((select jsonb_agg(to_jsonb(a)) from app_events a), '[]'::jsonb)
);
$$;

-- The function is security invoker and events has RLS enabled with no
-- policies, so an anonymous caller already gets zeros rather than data. This
-- closes the door anyway: only the worker, which authenticates as
-- service_role, has any reason to call it.
revoke all on function weekly_metrics(int) from public;
grant execute on function weekly_metrics(int) to service_role;

-- The worker labels every email event with a kind from here on. Rows written
-- before that shipped have none, and would all collapse into "unlabelled" in
-- the first few digests, so they get the label once, now. This CASE is a
-- one-time data fix and not the ongoing source of truth: that is emailKind()
-- in worker/index.js, next to the code that writes the subjects.
update events
set properties = properties || jsonb_build_object('kind', case
      when properties->>'subject' ilike 'Reset your PlayFund password%' then 'Password reset'
      when properties->>'subject' ilike 'Reminder:%'                    then 'Payment reminder'
      when properties->>'subject' ilike 'Receipt:%'                     then 'Receipt'
      when properties->>'subject' ilike '%is registered with%'          then 'Registration confirmed'
      when properties->>'subject' ilike '%is confirmed%'                then 'Payment confirmed'
      when properties->>'subject' ilike '%needs your approval%'         then 'Approval needed'
      when properties->>'subject' ilike 'Welcome to PlayFund%'          then 'Club welcome'
      -- Retired wording for the same club welcome, replaced before this ran.
      when properties->>'subject' ilike '%you''re on the PlayFund list%'  then 'Club welcome'
      -- Retired entirely: there is no parent registration invite today.
      when properties->>'subject' ilike 'Register % for %'              then 'Registration invite (retired)'
      when properties->>'subject' ilike 'ACTION NEEDED%'                then 'Action needed (internal)'
      -- Anchored loosely: an earlier wording prefixed this subject with an emoji.
      when properties->>'subject' ilike '%New club:%'                   then 'New club (internal)'
      when properties->>'subject' ilike 'New enquiry:%'                 then 'Site enquiry (internal)'
      when properties->>'subject' ilike 'Parent request:%'              then 'Parent request (internal)'
      when properties->>'subject' ilike '%wants to arrange payment directly%' then 'Direct payment request (internal)'
      else 'Other'
    end)
where event_name like 'email\_%'
  and properties->>'kind' is null
  and properties->>'subject' is not null;
