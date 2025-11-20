import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase/client'
import type { User } from '../../types/database'
import { toast } from 'sonner'

export default function UsersTeams() {
  const [users, setUsers] = useState<User[]>([])
  const [helpers, setHelpers] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])

  const [uName, setUName] = useState('')
  const [uEmail, setUEmail] = useState('')
  const [uRole, setURole] = useState<'admin' | 'driver'>('driver')
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)

  const [hName, setHName] = useState('')

  const [teamDriverId, setTeamDriverId] = useState('')
  const [teamHelperId, setTeamHelperId] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    try {
      const { data: usersData } = await supabase.from('users').select('*').order('name')
      if (usersData) setUsers(usersData as User[])

      const { data: helpersData } = await supabase.from('helpers').select('*').order('name')
      if (helpersData) setHelpers(helpersData)

      const { data: teamsData } = await supabase
        .from('teams')
        .select('*, driver:drivers!driver_id(id, user:users!user_id(name)), helper:helpers!helper_id(name)')
        .order('created_at', { ascending: false })
      if (teamsData) setTeams(teamsData)
    } catch (e) {
      console.error(e)
      toast.error('Falha ao carregar dados')
    }
  }

  const genPassword = () => String(Math.floor(100000 + Math.random() * 900000))

  const createUser = async () => {
    if (!uName.trim() || !uEmail.trim()) { toast.error('Informe nome e e-mail'); return }
    try {
      const pwd = genPassword()
      setGeneratedPassword(pwd)

      const signRes = await supabase.auth.signUp({ email: uEmail.trim(), password: pwd })
      if (signRes.error) throw signRes.error
      const uid = signRes.data.user?.id
      if (!uid) throw new Error('Usuário auth não criado')

      const { error: insErr } = await supabase.from('users').insert({
        id: uid,
        email: uEmail.trim(),
        name: uName.trim(),
        role: uRole,
        must_change_password: true,
      })
      if (insErr) throw insErr
      toast.success('Usuário criado. Senha inicial gerada.')
      setUName(''); setUEmail(''); setURole('driver')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(String(e.message || 'Falha ao criar usuário'))
    }
  }

  const createHelper = async () => {
    if (!hName.trim()) { toast.error('Informe o nome do ajudante'); return }
    try {
      const { error } = await supabase.from('helpers').insert({ name: hName.trim() })
      if (error) throw error
      toast.success('Ajudante criado')
      setHName('')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(String(e.message || 'Falha ao criar ajudante'))
    }
  }

  const driverOptions = useMemo(() => {
    return users.filter(u => u.role === 'driver').map(u => ({ id: u.id, name: u.name }))
  }, [users])

  const createTeam = async () => {
    if (!teamDriverId || !teamHelperId) { toast.error('Selecione motorista e ajudante'); return }
    try {
      // obter driver record a partir de users
      const { data: driverRec } = await supabase.from('drivers').select('id,user_id').eq('user_id', teamDriverId).single()
      let driverId = driverRec?.id
      if (!driverId) {
        const { data: newDrv, error: drvErr } = await supabase.from('drivers').insert({ user_id: teamDriverId, active: true }).select().single()
        if (drvErr) throw drvErr
        driverId = newDrv.id
      }
      const drvName = users.find(u => u.id === teamDriverId)?.name || ''
      const helperName = helpers.find((h: any) => h.id === teamHelperId)?.name || ''
      const teamName = `${drvName} x ${helperName}`
      const { error } = await supabase.from('teams').insert({ driver_id: driverId, helper_id: teamHelperId, name: teamName })
      if (error) throw error
      toast.success('Equipe criada')
      setTeamDriverId(''); setTeamHelperId('')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(String(e.message || 'Falha ao criar equipe'))
    }
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Cadastro de Usuários</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
            <input value={uName} onChange={e=>setUName(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">E-mail</label>
            <input type="email" value={uEmail} onChange={e=>setUEmail(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de usuário</label>
            <select value={uRole} onChange={e=>setURole(e.target.value as any)} className="w-full px-3 py-2 border rounded-md">
              <option value="admin">Admin</option>
              <option value="driver">Motorista</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center space-x-3">
          <button onClick={createUser} className="px-4 py-2 bg-blue-600 text-white rounded-md">Criar Usuário</button>
          {generatedPassword && (
            <div className="text-sm text-gray-700">Senha inicial: <span className="font-semibold">{generatedPassword}</span> (guarde, só aparece agora)</div>
          )}
        </div>
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Usuários</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="px-2 py-1 text-left">Nome</th><th className="px-2 py-1 text-left">E-mail</th><th className="px-2 py-1 text-left">Tipo</th><th className="px-2 py-1 text-left">Trocar senha no primeiro login</th></tr></thead>
              <tbody>
                {users.map(u=> (
                  <tr key={u.id} className="border-t"><td className="px-2 py-1">{u.name}</td><td className="px-2 py-1">{u.email}</td><td className="px-2 py-1">{u.role==='driver'?'Motorista':'Admin'}</td><td className="px-2 py-1">{u.must_change_password ? 'Sim' : 'Não'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Cadastro de Ajudantes</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome do Ajudante</label>
            <input value={hName} onChange={e=>setHName(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
        </div>
        <div className="mt-4">
          <button onClick={createHelper} className="px-4 py-2 bg-green-600 text-white rounded-md">Criar Ajudante</button>
        </div>
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Ajudantes</h3>
          <ul className="text-sm text-gray-800">
            {helpers.map((h:any)=> (<li key={h.id} className="py-1 border-t">{h.name}</li>))}
          </ul>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Ajudante</label>
            <select value={teamHelperId} onChange={e=>setTeamHelperId(e.target.value)} className="w-full px-3 py-2 border rounded-md">
              <option value="">Selecione</option>
              {helpers.map((h:any)=> (<option key={h.id} value={h.id}>{h.name}</option>))}
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
              <thead><tr><th className="px-2 py-1 text-left">Nome</th><th className="px-2 py-1 text-left">Motorista</th><th className="px-2 py-1 text-left">Ajudante</th></tr></thead>
              <tbody>
                {teams.map((t:any)=> (
                  <tr key={t.id} className="border-t"><td className="px-2 py-1">{t.name}</td><td className="px-2 py-1">{t.driver?.user?.name}</td><td className="px-2 py-1">{t.helper?.name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}