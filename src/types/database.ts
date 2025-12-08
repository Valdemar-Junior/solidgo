export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'driver' | 'helper' | 'montador' | 'conferente';
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
  
  // Campos adicionais para montagem
  destinatario_cidade?: string;
  destinatario_bairro?: string;
  sale_date?: string;
  delivery_date?: string;
  driver_name?: string;
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
  signature_url?: string;
  delivered_at?: string;
  returned_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RouteOrderWithDetails extends RouteOrder {
  order: Order;
  return_reason?: ReturnReason;
}

export interface ReturnReason {
  id: string;
  reason: string;
  description?: string;
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
  created_at: string;
  updated_at: string;
}

export interface AssemblyProductWithDetails extends AssemblyProduct {
  order: Order;
  installer?: User;
  assembly_route: AssemblyRoute;
}
