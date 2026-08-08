import { supabase, useSupabase } from './storage.js';
import { activeTrip } from './itinerary.js';
import { currentUser } from './auth.js';

const DOM = {
  btn: document.getElementById('share-trip-btn'), bg: document.getElementById('share-backdrop'),
  visibility: document.getElementById('share-visibility'), gaIcon: document.getElementById('ga-icon'), gaDesc: document.getElementById('ga-desc'),
  inviteInput: document.getElementById('invite-username'), inviteRole: document.getElementById('invite-role'),
  sendBtn: document.getElementById('send-invite-btn'), warning: document.getElementById('invite-warning'),
  list: document.getElementById('collaborators-list'), copyBtn: document.getElementById('copy-link-btn'), closeBtn: document.getElementById('close-share-btn')
};

export function initShareUI() {
  DOM.btn.onclick = async () => {
    if (!useSupabase) return alert("Sharing requires a connected database.");
    DOM.visibility.value = activeTrip.visibility || 'private';
    updateGeneralAccessUI(DOM.visibility.value);
    await loadCollaborators();
    DOM.bg.classList.remove('hidden');
  };

  DOM.closeBtn.onclick = () => { DOM.bg.classList.add('hidden'); DOM.warning.classList.add('hidden'); };
  
  DOM.visibility.onchange = async (e) => {
    if (!currentUser || activeTrip.owner_id !== currentUser.id) {
      e.target.value = activeTrip.visibility; // Revert visually
      return alert("Only the trip owner can change general access.");
    }
    activeTrip.visibility = e.target.value;
    updateGeneralAccessUI(e.target.value);
    await supabase.from('trips').update({ visibility: e.target.value }).eq('id', activeTrip.id);
  };

  DOM.sendBtn.onclick = async () => {
    if (!currentUser || activeTrip.owner_id !== currentUser.id) return alert("Only the owner can add users.");
    
    const username = DOM.inviteInput.value.trim();
    if (!username) return;
    DOM.warning.classList.add('hidden');

    // 1. Check if user exists in the platform
    const { data: profile } = await supabase.from('profiles').select('id').ilike('username', username).single();
    if (profile && profile.id === currentUser.id) return alert("You own this trip!");

    const role = DOM.inviteRole.value;
    
    if (profile) {
      // User exists, add them via UUID
      await supabase.from('trip_members').insert({ trip_id: activeTrip.id, user_id: profile.id, role });
    } else {
      // User does NOT exist, add as pending
      DOM.warning.classList.remove('hidden');
      await supabase.from('trip_members').insert({ trip_id: activeTrip.id, pending_username: username, role });
    }

    DOM.inviteInput.value = '';
    await loadCollaborators();
  };

  DOM.copyBtn.onclick = () => {
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?invite=${activeTrip.id}`);
    DOM.copyBtn.innerHTML = "✅ Copied!";
    setTimeout(() => DOM.copyBtn.innerHTML = "🔗 Copy link", 2000);
  };
}

function updateGeneralAccessUI(val) {
  if (val === 'private') { DOM.gaIcon.textContent = '🔒'; DOM.gaDesc.textContent = 'Only added people can access'; } 
  else { DOM.gaIcon.textContent = '🌐'; DOM.gaDesc.textContent = val === 'public_edit' ? 'Anyone with the link can edit (login required)' : 'Anyone with the link can view'; }
}

async function loadCollaborators() {
  DOM.list.innerHTML = '<span class="text-xs text-gray-400">Loading...</span>';
  
  // Get owner info
  const { data: owner } = await supabase.from('profiles').select('username').eq('id', activeTrip.owner_id).single();
  // Get members (both registered and pending)
  const { data: members } = await supabase.from('trip_members').select(`id, role, pending_username, user_id, profiles (username)`).eq('trip_id', activeTrip.id);

  const isOwner = currentUser && activeTrip.owner_id === currentUser.id;
  DOM.list.innerHTML = '';

  // 1. Render Owner
  DOM.list.innerHTML += `
    <div class="flex justify-between items-center py-2">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-[#58cc02] text-white flex items-center justify-center font-bold text-xs">${(owner?.username || 'O')[0].toUpperCase()}</div>
        <div class="flex flex-col"><span class="font-bold text-sm text-[#4b4b4b]">${owner?.username || 'Owner'}</span></div>
      </div>
      <span class="text-xs font-bold text-gray-400 italic">Owner</span>
    </div>`;

  // 2. Render Members
  (members || []).forEach(m => {
    const name = m.profiles?.username || m.pending_username;
    const isPending = !m.user_id;
    
    // Only the owner can change roles. Others just see text.
    const roleUI = isOwner ? `
      <select class="role-select bg-transparent font-bold text-xs text-gray-500 outline-none cursor-pointer hover:text-[#1cb0f6]" data-id="${m.id}">
        <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Editor</option>
        <option value="remove" class="text-red-500">Remove</option>
      </select>
    ` : `<span class="text-xs font-bold text-gray-400 capitalize">${m.role}</span>`;

    DOM.list.innerHTML += `
      <div class="flex justify-between items-center py-2">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-xs">${name[0].toUpperCase()}</div>
          <div class="flex flex-col">
            <span class="font-bold text-sm text-[#4b4b4b]">${name}</span>
            ${isPending ? '<span class="text-[10px] font-bold text-amber-500 uppercase">Pending Signup</span>' : ''}
          </div>
        </div>
        ${roleUI}
      </div>`;
  });

  // Attach change listeners for the dropdowns
  document.querySelectorAll('.role-select').forEach(select => {
    select.onchange = async (e) => {
      const memberId = e.target.dataset.id;
      const newRole = e.target.value;
      if (newRole === 'remove') {
        await supabase.from('trip_members').delete().eq('id', memberId);
      } else {
        await supabase.from('trip_members').update({ role: newRole }).eq('id', memberId);
      }
      await loadCollaborators();
    };
  });
}