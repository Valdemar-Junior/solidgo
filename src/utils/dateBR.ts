// Helpers de data no fuso de Brasilia.
//
// Motivo: Brasilia e UTC-3, entao `new Date().toISOString().slice(0, 10)` devolve
// o dia seguinte a partir das 21h. Isso zerava KPIs e jogava vendas noturnas para
// o dia errado em filtros e relatorios. Toda conversao de instante -> dia deve
// passar por aqui.

const TIME_ZONE = 'America/Sao_Paulo';

const DAY_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const toDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Dia correspondente ao instante no fuso de Brasilia, como 'YYYY-MM-DD'. */
export const toDateBR = (value: Date | string | number | null | undefined): string => {
  const date = toDate(value);
  if (!date) return '';

  const parts = DAY_PARTS_FORMATTER.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

/** Hoje em Brasilia, como 'YYYY-MM-DD'. */
export const todayBR = (): string => toDateBR(new Date());

/** Mesmo dia formatado como 'DD/MM/AAAA', ou '-' quando nao houver data. */
export const formatDateBR = (value: Date | string | number | null | undefined): string => {
  const day = toDateBR(value);
  if (!day) return '-';

  const [year, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}/${month}/${year}`;
};

const TIME_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * 'DD/MM/AAAA HH:MM' no fuso de Brasilia.
 *
 * Pedidos importados antes de 18/08/2026 foram gravados a meia-noite, porque o ERP
 * so mandava a data. Nesses casos devolve apenas o dia, para nao exibir um '00:00'
 * que nunca existiu.
 */
export const formatDateTimeBR = (value: Date | string | number | null | undefined): string => {
  const date = toDate(value);
  if (!date) return '-';

  const dateLabel = formatDateBR(date);
  const parts = TIME_PARTS_FORMATTER.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const timeLabel = `${pick('hour')}:${pick('minute')}`;

  return timeLabel === '00:00' ? dateLabel : `${dateLabel} ${timeLabel}`;
};

/** Instante ISO da meia-noite de Brasilia daquele dia (para filtros do Supabase). */
export const startOfDayBR = (value?: Date | string | number | null): string => {
  const day = toDateBR(value ?? new Date());
  if (!day) return '';
  return new Date(`${day}T00:00:00-03:00`).toISOString();
};

/** Soma dias sobre um 'YYYY-MM-DD' sem sair do fuso de Brasilia. */
export const addDaysBR = (day: string, days: number): string => {
  const base = toDate(`${day}T12:00:00-03:00`);
  if (!base) return day;

  base.setUTCDate(base.getUTCDate() + days);
  return toDateBR(base);
};
