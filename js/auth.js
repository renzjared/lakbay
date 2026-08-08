import { supabase, useSupabase, getTrip } from './storage.js';
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

  const { data: { session } } = await supabase.auth.getSession();
  await handleSession(session);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await handleSession(session);
  });

  const login = async () => {
    const redirectUrl = window.location.origin + window.location.pathname;
    await supabase.auth.signInWithOAuth({ 
      provider: 'discord', 
      options: { redirectTo: redirectUrl } 
    });
  };
  
  DOM.loginBtn.onclick = login;
  DOM.mobileLoginBtn.onclick = login;

  DOM.logoutBtn.onclick = async () => {
    await supabase.auth.signOut();
    window.location.reload(); 
  };
}

async function handleSession(session) {
  if (session) {
    currentUser = session.user;
    DOM.loginBtn.classList.add('hidden');
    DOM.mobileLoginBtn.classList.add('hidden');
    DOM.profileDiv.classList.remove('hidden');
    DOM.profileDiv.classList.add('flex');
    
    const meta = currentUser.user_metadata;
    DOM.name.textContent = meta.custom_claims?.global_name || meta.full_name;
    DOM.avatar.src = meta.avatar_url;
  } else {
    currentUser = null;
    DOM.loginBtn.classList.remove('hidden');
    DOM.mobileLoginBtn.classList.remove('hidden');
    DOM.profileDiv.classList.add('hidden');
    DOM.profileDiv.classList.remove('flex');
  }

  // Always check the URL for invites, whether logged in or out
  await checkUrlForInvites();
}

async function checkUrlForInvites() {
  const urlParams = new URLSearchParams(window.location.search);
  const inviteTripId = urlParams.get('invite');
  
  if (!inviteTripId) return;

  // SCENARIO 1: User is completely logged out
  if (!currentUser) {
    const publicTrip = await getTrip(inviteTripId);
    
    // If getTrip returned data, it means the RLS policies allowed it (it's public!)
    if (publicTrip) {
      loadTripDays(publicTrip);
      switchView('days');
    }
    return;
  }

  // SCENARIO 2: User is logged in
  const { data: trip } = await supabase
    .from('trips')
    .select('destination, owner_id')
    .eq('id', inviteTripId)
    .single();
    
  if (!trip || trip.owner_id === currentUser.id) return; 

  // Check if they are ALREADY a member so we don't show the popup again
  const { data: existingMember } = await supabase
    .from('trip_members')
    .select('id')
    .eq('trip_id', inviteTripId)
    .eq('user_id', currentUser.id)
    .single();

  if (existingMember) {
    // Already joined, just load the trip
    const memberTrip = await getTrip(inviteTripId);
    if (memberTrip) {
      loadTripDays(memberTrip);
      switchView('days');
    }
    return;
  }
  
  // They are not a member yet, show the invite popup
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', trip.owner_id)
    .single();
  
  document.getElementById('invite-popup-message').textContent = `${ownerProfile?.username || 'Someone'} invited you to '${trip.destination}'!`;
  document.getElementById('invite-popup-backdrop').classList.remove('hidden');
  
  document.getElementById('accept-invite-btn').onclick = async () => {
    // Add user as a viewer by default (owner can upgrade them to editor in the Share UI)
    await supabase.from('trip_members').insert({ 
      trip_id: inviteTripId, 
      user_id: currentUser.id, 
      role: 'viewer' 
    });
    
    // Clean up the URL and reload to fetch fresh data
    window.history.replaceState({}, document.title, window.location.pathname);
    window.location.reload();
  };
  
  document.getElementById('decline-invite-btn').onclick = () => {
    document.getElementById('invite-popup-backdrop').classList.add('hidden');
    window.history.replaceState({}, document.title, window.location.pathname);
  };
}