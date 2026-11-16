import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUDGET, CITIES, DAYS, DEFAULT_VARIANT, PRICE_CATEGORIES, STOPS, TRIP, VARIANTS, getItinerary } from '../dist/data.js';
import { computeBudget, convertPrice, makeCalendar, makePlan } from '../dist/logic.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'dist');
const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);
const compact = (text) => text.replace(/\s/g, '');
const plusDays = (date, amount) => new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
const calendarDate = (date) => date.replaceAll('-', '');
const dayText = (day) => [day.title, day.description, day.note, ...day.periods.flatMap((period) => [period.time, period.text])].join(' ');
const unfoldCalendar = (calendar) => calendar.replace(/\r\n[ \t]/g, '');
const calendarEvents = (calendar) => [...unfoldCalendar(calendar).matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map((match) => match[1]);
const calendarProperty = (event, property) => event.match(new RegExp(`(?:^|\\r\\n)${property}:([^\\r\\n]+)`))?.[1];
const itineraries = () => VARIANTS.map((variant) => getItinerary(variant.id));

const obsoleteCopy = [
  /6\s*[-–—]\s*15\s+феврал[яь]/iu,
  /6\s*[-–—]\s*15\.02(?:\.2027)?/u,
  /(?:10|десять)\s+(?:календарных\s+)?дн(?:ей|я)/iu,
  /(?:9|девять)\s+ноч(?:ей|и)/iu,
];
function assertCurrentCopy(text, source) {
  for (const expression of obsoleteCopy) assert.doesNotMatch(text, expression, `${source}: осталась предыдущая длительность поездки`);
}

test('Базовая смета на 8 ночей совпадает с 105 000 ₽ и 420 000 ₽', () => {
  assert.equal(sum(BUDGET), 105000);
  assert.equal(BUDGET.find((row) => row.id === 'hotels')?.amount, 13500);
  assert.equal(BUDGET.find((row) => row.id === 'meals')?.amount, 7200);
  assert.equal(BUDGET.find((row) => row.id === 'reserve')?.amount, 5100);
  assert.match(BUDGET.find((row) => row.id === 'hotels').label, /8\s+ночей/u);
  assert.equal(new Set(BUDGET.map((row) => row.id)).size, BUDGET.length);
  for (const { trip } of itineraries()) {
    assert.equal(trip.target, 105000);
    assert.equal(trip.people, 4);
  }
  const individual = computeBudget();
  const company = computeBudget({ people: 4 });
  assert.equal(individual.perPerson, 105000);
  assert.equal(individual.total, 105000);
  assert.equal(individual.people, 1);
  assert.equal(company.perPerson, 105000);
  assert.equal(company.total, 420000);
  assert.equal(company.people, 4);
  for (const baseRow of BUDGET) {
    assert.equal(company.rows.find((row) => row.id === baseRow.id)?.amount, baseRow.amount * 4, baseRow.label);
  }
});

test('Подорожание билетов и сувениры пересчитывают строки, итог и диаграмму', () => {
  const original = structuredClone(BUDGET);
  const cases = [
    { people: 1, flightExtra: 15000, includeSouvenirs: false, expected: 120000 },
    { people: 4, flightExtra: 15000, includeSouvenirs: false, expected: 480000 },
    { people: 1, flightExtra: 0, includeSouvenirs: true, expected: 110000 },
    { people: 4, flightExtra: 15000, includeSouvenirs: true, expected: 500000 },
  ];
  for (const { expected, ...options } of cases) {
    const result = computeBudget(options);
    assert.equal(result.total, expected);
    assert.equal(result.perPerson * options.people, expected);
    assert.equal(sum(result.rows), expected, 'Сумма строк должна равняться итогу');
    assert.equal(sum(result.groups), expected, 'Диаграмма должна отражать весь бюджет');
    for (const group of result.groups) {
      assert.equal(group.amount, sum(result.rows.filter((row) => row.group === group.id)), group.label);
    }
    assert.equal(result.groups.find((group) => group.id === 'flights').amount, (53000 + options.flightExtra) * options.people);
    assert.equal(result.groups.find((group) => group.id === 'other').amount, (9300 + (options.includeSouvenirs ? 5000 : 0)) * options.people);
  }
  assert.deepEqual(BUDGET, original, 'Переключатели не должны изменять исходную смету');
  assert.equal(computeBudget().total, 105000);
});

test('Неверные числа не превращаются в отрицательный бюджет или NaN', () => {
  for (const people of [0, 2, 3, -1, 1.5, NaN, Infinity, '4']) {
    assert.throws(() => computeBudget({ people }), RangeError);
  }
  for (const flightExtra of [-1, 15001, NaN, Infinity, -Infinity, '1000']) {
    assert.throws(() => computeBudget({ flightExtra }), RangeError);
  }
});

test('Местные цены переводятся в рубли по выбранному курсу', () => {
  assert.deepEqual(convertPrice({ min: 50, max: 120, currency: 'EGP' }), { min: 80, max: 192 });
  assert.deepEqual(convertPrice({ min: 3, max: 8, currency: 'USD' }), { min: 270, max: 720 });
  assert.deepEqual(convertPrice({ min: 310, max: 925, currency: 'RUB' }), { min: 310, max: 925 });
  assert.deepEqual(convertPrice({ min: 9, max: 15, currency: 'EGP' }, { EGP: 1.65, USD: 100 }), { min: 15, max: 25 });
  assert.deepEqual(convertPrice({ min: 1, max: 2, currency: 'USD' }, { EGP: 2, USD: 100 }), { min: 100, max: 200 });
  for (const rate of [0, -1, NaN, Infinity]) {
    assert.throws(() => convertPrice({ min: 50, max: 120, currency: 'EGP' }, { EGP: rate, USD: 90 }), RangeError);
    assert.throws(() => convertPrice({ min: 1, max: 2, currency: 'USD' }, { EGP: 1.6, USD: rate }), RangeError);
  }
  for (const category of PRICE_CATEGORIES) {
    for (const item of category.items) {
      assert.ok(Number.isFinite(item.min) && item.min >= 0 && item.max >= item.min, item.name);
      const converted = convertPrice(item);
      assert.ok(Number.isFinite(converted.min) && Number.isFinite(converted.max), item.name);
      assert.ok(converted.min <= converted.max, item.name);
    }
  }
});

test('Доступны ровно два варианта, основной — 6–14 февраля', () => {
  assert.deepEqual(VARIANTS.map((variant) => variant.id), ['6-14', '7-15']);
  assert.equal(DEFAULT_VARIANT, '6-14');
  const early = getItinerary();
  assert.deepEqual(early, getItinerary('6-14'));
  assert.deepEqual(TRIP, early.trip);
  assert.deepEqual(CITIES, early.cities);
  assert.deepEqual(STOPS, early.stops);
  assert.deepEqual(DAYS, early.days);
  assert.deepEqual(itineraries().map(({ trip }) => [trip.start, trip.end, trip.homeDate]), [
    ['2027-02-06', '2027-02-14', '2027-02-15'],
    ['2027-02-07', '2027-02-15', '2027-02-16'],
  ]);
});

test('Оба маршрута содержат 9 последовательных дней и 8 ночей: 3 + 1 + 4', () => {
  for (const { trip, days, cities } of itineraries()) {
    assert.equal(trip.days, 9, trip.id);
    assert.equal(trip.nights, 8, trip.id);
    assert.equal(days.length, 9);
    assert.equal(new Set(days.map((day) => day.date)).size, 9);
    for (let index = 0; index < days.length; index += 1) {
      const day = days[index];
      assert.equal(day.date, plusDays(trip.start, index));
      assert.equal(Number(day.day), Number(day.date.slice(-2)));
      const expectedWeekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`));
      assert.equal(day.weekday.toLowerCase(), expectedWeekday);
      assert.ok(day.title && day.kind && day.alt && day.periods.length, day.date);
      assert.ok(cities.some((city) => city.id === day.cityId), day.date);
    }
    assert.equal(days.at(-1).date, trip.end);
    assert.equal(plusDays(trip.end, 1), trip.homeDate);
    assert.equal(days.some((day) => day.date === trip.homeDate), false, 'Утро дома — отдельный день, не десятый день в Египте');
    assert.deepEqual(cities.map((city) => [city.id, city.nights]), [['hurghada', 3], ['luxor', 1], ['cairo', 4]]);
    assert.equal(cities.reduce((total, city) => total + city.nights, 0), 8);
    const nightDates = cities.flatMap((city) => city.nightDates);
    assert.deepEqual(nightDates, Array.from({ length: 8 }, (_, index) => plusDays(trip.start, index)), 'Все 8 ночей покрыты ровно один раз');
    assert.equal(new Set(nightDates).size, 8);
    for (let index = 0; index < cities.length; index += 1) {
      const city = cities[index];
      assert.equal(city.nightDates.length, city.nights, city.name);
      assert.equal(city.arrivalDate, city.nightDates[0]);
      assert.equal(city.departureDate, plusDays(city.arrivalDate, city.nights));
      if (index > 0) assert.equal(city.arrivalDate, cities[index - 1].departureDate, 'Между городами не должно быть пропавшей или лишней ночи');
    }
    assert.equal(cities[0].arrivalDate, trip.start);
    assert.equal(cities.at(-1).departureDate, trip.end);
  }
});

test('Второй вариант сдвигает все даты и ночи ровно на один день', () => {
  const early = getItinerary('6-14');
  const late = getItinerary('7-15');
  for (const field of ['start', 'end', 'homeDate']) assert.equal(late.trip[field], plusDays(early.trip[field], 1));
  early.days.forEach((day, index) => {
    assert.equal(late.days[index].date, plusDays(day.date, 1));
    assert.equal(late.days[index].kind, day.kind);
    assert.equal(late.days[index].cityId, day.cityId);
  });
  early.cities.forEach((city, index) => {
    const shifted = late.cities[index];
    assert.equal(shifted.id, city.id);
    assert.equal(shifted.nights, city.nights);
    assert.equal(shifted.arrivalDate, plusDays(city.arrivalDate, 1));
    assert.equal(shifted.departureDate, plusDays(city.departureDate, 1));
    assert.deepEqual(shifted.nightDates, city.nightDates.map((date) => plusDays(date, 1)));
  });
  early.stops.forEach((stop, index) => {
    const originalDays = [...stop.dates.matchAll(/\b\d{1,2}\b/g)].map((match) => Number(match[0]));
    const shiftedDays = [...late.stops[index].dates.matchAll(/\b\d{1,2}\b/g)].map((match) => Number(match[0]));
    assert.ok(originalDays.length > 0, stop.id);
    assert.equal(late.stops[index].id, stop.id);
    assert.deepEqual(shiftedDays, originalDays.map((day) => day + 1), `Дата точки карты ${stop.id} должна переключаться`);
  });
});

test('Переключение вариантов не изменяет исходный план и выбранную смету', () => {
  const baseline = getItinerary('6-14');
  const selectedBudget = computeBudget({ people: 4, flightExtra: 10000, includeSouvenirs: true });
  const edited = getItinerary('7-15');
  edited.days[0].periods[0].text = 'Изменено только в этой копии';
  edited.cities[0].nightDates.push('2027-02-20');
  assert.equal(getItinerary('7-15').cities[0].nightDates.length, 3);
  assert.notEqual(getItinerary('7-15').days[0].periods[0].text, edited.days[0].periods[0].text);
  assert.deepEqual(getItinerary('6-14'), baseline);
  assert.deepEqual(computeBudget({ people: 4, flightExtra: 10000, includeSouvenirs: true }), selectedBudget);
});

test('Первый и последний дни сохраняют оговорённые поездные и авиационные стыковки', () => {
  for (const { trip, days } of itineraries()) {
    const departure = dayText(days[0]);
    assert.match(departure, /Воронеж/iu);
    assert.match(departure, /сидяч/iu);
    assert.match(departure, /утр/iu);
    assert.match(departure, /14(?::00)?/u);
    assert.match(departure, /Москв/iu);
    assert.match(departure, /вечер/iu);
    assert.match(departure, /рейс|самол[её]т|перел[её]т/iu);
    const returnTrip = dayText(days.at(-1));
    assert.match(returnTrip, /Каир/iu);
    assert.match(returnTrip, /Москв/iu);
    assert.match(returnTrip, /вечер/iu);
    assert.match(returnTrip, /ночн/iu);
    assert.match(returnTrip, /поезд/iu);
    assert.match(returnTrip, /утр/iu);
    assert.match(returnTrip, /Воронеж/iu);
    assert.ok(returnTrip.includes(trip.homeDateLabel), trip.id);
    assert.match(departure + returnTrip, /не подтвержден|не подтверждён|подбираем|подбер[её]м|планируем/iu, 'Время и билеты не должны выглядеть подтверждённым бронированием');
  }
});

test('Карта содержит пять точек с датами выбранного маршрута', () => {
  for (const { cities, stops, days } of itineraries()) {
    assert.deepEqual(stops.map((stop) => stop.id).sort(), ['cairo', 'gem', 'giza', 'hurghada', 'luxor']);
    assert.equal(new Set(stops.map((stop) => stop.id)).size, 5);
    for (const stop of stops) {
      assert.equal(stop.coordinates.length, 2);
      const [latitude, longitude] = stop.coordinates;
      assert.ok(Number.isFinite(latitude) && latitude >= 22 && latitude <= 32, stop.name);
      assert.ok(Number.isFinite(longitude) && longitude >= 25 && longitude <= 37, stop.name);
      assert.ok(stop.name && stop.description && stop.dates);
      const city = cities.find((item) => item.id === stop.id);
      if (city) assert.equal(stop.dates, city.dates);
    }
    const gizaDay = days.find((day) => day.kind === 'giza');
    const freeDay = days.find((day) => day.kind === 'free');
    assert.equal(stops.find((stop) => stop.id === 'giza').dates, `${Number(gizaDay.day)} февраля`);
    assert.equal(stops.find((stop) => stop.id === 'gem').dates, `${Number(gizaDay.day)} или ${Number(freeDay.day)} февраля`);
  }
});

test('Календарь каждого варианта содержит 9 дней поездки и отдельное утро в Воронеже', () => {
  const allUids = [];
  for (const { trip, days } of itineraries()) {
    const calendar = makeCalendar(trip.id);
    assert.ok(calendar.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.match(calendar, /VERSION:2\.0\r\n/);
    assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
    assert.equal(calendar.replaceAll('\r\n', '').includes('\n'), false, 'RFC 5545 требует CRLF');
    for (const line of calendar.split('\r\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `Строка календаря длиннее 75 октетов: ${line}`);
      assert.equal(line.includes('\uFFFD'), false, 'Кириллица не должна повреждаться при переносах');
    }
    const events = calendarEvents(calendar);
    assert.equal(events.length, 10, trip.id);
    for (let index = 0; index < days.length; index += 1) {
      assert.equal(calendarProperty(events[index], 'DTSTART;VALUE=DATE'), calendarDate(days[index].date));
      assert.equal(calendarProperty(events[index], 'DTEND;VALUE=DATE'), calendarDate(plusDays(days[index].date, 1)));
      assert.ok(calendarProperty(events[index], 'SUMMARY'));
    }
    const home = events.at(-1);
    assert.equal(calendarProperty(home, 'DTSTART;VALUE=DATE'), calendarDate(trip.homeDate));
    assert.equal(calendarProperty(home, 'DTEND;VALUE=DATE'), trip.id === '6-14' ? '20270216' : '20270217');
    assert.match(home, /Воронеж/iu);
    assert.match(home, /утр/iu);
    const uids = events.map((event) => calendarProperty(event, 'UID'));
    for (const uid of uids) assert.ok(uid && uid.includes(trip.id), `UID должен различать выбранные даты: ${uid}`);
    assert.equal(new Set(uids).size, 10);
    assert.deepEqual(calendarEvents(makeCalendar(trip.id)).map((event) => calendarProperty(event, 'UID')), uids, 'Повторное скачивание должно сохранять UID событий');
    allUids.push(...uids);
    assertCurrentCopy(unfoldCalendar(calendar), `Календарь ${trip.id}`);
  }
  assert.equal(new Set(allUids).size, 20, 'Импорт двух вариантов не должен перезаписывать события другого варианта');
  assert.equal(makeCalendar(), makeCalendar(DEFAULT_VARIANT));
});

test('Скачиваемый план наследует выбранные даты, утро дома и настройки бюджета', () => {
  assert.equal(makePlan(), makePlan({ variantId: DEFAULT_VARIANT }));
  for (const { trip } of itineraries()) {
    for (const options of [
      { flightExtra: 0, includeSouvenirs: false },
      { flightExtra: 10000, includeSouvenirs: false },
      { flightExtra: 0, includeSouvenirs: true },
      { flightExtra: 15000, includeSouvenirs: true },
    ]) {
      const plan = makePlan({ variantId: trip.id, ...options });
      const expected = computeBudget(options);
      assert.ok(plan.includes(trip.longLabel), `План ${trip.id}: даты в заголовке`);
      assert.match(plan, /9\s+(?:календарных\s+)?дней/iu);
      assert.match(plan, /8\s+ночей/iu);
      assert.ok(plan.includes(trip.homeDateLabel), `План ${trip.id}: отдельное утро дома`);
      for (const city of ['Хургада', 'Луксор', 'Каир', 'Воронеж']) assert.ok(plan.includes(city));
      assert.ok(compact(plan).includes(String(expected.perPerson)), 'Личный бюджет сохраняется при выборе дат');
      assert.ok(compact(plan).includes(String(expected.perPerson * 4)), 'Общий бюджет сохраняется при выборе дат');
      assert.match(plan, /ориентир|предвар|не[^\n]*бронир/iu);
      assert.match(plan, /сидяч/iu);
      assert.match(plan, /14:00/u);
      assert.match(plan, /ночн[^\n]*поезд|поезд[^\n]*ноч/iu);
      if (options.includeSouvenirs) assert.match(plan, /сувенир[^\n]*включ|включ[^\n]*сувенир/iu);
      assertCurrentCopy(plan, `План ${trip.id}`);
    }
  }
});

test('В пользовательском тексте и логике не остался прежний вариант 6–15 февраля, 10 дней, 9 ночей', async () => {
  for (const { trip, cities, stops, days } of itineraries()) {
    assertCurrentCopy(JSON.stringify({ trip, cities, stops, days }), trip.id);
  }
  for (const path of ['dist/index.html', 'dist/photo-credits.html', 'dist/data.js', 'dist/logic.js', 'dist/app.js', 'package.json']) {
    const source = await readFile(resolve(projectRoot, path), 'utf8');
    const text = path.endsWith('.html') ? source.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ') : source;
    assertCurrentCopy(text, path);
  }
});

test('HTML-якоря и локальные ресурсы работают из подпапки GitHub Pages', async () => {
  const htmlFiles = (await readdir(publicRoot)).filter((file) => file.endsWith('.html'));
  assert.ok(htmlFiles.includes('index.html'));
  for (const htmlFile of htmlFiles) {
    const html = await readFile(resolve(publicRoot, htmlFile), 'utf8');
    assert.match(html, /<html\s+lang="ru"/);
    const ids = [...html.matchAll(/\sid\s*=\s*(["'])(.*?)\1/g)].map((match) => match[2]);
    assert.equal(new Set(ids).size, ids.length, `${htmlFile}: ID элементов должны быть уникальными`);
    const anchors = new Set(ids);
    const resourceAttributes = [...html.matchAll(/\s(?:src|href)\s*=\s*(["'])(.*?)\1/g)].map((match) => match[2]);
    for (const reference of resourceAttributes) {
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(reference)) continue;
      assert.ok(!reference.startsWith('/'), `${htmlFile}: абсолютный путь сломает подпапку GitHub Pages: ${reference}`);
      if (reference.startsWith('#')) {
        assert.ok(anchors.has(reference.slice(1)), `${htmlFile}: нет цели для ссылки ${reference}`);
        continue;
      }
      const pathname = decodeURIComponent(reference.split(/[?#]/)[0]);
      if (!pathname) continue;
      const info = await stat(resolve(publicRoot, pathname));
      assert.ok(info.isFile(), `${htmlFile}: не найден файл ${reference}`);
      const deployed = new URL(reference, `https://example.github.io/egypt-friends-2027/${htmlFile}`);
      assert.ok(deployed.pathname.startsWith('/egypt-friends-2027/'), `Путь вышел за подпапку проекта: ${reference}`);
    }
  }
  const images = new Set(itineraries().flatMap(({ cities, days }) => [...cities, ...days].map((item) => item.image)));
  for (const image of images) {
    const info = await stat(resolve(publicRoot, 'assets', 'images', image));
    assert.ok(info.isFile() && info.size > 0, `Изображение программы: ${image}`);
  }
  for (const filename of ['app.js', 'logic.js', 'data.js']) {
    const source = await readFile(resolve(publicRoot, filename), 'utf8');
    for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('./') || match[1].startsWith('../'), `${filename}: импорт должен работать без сборщика`);
      const imported = new URL(match[1], `https://example.github.io/egypt-friends-2027/${filename}`);
      assert.ok(imported.pathname.startsWith('/egypt-friends-2027/'), `${filename}: импорт вышел за подпапку проекта`);
      assert.ok((await stat(resolve(publicRoot, match[1]))).isFile());
    }
  }
});

test('Публикация настроена на GitHub Pages, прежний GitLab pipeline удалён', async () => {
  await assert.rejects(stat(resolve(projectRoot, '.gitlab-ci.yml')), { code: 'ENOENT' });
  const workflowsRoot = resolve(projectRoot, '.github', 'workflows');
  const files = (await readdir(workflowsRoot)).filter((file) => /\.ya?ml$/i.test(file));
  assert.ok(files.length > 0, 'Нужен workflow GitHub Actions');
  const workflows = await Promise.all(files.map((file) => readFile(resolve(workflowsRoot, file), 'utf8')));
  const pages = workflows.find((text) => /actions\/deploy-pages@/u.test(text));
  assert.ok(pages, 'Workflow должен публиковать статический сайт в Pages');
  assert.match(pages, /actions\/upload-pages-artifact@/u);
  assert.match(pages, /path:\s*['"]?(?:\.\/)?dist\/?['"]?\s*(?:\n|$)/u);
  assert.match(pages, /pages:\s*write/u);
  assert.match(pages, /id-token:\s*write/u);
  assert.match(pages, /workflow_dispatch\s*:/u);
});
