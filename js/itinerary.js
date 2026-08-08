import { minutesToStr, strToMinutes, formatCurrency } from './timeUtils.js';
import { updateTrip, supabase, useSupabase } from './storage.js';
import { currentUser } from './auth.js';
import { playClick, playSuccess } from './audio.js';
import { switchView } from './ui.js';

export let activeTrip = null;
export let activeDayId = null;
export let activeUserRole = 'viewer'; 
let editingActivityId = null;

const TRANSIT_ICONS = { car: '🚗', bus: '🚌', train: '🚆', plane: '✈️', bike: '🚲', walk: '🚶' };

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
  durInp: document.getElementById('act-duration'), costCont: document.getElementById('cost-container'),
  costInp: document.getElementById('act-cost'), btnSave: document.getElementById('save-act-btn'),
  btnDelete: document.getElementById('delete-act-btn'), btnClose: document.getElementById('close-act-btn'),
  addActBtn: document.getElementById('add-activity-btn')
};

export async function loadTripDays(trip) {
  activeTrip = trip;
  if (!activeTrip.days) activeTrip.days = []; 
  DOM.daysTripTitle.textContent = `${trip.emoji || '📍'} ${trip.destination}`;
  
  activeUserRole = 'viewer'; 
  if (!useSupabase) {
    activeUserRole = 'owner';
  } else if (currentUser) {
    if (activeTrip.owner_id === currentUser.id) {
      activeUserRole = 'owner';
    } else {
      const { data } = await supabase.from('trip_members').select('role').eq('trip_id', activeTrip.id).eq('user_id', currentUser.id).single();
      if (data && data.role) activeUserRole = data.role;
      else if (activeTrip.visibility === 'public_edit') activeUserRole = 'editor';
    }
  }

  const canEdit = activeUserRole !== 'viewer';
  DOM.addDayBtn.style.display = canEdit ? 'block' : 'none';
  DOM.addActBtn.style.display = canEdit ? 'block' : 'none';
  document.getElementById('share-trip-btn').style.display = (activeUserRole === 'owner') ? 'block' : 'none';

  setupDayManager();
  renderDaysList();
}

function setupDayManager() {
  DOM.addDayBtn.onclick = () => {
    if (activeUserRole === 'viewer') return;
    playClick(); DOM.dayDateInp.value = ''; DOM.dayTitleInp.value = '';
    DOM.dayModalBg.classList.remove('hidden'); setTimeout(() => DOM.dayModal.classList.remove('translate-y-full'), 10);
  };
  DOM.closeDayBtn.onclick = () => { playClick(); DOM.dayModal.classList.add('translate-y-full'); setTimeout(() => DOM.dayModalBg.classList.add('hidden'), 300); };
  DOM.saveDayBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    const selectedDate = DOM.dayDateInp.value;
    if (!selectedDate) return alert("Please select a date for this itinerary.");
    if (activeTrip.days.some(d => d.date === selectedDate)) return alert("An itinerary already exists for this date.");

    const title = DOM.dayTitleInp.value.trim() || `Day ${activeTrip.days.length + 1}`;
    playSuccess();
    activeTrip.days.push({ id: 'day-' + Date.now(), date: selectedDate, title, activities: [] });
    activeTrip.days.sort((a, b) => new Date(a.date) - new Date(b.date));
    await updateTrip(activeTrip); DOM.closeDayBtn.click(); renderDaysList();
  };
}

function renderDaysList() {
  DOM.daysList.innerHTML = '';
  const canEdit = activeUserRole !== 'viewer';

  if (activeTrip.days.length === 0) {
    DOM.daysList.innerHTML = `<div class="text-center py-12 bg-white rounded-2xl border-2 border-dashed border-gray-200"><h3 class="text-xl font-bold text-gray-400 mb-2">No days planned yet.</h3>${canEdit ? `<p class="text-sm text-gray-400">Click '+ Add Day' to start building.</p>` : ``}</div>`;
    return;
  }

  activeTrip.days.forEach((day) => {
    const card = document.createElement('div');
    card.className = 'day-card p-5 flex items-center justify-between mb-3';
    if(!day.activities) day.activities = [];
    let dests = 0; day.activities.forEach(a => { if(a.type === 'destination') dests++; });
    const displayDate = new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    card.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-16 h-16 bg-[#ddf4ff] rounded-xl flex flex-col items-center justify-center font-bold text-[#1cb0f6] shrink-0">
          <span class="text-xs uppercase">${new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <span class="text-xl leading-none">${new Date(day.date).getDate()}</span>
        </div>
        <div>
          <h3 class="font-extrabold text-xl text-[#4b4b4b]">${day.title}</h3>
          <p class="text-sm font-bold text-gray-400 mt-1">${displayDate} • ${dests} Places</p>
        </div>
      </div>`;
    card.onclick = () => { playClick(); openDayEditor(day.id); };
    DOM.daysList.appendChild(card);
  });
}

function openDayEditor(dayId) {
  activeDayId = dayId;
  const day = activeTrip.days.find(d => d.id === dayId);
  DOM.dayTitle.textContent = day.title;
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
      DOM.btnDest.className = "flex-1 py-2 font-bold rounded-lg bg-white shadow-sm text-[#1cb0f6] transition-all";
      DOM.btnTransit.className = "flex-1 py-2 font-bold rounded-lg text-gray-400 hover:text-gray-600 transition-all bg-transparent";
      DOM.transitModesCont.classList.add('hidden'); DOM.costCont.classList.remove('hidden');
    } else {
      DOM.btnTransit.className = "flex-1 py-2 font-bold rounded-lg bg-white shadow-sm text-[#58cc02] transition-all";
      DOM.btnDest.className = "flex-1 py-2 font-bold rounded-lg text-gray-400 hover:text-gray-600 transition-all bg-transparent";
      DOM.transitModesCont.classList.remove('hidden'); setTransitMode(DOM.transitVal.value || 'bus');
    }
  };
  DOM.btnDest.onclick = () => setType('destination'); DOM.btnTransit.onclick = () => setType('transit');

  const setTransitMode = (mode) => {
    DOM.transitVal.value = mode;
    DOM.transitModeBtns.forEach(btn => {
      if(btn.dataset.mode === mode) btn.classList.add('border-[#58cc02]', 'bg-green-50');
      else btn.classList.remove('border-[#58cc02]', 'bg-green-50');
    });
    if(mode === 'walk' || mode === 'bike') DOM.costCont.classList.add('hidden');
    else DOM.costCont.classList.remove('hidden');
  };
  DOM.transitModeBtns.forEach(btn => btn.onclick = () => { playClick(); setTransitMode(btn.dataset.mode); });

  DOM.addActBtn.onclick = () => {
    if (activeUserRole === 'viewer') return;
    playClick(); editingActivityId = null; DOM.titleEl.textContent = "Add Activity"; DOM.btnDelete.classList.add('hidden');
    DOM.titleInp.value = ''; DOM.durInp.value = '60'; DOM.costInp.value = '';
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
      if(type === 'transit') act.transitMode = transitMode;
    } else {
      day.activities.push({ id: 'act-' + Date.now(), type, title, duration: dur, cost, startTime: inputTime, manualTime: true, transitMode: type === 'transit' ? transitMode : null });
    }
    day.activities.sort((a,b) => a.startTime - b.startTime);
    playSuccess(); closeActModal(); await recalculateTimes(); renderDay(DOM.itineraryContainer);
  };

  DOM.btnDelete.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    if(confirm("Delete this activity?")) {
      playClick(); const day = activeTrip.days.find(d => d.id === activeDayId);
      day.activities = day.activities.filter(a => a.id !== editingActivityId);
      closeActModal(); await recalculateTimes(); renderDay(DOM.itineraryContainer);
    }
  };
  DOM.btnClose.onclick = () => { playClick(); closeActModal(); };
  
  container.addEventListener('click', (e) => {
    if(e.target.closest('.drag-handle')) return; 
    const target = e.target.closest('.edit-act-target');
    if(target) { 
      if (activeUserRole === 'viewer') return;
      playClick(); openEditModal(target.dataset.id); 
    }
  });
}

function openEditModal(id) {
  editingActivityId = id; const day = activeTrip.days.find(d => d.id === activeDayId); const act = day.activities.find(a => a.id === id);
  DOM.titleEl.textContent = "Edit Activity"; DOM.btnDelete.classList.remove('hidden');
  DOM.titleInp.value = act.title; DOM.durInp.value = act.duration; DOM.costInp.value = act.cost > 0 ? act.cost : ''; DOM.startInp.value = minutesToStr(act.startTime);
  if(act.type === 'destination') DOM.btnDest.click();
  else { DOM.btnTransit.click(); DOM.transitModeBtns.forEach(b => { if(b.dataset.mode === (act.transitMode || 'bus')) b.click(); }); }
  openActModal();
}

function openActModal() { DOM.bg.classList.remove('hidden'); setTimeout(() => DOM.modal.classList.remove('translate-y-full'), 10); }
function closeActModal() { DOM.modal.classList.add('translate-y-full'); setTimeout(() => DOM.bg.classList.add('hidden'), 300); }

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
    await recalculateTimes(); renderDay(document.getElementById('itinerary-container'));
  });
}

function renderDay(container) {
  const day = activeTrip.days.find(d => d.id === activeDayId);
  const canEdit = activeUserRole !== 'viewer';
  
  if (!day || !day.activities || day.activities.length === 0) {
    container.innerHTML = `<div class="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-gray-200"><h3 class="text-xl font-bold text-gray-400 mb-2">No activities planned.</h3>${canEdit ? `<p class="text-sm text-gray-400 mb-6">Click '+ Activity' to build your day.</p>` : ''}</div>`;
    return;
  }

  let html = `<div id="activity-list" class="space-y-3 relative pb-12">`;
  day.activities.forEach((act, index) => {
    const timeDisplay = minutesToStr(act.startTime); // UPDATED: Only show start time
    
    const dragAttr = canEdit ? `draggable="true"` : ``;
    const editClass = canEdit ? `edit-act-target cursor-pointer hover:shadow-md` : ``;
    const dragIcon = canEdit ? `<div class="text-gray-300 cursor-grab hover:text-gray-500 flex items-center px-2 drag-handle"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M4 8h16M4 16h16"></path></svg></div>` : ``;
    const transitHandleClass = canEdit ? `drag-handle cursor-grab` : ``;

    if (act.type === 'destination') {
      html += `
        <div class="draggable-item dest-card p-4 flex gap-4 relative z-10 ${editClass}" data-id="${act.id}" ${dragAttr} data-index="${index}">
          <div class="flex flex-col items-center justify-center border-r-2 border-gray-100 pr-4 shrink-0 w-24">
            <span class="text-sm font-extrabold text-[#afafaf] ${act.manualTime ? 'text-[#ff9600]' : ''}">${timeDisplay}</span>
            <span class="text-xs font-bold text-[#1cb0f6] bg-blue-50 px-2 py-1 rounded-lg mt-1 w-full text-center">${act.duration}m</span>
          </div>
          <div class="flex-1 flex flex-col justify-center">
            <h3 class="font-extrabold text-lg text-[#4b4b4b] leading-tight">${act.title}</h3>
            ${act.cost > 0 ? `<p class="text-sm font-bold text-[#ff9600] mt-1">${formatCurrency(act.cost)}</p>` : ''}
          </div>
          ${dragIcon}
        </div>`;
    } else {
      const icon = TRANSIT_ICONS[act.transitMode] || '🚌';
      const color = act.transitMode === 'walk' || act.transitMode === 'bike' ? 'text-[#afafaf]' : 'text-[#58cc02]';
      html += `
        <div class="draggable-item transit-card ${editClass}" data-id="${act.id}" ${dragAttr} data-index="${index}">
          <div class="transit-inner p-3 flex gap-4 items-center hover:bg-[#e8e8e8] transition-colors">
            <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm shadow-sm shrink-0 ${transitHandleClass}">${icon}</div>
            <div class="flex-1 flex justify-between items-center pr-2">
              <div>
                <span class="font-bold text-[#777] text-sm">${act.title}</span>
                <span class="text-xs font-bold ${color} ml-2">(${act.duration}m)</span>
              </div>
               ${act.cost > 0 ? `<span class="text-xs font-bold text-[#ff9600]">${formatCurrency(act.cost)}</span>` : ''}
            </div>
          </div>
        </div>`;
    }
  });
  html += `</div>`; 
  container.innerHTML = html; 
  if (canEdit) handleDragDrop(document.getElementById('activity-list'));
}