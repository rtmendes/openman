-- Shared Insight Profit installation only. Run after the Mahara baseline and its context function.
do $migration$
declare
  p record;
begin
  if to_regprocedure('mahara.second_spring_context()') is null then
    return;
  end if;

  if not exists (select from pg_roles where rolname = 'mahara_app') then
    create role mahara_app nologin noinherit;
  end if;
  grant mahara_app to authenticator;

  revoke usage on schema mahara, mahara_private from anon, authenticated;
  grant usage on schema mahara, mahara_private to mahara_app;
  revoke all on all tables in schema mahara from anon, authenticated;
  grant select, insert, update, delete on all tables in schema mahara to mahara_app;
  revoke all on all sequences in schema mahara from anon, authenticated;
  grant usage on all sequences in schema mahara to mahara_app;
  revoke execute on all functions in schema mahara, mahara_private from anon, authenticated;
  grant execute on all functions in schema mahara to mahara_app;
  grant execute on function mahara_private.is_server() to mahara_app;

  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'mahara' and roles = array['anon']::name[]
  loop
    execute format('alter policy %I on mahara.%I to mahara_app', p.policyname, p.tablename);
  end loop;
end
$migration$;
