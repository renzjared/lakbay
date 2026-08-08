import { getTrips, getTrip, createTrip, deleteTrip, useSupabase } from './storage.js';
import { playClick, playSuccess } from './audio.js';
import { currentUser } from './auth.js';
import { loadTripDays, activeDayId } from './itinerary.js';
import { renderNotes } from './notes.js';
import { renderSplitter, initSplitter } from './splitter.js';
import { renderHub } from './hub.js';

let currentView = 'trips';

export async function initUI() {
  await renderTripList();
  initSplitter();
  setupEventListeners();
  switchView('trips');
}

export function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const viewEl = document.getElementById(`${viewName}-view`);
  if (viewEl) viewEl.classList.remove('hidden');

  const globalNav = document.getElementById('global-bottom-nav');
  const tripNav = document.getElementById('trip-bottom-nav');
  if (viewName === 'trips') { globalNav.classList.remove('hidden'); tripNav.classList.add('hidden'); } 
  else { globalNav.classList.add('hidden'); tripNav.classList.remove('hidden'); }

  document.querySelectorAll('.trip-nav-btn').forEach(btn => {
    const isTarget = btn.dataset.target === viewName;
    // reset colors
    btn.classList.remove('text-[#1cb0f6]', 'text-[#ce82ff]', 'text-[#ff9600]');
    btn.classList.add('text-gray-400');
    
    if (isTarget) {
      btn.classList.remove('text-gray-400');
      if (viewName === 'splitter') btn.classList.add('text-[#ce82ff]');
      else if (viewName === 'hub') btn.classList.add('text-[#ff9600]');
      else btn.classList.add('text-[#1cb0f6]');
    }
  });

  if (viewName === 'notes') renderNotes();
  if (viewName === 'splitter') renderSplitter();
  if (viewName === 'hub') renderHub();
}

function setupEventListeners() {
  document.querySelectorAll('.trip-nav-btn, .global-nav-btn, .global-nav-mobile').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget.dataset.target; if (!target) return;
      if(target === 'day' && !activeDayId) return alert("Please select a Day from the Days tab first.");
      playClick(); switchView(target);
    });
  });

  document.getElementById('logo-btn').onclick = () => { playClick(); switchView('trips'); };
  document.getElementById('logo-btn-mobile').onclick = () => { playClick(); switchView('trips'); };
  document.getElementById('back-to-days-btn').onclick = () => { playClick(); switchView('days'); };

  const modal = {
    bg: document.getElementById('modal-backdrop'), card: document.getElementById('add-trip-modal'),
    emoji: document.getElementById('trip-emoji'), dest: document.getElementById('trip-destination'),
    saveBtn: document.getElementById('save-trip-btn'), closeBtn: document.getElementById('close-modal-btn')
  };

  document.getElementById('add-trip-btn').onclick = () => { 
    if(useSupabase && !currentUser) return alert("Please log in to create trips!");
    playClick(); modal.bg.classList.remove('hidden'); setTimeout(() => modal.card.classList.remove('translate-y-full'), 10); 
  };
  modal.closeBtn.onclick = () => { playClick(); modal.card.classList.add('translate-y-full'); setTimeout(() => modal.bg.classList.add('hidden'), 300); };
  modal.saveBtn.onclick = async () => {
    const dest = modal.dest.value.trim(); if (!dest) return alert("Please enter a destination!");
    playSuccess(); await createTrip(modal.emoji.value || '📍', dest); modal.closeBtn.click(); await renderTripList();
  };
}

async function renderTripList() {
  const list = document.getElementById('trip-list');
  const trips = await getTrips(); 
  list.innerHTML = '';
  if (useSupabase && !currentUser) {
    list.innerHTML = `<div class="text-center text-gray-400 mt-12 font-bold bg-white p-8 rounded-2xl border-2 border-dashed border-gray-200"><div class="text-4xl mb-4">🔒</div><p>Please log in via Discord to view or create trips.</p></div>`; return;
  }
  if (trips.length === 0) {
    list.innerHTML = `<div class="text-center text-gray-400 mt-12 font-bold bg-white p-8 rounded-2xl border-2 border-dashed border-gray-200"><div class="text-4xl mb-4">🌎</div><p>No trips yet. Let's explore!</p></div>`; return;
  }
  trips.forEach(trip => {
    const card = document.createElement('div'); card.className = 'trip-card p-5 flex items-center justify-between mb-3';
    if (!trip.days) trip.days = [];
    card.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 bg-[#e5e5e5] rounded-2xl flex items-center justify-center text-3xl shadow-inner pb-1">${trip.emoji || '📍'}</div>
        <div><h3 class="font-extrabold text-xl text-[#4b4b4b]">${trip.destination}</h3><p class="text-sm font-bold text-gray-400 mt-1">${trip.days.length} Days Planned</p></div>
      </div>
      <button class="delete-btn p-3 text-gray-300 hover:text-red-400 rounded-xl transition-colors" data-id="${trip.id}">✕</button>`;
    card.addEventListener('click', async (e) => {
      if(e.target.closest('.delete-btn')) return;
      playClick(); switchView('days'); loadTripDays(await getTrip(trip.id));
    });
    list.appendChild(card);
  });
  document.querySelectorAll('.delete-btn').forEach(b => b.onclick = async (e) => {
    playClick(); if(confirm('Delete trip permanently?')) { await deleteTrip(e.currentTarget.dataset.id); await renderTripList(); }
  });
}