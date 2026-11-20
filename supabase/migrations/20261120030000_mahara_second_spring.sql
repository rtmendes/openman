-- Shared Insight Profit installation only. Standalone installations skip this block.
do $migration$
begin
  if to_regprocedure('mahara_private.is_server()') is null then
    return;
  end if;

  create or replace function mahara.second_spring_context()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
  as $read$
    select case when mahara_private.is_server() then jsonb_build_object(
      'registry', (select jsonb_build_object(
        'name', b.brand_name, 'domain', b.domain, 'tagline', b.tagline,
        'positioning', b.positioning, 'audience', b.audience, 'voiceRules', b.voice_writing_rules)
        from entity.brands b where b.id = 'rec_e72cd97eeadd4537' and b.deleted_at is null),
      'commandCenter', (select jsonb_build_object(
        'name', b.name, 'category', b.category, 'status', b.status,
        'domain', b.domain, 'channels', b.channels)
        from public.ecc_brands b where b.id = 'second-spring'),
      'kits', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', k.name, 'guidelines', k.guidelines, 'tone', k.tone_of_voice,
        'audience', k.target_audience, 'do', k.do_rules, 'don’t', k.dont_rules)
        order by k.id), '[]'::jsonb)
        from public.brand_kits k where k.brand_slug = 'second-spring'),
      'assets', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', a.name, 'type', a.type, 'tags', a.tags) order by a.id), '[]'::jsonb)
        from public.brand_assets a where a.brand_slug = 'second-spring')
    ) end;
  $read$;

  revoke all on function mahara.second_spring_context() from public, anon, authenticated;
  grant execute on function mahara.second_spring_context() to anon;
end
$migration$;
