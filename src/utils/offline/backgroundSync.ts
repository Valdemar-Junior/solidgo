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

  private async syncPendingItems(): Promise<number> {
    if (this.isSyncing || !NetworkStatus.isOnline()) {
      return 0;
    }

    this.isSyncing = true;
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
          
          // If too many attempts, mark as failed permanently
          if (item.attempts >= 3) {
            await this.logSyncError(item, error as Error);
          }
        }
      }

      if (syncedCount > 0) {
        await SyncQueue.removeCompletedItems();
        toast.success(`${syncedCount} sincronizações concluídas`);
      }

    } catch (error) {
      console.error('Error during sync:', error);
    } finally {
      this.isSyncing = false;
    }
    return syncedCount;
  }

  private async syncItem(item: any): Promise<void> {
    switch (item.type) {
      case 'delivery_confirmation':
        await this.syncDeliveryConfirmation(item.data);
        break;
      case 'order_update':
        await this.syncOrderUpdate(item.data);
        break;
      default:
        console.warn(`Unknown sync item type: ${item.type}`);
    }
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
        .update({ status: 'delivered' })
        .eq('id', order_id);
      if (orderError) console.warn('Failed to update order status:', orderError);
    } else if (action === 'returned') {
      const { error: orderError2 } = await supabase
        .from('orders')
        .update({ status: 'returned' })
        .eq('id', order_id);
      if (orderError2) console.warn('Failed to update order status:', orderError2);
    }

    await this.logSyncAction('delivery_confirmation', order_id, action, user_id);
  }

  private async syncOrderUpdate(data: any): Promise<void> {
    // Implement order update sync logic if needed
    console.log('Syncing order update:', data);
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

  public async forceSync(): Promise<number> {
    if (!NetworkStatus.isOnline()) {
      toast.error('Sem conexão com a internet');
      return 0;
    }

    toast.info('Sincronizando dados...');
    const count = await this.syncPendingItems();
    return count;
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
