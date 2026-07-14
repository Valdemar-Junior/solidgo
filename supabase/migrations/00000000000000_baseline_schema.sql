--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_business_days(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.add_business_days(start_date timestamp with time zone, days integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    curr_date DATE := start_date::DATE;
    cnt INT := 0;
BEGIN
    IF days <= 0 THEN RETURN start_date; END IF;
    
    WHILE cnt < days LOOP
        curr_date := curr_date + 1;
        -- 0=Sunday, 6=Saturday
        IF EXTRACT(DOW FROM curr_date) NOT IN (0, 6) 
           AND NOT EXISTS (SELECT 1 FROM company_holidays WHERE date = curr_date) THEN
            cnt := cnt + 1;
        END IF;
    END LOOP;
    
    RETURN curr_date + time '18:00:00'; -- Default to end of day
END;
$$;


ALTER FUNCTION public.add_business_days(start_date timestamp with time zone, days integer) OWNER TO postgres;

--
-- Name: add_column_if_not_exists(text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = p_table_name AND column_name = p_column_name
    ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', p_table_name, p_column_name, p_column_type);
        RAISE NOTICE 'Coluna % adicionada à tabela %', p_column_name, p_table_name;
    ELSE
        RAISE NOTICE 'Coluna % já existe na tabela %', p_column_name, p_table_name;
    END IF;
END;
$$;


ALTER FUNCTION public.add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text) OWNER TO postgres;

--
-- Name: admin_create_helper(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.admin_create_helper(p_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare new_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'Not authorized';
  end if;
  insert into public.helpers(id,name,active) values (new_id, p_name, true);
  return new_id;
end; $$;


ALTER FUNCTION public.admin_create_helper(p_name text) OWNER TO postgres;

--
-- Name: admin_create_user(uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.admin_create_user(p_id uuid, p_email text, p_name text, p_role text DEFAULT 'driver'::text, p_must_change_password boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare has_mcp boolean;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'Not authorized';
  end if;
  select exists(
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='users' and column_name='must_change_password'
  ) into has_mcp;
  if has_mcp then
    insert into public.users (id,email,name,role,must_change_password)
    values (p_id, p_email, p_name, p_role, p_must_change_password);
  else
    insert into public.users (id,email,name,role)
    values (p_id, p_email, p_name, p_role);
  end if;
end; $$;


ALTER FUNCTION public.admin_create_user(p_id uuid, p_email text, p_name text, p_role text, p_must_change_password boolean) OWNER TO postgres;

--
-- Name: calculate_order_deadlines(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calculate_order_deadlines() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    -- Vars for rules
    city_rule RECORD;
    general_rule JSONB;
    
    -- Decision vars
    is_full BOOLEAN;
    is_rural BOOLEAN;
    effective_city TEXT;
    needs_assembly BOOLEAN := FALSE;
    item JSONB;
    
    -- Calculated deadlines
    entrega_days INT;
    montagem_days INT;
    
    -- Result dates
    calc_entrega TIMESTAMP WITH TIME ZONE;
    calc_montagem TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Only calculate if data_venda is present
    IF NEW.data_venda IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check if ANY item needs assembly
    IF NEW.items_json IS NOT NULL THEN
        FOR item IN SELECT * FROM jsonb_array_elements(NEW.items_json)
        LOOP
            IF (item->>'has_assembly' ILIKE 'SIM' OR item->>'has_assembly' ILIKE 'S') THEN
                needs_assembly := TRUE;
            END IF;
            -- Check for 'produto_e_montavel' as fallback if needed
            IF (item->>'produto_e_montavel' ILIKE 'SIM') THEN
                 needs_assembly := TRUE;
            END IF;
        END LOOP;
    END IF;

    -- 1. Determine City
    effective_city := UPPER(COALESCE(NEW.address_json->>'city', NEW.address_json->>'localidade', NEW.address_json->>'cidade', ''));
    
    -- 2. Determine Flags
    is_full := (NEW.tem_frete_full ILIKE 'SIM') OR (NEW.observacoes_internas ILIKE '%*frete full*%');
    
    is_rural := is_rural_address(NEW.address_json);
    
    -- 3. Fetch Specific City Rule
    SELECT * INTO city_rule FROM delivery_city_rules 
    WHERE UPPER(city_name) = effective_city;
    
    -- 4. Determine Days based on Priority
    IF city_rule IS NOT NULL THEN
        -- Rule Found
        IF is_full THEN
             entrega_days := city_rule.full_delivery_days;
             montagem_days := city_rule.full_assembly_days;
        ELSIF is_rural THEN
             entrega_days := city_rule.rural_delivery_days;
             montagem_days := city_rule.rural_assembly_days;
        ELSE
             -- Standard Urban
             entrega_days := city_rule.delivery_days;
             montagem_days := city_rule.assembly_days;
        END IF;
    ELSE
        -- No City Rule -> Use General Default
        SELECT value INTO general_rule FROM app_settings WHERE key = 'general_deadlines';
        
        entrega_days := COALESCE((general_rule->>'delivery_days')::INT, 15);
        montagem_days := COALESCE((general_rule->>'assembly_days')::INT, 15);
    END IF;

    -- 5. Calculate Dates
    calc_entrega := add_business_days(NEW.data_venda, entrega_days);
    NEW.previsao_entrega := calc_entrega;
    
    -- Only calculate assembly date if needed
    IF needs_assembly THEN
        calc_montagem := add_business_days(NEW.data_venda, montagem_days);
        NEW.previsao_montagem := calc_montagem;
    ELSE
        NEW.previsao_montagem := NULL;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.calculate_order_deadlines() OWNER TO postgres;

--
-- Name: cancel_fleet_inspection(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cancel_fleet_inspection(p_inspection_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.cancel_fleet_inspection(p_inspection_id uuid, p_reason text) OWNER TO postgres;

--
-- Name: clear_order_return_pickup(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clear_order_return_pickup(p_return_id uuid DEFAULT NULL::uuid, p_pickup_order_id uuid DEFAULT NULL::uuid, p_pickup_route_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_ids uuid[];
  i integer;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if num_nonnulls(p_return_id, p_pickup_order_id, p_pickup_route_id) <> 1 then
    raise exception 'Informe exatamente um identificador para limpar a coleta';
  end if;

  select coalesce(array_agg(distinct r.order_id), '{}'::uuid[])
  into v_order_ids
  from public.order_returns r
  where (p_return_id is not null and r.id = p_return_id)
     or (p_pickup_order_id is not null and r.pickup_order_id = p_pickup_order_id)
     or (p_pickup_route_id is not null and r.pickup_route_id = p_pickup_route_id);

  update public.order_returns
  set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
  where (p_return_id is not null and id = p_return_id)
     or (p_pickup_order_id is not null and pickup_order_id = p_pickup_order_id)
     or (p_pickup_route_id is not null and pickup_route_id = p_pickup_route_id);

  if coalesce(array_length(v_order_ids, 1), 0) > 0 then
    for i in 1..array_length(v_order_ids, 1) loop
      perform public.sync_order_return_operational_state(v_order_ids[i]);
    end loop;
  end if;

  return jsonb_build_object('cleared', true, 'order_ids', coalesce(v_order_ids, '{}'::uuid[]));
end;
$$;


ALTER FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) IS 'Remove o vínculo entre coleta e devolução para permitir recriação segura e recalcula o estado operacional do pedido.';


--
-- Name: clear_return_pickup_after_route_order_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clear_return_pickup_after_route_order_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  select r.order_id into v_order_id
  from public.order_returns r
  where r.pickup_order_id = old.order_id
    and r.pickup_route_id = old.route_id;

  if v_order_id is not null then
    update public.order_returns
    set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
    where pickup_order_id = old.order_id
      and pickup_route_id = old.route_id;

    perform public.sync_order_return_operational_state(v_order_id);
  end if;

  return old;
end;
$$;


ALTER FUNCTION public.clear_return_pickup_after_route_order_delete() OWNER TO postgres;

--
-- Name: clear_return_pickup_before_parent_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clear_return_pickup_before_parent_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_ids uuid[];
  i integer;
begin
  if tg_table_name = 'routes' then
    select coalesce(array_agg(distinct r.order_id), '{}'::uuid[])
    into v_order_ids
    from public.order_returns r
    where r.pickup_route_id = old.id;

    update public.order_returns
    set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
    where pickup_route_id = old.id;
  else
    select coalesce(array_agg(distinct r.order_id), '{}'::uuid[])
    into v_order_ids
    from public.order_returns r
    where r.pickup_order_id = old.id;

    update public.order_returns
    set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
    where pickup_order_id = old.id;
  end if;

  if coalesce(array_length(v_order_ids, 1), 0) > 0 then
    for i in 1..array_length(v_order_ids, 1) loop
      perform public.sync_order_return_operational_state(v_order_ids[i]);
    end loop;
  end if;

  return old;
end;
$$;


ALTER FUNCTION public.clear_return_pickup_before_parent_delete() OWNER TO postgres;

--
-- Name: create_fleet_inspection(uuid, uuid, timestamp with time zone, bigint, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) RETURNS uuid
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


ALTER FUNCTION public.create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) OWNER TO postgres;

--
-- Name: create_fleet_inspection_assignment(uuid, uuid, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_general_notes text DEFAULT NULL::text) RETURNS uuid
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


ALTER FUNCTION public.create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone, p_general_notes text) OWNER TO postgres;

--
-- Name: flag_order_return_capacity_divergence(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.flag_order_return_capacity_divergence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_order_id uuid;
  v_violation jsonb;
  v_issue_key text;
begin
  v_return_id := case when tg_op = 'DELETE' then old.return_id else new.return_id end;

  select r.order_id into v_order_id
  from public.order_returns r
  where r.id = v_return_id;

  if v_order_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_violation := public.get_order_return_capacity_violation(v_return_id);
  v_issue_key := 'over-return:' || v_return_id::text;

  if v_violation is not null then
    update public.order_returns
    set
      processing_status = 'divergent',
      processing_notes = 'Divergência: quantidade devolvida acima da quantidade comprada.',
      requires_pickup = false,
      pickup_created_at = null,
      pickup_order_id = null,
      pickup_route_id = null
    where id = v_return_id
      and processing_status <> 'cancelled';

    insert into public.item_fulfillment_sync_issues (
      order_id, order_item_id, issue_type, issue_key, details, status, detected_at
    ) values (
      v_order_id,
      nullif(v_violation->>'order_item_id', '')::uuid,
      'return_quantity_exceeded',
      v_issue_key,
      v_violation || jsonb_build_object('return_id', v_return_id),
      'open',
      timezone('utc', now())
    )
    on conflict (order_id, issue_type, issue_key) do update set
      order_item_id = excluded.order_item_id,
      details = excluded.details,
      status = 'open',
      detected_at = excluded.detected_at,
      resolved_at = null,
      resolved_by = null;
  else
    update public.item_fulfillment_sync_issues
    set status = 'resolved', resolved_at = timezone('utc', now())
    where order_id = v_order_id
      and issue_type = 'return_quantity_exceeded'
      and issue_key = v_issue_key
      and status = 'open';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION public.flag_order_return_capacity_divergence() OWNER TO postgres;

--
-- Name: get_duplicate_orders(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_duplicate_orders() RETURNS TABLE(order_id_erp text, count bigint, ids uuid[])
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.order_id_erp, 
        COUNT(*) as count,
        ARRAY_AGG(o.id) as ids
    FROM orders o
    GROUP BY o.order_id_erp
    HAVING COUNT(*) > 1;
END;
$$;


ALTER FUNCTION public.get_duplicate_orders() OWNER TO postgres;

--
-- Name: get_import_history_summary(text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_import_history_summary(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0) RETURNS TABLE(manifest_key text, manifest_id text, imported_at timestamp with time zone, total_orders bigint, is_avulso boolean, total_groups bigint)
    LANGUAGE sql STABLE
    AS $_$
  with grouped as (
    select
      coalesce(o.manifest_id, 'avulsos') as manifest_key,
      o.manifest_id,
      max(o.created_at) as imported_at,
      count(*)::bigint as total_orders,
      (o.manifest_id is null) as is_avulso
    from public.orders o
    where
      p_search is null
      or p_search = ''
      or coalesce(o.manifest_id, 'avulsos') ilike '%' || p_search || '%'
    group by coalesce(o.manifest_id, 'avulsos'), o.manifest_id
  )
  select
    g.manifest_key,
    g.manifest_id,
    g.imported_at,
    g.total_orders,
    g.is_avulso,
    count(*) over()::bigint as total_groups
  from grouped g
  order by
    case when g.is_avulso then 1 else 0 end,
    case
      when g.manifest_id ~ '^\d+$' then g.manifest_id::bigint
      else null
    end desc nulls last,
    g.manifest_id desc nulls last,
    g.imported_at desc
  limit greatest(coalesce(p_limit, 10), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$_$;


ALTER FUNCTION public.get_import_history_summary(p_search text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: get_item_fulfillment_shadow_diagnostics(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_item_fulfillment_shadow_diagnostics() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  select jsonb_build_object(
    'orders_total', (select count(*) from public.orders),
    'orders_with_source_items', (
      select count(distinct oi.order_id)
      from public.order_items oi
      where oi.source_present
    ),
    'orders_without_shadow_items', (
      select count(*)
      from public.orders o
      where jsonb_typeof(o.items_json) = 'array'
        and jsonb_array_length(o.items_json) > 0
        and not exists (
          select 1 from public.order_items oi
          where oi.order_id = o.id and oi.source_present
        )
    ),
    'source_items_total', (select count(*) from public.order_items where source_present),
    'source_items_missing', (select count(*) from public.order_items where not source_present),
    'over_return_items', (select count(*) from public.order_item_shadow_balances where has_over_return),
    'open_issues', (select count(*) from public.item_fulfillment_sync_issues where status = 'open'),
    'legacy_routes', (select count(*) from public.routes where fulfillment_mode = 'legacy'),
    'itemized_routes', (select count(*) from public.routes where fulfillment_mode = 'itemized')
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.get_item_fulfillment_shadow_diagnostics() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id_erp text NOT NULL,
    customer_name text NOT NULL,
    phone text NOT NULL,
    address_json jsonb NOT NULL,
    items_json jsonb NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    raw_json jsonb,
    xml_documento text,
    danfe_base64 text,
    danfe_gerada_em timestamp with time zone,
    filial_venda text,
    data_venda timestamp with time zone,
    previsao_entrega timestamp with time zone,
    tem_frete_full text,
    observacoes_publicas text,
    observacoes_internas text,
    customer_cpf text,
    vendedor_nome text,
    return_flag boolean DEFAULT false,
    last_return_reason text,
    last_return_notes text,
    brand text,
    department text,
    service_type text,
    erp_status character varying(50),
    blocked_at timestamp with time zone,
    blocked_reason text,
    requires_pickup boolean DEFAULT false,
    pickup_created_at timestamp with time zone,
    return_nfe_number character varying(50),
    return_nfe_key character varying(100),
    return_nfe_xml text,
    return_date timestamp with time zone,
    return_type character varying(50),
    return_danfe_base64 text,
    import_source text,
    previsao_montagem timestamp with time zone,
    product_group text,
    product_subgroup text,
    manifest_id text,
    is_carrier_delivery boolean DEFAULT false NOT NULL,
    requires_store_release boolean DEFAULT false NOT NULL,
    store_release_status text DEFAULT 'not_applicable'::text NOT NULL,
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'delivered'::text, 'imported'::text]))),
    CONSTRAINT orders_store_release_status_check CHECK ((store_release_status = ANY (ARRAY['not_applicable'::text, 'pending'::text, 'partial'::text, 'released'::text])))
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: COLUMN orders.erp_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.erp_status IS 'Status do pedido no ERP (devolvido, cancelado, etc)';


--
-- Name: COLUMN orders.blocked_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.blocked_at IS 'Data/hora em que o pedido foi bloqueado para roteamento';


--
-- Name: COLUMN orders.blocked_reason; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.blocked_reason IS 'Motivo do bloqueio';


--
-- Name: COLUMN orders.requires_pickup; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.requires_pickup IS 'TRUE se precisa de coleta física no cliente';


--
-- Name: COLUMN orders.pickup_created_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.pickup_created_at IS 'Data/hora em que a rota de coleta foi criada';


--
-- Name: COLUMN orders.return_nfe_number; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.return_nfe_number IS 'Número da NF-e de devolução do ERP';


--
-- Name: COLUMN orders.return_nfe_key; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.return_nfe_key IS 'Chave de acesso da NF-e de devolução (44 dígitos)';


--
-- Name: COLUMN orders.return_nfe_xml; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.return_nfe_xml IS 'XML completo da NF-e de devolução';


--
-- Name: COLUMN orders.return_date; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.return_date IS 'Data da devolução no ERP';


--
-- Name: COLUMN orders.return_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.return_type IS 'Tipo de retorno (NOTA DE DEVOLUCAO, etc)';


--
-- Name: COLUMN orders.return_danfe_base64; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.return_danfe_base64 IS 'PDF da DANFE de devolução em Base64';


--
-- Name: COLUMN orders.import_source; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.orders.import_source IS 'Origem da importação: avulsa ou lote';


--
-- Name: get_missing_assembly_orders(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_missing_assembly_orders() RETURNS SETOF public.orders
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT o.*
    FROM orders o
    LEFT JOIN assembly_products ap ON o.id = ap.order_id
    WHERE o.status = 'delivered' 
      AND o.has_assembly = true
      AND ap.id IS NULL; -- Missing in assembly_products
END;
$$;


ALTER FUNCTION public.get_missing_assembly_orders() OWNER TO postgres;

--
-- Name: get_order_public(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_order_public(p_order_number text, p_cpf text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_main_order RECORD;
  v_delivery_timeline JSONB;
  v_delivery_history JSONB;
  v_assembly_timeline JSONB;
  v_has_assembly_flag BOOLEAN := FALSE;
  v_clean_cpf TEXT;
BEGIN
  v_clean_cpf := regexp_replace(p_cpf, '[^0-9]', '', 'g');

  -- 1. Buscar o ID do pedido ÚNICO validando CPF
  SELECT id INTO v_order_id
  FROM orders
  WHERE order_id_erp = p_order_number
    AND (
      regexp_replace(COALESCE(customer_cpf, ''), '[^0-9]', '', 'g') = v_clean_cpf
      OR regexp_replace(COALESCE(raw_json->>'destinatario_cpf', ''), '[^0-9]', '', 'g') = v_clean_cpf
      OR regexp_replace(COALESCE(raw_json->>'cliente_cpf', ''), '[^0-9]', '', 'g') = v_clean_cpf
      OR regexp_replace(COALESCE(raw_json->>'cpf', ''), '[^0-9]', '', 'g') = v_clean_cpf
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_order_id IS NULL THEN RETURN NULL; END IF;

  -- Carregar SOMENTE os dados principais necessarios (evitar SELECT *) para nao carregar strings Base64 XML na RAM da function
  SELECT 
    id, order_id_erp, customer_name, address_json, items_json, 
    created_at, previsao_entrega, previsao_montagem, raw_json 
  INTO v_main_order 
  FROM orders 
  WHERE id = v_order_id;

  -- 2. Construir Histórico de Entregas
  SELECT jsonb_agg(
    jsonb_build_object(
      'route_name', r.name,
      'dispatched_at', r.updated_at,
      'status', ro.status,
      'route_status', r.status,
      'delivered_at', ro.delivered_at,
      'returned_at', ro.returned_at,
      'return_reason', rr.reason,
      'return_notes', ro.return_notes
    ) ORDER BY ro.created_at ASC
  )
  INTO v_delivery_history
  FROM route_orders ro
  JOIN routes r ON r.id = ro.route_id
  LEFT JOIN return_reasons rr ON rr.id = ro.return_reason_id
  WHERE ro.order_id = v_order_id
  AND r.status IS NOT NULL; -- precaver nulos indesejados caso corrompido

  -- 2.1 Timeline de base (venda etc)
  SELECT jsonb_build_object(
    'sale_date', v_main_order.raw_json->>'data_venda',
    'imported_date', v_main_order.created_at,
    'forecast_date', COALESCE(v_main_order.previsao_entrega::text, v_main_order.raw_json->>'previsao_entrega'),
    'assembly_forecast_date', v_main_order.previsao_montagem
  )
  INTO v_delivery_timeline;

  -- 3. Construir Timeline de MONTAGEM (se houver)
  SELECT jsonb_build_object(
      'product_name', ap.product_name,
      'status', ap.status,
      'scheduled_date', ap.assembly_date,
      'completion_date', ap.completion_date,
      'deadline', ar.deadline,
      'route_name', ar.name,
      'route_created_at', ar.created_at
  )
  INTO v_assembly_timeline
  FROM assembly_products ap
  LEFT JOIN assembly_routes ar ON ar.id = ap.assembly_route_id
  WHERE ap.order_id = v_order_id
  ORDER BY ap.created_at DESC
  LIMIT 1;

  -- 4. Verificar Flags de montagem
  IF v_assembly_timeline IS NOT NULL THEN
     v_has_assembly_flag := TRUE;
  ELSE
     -- Usar EXISTS nativo do Postgres em vez de loop lento PL/pgSQL
     IF jsonb_typeof(v_main_order.items_json) = 'array' THEN
         SELECT EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(v_main_order.items_json) AS v_item
            WHERE (v_item->>'has_assembly')::text ILIKE 'Sim'
               OR (v_item->>'has_assembly')::text = '1'
               OR (v_item->>'produto_e_montavel')::text ILIKE 'Sim'
         ) INTO v_has_assembly_flag;
     END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_number', v_main_order.order_id_erp,
    'customer_name', v_main_order.customer_name,
    'city', v_main_order.address_json->>'city',
    'neighborhood', v_main_order.address_json->>'neighborhood',
    'delivery_timeline', v_delivery_timeline,
    'delivery_history', COALESCE(v_delivery_history, '[]'::jsonb),
    'has_assembly', v_has_assembly_flag,
    'assembly_timeline', v_assembly_timeline
  );
END;
$$;


ALTER FUNCTION public.get_order_public(p_order_number text, p_cpf text) OWNER TO postgres;

--
-- Name: get_order_return_capacity_violation(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target_return as (
    select r.id, r.order_id
    from public.order_returns r
    where r.id = p_return_id
  ), target_items as (
    select
      coalesce(ori.order_item_id, by_key.id) as order_item_id,
      max(coalesce(ori.source_item_key, by_key.source_line_key)) as source_item_key,
      sum(ori.returned_quantity) as target_quantity
    from public.order_return_items ori
    join target_return tr on tr.id = ori.return_id
    left join public.order_items by_key
      on by_key.order_id = tr.order_id
     and by_key.source_line_key = ori.source_item_key
    group by coalesce(ori.order_item_id, by_key.id)
  ), other_processed as (
    select
      coalesce(ori.order_item_id, by_key.id) as order_item_id,
      sum(ori.returned_quantity) as returned_quantity
    from public.order_return_items ori
    join public.order_returns r on r.id = ori.return_id
    join target_return tr on tr.order_id = r.order_id
    left join public.order_items by_key
      on by_key.order_id = r.order_id
     and by_key.source_line_key = ori.source_item_key
    where r.id <> p_return_id
      and r.processing_status = 'processed'
    group by coalesce(ori.order_item_id, by_key.id)
  ), violation as (
    select
      oi.id as order_item_id,
      oi.order_id,
      oi.source_line_key,
      oi.product_name,
      oi.purchased_quantity,
      coalesce(op.returned_quantity, 0::numeric) as previously_returned_quantity,
      ti.target_quantity,
      coalesce(op.returned_quantity, 0::numeric) + ti.target_quantity as resulting_returned_quantity
    from target_items ti
    join public.order_items oi on oi.id = ti.order_item_id
    left join other_processed op on op.order_item_id = ti.order_item_id
    where coalesce(op.returned_quantity, 0::numeric) + ti.target_quantity > oi.purchased_quantity
    order by oi.source_line_key
    limit 1
  )
  select case
    when exists (select 1 from violation) then (
      select jsonb_build_object(
        'order_item_id', v.order_item_id,
        'order_id', v.order_id,
        'source_line_key', v.source_line_key,
        'product_name', v.product_name,
        'purchased_quantity', v.purchased_quantity,
        'previously_returned_quantity', v.previously_returned_quantity,
        'event_returned_quantity', v.target_quantity,
        'resulting_returned_quantity', v.resulting_returned_quantity
      )
      from violation v
    )
    else null::jsonb
  end;
$$;


ALTER FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION get_order_return_capacity_violation(p_return_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) IS 'Detecta se um evento faria a devolução acumulada ultrapassar a quantidade comprada.';


--
-- Name: get_product_commitment_report(text, date, date, text[], text[], integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_product_commitment_report(p_search text DEFAULT NULL::text, p_sale_start date DEFAULT NULL::date, p_sale_end date DEFAULT NULL::date, p_situations text[] DEFAULT ARRAY['reserved'::text], p_storage_locations text[] DEFAULT NULL::text[], p_page integer DEFAULT 0, p_page_size integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_result jsonb;
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_page integer := GREATEST(COALESCE(p_page, 0), 0);
  v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
BEGIN
  IF p_sale_start IS NOT NULL AND p_sale_end IS NOT NULL AND p_sale_start > p_sale_end THEN
    RAISE EXCEPTION 'Periodo de venda invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.id = auth.uid()
       AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acesso permitido apenas para administradores';
  END IF;

  WITH expanded AS (
    SELECT
      o.id AS order_id,
      o.order_id_erp,
      o.customer_name,
      o.phone,
      o.data_venda AS sale_date,
      o.previsao_entrega AS forecast_date,
      o.filial_venda AS branch,
      o.vendedor_nome AS seller_name,
      o.address_json->>'city' AS city,
      o.address_json->>'neighborhood' AS neighborhood,
      COALESCE(
        NULLIF(trim(item.value->>'sku'), ''),
        NULLIF(trim(item.value->>'codigo'), ''),
        NULLIF(trim(item.value->>'codigo_produto'), ''),
        'SKU-INDEF'
      ) AS product_sku,
      COALESCE(
        NULLIF(trim(item.value->>'name'), ''),
        NULLIF(trim(item.value->>'produto'), ''),
        NULLIF(trim(item.value->>'descricao'), ''),
        NULLIF(trim(item.value->>'nome_produto'), ''),
        'Produto sem nome'
      ) AS product_name,
      COALESCE(
        NULLIF(trim(item.value->>'location'), ''),
        NULLIF(trim(item.value->>'local_estocagem'), ''),
        'Sem local informado'
      ) AS storage_location,
      CASE
        WHEN COALESCE(item.value->>'purchased_quantity', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'purchased_quantity', ',', '.')::numeric
        WHEN COALESCE(item.value->>'quantidade_comprada', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'quantidade_comprada', ',', '.')::numeric
        WHEN COALESCE(item.value->>'quantity', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'quantity', ',', '.')::numeric
        ELSE 1::numeric
      END AS purchased_quantity,
      CASE
        WHEN COALESCE(item.value->>'unit_price_real', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'unit_price_real', ',', '.')::numeric
        WHEN COALESCE(item.value->>'unit_price', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'unit_price', ',', '.')::numeric
        ELSE NULL::numeric
      END AS unit_price,
      CASE
        WHEN o.status = 'delivered' THEN 'delivered'
        WHEN latest_route.route_status = 'pending' THEN 'separating'
        WHEN latest_route.route_status = 'in_progress'
          AND COALESCE(latest_route.route_order_status, 'pending') = 'pending' THEN 'in_route'
        ELSE 'awaiting_route'
      END AS report_status,
      latest_route.route_id,
      latest_route.route_code,
      latest_route.route_name,
      latest_route.route_status,
      latest_route.driver_name,
      latest_route.delivered_at
    FROM public.orders o
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.items_json, '[]'::jsonb)) AS item(value)
    LEFT JOIN LATERAL (
      SELECT
        r.id AS route_id,
        r.route_code,
        r.name AS route_name,
        r.status AS route_status,
        ro.status AS route_order_status,
        ro.delivered_at,
        du.name AS driver_name
      FROM public.route_orders ro
      JOIN public.routes r ON r.id = ro.route_id
      LEFT JOIN public.drivers d ON d.id = r.driver_id
      LEFT JOIN public.users du ON du.id = d.user_id
      WHERE ro.order_id = o.id
      ORDER BY
        CASE
          WHEN o.status = 'delivered' AND ro.status = 'delivered' THEN 0
          WHEN r.status = 'in_progress' THEN 1
          WHEN r.status = 'pending' THEN 2
          ELSE 3
        END,
        COALESCE(ro.delivered_at, r.completed_at, r.updated_at, r.created_at) DESC
      LIMIT 1
    ) AS latest_route ON true
    WHERE o.status IN ('pending', 'imported', 'assigned', 'delivered')
      AND o.import_source = 'lote'
      AND COALESCE(o.return_flag, false) = false
      AND COALESCE(o.requires_pickup, false) = false
      AND (p_sale_start IS NULL OR o.data_venda::date >= p_sale_start)
      AND (p_sale_end IS NULL OR o.data_venda::date <= p_sale_end)
  ), scoped AS (
    SELECT *
      FROM expanded e
     WHERE (
       v_search IS NULL
       OR e.product_name ILIKE '%' || v_search || '%'
       OR e.product_sku ILIKE '%' || v_search || '%'
     )
       AND (
         p_situations IS NULL
         OR cardinality(p_situations) = 0
         OR ('reserved' = ANY(p_situations) AND e.report_status <> 'delivered')
         OR ('delivered' = ANY(p_situations) AND e.report_status = 'delivered')
       )
  ), filtered AS (
    SELECT *
      FROM scoped s
     WHERE p_storage_locations IS NULL
        OR cardinality(p_storage_locations) = 0
        OR s.storage_location = ANY(p_storage_locations)
  ), summary AS (
    SELECT
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status <> 'delivered'), 0) AS reserved_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'delivered'), 0) AS delivered_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'awaiting_route'), 0) AS awaiting_route_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'separating'), 0) AS separating_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'in_route'), 0) AS in_route_units,
      count(*) AS total_records,
      count(DISTINCT (product_sku, product_name)) AS distinct_products
    FROM filtered
  ), page_rows AS (
    SELECT
      filtered.*,
      sum(purchased_quantity) FILTER (WHERE report_status <> 'delivered') OVER (PARTITION BY product_sku, product_name) AS product_reserved_units,
      sum(purchased_quantity) FILTER (WHERE report_status = 'delivered') OVER (PARTITION BY product_sku, product_name) AS product_delivered_units
      FROM filtered
     ORDER BY product_name, product_sku, sale_date DESC NULLS LAST, order_id_erp
     LIMIT v_page_size
    OFFSET v_page * v_page_size
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM page_rows p), '[]'::jsonb),
    'summary', jsonb_build_object(
      'reserved_units', s.reserved_units,
      'delivered_units', s.delivered_units,
      'awaiting_route_units', s.awaiting_route_units,
      'separating_units', s.separating_units,
      'in_route_units', s.in_route_units,
      'total_records', s.total_records,
      'distinct_products', s.distinct_products,
      'page', v_page,
      'page_size', v_page_size
    )
  )
  INTO v_result
  FROM summary s;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'rows', '[]'::jsonb,
      'summary', jsonb_build_object(
        'reserved_units', 0,
        'delivered_units', 0,
        'awaiting_route_units', 0,
        'separating_units', 0,
        'in_route_units', 0,
        'total_records', 0,
        'distinct_products', 0,
        'page', v_page,
        'page_size', v_page_size
      )
    )
  );
END;
$_$;


ALTER FUNCTION public.get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer) OWNER TO postgres;

--
-- Name: FUNCTION get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer) IS 'Relatorio paginado de unidades compradas reservadas ou entregues, expandido no banco para reduzir egress.';


--
-- Name: get_product_commitment_storage_locations(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_product_commitment_storage_locations() RETURNS text[]
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(array_agg(loc.storage_location ORDER BY loc.storage_location), ARRAY[]::text[])
  FROM (
    SELECT DISTINCT COALESCE(
      NULLIF(trim(item.value->>'location'), ''),
      NULLIF(trim(item.value->>'local_estocagem'), ''),
      'Sem local informado'
    ) AS storage_location
    FROM public.orders o
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.items_json, '[]'::jsonb)) AS item(value)
    WHERE o.import_source = 'lote'
      AND o.status IN ('pending', 'imported', 'assigned', 'delivered')
      AND COALESCE(o.return_flag, false) = false
      AND COALESCE(o.requires_pickup, false) = false
      AND EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role = 'admin'
      )
  ) AS loc;
$$;


ALTER FUNCTION public.get_product_commitment_storage_locations() OWNER TO postgres;

--
-- Name: FUNCTION get_product_commitment_storage_locations(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_product_commitment_storage_locations() IS 'Retorna somente os locais distintos de pedidos em lote para preencher o filtro com baixo egress.';


--
-- Name: get_route_duplicates(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_route_duplicates() RETURNS TABLE(order_id uuid, order_id_erp text, client_name text, route_count bigint, routes_info jsonb[])
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH orders_stats AS (
        SELECT 
            ro.order_id,
            -- Count only "Active/Valid" instances.
            -- Instance is VALID if: 
            -- 1. Route is Active (pending/in_progress/ready)
            -- 2. OR Route is Completed BUT order was NOT returned/skipped (meaning it was delivered or left pending erroneously)
            COUNT(CASE 
                WHEN r.status IN ('pending', 'in_progress', 'ready') THEN 1 
                WHEN r.status = 'completed' AND ro.status NOT IN ('returned', 'skipped') THEN 1
                ELSE NULL 
            END) as conflict_count,
            
            -- Keep track of all routes for display
            ARRAY_AGG(
                jsonb_build_object(
                    'id', r.id, 
                    'name', r.name, 
                    'status', r.status,
                    'order_status', ro.status, -- Include order status in route for UI
                    'created_at', r.created_at
                ) ORDER BY r.created_at DESC
            ) as r_info
        FROM route_orders ro
        JOIN routes r ON ro.route_id = r.id
        WHERE r.status != 'cancelled'
        GROUP BY ro.order_id
    )
    SELECT 
        os.order_id,
        o.order_id_erp,
        o.customer_name as client_name,
        os.conflict_count as route_count,
        os.r_info
    FROM orders_stats os
    JOIN orders o ON os.order_id = o.id
    WHERE os.conflict_count > 1; -- Only show if there are conflicting valid placements
END;
$$;


ALTER FUNCTION public.get_route_duplicates() OWNER TO postgres;

--
-- Name: get_route_start_return_blockers(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_route_start_return_blockers(p_route_id uuid) RETURNS TABLE(order_id uuid, order_id_erp text, blocked_reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    o.id as order_id,
    o.order_id_erp,
    o.blocked_reason
  from public.route_orders ro
  join public.orders o on o.id = ro.order_id
  where ro.route_id = p_route_id
    and exists (
      select 1
      from public.order_item_shadow_balances bal
      where bal.order_id = o.id
        and bal.source_present
        and bal.returned_quantity > 0
    )
    and not exists (
      select 1
      from public.order_item_shadow_balances bal
      where bal.order_id = o.id
        and bal.source_present
        and bal.shadow_deliverable_quantity > 0
    )
  order by ro.sequence, o.order_id_erp;
$$;


ALTER FUNCTION public.get_route_start_return_blockers(p_route_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION get_route_start_return_blockers(p_route_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) IS 'Lista pedidos totalmente devolvidos que precisam sair da rota antes do início.';


--
-- Name: get_users_names_by_ids(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_users_names_by_ids(p_user_ids uuid[]) RETURNS TABLE(id uuid, name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT u.id, u.name
  FROM public.users u
  WHERE u.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
$$;


ALTER FUNCTION public.get_users_names_by_ids(p_user_ids uuid[]) OWNER TO postgres;

--
-- Name: handle_order_return_header_snapshot_refresh(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_order_return_header_snapshot_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;

  if v_order_id is not null then
    perform public.resync_open_route_order_item_snapshots_for_order(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.handle_order_return_header_snapshot_refresh() OWNER TO postgres;

--
-- Name: handle_order_return_item_operational_state_refresh(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_order_return_item_operational_state_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_return_id := old.return_id;
  else
    v_return_id := new.return_id;
  end if;

  if v_return_id is not null then
    select r.order_id
    into v_order_id
    from public.order_returns r
    where r.id = v_return_id;
  end if;

  if v_order_id is not null then
    perform public.sync_order_return_operational_state(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.handle_order_return_item_operational_state_refresh() OWNER TO postgres;

--
-- Name: handle_order_return_item_snapshot_refresh(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_order_return_item_snapshot_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_return_id := old.return_id;
  else
    v_return_id := new.return_id;
  end if;

  if v_return_id is not null then
    select r.order_id
    into v_order_id
    from public.order_returns r
    where r.id = v_return_id;
  end if;

  if v_order_id is not null then
    perform public.resync_open_route_order_item_snapshots_for_order(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.handle_order_return_item_snapshot_refresh() OWNER TO postgres;

--
-- Name: handle_order_return_operational_state_refresh(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_order_return_operational_state_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;

  if v_order_id is not null then
    perform public.sync_order_return_operational_state(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.handle_order_return_operational_state_refresh() OWNER TO postgres;

--
-- Name: insert_vehicle(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.insert_vehicle(p_model text, p_plate text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  vid uuid;
begin
  -- segurança: só admin pode executar
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  ) then
    raise exception 'not allowed';
  end if;

  -- validação simples
  if coalesce(trim(p_model), '') = '' then
    raise exception 'model required';
  end if;
  if coalesce(trim(p_plate), '') = '' then
    raise exception 'plate required';
  end if;

  -- upsert por placa (não cria duplicado)
  insert into public.vehicles (id, model, plate, active)
  values (gen_random_uuid(), trim(p_model), upper(trim(p_plate)), true)
  on conflict (plate)
  do update set model = excluded.model, active = true
  returning id into vid;

  return vid;
end;
$$;


ALTER FUNCTION public.insert_vehicle(p_model text, p_plate text) OWNER TO postgres;

--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  );
$$;


ALTER FUNCTION public.is_admin() OWNER TO postgres;

--
-- Name: is_rural_address(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_rural_address(address_json jsonb) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    keywords JSONB;
    k TEXT;
    addr_text TEXT;
BEGIN
    SELECT value->'keywords' INTO keywords FROM app_settings WHERE key = 'rural_keywords';
    
    IF keywords IS NULL OR jsonb_array_length(keywords) = 0 THEN
        RETURN FALSE;
    END IF;
    
    -- Concatenate relevant address fields for searching (PT and EN keys)
    addr_text := UPPER(
        COALESCE(address_json->>'neighborhood', address_json->>'bairro', '') || ' ' || 
        COALESCE(address_json->>'street', address_json->>'logradouro', '') || ' ' || 
        COALESCE(address_json->>'complement', address_json->>'complemento', '')
    );
    
    FOR k IN SELECT * FROM jsonb_array_elements_text(keywords) LOOP
        IF addr_text LIKE '%' || k || '%' THEN
            RETURN TRUE;
        END IF;
    END LOOP;
    
    RETURN FALSE;
END;
$$;


ALTER FUNCTION public.is_rural_address(address_json jsonb) OWNER TO postgres;

--
-- Name: item_fulfillment_can_manage(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.item_fulfillment_can_manage() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    auth.role() = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
    or exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    );
$$;


ALTER FUNCTION public.item_fulfillment_can_manage() OWNER TO postgres;

--
-- Name: list_drivers(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_drivers() RETURNS TABLE(driver_id uuid, user_id uuid, name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT d.id AS driver_id, d.user_id, u.name
  FROM public.drivers d
  JOIN public.users u ON u.id = d.user_id
  WHERE d.active = true
    AND u.role = 'driver';
$$;


ALTER FUNCTION public.list_drivers() OWNER TO postgres;

--
-- Name: mark_new_user_must_change_password(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mark_new_user_must_change_password() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.must_change_password := true;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.mark_new_user_must_change_password() OWNER TO postgres;

--
-- Name: normalize_store_release_location(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.normalize_store_release_location(p_value text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_raw text;
  v_plain text;
begin
  v_raw := upper(trim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')));

  if v_raw = 'ATACADO LOJA ASSU' then
    return 'ATACADO LOJA ASSU';
  end if;

  if v_raw in (U&'LOJA MOSSOR\00D3', 'LOJA MOSSORO') then
    return 'LOJA MOSSORO';
  end if;

  if v_raw in (U&'LOJA MOSSOR\00D3 PARTAGE', 'LOJA MOSSORO PARTAGE') then
    return 'LOJA MOSSORO PARTAGE';
  end if;

  v_plain := translate(
    v_raw,
    U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
    'AAAAAEEEEIIIIOOOOOUUUUC'
  );

  if v_plain = 'ATACADO LOJA ASSU' then
    return 'ATACADO LOJA ASSU';
  end if;

  if v_plain = 'LOJA MOSSORO' then
    return 'LOJA MOSSORO';
  end if;

  if v_plain = 'LOJA MOSSORO PARTAGE' then
    return 'LOJA MOSSORO PARTAGE';
  end if;

  return v_raw;
end;
$$;


ALTER FUNCTION public.normalize_store_release_location(p_value text) OWNER TO postgres;

--
-- Name: order_item_payload_requires_assembly(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from jsonb_array_elements(
      case
        when p_payload is null then '[]'::jsonb
        when jsonb_typeof(p_payload) = 'array' then p_payload
        else jsonb_build_array(p_payload)
      end
    ) item
    where lower(trim(coalesce(item->>'has_assembly', ''))) in ('sim', 's', 'true', '1', 'yes', 'y')
       or lower(trim(coalesce(item->>'possui_montagem', ''))) in ('sim', 's', 'true', '1', 'yes', 'y')
  );
$$;


ALTER FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) OWNER TO postgres;

--
-- Name: FUNCTION order_item_payload_requires_assembly(p_payload jsonb); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) IS 'Detecta montagem contratada em source_payload de order_items, seja objeto ou array.';


--
-- Name: prevent_collected_return_item_changes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prevent_collected_return_item_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_has_pickup boolean := false;
begin
  v_return_id := case when tg_op = 'DELETE' then old.return_id else new.return_id end;

  select (
    r.pickup_created_at is not null
    or r.pickup_order_id is not null
    or r.pickup_route_id is not null
  )
  into v_has_pickup
  from public.order_returns r
  where r.id = v_return_id;

  if coalesce(v_has_pickup, false) then
    raise exception 'Não é permitido alterar itens de uma devolução que já possui coleta criada';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION public.prevent_collected_return_item_changes() OWNER TO postgres;

--
-- Name: prevent_duplicate_routing(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prevent_duplicate_routing() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    active_route_info text;
    order_erp_id text;
BEGIN
    -- Get Order ERP ID for better error message
    SELECT order_id_erp INTO order_erp_id FROM orders WHERE id = NEW.order_id;

    -- 1. Check if order is already delivered
    IF EXISTS (SELECT 1 FROM orders WHERE id = NEW.order_id AND status = 'delivered') THEN
        RAISE EXCEPTION 'O pedido % já foi entregue e não pode ser roteirizado novamente.', order_erp_id;
    END IF;

    -- 2. Check if order is in another ACTIVE route
    -- Active means: Route is pending/in_progress/ready.
    -- If route is completed, it's only a conflict if the order was NOT returned (i.e. it was delivered or stuck).
    -- But simplify: If it's in an active route, it's blocked.
    SELECT r.name INTO active_route_info
    FROM route_orders ro
    JOIN routes r ON ro.route_id = r.id
    WHERE ro.order_id = NEW.order_id
      AND r.status IN ('pending', 'in_progress', 'ready')
      AND r.id != NEW.route_id
    LIMIT 1;

    IF active_route_info IS NOT NULL THEN
        RAISE EXCEPTION 'O pedido % já está ativo na rota "%". Remova-o da rota anterior antes de adicionar novamente.', order_erp_id, active_route_info;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.prevent_duplicate_routing() OWNER TO postgres;

--
-- Name: prevent_route_start_with_return_blockers(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prevent_route_start_with_return_blockers() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_blocked_orders text;
begin
  if new.status = 'in_progress'
     and old.status is distinct from new.status
     and upper(coalesce(new.name, '')) not like 'COLETA-%' then
    select string_agg(blocker.order_id_erp, ', ' order by blocker.order_id_erp)
    into v_blocked_orders
    from public.get_route_start_return_blockers(new.id) blocker;

    if nullif(v_blocked_orders, '') is not null then
      raise exception 'Rota não pode ser iniciada. Remova os pedidos totalmente devolvidos: %',
        v_blocked_orders;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.prevent_route_start_with_return_blockers() OWNER TO postgres;

--
-- Name: FUNCTION prevent_route_start_with_return_blockers(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.prevent_route_start_with_return_blockers() IS 'Bloqueia no banco o início de rota com pedido sem saldo entregável.';


--
-- Name: reconcile_order_return_state(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reconcile_order_return_state(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_has_processed_return boolean := false;
begin
  if p_order_id is null then
    raise exception 'p_order_id é obrigatório';
  end if;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
  ) into v_has_processed_return;

  if v_has_processed_return then
    return public.sync_order_return_operational_state(p_order_id);
  end if;

  update public.orders
  set
    return_flag = false,
    requires_pickup = false,
    pickup_created_at = null,
    blocked_at = null,
    blocked_reason = null,
    last_return_reason = null,
    last_return_notes = null
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'processed_return', false,
    'requires_pickup', false
  );
end;
$$;


ALTER FUNCTION public.reconcile_order_return_state(p_order_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION reconcile_order_return_state(p_order_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) IS 'Restaura o estado fiscal de devolução após Entregue, Desfazer ou sincronização offline.';


--
-- Name: reconcile_returns_after_route_completion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reconcile_returns_after_route_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    for v_order_id in
      select distinct ro.order_id
      from public.route_orders ro
      where ro.route_id = new.id
    loop
      perform public.reconcile_order_return_state(v_order_id);
    end loop;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.reconcile_returns_after_route_completion() OWNER TO postgres;

--
-- Name: FUNCTION reconcile_returns_after_route_completion(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.reconcile_returns_after_route_completion() IS 'Consolida coletas por evento somente quando a rota possui resultado definitivo.';


--
-- Name: register_order_return_pickup(uuid, uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone DEFAULT timezone('utc'::text, now())) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return record;
  v_pickup_order record;
  v_pickup_route record;
  v_existing_return_id uuid;
  v_pickup_created_at timestamptz;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_return_id is null or p_pickup_order_id is null or p_pickup_route_id is null then
    raise exception 'Evento, pedido de coleta e rota de coleta são obrigatórios';
  end if;

  select r.* into v_return
  from public.order_returns r
  where r.id = p_return_id
  for update;

  if not found then
    raise exception 'Evento de devolução % não encontrado', p_return_id;
  end if;

  -- Repetir exatamente a mesma solicitação é seguro e não cria duplicidade.
  if v_return.pickup_created_at is not null
     and v_return.pickup_order_id = p_pickup_order_id
     and v_return.pickup_route_id = p_pickup_route_id then
    return jsonb_build_object(
      'return_id', p_return_id,
      'order_id', v_return.order_id,
      'pickup_order_id', p_pickup_order_id,
      'pickup_route_id', p_pickup_route_id,
      'pickup_created_at', v_return.pickup_created_at,
      'already_registered', true
    );
  end if;

  if num_nonnulls(v_return.pickup_created_at, v_return.pickup_order_id, v_return.pickup_route_id) > 0 then
    raise exception 'Este evento de devolução já possui outra coleta vinculada';
  end if;

  if v_return.processing_status <> 'processed' then
    raise exception 'Somente devolução processada pode gerar coleta';
  end if;

  if not v_return.requires_pickup then
    raise exception 'Este evento de devolução não está aguardando coleta';
  end if;

  select o.id, o.order_id_erp, o.raw_json into v_pickup_order
  from public.orders o
  where o.id = p_pickup_order_id;

  if not found then
    raise exception 'Pedido de coleta % não encontrado', p_pickup_order_id;
  end if;

  if coalesce(v_pickup_order.raw_json #>> '{pickup_context,source_return_id}', '') <> p_return_id::text
     or coalesce(v_pickup_order.raw_json #>> '{pickup_context,source_order_id}', '') <> v_return.order_id::text then
    raise exception 'O pedido de coleta não pertence a este evento de devolução';
  end if;

  select rt.id, rt.name into v_pickup_route
  from public.routes rt
  where rt.id = p_pickup_route_id;

  if not found then
    raise exception 'Rota de coleta % não encontrada', p_pickup_route_id;
  end if;

  if upper(coalesce(v_pickup_route.name, '')) not like 'COLETA-%' then
    raise exception 'A rota informada não é uma rota de coleta';
  end if;

  if not exists (
    select 1 from public.route_orders ro
    where ro.route_id = p_pickup_route_id
      and ro.order_id = p_pickup_order_id
  ) then
    raise exception 'O pedido de coleta não está vinculado à rota informada';
  end if;

  select r.id into v_existing_return_id
  from public.order_returns r
  where r.id <> p_return_id
    and (r.pickup_order_id = p_pickup_order_id or r.pickup_route_id = p_pickup_route_id)
  limit 1;

  if v_existing_return_id is not null then
    raise exception 'Esta coleta já pertence a outro evento de devolução';
  end if;

  v_pickup_created_at := coalesce(p_pickup_created_at, timezone('utc', now()));

  update public.order_returns
  set pickup_created_at = v_pickup_created_at,
      pickup_order_id = p_pickup_order_id,
      pickup_route_id = p_pickup_route_id
  where id = p_return_id;

  perform public.sync_order_return_operational_state(v_return.order_id);

  return jsonb_build_object(
    'return_id', p_return_id,
    'order_id', v_return.order_id,
    'pickup_order_id', p_pickup_order_id,
    'pickup_route_id', p_pickup_route_id,
    'pickup_created_at', v_pickup_created_at,
    'already_registered', false
  );
end;
$$;


ALTER FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) OWNER TO postgres;

--
-- Name: FUNCTION register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) IS 'Vincula uma coleta exclusivamente ao evento de origem, validando pedido, rota e processamento.';


--
-- Name: resolve_login_email(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resolve_login_email(identifier text) RETURNS TABLE(email text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.email
  from public.users u
  where u.active is distinct from false
    and (
      lower(trim(u.name)) = lower(trim(identifier))
      or lower(trim(u.email)) = lower(trim(identifier))
    )
  order by u.created_at desc nulls last
  limit 1;
$$;


ALTER FUNCTION public.resolve_login_email(identifier text) OWNER TO postgres;

--
-- Name: resync_open_route_order_item_snapshots_for_order(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_route_order_ids uuid[];
begin
  if p_order_id is null then
    return jsonb_build_object(
      'order_id', null,
      'synced_route_orders', 0,
      'synced_items', 0
    );
  end if;

  select coalesce(array_agg(ro.id order by ro.created_at, ro.id), '{}'::uuid[])
  into v_route_order_ids
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and r.status <> 'completed';

  return jsonb_build_object(
    'order_id', p_order_id,
    'result', public.sync_route_order_item_snapshots_system(v_route_order_ids)
  );
end;
$$;


ALTER FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION resync_open_route_order_item_snapshots_for_order(p_order_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) IS 'Recalcula automaticamente as route_orders abertas de um pedido após devoluções parciais/processadas.';


--
-- Name: search_assembly_candidates(text, text[], text[], integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_assembly_candidates(p_search_term text DEFAULT NULL::text, p_city_filter text[] DEFAULT NULL::text[], p_neighborhood_filter text[] DEFAULT NULL::text[], p_page integer DEFAULT 0, p_page_size integer DEFAULT 50) RETURNS TABLE(id uuid, order_id uuid, product_name text, product_sku text, status text, assembly_route_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, was_returned boolean, observations text, returned_at timestamp with time zone, order_data jsonb, total_count bigint)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_search_pattern text;
  v_offset integer;
BEGIN
  v_offset := p_page * p_page_size;
  
  IF p_search_term IS NOT NULL AND p_search_term != '' THEN
    v_search_pattern := '%' || p_search_term || '%';
  END IF;

  RETURN QUERY
  WITH filtered_assembly AS (
    SELECT 
      ap.id,
      ap.order_id,
      ap.product_name,
      ap.product_sku,
      ap.status::text,
      ap.assembly_route_id,
      ap.created_at,
      ap.updated_at,
      ap.was_returned,
      ap.observations,
      ap.returned_at,
      to_jsonb(o) as order_data
    FROM assembly_products ap
    JOIN orders o ON ap.order_id = o.id
    WHERE 
      -- Pending only
      ap.assembly_route_id IS NULL
      AND ap.status = 'pending'
      
      -- Search Term (Checks Order and Product fields)
      AND (
        v_search_pattern IS NULL 
        OR 
        o.customer_name ILIKE v_search_pattern 
        OR 
        o.order_id_erp ILIKE v_search_pattern 
        OR 
        ap.product_name ILIKE v_search_pattern
        OR
        ap.product_sku ILIKE v_search_pattern
      )
      
      -- City Filter (on Order)
      AND (
        p_city_filter IS NULL 
        OR 
        (o.address_json->>'city')::text = ANY(p_city_filter)
      )
      
      -- Neighborhood Filter (on Order)
      AND (
        p_neighborhood_filter IS NULL 
        OR 
        (o.address_json->>'neighborhood')::text = ANY(p_neighborhood_filter)
      )
  )
  SELECT 
    f.id,
    f.order_id,
    f.product_name,
    f.product_sku,
    f.status,
    f.assembly_route_id,
    f.created_at,
    f.updated_at,
    f.was_returned,
    f.observations,
    f.returned_at,
    f.order_data,
    (SELECT count(*) FROM filtered_assembly)::bigint as total_count
  FROM filtered_assembly f
  ORDER BY f.created_at DESC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;


ALTER FUNCTION public.search_assembly_candidates(p_search_term text, p_city_filter text[], p_neighborhood_filter text[], p_page integer, p_page_size integer) OWNER TO postgres;

--
-- Name: search_delivery_candidates(text, text[], text[], text[], text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_delivery_candidates(p_search_term text DEFAULT NULL::text, p_status_filter text[] DEFAULT NULL::text[], p_city_filter text[] DEFAULT NULL::text[], p_neighborhood_filter text[] DEFAULT NULL::text[], p_date_start text DEFAULT NULL::text, p_date_end text DEFAULT NULL::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 50) RETURNS TABLE(id uuid, order_id_erp text, customer_name text, phone text, address_json jsonb, items_json jsonb, status text, raw_json jsonb, return_flag boolean, last_return_reason text, created_at timestamp with time zone, updated_at timestamp with time zone, total_count bigint)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_search_pattern text;
  v_offset integer;
BEGIN
  v_offset := p_page * p_page_size;
  
  IF p_search_term IS NOT NULL AND p_search_term != '' THEN
    v_search_pattern := '%' || p_search_term || '%';
  END IF;

  RETURN QUERY
  WITH filtered_orders AS (
    SELECT 
      o.id,
      o.order_id_erp,
      o.customer_name,
      o.phone,
      o.address_json,
      o.items_json,
      o.status::text,
      o.raw_json,
      o.return_flag,
      o.last_return_reason,
      o.created_at,
      o.updated_at
    FROM orders o
    WHERE 
      -- Basic Status Filter (Pending/Returned/Assigned)
      (
        p_status_filter IS NULL 
        OR 
        o.status::text = ANY(p_status_filter)
      )
      -- Exclude blocked orders
      AND o.blocked_at IS NULL
      
      -- Search Term Filter
      AND (
        v_search_pattern IS NULL 
        OR 
        o.customer_name ILIKE v_search_pattern 
        OR 
        o.order_id_erp ILIKE v_search_pattern 
        OR 
        (o.address_json->>'city')::text ILIKE v_search_pattern 
        OR 
        (o.address_json->>'neighborhood')::text ILIKE v_search_pattern
      )
      
      -- City Filter
      AND (
        p_city_filter IS NULL 
        OR 
        (o.address_json->>'city')::text = ANY(p_city_filter)
      )
      
      -- Neighborhood Filter
      AND (
        p_neighborhood_filter IS NULL 
        OR 
        (o.address_json->>'neighborhood')::text = ANY(p_neighborhood_filter)
      )
      
      -- Date Range Filter (Created At or Sale Date?)
      -- Usually Delivery checks Created At or Data Venda. Let's assume Created At for backlog.
      AND (
        p_date_start IS NULL 
        OR 
        o.created_at >= p_date_start::timestamptz
      )
      AND (
        p_date_end IS NULL 
        OR 
        o.created_at <= p_date_end::timestamptz
      )
  )
  SELECT 
    f.*,
    (SELECT count(*) FROM filtered_orders)::bigint as total_count
  FROM filtered_orders f
  ORDER BY f.created_at DESC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;


ALTER FUNCTION public.search_delivery_candidates(p_search_term text, p_status_filter text[], p_city_filter text[], p_neighborhood_filter text[], p_date_start text, p_date_end text, p_page integer, p_page_size integer) OWNER TO postgres;

--
-- Name: set_carrier_cities_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_carrier_cities_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;


ALTER FUNCTION public.set_carrier_cities_updated_at() OWNER TO postgres;

--
-- Name: set_delivery_route_catalog_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_delivery_route_catalog_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;


ALTER FUNCTION public.set_delivery_route_catalog_updated_at() OWNER TO postgres;

--
-- Name: set_fleet_vehicle_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_fleet_vehicle_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;


ALTER FUNCTION public.set_fleet_vehicle_updated_at() OWNER TO postgres;

--
-- Name: set_mdfe_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_mdfe_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;


ALTER FUNCTION public.set_mdfe_updated_at() OWNER TO postgres;

--
-- Name: set_order_withdrawals_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_order_withdrawals_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;


ALTER FUNCTION public.set_order_withdrawals_updated_at() OWNER TO postgres;

--
-- Name: set_store_release_assignment(uuid, text, boolean, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_store_release_assignment(p_order_id uuid, p_store_location text, p_released boolean, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_location text := public.normalize_store_release_location(p_store_location);
begin
  if v_user_id is null then
    raise exception 'Usuario autenticado obrigatorio';
  end if;

  select u.role
    into v_user_role
  from public.users u
  where u.id = v_user_id;

  if v_user_role is distinct from 'gerente' then
    raise exception 'Somente gerente pode liberar saida de loja';
  end if;

  if not exists (
    select 1
    from public.user_store_release_locations usrl
    where usrl.user_id = v_user_id
      and usrl.store_location = v_location
  ) then
    raise exception 'Gerente sem permissao para o local %', v_location;
  end if;

  if not exists (
    select 1
    from public.store_release_assignments sra
    where sra.order_id = p_order_id
      and sra.store_location = v_location
  ) then
    raise exception 'Pendencia nao encontrada para o local %', v_location;
  end if;

  update public.store_release_assignments
     set status = case when p_released then 'released' else 'pending' end,
         released_at = case when p_released then timezone('utc'::text, now()) else null end,
         released_by_user_id = case when p_released then v_user_id else null end,
         release_notes = nullif(trim(coalesce(p_notes, '')), '')
   where order_id = p_order_id
     and store_location = v_location;

  insert into public.store_release_history (
    order_id,
    store_location,
    action,
    notes,
    acted_by_user_id
  ) values (
    p_order_id,
    v_location,
    case when p_released then 'released' else 'reverted' end,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  );

  perform public.sync_store_release_for_order(p_order_id);

  return jsonb_build_object(
    'order_id', p_order_id,
    'store_location', v_location,
    'released', p_released
  );
end;
$$;


ALTER FUNCTION public.set_store_release_assignment(p_order_id uuid, p_store_location text, p_released boolean, p_notes text) OWNER TO postgres;

--
-- Name: set_store_release_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_store_release_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;


ALTER FUNCTION public.set_store_release_updated_at() OWNER TO postgres;

--
-- Name: simulate_order_return_for_testing(uuid, text, text, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone DEFAULT timezone('utc'::text, now())) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_return_id uuid;
  v_return_type text;
  v_selected_count integer := 0;
  v_selected_total numeric := 0;
  v_remaining_after numeric := 0;
  v_item record;
  v_payload_item jsonb;
  v_requested_quantity numeric;
  v_available_quantity numeric;
  v_external_key text;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_order_id is null then
    raise exception 'Pedido é obrigatório';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item para devolução';
  end if;

  select o.id, o.order_id_erp
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % não encontrado', p_order_id;
  end if;

  for v_payload_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_requested_quantity := nullif(trim(coalesce(v_payload_item->>'returned_quantity', '')), '')::numeric;

    if v_requested_quantity is null or v_requested_quantity <= 0 then
      raise exception 'Quantidade devolvida inválida no payload informado';
    end if;

    select
      bal.order_item_id,
      bal.source_line_key,
      bal.sku,
      bal.product_name,
      bal.purchased_quantity,
      bal.returned_quantity,
      greatest(bal.purchased_quantity - bal.returned_quantity, 0::numeric) as available_quantity
    into v_item
    from public.order_item_shadow_balances bal
    where bal.order_id = p_order_id
      and bal.order_item_id = nullif(v_payload_item->>'order_item_id', '')::uuid;

    if not found then
      raise exception 'Item % não encontrado para o pedido %',
        coalesce(v_payload_item->>'order_item_id', '?'),
        v_order.order_id_erp;
    end if;

    v_available_quantity := coalesce(v_item.available_quantity, 0::numeric);

    if v_requested_quantity > v_available_quantity then
      raise exception 'Quantidade solicitada para % excede o saldo disponível (%).',
        v_item.product_name,
        v_available_quantity;
    end if;

    v_selected_count := v_selected_count + 1;
    v_selected_total := v_selected_total + v_requested_quantity;
  end loop;

  with remaining_after as (
    select
      greatest(
        bal.purchased_quantity
        - bal.returned_quantity
        - coalesce(sel.selected_quantity, 0::numeric),
        0::numeric
      ) as deliverable_after
    from public.order_item_shadow_balances bal
    left join (
      select
        nullif(value->>'order_item_id', '')::uuid as order_item_id,
        sum((value->>'returned_quantity')::numeric) as selected_quantity
      from jsonb_array_elements(p_items)
      group by 1
    ) sel on sel.order_item_id = bal.order_item_id
    where bal.order_id = p_order_id
      and bal.source_present
  )
  select coalesce(sum(deliverable_after), 0::numeric)
  into v_remaining_after
  from remaining_after;

  v_return_type := case when v_remaining_after <= 0 then 'total' else 'partial' end;
  v_external_key := 'temp-return-' || v_order.order_id_erp || '-' || extract(epoch from clock_timestamp())::bigint::text;

  insert into public.order_returns (
    order_id,
    external_key,
    return_nfe_number,
    return_date,
    return_type,
    reason,
    processing_status
  ) values (
    p_order_id,
    v_external_key,
    nullif(trim(coalesce(p_return_nfe_number, '')), ''),
    coalesce(p_return_date, timezone('utc', now())),
    v_return_type,
    nullif(trim(coalesce(p_reason, '')), ''),
    'processed'
  )
  returning id into v_return_id;

  for v_payload_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_requested_quantity := (v_payload_item->>'returned_quantity')::numeric;

    select
      oi.id as order_item_id,
      oi.source_line_key,
      oi.sku,
      oi.product_name
    into v_item
    from public.order_items oi
    where oi.id = nullif(v_payload_item->>'order_item_id', '')::uuid
      and oi.order_id = p_order_id;

    insert into public.order_return_items (
      return_id,
      order_item_id,
      source_item_key,
      sku_snapshot,
      product_name_snapshot,
      returned_quantity
    ) values (
      v_return_id,
      v_item.order_item_id,
      v_item.source_line_key,
      v_item.sku,
      v_item.product_name,
      v_requested_quantity
    );
  end loop;

  perform public.sync_order_return_operational_state(p_order_id);

  return jsonb_build_object(
    'return_id', v_return_id,
    'order_id', p_order_id,
    'order_id_erp', v_order.order_id_erp,
    'return_type', v_return_type,
    'selected_items', v_selected_count,
    'selected_quantity', v_selected_total
  );
end;
$$;


ALTER FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) OWNER TO postgres;

--
-- Name: FUNCTION simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) IS 'RPC temporária para simular devolução de teste via tela admin, respeitando estrutura real de order_returns/order_return_items.';


--
-- Name: start_fleet_inspection(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.start_fleet_inspection(p_inspection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.start_fleet_inspection(p_inspection_id uuid) OWNER TO postgres;

--
-- Name: store_release_is_truthy(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.store_release_is_truthy(p_value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select lower(trim(coalesce(p_value, ''))) = any (array['sim', 's', 'true', '1', 'yes', 'y']);
$$;


ALTER FUNCTION public.store_release_is_truthy(p_value text) OWNER TO postgres;

--
-- Name: store_release_location_is_controlled(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.store_release_location_is_controlled(p_value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select public.normalize_store_release_location(p_value) = any (
    array[
      'ATACADO LOJA ASSU',
      'LOJA MOSSORO',
      'LOJA MOSSORO PARTAGE'
    ]
  );
$$;


ALTER FUNCTION public.store_release_location_is_controlled(p_value text) OWNER TO postgres;

--
-- Name: submit_fleet_inspection(uuid, bigint, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) RETURNS uuid
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


ALTER FUNCTION public.submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) OWNER TO postgres;

--
-- Name: sync_all_order_items_shadow(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_all_order_items_shadow(p_limit integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_orders integer := 0;
  v_items integer := 0;
  v_result jsonb;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_limit is null then
    for v_order in
      select o.id
      from public.orders o
      order by o.created_at, o.id
    loop
      v_result := public.sync_order_items_shadow(v_order.id);
      v_orders := v_orders + 1;
      v_items := v_items + coalesce((v_result->>'synced_items')::integer, 0);
    end loop;
  else
    for v_order in
      select o.id
      from public.orders o
      order by o.created_at, o.id
      limit greatest(p_limit, 0)
    loop
      v_result := public.sync_order_items_shadow(v_order.id);
      v_orders := v_orders + 1;
      v_items := v_items + coalesce((v_result->>'synced_items')::integer, 0);
    end loop;
  end if;

  return jsonb_build_object(
    'synced_orders', v_orders,
    'synced_items', v_items
  );
end;
$$;


ALTER FUNCTION public.sync_all_order_items_shadow(p_limit integer) OWNER TO postgres;

--
-- Name: sync_assembly_products_with_returns(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted integer := 0;
  v_inserted integer := 0;
  v_route_result jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('order_id', null, 'deleted_products', 0, 'inserted_products', 0);
  end if;

  with target_counts as (
    select
      oi.order_id,
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::integer as target_count
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by oi.order_id, coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
  ), assembly_counts as (
    select
      ap.order_id,
      coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF') as product_sku,
      count(*)::integer as current_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
    group by ap.order_id, coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
  ), sku_deltas as (
    select
      ac.order_id,
      ac.product_sku,
      greatest(ac.current_count - coalesce(tc.target_count, 0), 0) as extra_count
    from assembly_counts ac
    left join target_counts tc
      on tc.order_id = ac.order_id
     and tc.product_sku = ac.product_sku
    where ac.current_count > coalesce(tc.target_count, 0)
  ), ranked_products as (
    select
      ap.id,
      row_number() over (
        partition by ap.order_id, coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
        order by
          case when ap.assembly_route_id is null then 0 else 1 end,
          case ap.status
            when 'pending' then 0
            when 'assigned' then 1
            when 'in_progress' then 2
            when 'completed' then 3
            when 'cancelled' then 4
            else 5
          end,
          ap.created_at desc,
          ap.id desc
      ) as rn,
      sd.extra_count
    from public.assembly_products ap
    join sku_deltas sd
      on sd.order_id = ap.order_id
     and sd.product_sku = coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
    where ap.order_id = p_order_id
  ), deleted as (
    delete from public.assembly_products ap
    using ranked_products rp
    where ap.id = rp.id
      and rp.rn <= rp.extra_count
    returning ap.id
  )
  select count(*)::integer into v_deleted from deleted;

  begin
    v_route_result := public.sync_missing_assembly_products_for_order(p_order_id);
    v_inserted := coalesce((v_route_result->>'inserted_products')::integer, 0);
  exception when others then
    v_inserted := 0;
  end;

  return jsonb_build_object(
    'order_id', p_order_id,
    'deleted_products', coalesce(v_deleted, 0),
    'inserted_products', coalesce(v_inserted, 0)
  );
end;
$$;


ALTER FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION sync_assembly_products_with_returns(p_order_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) IS 'Reconcila assembly_products com o saldo realmente entregável após devoluções por item.';


--
-- Name: sync_missing_assembly_products_for_order(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_latest_route_status text;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select o.id, o.status, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Pedido % precisa estar delivered para sincronizar montagem. Status atual: %', p_order_id, v_order.status;
  end if;

  select r.status
  into v_latest_route_status
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and upper(coalesce(r.name, '')) not like 'COLETA-%'
  order by coalesce(r.updated_at, r.created_at) desc
  limit 1;

  if v_latest_route_status is null or v_latest_route_status <> 'completed' then
    raise exception 'Pedido % ainda nao pertence a uma rota finalizada. Status da ultima rota: %',
      p_order_id, coalesce(v_latest_route_status, 'sem rota');
  end if;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku;

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id,
          product_name,
          product_sku,
          customer_name,
          customer_phone,
          installation_address,
          status,
          created_at,
          updated_at
        ) values (
          p_order_id,
          v_target_item.product_name,
          v_target_item.product_sku,
          v_order.customer_name,
          v_order.phone,
          v_order.address_json,
          'pending',
          timezone('utc', now()),
          timezone('utc', now())
        );
      end loop;

      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$$;


ALTER FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) OWNER TO postgres;

--
-- Name: sync_missing_assembly_products_for_pickup(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select o.id, o.status, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Pedido % precisa estar delivered para sincronizar montagem da retirada. Status atual: %', p_order_id, v_order.status;
  end if;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku;

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id,
          product_name,
          product_sku,
          customer_name,
          customer_phone,
          installation_address,
          status,
          created_at,
          updated_at
        ) values (
          p_order_id,
          v_target_item.product_name,
          v_target_item.product_sku,
          v_order.customer_name,
          v_order.phone,
          v_order.address_json,
          'pending',
          timezone('utc', now()),
          timezone('utc', now())
        );
      end loop;

      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$$;


ALTER FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) OWNER TO postgres;

--
-- Name: sync_missing_assembly_products_for_route(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_missing_assembly_products_for_route(p_route_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_route_status text;
    v_route_order record;
    v_delivered_orders int := 0;
    v_eligible_orders int := 0;
    v_inserted_products int := 0;
    v_order_result jsonb;
    v_order_inserted int;
    v_order_has_eligible_items boolean;
    v_item jsonb;
BEGIN
    IF p_route_id IS NULL THEN
        RAISE EXCEPTION 'route_id e obrigatorio';
    END IF;

    SELECT status
      INTO v_route_status
      FROM public.routes
     WHERE id = p_route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rota % nao encontrada', p_route_id;
    END IF;

    IF v_route_status <> 'completed' THEN
        RAISE EXCEPTION 'A rota % precisa estar completed para sincronizar montagem. Status atual: %', p_route_id, v_route_status;
    END IF;

    FOR v_route_order IN
        SELECT
            ro.order_id,
            o.items_json
        FROM public.route_orders ro
        JOIN public.orders o
          ON o.id = ro.order_id
       WHERE ro.route_id = p_route_id
         AND ro.status = 'delivered'
         AND o.status = 'delivered'
    LOOP
        v_delivered_orders := v_delivered_orders + 1;
        v_order_has_eligible_items := false;

        IF v_route_order.items_json IS NOT NULL AND jsonb_typeof(v_route_order.items_json) = 'array' THEN
            FOR v_item IN
                SELECT * FROM jsonb_array_elements(v_route_order.items_json)
            LOOP
                IF lower(trim(COALESCE(v_item->>'has_assembly', ''))) IN ('sim', 's', 'true', '1', 'yes', 'y')
                   OR lower(trim(COALESCE(v_item->>'possui_montagem', ''))) IN ('sim', 's', 'true', '1', 'yes', 'y') THEN
                    v_order_has_eligible_items := true;
                    EXIT;
                END IF;
            END LOOP;
        END IF;

        IF NOT v_order_has_eligible_items THEN
            CONTINUE;
        END IF;

        v_eligible_orders := v_eligible_orders + 1;
        v_order_result := public.sync_missing_assembly_products_for_order(v_route_order.order_id);
        v_order_inserted := COALESCE((v_order_result->>'inserted_products')::int, 0);
        v_inserted_products := v_inserted_products + v_order_inserted;
    END LOOP;

    RETURN jsonb_build_object(
        'route_id', p_route_id,
        'delivered_orders', v_delivered_orders,
        'eligible_orders', v_eligible_orders,
        'inserted_products', v_inserted_products
    );
END;
$$;


ALTER FUNCTION public.sync_missing_assembly_products_for_route(p_route_id uuid) OWNER TO postgres;

--
-- Name: sync_order_items_shadow(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_order_items_shadow(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_items jsonb;
  v_synced integer := 0;
  v_missing integer := 0;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  select o.items_json into v_items
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % não encontrado', p_order_id;
  end if;

  update public.order_items
  set source_present = false,
      source_synced_at = timezone('utc', now())
  where order_id = p_order_id;

  if v_items is not null and jsonb_typeof(v_items) = 'array' then
    with raw_items as (
      select value as item, ordinality
      from jsonb_array_elements(v_items) with ordinality
    ), normalized as (
      select
        item,
        ordinality,
        nullif(trim(coalesce(item->>'sku', item->>'codigo', item->>'codigo_produto', '')), '') as sku,
        coalesce(
          nullif(trim(item->>'name'), ''),
          nullif(trim(item->>'produto'), ''),
          nullif(trim(item->>'descricao'), ''),
          nullif(trim(item->>'nome_produto'), ''),
          'Produto sem nome'
        ) as product_name,
        nullif(trim(coalesce(item->>'location', item->>'local_estocagem', '')), '') as storage_location,
        nullif(trim(coalesce(item->>'codigo_kit_pai', '')), '') as kit_code,
        greatest(
          coalesce(
            case when coalesce(item->>'purchased_quantity', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'purchased_quantity', ',', '.')::numeric end,
            case when coalesce(item->>'quantidade_comprada', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'quantidade_comprada', ',', '.')::numeric end,
            1::numeric
          ),
          0.001::numeric
        ) as purchased_quantity,
        greatest(
          coalesce(
            case when coalesce(item->>'quantity', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'quantity', ',', '.')::numeric end,
            case when coalesce(item->>'volumes_per_unit', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'volumes_per_unit', ',', '.')::numeric end,
            0::numeric
          ),
          0::numeric
        ) as volume_quantity
      from raw_items
    ), keyed as (
      select
        *,
        case
          when sku is null and storage_location is null and kit_code is null then
            'line:' || ordinality::text
          else
            'item:' || md5(
              lower(coalesce(sku, '')) || '|' ||
              lower(coalesce(storage_location, '')) || '|' ||
              lower(coalesce(kit_code, ''))
            )
        end as source_line_key
      from normalized
    ), grouped as (
      select
        source_line_key,
        max(sku) as sku,
        max(product_name) as product_name,
        sum(purchased_quantity) as purchased_quantity,
        sum(volume_quantity) as volume_quantity,
        max(storage_location) as storage_location,
        max(kit_code) as kit_code,
        jsonb_agg(item order by ordinality) as source_payload
      from keyed
      group by source_line_key
    ), upserted as (
      insert into public.order_items (
        order_id,
        source_line_key,
        sku,
        product_name,
        purchased_quantity,
        volume_quantity,
        storage_location,
        kit_code,
        source_payload,
        source_present,
        source_synced_at
      )
      select
        p_order_id,
        source_line_key,
        sku,
        product_name,
        purchased_quantity,
        volume_quantity,
        storage_location,
        kit_code,
        source_payload,
        true,
        timezone('utc', now())
      from grouped
      on conflict (order_id, source_line_key) do update set
        sku = excluded.sku,
        product_name = excluded.product_name,
        purchased_quantity = excluded.purchased_quantity,
        volume_quantity = excluded.volume_quantity,
        storage_location = excluded.storage_location,
        kit_code = excluded.kit_code,
        source_payload = excluded.source_payload,
        source_present = true,
        source_synced_at = excluded.source_synced_at
      returning id
    )
    select count(*) into v_synced from upserted;
  end if;

  select count(*) into v_missing
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.source_present = false;

  if v_missing > 0 then
    insert into public.item_fulfillment_sync_issues (
      order_id,
      issue_type,
      issue_key,
      details
    ) values (
      p_order_id,
      'source_items_missing',
      'missing:' || p_order_id::text,
      jsonb_build_object('missing_count', v_missing)
    )
    on conflict (order_id, issue_type, issue_key) do update set
      details = excluded.details,
      status = 'open',
      detected_at = timezone('utc', now()),
      resolved_at = null,
      resolved_by = null;
  else
    update public.item_fulfillment_sync_issues
    set status = 'resolved',
        resolved_at = timezone('utc', now())
    where order_id = p_order_id
      and issue_type = 'source_items_missing'
      and status = 'open';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'synced_items', v_synced,
    'missing_source_items', v_missing
  );
end;
$_$;


ALTER FUNCTION public.sync_order_items_shadow(p_order_id uuid) OWNER TO postgres;

--
-- Name: sync_order_return_operational_state(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_order_return_operational_state(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_latest_return record;
  v_has_processed_return boolean := false;
  v_has_open_delivery_route boolean := false;
  v_has_completed_delivery boolean := false;
  v_total_items integer := 0;
  v_returned_items integer := 0;
  v_fully_returned_items integer := 0;
  v_is_total_return boolean := false;
  v_any_return_requires_pickup boolean := false;
  v_has_pending_pickup_return boolean := false;
  v_last_pickup_created_at timestamptz;
  v_reason text;
  v_blocked_reason text;
  v_effective_return_type text;
  v_assembly_sync_result jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('order_id', null, 'processed_return', false, 'requires_pickup', false);
  end if;

  select
    o.id, o.status, o.blocked_at, o.blocked_reason,
    o.last_return_reason, o.last_return_notes,
    o.return_nfe_number, o.return_nfe_key, o.return_type, o.return_date
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return jsonb_build_object('order_id', p_order_id, 'processed_return', false, 'requires_pickup', false, 'order_found', false);
  end if;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
  ) into v_has_processed_return;

  if not v_has_processed_return then
    return jsonb_build_object('order_id', p_order_id, 'processed_return', false, 'requires_pickup', false, 'order_found', true);
  end if;

  select r.id, r.return_nfe_number, r.return_nfe_key, r.return_date,
         r.return_type, r.return_xml, r.reason, r.processing_notes
  into v_latest_return
  from public.order_returns r
  where r.order_id = p_order_id
    and r.processing_status = 'processed'
  order by coalesce(r.return_date, r.updated_at, r.created_at) desc,
    r.updated_at desc, r.created_at desc, r.id desc
  limit 1;

  select exists (
    select 1
    from public.route_orders ro
    join public.routes rt on rt.id = ro.route_id
    where ro.order_id = p_order_id
      and rt.status <> 'completed'
      and upper(coalesce(rt.name, '')) not like 'COLETA-%'
  ) into v_has_open_delivery_route;

  select exists (
    select 1
    from public.route_orders ro
    join public.routes rt on rt.id = ro.route_id
    where ro.order_id = p_order_id
      and ro.status = 'delivered'
      and rt.status = 'completed'
      and upper(coalesce(rt.name, '')) not like 'COLETA-%'
  ) into v_has_completed_delivery;

  select
    count(*),
    count(*) filter (where coalesce(bal.returned_quantity, 0) > 0),
    count(*) filter (
      where coalesce(bal.returned_quantity, 0) >= coalesce(bal.purchased_quantity, 0)
        and coalesce(bal.purchased_quantity, 0) > 0
    )
  into v_total_items, v_returned_items, v_fully_returned_items
  from public.order_item_shadow_balances bal
  where bal.order_id = p_order_id
    and bal.source_present;

  v_is_total_return := (
    v_total_items > 0
    and v_returned_items > 0
    and v_fully_returned_items = v_total_items
  );

  update public.order_returns r
  set requires_pickup = (
    r.processing_status = 'processed'
    and (
      (r.pickup_created_at is not null and r.pickup_order_id is not null and r.pickup_route_id is not null)
      or (
        not exists (
          select 1
          from public.route_orders open_ro
          join public.routes open_rt on open_rt.id = open_ro.route_id
          where open_ro.order_id = r.order_id
            and open_rt.status <> 'completed'
            and upper(coalesce(open_rt.name, '')) not like 'COLETA-%'
            and open_ro.created_at <= coalesce(r.return_date, r.created_at)
        )
        and exists (
          select 1
          from public.route_orders delivered_ro
          join public.routes delivered_rt on delivered_rt.id = delivered_ro.route_id
          where delivered_ro.order_id = r.order_id
            and delivered_ro.status = 'delivered'
            and delivered_rt.status = 'completed'
            and upper(coalesce(delivered_rt.name, '')) not like 'COLETA-%'
            and delivered_ro.created_at <= coalesce(r.return_date, r.created_at)
            and (
              (
                delivered_ro.delivered_at is not null
                and delivered_ro.delivered_at <= coalesce(r.return_date, r.created_at)
              )
              or not exists (
                select 1
                from public.route_order_items legacy_roi
                where legacy_roi.route_order_id = delivered_ro.id
              )
              or (
                delivered_ro.delivered_at is null
                and exists (
                  select 1
                  from public.order_return_items ori
                  join public.route_order_items delivered_roi
                    on delivered_roi.route_order_id = delivered_ro.id
                   and (
                     (ori.order_item_id is not null and delivered_roi.order_item_id = ori.order_item_id)
                     or delivered_roi.source_line_key = ori.source_item_key
                   )
                  where ori.return_id = r.id
                    and (
                      delivered_roi.status = 'delivered'
                      or delivered_roi.delivered_quantity > 0
                    )
                )
              )
            )
        )
      )
    )
  )
  where r.order_id = p_order_id;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
      and r.requires_pickup
  ) into v_any_return_requires_pickup;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
      and r.requires_pickup
      and r.pickup_created_at is null
  ) into v_has_pending_pickup_return;

  select max(r.pickup_created_at)
  into v_last_pickup_created_at
  from public.order_returns r
  where r.order_id = p_order_id
    and r.processing_status = 'processed'
    and r.pickup_created_at is not null;

  v_reason := coalesce(
    nullif(trim(coalesce(v_latest_return.reason, '')), ''),
    nullif(trim(coalesce(v_order.last_return_reason, '')), ''),
    case when v_is_total_return then 'Devolução total' else 'Devolução parcial' end
  );

  v_effective_return_type := coalesce(
    nullif(trim(coalesce(v_latest_return.return_type, '')), ''),
    case when v_is_total_return then 'total' else 'partial' end
  );

  v_blocked_reason := case
    when v_has_pending_pickup_return and v_is_total_return then 'Devolução total após entrega - aguardando coleta'
    when v_has_pending_pickup_return and not v_is_total_return then 'Devolução parcial após entrega - aguardando coleta'
    when v_any_return_requires_pickup and v_is_total_return then 'Devolução total após entrega - coleta gerada'
    when v_any_return_requires_pickup and not v_is_total_return then 'Devolução parcial após entrega - coleta gerada'
    when v_is_total_return then 'Devolução total registrada no ERP'
    else 'Devolução parcial registrada no ERP'
  end;

  update public.orders
  set
    return_flag = true,
    requires_pickup = v_has_pending_pickup_return,
    pickup_created_at = case when v_has_pending_pickup_return then null else v_last_pickup_created_at end,
    blocked_at = coalesce(v_latest_return.return_date, blocked_at, timezone('utc', now())),
    blocked_reason = v_blocked_reason,
    last_return_reason = v_reason,
    last_return_notes = coalesce(nullif(trim(coalesce(v_latest_return.processing_notes, '')), ''), last_return_notes),
    return_nfe_number = coalesce(nullif(trim(coalesce(v_latest_return.return_nfe_number, '')), ''), return_nfe_number),
    return_nfe_key = coalesce(nullif(trim(coalesce(v_latest_return.return_nfe_key, '')), ''), return_nfe_key),
    return_nfe_xml = coalesce(nullif(coalesce(v_latest_return.return_xml, ''), ''), return_nfe_xml),
    return_date = coalesce(v_latest_return.return_date, return_date),
    return_type = coalesce(v_effective_return_type, return_type)
  where id = p_order_id;

  v_assembly_sync_result := public.sync_assembly_products_with_returns(p_order_id);

  return jsonb_build_object(
    'order_id', p_order_id,
    'processed_return', true,
    'has_open_delivery_route', v_has_open_delivery_route,
    'has_completed_delivery', v_has_completed_delivery,
    'is_total_return', v_is_total_return,
    'requires_pickup', v_has_pending_pickup_return,
    'returned_items', v_returned_items,
    'total_items', v_total_items,
    'assembly_deleted_products', coalesce((v_assembly_sync_result->>'deleted_products')::integer, 0),
    'assembly_inserted_products', coalesce((v_assembly_sync_result->>'inserted_products')::integer, 0)
  );
end;
$$;


ALTER FUNCTION public.sync_order_return_operational_state(p_order_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION sync_order_return_operational_state(p_order_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) IS 'Sincroniza flags operacionais do pedido original a partir das devoluções processadas, cobrindo cenários totais e parciais.';


--
-- Name: sync_order_status_from_route(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_order_status_from_route() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    -- CENÁRIO 1: Motorista marcou ENTREGUE
    -- Ação: Atualizar pedido para 'delivered' imediatamente (não deixa roteirizar de novo)
    IF NEW.status = 'delivered' THEN
        UPDATE orders 
        SET status = 'delivered', return_flag = false 
        WHERE id = NEW.order_id;
    
    -- CENÁRIO 2: Motorista DESFEZ a entrega (Voltou para Pendente na rota)
    -- Ação: Voltar pedido para 'assigned' (Em Rota). Mantém travado na rota dele.
    ELSIF NEW.status = 'pending' AND OLD.status = 'delivered' THEN
        UPDATE orders 
        SET status = 'assigned' 
        WHERE id = NEW.order_id;

    -- CENÁRIO 3: Motorista marcou RETORNADO
    -- Ação: Apenas marca a FLAG de retorno, mas status continua 'assigned' (travado).
    -- Regra do Usuário: Só libera para roteirizar (pending) na finalização da rota.
    ELSIF NEW.status = 'returned' THEN
        UPDATE orders 
        SET status = 'assigned', -- Garante que continua travado
            return_flag = true, 
            last_return_reason = NEW.return_reason 
        WHERE id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.sync_order_status_from_route() OWNER TO postgres;

--
-- Name: sync_route_order_item_snapshots_bulk(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_route_order record;
  v_route_orders integer := 0;
  v_items integer := 0;
  v_inserted_count integer := 0;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_route_order_ids is null or coalesce(array_length(p_route_order_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'synced_route_orders', 0,
      'synced_items', 0
    );
  end if;

  for v_route_order in
    select ro.id, ro.route_id, ro.order_id
    from public.route_orders ro
    where ro.id = any(p_route_order_ids)
    order by ro.created_at, ro.id
  loop
    delete from public.route_order_items roi
    where roi.route_order_id = v_route_order.id;

    with snapshot_rows as (
      select
        v_route_order.id as route_order_id,
        v_route_order.route_id,
        v_route_order.order_id,
        oi.id as order_item_id,
        oi.source_line_key,
        oi.sku as sku_snapshot,
        oi.product_name as product_name_snapshot,
        oi.storage_location as storage_location_snapshot,
        oi.kit_code as kit_code_snapshot,
        oi.purchased_quantity,
        bal.shadow_deliverable_quantity as allocated_quantity,
        bal.returned_quantity as returned_quantity_snapshot,
        bal.shadow_deliverable_quantity as deliverable_quantity_snapshot,
        case
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity = 0 then 'returned'
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity > 0 then 'partial'
          else 'pending'
        end as status
      from public.order_item_shadow_balances bal
      join public.order_items oi on oi.id = bal.order_item_id
      where bal.order_id = v_route_order.order_id
        and oi.source_present
        and (
          bal.shadow_deliverable_quantity > 0
          or bal.returned_quantity > 0
        )
    ), inserted as (
      insert into public.route_order_items (
        route_order_id,
        route_id,
        order_id,
        order_item_id,
        source_line_key,
        sku_snapshot,
        product_name_snapshot,
        storage_location_snapshot,
        kit_code_snapshot,
        purchased_quantity,
        allocated_quantity,
        returned_quantity_snapshot,
        deliverable_quantity_snapshot,
        status
      )
      select
        route_order_id,
        route_id,
        order_id,
        order_item_id,
        source_line_key,
        sku_snapshot,
        product_name_snapshot,
        storage_location_snapshot,
        kit_code_snapshot,
        purchased_quantity,
        allocated_quantity,
        returned_quantity_snapshot,
        deliverable_quantity_snapshot,
        status
      from snapshot_rows
      returning id
    )
    select count(*) into v_inserted_count from inserted;

    v_route_orders := v_route_orders + 1;
    v_items := v_items + coalesce(v_inserted_count, 0);
  end loop;

  return jsonb_build_object(
    'synced_route_orders', v_route_orders,
    'synced_items', v_items
  );
end;
$$;


ALTER FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) OWNER TO postgres;

--
-- Name: sync_route_order_item_snapshots_system(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_route_order record;
  v_route_orders integer := 0;
  v_items integer := 0;
  v_inserted_count integer := 0;
begin
  if p_route_order_ids is null or coalesce(array_length(p_route_order_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'synced_route_orders', 0,
      'synced_items', 0
    );
  end if;

  for v_route_order in
    select ro.id, ro.route_id, ro.order_id
    from public.route_orders ro
    where ro.id = any(p_route_order_ids)
    order by ro.created_at, ro.id
  loop
    delete from public.route_order_items roi
    where roi.route_order_id = v_route_order.id;

    with inserted as (
      insert into public.route_order_items (
        route_order_id,
        route_id,
        order_id,
        order_item_id,
        source_line_key,
        sku_snapshot,
        product_name_snapshot,
        storage_location_snapshot,
        kit_code_snapshot,
        purchased_quantity,
        allocated_quantity,
        returned_quantity_snapshot,
        deliverable_quantity_snapshot,
        status
      )
      select
        v_route_order.id as route_order_id,
        v_route_order.route_id,
        v_route_order.order_id,
        oi.id as order_item_id,
        oi.source_line_key,
        oi.sku as sku_snapshot,
        oi.product_name as product_name_snapshot,
        oi.storage_location as storage_location_snapshot,
        oi.kit_code as kit_code_snapshot,
        oi.purchased_quantity,
        bal.shadow_deliverable_quantity as allocated_quantity,
        bal.returned_quantity as returned_quantity_snapshot,
        bal.shadow_deliverable_quantity as deliverable_quantity_snapshot,
        case
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity = 0 then 'returned'
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity > 0 then 'partial'
          else 'pending'
        end as status
      from public.order_item_shadow_balances bal
      join public.order_items oi on oi.id = bal.order_item_id
      where bal.order_id = v_route_order.order_id
        and oi.source_present
        and (
          bal.shadow_deliverable_quantity > 0
          or bal.returned_quantity > 0
        )
      returning id
    )
    select count(*) into v_inserted_count from inserted;

    v_route_orders := v_route_orders + 1;
    v_items := v_items + coalesce(v_inserted_count, 0);
  end loop;

  return jsonb_build_object(
    'synced_route_orders', v_route_orders,
    'synced_items', v_items
  );
end;
$$;


ALTER FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) OWNER TO postgres;

--
-- Name: FUNCTION sync_route_order_item_snapshots_system(p_route_order_ids uuid[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) IS 'Recalcula snapshots por item de route_orders sem exigir permissões interativas; uso interno e por triggers.';


--
-- Name: sync_store_release_for_open_orders(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_store_release_for_open_orders() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
  v_processed integer := 0;
begin
  for v_order_id in
    select o.id
    from public.orders o
    where o.blocked_at is null
      and o.status = 'pending'
      and not exists (
        select 1
        from public.order_withdrawals ow
        where ow.order_id = o.id
      )
  loop
    perform public.sync_store_release_for_order(v_order_id);
    v_processed := v_processed + 1;
  end loop;

  for v_order_id in
    select distinct o.id
    from public.orders o
    join public.store_release_assignments sra on sra.order_id = o.id
    where o.blocked_at is not null
       or o.status is distinct from 'pending'
       or exists (
         select 1
         from public.order_withdrawals ow
         where ow.order_id = o.id
       )
  loop
    perform public.sync_store_release_for_order(v_order_id);
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed_orders', v_processed);
end;
$$;


ALTER FUNCTION public.sync_store_release_for_open_orders() OWNER TO postgres;

--
-- Name: sync_store_release_for_order(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_store_release_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_location text;
  v_required_locations text[] := '{}';
  v_assign record;
  v_required_count integer := 0;
  v_released_count integer := 0;
  v_only_block_disassemblable boolean := true;
  v_has_withdrawal boolean := false;
  v_import_source text;
  v_enabled boolean := false;
begin
  select *
    into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  v_import_source := lower(trim(coalesce(v_order.import_source, '')));

  begin
    select
      coalesce((value->>'enabled')::boolean, false),
      coalesce((value->>'only_block_disassemblable_items')::boolean, true)
    into v_enabled, v_only_block_disassemblable
    from public.app_settings
    where key = 'store_release_control';
  exception
    when others then
      v_enabled := false;
      v_only_block_disassemblable := true;
  end;

  select exists (
    select 1
    from public.order_withdrawals ow
    where ow.order_id = p_order_id
  )
  into v_has_withdrawal;

  if not v_enabled
     or v_order.blocked_at is not null
     or v_order.status is distinct from 'pending'
     or v_has_withdrawal
     or v_import_source <> 'lote' then
    for v_assign in
      select id, store_location
      from public.store_release_assignments
      where order_id = p_order_id
    loop
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_assign.store_location,
        'auto_cleared',
        case
          when not v_enabled then 'Pendencia removida automaticamente porque a liberacao de saida de loja esta desativada.'
          when v_import_source <> 'lote' then 'Pendencia removida automaticamente porque o pedido nao e importacao em lote.'
          else 'Pendencia removida automaticamente porque o pedido nao esta mais aguardando roteirizacao.'
        end,
        null
      );

      delete from public.store_release_assignments
      where id = v_assign.id;
    end loop;

    update public.orders
      set requires_store_release = false,
          store_release_status = 'not_applicable'
    where id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'required_locations', v_required_locations,
      'required_count', 0,
      'released_count', 0,
      'status', 'not_applicable'
    );
  end if;

  if v_order.items_json is not null and jsonb_typeof(v_order.items_json) = 'array' then
    for v_item in
      select value
      from jsonb_array_elements(v_order.items_json)
    loop
      v_location := public.normalize_store_release_location(v_item->>'location');

      if not public.store_release_location_is_controlled(v_location) then
        continue;
      end if;

      if v_only_block_disassemblable
         and not (
           public.store_release_is_truthy(v_item->>'possui_montagem')
           or public.store_release_is_truthy(v_item->>'produto_e_montavel')
         ) then
        continue;
      end if;

      if not (v_location = any (v_required_locations)) then
        v_required_locations := array_append(v_required_locations, v_location);
      end if;
    end loop;
  end if;

  if v_order.raw_json is not null then
    if jsonb_typeof(v_order.raw_json->'produtos_locais') = 'array' then
      for v_item in
        select value
        from jsonb_array_elements(v_order.raw_json->'produtos_locais')
      loop
        v_location := public.normalize_store_release_location(v_item->>'local_estocagem');

        if not public.store_release_location_is_controlled(v_location) then
          continue;
        end if;

        if v_only_block_disassemblable
           and not (
             public.store_release_is_truthy(v_item->>'possui_montagem')
             or public.store_release_is_truthy(v_item->>'produto_e_montavel')
           ) then
          continue;
        end if;

        if not (v_location = any (v_required_locations)) then
          v_required_locations := array_append(v_required_locations, v_location);
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_order.raw_json->'produtos') = 'array' then
      for v_item in
        select value
        from jsonb_array_elements(v_order.raw_json->'produtos')
      loop
        v_location := public.normalize_store_release_location(v_item->>'local_estocagem');

        if not public.store_release_location_is_controlled(v_location) then
          continue;
        end if;

        if v_only_block_disassemblable
           and not (
             public.store_release_is_truthy(v_item->>'possui_montagem')
             or public.store_release_is_truthy(v_item->>'produto_e_montavel')
           ) then
          continue;
        end if;

        if not (v_location = any (v_required_locations)) then
          v_required_locations := array_append(v_required_locations, v_location);
        end if;
      end loop;
    end if;
  end if;

  for v_assign in
    select id, store_location
    from public.store_release_assignments
    where order_id = p_order_id
  loop
    if not (v_assign.store_location = any (v_required_locations)) then
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_assign.store_location,
        'auto_cleared',
        'Pendencia removida por reclassificacao automatica.',
        null
      );

      delete from public.store_release_assignments
      where id = v_assign.id;
    end if;
  end loop;

  foreach v_location in array v_required_locations
  loop
    insert into public.store_release_assignments (
      order_id,
      store_location,
      status
    ) values (
      p_order_id,
      v_location,
      'pending'
    )
    on conflict (order_id, store_location) do nothing;

    if not exists (
      select 1
      from public.store_release_history h
      where h.order_id = p_order_id
        and h.store_location = v_location
        and h.action = 'auto_created'
    ) then
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_location,
        'auto_created',
        'Pendencia criada por classificacao automatica.',
        null
      );
    end if;
  end loop;

  select count(*)
    into v_required_count
  from public.store_release_assignments
  where order_id = p_order_id;

  select count(*)
    into v_released_count
  from public.store_release_assignments
  where order_id = p_order_id
    and status = 'released';

  if v_required_count = 0 then
    update public.orders
      set requires_store_release = false,
          store_release_status = 'not_applicable'
    where id = p_order_id;
  elsif v_released_count = 0 then
    update public.orders
      set requires_store_release = true,
          store_release_status = 'pending'
    where id = p_order_id;
  elsif v_released_count < v_required_count then
    update public.orders
      set requires_store_release = true,
          store_release_status = 'partial'
    where id = p_order_id;
  else
    update public.orders
      set requires_store_release = true,
          store_release_status = 'released'
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'required_locations', v_required_locations,
    'required_count', v_required_count,
    'released_count', v_released_count,
    'status', (
      select o.store_release_status
      from public.orders o
      where o.id = p_order_id
    )
  );
end;
$$;


ALTER FUNCTION public.sync_store_release_for_order(p_order_id uuid) OWNER TO postgres;

--
-- Name: sync_store_release_for_orders(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_store_release_for_orders(p_order_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
  v_processed integer := 0;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return jsonb_build_object('processed_orders', 0);
  end if;

  foreach v_order_id in array p_order_ids
  loop
    perform public.sync_store_release_for_order(v_order_id);
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed_orders', v_processed);
end;
$$;


ALTER FUNCTION public.sync_store_release_for_orders(p_order_ids uuid[]) OWNER TO postgres;

--
-- Name: update_fleet_occurrence_status(uuid, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text DEFAULT NULL::text) RETURNS void
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
    update public.fleet_vehicles
    set status = 'available'
    where id = v_occurrence.vehicle_id
      and active = true;
  end if;
end;
$$;


ALTER FUNCTION public.update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text) OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

--
-- Name: users_guard_sensitive_fields(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.users_guard_sensitive_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() and old.id = auth.uid() then
    if new.role is distinct from old.role then
      raise exception 'Nao permitido alterar role';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Nao permitido alterar email';
    end if;
    if new.id is distinct from old.id then
      raise exception 'Nao permitido alterar id';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.users_guard_sensitive_fields() OWNER TO postgres;

--
-- Name: validate_order_return_before_processing(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validate_order_return_before_processing() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_violation jsonb;
begin
  if new.processing_status = 'processed'
     and old.processing_status is distinct from new.processing_status then
    v_violation := public.get_order_return_capacity_violation(new.id);
    if v_violation is not null then
      raise exception 'Quantidade devolvida acima da comprada para o produto %',
        coalesce(v_violation->>'product_name', v_violation->>'source_line_key', 'não identificado');
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.validate_order_return_before_processing() OWNER TO postgres;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: assembly_photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assembly_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assembly_product_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    file_size integer,
    uploaded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    is_synced boolean DEFAULT false
);


ALTER TABLE public.assembly_photos OWNER TO postgres;

--
-- Name: TABLE assembly_photos; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.assembly_photos IS 'Armazena fotos tiradas pelos montadores ao finalizar montagem de produtos';


--
-- Name: COLUMN assembly_photos.storage_path; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assembly_photos.storage_path IS 'Caminho do arquivo no Supabase Storage bucket assembly-photos';


--
-- Name: COLUMN assembly_photos.is_synced; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assembly_photos.is_synced IS 'Indica se a foto já foi enviada ao Storage. Usado para controle offline.';


--
-- Name: assembly_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assembly_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assembly_route_id uuid,
    order_id uuid,
    product_name text NOT NULL,
    product_sku text,
    customer_name text NOT NULL,
    customer_phone text,
    installation_address jsonb,
    installer_id uuid,
    status text DEFAULT 'pending'::text,
    assembly_date timestamp with time zone,
    completion_date timestamp with time zone,
    observations text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    returned_at timestamp with time zone,
    was_returned boolean DEFAULT false,
    return_reason text,
    import_source text,
    mount_priority text,
    CONSTRAINT assembly_products_mount_priority_check CHECK (((mount_priority IS NULL) OR (mount_priority = ANY (ARRAY['baixa'::text, 'media'::text, 'alta'::text])))),
    CONSTRAINT assembly_products_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);


ALTER TABLE public.assembly_products OWNER TO postgres;

--
-- Name: COLUMN assembly_products.import_source; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assembly_products.import_source IS 'Origem da importação: avulsa ou lote';


--
-- Name: COLUMN assembly_products.mount_priority; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assembly_products.mount_priority IS 'Prioridade manual de montagem definida pelo usuário: baixa, media, alta ou null.';


--
-- Name: assembly_routes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assembly_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    deadline timestamp with time zone,
    observations text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    assembler_id uuid,
    vehicle_id uuid,
    route_code character varying(15),
    CONSTRAINT assembly_routes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);


ALTER TABLE public.assembly_routes OWNER TO postgres;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    details jsonb,
    user_id uuid,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: carrier_cities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.carrier_cities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    city_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.carrier_cities OWNER TO postgres;

--
-- Name: company_holidays; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.company_holidays (
    date date NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.company_holidays OWNER TO postgres;

--
-- Name: delivery_city_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_city_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    city_name text NOT NULL,
    delivery_days integer DEFAULT 15 NOT NULL,
    assembly_days integer DEFAULT 15 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    rural_delivery_days integer DEFAULT 0,
    rural_assembly_days integer DEFAULT 0,
    full_delivery_days integer DEFAULT 0,
    full_assembly_days integer DEFAULT 0
);


ALTER TABLE public.delivery_city_rules OWNER TO postgres;

--
-- Name: delivery_photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_order_id uuid NOT NULL,
    photo_type text DEFAULT 'general'::text NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    file_size integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    is_synced boolean DEFAULT true
);


ALTER TABLE public.delivery_photos OWNER TO postgres;

--
-- Name: delivery_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    route_id uuid NOT NULL,
    route_order_id uuid NOT NULL,
    delivered_by_user_id uuid,
    delivered_at_server timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    device_timestamp timestamp with time zone,
    gps_lat numeric(10,7),
    gps_lng numeric(10,7),
    gps_accuracy_m numeric(8,2),
    gps_status text DEFAULT 'ok'::text NOT NULL,
    gps_failure_reason text,
    recipient_name text,
    recipient_relation text,
    recipient_notes text,
    photo_count integer DEFAULT 0 NOT NULL,
    photo_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    network_mode text DEFAULT 'online'::text NOT NULL,
    device_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    app_version text,
    sync_status text DEFAULT 'synced'::text NOT NULL,
    proof_hash text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT delivery_receipts_gps_pair CHECK ((((gps_lat IS NULL) AND (gps_lng IS NULL)) OR ((gps_lat IS NOT NULL) AND (gps_lng IS NOT NULL)))),
    CONSTRAINT delivery_receipts_gps_status_check CHECK ((gps_status = ANY (ARRAY['ok'::text, 'failed'::text]))),
    CONSTRAINT delivery_receipts_network_mode_check CHECK ((network_mode = ANY (ARRAY['online'::text, 'offline'::text]))),
    CONSTRAINT delivery_receipts_photo_count_check CHECK ((photo_count >= 0)),
    CONSTRAINT delivery_receipts_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending_sync'::text, 'synced'::text, 'failed'::text])))
);


ALTER TABLE public.delivery_receipts OWNER TO postgres;

--
-- Name: TABLE delivery_receipts; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.delivery_receipts IS 'Comprovacao digital de entrega (modo paralelo/sombra).';


--
-- Name: delivery_route_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_route_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT delivery_route_catalog_name_not_blank CHECK ((char_length(btrim(name)) > 0))
);


ALTER TABLE public.delivery_route_catalog OWNER TO postgres;

--
-- Name: drivers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    cpf text,
    vehicle_id uuid,
    active boolean DEFAULT true
);


ALTER TABLE public.drivers OWNER TO postgres;

--
-- Name: fleet_inspection_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fleet_inspection_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    item_code text NOT NULL,
    category text NOT NULL,
    label text NOT NULL,
    status text NOT NULL,
    notes text,
    sort_order integer NOT NULL,
    CONSTRAINT fleet_inspection_items_category_not_blank CHECK ((char_length(btrim(category)) > 0)),
    CONSTRAINT fleet_inspection_items_code_not_blank CHECK ((char_length(btrim(item_code)) > 0)),
    CONSTRAINT fleet_inspection_items_label_not_blank CHECK ((char_length(btrim(label)) > 0)),
    CONSTRAINT fleet_inspection_items_sort_order_non_negative CHECK ((sort_order >= 0)),
    CONSTRAINT fleet_inspection_items_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'attention'::text, 'critical'::text, 'na'::text])))
);


ALTER TABLE public.fleet_inspection_items OWNER TO postgres;

--
-- Name: fleet_inspection_photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fleet_inspection_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    file_size bigint,
    caption text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT fleet_inspection_photos_storage_path_not_blank CHECK ((char_length(btrim(storage_path)) > 0))
);


ALTER TABLE public.fleet_inspection_photos OWNER TO postgres;

--
-- Name: fleet_inspections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fleet_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    inspection_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    odometer bigint,
    overall_status text,
    general_notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    assigned_driver_user_id uuid,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    completed_by uuid,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancellation_reason text,
    CONSTRAINT fleet_inspections_odometer_non_negative CHECK ((odometer >= 0)),
    CONSTRAINT fleet_inspections_overall_status_check CHECK ((overall_status = ANY (ARRAY['approved'::text, 'attention'::text, 'critical'::text]))),
    CONSTRAINT fleet_inspections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);


ALTER TABLE public.fleet_inspections OWNER TO postgres;

--
-- Name: fleet_occurrences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fleet_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    inspection_id uuid NOT NULL,
    severity text DEFAULT 'critical'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    title text NOT NULL,
    description text,
    resolution_notes text,
    created_by uuid,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT fleet_occurrences_severity_check CHECK ((severity = 'critical'::text)),
    CONSTRAINT fleet_occurrences_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'cancelled'::text]))),
    CONSTRAINT fleet_occurrences_title_not_blank CHECK ((char_length(btrim(title)) > 0))
);


ALTER TABLE public.fleet_occurrences OWNER TO postgres;

--
-- Name: fleet_vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fleet_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    plate text NOT NULL,
    brand text NOT NULL,
    model text NOT NULL,
    model_year integer,
    vehicle_type text,
    renavam text,
    chassis text,
    current_odometer bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT fleet_vehicles_brand_not_blank CHECK ((char_length(btrim(brand)) > 0)),
    CONSTRAINT fleet_vehicles_display_name_not_blank CHECK ((char_length(btrim(display_name)) > 0)),
    CONSTRAINT fleet_vehicles_model_not_blank CHECK ((char_length(btrim(model)) > 0)),
    CONSTRAINT fleet_vehicles_odometer_non_negative CHECK ((current_odometer >= 0)),
    CONSTRAINT fleet_vehicles_plate_not_blank CHECK ((char_length(btrim(plate)) > 0)),
    CONSTRAINT fleet_vehicles_status_check CHECK ((status = ANY (ARRAY['available'::text, 'maintenance'::text, 'inactive'::text])))
);


ALTER TABLE public.fleet_vehicles OWNER TO postgres;

--
-- Name: item_fulfillment_sync_issues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.item_fulfillment_sync_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid,
    issue_type text NOT NULL,
    issue_key text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    detected_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT item_fulfillment_sync_issues_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text])))
);


ALTER TABLE public.item_fulfillment_sync_issues OWNER TO postgres;

--
-- Name: route_conferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.route_conferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text,
    result_ok boolean,
    started_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    finished_at timestamp with time zone,
    user_id uuid,
    summary jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution jsonb,
    CONSTRAINT route_conferences_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text])))
);


ALTER TABLE public.route_conferences OWNER TO postgres;

--
-- Name: latest_route_conferences; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.latest_route_conferences WITH (security_invoker='true') AS
 SELECT DISTINCT ON (route_id) id,
    route_id,
    status,
    result_ok,
    started_at,
    finished_at,
    created_at,
    user_id,
    summary,
    resolved_at,
    resolved_by,
    resolution
   FROM public.route_conferences
  ORDER BY route_id, created_at DESC;


ALTER VIEW public.latest_route_conferences OWNER TO postgres;

--
-- Name: mdfe_drivers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mdfe_drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    cpf text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT mdfe_drivers_cpf_not_blank CHECK ((char_length(btrim(cpf)) > 0)),
    CONSTRAINT mdfe_drivers_name_not_blank CHECK ((char_length(btrim(name)) > 0))
);


ALTER TABLE public.mdfe_drivers OWNER TO postgres;

--
-- Name: mdfe_emitters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mdfe_emitters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    trade_name text,
    cnpj text NOT NULL,
    state_registration text NOT NULL,
    street text NOT NULL,
    number text NOT NULL,
    complement text,
    neighborhood text NOT NULL,
    city_code text NOT NULL,
    city_name text NOT NULL,
    uf text NOT NULL,
    zip_code text,
    phone text,
    email text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT mdfe_emitters_city_code_not_blank CHECK ((char_length(btrim(city_code)) > 0)),
    CONSTRAINT mdfe_emitters_city_name_not_blank CHECK ((char_length(btrim(city_name)) > 0)),
    CONSTRAINT mdfe_emitters_cnpj_not_blank CHECK ((char_length(btrim(cnpj)) > 0)),
    CONSTRAINT mdfe_emitters_company_name_not_blank CHECK ((char_length(btrim(company_name)) > 0)),
    CONSTRAINT mdfe_emitters_ie_not_blank CHECK ((char_length(btrim(state_registration)) > 0)),
    CONSTRAINT mdfe_emitters_neighborhood_not_blank CHECK ((char_length(btrim(neighborhood)) > 0)),
    CONSTRAINT mdfe_emitters_number_not_blank CHECK ((char_length(btrim(number)) > 0)),
    CONSTRAINT mdfe_emitters_street_not_blank CHECK ((char_length(btrim(street)) > 0)),
    CONSTRAINT mdfe_emitters_uf_len CHECK ((char_length(btrim(uf)) = 2))
);


ALTER TABLE public.mdfe_emitters OWNER TO postgres;

--
-- Name: mdfe_manifest_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mdfe_manifest_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    manifest_id uuid NOT NULL,
    order_id uuid,
    order_id_erp text,
    nfe_key text NOT NULL,
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
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT mdfe_manifest_documents_nfe_key_not_blank CHECK ((char_length(btrim(nfe_key)) > 0))
);


ALTER TABLE public.mdfe_manifest_documents OWNER TO postgres;

--
-- Name: mdfe_manifests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mdfe_manifests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid,
    emitter_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    environment text DEFAULT 'homologation'::text NOT NULL,
    operation_type text DEFAULT 'cargo_propria'::text NOT NULL,
    loading_city_code text,
    loading_city_name text,
    loading_uf text,
    unloading_city_code text,
    unloading_city_name text,
    unloading_uf text,
    total_documents integer DEFAULT 0 NOT NULL,
    total_value numeric(13,2) DEFAULT 0 NOT NULL,
    total_gross_weight numeric(13,4) DEFAULT 0 NOT NULL,
    focus_reference text,
    mdfe_number text,
    mdfe_key text,
    protocol text,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    response_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    xml_content text,
    pdf_url text,
    error_message text,
    issued_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT mdfe_manifests_environment_check CHECK ((environment = ANY (ARRAY['homologation'::text, 'production'::text]))),
    CONSTRAINT mdfe_manifests_operation_type_check CHECK ((operation_type = 'cargo_propria'::text)),
    CONSTRAINT mdfe_manifests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'processing'::text, 'issued'::text, 'closed'::text, 'cancelled'::text, 'error'::text]))),
    CONSTRAINT mdfe_manifests_total_documents_non_negative CHECK ((total_documents >= 0)),
    CONSTRAINT mdfe_manifests_total_gross_weight_non_negative CHECK ((total_gross_weight >= (0)::numeric)),
    CONSTRAINT mdfe_manifests_total_value_non_negative CHECK ((total_value >= (0)::numeric))
);


ALTER TABLE public.mdfe_manifests OWNER TO postgres;

--
-- Name: mdfe_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mdfe_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    environment text DEFAULT 'homologation'::text NOT NULL,
    operation_type text DEFAULT 'cargo_propria'::text NOT NULL,
    emit_type integer DEFAULT 2 NOT NULL,
    transport_type integer,
    default_emitter_id uuid,
    loading_city_code text,
    loading_city_name text,
    loading_uf text,
    observations text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    auto_close_on_route_complete boolean DEFAULT false NOT NULL,
    CONSTRAINT mdfe_settings_environment_check CHECK ((environment = ANY (ARRAY['homologation'::text, 'production'::text]))),
    CONSTRAINT mdfe_settings_operation_type_check CHECK ((operation_type = 'cargo_propria'::text))
);


ALTER TABLE public.mdfe_settings OWNER TO postgres;

--
-- Name: mdfe_vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mdfe_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    plate text NOT NULL,
    renavam text,
    tara_kg integer NOT NULL,
    capacity_kg integer,
    capacity_m3 integer,
    body_type text NOT NULL,
    rodado_type text,
    licensing_uf text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT mdfe_vehicles_body_type_not_blank CHECK ((char_length(btrim(body_type)) > 0)),
    CONSTRAINT mdfe_vehicles_capacity_kg_non_negative CHECK (((capacity_kg IS NULL) OR (capacity_kg >= 0))),
    CONSTRAINT mdfe_vehicles_capacity_m3_non_negative CHECK (((capacity_m3 IS NULL) OR (capacity_m3 >= 0))),
    CONSTRAINT mdfe_vehicles_display_name_not_blank CHECK ((char_length(btrim(display_name)) > 0)),
    CONSTRAINT mdfe_vehicles_licensing_uf_len CHECK ((char_length(btrim(licensing_uf)) = 2)),
    CONSTRAINT mdfe_vehicles_plate_not_blank CHECK ((char_length(btrim(plate)) > 0)),
    CONSTRAINT mdfe_vehicles_tara_non_negative CHECK ((tara_kg >= 0))
);


ALTER TABLE public.mdfe_vehicles OWNER TO postgres;

--
-- Name: operational_diary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operational_diary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    date date DEFAULT CURRENT_DATE NOT NULL,
    type text,
    order_ref text,
    responsible_staff text,
    content text,
    tags text[]
);


ALTER TABLE public.operational_diary OWNER TO postgres;

--
-- Name: order_audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    user_id uuid,
    user_name text NOT NULL,
    field_changed text NOT NULL,
    old_value text,
    new_value text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.order_audit_log OWNER TO postgres;

--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    source_line_key text NOT NULL,
    sku text,
    product_name text NOT NULL,
    purchased_quantity numeric(12,3) NOT NULL,
    volume_quantity numeric(12,3),
    storage_location text,
    kit_code text,
    source_payload jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_present boolean DEFAULT true NOT NULL,
    source_synced_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_items_purchased_quantity_positive CHECK ((purchased_quantity > (0)::numeric)),
    CONSTRAINT order_items_volume_quantity_nonnegative CHECK (((volume_quantity IS NULL) OR (volume_quantity >= (0)::numeric)))
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: TABLE order_items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.order_items IS 'Representação estruturada e inicialmente somente sombra dos itens originais de orders.items_json.';


--
-- Name: order_return_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid NOT NULL,
    order_item_id uuid,
    source_item_key text NOT NULL,
    sku_snapshot text,
    product_name_snapshot text,
    returned_quantity numeric(12,3) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_return_items_quantity_positive CHECK ((returned_quantity > (0)::numeric))
);


ALTER TABLE public.order_return_items OWNER TO postgres;

--
-- Name: TABLE order_return_items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.order_return_items IS 'Produtos e quantidades presentes em cada devolução.';


--
-- Name: order_returns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    external_key text,
    return_nfe_number text,
    return_nfe_key text,
    return_date timestamp with time zone,
    return_type text,
    return_xml text,
    reason text,
    processing_status text DEFAULT 'pending'::text NOT NULL,
    processing_notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    requires_pickup boolean DEFAULT false NOT NULL,
    pickup_created_at timestamp with time zone,
    pickup_order_id uuid,
    pickup_route_id uuid,
    CONSTRAINT order_returns_pickup_link_all_or_none CHECK ((num_nonnulls(pickup_created_at, pickup_order_id, pickup_route_id) = ANY (ARRAY[0, 3]))),
    CONSTRAINT order_returns_processing_status_check CHECK ((processing_status = ANY (ARRAY['pending'::text, 'processed'::text, 'divergent'::text, 'cancelled'::text])))
);


ALTER TABLE public.order_returns OWNER TO postgres;

--
-- Name: TABLE order_returns; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.order_returns IS 'Cabeçalho histórico de devoluções totais ou parciais vinculadas ao pedido.';


--
-- Name: COLUMN order_returns.requires_pickup; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.order_returns.requires_pickup IS 'Indica se esta devolução específica precisa entrar na fila de coleta.';


--
-- Name: COLUMN order_returns.pickup_created_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.order_returns.pickup_created_at IS 'Data/hora em que a coleta desta devolução específica foi criada.';


--
-- Name: COLUMN order_returns.pickup_order_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.order_returns.pickup_order_id IS 'Pedido operacional C- criado exclusivamente para a coleta desta devolução.';


--
-- Name: COLUMN order_returns.pickup_route_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.order_returns.pickup_route_id IS 'Rota de coleta criada exclusivamente para esta devolução.';


--
-- Name: order_item_shadow_balances; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.order_item_shadow_balances AS
 SELECT oi.id AS order_item_id,
    oi.order_id,
    oi.source_line_key,
    oi.sku,
    oi.product_name,
    oi.storage_location,
    oi.kit_code,
    oi.source_present,
    oi.purchased_quantity,
    COALESCE(ret.returned_quantity, (0)::numeric) AS returned_quantity,
    GREATEST((oi.purchased_quantity - COALESCE(ret.returned_quantity, (0)::numeric)), (0)::numeric) AS shadow_deliverable_quantity,
    (COALESCE(ret.returned_quantity, (0)::numeric) > oi.purchased_quantity) AS has_over_return
   FROM (public.order_items oi
     LEFT JOIN ( SELECT ori.order_item_id,
            sum(ori.returned_quantity) AS returned_quantity
           FROM (public.order_return_items ori
             JOIN public.order_returns r ON ((r.id = ori.return_id)))
          WHERE ((ori.order_item_id IS NOT NULL) AND (r.processing_status = 'processed'::text))
          GROUP BY ori.order_item_id) ret ON ((ret.order_item_id = oi.id)));


ALTER VIEW public.order_item_shadow_balances OWNER TO postgres;

--
-- Name: VIEW order_item_shadow_balances; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.order_item_shadow_balances IS 'Saldo por item em modo sombra; não interfere na roteirização ou entrega legada.';


--
-- Name: order_withdrawals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_withdrawals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    responsible_name text NOT NULL,
    notes text,
    withdrawn_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    registered_by_user_id uuid,
    registered_by_name text,
    source text DEFAULT 'manual'::text NOT NULL,
    legacy_route_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_withdrawals_responsible_name_not_blank CHECK ((char_length(btrim(responsible_name)) > 0)),
    CONSTRAINT order_withdrawals_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'legacy_route'::text])))
);


ALTER TABLE public.order_withdrawals OWNER TO postgres;

--
-- Name: orders_backup_20241130; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders_backup_20241130 (
    id uuid NOT NULL,
    order_id_erp text,
    id_unico_integracao bigint,
    tipo integer,
    cliente_celular text,
    phone text,
    tem_montagem text
);


ALTER TABLE public.orders_backup_20241130 OWNER TO postgres;

--
-- Name: return_reasons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.return_reasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reason text NOT NULL,
    description text,
    active boolean DEFAULT true,
    type text DEFAULT 'both'::text,
    CONSTRAINT check_return_type CHECK ((type = ANY (ARRAY['delivery'::text, 'assembly'::text, 'both'::text])))
);


ALTER TABLE public.return_reasons OWNER TO postgres;

--
-- Name: route_conference_scans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.route_conference_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_conference_id uuid NOT NULL,
    normalized_code text NOT NULL,
    order_id uuid,
    product_code text,
    volume_index integer,
    volume_total integer,
    matched boolean DEFAULT true,
    "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);


ALTER TABLE public.route_conference_scans OWNER TO postgres;

--
-- Name: route_order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.route_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_order_id uuid NOT NULL,
    route_id uuid NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid,
    source_line_key text NOT NULL,
    sku_snapshot text,
    product_name_snapshot text NOT NULL,
    storage_location_snapshot text,
    kit_code_snapshot text,
    purchased_quantity numeric(12,3) NOT NULL,
    allocated_quantity numeric(12,3) NOT NULL,
    returned_quantity_snapshot numeric(12,3) DEFAULT 0 NOT NULL,
    deliverable_quantity_snapshot numeric(12,3) NOT NULL,
    delivered_quantity numeric(12,3) DEFAULT 0 NOT NULL,
    returned_quantity numeric(12,3) DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT route_order_items_allocated_quantity_nonnegative CHECK ((allocated_quantity >= (0)::numeric)),
    CONSTRAINT route_order_items_deliverable_snapshot_nonnegative CHECK ((deliverable_quantity_snapshot >= (0)::numeric)),
    CONSTRAINT route_order_items_delivered_quantity_nonnegative CHECK ((delivered_quantity >= (0)::numeric)),
    CONSTRAINT route_order_items_purchased_quantity_nonnegative CHECK ((purchased_quantity >= (0)::numeric)),
    CONSTRAINT route_order_items_returned_quantity_nonnegative CHECK ((returned_quantity >= (0)::numeric)),
    CONSTRAINT route_order_items_returned_snapshot_nonnegative CHECK ((returned_quantity_snapshot >= (0)::numeric)),
    CONSTRAINT route_order_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'partial'::text, 'delivered'::text, 'returned'::text, 'cancelled'::text])))
);


ALTER TABLE public.route_order_items OWNER TO postgres;

--
-- Name: TABLE route_order_items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.route_order_items IS 'Snapshot por item dos pedidos que entraram em uma route_order, mantendo a criação da rota em nível de pedido.';


--
-- Name: route_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.route_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid NOT NULL,
    order_id uuid NOT NULL,
    sequence integer NOT NULL,
    status text NOT NULL,
    delivery_observations text,
    return_reason_id uuid,
    signature_url text,
    delivered_at timestamp with time zone,
    returned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    delivered_by uuid,
    return_reason text,
    synced boolean DEFAULT false,
    synced_at timestamp with time zone,
    return_notes text,
    CONSTRAINT route_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'returned'::text])))
);


ALTER TABLE public.route_orders OWNER TO postgres;

--
-- Name: routes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    driver_id uuid NOT NULL,
    vehicle_id uuid,
    conferente text,
    observations text,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    team_id uuid,
    helper_id uuid,
    route_code character varying(15),
    conferente_id uuid,
    completed_at timestamp with time zone,
    fulfillment_mode text DEFAULT 'legacy'::text NOT NULL,
    fulfillment_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT routes_fulfillment_mode_check CHECK ((fulfillment_mode = ANY (ARRAY['legacy'::text, 'itemized'::text]))),
    CONSTRAINT routes_fulfillment_version_check CHECK ((fulfillment_version >= 1)),
    CONSTRAINT routes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])))
);


ALTER TABLE public.routes OWNER TO postgres;

--
-- Name: store_release_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_release_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    store_location text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    released_at timestamp with time zone,
    released_by_user_id uuid,
    release_notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT store_release_assignments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'released'::text])))
);


ALTER TABLE public.store_release_assignments OWNER TO postgres;

--
-- Name: store_release_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_release_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    store_location text NOT NULL,
    action text NOT NULL,
    notes text,
    acted_by_user_id uuid,
    acted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT store_release_history_action_check CHECK ((action = ANY (ARRAY['auto_created'::text, 'auto_cleared'::text, 'released'::text, 'reverted'::text])))
);


ALTER TABLE public.store_release_history OWNER TO postgres;

--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    record_id text NOT NULL,
    action text NOT NULL,
    data jsonb NOT NULL,
    synced boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    synced_at timestamp with time zone,
    CONSTRAINT sync_logs_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))
);


ALTER TABLE public.sync_logs OWNER TO postgres;

--
-- Name: teams_user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teams_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_user_id uuid NOT NULL,
    helper_user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.teams_user OWNER TO postgres;

--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    pref_key text NOT NULL,
    pref_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_preferences OWNER TO postgres;

--
-- Name: user_store_release_locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_store_release_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    store_location text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.user_store_release_locations OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    phone text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    must_change_password boolean DEFAULT false,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'driver'::text, 'helper'::text, 'montador'::text, 'conferente'::text, 'consultor'::text, 'gerente'::text])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plate text NOT NULL,
    model text NOT NULL,
    capacity integer,
    active boolean DEFAULT true
);


ALTER TABLE public.vehicles OWNER TO postgres;

--
-- Name: webhook_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.webhook_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    url text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.webhook_settings OWNER TO postgres;

--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: assembly_photos assembly_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_photos
    ADD CONSTRAINT assembly_photos_pkey PRIMARY KEY (id);


--
-- Name: assembly_products assembly_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_pkey PRIMARY KEY (id);


--
-- Name: assembly_routes assembly_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_pkey PRIMARY KEY (id);


--
-- Name: assembly_routes assembly_routes_route_code_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_route_code_unique UNIQUE (route_code);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: carrier_cities carrier_cities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.carrier_cities
    ADD CONSTRAINT carrier_cities_pkey PRIMARY KEY (id);


--
-- Name: company_holidays company_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_holidays
    ADD CONSTRAINT company_holidays_pkey PRIMARY KEY (date);


--
-- Name: delivery_city_rules delivery_city_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_city_rules
    ADD CONSTRAINT delivery_city_rules_pkey PRIMARY KEY (id);


--
-- Name: delivery_photos delivery_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_photos
    ADD CONSTRAINT delivery_photos_pkey PRIMARY KEY (id);


--
-- Name: delivery_receipts delivery_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_pkey PRIMARY KEY (id);


--
-- Name: delivery_route_catalog delivery_route_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_route_catalog
    ADD CONSTRAINT delivery_route_catalog_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: fleet_inspection_items fleet_inspection_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspection_items
    ADD CONSTRAINT fleet_inspection_items_pkey PRIMARY KEY (id);


--
-- Name: fleet_inspection_photos fleet_inspection_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspection_photos
    ADD CONSTRAINT fleet_inspection_photos_pkey PRIMARY KEY (id);


--
-- Name: fleet_inspections fleet_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspections
    ADD CONSTRAINT fleet_inspections_pkey PRIMARY KEY (id);


--
-- Name: fleet_occurrences fleet_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_occurrences
    ADD CONSTRAINT fleet_occurrences_pkey PRIMARY KEY (id);


--
-- Name: fleet_vehicles fleet_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_vehicles
    ADD CONSTRAINT fleet_vehicles_pkey PRIMARY KEY (id);


--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_pkey PRIMARY KEY (id);


--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_unique UNIQUE (order_id, issue_type, issue_key);


--
-- Name: mdfe_drivers mdfe_drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_drivers
    ADD CONSTRAINT mdfe_drivers_pkey PRIMARY KEY (id);


--
-- Name: mdfe_emitters mdfe_emitters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_emitters
    ADD CONSTRAINT mdfe_emitters_pkey PRIMARY KEY (id);


--
-- Name: mdfe_manifest_documents mdfe_manifest_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifest_documents
    ADD CONSTRAINT mdfe_manifest_documents_pkey PRIMARY KEY (id);


--
-- Name: mdfe_manifests mdfe_manifests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifests
    ADD CONSTRAINT mdfe_manifests_pkey PRIMARY KEY (id);


--
-- Name: mdfe_settings mdfe_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_settings
    ADD CONSTRAINT mdfe_settings_pkey PRIMARY KEY (id);


--
-- Name: mdfe_vehicles mdfe_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_vehicles
    ADD CONSTRAINT mdfe_vehicles_pkey PRIMARY KEY (id);


--
-- Name: operational_diary operational_diary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operational_diary
    ADD CONSTRAINT operational_diary_pkey PRIMARY KEY (id);


--
-- Name: order_audit_log order_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_source_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_source_key_unique UNIQUE (order_id, source_line_key);


--
-- Name: order_return_items order_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_pkey PRIMARY KEY (id);


--
-- Name: order_return_items order_return_items_source_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_source_unique UNIQUE (return_id, source_item_key);


--
-- Name: order_returns order_returns_external_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_external_key_unique UNIQUE (order_id, external_key);


--
-- Name: order_returns order_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pkey PRIMARY KEY (id);


--
-- Name: order_withdrawals order_withdrawals_order_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_withdrawals
    ADD CONSTRAINT order_withdrawals_order_unique UNIQUE (order_id);


--
-- Name: order_withdrawals order_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_withdrawals
    ADD CONSTRAINT order_withdrawals_pkey PRIMARY KEY (id);


--
-- Name: orders_backup_20241130 orders_backup_20241130_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders_backup_20241130
    ADD CONSTRAINT orders_backup_20241130_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_id_erp_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_id_erp_key UNIQUE (order_id_erp);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: return_reasons return_reasons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.return_reasons
    ADD CONSTRAINT return_reasons_pkey PRIMARY KEY (id);


--
-- Name: return_reasons return_reasons_reason_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.return_reasons
    ADD CONSTRAINT return_reasons_reason_key UNIQUE (reason);


--
-- Name: route_conference_scans route_conference_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conference_scans
    ADD CONSTRAINT route_conference_scans_pkey PRIMARY KEY (id);


--
-- Name: route_conferences route_conferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_pkey PRIMARY KEY (id);


--
-- Name: route_order_items route_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_pkey PRIMARY KEY (id);


--
-- Name: route_order_items route_order_items_route_order_line_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_route_order_line_unique UNIQUE (route_order_id, source_line_key);


--
-- Name: route_orders route_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_pkey PRIMARY KEY (id);


--
-- Name: route_orders route_orders_route_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_route_id_order_id_key UNIQUE (route_id, order_id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: routes routes_route_code_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_route_code_unique UNIQUE (route_code);


--
-- Name: store_release_assignments store_release_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_release_assignments
    ADD CONSTRAINT store_release_assignments_pkey PRIMARY KEY (id);


--
-- Name: store_release_history store_release_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_release_history
    ADD CONSTRAINT store_release_history_pkey PRIMARY KEY (id);


--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);


--
-- Name: teams_user teams_user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams_user
    ADD CONSTRAINT teams_user_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id, pref_key);


--
-- Name: user_store_release_locations user_store_release_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_store_release_locations
    ADD CONSTRAINT user_store_release_locations_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_plate_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_plate_key UNIQUE (plate);


--
-- Name: webhook_settings webhook_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_settings
    ADD CONSTRAINT webhook_settings_key_key UNIQUE (key);


--
-- Name: webhook_settings webhook_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_settings
    ADD CONSTRAINT webhook_settings_pkey PRIMARY KEY (id);


--
-- Name: carrier_cities_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX carrier_cities_active_idx ON public.carrier_cities USING btree (active);


--
-- Name: carrier_cities_city_name_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX carrier_cities_city_name_unique_idx ON public.carrier_cities USING btree (lower(btrim(city_name)));


--
-- Name: delivery_city_rules_city_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX delivery_city_rules_city_name_idx ON public.delivery_city_rules USING btree (lower(city_name));


--
-- Name: delivery_route_catalog_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX delivery_route_catalog_active_idx ON public.delivery_route_catalog USING btree (active);


--
-- Name: delivery_route_catalog_name_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX delivery_route_catalog_name_unique_idx ON public.delivery_route_catalog USING btree (lower(btrim(name)));


--
-- Name: fleet_inspection_items_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_inspection_items_status_idx ON public.fleet_inspection_items USING btree (status, inspection_id);


--
-- Name: fleet_inspection_items_unique_code_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fleet_inspection_items_unique_code_idx ON public.fleet_inspection_items USING btree (inspection_id, item_code);


--
-- Name: fleet_inspection_photos_inspection_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_inspection_photos_inspection_idx ON public.fleet_inspection_photos USING btree (inspection_id, created_at);


--
-- Name: fleet_inspection_photos_storage_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fleet_inspection_photos_storage_unique_idx ON public.fleet_inspection_photos USING btree (storage_path);


--
-- Name: fleet_inspections_driver_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_inspections_driver_status_idx ON public.fleet_inspections USING btree (assigned_driver_user_id, status, scheduled_at DESC NULLS LAST, created_at DESC);


--
-- Name: fleet_inspections_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_inspections_status_idx ON public.fleet_inspections USING btree (overall_status, created_at DESC);


--
-- Name: fleet_inspections_vehicle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_inspections_vehicle_idx ON public.fleet_inspections USING btree (vehicle_id, inspection_at DESC);


--
-- Name: fleet_inspections_vehicle_open_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_inspections_vehicle_open_idx ON public.fleet_inspections USING btree (vehicle_id, status, created_at DESC);


--
-- Name: fleet_occurrences_inspection_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fleet_occurrences_inspection_unique_idx ON public.fleet_occurrences USING btree (inspection_id);


--
-- Name: fleet_occurrences_vehicle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_occurrences_vehicle_idx ON public.fleet_occurrences USING btree (vehicle_id, status, created_at DESC);


--
-- Name: fleet_vehicles_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fleet_vehicles_active_idx ON public.fleet_vehicles USING btree (active, status, created_at DESC);


--
-- Name: fleet_vehicles_chassis_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fleet_vehicles_chassis_unique_idx ON public.fleet_vehicles USING btree (lower(btrim(chassis))) WHERE ((chassis IS NOT NULL) AND (char_length(btrim(chassis)) > 0));


--
-- Name: fleet_vehicles_plate_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fleet_vehicles_plate_unique_idx ON public.fleet_vehicles USING btree (lower(btrim(plate)));


--
-- Name: fleet_vehicles_renavam_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fleet_vehicles_renavam_unique_idx ON public.fleet_vehicles USING btree (lower(btrim(renavam))) WHERE ((renavam IS NOT NULL) AND (char_length(btrim(renavam)) > 0));


--
-- Name: idx_assembly_photos_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_photos_product ON public.assembly_photos USING btree (assembly_product_id);


--
-- Name: idx_assembly_products_assembly_route_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_products_assembly_route_id ON public.assembly_products USING btree (assembly_route_id);


--
-- Name: idx_assembly_products_installer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_products_installer_id ON public.assembly_products USING btree (installer_id);


--
-- Name: idx_assembly_products_mount_priority; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_products_mount_priority ON public.assembly_products USING btree (mount_priority);


--
-- Name: idx_assembly_products_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_products_order_id ON public.assembly_products USING btree (order_id);


--
-- Name: idx_assembly_products_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_products_status ON public.assembly_products USING btree (status);


--
-- Name: idx_assembly_routes_assembler; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_routes_assembler ON public.assembly_routes USING btree (assembler_id);


--
-- Name: idx_assembly_routes_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_routes_created_at ON public.assembly_routes USING btree (created_at);


--
-- Name: idx_assembly_routes_route_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_routes_route_code ON public.assembly_routes USING btree (route_code);


--
-- Name: idx_assembly_routes_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_routes_status ON public.assembly_routes USING btree (status);


--
-- Name: idx_assembly_routes_vehicle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assembly_routes_vehicle_id ON public.assembly_routes USING btree (vehicle_id);


--
-- Name: idx_audit_log_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_log_order ON public.order_audit_log USING btree (order_id);


--
-- Name: idx_delivery_photos_route_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_photos_route_order_id ON public.delivery_photos USING btree (route_order_id);


--
-- Name: idx_delivery_receipts_delivered_at_server; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_receipts_delivered_at_server ON public.delivery_receipts USING btree (delivered_at_server DESC);


--
-- Name: idx_delivery_receipts_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_receipts_order_id ON public.delivery_receipts USING btree (order_id);


--
-- Name: idx_delivery_receipts_route_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_receipts_route_id ON public.delivery_receipts USING btree (route_id);


--
-- Name: idx_delivery_receipts_route_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_receipts_route_order_id ON public.delivery_receipts USING btree (route_order_id);


--
-- Name: idx_drivers_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_user_id ON public.drivers USING btree (user_id);


--
-- Name: idx_drivers_vehicle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_vehicle_id ON public.drivers USING btree (vehicle_id);


--
-- Name: idx_item_fulfillment_sync_issues_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_item_fulfillment_sync_issues_order_id ON public.item_fulfillment_sync_issues USING btree (order_id);


--
-- Name: idx_item_fulfillment_sync_issues_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_item_fulfillment_sync_issues_status ON public.item_fulfillment_sync_issues USING btree (status, detected_at DESC);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_sku; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_sku ON public.order_items USING btree (sku);


--
-- Name: idx_order_items_source_present; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_source_present ON public.order_items USING btree (order_id, source_present);


--
-- Name: idx_order_return_items_order_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_return_items_order_item_id ON public.order_return_items USING btree (order_item_id);


--
-- Name: idx_order_return_items_return_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_return_items_return_id ON public.order_return_items USING btree (return_id);


--
-- Name: idx_order_returns_nfe_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_returns_nfe_key ON public.order_returns USING btree (return_nfe_key);


--
-- Name: idx_order_returns_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_returns_order_id ON public.order_returns USING btree (order_id);


--
-- Name: idx_order_returns_pickup_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_returns_pickup_order_id ON public.order_returns USING btree (pickup_order_id) WHERE (pickup_order_id IS NOT NULL);


--
-- Name: idx_order_returns_pickup_queue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_returns_pickup_queue ON public.order_returns USING btree (requires_pickup, pickup_created_at, return_date DESC, created_at DESC);


--
-- Name: idx_order_returns_pickup_route_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_returns_pickup_route_id ON public.order_returns USING btree (pickup_route_id) WHERE (pickup_route_id IS NOT NULL);


--
-- Name: idx_order_returns_processing_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_returns_processing_status ON public.order_returns USING btree (processing_status);


--
-- Name: idx_orders_blocked; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_blocked ON public.orders USING btree (blocked_at) WHERE (blocked_at IS NOT NULL);


--
-- Name: idx_orders_order_id_erp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_order_id_erp ON public.orders USING btree (order_id_erp);


--
-- Name: idx_orders_pickup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_pickup ON public.orders USING btree (requires_pickup, pickup_created_at) WHERE (requires_pickup = true);


--
-- Name: idx_orders_product_commitment_lote_status_sale; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_product_commitment_lote_status_sale ON public.orders USING btree (import_source, status, data_venda) WHERE ((import_source = 'lote'::text) AND (COALESCE(return_flag, false) = false));


--
-- Name: idx_orders_product_commitment_status_sale; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_product_commitment_status_sale ON public.orders USING btree (status, data_venda) WHERE (COALESCE(return_flag, false) = false);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_store_release_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_store_release_status ON public.orders USING btree (requires_store_release, store_release_status);


--
-- Name: idx_route_order_items_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_order_items_order_id ON public.route_order_items USING btree (order_id);


--
-- Name: idx_route_order_items_order_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_order_items_order_item_id ON public.route_order_items USING btree (order_item_id);


--
-- Name: idx_route_order_items_route_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_order_items_route_id ON public.route_order_items USING btree (route_id);


--
-- Name: idx_route_order_items_route_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_order_items_route_order_id ON public.route_order_items USING btree (route_order_id);


--
-- Name: idx_route_orders_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_orders_order_id ON public.route_orders USING btree (order_id);


--
-- Name: idx_route_orders_route_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_orders_route_id ON public.route_orders USING btree (route_id);


--
-- Name: idx_route_orders_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_route_orders_status ON public.route_orders USING btree (status);


--
-- Name: idx_routes_completed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_completed_at ON public.routes USING btree (completed_at);


--
-- Name: idx_routes_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_created_at ON public.routes USING btree (created_at);


--
-- Name: idx_routes_driver_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_driver_id ON public.routes USING btree (driver_id);


--
-- Name: idx_routes_helper_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_helper_id ON public.routes USING btree (helper_id);


--
-- Name: idx_routes_route_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_route_code ON public.routes USING btree (route_code);


--
-- Name: idx_routes_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_status ON public.routes USING btree (status);


--
-- Name: idx_routes_status_completed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_status_completed_at ON public.routes USING btree (status, completed_at);


--
-- Name: idx_routes_team_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_routes_team_id ON public.routes USING btree (team_id);


--
-- Name: idx_teams_user_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_teams_user_active ON public.teams_user USING btree (active);


--
-- Name: idx_teams_user_driver_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_teams_user_driver_user_id ON public.teams_user USING btree (driver_user_id);


--
-- Name: idx_teams_user_helper_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_teams_user_helper_user_id ON public.teams_user USING btree (helper_user_id);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_active ON public.users USING btree (active);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: mdfe_drivers_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mdfe_drivers_active_idx ON public.mdfe_drivers USING btree (active, created_at DESC);


--
-- Name: mdfe_drivers_cpf_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mdfe_drivers_cpf_unique_idx ON public.mdfe_drivers USING btree (regexp_replace(cpf, '\D'::text, ''::text, 'g'::text));


--
-- Name: mdfe_emitters_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mdfe_emitters_active_idx ON public.mdfe_emitters USING btree (active, created_at DESC);


--
-- Name: mdfe_emitters_cnpj_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mdfe_emitters_cnpj_unique_idx ON public.mdfe_emitters USING btree (regexp_replace(cnpj, '\D'::text, ''::text, 'g'::text));


--
-- Name: mdfe_manifest_documents_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mdfe_manifest_documents_order_idx ON public.mdfe_manifest_documents USING btree (order_id, order_id_erp);


--
-- Name: mdfe_manifest_documents_unique_nfe_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mdfe_manifest_documents_unique_nfe_idx ON public.mdfe_manifest_documents USING btree (manifest_id, nfe_key);


--
-- Name: mdfe_manifests_key_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mdfe_manifests_key_unique_idx ON public.mdfe_manifests USING btree (mdfe_key) WHERE (mdfe_key IS NOT NULL);


--
-- Name: mdfe_manifests_route_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mdfe_manifests_route_idx ON public.mdfe_manifests USING btree (route_id, created_at DESC);


--
-- Name: mdfe_manifests_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mdfe_manifests_status_idx ON public.mdfe_manifests USING btree (status, created_at DESC);


--
-- Name: mdfe_vehicles_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mdfe_vehicles_active_idx ON public.mdfe_vehicles USING btree (active, created_at DESC);


--
-- Name: mdfe_vehicles_plate_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mdfe_vehicles_plate_unique_idx ON public.mdfe_vehicles USING btree (lower(btrim(plate)));


--
-- Name: order_returns_pickup_order_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX order_returns_pickup_order_unique ON public.order_returns USING btree (pickup_order_id) WHERE (pickup_order_id IS NOT NULL);


--
-- Name: order_returns_pickup_route_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX order_returns_pickup_route_unique ON public.order_returns USING btree (pickup_route_id) WHERE (pickup_route_id IS NOT NULL);


--
-- Name: order_withdrawals_registered_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_withdrawals_registered_by_idx ON public.order_withdrawals USING btree (registered_by_user_id);


--
-- Name: order_withdrawals_withdrawn_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_withdrawals_withdrawn_at_idx ON public.order_withdrawals USING btree (withdrawn_at DESC);


--
-- Name: orders_filial_venda_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_filial_venda_idx ON public.orders USING btree (filial_venda);


--
-- Name: store_release_assignments_order_location_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX store_release_assignments_order_location_idx ON public.store_release_assignments USING btree (order_id, store_location);


--
-- Name: store_release_assignments_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX store_release_assignments_status_idx ON public.store_release_assignments USING btree (status, store_location);


--
-- Name: store_release_history_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX store_release_history_order_idx ON public.store_release_history USING btree (order_id, acted_at DESC);


--
-- Name: user_store_release_locations_location_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_store_release_locations_location_idx ON public.user_store_release_locations USING btree (store_location);


--
-- Name: user_store_release_locations_user_location_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_store_release_locations_user_location_idx ON public.user_store_release_locations USING btree (user_id, store_location);


--
-- Name: route_orders check_duplicate_routing; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER check_duplicate_routing BEFORE INSERT ON public.route_orders FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_routing();


--
-- Name: orders trg_calculate_deadlines; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_calculate_deadlines BEFORE INSERT OR UPDATE OF data_venda, address_json, tem_frete_full, observacoes_internas ON public.orders FOR EACH ROW EXECUTE FUNCTION public.calculate_order_deadlines();


--
-- Name: carrier_cities trg_carrier_cities_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_carrier_cities_updated_at BEFORE UPDATE ON public.carrier_cities FOR EACH ROW EXECUTE FUNCTION public.set_carrier_cities_updated_at();


--
-- Name: route_orders trg_clear_return_pickup_after_route_order_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_clear_return_pickup_after_route_order_delete AFTER DELETE ON public.route_orders FOR EACH ROW EXECUTE FUNCTION public.clear_return_pickup_after_route_order_delete();


--
-- Name: orders trg_clear_return_pickup_before_order_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_clear_return_pickup_before_order_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.clear_return_pickup_before_parent_delete();


--
-- Name: routes trg_clear_return_pickup_before_route_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_clear_return_pickup_before_route_delete BEFORE DELETE ON public.routes FOR EACH ROW EXECUTE FUNCTION public.clear_return_pickup_before_parent_delete();


--
-- Name: delivery_route_catalog trg_delivery_route_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_delivery_route_catalog_updated_at BEFORE UPDATE ON public.delivery_route_catalog FOR EACH ROW EXECUTE FUNCTION public.set_delivery_route_catalog_updated_at();


--
-- Name: order_return_items trg_flag_order_return_capacity_divergence; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_flag_order_return_capacity_divergence AFTER INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.flag_order_return_capacity_divergence();


--
-- Name: fleet_vehicles trg_fleet_vehicle_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_fleet_vehicle_updated_at BEFORE UPDATE ON public.fleet_vehicles FOR EACH ROW EXECUTE FUNCTION public.set_fleet_vehicle_updated_at();


--
-- Name: mdfe_drivers trg_mdfe_drivers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mdfe_drivers_updated_at BEFORE UPDATE ON public.mdfe_drivers FOR EACH ROW EXECUTE FUNCTION public.set_mdfe_updated_at();


--
-- Name: mdfe_emitters trg_mdfe_emitters_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mdfe_emitters_updated_at BEFORE UPDATE ON public.mdfe_emitters FOR EACH ROW EXECUTE FUNCTION public.set_mdfe_updated_at();


--
-- Name: mdfe_manifests trg_mdfe_manifests_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mdfe_manifests_updated_at BEFORE UPDATE ON public.mdfe_manifests FOR EACH ROW EXECUTE FUNCTION public.set_mdfe_updated_at();


--
-- Name: mdfe_settings trg_mdfe_settings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mdfe_settings_updated_at BEFORE UPDATE ON public.mdfe_settings FOR EACH ROW EXECUTE FUNCTION public.set_mdfe_updated_at();


--
-- Name: mdfe_vehicles trg_mdfe_vehicles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mdfe_vehicles_updated_at BEFORE UPDATE ON public.mdfe_vehicles FOR EACH ROW EXECUTE FUNCTION public.set_mdfe_updated_at();


--
-- Name: order_items trg_order_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_items_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_return_items trg_order_return_items_operational_state_refresh; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_return_items_operational_state_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_item_operational_state_refresh();


--
-- Name: order_return_items trg_order_return_items_snapshot_refresh; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_return_items_snapshot_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_item_snapshot_refresh();


--
-- Name: order_return_items trg_order_return_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_return_items_updated_at BEFORE UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_returns trg_order_returns_operational_state_refresh; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_returns_operational_state_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_operational_state_refresh();


--
-- Name: order_returns trg_order_returns_snapshot_refresh; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_returns_snapshot_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_header_snapshot_refresh();


--
-- Name: order_returns trg_order_returns_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_returns_updated_at BEFORE UPDATE ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_withdrawals trg_order_withdrawals_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_order_withdrawals_updated_at BEFORE UPDATE ON public.order_withdrawals FOR EACH ROW EXECUTE FUNCTION public.set_order_withdrawals_updated_at();


--
-- Name: order_return_items trg_prevent_collected_return_item_changes; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_prevent_collected_return_item_changes BEFORE INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.prevent_collected_return_item_changes();


--
-- Name: routes trg_prevent_route_start_with_return_blockers; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_prevent_route_start_with_return_blockers BEFORE UPDATE OF status ON public.routes FOR EACH ROW EXECUTE FUNCTION public.prevent_route_start_with_return_blockers();


--
-- Name: route_order_items trg_route_order_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_route_order_items_updated_at BEFORE UPDATE ON public.route_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: routes trg_routes_reconcile_returns_after_completion; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_routes_reconcile_returns_after_completion AFTER UPDATE OF status ON public.routes FOR EACH ROW EXECUTE FUNCTION public.reconcile_returns_after_route_completion();


--
-- Name: store_release_assignments trg_store_release_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_store_release_assignments_updated_at BEFORE UPDATE ON public.store_release_assignments FOR EACH ROW EXECUTE FUNCTION public.set_store_release_updated_at();


--
-- Name: user_store_release_locations trg_user_store_release_locations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_user_store_release_locations_updated_at BEFORE UPDATE ON public.user_store_release_locations FOR EACH ROW EXECUTE FUNCTION public.set_store_release_updated_at();


--
-- Name: users trg_users_guard_sensitive_fields; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_users_guard_sensitive_fields BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_guard_sensitive_fields();


--
-- Name: order_returns trg_validate_order_return_before_processing; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_validate_order_return_before_processing BEFORE UPDATE OF processing_status ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.validate_order_return_before_processing();


--
-- Name: users trigger_mark_must_change_password; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_mark_must_change_password BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.mark_new_user_must_change_password();


--
-- Name: route_orders trigger_sync_route_to_order; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_sync_route_to_order AFTER UPDATE ON public.route_orders FOR EACH ROW EXECUTE FUNCTION public.sync_order_status_from_route();


--
-- Name: assembly_products update_assembly_products_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_assembly_products_updated_at BEFORE UPDATE ON public.assembly_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: assembly_routes update_assembly_routes_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_assembly_routes_updated_at BEFORE UPDATE ON public.assembly_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: assembly_photos assembly_photos_assembly_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_photos
    ADD CONSTRAINT assembly_photos_assembly_product_id_fkey FOREIGN KEY (assembly_product_id) REFERENCES public.assembly_products(id) ON DELETE CASCADE;


--
-- Name: assembly_photos assembly_photos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_photos
    ADD CONSTRAINT assembly_photos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: assembly_products assembly_products_assembly_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_assembly_route_id_fkey FOREIGN KEY (assembly_route_id) REFERENCES public.assembly_routes(id) ON DELETE CASCADE;


--
-- Name: assembly_products assembly_products_installer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_installer_id_fkey FOREIGN KEY (installer_id) REFERENCES public.users(id);


--
-- Name: assembly_products assembly_products_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: assembly_routes assembly_routes_assembler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_assembler_id_fkey FOREIGN KEY (assembler_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assembly_routes assembly_routes_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: delivery_photos delivery_photos_route_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_photos
    ADD CONSTRAINT delivery_photos_route_order_id_fkey FOREIGN KEY (route_order_id) REFERENCES public.route_orders(id) ON DELETE CASCADE;


--
-- Name: delivery_receipts delivery_receipts_delivered_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_delivered_by_user_id_fkey FOREIGN KEY (delivered_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: delivery_receipts delivery_receipts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: delivery_receipts delivery_receipts_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: delivery_receipts delivery_receipts_route_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_route_order_id_fkey FOREIGN KEY (route_order_id) REFERENCES public.route_orders(id) ON DELETE CASCADE;


--
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: drivers drivers_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: fleet_inspection_items fleet_inspection_items_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspection_items
    ADD CONSTRAINT fleet_inspection_items_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.fleet_inspections(id) ON DELETE CASCADE;


--
-- Name: fleet_inspection_photos fleet_inspection_photos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspection_photos
    ADD CONSTRAINT fleet_inspection_photos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fleet_inspection_photos fleet_inspection_photos_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspection_photos
    ADD CONSTRAINT fleet_inspection_photos_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.fleet_inspections(id) ON DELETE CASCADE;


--
-- Name: fleet_inspections fleet_inspections_assigned_driver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspections
    ADD CONSTRAINT fleet_inspections_assigned_driver_user_id_fkey FOREIGN KEY (assigned_driver_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: fleet_inspections fleet_inspections_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspections
    ADD CONSTRAINT fleet_inspections_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fleet_inspections fleet_inspections_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspections
    ADD CONSTRAINT fleet_inspections_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fleet_inspections fleet_inspections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspections
    ADD CONSTRAINT fleet_inspections_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fleet_inspections fleet_inspections_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_inspections
    ADD CONSTRAINT fleet_inspections_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.fleet_vehicles(id) ON DELETE RESTRICT;


--
-- Name: fleet_occurrences fleet_occurrences_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_occurrences
    ADD CONSTRAINT fleet_occurrences_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fleet_occurrences fleet_occurrences_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_occurrences
    ADD CONSTRAINT fleet_occurrences_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.fleet_inspections(id) ON DELETE CASCADE;


--
-- Name: fleet_occurrences fleet_occurrences_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_occurrences
    ADD CONSTRAINT fleet_occurrences_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fleet_occurrences fleet_occurrences_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fleet_occurrences
    ADD CONSTRAINT fleet_occurrences_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.fleet_vehicles(id) ON DELETE RESTRICT;


--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;


--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mdfe_manifest_documents mdfe_manifest_documents_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifest_documents
    ADD CONSTRAINT mdfe_manifest_documents_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.mdfe_manifests(id) ON DELETE CASCADE;


--
-- Name: mdfe_manifest_documents mdfe_manifest_documents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifest_documents
    ADD CONSTRAINT mdfe_manifest_documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: mdfe_manifests mdfe_manifests_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifests
    ADD CONSTRAINT mdfe_manifests_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.mdfe_drivers(id) ON DELETE RESTRICT;


--
-- Name: mdfe_manifests mdfe_manifests_emitter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifests
    ADD CONSTRAINT mdfe_manifests_emitter_id_fkey FOREIGN KEY (emitter_id) REFERENCES public.mdfe_emitters(id) ON DELETE RESTRICT;


--
-- Name: mdfe_manifests mdfe_manifests_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifests
    ADD CONSTRAINT mdfe_manifests_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: mdfe_manifests mdfe_manifests_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_manifests
    ADD CONSTRAINT mdfe_manifests_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.mdfe_vehicles(id) ON DELETE RESTRICT;


--
-- Name: mdfe_settings mdfe_settings_default_emitter_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mdfe_settings
    ADD CONSTRAINT mdfe_settings_default_emitter_fk FOREIGN KEY (default_emitter_id) REFERENCES public.mdfe_emitters(id) ON DELETE SET NULL;


--
-- Name: order_audit_log order_audit_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_audit_log order_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_return_items order_return_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE RESTRICT;


--
-- Name: order_return_items order_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.order_returns(id) ON DELETE CASCADE;


--
-- Name: order_returns order_returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_returns order_returns_pickup_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pickup_order_id_fkey FOREIGN KEY (pickup_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: order_returns order_returns_pickup_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pickup_route_id_fkey FOREIGN KEY (pickup_route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: order_withdrawals order_withdrawals_legacy_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_withdrawals
    ADD CONSTRAINT order_withdrawals_legacy_route_id_fkey FOREIGN KEY (legacy_route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: order_withdrawals order_withdrawals_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_withdrawals
    ADD CONSTRAINT order_withdrawals_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_withdrawals order_withdrawals_registered_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_withdrawals
    ADD CONSTRAINT order_withdrawals_registered_by_user_id_fkey FOREIGN KEY (registered_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: route_conference_scans route_conference_scans_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conference_scans
    ADD CONSTRAINT route_conference_scans_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: route_conference_scans route_conference_scans_route_conference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conference_scans
    ADD CONSTRAINT route_conference_scans_route_conference_id_fkey FOREIGN KEY (route_conference_id) REFERENCES public.route_conferences(id) ON DELETE CASCADE;


--
-- Name: route_conferences route_conferences_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: route_conferences route_conferences_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: route_conferences route_conferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: route_order_items route_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: route_order_items route_order_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;


--
-- Name: route_order_items route_order_items_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: route_order_items route_order_items_route_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_route_order_id_fkey FOREIGN KEY (route_order_id) REFERENCES public.route_orders(id) ON DELETE CASCADE;


--
-- Name: route_orders route_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: route_orders route_orders_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: routes routes_conferente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_conferente_id_fkey FOREIGN KEY (conferente_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: routes routes_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: routes routes_helper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_helper_id_fkey FOREIGN KEY (helper_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: routes routes_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams_user(id) ON DELETE SET NULL;


--
-- Name: routes routes_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: store_release_assignments store_release_assignments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_release_assignments
    ADD CONSTRAINT store_release_assignments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: store_release_assignments store_release_assignments_released_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_release_assignments
    ADD CONSTRAINT store_release_assignments_released_by_user_id_fkey FOREIGN KEY (released_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: store_release_history store_release_history_acted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_release_history
    ADD CONSTRAINT store_release_history_acted_by_user_id_fkey FOREIGN KEY (acted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: store_release_history store_release_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_release_history
    ADD CONSTRAINT store_release_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: teams_user teams_user_driver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams_user
    ADD CONSTRAINT teams_user_driver_user_id_fkey FOREIGN KEY (driver_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: teams_user teams_user_helper_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams_user
    ADD CONSTRAINT teams_user_helper_user_id_fkey FOREIGN KEY (helper_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_store_release_locations user_store_release_locations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_store_release_locations
    ADD CONSTRAINT user_store_release_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: assembly_photos Admin acesso total a fotos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin acesso total a fotos" ON public.assembly_photos TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));


--
-- Name: orders Admin can delete orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can delete orders" ON public.orders FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));


--
-- Name: orders Admin can insert orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can insert orders" ON public.orders FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));


--
-- Name: orders Admin can update orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can update orders" ON public.orders FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));


--
-- Name: assembly_products Admins can manage assembly products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins can manage assembly products" ON public.assembly_products USING ((((( SELECT auth.jwt() AS jwt) ->> 'role'::text) = 'service_role'::text) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))));


--
-- Name: assembly_routes Admins can manage assembly routes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins can manage assembly routes" ON public.assembly_routes USING ((((( SELECT auth.jwt() AS jwt) ->> 'role'::text) = 'service_role'::text) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))));


--
-- Name: orders All authenticated users can view orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "All authenticated users can view orders" ON public.orders FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: return_reasons All authenticated users can view return reasons; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "All authenticated users can view return reasons" ON public.return_reasons FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: vehicles All authenticated users can view vehicles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "All authenticated users can view vehicles" ON public.vehicles FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: company_holidays Allow all access for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow all access for authenticated users" ON public.company_holidays USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: delivery_city_rules Allow all access for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow all access for authenticated users" ON public.delivery_city_rules USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: drivers Allow authenticated users to insert drivers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow authenticated users to insert drivers" ON public.drivers FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: drivers Allow authenticated users to read drivers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow authenticated users to read drivers" ON public.drivers FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: orders Allow authenticated users to update orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow authenticated users to update orders" ON public.orders FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: drivers Allow users to update drivers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow users to update drivers" ON public.drivers FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))));


--
-- Name: order_audit_log Authenticated users can insert audit logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can insert audit logs" ON public.order_audit_log FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: order_audit_log Authenticated users can view audit logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can view audit logs" ON public.order_audit_log FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: sync_logs Debug: Allow All Insert Logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Debug: Allow All Insert Logs" ON public.sync_logs FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Debug: Allow All Updates; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Debug: Allow All Updates" ON public.assembly_products FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: operational_diary Enable all access for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable all access for authenticated users" ON public.operational_diary USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: audit_logs Enable all for public; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable all for public" ON public.audit_logs USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text]))) WITH CHECK ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text])));


--
-- Name: orders_backup_20241130 Enable all for public; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable all for public" ON public.orders_backup_20241130 USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text]))) WITH CHECK ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text])));


--
-- Name: teams_user Enable all for public; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable all for public" ON public.teams_user USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text]))) WITH CHECK ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text])));


--
-- Name: assembly_photos Enable delete for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable delete for authenticated users" ON public.assembly_photos FOR DELETE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_photos Enable insert for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable insert for authenticated users" ON public.assembly_photos FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Enable insert for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable insert for authenticated users" ON public.assembly_products FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_routes Enable insert for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable insert for authenticated users" ON public.assembly_routes FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Enable read access for all users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for all users" ON public.assembly_products FOR SELECT USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text])));


--
-- Name: assembly_routes Enable read access for all users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for all users" ON public.assembly_routes FOR SELECT USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text])));


--
-- Name: assembly_photos Enable read access for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for authenticated users" ON public.assembly_photos FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: sync_logs Enable select for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable select for authenticated users" ON public.sync_logs FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Enable update for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable update for authenticated users" ON public.assembly_products FOR UPDATE USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_routes Enable update for authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable update for authenticated users" ON public.assembly_routes FOR UPDATE USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Installers can update their assigned products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Installers can update their assigned products" ON public.assembly_products FOR UPDATE USING ((installer_id = ( SELECT auth.uid() AS uid)));


--
-- Name: assembly_products Installers can view their assigned products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Installers can view their assigned products" ON public.assembly_products FOR SELECT USING ((installer_id = ( SELECT auth.uid() AS uid)));


--
-- Name: assembly_photos Montador atualiza próprias fotos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Montador atualiza próprias fotos" ON public.assembly_photos FOR UPDATE TO authenticated USING ((created_by = ( SELECT auth.uid() AS uid))) WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)));


--
-- Name: assembly_photos Montador insere fotos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Montador insere fotos" ON public.assembly_photos FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.assembly_products ap
  WHERE ((ap.id = assembly_photos.assembly_product_id) AND (ap.installer_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: assembly_photos Montador vê fotos da rota ativa; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Montador vê fotos da rota ativa" ON public.assembly_photos FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.assembly_products ap
     JOIN public.assembly_routes ar ON ((ap.assembly_route_id = ar.id)))
  WHERE ((ap.id = assembly_photos.assembly_product_id) AND (ar.status = ANY (ARRAY['pending'::text, 'assigned'::text, 'in_progress'::text])) AND (ap.installer_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: route_orders Permitir atualização de pedidos em rotas para usuários auten; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir atualização de pedidos em rotas para usuários auten" ON public.route_orders FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Permitir atualização de produtos para admin e montador; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir atualização de produtos para admin e montador" ON public.assembly_products FOR UPDATE USING (((( SELECT auth.uid() AS uid) IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))) OR (( SELECT auth.uid() AS uid) = installer_id)));


--
-- Name: assembly_routes Permitir atualização de rotas para admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir atualização de rotas para admin" ON public.assembly_routes FOR UPDATE USING ((( SELECT auth.uid() AS uid) IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))));


--
-- Name: routes Permitir atualização de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir atualização de rotas para usuários autenticados" ON public.routes FOR UPDATE USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Permitir criação de produtos para admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir criação de produtos para admin" ON public.assembly_products FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))));


--
-- Name: assembly_routes Permitir criação de rotas para admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir criação de rotas para admin" ON public.assembly_routes FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))));


--
-- Name: route_orders Permitir exclusão de pedidos em rotas para usuários autentica; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir exclusão de pedidos em rotas para usuários autentica" ON public.route_orders FOR DELETE USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: routes Permitir exclusão de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir exclusão de rotas para usuários autenticados" ON public.routes FOR DELETE USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: route_orders Permitir inserção de pedidos em rotas para usuários autentic; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir inserção de pedidos em rotas para usuários autentic" ON public.route_orders FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: routes Permitir inserção de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir inserção de rotas para usuários autenticados" ON public.routes FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_products Permitir leitura de produtos para usuários autenticados; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir leitura de produtos para usuários autenticados" ON public.assembly_products FOR SELECT USING ((( SELECT auth.uid() AS uid) IS NOT NULL));


--
-- Name: assembly_routes Permitir leitura de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir leitura de rotas para usuários autenticados" ON public.assembly_routes FOR SELECT USING ((( SELECT auth.uid() AS uid) IS NOT NULL));


--
-- Name: route_orders Permitir visualização de pedidos em rotas para usuários aute; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir visualização de pedidos em rotas para usuários aute" ON public.route_orders FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: routes Permitir visualização de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Permitir visualização de rotas para usuários autenticados" ON public.routes FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: delivery_photos Users can delete delivery photos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete delivery photos" ON public.delivery_photos FOR DELETE USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: delivery_photos Users can insert delivery photos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert delivery photos" ON public.delivery_photos FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: delivery_photos Users can update their own delivery photos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own delivery photos" ON public.delivery_photos FOR UPDATE USING ((( SELECT auth.uid() AS uid) = created_by));


--
-- Name: delivery_photos Users can view all delivery photos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view all delivery photos" ON public.delivery_photos FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: orders Users can view orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view orders" ON public.orders FOR SELECT USING ((( SELECT auth.uid() AS uid) IS NOT NULL));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_modify_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY app_settings_modify_admin ON public.app_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));


--
-- Name: app_settings app_settings_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY app_settings_select_authenticated ON public.app_settings FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: assembly_photos; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assembly_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: assembly_products; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assembly_products ENABLE ROW LEVEL SECURITY;

--
-- Name: assembly_routes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assembly_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: carrier_cities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.carrier_cities ENABLE ROW LEVEL SECURITY;

--
-- Name: carrier_cities carrier_cities_insert_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY carrier_cities_insert_admin ON public.carrier_cities FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: carrier_cities carrier_cities_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY carrier_cities_select_authenticated ON public.carrier_cities FOR SELECT TO authenticated USING (true);


--
-- Name: carrier_cities carrier_cities_update_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY carrier_cities_update_admin ON public.carrier_cities FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: company_holidays; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_city_rules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.delivery_city_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_photos; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.delivery_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_receipts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_receipts delivery_receipts_insert_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_receipts_insert_admin ON public.delivery_receipts FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));


--
-- Name: delivery_receipts delivery_receipts_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_receipts_insert_own ON public.delivery_receipts FOR INSERT TO authenticated WITH CHECK ((delivered_by_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: delivery_receipts delivery_receipts_select_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_receipts_select_admin ON public.delivery_receipts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));


--
-- Name: delivery_receipts delivery_receipts_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_receipts_select_own ON public.delivery_receipts FOR SELECT TO authenticated USING ((delivered_by_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: delivery_route_catalog; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.delivery_route_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_route_catalog delivery_route_catalog_insert_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_route_catalog_insert_authenticated ON public.delivery_route_catalog FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: delivery_route_catalog delivery_route_catalog_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_route_catalog_select_authenticated ON public.delivery_route_catalog FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: delivery_route_catalog delivery_route_catalog_update_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY delivery_route_catalog_update_authenticated ON public.delivery_route_catalog FOR UPDATE USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: drivers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

--
-- Name: route_orders enable_update_for_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY enable_update_for_authenticated ON public.route_orders FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: fleet_inspection_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.fleet_inspection_items ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_inspection_items fleet_inspection_items_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspection_items_admin_insert ON public.fleet_inspection_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_inspection_items fleet_inspection_items_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspection_items_admin_select ON public.fleet_inspection_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_inspection_items fleet_inspection_items_driver_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspection_items_driver_select ON public.fleet_inspection_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.fleet_inspections fi
  WHERE ((fi.id = fleet_inspection_items.inspection_id) AND (fi.assigned_driver_user_id = auth.uid())))));


--
-- Name: fleet_inspection_photos; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.fleet_inspection_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_inspection_photos fleet_inspection_photos_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspection_photos_admin_insert ON public.fleet_inspection_photos FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_inspection_photos fleet_inspection_photos_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspection_photos_admin_select ON public.fleet_inspection_photos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_inspection_photos fleet_inspection_photos_driver_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspection_photos_driver_select ON public.fleet_inspection_photos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.fleet_inspections fi
  WHERE ((fi.id = fleet_inspection_photos.inspection_id) AND (fi.assigned_driver_user_id = auth.uid())))));


--
-- Name: fleet_inspections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.fleet_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_inspections fleet_inspections_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspections_admin_insert ON public.fleet_inspections FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_inspections fleet_inspections_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspections_admin_select ON public.fleet_inspections FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_inspections fleet_inspections_driver_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_inspections_driver_select ON public.fleet_inspections FOR SELECT USING ((assigned_driver_user_id = auth.uid()));


--
-- Name: fleet_occurrences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.fleet_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_occurrences fleet_occurrences_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_occurrences_admin_insert ON public.fleet_occurrences FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_occurrences fleet_occurrences_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_occurrences_admin_select ON public.fleet_occurrences FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_occurrences fleet_occurrences_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_occurrences_admin_update ON public.fleet_occurrences FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_vehicles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_vehicles fleet_vehicles_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_vehicles_admin_insert ON public.fleet_vehicles FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_vehicles fleet_vehicles_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_vehicles_admin_select ON public.fleet_vehicles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: fleet_vehicles fleet_vehicles_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY fleet_vehicles_admin_update ON public.fleet_vehicles FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: item_fulfillment_sync_issues; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.item_fulfillment_sync_issues ENABLE ROW LEVEL SECURITY;

--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_select_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY item_fulfillment_sync_issues_select_admin ON public.item_fulfillment_sync_issues FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_drivers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mdfe_drivers ENABLE ROW LEVEL SECURITY;

--
-- Name: mdfe_drivers mdfe_drivers_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_drivers_admin_insert ON public.mdfe_drivers FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_drivers mdfe_drivers_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_drivers_admin_select ON public.mdfe_drivers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_drivers mdfe_drivers_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_drivers_admin_update ON public.mdfe_drivers FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_emitters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mdfe_emitters ENABLE ROW LEVEL SECURITY;

--
-- Name: mdfe_emitters mdfe_emitters_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_emitters_admin_insert ON public.mdfe_emitters FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_emitters mdfe_emitters_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_emitters_admin_select ON public.mdfe_emitters FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_emitters mdfe_emitters_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_emitters_admin_update ON public.mdfe_emitters FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_manifest_documents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mdfe_manifest_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: mdfe_manifest_documents mdfe_manifest_documents_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_manifest_documents_admin_insert ON public.mdfe_manifest_documents FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_manifest_documents mdfe_manifest_documents_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_manifest_documents_admin_select ON public.mdfe_manifest_documents FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_manifest_documents mdfe_manifest_documents_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_manifest_documents_admin_update ON public.mdfe_manifest_documents FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_manifests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mdfe_manifests ENABLE ROW LEVEL SECURITY;

--
-- Name: mdfe_manifests mdfe_manifests_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_manifests_admin_insert ON public.mdfe_manifests FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_manifests mdfe_manifests_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_manifests_admin_select ON public.mdfe_manifests FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_manifests mdfe_manifests_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_manifests_admin_update ON public.mdfe_manifests FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mdfe_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: mdfe_settings mdfe_settings_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_settings_admin_insert ON public.mdfe_settings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_settings mdfe_settings_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_settings_admin_select ON public.mdfe_settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_settings mdfe_settings_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_settings_admin_update ON public.mdfe_settings FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_vehicles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mdfe_vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: mdfe_vehicles mdfe_vehicles_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_vehicles_admin_insert ON public.mdfe_vehicles FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_vehicles mdfe_vehicles_admin_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_vehicles_admin_select ON public.mdfe_vehicles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: mdfe_vehicles mdfe_vehicles_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mdfe_vehicles_admin_update ON public.mdfe_vehicles FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: operational_diary; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.operational_diary ENABLE ROW LEVEL SECURITY;

--
-- Name: order_audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items order_items_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_items_select_authenticated ON public.order_items FOR SELECT TO authenticated USING (true);


--
-- Name: order_return_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_return_items order_return_items_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_return_items_select_authenticated ON public.order_return_items FOR SELECT TO authenticated USING (true);


--
-- Name: order_returns; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: order_returns order_returns_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_returns_select_authenticated ON public.order_returns FOR SELECT TO authenticated USING (true);


--
-- Name: order_withdrawals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_withdrawals ENABLE ROW LEVEL SECURITY;

--
-- Name: order_withdrawals order_withdrawals_insert_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_withdrawals_insert_authenticated ON public.order_withdrawals FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: order_withdrawals order_withdrawals_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_withdrawals_select_authenticated ON public.order_withdrawals FOR SELECT TO authenticated USING (true);


--
-- Name: order_withdrawals order_withdrawals_update_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_withdrawals_update_authenticated ON public.order_withdrawals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders_backup_20241130; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.orders_backup_20241130 ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_update_driver_delivered; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY orders_update_driver_delivered ON public.orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.route_orders ro
     JOIN public.routes r ON ((ro.route_id = r.id)))
     JOIN public.drivers d ON ((r.driver_id = d.id)))
  WHERE ((ro.order_id = orders.id) AND (d.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK (((status = 'delivered'::text) OR (status = 'assigned'::text) OR (status = 'pending'::text)));


--
-- Name: orders orders_update_driver_returned; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY orders_update_driver_returned ON public.orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.route_orders ro
     JOIN public.routes r ON ((ro.route_id = r.id)))
     JOIN public.drivers d ON ((r.driver_id = d.id)))
  WHERE ((ro.order_id = orders.id) AND (d.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK (((status = 'pending'::text) AND (return_flag = true)));


--
-- Name: route_conferences rc_insert_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rc_insert_authenticated ON public.route_conferences FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: route_conferences rc_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rc_select_authenticated ON public.route_conferences FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: route_conferences rc_update_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rc_update_admin ON public.route_conferences FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));


--
-- Name: route_conferences rc_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rc_update_own ON public.route_conferences FOR UPDATE USING (((( SELECT auth.role() AS role) = 'authenticated'::text) AND (user_id = ( SELECT auth.uid() AS uid)))) WITH CHECK (((( SELECT auth.role() AS role) = 'authenticated'::text) AND (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: route_conference_scans rcs_insert_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rcs_insert_authenticated ON public.route_conference_scans FOR INSERT WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: route_conference_scans rcs_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rcs_select_authenticated ON public.route_conference_scans FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: return_reasons; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.return_reasons ENABLE ROW LEVEL SECURITY;

--
-- Name: route_conference_scans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.route_conference_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: route_conferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.route_conferences ENABLE ROW LEVEL SECURITY;

--
-- Name: route_order_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.route_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: route_order_items route_order_items_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY route_order_items_select_authenticated ON public.route_order_items FOR SELECT TO authenticated USING (true);


--
-- Name: route_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.route_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: route_orders route_orders_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY route_orders_select_authenticated ON public.route_orders FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: route_orders route_orders_select_driver; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY route_orders_select_driver ON public.route_orders FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.routes r
     JOIN public.drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: route_orders route_orders_update_driver; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY route_orders_update_driver ON public.route_orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.routes r
     JOIN public.drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.routes r
     JOIN public.drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: routes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

--
-- Name: routes routes_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY routes_select_authenticated ON public.routes FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: routes routes_update_driver; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY routes_update_driver ON public.routes FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.drivers d
  WHERE ((d.id = routes.driver_id) AND (d.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.drivers d
  WHERE ((d.id = routes.driver_id) AND (d.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: store_release_assignments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.store_release_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: store_release_assignments store_release_assignments_select_policy; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY store_release_assignments_select_policy ON public.store_release_assignments FOR SELECT TO authenticated USING (true);


--
-- Name: store_release_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.store_release_history ENABLE ROW LEVEL SECURITY;

--
-- Name: store_release_history store_release_history_select_policy; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY store_release_history_select_policy ON public.store_release_history FOR SELECT TO authenticated USING (true);


--
-- Name: sync_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: teams_user; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.teams_user ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences upsert_own_prefs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY upsert_own_prefs ON public.user_preferences USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_store_release_locations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_store_release_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: user_store_release_locations user_store_release_locations_modify_admin_policy; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY user_store_release_locations_modify_admin_policy ON public.user_store_release_locations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: user_store_release_locations user_store_release_locations_select_policy; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY user_store_release_locations_select_policy ON public.user_store_release_locations FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_delete_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_delete_admin ON public.users FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: users users_insert_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_insert_admin ON public.users FOR INSERT TO authenticated WITH CHECK (public.is_admin());


--
-- Name: users users_insert_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_insert_self ON public.users FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: users users_select_self_or_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_select_self_or_admin ON public.users FOR SELECT TO authenticated USING (((auth.uid() = id) OR public.is_admin()));


--
-- Name: users users_update_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_update_admin ON public.users FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: users users_update_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles vehicles_insert_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY vehicles_insert_admin ON public.vehicles FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));


--
-- Name: vehicles vehicles_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY vehicles_select_authenticated ON public.vehicles FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: vehicles vehicles_update_admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY vehicles_update_admin ON public.vehicles FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));


--
-- Name: webhook_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.webhook_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_settings webhook_settings_modify_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY webhook_settings_modify_authenticated ON public.webhook_settings TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: webhook_settings webhook_settings_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY webhook_settings_select_authenticated ON public.webhook_settings FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION add_business_days(start_date timestamp with time zone, days integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.add_business_days(start_date timestamp with time zone, days integer) TO anon;
GRANT ALL ON FUNCTION public.add_business_days(start_date timestamp with time zone, days integer) TO authenticated;
GRANT ALL ON FUNCTION public.add_business_days(start_date timestamp with time zone, days integer) TO service_role;


--
-- Name: FUNCTION add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text) TO anon;
GRANT ALL ON FUNCTION public.add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text) TO authenticated;
GRANT ALL ON FUNCTION public.add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text) TO service_role;


--
-- Name: FUNCTION admin_create_helper(p_name text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.admin_create_helper(p_name text) TO anon;
GRANT ALL ON FUNCTION public.admin_create_helper(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_create_helper(p_name text) TO service_role;


--
-- Name: FUNCTION admin_create_user(p_id uuid, p_email text, p_name text, p_role text, p_must_change_password boolean); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.admin_create_user(p_id uuid, p_email text, p_name text, p_role text, p_must_change_password boolean) TO anon;
GRANT ALL ON FUNCTION public.admin_create_user(p_id uuid, p_email text, p_name text, p_role text, p_must_change_password boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_create_user(p_id uuid, p_email text, p_name text, p_role text, p_must_change_password boolean) TO service_role;


--
-- Name: FUNCTION calculate_order_deadlines(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.calculate_order_deadlines() TO anon;
GRANT ALL ON FUNCTION public.calculate_order_deadlines() TO authenticated;
GRANT ALL ON FUNCTION public.calculate_order_deadlines() TO service_role;


--
-- Name: FUNCTION cancel_fleet_inspection(p_inspection_id uuid, p_reason text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.cancel_fleet_inspection(p_inspection_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.cancel_fleet_inspection(p_inspection_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_fleet_inspection(p_inspection_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) TO anon;
GRANT ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) TO service_role;


--
-- Name: FUNCTION clear_return_pickup_after_route_order_delete(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.clear_return_pickup_after_route_order_delete() TO anon;
GRANT ALL ON FUNCTION public.clear_return_pickup_after_route_order_delete() TO authenticated;
GRANT ALL ON FUNCTION public.clear_return_pickup_after_route_order_delete() TO service_role;


--
-- Name: FUNCTION clear_return_pickup_before_parent_delete(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.clear_return_pickup_before_parent_delete() TO anon;
GRANT ALL ON FUNCTION public.clear_return_pickup_before_parent_delete() TO authenticated;
GRANT ALL ON FUNCTION public.clear_return_pickup_before_parent_delete() TO service_role;


--
-- Name: FUNCTION create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) TO anon;
GRANT ALL ON FUNCTION public.create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_fleet_inspection(p_inspection_id uuid, p_vehicle_id uuid, p_inspection_at timestamp with time zone, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) TO service_role;


--
-- Name: FUNCTION create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone, p_general_notes text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone, p_general_notes text) TO anon;
GRANT ALL ON FUNCTION public.create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone, p_general_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.create_fleet_inspection_assignment(p_vehicle_id uuid, p_assigned_driver_user_id uuid, p_scheduled_at timestamp with time zone, p_general_notes text) TO service_role;


--
-- Name: FUNCTION flag_order_return_capacity_divergence(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.flag_order_return_capacity_divergence() TO anon;
GRANT ALL ON FUNCTION public.flag_order_return_capacity_divergence() TO authenticated;
GRANT ALL ON FUNCTION public.flag_order_return_capacity_divergence() TO service_role;


--
-- Name: FUNCTION get_duplicate_orders(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_duplicate_orders() TO anon;
GRANT ALL ON FUNCTION public.get_duplicate_orders() TO authenticated;
GRANT ALL ON FUNCTION public.get_duplicate_orders() TO service_role;


--
-- Name: FUNCTION get_import_history_summary(p_search text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_import_history_summary(p_search text, p_limit integer, p_offset integer) TO anon;
GRANT ALL ON FUNCTION public.get_import_history_summary(p_search text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_import_history_summary(p_search text, p_limit integer, p_offset integer) TO service_role;


--
-- Name: FUNCTION get_item_fulfillment_shadow_diagnostics(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() TO anon;
GRANT ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() TO authenticated;
GRANT ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: FUNCTION get_missing_assembly_orders(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_missing_assembly_orders() TO anon;
GRANT ALL ON FUNCTION public.get_missing_assembly_orders() TO authenticated;
GRANT ALL ON FUNCTION public.get_missing_assembly_orders() TO service_role;


--
-- Name: FUNCTION get_order_public(p_order_number text, p_cpf text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_order_public(p_order_number text, p_cpf text) TO anon;
GRANT ALL ON FUNCTION public.get_order_public(p_order_number text, p_cpf text) TO authenticated;
GRANT ALL ON FUNCTION public.get_order_public(p_order_number text, p_cpf text) TO service_role;


--
-- Name: FUNCTION get_order_return_capacity_violation(p_return_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) TO service_role;


--
-- Name: FUNCTION get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer) TO anon;
GRANT ALL ON FUNCTION public.get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_product_commitment_report(p_search text, p_sale_start date, p_sale_end date, p_situations text[], p_storage_locations text[], p_page integer, p_page_size integer) TO service_role;


--
-- Name: FUNCTION get_product_commitment_storage_locations(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_product_commitment_storage_locations() TO anon;
GRANT ALL ON FUNCTION public.get_product_commitment_storage_locations() TO authenticated;
GRANT ALL ON FUNCTION public.get_product_commitment_storage_locations() TO service_role;


--
-- Name: FUNCTION get_route_duplicates(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_route_duplicates() TO anon;
GRANT ALL ON FUNCTION public.get_route_duplicates() TO authenticated;
GRANT ALL ON FUNCTION public.get_route_duplicates() TO service_role;


--
-- Name: FUNCTION get_route_start_return_blockers(p_route_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) TO service_role;


--
-- Name: FUNCTION get_users_names_by_ids(p_user_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_users_names_by_ids(p_user_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.get_users_names_by_ids(p_user_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_users_names_by_ids(p_user_ids uuid[]) TO service_role;


--
-- Name: FUNCTION handle_order_return_header_snapshot_refresh(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() TO anon;
GRANT ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() TO service_role;


--
-- Name: FUNCTION handle_order_return_item_operational_state_refresh(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() TO anon;
GRANT ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() TO service_role;


--
-- Name: FUNCTION handle_order_return_item_snapshot_refresh(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() TO anon;
GRANT ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() TO service_role;


--
-- Name: FUNCTION handle_order_return_operational_state_refresh(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_order_return_operational_state_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_operational_state_refresh() TO anon;
GRANT ALL ON FUNCTION public.handle_order_return_operational_state_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_operational_state_refresh() TO service_role;


--
-- Name: FUNCTION insert_vehicle(p_model text, p_plate text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.insert_vehicle(p_model text, p_plate text) TO anon;
GRANT ALL ON FUNCTION public.insert_vehicle(p_model text, p_plate text) TO authenticated;
GRANT ALL ON FUNCTION public.insert_vehicle(p_model text, p_plate text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_rural_address(address_json jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_rural_address(address_json jsonb) TO anon;
GRANT ALL ON FUNCTION public.is_rural_address(address_json jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.is_rural_address(address_json jsonb) TO service_role;


--
-- Name: FUNCTION item_fulfillment_can_manage(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.item_fulfillment_can_manage() FROM PUBLIC;
GRANT ALL ON FUNCTION public.item_fulfillment_can_manage() TO anon;
GRANT ALL ON FUNCTION public.item_fulfillment_can_manage() TO authenticated;
GRANT ALL ON FUNCTION public.item_fulfillment_can_manage() TO service_role;


--
-- Name: FUNCTION list_drivers(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.list_drivers() TO anon;
GRANT ALL ON FUNCTION public.list_drivers() TO authenticated;
GRANT ALL ON FUNCTION public.list_drivers() TO service_role;


--
-- Name: FUNCTION mark_new_user_must_change_password(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.mark_new_user_must_change_password() TO anon;
GRANT ALL ON FUNCTION public.mark_new_user_must_change_password() TO authenticated;
GRANT ALL ON FUNCTION public.mark_new_user_must_change_password() TO service_role;


--
-- Name: FUNCTION normalize_store_release_location(p_value text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.normalize_store_release_location(p_value text) TO anon;
GRANT ALL ON FUNCTION public.normalize_store_release_location(p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.normalize_store_release_location(p_value text) TO service_role;


--
-- Name: FUNCTION order_item_payload_requires_assembly(p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) TO anon;
GRANT ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) TO service_role;


--
-- Name: FUNCTION prevent_collected_return_item_changes(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.prevent_collected_return_item_changes() TO anon;
GRANT ALL ON FUNCTION public.prevent_collected_return_item_changes() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_collected_return_item_changes() TO service_role;


--
-- Name: FUNCTION prevent_duplicate_routing(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.prevent_duplicate_routing() TO anon;
GRANT ALL ON FUNCTION public.prevent_duplicate_routing() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_duplicate_routing() TO service_role;


--
-- Name: FUNCTION prevent_route_start_with_return_blockers(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.prevent_route_start_with_return_blockers() TO anon;
GRANT ALL ON FUNCTION public.prevent_route_start_with_return_blockers() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_route_start_with_return_blockers() TO service_role;


--
-- Name: FUNCTION reconcile_order_return_state(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION reconcile_returns_after_route_completion(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.reconcile_returns_after_route_completion() TO anon;
GRANT ALL ON FUNCTION public.reconcile_returns_after_route_completion() TO authenticated;
GRANT ALL ON FUNCTION public.reconcile_returns_after_route_completion() TO service_role;


--
-- Name: FUNCTION register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION resolve_login_email(identifier text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.resolve_login_email(identifier text) TO anon;
GRANT ALL ON FUNCTION public.resolve_login_email(identifier text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_login_email(identifier text) TO service_role;


--
-- Name: FUNCTION resync_open_route_order_item_snapshots_for_order(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION search_assembly_candidates(p_search_term text, p_city_filter text[], p_neighborhood_filter text[], p_page integer, p_page_size integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.search_assembly_candidates(p_search_term text, p_city_filter text[], p_neighborhood_filter text[], p_page integer, p_page_size integer) TO anon;
GRANT ALL ON FUNCTION public.search_assembly_candidates(p_search_term text, p_city_filter text[], p_neighborhood_filter text[], p_page integer, p_page_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_assembly_candidates(p_search_term text, p_city_filter text[], p_neighborhood_filter text[], p_page integer, p_page_size integer) TO service_role;


--
-- Name: FUNCTION search_delivery_candidates(p_search_term text, p_status_filter text[], p_city_filter text[], p_neighborhood_filter text[], p_date_start text, p_date_end text, p_page integer, p_page_size integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.search_delivery_candidates(p_search_term text, p_status_filter text[], p_city_filter text[], p_neighborhood_filter text[], p_date_start text, p_date_end text, p_page integer, p_page_size integer) TO anon;
GRANT ALL ON FUNCTION public.search_delivery_candidates(p_search_term text, p_status_filter text[], p_city_filter text[], p_neighborhood_filter text[], p_date_start text, p_date_end text, p_page integer, p_page_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_delivery_candidates(p_search_term text, p_status_filter text[], p_city_filter text[], p_neighborhood_filter text[], p_date_start text, p_date_end text, p_page integer, p_page_size integer) TO service_role;


--
-- Name: FUNCTION set_carrier_cities_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_carrier_cities_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_carrier_cities_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_carrier_cities_updated_at() TO service_role;


--
-- Name: FUNCTION set_delivery_route_catalog_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_delivery_route_catalog_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_delivery_route_catalog_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_delivery_route_catalog_updated_at() TO service_role;


--
-- Name: FUNCTION set_fleet_vehicle_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_fleet_vehicle_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_fleet_vehicle_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_fleet_vehicle_updated_at() TO service_role;


--
-- Name: FUNCTION set_mdfe_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_mdfe_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_mdfe_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_mdfe_updated_at() TO service_role;


--
-- Name: FUNCTION set_order_withdrawals_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_order_withdrawals_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_order_withdrawals_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_order_withdrawals_updated_at() TO service_role;


--
-- Name: FUNCTION set_store_release_assignment(p_order_id uuid, p_store_location text, p_released boolean, p_notes text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_store_release_assignment(p_order_id uuid, p_store_location text, p_released boolean, p_notes text) TO anon;
GRANT ALL ON FUNCTION public.set_store_release_assignment(p_order_id uuid, p_store_location text, p_released boolean, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.set_store_release_assignment(p_order_id uuid, p_store_location text, p_released boolean, p_notes text) TO service_role;


--
-- Name: FUNCTION set_store_release_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_store_release_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_store_release_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_store_release_updated_at() TO service_role;


--
-- Name: FUNCTION simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) TO service_role;


--
-- Name: FUNCTION start_fleet_inspection(p_inspection_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.start_fleet_inspection(p_inspection_id uuid) TO anon;
GRANT ALL ON FUNCTION public.start_fleet_inspection(p_inspection_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.start_fleet_inspection(p_inspection_id uuid) TO service_role;


--
-- Name: FUNCTION store_release_is_truthy(p_value text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.store_release_is_truthy(p_value text) TO anon;
GRANT ALL ON FUNCTION public.store_release_is_truthy(p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.store_release_is_truthy(p_value text) TO service_role;


--
-- Name: FUNCTION store_release_location_is_controlled(p_value text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.store_release_location_is_controlled(p_value text) TO anon;
GRANT ALL ON FUNCTION public.store_release_location_is_controlled(p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.store_release_location_is_controlled(p_value text) TO service_role;


--
-- Name: FUNCTION submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) TO anon;
GRANT ALL ON FUNCTION public.submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.submit_fleet_inspection(p_inspection_id uuid, p_odometer bigint, p_general_notes text, p_items jsonb, p_photos jsonb) TO service_role;


--
-- Name: FUNCTION sync_all_order_items_shadow(p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) TO service_role;


--
-- Name: FUNCTION sync_assembly_products_with_returns(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION sync_missing_assembly_products_for_order(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION sync_missing_assembly_products_for_pickup(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION sync_missing_assembly_products_for_route(p_route_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_route(p_route_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_route(p_route_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_route(p_route_id uuid) TO service_role;


--
-- Name: FUNCTION sync_order_items_shadow(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION sync_order_return_operational_state(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION sync_order_status_from_route(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_order_status_from_route() TO anon;
GRANT ALL ON FUNCTION public.sync_order_status_from_route() TO authenticated;
GRANT ALL ON FUNCTION public.sync_order_status_from_route() TO service_role;


--
-- Name: FUNCTION sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) TO service_role;


--
-- Name: FUNCTION sync_route_order_item_snapshots_system(p_route_order_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) TO service_role;


--
-- Name: FUNCTION sync_store_release_for_open_orders(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_store_release_for_open_orders() TO anon;
GRANT ALL ON FUNCTION public.sync_store_release_for_open_orders() TO authenticated;
GRANT ALL ON FUNCTION public.sync_store_release_for_open_orders() TO service_role;


--
-- Name: FUNCTION sync_store_release_for_order(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_store_release_for_order(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sync_store_release_for_order(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_store_release_for_order(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION sync_store_release_for_orders(p_order_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_store_release_for_orders(p_order_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.sync_store_release_for_orders(p_order_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_store_release_for_orders(p_order_ids uuid[]) TO service_role;


--
-- Name: FUNCTION update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text) TO anon;
GRANT ALL ON FUNCTION public.update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.update_fleet_occurrence_status(p_occurrence_id uuid, p_new_status text, p_resolution_notes text) TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION users_guard_sensitive_fields(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.users_guard_sensitive_fields() TO anon;
GRANT ALL ON FUNCTION public.users_guard_sensitive_fields() TO authenticated;
GRANT ALL ON FUNCTION public.users_guard_sensitive_fields() TO service_role;


--
-- Name: FUNCTION validate_order_return_before_processing(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.validate_order_return_before_processing() TO anon;
GRANT ALL ON FUNCTION public.validate_order_return_before_processing() TO authenticated;
GRANT ALL ON FUNCTION public.validate_order_return_before_processing() TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.app_settings TO anon;
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE assembly_photos; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assembly_photos TO anon;
GRANT ALL ON TABLE public.assembly_photos TO authenticated;
GRANT ALL ON TABLE public.assembly_photos TO service_role;


--
-- Name: TABLE assembly_products; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assembly_products TO anon;
GRANT ALL ON TABLE public.assembly_products TO authenticated;
GRANT ALL ON TABLE public.assembly_products TO service_role;


--
-- Name: TABLE assembly_routes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assembly_routes TO anon;
GRANT ALL ON TABLE public.assembly_routes TO authenticated;
GRANT ALL ON TABLE public.assembly_routes TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE carrier_cities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.carrier_cities TO anon;
GRANT ALL ON TABLE public.carrier_cities TO authenticated;
GRANT ALL ON TABLE public.carrier_cities TO service_role;


--
-- Name: TABLE company_holidays; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.company_holidays TO anon;
GRANT ALL ON TABLE public.company_holidays TO authenticated;
GRANT ALL ON TABLE public.company_holidays TO service_role;


--
-- Name: TABLE delivery_city_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.delivery_city_rules TO anon;
GRANT ALL ON TABLE public.delivery_city_rules TO authenticated;
GRANT ALL ON TABLE public.delivery_city_rules TO service_role;


--
-- Name: TABLE delivery_photos; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.delivery_photos TO anon;
GRANT ALL ON TABLE public.delivery_photos TO authenticated;
GRANT ALL ON TABLE public.delivery_photos TO service_role;


--
-- Name: TABLE delivery_receipts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.delivery_receipts TO anon;
GRANT ALL ON TABLE public.delivery_receipts TO authenticated;
GRANT ALL ON TABLE public.delivery_receipts TO service_role;


--
-- Name: TABLE delivery_route_catalog; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.delivery_route_catalog TO anon;
GRANT ALL ON TABLE public.delivery_route_catalog TO authenticated;
GRANT ALL ON TABLE public.delivery_route_catalog TO service_role;


--
-- Name: TABLE drivers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.drivers TO anon;
GRANT ALL ON TABLE public.drivers TO authenticated;
GRANT ALL ON TABLE public.drivers TO service_role;


--
-- Name: TABLE fleet_inspection_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fleet_inspection_items TO anon;
GRANT ALL ON TABLE public.fleet_inspection_items TO authenticated;
GRANT ALL ON TABLE public.fleet_inspection_items TO service_role;


--
-- Name: TABLE fleet_inspection_photos; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fleet_inspection_photos TO anon;
GRANT ALL ON TABLE public.fleet_inspection_photos TO authenticated;
GRANT ALL ON TABLE public.fleet_inspection_photos TO service_role;


--
-- Name: TABLE fleet_inspections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fleet_inspections TO anon;
GRANT ALL ON TABLE public.fleet_inspections TO authenticated;
GRANT ALL ON TABLE public.fleet_inspections TO service_role;


--
-- Name: TABLE fleet_occurrences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fleet_occurrences TO anon;
GRANT ALL ON TABLE public.fleet_occurrences TO authenticated;
GRANT ALL ON TABLE public.fleet_occurrences TO service_role;


--
-- Name: TABLE fleet_vehicles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fleet_vehicles TO anon;
GRANT ALL ON TABLE public.fleet_vehicles TO authenticated;
GRANT ALL ON TABLE public.fleet_vehicles TO service_role;


--
-- Name: TABLE item_fulfillment_sync_issues; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.item_fulfillment_sync_issues TO anon;
GRANT ALL ON TABLE public.item_fulfillment_sync_issues TO authenticated;
GRANT ALL ON TABLE public.item_fulfillment_sync_issues TO service_role;


--
-- Name: TABLE route_conferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.route_conferences TO anon;
GRANT ALL ON TABLE public.route_conferences TO authenticated;
GRANT ALL ON TABLE public.route_conferences TO service_role;


--
-- Name: TABLE latest_route_conferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.latest_route_conferences TO anon;
GRANT ALL ON TABLE public.latest_route_conferences TO authenticated;
GRANT ALL ON TABLE public.latest_route_conferences TO service_role;


--
-- Name: TABLE mdfe_drivers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mdfe_drivers TO anon;
GRANT ALL ON TABLE public.mdfe_drivers TO authenticated;
GRANT ALL ON TABLE public.mdfe_drivers TO service_role;


--
-- Name: TABLE mdfe_emitters; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mdfe_emitters TO anon;
GRANT ALL ON TABLE public.mdfe_emitters TO authenticated;
GRANT ALL ON TABLE public.mdfe_emitters TO service_role;


--
-- Name: TABLE mdfe_manifest_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mdfe_manifest_documents TO anon;
GRANT ALL ON TABLE public.mdfe_manifest_documents TO authenticated;
GRANT ALL ON TABLE public.mdfe_manifest_documents TO service_role;


--
-- Name: TABLE mdfe_manifests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mdfe_manifests TO anon;
GRANT ALL ON TABLE public.mdfe_manifests TO authenticated;
GRANT ALL ON TABLE public.mdfe_manifests TO service_role;


--
-- Name: TABLE mdfe_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mdfe_settings TO anon;
GRANT ALL ON TABLE public.mdfe_settings TO authenticated;
GRANT ALL ON TABLE public.mdfe_settings TO service_role;


--
-- Name: TABLE mdfe_vehicles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mdfe_vehicles TO anon;
GRANT ALL ON TABLE public.mdfe_vehicles TO authenticated;
GRANT ALL ON TABLE public.mdfe_vehicles TO service_role;


--
-- Name: TABLE operational_diary; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operational_diary TO anon;
GRANT ALL ON TABLE public.operational_diary TO authenticated;
GRANT ALL ON TABLE public.operational_diary TO service_role;


--
-- Name: TABLE order_audit_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_audit_log TO anon;
GRANT ALL ON TABLE public.order_audit_log TO authenticated;
GRANT ALL ON TABLE public.order_audit_log TO service_role;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_items TO anon;
GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;


--
-- Name: TABLE order_return_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_return_items TO anon;
GRANT ALL ON TABLE public.order_return_items TO authenticated;
GRANT ALL ON TABLE public.order_return_items TO service_role;


--
-- Name: TABLE order_returns; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_returns TO anon;
GRANT ALL ON TABLE public.order_returns TO authenticated;
GRANT ALL ON TABLE public.order_returns TO service_role;


--
-- Name: TABLE order_item_shadow_balances; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_item_shadow_balances TO anon;
GRANT ALL ON TABLE public.order_item_shadow_balances TO authenticated;
GRANT ALL ON TABLE public.order_item_shadow_balances TO service_role;


--
-- Name: TABLE order_withdrawals; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_withdrawals TO anon;
GRANT ALL ON TABLE public.order_withdrawals TO authenticated;
GRANT ALL ON TABLE public.order_withdrawals TO service_role;


--
-- Name: TABLE orders_backup_20241130; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.orders_backup_20241130 TO anon;
GRANT ALL ON TABLE public.orders_backup_20241130 TO authenticated;
GRANT ALL ON TABLE public.orders_backup_20241130 TO service_role;


--
-- Name: TABLE return_reasons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.return_reasons TO anon;
GRANT ALL ON TABLE public.return_reasons TO authenticated;
GRANT ALL ON TABLE public.return_reasons TO service_role;


--
-- Name: TABLE route_conference_scans; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.route_conference_scans TO anon;
GRANT ALL ON TABLE public.route_conference_scans TO authenticated;
GRANT ALL ON TABLE public.route_conference_scans TO service_role;


--
-- Name: TABLE route_order_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.route_order_items TO anon;
GRANT ALL ON TABLE public.route_order_items TO authenticated;
GRANT ALL ON TABLE public.route_order_items TO service_role;


--
-- Name: TABLE route_orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.route_orders TO anon;
GRANT ALL ON TABLE public.route_orders TO authenticated;
GRANT ALL ON TABLE public.route_orders TO service_role;


--
-- Name: TABLE routes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.routes TO anon;
GRANT ALL ON TABLE public.routes TO authenticated;
GRANT ALL ON TABLE public.routes TO service_role;


--
-- Name: TABLE store_release_assignments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.store_release_assignments TO anon;
GRANT ALL ON TABLE public.store_release_assignments TO authenticated;
GRANT ALL ON TABLE public.store_release_assignments TO service_role;


--
-- Name: TABLE store_release_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.store_release_history TO anon;
GRANT ALL ON TABLE public.store_release_history TO authenticated;
GRANT ALL ON TABLE public.store_release_history TO service_role;


--
-- Name: TABLE sync_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sync_logs TO anon;
GRANT ALL ON TABLE public.sync_logs TO authenticated;
GRANT ALL ON TABLE public.sync_logs TO service_role;


--
-- Name: TABLE teams_user; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.teams_user TO anon;
GRANT ALL ON TABLE public.teams_user TO authenticated;
GRANT ALL ON TABLE public.teams_user TO service_role;


--
-- Name: TABLE user_preferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_preferences TO anon;
GRANT ALL ON TABLE public.user_preferences TO authenticated;
GRANT ALL ON TABLE public.user_preferences TO service_role;


--
-- Name: TABLE user_store_release_locations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_store_release_locations TO anon;
GRANT ALL ON TABLE public.user_store_release_locations TO authenticated;
GRANT ALL ON TABLE public.user_store_release_locations TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE vehicles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.vehicles TO anon;
GRANT ALL ON TABLE public.vehicles TO authenticated;
GRANT ALL ON TABLE public.vehicles TO service_role;


--
-- Name: TABLE webhook_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.webhook_settings TO anon;
GRANT ALL ON TABLE public.webhook_settings TO authenticated;
GRANT ALL ON TABLE public.webhook_settings TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


