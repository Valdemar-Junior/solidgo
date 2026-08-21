-- ============================================================================
-- PARTE 1 — as 6 tabelas novas
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

--
-- Name: item_fulfillment_sync_issues; Type: TABLE; Schema: public; Owner: -
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



--
-- Name: order_item_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_item_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid,
    source_line_key text,
    sku text,
    storage_location text,
    product_name text,
    hold_type text DEFAULT 'manual'::text NOT NULL,
    scheduled_date date,
    reason text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    released_by uuid,
    released_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_item_holds_status_check CHECK ((status = ANY (ARRAY['active'::text, 'released'::text, 'picked_up'::text]))),
    CONSTRAINT order_item_holds_type_check CHECK ((hold_type = ANY (ARRAY['manual'::text, 'scheduled'::text, 'retirada'::text, 'antecipada'::text])))
);



--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
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



--
-- Name: order_return_items; Type: TABLE; Schema: public; Owner: -
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



--
-- Name: order_returns; Type: TABLE; Schema: public; Owner: -
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
    store_return_confirmed_at timestamp with time zone,
    store_return_confirmed_by uuid,
    CONSTRAINT order_returns_pickup_link_all_or_none CHECK ((num_nonnulls(pickup_created_at, pickup_order_id, pickup_route_id) = ANY (ARRAY[0, 3]))),
    CONSTRAINT order_returns_processing_status_check CHECK ((processing_status = ANY (ARRAY['pending'::text, 'processed'::text, 'divergent'::text, 'cancelled'::text])))
);



--
-- Name: route_order_items; Type: TABLE; Schema: public; Owner: -
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


