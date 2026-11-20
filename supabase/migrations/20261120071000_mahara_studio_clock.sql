-- Optional self-hosted Supabase clock. Schedule request_studio_tick from pg_cron with the deployment URL.
-- The HTTP request carries a single-use ticket and never receives the app's shared database secret.
do $migration$
begin
  if to_regclass('mahara.studio_runs') is null then return; end if;

  create table if not exists mahara_private.studio_tick_tickets (
    ticket uuid primary key,
    expires_at timestamptz not null
  );
  alter table mahara_private.studio_tick_tickets enable row level security;
  revoke all on mahara_private.studio_tick_tickets from public, anon, authenticated, mahara_app;

  create or replace function mahara.studio_claim_tick(p_ticket uuid)
  returns boolean language plpgsql security definer set search_path = '' as $function$
  begin
    if not mahara_private.is_server() then return false; end if;
    delete from mahara_private.studio_tick_tickets where ticket = p_ticket and expires_at > now();
    return found;
  end
  $function$;
  revoke all on function mahara.studio_claim_tick(uuid) from public, anon, authenticated;
  grant execute on function mahara.studio_claim_tick(uuid) to mahara_app;

  create or replace function mahara_private.request_studio_tick(p_url text)
  returns bigint language plpgsql security definer set search_path = '' as $function$
  declare token uuid;
  begin
    delete from mahara_private.studio_tick_tickets where expires_at <= now();
    if not exists (select 1 from mahara.studio_runs where phase in ('queued','dispatching','running','waiting') and due_at <= now()) then
      return null;
    end if;
    token := gen_random_uuid();
    insert into mahara_private.studio_tick_tickets values (token, now() + interval '2 minutes');
    return net.http_post(url := p_url, body := '{}'::jsonb,
      headers := jsonb_build_object('content-type','application/json','x-studio-ticket',token::text), timeout_milliseconds := 12000);
  end
  $function$;
  revoke all on function mahara_private.request_studio_tick(text) from public, anon, authenticated, mahara_app;
  notify pgrst, 'reload schema';
end
$migration$;
