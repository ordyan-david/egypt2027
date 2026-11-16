import { BUDGET, BUDGET_GROUPS, DEFAULT_VARIANT, getItinerary, SOURCES } from './data.js';

export const rub = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`;
export const number = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);

export function computeBudget({ people = 1, flightExtra = 0, includeSouvenirs = false } = {}) {
  if (![1, 4].includes(people) || !Number.isFinite(flightExtra) || flightExtra < 0 || flightExtra > 15000) {
    throw new RangeError('Выберите 1 или 4 человека и надбавку от 0 до 15 000 ₽.');
  }
  const personalRows = BUDGET.map((row) => ({ ...row }));
  if (flightExtra > 0) personalRows.push({ id: 'extra-flights', label: 'Запас на удорожание перелётов', amount: flightExtra, group: 'flights', extra: true });
  if (includeSouvenirs) personalRows.push({ id: 'extra-souvenirs', label: 'Сувениры · по желанию', amount: 5000, group: 'other', extra: true });
  const perPerson = personalRows.reduce((sum, row) => sum + row.amount, 0);
  const rows = personalRows.map((row) => ({ ...row, amount: row.amount * people }));
  const groups = BUDGET_GROUPS.map((group) => ({ ...group, amount: rows.filter((row) => row.group === group.id).reduce((sum, row) => sum + row.amount, 0) }));
  return { people, perPerson, total: perPerson * people, rows, groups };
}

export function convertPrice(item, rates = { EGP: 1.6, USD: 90 }) {
  const rate = item.currency === 'RUB' ? 1 : rates[item.currency];
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Курс должен быть положительным числом.');
  if (!Number.isFinite(item.min) || !Number.isFinite(item.max) || item.min < 0 || item.max < item.min) throw new RangeError('Некорректный диапазон цен.');
  return { min: Math.round(item.min * rate), max: Math.round(item.max * rate) };
}

const escapeICS = (value) => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function foldICS(line) {
  let result = '', current = '', count = 0;
  for (const character of line) {
    const bytes = new TextEncoder().encode(character).length;
    if (count + bytes > 75) { result += `${current}\r\n`; current = ' '; count = 1; }
    current += character; count += bytes;
  }
  return result + current;
}
export function makeCalendar(variantId = DEFAULT_VARIANT) {
  const { trip, days, cities } = getItinerary(variantId);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Egypt 2027//Trip plan//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeICS(`Египет 2027 — ${trip.label}`)}`];
  for (const day of days) {
    const end = new Date(`${day.date}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
    const city = cities.find((item) => item.id === day.cityId).name;
    const location = day.kind === 'arrival' ? 'Воронеж → Москва → Хургада' : day.kind === 'return' ? 'Каир → Москва → Воронеж' : day.kind === 'luxor-west' ? 'Луксор → Каир, Египет' : `${city}, Египет`;
    lines.push('BEGIN:VEVENT', `UID:egypt-2027-${trip.id}-${day.kind}-${day.date}@trip.local`, 'DTSTAMP:20261116T000000Z', `DTSTART;VALUE=DATE:${day.date.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replaceAll('-', '')}`, `SUMMARY:${escapeICS(day.title)}`, `LOCATION:${escapeICS(location)}`, `DESCRIPTION:${escapeICS(day.description + '\n' + day.periods.map((p) => `${p.time}: ${p.text}`).join('\n') + '\n' + day.note + '\nПредварительная программа, бронирований нет. Точное время транспорта ещё подбираем.')}`, 'TRANSP:TRANSPARENT', 'STATUS:TENTATIVE', 'END:VEVENT');
  }
  const homeEnd = new Date(`${trip.homeDate}T00:00:00Z`); homeEnd.setUTCDate(homeEnd.getUTCDate() + 1);
  lines.push('BEGIN:VEVENT', `UID:egypt-2027-${trip.id}-home-${trip.homeDate}@trip.local`, 'DTSTAMP:20261116T000000Z', `DTSTART;VALUE=DATE:${trip.homeDate.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${homeEnd.toISOString().slice(0, 10).replaceAll('-', '')}`, `SUMMARY:${escapeICS('Утро: дома в Воронеже')}`, `LOCATION:${escapeICS('Воронеж, Россия')}`, `DESCRIPTION:${escapeICS(`Планируем прибыть в Воронеж утром ${trip.homeDateLabel} ночным поездом из Москвы. В Москву прилетаем из Каира вечером ${trip.returnDateLabel}. Точные поезда, рейсы и стыковки ещё не подтверждены. Это отдельный день дороги после 9 дней и 8 ночей в Египте; событие без фиксированного времени.`)}`, 'TRANSP:TRANSPARENT', 'STATUS:TENTATIVE', 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.map(foldICS).join('\r\n') + '\r\n';
}

export function makePlan({ variantId = DEFAULT_VARIANT, flightExtra = 0, includeSouvenirs = false } = {}) {
  const { trip, cities, days } = getItinerary(variantId);
  const plan = computeBudget({ flightExtra, includeSouvenirs });
  const freeDay = days.find((day) => day.kind === 'free');
  return [
    'ЕГИПЕТ 2027 — ОДНО БОЛЬШОЕ ПРИКЛЮЧЕНИЕ',
    `${trip.longLabel} · 9 дней · 8 ночей в Египте · 4 друга`,
    `Дома в Воронеже — утром ${trip.homeDateLabel}.`,
    'Предварительный план, бронирований нет.', '',
    'МАРШРУТ', 'Воронеж → Москва → Хургада → Луксор → Каир → Москва → Воронеж.',
    ...cities.map((city) => `${city.name}: ${city.dates}, ${city.nights === 1 ? '1 ночь' : `${city.nights} ночи`}.`), '',
    'ДОРОГА ТУДА И ОБРАТНО',
    `${trip.departureDateLabel} утром — сидячий поезд Воронеж → Москва; прибытие в Москву около 14:00, затем подходящий вечерний рейс Москва → Хургада. Закладываем запас на дорогу в аэропорт, регистрацию и контроль.`,
    `${trip.returnDateLabel} — перелёт Каир → Москва так, чтобы вечером этой даты прибыть в Москву; затем ночной поезд Москва → Воронеж. На паспортный контроль, багаж и переезд к поезду нужен запас.`,
    `Утром ${trip.homeDateLabel} — дома в Воронеже. Это дополнительное утро дороги после 9 дней и 8 ночей в Египте.`,
    'Номера поездов, рейсы и точное время не подтверждены. Около 14:00 в Москве — ориентир для подбора, а не купленная стыковка.', '',
    'ПРОГРАММА', ...days.flatMap((day) => [`${day.day} февраля (${day.weekday}). ${day.title}`, ...day.periods.map((p) => `  ${p.time}: ${p.text}`), `  Учесть: ${day.note}`, '']),
    `${trip.homeDateLabel}. Утро: дома в Воронеже.`, '',
    'БЮДЖЕТ НА ЧЕЛОВЕКА', ...plan.rows.map((row) => `${row.label}: ${rub(row.amount)}`),
    `Итого на человека: ${rub(plan.perPerson)}`, `На четверых: ${rub(plan.perPerson * trip.people)}`, '',
    'Базовая смета сохранена на уровне 105 000 ₽: жильё на 8 ночей — 13 500 ₽, еда и вода на 9 дней — 7 200 ₽. Освободившиеся 2 300 ₽ перенесены в резерв: теперь 5 100 ₽.',
    'Самые чувствительные статьи — авиабилеты и жильё. Все суммы ориентировочные.',
    includeSouvenirs ? 'В этом расчёте сувениры включены: 5 000 ₽ на человека.' : 'Сувениры и личные покупки дополнительно: ориентир 3–7 тысяч ₽ на человека.',
    'Рейс Луксор → Каир, автобус и отели на наши даты ещё не подтверждены.',
    'Сбор за визу на февраль 2027 уточнить; в исходной смете заложено 2 700 ₽.',
    'Рамадан ожидается около 8 февраля; официальная дата и часы работы будут уточнены.',
    `День пирамид и GEM плотный: музей можно перенести на ${Number(freeDay.day)} февраля.`,
    'Сафари — вместо морской экскурсии либо отдельно при подходящих времени и цене; обе активности не обещаны за базовые 4 000 ₽.', '',
    'ИСТОЧНИКИ ДЛЯ ПРОВЕРКИ', ...SOURCES.map((source) => `${source.name}: ${source.url}`), '',
    `План подготовлен ${trip.updated}.`,
  ].join('\n');
}
