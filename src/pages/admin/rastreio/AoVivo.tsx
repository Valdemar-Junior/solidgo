import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { Battery, Link2, Loader2, MapPin, RefreshCw, Truck } from 'lucide-react';
import { chamarAgente } from '../agente/api';

// Tela "Ao vivo": onde estão os caminhões agora. A posição vem do Traccar Client
// instalado no celular do motorista (funciona com a tela apagada); o caminhão e a
// rota vêm da rota "Em Rota" do motorista no SolidGo. Atualiza sozinha a cada 20 s.

type Dispositivo = {
  dispositivo_id: number;
  dispositivo_nome: string;
  online: boolean;
  ultimo_contato: string | null;
  motorista_id: string | null;
  motorista_nome: string | null;
  posicao: { lat: number; lng: number; velocidade_kmh: number; direcao: number; horario: string | null; bateria: number | null } | null;
  rota: { id: string; nome: string; codigo: string; veiculo: string | null; entregues: number; retornados: number; total: number } | null;
};
type Resposta = { configurado: boolean; dispositivos: Dispositivo[]; motoristas: { id: string; nome: string }[]; atualizado_em: string };

const INTERVALO_MS = 20_000;
const SEM_SINAL_MIN = 10; // sem posição nova há mais que isso = "sem sinal"

function minutosDesde(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
}

function textoTempo(min: number | null): string {
  if (min === null) return 'nunca';
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h}h${String(min % 60).padStart(2, '0')}` : `há ${Math.floor(h / 24)} dia(s)`;
}

type Situacao = { rotulo: string; cor: string; ponto: string };
function situacao(d: Dispositivo): Situacao {
  const min = minutosDesde(d.posicao?.horario ?? d.ultimo_contato);
  if (!d.posicao || min === null || min > SEM_SINAL_MIN) return { rotulo: `sem sinal ${textoTempo(min)}`, cor: 'text-gray-500', ponto: '#9ca3af' };
  if (d.posicao.velocidade_kmh >= 5) return { rotulo: `andando · ${d.posicao.velocidade_kmh} km/h`, cor: 'text-green-700', ponto: '#16a34a' };
  return { rotulo: 'parado', cor: 'text-blue-700', ponto: '#2563eb' };
}

const nomeExibido = (d: Dispositivo) => d.motorista_nome || d.dispositivo_nome || `Celular ${d.dispositivo_id}`;

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function icone(d: Dispositivo): L.DivIcon {
  const s = situacao(d);
  const rotulo = escapar(nomeExibido(d).split(' ')[0]);
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
      <div style="background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:1px 6px;font:600 12px system-ui;color:#111;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2)">${rotulo}</div>
      <div style="width:18px;height:18px;margin-top:2px;border-radius:50%;background:${s.ponto};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>
    </div>`,
  });
}

export default function AoVivo() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [vinculando, setVinculando] = useState<number | null>(null);
  const caixaMapa = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const marcadores = useRef(new Map<number, L.Marker>());
  const enquadrado = useRef(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await chamarAgente<Resposta>('ao_vivo'));
      setErro(null);
    } catch (e: any) {
      setErro(e.message || 'Falha ao buscar as posições.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // Atualiza a cada 20 s, só com a aba visível.
  useEffect(() => {
    carregar();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [carregar]);

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!caixaMapa.current || mapa.current) return;
    const m = L.map(caixaMapa.current, { zoomControl: true }).setView([-5.57, -36.91], 9); // região de Assú
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(m);
    mapa.current = m;
    return () => { m.remove(); mapa.current = null; marcadores.current.clear(); };
  }, []);

  // Desenha/atualiza os marcadores.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !dados) return;
    const vistos = new Set<number>();
    for (const d of dados.dispositivos) {
      if (!d.posicao) continue;
      vistos.add(d.dispositivo_id);
      const pos: L.LatLngExpression = [d.posicao.lat, d.posicao.lng];
      let mk = marcadores.current.get(d.dispositivo_id);
      if (!mk) {
        mk = L.marker(pos).addTo(m);
        const id = d.dispositivo_id;
        mk.on('click', () => setSelecionado(id));
        marcadores.current.set(id, mk);
      } else {
        mk.setLatLng(pos);
      }
      mk.setIcon(icone(d));
    }
    for (const [id, mk] of marcadores.current) {
      if (!vistos.has(id)) { mk.remove(); marcadores.current.delete(id); }
    }
    if (!enquadrado.current && vistos.size > 0) {
      const pontos = dados.dispositivos.filter((d) => d.posicao).map((d) => [d.posicao!.lat, d.posicao!.lng] as [number, number]);
      if (pontos.length === 1) m.setView(pontos[0], 14);
      else m.fitBounds(L.latLngBounds(pontos), { padding: [40, 40], maxZoom: 14 });
      enquadrado.current = true;
    }
  }, [dados]);

  const focar = (d: Dispositivo) => {
    setSelecionado(d.dispositivo_id);
    if (d.posicao && mapa.current) mapa.current.setView([d.posicao.lat, d.posicao.lng], 15, { animate: true });
  };

  const vincular = async (dispositivoId: number, motoristaId: string) => {
    setVinculando(dispositivoId);
    try {
      await chamarAgente('vincular_celular', { method: 'POST', body: { dispositivo_id: dispositivoId, motorista_id: motoristaId || null } });
      toast.success(motoristaId ? 'Celular ligado ao motorista' : 'Vínculo removido');
      await carregar();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao vincular');
    } finally {
      setVinculando(null);
    }
  };

  // Em rota primeiro, depois com sinal, depois por nome.
  const lista = useMemo(() => [...(dados?.dispositivos || [])].sort((a, b) =>
    Number(Boolean(b.rota)) - Number(Boolean(a.rota))
    || Number(situacao(a).ponto === '#9ca3af') - Number(situacao(b).ponto === '#9ca3af')
    || nomeExibido(a).localeCompare(nomeExibido(b), 'pt-BR')), [dados]);

  const emRota = lista.filter((d) => d.rota).length;

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><MapPin className="h-5 w-5 text-blue-600" /> Ao vivo</h1>
          <p className="text-xs text-gray-500">
            {dados ? `${lista.length} celular(es) · ${emRota} em rota · atualizado ${new Date(dados.atualizado_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'carregando…'}
            {' · atualiza sozinho a cada 20 s'}
          </p>
        </div>
        <button onClick={carregar} disabled={carregando} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm flex items-center gap-1.5 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{erro}</div>}
      {dados && !dados.configurado && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          O rastreio ainda não foi ligado: faltam <strong>TRACCAR_URL</strong>, <strong>TRACCAR_USUARIO</strong> e <strong>TRACCAR_SENHA</strong> na Vercel.
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
        <div className="lg:w-80 shrink-0 overflow-y-auto space-y-2 max-h-64 lg:max-h-none">
          {!dados && !erro && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> buscando posições…</div>}
          {dados?.configurado && lista.length === 0 && <div className="text-sm text-gray-500">Nenhum celular cadastrado no Traccar.</div>}
          {lista.map((d) => {
            const s = situacao(d);
            const ativo = selecionado === d.dispositivo_id;
            return (
              <div key={d.dispositivo_id} onClick={() => focar(d)}
                className={`rounded-xl border bg-white p-3 text-sm cursor-pointer ${ativo ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.ponto }} />
                    {nomeExibido(d)}
                  </div>
                  {d.posicao?.bateria != null && (
                    <span className={`text-xs flex items-center gap-0.5 ${d.posicao.bateria <= 20 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      <Battery className="h-3.5 w-3.5" /> {d.posicao.bateria}%
                    </span>
                  )}
                </div>
                <div className={`text-xs ${s.cor}`}>{s.rotulo}</div>
                {d.rota ? (
                  <div className="mt-1.5 text-xs text-gray-700 space-y-0.5">
                    <div className="flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-gray-400" /> {d.rota.veiculo || 'veículo não informado'}</div>
                    <div>{d.rota.codigo} · {d.rota.nome}</div>
                    <div>
                      <strong>{d.rota.entregues}</strong> de {d.rota.total} entregue(s)
                      {d.rota.retornados ? ` · ${d.rota.retornados} retornado(s)` : ''}
                    </div>
                  </div>
                ) : d.motorista_id ? (
                  <div className="mt-1 text-xs text-gray-400">sem rota em andamento</div>
                ) : null}
                {!d.motorista_id && (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <label className="text-[11px] text-orange-700 flex items-center gap-1 mb-1"><Link2 className="h-3 w-3" /> Ligar este celular a um motorista</label>
                    <select disabled={vinculando === d.dispositivo_id} defaultValue=""
                      onChange={(e) => e.target.value && vincular(d.dispositivo_id, e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
                      <option value="">Escolher motorista…</option>
                      {(dados?.motoristas || []).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </div>
                )}
                {d.motorista_id && ativo && (
                  <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Desligar este celular do motorista?')) vincular(d.dispositivo_id, ''); }}
                    className="mt-2 text-[11px] text-gray-500 underline">
                    trocar motorista deste celular
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div ref={caixaMapa} className="flex-1 min-h-[320px] rounded-xl border border-gray-200 overflow-hidden z-0" />
      </div>
    </div>
  );
}
