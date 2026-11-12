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
  document.addEventListener('lakbay:auth-changed', renderTripList);
  window.lakbayRenderTrips = renderTripList;
  switchView('trips');
}

export function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const viewEl = document.getElementById(`${viewName}-view`);
  if (viewEl) viewEl.classList.remove('hidden');

  const globalNav = document.getElementById('global-bottom-nav');
  const tripNav = document.getElementById('trip-bottom-nav');
  globalNav.classList.remove('hidden');
  tripNav.classList.add('hidden');

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
  const labels = { trips: 'Overview', days: 'Plan', day: 'Plan', splitter: 'Budget', forum: 'Forum', settings: 'Trip settings', profile: 'My profile', notes: 'Notes', hub: 'Travel guide' };
  const crumb = document.getElementById('workspace-breadcrumb');
  if (crumb) crumb.textContent = labels[viewName] || 'Overview';
  document.querySelectorAll('.global-nav-btn, .global-nav-mobile').forEach(btn => {
    const target = btn.dataset.target;
    btn.classList.toggle('nav-btn-active', target === viewName || (viewName === 'day' && target === 'days'));
  });
  document.querySelectorAll('.trip-nav-btn').forEach(btn => btn.classList.toggle('nav-btn-active', btn.dataset.target === viewName || (viewName === 'day' && btn.dataset.target === 'days')));
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
    playSuccess();
    const created = await createTrip(modal.emoji.value || '📍', dest);
    if (!created) return alert('Could not create the trip. Check your connection and try again.');
    modal.closeBtn.click();
    await loadTripDays(created);
    window.dispatchEvent(new Event('lakbay:trip-loaded'));
    await renderTripList();
    switchView('trips');
  };
}

async function renderTripList() {
  const list = document.getElementById('trip-list');
  const trips = await getTrips(); 
  list.innerHTML = '';
  if (useSupabase && !currentUser) {
    document.dispatchEvent(new Event('lakbay:trip-list-updated'));
    return;
  }
  if (trips.length === 0) {
    list.innerHTML = `<div class="empty-trip-state"><div class="empty-trip-icon">✳</div><h3>Your next adventure starts with an invite.</h3><p>Create a trip for your crew, or join one with an invite code or link.</p><div><button class="primary-btn" data-empty-action="create">＋ Create a trip</button><button class="outline-btn" data-empty-action="join">↗ Join a trip</button></div></div>`;
    document.dispatchEvent(new Event('lakbay:trip-list-updated'));
    return;
  }
  trips.forEach(trip => {
    const card = document.createElement('div'); card.className = 'trip-card p-5 flex items-center justify-between mb-3';
    if (!trip.days) trip.days = [];
    const tripDate = trip.workspace_data?.start_date || trip.days.map(d => d.date).sort()[0] || '';
    card.dataset.search = `${trip.destination || ''} ${trip.emoji || ''}`.toLowerCase();
    card.dataset.tripDate = tripDate;
    card.dataset.planned = String(trip.days.length > 0);
    card.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 bg-[#e5e5e5] rounded-2xl flex items-center justify-center text-3xl shadow-inner pb-1">${trip.emoji || '📍'}</div>
        <div><h3 class="font-extrabold text-xl text-[#4b4b4b]">${escapeHtml(trip.destination || 'Untitled trip')}</h3><p class="text-sm font-bold text-gray-400 mt-1">${trip.days.length} ${trip.days.length === 1 ? 'day' : 'days'} planned${tripDate ? ` · ${new Date(tripDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</p></div>
      </div>
      ${!useSupabase || trip.owner_id === currentUser?.id ? `<button class="delete-btn p-3 text-gray-300 hover:text-red-400 rounded-xl transition-colors" data-id="${trip.id}" aria-label="Delete trip">✕</button>` : ''}`;
    card.addEventListener('click', async (e) => {
      if(e.target.closest('.delete-btn')) return;
      playClick(); await loadTripDays(await getTrip(trip.id));
      window.dispatchEvent(new Event('lakbay:trip-loaded'));
      switchView('trips');
    });
    list.appendChild(card);
  });
  document.querySelectorAll('.delete-btn').forEach(b => b.onclick = async (e) => {
    playClick(); if(confirm('Delete trip permanently?')) { await deleteTrip(e.currentTarget.dataset.id); await renderTripList(); }
  });
  document.dispatchEvent(new Event('lakbay:trip-list-updated'));
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
