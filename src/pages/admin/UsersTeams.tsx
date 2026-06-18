import { useEffect, useMemo, useState } from 'react';
import supabase from '../../supabase/client';
import type { DeliveryRouteCatalog, User, Vehicle } from '../../types/database';
import { slugifyName, toLoginEmailFromName } from '../../lib/utils';
import { toast } from 'sonner';
import {
  Search,
  Edit,
  Trash2,
  Key,
  Plus,
  X,
  Check,
  Copy,
  Truck,
  Power,
} from 'lucide-react';

type AppRole = User['role'];

type TeamRecord = {
  id: string;
  name: string;
  driver_user_id: string;
  helper_user_id: string;
  created_at: string;
  active: boolean;
  driver?: { id?: string; name?: string; active?: boolean } | null;
  helper?: { id?: string; name?: string; active?: boolean } | null;
};

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  driver: 'Motorista',
  helper: 'Ajudante',
  montador: 'Montador',
  conferente: 'Conferente',
  consultor: 'Consultor',
};

const ROLE_STYLES: Record<AppRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  driver: 'bg-blue-100 text-blue-800',
  helper: 'bg-gray-100 text-gray-800',
  montador: 'bg-orange-100 text-orange-800',
  conferente: 'bg-teal-100 text-teal-800',
  consultor: 'bg-cyan-100 text-cyan-800',
};

const ensureSelectedOption = (
  options: Array<{ id: string; name: string }>,
  selectedId: string,
  users: User[]
) => {
  if (!selectedId || options.some((option) => option.id === selectedId)) return options;
  const selectedUser = users.find((user) => user.id === selectedId);
  if (!selectedUser) return options;
  return [...options, { id: selectedUser.id, name: `${selectedUser.name} (inativo)` }];
};

export default function UsersTeams() {
  const [activeTab, setActiveTab] = useState<'users' | 'teams' | 'vehicles' | 'routes'>('users');
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [deliveryRoutes, setDeliveryRoutes] = useState<DeliveryRouteCatalog[]>([]);

  const [showUserModal, setShowUserModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showDeliveryRouteModal, setShowDeliveryRouteModal] = useState(false);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingTeam, setEditingTeam] = useState<TeamRecord | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editingDeliveryRoute, setEditingDeliveryRoute] = useState<DeliveryRouteCatalog | null>(null);

  const [uName, setUName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRole, setURole] = useState<AppRole>('driver');
  const [uActive, setUActive] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);

  const [teamDriverId, setTeamDriverId] = useState('');
  const [teamHelperId, setTeamHelperId] = useState('');
  const [teamActive, setTeamActive] = useState(true);
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const [vModel, setVModel] = useState('');
  const [vPlate, setVPlate] = useState('');
  const [vActive, setVActive] = useState(true);
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);

  const [deliveryRouteName, setDeliveryRouteName] = useState('');
  const [deliveryRouteActive, setDeliveryRouteActive] = useState(true);
  const [isSavingDeliveryRoute, setIsSavingDeliveryRoute] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      setLoading(true);

      const { data: usersData } = await supabase
        .from('users')
        .select('id,email,name,role,phone,active,must_change_password,created_at')
        .order('name');
      if (usersData) setUsers(usersData as User[]);

      const { data: teamsData } = await supabase
        .from('teams_user')
        .select('id,name,driver_user_id,helper_user_id,created_at,active, driver:users!driver_user_id(id,name,active), helper:users!helper_user_id(id,name,active)')
        .order('created_at', { ascending: false });
      if (teamsData) setTeams((teamsData || []) as TeamRecord[]);

      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, model, plate, active')
        .order('model');
      if (vehiclesData) setVehicles((vehiclesData || []) as Vehicle[]);

      const { data: routeCatalogData } = await supabase
        .from('delivery_route_catalog')
        .select('id, name, active, created_at, updated_at')
        .order('name');
      if (routeCatalogData) setDeliveryRoutes(routeCatalogData as DeliveryRouteCatalog[]);
    } catch (e) {
      console.error(e);
      toast.error('Falha ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const genPassword = () => String(Math.floor(100000 + Math.random() * 900000));

  const resetUserForm = () => {
    setEditingUser(null);
    setUName('');
    setUPassword('');
    setURole('driver');
    setUActive(true);
    setGeneratedPassword(null);
  };

  const resetTeamForm = () => {
    setEditingTeam(null);
    setTeamDriverId('');
    setTeamHelperId('');
    setTeamActive(true);
  };

  const resetVehicleForm = () => {
    setEditingVehicle(null);
    setVModel('');
    setVPlate('');
    setVActive(true);
  };

  const resetDeliveryRouteForm = () => {
    setEditingDeliveryRoute(null);
    setDeliveryRouteName('');
    setDeliveryRouteActive(true);
  };

  const openCreateUserModal = () => {
    resetUserForm();
    setShowUserModal(true);
  };

  const openEditUserModal = (user: User) => {
    setEditingUser(user);
    setUName(user.name);
    setUPassword('');
    setURole(user.role);
    setUActive(user.active ?? true);
    setGeneratedPassword(null);
    setShowUserModal(true);
  };

  const closeUserModal = () => {
    setShowUserModal(false);
    resetUserForm();
  };

  const openCreateTeamModal = () => {
    resetTeamForm();
    setShowTeamModal(true);
  };

  const openEditTeamModal = (team: TeamRecord) => {
    setEditingTeam(team);
    setTeamDriverId(team.driver_user_id || '');
    setTeamHelperId(team.helper_user_id || '');
    setTeamActive(team.active ?? true);
    setShowTeamModal(true);
  };

  const closeTeamModal = () => {
    setShowTeamModal(false);
    resetTeamForm();
  };

  const openCreateVehicleModal = () => {
    resetVehicleForm();
    setShowVehicleModal(true);
  };

  const openEditVehicleModal = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVModel(vehicle.model || '');
    setVPlate(vehicle.plate || '');
    setVActive(vehicle.active ?? true);
    setShowVehicleModal(true);
  };

  const closeVehicleModal = () => {
    setShowVehicleModal(false);
    resetVehicleForm();
  };

  const openCreateDeliveryRouteModal = () => {
    resetDeliveryRouteForm();
    setShowDeliveryRouteModal(true);
  };

  const openEditDeliveryRouteModal = (route: DeliveryRouteCatalog) => {
    setEditingDeliveryRoute(route);
    setDeliveryRouteName(route.name || '');
    setDeliveryRouteActive(route.active ?? true);
    setShowDeliveryRouteModal(true);
  };

  const closeDeliveryRouteModal = () => {
    setShowDeliveryRouteModal(false);
    resetDeliveryRouteForm();
  };

  const upsertDriverStatus = async (userId: string, role: AppRole, active: boolean, previousRole?: AppRole) => {
    const wasDriver = previousRole === 'driver';
    const willBeDriver = role === 'driver';

    if (willBeDriver) {
      const { data: existingDriver, error: driverLookupError } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (driverLookupError) throw driverLookupError;

      if (existingDriver?.id) {
        const { error: updateDriverError } = await supabase
          .from('drivers')
          .update({ active })
          .eq('id', existingDriver.id);
        if (updateDriverError) throw updateDriverError;
      } else {
        const { error: insertDriverError } = await supabase
          .from('drivers')
          .insert({
            user_id: userId,
            cpf: '00000000000',
            vehicle_id: null,
            active,
          });
        if (insertDriverError) throw insertDriverError;
      }
      return;
    }

    if (wasDriver) {
      const { error: disableDriverError } = await supabase
        .from('drivers')
        .update({ active: false })
        .eq('user_id', userId);
      if (disableDriverError) throw disableDriverError;
    }
  };

  const saveUser = async () => {
    if (!uName.trim()) {
      toast.error('Informe o nome');
      return;
    }

    setIsSavingUser(true);
    try {
      if (editingUser) {
        const { error } = await supabase
          .from('users')
          .update({
            name: uName.trim(),
            role: uRole,
            active: uActive,
          })
          .eq('id', editingUser.id);
        if (error) throw error;

        await upsertDriverStatus(editingUser.id, uRole, uActive, editingUser.role);

        toast.success('Usuário atualizado com sucesso');
        closeUserModal();
        await loadAll();
        return;
      }

      const pwd = uPassword.trim() ? uPassword.trim() : genPassword();

      let pseudoEmail = toLoginEmailFromName(uName);
      const { data: existsUserEmail } = await supabase.from('users').select('id').eq('email', pseudoEmail).maybeSingle();
      if (existsUserEmail?.id) {
        const base = slugifyName(uName);
        pseudoEmail = `${base}.${String(Date.now()).slice(-4)}@solidgo.local`;
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;
      if (!functionUrl || !functionUrl.startsWith('http')) {
        throw new Error('Configuracao do Supabase invalida no frontend.');
      }

      const payload: Record<string, unknown> = {
        email: pseudoEmail,
        password: pwd,
        name: uName.trim(),
        role: uRole,
      };

      if (uRole !== 'driver') {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) throw new Error('Sessao expirada. Faca login novamente.');
        payload.auth_token = accessToken;
      }

      const response = await fetch(functionUrl, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      let resData: any = null;
      try {
        resData = raw ? JSON.parse(raw) : null;
      } catch {
        resData = null;
      }

      if (!response.ok || resData?.error) {
        throw new Error(resData?.error || `Falha ao criar usuario (HTTP ${response.status})`);
      }

      setGeneratedPassword(pwd);
      toast.success('Usuário criado com sucesso!');
      setUName('');
      setUPassword('');
      setURole('driver');
      setUActive(true);
      await loadAll();
    } catch (e: any) {
      console.error(e);
      if (!editingUser) setGeneratedPassword(null);
      toast.error(String(e.message || 'Falha ao salvar usuário'));
    } finally {
      setIsSavingUser(false);
    }
  };

  const saveTeam = async () => {
    if (!teamDriverId || !teamHelperId) {
      toast.error('Selecione motorista e ajudante/montador');
      return;
    }

    setIsSavingTeam(true);
    try {
      const drv = users.find((user) => user.id === teamDriverId);
      const hlp = users.find((user) => user.id === teamHelperId);
      const teamName = `${drv?.name || ''} x ${hlp?.name || ''}`.trim() || 'Equipe';

      if (editingTeam) {
        const { error } = await supabase
          .from('teams_user')
          .update({
            driver_user_id: teamDriverId,
            helper_user_id: teamHelperId,
            name: teamName,
            active: teamActive,
          })
          .eq('id', editingTeam.id);
        if (error) throw error;
        toast.success('Equipe atualizada com sucesso');
      } else {
        const { error } = await supabase.from('teams_user').insert({
          driver_user_id: teamDriverId,
          helper_user_id: teamHelperId,
          name: teamName,
          active: true,
        });
        if (error) throw error;
        toast.success('Equipe criada com sucesso');
      }

      closeTeamModal();
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao salvar equipe'));
    } finally {
      setIsSavingTeam(false);
    }
  };

  const saveVehicle = async () => {
    if (!vModel.trim() || !vPlate.trim()) {
      toast.error('Informe modelo e placa');
      return;
    }

    setIsSavingVehicle(true);
    try {
      const plate = vPlate.trim().toUpperCase();

      if (editingVehicle) {
        const { error } = await supabase
          .from('vehicles')
          .update({
            model: vModel.trim(),
            plate,
            active: vActive,
          })
          .eq('id', editingVehicle.id);
        if (error) throw error;
        toast.success('Veículo atualizado com sucesso');
      } else {
        const { error: rpcError } = await supabase.rpc('insert_vehicle', {
          p_model: vModel.trim(),
          p_plate: plate,
        });
        if (rpcError) throw rpcError;
        toast.success('Veículo salvo com sucesso');
      }

      closeVehicleModal();
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao salvar veículo'));
    } finally {
      setIsSavingVehicle(false);
    }
  };

  const saveDeliveryRoute = async () => {
    if (!deliveryRouteName.trim()) {
      toast.error('Informe o nome da rota');
      return;
    }
    setIsSavingDeliveryRoute(true);
    try {
      const normalizedName = deliveryRouteName.trim().toUpperCase();

      if (editingDeliveryRoute) {
        const { error } = await supabase
          .from('delivery_route_catalog')
          .update({
            name: normalizedName,
            active: deliveryRouteActive,
          })
          .eq('id', editingDeliveryRoute.id);
        if (error) throw error;
        toast.success('Rota atualizada com sucesso');
      } else {
        const { error } = await supabase.from('delivery_route_catalog').insert({
          name: normalizedName,
          active: true,
        });
        if (error) throw error;
        toast.success('Rota cadastrada com sucesso');
      }

      closeDeliveryRouteModal();
      await loadAll();
    } catch (e: any) {
      if (String(e?.code) === '23505') {
        toast.error('Já existe uma rota cadastrada com esse nome');
      } else {
        toast.error(String(e.message || 'Falha ao salvar rota'));
      }
    } finally {
      setIsSavingDeliveryRoute(false);
    }
  };

  const toggleDeliveryRouteStatus = async (route: DeliveryRouteCatalog) => {
    try {
      const { error } = await supabase
        .from('delivery_route_catalog')
        .update({ active: !route.active })
        .eq('id', route.id);
      if (error) throw error;
      toast.success(route.active ? 'Rota inativada' : 'Rota ativada');
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao atualizar status da rota'));
    }
  };

  const toggleUserStatus = async (user: User) => {
    try {
      const nextActive = !(user.active ?? true);
      const { error } = await supabase
        .from('users')
        .update({ active: nextActive })
        .eq('id', user.id);
      if (error) throw error;

      await upsertDriverStatus(user.id, user.role, nextActive, user.role);

      toast.success(nextActive ? 'Usuário ativado' : 'Usuário inativado');
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao atualizar status do usuário'));
    }
  };

  const toggleTeamStatus = async (team: TeamRecord) => {
    try {
      const { error } = await supabase
        .from('teams_user')
        .update({ active: !team.active })
        .eq('id', team.id);
      if (error) throw error;
      toast.success(team.active ? 'Equipe inativada' : 'Equipe ativada');
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao atualizar status da equipe'));
    }
  };

  const toggleVehicleStatus = async (vehicle: Vehicle) => {
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({ active: !(vehicle.active ?? true) })
        .eq('id', vehicle.id);
      if (error) throw error;
      toast.success(vehicle.active ? 'Veículo inativado' : 'Veículo ativado');
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao atualizar status do veículo'));
    }
  };

  const copyPwd = async () => {
    try {
      if (generatedPassword) {
        await navigator.clipboard.writeText(generatedPassword);
        toast.success('Senha copiada');
      }
    } catch {
      toast.error('Falha ao copiar senha');
    }
  };

  const activeDrivers = useMemo(
    () => users.filter((user) => user.active && user.role === 'driver').map((user) => ({ id: user.id, name: user.name })),
    [users]
  );

  const activeHelpers = useMemo(
    () => users
      .filter((user) => user.active && (user.role === 'helper' || user.role === 'montador'))
      .map((user) => ({ id: user.id, name: user.name })),
    [users]
  );

  const driverOptions = useMemo(
    () => ensureSelectedOption(activeDrivers, teamDriverId, users),
    [activeDrivers, teamDriverId, users]
  );

  const helperOptions = useMemo(
    () => ensureSelectedOption(activeHelpers, teamHelperId, users),
    [activeHelpers, teamHelperId, users]
  );

  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        const haystack = `${user.name} ${user.email} ${user.role} ${user.active ? 'ativo' : 'inativo'}`.toLowerCase();
        return haystack.includes(searchTerm.toLowerCase());
      }),
    [users, searchTerm]
  );

  const filteredTeams = useMemo(
    () =>
      teams.filter((team) => {
        const haystack = `${team.name} ${team.driver?.name || ''} ${team.helper?.name || ''} ${team.active ? 'ativo' : 'inativo'}`.toLowerCase();
        return haystack.includes(searchTerm.toLowerCase());
      }),
    [teams, searchTerm]
  );

  const filteredVehicles = useMemo(
    () =>
      vehicles.filter((vehicle) => {
        const haystack = `${vehicle.model} ${vehicle.plate} ${vehicle.active ? 'ativo' : 'inativo'}`.toLowerCase();
        return haystack.includes(searchTerm.toLowerCase());
      }),
    [vehicles, searchTerm]
  );

  const filteredDeliveryRoutes = useMemo(
    () => deliveryRoutes.filter((route) => route.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [deliveryRoutes, searchTerm]
  );

  const RoleBadge = ({ role }: { role: AppRole }) => (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );

  if (loading) {
    return (
      <div className="w-full p-8">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          Carregando cadastros...
        </div>
      </div>
    );
  }

  return (
    <div className="w-full pb-20">
      <div className="w-full p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex overflow-x-auto items-center gap-3 bg-white p-2 rounded-xl shadow-sm border border-gray-200">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 whitespace-nowrap rounded-md text-sm font-medium transition-all ${activeTab === 'users' ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            Usuários
          </button>
          <button
            onClick={() => setActiveTab('teams')}
            className={`px-4 py-2 whitespace-nowrap rounded-md text-sm font-medium transition-all ${activeTab === 'teams' ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            Equipes
          </button>
          <button
            onClick={() => setActiveTab('vehicles')}
            className={`px-4 py-2 whitespace-nowrap rounded-md text-sm font-medium transition-all ${activeTab === 'vehicles' ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            Veículos
          </button>
          <button
            onClick={() => setActiveTab('routes')}
            className={`px-4 py-2 whitespace-nowrap rounded-md text-sm font-medium transition-all ${activeTab === 'routes' ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            Rotas Padrão
          </button>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={`Buscar ${activeTab === 'users' ? 'usuários' : activeTab === 'teams' ? 'equipes' : activeTab === 'vehicles' ? 'veículos' : 'rotas'}...`}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            onClick={() => {
              if (activeTab === 'users') openCreateUserModal();
              else if (activeTab === 'teams') openCreateTeamModal();
              else if (activeTab === 'vehicles') openCreateVehicleModal();
              else openCreateDeliveryRouteModal();
            }}
            className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            {activeTab === 'users' ? 'Novo Usuário' : activeTab === 'teams' ? 'Nova Equipe' : activeTab === 'vehicles' ? 'Novo Veículo' : 'Nova Rota'}
          </button>
        </div>

        {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUsers.map((user) => (
              <div key={user.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-lg font-bold">
                      {user.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{user.name}</h3>
                      <p className="text-sm text-gray-500">{user.email}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <RoleBadge role={user.role} />
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${user.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {user.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => openEditUserModal(user)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-xs font-medium flex items-center"
                  >
                    <Edit className="h-4 w-4 mr-1" /> Editar
                  </button>
                  <button
                    onClick={() => toggleUserStatus(user)}
                    className={`p-2 rounded-lg transition-colors text-xs font-medium flex items-center ${user.active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                  >
                    <Power className="h-4 w-4 mr-1" /> {user.active ? 'Inativar' : 'Ativar'}
                  </button>
                  <button
                    onClick={async () => {
                      const temp = genPassword();
                      try {
                        const resp = await fetch('/api/reset-password', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: user.id, newPassword: temp }),
                        });
                        if (!resp.ok) {
                          let msg = 'Falha ao resetar senha';
                          try {
                            const json = await resp.json();
                            if (json?.error) msg = json.error;
                          } catch {
                            // ignore
                          }
                          throw new Error(msg);
                        }
                        await supabase.from('users').update({ must_change_password: true }).eq('id', user.id);
                        toast.success(`Senha resetada: ${temp}`, { duration: 10000 });
                        await loadAll();
                      } catch (e: any) {
                        toast.error(String(e.message || 'Erro ao resetar senha'));
                      }
                    }}
                    className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors text-xs font-medium flex items-center"
                  >
                    <Key className="h-4 w-4 mr-1" /> Resetar
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remover usuário "${user.name}"?`)) return;
                      try {
                        const resp = await fetch('/api/delete-user', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: user.id }),
                        });
                        if (!resp.ok) {
                          let message = 'Falha ao remover';
                          try {
                            const json = await resp.json();
                            if (json?.error) message = json.error;
                          } catch {
                            // ignore
                          }
                          throw new Error(message);
                        }
                        toast.success('Usuário removido');
                        await loadAll();
                      } catch (e: any) {
                        toast.error(String(e.message || 'Erro ao remover usuário'));
                      }
                    }}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-xs font-medium flex items-center"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'teams' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome da Equipe</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Motorista</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ajudante/Montador</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Criada em</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTeams.map((team) => (
                  <tr key={team.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{team.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{team.driver?.name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{team.helper?.name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${team.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {team.active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(team.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditTeamModal(team)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleTeamStatus(team)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${team.active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                        >
                          {team.active ? 'Inativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTeams.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">Nenhuma equipe encontrada</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'vehicles' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVehicles.map((vehicle) => (
              <div key={vehicle.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Truck className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{vehicle.model}</h3>
                      <p className="text-sm text-gray-500 font-mono">{vehicle.plate}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${vehicle.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {vehicle.active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    onClick={() => openEditVehicleModal(vehicle)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleVehicleStatus(vehicle)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${vehicle.active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                  >
                    {vehicle.active ? 'Inativar' : 'Ativar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'routes' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome da Rota</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Criada em</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDeliveryRoutes.map((route) => (
                  <tr key={route.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{route.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${route.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {route.active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(route.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditDeliveryRouteModal(route)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleDeliveryRouteStatus(route)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${route.active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                        >
                          {route.active ? 'Inativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDeliveryRoutes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">Nenhuma rota cadastrada</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h3>
              <button onClick={closeUserModal} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              {!generatedPassword ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
                    <input
                      value={uName}
                      onChange={(event) => setUName(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Ex: João da Silva"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Função</label>
                    <select
                      value={uRole}
                      onChange={(event) => setURole(event.target.value as AppRole)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="driver">Motorista</option>
                      <option value="helper">Ajudante</option>
                      <option value="montador">Montador</option>
                      <option value="conferente">Conferente</option>
                      <option value="consultor">Consultor</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  {!editingUser && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Senha Inicial (Opcional)</label>
                      <input
                        type="password"
                        value={uPassword}
                        onChange={(event) => setUPassword(event.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Deixe vazio para gerar automaticamente"
                      />
                    </div>
                  )}
                  {editingUser && (
                    <label className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                      <span className="text-sm font-medium text-gray-700">Usuário ativo</span>
                      <input type="checkbox" checked={uActive} onChange={(event) => setUActive(event.target.checked)} className="h-4 w-4" />
                    </label>
                  )}
                </>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center space-y-3">
                  <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <Check className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="text-lg font-bold text-green-800">Usuário criado</h4>
                  <p className="text-sm text-green-700">Copie a senha inicial abaixo:</p>
                  <div className="flex items-center gap-2 bg-white border border-green-200 p-3 rounded-lg">
                    <code className="flex-1 text-lg font-mono font-bold text-gray-800">{generatedPassword}</code>
                    <button onClick={copyPwd} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700" title="Copiar">
                      <Copy className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">Esta senha só será exibida uma vez.</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              {!generatedPassword ? (
                <>
                  <button onClick={closeUserModal} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
                  <button
                    onClick={saveUser}
                    disabled={isSavingUser}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isSavingUser ? 'Salvando...' : editingUser ? 'Salvar Alterações' : 'Criar Usuário'}
                  </button>
                </>
              ) : (
                <button onClick={closeUserModal} className="w-full px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors">
                  Concluir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showTeamModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editingTeam ? 'Editar Equipe' : 'Nova Equipe'}</h3>
              <button onClick={closeTeamModal} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motorista</label>
                <select value={teamDriverId} onChange={(event) => setTeamDriverId(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Selecione...</option>
                  {driverOptions.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ajudante / Montador</label>
                <select value={teamHelperId} onChange={(event) => setTeamHelperId(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Selecione...</option>
                  {helperOptions.map((helper) => <option key={helper.id} value={helper.id}>{helper.name}</option>)}
                </select>
              </div>
              {editingTeam && (
                <label className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                  <span className="text-sm font-medium text-gray-700">Equipe ativa</span>
                  <input type="checkbox" checked={teamActive} onChange={(event) => setTeamActive(event.target.checked)} className="h-4 w-4" />
                </label>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closeTeamModal} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
              <button
                onClick={saveTeam}
                disabled={isSavingTeam}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSavingTeam ? 'Salvando...' : editingTeam ? 'Salvar Alterações' : 'Criar Equipe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVehicleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editingVehicle ? 'Editar Veículo' : 'Novo Veículo'}</h3>
              <button onClick={closeVehicleModal} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
                <input
                  value={vModel}
                  onChange={(event) => setVModel(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ex: Fiat Ducato"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Placa</label>
                <input
                  value={vPlate}
                  onChange={(event) => setVPlate(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="ABC-1234"
                />
              </div>
              {editingVehicle && (
                <label className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                  <span className="text-sm font-medium text-gray-700">Veículo ativo</span>
                  <input type="checkbox" checked={vActive} onChange={(event) => setVActive(event.target.checked)} className="h-4 w-4" />
                </label>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closeVehicleModal} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
              <button
                onClick={saveVehicle}
                disabled={isSavingVehicle}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSavingVehicle ? 'Salvando...' : editingVehicle ? 'Salvar Alterações' : 'Salvar Veículo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeliveryRouteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">{editingDeliveryRoute ? 'Editar Rota Padrão' : 'Nova Rota Padrão'}</h3>
              <button onClick={closeDeliveryRouteModal} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da Rota</label>
                <input
                  value={deliveryRouteName}
                  onChange={(event) => setDeliveryRouteName(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ex: ROTA IPANGUAÇU"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Essas rotas serão exibidas no dropdown da criação de romaneios.
                </p>
              </div>
              {editingDeliveryRoute && (
                <label className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                  <span className="text-sm font-medium text-gray-700">Rota ativa</span>
                  <input
                    type="checkbox"
                    checked={deliveryRouteActive}
                    onChange={(event) => setDeliveryRouteActive(event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closeDeliveryRouteModal} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
              <button
                onClick={saveDeliveryRoute}
                disabled={isSavingDeliveryRoute}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSavingDeliveryRoute ? 'Salvando...' : editingDeliveryRoute ? 'Salvar Alterações' : 'Salvar Rota'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
