export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'driver' | 'helper' | 'montador' | 'conferente' | 'consultor';
  phone?: string;
  must_change_password?: boolean;
  created_at: string;
}

export interface Driver {
  id: string;
  user_id: string;
  cpf: string;
  vehicle_id?: string;
  active: boolean;
  name?: string;
}

export interface DriverWithUser extends Driver {
  user: User;
}

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  capacity?: number;
  active?: boolean;
  name?: string;
}

export interface Order {
  id: string;
  order_id_erp: string;
  customer_name: string;
  phone: string;
  customer_cpf?: string;
  address_json: Address;
  items_json: OrderItem[];
  status: 'pending' | 'imported' | 'assigned' | 'delivered' | 'returned';
  danfe_base64?: string;
  danfe_gerada_em?: string;
  xml_documento?: string;
  raw_json?: any;
  return_flag?: boolean;
  last_return_reason?: string | null;
  last_return_notes?: string | null;
  created_at: string;
  updated_at: string;

  // Novos campos do JSON reformulado (sem campos XML - usamos xml_documento existente)
  numero_lancamento?: number;
  observacoes_publicas?: string;
  observacoes_internas?: string;
  quantidade_volumes?: number;
  etiquetas?: string[];
  tem_frete_full?: string;
  filial_venda?: string;
  brand?: string;
  department?: string;
  product_group?: string;
  product_subgroup?: string;

  // Campos adicionais para montagem
  destinatario_cidade?: string;
  destinatario_bairro?: string;
  sale_date?: string;
  delivery_date?: string;
  driver_name?: string;
  service_type?: 'troca' | 'assistencia' | 'venda';

  // Datas calculadas pelo banco
  data_venda?: string;        // Mapeamento direto do banco
  previsao_entrega?: string;  // Data calculada de entrega
  previsao_montagem?: string; // Data calculada de montagem

  // Campos de controle de bloqueio/devolução (preenchidos via n8n)
  erp_status?: string;           // Status do ERP: 'devolvido', 'cancelado'
  blocked_at?: string;           // Data/hora do bloqueio - se preenchido, pedido está bloqueado
  blocked_reason?: string;       // Motivo do bloqueio
  requires_pickup?: boolean;     // TRUE = precisa coletar no cliente
  pickup_created_at?: string;    // Data/hora em que a rota de coleta foi criada

  // Dados da nota de devolução (para DANFE de coleta)
  return_nfe_number?: string;    // Número da NF-e de devolução
  return_nfe_key?: string;       // Chave de acesso da NF-e (44 dígitos)
  return_nfe_xml?: string;       // XML completo da NF-e de devolução
  return_date?: string;          // Data da devolução no ERP
  return_type?: string;          // Tipo: 'NOTA DE DEVOLUCAO'
  return_danfe_base64?: string;  // PDF da DANFE de devolução em Base64
}

export interface Address {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
  complement?: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  volumes_per_unit?: number;
  purchased_quantity?: number | null;
  unit_price_real?: number;
  total_price_real?: number;
  unit_price?: number;
  total_price?: number;
  labels?: string[];
  location?: string;
  has_assembly?: string;
}

export interface Route {
  id: string;
  name: string;
  driver_id: string;
  vehicle_id?: string;
  conferente?: string;
  observations?: string;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  team_id?: string;
  helper_id?: string;
  conferente_id?: string;
  route_code?: string;
}

export interface RouteWithDetails extends Route {
  driver: Driver;
  vehicle?: Vehicle;
  route_orders: RouteOrderWithDetails[];
}

export interface RouteOrder {
  id: string;
  route_id: string;
  order_id: string;
  sequence: number;
  status: 'pending' | 'delivered' | 'returned';
  delivery_observations?: string;
  return_reason_id?: string;
  return_reason?: string | ReturnReason | null;
  return_notes?: string | null;
  signature_url?: string;
  delivered_at?: string;
  returned_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteOrderWithDetails extends RouteOrder {
  order: Order;
  return_reason?: ReturnReason | string | null;
}

export interface ReturnReason {
  id: string;
  reason: string;
  description?: string;
  type?: 'delivery' | 'assembly' | 'both';
}

export interface DeliveryConfirmation {
  route_order_id: string;
  status: 'delivered' | 'returned';
  observations?: string;
  return_reason_id?: string;
  signature?: string;
  delivered_at: string;
}

export interface SyncLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete';
  data: any;
  synced: boolean;
  created_at: string;
  synced_at?: string;
}

export interface DashboardMetrics {
  total_routes_today: number;
  pending_deliveries: number;
  completed_deliveries: number;
  success_rate: number;
  expired_returns: number;
}

export interface WebhookResponse {
  status: string;
  message: string;
  orders?: any[];
}

export interface AssemblyRoute {
  id: string;
  name: string;
  admin_id: string;
  status: 'pending' | 'in_progress' | 'completed';
  deadline?: string;
  observations?: string;
  assembler_id?: string;
  vehicle_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AssemblyProduct {
  id: string;
  assembly_route_id: string;
  order_id: string;
  product_name: string;
  product_sku?: string;
  customer_name: string;
  customer_phone?: string;
  installation_address: Address;
  assembly_date?: string;
  installer_id?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  completion_date?: string;
  technical_notes?: string;
  photos: string[];
  observations?: string;
  returned_at?: string;
  was_returned?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssemblyProductWithDetails extends AssemblyProduct {
  order: Order;
  installer?: User;
  assembly_route: AssemblyRoute;
}
