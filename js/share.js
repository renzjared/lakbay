import { supabase, useSupabase } from './storage.js';
import { activeTrip } from './itinerary.js';
import { currentUser } from './auth.js';

const DOM = {
  btn: document.getElementById('share-trip-btn'),
  bg: document.getElementById('share-backdrop'),
  visibility: document.getElementById('share-visibility'),
  gaIcon: document.getElementById('ga-icon'),
  inviteInput: document.getElementById('invite-username'),
  inviteRole: document.getElementById('invite-role'),
  sendBtn: document.getElementById('send-invite-btn'),
  warning: document.getElementById('invite-warning'),
  list: document.getElementById('collaborators-list'),
  copyBtn: document.getElementById('copy-link-btn'),
  closeBtn: document.getElementById('close-share-btn')
};

export function initShareUI() {
  DOM.btn.onclick = async () => {
    if (!useSupabase) return alert('Sharing requires a connected database.');
    DOM.visibility.value = activeTrip.visibility || 'private';
    updateGeneralAccessUI(DOM.visibility.value);
    await loadCollaborators();
    DOM.bg.classList.remove('hidden');
    DOM.inviteInput.focus();
  };

  DOM.closeBtn.onclick = closeShare;
  document.getElementById('share-modal-x')?.addEventListener('click', closeShare);

  DOM.visibility.onchange = async event => {
    if (!currentUser || activeTrip.owner_id !== currentUser.id) {
      event.target.value = activeTrip.visibility || 'private';
      return;
    }
    const nextVisibility = event.target.value;
    const { error } = await supabase.from('trips').update({ visibility: nextVisibility }).eq('id', activeTrip.id);
    if (error) {
      event.target.value = activeTrip.visibility || 'private';
      updateGeneralAccessUI(event.target.value);
      return alert(error.message || 'Could not update sharing access.');
    }
    activeTrip.visibility = nextVisibility;
    updateGeneralAccessUI(nextVisibility);
  };

  DOM.sendBtn.onclick = async () => {
    if (!currentUser || activeTrip.owner_id !== currentUser.id) return alert('Only the trip owner can add people.');
    const username = DOM.inviteInput.value.trim().replace(/^@/, '');
    if (!username) return DOM.inviteInput.focus();
    DOM.warning.classList.add('hidden');
    DOM.sendBtn.disabled = true;
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('id').ilike('username', username).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.id === currentUser.id) return alert('You already own this trip.');

      const { error } = profile
        ? await supabase.from('trip_members').insert({ trip_id: activeTrip.id, user_id: profile.id, role: DOM.inviteRole.value })
        : await supabase.from('trip_members').insert({ trip_id: activeTrip.id, pending_username: username, role: DOM.inviteRole.value });
      if (error) throw error;
      DOM.inviteInput.value = '';
      if (!profile) DOM.warning.classList.remove('hidden');
      await loadCollaborators();
    } catch (error) {
      console.error('Could not share trip with this person.', error);
      alert(error.message || 'Could not add this person to the trip.');
    } finally {
      DOM.sendBtn.disabled = false;
    }
  };

  DOM.copyBtn.onclick = async () => {
    const url = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(activeTrip.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      DOM.copyBtn.textContent = 'Link copied';
      window.setTimeout(() => { DOM.copyBtn.textContent = 'Copy link'; }, 1800);
    } catch (error) {
      console.error('Could not copy trip link.', error);
      alert('Could not copy the link. Check clipboard permissions and try again.');
    }
  };
}

function closeShare() {
  DOM.bg.classList.add('hidden');
  DOM.warning.classList.add('hidden');
}

function updateGeneralAccessUI(value) {
  DOM.gaIcon.textContent = value === 'private' ? '🔒' : '🌐';
}

async function loadCollaborators() {
  DOM.list.innerHTML = '<p class="share-loading">Loading people…</p>';
  const [{ data: ownerProfile }, { data: members, error }] = await Promise.all([
    supabase.from('profiles').select('id, username, avatar_url').eq('id', activeTrip.owner_id).maybeSingle(),
    supabase.from('trip_members').select('id, role, pending_username, user_id').eq('trip_id', activeTrip.id)
  ]);
  if (error) {
    DOM.list.innerHTML = '<p class="share-loading" role="alert">Could not load trip access.</p>';
    console.error('Could not load trip members.', error);
    return;
  }

  const memberIds = [...new Set((members || []).map(member => member.user_id).filter(Boolean))];
  let profilesById = new Map();
  if (memberIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles').select('id, username, avatar_url').in('id', memberIds);
    if (profileError) console.warn('Could not load some trip member profiles.', profileError);
    profilesById = new Map((profiles || []).map(profile => [String(profile.id), profile]));
  }

  const metadata = currentUser?.user_metadata || {};
  const ownerName = ownerProfile?.username || metadata.username || metadata.user_name || metadata.display_name || metadata.global_name || 'Trip creator';
  const ownerAvatar = ownerProfile?.avatar_url || metadata.avatar_url || metadata.picture || '';
  const ownerRow = personMarkup(ownerName, ownerAvatar, 'Owner');
  const memberRows = (members || []).map(member => {
    const profile = profilesById.get(String(member.user_id)) || null;
    const name = profile?.username || member.pending_username || 'Trip member';
    const role = `<select class="share-member-role" aria-label="Access for ${escapeHTML(name)}" data-id="${escapeHTML(member.id)}">
      <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>Viewer</option>
      <option value="editor" ${member.role === 'editor' ? 'selected' : ''}>Editor</option>
      <option value="remove">Remove access</option>
    </select>`;
    return `${personMarkup(name, profile?.avatar_url || '', member.user_id ? '' : 'Pending signup')}<div class="share-person-action">${role}</div>`;
  }).map(markup => `<div class="share-person-row">${markup}</div>`).join('');

  DOM.list.innerHTML = `<div class="share-person-row">${ownerRow}</div>${memberRows || '<p class="share-loading">No other people have access.</p>'}`;
  DOM.list.querySelectorAll('.share-member-role').forEach(select => {
    select.onchange = async event => {
      const memberId = event.target.dataset.id;
      const value = event.target.value;
      event.target.disabled = true;
      const result = value === 'remove'
        ? await supabase.from('trip_members').delete().eq('id', memberId)
        : await supabase.from('trip_members').update({ role: value }).eq('id', memberId);
      if (result.error) {
        alert(result.error.message || 'Could not update trip access.');
      }
      await loadCollaborators();
    };
  });
}

function personMarkup(name, avatar, role) {
  const image = safeUrl(avatar);
  const avatarMarkup = image
    ? `<img class="share-person-avatar" src="${escapeHTML(image)}" alt="">`
    : `<span class="share-person-avatar share-person-initial">${escapeHTML((name.trim()[0] || '?').toLocaleUpperCase())}</span>`;
  return `<div class="share-person-copy">${avatarMarkup}<span><strong>${escapeHTML(name)}</strong>${role === 'Pending signup' ? '<small>Pending signup</small>' : ''}</span></div>${role && role !== 'Pending signup' ? `<span class="share-person-role">${escapeHTML(role)}</span>` : ''}`;
}

function safeUrl(value) {
  try { const url = new URL(value, window.location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
