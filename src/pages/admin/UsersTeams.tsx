import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../../supabase/client';
import type { User } from '../../types/database';
import { slugifyName, toLoginEmailFromName } from '../../lib/utils';
import { toast } from 'sonner';
import {
  Users,
  UserPlus,
  Truck,
  Briefcase,
  Search,
  Filter,
  MoreVertical,
  Edit,
  Trash2,
  Key,
  Plus,
  X,
  Check,
  Shield,
  User as UserIcon,
  Settings,
  Copy,
  ArrowLeft
} from 'lucide-react';

export default function UsersTeams() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'users' | 'teams' | 'vehicles'>('users');
  const [loading, setLoading] = useState(true);

  // Data States
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  // Modal States
  const [showUserModal, setShowUserModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);

  // Form States - User
  const [uName, setUName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRole, setURole] = useState<'admin' | 'driver' | 'helper' | 'montador' | 'conferente' | 'consultor'>('driver');
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Form States - Team
  const [teamDriverId, setTeamDriverId] = useState('');
  const [teamHelperId, setTeamHelperId] = useState('');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);

  // Form States - Vehicle
  const [vModel, setVModel] = useState('');
  const [vPlate, setVPlate] = useState('');
  const [isCreatingVehicle, setIsCreatingVehicle] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { loadAll() }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      const { data: usersData } = await supabase.from('users').select('*').order('name');
      if (usersData) setUsers(usersData as User[]);

      const { data: teamsData } = await supabase
        .from('teams_user')
        .select('id,name,created_at, driver:users!driver_user_id(name), helper:users!helper_user_id(name)')
        .order('created_at', { ascending: false });
      if (teamsData) setTeams(teamsData);

      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, model, plate, active')
        .order('model');
      if (vehiclesData) setVehicles(vehiclesData);
    } catch (e) {
      console.error(e);
      toast.error('Falha ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const genPassword = () => String(Math.floor(100000 + Math.random() * 900000));

  const createUser = async () => {
    if (!uName.trim()) { toast.error('Informe o nome'); return; }
    setIsCreatingUser(true);
    try {
      const pwd = uPassword.trim() ? uPassword.trim() : genPassword();
      setGeneratedPassword(pwd);
      let pseudoEmail = toLoginEmailFromName(uName);
      const { data: existsUserEmail } = await supabase.from('users').select('id').eq('email', pseudoEmail).maybeSingle();
      if (existsUserEmail?.id) {
        const base = slugifyName(uName);
        pseudoEmail = `${base}.${String(Date.now()).slice(-4)}@solidgo.local`;
      }
      const { data: prev } = await supabase.auth.getSession();
      localStorage.setItem('auth_lock', '1');
      let uid = '';
      let signRes = await supabase.auth.signUp({ email: pseudoEmail, password: pwd });
      if (signRes.error) {
        const msg = String(signRes.error.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('user already exists') || signRes.error.status === 422) {
          const altEmail = `${slugifyName(uName)}.${String(Date.now()).slice(-6)}@solidgo.local`;
          const altSignup = await supabase.auth.signUp({ email: altEmail, password: pwd });
          if (altSignup.error) throw altSignup.error;
          uid = altSignup.data.user?.id || '';
          pseudoEmail = altEmail;
        } else {
          throw signRes.error;
        }
      } else {
        uid = signRes.data.user?.id || '';
      }
      if (!uid) throw new Error('Falha ao obter id do usuário');

      if (prev?.session?.access_token && prev?.session?.refresh_token) {
        await supabase.auth.setSession({ access_token: prev.session.access_token, refresh_token: prev.session.refresh_token });
      }

      const { error: insErr } = await supabase.from('users').upsert({
        id: uid,
        email: pseudoEmail,
        name: uName.trim(),
        role: uRole,
        must_change_password: true,
      }, { onConflict: 'id' });
      if (insErr) throw insErr;

      if (uRole === 'driver') {
        try {
          const { data: drvExists } = await supabase.from('drivers').select('id').eq('user_id', uid).maybeSingle();
          if (!drvExists?.id) {
            await supabase.from('drivers').insert({ user_id: uid, active: true });
          }
        } catch (error) {
          try {
            await supabase.from('drivers').upsert({ user_id: uid, active: true }, { onConflict: 'user_id' });
          } catch { }
        }
      }
      toast.success('Usuário criado com sucesso!');
      setUName(''); setUPassword(''); setURole('driver');
      await loadAll();
      // Keep modal open to show password, or close it?
      // Better to keep it open if showing password, but maybe design a success state in modal
    } catch (e: any) {
      console.error(e);
      toast.error(String(e.message || 'Falha ao criar usuário'));
    } finally {
      localStorage.removeItem('auth_lock');
      setIsCreatingUser(false);
    }
  };

  const createTeam = async () => {
    if (!teamDriverId || !teamHelperId) { toast.error('Selecione motorista e ajudante/montador'); return; }
    setIsCreatingTeam(true);
    try {
      const drv = users.find(u => u.id === teamDriverId);
      const hlp = users.find(u => u.id === teamHelperId);
      const teamName = `${drv?.name || ''} x ${hlp?.name || ''}`.trim();
      const { error } = await supabase.from('teams_user').insert({
        driver_user_id: teamDriverId,
        helper_user_id: teamHelperId,
        name: teamName || 'Equipe',
      });
      if (error) throw error;
      toast.success('Equipe criada com sucesso');
      setTeamDriverId(''); setTeamHelperId('');
      setShowTeamModal(false);
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao criar equipe'));
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const createVehicle = async () => {
    if (!vModel.trim() || !vPlate.trim()) { toast.error('Informe modelo e placa'); return; }
    setIsCreatingVehicle(true);
    try {
      const plate = vPlate.trim().toUpperCase();
      const { error: rpcError } = await supabase.rpc('insert_vehicle', { p_model: vModel.trim(), p_plate: plate });
      if (rpcError) throw rpcError;
      toast.success('Veículo salvo com sucesso');
      setVModel(''); setVPlate('');
      setShowVehicleModal(false);
      await loadAll();
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao salvar veículo'));
    } finally {
      setIsCreatingVehicle(false);
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

  const driverOptions = useMemo(() => users.filter(u => u.role === 'driver').map(u => ({ id: u.id, name: u.name })), [users]);
  const helperOptions = useMemo(() => users.filter(u => u.role === 'helper' || u.role === 'montador').map(u => ({ id: u.id, name: u.name })), [users]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.role.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [users, searchTerm]);

  const filteredTeams = useMemo(() => {
    return teams.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [teams, searchTerm]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => v.model.toLowerCase().includes(searchTerm.toLowerCase()) || v.plate.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [vehicles, searchTerm]);

  const RoleBadge = ({ role }: { role: string }) => {
    const styles: any = {
      admin: 'bg-purple-100 text-purple-800',
      driver: 'bg-blue-100 text-blue-800',
      helper: 'bg-gray-100 text-gray-800',
      montador: 'bg-orange-100 text-orange-800',
      conferente: 'bg-teal-100 text-teal-800',
      consultor: 'bg-cyan-100 text-cyan-800'
    };
    const labels: any = {
      admin: 'Admin',
      driver: 'Motorista',
      helper: 'Ajudante',
      montador: 'Montador',
      conferente: 'Conferente',
      consultor: 'Consultor'
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[role] || 'bg-gray-100 text-gray-800'}`}>
        {labels[role] || role}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                title="Voltar"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Users className="h-6 w-6 text-blue-600" />
                  Usuários e Equipes
                </h1>
                <p className="text-sm text-gray-500">Gerencie o acesso ao sistema, equipes de entrega e frota</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'users' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Usuários
              </button>
              <button
                onClick={() => setActiveTab('teams')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'teams' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Equipes
              </button>
              <button
                onClick={() => setActiveTab('vehicles')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'vehicles' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Veículos
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={`Buscar ${activeTab === 'users' ? 'usuários' : activeTab === 'teams' ? 'equipes' : 'veículos'}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            onClick={() => activeTab === 'users' ? setShowUserModal(true) : activeTab === 'teams' ? setShowTeamModal(true) : setShowVehicleModal(true)}
            className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            {activeTab === 'users' ? 'Novo Usuário' : activeTab === 'teams' ? 'Nova Equipe' : 'Novo Veículo'}
          </button>
        </div>

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUsers.map(user => (
              <div key={user.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow group relative">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-lg font-bold">
                      {user.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{user.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <RoleBadge role={user.role} />
                      </div>
                    </div>
                  </div>
                  <div className="relative">
                    <button className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" title="Ações">
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {/* Action Menu Mockup - simpler to just have buttons for now */}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    onClick={async () => {
                      const temp = genPassword();
                      try {
                        const resp = await fetch(`/api/reset-password`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: user.id, newPassword: temp })
                        });
                        if (!resp.ok) {
                          let msg = 'Falha ao resetar senha';
                          try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { }
                          throw new Error(msg);
                        }
                        await supabase.from('users').update({ must_change_password: true }).eq('id', user.id);
                        toast.success(`Senha resetada: ${temp}`, { duration: 10000 });
                        loadAll();
                      } catch (e: any) {
                        toast.error(String(e.message || 'Erro ao resetar senha'));
                      }
                    }}
                    className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors text-xs font-medium flex items-center"
                    title="Resetar Senha"
                  >
                    <Key className="h-4 w-4 mr-1" /> Resetar
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remover usuário "${user.name}"?`)) return;
                      try {
                        const resp = await fetch(`/api/delete-user`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: user.id })
                        });
                        if (!resp.ok) throw new Error('Falha ao remover');
                        toast.success('Usuário removido');
                        loadAll();
                      } catch (e) {
                        toast.error('Erro ao remover usuário');
                      }
                    }}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-xs font-medium flex items-center"
                    title="Remover Usuário"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TEAMS TAB */}
        {activeTab === 'teams' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome da Equipe</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Motorista</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ajudante/Montador</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Criada em</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTeams.map(team => (
                  <tr key={team.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{team.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{team.driver?.name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{team.helper?.name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(team.created_at).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))}
                {filteredTeams.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">Nenhuma equipe encontrada</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* VEHICLES TAB */}
        {activeTab === 'vehicles' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVehicles.map(v => (
              <div key={v.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Truck className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{v.model}</h3>
                    <p className="text-sm text-gray-500 font-mono">{v.plate}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${v.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {v.active ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* --- MODALS --- */}

      {/* Create User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Novo Usuário</h3>
              <button onClick={() => { setShowUserModal(false); setGeneratedPassword(null); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              {!generatedPassword ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
                    <input
                      value={uName}
                      onChange={e => setUName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Ex: João da Silva"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Função</label>
                    <select
                      value={uRole}
                      onChange={e => setURole(e.target.value as any)}
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Senha Inicial (Opcional)</label>
                    <input
                      type="password"
                      value={uPassword}
                      onChange={e => setUPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Deixe vazio para gerar automaticamente"
                    />
                  </div>
                </>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center space-y-3">
                  <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <Check className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="text-lg font-bold text-green-800">Usuário Criado!</h4>
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
                  <button onClick={() => setShowUserModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
                  <button
                    onClick={createUser}
                    disabled={isCreatingUser}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isCreatingUser ? 'Criando...' : 'Criar Usuário'}
                  </button>
                </>
              ) : (
                <button onClick={() => { setShowUserModal(false); setGeneratedPassword(null); }} className="w-full px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors">
                  Concluir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {showTeamModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Nova Equipe</h3>
              <button onClick={() => setShowTeamModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motorista</label>
                <select value={teamDriverId} onChange={e => setTeamDriverId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Selecione...</option>
                  {driverOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ajudante / Montador</label>
                <select value={teamHelperId} onChange={e => setTeamHelperId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Selecione...</option>
                  {helperOptions.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowTeamModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
              <button
                onClick={createTeam}
                disabled={isCreatingTeam}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isCreatingTeam ? 'Criando...' : 'Criar Equipe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Vehicle Modal */}
      {showVehicleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Novo Veículo</h3>
              <button onClick={() => setShowVehicleModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
                <input
                  value={vModel}
                  onChange={e => setVModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ex: Fiat Ducato"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Placa</label>
                <input
                  value={vPlate}
                  onChange={e => setVPlate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="ABC-1234"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowVehicleModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancelar</button>
              <button
                onClick={createVehicle}
                disabled={isCreatingVehicle}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isCreatingVehicle ? 'Salvando...' : 'Salvar Veículo'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
