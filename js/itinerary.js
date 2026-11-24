import { minutesToStr, strToMinutes, formatCurrency } from './timeUtils.js';
import { updateTrip, supabase, useSupabase } from './storage.js';
import { currentUser } from './auth.js';
import { playClick, playSuccess } from './audio.js';
import { switchView } from './ui.js';

export let activeTrip = null;
export let activeDayId = null;
export let activeUserRole = 'viewer'; 
export let isTripMember = false;
export function clearActiveTrip(){activeTrip=null;activeDayId=null;previewDayId=null;isTripMember=false;activeUserRole='viewer'}
let editingActivityId = null;
let previewDayId = null;
let itineraryMap = null;
let activePreviewPlaces = [];
let itineraryMapLayers = null;
let mapRenderSequence = 0;
let leafletLoad = null;
let lastGeocodeAt = 0;
let selectedMapPin = null;
const geocodeCache = new Map();
const routeCache = new Map();

const TRANSIT_ICONS = { car: '🚗', bus: '🚌', train: '🚆', plane: '✈️', bike: '🚲', walk: '🚶' };
const MAP_SERVICES = Object.assign({
  tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  geocoder: 'https://nominatim.openstreetmap.org/search',
  router: 'https://router.project-osrm.org/route/v1/driving'
}, window.LAKBAY_MAP_SERVICES || {});

const DOM = {
  daysList: document.getElementById('days-list'), daysTripTitle: document.getElementById('days-trip-title'),
  addDayBtn: document.getElementById('add-day-btn'), dayModalBg: document.getElementById('day-backdrop'),
  dayModal: document.getElementById('day-modal'), dayDateInp: document.getElementById('day-date-input'),
  dayTitleInp: document.getElementById('day-title-input'), saveDayBtn: document.getElementById('save-day-btn'),
  closeDayBtn: document.getElementById('close-day-btn'), itineraryContainer: document.getElementById('itinerary-container'),
  dayTitle: document.getElementById('day-title'), bg: document.getElementById('activity-backdrop'),
  modal: document.getElementById('activity-modal'), titleEl: document.getElementById('activity-modal-title'),
  typeVal: document.getElementById('act-type-val'), btnDest: document.getElementById('type-dest-btn'),
  btnTransit: document.getElementById('type-transit-btn'), transitModesCont: document.getElementById('transit-modes'),
  transitModeBtns: document.querySelectorAll('.transit-mode-btn'), transitVal: document.getElementById('act-transit-val'),
  titleInp: document.getElementById('act-title'), startInp: document.getElementById('act-start'),
  locationInp: document.getElementById('act-location'), locationSearchBtn: document.getElementById('act-location-search'),
  locationResults: document.getElementById('act-location-results'), locationClearBtn: document.getElementById('act-location-clear'),
  durInp: document.getElementById('act-duration'), costCont: document.getElementById('cost-container'),
  costInp: document.getElementById('act-cost'), btnSave: document.getElementById('save-act-btn'),
  btnDelete: document.getElementById('delete-act-btn'), btnClose: document.getElementById('close-act-btn'),
  addActBtn: document.getElementById('add-activity-btn')
};

document.addEventListener('lakbay:view-changed', event => {
  if (event.detail === 'days' || event.detail === 'day') window.setTimeout(() => {
    itineraryMap?.invalidateSize();
    if (event.detail === 'days' && activePreviewPlaces.length) void renderItineraryMap(activePreviewPlaces);
  }, 180);
});

export async function loadTripDays(trip) {
  if (activeTrip?.id !== trip.id) activeDayId = null;
  activeTrip = trip;
  if (!Array.isArray(activeTrip.expenses)) {
    activeTrip.expenses = Array.isArray(activeTrip.workspace_data?.expenses) ? activeTrip.workspace_data.expenses : [];
  }
  if (!activeTrip.workspace_data || typeof activeTrip.workspace_data !== 'object') activeTrip.workspace_data = {};
  if (!activeTrip.days) activeTrip.days = []; 
  DOM.daysTripTitle.textContent = trip.destination || 'Review stops and routes for each day.';
  const savedDay=localStorage.getItem(`lakbay_${trip.id}_preview_day`);
  if(savedDay&&activeTrip.days.some(day=>String(day.id)===savedDay))previewDayId=savedDay;
  if (!activeTrip.days.some(day => String(day.id) === String(previewDayId))) previewDayId = activeTrip.days[0]?.id || null;
  if(previewDayId)localStorage.setItem(`lakbay_${trip.id}_preview_day`,String(previewDayId));
  
  activeUserRole = 'viewer';
  isTripMember = false;
  if (!useSupabase) {
    activeUserRole = 'owner';
    isTripMember = true;
  } else if (currentUser) {
    if (activeTrip.owner_id === currentUser.id) {
      activeUserRole = 'owner';
      isTripMember = true;
    } else {
      const { data } = await supabase.from('trip_members').select('role').eq('trip_id', activeTrip.id).eq('user_id', currentUser.id).maybeSingle();
      if (data?.role) { activeUserRole = data.role; isTripMember = true; }
    }
  }

  const canEdit = activeUserRole !== 'viewer';
  DOM.addDayBtn.style.display = canEdit ? 'block' : 'none';
  DOM.addActBtn.style.display = canEdit ? 'block' : 'none';
  document.getElementById('share-trip-btn').style.display = (activeUserRole === 'owner') ? 'inline-flex' : 'none';

  setupDayManager();
  renderDaysList();
}

function setupDayManager() {
  DOM.addDayBtn.onclick = () => {
    if (activeUserRole === 'viewer') return;
    playClick(); DOM.dayDateInp.value = ''; DOM.dayTitleInp.value = '';
    DOM.dayModalBg.classList.remove('hidden'); DOM.dayDateInp.focus();
  };
  const closeDay = () => { playClick(); DOM.dayModalBg.classList.add('hidden'); };
  DOM.closeDayBtn.onclick = closeDay;
  document.getElementById('cancel-day-btn').onclick = closeDay;
  DOM.dayModal.onsubmit = async event => {
    event.preventDefault();
    if (activeUserRole === 'viewer') return;
    const selectedDate = DOM.dayDateInp.value;
    if (!selectedDate) return alert("Please select a date for this itinerary.");
    if (activeTrip.days.some(d => d.date === selectedDate)) return alert("An itinerary already exists for this date.");

    const title = DOM.dayTitleInp.value.trim() || `Day ${activeTrip.days.length + 1}`;
    playSuccess();
    const day = { id: 'day-' + Date.now(), date: selectedDate, title, activities: [] };
    activeTrip.days.push(day); previewDayId = day.id; localStorage.setItem(`lakbay_${activeTrip.id}_preview_day`,String(day.id));
    activeTrip.days.sort((a, b) => new Date(a.date) - new Date(b.date));
    await updateTrip(activeTrip); DOM.dayModalBg.classList.add('hidden'); DOM.dayModal.reset(); renderDaysList();
  };
  DOM.daysList.onclick = event => {
    const edit = event.target.closest('[data-edit-day]');
    if (edit) { openDayEditor(edit.dataset.editDay); return; }
    const select = event.target.closest('[data-preview-day]');
    if (select) { previewDayId = select.dataset.previewDay; localStorage.setItem(`lakbay_${activeTrip.id}_preview_day`,String(previewDayId)); renderDaysList(); }
  };
  document.getElementById('edit-preview-day').onclick = () => { if (previewDayId) openDayEditor(previewDayId); };
  document.getElementById('preview-add-activity').onclick = () => {
    if (previewDayId) { activeDayId = previewDayId; openDayEditor(previewDayId); DOM.addActBtn.click(); }
  };
  DOM.locationSearchBtn.onclick = searchMapPin;
  DOM.locationInp.onkeydown = event => { if(event.key === 'Enter'){ event.preventDefault(); searchMapPin(); } };
  DOM.locationResults.onclick = event => {
    const choice = event.target.closest('[data-map-result]'); if (!choice) return;
    const result = JSON.parse(choice.dataset.mapResult);
    selectedMapPin = { name: result.name, lat: Number(result.lat), lon: Number(result.lon), osm_id: result.osm_id };
    DOM.locationInp.value = selectedMapPin.name; DOM.locationResults.innerHTML = ''; updatePinClearButton();
  };
  DOM.locationClearBtn.onclick = () => { selectedMapPin = null; DOM.locationInp.value = ''; DOM.locationResults.innerHTML = ''; updatePinClearButton(); };
}

function renderDaysList() {
  DOM.daysList.innerHTML = '';
  const canEdit = activeUserRole !== 'viewer';
  const count = activeTrip.days.length;
  document.getElementById('itinerary-day-count').textContent = String(count);

  if (activeTrip.days.length === 0) {
    DOM.daysList.innerHTML = `<div class="empty-note">No days added yet.</div>`;
    previewDayId = null;
    document.getElementById('preview-day-title').textContent = 'No itinerary yet';
    document.getElementById('preview-day-date').textContent = canEdit ? 'Add a day to start planning stops.' : 'The trip itinerary has no days yet.';
    document.getElementById('edit-preview-day').classList.add('hidden');
    document.getElementById('preview-add-activity').classList.add('hidden');
    document.getElementById('day-stops-preview').innerHTML = '';
    void renderItineraryMap([]);
    return;
  }

  activeTrip.days.forEach((day) => {
    const card = document.createElement('div');
    if(!day.activities) day.activities = [];
    let dests = 0; day.activities.forEach(a => { if(a.type === 'destination') dests++; });
    const displayDate = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    card.className = `day-selector-item${String(day.id) === String(previewDayId) ? ' is-selected' : ''}`;
    card.innerHTML = `<button type="button" class="day-selector-button" data-preview-day="${day.id}"><span class="day-selector-date">${displayDate}</span><strong>${escapeHTML(day.title || 'Trip day')}</strong><small>${dests} ${dests === 1 ? 'stop' : 'stops'} · ${(day.activities || []).length} activities</small></button>${canEdit ? `<button type="button" class="day-selector-edit" data-edit-day="${day.id}" aria-label="Edit ${escapeHTML(day.title || 'trip day')}">Edit</button>` : ''}`;
    DOM.daysList.appendChild(card);
  });
  const day = activeTrip.days.find(item => String(item.id) === String(previewDayId)) || activeTrip.days[0];
  previewDayId = day.id;
  renderDayPreview(day);
}

function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderDayPreview(day) {
  const canEdit = activeUserRole !== 'viewer';
  document.getElementById('preview-day-title').textContent = day.title || 'Trip day';
  document.getElementById('preview-day-date').textContent = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('edit-preview-day').classList.toggle('hidden', !canEdit);
  document.getElementById('preview-add-activity').classList.toggle('hidden', !canEdit);
  const stops = day.activities || [];
  let placeNumber = 0;
  const rows = stops.map(activity => {
    const time = minutesToStr(activity.startTime ?? 540);
    const isPlace = activity.type === 'destination';
    if (isPlace) placeNumber += 1;
    const hasPin = isPlace && activity.lat !== null && activity.lat !== undefined && activity.lat !== '' && activity.lon !== null && activity.lon !== undefined && activity.lon !== '' && Number.isFinite(Number(activity.lat)) && Number.isFinite(Number(activity.lon));
    const icon = isPlace ? '📍' : (TRANSIT_ICONS[activity.transitMode] || '🚌');
    return `<div class="preview-stop"><span class="preview-stop-index">${isPlace ? placeNumber : icon}</span><div><strong>${escapeHTML(activity.title || (isPlace ? 'Place' : 'Transit'))}</strong><small>${time}${activity.duration ? ` · ${activity.duration} min` : ''}${activity.location ? ` · ${escapeHTML(activity.location)}` : ''}</small></div>${isPlace && !hasPin && canEdit ? `<button type="button" class="light-button" data-pin-activity="${activity.id}">Add map pin</button>` : hasPin ? '<span class="pin-marked" title="Map pin added">●</span>' : ''}</div>`;
  }).join('');
  document.getElementById('day-stops-preview').innerHTML = rows || '<div class="empty-note">No stops or activities for this day.</div>';
  document.getElementById('day-stops-preview').onclick = event => {
    const pin = event.target.closest('[data-pin-activity]');
    if (pin) { openDayEditor(day.id); openEditModal(pin.dataset.pinActivity); }
  };
  void renderItineraryMap(stops.filter(activity => activity.type === 'destination' && activity.lat !== null && activity.lat !== undefined && activity.lat !== '' && activity.lon !== null && activity.lon !== undefined && activity.lon !== '' && Number.isFinite(Number(activity.lat)) && Number.isFinite(Number(activity.lon))));
}

function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoad) return leafletLoad;
  leafletLoad = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; css.dataset.leaflet = 'true'; document.head.append(css);
    }
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true;
    script.onload = () => resolve(window.L); script.onerror = () => reject(new Error('The map library could not be loaded.'));
    document.head.append(script);
  });
  return leafletLoad;
}

async function renderItineraryMap(places) {
  activePreviewPlaces=places||[];
  const sequence = ++mapRenderSequence;
  const host = document.getElementById('itinerary-map');
  if (!host) return;
  try {
    const L = await ensureLeaflet();
    if (sequence !== mapRenderSequence || !host.isConnected) return;
    if (!itineraryMap) {
      itineraryMap = L.map(host, { scrollWheelZoom: false }).setView([20, 0], 2);
      L.tileLayer(MAP_SERVICES.tiles, { maxZoom: 19, attribution: MAP_SERVICES.attribution }).addTo(itineraryMap);
      itineraryMapLayers = L.featureGroup().addTo(itineraryMap);
      window.setTimeout(() => itineraryMap?.invalidateSize(), 100);
    } else itineraryMap.invalidateSize();
    itineraryMapLayers.clearLayers();
    if (!places.length) {
      itineraryMap.setView([20, 0], 2);
      if (!host.querySelector('.map-empty-state')) host.insertAdjacentHTML('beforeend', '<div class="map-empty-state">Add map pins to destinations to show this day’s route.</div>');
      return;
    }
    host.querySelector('.map-empty-state')?.remove();
    const points = places.map((place, index) => {
      const latlng = [Number(place.lat), Number(place.lon)];
      L.marker(latlng).bindPopup(`<strong>${index + 1}. ${escapeHTML(place.title || 'Stop')}</strong>${place.location ? `<br>${escapeHTML(place.location)}` : ''}`).addTo(itineraryMapLayers);
      return latlng;
    });
    if (points.length > 1) {
      const coordinatePath = places.map(place => `${Number(place.lon)},${Number(place.lat)}`).join(';');
      try {
        let result = routeCache.get(coordinatePath);
        if (!result) {
          const response = await fetch(`${MAP_SERVICES.router}/${coordinatePath}?overview=full&geometries=geojson`);
          if (!response.ok) throw new Error('Route service unavailable.');
          result = await response.json(); routeCache.set(coordinatePath, result);
        }
        if (sequence !== mapRenderSequence) return;
        const geometry = result.routes?.[0]?.geometry;
        if (geometry) L.geoJSON(geometry, { style: { color: '#58a700', weight: 5, opacity: .82 } }).addTo(itineraryMapLayers);
        else L.polyline(points, { color: '#58a700', weight: 4, dashArray: '8 8' }).addTo(itineraryMapLayers);
      } catch { L.polyline(points, { color: '#58a700', weight: 4, dashArray: '8 8' }).addTo(itineraryMapLayers); }
    }
    if (sequence === mapRenderSequence) {
      const bounds=itineraryMapLayers.getBounds().pad(.18);
      requestAnimationFrame(()=>window.setTimeout(()=>{if(sequence===mapRenderSequence&&itineraryMap&&host.isConnected){itineraryMap.invalidateSize();itineraryMap.fitBounds(bounds,{maxZoom:15,animate:false})}},120));
    }
  } catch (error) {
    console.error('Could not load the itinerary map.', error);
    if (sequence === mapRenderSequence) host.innerHTML = '<div class="map-empty-state">Map unavailable. Try again when a connection is available.</div>';
  }
}

function openDayEditor(dayId) {
  activeDayId = dayId;
  previewDayId = dayId;
  if(activeTrip)localStorage.setItem(`lakbay_${activeTrip.id}_preview_day`,String(dayId));
  const day = activeTrip.days.find(d => d.id === dayId);
  DOM.dayTitle.textContent = day.title;
  renderDaysList();
  switchView('day'); recalculateTimes(); renderDay(DOM.itineraryContainer); setupActivityEditor(DOM.itineraryContainer);
}

async function recalculateTimes() {
  const day = activeTrip.days.find(d => d.id === activeDayId);
  if (!day || !day.activities || day.activities.length === 0) return;
  if(day.activities[0].startTime === undefined) day.activities[0].startTime = 540;

  for (let i = 1; i < day.activities.length; i++) {
    const prev = day.activities[i - 1];
    const prevEnd = prev.startTime + prev.duration;
    if(day.activities[i].startTime < prevEnd || !day.activities[i].manualTime) {
      day.activities[i].startTime = prevEnd; day.activities[i].manualTime = false; 
    }
  }
  await updateTrip(activeTrip);
}

function setupActivityEditor(container) {
  const setType = (type) => {
    playClick(); DOM.typeVal.value = type;
    if(type === 'destination') {
      DOM.btnDest.classList.add('active'); DOM.btnTransit.classList.remove('active');
      DOM.transitModesCont.classList.add('hidden'); DOM.costCont.classList.remove('hidden'); document.getElementById('destination-pin-fields').classList.remove('hidden');
    } else {
      DOM.btnTransit.classList.add('active'); DOM.btnDest.classList.remove('active');
      DOM.transitModesCont.classList.remove('hidden'); document.getElementById('destination-pin-fields').classList.add('hidden'); setTransitMode(DOM.transitVal.value || 'bus');
    }
  };
  DOM.btnDest.onclick = () => setType('destination'); DOM.btnTransit.onclick = () => setType('transit');

  const setTransitMode = (mode) => {
    DOM.transitVal.value = mode;
    DOM.transitModeBtns.forEach(btn => {
      btn.classList.toggle('is-selected', btn.dataset.mode === mode);
    });
    if(mode === 'walk' || mode === 'bike') DOM.costCont.classList.add('hidden');
    else DOM.costCont.classList.remove('hidden');
  };
  DOM.transitModeBtns.forEach(btn => btn.onclick = () => { playClick(); setTransitMode(btn.dataset.mode); });

  DOM.addActBtn.onclick = () => {
    if (activeUserRole === 'viewer') return;
    playClick(); editingActivityId = null; DOM.titleEl.textContent = "Add a stop"; DOM.btnDelete.classList.add('hidden');
    DOM.titleInp.value = ''; DOM.durInp.value = '60'; DOM.costInp.value = ''; DOM.locationInp.value = ''; DOM.locationResults.innerHTML = ''; selectedMapPin = null; updatePinClearButton();
    const day = activeTrip.days.find(d => d.id === activeDayId);
    let defStart = 540;
    if (day.activities.length > 0) { const last = day.activities[day.activities.length-1]; defStart = last.startTime + last.duration; }
    DOM.startInp.value = minutesToStr(defStart); setType('destination'); openActModal();
  };

  DOM.btnSave.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    const title = DOM.titleInp.value.trim();
    if(!title) return alert("Title is required");
    const day = activeTrip.days.find(d => d.id === activeDayId);
    const dur = parseInt(DOM.durInp.value) || 60;
    const type = DOM.typeVal.value; const transitMode = DOM.transitVal.value;
    const isFreeMode = type === 'transit' && (transitMode === 'walk' || transitMode === 'bike');
    const cost = isFreeMode ? 0 : (parseInt(DOM.costInp.value) || 0);
    const inputTime = strToMinutes(DOM.startInp.value);

    if (editingActivityId) {
      const act = day.activities.find(a => a.id === editingActivityId);
      if(act.startTime !== inputTime) act.manualTime = true; 
      act.title = title; act.duration = dur; act.cost = cost; act.type = type; act.startTime = inputTime;
      if(type === 'transit') { act.transitMode = transitMode; delete act.location; delete act.lat; delete act.lon; delete act.osm_id; }
      else if(selectedMapPin) Object.assign(act, { location: selectedMapPin.name, lat: selectedMapPin.lat, lon: selectedMapPin.lon, osm_id: selectedMapPin.osm_id });
      else if(DOM.locationInp.value.trim()) { act.location = DOM.locationInp.value.trim(); delete act.lat; delete act.lon; delete act.osm_id; }
      else { delete act.location; delete act.lat; delete act.lon; delete act.osm_id; }
    } else {
      const activity = { id: 'act-' + Date.now(), type, title, duration: dur, cost, startTime: inputTime, manualTime: true, transitMode: type === 'transit' ? transitMode : null };
      if(type === 'destination' && selectedMapPin) Object.assign(activity, { location: selectedMapPin.name, lat: selectedMapPin.lat, lon: selectedMapPin.lon, osm_id: selectedMapPin.osm_id });
      else if(type === 'destination' && DOM.locationInp.value.trim()) activity.location = DOM.locationInp.value.trim();
      day.activities.push(activity);
    }
    day.activities.sort((a,b) => a.startTime - b.startTime);
    playSuccess(); closeActModal(); await recalculateTimes(); renderDay(DOM.itineraryContainer); renderDaysList();
  };

  DOM.btnDelete.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    if(confirm("Delete this activity?")) {
      playClick(); const day = activeTrip.days.find(d => d.id === activeDayId);
      day.activities = day.activities.filter(a => a.id !== editingActivityId);
      closeActModal(); await recalculateTimes(); renderDay(DOM.itineraryContainer); renderDaysList();
    }
  };
  DOM.btnClose.onclick = () => { playClick(); closeActModal(); };
  document.getElementById('close-act-x').onclick = DOM.btnClose.onclick;
  container.onclick = (e) => {
    if(e.target.closest('.drag-handle')) return; 
    const target = e.target.closest('.edit-act-target');
    if(target) { 
      if (activeUserRole === 'viewer') return;
      playClick(); openEditModal(target.dataset.id); 
    }
  };
}

function openEditModal(id) {
  editingActivityId = id; const day = activeTrip.days.find(d => d.id === activeDayId); const act = day.activities.find(a => a.id === id);
  DOM.titleEl.textContent = "Edit stop"; DOM.btnDelete.classList.remove('hidden');
  DOM.titleInp.value = act.title; DOM.durInp.value = act.duration; DOM.costInp.value = act.cost > 0 ? act.cost : ''; DOM.startInp.value = minutesToStr(act.startTime);
  selectedMapPin = act.lat !== null && act.lat !== undefined && act.lat !== '' && act.lon !== null && act.lon !== undefined && act.lon !== '' && Number.isFinite(Number(act.lat)) && Number.isFinite(Number(act.lon)) ? { name: act.location || act.title, lat: Number(act.lat), lon: Number(act.lon), osm_id: act.osm_id || null } : null;
  DOM.locationInp.value = selectedMapPin?.name || act.location || ''; DOM.locationResults.innerHTML = ''; updatePinClearButton();
  if(act.type === 'destination') DOM.btnDest.click();
  else { DOM.btnTransit.click(); DOM.transitModeBtns.forEach(b => { if(b.dataset.mode === (act.transitMode || 'bus')) b.click(); }); }
  openActModal();
}

function updatePinClearButton() { DOM.locationClearBtn.classList.toggle('hidden', !selectedMapPin); }

async function searchMapPin() {
  const query = DOM.locationInp.value.trim();
  if (!query) { DOM.locationResults.innerHTML = '<div class="map-search-message">Enter a place or address to search.</div>'; return; }
  const cacheKey = query.toLocaleLowerCase();
  let results = geocodeCache.get(cacheKey);
  if (!results) {
    try {
      const cached = JSON.parse(localStorage.getItem(`lakbay_map_search_${encodeURIComponent(cacheKey)}`) || 'null');
      if (cached?.savedAt && Date.now() - cached.savedAt < 30 * 86400000) results = cached.results;
    } catch { /* Ignore an invalid cached place search. */ }
  }
  if (!results) {
    DOM.locationSearchBtn.disabled = true; DOM.locationSearchBtn.textContent = 'Searching…';
    try {
      const delay = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastGeocodeAt = Date.now();
      const response = await fetch(`${MAP_SERVICES.geocoder}?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Place search failed (${response.status}).`);
      const data = await response.json();
      results = data.map(item => ({ name: item.display_name, lat: Number(item.lat), lon: Number(item.lon), osm_id: `${item.osm_type || ''}:${item.osm_id || ''}` }));
      geocodeCache.set(cacheKey, results);
      try { localStorage.setItem(`lakbay_map_search_${encodeURIComponent(cacheKey)}`, JSON.stringify({ savedAt: Date.now(), results })); } catch { /* Cache is optional when local storage is full. */ }
    } catch (error) {
      console.error('Could not search for a map pin.', error);
      DOM.locationResults.innerHTML = '<div class="map-search-message">Place search is unavailable. Try again later.</div>';
      DOM.locationSearchBtn.disabled = false; DOM.locationSearchBtn.textContent = 'Search'; return;
    }
    DOM.locationSearchBtn.disabled = false; DOM.locationSearchBtn.textContent = 'Search';
  }
  DOM.locationResults.innerHTML = results.length ? results.map(result => `<button type="button" role="option" data-map-result='${JSON.stringify(result).replace(/'/g, '&#39;')}'><strong>${escapeHTML(result.name.split(',')[0])}</strong><small>${escapeHTML(result.name)}</small></button>`).join('') : '<div class="map-search-message">No matching places found.</div>';
}

function openActModal() { DOM.bg.classList.remove('hidden'); DOM.titleInp.focus(); }
function closeActModal() { DOM.bg.classList.add('hidden'); }

function handleDragDrop(container) {
  let draggedItemIndex = null;
  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.draggable-item'); if (!item) return;
    draggedItemIndex = parseInt(item.dataset.index); item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault(); const item = e.target.closest('.draggable-item');
    if (item && parseInt(item.dataset.index) !== draggedItemIndex) item.classList.add('drag-over');
  });
  container.addEventListener('dragleave', (e) => { const item = e.target.closest('.draggable-item'); if (item) item.classList.remove('drag-over'); });
  container.addEventListener('drop', async (e) => {
    e.preventDefault(); const dropTarget = e.target.closest('.draggable-item');
    container.querySelectorAll('.draggable-item').forEach(el => el.classList.remove('drag-over', 'dragging'));
    if (!dropTarget) return; const targetIndex = parseInt(dropTarget.dataset.index); if (draggedItemIndex === targetIndex) return;
    playClick(); const day = activeTrip.days.find(d => d.id === activeDayId);
    const itemToMove = day.activities.splice(draggedItemIndex, 1)[0];
    day.activities.splice(targetIndex, 0, itemToMove);
    itemToMove.manualTime = false; 
    await recalculateTimes(); renderDay(document.getElementById('itinerary-container')); renderDaysList();
  });
}

function renderDay(container) {
  const day = activeTrip.days.find(d => d.id === activeDayId);
  const canEdit = activeUserRole !== 'viewer';
  
  if (!day || !day.activities || day.activities.length === 0) {
    container.innerHTML = `<div class="day-editor-empty"><span class="day-editor-empty-icon">⌖</span><h2>No activities planned</h2>${canEdit ? '<p>Add a stop or transit segment to this day.</p><button type="button" class="action-button" data-empty-add-stop>＋ Add stop</button>' : '<p>This day has no scheduled activities.</p>'}</div>`;
    return;
  }

  let html = `<div id="activity-list" class="activity-list">`;
  day.activities.forEach((act, index) => {
    const timeDisplay = minutesToStr(act.startTime);
    const dragAttr = canEdit ? `draggable="true"` : ``;
    const editClass = canEdit ? 'edit-act-target is-editable' : '';
    const dragIcon = canEdit ? '<button type="button" class="activity-drag-handle drag-handle" aria-label="Drag to reorder" tabindex="-1">⠿</button>' : '';

    if (act.type === 'destination') {
      html += `
        <article class="draggable-item destination-card ${editClass}" data-id="${act.id}" ${dragAttr} data-index="${index}">
          <div class="activity-time-column">
            <span class="activity-time${act.manualTime ? ' is-manual' : ''}">${timeDisplay}</span>
            <span class="activity-duration">${act.duration} min</span>
          </div>
          <div class="activity-copy">
            <h2>${escapeHTML(act.title)}</h2>
            ${act.location ? `<p class="destination-location">${escapeHTML(act.location)}</p>` : ''}
            ${act.cost > 0 ? `<p class="activity-cost">${formatCurrency(act.cost)}</p>` : ''}
          </div>
          ${dragIcon}
        </article>`;
    } else {
      const icon = TRANSIT_ICONS[act.transitMode] || '🚌';
      html += `
        <article class="draggable-item transit-card ${editClass}" data-id="${act.id}" ${dragAttr} data-index="${index}">
          <div class="transit-inner">
            <span class="transit-icon${canEdit ? ' drag-handle' : ''}" aria-hidden="true">${icon}</span>
            <div class="transit-copy"><strong>${escapeHTML(act.title)}</strong><span>${act.duration} min</span></div>
            ${act.cost > 0 ? `<span class="activity-cost">${formatCurrency(act.cost)}</span>` : ''}
          </div>
        </article>`;
    }
  });
  html += `</div>`; 
  container.innerHTML = html; 
  container.querySelector('[data-empty-add-stop]')?.addEventListener('click', () => document.getElementById('add-activity-btn')?.click());
  if (canEdit) handleDragDrop(document.getElementById('activity-list'));
}
