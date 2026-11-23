import { supabase, useSupabase, getTrip, getTripLinkPreview, getPublicTripView } from './storage.js';
import { loadTripDays } from './itinerary.js';
import { switchView } from './ui.js';

export let currentUser = null;

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

  // Defer application work until Supabase releases its auth lock. Auth callbacks
  // must stay synchronous because handleSession may make additional API calls.
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => { void handleSession(session); }, 0);
  });

  let { data: { session }, error: sessionError } = await supabase.auth.getSession();
  const callbackUrl = new URL(window.location.href);
  const authCode = callbackUrl.searchParams.get('code');
  if (!session && authCode) {
    try {
      const result = await supabase.auth.exchangeCodeForSession(authCode);
      session = result.data?.session || null;
      sessionError = result.error || sessionError;
      if (session) {
        callbackUrl.searchParams.delete('code');
        window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      }
    } catch (error) {
      sessionError = error;
    }
  }
  if (sessionError) console.error('Could not restore the Discord sign-in session.', sessionError);
  await handleSession(session);

  const login = async () => {
    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
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
      const tripView = await getPublicTripView(code);
      if (tripView) {
        await loadTripDays(tripView);
        document.dispatchEvent(new Event('lakbay:trip-loaded'));
        showPersistentInviteBar(preview, code);
        switchView('trips');
        if(sessionStorage.getItem('lakbay_invite_accept_pending')==='true'){
          sessionStorage.removeItem('lakbay_invite_accept_pending');
          await joinTripFromInvite(code);
        }
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
  const dayCount = Number(trip.day_count ?? trip.days?.length ?? 0);
  const name = trip.destination || 'this trip';
  document.getElementById('invite-popup-message').textContent = `Join ${name}?`;
  document.getElementById('invite-popup-owner').textContent = `Organized by ${trip.owner_name || 'Trip organizer'}`;
  document.getElementById('invite-popup-hint').textContent = currentUser
    ? 'Join to access the forum and trip controls.'
    : 'Join to access the forum and trip controls. Discord sign-in is required.';

  const details = document.getElementById('invite-trip-details');
  details.replaceChildren();
  const facts = [];
  if (start && end) facts.push(`${formatDate(start)} – ${formatDate(end)}`);
  else if (start) facts.push(`Starts ${formatDate(start)}`);
  if (start) facts.push(countdownLabel(start, end));
  if (dayCount) facts.push(`${dayCount} planned ${dayCount === 1 ? 'day' : 'days'}`);
  (facts.length ? facts : ['Trip details are ready to view after joining.']).forEach(fact => {
    const item = document.createElement('span');
    item.textContent = fact;
    details.append(item);
  });

  const viewButton = document.getElementById('view-public-trip-btn');
  viewButton.classList.toggle('hidden', !isPublic);
  viewButton.onclick = async () => {
    try {
      const tripView = await getPublicTripView(trip.invite_code || code || String(trip.id));
      if (!tripView) throw new Error('This trip is not available for public viewing.');
      await loadTripDays(tripView);
      sessionStorage.setItem('lakbay_public_invite_preview',String(code || trip.invite_code || trip.id));
      closeInvitePrompt();
      document.dispatchEvent(new Event('lakbay:trip-loaded'));
      switchView('trips');
      showPersistentInviteBar(trip,code || trip.invite_code || String(trip.id));
    } catch (error) {
      console.error('Could not open public trip view.', error);
      alert(error.message || 'Could not open this trip.');
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

async function joinTripFromInvite(code) {
  const button = document.getElementById('accept-invite-btn');
  button.disabled = true;
  button.textContent = 'Joining…';
  try {
    const { data, error } = await supabase.rpc('join_trip_by_invite', { p_code: String(code) });
    if (error) throw error;
    const trip = Array.isArray(data) ? data[0] : data;
    if (!trip) throw new Error('The invitation could not be found.');
    removeInviteFromUrl();
    sessionStorage.removeItem('lakbay_public_invite_preview');
    sessionStorage.removeItem('lakbay_invite_accept_pending');
    document.getElementById('public-trip-invite-bar')?.remove();
    document.body.classList.remove('has-public-trip-invite');
    const nickname = prompt(`Choose a name to use in ${trip.destination}, or leave blank to use your Discord name.`, '');
    const profileUpdates = {};
    if (nickname?.trim()) profileUpdates.display_name = nickname.trim();
    const avatar = prompt('Paste a profile photo URL if you want to use a different picture, or leave blank to keep your Discord photo.', '');
    if (avatar?.trim()) profileUpdates.avatar_url = avatar.trim();
    if (Object.keys(profileUpdates).length) await supabase.auth.updateUser({ data: profileUpdates });
    await loadTripDays(trip);
    closeInvitePrompt();
    document.dispatchEvent(new Event('lakbay:trip-loaded'));
    switchView('trips');
  } catch (error) {
    console.error('Could not join trip.', error);
    alert(error.message || 'Could not join this trip. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = currentUser ? 'Join trip' : 'Sign in to join';
  }
}

function showPersistentInviteBar(trip, code) {
  let bar=document.getElementById('public-trip-invite-bar');
  if(!bar){bar=document.createElement('aside');bar.id='public-trip-invite-bar';bar.className='public-trip-invite-bar';bar.setAttribute('aria-label','Trip invitation');document.body.append(bar)}
  const start=trip.start_date||trip.workspace_data?.start_date||null,end=trip.end_date||trip.workspace_data?.end_date||null;
  document.body.classList.add('has-public-trip-invite');
  const days=Number(trip.day_count??trip.days?.length??0),facts=[];
  if(start&&end)facts.push(`${formatDate(start)} – ${formatDate(end)}`);else if(start)facts.push(`Starts ${formatDate(start)}`);
  if(start)facts.push(countdownLabel(start,end));if(days)facts.push(`${days} planned ${days===1?'day':'days'}`);
  bar.innerHTML=`<div class="invite-bar-copy"><strong>Trip preview: ${escapeHTML(trip.destination||'Shared trip')}</strong><span>Shared by ${escapeHTML(trip.owner_name||'Trip organizer')}${facts.length?` · ${escapeHTML(facts.join(' · '))}`:''}</span></div><div class="invite-bar-actions"><button type="button" class="light-button" data-invite-discard>Discard</button><button type="button" class="action-button" data-invite-accept>${currentUser?'Accept invitation':'Sign in to accept'}</button></div>`;
  bar.querySelector('[data-invite-accept]').onclick=async()=>{if(!currentUser){sessionStorage.setItem('lakbay_public_invite_preview',String(code));sessionStorage.setItem('lakbay_invite_accept_pending','true');DOM.loginBtn.click();return}await joinTripFromInvite(code)};
  bar.querySelector('[data-invite-discard]').onclick=()=>showDiscardInviteConfirmation(()=>{sessionStorage.removeItem('lakbay_public_invite_preview');removeInviteFromUrl();bar.remove();document.body.classList.remove('has-public-trip-invite');window.location.reload()});
}

function showDiscardInviteConfirmation(onDiscard){
  let dialog=document.getElementById('discard-trip-invite-confirm');
  if(!dialog){dialog=document.createElement('div');dialog.id='discard-trip-invite-confirm';dialog.className='lakbay-modal-backdrop';dialog.innerHTML='<section class="lakbay-modal invite-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-invite-title"><h2 id="discard-invite-title">Discard this invitation?</h2><p>You can reopen the trip later from its invite link.</p><div class="modal-actions"><button type="button" class="light-button" data-keep-invite>Keep previewing</button><button type="button" class="danger-button" data-confirm-discard>Discard invitation</button></div></section>';document.body.append(dialog)}
  dialog.classList.remove('hidden');dialog.querySelector('[data-keep-invite]').onclick=()=>dialog.classList.add('hidden');dialog.querySelector('[data-confirm-discard]').onclick=()=>{dialog.classList.add('hidden');onDiscard()};dialog.onclick=event=>{if(event.target===dialog)dialog.classList.add('hidden')};
}

function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

function closeInvitePrompt() {
  document.getElementById('invite-popup-backdrop').classList.add('hidden');
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
