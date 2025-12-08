import { useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase/client'
// no need to create another client; use existing and restore session if it changes
import type { User } from '../../types/database'
import { slugifyName, toLoginEmailFromName } from '../../lib/utils'
import { toast } from 'sonner'

export default function UsersTeams() {
  const [users, setUsers] = useState<User[]>([])
  const [teams, setTeams] = useState<any[]>([])

  const [uName, setUName] = useState('')
  const [uPassword, setUPassword] = useState('')
  const [uRole, setURole] = useState<'admin' | 'driver' | 'helper' | 'montador' | 'conferente'>('driver')
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)

  const [teamDriverId, setTeamDriverId] = useState('')
  const [teamHelperId, setTeamHelperId] = useState('')

  // veículos
  const [vehicles, setVehicles] = useState<any[]>([])
  const [vModel, setVModel] = useState('')
  const [vPlate, setVPlate] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    try {
      const { data: usersData } = await supabase.from('users').select('*').order('name')
      if (usersData) setUsers(usersData as User[])

      // helpers removidos: usamos perfis de usuários com roles 'helper' e 'montador'

      const { data: teamsData } = await supabase
        .from('teams_user')
        .select('id,name,created_at, driver:users!driver_user_id(name), helper:users!helper_user_id(name)')
        .order('created_at', { ascending: false })
      if (teamsData) setTeams(teamsData)

      // veículos
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, model, plate, active')
        .order('model')
      if (vehiclesData) setVehicles(vehiclesData)
    } catch (e) {
      console.error(e)
      toast.error('Falha ao carregar dados')
    }
  }

  const genPassword = () => String(Math.floor(100000 + Math.random() * 900000))

  const createUser = async () => {
    if (!uName.trim()) { toast.error('Informe o nome'); return }
    try {
      const pwd = uPassword.trim() ? uPassword.trim() : genPassword()
      setGeneratedPassword(pwd)
      let pseudoEmail = toLoginEmailFromName(uName)
      const { data: existsUserEmail } = await supabase.from('users').select('id').eq('email', pseudoEmail).maybeSingle()
      if (existsUserEmail?.id) {
        const base = slugifyName(uName)
        pseudoEmail = `${base}.${String(Date.now()).slice(-4)}@solidgo.local`
      }
      const { data: prev } = await supabase.auth.getSession()
      localStorage.setItem('auth_lock','1')
      let uid = ''
      let signRes = await supabase.auth.signUp({ email: pseudoEmail, password: pwd })
      if (signRes.error) {
        const msg = String(signRes.error.message || '').toLowerCase()
        if (msg.includes('already registered') || msg.includes('user already exists') || signRes.error.status === 422) {
          // tentar com email alternativo único
          const altEmail = `${slugifyName(uName)}.${String(Date.now()).slice(-6)}@solidgo.local`
          const altSignup = await supabase.auth.signUp({ email: altEmail, password: pwd })
          if (altSignup.error) throw altSignup.error
          uid = altSignup.data.user?.id || ''
          pseudoEmail = altEmail
        } else {
          throw signRes.error
        }
      } else {
        uid = signRes.data.user?.id || ''
      }
      if (!uid) throw new Error('Falha ao obter id do usuário')
      // restaura a sessão do admin sem deslogar
      if (prev?.session?.access_token && prev?.session?.refresh_token) {
        await supabase.auth.setSession({ access_token: prev.session.access_token, refresh_token: prev.session.refresh_token })
      }

      // Inserção com fallback quando coluna must_change_password não existir
      const { error: insErr } = await supabase.from('users').upsert({
        id: uid,
        email: pseudoEmail,
        name: uName.trim(),
        role: uRole,
        must_change_password: true,
      }, { onConflict: 'id' })
      if (insErr) throw insErr

      // Garantir criação do registro em drivers quando perfil for 'driver'
      if (uRole === 'driver') {
        try {
          console.log('🚗 Criando registro de driver para user_id:', uid);
          const { data: drvExists } = await supabase.from('drivers').select('id').eq('user_id', uid).maybeSingle();
          console.log('📋 Driver existente:', drvExists);
          const exists = !!(drvExists && drvExists.id);
          if (!exists) {
            console.log('➕ Criando novo driver...');
            const { data, error } = await supabase.from('drivers').insert({ user_id: uid, active: true });
            console.log('✅ Resultado criação:', { data, error });
            if (error) {
              console.error('❌ Erro ao criar driver:', error);
              throw error;
            }
          } else {
            console.log('✅ Driver já existe, pulando criação');
          }
        } catch (error) {
          console.error('❌ Erro na criação de driver, tentando upsert:', error);
          try {
            const { data, error: upsertError } = await supabase.from('drivers').upsert({ user_id: uid, active: true }, { onConflict: 'user_id' });
            console.log('🔄 Resultado upsert:', { data, upsertError });
            if (upsertError) {
              console.error('❌ Erro no upsert também:', upsertError);
            }
          } catch (upsertError) {
            console.error('❌ Erro crítico no upsert:', upsertError);
          }
        }
      }
      toast.success('Usuário criado/atualizado. Senha inicial gerada.')
      setUName(''); setUPassword(''); setURole('driver')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(String(e.message || 'Falha ao criar usuário'))
    } finally {
      localStorage.removeItem('auth_lock')
    }
  }

  const copyPwd = async () => {
    try {
      if (generatedPassword) {
        await navigator.clipboard.writeText(generatedPassword)
        toast.success('Senha copiada')
      }
    } catch {
      toast.error('Falha ao copiar senha')
    }
  }

  // criação de ajudante/montador agora é via criação de usuário com role correspondente

  const driverOptions = useMemo(() => {
    return users.filter(u => u.role === 'driver').map(u => ({ id: u.id, name: u.name }))
  }, [users])

  const helperOptions = useMemo(() => {
    return users.filter(u => u.role === 'helper' || u.role === 'montador').map(u => ({ id: u.id, name: u.name }))
  }, [users])

  const createTeam = async () => {
    if (!teamDriverId || !teamHelperId) { toast.error('Selecione motorista e ajudante/montador'); return }
    try {
      const drv = users.find(u => u.id === teamDriverId)
      const hlp = users.find(u => u.id === teamHelperId)
      const teamName = `${drv?.name || ''} x ${hlp?.name || ''}`.trim()
      const { error } = await supabase.from('teams_user').insert({
        driver_user_id: teamDriverId,
        helper_user_id: teamHelperId,
        name: teamName || 'Equipe',
      })
      if (error) throw error
      toast.success('Equipe criada')
      setTeamDriverId(''); setTeamHelperId('')
      await loadAll()
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao criar equipe'))
    }
  }

  const createVehicle = async () => {
    if (!vModel.trim() || !vPlate.trim()) { toast.error('Informe modelo e placa'); return }
    try {
      const plate = vPlate.trim().toUpperCase()
      // usar RPC com security definer para evitar impacto de RLS
      const { data: newId, error: rpcError } = await supabase.rpc('insert_vehicle', { p_model: vModel.trim(), p_plate: plate })
      if (rpcError) throw rpcError
      toast.success('Veículo salvo')
      setVModel(''); setVPlate('')
      await loadAll()
    } catch (e:any) {
      toast.error(String(e.message || 'Falha ao salvar veículo'))
    }
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Cadastro de Usuários</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
            <input value={uName} onChange={e=>setUName(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de usuário</label>
            <select value={uRole} onChange={e=>setURole(e.target.value as any)} className="w-full px-3 py-2 border rounded-md">
              <option value="admin">Admin</option>
              <option value="driver">Motorista</option>
              <option value="helper">Ajudante</option>
              <option value="montador">Montador</option>
              <option value="conferente">Conferente</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Senha inicial (opcional)</label>
            <input type="password" value={uPassword} onChange={e=>setUPassword(e.target.value)} className="w-full px-3 py-2 border rounded-md" placeholder="Deixe vazio para gerar" />
          </div>
        </div>
        <div className="mt-4 flex items-center space-x-3">
          <button onClick={createUser} className="px-4 py-2 bg-blue-600 text-white rounded-md">Criar Usuário</button>
          {generatedPassword && (
            <div className="text-sm text-gray-700 flex items-center">Senha inicial: <span className="font-semibold ml-1">{generatedPassword}</span> <span className="ml-2">(guarde, só aparece agora)</span>
              <button onClick={copyPwd} className="ml-3 px-2 py-1 bg-gray-100 rounded border hover:bg-gray-200">Copiar</button>
            </div>
          )}
        </div>
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Usuários</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="px-2 py-1 text-left">Nome</th><th className="px-2 py-1 text-left">Tipo</th><th className="px-2 py-1 text-left">Trocar senha no primeiro login</th><th className="px-2 py-1 text-right">Ações</th></tr></thead>
              <tbody>
                {users.map(u=> (
                  <tr key={u.id} className="border-t">
                    <td className="px-2 py-1">{u.name}</td>
                    <td className="px-2 py-1">{u.role==='driver'?'Motorista':u.role==='admin'?'Admin':u.role==='helper'?'Ajudante':u.role==='montador'?'Montador':'Conferente'}</td>
                    <td className="px-2 py-1">{u.must_change_password === undefined ? '—' : (u.must_change_password ? 'Sim' : 'Não')}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        onClick={async ()=>{
                          const temp = genPassword()
                          try {
                            const resp = await fetch(`/api/reset-password`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: u.id, newPassword: temp })
                            })
                            if (!resp.ok) {
                              let msg = 'Falha ao resetar senha'
                              try { const j = await resp.json(); if (j?.error) msg = j.error } catch {}
                              throw new Error(msg + ' — verifique configuração do servidor (SUPABASE_URL/SUPABASE_SERVICE_KEY)')
                            }
                            await supabase.from('users').update({ must_change_password: true }).eq('id', u.id)
                            toast.success(`Senha resetada. Nova senha: ${temp}`)
                            await loadAll()
                          } catch (e:any) {
                            toast.error(String(e.message||'Erro ao resetar senha'))
                          }
                        }}
                        className="px-2 py-1 bg-orange-600 text-white rounded-md"
                      >Resetar senha</button>
                      <button
                        onClick={async ()=>{
                          const ok = window.confirm(`Remover usuário "${u.name}"? Esta ação não pode ser desfeita.`)
                          if (!ok) return
                          try {
                            const resp = await fetch(`/api/delete-user`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: u.id })
                            })
                            if (!resp.ok) {
                              let msg = 'Falha ao remover usuário'
                              try { const j = await resp.json(); if (j?.error) msg = j.error } catch {}
                              throw new Error(msg + ' — verifique configuração do servidor (SUPABASE_URL/SUPABASE_SERVICE_KEY)')
                            }
                            toast.success('Usuário removido')
                            await loadAll()
                          } catch (e:any) {
                            toast.error(String(e.message||'Erro ao remover usuário'))
                          }
                        }}
                        className="ml-2 px-2 py-1 bg-red-600 text-white rounded-md"
                      >Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Cadastro de Equipes</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Motorista</label>
            <select value={teamDriverId} onChange={e=>setTeamDriverId(e.target.value)} className="w-full px-3 py-2 border rounded-md">
              <option value="">Selecione</option>
              {driverOptions.map(d=> (<option key={d.id} value={d.id}>{d.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ajudante/Montador</label>
            <select value={teamHelperId} onChange={e=>setTeamHelperId(e.target.value)} className="w-full px-3 py-2 border rounded-md">
              <option value="">Selecione</option>
              {helperOptions.map((h:any)=> (<option key={h.id} value={h.id}>{h.name}</option>))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button onClick={createTeam} className="px-4 py-2 bg-purple-600 text-white rounded-md">Criar Equipe</button>
        </div>
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Equipes</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="px-2 py-1 text-left">Nome</th><th className="px-2 py-1 text-left">Motorista</th><th className="px-2 py-1 text-left">Ajudante/Montador</th></tr></thead>
              <tbody>
                {teams.map((t:any)=> (
                  <tr key={t.id} className="border-t"><td className="px-2 py-1">{t.name}</td><td className="px-2 py-1">{t.driver?.name}</td><td className="px-2 py-1">{t.helper?.name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Cadastro de Veículo</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Modelo</label>
            <input value={vModel} onChange={e=>setVModel(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Placa</label>
            <input value={vPlate} onChange={e=>setVPlate(e.target.value)} className="w-full px-3 py-2 border rounded-md" placeholder="ABC-1234" />
          </div>
          <div className="flex items-end">
            <button onClick={createVehicle} className="px-4 py-2 bg-blue-600 text-white rounded-md">Salvar Veículo</button>
          </div>
        </div>
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Veículos</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="px-2 py-1 text-left">Modelo</th><th className="px-2 py-1 text-left">Placa</th><th className="px-2 py-1 text-left">Ativo</th></tr></thead>
              <tbody>
                {vehicles.map(v=> (
                  <tr key={v.id} className="border-t">
                    <td className="px-2 py-1">{v.model}</td>
                    <td className="px-2 py-1">{v.plate}</td>
                    <td className="px-2 py-1">{v.active ? 'Sim' : 'Não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
