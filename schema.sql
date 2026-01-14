--
-- PostgreSQL database dump
--

-- \restrict 1ixke8rmFYs2aevLZ3j71sa0l9y2kXK8EdkHoVQehfjy6wms3fAdk5H9PksUZh6

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

-- COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_column_if_not_exists(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_column_if_not_exists(p_table_name text, p_column_name text, p_column_type text) RETURNS void
    LANGUAGE plpgsql
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


--
-- Name: admin_create_helper(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_helper(p_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

declare new_id uuid := gen_random_uuid();

begin

  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then

    raise exception 'Not authorized';

  end if;

  insert into public.helpers(id,name,active) values (new_id, p_name, true);

  return new_id;

end; $$;


--
-- Name: admin_create_user(uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_user(p_id uuid, p_email text, p_name text, p_role text DEFAULT 'driver'::text, p_must_change_password boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: get_duplicate_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_duplicate_orders() RETURNS TABLE(order_id_erp text, count bigint, ids uuid[])
    LANGUAGE plpgsql
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'delivered'::text, 'imported'::text])))
);


--
-- Name: COLUMN orders.erp_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.erp_status IS 'Status do pedido no ERP (devolvido, cancelado, etc)';


--
-- Name: COLUMN orders.blocked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.blocked_at IS 'Data/hora em que o pedido foi bloqueado para roteamento';


--
-- Name: COLUMN orders.blocked_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.blocked_reason IS 'Motivo do bloqueio';


--
-- Name: COLUMN orders.requires_pickup; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.requires_pickup IS 'TRUE se precisa de coleta física no cliente';


--
-- Name: COLUMN orders.pickup_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.pickup_created_at IS 'Data/hora em que a rota de coleta foi criada';


--
-- Name: COLUMN orders.return_nfe_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.return_nfe_number IS 'Número da NF-e de devolução do ERP';


--
-- Name: COLUMN orders.return_nfe_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.return_nfe_key IS 'Chave de acesso da NF-e de devolução (44 dígitos)';


--
-- Name: COLUMN orders.return_nfe_xml; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.return_nfe_xml IS 'XML completo da NF-e de devolução';


--
-- Name: COLUMN orders.return_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.return_date IS 'Data da devolução no ERP';


--
-- Name: COLUMN orders.return_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.return_type IS 'Tipo de retorno (NOTA DE DEVOLUCAO, etc)';


--
-- Name: COLUMN orders.return_danfe_base64; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.return_danfe_base64 IS 'PDF da DANFE de devolução em Base64';


--
-- Name: get_missing_assembly_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_missing_assembly_orders() RETURNS SETOF public.orders
    LANGUAGE plpgsql
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


--
-- Name: get_route_duplicates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_route_duplicates() RETURNS TABLE(order_id uuid, order_id_erp text, client_name text, route_count bigint, routes_info jsonb[])
    LANGUAGE plpgsql
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'driver'),
    NEW.raw_user_meta_data->>'phone'
  );
  
  -- If the user is a driver, create a driver profile
  IF NEW.raw_user_meta_data->>'role' = 'driver' THEN
    INSERT INTO public.drivers (user_id, cpf, vehicle_id, active)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'cpf', '00000000000'),
      NULL,
      true
    );
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: insert_vehicle(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_vehicle(p_model text, p_plate text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: list_drivers(); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: mark_new_user_must_change_password(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_new_user_must_change_password() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.must_change_password := true;

  RETURN NEW;

END;

$$;


--
-- Name: prevent_duplicate_routing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_duplicate_routing() RETURNS trigger
    LANGUAGE plpgsql
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


--
-- Name: sync_assembly_products_from_order(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_assembly_products_from_order() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    item jsonb;
    should_assemble boolean;
    order_has_keyword boolean;
    clean_sku text;
    clean_name text;
    normalized_obs text;
    qty int;
    current_count int;
    i int;
BEGIN
    -- Normalizar observações para verificação de keyword (*montagem*)
    normalized_obs := lower(coalesce(NEW.observacoes_internas, '') || ' ' || coalesce(NEW.observacoes_publicas, ''));
    order_has_keyword := normalized_obs LIKE '%*montagem*%';

    -- CRÍTICO: Montagem só deve nascer quando o pedido tiver sido ENTREGUE (delivered)
    -- Se o status não for 'delivered', não gera assembly_product ainda.
    IF NEW.status != 'delivered' THEN
        RETURN NEW;
    END IF;

    -- Se não tiver itens, não faz nada
    IF NEW.items_json IS NULL OR jsonb_array_length(NEW.items_json) = 0 THEN
        RETURN NEW;
    END IF;

    -- Iterar sobre os itens do JSON
    FOR item IN SELECT * FROM jsonb_array_elements(NEW.items_json)
    LOOP
        -- Verifica critério: Flag explícita OU Keyword no pedido
        should_assemble := (item->>'has_assembly')::text ~* '^(true|sim|1|yes|y)$' 
                        OR order_has_keyword;

        IF should_assemble THEN
            clean_sku := coalesce(item->>'sku', 'SKU-INDEF');
            clean_name := coalesce(item->>'name', 'Produto sem nome');
            
            -- Determinar quantidade (fallback para 1 se não definido)
            qty := GREATEST(1, coalesce((item->>'purchased_quantity')::int, (item->>'quantity')::int, 1));

            -- Verificar quantos já existem para este pedido e SKU
            SELECT COUNT(*) INTO current_count
            FROM public.assembly_products ap 
            WHERE ap.order_id = NEW.id 
            AND ap.product_sku = clean_sku;

            -- Inserir faltantes (se qty=2 e tem 0, insere 2. Se tem 1, insere 1)
            IF current_count < qty THEN
                FOR i IN 1..(qty - current_count) LOOP
                    INSERT INTO public.assembly_products (
                        order_id,
                        product_name,
                        product_sku,
                        customer_name,
                        customer_phone,
                        installation_address,
                        status,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        NEW.id,
                        clean_name,
                        clean_sku,
                        NEW.customer_name,
                        NEW.phone,
                        NEW.address_json,
                        'pending', -- Status inicial
                        NOW(),
                        NOW()
                    );
                END LOOP;
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$_$;


--
-- Name: sync_order_status_from_route(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_order_status_from_route() RETURNS trigger
    LANGUAGE plpgsql
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


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: assembly_products; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT assembly_products_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: assembly_routes; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    cpf text,
    vehicle_id uuid,
    active boolean DEFAULT true
);


--
-- Name: route_conferences; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: latest_route_conferences; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_route_conferences AS
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


--
-- Name: orders_backup_20241130; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders_backup_20241130 (
    id uuid,
    order_id_erp text,
    id_unico_integracao bigint,
    tipo integer,
    cliente_celular text,
    phone text,
    tem_montagem text
);


--
-- Name: return_reasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_reasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reason text NOT NULL,
    description text,
    active boolean DEFAULT true,
    type text DEFAULT 'both'::text,
    CONSTRAINT check_return_type CHECK ((type = ANY (ARRAY['delivery'::text, 'assembly'::text, 'both'::text])))
);


--
-- Name: route_conference_scans; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: route_orders; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: routes; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT routes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])))
);


--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: teams_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_user_id uuid NOT NULL,
    helper_user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    pref_key text NOT NULL,
    pref_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    phone text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    must_change_password boolean DEFAULT false,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'driver'::text, 'helper'::text, 'montador'::text, 'conferente'::text])))
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plate text NOT NULL,
    model text NOT NULL,
    capacity integer,
    active boolean DEFAULT true
);


--
-- Name: webhook_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    url text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: assembly_products assembly_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_pkey PRIMARY KEY (id);


--
-- Name: assembly_routes assembly_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_pkey PRIMARY KEY (id);


--
-- Name: assembly_routes assembly_routes_route_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_route_code_unique UNIQUE (route_code);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_id_erp_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_id_erp_key UNIQUE (order_id_erp);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: return_reasons return_reasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_reasons
    ADD CONSTRAINT return_reasons_pkey PRIMARY KEY (id);


--
-- Name: return_reasons return_reasons_reason_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_reasons
    ADD CONSTRAINT return_reasons_reason_key UNIQUE (reason);


--
-- Name: route_conference_scans route_conference_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conference_scans
    ADD CONSTRAINT route_conference_scans_pkey PRIMARY KEY (id);


--
-- Name: route_conferences route_conferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_pkey PRIMARY KEY (id);


--
-- Name: route_orders route_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_pkey PRIMARY KEY (id);


--
-- Name: route_orders route_orders_route_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_route_id_order_id_key UNIQUE (route_id, order_id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: routes routes_route_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_route_code_unique UNIQUE (route_code);


--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);


--
-- Name: teams_user teams_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_user
    ADD CONSTRAINT teams_user_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id, pref_key);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_plate_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_plate_key UNIQUE (plate);


--
-- Name: webhook_settings webhook_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_settings
    ADD CONSTRAINT webhook_settings_key_key UNIQUE (key);


--
-- Name: webhook_settings webhook_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_settings
    ADD CONSTRAINT webhook_settings_pkey PRIMARY KEY (id);


--
-- Name: drivers_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX drivers_user_id_idx ON public.drivers USING btree (user_id);


--
-- Name: idx_app_settings_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_settings_key ON public.app_settings USING btree (key);


--
-- Name: idx_assembly_products_assembly_route_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_products_assembly_route_id ON public.assembly_products USING btree (assembly_route_id);


--
-- Name: idx_assembly_products_installer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_products_installer_id ON public.assembly_products USING btree (installer_id);


--
-- Name: idx_assembly_products_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_products_order_id ON public.assembly_products USING btree (order_id);


--
-- Name: idx_assembly_products_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_products_status ON public.assembly_products USING btree (status);


--
-- Name: idx_assembly_routes_assembler; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_routes_assembler ON public.assembly_routes USING btree (assembler_id);


--
-- Name: idx_assembly_routes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_routes_created_at ON public.assembly_routes USING btree (created_at);


--
-- Name: idx_assembly_routes_route_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_routes_route_code ON public.assembly_routes USING btree (route_code);


--
-- Name: idx_assembly_routes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_routes_status ON public.assembly_routes USING btree (status);


--
-- Name: idx_assembly_routes_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_routes_vehicle ON public.assembly_routes USING btree (vehicle_id);


--
-- Name: idx_drivers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_user_id ON public.drivers USING btree (user_id);


--
-- Name: idx_drivers_vehicle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drivers_vehicle_id ON public.drivers USING btree (vehicle_id);


--
-- Name: idx_orders_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_blocked ON public.orders USING btree (blocked_at) WHERE (blocked_at IS NOT NULL);


--
-- Name: idx_orders_order_id_erp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_id_erp ON public.orders USING btree (order_id_erp);


--
-- Name: idx_orders_pickup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pickup ON public.orders USING btree (requires_pickup, pickup_created_at) WHERE (requires_pickup = true);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_route_orders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_orders_order_id ON public.route_orders USING btree (order_id);


--
-- Name: idx_route_orders_route_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_orders_route_id ON public.route_orders USING btree (route_id);


--
-- Name: idx_route_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_orders_status ON public.route_orders USING btree (status);


--
-- Name: idx_routes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_created_at ON public.routes USING btree (created_at);


--
-- Name: idx_routes_driver_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_driver_id ON public.routes USING btree (driver_id);


--
-- Name: idx_routes_helper_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_helper_id ON public.routes USING btree (helper_id);


--
-- Name: idx_routes_route_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_route_code ON public.routes USING btree (route_code);


--
-- Name: idx_routes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_status ON public.routes USING btree (status);


--
-- Name: idx_routes_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_team_id ON public.routes USING btree (team_id);


--
-- Name: idx_sync_logs_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_logs_synced ON public.sync_logs USING btree (synced);


--
-- Name: idx_sync_logs_table_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_logs_table_name ON public.sync_logs USING btree (table_name);


--
-- Name: idx_teams_user_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_user_driver ON public.teams_user USING btree (driver_user_id);


--
-- Name: idx_teams_user_helper; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_user_helper ON public.teams_user USING btree (helper_user_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: orders_customer_cpf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_cpf_idx ON public.orders USING btree (customer_cpf);


--
-- Name: orders_filial_venda_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_filial_venda_idx ON public.orders USING btree (filial_venda);


--
-- Name: route_orders check_duplicate_routing; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_duplicate_routing BEFORE INSERT ON public.route_orders FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_routing();


--
-- Name: users trigger_mark_must_change_password; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_mark_must_change_password BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.mark_new_user_must_change_password();


--
-- Name: route_orders trigger_sync_route_to_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sync_route_to_order AFTER UPDATE ON public.route_orders FOR EACH ROW EXECUTE FUNCTION public.sync_order_status_from_route();


--
-- Name: assembly_products update_assembly_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_assembly_products_updated_at BEFORE UPDATE ON public.assembly_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: assembly_routes update_assembly_routes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_assembly_routes_updated_at BEFORE UPDATE ON public.assembly_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: assembly_products assembly_products_assembly_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_assembly_route_id_fkey FOREIGN KEY (assembly_route_id) REFERENCES public.assembly_routes(id) ON DELETE CASCADE;


--
-- Name: assembly_products assembly_products_installer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_installer_id_fkey FOREIGN KEY (installer_id) REFERENCES public.users(id);


--
-- Name: assembly_products assembly_products_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_products
    ADD CONSTRAINT assembly_products_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: assembly_routes assembly_routes_assembler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_assembler_id_fkey FOREIGN KEY (assembler_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assembly_routes assembly_routes_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_routes
    ADD CONSTRAINT assembly_routes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: drivers drivers_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: route_conference_scans route_conference_scans_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conference_scans
    ADD CONSTRAINT route_conference_scans_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: route_conference_scans route_conference_scans_route_conference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conference_scans
    ADD CONSTRAINT route_conference_scans_route_conference_id_fkey FOREIGN KEY (route_conference_id) REFERENCES public.route_conferences(id) ON DELETE CASCADE;


--
-- Name: route_conferences route_conferences_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: route_conferences route_conferences_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: route_conferences route_conferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_conferences
    ADD CONSTRAINT route_conferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: route_orders route_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: route_orders route_orders_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_orders
    ADD CONSTRAINT route_orders_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: routes routes_conferente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_conferente_id_fkey FOREIGN KEY (conferente_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: routes routes_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: routes routes_helper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_helper_id_fkey FOREIGN KEY (helper_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: routes routes_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams_user(id) ON DELETE SET NULL;


--
-- Name: routes routes_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: teams_user teams_user_driver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_user
    ADD CONSTRAINT teams_user_driver_user_id_fkey FOREIGN KEY (driver_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: teams_user teams_user_helper_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_user
    ADD CONSTRAINT teams_user_helper_user_id_fkey FOREIGN KEY (helper_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: orders Admin can delete orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete orders" ON public.orders FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text)))));


--
-- Name: orders Admin can insert orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can insert orders" ON public.orders FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text)))));


--
-- Name: orders Admin can update orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update orders" ON public.orders FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text)))));


--
-- Name: assembly_products Admins can manage assembly products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage assembly products" ON public.assembly_products USING ((((auth.jwt() ->> 'role'::text) = 'service_role'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text))))));


--
-- Name: assembly_routes Admins can manage assembly routes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage assembly routes" ON public.assembly_routes USING ((((auth.jwt() ->> 'role'::text) = 'service_role'::text) OR (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text))))));


--
-- Name: orders All authenticated users can view orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "All authenticated users can view orders" ON public.orders FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: return_reasons All authenticated users can view return reasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "All authenticated users can view return reasons" ON public.return_reasons FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: vehicles All authenticated users can view vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "All authenticated users can view vehicles" ON public.vehicles FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: drivers Allow authenticated users to insert drivers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated users to insert drivers" ON public.drivers FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: drivers Allow authenticated users to read drivers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated users to read drivers" ON public.drivers FOR SELECT TO authenticated USING (true);


--
-- Name: orders Allow authenticated users to update orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated users to update orders" ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: drivers Allow users to update drivers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to update drivers" ON public.drivers FOR UPDATE TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text))))));


--
-- Name: sync_logs Debug: Allow All Insert Logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Debug: Allow All Insert Logs" ON public.sync_logs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: assembly_products Debug: Allow All Updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Debug: Allow All Updates" ON public.assembly_products FOR UPDATE TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Enable insert for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable insert for authenticated users" ON public.assembly_products FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_routes Enable insert for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable insert for authenticated users" ON public.assembly_routes FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.assembly_products FOR SELECT USING (true);


--
-- Name: assembly_routes Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.assembly_routes FOR SELECT USING (true);


--
-- Name: sync_logs Enable select for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable select for authenticated users" ON public.sync_logs FOR SELECT TO authenticated USING ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Enable update for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable update for authenticated users" ON public.assembly_products FOR UPDATE USING ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_routes Enable update for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable update for authenticated users" ON public.assembly_routes FOR UPDATE USING ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Installers can update their assigned products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Installers can update their assigned products" ON public.assembly_products FOR UPDATE USING ((installer_id = auth.uid()));


--
-- Name: assembly_products Installers can view their assigned products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Installers can view their assigned products" ON public.assembly_products FOR SELECT USING ((installer_id = auth.uid()));


--
-- Name: route_orders Permitir atualização de pedidos em rotas para usuários auten; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir atualização de pedidos em rotas para usuários auten" ON public.route_orders FOR UPDATE WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Permitir atualização de produtos para admin e montador; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir atualização de produtos para admin e montador" ON public.assembly_products FOR UPDATE USING (((auth.uid() IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))) OR (auth.uid() = installer_id)));


--
-- Name: assembly_routes Permitir atualização de rotas para admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir atualização de rotas para admin" ON public.assembly_routes FOR UPDATE USING ((auth.uid() IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))));


--
-- Name: routes Permitir atualização de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir atualização de rotas para usuários autenticados" ON public.routes FOR UPDATE USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Permitir criação de produtos para admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir criação de produtos para admin" ON public.assembly_products FOR INSERT WITH CHECK ((auth.uid() IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))));


--
-- Name: assembly_routes Permitir criação de rotas para admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir criação de rotas para admin" ON public.assembly_routes FOR INSERT WITH CHECK ((auth.uid() IN ( SELECT users.id
   FROM public.users
  WHERE (users.role = 'admin'::text))));


--
-- Name: route_orders Permitir exclusão de pedidos em rotas para usuários autentica; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir exclusão de pedidos em rotas para usuários autentica" ON public.route_orders FOR DELETE USING ((auth.role() = 'authenticated'::text));


--
-- Name: routes Permitir exclusão de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir exclusão de rotas para usuários autenticados" ON public.routes FOR DELETE USING ((auth.role() = 'authenticated'::text));


--
-- Name: route_orders Permitir inserção de pedidos em rotas para usuários autentic; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir inserção de pedidos em rotas para usuários autentic" ON public.route_orders FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: routes Permitir inserção de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir inserção de rotas para usuários autenticados" ON public.routes FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: assembly_products Permitir leitura de produtos para usuários autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir leitura de produtos para usuários autenticados" ON public.assembly_products FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: assembly_routes Permitir leitura de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir leitura de rotas para usuários autenticados" ON public.assembly_routes FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: route_orders Permitir visualização de pedidos em rotas para usuários aute; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir visualização de pedidos em rotas para usuários aute" ON public.route_orders FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: routes Permitir visualização de rotas para usuários autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir visualização de rotas para usuários autenticados" ON public.routes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: users Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: users Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING ((auth.uid() = id));


--
-- Name: orders Users can view orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view orders" ON public.orders FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: users Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING ((auth.uid() = id));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_modify_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_modify_admin ON public.app_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: app_settings app_settings_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_select_authenticated ON public.app_settings FOR SELECT TO authenticated USING (true);


--
-- Name: assembly_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assembly_products ENABLE ROW LEVEL SECURITY;

--
-- Name: assembly_routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assembly_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: drivers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

--
-- Name: route_orders enable_update_for_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enable_update_for_authenticated ON public.route_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_update_driver_delivered; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_update_driver_delivered ON public.orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.route_orders ro
     JOIN public.routes r ON ((ro.route_id = r.id)))
     JOIN public.drivers d ON ((r.driver_id = d.id)))
  WHERE ((ro.order_id = orders.id) AND (d.user_id = auth.uid()))))) WITH CHECK (((status = 'delivered'::text) OR (status = 'assigned'::text) OR (status = 'pending'::text)));


--
-- Name: orders orders_update_driver_returned; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_update_driver_returned ON public.orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.route_orders ro
     JOIN public.routes r ON ((ro.route_id = r.id)))
     JOIN public.drivers d ON ((r.driver_id = d.id)))
  WHERE ((ro.order_id = orders.id) AND (d.user_id = auth.uid()))))) WITH CHECK (((status = 'pending'::text) AND (return_flag = true)));


--
-- Name: route_conferences rc_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rc_insert_authenticated ON public.route_conferences FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: route_conferences rc_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rc_select_authenticated ON public.route_conferences FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: route_conferences rc_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rc_update_admin ON public.route_conferences FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: route_conferences rc_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rc_update_own ON public.route_conferences FOR UPDATE USING (((auth.role() = 'authenticated'::text) AND (user_id = auth.uid()))) WITH CHECK (((auth.role() = 'authenticated'::text) AND (user_id = auth.uid())));


--
-- Name: route_conference_scans rcs_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rcs_insert_authenticated ON public.route_conference_scans FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: route_conference_scans rcs_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rcs_select_authenticated ON public.route_conference_scans FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: return_reasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.return_reasons ENABLE ROW LEVEL SECURITY;

--
-- Name: route_conference_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_conference_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: route_conferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_conferences ENABLE ROW LEVEL SECURITY;

--
-- Name: route_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: route_orders route_orders_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY route_orders_select_authenticated ON public.route_orders FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: route_orders route_orders_select_driver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY route_orders_select_driver ON public.route_orders FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.routes r
     JOIN public.drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = auth.uid())))));


--
-- Name: route_orders route_orders_update_driver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY route_orders_update_driver ON public.route_orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.routes r
     JOIN public.drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.routes r
     JOIN public.drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = auth.uid())))));


--
-- Name: routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

--
-- Name: routes routes_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY routes_select_authenticated ON public.routes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: routes routes_update_driver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY routes_update_driver ON public.routes FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.drivers d
  WHERE ((d.id = routes.driver_id) AND (d.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.drivers d
  WHERE ((d.id = routes.driver_id) AND (d.user_id = auth.uid())))));


--
-- Name: sync_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences upsert_own_prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY upsert_own_prefs ON public.user_preferences USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles vehicles_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicles_insert_admin ON public.vehicles FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: vehicles vehicles_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicles_select_authenticated ON public.vehicles FOR SELECT TO authenticated USING (true);


--
-- Name: vehicles vehicles_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicles_update_admin ON public.vehicles FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));


--
-- Name: webhook_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_settings webhook_settings_modify_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_settings_modify_authenticated ON public.webhook_settings TO authenticated USING (true) WITH CHECK (true);


--
-- Name: webhook_settings webhook_settings_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_settings_select_authenticated ON public.webhook_settings FOR SELECT TO authenticated USING (true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict 1ixke8rmFYs2aevLZ3j71sa0l9y2kXK8EdkHoVQehfjy6wms3fAdk5H9PksUZh6

