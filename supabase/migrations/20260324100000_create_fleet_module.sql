-- Isolated fleet management module

create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  plate text not null,
  brand text not null,
  model text not null,
  model_year integer,
  vehicle_type text,
  renavam text,
  chassis text,
  current_odometer bigint not null default 0,
  status text not null default 'available',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fleet_vehicles_display_name_not_blank check (char_length(btrim(display_name)) > 0),
  constraint fleet_vehicles_plate_not_blank check (char_length(btrim(plate)) > 0),
  constraint fleet_vehicles_brand_not_blank check (char_length(btrim(brand)) > 0),
  constraint fleet_vehicles_model_not_blank check (char_length(btrim(model)) > 0),
  constraint fleet_vehicles_odometer_non_negative check (current_odometer >= 0),
  constraint fleet_vehicles_status_check check (status in ('available', 'maintenance', 'inactive'))
);

create unique index if not exists fleet_vehicles_plate_unique_idx
  on public.fleet_vehicles ((lower(btrim(plate))));

create unique index if not exists fleet_vehicles_renavam_unique_idx
  on public.fleet_vehicles ((lower(btrim(renavam))))
  where renavam is not null and char_length(btrim(renavam)) > 0;

create unique index if not exists fleet_vehicles_chassis_unique_idx
  on public.fleet_vehicles ((lower(btrim(chassis))))
  where chassis is not null and char_length(btrim(chassis)) > 0;

create index if not exists fleet_vehicles_active_idx
  on public.fleet_vehicles (active, status, created_at desc);

create or replace function public.set_fleet_vehicle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_fleet_vehicle_updated_at on public.fleet_vehicles;

create trigger trg_fleet_vehicle_updated_at
before update on public.fleet_vehicles
for each row
execute function public.set_fleet_vehicle_updated_at();

create table if not exists public.fleet_inspections (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  inspection_at timestamptz not null default timezone('utc', now()),
  odometer bigint not null,
  overall_status text not null,
  general_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint fleet_inspections_odometer_non_negative check (odometer >= 0),
  constraint fleet_inspections_overall_status_check check (overall_status in ('approved', 'attention', 'critical'))
);

create index if not exists fleet_inspections_vehicle_idx
  on public.fleet_inspections (vehicle_id, inspection_at desc);

create index if not exists fleet_inspections_status_idx
  on public.fleet_inspections (overall_status, created_at desc);

create table if not exists public.fleet_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.fleet_inspections(id) on delete cascade,
  item_code text not null,
  category text not null,
  label text not null,
  status text not null,
  notes text,
  sort_order integer not null,
  constraint fleet_inspection_items_code_not_blank check (char_length(btrim(item_code)) > 0),
  constraint fleet_inspection_items_category_not_blank check (char_length(btrim(category)) > 0),
  constraint fleet_inspection_items_label_not_blank check (char_length(btrim(label)) > 0),
  constraint fleet_inspection_items_sort_order_non_negative check (sort_order >= 0),
  constraint fleet_inspection_items_status_check check (status in ('ok', 'attention', 'critical', 'na'))
);

create unique index if not exists fleet_inspection_items_unique_code_idx
  on public.fleet_inspection_items (inspection_id, item_code);

create index if not exists fleet_inspection_items_status_idx
  on public.fleet_inspection_items (status, inspection_id);

create table if not exists public.fleet_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.fleet_inspections(id) on delete cascade,
  storage_path text not null,
  file_name text,
  file_size bigint,
  caption text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint fleet_inspection_photos_storage_path_not_blank check (char_length(btrim(storage_path)) > 0)
);

create unique index if not exists fleet_inspection_photos_storage_unique_idx
  on public.fleet_inspection_photos (storage_path);

create index if not exists fleet_inspection_photos_inspection_idx
  on public.fleet_inspection_photos (inspection_id, created_at asc);

create table if not exists public.fleet_occurrences (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  inspection_id uuid not null references public.fleet_inspections(id) on delete cascade,
  severity text not null default 'critical',
  status text not null default 'open',
  title text not null,
  description text,
  resolution_notes text,
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  constraint fleet_occurrences_severity_check check (severity in ('critical')),
  constraint fleet_occurrences_status_check check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  constraint fleet_occurrences_title_not_blank check (char_length(btrim(title)) > 0)
);

create unique index if not exists fleet_occurrences_inspection_unique_idx
  on public.fleet_occurrences (inspection_id);

create index if not exists fleet_occurrences_vehicle_idx
  on public.fleet_occurrences (vehicle_id, status, created_at desc);

alter table public.fleet_vehicles enable row level security;
alter table public.fleet_inspections enable row level security;
alter table public.fleet_inspection_items enable row level security;
alter table public.fleet_inspection_photos enable row level security;
alter table public.fleet_occurrences enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_vehicles'
      and policyname = 'fleet_vehicles_admin_select'
  ) then
    create policy fleet_vehicles_admin_select
      on public.fleet_vehicles
      for select
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_vehicles'
      and policyname = 'fleet_vehicles_admin_insert'
  ) then
    create policy fleet_vehicles_admin_insert
      on public.fleet_vehicles
      for insert
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_vehicles'
      and policyname = 'fleet_vehicles_admin_update'
  ) then
    create policy fleet_vehicles_admin_update
      on public.fleet_vehicles
      for update
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      )
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspections'
      and policyname = 'fleet_inspections_admin_select'
  ) then
    create policy fleet_inspections_admin_select
      on public.fleet_inspections
      for select
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspections'
      and policyname = 'fleet_inspections_admin_insert'
  ) then
    create policy fleet_inspections_admin_insert
      on public.fleet_inspections
      for insert
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspection_items'
      and policyname = 'fleet_inspection_items_admin_select'
  ) then
    create policy fleet_inspection_items_admin_select
      on public.fleet_inspection_items
      for select
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspection_items'
      and policyname = 'fleet_inspection_items_admin_insert'
  ) then
    create policy fleet_inspection_items_admin_insert
      on public.fleet_inspection_items
      for insert
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspection_photos'
      and policyname = 'fleet_inspection_photos_admin_select'
  ) then
    create policy fleet_inspection_photos_admin_select
      on public.fleet_inspection_photos
      for select
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_inspection_photos'
      and policyname = 'fleet_inspection_photos_admin_insert'
  ) then
    create policy fleet_inspection_photos_admin_insert
      on public.fleet_inspection_photos
      for insert
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_occurrences'
      and policyname = 'fleet_occurrences_admin_select'
  ) then
    create policy fleet_occurrences_admin_select
      on public.fleet_occurrences
      for select
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_occurrences'
      and policyname = 'fleet_occurrences_admin_insert'
  ) then
    create policy fleet_occurrences_admin_insert
      on public.fleet_occurrences
      for insert
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_occurrences'
      and policyname = 'fleet_occurrences_admin_update'
  ) then
    create policy fleet_occurrences_admin_update
      on public.fleet_occurrences
      for update
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      )
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;
end
$$;

grant select, insert, update on public.fleet_vehicles to authenticated;
grant select, insert on public.fleet_inspections to authenticated;
grant select, insert on public.fleet_inspection_items to authenticated;
grant select, insert on public.fleet_inspection_photos to authenticated;
grant select, insert, update on public.fleet_occurrences to authenticated;

insert into storage.buckets (id, name, public)
values ('fleet-inspections', 'fleet-inspections', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_select_admin'
  ) then
    create policy fleet_inspections_storage_select_admin
      on storage.objects
      for select
      using (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_insert_admin'
  ) then
    create policy fleet_inspections_storage_insert_admin
      on storage.objects
      for insert
      with check (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_update_admin'
  ) then
    create policy fleet_inspections_storage_update_admin
      on storage.objects
      for update
      using (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      )
      with check (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fleet_inspections_storage_delete_admin'
  ) then
    create policy fleet_inspections_storage_delete_admin
      on storage.objects
      for delete
      using (
        bucket_id = 'fleet-inspections'
        and exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;
end
$$;

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
    created_by
  ) values (
    p_inspection_id,
    p_vehicle_id,
    coalesce(p_inspection_at, timezone('utc', now())),
    p_odometer,
    v_overall_status,
    nullif(btrim(coalesce(p_general_notes, '')), ''),
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
    );

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

  if v_occurrence.status = 'open' and p_new_status not in ('in_progress', 'resolved', 'cancelled') then
    raise exception 'Transição de status inválida';
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

  if p_new_status = 'resolved' then
    update public.fleet_vehicles
    set status = 'available'
    where id = v_occurrence.vehicle_id
      and active = true;
  end if;
end;
$$;

grant execute on function public.update_fleet_occurrence_status(uuid, text, text) to authenticated;
