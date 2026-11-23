import { activeTrip, loadTripDays, isTripMember, activeUserRole } from './itinerary.js';
import { getTrip, getTrips, getPublicTripView, updateTrip, useSupabase, supabase } from './storage.js';
import { currentUser } from './auth.js';
import { switchView, returnFromProfile, showToast } from './ui.js';

const $ = (s, root = document) => root.querySelector(s);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeWebUrl = value => { try { const raw=String(value||'').trim(); if(!/^https?:\/\//i.test(raw))return ''; const url=new URL(raw); return ['http:','https:'].includes(url.protocol)?safe(url.href):'' } catch { return '' } };
const money = n => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(Number(n) || 0);
const currentForumAuthor = () => {
  const meta = currentUser?.user_metadata || {};
  return meta.display_name || meta.custom_claims?.global_name || meta.global_name || meta.full_name || meta.name || meta.preferred_username || meta.username || meta.user_name || meta.nickname || 'You';
};
const key = suffix => `lakbay_${activeTrip?.id || 'workspace'}_${suffix}`;
let browsingAllTrips = false;
let tripFolders = [];
let lastWorkspaceUserId=String(currentUser?.id||'');
const tripFolderStorageKey = () => `lakbay_trip_folders_${currentUser?.id || 'local'}`;
function readTripFolders() {
  try { const value = JSON.parse(localStorage.getItem(tripFolderStorageKey()) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function saveTripFolders() { localStorage.setItem(tripFolderStorageKey(), JSON.stringify(tripFolders)); }
const workspaceData = () => {
  if (!activeTrip) return {};
  if (!activeTrip.workspace_data) {
    try { activeTrip.workspace_data = JSON.parse(localStorage.getItem(`lakbay_${activeTrip.id}_workspace_data`) || '{}'); }
    catch { activeTrip.workspace_data = {}; }
  }
  return activeTrip.workspace_data;
};
const readTripData = (name, fallback) => workspaceData()[name] ?? fallback;
let settingsDraft = null, pendingSettingsNavigation = null, settingsPreviousView = 'trips';
function isSettingsDirty(){return !!settingsDraft && JSON.stringify(settingsSnapshot())!==JSON.stringify(settingsDraft.baseline)}
function settingsSnapshot(){if(!activeTrip)return {};const inSettings=window.lakbayCurrentView==='settings';return {destination:inSettings?($('#setting-name')?.value??activeTrip.destination):activeTrip.destination||'',icon_url:inSettings?($('#setting-icon-url')?.value??workspaceData().icon_url):workspaceData().icon_url||'',start_date:inSettings?($('#setting-start')?.value||null):(workspaceData().start_date||null),end_date:inSettings?($('#setting-end')?.value||null):(workspaceData().end_date||null),admin_permissions:{...(workspaceData().admin_permissions||{}),showcase_forum:inSettings?$('#permission-showcase-forum')?.checked!==false:workspaceData().admin_permissions?.showcase_forum!==false},people:readTripData('people',[]),groups:readTripData('groups',[]),methods:readTripData('methods',[])}}
function updateSettingsDirtyBanner(){const banner=$('#settings-unsaved-banner'),dirty=isSettingsDirty();banner?.classList.toggle('hidden',!dirty);const save=$('#save-settings-btn');if(save)save.disabled=!dirty;return dirty}
function beginSettingsDraft(fromView){if(!activeTrip)return;settingsPreviousView=fromView&&fromView!=='settings'?fromView:(localStorage.getItem(`lakbay_${activeTrip.id}_settings_return_view`)||'trips');settingsDraft={tripId:String(activeTrip.id),workspace:JSON.parse(JSON.stringify(workspaceData())),destination:activeTrip.destination||'',baseline:settingsSnapshot()};updateSettingsDirtyBanner()}
function applyPendingSettingsNavigation(){const action=pendingSettingsNavigation;pendingSettingsNavigation=null;if(action)action();else switchView(settingsPreviousView||'trips',{force:true})}
function showSettingsNavigationWarning(){const modal=$('#settings-unsaved-modal');if(!modal)return;modal.classList.remove('hidden');}
function guardSettingsNavigation(action){if(window.lakbayCurrentView!=='settings'||!isSettingsDirty())return false;pendingSettingsNavigation=action;showSettingsNavigationWarning();return true}
function writeTripData(name, value) { if (!activeTrip) return; workspaceData()[name] = value; if(window.lakbayCurrentView==='settings'&&settingsDraft){updateSettingsDirtyBanner();return}localStorage.setItem(key(name), JSON.stringify(value)); updateTrip(activeTrip); }

export function initWorkspace() {
  window.lakbayHasUnsavedTripSettings=isSettingsDirty;
  mountNavigation(); mountSecondaryViews(); mountOverview(); mountPlanFood(); mountBudgetPayments();
  mountForum(); mountSettings(); ensureInviteCodeField(); mountProfile(); mountThemeToggles(); mountModalDismissal();
  if(!window.lakbayCountdownTimer)window.lakbayCountdownTimer=window.setInterval(updateOverviewCountdown,1000);
  document.addEventListener('click', e => {
    const pay=e.target.closest('[data-open-my-pay]'),summary=e.target.closest('[data-open-my-summary]'),logPayment=e.target.closest('[data-log-my-payment]');
    if(pay){e.preventDefault();void openMyPayModal();return}
    if(summary){e.preventDefault();void openMySummaryModal();return}
    if(logPayment){e.preventDefault();closeModal('my-pay-modal');void openRecordPayment(null,{toId:logPayment.dataset.logMyPayment,amount:Number(logPayment.dataset.amount)});return}
    const nav = e.target.closest('[data-target]');
    if (nav && ['forum','settings','profile','trips','days','day','food','splitter'].includes(nav.dataset.target)) {
      e.preventDefault();
      if (!activeTrip && !['trips', 'profile'].includes(nav.dataset.target)) return;
      switchView(nav.dataset.target);
    }
  });
  document.addEventListener('lakbay:trip-loaded', () => { tripPeopleCache=[]; refreshWorkspace(); });
  document.addEventListener('lakbay:view-changing',event=>{if(event.detail?.to==='settings'){beginSettingsDraft(event.detail.from);localStorage.setItem(`lakbay_${activeTrip?.id}_settings_return_view`,event.detail.from||'trips')}else if(event.detail?.from!=='settings'&&activeTrip)localStorage.setItem(`lakbay_${activeTrip.id}_settings_return_view`,event.detail.from||'trips')});
  document.addEventListener('lakbay:settings-navigation-attempt',event=>{pendingSettingsNavigation=()=>{if(event.detail?.target==='__trip-switch__')return;switchView(event.detail?.target||'trips',{force:true})};showSettingsNavigationWarning()});
  document.addEventListener('input',event=>{if(event.target.closest('#settings-view'))updateSettingsDirtyBanner()});
  document.addEventListener('change',event=>{if(event.target.closest('#settings-view'))updateSettingsDirtyBanner()});
  document.addEventListener('click',e=>{const featured=e.target.closest('[data-overview-thread]');if(featured){switchView('forum');window.setTimeout(()=>openForumThread(featured.dataset.overviewThread),80)}});
  document.addEventListener('keydown',e=>{const preview=e.target.closest('[data-overview-thread],.thread-open[data-open-thread]');if(preview&&(e.key==='Enter'||e.key===' ')){e.preventDefault();preview.click()}});
  document.addEventListener('lakbay:trip-loaded', () => { syncAccessGate(); refreshTripSwitcher(); });
  document.addEventListener('lakbay:auth-changed',()=>{const userId=String(currentUser?.id||'');refreshTripSwitcher();if(userId!==lastWorkspaceUserId){lastWorkspaceUserId=userId;tripPeopleCache=[];if(activeTrip)refreshWorkspace()}});
  document.addEventListener('lakbay:trip-list-updated', refreshTripSwitcher);
  refreshTripSwitcher();
  if (activeTrip) refreshWorkspace();
}

function mountNavigation() {
  const mobile = $('#global-bottom-nav');
  if (mobile) { mobile.classList.add('mobile-bottom-nav'); mobile.innerHTML = '<button data-target="trips" aria-label="Overview" class="global-nav-mobile nav-btn-active"><span>◫</span><small>Overview</small></button><button data-target="days" aria-label="Itinerary" class="global-nav-mobile"><span>⌖</span><small>Itinerary</small></button><button data-target="food" aria-label="Food" class="global-nav-mobile"><span>♨</span><small>Food</small></button><button data-target="splitter" aria-label="Budget" class="global-nav-mobile"><span>₱</span><small>Budget</small></button><button data-target="forum" aria-label="Forum" class="global-nav-mobile"><span>☷</span><small>Forum</small></button>'; }
  const tripNav = $('#trip-bottom-nav'); if (tripNav) tripNav.classList.add('hidden');
  const main = $('main');
  if (main) main.insertAdjacentHTML('afterbegin', '<header class="lakbay-topbar mobile-workspace-header"><div class="topbar-left"><div class="trip-switcher-wrap"><button id="workspace-trip-switcher" class="workspace-trip-switcher" type="button" aria-haspopup="true" aria-expanded="false"><span class="trip-avatar" id="workspace-trip-avatar">＋</span><span class="trip-switcher-copy"><strong id="workspace-trip-title">Select a trip</strong><small id="workspace-breadcrumb" class="workspace-breadcrumb">Choose a trip to continue</small></span><span class="switch-chevron">⌄</span></button><div id="trip-switcher-menu" class="trip-switcher-menu hidden"><div id="trip-switcher-options"></div><button class="trip-switcher-create workspace-trip-create" type="button">＋ Create a trip</button></div></div></div><div class="topbar-right"><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark mode" aria-pressed="false">☾</button><button class="top-icon" data-target="settings" aria-label="Trip settings">⚙</button><button class="top-avatar" data-target="profile" aria-label="My profile">☺</button><button class="mobile-login" id="mobile-login-inline">Log in</button></div></header>');
  const mobileLogin=$('#mobile-login-inline'); if(mobileLogin){mobileLogin.classList.toggle('hidden',!!currentUser);mobileLogin.onclick=()=>$('#login-discord-btn')?.click()}
  document.querySelectorAll('.workspace-trip-switcher').forEach(button => button.addEventListener('click', () => {
    const menu = button.closest('.trip-switcher-wrap')?.querySelector('.trip-switcher-menu');
    const open = menu?.classList.toggle('hidden') === false;
    button.setAttribute('aria-expanded', String(open));
  }));
  document.querySelectorAll('.workspace-trip-create').forEach(button => button.addEventListener('click', createTripFromSwitcher));
  $('#trip-server-add')?.addEventListener('click', createTripFromSwitcher);
  const rail = $('#trip-server-list');
  rail?.addEventListener('dragstart', event => {
    const trip = event.target.closest('[data-trip-drag]');
    if (!trip) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', trip.dataset.tripDrag);
    trip.classList.add('is-dragging');
  });
  rail?.addEventListener('dragend', event => event.target.closest('[data-trip-drag]')?.classList.remove('is-dragging'));
  rail?.addEventListener('dragover', event => {
    if (event.target.closest('[data-trip-drop],[data-folder-drop]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  });
  rail?.addEventListener('drop', event => {
    const tripId = event.dataTransfer.getData('text/plain');
    if (!tripId) return;
    const folderId = event.target.closest('[data-folder-drop]')?.dataset.folderDrop;
    const targetTrip = event.target.closest('[data-trip-drop]')?.dataset.tripDrop;
    if (folderId) { event.preventDefault(); addTripToFolder(tripId, folderId); }
    else if (targetTrip && targetTrip !== tripId) { event.preventDefault(); createTripFolder(tripId, targetTrip); }
  });
  rail?.addEventListener('click', event => {
    const folder = event.target.closest('[data-folder-toggle]');
    if (!folder) return;
    const item = tripFolders.find(value => value.id === folder.dataset.folderToggle);
    if (item) { item.collapsed = !item.collapsed; saveTripFolders(); refreshTripSwitcher(); }
  });
  rail?.addEventListener('dblclick', event => {
    const folder = event.target.closest('[data-folder-toggle]');
    if (!folder) return;
    const item = tripFolders.find(value => value.id === folder.dataset.folderToggle);
    const name = prompt('Folder name', item?.name || 'Trips');
    if (item && name?.trim()) { item.name = name.trim(); saveTripFolders(); refreshTripSwitcher(); }
  });
  $('#account-menu-trigger')?.addEventListener('click', () => {
    const menu = $('#account-menu');
    const open = menu?.classList.toggle('hidden') === false;
    $('#account-menu-trigger')?.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    const item = e.target.closest('[data-trip-select]');
    if (item) { selectTrip(item.dataset.tripSelect); return; }
    if (!e.target.closest('.account-menu-wrap')) {
      $('#account-menu')?.classList.add('hidden');
      $('#account-menu-trigger')?.setAttribute('aria-expanded', 'false');
    }
    if (!e.target.closest('.trip-switcher-wrap')) closeTripSwitcher();
  });
}

function closeTripSwitcher() {
  document.querySelectorAll('.trip-switcher-menu').forEach(menu => menu.classList.add('hidden'));
  document.querySelectorAll('.workspace-trip-switcher').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function createTripFromSwitcher() {
  if(guardSettingsNavigation(()=>createTripFromSwitcher()))return;
  closeTripSwitcher();
  if (useSupabase && !currentUser) { $('#login-discord-btn')?.click(); return; }
  switchView('trips');
  $('#add-trip-btn')?.click();
}

function tripInitials(trip) {
  return String(trip?.destination || 'Trip').trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toLocaleUpperCase() || '').join('') || 'T';
}

function addTripToFolder(tripId, folderId) {
  for (const folder of tripFolders) folder.tripIds = folder.tripIds.filter(id => String(id) !== String(tripId));
  const target = tripFolders.find(folder => folder.id === folderId);
  if (!target) return;
  target.tripIds.push(String(tripId));
  tripFolders = tripFolders.filter(folder => folder.tripIds.length);
  saveTripFolders();
  refreshTripSwitcher();
}

function createTripFolder(firstId, secondId) {
  for (const folder of tripFolders) folder.tripIds = folder.tripIds.filter(id => String(id) !== String(firstId) && String(id) !== String(secondId));
  tripFolders = tripFolders.filter(folder => folder.tripIds.length);
  tripFolders.push({ id: `folder-${Date.now()}`, name: 'Trips', tripIds: [String(firstId), String(secondId)], collapsed: false });
  saveTripFolders();
  refreshTripSwitcher();
}

async function refreshTripSwitcher() {
  let trips = [];
  if (currentUser || !useSupabase) {
    try { trips = await getTrips(); }
    catch (error) { console.error('Could not refresh trip switcher.', error); }
  }
  const currentId = activeTrip?.id == null ? '' : String(activeTrip.id);
  const rail = $('#trip-server-list');
  if (rail) {
    tripFolders = readTripFolders().filter(folder => Array.isArray(folder.tripIds)).map(folder => ({ ...folder, tripIds: folder.tripIds.map(String) })).filter(folder => folder.tripIds.some(id => trips.some(trip => String(trip.id) === id)));
    const assigned = new Set(tripFolders.flatMap(folder => folder.tripIds));
    const tripButton = trip => `<button type="button" draggable="true" class="trip-server-button${String(trip.id) === currentId ? ' is-selected' : ''}" data-trip-select="${safe(trip.id)}" data-trip-drag="${safe(trip.id)}" data-trip-drop="${safe(trip.id)}" title="${safe(trip.destination || 'Trip')}" aria-label="Open ${safe(trip.destination || 'trip')}"><span class="trip-avatar">${trip.workspace_data?.icon_url?`<img src="${safe(trip.workspace_data.icon_url)}" alt="">`:safe(tripInitials(trip))}</span></button>`;
    const folderMarkup = tripFolders.map(folder => {
      const members = folder.tripIds.map(id => trips.find(trip => String(trip.id) === id)).filter(Boolean);
      if (!members.length) return '';
      return `<div class="trip-folder${folder.collapsed ? ' is-collapsed' : ''}" data-folder-drop="${safe(folder.id)}"><button type="button" class="trip-folder-button" data-folder-toggle="${safe(folder.id)}" title="${safe(folder.name)} · ${members.length} trips. Double-click to rename." aria-label="${safe(folder.collapsed ? 'Expand' : 'Collapse')} ${safe(folder.name)}"><span class="folder-stack">${members.slice(0, 3).map((trip, index) => `<i class="folder-mini folder-mini-${index}">${safe(tripInitials(trip).slice(0, 1))}</i>`).join('')}</span><small>${safe(folder.name)}</small><span class="folder-chevron">${folder.collapsed ? '›' : '⌄'}</span></button><div class="trip-folder-items${folder.collapsed ? ' hidden' : ''}">${members.map(tripButton).join('')}</div></div>`;
    }).join('');
    rail.innerHTML = `${folderMarkup}${trips.filter(trip => !assigned.has(String(trip.id))).map(tripButton).join('')}`;
  }
  ['#workspace-trip-title', '#desktop-workspace-trip-title'].forEach(selector => { const title = $(selector); if (title) title.textContent = activeTrip?.destination || 'Select a trip'; });
  ['#workspace-trip-avatar', '#desktop-workspace-trip-avatar'].forEach(selector => { const avatar = $(selector); if (avatar) avatar.textContent = activeTrip ? (activeTrip.emoji || '✈️') : '＋'; });
  const optionMarkup = trips.length
    ? trips.map(trip => `<button type="button" class="trip-switcher-option${String(trip.id) === currentId ? ' is-selected' : ''}" data-trip-select="${safe(trip.id)}"><span class="trip-avatar">${safe(tripInitials(trip))}</span><span>${safe(trip.destination || 'Untitled trip')}</span>${String(trip.id) === currentId ? '<span class="selected-check">✓</span>' : ''}</button>`).join('')
    : '<p class="trip-switcher-empty">No trips yet.</p>';
  ['#trip-switcher-options', '#desktop-trip-switcher-options'].forEach(selector => { const options = $(selector); if (options) options.innerHTML = optionMarkup; });
}

async function selectTrip(id) {
  if(guardSettingsNavigation(()=>selectTrip(id)))return;
  const trip = await getTrip(id);
  if (!trip) { closeTripSwitcher(); alert('This trip is no longer available.'); return; }
  try {
    await loadTripDays(trip);
    closeTripSwitcher();
    document.dispatchEvent(new Event('lakbay:trip-loaded'));
    switchView('trips');
  } catch (error) {
    console.error('Could not open selected trip.', error);
    alert('Could not open this trip. Please try again.');
  }
}

function mountThemeToggles() {
  const toggles = document.querySelectorAll('[data-theme-toggle]');
  const apply = dark => {
    document.body.classList.toggle('theme-dark', dark);
    toggles.forEach(button => {
      button.textContent = dark ? '☀' : '☾';
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('aria-pressed', String(dark));
    });
  };
  apply(localStorage.getItem('lakbay_theme') === 'dark');
  toggles.forEach(button => button.addEventListener('click', () => {
    const dark = !document.body.classList.contains('theme-dark');
    localStorage.setItem('lakbay_theme', dark ? 'dark' : 'light');
    apply(dark);
  }));
}

function mountSecondaryViews() {
  const main = $('main'); if (!main) return;
  main.insertAdjacentHTML('beforeend', `
    <section id="forum-view" class="view-section hidden new-view"><div class="page-head"><div><h1>Trip forum</h1></div><button class="action-button" id="new-thread-btn">＋ Start a thread</button></div><div class="forum-layout"><div><div id="forum-list"></div></div></div></section>
    <section id="settings-view" class="view-section hidden new-view"><div id="settings-unsaved-banner" class="settings-unsaved-banner hidden" role="status"><span>You have unsaved changes.</span><button type="button" class="action-button" id="save-settings-btn" disabled>Save changes</button></div><div class="page-head"><div><h1>Trip settings</h1><p>Manage trip details, members, and permissions.</p></div></div><div class="settings-grid"><nav class="settings-tabs"><button class="active" data-setting-tab="details">✳　Trip details</button><button data-setting-tab="people">♧　People & groups</button><button data-setting-tab="paymethods">＄　Payment methods</button><button data-setting-tab="permissions">⚙　Permissions</button></nav><div class="setting-panels"><section class="setting-panel" data-setting-panel="details"><h2>Trip details</h2><label>Trip name<input id="setting-name" placeholder="e.g. Summer in Siargao"></label><label>Trip icon image URL<input id="setting-icon-url" type="url" placeholder="https://…"><span class="icon-url-preview" id="trip-icon-preview"></span></label><div class="two-fields"><label>Start date<input id="setting-start" type="date"></label><label>End date<input id="setting-end" type="date"></label></div><label>Invite link<div class="inline-field"><input id="trip-link" readonly><button id="copy-trip-link" class="light-button">Copy</button></div></label><hr><h3>Expense tags</h3><p>Choose labels for your trip expenses.</p><div class="tag-row"><span>🍜 Food</span><span>🚕 Transport</span><span>🏡 Stay</span><span>🎟 Activities</span></div></section><section class="setting-panel hidden" data-setting-panel="people"><h2>People & groups</h2><p>App members and guests can both be included in a trip.</p><div class="setting-row people-section-heading"><b>People on this trip</b><button id="add-person-btn" class="light-button">＋ Add person</button></div><div id="people-list"></div><hr><div class="setting-row people-section-heading"><b>People groups</b><button id="add-group-btn" class="light-button">＋ New group</button></div><div id="groups-list"></div></section><section class="setting-panel hidden" data-setting-panel="paymethods"><h2>Payment methods</h2><p>Payment details are shared with trip members to make settling balances easier.</p><div class="payment-method-section"><div id="payment-method-list"></div><button id="add-payment-method" class="light-button">＋ Add payment method</button></div></section><section class="setting-panel hidden" data-setting-panel="permissions"><h2>Admin permissions</h2><p>Choose what trip admins can manage. The trip owner always keeps full control.</p><div class="permission-list"><label class="permission-option"><span><b>Showcasing forum posts on Overview</b><small>Allow trip admins to feature one discussion for all trip members.</small></span><input id="permission-showcase-forum" type="checkbox" checked></label></div></section></div></div></section>
    <section id="profile-view" class="view-section hidden new-view"><div class="page-head profile-page-head"><div><h1>Your profile</h1><p>Update the name and photo shown to trip members.</p></div><div class="profile-actions"><button class="light-button" id="discard-profile-btn">Discard</button><button class="action-button" id="save-profile-btn">Save profile</button></div></div><div class="profile-card"><div class="profile-photo"><img id="profile-preview" alt="Profile photo"><label class="profile-upload-control"><span>Choose photo</span><input type="file" id="profile-upload" accept="image/*"></label><small>JPG or PNG · up to 5 MB</small></div><div class="profile-form"><h2>Profile details</h2><label>Display name<input id="profile-name" placeholder="Display name"></label><label>A little bio<textarea id="profile-bio" rows="4" placeholder="Add a short bio"></textarea></label><small>Sign-in is handled securely through Discord.</small></div></div></section>`);
}

function mountOverview() {
  const view = $('#trips-view');
  if (!view) return;

  view.insertAdjacentHTML('afterbegin', `<section class="landing-gate" id="landing-gate">

    <div class="landing-copy">
      <div class="landing-brand">Lakbay<span>.</span></div>
      <h1>Bring every trip<br><em>into focus.</em></h1>
      <p>Plan the route, share costs, and keep your group’s decisions in one place.</p>
      <div class="landing-actions"><button class="discord-cta" id="landing-discord-login"><span class="discord-glyph">◉</span> Continue with Discord <span class="cta-arrow">→</span></button><button class="landing-theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark mode" aria-pressed="false">☾</button></div>
    </div>
    <div class="landing-art" aria-hidden="true"><div class="landing-sun"></div><div class="landing-postcard"><div class="postcard-stamp">✳</div><strong class="postcard-message">Gusto mo bang<br>sumama?</strong><div class="postcard-waves">〰 〰 〰</div></div><div class="landing-orbit orbit-one"></div><div class="landing-orbit orbit-two"></div></div>
  </section>
  <div id="active-trip-overview" class="active-trip-overview hidden trip-browser"><div class="active-trip-head"><div class="trip-art"><span>✳</span><b id="active-trip-emoji">✈️</b></div><div class="active-trip-copy"><h2 id="active-trip-title"></h2><p id="active-trip-date-copy">Trip overview and shared planning.</p><div class="active-trip-actions"><button class="action-button" data-target="days">Open itinerary　→</button><button class="light-button" id="overview-share">Invite your people</button><button class="outline-btn guest-join-trip hidden" id="guest-join-trip">Join this trip</button><button class="text-link" id="all-trips-button">All trips</button></div></div></div><div class="overview-cards"><article class="overview-card countdown"><strong id="overview-countdown">—</strong><small>Until trip start</small></article><article class="overview-card overview-balance-card"><strong id="overview-balance">₱0</strong><small>Your balance</small><div class="balance-actions"><button type="button" class="light-button" data-open-my-pay>Pay</button><button type="button" class="light-button" data-open-my-summary>Summary</button></div></article><article class="overview-card"><strong id="overview-day-count">0 days</strong><small>In the plan</small></article></div><div class="overview-community-grid"><section class="overview-members-panel"><h2>Trip members</h2><div id="overview-members-list"></div></section><section class="overview-forum-panel"><div class="overview-panel-heading"><h2>Forum</h2><button type="button" class="text-link" data-target="forum">Open forum →</button></div><div id="overview-showcase-content"></div></section></div></div>
  <div id="trip-search-controls" class="trip-search-controls trip-browser"><label class="trip-search"><span>⌕</span><input id="trip-search-input" type="search" placeholder="Search your trips…"></label><label class="filter-select"><span>Show</span><select id="trip-filter"><option value="all">All trips</option><option value="upcoming">Upcoming</option><option value="past">Past trips</option><option value="planning">Planning in progress</option></select></label></div>
  <div id="join-trip-modal" class="join-trip-overlay hidden"><form class="join-trip-card" id="join-trip-form"><button type="button" class="join-close" id="close-join-modal" aria-label="Close">×</button><div class="join-icon">↗</div><h2>Join a trip</h2><p>Paste an invite code or the full invite link.</p><label for="join-trip-value">Invite code or link</label><input id="join-trip-value" autocomplete="off" placeholder="Paste code or invite link" required><button class="primary-btn join-submit" type="submit">Find trip　→</button></form></div>
  <div id="pending-person-link-modal" class="lakbay-modal-backdrop hidden" data-close-modal><section class="lakbay-modal pending-person-modal" role="dialog" aria-modal="true" aria-labelledby="pending-person-title"><div class="pending-person-mark">↗</div><h2 id="pending-person-title">Are you already listed?</h2><p id="pending-person-copy"></p><div id="pending-person-options" class="pending-person-options"></div><button type="button" id="join-as-new-person" class="light-button pending-person-new">No, add me as a new person</button></section></div>`);

  const tripList = $('#trip-list');
  if (tripList) tripList.classList.add('new-trip-grid', 'trip-browser');
  const header = view.querySelector(':scope > .flex');
  if (header) {
    header.classList.add('legacy-heading', 'trip-browser');
    const title = header.querySelector('h2');
    if (title) title.textContent = 'Your trips';
    const actions = document.createElement('div');
    actions.className = 'browser-top-actions';
    actions.id = 'browser-actions';
    header.append(actions);
    const createButton = header.querySelector('#add-trip-btn');
    if (createButton) {
      createButton.textContent = 'Create trip';
      createButton.className = 'primary-btn';
      actions.append(createButton);
    }
    actions.insertAdjacentHTML('beforeend', '<button id="join-trip-btn" class="outline-btn">Join a trip</button>');
  }
  const search = $('#trip-search-controls');
  if (header && search) header.after(search);
  $('#active-trip-overview')?.classList.add('trip-browser');
  $('#landing-discord-login')?.addEventListener('click', () => $('#login-discord-btn')?.click());
  $('#join-trip-btn')?.addEventListener('click', openJoinModal);
  $('#close-join-modal')?.addEventListener('click', closeJoinModal);
  $('#join-trip-modal')?.addEventListener('click', e => { if (e.target.id === 'join-trip-modal') closeJoinModal(); });
  $('#pending-person-link-modal')?.addEventListener('click',e=>{if(e.target.id==='pending-person-link-modal'&&pendingLinkTrip)void completeJoin(pendingLinkTrip,null)});
  $('#join-trip-form')?.addEventListener('submit', submitJoinTrip);
  $('#pending-person-options')?.addEventListener('click',async event=>{const choice=event.target.closest('[data-link-pending-person]');if(!choice||!pendingLinkTrip)return;const person=(pendingLinkPeople||[]).find(item=>String(item.id)===choice.dataset.linkPendingPerson);if(person)await completeJoin(pendingLinkTrip,person)});
  $('#join-as-new-person')?.addEventListener('click',async()=>{if(pendingLinkTrip)await completeJoin(pendingLinkTrip,null)});
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-empty-action]');
    if (!button) return;
    if (button.dataset.emptyAction === 'create') $('#add-trip-btn')?.click(); else openJoinModal();
  });
  $('#trip-search-input')?.addEventListener('input', filterTrips);
  $('#trip-filter')?.addEventListener('change', filterTrips);
  $('#all-trips-button')?.addEventListener('click', () => {
    browsingAllTrips = true;
    $('#active-trip-overview')?.classList.add('hidden');
    $('.trip-browser-hero')?.classList.add('hidden');
    $('#trip-list')?.classList.remove('hidden');
    header?.classList.remove('hidden');
    search?.classList.remove('hidden');
  });
  $('#overview-share')?.addEventListener('click', () => $('#share-trip-btn')?.click());
  $('#guest-join-trip')?.addEventListener('click', () => window.lakbayOpenTripInvitePrompt?.(activeTrip));
  document.addEventListener('lakbay:trip-list-updated', () => { syncAccessGate(); syncTripBrowserActions(); });
  document.addEventListener('lakbay:auth-changed', syncAccessGate);
  syncAccessGate();
  syncTripBrowserActions();
}

function syncTripBrowserActions() {
  const hasTrips = document.querySelectorAll('#trip-list .trip-card').length > 0;
  $('#browser-actions')?.classList.toggle('hidden', !hasTrips);
}
function syncAccessGate() {
  const publicGuest = !!activeTrip && !currentUser && ['public_view', 'public_edit'].includes(activeTrip.visibility);
  if(publicGuest)browsingAllTrips=false;
  const needsLogin = useSupabase && !currentUser && !publicGuest;
  document.body.classList.toggle('is-logged-out', needsLogin);
  document.body.classList.toggle('has-active-trip', !!activeTrip);
  $('.sidebar')?.classList.toggle('hidden', needsLogin);
  $('.sidebar')?.classList.toggle('no-active-trip', !activeTrip);
  $('.lakbay-topbar')?.classList.toggle('hidden', needsLogin);
  $('#landing-gate')?.classList.toggle('hidden', !needsLogin);
  document.querySelectorAll('.trip-browser').forEach(el => el.classList.toggle('hidden', needsLogin));
  const navigationHidden = needsLogin || !activeTrip;
  const desktopNav = $('#desktop-global-nav');
  desktopNav?.classList.toggle('hidden', navigationHidden);
  if (desktopNav) desktopNav.style.display = navigationHidden ? 'none' : '';
  const mobileNav = $('#global-bottom-nav');
  mobileNav?.classList.toggle('hidden', navigationHidden);
  if (mobileNav) mobileNav.style.display = navigationHidden ? 'none' : '';
  $('.top-icon')?.classList.toggle('hidden', needsLogin);
  document.querySelectorAll('.workspace-trip-switcher').forEach(button=>{button.disabled=publicGuest;button.setAttribute('aria-disabled',String(publicGuest));});
  $('.mobile-workspace-header [data-target="settings"]')?.classList.toggle('hidden', needsLogin || !activeTrip || !isTripMember || activeUserRole === 'viewer');
  $('.top-avatar')?.classList.toggle('hidden', needsLogin || !currentUser);
  $('#top-settings-btn')?.classList.toggle('hidden', needsLogin || !activeTrip || !isTripMember || activeUserRole === 'viewer');
  document.querySelectorAll('.global-nav-btn[data-target="forum"], .global-nav-mobile[data-target="forum"]').forEach(button => button.classList.toggle('hidden', !isTripMember));
  document.querySelectorAll('.global-nav-btn[data-target="settings"]').forEach(button => button.classList.toggle('hidden', !isTripMember || activeUserRole === 'viewer'));
  $('#guest-join-trip')?.classList.add('hidden');
  $('#all-trips-button')?.classList.toggle('hidden', publicGuest);
  $('#overview-share')?.classList.toggle('hidden', activeUserRole !== 'owner');
  $('#record-payment-top')?.classList.toggle('hidden', !isTripMember);
  document.querySelectorAll('[data-open-my-pay],[data-open-my-summary]').forEach(button=>button.classList.toggle('hidden',!isTripMember||(useSupabase&&!currentUser)));
  if (needsLogin) {
    $('#active-trip-overview')?.classList.add('hidden');
    $('#trip-list')?.classList.add('hidden');
    return;
  }
  if (!activeTrip) {
    document.querySelectorAll('#workspace-breadcrumb, #desktop-workspace-breadcrumb').forEach(crumb => crumb.replaceChildren(document.createTextNode('Select a trip to continue')));
    $('#active-trip-overview')?.classList.add('hidden');
    $('#trip-list')?.classList.remove('hidden');
    $('.legacy-heading.trip-browser')?.classList.remove('hidden');
    $('#trip-search-controls')?.classList.remove('hidden');
    filterTrips();
    return;
  }
  const hasSelection = !!activeTrip && !browsingAllTrips;
  $('#active-trip-overview')?.classList.toggle('hidden', !hasSelection);
  $('.legacy-heading.trip-browser')?.classList.toggle('hidden', hasSelection);
  $('#trip-search-controls')?.classList.toggle('hidden', hasSelection);
  $('#trip-list')?.classList.toggle('hidden', hasSelection);
  filterTrips();
}
function openJoinModal(){if(useSupabase&&!currentUser){$('#login-discord-btn')?.click();return}$('#join-trip-modal')?.classList.remove('hidden');$('#join-trip-value')?.focus()}
function closeJoinModal(){$('#join-trip-modal')?.classList.add('hidden');$('#join-trip-value').value=''}
let pendingLinkTrip=null;
let pendingLinkPeople=[];
function discordUsername(){
  const metadata=currentUser?.user_metadata||{},identity=currentUser?.identities?.find(item=>item.provider==='discord')?.identity_data||{};
  return String(identity.username||metadata.username||identity.user_name||metadata.user_name||identity.preferred_username||metadata.preferred_username||'').trim().replace(/^@/,'');
}
async function resolveDiscordUsername(){return discordUsername()}
function normalizePersonName(value){return String(value||'').trim().replace(/^@/,'').toLocaleLowerCase()}
function pendingPeopleFor(trip){const people=Array.isArray(trip?.workspace_data?.people)?trip.workspace_data.people:[];return people.filter(person=>person&&person.guest!==false&&!person.linked_user_id)}
function remapLinkedPersonData(value,guestId,guestName,userId,userName,parentKey=''){
  if(Array.isArray(value))return value.map(item=>remapLinkedPersonData(item,guestId,guestName,userId,userName,parentKey));
  if(!value||typeof value!=='object'){
    if(typeof value==='string'&&value===String(guestId))return String(userId);
    if(typeof value==='string'&&['from','to','payer','paid_by','assigned_to_name'].includes(parentKey)&&normalizePersonName(value)===normalizePersonName(guestName))return userName;
    return value;
  }
  const next={};
  for(const [key,item] of Object.entries(value))next[key]=remapLinkedPersonData(item,guestId,guestName,userId,userName,key);
  if(next.from&&normalizePersonName(next.from)===normalizePersonName(guestName)){next.from=userName;next.from_id=String(userId)}
  if(next.to&&normalizePersonName(next.to)===normalizePersonName(guestName)){next.to=userName;next.to_id=String(userId)}
  if(next.payer&&normalizePersonName(next.payer)===normalizePersonName(guestName)){next.payer=userName;next.payer_id=String(userId)}
  return next;
}
async function linkPendingPerson(trip,person){
  const userId=String(currentUser?.id||(!useSupabase?'me':'')),userName=currentForumAuthor();if(!trip||!person||!userId)return false;
  trip.workspace_data=trip.workspace_data&&typeof trip.workspace_data==='object'?trip.workspace_data:{};
  const guestId=String(person.id||''),guestName=String(person.name||'');
  const remainingPeople=Array.isArray(trip.workspace_data.people)?trip.workspace_data.people.filter(item=>String(item.id)!==guestId):[];
  trip.workspace_data=remapLinkedPersonData(trip.workspace_data,guestId,guestName,userId,userName);
  trip.workspace_data.people=remapLinkedPersonData(remainingPeople,guestId,guestName,userId,userName);
  trip.days=remapLinkedPersonData(trip.days||[],guestId,guestName,userId,userName);
  trip.expenses=remapLinkedPersonData(trip.expenses||trip.workspace_data.expenses||[],guestId,guestName,userId,userName);
  trip.workspace_data.expenses=trip.expenses;
  return await updateTrip(trip);
}
async function completeJoin(trip,person){
  if(person){const ok=await linkPendingPerson(trip,person);if(!ok)return alert('The person could not be linked. Please try again.')}
  pendingLinkTrip=null;pendingLinkPeople=[];$('#pending-person-link-modal')?.classList.add('hidden');closeJoinModal();
  tripPeopleCache=[];await loadTripDays(trip);document.dispatchEvent(new Event('lakbay:trip-loaded'));switchView('trips');
}
async function prepareJoinedTrip(trip,alreadyMember=false){
  const people=pendingPeopleFor(trip),username=await resolveDiscordUsername();
  const exact=username?people.find(person=>normalizePersonName(person.name)===normalizePersonName(username)):null;
  if(exact){await completeJoin(trip,exact);return}
  if(!alreadyMember&&people.length){
    pendingLinkTrip=trip;pendingLinkPeople=people;closeJoinModal();
    $('#pending-person-title').textContent=`Joining ${trip.destination||'this trip'}`;
    $('#pending-person-copy').textContent='Were you added earlier as one of these people? Select your name to connect your existing trip records.';
    $('#pending-person-options').innerHTML=people.map(person=>`<button type="button" class="pending-person-option" data-link-pending-person="${safe(person.id)}"><span class="pending-person-avatar">${safe(person.name?.[0]?.toUpperCase()||'?')}</span><span><b>${safe(person.name||'Trip member')}</b><small>Link this trip profile to your account</small></span><span class="pending-person-select">Select</span></button>`).join('');
    $('#pending-person-link-modal').classList.remove('hidden');return;
  }
  await completeJoin(trip,null);
}
async function submitJoinTrip(e){
  e.preventDefault();const raw=$('#join-trip-value').value.trim();if(!raw)return;let code=raw;
  if(raw.includes('?')||/^https?:\/\//i.test(raw)){try{const url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);code=url.searchParams.get('invite')||url.searchParams.get('code')||'';if(!code)code=url.pathname.split('/').filter(Boolean).at(-1)||''}catch{}}
  if(!code)return alert('That invite link does not contain an invite code.');
  if(useSupabase){
    const memberTrip=(await getTrips()).find(trip=>String(trip.id)===code||String(trip.invite_code||'').toLowerCase()===code.toLowerCase());
    if(memberTrip){let trip=memberTrip;try{const {data,error}=await supabase.rpc('join_trip_by_invite',{p_code:memberTrip.invite_code||String(memberTrip.id)});if(!error&&data)trip=Array.isArray(data)?data[0]||memberTrip:data}catch(error){console.warn('Could not claim username-based trip invitation.',error)}await prepareJoinedTrip(trip,true);return}
    const {data,error}=await supabase.rpc('join_trip_by_invite',{p_code:code});
    if(error)return alert('We couldn’t find that invite. Check the code or ask the trip owner for a new link.');
    const joined=Array.isArray(data)?data[0]:data;if(!joined)return alert('We couldn’t find that invite. Check the code or ask the trip owner for a new link.');
    await prepareJoinedTrip(joined,false);return;
  }
  const accessible=await getTrip(code);if(accessible)await prepareJoinedTrip(accessible,false);else alert('We couldn’t find a trip with that invite code.');
}
function filterTrips(){const q=($('#trip-search-input')?.value||'').trim().toLowerCase(),filter=$('#trip-filter')?.value||'all',today=new Date().toISOString().slice(0,10);document.querySelectorAll('#trip-list .trip-card').forEach(card=>{const queryMatch=(card.dataset.search||'').includes(q),date=card.dataset.tripDate||'',dateMatch=filter==='all'||(filter==='upcoming'&&(!date||date>=today))||(filter==='past'&&!!date&&date<today)||(filter==='planning'&&card.dataset.planned==='false');card.classList.toggle('hidden',!(queryMatch&&dateMatch))})}

let selectedRecipeCooks = new Set();
let recipeDraftItems = [];
let selectedRecipeId = null;

function mountPlanFood() {
  const view = $('#food-view'); if (!view) return;
  view.innerHTML = `<header class="plan-page-head food-page-head"><div><h1>Food</h1><p>Manage ingredients, recipes, and meal assignments.</p></div><button type="button" id="open-grocery-list" class="light-button">Grocery list <span id="grocery-badge">0</span></button></header>
    <div id="food-browser-screen" class="food-workspace"><aside class="ingredient-registry"><div class="panel-heading"><div><h2>Ingredients</h2><p>Per-unit nutrition, cost, and store details.</p></div><div class="ingredient-heading-actions"><button type="button" id="import-ingredients-btn" class="light-button">Import CSV</button><button type="button" id="add-ingredient" class="action-button">＋ Add</button><input type="file" id="ingredients-csv-file" accept=".csv,text/csv" class="hidden" aria-label="Import ingredients CSV"></div></div><p id="ingredient-import-status" class="ingredient-import-status hidden" role="status"></p><div id="ingredients-list"></div></aside><section class="recipe-browser"><div class="panel-heading recipe-browser-heading"><div><h2>Recipes</h2><p>Browse and build the trip menu.</p></div><button type="button" id="add-recipe" class="action-button">＋ New recipe</button></div><label class="recipe-search"><span>⌕</span><input type="search" id="recipe-search-input" placeholder="Search recipes…"></label><div id="recipes-list" class="recipe-grid"></div></section></div>
    <section id="food-detail-screen" class="food-detail-screen hidden"><button type="button" id="back-to-recipes" class="forum-back-button">← All recipes</button><div id="recipe-detail"></div></section>
    <section id="grocery-list-screen" class="grocery-list-screen hidden"><header class="plan-page-head"><div><h1>Grocery list</h1><p>Quantities and package estimates across all recipes.</p></div><div class="plan-page-actions"><button type="button" id="back-to-food" class="light-button">← Food</button><button type="button" id="copy-groceries" class="action-button">Copy list</button></div></header><div class="pretty-card grocery-table-wrap"><table class="grocery-table"><thead><tr><th>Ingredient</th><th>Total needed</th><th>Packages</th><th>Estimated cost</th></tr></thead><tbody id="grocery-items"></tbody></table><div id="grocery-empty" class="empty-note hidden">Add ingredients to recipes to build this list.</div></div></section>
    <div id="ingredient-modal" class="lakbay-modal-backdrop hidden" data-close-modal><form class="lakbay-modal ingredient-dialog" id="ingredient-form" role="dialog" aria-modal="true" aria-labelledby="ingredient-modal-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="ingredient-modal-title">Add an ingredient</h2><p>Nutrition and reference cost are recorded per unit.</p><label>Ingredient name<input name="name" required maxlength="100" placeholder="e.g. Jasmine rice"></label><div class="two-fields"><label>Unit<input name="unit" list="ingredient-unit-options" required maxlength="24" placeholder="g"><datalist id="ingredient-unit-options"><option value="g"><option value="kg"><option value="mL"><option value="L"><option value="piece"><option value="pc"><option value="bundle"><option value="bag"><option value="pack"></datalist></label><label>Reference cost per <span class="ingredient-unit-copy">unit</span><input name="unitCost" type="number" min="0" step="any" placeholder="0.00"></label></div><div class="two-fields"><label>Store quantity <span class="optional-label">Optional</span><input name="size" type="number" min="0.001" step="any" placeholder="e.g. 1000"></label><label>Store price <span class="optional-label">Optional</span><input name="cost" type="number" min="0" step="any" placeholder="0.00"></label></div><details class="ingredient-nutrition-fields"><summary>Nutrition per <span class="ingredient-unit-copy">unit</span> <span class="optional-label">Optional</span></summary><div class="two-fields"><label>Calories<input name="calories" type="number" min="0" step="any" placeholder="kcal"></label><label>Carbohydrates<input name="carbs" type="number" min="0" step="any" placeholder="g"></label><label>Protein<input name="protein" type="number" min="0" step="any" placeholder="g"></label><label>Fat<input name="fat" type="number" min="0" step="any" placeholder="g"></label></div></details><div class="two-fields"><label>Category <span class="optional-label">Optional</span><input name="category" maxlength="80" placeholder="e.g. Vegetables"></label><label>Subcategory <span class="optional-label">Optional</span><input name="subcategory" maxlength="80" placeholder="e.g. Root vegetables"></label></div><label>Source <span class="optional-label">Optional</span><input name="source" maxlength="160" placeholder="Store or product source"></label><label>Notes <span class="optional-label">Optional</span><textarea name="notes" rows="3" placeholder="Brand, substitutions, or other notes"></textarea></label><div class="ingredient-scaling-note">Store price and quantity determine the cost per unit when both are provided. Otherwise, the reference cost is multiplied by recipe quantities.</div><div class="modal-actions"><button type="button" class="light-button" data-dismiss-modal>Cancel</button><button type="submit" class="action-button">Save ingredient</button></div><button type="button" id="delete-ingredient-modal" class="payment-modal-delete hidden">Delete ingredient</button></form></div>
    <div id="recipe-modal" class="lakbay-modal-backdrop hidden" data-close-modal><form class="lakbay-modal recipe-dialog" id="recipe-form" role="dialog" aria-modal="true" aria-labelledby="recipe-modal-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="recipe-modal-title">Create a recipe</h2><p>Add ingredients and assign optional cooks.</p><label>Recipe title<input name="name" required maxlength="120" placeholder="e.g. Shoyu ramen"></label><label>Description <span class="optional-label">Optional</span><textarea name="description" rows="3" maxlength="1000" placeholder="Describe the dish"></textarea></label><label>Image URL <span class="optional-label">Optional</span><input name="image" type="url" placeholder="https://…"></label><label>Assign cooks <span class="optional-label">Optional</span><input id="recipe-cook-search" type="search" placeholder="Search trip members"></label><div id="recipe-cook-selection" class="recipe-cook-selection"></div><div id="recipe-cook-options" class="group-member-options"></div><div class="recipe-ingredient-builder"><h3>Ingredients</h3><div class="recipe-add-line"><select id="recipe-add-ingredient" aria-label="Choose an ingredient"></select><input id="recipe-add-quantity" type="number" min="0.001" step="any" placeholder="Quantity" aria-label="Quantity"><button type="button" id="recipe-add-line" class="light-button">Add</button></div><div id="recipe-draft-items"></div><div class="recipe-cost-total">Recipe total <strong id="recipe-total-cost">₱0.00</strong></div></div><div class="modal-actions"><button type="button" class="light-button" data-dismiss-modal>Cancel</button><button type="submit" class="action-button">Save recipe</button></div><button type="button" id="delete-recipe-modal" class="payment-modal-delete hidden">Delete recipe</button></form></div>`;

  $('#add-ingredient').onclick = () => openIngredientModal();
  $('#add-recipe').onclick = () => { void openRecipeModal(); };
  $('#open-grocery-list').onclick = () => showFoodScreen('groceries');
  $('#back-to-food').onclick = () => showFoodScreen('browse');
  $('#back-to-recipes').onclick = () => { selectedRecipeId = null; showFoodScreen('browse'); };
  $('#recipe-search-input').addEventListener('input', renderRecipes);
  $('#ingredients-list').addEventListener('click', handleIngredientListClick);
  $('#recipes-list').addEventListener('click', handleRecipeListClick);
  $('#recipe-detail').addEventListener('click', event => {
    if (event.target.closest('[data-edit-selected-recipe]')) void openRecipeModal(selectedRecipeId);
    if (event.target.closest('[data-delete-selected-recipe]')) deleteRecipe(selectedRecipeId);
  });
  $('#ingredient-form').addEventListener('submit', saveIngredient);
  $('#import-ingredients-btn').onclick = () => $('#ingredients-csv-file').click();
  $('#ingredients-csv-file').addEventListener('change', importIngredientsCSV);
  $('#ingredient-form').elements.unit.addEventListener('change', handleIngredientUnitChange);
  $('#delete-ingredient-modal').onclick = () => deleteIngredient($('#ingredient-form').dataset.editId);
  $('#recipe-form').addEventListener('submit', saveRecipe);
  $('#delete-recipe-modal').onclick = () => deleteRecipe($('#recipe-form').dataset.editId);
  $('#recipe-cook-search').addEventListener('input', renderRecipeCookOptions);
  $('#recipe-cook-options').addEventListener('click', event => {
    const item = event.target.closest('[data-recipe-cook]'); if (!item) return;
    const id = item.dataset.recipeCook; if (selectedRecipeCooks.has(id)) selectedRecipeCooks.delete(id); else selectedRecipeCooks.add(id);
    renderRecipeCookOptions();
  });
  $('#recipe-add-line').onclick = addRecipeIngredient;
  $('#recipe-draft-items').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-recipe-line]'); if (remove) { recipeDraftItems.splice(Number(remove.dataset.removeRecipeLine), 1); renderRecipeDraftItems(); }
  });
  $('#recipe-draft-items').addEventListener('change', event => {
    const quantity = event.target.closest('[data-recipe-line-qty]'); if (!quantity) return;
    const index = Number(quantity.dataset.recipeLineQty), value = Number(quantity.value);
    if (value > 0 && recipeDraftItems[index]) { recipeDraftItems[index].qty = value; recipeDraftItems[index].cost = value * Number(recipeDraftItems[index].unitCost || 0); renderRecipeDraftItems(); }
  });
  $('#copy-groceries').onclick = copyGroceries;
  renderFood();
}

function foodData() {
  try {
    const stored = readTripData('food', JSON.parse(localStorage.getItem(key('food')) || '{"ingredients":[],"recipes":[]}'));
    const data = { ingredients: Array.isArray(stored?.ingredients) ? stored.ingredients : [], recipes: Array.isArray(stored?.recipes) ? stored.recipes : [] };
    data.ingredients.forEach((ingredient, index) => { if (!ingredient.id) ingredient.id = `ingredient-${index}-${String(ingredient.name || 'item').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`; });
    data.recipes.forEach((recipe, index) => { if (!recipe.id) recipe.id = `recipe-${index}-${String(recipe.name || 'dish').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`; });
    return data;
  } catch { return { ingredients: [], recipes: [] }; }
}
function saveFood(data) { writeTripData('food', data); renderFood(); }
function parseCSVRows(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  return rows;
}
function csvNumber(value) {
  const clean = String(value ?? '').trim();
  if (!clean) return 0;
  const number = Number(clean);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
async function importIngredientsCSV(event) {
  const input = event.currentTarget, file = input.files?.[0], status = $('#ingredient-import-status');
  if (!file) return;
  input.value = '';
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a CSV file smaller than 10 MB.');
    const rows = parseCSVRows((await file.text()).replace(/^\uFEFF/, ''));
    if (rows.length < 2) throw new Error('The CSV has no ingredient rows.');
    const headers = rows[0].map(value => value.trim().toLocaleLowerCase());
    const nameColumn = headers.indexOf('name'), unitColumn = headers.indexOf('unit');
    if (nameColumn < 0 || unitColumn < 0) throw new Error('The CSV must include name and unit columns.');
    const column = name => headers.indexOf(name);
    const numberAt = (cells, name) => column(name) < 0 ? 0 : csvNumber(cells[column(name)]);
    const data = foodData(); let added = 0, updated = 0, skipped = 0;
    for (const cells of rows.slice(1)) {
      const name = String(cells[nameColumn] || '').trim(), unit = String(cells[unitColumn] || '').trim();
      if (!name || !unit) { skipped++; continue; }
      const values = {
        unitCost: numberAt(cells, 'cost_per_unit'),
        caloriesPerUnit: numberAt(cells, 'calories_per_unit'),
        carbsPerUnit: numberAt(cells, 'carbs_per_unit'),
        proteinPerUnit: numberAt(cells, 'protein_per_unit'),
        fatPerUnit: numberAt(cells, 'fat_per_unit')
      };
      if (Object.values(values).some(value => value === null)) { skipped++; continue; }
      const keyName = name.toLocaleLowerCase(), keyUnit = unit.toLocaleLowerCase();
      const existing = data.ingredients.find(item => item.name?.trim().toLocaleLowerCase() === keyName && String(item.unit || '').trim().toLocaleLowerCase() === keyUnit);
      const ingredient = {
        ...(existing || {}), id: existing?.id || `ingredient-${crypto.randomUUID()}`, name, unit,
        size: packageSize(existing || {}), cost: packageCost(existing || {}), ...values,
        category: String(cells[column('category')] || existing?.category || '').trim(),
        subcategory: String(cells[column('subcategory')] || existing?.subcategory || '').trim(),
        source: existing?.source || '',
        notes: String(cells[column('notes')] || existing?.notes || '').trim()
      };
      ingredient.costPerUnit = ingredient.unitCost;
      if (existing) { data.ingredients[data.ingredients.indexOf(existing)] = ingredient; updated++; }
      else { data.ingredients.push(ingredient); added++; }
    }
    if (!added && !updated) throw new Error('No valid ingredient rows were found. Check the names, units, and numeric fields.');
    saveFood(data);
    status.textContent = `Imported ${added} new ingredients, updated ${updated}, skipped ${skipped}. CSV IDs were ignored.`;
    status.classList.remove('hidden');
  } catch (error) {
    console.error('Could not import ingredients CSV.', error);
    status.textContent = error.message || 'Could not import that CSV file.';
    status.classList.remove('hidden');
  }
}
function packageSize(ingredient) { return Number(ingredient.size ?? ingredient.package_size ?? 0); }
function packageCost(ingredient) { return Number(ingredient.cost ?? ingredient.storePrice ?? ingredient.store_price ?? ingredient.package_cost ?? 0); }
function ingredientUnitCost(ingredient) {
  const size = packageSize(ingredient), storePrice = packageCost(ingredient);
  if (size > 0 && storePrice > 0) return storePrice / size;
  return Number(ingredient.costPerUnit ?? ingredient.cost_per_unit ?? ingredient.unitCost ?? ingredient.unit_cost ?? (size ? storePrice / size : 0));
}
function ingredientPackageEstimate(ingredient) { const size = packageSize(ingredient), actual = packageCost(ingredient); return actual || (size > 0 ? size * ingredientUnitCost(ingredient) : 0); }
function unitMoney(value) { return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`; }
function ingredientNutrition(ingredient) { return { calories: Number(ingredient.caloriesPerUnit ?? ingredient.calories_per_unit ?? 0), carbs: Number(ingredient.carbsPerUnit ?? ingredient.carbs_per_unit ?? 0), protein: Number(ingredient.proteinPerUnit ?? ingredient.protein_per_unit ?? 0), fat: Number(ingredient.fatPerUnit ?? ingredient.fat_per_unit ?? 0) }; }
function recipeNutrition(recipe, data) {
  return (recipe.items || []).reduce((total, item) => {
    const ingredient = ingredientById(data, item); if (!ingredient) return total;
    const nutrition = ingredientNutrition(ingredient), quantity = Number(item.qty) || 0;
    Object.keys(total).forEach(key => { total[key] += nutrition[key] * quantity; }); return total;
  }, { calories: 0, carbs: 0, protein: 0, fat: 0 });
}
function unitConversionFactor(from, to) {
  const normalize = value => String(value || '').trim().toLocaleLowerCase();
  const weight = { mg: .001, g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000 };
  const volume = { ml: 1, milliliter: 1, milliliters: 1, cc: 1, l: 1000, liter: 1000, liters: 1000 };
  const count = { pc: 1, pcs: 1, piece: 1, pieces: 1, each: 1, count: 1 };
  const a = normalize(from), b = normalize(to);
  if (a === b) return 1;
  for (const map of [weight, volume, count]) if (map[a] && map[b]) return map[a] / map[b];
  return null;
}
function recipeItemUsesIngredient(item, ingredient) {
  if (String(item.ingredient_id || '') === String(ingredient.id)) return true;
  if (item.ingredient_id) return false;
  const sameName = String(item.name || '').trim().toLocaleLowerCase() === String(ingredient.name || '').trim().toLocaleLowerCase();
  const sameUnit = !item.unit || String(item.unit).trim().toLocaleLowerCase() === String(ingredient.unit || '').trim().toLocaleLowerCase();
  return sameName && sameUnit;
}
function handleIngredientUnitChange(event) {
  const form = $('#ingredient-form'), from = form.dataset.unitBasis || event.target.value, to = event.target.value.trim();
  if (!to || to === from) return;
  const factor = unitConversionFactor(from, to), id = form.dataset.editId;
  const ingredient = foodData().ingredients.find(item => String(item.id) === String(id));
  const isUsed = !!ingredient && foodData().recipes.some(recipe => (recipe.items || []).some(item => recipeItemUsesIngredient(item, ingredient)));
  if (factor === null && isUsed) {
    alert(`Recipes use this ingredient in ${from}. Change to a compatible unit (g/kg, mL/L, or piece/pc) to preserve quantities.`);
    event.target.value = from; return;
  }
  if (factor !== null && factor !== 1) {
    const size = form.elements.size, reference = ['unitCost', 'calories', 'carbs', 'protein', 'fat'].map(name => form.elements[name]);
    if (size.value !== '') size.value = Number(size.value) * factor;
    reference.forEach(input => { if (input.value !== '') input.value = Number(input.value) / factor; });
  }
  form.dataset.unitBasis = to;
  form.querySelectorAll('.ingredient-unit-copy').forEach(node => { node.textContent = to; });
}
function foodImageUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function ingredientById(data, item) { return data.ingredients.find(ingredient => item.ingredient_id && String(ingredient.id) === String(item.ingredient_id)) || data.ingredients.find(ingredient => ingredient.name?.toLowerCase() === String(item.name || '').toLowerCase() && (!item.unit || String(ingredient.unit || '').toLowerCase() === String(item.unit).toLowerCase())); }
function recipeLineCost(item, data) { const ingredient = ingredientById(data, item); return ingredient ? (Number(item.qty || 0) * ingredientUnitCost(ingredient)) : (Number(item.cost ?? (Number(item.qty || 0) * Number(item.unitCost || 0))) || 0); }
function recipeTotal(recipe, data) { return (recipe.items || []).reduce((sum, item) => sum + recipeLineCost(item, data), 0); }
function saveableRecipeLine(item, data) {
  const ingredient = ingredientById(data, item), size = ingredient ? packageSize(ingredient) : 0;
  const qty = Number(item.qty) || 0;
  const unitCost = Number(ingredient ? ingredientUnitCost(ingredient) : (item.unitCost ?? (qty ? Number(item.cost || 0) / qty : 0)));
  return { ingredient_id: item.ingredient_id || ingredient?.id || null, name: ingredient?.name || item.name || 'Ingredient', unit: ingredient?.unit || item.unit || 'pcs', qty, unitCost, cost: ingredient ? qty * unitCost : Number(item.cost ?? qty * unitCost), package_size: ingredient ? size : Number(item.package_size || 0), package_cost: ingredient ? packageCost(ingredient) : Number(item.package_cost || 0) };
}
function showFoodScreen(screen) {
  $('#food-browser-screen').classList.toggle('hidden', screen !== 'browse');
  $('#food-detail-screen').classList.toggle('hidden', screen !== 'detail');
  $('#grocery-list-screen').classList.toggle('hidden', screen !== 'groceries');
  if (screen === 'groceries') renderGroceryList();
  else if (screen === 'browse') renderRecipes();
}
function renderFood() {
  const data = foodData();
  if (!$('#ingredients-list')) return;
  const canEdit = activeUserRole !== 'viewer';
  $('#add-ingredient').classList.toggle('hidden', !canEdit); $('#add-recipe').classList.toggle('hidden', !canEdit);
  $('#import-ingredients-btn').classList.toggle('hidden', !canEdit);
  $('#ingredients-list').innerHTML = data.ingredients.length ? data.ingredients.map(ingredient => {
    const size = packageSize(ingredient), unit = ingredient.unit || 'pcs', unitCost = ingredientUnitCost(ingredient), packEstimate = ingredientPackageEstimate(ingredient), nutrition = ingredientNutrition(ingredient);
    const hasNutrition = Object.values(nutrition).some(value => value !== 0);
    const category = [ingredient.category, ingredient.subcategory].filter(Boolean).join(' · ');
    const packageCopy = size ? `${size} ${safe(unit)} store quantity` : `Per ${safe(unit)}`;
    const priceCopy = size ? `${money(packEstimate)} per store quantity` : `${unitMoney(unitCost)} per ${safe(unit)}`;
    const nutritionCopy = hasNutrition ? `${nutrition.calories} kcal · C ${nutrition.carbs} g · P ${nutrition.protein} g · F ${nutrition.fat} g` : '';
    const packageNutrition = size && hasNutrition ? `Store quantity: ${(nutrition.calories * size).toFixed(1)} kcal · C ${(nutrition.carbs * size).toFixed(1)} g · P ${(nutrition.protein * size).toFixed(1)} g · F ${(nutrition.fat * size).toFixed(1)} g` : '';
    return `<article class="ingredient-card"><div class="ingredient-card-top"><span class="ingredient-symbol">◈</span><div><h3>${safe(ingredient.name)}</h3><small>${packageCopy}${category ? ` · ${safe(category)}` : ''}</small></div></div><div class="ingredient-price"><strong>${priceCopy}</strong>${size ? `<small>${unitMoney(unitCost)} per ${safe(unit)}</small>` : ''}</div>${nutritionCopy ? `<p class="ingredient-nutrition-copy">Per ${safe(unit)}: ${nutritionCopy}</p>${packageNutrition ? `<p class="ingredient-package-nutrition">${packageNutrition}</p>` : ''}` : ''}${ingredient.source || ingredient.notes ? `<details class="ingredient-notes"><summary>Source and notes</summary>${ingredient.source ? `<p><b>Source</b> ${safe(ingredient.source)}</p>` : ''}${ingredient.notes ? `<p>${safe(ingredient.notes)}</p>` : ''}</details>` : ''}${canEdit ? `<div class="ingredient-card-actions"><button type="button" class="light-button" data-edit-ingredient="${safe(ingredient.id)}">Edit</button><button type="button" class="text-link" data-delete-ingredient="${safe(ingredient.id)}">Delete</button></div>` : ''}</article>`;
  }).join('') : '<div class="empty-note">The ingredient registry is empty.</div>';
  renderRecipes(); renderGroceryList();
  if (activeTrip && !tripPeopleCache.length && (!useSupabase || currentUser)) void loadTripPeople().then(() => renderFood());
  if (selectedRecipeId && !$('#food-detail-screen').classList.contains('hidden')) renderRecipeDetail(selectedRecipeId);
}
function renderRecipes() {
  const host = $('#recipes-list'); if (!host) return;
  const data = foodData(), query = ($('#recipe-search-input')?.value || '').trim().toLocaleLowerCase();
  const recipes = data.recipes.filter(recipe => `${recipe.name || ''} ${recipe.description || ''}`.toLocaleLowerCase().includes(query));
  const canEdit = activeUserRole !== 'viewer';
  host.innerHTML = recipes.length ? recipes.map(recipe => {
    const image = foodImageUrl(recipe.image || recipe.image_url), cooks = recipeCookNames(recipe, tripPeopleCache), nutrition = recipeNutrition(recipe, data);
    return `<article class="recipe-card"><button type="button" class="recipe-card-open" data-open-recipe="${safe(recipe.id)}">${image ? `<img class="recipe-card-image" src="${safe(image)}" alt="">` : '<span class="recipe-card-image recipe-card-placeholder">🍲</span>'}<span class="recipe-card-copy"><strong>${safe(recipe.name)}</strong><small>${safe(recipe.description || 'No description')}</small><span>${(recipe.items || []).length} ${(recipe.items || []).length === 1 ? 'ingredient' : 'ingredients'} · ${money(recipeTotal(recipe, data))}${nutrition.calories ? ` · ${nutrition.calories.toFixed(0)} kcal` : ''}</span>${cooks.length ? `<small class="recipe-cook-copy">Cooks: ${safe(cooks.join(', '))}</small>` : ''}</span><span class="recipe-card-arrow">→</span></button>${canEdit ? `<button type="button" class="recipe-card-edit" data-edit-recipe="${safe(recipe.id)}" aria-label="Edit ${safe(recipe.name)}">Edit</button>` : ''}</article>`;
  }).join('') : '<div class="empty-note large">No matching recipes.</div>';
}
function recipeCookNames(recipe, people) {
  const cooks = recipe.cooks || recipe.people || [];
  return cooks.map(cook => { const person = people.find(member => String(member.id) === String(cook)); return person?.name || String(cook); }).filter(Boolean);
}
function renderRecipeDetail(id) {
  const recipe = foodData().recipes.find(item => String(item.id) === String(id)); if (!recipe) return;
  const data = foodData(), image = foodImageUrl(recipe.image || recipe.image_url), people = tripPeopleCache, cooks = recipeCookNames(recipe, people), nutrition = recipeNutrition(recipe, data);
  const lines = (recipe.items || []).map(item => { const line = saveableRecipeLine(item, data); return `<div class="recipe-detail-line"><span>${safe(line.name)}</span><strong>${line.qty} ${safe(line.unit)}</strong><small>${money(recipeLineCost(item, data))}</small></div>`; }).join('');
  const nutritionCopy = Object.values(nutrition).some(value => value > 0) ? `<span>Per recipe <strong>${nutrition.calories.toFixed(1)} kcal · C ${nutrition.carbs.toFixed(1)} g · P ${nutrition.protein.toFixed(1)} g · F ${nutrition.fat.toFixed(1)} g</strong></span>` : '';
  $('#recipe-detail').innerHTML = `<article class="recipe-detail-card">${image ? `<img class="recipe-detail-image" src="${safe(image)}" alt="${safe(recipe.name)}">` : ''}<div class="recipe-detail-heading"><div><h2>${safe(recipe.name)}</h2><p>${safe(recipe.description || 'No description provided.')}</p></div><div class="recipe-detail-actions">${activeUserRole !== 'viewer' ? `<button type="button" class="light-button" data-edit-selected-recipe>Edit recipe</button><button type="button" class="text-link" data-delete-selected-recipe>Delete</button>` : ''}</div></div><div class="recipe-detail-meta"><span>Total cost <strong>${money(recipeTotal(recipe, data))}</strong></span><span>${cooks.length ? `Cooks: ${safe(cooks.join(', '))}` : 'No cooks assigned'}</span>${nutritionCopy}</div><section><h3>Ingredients</h3>${lines || '<div class="empty-note">No ingredients added.</div>'}</section></article>`;
}
function handleIngredientListClick(event) {
  const edit = event.target.closest('[data-edit-ingredient]'), remove = event.target.closest('[data-delete-ingredient]');
  if (edit) openIngredientModal(edit.dataset.editIngredient);
  if (remove) deleteIngredient(remove.dataset.deleteIngredient);
}
function handleRecipeListClick(event) {
  const edit = event.target.closest('[data-edit-recipe]'), open = event.target.closest('[data-open-recipe]');
  if (edit) { void openRecipeModal(edit.dataset.editRecipe); return; }
  if (open) { selectedRecipeId = open.dataset.openRecipe; renderRecipeDetail(selectedRecipeId); showFoodScreen('detail'); }
}
function openIngredientModal(id = '') {
  if (activeUserRole === 'viewer') return;
  const form = $('#ingredient-form'), ingredient = foodData().ingredients.find(item => String(item.id) === String(id));
  form.reset(); form.dataset.editId = ingredient?.id || ''; $('#ingredient-modal-title').textContent = ingredient ? 'Edit ingredient' : 'Add an ingredient';
  const nutrition = ingredientNutrition(ingredient || {}), unit = ingredient?.unit || 'g';
  form.dataset.originalUnit = unit; form.dataset.unitBasis = unit;
  form.elements.name.value = ingredient?.name || ''; form.elements.size.value = packageSize(ingredient || {}) || ''; form.elements.unit.value = unit; form.elements.cost.value = packageCost(ingredient || {}) || ''; form.elements.unitCost.value = ingredient ? ingredientUnitCost(ingredient) : '';
  form.elements.calories.value = nutrition.calories || ''; form.elements.carbs.value = nutrition.carbs || ''; form.elements.protein.value = nutrition.protein || ''; form.elements.fat.value = nutrition.fat || '';
  form.elements.category.value = ingredient?.category || ''; form.elements.subcategory.value = ingredient?.subcategory || ''; form.elements.source.value = ingredient?.source || ''; form.elements.notes.value = ingredient?.notes || '';
  form.querySelectorAll('.ingredient-unit-copy').forEach(node => { node.textContent = unit; });
  $('#delete-ingredient-modal').classList.toggle('hidden', !ingredient); openModal('ingredient-modal');
}
function saveIngredient(event) {
  event.preventDefault(); if (activeUserRole === 'viewer') return;
  const form = event.currentTarget, fields = new FormData(form), data = foodData(), id = form.dataset.editId;
  const previous = data.ingredients.find(item => String(item.id) === String(id)), previousUnit = previous?.unit || String(fields.get('unit')), unit = String(fields.get('unit')).trim();
  const conversion = unitConversionFactor(previousUnit, unit);
  const uses = previous && data.recipes.flatMap(recipe => recipe.items || []).filter(item => recipeItemUsesIngredient(item, previous));
  if (conversion === null && uses?.length) { alert(`This ingredient is used in recipes as ${previousUnit}. Change to a compatible unit (g/kg, mL/L, or piece/pc) to preserve recipe quantities.`); form.elements.unit.value = previousUnit; form.dataset.unitBasis = previousUnit; return; }
  if (conversion !== null && conversion !== 1 && uses?.length) {
    data.recipes.forEach(recipe => (recipe.items || []).forEach(item => {
      if (recipeItemUsesIngredient(item, previous)) { item.ingredient_id = id; item.qty = Number(item.qty || 0) * conversion; item.unit = unit; }
    }));
  }
  const size = Number(fields.get('size')) || 0, storePrice = Number(fields.get('cost')) || 0, referenceCost = Number(fields.get('unitCost')) || 0;
  const ingredient = {
    ...(previous || {}), id: id || `ingredient-${crypto.randomUUID()}`, name: String(fields.get('name')).trim(), unit,
    size, package_size: size, cost: storePrice, package_cost: storePrice,
    unitCost: size > 0 && storePrice > 0 ? storePrice / size : referenceCost, costPerUnit: referenceCost,
    caloriesPerUnit: Number(fields.get('calories')) || 0, carbsPerUnit: Number(fields.get('carbs')) || 0,
    proteinPerUnit: Number(fields.get('protein')) || 0, fatPerUnit: Number(fields.get('fat')) || 0,
    category: String(fields.get('category') || '').trim(), subcategory: String(fields.get('subcategory') || '').trim(),
    source: String(fields.get('source') || '').trim(), notes: String(fields.get('notes') || '').trim()
  };
  const index = data.ingredients.findIndex(item => String(item.id) === String(id)); if (index >= 0) data.ingredients[index] = ingredient; else data.ingredients.push(ingredient);
  saveFood(data); form.reset(); closeModal('ingredient-modal');
}
function deleteIngredient(id) {
  if (activeUserRole === 'viewer' || !id || !confirm('Delete this ingredient from the registry? Recipes that already use it keep their saved quantities.')) return;
  const data = foodData(); data.ingredients = data.ingredients.filter(item => String(item.id) !== String(id)); saveFood(data); closeModal('ingredient-modal');
}
async function openRecipeModal(id = '') {
  if (activeUserRole === 'viewer') return;
  await loadTripPeople();
  const form = $('#recipe-form'), recipe = foodData().recipes.find(item => String(item.id) === String(id));
  form.reset(); form.dataset.editId = recipe?.id || ''; $('#recipe-modal-title').textContent = recipe ? 'Edit recipe' : 'Create a recipe';
  form.elements.name.value = recipe?.name || ''; form.elements.description.value = recipe?.description || ''; form.elements.image.value = recipe?.image || recipe?.image_url || '';
  selectedRecipeCooks = new Set((recipe?.cooks || []).map(String));
  if (!recipe?.cooks?.length && recipe?.people?.length) selectedRecipeCooks = new Set(recipe.people.map(name => tripPeople().find(person => person.name === name)?.id).filter(Boolean));
  recipeDraftItems = (recipe?.items || []).map(item => saveableRecipeLine(item, foodData())).filter(item => item.qty > 0);
  renderRecipeCookOptions(); renderRecipeIngredientOptions(); renderRecipeDraftItems();
  $('#delete-recipe-modal').classList.toggle('hidden', !recipe); openModal('recipe-modal');
}
function renderRecipeCookOptions() {
  const people = tripPeople(), query = ($('#recipe-cook-search').value || '').trim().toLocaleLowerCase();
  $('#recipe-cook-selection').innerHTML = [...selectedRecipeCooks].map(id => { const person = people.find(item => item.id === id); return person ? `<button type="button" class="cook-chip" data-remove-cook="${safe(id)}">${safe(person.name)} ×</button>` : ''; }).join('') || '<span>No cooks assigned</span>';
  $('#recipe-cook-options').innerHTML = people.filter(person => person.name.toLocaleLowerCase().includes(query)).map(person => `<button type="button" class="group-member-option${selectedRecipeCooks.has(person.id) ? ' is-selected' : ''}" data-recipe-cook="${safe(person.id)}"><span class="member-avatar">${safe(person.name[0]?.toUpperCase() || '?')}</span><span>${safe(person.name)}</span><span class="member-check">${selectedRecipeCooks.has(person.id) ? '✓' : '＋'}</span></button>`).join('') || '<div class="empty-note">No matching trip members.</div>';
  $('#recipe-cook-selection').onclick = event => { const chip = event.target.closest('[data-remove-cook]'); if (chip) { selectedRecipeCooks.delete(chip.dataset.removeCook); renderRecipeCookOptions(); } };
}
function renderRecipeIngredientOptions() {
  const select = $('#recipe-add-ingredient'), ingredients = foodData().ingredients;
  select.innerHTML = '<option value="">Choose an ingredient</option>' + ingredients.map(item => `<option value="${safe(item.id)}">${safe(item.name)} · per ${safe(item.unit || 'pcs')}</option>`).join('');
}
function addRecipeIngredient() {
  const data = foodData(), ingredient = data.ingredients.find(item => String(item.id) === $('#recipe-add-ingredient').value), quantity = Number($('#recipe-add-quantity').value);
  if (!ingredient || quantity <= 0) return;
  recipeDraftItems.push({ ingredient_id: ingredient.id, name: ingredient.name, unit: ingredient.unit || 'pcs', qty: quantity, unitCost: ingredientUnitCost(ingredient), cost: quantity * ingredientUnitCost(ingredient), package_size: packageSize(ingredient), package_cost: packageCost(ingredient) });
  $('#recipe-add-ingredient').value = ''; $('#recipe-add-quantity').value = ''; renderRecipeDraftItems();
}
function renderRecipeDraftItems() {
  const data = foodData();
  $('#recipe-draft-items').innerHTML = recipeDraftItems.length ? recipeDraftItems.map((item, index) => `<div class="recipe-draft-line"><div><strong>${safe(item.name)}</strong><small>${money(Number(item.unitCost || 0))} per ${safe(item.unit)}</small></div><label><span class="sr-only">Quantity for ${safe(item.name)}</span><input type="number" min="0.001" step="any" value="${Number(item.qty)}" data-recipe-line-qty="${index}"></label><strong>${money(recipeLineCost(item, data))}</strong><button type="button" data-remove-recipe-line="${index}" aria-label="Remove ${safe(item.name)}">×</button></div>`).join('') : '<div class="empty-note">Add ingredients to calculate the recipe cost.</div>';
  $('#recipe-total-cost').textContent = money(recipeDraftItems.reduce((sum, item) => sum + recipeLineCost(item, data), 0));
}
function saveRecipe(event) {
  event.preventDefault(); if (activeUserRole === 'viewer') return;
  const form = event.currentTarget, fields = new FormData(form), data = foodData(), id = form.dataset.editId;
  const recipe = { id: id || `recipe-${crypto.randomUUID()}`, name: String(fields.get('name')).trim(), description: String(fields.get('description') || '').trim(), image: String(fields.get('image') || '').trim(), cooks: [...selectedRecipeCooks], items: recipeDraftItems.map(item => saveableRecipeLine(item, data)) };
  const index = data.recipes.findIndex(item => String(item.id) === String(id)); if (index >= 0) data.recipes[index] = recipe; else data.recipes.unshift(recipe);
  selectedRecipeId = recipe.id; saveFood(data); closeModal('recipe-modal'); renderRecipeDetail(recipe.id); showFoodScreen('detail');
}
function deleteRecipe(id) {
  if (activeUserRole === 'viewer' || !id || !confirm('Delete this recipe?')) return;
  const data = foodData(); data.recipes = data.recipes.filter(recipe => String(recipe.id) !== String(id)); selectedRecipeId = null; saveFood(data); closeModal('recipe-modal'); showFoodScreen('browse');
}
function aggregateGroceries(data = foodData()) {
  const totals = new Map();
  data.recipes.forEach(recipe => (recipe.items || []).forEach(item => {
    const registered = ingredientById(data, item), name = registered?.name || item.name || 'Ingredient', unit = registered?.unit || item.unit || 'pcs';
    const key = `${registered?.id || name.toLocaleLowerCase()}|${unit}`;
    const aggregate = totals.get(key) || { name, unit, quantity: 0, packageSize: registered ? packageSize(registered) : Number(item.package_size || 0), packageCost: registered ? ingredientPackageEstimate(registered) : Number(item.package_cost || 0), cost: 0 };
    aggregate.quantity += Number(item.qty) || 0;
    aggregate.packageSize ||= registered ? packageSize(registered) : Number(item.package_size || 0);
    aggregate.packageCost ||= registered ? ingredientPackageEstimate(registered) : Number(item.package_cost || 0);
    aggregate.cost += recipeLineCost(item, data);
    totals.set(key, aggregate);
  }));
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function renderGroceryList() {
  const list = aggregateGroceries(), body = $('#grocery-items'); if (!body) return;
  $('#grocery-badge').textContent = String(list.length);
  $('#grocery-empty').classList.toggle('hidden', !!list.length);
  body.innerHTML = list.map(item => { const packs = item.packageSize ? Math.ceil(item.quantity / item.packageSize) : 0, estimated = packs && item.packageCost ? packs * item.packageCost : item.cost; return `<tr><td><strong>${safe(item.name)}</strong></td><td>${item.quantity} ${safe(item.unit)}</td><td>${packs ? `${packs} × ${item.packageSize} ${safe(item.unit)}` : '—'}</td><td>${money(estimated)}</td></tr>`; }).join('');
}
function copyGroceries() { const list = aggregateGroceries(); navigator.clipboard?.writeText(list.map(item => { const packs = item.packageSize ? Math.ceil(item.quantity / item.packageSize) : 0; return `[ ] ${item.name} — ${item.quantity} ${item.unit}${packs ? ` (${packs} packs)` : ''}`; }).join('\n')); }

function mountBudgetPayments() {
  const view = $('#splitter-view');
  if (!view) return;

  const expenseList = $('#expenses-list');
  const addExpense = $('#add-expense-btn');
  const debtList = $('#debts-container');
  const oldHeader = view.querySelector(':scope > .flex');
  const oldExpenseHeading = expenseList?.previousElementSibling;
  const oldDebtCard = debtList?.parentElement;
  oldHeader?.remove();
  oldExpenseHeading?.remove();
  oldDebtCard?.remove();

  view.insertAdjacentHTML('afterbegin', `<div class="new-page-head budget-page-head"><h1>Trip budget</h1></div><div class="budget-highlight"><div class="budget-total-copy"><h2 id="budget-total-spent">₱0.00</h2><small>Total expenses to date</small></div><div class="budget-summary-actions"><button type="button" class="light-button" data-open-my-pay>Pay</button><button type="button" class="light-button" data-open-my-summary>Summary</button></div></div><div class="budget-mobile-tabs" role="tablist" aria-label="Budget records"><button type="button" role="tab" aria-selected="true" class="active" data-budget-mobile-tab="expenses">Expenses</button><button type="button" role="tab" aria-selected="false" data-budget-mobile-tab="payments">Payments</button></div><div class="budget-columns"><section class="pretty-card budget-panel mobile-active" data-budget-panel="expenses"><div class="panel-heading"><h2>Expenses</h2><div id="expense-add-button-slot"></div></div><div id="expense-list-slot"></div></section><section class="pretty-card budget-panel" data-budget-panel="payments"><div class="panel-heading"><h2>Payments</h2><button id="record-payment-top" class="action-button">Record payment</button></div><div id="payment-list-slot"><div id="payment-list"></div></div></section></div><section class="pretty-card budget-settle-panel"><h2>Who owes what</h2><div id="debt-list-slot"></div></section><section class="pretty-card budget-methods-panel" id="budget-payment-methods-panel"><div class="panel-heading"><div><h2>Payment methods</h2><p>Shared by trip members to settle balances.</p></div><button id="add-payment-method-budget" class="light-button">＋ Add payment method</button></div><div id="budget-payment-method-list"></div></section>`);

  if (expenseList) {
    expenseList.classList.add('budget-expenses-list');
    $('#expense-list-slot')?.append(expenseList);
  }
  if (addExpense) {
    addExpense.textContent = 'Add expense';
    addExpense.className = 'action-button';
    $('#expense-add-button-slot')?.append(addExpense);
  }
  $('#payment-list')?.classList.add('payment-list');
  $('#payment-list-slot')?.append($('#payment-list'));
  $('#debt-list-slot')?.append(debtList);
  $('#record-payment-top')?.addEventListener('click', openRecordPayment);
  $('#add-payment-method-budget')?.addEventListener('click',()=>{if(!isTripMember)return;if(myPaymentMethods().length>=5)return alert('You can add up to five payment methods to this trip.');openPaymentMethodModal()});
  $('#payment-list')?.addEventListener('click',e=>{const edit=e.target.closest('[data-edit-payment]'),remove=e.target.closest('[data-delete-payment]');if(edit)openRecordPayment(Number(edit.dataset.editPayment));else if(remove)deletePaymentLog(Number(remove.dataset.deletePayment))});
  document.querySelectorAll('[data-budget-mobile-tab]').forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.budgetMobileTab;
    document.querySelectorAll('[data-budget-mobile-tab]').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-budget-panel]').forEach(panel => panel.classList.toggle('mobile-active', panel.dataset.budgetPanel === selected));
  }));
}
async function openRecordPayment(paymentIndex=null,prefill={}){
  if(!activeTrip||!isTripMember)return;
  await loadTripPeople();
  const payments=readTripData('payments',[]);
  editingPaymentIndex=Number.isInteger(paymentIndex)?paymentIndex:null;
  const payment=editingPaymentIndex===null?null:payments[editingPaymentIndex];
  let modal=$('#record-payment-modal');
  if(!modal){
    $('main').insertAdjacentHTML('beforeend',`<div id="record-payment-modal" class="lakbay-modal-backdrop hidden" data-close-modal><form class="lakbay-modal" id="record-payment-form" role="dialog" aria-modal="true" aria-labelledby="record-payment-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="record-payment-title">Record a payment</h2><p>Record money transferred between trip members.</p><div class="two-fields"><label>Paid by<select name="from" required></select></label><label>Paid to<select name="to" required></select></label></div><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label><div class="two-fields"><label>Payment method<select name="mode"><option>Cash</option><option>GCash</option><option>Maya</option><option>Bank transfer</option><option>Other</option></select></label><label>Reference <span class="optional-label">Optional</span><input name="ref" placeholder="Reference number"></label></div><div class="modal-actions"><button type="button" class="light-button" data-dismiss-modal>Cancel</button><button class="action-button" type="submit">Save payment</button></div><button type="button" id="delete-payment-in-modal" class="payment-modal-delete hidden">Delete payment</button></form></div>`);
    modal=$('#record-payment-modal');
    $('#record-payment-form').addEventListener('submit',e=>{
      e.preventDefault();
      const form=e.currentTarget,data=new FormData(form),people=tripPeople();
      const from=people.find(person=>person.id===data.get('from')),to=people.find(person=>person.id===data.get('to')),amount=Number(data.get('amount'));
      if(!from||!to||from.id===to.id){alert('Choose two different people.');return}
      if(amount<=0)return;
      const records=readTripData('payments',[]),entry={...(editingPaymentIndex===null?{}:records[editingPaymentIndex]),id:editingPaymentIndex===null?crypto.randomUUID():(records[editingPaymentIndex]?.id||crypto.randomUUID()),from_id:from.id,to_id:to.id,from:from.name,to:to.name,amount,mode:String(data.get('mode')),ref:String(data.get('ref')||'').trim(),date:editingPaymentIndex===null?new Date().toISOString():(records[editingPaymentIndex]?.date||new Date().toISOString()),updated_at:new Date().toISOString()};
      if(editingPaymentIndex===null)records.unshift(entry);else records[editingPaymentIndex]=entry;
      writeTripData('payments',records);editingPaymentIndex=null;form.reset();closeModal('record-payment-modal');renderPayments();document.dispatchEvent(new Event('lakbay:payment-updated'));
    });
    $('#delete-payment-in-modal').addEventListener('click',()=>deletePaymentLog(editingPaymentIndex));
  }
  const form=$('#record-payment-form'),people=tripPeople();
  for(const field of ['from','to']){
    const select=form.elements[field],current=payment?.[`${field}_id`]??(field==='from'?prefill.fromId:prefill.toId);
    select.innerHTML=people.map(person=>`<option value="${safe(person.id)}">${safe(person.name)}</option>`).join('');
    if(current!=null&&people.some(person=>String(person.id)===String(current)))select.value=String(current);
    else if(payment?.[field])select.value=people.find(person=>person.name.toLowerCase()===String(payment[field]).toLowerCase())?.id||people[0]?.id||'';
    else if(field==='from'&&currentUser&&people.some(person=>String(person.id)===String(currentUser.id)))select.value=String(currentUser.id);
    else if(field==='to'&&people.length>1)select.selectedIndex=1;
  }
  if(payment?.mode&&!Array.from(form.elements.mode.options).some(option=>option.value===payment.mode)){const option=document.createElement('option');option.value=payment.mode;option.textContent=payment.mode;form.elements.mode.append(option)}
  form.elements.mode.value=payment?.mode||'Cash';form.elements.amount.value=payment?.amount??prefill.amount??'';form.elements.ref.value=payment?.ref||'';
  $('#record-payment-title').textContent=payment?'Edit payment':'Record a payment';
  form.querySelector('[type="submit"]').textContent=payment?'Save changes':'Save payment';
  $('#delete-payment-in-modal').classList.toggle('hidden',!payment||!isTripCreator());
  openModal('record-payment-modal');
}
function deletePaymentLog(index){
  if(!isTripCreator()||!Number.isInteger(index))return;
  if(!confirm('Delete this payment log?'))return;
  const records=readTripData('payments',[]);records.splice(index,1);writeTripData('payments',records);editingPaymentIndex=null;closeModal('record-payment-modal');renderPayments();document.dispatchEvent(new Event('lakbay:payment-updated'));
}
function renderPayments(){
  const list=$('#payment-list');if(!list)return;const items=readTripData('payments',[]),owner=isTripCreator();
  list.innerHTML=items.length?items.map((payment,index)=>`<div class="payment-row"><span class="pay-icon">↗</span><div><b>${safe(payment.from)} paid ${safe(payment.to)}</b><small>${safe(payment.mode)}${payment.ref?` · ref ${safe(payment.ref)}`:''} · ${payment.date?new Date(payment.date).toLocaleDateString():''}</small></div><strong>${money(payment.amount)}</strong>${owner?`<div class="payment-row-actions"><button type="button" data-edit-payment="${index}" aria-label="Edit payment">Edit</button><button type="button" data-delete-payment="${index}" aria-label="Delete payment">Delete</button></div>`:''}</div>`).join(''):'<div class="empty-note">No payments yet.</div>';
}

let activeForumThreadId=null;
let editingPaymentIndex=null;
let forumThreadReactions=[];
let forumThreadReplies=[];
let replyParentId='';

function mountForum(){
  const view=$('#forum-view');if(!view)return;
  view.querySelector('.forum-layout')?.remove();
  view.insertAdjacentHTML('beforeend',`<div id="forum-list-view"><div id="forum-list"></div></div><section id="forum-thread-view" class="forum-thread-view hidden"><button type="button" class="forum-back-button" id="back-to-forum">← All discussions</button><div id="thread-detail"></div><div class="replies-section"><div class="replies-heading"><h2>Messages</h2><span id="reply-count">0</span></div><div id="thread-replies" class="thread-replies-list"></div><form id="thread-reply-form" class="thread-reply-form"><div id="replying-to" class="replying-to hidden"><span id="replying-to-copy"></span><button type="button" id="cancel-reply-target" aria-label="Cancel reply">×</button></div><textarea id="thread-reply-input" aria-label="Write a message" rows="3" maxlength="8000" placeholder="Write a message…" required></textarea><div id="thread-reply-preview-wrap" class="thread-reply-preview-wrap hidden"><div class="preview-label">Preview</div><div id="thread-reply-preview" class="thread-reply-preview md-content" aria-live="polite"></div></div><div class="reply-form-footer"><small>Markdown is supported · Replies are visible to trip members.</small><button class="action-button" type="submit">Send reply</button></div></form></div></section><div id="thread-composer" class="thread-composer hidden"><div class="thread-composer-card"><button class="composer-close" id="close-thread" type="button" aria-label="Close">×</button><h2>Start a discussion</h2><label>Thread title<input id="thread-title-input" placeholder="Give your thread a title" maxlength="180"></label><label>Your message</label><div class="markdown-tools"><button type="button" data-wrap="**">B</button><button type="button" data-wrap="*"><i>I</i></button><button type="button" data-prefix="# ">H</button><button type="button" data-wrap="&#96;">‹›</button><span>Markdown supported</span></div><textarea id="thread-body-input" rows="6" placeholder="Write your message…"></textarea><div class="preview-label">Preview</div><div id="thread-preview" class="thread-preview md-content">Your message preview appears here.</div><button class="action-button" id="publish-thread" type="button">Post to the forum</button></div></div>`);
  $('#new-thread-btn')?.addEventListener('click',createThread);
  $('#forum-prompt-btn')?.addEventListener('click',createThread);
  $('#close-thread')?.addEventListener('click',()=>$('#thread-composer').classList.add('hidden'));
  $('#thread-composer')?.addEventListener('click',e=>{if(e.target.id==='thread-composer')e.currentTarget.classList.add('hidden')});
  $('#publish-thread')?.addEventListener('click',publishThread);
  $('#thread-body-input')?.addEventListener('input',previewThread);
  $('#forum-view')?.addEventListener('click',async e=>{
    const showcase=e.target.closest('[data-toggle-showcase]');if(showcase){e.preventDefault();e.stopPropagation();await toggleShowcase(showcase.dataset.toggleShowcase);return}
    const back=e.target.closest('#back-to-forum');
    if(back){activeForumThreadId=null;$('#forum-thread-view').classList.add('hidden');$('#forum-list-view').classList.remove('hidden');return}
    const deleteThread=e.target.closest('[data-delete-thread]');
    if(deleteThread){e.preventDefault();e.stopPropagation();await deleteForumThread(deleteThread.dataset.deleteThread);return}
    const deleteReply=e.target.closest('[data-delete-reply]');
    if(deleteReply){e.preventDefault();e.stopPropagation();await deleteForumReply(deleteReply.dataset.deleteReply);return}
    const deleteLegacy=e.target.closest('[data-delete-legacy-reply]');
    if(deleteLegacy){e.preventDefault();e.stopPropagation();await deleteLegacyForumReply(deleteLegacy.dataset.threadId,Number(deleteLegacy.dataset.replyIndex));return}
    const open=e.target.closest('[data-open-thread]');
    if(open){await openForumThread(open.dataset.openThread);return}
    const reaction=e.target.closest('[data-forum-reaction]');
    if(reaction){await toggleForumReaction(reaction.dataset.forumReaction);return}
    const reply=e.target.closest('[data-reply-to]');
    if(reply){setReplyTarget(reply.dataset.replyTo,reply.dataset.replyAuthor);return}
  });
  $('#thread-reply-form')?.addEventListener('submit',sendForumReply);
  $('#thread-reply-input')?.addEventListener('input',previewForumReply);
  $('#cancel-reply-target')?.addEventListener('click',()=>setReplyTarget('',''));
  $('#thread-body-input')?.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();formatTextarea(document.querySelector('#thread-composer [data-wrap="**"]'))}});
  document.querySelectorAll('[data-wrap],[data-prefix]').forEach(b=>b.addEventListener('click',()=>formatTextarea(b)));
}
function forumData(){try{return readTripData('forum',JSON.parse(localStorage.getItem(key('forum'))||'[]'))}catch{return []}}
async function saveForum(items){
  if(!activeTrip||!isTripMember||(useSupabase&&!currentUser))return false;
  if(useSupabase){
    const {error}=await supabase.rpc('save_trip_forum_member',{p_trip_id:activeTrip.id,p_forum:items});
    if(error){console.error('Could not save forum post.',error);alert(error.message||'Could not save your forum post.');return false;}
    workspaceData().forum=items;localStorage.setItem(key('forum'),JSON.stringify(items));
  }else writeTripData('forum',items);
  renderForum();return true;
}
function createThread(){if(!currentUser||!isTripMember)return;$('#thread-title-input').value='';$('#thread-body-input').value='';previewThread();$('#thread-composer').classList.remove('hidden');$('#thread-title-input').focus()}
function previewThread(){const value=$('#thread-body-input').value;const html=window.marked?marked.parse(value||'Your message preview appears here.'):(safe(value)||'Your message preview appears here.');$('#thread-preview').innerHTML=window.DOMPurify?DOMPurify.sanitize(html):safe(value)}
function previewForumReply(){const input=$('#thread-reply-input'),wrap=$('#thread-reply-preview-wrap'),preview=$('#thread-reply-preview'),body=input?.value.trim()||'';if(!wrap||!preview)return;wrap.classList.toggle('hidden',!body);preview.innerHTML=body?forumContent(body):''}
async function publishThread(){if(!currentUser||!isTripMember)return;const title=$('#thread-title-input').value.trim(),body=$('#thread-body-input').value.trim();if(!title||!body)return alert('Add a title and a message first.');const data=forumData(),thread={id:crypto.randomUUID(),title,body,author:currentForumAuthor(),author_id:currentUser.id,date:new Date().toISOString()};data.unshift(thread);if(await saveForum(data)){$('#thread-composer').classList.add('hidden');await openForumThread(thread.id)}}
function formatTextarea(button){const area=$('#thread-body-input');if(!button||!area)return;const start=area.selectionStart,end=area.selectionEnd,text=area.value,wrap=button.dataset.wrap;if(wrap){const selected=text.slice(start,end)||'text';area.setRangeText(`${wrap}${selected}${wrap}`,start,end,'select')}else{const lineStart=text.lastIndexOf('\n',start-1)+1;area.setRangeText(button.dataset.prefix,lineStart,lineStart,'end')}area.focus();previewThread()}
function forumContent(value){const html=window.marked?marked.parse(value||'') : safe(value||'');return window.DOMPurify?DOMPurify.sanitize(html):safe(value||'')}
function renderForum(){
  const el=$('#forum-list');if(!el)return;
  const items=forumData();
  if(!items.length){el.innerHTML='<div class="empty-note large">No discussions yet.</div>';renderOverviewShowcase(items);return}
  el.innerHTML=items.map(item=>`<article class="thread-card"><div class="thread-meta"><span class="thread-avatar">${safe(item.author?.[0]||'L')}</span><b>${safe(item.author||'Trip member')}</b><span>·</span><time>${item.date?new Date(item.date).toLocaleDateString():''}</time></div><div class="thread-open" role="button" tabindex="0" data-open-thread="${safe(item.id)}"><span class="thread-open-title">${safe(item.title)}</span><div class="thread-open-body md-content">${forumContent(item.body||'')}</div></div><div class="thread-card-actions"><button class="thread-open-link" type="button" data-open-thread="${safe(item.id)}">Open discussion　→</button>${canManageShowcase()?`<button type="button" class="light-button thread-showcase-toggle${item.showcased?' is-featured':''}" data-toggle-showcase="${safe(item.id)}">${item.showcased?'Remove from Overview':'Show on Overview'}</button>`:''}${isTripCreator()?`<button type="button" class="thread-owner-delete" data-delete-thread="${safe(item.id)}">Delete thread</button>`:''}</div></article>`).join('');renderOverviewShowcase(items);
}
async function openForumThread(threadId){
  const thread=forumData().find(item=>String(item.id)===String(threadId));if(!thread)return;
  activeForumThreadId=String(threadId);replyParentId='';$('#forum-list-view').classList.add('hidden');$('#forum-thread-view').classList.remove('hidden');
  $('#thread-detail').innerHTML=`<article class="thread-card thread-detail-card"><div class="thread-meta"><span class="thread-avatar">${safe(thread.author?.[0]||'L')}</span><b>${safe(thread.author||'Trip member')}</b><span>·</span><time>${thread.date?new Date(thread.date).toLocaleDateString():''}</time>${isTripCreator()?`<button type="button" class="thread-owner-delete" data-delete-thread="${safe(thread.id)}">Delete thread</button>`:''}</div><h2>${safe(thread.title)}</h2><div class="thread-body md-content">${forumContent(thread.body)}</div><div id="thread-reaction-list" class="thread-reaction-list"><span class="reaction-loading">Loading reactions…</span></div></article>`;
  $('#thread-reply-input').value='';previewForumReply();
  try{
    if(useSupabase){
      const [{data:reactions,error:reactionError},{data:replies,error:replyError}]=await Promise.all([
        supabase.rpc('get_trip_forum_reactions',{p_trip_id:activeTrip.id,p_thread_id:threadId}),
        supabase.rpc('get_trip_forum_replies',{p_trip_id:activeTrip.id,p_thread_id:threadId})
      ]);
      if(reactionError)throw reactionError;if(replyError)throw replyError;
      forumThreadReactions=Array.isArray(reactions)?reactions:[];forumThreadReplies=Array.isArray(replies)?replies:[];
    }else{
      forumThreadReactions=thread.reactions||[];
      forumThreadReplies=(thread.replies||[]).filter(reply=>reply.id);
    }
    if(activeForumThreadId!==String(threadId))return;
    renderThreadReactions();renderThreadReplies(thread);
  }catch(error){console.error('Could not load the thread discussion.',error);$('#thread-reaction-list').innerHTML='<span class="discussion-error">Could not load reactions and replies.</span>';$('#thread-replies').innerHTML='<div class="empty-note">Could not load messages. Refresh and try again.</div>'}
}
const REACTION_OPTIONS=['👍','❤️','😂','🎉','👏'];
function renderThreadReactions(){
  const host=$('#thread-reaction-list');if(!host)return;
  const userId=String(currentUser?.id||'local-user'),summary=forumThreadReactions.map(group=>{const reactors=group.reactors||[],names=reactors.map(r=>r.name||r.username||'Trip member');return `<button type="button" class="reaction-count${reactors.some(r=>String(r.user_id||r.id)===userId)?' is-mine':''}" data-forum-reaction="${safe(group.reaction||group.emoji)}" title="${safe(names.join(', '))}" aria-label="${safe(group.reaction||group.emoji)} reacted by ${safe(names.join(', '))}"><span>${safe(group.reaction||group.emoji)}</span><b>${Number(group.count)||reactors.length}</b><small>${names.length?safe(names.join(', ')):''}</small></button>`}).join('');
  host.innerHTML=`<div class="reaction-summary">${summary||'<span class="reaction-empty">No reactions yet</span>'}</div><div class="reaction-picker" aria-label="Add a reaction">${REACTION_OPTIONS.map(emoji=>`<button type="button" data-forum-reaction="${emoji}" aria-label="React ${emoji}" title="React ${emoji}">${emoji}</button>`).join('')}</div>`;
}
async function toggleForumReaction(emoji){
  if(!activeTrip||!activeForumThreadId||!isTripMember||!currentUser&&useSupabase)return;
  try{
    if(useSupabase){const {data,error}=await supabase.rpc('toggle_trip_forum_reaction',{p_trip_id:activeTrip.id,p_thread_id:activeForumThreadId,p_reaction:emoji});if(error)throw error;forumThreadReactions=Array.isArray(data)?data:[];}
    else{
      const thread=forumData().find(item=>String(item.id)===activeForumThreadId);if(!thread)return;
      thread.reactions=thread.reactions||[];const userId=String(currentUser?.id||'local-user'),mine=thread.reactions.findIndex(r=>String(r.user_id)===userId);
      if(mine>=0&&thread.reactions[mine].emoji===emoji)thread.reactions.splice(mine,1);else{if(mine>=0)thread.reactions.splice(mine,1);thread.reactions.push({user_id:userId,name:currentForumAuthor(),emoji})}
      writeTripData('forum',forumData());forumThreadReactions=thread.reactions.map(r=>({reaction:r.emoji,count:thread.reactions.filter(x=>x.emoji===r.emoji).length,reactors:thread.reactions.filter(x=>x.emoji===r.emoji).map(x=>({user_id:x.user_id,name:x.name}))})).filter((r,i,a)=>a.findIndex(x=>x.reaction===r.reaction)===i);
    }
    renderThreadReactions();
  }catch(error){console.error('Could not update reaction.',error);alert(error.message||'Could not update your reaction.')}
}
function isTripCreator(){return !useSupabase||!!(currentUser&&activeTrip&&String(activeTrip.owner_id)===String(currentUser.id))}
function canManageShowcase(){return isTripCreator()||((activeUserRole==='admin'||activeUserRole==='owner')&&workspaceData().admin_permissions?.showcase_forum!==false)}
async function toggleShowcase(threadId){if(!canManageShowcase())return;const items=forumData();const selected=items.find(thread=>String(thread.id)===String(threadId));if(!selected)return;const nextValue=!selected.showcased;items.forEach(thread=>{thread.showcased=String(thread.id)===String(threadId)?nextValue:false});await saveForum(items);renderOverviewShowcase(items)}
async function deleteForumThread(threadId){
  if(!isTripCreator())return;
  if(!confirm('Delete this thread and all of its messages and reactions?'))return;
  try{
    if(useSupabase){const {error}=await supabase.rpc('delete_trip_forum_thread',{p_trip_id:activeTrip.id,p_thread_id:threadId});if(error)throw error;}
    const next=forumData().filter(thread=>String(thread.id)!==String(threadId));if(useSupabase){workspaceData().forum=next;localStorage.setItem(key('forum'),JSON.stringify(next))}else writeTripData('forum',next);
    if(activeForumThreadId===String(threadId)){activeForumThreadId=null;$('#forum-thread-view').classList.add('hidden');$('#forum-list-view').classList.remove('hidden')}
    renderForum();
  }catch(error){console.error('Could not delete forum thread.',error);alert(error.message||'Could not delete this thread.')}
}
async function deleteForumReply(replyId){
  if(!isTripCreator()||!activeForumThreadId)return;
  if(!confirm('Delete this message and its replies?'))return;
  try{
    if(useSupabase){const {error}=await supabase.rpc('delete_trip_forum_reply',{p_reply_id:replyId,p_trip_id:activeTrip.id});if(error)throw error;}
    const ids=new Set([String(replyId)]);let changed=true;while(changed){changed=false;forumThreadReplies.forEach(reply=>{if(ids.has(String(reply.parent_reply_id))&&!ids.has(String(reply.id))){ids.add(String(reply.id));changed=true}})}
    forumThreadReplies=forumThreadReplies.filter(reply=>!ids.has(String(reply.id)));
    if(!useSupabase){const thread=forumData().find(item=>String(item.id)===activeForumThreadId);if(thread)thread.replies=[...(thread.replies||[]).filter(reply=>!reply.id),...forumThreadReplies];writeTripData('forum',forumData())}
    const thread=forumData().find(item=>String(item.id)===activeForumThreadId);renderThreadReplies(thread);
  }catch(error){console.error('Could not delete forum message.',error);alert(error.message||'Could not delete this message.')}
}
async function deleteLegacyForumReply(threadId,index){
  if(!isTripCreator())return;
  if(!confirm('Delete this message?'))return;
  const items=forumData(),thread=items.find(item=>String(item.id)===String(threadId));if(!thread?.replies?.[index])return;
  thread.replies.splice(index,1);if(await saveForum(items))renderThreadReplies(thread);
}

function renderThreadReplies(thread){
  const host=$('#thread-replies');if(!host)return;
  const list=Array.isArray(forumThreadReplies)?forumThreadReplies:[];
  const legacy=(thread?.replies||[]).map((reply,index)=>({reply,index})).filter(item=>!item.reply.id);
  const canModerate=isTripCreator();
  const childrenOf=parent=>list.filter(reply=>String(reply.parent_reply_id||'')===String(parent||''));
  const renderNode=(reply,depth=0)=>`<article class="forum-reply" style="--reply-depth:${Math.min(depth,4)}"><div class="reply-meta"><span class="thread-avatar">${safe(reply.author?.[0]||'M')}</span><b>${safe(reply.author||'Trip member')}</b><time>${reply.created_at?new Date(reply.created_at).toLocaleString():reply.date?new Date(reply.date).toLocaleString():''}</time></div><div class="reply-body">${forumContent(reply.body)}</div><div class="reply-controls"><button type="button" class="reply-link" data-reply-to="${safe(reply.id)}" data-reply-author="${safe(reply.author||'Trip member')}">Reply</button>${canModerate?`<button type="button" class="reply-delete" data-delete-reply="${safe(reply.id)}">Delete</button>`:''}</div>${childrenOf(reply.id).map(child=>renderNode(child,depth+1)).join('')}</article>`;
  const rendered=[...legacy.map(({reply,index})=>`<article class="forum-reply legacy-reply"><div class="reply-meta"><span class="thread-avatar">${safe(reply.author?.[0]||'M')}</span><b>${safe(reply.author||'Trip member')}</b></div><div class="reply-body">${forumContent(reply.body||'')}</div>${canModerate?`<button type="button" class="reply-delete" data-delete-legacy-reply data-thread-id="${safe(thread.id)}" data-reply-index="${index}">Delete</button>`:''}</article>`),...childrenOf('').map(reply=>renderNode(reply))];
  host.innerHTML=rendered.join('')||'<div class="empty-note">No messages yet. Add the first reply.</div>';
  const count=list.length+legacy.length;$('#reply-count').textContent=String(count);
}
function setReplyTarget(id,author){replyParentId=id||'';const banner=$('#replying-to');banner.classList.toggle('hidden',!id);$('#replying-to-copy').textContent=id?`Replying to ${author}`:'';$('#thread-reply-input').focus()}
async function sendForumReply(event){
  event.preventDefault();if(!activeTrip||!activeForumThreadId||!currentUser&&useSupabase||!isTripMember)return;
  const input=$('#thread-reply-input'),body=input.value.trim();if(!body)return;
  try{
    if(useSupabase){const {data,error}=await supabase.rpc('post_trip_forum_reply',{p_trip_id:activeTrip.id,p_thread_id:activeForumThreadId,p_parent_reply_id:replyParentId||null,p_body:body});if(error)throw error;if(data)forumThreadReplies.push(data);}
    else{forumThreadReplies.push({id:crypto.randomUUID(),parent_reply_id:replyParentId||null,author_id:currentUser?.id||'local-user',author:currentForumAuthor(),body,created_at:new Date().toISOString()});const thread=forumData().find(item=>String(item.id)===activeForumThreadId);if(thread){thread.replies=[...(thread.replies||[]).filter(reply=>!reply.id),...forumThreadReplies];writeTripData('forum',forumData())}}
    input.value='';previewForumReply();setReplyTarget('','');const thread=forumData().find(item=>String(item.id)===activeForumThreadId);renderThreadReplies(thread);
  }catch(error){console.error('Could not post reply.',error);alert(error.message||'Could not post your reply.')}
}

function paymentOwnerId(){return String(currentUser?.id||'local-user')}
function effectiveMethodOwner(method){return String(method?.owner_id||activeTrip?.owner_id||'local-user')}
let editingPaymentMethodIndex=null;
function renderPaymentMethodCards(methods){return methods.map((x,i)=>{const qr=safeWebUrl(x.qr),mine=!useSupabase||effectiveMethodOwner(x)===paymentOwnerId();return `<article class="method-card"><span class="method-rank">${i+1}</span><div class="method-card-copy"><b>${safe(x.mode)} · ${safe(x.name)}</b><small>${safe(x.number||'Contact the account holder')}${x.owner_name?` · ${safe(x.owner_name)}`:''}</small></div>${qr?`<a class="payment-qr-link" href="${qr}" target="_blank" rel="noopener"><img src="${qr}" alt="${safe(x.mode)} QR code"><span>View QR</span></a>`:''}${mine?`<div class="method-actions"><button type="button" class="light-button" data-edit-method="${i}">Edit</button><button type="button" class="member-remove" data-remove-method="${i}" aria-label="Remove ${safe(x.mode)} payment method">×</button></div>`:''}</article>`}).join('')}
function myPaymentMethods(){return (readTripData('methods',[])||[]).filter(method=>effectiveMethodOwner(method)===paymentOwnerId())}
function openPaymentMethodModal(index=null){editingPaymentMethodIndex=Number.isInteger(index)?index:null;const form=$('#payment-method-form');form?.reset();const item=editingPaymentMethodIndex===null?null:(readTripData('methods',[])||[])[editingPaymentMethodIndex];if(item&&effectiveMethodOwner(item)!==paymentOwnerId())return;$('#payment-modal-title').textContent=item?'Edit payment method':'Add payment method';form?.querySelector('[type="submit"]')?.replaceChildren(document.createTextNode(item?'Save changes':'Save method'));if(form&&item){form.elements.mode.value=item.mode||'';form.elements.name.value=item.name||'';form.elements.number.value=item.number||'';form.elements.qr.value=item.qr||''}openModal('payment-method-modal')}

function mountSettings(){
  document.querySelectorAll('[data-setting-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-setting-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-setting-panel]').forEach(x=>x.classList.toggle('hidden',x.dataset.settingPanel!==b.dataset.settingTab))});
  const main=$('main');
  if(main&&!$('#settings-modals'))main.insertAdjacentHTML('beforeend',`<div id="settings-modals">
    <div id="settings-unsaved-modal" class="lakbay-modal-backdrop hidden"><section class="lakbay-modal" role="dialog" aria-modal="true" aria-labelledby="settings-unsaved-title"><h2 id="settings-unsaved-title">Unsaved trip settings</h2><p>Your changes have not been saved.</p><div class="modal-actions"><button type="button" class="light-button" id="settings-discard-navigation">Discard</button><button type="button" class="action-button" id="settings-save-navigation">Save</button></div></section></div>
    <div id="payment-method-modal" class="lakbay-modal-backdrop hidden" data-close-modal><form class="lakbay-modal" id="payment-method-form" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="payment-modal-title">Add payment method</h2><p>Save the details your trip members can use to reimburse you.</p><label>Payment service<select name="mode" required><option value="">Choose a method</option><option>GCash</option><option>Maya</option><option>GoTyme</option><option>MariBank</option><option>BDO</option><option>BPI</option><option>Cash</option><option>Other</option></select></label><label>Account name<input name="name" autocomplete="name" required></label><label>Account number<input name="number" autocomplete="off"></label><label>QR image URL <span class="optional-label">Optional</span><input name="qr" type="url" placeholder="https://…"></label><div class="modal-actions"><button type="button" class="light-button" data-dismiss-modal>Cancel</button><button class="action-button" type="submit">Save method</button></div></form></div>
    <div id="guest-modal" class="lakbay-modal-backdrop hidden" data-close-modal><form class="lakbay-modal" id="guest-form" role="dialog" aria-modal="true" aria-labelledby="guest-modal-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="guest-modal-title">Add a guest</h2><p>Add someone who will participate without a Lakbay account.</p><label>Guest name<input name="name" required maxlength="60" autocomplete="off" placeholder="Name"></label><div class="modal-actions"><button type="button" class="light-button" data-dismiss-modal>Cancel</button><button class="action-button" type="submit">Add person</button></div></form></div>
    <div id="group-modal" class="lakbay-modal-backdrop hidden" data-close-modal><form class="lakbay-modal group-modal" id="group-form" role="dialog" aria-modal="true" aria-labelledby="group-modal-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="group-modal-title">Create a people group</h2><p>Choose trip members to include in this group.</p><label>Group name<input name="name" required maxlength="60" placeholder="e.g. Roommates"></label><label>Search people<input id="group-member-search" type="search" placeholder="Search trip members"></label><div class="group-selection-summary" id="group-selection-summary">No members selected</div><div class="group-member-options" id="group-member-options"></div><div class="modal-actions"><button type="button" class="light-button" data-dismiss-modal>Cancel</button><button class="action-button" type="submit">Save group</button></div></form></div>
  </div>`);
  const persistSettings=async()=>{if(!activeTrip)return false;activeTrip.destination=$('#setting-name').value.trim()||activeTrip.destination;workspaceData().icon_url=$('#setting-icon-url').value.trim()||'';workspaceData().start_date=$('#setting-start').value||null;workspaceData().end_date=$('#setting-end').value||null;workspaceData().admin_permissions={...(workspaceData().admin_permissions||{}),showcase_forum:$('#permission-showcase-forum')?.checked!==false};try{await updateTrip(activeTrip);settingsDraft=null;localStorage.removeItem(`lakbay_${activeTrip.id}_settings_return_view`);refreshWorkspace();refreshTripSwitcher();showToast('Trip settings saved.','success');return true}catch(error){console.error('Could not save trip settings.',error);showToast(error.message||'Could not save trip settings.','error');return false}};
  const saveAndReturn=async()=>{const saved=await persistSettings();if(saved){$('#settings-unsaved-modal')?.classList.add('hidden');applyPendingSettingsNavigation()}};
  $('#save-settings-btn')?.addEventListener('click',saveAndReturn);
  $('#settings-save-navigation')?.addEventListener('click',saveAndReturn);
  $('#settings-discard-navigation')?.addEventListener('click',()=>{if(settingsDraft&&activeTrip&&settingsDraft.tripId===String(activeTrip.id)){activeTrip.destination=settingsDraft.destination;activeTrip.workspace_data=JSON.parse(JSON.stringify(settingsDraft.workspace));localStorage.setItem(`lakbay_${activeTrip.id}_workspace_data`,JSON.stringify(activeTrip.workspace_data));for(const name of ['people','groups','methods'])localStorage.setItem(key(name),JSON.stringify(readTripData(name,[])));}settingsDraft=null;$('#settings-unsaved-modal')?.classList.add('hidden');refreshWorkspace();applyPendingSettingsNavigation()});
  $('#settings-unsaved-modal')?.addEventListener('click',event=>{if(event.target.id==='settings-unsaved-modal')event.currentTarget.classList.add('hidden')});
  $('#add-person-btn')?.addEventListener('click',()=>openModal('guest-modal'));
  $('#add-group-btn')?.addEventListener('click',()=>openGroupModal());
  $('#add-payment-method')?.addEventListener('click',()=>{if(myPaymentMethods().length>=5)return alert('You can add up to five payment methods to this trip.');openPaymentMethodModal()});
  document.addEventListener('click',event=>{const edit=event.target.closest('[data-edit-method]');if(edit)openPaymentMethodModal(Number(edit.dataset.editMethod))});
  $('#copy-trip-link')?.addEventListener('click',()=>{navigator.clipboard?.writeText(location.origin+location.pathname+'?invite='+activeTrip?.id);});
  $('#payment-method-form')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form),methods=readTripData('methods',[]),editing=editingPaymentMethodIndex!==null;const existing=editing?methods[editingPaymentMethodIndex]:null;if(editing&&(!existing||effectiveMethodOwner(existing)!==paymentOwnerId()))return;if(!editing&&myPaymentMethods().length>=5){alert('You can add up to five payment methods to this trip.');return}const method={...(existing||{}),id:existing?.id||crypto.randomUUID(),owner_id:existing?.owner_id||paymentOwnerId(),owner_name:existing?.owner_name||currentForumAuthor(),mode:String(data.get('mode')),name:String(data.get('name')).trim(),number:String(data.get('number')).trim(),qr:String(data.get('qr')).trim()};if(editing)methods[editingPaymentMethodIndex]=method;else methods.push(method);writeTripData('methods',methods);editingPaymentMethodIndex=null;form.reset();closeModal('payment-method-modal');renderSettings()});
  $('#guest-form')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,name=new FormData(form).get('name').toString().trim();if(!name)return;const people=readTripData('people',[]);people.push({id:`guest-${crypto.randomUUID()}`,name,guest:true});tripPeopleCache=[];writeTripData('people',people);form.reset();closeModal('guest-modal');renderSettings()});
  $('#group-form')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form),groups=normalizeGroups(readTripData('groups',[])),id=form.dataset.editId;const group={id:id||`group-${crypto.randomUUID()}`,name:String(data.get('name')).trim(),members:[...selectedGroupMembers]};if(!group.name)return;const old=groups.findIndex(x=>x.id===id);if(old>=0)groups[old]=group;else groups.push(group);writeTripData('groups',groups);form.reset();delete form.dataset.editId;selectedGroupMembers=new Set();closeModal('group-modal');renderSettings()});
  $('#group-member-search')?.addEventListener('input',renderGroupCandidates);
  $('#group-member-options')?.addEventListener('click',e=>{const row=e.target.closest('[data-group-member]');if(!row)return;const id=row.dataset.groupMember;selectedGroupMembers.has(id)?selectedGroupMembers.delete(id):selectedGroupMembers.add(id);renderGroupCandidates()});
  $('#groups-list')?.addEventListener('click',e=>{const edit=e.target.closest('[data-edit-group]'),del=e.target.closest('[data-delete-group]');if(edit){openGroupModal(edit.dataset.editGroup);return}if(del){writeTripData('groups',normalizeGroups(readTripData('groups',[])).filter(g=>g.id!==del.dataset.deleteGroup));renderSettings()}});
  $('#setting-icon-url')?.addEventListener('input',e=>renderIconPreview(e.target.value));
}
let selectedGroupMembers=new Set();
let tripPeopleCache=[];
async function loadTripPeople(){
  const users=[];
  if(currentUser)users.push({id:String(currentUser.id),name:discordUsername()||currentUser.user_metadata?.display_name||currentUser.user_metadata?.full_name||'You',avatar:currentUser.user_metadata?.avatar_url||currentUser.user_metadata?.picture||'',guest:false});
  (activeTrip?.public_members||[]).forEach(person=>{if(person?.id&&!users.some(user=>user.id===String(person.id)))users.push({id:String(person.id),name:person.name||'Trip member',avatar:person.avatar||'',guest:false})});
  if(!users.length&&activeTrip&&['public_view','public_edit'].includes(activeTrip.visibility)&&activeTrip.owner_id)users.push({id:String(activeTrip.owner_id),name:activeTrip.owner_name||'Trip organizer',avatar:activeTrip.owner_avatar||'',guest:false});
  else if(!useSupabase)users.push({id:'me',name:'You',guest:false});
  if(useSupabase&&activeTrip){
    try{
      if(['public_view','public_edit'].includes(activeTrip.visibility)){
        try{
          const publicTrip=await getPublicTripView(activeTrip.invite_code||activeTrip.id);
          (publicTrip?.public_members||[]).forEach(person=>{
            if(person?.id&&!users.some(user=>user.id===String(person.id)))users.push({id:String(person.id),name:person.name||'Trip member',avatar:person.avatar||'',guest:false});
          });
        }catch(error){console.warn('Could not load public trip member details.',error)}
      }
      const [{data:owner},{data:members}]=await Promise.all([
        supabase.from('profiles').select('id, username').eq('id',activeTrip.owner_id).maybeSingle(),
        supabase.from('trip_members').select('user_id, pending_username, role, profiles(id, username)').eq('trip_id',activeTrip.id)
      ]);
      if(owner&&!users.some(u=>u.id===String(owner.id)))users.push({id:String(owner.id),name:owner.username||'Trip owner',avatar:'',guest:false});
      (members||[]).forEach(row=>{
        const profile=Array.isArray(row.profiles)?row.profiles[0]:row.profiles;
        if(profile&&!users.some(u=>u.id===String(profile.id)))users.push({id:String(profile.id),name:profile.username||'Trip member',avatar:'',guest:false});
        else if(row.user_id&&!users.some(u=>u.id===String(row.user_id)))users.push({id:String(row.user_id),name:String(row.user_id)===String(currentUser?.id)?discordUsername()||'You':'Trip member',avatar:'',guest:false});
        else if(!row.user_id&&row.pending_username&&!users.some(u=>normalizePersonName(u.name)===normalizePersonName(row.pending_username)))users.push({id:`pending-${row.pending_username}`,name:row.pending_username,avatar:'',guest:true});
      });
      try{const ids=users.map(user=>user.id).filter(id=>id!=='me');if(ids.length){const {data:avatars}=await supabase.from('profiles').select('id, avatar_url').in('id',ids);(avatars||[]).forEach(profile=>{const user=users.find(item=>item.id===String(profile.id));if(user&&profile.avatar_url)user.avatar=profile.avatar_url})}}catch{}
    }catch(error){console.warn('Could not load trip members for selection.',error)}
  }
  const guests=(readTripData('people',[])||[]).filter(person=>!person.linked_user_id&&!users.some(user=>String(user.id)===String(person.id))).map((person,index)=>({id:String(person.id||`guest-${index}-${person.name}`),name:person.name||'Guest',avatar:person.avatar||'',guest:true}));
  tripPeopleCache=[...users,...guests];return tripPeopleCache;
}
function openModal(id){const modal=$(`#${id}`);modal?.classList.remove('hidden');modal?.querySelector('input:not([type="hidden"]),select,textarea,button:not(.modal-x):not([data-dismiss-modal])')?.focus()}
function closeModal(id){$(`#${id}`)?.classList.add('hidden')}
function mountModalDismissal(){document.addEventListener('click',e=>{const close=e.target.closest('[data-dismiss-modal]');if(close){closeModal(close.closest('.lakbay-modal-backdrop')?.id);return}if(e.target.matches('[data-close-modal]')){if(e.target.id==='expense-backdrop')$('#close-expense-btn')?.click();else closeModal(e.target.id);return}if(e.target.id==='modal-backdrop')$('#close-modal-btn')?.click();else if(e.target.id==='day-backdrop')$('#close-day-btn')?.click();else if(e.target.id==='activity-backdrop')$('#close-act-btn')?.click();else if(e.target.id==='note-backdrop')$('#close-note-btn')?.click();else if(e.target.id==='share-backdrop')$('#close-share-btn')?.click();else if(e.target.id==='expense-backdrop')$('#close-expense-btn')?.click();else if(e.target.id==='invite-popup-backdrop')$('#decline-invite-btn')?.click();else if(e.target.id==='join-trip-modal')$('#close-join-modal')?.click();else if(e.target.id==='thread-composer')e.target.classList.add('hidden')})}
function normalizeGroups(items){return (Array.isArray(items)?items:[]).map((item,index)=>typeof item==='string'?{id:`legacy-${index}-${item}`,name:item,members:[]}:{...item,id:item.id||`group-${index}`,name:item.name||'Group',members:Array.isArray(item.members)?item.members:[]})}
function tripPeople(){if(tripPeopleCache.length)return tripPeopleCache;const guests=(readTripData('people',[])||[]).map((person,index)=>({id:String(person.id||`guest-${index}-${person.name}`),name:person.name||'Guest',avatar:person.avatar||'',guest:true}));const ownName=currentUser?.user_metadata?.display_name||currentUser?.user_metadata?.full_name||currentUser?.user_metadata?.username||'You';return [{id:String(currentUser?.id||(!useSupabase?'me':'self')),name:ownName,guest:false},...guests]}
async function openGroupModal(groupId){await loadTripPeople();const form=$('#group-form'),group=normalizeGroups(readTripData('groups',[])).find(x=>x.id===groupId);form.reset();form.dataset.editId=groupId||'';$('#group-modal-title').textContent=group?'Edit people group':'Create a people group';form.elements.name.value=group?.name||'';selectedGroupMembers=new Set(group?.members||[]);renderGroupCandidates();openModal('group-modal')}
function renderGroupCandidates(){const people=tripPeople(),search=($('#group-member-search')?.value||'').toLowerCase();$('#group-selection-summary').textContent=selectedGroupMembers.size?`${selectedGroupMembers.size} selected · click a name to remove it`: 'No members selected';$('#group-member-options').innerHTML=people.filter(p=>p.name.toLowerCase().includes(search)).map(p=>`<button type="button" class="group-member-option${selectedGroupMembers.has(p.id)?' is-selected':''}" data-group-member="${safe(p.id)}"><span class="member-avatar${p.guest?' guest':''}">${safe(p.name[0]?.toUpperCase()||'?')}</span><span>${safe(p.name)}</span><span class="member-check">${selectedGroupMembers.has(p.id)?'✓':'＋'}</span></button>`).join('')||'<div class="empty-note">No matching people.</div>'}
function renderIconPreview(url){const preview=$('#trip-icon-preview');if(!preview)return;let valid='';try{const parsed=new URL(url,location.href);if(['http:','https:'].includes(parsed.protocol)&&url.trim())valid=parsed.href}catch{}preview.innerHTML=valid?`<img src="${safe(valid)}" alt="Trip icon preview"><span>Preview</span>`:'<span class="icon-preview-empty">Trip initials will be used when no image is set.</span>'}
async function renderSettingsPeople(){
  const host=$('#people-list');if(!host||!activeTrip)return;
  const tripId=String(activeTrip.id),users=await loadTripPeople();if(!activeTrip||String(activeTrip.id)!==tripId)return;
  const ownerId=String(activeTrip.owner_id||'');
  host.innerHTML=users.map(person=>{
    const name=person.name||'Trip member',avatar=person.avatar?`<img src="${safe(person.avatar)}" alt="">`:safe(name[0]?.toUpperCase()||'?');
    const status=person.guest?'Guest · not on Lakbay':String(person.id)===ownerId?'Trip owner':'Trip member';
    return `<div class="member-row"><span class="member-avatar${person.guest?' guest':''}${person.avatar?' has-image':''}">${avatar}</span><b>${safe(name)}</b><small>${safe(status)}</small>${person.guest?`<button class="member-remove" data-remove-person="${safe(person.id)}" aria-label="Remove ${safe(name)}">×</button>`:''}</div>`;
  }).join('')||'<div class="empty-note">No trip members yet.</div>';
  host.querySelectorAll('[data-remove-person]').forEach(button=>button.onclick=()=>{
    const people=readTripData('people',[]).filter(person=>String(person.id)!==button.dataset.removePerson);
    writeTripData('people',people);tripPeopleCache=[];void renderSettingsPeople();
  });
}
function renderSettings(){if(!activeTrip)return;if($('#permission-showcase-forum')){if(!settingsDraft||settingsDraft.tripId!==String(activeTrip.id)||window.lakbayCurrentView!=='settings')$('#permission-showcase-forum').checked=workspaceData().admin_permissions?.showcase_forum!==false;$('#permission-showcase-forum').disabled=activeUserRole!=='owner'}if(!settingsDraft||settingsDraft.tripId!==String(activeTrip.id)||window.lakbayCurrentView!=='settings'){$('#setting-name').value=activeTrip.destination||'';$('#setting-icon-url').value=workspaceData().icon_url||'';$('#setting-start').value=workspaceData().start_date||'';$('#setting-end').value=workspaceData().end_date||'';}renderIconPreview($('#setting-icon-url').value);$('#trip-link').value=location.origin+location.pathname+'?invite='+activeTrip.id;void renderSettingsPeople();const groups=normalizeGroups(readTripData('groups',[]));if($('#groups-list'))$('#groups-list').innerHTML=groups.length?groups.map(g=>`<div class="group-row"><div><b>${safe(g.name)}</b><small>${g.members.length} ${g.members.length===1?'person':'people'}</small></div><button class="light-button" data-edit-group="${safe(g.id)}">Edit</button><button class="member-remove" data-delete-group="${safe(g.id)}" aria-label="Delete ${safe(g.name)}">×</button></div>`).join(''):'<div class="empty-note">No groups yet.</div>';const methods=readTripData('methods',[]);if($('#payment-method-list'))$('#payment-method-list').innerHTML=methods.length?renderPaymentMethodCards(methods):'<div class="empty-note">No payment methods have been added.</div>';const addMethod=$('#add-payment-method'),budgetAddMethod=$('#add-payment-method-budget');for(const button of [addMethod,budgetAddMethod])if(button){const count=myPaymentMethods().length;button.disabled=count>=5;button.textContent=count>=5?'Maximum reached (5/5)':`＋ Add payment method (${count}/5)`;button.classList.toggle('hidden',!isTripMember||(useSupabase&&!currentUser))}const budgetMethods=$('#budget-payment-method-list');if(budgetMethods)budgetMethods.innerHTML=methods.length?renderPaymentMethodCards(methods):'<div class="empty-note">No payment methods have been added.</div>';$('#budget-payment-methods-panel')?.classList.toggle('hidden',!isTripMember||(useSupabase&&!currentUser));document.querySelectorAll('#payment-method-list [data-remove-method],#budget-payment-method-list [data-remove-method]').forEach(button=>button.onclick=()=>{const next=readTripData('methods',[]),method=next[Number(button.dataset.removeMethod)];if(useSupabase&&effectiveMethodOwner(method)!==paymentOwnerId())return;next.splice(Number(button.dataset.removeMethod),1);writeTripData('methods',next);renderSettings()})}

function ensureInviteCodeField(){
  const link=$('#trip-link')?.closest('label');
  if(!link||$('#invite-code-display'))return;
  const label=document.createElement('label');
  label.innerHTML='Invite code<div class="inline-field"><input id="invite-code-display" readonly><button type="button" id="copy-invite-code" class="light-button">Copy code</button></div>';
  link.after(label);
  $('#copy-invite-code').onclick=async()=>{await navigator.clipboard?.writeText($('#invite-code-display').value);};
}

function mountProfile(){
  const name=$('#profile-name'),bio=$('#profile-bio'),preview=$('#profile-preview'),upload=$('#profile-upload');
  if(!name)return;
  const profileStorageKey=()=>currentUser?.id?`lakbay_profile_${currentUser.id}`:'lakbay_profile';
  const loadSavedProfile=()=>{
    let saved={};
    try{saved=JSON.parse(localStorage.getItem(profileStorageKey())||'{}')}catch{}
    name.value=saved.name||currentUser?.user_metadata?.display_name||currentUser?.user_metadata?.full_name||'';
    bio.value=saved.bio||currentUser?.user_metadata?.bio||'';
    const photo=saved.photo||currentUser?.user_metadata?.avatar_url||'';
    if(photo)preview.src=photo;else preview.removeAttribute('src');
    upload.value='';
  };
  loadSavedProfile();
  document.addEventListener('lakbay:profile-opened',loadSavedProfile);
  upload.onchange=e=>{
    const f=e.target.files?.[0];if(!f)return;
    if(f.size>5*1024*1024){alert('Please choose an image under 5 MB.');upload.value='';return;}
    const reader=new FileReader();
    reader.onload=()=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,512/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);preview.src=canvas.toDataURL('image/jpeg',.76)};img.src=reader.result};
    reader.readAsDataURL(f);
  };
  $('#discard-profile-btn').onclick=()=>{loadSavedProfile();returnFromProfile();};
  $('#save-profile-btn').onclick=async()=>{
    const profile={name:name.value.trim(),bio:bio.value.trim(),photo:preview.getAttribute('src')||''};
    try{
      if(useSupabase&&currentUser){const {error}=await supabase.auth.updateUser({data:{display_name:profile.name,bio:profile.bio,avatar_url:profile.photo}});if(error)throw error;}
      localStorage.setItem(profileStorageKey(),JSON.stringify(profile));
      returnFromProfile();
      alert('Profile saved.');
    }catch(error){console.error('Could not save profile.',error);alert(error?.message||'Could not save your profile. Please try again.');}
  };
}

function calculateTripBalances(users){
  const balances=new Map(users.map(user=>[String(user.id),0]));
  for(const expense of (activeTrip?.expenses||[])){
    const amount=Number(expense.amount)||0,shares=(Array.isArray(expense.split_between)?expense.split_between:[]).map(String);
    if(!shares.length)continue;
    const payer=String(expense.payer_id||'');if(balances.has(payer))balances.set(payer,balances.get(payer)+amount);
    shares.forEach(id=>{if(balances.has(id))balances.set(id,balances.get(id)-amount/shares.length)});
  }
  for(const payment of (readTripData('payments',[])||[])){
    const from=users.find(user=>payment.from_id&&String(user.id)===String(payment.from_id))||users.find(user=>user.name.toLowerCase()===String(payment.from||'').toLowerCase());
    const to=users.find(user=>payment.to_id&&String(user.id)===String(payment.to_id))||users.find(user=>user.name.toLowerCase()===String(payment.to||'').toLowerCase());
    const amount=Math.max(0,Number(payment.amount)||0);
    if(from&&to&&from.id!==to.id){balances.set(String(from.id),(balances.get(String(from.id))||0)+amount);balances.set(String(to.id),(balances.get(String(to.id))||0)-amount)}
  }
  return balances;
}
function suggestedSettlements(users,balances=calculateTripBalances(users)){
  const debtors=users.map(user=>({id:String(user.id),amount:-(balances.get(String(user.id))||0)})).filter(user=>user.amount>.05);
  const creditors=users.map(user=>({id:String(user.id),amount:balances.get(String(user.id))||0})).filter(user=>user.amount>.05);
  const transactions=[];let debtorIndex=0,creditorIndex=0;
  while(debtorIndex<debtors.length&&creditorIndex<creditors.length){
    const debtor=debtors[debtorIndex],creditor=creditors[creditorIndex],amount=Math.min(debtor.amount,creditor.amount);
    if(amount>.005)transactions.push({from:debtor.id,to:creditor.id,amount:Math.round(amount*100)/100});
    debtor.amount-=amount;creditor.amount-=amount;
    if(debtor.amount<.005)debtorIndex++;
    if(creditor.amount<.005)creditorIndex++;
  }
  return transactions;
}
function resolvePaymentParty(payment,field,users){
  const id=payment?.[`${field}_id`];
  if(id!=null){const match=users.find(user=>String(user.id)===String(id));if(match)return match}
  const name=String(payment?.[field]||'').trim().toLocaleLowerCase();
  const matches=users.filter(user=>String(user.name||'').trim().toLocaleLowerCase()===name);
  return matches.length===1?matches[0]:null;
}
async function openMyPayModal(){
  if(!activeTrip||!currentUser||!isTripMember)return;
  const users=await loadTripPeople(),balances=calculateTripBalances(users),me=String(currentUser.id);
  const owing=suggestedSettlements(users,balances).filter(item=>item.from===me);
  let modal=$('#my-pay-modal');
  if(!modal){$('main').insertAdjacentHTML('beforeend','<div id="my-pay-modal" class="lakbay-modal-backdrop hidden" data-close-modal><section class="lakbay-modal my-pay-dialog" role="dialog" aria-modal="true" aria-labelledby="my-pay-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="my-pay-title">Pay trip members</h2><p>Settle the balances you owe using a member’s shared payment details.</p><div id="my-pay-content"></div></section></div>');modal=$('#my-pay-modal')}
  const methods=readTripData('methods',[]);
  $('#my-pay-content').innerHTML=owing.length?`<div class="my-pay-list">${owing.map(item=>{
    const person=users.find(user=>String(user.id)===item.to),personMethods=methods.filter(method=>effectiveMethodOwner(method)===item.to);
    const paymentDetails=personMethods.length?personMethods.map(method=>{const qr=safeWebUrl(method.qr);return `<div class="my-pay-method"><div><strong>${safe(method.mode||'Payment method')} · ${safe(method.name||person?.name||'')}</strong><small>${safe(method.number||'Contact the account holder')}${method.owner_name?` · ${safe(method.owner_name)}`:''}</small></div>${qr?`<a class="light-button my-pay-qr" href="${qr}" target="_blank" rel="noopener">View QR</a>`:''}</div>`}).join(''):'<div class="empty-note">No payment details have been shared yet.</div>';
    return `<article class="my-pay-person"><div class="my-pay-person-head"><div><h3>${safe(person?.name||'Trip member')}</h3><p>You owe <strong>${money(item.amount)}</strong></p></div><button type="button" class="action-button" data-log-my-payment="${safe(item.to)}" data-amount="${item.amount.toFixed(2)}">Log payment</button></div><div class="my-pay-methods">${paymentDetails}</div></article>`;
  }).join('')}</div>`:'<div class="empty-note my-pay-settled">You have no outstanding balances to pay.</div>';
  openModal('my-pay-modal');
}
async function openMySummaryModal(){
  if(!activeTrip||!currentUser||!isTripMember)return;
  const users=await loadTripPeople(),me=String(currentUser.id),myPerson=users.find(user=>String(user.id)===me),expenses=activeTrip.expenses||[],payments=readTripData('payments',[]),balances=calculateTripBalances(users),balance=balances.get(me)||0;
  const expenseRows=expenses.filter(expense=>String(expense.payer_id||'')===me||(Array.isArray(expense.split_between)&&expense.split_between.map(String).includes(me))).map(expense=>{
    const participants=(Array.isArray(expense.split_between)?expense.split_between:[]).map(String),share=participants.includes(me)?Number(expense.amount||0)/Math.max(1,participants.length):null;
    const paidBy=users.find(user=>String(user.id)===String(expense.payer_id))?.name||'Trip member';
    const shareText=share===null?'Not in split':`${safe(money(expense.amount))} ÷ ${participants.length} = ${safe(money(share))}`;
    return `<article class="my-summary-row"><div><strong>${safe(expense.title||'Expense')}</strong><small>${safe(money(expense.amount))} total · ${participants.length} ${participants.length===1?'person':'people'} sharing · Your share: ${shareText} · Paid by ${safe(paidBy)}</small></div><b>${share===null?'Payer only':`${safe(money(share))} share`}</b></article>`;
  });
  const paymentRows=payments.flatMap(payment=>{
    const from=resolvePaymentParty(payment,'from',users),to=resolvePaymentParty(payment,'to',users);
    if(!from||!to)return[];
    const outgoing=String(from.id)===me,incoming=String(to.id)===me;if(!outgoing&&!incoming)return[];
    const other=outgoing?to:from,date=payment.date?new Date(payment.date).toLocaleDateString():'';
    return [`<article class="my-summary-row"><div><strong>${outgoing?'You paid':'Received from'} ${safe(other.name)}</strong><small>${safe(payment.mode||'Payment')}${date?` · ${safe(date)}`:''}${payment.ref?` · Ref ${safe(payment.ref)}`:''}</small></div><b class="${outgoing?'summary-credit':'summary-debit'}">${outgoing?'+':'−'}${safe(money(payment.amount))}</b></article>`];
  });
  const paidTotal=expenses.filter(item=>String(item.payer_id||'')===me).reduce((sum,item)=>sum+Number(item.amount||0),0);
  const shareTotal=expenses.reduce((sum,item)=>{const list=(Array.isArray(item.split_between)?item.split_between:[]).map(String);return sum+(list.includes(me)?Number(item.amount||0)/Math.max(1,list.length):0)},0);
  const paidOut=payments.reduce((sum,item)=>sum+(String(resolvePaymentParty(item,'from',users)?.id||'')===me?Number(item.amount)||0:0),0);
  const received=payments.reduce((sum,item)=>sum+(String(resolvePaymentParty(item,'to',users)?.id||'')===me?Number(item.amount)||0:0),0);
  let modal=$('#my-summary-modal');
  if(!modal){$('main').insertAdjacentHTML('beforeend','<div id="my-summary-modal" class="lakbay-modal-backdrop hidden" data-close-modal><section class="lakbay-modal my-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="my-summary-title"><button type="button" class="modal-x" data-dismiss-modal aria-label="Close">×</button><h2 id="my-summary-title">Your trip summary</h2><p id="my-summary-description"></p><div id="my-summary-content"></div></section></div>');modal=$('#my-summary-modal')}
  $('#my-summary-description').textContent=`A detailed balance breakdown for ${myPerson?.name||'you'}.`;
  const balanceLabel=Math.abs(balance)<=.05?'Settled':balance>0?`You are owed ${money(balance)}`:`You owe ${money(Math.abs(balance))}`;
  $('#my-summary-content').innerHTML=`<div class="my-summary-totals"><div><small>Expenses you paid</small><strong>+${money(paidTotal)}</strong></div><div><small>Your expense shares</small><strong>−${money(shareTotal)}</strong></div><div><small>Payments made</small><strong>+${money(paidOut)}</strong></div><div><small>Payments received</small><strong>−${money(received)}</strong></div></div><div class="my-summary-balance"><span>Effective balance</span><strong class="${Math.abs(balance)<=.05?'summary-settled':balance>0?'summary-credit':'summary-debit'}">${balanceLabel}</strong><small>Expenses paid − your shares + payments made − payments received</small></div><section class="my-summary-section"><h3>Expenses you are part of</h3><div class="my-summary-list">${expenseRows.join('')||'<div class="empty-note">No expenses include you yet.</div>'}</div></section><section class="my-summary-section"><h3>Payments made and received</h3><div class="my-summary-list">${paymentRows.join('')||'<div class="empty-note">No payments recorded for you yet.</div>'}</div></section>`;
  openModal('my-summary-modal');
}
async function renderOverviewMembers(){
  const host=$('#overview-members-list');if(!host)return;
  const users=await loadTripPeople();const groups=normalizeGroups(readTripData('groups',[]));const balances=calculateTripBalances(users);
  host.innerHTML=users.map(user=>{const balance=balances.get(String(user.id))||0;const settled=Math.abs(balance)<=.05;const status=settled?'settled':balance>0?'owed':'owes';const groupNames=groups.filter(group=>group.members.map(String).includes(String(user.id))).map(group=>group.name);const avatar=user.avatar?`<img src="${safe(user.avatar)}" alt="">`:safe(user.name?.[0]?.toUpperCase()||'?');return `<article class="overview-member-row"><span class="overview-member-avatar ${user.avatar?'has-image':''}">${avatar}</span><span class="overview-member-copy"><b>${safe(user.name)}</b><small>${groupNames.length?safe(groupNames.join(' · ')):'No group'}</small></span><strong class="member-balance ${status}">${settled?'Settled':`${balance>0?'+':'−'}${money(Math.abs(balance))}`}</strong></article>`}).join('')||'<div class="empty-note">No trip members yet.</div>';
}
function renderOverviewShowcase(items=forumData()){
  const host=$('#overview-showcase-content');if(!host)return;
  const thread=items.find(item=>item.showcased);
  if(!thread){host.innerHTML='<div class="empty-note">No discussion is featured yet.</div>';return}
  host.innerHTML=`<article class="overview-featured-thread"><div class="overview-featured-trigger" role="button" tabindex="0" data-overview-thread="${safe(thread.id)}"><strong>${safe(thread.title)}</strong><div class="overview-featured-body md-content">${forumContent(thread.body||'')}</div></div><small>${safe(thread.author||'Trip member')} · ${thread.date?new Date(thread.date).toLocaleDateString():''}</small></article>`;
}
function updateOverviewCountdown(){
  const counter=$('#overview-countdown');if(!counter||!activeTrip)return;
  const days=activeTrip.days||[],start=workspaceData().start_date||days.map(day=>day.date).filter(Boolean).sort()[0];
  if(!start){counter.textContent='—';return}
  const target=new Date(`${start}T00:00:00`).getTime(),remaining=target-Date.now();
  if(remaining<=0){counter.textContent=remaining>-86400000?'Today':'Trip started';return}
  const seconds=Math.floor(remaining/1000),d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  counter.textContent=`${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}
async function refreshWorkspace(){
  if(!activeTrip)return;browsingAllTrips=false;
  $('#sidebar-trip-name')?.replaceChildren(document.createTextNode(activeTrip.destination||'Choose a trip'));
  if($('#setting-name'))$('#setting-name').value=activeTrip.destination||'';
  renderFood();renderPayments();renderForum();renderSettings();
  if($('#invite-code-display'))$('#invite-code-display').value=activeTrip.invite_code||String(activeTrip.id);
  const days=activeTrip.days||[],expenses=activeTrip.expenses||[];
  $('#plan-count')?.replaceChildren(document.createTextNode(String(days.length)));
  $('#budget-total-spent')?.replaceChildren(document.createTextNode(money(expenses.reduce((sum,row)=>sum+Number(row.amount||0),0))));
  $('#active-trip-title').textContent=activeTrip.destination||'Your trip';
  $('#active-trip-emoji').innerHTML=workspaceData().icon_url?`<img src="${safe(workspaceData().icon_url)}" alt="">`:safe(activeTrip.emoji||'✈️');
  $('#overview-day-count').textContent=`${days.length} ${days.length===1?'day':'days'}`;
  const users=await loadTripPeople(),balances=calculateTripBalances(users),myBalance=balances.get(String(currentUser?.id||'me'))||0;
  const publicGuest=!currentUser&&['public_view','public_edit'].includes(activeTrip.visibility);$('#overview-balance').textContent=money(publicGuest?expenses.reduce((sum,row)=>sum+Number(row.amount||0),0):myBalance);$('#overview-balance')?.parentElement?.querySelector('small')?.replaceChildren(document.createTextNode(publicGuest?'Expenses logged':'Your balance'));
  const start=workspaceData().start_date||days.map(day=>day.date).filter(Boolean).sort()[0];
  $('#active-trip-date-copy').textContent=start?new Date(`${start}T00:00:00`).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}):'Add trip dates in settings to start your countdown.';
  updateOverviewCountdown();void renderOverviewMembers();renderOverviewShowcase();
  $('#active-trip-overview').classList.remove('hidden');$('.trip-browser-hero')?.classList.add('hidden');$('#trip-list')?.classList.add('hidden');$('.legacy-heading.trip-browser')?.classList.add('hidden');$('#trip-search-controls')?.classList.add('hidden');
}
