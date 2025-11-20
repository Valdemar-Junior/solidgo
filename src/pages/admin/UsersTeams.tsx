import { useEffect, useMemo, useState } from 'react'
import { supabase, supabasePublicUrl, supabaseAnonPublicKey } from '../../supabase/client'
import { createClient } from '@supabase/supabase-js'
import type { User } from '../../types/database'
import { slugifyName, toLoginEmailFromName } from '../../lib/utils'
import { toast } from 'sonner'

export default function UsersTeams() {
  const [users, setUsers] = useState<User[]>([])
  const [helpers, setHelpers] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [schemaReady, setSchemaReady] = useState(true)

  const [uName, setUName] = useState('')
  const [uPassword, setUPassword] = useState('')
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

      try {
        const { data: helpersData } = await supabase.from('helpers').select('*').order('name')
        if (helpersData) setHelpers(helpersData)
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase()
        if (msg.includes("helpers") && msg.includes("schema")) setSchemaReady(false)
        else throw err
      }

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
    if (!uName.trim()) { toast.error('Informe o nome'); return }
    try {
      const pwd = uPassword.trim() ? uPassword.trim() : genPassword()
      setGeneratedPassword(pwd)
      // usar cliente temporário sem persistir sessão
      const temp = createClient(supabasePublicUrl, supabaseAnonPublicKey, { auth: { persistSession: false } })
      const pseudoEmail = toLoginEmailFromName(uName)
      const signRes = await temp.auth.signUp({ email: pseudoEmail, password: pwd })
      if (signRes.error) throw signRes.error
      const uid = signRes.data.user?.id
      if (!uid) throw new Error('Usuário auth não criado')

      const { error: insErr } = await supabase.from('users').insert({
        id: uid,
        email: pseudoEmail,
        name: uName.trim(),
        role: uRole,
        must_change_password: true,
      })
      if (insErr) throw insErr
      toast.success('Usuário criado. Senha inicial gerada.')
      setUName(''); setUPassword(''); setURole('driver')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(String(e.message || 'Falha ao criar usuário'))
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
        {!schemaReady && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            Tabela "helpers" não encontrada. Execute a migração 018_helpers_teams.sql no painel SQL do Supabase e recarregue.
          </div>
        )}
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