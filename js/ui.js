import { getTrips, getTrip, createTrip, deleteTrip, useSupabase } from './storage.js';
import { playClick, playSuccess } from './audio.js';
import { currentUser } from './auth.js';
import { loadTripDays, activeDayId, activeTrip, isTripMember, activeUserRole } from './itinerary.js';
import { renderNotes } from './notes.js';
import { renderSplitter, initSplitter } from './splitter.js';
import { renderHub } from './hub.js';

let currentView = 'trips';
let profileReturnView = 'trips';
window.lakbayCurrentView = currentView;

export async function initUI() {
  await renderTripList();
  initSplitter();
  setupEventListeners();
  document.addEventListener('lakbay:auth-changed', renderTripList);
  window.lakbayRenderTrips = renderTripList;
  switchView('trips');
}

export function switchView(viewName, options = {}) {
  if (!options.force && viewName !== 'settings' && currentView === 'settings' && window.lakbayHasUnsavedTripSettings?.()) {
    document.dispatchEvent(new CustomEvent('lakbay:settings-navigation-attempt', { detail: { target: viewName } }));
    return false;
  }
  if (viewName === 'forum' && activeTrip && !isTripMember) {
    window.lakbayOpenTripInvitePrompt?.(activeTrip);
    return;
  }
  if (viewName === 'settings' && activeUserRole === 'viewer') return;
  if (viewName === 'profile' && currentView !== 'profile') profileReturnView = currentView;
  document.dispatchEvent(new CustomEvent('lakbay:view-changing', { detail: { from: currentView, to: viewName } }));
  currentView = viewName;
  window.lakbayCurrentView = viewName;
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const viewEl = document.getElementById(`${viewName}-view`);
  if (viewEl) viewEl.classList.remove('hidden');
  document.dispatchEvent(new CustomEvent('lakbay:view-changed', { detail: viewName }));

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
  const labels = { trips: 'Overview', days: 'Itinerary', day: 'Itinerary', food: 'Food', splitter: 'Budget', forum: 'Forum', settings: 'Trip settings', profile: 'My profile', notes: 'Notes', hub: 'Travel guide' };
  document.querySelectorAll('#workspace-breadcrumb, #desktop-workspace-breadcrumb').forEach(crumb => { crumb.textContent = labels[viewName] || 'Overview'; });
  if (viewName === 'profile') document.dispatchEvent(new Event('lakbay:profile-opened'));
  document.querySelectorAll('.global-nav-btn, .global-nav-mobile').forEach(btn => {
    const target = btn.dataset.target;
    btn.classList.toggle('nav-btn-active', target === viewName || (viewName === 'day' && target === 'days'));
  });
  document.querySelectorAll('.trip-nav-btn').forEach(btn => btn.classList.toggle('nav-btn-active', btn.dataset.target === viewName || (viewName === 'day' && btn.dataset.target === 'days')));
}

export function returnFromProfile() {
  switchView(profileReturnView || 'trips');
}

function setupEventListeners() {
  document.querySelectorAll('.trip-nav-btn, .global-nav-btn, .global-nav-mobile').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget.dataset.target; if (!target) return;
      if(target === 'day' && !activeDayId) return alert("Select a day from Itinerary first.");
      playClick(); switchView(target);
    });
  });

  document.getElementById('logo-btn')?.addEventListener('click', () => { playClick(); switchView('trips'); });
  document.getElementById('logo-btn-mobile')?.addEventListener('click', () => { playClick(); switchView('trips'); });
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
    playClick();
    modal.saveBtn.disabled = true;
    modal.saveBtn.textContent = 'Creating…';
    let created = null;
    try {
      created = await createTrip(modal.emoji.value || '📍', dest);
      if (!created) throw new Error('Supabase did not return the new trip.');
      playSuccess();
      showToast(`Trip created · ${dest}`);
      modal.closeBtn.click();
      await renderTripList();
      try {
        await loadTripDays(created);
        document.dispatchEvent(new Event('lakbay:trip-loaded'));
      } catch (openError) {
        console.error('Trip was created, but its overview could not be opened.', openError);
        switchView('trips');
        alert('Your trip was created and is in the trip list. Open it from there to continue.');
        return;
      }
      switchView('trips');
    } catch (error) {
      console.error('Could not create trip.', error);
      if (created) {
        await renderTripList();
        switchView('trips');
        alert('Your trip was created, but Lakbay could not open its overview. It is available in your trip list.');
      } else {
        const detail = error?.message || 'Check your connection and try again.';
        alert(`Could not create the trip. ${detail}`);
      }
    } finally {
      modal.saveBtn.disabled = false;
      modal.saveBtn.textContent = "Let's Go!";
    }
  };
}

async function renderTripList() {
  const list = document.getElementById('trip-list');
  if (!list) return;
  let trips;
  try {
    trips = await getTrips();
  } catch (error) {
    console.error('Could not load trips.', error);
    list.innerHTML = `<div class="empty-trip-state" role="alert"><div class="empty-trip-icon">!</div><h3>We couldn’t load your trips.</h3><p>${escapeHtml(error?.message || 'Check your connection, then try again.')}</p><button class="outline-btn" type="button" id="retry-trip-load">Try again</button></div>`;
    document.getElementById('retry-trip-load')?.addEventListener('click', renderTripList);
    document.dispatchEvent(new Event('lakbay:trip-list-updated'));
    return;
  }
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
      document.dispatchEvent(new Event('lakbay:trip-loaded'));
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

export function showToast(message) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}
