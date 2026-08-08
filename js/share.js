import { supabase, useSupabase } from './storage.js';
import { activeTrip } from './itinerary.js';
import { currentUser } from './auth.js';

const DOM = {
  btn: document.getElementById('share-trip-btn'),
  bg: document.getElementById('share-backdrop'),
  visibility: document.getElementById('share-visibility'),
  inviteSection: document.getElementById('invite-section'),
  inviteInput: document.getElementById('invite-username'),
  inviteRole: document.getElementById('invite-role'),
  sendBtn: document.getElementById('send-invite-btn'),
  list: document.getElementById('collaborators-list'),
  copyBtn: document.getElementById('copy-link-btn'),
  closeBtn: document.getElementById('close-share-btn')
};

export function initShareUI() {
  DOM.btn.onclick = async () => {
    if (!useSupabase) return alert("Sharing requires a connected Supabase database.");
    if (!currentUser || activeTrip.owner_id !== currentUser.id) return alert("Only the trip owner can manage sharing settings.");
    
    DOM.visibility.value = activeTrip.visibility || 'private';
    toggleInviteSection(activeTrip.visibility);
    await loadCollaborators();
    DOM.bg.classList.remove('hidden');
  };

  DOM.closeBtn.onclick = () => DOM.bg.classList.add('hidden');
  
  DOM.visibility.onchange = async (e) => {
    const val = e.target.value;
    activeTrip.visibility = val;
    toggleInviteSection(val);
    await supabase.from('trips').update({ visibility: val }).eq('id', activeTrip.id);
  };

  DOM.sendBtn.onclick = async () => {
    const username = DOM.inviteInput.value.trim();
    if (!username) return;

    const { data: profile } = await supabase.from('profiles').select('id').ilike('username', username).single();
    if (!profile) return alert(`No account found with username: ${username}`);
    if (profile.id === currentUser.id) return alert("You can't invite yourself!");

    const role = DOM.inviteRole.value;
    const { error } = await supabase.from('trip_members').upsert({ trip_id: activeTrip.id, user_id: profile.id, role });
    
    if (error) alert("Error adding user.");
    else { DOM.inviteInput.value = ''; await loadCollaborators(); }
  };

  DOM.copyBtn.onclick = () => {
    const link = `${window.location.origin}${window.location.pathname}?invite=${activeTrip.id}`;
    navigator.clipboard.writeText(link);
    const originalText = DOM.copyBtn.innerHTML;
    DOM.copyBtn.innerHTML = "✅ Copied to Clipboard!";
    setTimeout(() => DOM.copyBtn.innerHTML = originalText, 2000);
  };
}

function toggleInviteSection(visibility) {
  if (visibility === 'shared') DOM.inviteSection.classList.remove('hidden');
  else DOM.inviteSection.classList.add('hidden');
}

async function loadCollaborators() {
  DOM.list.innerHTML = '<span class="text-xs text-gray-400">Loading...</span>';
  const { data: members } = await supabase.from('trip_members').select(`role, user_id, profiles (username)`).eq('trip_id', activeTrip.id);
  DOM.list.innerHTML = '';
  
  if (!members || members.length === 0) {
    DOM.list.innerHTML = '<span class="text-xs font-bold text-gray-300">No users added yet.</span>';
    return;
  }

  members.forEach(member => {
    DOM.list.innerHTML += `
      <div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
        <span class="font-bold text-sm text-[#4b4b4b]">@${member.profiles.username}</span>
        <div class="flex gap-2 items-center">
          <span class="text-xs font-bold text-gray-400 uppercase">${member.role}</span>
          <button class="remove-member-btn text-red-400 text-xs font-bold hover:text-red-600" data-id="${member.user_id}">✕</button>
        </div>
      </div>
    `;
  });

  document.querySelectorAll('.remove-member-btn').forEach(btn => {
    btn.onclick = async (e) => {
      await supabase.from('trip_members').delete().match({ trip_id: activeTrip.id, user_id: e.target.dataset.id });
      await loadCollaborators();
    };
  });
}