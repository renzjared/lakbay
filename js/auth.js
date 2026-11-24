import { supabase, useSupabase, getTrip, getTripLinkPreview, getPublicTripView } from './storage.js';
import { loadTripDays } from './itinerary.js';
import { switchView } from './ui.js';

export let currentUser = null;
let inviteCountdownTimer = null;
let publicTripPreviewSequence = 0;

const OAUTH_ERROR_PARAMS = ['error', 'error_description', 'error_code'];
function removeOAuthErrorParams(url) {
  let changed = false;
  for (const key of OAUTH_ERROR_PARAMS) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  }
  if (url.hash.length > 1) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    let hashChanged = false;
    for (const key of OAUTH_ERROR_PARAMS) {
      if (hashParams.has(key)) { hashParams.delete(key); hashChanged = true; }
    }
    if (hashChanged) { url.hash = hashParams.size ? hashParams.toString() : ''; changed = true; }
  }
  return changed;
}
function cleanCallbackAddress(url, { removeCode = false, removeHash = false } = {}) {
  let changed = removeOAuthErrorParams(url);
  if (removeCode && (url.searchParams.has('code') || url.searchParams.has('state'))) {
    url.searchParams.delete('code'); url.searchParams.delete('state'); changed = true;
  }
  if (removeHash && url.hash) { url.hash = ''; changed = true; }
  if (changed) window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

const DOM = {
  loginBtn: document.getElementById('login-discord-btn'),
  mobileLoginBtn: document.getElementById('mobile-login-btn'),
  profileDiv: document.getElementById('user-profile-display'),
  avatar: document.getElementById('user-avatar'),
  name: document.getElementById('user-name'),
  logoutBtn: document.getElementById('logout-btn')
};

export async function initAuth() {
  if (!useSupabase) return;

  const callbackUrl = new URL(window.location.href);
  const initialHashParams = new URLSearchParams(callbackUrl.hash.slice(1));
  const callbackError = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error') || initialHashParams.get('error_description') || initialHashParams.get('error');
  // Remove stale provider errors before supabase-js examines the URL. Keep the
  // invite and PKCE code parameters intact so the intended callback can finish.
  if (removeOAuthErrorParams(callbackUrl)) window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);

  // Defer application work until Supabase releases its auth lock. Auth callbacks
  // must stay synchronous because handleSession may make additional API calls.
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => { void handleSession(session); }, 0);
  });

  let { data: { session }, error: sessionError } = await supabase.auth.getSession();
  const authCode = callbackUrl.searchParams.get('code');
  if (!session && authCode) {
    try {
      const result = await supabase.auth.exchangeCodeForSession(authCode);
      session = result.data?.session || null;
      sessionError = result.error || sessionError;
      if (session) {
        cleanCallbackAddress(new URL(window.location.href), { removeCode: true, removeHash: true });
      }
    } catch (error) {
      sessionError = error;
    }
  }
  if (session) {
    window.lakbayAuthErrorMessage = '';
    cleanCallbackAddress(new URL(window.location.href), { removeCode: true, removeHash: true });
  } else if (callbackError) {
    window.lakbayAuthErrorMessage = 'Discord sign-in was denied or canceled. Try again. If you approved the request, check that Lakbay is still authorized in Discord.';
    cleanCallbackAddress(new URL(window.location.href), { removeCode: true, removeHash: true });
  } else if (sessionError) {
    window.lakbayAuthErrorMessage = 'Your sign-in could not be restored. Please try Discord sign-in again.';
    cleanCallbackAddress(new URL(window.location.href), { removeCode: true, removeHash: true });
  }
  if (sessionError) console.error('Could not restore the Discord sign-in session.', sessionError);
  await handleSession(session);

  const login = async () => {
    try {
      window.lakbayAuthErrorMessage = '';
      document.querySelector('.auth-inline-notice')?.remove();
      const redirect = new URL(window.location.href);
      removeOAuthErrorParams(redirect);
      redirect.searchParams.delete('code');
      redirect.searchParams.delete('state');
      redirect.hash = '';
      const redirectUrl = `${redirect.origin}${redirect.pathname}${redirect.search}`;
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: redirectUrl } });
      if (error) throw error;
    } catch (error) {
      console.error('Could not start Discord sign-in.', error);
      alert(error.message || 'Could not start Discord sign-in. Please try again.');
    }
  };

  if (DOM.loginBtn) DOM.loginBtn.onclick = login;
  if (DOM.mobileLoginBtn) DOM.mobileLoginBtn.onclick = login;
  if (DOM.logoutBtn) DOM.logoutBtn.onclick = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) { alert(error.message || 'Could not sign out.'); return; }
    window.location.reload();
  };
  window.lakbayOpenTripInvitePrompt = async trip => {
    let details = trip;
    try { details = await getTripLinkPreview(trip.invite_code || trip.id) || trip; }
    catch (error) { console.error('Could not load trip invitation details.', error); }
    showTripInvitePrompt(details, details.invite_code || trip.invite_code || String(trip.id), false);
  };
}

async function handleSession(session) {
  document.getElementById('mobile-login-inline')?.classList.toggle('hidden', !!session);
  if (session) {
    window.lakbayAuthErrorMessage = '';
    currentUser = session.user;
    DOM.loginBtn.classList.add('hidden');
    DOM.mobileLoginBtn.classList.add('hidden');
    DOM.profileDiv.classList.remove('hidden');
    DOM.profileDiv.classList.add('flex');
    const meta = currentUser.user_metadata;
    DOM.name.textContent = meta.display_name || meta.custom_claims?.global_name || meta.full_name || 'Traveler';
    const avatarUrl=meta.avatar_url||meta.picture;
    if (avatarUrl) DOM.avatar.src = avatarUrl; else DOM.avatar.removeAttribute('src');
  } else {
    currentUser = null;
    DOM.loginBtn.classList.remove('hidden');
    DOM.mobileLoginBtn.classList.remove('hidden');
    DOM.profileDiv.classList.add('hidden');
    DOM.profileDiv.classList.remove('flex');
  }

  await checkUrlForInvites();
  document.dispatchEvent(new CustomEvent('lakbay:auth-changed', { detail: { loggedIn: !!session } }));
}

async function checkUrlForInvites() {
  const code = new URLSearchParams(window.location.search).get('invite');
  if (!code) return;

  try {
    const preview = await getTripLinkPreview(code);
    if (!preview) return;

    if (sessionStorage.getItem('lakbay_public_invite_preview') === String(code) && ['public_view','public_edit'].includes(preview.visibility)) {
      const rawTripView = await getPublicTripView(code);
      if (rawTripView) {
        const tripView = completePublicTripView(rawTripView, preview, code);
        await loadTripDays(tripView);
        document.dispatchEvent(new Event('lakbay:trip-loaded'));
        showPersistentInviteBar(preview, code);
        switchView(window.lakbayCurrentView || 'trips');
        return;
      }
    }

    if (currentUser) {
      const isOwner = preview.owner_id === currentUser.id;
      let isMember = isOwner;
      if (!isMember) {
        const { data } = await supabase.from('trip_members').select('id').eq('trip_id', preview.id).eq('user_id', currentUser.id).maybeSingle();
        isMember = !!data;
      }
      if (isMember) {
        const trip = await getTrip(preview.id);
        if (trip) {
          await loadTripDays(trip);
          document.dispatchEvent(new Event('lakbay:trip-loaded'));
          switchView('trips');
          removeInviteFromUrl();
          return;
        }
      }
    }
    showTripInvitePrompt(preview, code, true);
  } catch (error) {
    console.error('Could not open trip invite.', error);
    if (!currentUser) {
      document.getElementById('invite-popup-message').textContent = 'Sign in to open this trip';
      document.getElementById('invite-popup-owner').textContent = '';
      document.getElementById('invite-trip-details').textContent = 'This trip is not publicly viewable. Sign in with Discord to accept its invitation.';
      document.getElementById('invite-popup-hint').textContent = 'Your invitation link will be kept during sign-in.';
      document.getElementById('view-public-trip-btn').classList.add('hidden');
      document.getElementById('accept-invite-btn').textContent = 'Sign in to join';
      document.getElementById('invite-popup-backdrop').classList.remove('hidden');
      document.getElementById('decline-invite-btn').onclick = () => { closeInvitePrompt(); removeInviteFromUrl(); };
      document.getElementById('accept-invite-btn').onclick = () => DOM.loginBtn.click();
    }
  }
}

function showTripInvitePrompt(trip, code, fromLink) {
  const isPublic = ['public_view', 'public_edit'].includes(trip.visibility);
  const start = trip.start_date || trip.workspace_data?.start_date || null;
  const end = trip.end_date || trip.workspace_data?.end_date || null;
  const name = trip.destination || 'this trip';
  document.getElementById('invite-popup-message').textContent = `Join ${name}?`;
  document.getElementById('invite-popup-owner').textContent = `Organized by ${trip.owner_name || 'Trip organizer'}`;
  const ownerAvatar = document.getElementById('invite-popup-owner-avatar');
  const ownerAvatarUrl = safeAvatarUrl(trip.owner_avatar || trip.owner_avatar_url);
  ownerAvatar.classList.toggle('hidden', !ownerAvatarUrl);
  ownerAvatar.removeAttribute('src');
  ownerAvatar.onerror = () => ownerAvatar.classList.add('hidden');
  if (ownerAvatarUrl) ownerAvatar.src = ownerAvatarUrl;
  document.getElementById('invite-popup-hint').textContent = currentUser
    ? 'Join to access the forum and trip controls.'
    : 'Join to access the forum and trip controls. Discord sign-in is required.';

  const details = document.getElementById('invite-trip-details');
  details.replaceChildren();
  const dateRange = start && end ? `${formatDate(start)} – ${formatDate(end)}` : start ? `Starts ${formatDate(start)}` : end ? `Ends ${formatDate(end)}` : 'Dates not set';
  details.textContent = dateRange;
  const countdown = document.getElementById('invite-trip-countdown');
  countdown.classList.toggle('hidden', !start);
  if (inviteCountdownTimer) clearInterval(inviteCountdownTimer);
  if (start) {
    const update = () => updateInviteCountdown(start, end);
    update();
    inviteCountdownTimer = window.setInterval(update, 1000);
  }

  const viewButton = document.getElementById('view-public-trip-btn');
  viewButton.classList.toggle('hidden', !isPublic);
  viewButton.onclick = async () => {
    if (viewButton.disabled) return;
    viewButton.disabled = true;
    viewButton.textContent = 'Opening…';
    closeInvitePrompt();
    const inviteCode = code || trip.invite_code || String(trip.id);
    const sequence = ++publicTripPreviewSequence;
    const previewShell = completePublicTripView({
      id: trip.id, owner_id: trip.owner_id, visibility: trip.visibility,
      days: [], workspace_data: { start_date: start, end_date: end, food: { ingredients: [], recipes: [] }, expenses: [], payments: [], forum: [] }
    }, trip, inviteCode);
    document.getElementById('active-trip-title').textContent=previewShell.destination||'Your trip';
    document.getElementById('active-trip-emoji').textContent=previewShell.emoji||'✈️';
    document.getElementById('active-trip-date-copy').textContent=start?formatDate(start):'Shared trip preview';
    document.getElementById('overview-day-count').textContent='0 days';
    const shellLoad = loadTripDays(previewShell);
    document.dispatchEvent(new Event('lakbay:trip-preview-shell'));
    switchView(window.lakbayCurrentView || 'trips');
    showPersistentInviteBar(trip, inviteCode, { loading: true });
    void shellLoad.catch(error => console.warn('Could not initialize trip preview shell.', error));
    try {
      const rawTripView = await promiseWithTimeout(getPublicTripView(trip.invite_code || code || String(trip.id)), 15000, 'The trip preview is taking too long to load. Check your connection and retry.');
      if (sequence !== publicTripPreviewSequence) return;
      if (!rawTripView) throw new Error('This trip is not available for public viewing.');
      const tripView = completePublicTripView(rawTripView, trip, code);
      await loadTripDays(tripView);
      sessionStorage.setItem('lakbay_public_invite_preview', String(inviteCode));
      document.dispatchEvent(new Event('lakbay:trip-loaded'));
      switchView(window.lakbayCurrentView || 'trips');
      showPersistentInviteBar(trip, inviteCode);
    } catch (error) {
      if (sequence !== publicTripPreviewSequence) return;
      console.error('Could not open public trip view.', error);
      showPersistentInviteBar(trip, inviteCode, { error: error.message || 'Could not load the full trip preview. You can retry or accept the invite.' });
    } finally {
      viewButton.disabled = false;
      viewButton.textContent = 'View trip';
    }
  };

  document.getElementById('decline-invite-btn').onclick = () => {
    closeInvitePrompt();
    if (fromLink) removeInviteFromUrl();
  };
  document.getElementById('accept-invite-btn').textContent = currentUser ? 'Join trip' : 'Sign in to join';
  document.getElementById('accept-invite-btn').onclick = async () => {
    if (!currentUser) { DOM.loginBtn.click(); return; }
    await joinTripFromInvite(trip.invite_code || code || String(trip.id));
  };
  document.getElementById('invite-popup-backdrop').classList.remove('hidden');
}

function completePublicTripView(view, invitation, code) {
  return {
    ...view,
    invite_code: view.invite_code || invitation.invite_code || String(code || invitation.id || view.id),
    visibility: view.visibility || invitation.visibility || 'public_view',
    owner_name: view.owner_name || invitation.owner_name || 'Trip organizer',
    owner_avatar: view.owner_avatar || invitation.owner_avatar || '',
    workspace_data: {
      ...(view.workspace_data || {}),
      start_date: view.workspace_data?.start_date || view.start_date || invitation.start_date || null,
      end_date: view.workspace_data?.end_date || view.end_date || invitation.end_date || null
    },
    days: Array.isArray(view.days) ? view.days : []
  };
}

function updateInviteCountdown(start, end) {
  const value = document.getElementById('invite-countdown-value');
  if (!value) return;
  const remaining = new Date(`${start}T00:00:00`).getTime() - Date.now();
  if (remaining <= 0) {
    const tripEnd = end ? new Date(`${end}T23:59:59`).getTime() : null;
    value.textContent = tripEnd && Date.now() <= tripEnd ? 'Trip in progress' : 'Trip started';
    return;
  }
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  value.textContent = `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`;
}

function safeAvatarUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

async function joinTripFromInvite(code) {
  const button = document.getElementById('accept-invite-btn');
  if(button){button.disabled = true;button.textContent = 'Checking…'}
  try {
    if(typeof window.lakbayJoinTripByInvite!=='function')throw new Error('Trip joining is still loading. Please try again.');
    await window.lakbayJoinTripByInvite(String(code));
  } catch (error) {
    console.error('Could not join trip.', error);
    alert(error.message || 'Could not join this trip. Please try again.');
  } finally {
    if(button){button.disabled = false;button.textContent = currentUser ? 'Join trip' : 'Sign in to join'}
  }
}

document.addEventListener('lakbay:trip-invitation-joined',()=>{
  removeInviteFromUrl();
  sessionStorage.removeItem('lakbay_public_invite_preview');
  sessionStorage.removeItem('lakbay_invite_accept_pending');
  document.getElementById('public-trip-invite-bar')?.remove();
  document.body.classList.remove('has-public-trip-invite');
  closeInvitePrompt();
});

function showPersistentInviteBar(trip, code, state = {}) {
  let bar=document.getElementById('public-trip-invite-bar');
  if(!bar){bar=document.createElement('aside');bar.id='public-trip-invite-bar';bar.className='public-trip-invite-bar';bar.setAttribute('aria-label','Trip invitation');document.body.append(bar)}
  const start=trip.start_date||trip.workspace_data?.start_date||null,end=trip.end_date||trip.workspace_data?.end_date||null;
  document.body.classList.add('has-public-trip-invite');
  document.dispatchEvent(new Event('lakbay:public-invite-preview'));
  const days=Number(trip.day_count??trip.days?.length??0),facts=[];
  if(start&&end)facts.push(`${formatDate(start)} – ${formatDate(end)}`);else if(start)facts.push(`Starts ${formatDate(start)}`);
  if(start)facts.push(countdownLabel(start,end));if(days)facts.push(`${days} planned ${days===1?'day':'days'}`);
  const status=state.error|| (state.loading?'Loading trip details…':facts.join(' · '));
  bar.innerHTML=`<div class="invite-bar-copy"><strong>Trip preview: ${escapeHTML(trip.destination||'Shared trip')}</strong><span>${state.error?escapeHTML(status):`Shared by ${escapeHTML(trip.owner_name||'Trip organizer')}${status?` · ${escapeHTML(status)}`:''}`}</span></div><div class="invite-bar-actions">${state.error?'<button type="button" class="light-button" data-invite-retry>Retry</button>':''}<button type="button" class="light-button" data-invite-discard ${state.loading?'disabled':''}>Discard</button><button type="button" class="action-button" data-invite-accept ${state.loading?'disabled':''}>${state.loading?'Loading…':currentUser?'Accept invitation':'Sign in to accept'}</button></div>`;
  bar.querySelector('[data-invite-accept]').onclick=async()=>{if(state.loading)return;if(!currentUser){sessionStorage.setItem('lakbay_public_invite_preview',String(code));sessionStorage.setItem('lakbay_invite_accept_pending','true');DOM.loginBtn.click();return}await joinTripFromInvite(code)};
  bar.querySelector('[data-invite-discard]').onclick=()=>{if(state.loading)return;showDiscardInviteConfirmation(()=>{sessionStorage.removeItem('lakbay_public_invite_preview');removeInviteFromUrl();bar.remove();document.body.classList.remove('has-public-trip-invite');window.location.reload()})};
  bar.querySelector('[data-invite-retry]')?.addEventListener('click',()=>showTripInvitePrompt(trip,code,true));
}

function promiseWithTimeout(promise, milliseconds, message){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=window.setTimeout(()=>reject(new Error(message)),milliseconds)})]).finally(()=>window.clearTimeout(timer));
}

function showDiscardInviteConfirmation(onDiscard){
  let dialog=document.getElementById('discard-trip-invite-confirm');
  if(!dialog){dialog=document.createElement('div');dialog.id='discard-trip-invite-confirm';dialog.className='lakbay-modal-backdrop';dialog.innerHTML='<section class="lakbay-modal invite-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-invite-title"><h2 id="discard-invite-title">Discard this invitation?</h2><p>You can reopen the trip later from its invite link.</p><div class="modal-actions"><button type="button" class="light-button" data-keep-invite>Keep previewing</button><button type="button" class="danger-button" data-confirm-discard>Discard invitation</button></div></section>';document.body.append(dialog)}
  dialog.classList.remove('hidden');dialog.querySelector('[data-keep-invite]').onclick=()=>dialog.classList.add('hidden');dialog.querySelector('[data-confirm-discard]').onclick=()=>{dialog.classList.add('hidden');onDiscard()};dialog.onclick=event=>{if(event.target===dialog)dialog.classList.add('hidden')};
}

function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

function closeInvitePrompt() {
  document.getElementById('invite-popup-backdrop').classList.add('hidden');
  if (inviteCountdownTimer) clearInterval(inviteCountdownTimer);
  inviteCountdownTimer = null;
}

function removeInviteFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function countdownLabel(start, end) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDate = new Date(`${start}T00:00:00`);
  const days = Math.ceil((startDate - today) / 86400000);
  if (days > 1) return `${days} days until start`;
  if (days === 1) return 'Starts tomorrow';
  if (days === 0) return 'Starts today';
  if (end && new Date(`${end}T23:59:59`) >= today) return 'In progress';
  return 'Trip date has passed';
}
