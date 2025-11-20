import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import { useAuthStore } from '../stores/authStore'
import { toast } from 'sonner'

export default function FirstLogin() {
  const navigate = useNavigate()
  const { user, checkAuth } = useAuthStore()
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = async () => {
    if (!pwd || pwd.length < 6) { toast.error('Senha deve ter ao menos 6 dígitos'); return }
    if (pwd !== confirm) { toast.error('Senhas não conferem'); return }
    try {
      setLoading(true)
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      await supabase.from('users').update({ must_change_password: false }).eq('id', user?.id)
      toast.success('Senha alterada com sucesso')
      await checkAuth()
      navigate('/')
    } catch (e: any) {
      toast.error(String(e.message || 'Falha ao alterar senha'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-6 w-full max-w-md">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Definir nova senha</h1>
        <p className="text-sm text-gray-600 mb-4">Por segurança, defina sua nova senha para continuar.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
            <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} className="w-full px-3 py-2 border rounded-md" />
          </div>
        </div>
        <button onClick={handleChange} disabled={loading} className="mt-4 w-full bg-blue-600 text-white py-2 rounded-md disabled:opacity-50">{loading ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </div>
  )
}