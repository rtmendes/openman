-- The shared installation uses a private media table behind its existing app gate.
do $migration$
begin
  if to_regprocedure('mahara_private.is_server()') is null
     or not exists (select from pg_roles where rolname = 'mahara_app') then
    return;
  end if;

  create table if not exists mahara_private.studio_reference_assets (
    id text primary key,
    content bytea not null
  );
  alter table mahara_private.studio_reference_assets enable row level security;
  revoke all on mahara_private.studio_reference_assets from public, anon, authenticated, mahara_app;

  create or replace function mahara.studio_reference_video(asset_id text)
  returns text
  language sql stable security definer set search_path = ''
  as $function$
    select case when mahara_private.is_server() then (
      select encode(asset.content, 'base64')
      from mahara_private.studio_reference_assets asset
      where asset.id = asset_id
    ) end;
  $function$;

  revoke all on function mahara.studio_reference_video(text) from public, anon, authenticated;
  grant execute on function mahara.studio_reference_video(text) to mahara_app;
  notify pgrst, 'reload schema';
end
$migration$;
