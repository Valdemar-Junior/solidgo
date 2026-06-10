-- Isolated MDF-e module

create table if not exists public.mdfe_settings (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  environment text not null default 'homologation',
  operation_type text not null default 'cargo_propria',
  emit_type integer not null default 2,
  transport_type integer,
  default_emitter_id uuid,
  loading_city_code text,
  loading_city_name text,
  loading_uf text,
  observations text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdfe_settings_environment_check check (environment in ('homologation', 'production')),
  constraint mdfe_settings_operation_type_check check (operation_type in ('cargo_propria'))
);

create table if not exists public.mdfe_emitters (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  trade_name text,
  cnpj text not null,
  state_registration text not null,
  street text not null,
  number text not null,
  complement text,
  neighborhood text not null,
  city_code text not null,
  city_name text not null,
  uf text not null,
  zip_code text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdfe_emitters_company_name_not_blank check (char_length(btrim(company_name)) > 0),
  constraint mdfe_emitters_cnpj_not_blank check (char_length(btrim(cnpj)) > 0),
  constraint mdfe_emitters_ie_not_blank check (char_length(btrim(state_registration)) > 0),
  constraint mdfe_emitters_street_not_blank check (char_length(btrim(street)) > 0),
  constraint mdfe_emitters_number_not_blank check (char_length(btrim(number)) > 0),
  constraint mdfe_emitters_neighborhood_not_blank check (char_length(btrim(neighborhood)) > 0),
  constraint mdfe_emitters_city_code_not_blank check (char_length(btrim(city_code)) > 0),
  constraint mdfe_emitters_city_name_not_blank check (char_length(btrim(city_name)) > 0),
  constraint mdfe_emitters_uf_len check (char_length(btrim(uf)) = 2)
);

create unique index if not exists mdfe_emitters_cnpj_unique_idx
  on public.mdfe_emitters ((regexp_replace(cnpj, '\D', '', 'g')));

create index if not exists mdfe_emitters_active_idx
  on public.mdfe_emitters (active, created_at desc);

create table if not exists public.mdfe_vehicles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  plate text not null,
  renavam text,
  tara_kg integer not null,
  capacity_kg integer,
  capacity_m3 integer,
  body_type text not null,
  rodado_type text,
  licensing_uf text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdfe_vehicles_display_name_not_blank check (char_length(btrim(display_name)) > 0),
  constraint mdfe_vehicles_plate_not_blank check (char_length(btrim(plate)) > 0),
  constraint mdfe_vehicles_tara_non_negative check (tara_kg >= 0),
  constraint mdfe_vehicles_capacity_kg_non_negative check (capacity_kg is null or capacity_kg >= 0),
  constraint mdfe_vehicles_capacity_m3_non_negative check (capacity_m3 is null or capacity_m3 >= 0),
  constraint mdfe_vehicles_body_type_not_blank check (char_length(btrim(body_type)) > 0),
  constraint mdfe_vehicles_licensing_uf_len check (char_length(btrim(licensing_uf)) = 2)
);

create unique index if not exists mdfe_vehicles_plate_unique_idx
  on public.mdfe_vehicles ((lower(btrim(plate))));

create index if not exists mdfe_vehicles_active_idx
  on public.mdfe_vehicles (active, created_at desc);

create table if not exists public.mdfe_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cpf text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdfe_drivers_name_not_blank check (char_length(btrim(name)) > 0),
  constraint mdfe_drivers_cpf_not_blank check (char_length(btrim(cpf)) > 0)
);

create unique index if not exists mdfe_drivers_cpf_unique_idx
  on public.mdfe_drivers ((regexp_replace(cpf, '\D', '', 'g')));

create index if not exists mdfe_drivers_active_idx
  on public.mdfe_drivers (active, created_at desc);

create table if not exists public.mdfe_manifests (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references public.routes(id) on delete set null,
  emitter_id uuid not null references public.mdfe_emitters(id) on delete restrict,
  vehicle_id uuid not null references public.mdfe_vehicles(id) on delete restrict,
  driver_id uuid not null references public.mdfe_drivers(id) on delete restrict,
  status text not null default 'draft',
  environment text not null default 'homologation',
  operation_type text not null default 'cargo_propria',
  loading_city_code text,
  loading_city_name text,
  loading_uf text,
  unloading_city_code text,
  unloading_city_name text,
  unloading_uf text,
  total_documents integer not null default 0,
  total_value numeric(13,2) not null default 0,
  total_gross_weight numeric(13,4) not null default 0,
  focus_reference text,
  mdfe_number text,
  mdfe_key text,
  protocol text,
  payload_json jsonb not null default '{}'::jsonb,
  response_json jsonb not null default '{}'::jsonb,
  xml_content text,
  pdf_url text,
  error_message text,
  issued_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdfe_manifests_status_check check (status in ('draft', 'processing', 'issued', 'closed', 'cancelled', 'error')),
  constraint mdfe_manifests_environment_check check (environment in ('homologation', 'production')),
  constraint mdfe_manifests_operation_type_check check (operation_type in ('cargo_propria')),
  constraint mdfe_manifests_total_documents_non_negative check (total_documents >= 0),
  constraint mdfe_manifests_total_value_non_negative check (total_value >= 0),
  constraint mdfe_manifests_total_gross_weight_non_negative check (total_gross_weight >= 0)
);

create index if not exists mdfe_manifests_route_idx
  on public.mdfe_manifests (route_id, created_at desc);

create index if not exists mdfe_manifests_status_idx
  on public.mdfe_manifests (status, created_at desc);

create unique index if not exists mdfe_manifests_key_unique_idx
  on public.mdfe_manifests (mdfe_key)
  where mdfe_key is not null;

create table if not exists public.mdfe_manifest_documents (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.mdfe_manifests(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  order_id_erp text,
  nfe_key text not null,
  nfe_number text,
  source_city_code text,
  source_city_name text,
  source_uf text,
  target_city_code text,
  target_city_name text,
  target_uf text,
  total_value numeric(13,2),
  gross_weight numeric(13,4),
  xml_snapshot text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint mdfe_manifest_documents_nfe_key_not_blank check (char_length(btrim(nfe_key)) > 0)
);

create unique index if not exists mdfe_manifest_documents_unique_nfe_idx
  on public.mdfe_manifest_documents (manifest_id, nfe_key);

create index if not exists mdfe_manifest_documents_order_idx
  on public.mdfe_manifest_documents (order_id, order_id_erp);

alter table public.mdfe_settings
  add constraint mdfe_settings_default_emitter_fk
  foreign key (default_emitter_id) references public.mdfe_emitters(id) on delete set null;

create or replace function public.set_mdfe_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_mdfe_settings_updated_at on public.mdfe_settings;
create trigger trg_mdfe_settings_updated_at
before update on public.mdfe_settings
for each row
execute function public.set_mdfe_updated_at();

drop trigger if exists trg_mdfe_emitters_updated_at on public.mdfe_emitters;
create trigger trg_mdfe_emitters_updated_at
before update on public.mdfe_emitters
for each row
execute function public.set_mdfe_updated_at();

drop trigger if exists trg_mdfe_vehicles_updated_at on public.mdfe_vehicles;
create trigger trg_mdfe_vehicles_updated_at
before update on public.mdfe_vehicles
for each row
execute function public.set_mdfe_updated_at();

drop trigger if exists trg_mdfe_drivers_updated_at on public.mdfe_drivers;
create trigger trg_mdfe_drivers_updated_at
before update on public.mdfe_drivers
for each row
execute function public.set_mdfe_updated_at();

drop trigger if exists trg_mdfe_manifests_updated_at on public.mdfe_manifests;
create trigger trg_mdfe_manifests_updated_at
before update on public.mdfe_manifests
for each row
execute function public.set_mdfe_updated_at();

alter table public.mdfe_settings enable row level security;
alter table public.mdfe_emitters enable row level security;
alter table public.mdfe_vehicles enable row level security;
alter table public.mdfe_drivers enable row level security;
alter table public.mdfe_manifests enable row level security;
alter table public.mdfe_manifest_documents enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'mdfe_settings',
    'mdfe_emitters',
    'mdfe_vehicles',
    'mdfe_drivers',
    'mdfe_manifests',
    'mdfe_manifest_documents'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = tbl || '_admin_select'
    ) then
      execute format(
        'create policy %I on public.%I for select using (
          exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role = %L
          )
        )',
        tbl || '_admin_select',
        tbl,
        'admin'
      );
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = tbl || '_admin_insert'
    ) then
      execute format(
        'create policy %I on public.%I for insert with check (
          exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role = %L
          )
        )',
        tbl || '_admin_insert',
        tbl,
        'admin'
      );
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = tbl || '_admin_update'
    ) then
      execute format(
        'create policy %I on public.%I for update using (
          exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role = %L
          )
        ) with check (
          exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role = %L
          )
        )',
        tbl || '_admin_update',
        tbl,
        'admin',
        'admin'
      );
    end if;
  end loop;
end;
$$;

insert into public.mdfe_settings (
  enabled,
  environment,
  operation_type,
  emit_type
)
select false, 'homologation', 'cargo_propria', 2
where not exists (
  select 1 from public.mdfe_settings
);
