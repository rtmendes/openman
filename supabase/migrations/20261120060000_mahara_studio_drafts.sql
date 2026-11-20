-- Mahara on the shared Insight Profit database.
do $migration$
begin
  if to_regprocedure('mahara_private.is_server()') is null
     or not exists (select from pg_roles where rolname = 'mahara_app') then
    return;
  end if;

  create table if not exists mahara.studio_draft_versions (
    user_id text not null,
    revision integer not null check (revision > 0),
    items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 12),
    created_at timestamptz not null default now(),
    primary key (user_id, revision)
  );
  alter table mahara.studio_draft_versions enable row level security;
  revoke all on mahara.studio_draft_versions from public, anon, authenticated;
  grant select, insert, delete on mahara.studio_draft_versions to mahara_app;
  create policy "server only" on mahara.studio_draft_versions for all to mahara_app
    using ((select mahara_private.is_server())) with check ((select mahara_private.is_server()));

  create function mahara.studio_save_drafts(p_user text, p_revision integer, p_items jsonb)
  returns jsonb language plpgsql set search_path = '' as $save$
  declare latest mahara.studio_draft_versions%rowtype;
  begin
    if not mahara_private.is_server() then
      raise insufficient_privilege;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mahara-studio:' || p_user, 0));
    select * into latest from mahara.studio_draft_versions where user_id = p_user order by revision desc limit 1;
    if latest.items = p_items then
      return jsonb_build_object('revision', latest.revision, 'savedAt', latest.created_at);
    end if;
    if coalesce(latest.revision, 0) <> p_revision then
      return jsonb_build_object('conflict', true, 'revision', latest.revision);
    end if;
    insert into mahara.studio_draft_versions(user_id, revision, items)
      values (p_user, p_revision + 1, p_items) returning * into latest;
    return jsonb_build_object('revision', latest.revision, 'savedAt', latest.created_at);
  end;
  $save$;
  revoke all on function mahara.studio_save_drafts(text,integer,jsonb) from public, anon, authenticated;
  grant execute on function mahara.studio_save_drafts(text,integer,jsonb) to mahara_app;

  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('mahara-studio-private', 'mahara-studio-private', false, 52428800,
    array['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/wav','audio/mp4','audio/ogg',
          'image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain',
          'text/markdown','text/csv','text/vtt','application/json','application/x-subrip'])
  on conflict (id) do nothing;
  grant usage on schema storage to mahara_app;
  grant select on storage.buckets to mahara_app;
  grant select, insert, delete on storage.objects to mahara_app;
  create policy "mahara studio storage only" on storage.objects as restrictive for all to mahara_app
    using (bucket_id = 'mahara-studio-private') with check (bucket_id = 'mahara-studio-private');
  create policy "mahara studio storage access" on storage.objects for all to mahara_app
    using (bucket_id = 'mahara-studio-private') with check (bucket_id = 'mahara-studio-private');
  create policy "mahara studio bucket lookup" on storage.buckets for select to mahara_app
    using (id = 'mahara-studio-private');
  -- Existing shared policies cannot accidentally expose this private bucket to general API roles.
  create policy "mahara studio deny shared api" on storage.objects as restrictive for all to anon, authenticated
    using (bucket_id <> 'mahara-studio-private') with check (bucket_id <> 'mahara-studio-private');
  notify pgrst, 'reload schema';
end
$migration$;
