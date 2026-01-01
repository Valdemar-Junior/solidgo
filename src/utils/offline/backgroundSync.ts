import { supabase } from '../../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from './storage';
import { toast } from 'sonner';

export class BackgroundSyncService {
  private static instance: BackgroundSyncService;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): BackgroundSyncService {
    if (!BackgroundSyncService.instance) {
      BackgroundSyncService.instance = new BackgroundSyncService();
    }
    return BackgroundSyncService.instance;
  }

  private initialize(): void {
    // Listen for network status changes
    NetworkStatus.addListener((online) => {
      if (online) {
        this.startSync();
      } else {
        this.stopSync();
      }
    });

    // Start sync if online
    if (NetworkStatus.isOnline()) {
      this.startSync();
    }
  }

  public startSync(): void {
    if (this.syncInterval) {
      return; // Already running
    }

    console.log('Starting background sync...');

    // Sync immediately when coming online
    this.syncPendingItems();

    // Set up periodic sync (every 30 seconds)
    this.syncInterval = setInterval(() => {
      this.syncPendingItems();
    }, 30000);
  }

  public stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('Background sync stopped');
    }
  }

  private syncPromise: Promise<number> | null = null;

  public async forceSync(): Promise<number> {
    if (!NetworkStatus.isOnline()) {
      toast.error('Sem conexão com a internet');
      return 0;
    }

    // Se já estiver sincronizando, retorna a promessa atual
    if (this.syncPromise) {
      return this.syncPromise;
    }

    toast.info('Sincronizando dados...');
    return this.syncPendingItems();
  }

  private async syncPendingItems(): Promise<number> {
    // Evita múltiplas chamadas
    if (!NetworkStatus.isOnline()) {
      return 0;
    }

    // Se já existe uma promessa rodando, retorna ela (embora o forceSync já trate isso,
    // o sync periódico chama este método direto)
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.isSyncing = true;

    // Cria nova promessa para esta execução
    this.syncPromise = (async () => {
      let syncedCount = 0;
      try {
        const pendingItems = await SyncQueue.getPendingItems();

        if (pendingItems.length === 0) {
          return 0;
        }

        console.log(`Syncing ${pendingItems.length} pending items...`);

        for (const item of pendingItems) {
          try {
            await this.syncItem(item);
            await SyncQueue.updateItemStatus(item.id, 'completed');
            syncedCount++;
          } catch (error) {
            console.error(`Failed to sync item ${item.id}:`, error);
            await SyncQueue.updateItemStatus(item.id, 'failed', item.attempts + 1);
            if (item.attempts >= 3) {
              await this.logSyncError(item, error as Error);
            }
          }
        }

        if (syncedCount > 0) {
          await SyncQueue.removeCompletedItems();
          toast.success(`${syncedCount} sincronizações concluídas`);
        }

        return syncedCount;

      } catch (error) {
        console.error('Error during sync:', error);
        return 0;
      } finally {
        this.isSyncing = false;
        this.syncPromise = null; // Limpa a promessa ao terminar
      }
    })();

    return this.syncPromise;
  }

  private async syncItem(item: any): Promise<void> {
    switch (item.type) {
      case 'delivery_confirmation':
        await this.syncDeliveryConfirmation(item.data);
        break;
      case 'assembly_update':
        await this.syncAssemblyUpdate(item.data);
        break;
      case 'assembly_confirmation':
        await this.syncAssemblyConfirmation(item.data);
        break;
      case 'assembly_return':
        await this.syncAssemblyReturn(item.data);
        break;
      case 'return_revert':
        await this.syncReturnRevert(item.data);
        break;
      case 'delivery_revert':
        await this.syncDeliveryRevert(item.data);
        break;
      case 'order_update':
        await this.syncOrderUpdate(item.data);
        break;
      case 'assembly_undo':
        await this.syncAssemblyUndo(item.data);
        break;
      case 'route_completion':
        await this.syncRouteCompletion(item.data);
        break;
      case 'assembly_route_completion':
        await this.syncAssemblyRouteCompletion(item.data);
        break;
      default:
        console.warn(`Unknown sync item type: ${item.type}`);
    }
  }

  private async syncAssemblyUpdate(data: any): Promise<void> {
    const { route_id, order_id, action, local_timestamp } = data || {};
    if (!order_id || !route_id || !action) throw new Error('Invalid assembly_update payload');
    if (action === 'complete') {
      const { error } = await supabase
        .from('assembly_products')
        .update({ status: 'completed', completion_date: local_timestamp })
        .eq('order_id', order_id)
        .eq('assembly_route_id', route_id);
      if (error) throw error;
    } else if (action === 'return') {
      const { error } = await supabase
        .from('assembly_products')
        .update({ status: 'cancelled', assembly_date: null, completion_date: null })
        .eq('order_id', order_id)
        .eq('assembly_route_id', route_id);
      if (error) throw error;
      const { data: pendente } = await supabase
        .from('assembly_products')
        .select('*')
        .eq('order_id', order_id)
        .is('assembly_route_id', null)
        .eq('status', 'pending');
      if (!pendente || pendente.length === 0) {
        const { data: base } = await supabase
          .from('assembly_products')
          .select('*')
          .eq('order_id', order_id)
          .eq('assembly_route_id', route_id);
        const clones = (base || []).map((it: any) => ({
          assembly_route_id: null,
          order_id: it.order_id,
          product_name: it.product_name,
          product_sku: it.product_sku,
          customer_name: it.customer_name,
          customer_phone: it.customer_phone,
          installation_address: it.installation_address,
          installer_id: null,
          status: 'pending',
          observations: it.observations,
        }));
        if (clones.length) await supabase.from('assembly_products').insert(clones);
      }
    }
  }

  // Sync assembly confirmation (marcado como montado) - usa item_id
  private async syncAssemblyConfirmation(data: any): Promise<void> {
    const { item_id, route_id, action, local_timestamp } = data || {};
    console.log('[BackgroundSync] syncAssemblyConfirmation:', { item_id, route_id, action });

    if (!item_id) throw new Error('Invalid assembly_confirmation payload: missing item_id');

    if (action === 'completed') {
      const { error } = await supabase
        .from('assembly_products')
        .update({ status: 'completed', completion_date: local_timestamp })
        .eq('id', item_id);

      if (error) {
        console.error('[BackgroundSync] Error syncing assembly confirmation:', error);
        throw error;
      }
      console.log('[BackgroundSync] Assembly confirmation synced successfully:', item_id);

      // Verificar se todos os produtos da rota estão concluídos
      if (route_id) {
        await this.checkAssemblyRouteCompletion(route_id);
      }
    }
  }

  // Sync assembly return (marcado como retorno) - usa item_id
  private async syncAssemblyReturn(data: any): Promise<void> {
    const { item_id, route_id, return_reason, observations, local_timestamp } = data || {};
    console.log('[BackgroundSync] syncAssemblyReturn:', { item_id, route_id });

    if (!item_id) throw new Error('Invalid assembly_return payload: missing item_id');

    const { error } = await supabase
      .from('assembly_products')
      .update({
        status: 'cancelled',
        return_reason: return_reason || null,
        observations: observations || null,
        returned_at: local_timestamp || new Date().toISOString()
      })
      .eq('id', item_id);

    if (error) {
      console.error('[BackgroundSync] Error syncing assembly return:', error);
      throw error;
    }
    console.log('[BackgroundSync] Assembly return synced successfully:', item_id);

    // Buscar dados do produto para clonar
    const { data: originalProduct } = await supabase
      .from('assembly_products')
      .select('*')
      .eq('id', item_id)
      .single();

    if (originalProduct) {
      // Clone para nova tentativa (libera para nova rota)
      const newItem = {
        order_id: originalProduct.order_id,
        product_name: originalProduct.product_name,
        product_sku: originalProduct.product_sku,
        customer_name: originalProduct.customer_name,
        customer_phone: originalProduct.customer_phone,
        installation_address: originalProduct.installation_address,
        status: 'pending',
        observations: originalProduct.observations,
        assembly_route_id: null,
        was_returned: true // Marca como retorno para badge
      };

      await supabase.from('assembly_products').insert(newItem);
      console.log('[BackgroundSync] Created clone for returned product');
    }

    // Verificar se todos os produtos da rota estão concluídos
    if (route_id) {
      await this.checkAssemblyRouteCompletion(route_id);
    }
  }

  // Verifica se todos os produtos de uma rota de montagem estão concluídos
  private async checkAssemblyRouteCompletion(route_id: string): Promise<void> {
    try {
      const { data: allProducts } = await supabase
        .from('assembly_products')
        .select('status')
        .eq('assembly_route_id', route_id);

      if (allProducts && allProducts.length > 0) {
        const allDone = allProducts.every((p: any) => p.status !== 'pending');
        if (allDone) {
          await supabase.from('assembly_routes').update({ status: 'completed' }).eq('id', route_id);
          console.log('[BackgroundSync] Assembly route marked as completed:', route_id);
        }
      }
    } catch (routeErr) {
      console.warn('[BackgroundSync] Failed to check/update assembly route status:', routeErr);
    }
  }

  private async syncRouteCompletion(data: any): Promise<void> {
    const { route_id } = data;
    if (!route_id) throw new Error('Invalid route_completion payload');

    // 1. Mark route as completed
    const { error } = await supabase.from('routes').update({ status: 'completed' }).eq('id', route_id);
    if (error) throw error;

    // 2. Release returned orders for routing
    const { data: returnedOrders } = await supabase
      .from('route_orders')
      .select('order_id')
      .eq('route_id', route_id)
      .eq('status', 'returned');

    if (returnedOrders && returnedOrders.length > 0) {
      const orderIds = returnedOrders.map(ro => ro.order_id);
      await supabase
        .from('orders')
        .update({ status: 'pending' })
        .in('id', orderIds);
    }

    console.log('[BackgroundSync] Route completed and returns released:', route_id);
  }

  // Sync assembly route completion (finalização de rota de MONTAGEM)
  private async syncAssemblyRouteCompletion(data: any): Promise<void> {
    const { route_id, local_timestamp } = data;
    if (!route_id) throw new Error('Invalid assembly_route_completion payload');

    console.log('[BackgroundSync] syncAssemblyRouteCompletion:', route_id);

    // 1. Mark assembly route as completed
    const { error } = await supabase.from('assembly_routes').update({ status: 'completed' }).eq('id', route_id);
    if (error) {
      console.error('[BackgroundSync] Error completing assembly route:', error);
      throw error;
    }

    // 2. Find returned items (cancelled) and re-insert for new routing
    const { data: returnedItems } = await supabase
      .from('assembly_products')
      .select('*')
      .eq('assembly_route_id', route_id)
      .eq('status', 'cancelled');

    if (returnedItems && returnedItems.length > 0) {
      const newItems = returnedItems.map((item: any) => ({
        order_id: item.order_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        installation_address: item.installation_address,
        status: 'pending',
        observations: item.observations,
        assembly_route_id: null,
        was_returned: true
      }));

      const { error: insertError } = await supabase.from('assembly_products').insert(newItems);
      if (insertError) {
        console.error('[BackgroundSync] Error re-inserting returned items:', insertError);
        // Don't throw, route is already completed
      } else {
        console.log('[BackgroundSync] Re-inserted', newItems.length, 'returned items for new routing');
      }
    }

    console.log('[BackgroundSync] Assembly route completed successfully:', route_id);
  }

  private async syncDeliveryConfirmation(data: any): Promise<void> {
    const { order_id, route_id, action, signature, local_timestamp, user_id } = data;

    const updateData: any = { status: action };
    if (action === 'delivered') updateData.delivered_at = local_timestamp;
    if (action === 'returned') {
      updateData.returned_at = local_timestamp;
      if (data.return_reason) updateData.return_reason = data.return_reason;
      if (data.observations) updateData.return_notes = data.observations;
    }
    if (signature) updateData.signature_url = signature;

    const { error } = await supabase
      .from('route_orders')
      .update(updateData)
      .eq('order_id', order_id)
      .eq('route_id', route_id);

    if (error) {
      throw new Error(`Failed to update route order: ${error.message}`);
    }

    if (action === 'delivered') {
      const { error: orderError } = await supabase
        .from('orders')
        .update({ status: 'delivered', return_flag: false, last_return_reason: null, last_return_notes: null })
        .eq('id', order_id);
      if (orderError) console.warn('Failed to update order status:', orderError);

      // Criar produtos de montagem se o pedido tiver itens com montagem
      try {
        const { data: orderData, error: orderFetchError } = await supabase
          .from('orders')
          .select('id, items_json, customer_name, phone, address_json, order_id_erp')
          .eq('id', order_id)
          .single();

        if (orderFetchError) {
          console.warn('[BackgroundSync] Failed to fetch order for assembly:', orderFetchError);
        } else if (orderData && orderData.items_json) {
          console.log('[BackgroundSync] Checking assembly for order:', order_id, 'items:', orderData.items_json.length);

          const produtosComMontagem = orderData.items_json.filter((item: any) =>
            item.has_assembly === 'SIM' || item.has_assembly === 'sim' || item.possui_montagem === true || item.possui_montagem === 'true'
          );

          console.log('[BackgroundSync] Products with assembly found:', produtosComMontagem.length);

          if (produtosComMontagem.length > 0) {
            // Verificar se já existem registros PARA ESTE PEDIDO (order_id é único)
            const { data: existing } = await supabase
              .from('assembly_products')
              .select('id')
              .eq('order_id', order_id);

            console.log('[BackgroundSync] Existing products for this order:', (existing || []).length);

            // Só insere se NÃO existir nenhum registro para este pedido
            if (!existing || existing.length === 0) {
              const assemblyProducts = produtosComMontagem.map((item: any) => ({
                order_id: orderData.id,
                product_name: item.name,
                product_sku: item.sku,
                customer_name: orderData.customer_name,
                customer_phone: orderData.phone,
                installation_address: orderData.address_json,
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }));

              const { error: insertError } = await supabase.from('assembly_products').insert(assemblyProducts);

              if (insertError) {
                console.error('[BackgroundSync] Failed to insert assembly_products:', insertError);
              } else {
                console.log(`[BackgroundSync] Created ${assemblyProducts.length} assembly products for order ${order_id}`);
              }
            } else {
              console.log('[BackgroundSync] Order already has assembly products, skipping creation');
            }
          }
        }
      } catch (assemblyErr) {
        console.warn('[BackgroundSync] Failed to create assembly products:', assemblyErr);
      }
    } else if (action === 'returned') {
      const { error: orderError2 } = await supabase
        .from('orders')
        .update({
          // status: 'pending', // <--- PREVENT RELEASE UNTIL ROUTE COMPLETION
          return_flag: true,
          last_return_reason: data.return_reason || null,
          last_return_notes: data.observations || null,
        })
        .eq('id', order_id);
      if (orderError2) console.warn('Failed to update order status:', orderError2);
    }

    // Auto-completion check removed in favor of manual finalization
    /* 
    try {
       ...
    } catch (routeErr) { } 
    */

    await this.logSyncAction('delivery_confirmation', order_id, action, user_id);
  }

  private async syncReturnRevert(data: any): Promise<void> {
    const { order_id, route_id } = data;
    const { error } = await supabase
      .from('route_orders')
      .update({
        status: 'pending',
        returned_at: null,
        return_reason: null,
        return_notes: null,
      })
      .eq('order_id', order_id)
      .eq('route_id', route_id);

    if (error) {
      throw new Error(`Failed to revert return: ${error.message}`);
    }

    const { error: orderError } = await supabase
      .from('orders')
      .update({
        status: 'assigned', // LOCK: Back to 'assigned' (safe)
        return_flag: false,
        last_return_reason: null,
        last_return_notes: null,
      })
      .eq('id', order_id);
    if (orderError) console.warn('Failed to update order status on revert:', orderError);

    await this.logSyncAction('return_revert', order_id, 'pending', data.user_id || null);
  }

  private async syncDeliveryRevert(data: any): Promise<void> {
    const { order_id, route_id } = data;
    const { error } = await supabase
      .from('route_orders')
      .update({
        status: 'pending',
        delivered_at: null,
        signature_url: null,
      })
      .eq('order_id', order_id)
      .eq('route_id', route_id);

    if (error) {
      throw new Error(`Failed to revert delivery: ${error.message}`);
    }

    const { error: orderError } = await supabase
      .from('orders')
      .update({
        status: 'assigned', // LOCK: Back to 'assigned' (safe)
        return_flag: false,
      })
      .eq('id', order_id);
    if (orderError) console.warn('Failed to update order status on revert:', orderError);

    await this.logSyncAction('delivery_revert', order_id, 'pending', data.user_id || null);
  }

  private async syncOrderUpdate(data: any): Promise<void> {
    // Implement order update sync logic if needed
    console.log('Syncing order update:', data);
  }

  private async syncAssemblyUndo(data: any): Promise<void> {
    const { item_id, local_timestamp } = data;
    if (!item_id) throw new Error('Invalid assembly_undo payload');

    console.log('[BackgroundSync] syncAssemblyUndo:', item_id);

    // 1. Fetch current status to check if we are undoing a return
    const { data: current } = await supabase.from('assembly_products').select('status, order_id, product_sku, observations').eq('id', item_id).single();

    if (current && current.status === 'cancelled') {
      try {
        // Clean up ghost
        let query = supabase
          .from('assembly_products')
          .select('id')
          .eq('order_id', current.order_id)
          .eq('status', 'pending')
          .eq('was_returned', true)
          .is('assembly_route_id', null)
          .order('created_at', { ascending: false })
          .limit(1);

        if (current.product_sku) query = query.eq('product_sku', current.product_sku);

        const { data: ghosts } = await query;
        if (ghosts && ghosts.length > 0) {
          await supabase.from('assembly_products').delete().eq('id', ghosts[0].id);
          console.log('[BackgroundSync] Deleted ghost copy for undo');
        }
      } catch (e) {
        console.error('[BackgroundSync] Error cleaning ghost:', e);
      }
    }

    // 2. Revert status
    // Note: We use db current observations to clean strings, or default to whatever logic needed.
    // Ideally we assume current.observations is up to date relative to when action was queued? 
    // Actually the queue data usually doesn't contain full observations string, so we must use DB value.
    const obs = current?.observations || '';
    const cleanObs = obs.replace(/\(Retorno: .*\)\s*/, '').replace(/^Retorno: .*/, '').trim();

    const { error } = await supabase
      .from('assembly_products')
      .update({
        status: 'pending',
        completion_date: null,
        observations: cleanObs || null
      })
      .eq('id', item_id);

    if (error) throw error;
  }

  private async logSyncAction(
    entity: string,
    entityId: string,
    action: string,
    userId: string
  ): Promise<void> {
    try {
      const { error } = await supabase.from('sync_logs').insert({
        entity,
        entity_id: entityId,
        action,
        user_id: userId,
        timestamp: new Date().toISOString(),
      });

      if (error) {
        console.error('Failed to log sync action:', error);
      }
    } catch (error) {
      console.error('Error logging sync action:', error);
    }
  }

  private async logSyncError(item: any, error: Error): Promise<void> {
    try {
      await supabase.from('sync_logs').insert({
        entity: item.type,
        entity_id: item.id,
        action: 'sync_failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    } catch (logError) {
      console.error('Failed to log sync error:', logError);
    }
  }



  public getSyncStatus(): { isSyncing: boolean; isOnline: boolean } {
    return {
      isSyncing: this.isSyncing,
      isOnline: NetworkStatus.isOnline(),
    };
  }
}

// Export singleton instance
export const backgroundSync = BackgroundSyncService.getInstance();
