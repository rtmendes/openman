-- Studio uses the shared Mahara role and its existing private media bucket.
do $migration$
declare
  old_check text;
begin
  if to_regclass('mahara.studio_draft_versions') is null
     or not exists (select from pg_roles where rolname = 'mahara_app') then
    return;
  end if;

  create table if not exists mahara.studio_workspaces (
    user_id text primary key,
    revision integer not null check (revision > 0),
    organization jsonb not null check (jsonb_typeof(organization) = 'object')
  );
  alter table mahara.studio_workspaces enable row level security;
  revoke all on mahara.studio_workspaces from public, anon, authenticated;
  grant select, insert, update, delete on mahara.studio_workspaces to mahara_app;
  drop policy if exists "server only" on mahara.studio_workspaces;
  create policy "server only" on mahara.studio_workspaces for all to mahara_app
    using ((select mahara_private.is_server())) with check ((select mahara_private.is_server()));

  create table if not exists mahara.studio_brand_assets (
    user_id text not null,
    brand_id text not null,
    media_id text not null,
    folder_id uuid,
    name text not null,
    type text not null,
    size bigint not null check (size > 0),
    created_at timestamptz not null default now(),
    primary key (user_id, brand_id, media_id)
  );
  create index if not exists studio_brand_assets_folder_idx
    on mahara.studio_brand_assets (user_id, brand_id, folder_id, created_at desc, media_id);
  alter table mahara.studio_brand_assets enable row level security;
  revoke all on mahara.studio_brand_assets from public, anon, authenticated;
  grant select, insert, update, delete on mahara.studio_brand_assets to mahara_app;
  drop policy if exists "server only" on mahara.studio_brand_assets;
  create policy "server only" on mahara.studio_brand_assets for all to mahara_app
    using ((select mahara_private.is_server())) with check ((select mahara_private.is_server()));

  for old_check in select conname from pg_constraint
    where conrelid = 'mahara.studio_draft_versions'::regclass and contype = 'c'
      and conname <> 'studio_draft_versions_projects_check'
      and pg_get_constraintdef(oid) like '%jsonb_array_length(items)%'
  loop
    execute format('alter table mahara.studio_draft_versions drop constraint %I', old_check);
  end loop;
  if not exists (select from pg_constraint where conrelid = 'mahara.studio_draft_versions'::regclass
                 and conname = 'studio_draft_versions_projects_check') then
    alter table mahara.studio_draft_versions add constraint studio_draft_versions_projects_check
      check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100);
  end if;
  notify pgrst, 'reload schema';
end
$migration$;
