import { supabase, useSupabase } from './storage.js';

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
  if (!useSupabase) return; // Skip if no Supabase

  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  supabase.auth.onAuthStateChange((_event, session) => handleSession(session));

  const login = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.origin } });
  };
  
  DOM.loginBtn.onclick = login;
  DOM.mobileLoginBtn.onclick = login;

  DOM.logoutBtn.onclick = async () => {
    await supabase.auth.signOut();
    window.location.reload(); 
  };
}

function handleSession(session) {
  if (session) {
    currentUser = session.user;
    DOM.loginBtn.classList.add('hidden');
    DOM.mobileLoginBtn.classList.add('hidden');
    DOM.profileDiv.classList.remove('hidden');
    DOM.profileDiv.classList.add('flex');
    
    const meta = currentUser.user_metadata;
    DOM.name.textContent = meta.custom_claims?.global_name || meta.full_name;
    DOM.avatar.src = meta.avatar_url;
    checkUrlForInvites();
  } else {
    currentUser = null;
    DOM.loginBtn.classList.remove('hidden');
    DOM.mobileLoginBtn.classList.remove('hidden');
    DOM.profileDiv.classList.add('hidden');
    DOM.profileDiv.classList.remove('flex');
  }
}

async function checkUrlForInvites() {
  const urlParams = new URLSearchParams(window.location.search);
  const inviteTripId = urlParams.get('invite');
  if (inviteTripId && currentUser) {
    const { data: trip } = await supabase.from('trips').select('destination, owner_id').eq('id', inviteTripId).single();
    if (!trip || trip.owner_id === currentUser.id) return; 
    const { data: ownerProfile } = await supabase.from('profiles').select('username').eq('id', trip.owner_id).single();
    
    document.getElementById('invite-popup-message').textContent = `${ownerProfile?.username || 'Someone'} invited you to '${trip.destination}'!`;
    document.getElementById('invite-popup-backdrop').classList.remove('hidden');
    
    document.getElementById('accept-invite-btn').onclick = async () => {
      await supabase.from('trip_members').upsert({ trip_id: inviteTripId, user_id: currentUser.id, role: 'viewer' });
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload();
    };
    
    document.getElementById('decline-invite-btn').onclick = () => {
      document.getElementById('invite-popup-backdrop').classList.add('hidden');
      window.history.replaceState({}, document.title, window.location.pathname);
    };
  }
}