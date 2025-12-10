import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { CheckCircle, ScanLine, ArrowLeft } from 'lucide-react';

type ExpectedLabel = { code: string; display?: string; orderId: string; productCode?: string; volumeIndex?: number; volumeTotal?: number };

const normalizeScan = (raw: string) => {
  // Tolerar tanto '/' quanto ';' (inclui ponto-e-vírgula unicode) e remover espaços
  const s0 = String(raw || '').trim();
  const s = s0.replace(/[；;]/g, '/').replace(/\s+/g, '');
  const m = s.match(/^(\d+)[\/](\d+)-([A-Za-z0-9-]+?)(?:-(\d+))?$/);
  if (!m) return s.toLowerCase();
  const x = m[1], y = m[2], code = m[3];
  return `${x}/${y}-${code}`.toLowerCase();
};

const extractProductCode = (normalized: string) => {
  // normalized format: x/y-productCode
  const idx = normalized.indexOf('-');
  if (idx === -1) return '';
  return normalized.slice(idx + 1);
};

const findExpectedMatch = (norm: string, has: (code: string)=>boolean) => {
  let candidate = norm;
  const slashIdx = candidate.indexOf('/');
  while (true) {
    if (has(candidate)) return candidate;
    const idx = candidate.lastIndexOf('-');
    if (idx <= slashIdx) break;
    const tail = candidate.slice(idx + 1);
    if (!/^\d+$/.test(tail)) break;
    candidate = candidate.slice(0, idx);
  }
  return null;
};

export default function RouteConference() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const [route, setRoute] = useState<any>(null);
  const [expected, setExpected] = useState<ExpectedLabel[]>([]);
  const [conferenceId, setConferenceId] = useState<string>('');
  const [scanInput, setScanInput] = useState('');
  const [started, setStarted] = useState(false);

  const expectedCounts = useMemo(() => {
    const map = new Map<string, number>();
    expected.forEach((e) => map.set(e.code, (map.get(e.code) || 0) + 1));
    return map;
  }, [expected]);

  const [scannedCounts, setScannedCounts] = useState<Map<string, number>>(new Map());
  const [notBiped, setNotBiped] = useState<Record<string, { reason: string; notes?: string }>>({});
  const REASONS = [
    { value: 'no_space', label: 'Não coube no caminhão' },
    { value: 'damaged', label: 'Avariado' },
    { value: 'no_stock', label: 'Sem estoque' },
    { value: 'other', label: 'Outro' },
  ];

  const loadRoute = async () => {
    try {
      const { data: r } = await supabase
        .from('routes')
        .select('*, route_orders:route_orders(*, order:orders!order_id(*))')
        .eq('id', routeId)
        .single();
      setRoute(r);
      const labels: ExpectedLabel[] = [];
      (r?.route_orders || []).forEach((ro: any) => {
        const o = ro.order;
        const etiquetas = o?.etiquetas || [];
        if (Array.isArray(etiquetas) && etiquetas.length > 0) {
          etiquetas.forEach((raw: string) => {
            const norm = normalizeScan(raw);
            labels.push({ code: norm, display: String(raw || ''), orderId: o.id, productCode: extractProductCode(norm) });
          });
        } else {
          const items = Array.isArray(o?.items_json) ? o.items_json : [];
          if (items.length > 0) {
            items.forEach((it: any) => {
              const qty = Number(it?.quantity || 0);
              const skuRaw = String(it?.sku || '').trim();
              const skuLower = skuRaw.toLowerCase();
              // Mantém o sufixo conforme etiqueta impressa (variação/cor)
              const skuNorm = skuLower;
              if (qty > 0 && skuRaw) {
                for (let i = 1; i <= qty; i++) {
                  const disp = `${i}/${qty}-${skuRaw}`;
                  labels.push({ code: `${i}/${qty}-${skuNorm}`, display: disp, orderId: o.id, productCode: skuRaw, volumeIndex: i, volumeTotal: qty });
                }
              }
            });
          } else {
            const vol = Number(o?.quantidade_volumes || 0);
            const fallbackCode = String(o?.order_id_erp || '').trim();
            if (vol > 0 && fallbackCode) {
              for (let i = 1; i <= vol; i++) {
                const disp = `${i}/${vol}-${fallbackCode}`;
                labels.push({ code: `${i}/${vol}-${fallbackCode.toLowerCase()}`, display: disp, orderId: o.id, productCode: fallbackCode, volumeIndex: i, volumeTotal: vol });
              }
            }
          }
        }
      });
      setExpected(labels);
    } catch (e) {
      console.error(e);
      toast.error('Falha ao carregar rota para conferência');
    }
  };

  useEffect(() => { loadRoute(); }, [routeId]);

  const startConference = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('route_conferences')
        .insert({ route_id: routeId, status: 'in_progress', user_id: user?.id || null })
        .select()
        .single();
      if (error) throw error;
      setConferenceId(data.id);
      setStarted(true);
      toast.success('Conferência iniciada');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao iniciar conferência');
    }
  };

  const handleScan = async (raw: string) => {
    const norm = normalizeScan(raw);
    if (!norm) return;
    const matched = findExpectedMatch(norm, (code)=>expectedCounts.has(code));
    if (!matched) { toast.error('Este produto não pertence a este romaneio'); return; }
    // Bloquear leitura se produto foi marcado como "não bipar"
    const prodKey = (() => {
      const e = expected.find((x) => x.code === matched) || expected.find((x)=> norm.startsWith(x.code));
      return `${e?.orderId || ''}|${e?.productCode || extractProductCode(matched)}`;
    })();
    if (notBiped[prodKey]) {
      toast.error('Produto marcado como não bipado. Remova a marcação para bipar.');
      return;
    }
    const current = scannedCounts.get(matched) || 0;
    const max = expectedCounts.get(matched)!;
    if (current >= max) {
      toast.error('Volume excedente para este código');
      return;
    }
    const e = expected.find((x) => x.code === matched);
    try {
      await supabase.from('route_conference_scans').insert({
        route_conference_id: conferenceId,
        normalized_code: matched,
        order_id: e?.orderId,
        product_code: e?.productCode,
        volume_index: e?.volumeIndex,
        volume_total: e?.volumeTotal,
        matched: true,
      });
      const next = new Map(scannedCounts);
      next.set(matched, current + 1);
      setScannedCounts(next);
      setScanInput('');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao registrar leitura');
    }
  };

  const finalize = async () => {
    // Enforce all-or-nothing per product
    const byProduct: Record<string, { total: number; scanned: number; orderId?: string; productCode?: string }> = {};
    expected.forEach((e) => {
      const key = `${e.orderId || ''}|${e.productCode || extractProductCode(e.code)}`;
      const cnt = Math.min(scannedCounts.get(e.code) || 0, expectedCounts.get(e.code) || 0);
      if (!byProduct[key]) byProduct[key] = { total: 0, scanned: 0, orderId: e.orderId, productCode: e.productCode || extractProductCode(e.code) };
      byProduct[key].total += 1;
      byProduct[key].scanned += cnt;
    });

    const partialProducts = Object.values(byProduct).filter(p => p.scanned > 0 && p.scanned < p.total);
    if (partialProducts.length > 0) {
      toast.error('Conferência parcial detectada: finalize apenas com produtos 0% ou 100% bipados');
      return;
    }

    const missingLabels: { code: string; orderId?: string }[] = [];
    expectedCounts.forEach((max, code) => {
      const cur = scannedCounts.get(code) || 0;
      if (cur < max) {
        const e = expected.find((x) => x.code === code);
        missingLabels.push({ code, orderId: e?.orderId });
      }
    });
    try {
      const { error } = await supabase
        .from('route_conferences')
        .update({ status: 'completed', result_ok: missingLabels.length === 0 && Object.keys(notBiped).length === 0, finished_at: new Date().toISOString(), summary: { missing: missingLabels, notBipedProducts: Object.entries(notBiped).map(([key, v]) => { const [orderId, productCode] = key.split('|'); return { orderId, productCode, reason: v.reason, notes: v.notes }; }) } })
        .eq('id', conferenceId);
      if (error) throw error;
      toast.success(missingLabels.length === 0 ? 'Conferência finalizada (OK)' : 'Conferência finalizada com divergências');
      navigate('/conferente');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao finalizar conferência');
    }
  };

  const grouped = useMemo(() => {
    const map: Record<string, ExpectedLabel[]> = {};
    expected.forEach((e) => {
      const k = e.productCode || 'produto';
      if (!map[k]) map[k] = [];
      map[k].push(e);
    });
    return map;
  }, [expected]);

  return (
    <div className="p-6 space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => navigate(-1)} 
              className="p-2 -ml-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
              title="Voltar"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Conferência da Rota</h1>
          </div>
          {!started ? (
            <button onClick={startConference} className="px-4 py-2 bg-blue-600 text-white rounded-md">Iniciar Conferência</button>
          ) : (
            <button onClick={finalize} className="px-4 py-2 bg-green-600 text-white rounded-md flex items-center"><CheckCircle className="h-4 w-4 mr-1"/>Finalizar</button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            {Object.entries(grouped).map(([pcode, labels]) => (
              <div key={pcode} className="border rounded-md mb-4">
                <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
                  {(() => {
                    const findOrder = (id?: string) => (route?.route_orders || []).find((ro:any)=> String(ro.order_id) === String(id) || String(ro.order?.id) === String(id))?.order;
                    const ord = findOrder(labels[0]?.orderId);
                    const skus = Array.isArray(ord?.items_json) ? ord.items_json.map((it:any)=> String(it?.sku || '')).filter(Boolean) : [];
                    const norm = (s:string) => s.toLowerCase().trim();
                    const pnorm = norm(pcode || '');
                    const fullSku = skus.find(s => norm(s) === pnorm) || skus.find(s => norm(s).startsWith(pnorm)) || skus.find(s => norm(s).includes(pnorm));
                    const display = fullSku || pcode;
                    return <div className="font-semibold text-gray-900">Produto: {display}</div>;
                  })()}
                  <div className="flex items-center space-x-3">
                    <div className="text-sm text-gray-600">{labels.length} volume(s)</div>
                    {(() => {
                      const key = `${labels[0]?.orderId || ''}|${labels[0]?.productCode || extractProductCode(labels[0]?.code || '')}`;
                      const isMarked = Boolean(notBiped[key]);
                      return (
                        <div className="flex items-center space-x-2">
                          {!isMarked ? (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-red-600">Não bipar produto</summary>
                              <div className="mt-2 p-2 border rounded">
                                <label className="block mb-1">Motivo</label>
                                <select className="w-full border rounded px-2 py-1 mb-2" onChange={(e)=>{
                                  const reason = e.target.value;
                                  setNotBiped(prev=>({ ...prev, [key]: { reason, notes: prev[key]?.notes } }));
                                }}>
                                  <option value="">Selecione</option>
                                  {REASONS.map(r=> <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                                <label className="block mb-1">Observações (opcional)</label>
                                <input className="w-full border rounded px-2 py-1 mb-2" onChange={(e)=>{
                                  const notes = e.target.value;
                                  setNotBiped(prev=>({ ...prev, [key]: { reason: prev[key]?.reason || '', notes } }));
                                }} />
                                <button className="px-2 py-1 bg-red-600 text-white rounded text-xs" onClick={()=>{
                                  const entry = notBiped[key];
                                  if (!entry?.reason) { toast.error('Selecione um motivo'); return; }
                                  // Ao marcar, impedimos bipagem dos volumes deste produto
                                  toast.success('Produto marcado como não bipado');
                                }}>Confirmar</button>
                              </div>
                            </details>
                          ) : (
                            <button className="text-xs px-2 py-1 bg-gray-100 rounded" onClick={()=>{
                              setNotBiped(prev=>{ const copy = { ...prev }; delete copy[key]; return copy; });
                            }}>Desmarcar</button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {labels.map((l, idx) => {
                    const count = scannedCounts.get(l.code) || 0;
                    const max = expectedCounts.get(l.code) || 0;
                    const done = count >= max;
                    const key = `${l.orderId || ''}|${l.productCode || extractProductCode(l.code)}`;
                    return (
                      <div key={`${l.code}-${idx}`} className={`text-xs px-2 py-2 rounded border ${done ? 'bg-green-100 border-green-300 text-green-800' : notBiped[key] ? 'bg-red-100 border-red-300 text-red-700' : 'bg-gray-100 border-gray-300 text-gray-700'}`}>
                        {l.display || l.code}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="border rounded-md p-4">
              <div className="font-semibold text-gray-900 mb-2 flex items-center"><ScanLine className="h-4 w-4 mr-1"/>Leitura</div>
              {!started && (
                <div className="text-sm text-gray-600 mb-2">Clique em "Iniciar Conferência" para habilitar a leitura</div>
              )}
              <input
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && started) handleScan(scanInput); }}
                disabled={!started}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Bipe/Cole o código aqui e pressione Enter"
              />
              <div className="text-xs text-gray-500 mt-2">Aceita somente códigos pertencentes à rota. Sufixo de impressão é ignorado automaticamente.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
