import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import { useAuthStore } from '../stores/authStore';
import { trustThisDevice } from '../utils/security/twoFactor';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react';

type Mode = 'loading' | 'enroll' | 'verify' | 'error';

// Tela de 2FA (TOTP). Serve para DOIS momentos:
// - Ativar: mostra o QR Code para o admin cadastrar o celular (Google Authenticator etc.).
// - Confirmar: quando já tem o celular cadastrado, pede só o código de 6 dígitos no login.
export default function TwoFactor() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();
  const [mode, setMode] = useState<Mode>('loading');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Precisa estar logado (sessão aal1) para cadastrar/confirmar o fator.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login', { replace: true });
        return;
      }

      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel === 'aal2') {
          // Já passou pelo 2FA nesta sessão.
          navigate('/', { replace: true });
          return;
        }

        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const verified = factorsData?.totp?.find((f) => f.status === 'verified');

        if (verified) {
          // Já tem celular cadastrado → só confirmar o código.
          if (cancelled) return;
          setFactorId(verified.id);
          setMode('verify');
          return;
        }

        // Sem fator verificado → cadastrar. Limpa tentativas incompletas antes.
        const unverified = factorsData?.totp?.filter((f) => f.status !== 'verified') || [];
        for (const f of unverified) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }

        const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
        });
        if (enrollError || !enrollData) {
          throw enrollError || new Error('Falha ao gerar o 2FA');
        }
        if (cancelled) return;
        setFactorId(enrollData.id);
        setQrCode(enrollData.totp.qr_code);
        setSecret(enrollData.totp.secret);
        setMode('enroll');
      } catch (e: any) {
        if (cancelled) return;
        setError(
          e?.message?.includes('MFA')
            ? 'O 2FA ainda não está habilitado no servidor. Ative o MFA (TOTP) no painel do Supabase.'
            : String(e?.message || 'Não foi possível iniciar o 2FA.')
        );
        setMode('error');
      }
    };

    void init();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleConfirm = async () => {
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError('Digite os 6 dígitos do app.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) throw challengeError || new Error('Falha ao validar');

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: clean,
      });
      if (verifyError) throw verifyError;

      // Marca este dispositivo como confiável (pula o código por ~1 dia; a senha continua sempre).
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) trustThisDevice(authUser.id);

      toast.success(mode === 'enroll' ? '2FA ativado com sucesso!' : 'Código confirmado!', {
        description: 'Este dispositivo ficará confiável por 1 dia. A senha continua sendo pedida sempre.',
        duration: 8000,
      });
      await checkAuth();
      navigate('/', { replace: true });
    } catch (e: any) {
      setError('Código inválido ou expirado. Tente o próximo código do app.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Verificação em 2 etapas</h1>
          <p className="text-gray-600 mt-1 text-sm">
            {mode === 'enroll'
              ? 'Cadastre seu celular para proteger a conta de administrador.'
              : 'Digite o código do seu app autenticador.'}
          </p>
        </div>

        {mode === 'loading' && (
          <div className="flex items-center justify-center py-10 text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Preparando...
          </div>
        )}

        {mode === 'error' && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
            <button onClick={handleLogout} className="w-full px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">
              Voltar ao login
            </button>
          </div>
        )}

        {(mode === 'enroll' || mode === 'verify') && (
          <div className="space-y-5">
            {mode === 'enroll' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-600">
                  <Smartphone className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <span>Abra o Google Authenticator (ou similar), toque em <b>+</b> e escaneie o código abaixo:</span>
                </div>
                {qrCode && (
                  <div className="flex justify-center">
                    <img src={qrCode} alt="QR Code do 2FA" className="w-48 h-48 border border-gray-200 rounded-lg bg-white p-2" />
                  </div>
                )}
                {secret && (
                  <p className="text-center text-xs text-gray-500">
                    Não consegue escanear? Digite este código no app:<br />
                    <code className="font-mono text-gray-800 break-all">{secret}</code>
                  </p>
                )}
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
                  Depois de ativar, <b>este dispositivo fica confiável por 1 dia</b> — só pedirá o código
                  de novo amanhã (ou em outro aparelho). A <b>senha continua sendo pedida sempre</b>.
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código de 6 dígitos</label>
              <input
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirm(); }}
                inputMode="numeric"
                autoFocus
                placeholder="000000"
                className="w-full px-3 py-2 text-center text-2xl tracking-[0.4em] font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : (mode === 'enroll' ? 'Ativar 2FA' : 'Confirmar')}
            </button>

            <button onClick={handleLogout} className="w-full text-sm text-gray-500 hover:text-gray-700">
              Sair
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
