import { VARIANTS, DEFAULT_VARIANT, getItinerary, BUDGET_GROUPS, PRICE_CATEGORIES, USEFUL, SOURCES } from './data.js';
import { computeBudget, convertPrice, makeCalendar, makePlan, rub, number } from './logic.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const photo = (name) => `./assets/images/${name}`;
const requestedVariant = () => new URLSearchParams(window.location.search).get('dates');
const validVariant = (id) => VARIANTS.some((variant) => variant.id === id) ? id : DEFAULT_VARIANT;
const state = { variantId: validVariant(requestedVariant()), people: 1, flightExtra: 0, includeSouvenirs: false, day: 0, stop: null, priceCategory: 'food', rates: { EGP: 1.6, USD: 90 } };
let { trip: TRIP, cities: CITIES, stops: STOPS, days: DAYS } = getItinerary(state.variantId);
const dateLabel = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let routeMap;
let markers = new Map();

// Photos and city copy stay local; all amounts are derived from the same data.
function renderCities() {
  $('#city-cards').innerHTML = CITIES.map((city, index) => `
  <article class="city-card">
    <div class="city-image"><img src="${photo(city.id === 'luxor' ? 'karnak.webp' : city.image)}" alt="${escape(city.id === 'hurghada' ? 'Бирюзовое море и кораллы у Хургады' : city.id === 'luxor' ? 'Колонны Карнакского храма в Луксоре' : 'Рынок Хан-эль-Халили в Каире')}" width="1000" height="667" loading="lazy"><span class="city-number">0${index + 1}</span><span class="city-nights">${city.nights} ${city.nights === 1 ? 'ночь' : 'ночи'}</span></div>
    <div class="city-card-body"><span class="city-date">${escape(city.dates.toUpperCase())}</span><h3>${escape(city.name)}</h3><p>${escape(city.description)}</p><div class="city-card-bottom"><span>${escape(city.subtitle)}</span><button data-city="${city.id}" aria-label="Показать ${escape(city.name)} на карте"><svg class="icon-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg></button></div></div>
  </article>`).join('');
}
$('#city-cards').addEventListener('click', (event) => {
  const button = event.target.closest('[data-city]');
  if (!button) return;
  $('#route-map').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' });
  selectStop(button.dataset.city);
});

function selectStop(id) {
  const stop = STOPS.find((item) => item.id === id);
  if (!stop) return;
  state.stop = id;
  $$('#map-points button').forEach((button) => { const active = button.dataset.stop === id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#map-description').textContent = `${stop.name} · ${stop.dates}. ${stop.description}`;
  if (routeMap) {
    const zoom = ['giza', 'gem'].includes(id) ? 14 : id === 'cairo' ? 11 : 10;
    routeMap.setView(stop.coordinates, zoom, { animate: !reducedMotion });
    const marker = markers.get(id);
    if (marker) { if (!routeMap.hasLayer(marker)) marker.addTo(routeMap); marker.openPopup(); }
  }
}
$('#map-points').innerHTML = STOPS.map((stop, index) => `<button data-stop="${stop.id}" aria-pressed="false" aria-label="Показать ${escape(stop.name)}">${index + 1}. ${escape(stop.id === 'giza' ? 'Гиза' : stop.id === 'gem' ? 'GEM' : stop.name)}</button>`).join('');
$$('#map-points button').forEach((button) => button.addEventListener('click', () => selectStop(button.dataset.stop)));

function initMap() {
  if (!window.L) { $('#map-description').textContent = 'Карта недоступна. Выбери точку ниже: описание маршрута работает без карты.'; return; }
  const L = window.L;
  routeMap = L.map('route-map', { scrollWheelZoom: false, zoomControl: false, minZoom: 5, maxZoom: 17, attributionControl: true });
  L.control.zoom({ zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(routeMap);
  const bounds = L.latLngBounds([[25.15, 30.75], [30.5, 34.4]]);
  routeMap.fitBounds(bounds, { padding: [27, 27] });
  const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>', crossOrigin: true }).addTo(routeMap);
  let loaded = 0, failed = 0;
  tileLayer.on('tileload', () => { loaded++; $('#map-offline-note')?.remove(); });
  tileLayer.on('tileerror', () => {
    failed++;
    if (loaded === 0 && failed >= 3 && !$('#map-offline-note')) {
      const note = document.createElement('div'); note.id = 'map-offline-note'; note.className = 'map-error'; note.textContent = 'Фон карты не загрузился. Точки и описания доступны; для подробной карты нужен интернет.'; $('#route-map').append(note);
    }
  });
  const primary = STOPS.slice(0, 3);
  L.polyline([primary[0].coordinates, [26.74, 33.91], [26.16, 32.73], primary[1].coordinates], { color: '#c76840', weight: 3, opacity: .9 }).addTo(routeMap);
  L.polyline([primary[1].coordinates, [27.8, 31.4], primary[2].coordinates], { color: '#2d5b64', weight: 2.5, dashArray: '7 7' }).addTo(routeMap);
  L.polyline([[31.4, 34.7], primary[0].coordinates], { color: '#797f6b', weight: 1.5, dashArray: '4 7', opacity: .65 }).addTo(routeMap);
  L.polyline([primary[2].coordinates, [32.4, 31.75]], { color: '#797f6b', weight: 1.5, dashArray: '4 7', opacity: .65 }).addTo(routeMap);
  const routeLabels = [
    [[26.4, 33.08], '↓ 4–6 ч'], [[28.13, 31.38], '↑ перелёт'], [[30.9, 34.3], 'из Москвы ↓'], [[31, 31.15], '↑ в Москву'],
  ].map(([coordinates, text]) => L.marker(coordinates, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: `<span class="map-route-label">${text}</span>`, iconSize: [80, 20], iconAnchor: [40, 10] }) }).addTo(routeMap));
  STOPS.forEach((stop, index) => {
    const poi = index > 2;
    const marker = L.marker(stop.coordinates, { title: stop.name, alt: `Точка ${index + 1}: ${stop.name}`, keyboard: true, icon: L.divIcon({ className: '', html: `<span class="map-marker${poi ? ' poi' : ''}">${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
    marker.bindPopup(`<strong>${escape(stop.name)}</strong>${escape(stop.dates)}<br>${escape(stop.description)}`);
    if (!poi) marker.bindTooltip(stop.name, { permanent: true, direction: stop.id === 'hurghada' ? 'right' : 'left', offset: stop.id === 'hurghada' ? [13, 0] : [-13, 0], className: 'map-tooltip' });
    marker.on('click', () => { const current = STOPS.find((item) => item.id === stop.id); state.stop = current.id; $('#map-description').textContent = `${current.name} · ${current.dates}. ${current.description}`; $$('#map-points button').forEach((b) => { const active = b.dataset.stop === current.id; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }); });
    marker.on('add', () => { marker.getElement()?.setAttribute('aria-label', stop.name); });
    markers.set(stop.id, marker);
    if (!poi) marker.addTo(routeMap);
  });
  routeMap.on('zoomend', () => {
    const detail = routeMap.getZoom() >= 10;
    for (const id of ['giza', 'gem']) { const marker = markers.get(id); if (detail) marker.addTo(routeMap); else routeMap.removeLayer(marker); }
    routeLabels.forEach((label) => { if (detail) routeMap.removeLayer(label); else label.addTo(routeMap); });
  });
  $('#reset-map').addEventListener('click', () => { state.stop = null; routeMap.closePopup(); routeMap.fitBounds(bounds, { padding: [27, 27], animate: !reducedMotion }); $$('#map-points button').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }); $('#map-description').textContent = 'Хургада → Луксор → Каир. Гиза и GEM находятся рядом с Каиром: выбери их, чтобы приблизить.'; });
  new ResizeObserver(() => routeMap.invalidateSize({ animate: false })).observe($('#route-map'));
}
// Module scripts and the local Leaflet script may complete in either order.
if (document.readyState === 'complete') initMap(); else window.addEventListener('load', initMap, { once: true });

function renderDayTabs() {
  $('#day-tabs').innerHTML = DAYS.map((day, index) => `<button id="day-tab-${index}" class="day-tab${index === state.day ? ' active' : ''}" role="tab" aria-selected="${index === state.day}" aria-controls="day-panel" tabindex="${index === state.day ? 0 : -1}" data-day="${index}"><span>${escape(day.weekday)}</span><b>${day.day}</b><small>${escape(CITIES.find((city) => city.id === day.cityId).name)}</small></button>`).join('');
}
function renderDay(index) {
  const day = DAYS[index]; state.day = index;
  const city = CITIES.find((item) => item.id === day.cityId);
  const dayPhoto = day.image;
  $$('#day-tabs button').forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; });
  $('#day-panel').setAttribute('aria-labelledby', `day-tab-${index}`);
  $('#day-panel').innerHTML = `<div class="day-image"><img src="${photo(dayPhoto)}" alt="${escape(day.alt || city.name)}" width="1000" height="667"><div class="day-image-badge"><b>${day.day}</b><span>ФЕВРАЛЯ</span></div><span class="day-image-caption">${escape(city.name.toUpperCase())} &nbsp; / &nbsp; ДЕНЬ ${index + 1}</span></div><div class="day-content"><span class="eyebrow">${escape(day.label)}</span><h3>${escape(day.title)}</h3><p class="day-description">${escape(day.description)}</p><ul class="day-periods">${day.periods.map((period) => `<li><b>${escape(period.time)}</b><span>${escape(period.text)}</span></li>`).join('')}</ul><details class="day-details"><summary>Детали и что учесть</summary><p>${escape(day.note)}</p></details><div class="day-tags">${day.tags.map((tag) => `<span>${escape(tag)}</span>`).join('')}</div></div>`;
}
$('#day-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-day]'); if (button) renderDay(Number(button.dataset.day)); });
function keyboardTabs(container, selector, activate) {
  container.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$(selector, container); const current = tabs.indexOf(document.activeElement); if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activate(tabs[next], next); tabs[next].focus({ preventScroll: true }); tabs[next].scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' });
  });
}
keyboardTabs($('#day-tabs'), 'button', (_, index) => renderDay(index));

function renderBudget() {
  const budget = computeBudget(state);
  $('#budget-total').innerHTML = `${number(budget.total)} <span>₽</span>`;
  $('#budget-total-label').textContent = state.people === 1 ? 'НА ОДНОГО ЧЕЛОВЕКА' : 'НА ВСЮ КОМПАНИЮ';
  $('#budget-column-title').textContent = state.people === 1 ? 'НА ЧЕЛОВЕКА' : 'НА ЧЕТВЕРЫХ';
  $('#budget-subtotal').textContent = state.people === 1 ? `${rub(budget.perPerson * TRIP.people)} на всю компанию` : `${rub(budget.perPerson)} на человека`;
  $('#budget-table-total').textContent = rub(budget.total);
  $('#budget-rows').innerHTML = budget.rows.map((row) => `<div class="budget-row${row.extra ? ' extra' : ''}"><span><i class="legend-swatch" style="background:${BUDGET_GROUPS.find((group) => group.id === row.group).color}"></i>${escape(row.label)}</span><span>${rub(row.amount)}</span></div>`).join('');
  $('#budget-legend').innerHTML = budget.groups.map((group) => `<li><span><i class="legend-swatch" style="background:${group.color}"></i>${escape(group.label)}</span><b>${Math.round(group.amount / budget.total * 100)}%</b></li>`).join('');
  let start = 0;
  const stops = budget.groups.map((group) => { const end = start + group.amount / budget.total * 100; const stop = `${group.color} ${start}% ${end}%`; start = end; return stop; });
  $('#budget-chart').style.background = `conic-gradient(${stops.join(',')})`;
  $('#budget-chart').setAttribute('aria-label', budget.groups.map((group) => `${group.label}: ${rub(group.amount)}`).join('; '));
  $('#flight-extra-label').textContent = `+${rub(state.flightExtra)} / чел.`;
  $$('[data-people]').forEach((button) => { const active = Number(button.dataset.people) === state.people; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
$$('[data-people]').forEach((button) => button.addEventListener('click', () => { state.people = Number(button.dataset.people); renderBudget(); }));
$('#flight-extra').addEventListener('input', (event) => { state.flightExtra = Number(event.target.value); renderBudget(); });
$('#souvenirs').addEventListener('change', (event) => { state.includeSouvenirs = event.target.checked; renderBudget(); }); renderBudget();

$('#price-tabs').innerHTML = PRICE_CATEGORIES.map((category, index) => `<button id="price-tab-${category.id}" role="tab" aria-controls="price-panel" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-category="${category.id}"${index === 0 ? ' class="active"' : ''}>${escape(category.label)}</button>`).join('');
const rangeText = (min, max) => min === max ? number(min) : `${number(min)}–${number(max)}`;
function renderPrices() {
  const category = PRICE_CATEGORIES.find((item) => item.id === state.priceCategory);
  $('#price-panel').setAttribute('aria-labelledby', `price-tab-${category.id}`);
  $('#price-rows').innerHTML = category.items.map((item) => { const converted = convertPrice(item, state.rates); return `<tr><td>${escape(item.name)}</td><td>${rangeText(item.min, item.max)} ${item.currency === 'RUB' ? '₽' : item.currency}</td><td>≈ ${rangeText(converted.min, converted.max)} ₽</td></tr>`; }).join('');
  $('#price-note').textContent = category.note;
  $$('#price-tabs button').forEach((button) => { const active = button.dataset.category === state.priceCategory; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
}
$$('#price-tabs button').forEach((button) => button.addEventListener('click', () => { state.priceCategory = button.dataset.category; renderPrices(); }));
keyboardTabs($('#price-tabs'), 'button', (button) => { state.priceCategory = button.dataset.category; renderPrices(); });
for (const [id, currency] of [['egp-rate', 'EGP'], ['usd-rate', 'USD']]) {
  const input = $(`#${id}`);
  input.addEventListener('input', () => {
    const rate = Number(input.value);
    if (input.value && input.validity.valid && Number.isFinite(rate) && rate > 0) { input.setAttribute('aria-invalid', 'false'); state.rates[currency] = rate; renderPrices(); }
    else { input.setAttribute('aria-invalid', 'true'); }
  });
  input.addEventListener('change', () => { if (input.getAttribute('aria-invalid') === 'true') { input.value = state.rates[currency]; input.setAttribute('aria-invalid', 'false'); toast('Введите положительный курс в указанном диапазоне.'); } });
}
renderPrices();

function renderStay() {
  $('#stay-cards').innerHTML = CITIES.map((city, index) => `<article class="stay-card"><span>0${index + 1}</span><div><h3>${escape(city.name)} <small>${city.nights} ${city.nights === 1 ? 'ночь' : 'ночи'}</small></h3><p>${escape(city.stay)}</p>${city.id === 'hurghada' ? '<p class="stay-mini">Для трёх ночей отдельно сравним завтрак и «всё включено»: доплату проверяем по выбранным датам и условиям отеля.</p>' : ''}</div></article>`).join('');
}
$('#guide-accordions').innerHTML = USEFUL.filter((item) => item.id !== 'weather').map((item, index) => `<details class="guide-item"><summary><span class="guide-number">0${index + 1}</span><span><strong>${escape(item.title)}</strong><small>${escape(item.summary)}</small></span><span class="guide-toggle" aria-hidden="true">+</span></summary><div class="guide-body">${item.paragraphs.map((paragraph) => `<p>${escape(paragraph)}</p>`).join('')}<div class="guide-links">${(item.links || []).map((link) => `<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}</div></div></details>`).join('');
$('#sources').innerHTML = SOURCES.map((source) => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.name)} ↗</a>${source.note ? ` — ${escape(source.note)}` : ''}</li>`).join('');
$('#photo-credits').innerHTML = 'Фотографии: Matthew Stephenson, Shashi Ghosh, Bahaa Mourad, Fatih Beki, Thales Botelho de Sousa и другие авторы на Unsplash. <a href="./photo-credits.html" target="_blank" rel="noopener noreferrer">Все авторы и лицензии ↗</a>';

const menu = $('.menu-toggle');
function closeMenu() { $('#mobile-nav').hidden = true; menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'Открыть меню'); }
menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; $('#mobile-nav').hidden = !open; menu.setAttribute('aria-expanded', String(open)); menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню'); });
$$('#mobile-nav a').forEach((link) => link.addEventListener('click', closeMenu));
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#mobile-nav').hidden) { closeMenu(); menu.focus(); } });
window.matchMedia('(min-width: 641px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
$('#download-calendar').addEventListener('click', () => { download(makeCalendar(state.variantId), `egypt-2027-${state.variantId}.ics`, 'text/calendar;charset=utf-8'); toast(`Календарь: ${TRIP.label} и возвращение домой ${TRIP.homeDateLabel}.`); });
$('#download-plan').addEventListener('click', () => { download('\ufeff' + makePlan(state), `egypt-2027-${state.variantId}-plan.txt`, 'text/plain;charset=utf-8'); toast('План скачан с выбранными датами и бюджетом.'); });
const shareDialog = $('#share-dialog');
function shareUrl() { const url = new URL(window.location.href); url.hash = ''; url.search = ''; url.searchParams.set('dates', state.variantId); return url.href; }
$('#share-trip').addEventListener('click', async () => {
  const url = shareUrl();
  if (navigator.share) {
    try { await navigator.share({ title: 'Египет 2027 — одно большое приключение', text: `${TRIP.label}: Хургада, Луксор, Каир. В Воронеже — утром ${TRIP.homeDateLabel}. Поехали вчетвером?`, url }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  $('#share-url').value = url; shareDialog.showModal();
});
$('#close-share').addEventListener('click', () => shareDialog.close());
shareDialog.addEventListener('click', (event) => { const box = shareDialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) shareDialog.close(); });
$('#copy-share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#share-url').value); toast('Ссылка скопирована.'); shareDialog.close(); }
  catch { $('#share-url').focus(); $('#share-url').select(); toast('Ссылка выделена: скопируй её сочетанием ⌘C или Ctrl+C.'); }
});

function renderTravel() {
  $('#hero-trip-dates').textContent = TRIP.longLabel;
  $('#final-trip-dates').textContent = TRIP.longLabel.toUpperCase();
  $('#schedule-home-note').textContent = `В Воронеже — утром ${TRIP.homeDateLabel}`;
  $('#variant-summary').innerHTML = `${escape(TRIP.label)} — 9 дней и 8 ночей в Египте.<br>Дома в Воронеже — утром ${escape(TRIP.homeDateLabel)}.`;
  $('#final-home-note').textContent = `В Москву — вечером ${TRIP.returnDateLabel}, в Воронеж — утром ${TRIP.homeDateLabel}.`;
  const luxor = CITIES.find((city) => city.id === 'luxor');
  $('#route-transfer').textContent = `Хургада → Луксор: закладываем 4–6 часов на автобус или трансфер ${dateLabel(luxor.arrivalDate)}. Вечером ${dateLabel(luxor.departureDate)} планируем перелёт в Каир.`;
  const legs = [
    { date: `${TRIP.departureDateLabel} · утро`, title: 'Воронеж → Москва', text: 'Утром выезжаем на сидячем поезде. Планируем прибыть в Москву около 14:00.' },
    { date: `${TRIP.departureDateLabel} · после поезда`, title: 'Москва → Хургада', text: 'Подбираем вылет во второй половине дня или вечером, с достаточным запасом после приезда в Москву.' },
    { date: `${TRIP.returnDateLabel} · вечер`, title: 'Каир → Москва', text: `Ищем рейс с прилётом в Москву именно вечером ${TRIP.returnDateLabel}, чтобы затем уехать домой.` },
    { date: `Ночь ${Number(TRIP.end.slice(-2))} → ${TRIP.homeDateLabel}`, title: 'Москва → Воронеж', text: `После прилёта — на ночной поезд. В Воронеже планируем быть утром ${TRIP.homeDateLabel}.` },
  ];
  $('#travel-legs').innerHTML = legs.map((leg, index) => `<article class="travel-leg"><span class="travel-leg-index">0${index + 1}</span><span class="travel-leg-date">${escape(leg.date)}</span><h3>${escape(leg.title)}</h3><p>${escape(leg.text)}</p></article>`).join('');
}

function selectVariant(id, updateUrl = true) {
  state.variantId = validVariant(id);
  ({ trip: TRIP, cities: CITIES, stops: STOPS, days: DAYS } = getItinerary(state.variantId));
  state.day = Math.min(state.day, DAYS.length - 1);
  $$('[data-variant]').forEach((button) => { const active = button.dataset.variant === state.variantId; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  renderCities(); renderTravel(); renderDayTabs(); renderDay(state.day); renderStay();
  for (const stop of STOPS) markers.get(stop.id)?.setPopupContent(`<strong>${escape(stop.name)}</strong>${escape(stop.dates)}<br>${escape(stop.description)}`);
  if (state.stop) { const stop = STOPS.find((item) => item.id === state.stop); $('#map-description').textContent = `${stop.name} · ${stop.dates}. ${stop.description}`; }
  if (updateUrl) { const url = new URL(window.location.href); url.searchParams.set('dates', state.variantId); window.history.replaceState(null, '', url); }
}
$$('[data-variant]').forEach((button) => button.addEventListener('click', () => selectVariant(button.dataset.variant)));
window.addEventListener('popstate', () => selectVariant(requestedVariant(), false));
selectVariant(state.variantId, false);

// Show content even when motion APIs are unavailable or reduced motion is on.
if ('IntersectionObserver' in window && !reducedMotion) {
  document.documentElement.classList.add('js');
  const observer = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }, { threshold: .07, rootMargin: '0px 0px 15px 0px' });
  $$('.reveal').forEach((element) => observer.observe(element));
}
