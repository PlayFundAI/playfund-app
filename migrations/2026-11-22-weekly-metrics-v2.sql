-- Second version of the aggregation behind the weekly metrics email
-- (runWeeklyMetrics in worker/index.js, sent Sundays to admin@playfundai.com).
-- Replaces the function from 2026-10-23-weekly-metrics.sql. Every key the
-- first version returned is still here under the same name, so the worker
-- that was written against it keeps working; the additions are new keys.
--
-- What changed, and why:
--
-- Site
--   * Rows the worker marked _bot or _preview are left out, and counted, so
--     the email can say how many. A preview deploy is not the public site.
--   * Each visit gets one source: the referrer of its first page view in the
--     window. Before, a visit counted once under every referrer it ever sent,
--     so moving between our own pages listed our own site as a source and the
--     rows added up to more than the total.
--   * Paths are normalised, so /index.html and / are one row.
--
-- Email
--   * An open or click is labelled by joining to the send it belongs to.
--     Webhook rows have been arriving without a kind of their own, which put
--     every open under "unlabelled" next to a send it could not be read
--     against.
--   * The totals cover mail to parents and clubs. Mail we send ourselves,
--     this digest included, is in the by-kind table and nowhere else.
--   * opened_of_sent is the numerator for a real open rate: of the mail sent
--     in the window, how many pieces were opened. The old rate divided every
--     open in the window by the sends in the window, and an open can belong
--     to mail sent weeks earlier.
--
-- "visitors" keeps its name in the JSON for compatibility. It has always
-- been distinct browser-tab sessions, and the email now calls it visits.

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
         e.created_at,
         (e.properties ? '_bot' or e.properties ? '_preview') as excluded,
         case when e.created_at >= b.this_start then 'now' else 'prev' end as period
  from events e, bounds b
  where e.created_at >= b.prev_start
    -- Always true while this_end is now(). Stated so the body can be run for
    -- a past week by substituting a timestamp, which is how it was checked.
    and e.created_at < b.this_end
),
site as (
  select period,
         event_name,
         session_id,
         created_at,
         properties,
         -- /index.html and a trailing slash are the same page as the bare path.
         coalesce(nullif(regexp_replace(
           regexp_replace(coalesce(properties->>'path', ''), '/index\.html$', '/'),
           '/+$', ''), ''), '/') as path
  from scoped
  where event_name in ('site_page_view', 'site_click') and not excluded
),
site_totals as (
  select period,
         count(distinct session_id)                                   as visitors,
         count(*) filter (where event_name = 'site_page_view')         as page_views,
         count(*) filter (where event_name = 'site_click')             as clicks
  from site
  group by period
),
site_pages as (
  select path,
         count(*)                   as views,
         count(distinct session_id) as visitors
  from site
  where period = 'now' and event_name = 'site_page_view'
  group by 1 order by views desc limit 15
),
site_clicks as (
  select properties->>'label' as label,
         path,
         count(*)                   as clicks
  from site
  where period = 'now' and event_name = 'site_click'
  group by 1, 2 order by clicks desc limit 15
),
-- One row per visit: where its first page view in the window came from.
first_views as (
  select distinct on (session_id)
         session_id,
         properties->>'referrer' as referrer
  from site
  where period = 'now' and event_name = 'site_page_view' and session_id is not null
  order by session_id, created_at
),
site_referrers as (
  select case
           when referrer is null or referrer = ''             then 'direct or unknown'
           -- A first view referred by our own site is a tab that was already
           -- open when the window started, or a link opened in a new tab.
           -- Either way it says nothing about where the visit came from.
           when referrer in ('www.playfundai.com', 'playfundai.com') then 'direct or unknown'
           when referrer like '%.playfund-app.pages.dev'      then 'direct or unknown'
           else referrer
         end as source,
         count(*) as visitors
  from first_views
  group by 1 order by visitors desc limit 10
),
-- Every send we have ever recorded, as a lookup from Resend's id to the kind
-- of mail. Not limited to the window: an open this week can belong to mail
-- sent before it.
sends as (
  select distinct on (properties->>'resend_email_id')
         properties->>'resend_email_id' as id,
         properties->>'kind'            as kind,
         created_at                     as sent_at
  from events
  where event_name = 'email_sent' and properties->>'resend_email_id' is not null
  order by properties->>'resend_email_id', created_at
),
mail as (
  select s.period,
         s.event_name,
         s.properties->>'resend_email_id' as id,
         -- The send's own label first, then whatever the row carries. What is
         -- left is an open or click of mail we never recorded sending.
         coalesce(sd.kind, s.properties->>'kind', 'no send recorded') as kind,
         -- True when the mail this row is about was sent in the same window
         -- the row falls in.
         (sd.sent_at is not null
           and (case when sd.sent_at >= b.this_start then 'now'
                     when sd.sent_at >= b.prev_start then 'prev' end) = s.period) as sent_in_period
  from scoped s
  cross join bounds b
  left join sends sd on sd.id = s.properties->>'resend_email_id'
  where s.event_name like 'email\_%'
),
-- Opens are counted two ways on purpose. A single email opened six times is
-- six email_opened rows, so the raw count says how much attention the mail
-- got and the distinct count says how many pieces of mail were opened at all.
email_totals as (
  select period,
         count(*) filter (where event_name = 'email_sent')       as sent,
         count(*) filter (where event_name = 'email_delivered')  as delivered,
         count(*) filter (where event_name = 'email_opened')     as opened,
         count(distinct case when event_name = 'email_opened' then id end) as unique_opened,
         count(distinct case when event_name = 'email_opened' and sent_in_period then id end) as opened_of_sent,
         count(*) filter (where event_name = 'email_clicked')    as clicked,
         count(*) filter (where event_name = 'email_bounced')    as bounced,
         count(*) filter (where event_name = 'email_complained') as complained
  from mail
  where kind not like '%(internal)'
  group by period
),
email_kinds as (
  select kind,
         count(*) filter (where event_name = 'email_sent')    as sent,
         count(distinct case when event_name = 'email_opened' then id end) as unique_opened,
         count(*) filter (where event_name = 'email_clicked') as clicked,
         count(*) filter (where event_name = 'email_bounced') as bounced
  from mail
  where period = 'now'
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
  where event_name not like 'site\_%' and event_name not like 'email\_%' and not excluded
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
    'referrers', coalesce((select jsonb_agg(to_jsonb(r)) from site_referrers r), '[]'::jsonb),
    -- Site rows in this window that were left out of everything above.
    'excluded',  (select count(*) from scoped
                  where period = 'now' and excluded
                    and event_name in ('site_page_view', 'site_click'))
  ),
  'email', jsonb_build_object(
    'now',     coalesce((select to_jsonb(e) - 'period' from email_totals e where period = 'now'),  '{}'::jsonb),
    'prev',    coalesce((select to_jsonb(e) - 'period' from email_totals e where period = 'prev'), '{}'::jsonb),
    'by_kind', coalesce((select jsonb_agg(to_jsonb(k)) from email_kinds k), '[]'::jsonb)
  ),
  'app', coalesce((select jsonb_agg(to_jsonb(a)) from app_events a), '[]'::jsonb)
);
$$;

-- create or replace keeps the grants from the first version. Restated so this
-- file is correct on its own: only the worker, which authenticates as
-- service_role, has any reason to call it.
revoke all on function weekly_metrics(int) from public;
grant execute on function weekly_metrics(int) to service_role;
