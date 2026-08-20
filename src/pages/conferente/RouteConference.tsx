import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { OfflineStorage } from '../../utils/offline/storage';
import {
  buildStops, matchLine, normalizeScan, findOtherStops,
  type ExpectedLine, type Stop,
} from '../../utils/conference/expected';
import {
  ArrowLeft, CheckCircle2, ScanLine, Undo2, AlertTriangle,
  ChevronRight, CloudOff, Ban, RotateCcw, Play, X, Check,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Modelo (regras puras vivem em utils/conference/expected.ts)
 * ------------------------------------------------------------------ */

type ScanRecord = {
  localId: string;
  lineKey: string;
  orderId: string;
  code: string;
  exact: boolean;         // bateu com a etiqueta exata (não só com o código do produto)
  savedId?: string;       // id da linha em route_conference_scans
  pending?: boolean;      // ainda não foi pro banco
};

type NotShipped = Record<string, { reason: string; notes?: string }>;

type Feedback = { kind: 'ok' | 'err' | 'warn'; title: string; detail?: string; seq: number };

const REASONS = [
  { value: 'no_space', label: 'Não coube no caminhão' },
  { value: 'damaged', label: 'Avariado' },
  { value: 'no_stock', label: 'Sem estoque' },
  { value: 'not_found', label: 'Não encontrado no estoque' },
  { value: 'other', label: 'Outro' },
];

const reasonLabel = (v?: string) => REASONS.find((r) => r.value === v)?.label || v || '\u2014';

/* ------------------------------------------------------------------ *
 * Som e vibração (coletor de galpão: precisa avisar sem olhar)
 * ------------------------------------------------------------------ */

const useSignals = () => {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback((kind: 'ok' | 'err' | 'warn') => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        if (!ctxRef.current) ctxRef.current = new Ctx();
        const ctx = ctxRef.current!;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        if (kind === 'ok') {
          osc.type = 'sine';
          osc.frequency.value = 950;
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          osc.start(now); osc.stop(now + 0.11);
        } else if (kind === 'warn') {
          osc.type = 'triangle';
          osc.frequency.value = 520;
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.start(now); osc.stop(now + 0.23);
        } else {
          osc.type = 'square';
          osc.frequency.value = 170;
          gain.gain.setValueAtTime(0.22, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
          osc.start(now); osc.stop(now + 0.4);
        }
      }
    } catch { /* som é enfeite, nunca pode quebrar a leitura */ }

    try {
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'ok' ? 35 : kind === 'warn' ? [40, 50, 40] : [90, 70, 90]);
      }
    } catch { /* idem */ }
  }, []);
};

/* ------------------------------------------------------------------ *
 * Tela
 * ------------------------------------------------------------------ */

export default function RouteConference() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const signal = useSignals();

  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<any>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [conference, setConference] = useState<any>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [notShipped, setNotShipped] = useState<NotShipped>({});
  const [openOrderId, setOpenOrderId] = useState<string>('');
  const [scanInput, setScanInput] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ code: string; orderId: string } | null>(null);
  const [chooser, setChooser] = useState<{ code: string; candidates: Stop[] } | null>(null);
  const [reasonFor, setReasonFor] = useState<ExpectedLine | null>(null);
  const [reasonDraft, setReasonDraft] = useState<{ reason: string; notes: string }>({ reason: '', notes: '' });
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeDraft, setFinalizeDraft] = useState<NotShipped>({});
  const [saving, setSaving] = useState(false);
  const [offlineCount, setOfflineCount] = useState(0);
  const [manualTyping, setManualTyping] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  // Espelho síncrono das leituras: bipadas em sequência rápida não podem
  // escapar da checagem por causa do estado do React ser assíncrono.
  const scansRef = useRef<ScanRecord[]>([]);
  const applyScans = useCallback((updater: (prev: ScanRecord[]) => ScanRecord[]) => {
    scansRef.current = updater(scansRef.current);
    setScans(scansRef.current);
  }, []);
  const lineScans = useCallback((lineKey: string) => scansRef.current.filter((s) => s.lineKey === lineKey), []);

  const started = Boolean(conference?.id) && conference?.status === 'in_progress';
  const dialogOpen = Boolean(chooser || reasonFor || finalizeOpen);
  const openStop = useMemo(() => stops.find((s) => s.orderId === openOrderId) || null, [stops, openOrderId]);

  const pendingKey = conference?.id ? `conf_pending_${conference.id}` : '';
  const marksKey = conference?.id ? `conf_marks_${conference.id}` : '';

  /* ---------------- contagens ---------------- */

  const scansByLine = useMemo(() => {
    const m = new Map<string, ScanRecord[]>();
    scans.forEach((s) => {
      if (!m.has(s.lineKey)) m.set(s.lineKey, []);
      m.get(s.lineKey)!.push(s);
    });
    return m;
  }, [scans]);

  const countOf = useCallback((lineKey: string) => (scansByLine.get(lineKey) || []).length, [scansByLine]);

  const stopProgress = useCallback((stop: Stop) => {
    let scanned = 0;
    let marked = 0;
    stop.lines.forEach((l) => {
      scanned += Math.min(countOf(l.key), l.required);
      if (notShipped[l.key]) marked += l.required;
    });
    const done = stop.required > 0 && scanned + marked >= stop.required;
    return { scanned, marked, required: stop.required, done };
  }, [countOf, notShipped]);

  const totals = useMemo(() => {
    let required = 0, scanned = 0, marked = 0, ordersDone = 0;
    stops.forEach((s) => {
      const p = stopProgress(s);
      required += p.required;
      scanned += p.scanned;
      marked += p.marked;
      if (p.done) ordersDone += 1;
    });
    return { required, scanned, marked, ordersDone, orders: stops.length };
  }, [stops, stopProgress]);

  /* ---------------- carregar ---------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: r, error: rErr }, { data: snap }] = await Promise.all([
        supabase
          .from('routes')
          .select('id,name,route_code,status,conferente,conferente_id, route_orders:route_orders(id,order_id,status,sequence, order:orders!order_id(id,order_id_erp,customer_name,items_json))')
          .eq('id', routeId)
          .single(),
        supabase
          .from('route_order_items')
          .select('order_id,sku_snapshot,allocated_quantity,purchased_quantity')
          .eq('route_id', routeId),
      ]);
      if (rErr) throw rErr;

      setRoute(r);
      setStops(buildStops(r, snap || []));

      // Retoma a conferência em andamento em vez de criar outra.
      const { data: confs } = await supabase
        .from('route_conferences')
        .select('*')
        .eq('route_id', routeId)
        .order('created_at', { ascending: false })
        .limit(1);
      const conf = (confs || [])[0] || null;
      setConference(conf);

      if (conf?.id) {
        const { data: rows } = await supabase
          .from('route_conference_scans')
          .select('id,normalized_code,order_id,product_code,created_at')
          .eq('route_conference_id', conf.id)
          .order('created_at', { ascending: true });

        const built = buildStops(r, snap || []);
        const recovered: ScanRecord[] = [];
        (rows || []).forEach((row: any) => {
          const stop = built.find((s) => s.orderId === String(row.order_id));
          if (!stop) return;
          const code = normalizeScan(String(row.normalized_code || ''));
          const hit = matchLine(code, stop.lines)
            || (row.product_code
              ? matchLine(`1/1-${String(row.product_code).toLowerCase()}`, stop.lines)
              : null);
          if (!hit) return;
          recovered.push({
            localId: `db_${row.id}`,
            lineKey: hit.line.key,
            orderId: stop.orderId,
            code,
            exact: hit.exact,
            savedId: String(row.id),
          });
        });
        applyScans(() => recovered);

        const marks = (await OfflineStorage.getItem(`conf_marks_${conf.id}`)) as NotShipped | null;
        if (marks) setNotShipped(marks);
      }
    } catch (e) {
      console.error(e);
      toast.error('Falha ao carregar a rota para conferência');
    } finally {
      setLoading(false);
    }
  }, [routeId, applyScans]);

  useEffect(() => { load(); }, [load]);

  /* ---------------- fila offline ---------------- */

  const readQueue = useCallback(async (): Promise<any[]> => {
    if (!pendingKey) return [];
    const q = (await OfflineStorage.getItem(pendingKey)) as any[] | null;
    return Array.isArray(q) ? q : [];
  }, [pendingKey]);

  const writeQueue = useCallback(async (q: any[]) => {
    if (!pendingKey) return;
    await OfflineStorage.setItem(pendingKey, q);
    setOfflineCount(q.length);
  }, [pendingKey]);

  const flushQueue = useCallback(async () => {
    if (!pendingKey) return;
    const q = await readQueue();
    if (q.length === 0) { setOfflineCount(0); return; }
    const rest: any[] = [];
    for (const item of q) {
      try {
        const { data, error } = await supabase
          .from('route_conference_scans')
          .insert(item.payload)
          .select('id')
          .single();
        if (error) throw error;
        applyScans((prev) => prev.map((s) => (
          s.localId === item.localId ? { ...s, savedId: String(data.id), pending: false } : s
        )));
      } catch {
        rest.push(item);
      }
    }
    await writeQueue(rest);
  }, [pendingKey, readQueue, writeQueue, applyScans]);

  useEffect(() => {
    if (!conference?.id) return;
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener('online', onOnline);
    const t = window.setInterval(() => { if (navigator.onLine) flushQueue(); }, 20000);
    return () => { window.removeEventListener('online', onOnline); window.clearInterval(t); };
  }, [conference?.id, flushQueue]);

  useEffect(() => {
    if (!marksKey) return;
    OfflineStorage.setItem(marksKey, notShipped).catch(() => {});
  }, [marksKey, notShipped]);

  /* ---------------- foco do coletor ---------------- */

  const keepFocus = useCallback(() => {
    if (dialogOpen || !openStop || !started) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [dialogOpen, openStop, started]);

  useEffect(() => { keepFocus(); }, [keepFocus]);

  useEffect(() => {
    // Coletor "tipo teclado" digita direto: se o cursor escapou do campo,
    // trazemos de volta e não perdemos o caractere.
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen || !openStop || !started) return;
      if (document.activeElement === inputRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      e.preventDefault();
      setScanInput((prev) => prev + e.key);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, openStop, started]);

  /* ---------------- feedback ---------------- */

  const say = useCallback((kind: Feedback['kind'], title: string, detail?: string) => {
    seqRef.current += 1;
    setFeedback({ kind, title, detail, seq: seqRef.current });
    signal(kind);
  }, [signal]);

  /* ---------------- iniciar / refazer ---------------- */

  const startConference = async (redo = false) => {
    try {
      setSaving(true);
      if (!redo && conference?.status === 'in_progress') { keepFocus(); return; }
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('route_conferences')
        .insert({ route_id: routeId, status: 'in_progress', user_id: user?.id || null })
        .select()
        .single();
      if (error) throw error;
      setConference(data);
      applyScans(() => []);
      setNotShipped({});
      toast.success('Conferência iniciada');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao iniciar a conferência');
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- bipar ---------------- */

  const registerScan = useCallback(async (line: ExpectedLine, code: string, exact: boolean) => {
    const localId = `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idx = lineScans(line.key).length + 1;
    const record: ScanRecord = { localId, lineKey: line.key, orderId: line.orderId, code, exact, pending: true };
    applyScans((prev) => [...prev, record]);

    const payload = {
      route_conference_id: conference?.id,
      normalized_code: code,
      order_id: line.orderId,
      product_code: line.sku,
      volume_index: idx,
      volume_total: line.required,
      matched: true,
    };

    try {
      const { data, error } = await supabase
        .from('route_conference_scans')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      applyScans((prev) => prev.map((s) => (
        s.localId === localId ? { ...s, savedId: String(data.id), pending: false } : s
      )));
    } catch {
      const q = await readQueue();
      q.push({ localId, payload });
      await writeQueue(q);
    }

    say('ok', `${line.sku} — volume ${Math.min(idx, line.required)} de ${line.required}`, line.name || undefined);
  }, [conference?.id, lineScans, applyScans, readQueue, writeQueue, say]);

  const onScan = useCallback(async (raw: string) => {
    setScanInput('');
    const norm = normalizeScan(raw);
    if (!norm || !openStop || !started) return;

    const hit = matchLine(norm, openStop.lines);

    if (!hit) {
      // O volume é de outro pedido da rota?
      const candidates = findOtherStops(norm, stops, openStop.orderId);
      if (candidates.length === 0) {
        setPendingSwitch(null);
        say('err', 'Este volume não é desta rota', norm);
        return;
      }
      if (candidates.length > 1) {
        setChooser({ code: norm, candidates });
        say('warn', 'Este volume está em mais de um pedido', 'Escolha o cliente na tela');
        return;
      }
      const target = candidates[0];
      if (pendingSwitch?.code === norm && pendingSwitch.orderId === target.orderId) {
        setPendingSwitch(null);
        setOpenOrderId(target.orderId);
        const th = matchLine(norm, target.lines)!;
        if (notShipped[th.line.key]) { say('err', 'Produto marcado como "não vai"', 'Desmarque para bipar'); return; }
        await registerScan(th.line, norm, th.exact);
        return;
      }
      setPendingSwitch({ code: norm, orderId: target.orderId });
      say('warn', `Volume do pedido ${target.erp}`, `${target.customer} — bipe de novo para trocar de pedido`);
      return;
    }

    setPendingSwitch(null);
    const { line, exact } = hit;

    if (notShipped[line.key]) {
      say('err', 'Produto marcado como "não vai"', 'Desmarque para poder bipar');
      return;
    }

    const already = lineScans(line.key);
    if (exact && already.some((s) => s.code === norm)) {
      say('err', 'Volume repetido', `${line.sku} — esta etiqueta já foi bipada`);
      return;
    }
    if (already.length >= line.required) {
      say('err', 'Volume a mais', `${line.sku} já está completo (${line.required})`);
      return;
    }

    await registerScan(line, norm, exact);
  }, [openStop, started, stops, pendingSwitch, notShipped, lineScans, registerScan, say]);

  const undoLast = useCallback(async () => {
    if (!openStop) return;
    const mine = scansRef.current.filter((s) => s.orderId === openStop.orderId);
    const last = mine[mine.length - 1];
    if (!last) { say('warn', 'Nada para desfazer', 'Nenhum volume bipado neste pedido'); return; }
    applyScans((prev) => prev.filter((s) => s.localId !== last.localId));

    if (!last.savedId) {
      // Ainda estava na fila offline: basta tirar da fila.
      const q = await readQueue();
      await writeQueue(q.filter((i) => i.localId !== last.localId));
      say('warn', 'Leitura desfeita', last.code);
      return;
    }

    try {
      // Confirmamos que a linha REALMENTE saiu: sem permissão de DELETE o
      // Postgres apaga zero linhas e não reclama, e a tela ficaria mentindo.
      const { data, error } = await supabase
        .from('route_conference_scans')
        .delete()
        .eq('id', last.savedId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        applyScans((prev) => [...prev, last]); // desfaz o desfazer: banco não deixou
        say('err', 'Não consegui desfazer', 'O banco não permitiu apagar a leitura — avise o suporte');
        return;
      }
    } catch (e) {
      console.error(e);
      applyScans((prev) => [...prev, last]);
      say('err', 'Não consegui desfazer', 'Sem conexão com o banco — tente de novo');
      return;
    }

    say('warn', 'Leitura desfeita', last.code);
  }, [openStop, applyScans, readQueue, writeQueue, say]);

  /* ---------------- finalizar ---------------- */

  const openFinalize = () => {
    const draft: NotShipped = {};
    stops.forEach((s) => s.lines.forEach((l) => {
      if (notShipped[l.key]) { draft[l.key] = notShipped[l.key]; return; }
      if (countOf(l.key) < l.required) draft[l.key] = { reason: '', notes: '' };
    }));
    setFinalizeDraft(draft);
    setFinalizeOpen(true);
  };

  const pendingLines = useMemo(() => {
    const out: { stop: Stop; line: ExpectedLine; scanned: number }[] = [];
    stops.forEach((s) => s.lines.forEach((l) => {
      const c = countOf(l.key);
      if (c < l.required) out.push({ stop: s, line: l, scanned: c });
    }));
    return out;
  }, [stops, countOf]);

  const confirmFinalize = async () => {
    const faltandoMotivo = pendingLines.filter(({ line }) => !finalizeDraft[line.key]?.reason);
    if (faltandoMotivo.length > 0) {
      toast.error('Informe o motivo de cada produto que não foi bipado');
      return;
    }

    setSaving(true);
    try {
      await flushQueue();

      // Formato mantido para a tela de "Revisão de Conferência" do admin.
      const missing: { code: string; orderId: string }[] = [];
      const notBipedProducts: { orderId: string; productCode: string; reason: string; notes?: string }[] = [];
      const byOrder: any[] = [];

      stops.forEach((stop) => {
        const p = stopProgress(stop);
        byOrder.push({
          orderId: stop.orderId,
          erp: stop.erp,
          customer: stop.customer,
          required: p.required,
          scanned: p.scanned,
        });
        stop.lines.forEach((line) => {
          const scanned = countOf(line.key);
          if (scanned >= line.required) return;
          const info = finalizeDraft[line.key] || notShipped[line.key];
          notBipedProducts.push({
            orderId: stop.orderId,
            productCode: line.sku,
            reason: info?.reason || 'other',
            notes: [info?.notes, `bipados ${scanned} de ${line.required}`].filter(Boolean).join(' • '),
          });
          for (let i = scanned + 1; i <= line.required; i++) {
            missing.push({ code: line.codes[i - 1] || `${i}/${line.required}-${line.skuNorm}`, orderId: stop.orderId });
          }
        });
      });

      const okTudo = missing.length === 0 && notBipedProducts.length === 0;
      const { data: updated, error } = await supabase
        .from('route_conferences')
        .update({
          status: 'completed',
          result_ok: okTudo,
          finished_at: new Date().toISOString(),
          summary: {
            missing,
            notBipedProducts,
            byOrder,
            totals: { required: totals.required, scanned: totals.scanned, orders: stops.length },
          },
        })
        .eq('id', conference.id)
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        // Sem permissão, o banco não grava e também não reclama. Não podemos
        // dizer "finalizado" pra quem está no galpão se não finalizou.
        toast.error('O banco não deixou finalizar esta conferência (permissão). Avise o suporte — nada foi perdido.');
        return;
      }

      if (marksKey) await OfflineStorage.removeItem(marksKey).catch(() => {});
      toast.success(okTudo ? 'Conferência finalizada — tudo certo' : 'Conferência finalizada com divergências');
      navigate('/conferente');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao finalizar a conferência');
    } finally {
      setSaving(false);
      setFinalizeOpen(false);
    }
  };

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  const fbTone = feedback?.kind === 'ok'
    ? 'bg-green-600 text-white'
    : feedback?.kind === 'warn'
      ? 'bg-amber-500 text-white'
      : 'bg-red-600 text-white';

  /* ---------- Tela 1: lista de pedidos ---------- */
  if (!openStop) {
    const finished = conference?.status === 'completed';
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        <div className="sticky top-0 z-10 bg-white border-b shadow-sm px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/conferente')} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-600">
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-gray-900 truncate">{route?.name || 'Rota'}</div>
              <div className="text-xs text-gray-500">
                {totals.ordersDone} de {totals.orders} pedido(s) conferido(s)
              </div>
            </div>
            {offlineCount > 0 && (
              <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                <CloudOff className="h-3.5 w-3.5" /> {offlineCount}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="text-3xl font-extrabold leading-none text-gray-900">
                {totals.scanned}<span className="text-lg font-bold text-gray-400">/{totals.required}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">volumes bipados</div>
            </div>
            {totals.marked > 0 && (
              <div className="text-xs text-red-600 font-medium">{totals.marked} volume(s) marcados como "não vão"</div>
            )}
          </div>
          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${totals.required ? Math.min(100, (totals.scanned / totals.required) * 100) : 0}%` }}
            />
          </div>
        </div>

        <div className="p-3 space-y-2">
          {!started && !finished && (
            <button
              onClick={() => startConference(false)}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-4 rounded-xl shadow disabled:opacity-60"
            >
              <Play className="h-5 w-5" /> Iniciar conferência
            </button>
          )}
          {finished && (
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                {conference?.result_ok
                  ? <><CheckCircle2 className="h-5 w-5 text-green-600" /> Conferência finalizada — tudo certo</>
                  : <><AlertTriangle className="h-5 w-5 text-red-600" /> Conferência finalizada com divergências</>}
              </div>
              <button
                onClick={() => startConference(true)}
                disabled={saving}
                className="mt-3 w-full flex items-center justify-center gap-2 border border-blue-600 text-blue-700 font-semibold py-3 rounded-lg disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" /> Refazer conferência
              </button>
            </div>
          )}

          {stops.length === 0 && (
            <div className="bg-white border rounded-xl p-6 text-center text-gray-600">
              Esta rota não tem pedidos para conferir.
            </div>
          )}

          {stops.map((stop) => {
            const p = stopProgress(stop);
            const semItens = stop.required === 0;
            return (
              <button
                key={stop.orderId}
                onClick={() => { if (started) { setOpenOrderId(stop.orderId); setFeedback(null); setPendingSwitch(null); } else { toast.error('Inicie a conferência primeiro'); } }}
                className={`w-full text-left bg-white border rounded-xl p-4 flex items-center gap-3 active:bg-gray-50 ${p.done ? 'border-green-300' : 'border-gray-200'}`}
              >
                <div className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center font-bold ${p.done ? 'bg-green-100 text-green-700' : p.scanned > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.done ? <Check className="h-6 w-6" /> : stop.sequence || '–'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 truncate">{stop.customer || 'Cliente não informado'}</div>
                  <div className="text-xs text-gray-500">Pedido {stop.erp || '—'}</div>
                  {semItens
                    ? <div className="text-xs text-red-600 mt-1 font-medium">Sem itens cadastrados neste pedido</div>
                    : <div className="text-sm mt-1 font-medium text-gray-700">{p.scanned} de {p.required} volume(s){p.marked > 0 ? ` • ${p.marked} não vai(ão)` : ''}</div>}
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400 shrink-0" />
              </button>
            );
          })}
        </div>

        {started && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3">
            <button
              onClick={openFinalize}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-4 rounded-xl shadow"
            >
              <CheckCircle2 className="h-5 w-5" /> Finalizar conferência
            </button>
          </div>
        )}

        {finalizeOpen && (
          <FinalizeDialog
            pendingLines={pendingLines}
            draft={finalizeDraft}
            setDraft={setFinalizeDraft}
            onCancel={() => setFinalizeOpen(false)}
            onConfirm={confirmFinalize}
            saving={saving}
            totals={totals}
          />
        )}
      </div>
    );
  }

  /* ---------- Tela 2: pedido aberto (modo coletor) ---------- */
  const p = stopProgress(openStop);
  const nextStop = stops.find((s) => s.orderId !== openStop.orderId && !stopProgress(s).done);

  return (
    <div className="min-h-screen bg-gray-50 pb-32" onClick={keepFocus}>
      <div className="sticky top-0 z-10 bg-white border-b shadow-sm">
        <div className="px-4 py-3 flex items-center gap-2">
          <button onClick={() => { setOpenOrderId(''); setPendingSwitch(null); }} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-600">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-gray-900 truncate">{openStop.customer || 'Cliente não informado'}</div>
            <div className="text-xs text-gray-500">Pedido {openStop.erp || '—'} • parada {openStop.sequence || '–'}</div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-extrabold leading-none ${p.done ? 'text-green-600' : 'text-gray-900'}`}>
              {p.scanned}<span className="text-base font-bold text-gray-400">/{p.required}</span>
            </div>
            {offlineCount > 0 && (
              <div className="text-[10px] text-amber-700 flex items-center justify-end gap-1 mt-0.5">
                <CloudOff className="h-3 w-3" /> {offlineCount} p/ enviar
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pb-3">
          <input
            ref={inputRef}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onScan(scanInput); }
            }}
            onBlur={keepFocus}
            autoFocus
            autoComplete="off"
            inputMode={manualTyping ? 'text' : 'none'}
            className="w-full px-4 py-3 text-lg border-2 border-blue-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder={manualTyping ? 'Digite o código e aperte Enter' : 'Bipe o volume'}
          />
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              <ScanLine className="h-3.5 w-3.5" /> Campo pronto para o coletor — não precisa tocar na tela
            </span>
            <button
              onClick={() => { setManualTyping((v) => !v); keepFocus(); }}
              className="shrink-0 font-semibold text-blue-600 underline"
            >
              {manualTyping ? 'Usar coletor' : 'Digitar na mão'}
            </button>
          </div>
        </div>

        {feedback && (
          <div key={feedback.seq} className={`px-4 py-3 ${fbTone}`}>
            <div className="font-bold text-base leading-tight">{feedback.title}</div>
            {feedback.detail && <div className="text-sm opacity-90 mt-0.5 break-all">{feedback.detail}</div>}
          </div>
        )}

        {pendingSwitch && (
          <div className="px-4 py-2 bg-amber-100 text-amber-900 text-sm font-medium">
            Bipe o mesmo código de novo para trocar de pedido.
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {openStop.lines.length === 0 && (
          <div className="bg-white border rounded-xl p-6 text-center text-gray-600">
            Este pedido não tem itens cadastrados. Avise a logística antes de carregar.
          </div>
        )}

        {[...openStop.lines]
          .sort((a, b) => {
            const ad = countOf(a.key) >= a.required || Boolean(notShipped[a.key]);
            const bd = countOf(b.key) >= b.required || Boolean(notShipped[b.key]);
            return Number(ad) - Number(bd);
          })
          .map((line) => {
            const count = countOf(line.key);
            const mark = notShipped[line.key];
            const done = count >= line.required;
            return (
              <div key={line.key} className={`bg-white border rounded-xl overflow-hidden ${mark ? 'border-red-300' : done ? 'border-green-300' : 'border-gray-200'}`}>
                <div className="px-4 py-3 flex items-start gap-3 border-b bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-gray-900">{line.sku}</div>
                    {line.name && <div className="text-xs text-gray-600 truncate">{line.name}</div>}
                    {line.location && <div className="text-[11px] text-gray-500 mt-0.5">Local: {line.location}</div>}
                  </div>
                  <div className={`shrink-0 text-sm font-bold ${done ? 'text-green-600' : 'text-gray-700'}`}>
                    {count}/{line.required}
                  </div>
                </div>

                <div className="p-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {Array.from({ length: line.required }, (_, i) => {
                    const filled = i < count;
                    return (
                      <div
                        key={i}
                        className={`h-12 rounded-lg border flex items-center justify-center text-sm font-bold ${
                          filled
                            ? 'bg-green-500 border-green-600 text-white'
                            : mark
                              ? 'bg-red-50 border-red-200 text-red-500'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                        }`}
                      >
                        {filled ? <Check className="h-5 w-5" /> : i + 1}
                      </div>
                    );
                  })}
                </div>

                <div className="px-3 pb-3">
                  {mark ? (
                    <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <div className="text-xs text-red-700 min-w-0">
                        <span className="font-semibold">Não vai:</span> {reasonLabel(mark.reason)}
                        {mark.notes ? ` • ${mark.notes}` : ''}
                      </div>
                      <button
                        onClick={() => setNotShipped((prev) => { const c = { ...prev }; delete c[line.key]; return c; })}
                        className="shrink-0 text-xs font-semibold text-gray-700 bg-white border rounded px-2 py-1"
                      >
                        Desmarcar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setReasonFor(line); setReasonDraft({ reason: '', notes: '' }); }}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg py-2"
                    >
                      <Ban className="h-3.5 w-3.5" /> Este produto não vai
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex gap-2">
        <button
          onClick={undoLast}
          className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-800 font-semibold py-3.5 rounded-xl"
        >
          <Undo2 className="h-5 w-5" /> Desfazer
        </button>
        {p.done && nextStop ? (
          <button
            onClick={() => { setOpenOrderId(nextStop.orderId); setFeedback(null); setPendingSwitch(null); }}
            className="flex-[1.4] flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3.5 rounded-xl"
          >
            Próximo pedido <ChevronRight className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={() => { setOpenOrderId(''); setPendingSwitch(null); }}
            className="flex-[1.4] flex items-center justify-center gap-2 bg-gray-800 text-white font-bold py-3.5 rounded-xl"
          >
            Lista de pedidos
          </button>
        )}
      </div>

      {/* Escolha de pedido quando o mesmo código está em vários */}
      {chooser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-bold text-gray-900">De quem é este volume?</div>
              <button onClick={() => { setChooser(null); keepFocus(); }} className="p-1 text-gray-500"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
              <div className="text-xs text-gray-500 break-all mb-1">Código lido: {chooser.code}</div>
              {chooser.candidates.map((c) => (
                <button
                  key={c.orderId}
                  onClick={async () => {
                    const code = chooser.code;
                    setChooser(null);
                    setOpenOrderId(c.orderId);
                    const th = matchLine(code, c.lines);
                    if (!th) return;
                    if (notShipped[th.line.key]) { say('err', 'Produto marcado como "não vai"', 'Desmarque para bipar'); return; }
                    const already = lineScans(th.line.key);
                    if (th.exact && already.some((s) => s.code === code)) { say('err', 'Volume repetido', th.line.sku); return; }
                    if (already.length >= th.line.required) { say('err', 'Volume a mais', th.line.sku); return; }
                    await registerScan(th.line, code, th.exact);
                  }}
                  className="w-full text-left border rounded-xl px-4 py-3 active:bg-gray-50"
                >
                  <div className="font-semibold text-gray-900">{c.customer || 'Cliente não informado'}</div>
                  <div className="text-xs text-gray-500">Pedido {c.erp || '—'} • parada {c.sequence || '–'}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Motivo do "não vai" */}
      {reasonFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-bold text-gray-900">Por que {reasonFor.sku} não vai?</div>
              <button onClick={() => { setReasonFor(null); keepFocus(); }} className="p-1 text-gray-500"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReasonDraft((d) => ({ ...d, reason: r.value }))}
                    className={`w-full text-left px-4 py-3 rounded-xl border font-medium ${reasonDraft.reason === r.value ? 'bg-blue-50 border-blue-500 text-blue-800' : 'border-gray-200 text-gray-700'}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <input
                value={reasonDraft.notes}
                onChange={(e) => setReasonDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Observação (opcional)"
                className="w-full px-3 py-2.5 border rounded-xl"
              />
              <button
                onClick={() => {
                  if (!reasonDraft.reason) { toast.error('Escolha um motivo'); return; }
                  setNotShipped((prev) => ({ ...prev, [reasonFor.key]: { reason: reasonDraft.reason, notes: reasonDraft.notes || undefined } }));
                  setReasonFor(null);
                  keepFocus();
                }}
                className="w-full bg-red-600 text-white font-bold py-3.5 rounded-xl"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {finalizeOpen && (
        <FinalizeDialog
          pendingLines={pendingLines}
          draft={finalizeDraft}
          setDraft={setFinalizeDraft}
          onCancel={() => { setFinalizeOpen(false); keepFocus(); }}
          onConfirm={confirmFinalize}
          saving={saving}
          totals={totals}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Diálogo de finalização: exige motivo para cada produto incompleto
 * ------------------------------------------------------------------ */

function FinalizeDialog({
  pendingLines, draft, setDraft, onCancel, onConfirm, saving, totals,
}: {
  pendingLines: { stop: Stop; line: ExpectedLine; scanned: number }[];
  draft: NotShipped;
  setDraft: Dispatch<SetStateAction<NotShipped>>;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
  totals: { required: number; scanned: number };
}) {
  const applyAll = (reason: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      pendingLines.forEach(({ line }) => { next[line.key] = { reason, notes: next[line.key]?.notes }; });
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-bold text-gray-900">Finalizar conferência</div>
          <button onClick={onCancel} className="p-1 text-gray-500"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <div className="bg-gray-50 border rounded-xl px-4 py-3 text-sm text-gray-700">
            <span className="font-bold text-gray-900">{totals.scanned} de {totals.required}</span> volume(s) bipados.
          </div>

          {pendingLines.length === 0 ? (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-800 font-semibold">
              <CheckCircle2 className="h-5 w-5" /> Tudo bipado. Pode finalizar.
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-900 text-sm">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  {pendingLines.length} produto(s) não foram bipados por completo. Diga o motivo de cada um — isso vai
                  aparecer para a logística.
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Aplicar o mesmo motivo em todos:
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button key={r.value} onClick={() => applyAll(r.value)} className="px-2.5 py-1.5 border rounded-full text-xs font-medium text-gray-700">
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {pendingLines.map(({ stop, line, scanned }) => (
                <div key={line.key} className="border rounded-xl p-3">
                  <div className="font-semibold text-gray-900">{line.sku}</div>
                  <div className="text-xs text-gray-500">
                    {stop.customer || 'Cliente'} • Pedido {stop.erp || '—'} • bipados {scanned} de {line.required}
                  </div>
                  <select
                    value={draft[line.key]?.reason || ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [line.key]: { reason: e.target.value, notes: prev[line.key]?.notes } }))}
                    className="mt-2 w-full border rounded-lg px-3 py-2.5"
                  >
                    <option value="">Escolha o motivo…</option>
                    {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <input
                    value={draft[line.key]?.notes || ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [line.key]: { reason: prev[line.key]?.reason || '', notes: e.target.value } }))}
                    placeholder="Observação (opcional)"
                    className="mt-2 w-full border rounded-lg px-3 py-2"
                  />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="p-3 border-t flex gap-2">
          <button onClick={onCancel} className="flex-1 bg-gray-100 text-gray-800 font-semibold py-3.5 rounded-xl">
            Voltar
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="flex-[1.4] bg-green-600 text-white font-bold py-3.5 rounded-xl disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Finalizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
