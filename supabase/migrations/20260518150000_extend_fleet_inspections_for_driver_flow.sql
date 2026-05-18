alter table public.fleet_inspections
  add column if not exists status text not null default 'completed',
  add column if not exists assigned_driver_user_id uuid references public.users(id) on delete set null,
  add column if not exists scheduled_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table public.fleet_inspections
  drop constraint if exists fleet_inspections_status_check;

alter table public.fleet_inspections
  add constraint fleet_inspections_status_check
  check (status in ('pending', 'in_progress', 'completed', 'cancelled'));

alter table public.fleet_inspections
  alter column inspection_at drop not null,
  alter column odometer drop not null,
  alter column overall_status drop not null;

update public.fleet_inspections
set status = 'completed',
    completed_at = coalesce(completed_at, inspection_at, created_at),
    completed_by = coalesce(completed_by, created_by)
where status is distinct from 'completed'
   or completed_at is null
   or completed_by is null;

create index if not exists fleet_inspections_driver_status_idx
  on public.fleet_inspections (assigned_driver_user_id, status, scheduled_at desc nulls last, created_at desc);

create index if not exists fleet_inspections_vehicle_open_idx
  on public.fleet_inspections (vehicle_id, status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspections'
      and policyname = 'fleet_inspections_driver_select'
  ) then
    create policy fleet_inspections_driver_select
      on public.fleet_inspections
      for select
      using (assigned_driver_user_id = auth.uid());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspection_items'
      and policyname = 'fleet_inspection_items_driver_select'
  ) then
    create policy fleet_inspection_items_driver_select
      on public.fleet_inspection_items
      for select
      using (
        exists (
          select 1
          from public.fleet_inspections fi
          where fi.id = fleet_inspection_items.inspection_id
            and fi.assigned_driver_user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspection_photos'
      and policyname = 'fleet_inspection_photos_driver_select'
  ) then
    create policy fleet_inspection_photos_driver_select
      on public.fleet_inspection_photos
      for select
      using (
        exists (
          select 1
          from public.fleet_inspections fi
          where fi.id = fleet_inspection_photos.inspection_id
            and fi.assigned_driver_user_id = auth.uid()
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_select_driver'
  ) then
    create policy fleet_inspections_storage_select_driver
      on storage.objects
      for select
      using (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.fleet_inspections fi
          where fi.id::text = split_part(name, '/', 2)
            and fi.assigned_driver_user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_insert_driver'
  ) then
    create policy fleet_inspections_storage_insert_driver
      on storage.objects
      for insert
      with check (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.fleet_inspections fi
          where fi.id::text = split_part(name, '/', 2)
            and fi.assigned_driver_user_id = auth.uid()
            and fi.status in ('pending', 'in_progress')
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_delete_driver'
  ) then
    create policy fleet_inspections_storage_delete_driver
      on storage.objects
      for delete
      using (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.fleet_inspections fi
          where fi.id::text = split_part(name, '/', 2)
            and fi.assigned_driver_user_id = auth.uid()
            and fi.status in ('pending', 'in_progress')
        )
      );
  end if;
end
$$;

create or replace function public.create_fleet_inspection_assignment(
  p_vehicle_id uuid,
  p_assigned_driver_user_id uuid,
  p_scheduled_at timestamptz default null,
  p_general_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inspection_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem criar inspeções pendentes';
  end if;

  if p_vehicle_id is null then
    raise exception 'Veículo é obrigatório';
  end if;

  if p_assigned_driver_user_id is null then
    raise exception 'Motorista responsável é obrigatório';
  end if;

  if not exists (
    select 1
    from public.fleet_vehicles fv
    where fv.id = p_vehicle_id
      and fv.active = true
  ) then
    raise exception 'Veículo inválido ou inativo';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_assigned_driver_user_id
      and u.role = 'driver'
  ) then
    raise exception 'Motorista responsável inválido';
  end if;

  if exists (
    select 1
    from public.fleet_inspections fi
    where fi.vehicle_id = p_vehicle_id
      and fi.status in ('pending', 'in_progress')
  ) then
    raise exception 'Já existe uma inspeção aberta para este veículo';
  end if;

  insert into public.fleet_inspections (
    id,
    vehicle_id,
    inspection_at,
    odometer,
    overall_status,
    general_notes,
    created_by,
    status,
    assigned_driver_user_id,
    scheduled_at
  ) values (
    v_inspection_id,
    p_vehicle_id,
    null,
    null,
    null,
    nullif(btrim(coalesce(p_general_notes, '')), ''),
    auth.uid(),
    'pending',
    p_assigned_driver_user_id,
    p_scheduled_at
  );

  return v_inspection_id;
end;
$$;

grant execute on function public.create_fleet_inspection_assignment(uuid, uuid, timestamptz, text) to authenticated;

create or replace function public.start_fleet_inspection(
  p_inspection_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inspection public.fleet_inspections%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select *
    into v_inspection
  from public.fleet_inspections fi
  where fi.id = p_inspection_id;

  if not found then
    raise exception 'Inspeção não encontrada';
  end if;

  if v_inspection.assigned_driver_user_id <> auth.uid() then
    raise exception 'Esta inspeção não pertence ao motorista logado';
  end if;

  if v_inspection.status = 'completed' then
    raise exception 'Esta inspeção já foi concluída';
  end if;

  if v_inspection.status = 'cancelled' then
    raise exception 'Esta inspeção foi cancelada';
  end if;

  update public.fleet_inspections
  set status = 'in_progress',
      started_at = coalesce(started_at, timezone('utc', now()))
  where id = p_inspection_id
    and status = 'pending';
end;
$$;

grant execute on function public.start_fleet_inspection(uuid) to authenticated;

create or replace function public.submit_fleet_inspection(
  p_inspection_id uuid,
  p_odometer bigint,
  p_general_notes text,
  p_items jsonb,
  p_photos jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inspection public.fleet_inspections%rowtype;
  v_item jsonb;
  v_photo jsonb;
  v_has_critical boolean := false;
  v_has_attention boolean := false;
  v_overall_status text := 'approved';
  v_critical_description text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select *
    into v_inspection
  from public.fleet_inspections fi
  where fi.id = p_inspection_id;

  if not found then
    raise exception 'Inspeção não encontrada';
  end if;

  if v_inspection.assigned_driver_user_id <> auth.uid() then
    raise exception 'Esta inspeção não pertence ao motorista logado';
  end if;

  if v_inspection.status not in ('pending', 'in_progress') then
    raise exception 'Esta inspeção não pode mais ser enviada';
  end if;

  if p_odometer is null or p_odometer < 0 then
    raise exception 'Odômetro inválido';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Checklist da inspeção é obrigatório';
  end if;

  if jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_photos, '[]'::jsonb)) = 0 then
    raise exception 'A inspeção deve ter ao menos uma foto';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'status', '') not in ('ok', 'attention', 'critical', 'na') then
      raise exception 'Status de item de inspeção inválido';
    end if;

    if coalesce(v_item->>'status', '') in ('attention', 'critical')
       and char_length(btrim(coalesce(v_item->>'notes', ''))) = 0 then
      raise exception 'Itens com atenção ou crítico exigem observação';
    end if;

    if coalesce(v_item->>'status', '') = 'critical' then
      v_has_critical := true;
    elsif coalesce(v_item->>'status', '') = 'attention' then
      v_has_attention := true;
    end if;
  end loop;

  if v_has_critical then
    v_overall_status := 'critical';
  elsif v_has_attention then
    v_overall_status := 'attention';
  end if;

  delete from public.fleet_inspection_items
  where inspection_id = p_inspection_id;

  delete from public.fleet_inspection_photos
  where inspection_id = p_inspection_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    insert into public.fleet_inspection_items (
      inspection_id,
      item_code,
      category,
      label,
      status,
      notes,
      sort_order
    ) values (
      p_inspection_id,
      coalesce(v_item->>'item_code', ''),
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'label', ''),
      coalesce(v_item->>'status', ''),
      nullif(btrim(coalesce(v_item->>'notes', '')), ''),
      coalesce((v_item->>'sort_order')::integer, 0)
    );
  end loop;

  for v_photo in
    select value
    from jsonb_array_elements(p_photos)
  loop
    if char_length(btrim(coalesce(v_photo->>'storage_path', ''))) = 0 then
      raise exception 'Foto sem caminho de storage';
    end if;

    insert into public.fleet_inspection_photos (
      inspection_id,
      storage_path,
      file_name,
      file_size,
      caption,
      created_by
    ) values (
      p_inspection_id,
      v_photo->>'storage_path',
      nullif(btrim(coalesce(v_photo->>'file_name', '')), ''),
      nullif(v_photo->>'file_size', '')::bigint,
      nullif(btrim(coalesce(v_photo->>'caption', '')), ''),
      auth.uid()
    );
  end loop;

  update public.fleet_inspections
  set inspection_at = timezone('utc', now()),
      odometer = p_odometer,
      overall_status = v_overall_status,
      general_notes = nullif(btrim(coalesce(p_general_notes, '')), ''),
      status = 'completed',
      started_at = coalesce(started_at, timezone('utc', now())),
      completed_at = timezone('utc', now()),
      completed_by = auth.uid()
  where id = p_inspection_id;

  update public.fleet_vehicles
  set current_odometer = greatest(current_odometer, p_odometer)
  where id = v_inspection.vehicle_id;

  if v_has_critical then
    select string_agg(format('%s - %s', item->>'category', item->>'label'), '; ')
      into v_critical_description
    from jsonb_array_elements(p_items) item
    where item->>'status' = 'critical';

    insert into public.fleet_occurrences (
      vehicle_id,
      inspection_id,
      severity,
      status,
      title,
      description,
      created_by
    ) values (
      v_inspection.vehicle_id,
      p_inspection_id,
      'critical',
      'open',
      'Ocorrência crítica na inspeção',
      coalesce(v_critical_description, 'Itens críticos encontrados na inspeção'),
      auth.uid()
    )
    on conflict (inspection_id) do nothing;

    update public.fleet_vehicles
    set status = 'maintenance'
    where id = v_inspection.vehicle_id
      and status <> 'inactive';
  end if;

  return p_inspection_id;
end;
$$;

grant execute on function public.submit_fleet_inspection(uuid, bigint, text, jsonb, jsonb) to authenticated;

create or replace function public.cancel_fleet_inspection(
  p_inspection_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem cancelar inspeções';
  end if;

  update public.fleet_inspections
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      cancelled_by = auth.uid(),
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_inspection_id
    and status in ('pending', 'in_progress');

  if not found then
    raise exception 'Inspeção não encontrada ou já finalizada';
  end if;
end;
$$;

grant execute on function public.cancel_fleet_inspection(uuid, text) to authenticated;

create or replace function public.create_fleet_inspection(
  p_inspection_id uuid,
  p_vehicle_id uuid,
  p_inspection_at timestamptz,
  p_odometer bigint,
  p_general_notes text,
  p_items jsonb,
  p_photos jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_photo jsonb;
  v_has_critical boolean := false;
  v_has_attention boolean := false;
  v_overall_status text := 'approved';
  v_critical_description text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem criar inspeções';
  end if;

  if p_inspection_id is null then
    raise exception 'ID da inspeção é obrigatório';
  end if;

  if p_vehicle_id is null then
    raise exception 'Veículo é obrigatório';
  end if;

  if p_odometer is null or p_odometer < 0 then
    raise exception 'Odômetro inválido';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Checklist da inspeção é obrigatório';
  end if;

  if jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_photos, '[]'::jsonb)) = 0 then
    raise exception 'A inspeção deve ter ao menos uma foto';
  end if;

  if exists (
    select 1
    from public.fleet_inspections fi
    where fi.id = p_inspection_id
  ) then
    raise exception 'Esta inspeção já foi cadastrada';
  end if;

  if not exists (
    select 1
    from public.fleet_vehicles fv
    where fv.id = p_vehicle_id
      and fv.active = true
  ) then
    raise exception 'Veículo inválido ou inativo';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'status', '') not in ('ok', 'attention', 'critical', 'na') then
      raise exception 'Status de item de inspeção inválido';
    end if;

    if coalesce(v_item->>'status', '') in ('attention', 'critical')
       and char_length(btrim(coalesce(v_item->>'notes', ''))) = 0 then
      raise exception 'Itens com atenção ou crítico exigem observação';
    end if;

    if coalesce(v_item->>'status', '') = 'critical' then
      v_has_critical := true;
    elsif coalesce(v_item->>'status', '') = 'attention' then
      v_has_attention := true;
    end if;
  end loop;

  if v_has_critical then
    v_overall_status := 'critical';
  elsif v_has_attention then
    v_overall_status := 'attention';
  else
    v_overall_status := 'approved';
  end if;

  insert into public.fleet_inspections (
    id,
    vehicle_id,
    inspection_at,
    odometer,
    overall_status,
    general_notes,
    created_by,
    status,
    started_at,
    completed_at,
    completed_by
  ) values (
    p_inspection_id,
    p_vehicle_id,
    coalesce(p_inspection_at, timezone('utc', now())),
    p_odometer,
    v_overall_status,
    nullif(btrim(coalesce(p_general_notes, '')), ''),
    auth.uid(),
    'completed',
    coalesce(p_inspection_at, timezone('utc', now())),
    timezone('utc', now()),
    auth.uid()
  );

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    insert into public.fleet_inspection_items (
      inspection_id,
      item_code,
      category,
      label,
      status,
      notes,
      sort_order
    ) values (
      p_inspection_id,
      coalesce(v_item->>'item_code', ''),
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'label', ''),
      coalesce(v_item->>'status', ''),
      nullif(btrim(coalesce(v_item->>'notes', '')), ''),
      coalesce((v_item->>'sort_order')::integer, 0)
    );
  end loop;

  for v_photo in
    select value
    from jsonb_array_elements(p_photos)
  loop
    if char_length(btrim(coalesce(v_photo->>'storage_path', ''))) = 0 then
      raise exception 'Foto sem caminho de storage';
    end if;

    insert into public.fleet_inspection_photos (
      inspection_id,
      storage_path,
      file_name,
      file_size,
      caption,
      created_by
    ) values (
      p_inspection_id,
      v_photo->>'storage_path',
      nullif(btrim(coalesce(v_photo->>'file_name', '')), ''),
      nullif(v_photo->>'file_size', '')::bigint,
      nullif(btrim(coalesce(v_photo->>'caption', '')), ''),
      auth.uid()
    );
  end loop;

  update public.fleet_vehicles
  set current_odometer = greatest(current_odometer, p_odometer)
  where id = p_vehicle_id;

  if v_has_critical then
    select string_agg(format('%s - %s', item->>'category', item->>'label'), '; ')
      into v_critical_description
    from jsonb_array_elements(p_items) item
    where item->>'status' = 'critical';

    insert into public.fleet_occurrences (
      vehicle_id,
      inspection_id,
      severity,
      status,
      title,
      description,
      created_by
    ) values (
      p_vehicle_id,
      p_inspection_id,
      'critical',
      'open',
      'Ocorrência crítica na inspeção',
      coalesce(v_critical_description, 'Itens críticos encontrados na inspeção'),
      auth.uid()
    )
    on conflict (inspection_id) do nothing;

    update public.fleet_vehicles
    set status = 'maintenance'
    where id = p_vehicle_id
      and status <> 'inactive';
  end if;

  return p_inspection_id;
end;
$$;

grant execute on function public.create_fleet_inspection(uuid, uuid, timestamptz, bigint, text, jsonb, jsonb) to authenticated;

create or replace function public.update_fleet_occurrence_status(
  p_occurrence_id uuid,
  p_new_status text,
  p_resolution_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occurrence public.fleet_occurrences%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem atualizar ocorrências';
  end if;

  if p_new_status not in ('in_progress', 'resolved', 'cancelled') then
    raise exception 'Transição de status inválida';
  end if;

  select *
    into v_occurrence
  from public.fleet_occurrences fo
  where fo.id = p_occurrence_id;

  if not found then
    raise exception 'Ocorrência não encontrada';
  end if;

  if v_occurrence.status not in ('open', 'in_progress') then
    raise exception 'Esta ocorrência já foi finalizada';
  end if;

  if v_occurrence.status = 'in_progress' and p_new_status not in ('resolved', 'cancelled') then
    raise exception 'Transição de status inválida';
  end if;

  if p_new_status in ('resolved', 'cancelled')
     and char_length(btrim(coalesce(p_resolution_notes, ''))) = 0 then
    raise exception 'Informe a nota de resolução';
  end if;

  update public.fleet_occurrences
  set status = p_new_status,
      resolution_notes = case
        when p_new_status in ('resolved', 'cancelled') then nullif(btrim(coalesce(p_resolution_notes, '')), '')
        else resolution_notes
      end,
      resolved_by = case
        when p_new_status in ('resolved', 'cancelled') then auth.uid()
        else resolved_by
      end,
      resolved_at = case
        when p_new_status in ('resolved', 'cancelled') then timezone('utc', now())
        else resolved_at
      end
  where id = p_occurrence_id;

  if p_new_status = 'resolved' and not exists (
    select 1
    from public.fleet_occurrences fo
    where fo.vehicle_id = v_occurrence.vehicle_id
      and fo.id <> v_occurrence.id
      and fo.status in ('open', 'in_progress')
  ) then
    update public.fleet_vehicles
    set status = 'available'
    where id = v_occurrence.vehicle_id
      and active = true;
  end if;
end;
$$;

grant execute on function public.update_fleet_occurrence_status(uuid, text, text) to authenticated;
