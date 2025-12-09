import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, MapPin, User as UserIcon, Calendar, Camera, CheckCircle, Clock, AlertCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { AssemblyProductWithDetails } from '../../types/database';
import { useAuthStore } from '../../stores/authStore';

export default function AssemblyDashboard() {
  const [assemblyProducts, setAssemblyProducts] = useState<AssemblyProductWithDetails[]>([]);
  const [pendingProducts, setPendingProducts] = useState<AssemblyProductWithDetails[]>([]);
  const [myProducts, setMyProducts] = useState<AssemblyProductWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<AssemblyProductWithDetails | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [technicalNotes, setTechnicalNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const fetchAssemblyProducts = async () => {
    try {
      setLoading(true);
      
      // Buscar produtos de montagem
      const { data: productsData } = await supabase
        .from('assembly_products')
        .select(`
          *,
          order:order_id (*),
          installer:installer_id (*),
          route:assembly_route_id (*)
        `)
        .order('created_at', { ascending: false });

      // Buscar produtos pendentes (que ainda não foram atribuídos)
      const { data: pendingData } = await supabase
        .from('assembly_products')
        .select(`
          *,
          order:order_id (*),
          installer:installer_id (*),
          route:assembly_route_id (*)
        `)
        .is('installer_id', null)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      setAssemblyProducts(productsData || []);
      setPendingProducts(pendingData || []);
      
      // Filtrar produtos atribuídos ao usuário atual
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const myProductsData = (productsData || []).filter(product => product.installer_id === user.id);
        setMyProducts(myProductsData);
      }
      
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      toast.error('Erro ao carregar produtos para montagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssemblyProducts();
  }, []);

  const logout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {}
    navigate('/login');
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + photos.length > 5) {
      toast.error('Máximo de 5 fotos permitidas');
      return;
    }
    
    setPhotos([...photos, ...files]);
    
    // Criar previews
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoPreviews(prev => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotoPreviews(photoPreviews.filter((_, i) => i !== index));
  };

  const uploadPhotos = async (): Promise<string[]> => {
    const uploadedUrls: string[] = [];
    
    for (const photo of photos) {
      const fileName = `${Date.now()}-${photo.name}`;
      const { data, error } = await supabase.storage
        .from('assembly-photos')
        .upload(fileName, photo);
      
      if (error) {
        console.error('Erro ao fazer upload da foto:', error);
        continue;
      }
      
      const { data: { publicUrl } } = supabase.storage
        .from('assembly-photos')
        .getPublicUrl(fileName);
      
      uploadedUrls.push(publicUrl);
    }
    
    return uploadedUrls;
  };

  const markAsCompleted = async () => {
    if (!selectedProduct) return;
    
    try {
      let photoUrls: string[] = [];
      
      if (photos.length > 0) {
        photoUrls = await uploadPhotos();
      }

      const { error } = await supabase
        .from('assembly_products')
        .update({
          status: 'completed',
          completion_date: new Date().toISOString(),
          technical_notes: technicalNotes,
          photos: photoUrls
        })
        .eq('id', selectedProduct.id);

      if (error) throw error;

      // Registrar log
      try {
        const userId = (await supabase.auth.getUser()).data.user?.id || '';
        await supabase.from('audit_logs').insert({
          entity_type: 'assembly_product',
          entity_id: selectedProduct.id,
          action: 'completed',
          details: { technical_notes: technicalNotes, photos: photoUrls },
          user_id: userId,
          timestamp: new Date().toISOString(),
        });
      } catch {}
      
      toast.success('Montagem concluída com sucesso!');
      setShowModal(false);
      setSelectedProduct(null);
      setTechnicalNotes('');
      setPhotos([]);
      setPhotoPreviews([]);
      fetchAssemblyProducts();
      
    } catch (error) {
      console.error('Erro ao concluir montagem:', error);
      toast.error('Erro ao concluir montagem');
    }
  };

  const startAssembly = async (productId: string) => {
    try {
      const { error } = await supabase
        .from('assembly_products')
        .update({
          status: 'in_progress',
          assembly_date: new Date().toISOString()
        })
        .eq('id', productId);

      if (error) throw error;
      
      // Registrar log
      try {
        const userId = (await supabase.auth.getUser()).data.user?.id || '';
        await supabase.from('audit_logs').insert({
          entity_type: 'assembly_product',
          entity_id: productId,
          action: 'started',
          details: {},
          user_id: userId,
          timestamp: new Date().toISOString(),
        });
      } catch {}
      
      toast.success('Montagem iniciada!');
      fetchAssemblyProducts();
      
    } catch (error) {
      console.error('Erro ao iniciar montagem:', error);
      toast.error('Erro ao iniciar montagem');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'assigned': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-orange-100 text-orange-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'assigned': return 'Atribuído';
      case 'in_progress': return 'Em Andamento';
      case 'completed': return 'Concluído';
      case 'cancelled': return 'Cancelado';
      default: return status;
    }
  };

  const getOrderCompleteInfo = (product: AssemblyProductWithDetails) => {
    const order = product.order;
    const address = typeof order?.address_json === 'string' ? JSON.parse(order.address_json) : order?.address_json;
    const items = typeof order?.items_json === 'string' ? JSON.parse(order.items_json) : order?.items_json;
    
    return {
      orderId: order?.order_id_erp || '—',
      numeroLancamento: order?.order_id_erp || '—',
      cliente: order?.customer_name || '—',
      telefone: order?.phone || '—',
      enderecoCompleto: address ? `${address.street}${address.number ? ', ' + address.number : ''} - ${address.neighborhood || ''}` : '—',
      cidade: address?.city || '—',
      bairro: address?.neighborhood || '—',
      dataVenda: order?.sale_date ? new Date(order.sale_date).toLocaleDateString('pt-BR') : '—',
      dataEntrega: order?.delivery_date ? new Date(order.delivery_date).toLocaleDateString('pt-BR') : '—',
      motoristaEntrega: order?.driver_name || '—',
      observacoes: (order as any)?.observacoes_publicas || (order as any)?.raw_json?.observacoes || '—',
      observacoesInternas: order?.observacoes_internas || '—'
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
             <h1 className="text-2xl font-bold text-gray-900 flex items-center">
               <Package className="h-6 w-6 mr-2" />
               Dashboard de Montagem
             </h1>
          </div>
          <div className="flex items-center space-x-2">
            <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-sm font-medium">Montador</span>
            <button onClick={logout} className="px-3 py-2 bg-gray-100 text-gray-800 rounded border hover:bg-gray-200">Sair</button>
          </div>
        </div>
        <p className="text-gray-600 mt-1">Bem-vindo, {user?.name || user?.email}</p>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Package className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Montagens</p>
              <p className="text-2xl font-semibold text-gray-900">{assemblyProducts.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Pendentes</p>
              <p className="text-2xl font-semibold text-gray-900">
                {assemblyProducts.filter(p => p.status === 'pending').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UserIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Em Andamento</p>
              <p className="text-2xl font-semibold text-gray-900">
                {assemblyProducts.filter(p => p.status === 'in_progress').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Concluídas</p>
              <p className="text-2xl font-semibold text-gray-900">
                {assemblyProducts.filter(p => p.status === 'completed').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de Produtos Pendentes */}
      {pendingProducts.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 text-yellow-600">Produtos Pendentes para Atribuição</h2>
                <p className="text-sm text-gray-600">Estes produtos precisam ser atribuídos a montadores</p>
              </div>
              <button
                onClick={() => window.open('/admin/montagem', '_blank')}
                className="inline-flex items-center px-3 py-1 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <Plus className="h-4 w-4 mr-1" />
                Criar Rota
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produto</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Pedido</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Lançamento</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endereço</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cidade</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bairro</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Venda</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Entrega</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Motorista</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Observações</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Obs. Internas</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pendingProducts.map((product) => {
                  const info = getOrderCompleteInfo(product);
                  return (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {product.product_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.orderId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.numeroLancamento}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.cliente}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <div className="max-h-12 overflow-y-auto" title={info.enderecoCompleto}>
                          {info.enderecoCompleto}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.cidade}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.bairro}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.dataVenda}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.dataEntrega}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.motoristaEntrega}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <div className="max-h-12 overflow-y-auto" title={info.observacoes}>
                          {info.observacoes}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <div className="max-h-12 overflow-y-auto" title={info.observacoesInternas}>
                          {info.observacoesInternas}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(product.status)}`}>
                          {getStatusLabel(product.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lista de Montagens */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Suas Montagens</h2>
        </div>
        
        {myProducts.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>Nenhuma montagem atribuída a você</p>
            <p className="text-sm mt-2">Aguarde novas atribuições do administrador</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produto</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Pedido</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Lançamento</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endereço</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cidade</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bairro</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Venda</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Entrega</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Motorista</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Observações</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Obs. Internas</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {myProducts.map((product) => {
                  const info = getOrderCompleteInfo(product);
                  return (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {product.product_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.orderId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.numeroLancamento}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.cliente}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <div className="max-h-12 overflow-y-auto" title={info.enderecoCompleto}>
                          {info.enderecoCompleto}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.cidade}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.bairro}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.dataVenda}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.dataEntrega}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {info.motoristaEntrega}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <div className="max-h-12 overflow-y-auto" title={info.observacoes}>
                          {info.observacoes}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <div className="max-h-12 overflow-y-auto" title={info.observacoesInternas}>
                          {info.observacoesInternas}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(product.status)}`}>
                          {getStatusLabel(product.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {product.status === 'assigned' && (
                          <button
                            onClick={() => startAssembly(product.id)}
                            className="text-blue-600 hover:text-blue-900 mr-2"
                          >
                            Iniciar
                          </button>
                        )}
                        {product.status === 'in_progress' && (
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setShowModal(true);
                            }}
                            className="text-green-600 hover:text-green-900"
                          >
                            Concluir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Conclusão */}
      {showModal && selectedProduct && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Concluir Montagem</h3>
                <button
                  onClick={() => {
                    setShowModal(false);
                    setSelectedProduct(null);
                    setTechnicalNotes('');
                    setPhotos([]);
                    setPhotoPreviews([]);
                  }}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <span className="sr-only">Fechar</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="px-6 py-4 space-y-4">
              {(() => {
                const info = getOrderCompleteInfo(selectedProduct);
                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Produto</h4>
                        <p className="text-gray-600">{selectedProduct.product_name}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Nº Pedido</h4>
                        <p className="text-gray-600">{info.orderId}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Nº Lançamento</h4>
                        <p className="text-gray-600">{info.numeroLancamento}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Cliente</h4>
                        <p className="text-gray-600">{info.cliente}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Telefone</h4>
                        <p className="text-gray-600">{info.telefone}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Data Venda</h4>
                        <p className="text-gray-600">{info.dataVenda}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Data Entrega</h4>
                        <p className="text-gray-600">{info.dataEntrega}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Motorista Entrega</h4>
                        <p className="text-gray-600">{info.motoristaEntrega}</p>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-medium text-gray-900 mb-1">Endereço Completo</h4>
                      <p className="text-gray-600">{info.enderecoCompleto}</p>
                    </div>
                    
                    {info.observacoes !== '—' && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Observações</h4>
                        <p className="text-gray-600 bg-yellow-50 p-2 rounded border border-yellow-200">{info.observacoes}</p>
                      </div>
                    )}
                    
                    {info.observacoesInternas !== '—' && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Observações Internas</h4>
                        <p className="text-gray-600 bg-blue-50 p-2 rounded border border-blue-200">{info.observacoesInternas}</p>
                      </div>
                    )}
                  </>
                );
              })()}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações Técnicas
                </label>
                <textarea
                  value={technicalNotes}
                  onChange={(e) => setTechnicalNotes(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Descreva detalhes da montagem, problemas encontrados, etc..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fotos da Montagem (máximo 5)
                </label>
                <div className="space-y-4">
                  {photoPreviews.length > 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {photoPreviews.map((preview, index) => (
                        <div key={index} className="relative">
                          <img
                            src={preview}
                            alt={`Foto ${index + 1}`}
                            className="w-full h-24 object-cover rounded-lg border"
                          />
                          <button
                            onClick={() => removePhoto(index)}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {photoPreviews.length < 5 && (
                    <div className="flex items-center justify-center w-full">
                      <label className="w-full flex flex-col items-center px-4 py-6 bg-white text-blue rounded-lg shadow-lg tracking-wide uppercase border border-blue cursor-pointer hover:bg-blue hover:text-white">
                        <Camera className="h-8 w-8" />
                        <span className="mt-2 text-base leading-normal">Adicionar Foto</span>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          multiple
                          onChange={handlePhotoUpload}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedProduct(null);
                  setTechnicalNotes('');
                  setPhotos([]);
                  setPhotoPreviews([]);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Cancelar
              </button>
              <button
                onClick={markAsCompleted}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <CheckCircle className="h-4 w-4 mr-1 inline" />
                Concluir Montagem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
