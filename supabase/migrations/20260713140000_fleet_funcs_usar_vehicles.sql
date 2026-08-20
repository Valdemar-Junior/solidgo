-- ============================================================================
-- Ajusta as funções da Frota que ainda referenciavam fleet_vehicles (removida).
-- Corpo idêntico ao original; só a tabela mudou para public.vehicles (que agora
-- carrega active / current_odometer / status). Corrige o erro
-- 'relation public.fleet_vehicles does not exist' ao criar/enviar inspeção.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    from public.vehicles fv
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

  update public.vehicles
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

    update public.vehicles
    set status = 'maintenance'
    where id = p_vehicle_id
      and status <> 'inactive';
  end if;

  return p_inspection_id;
end;
$$;


CREATE OR REPLACE FUNCTION public.create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_general_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    from public.vehicles fv
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


CREATE OR REPLACE FUNCTION public.submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  update public.vehicles
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

    update public.vehicles
    set status = 'maintenance'
    where id = v_inspection.vehicle_id
      and status <> 'inactive';
  end if;

  return p_inspection_id;
end;
$$;


CREATE OR REPLACE FUNCTION public.update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    update public.vehicles
    set status = 'available'
    where id = v_occurrence.vehicle_id
      and active = true;
  end if;
end;
$$;


