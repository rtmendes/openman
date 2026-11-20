-- Durable Content Studio runs on the shared Mahara installation.
do $migration$
begin
  if to_regprocedure('mahara_private.is_server()') is null
     or not exists (select from pg_roles where rolname = 'mahara_app') then
    return;
  end if;

  create table if not exists mahara.studio_runs (
    user_id text not null,
    id uuid not null,
    video_id uuid not null,
    kind text not null check (kind in ('workflow','script','suggestion')),
    phase text not null check (phase in ('queued','dispatching','running','waiting','review','blocked','complete','stopped')),
    version integer not null default 1,
    input jsonb not null,
    state jsonb not null,
    due_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
  );
  create index if not exists studio_runs_projects on mahara.studio_runs (user_id, video_id, created_at desc);
  create index if not exists studio_runs_due on mahara.studio_runs (due_at)
    where phase in ('queued','dispatching','running','waiting');
  create unique index if not exists studio_runs_active
    on mahara.studio_runs (user_id, video_id, kind)
    where phase in ('queued','dispatching','running','waiting','review','blocked');

  alter table mahara.studio_runs enable row level security;
  revoke all on mahara.studio_runs from public, anon, authenticated;
  grant select, insert, update, delete on mahara.studio_runs to mahara_app;
  if not exists (select from pg_policies where schemaname = 'mahara' and tablename = 'studio_runs' and policyname = 'server only') then
    create policy "server only" on mahara.studio_runs for all to mahara_app
      using ((select mahara_private.is_server())) with check ((select mahara_private.is_server()));
  end if;
  notify pgrst, 'reload schema';
end
$migration$;
