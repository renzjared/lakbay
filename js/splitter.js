import { activeTrip, activeUserRole } from './itinerary.js';
import { updateTrip, getPublicTripView, supabase, useSupabase } from './storage.js';
import { currentUser } from './auth.js';
import { playClick, playSuccess } from './audio.js';
import { formatCurrency } from './timeUtils.js';

let editingExpenseId = null;
let tripUsers = []; // Cache of collaborators

const DOM = {
  view: document.getElementById('splitter-view'), addBtn: document.getElementById('add-expense-btn'),
  bg: document.getElementById('expense-backdrop'), modal: document.getElementById('expense-modal'),
  title: document.getElementById('expense-title'), amount: document.getElementById('expense-amount'),
  payer: document.getElementById('expense-payer'), splitList: document.getElementById('expense-split-list'),
  selectAll: document.getElementById('expense-select-all'), clearAll: document.getElementById('expense-clear-all'),
  saveBtn: document.getElementById('save-expense-btn'), deleteBtn: document.getElementById('delete-expense-btn'),
  closeBtn: document.getElementById('close-expense-btn'), expensesList: document.getElementById('expenses-list'),
  debtsContainer: document.getElementById('debts-container')
};

function ensureExpensesExist() { if (!activeTrip.expenses) activeTrip.expenses = []; }

export async function renderSplitter() {
  if (!activeTrip) return;
  ensureExpensesExist();
  const canAdd = activeUserRole !== 'viewer';
  const canManageExpenses = activeUserRole === 'owner';
  DOM.addBtn.style.display = canAdd ? 'block' : 'none';

  // Fetch all users involved in this trip
  const discordIdentity = currentUser?.identities?.find(item => item.provider === 'discord')?.identity_data || {};
  const metadata = currentUser?.user_metadata || {};
  const currentUsername = String(discordIdentity.username || metadata.username || metadata.user_name || '').trim();
  tripUsers = currentUser ? [{ id: String(currentUser.id), name: currentUsername || metadata.display_name || metadata.full_name || 'You' }] : [{ id: 'me', name: 'You' }];
  if (useSupabase) {
    const [{ data: owner }, { data: members }] = await Promise.all([
      supabase.from('profiles').select('id, username').eq('id', activeTrip.owner_id).maybeSingle(),
      supabase.from('trip_members').select('user_id, pending_username, profiles(id, username)').eq('trip_id', activeTrip.id)
    ]);
    const people = [];
    const addPerson = person => { if (person?.id && !people.some(user => String(user.id) === String(person.id))) people.push({ id: String(person.id), name: person.name || 'Trip member' }); };
    if (owner) addPerson({ id: owner.id, name: String(owner.id) === String(currentUser?.id) ? currentUsername || owner.username : owner.username || 'Trip owner' });
    addPerson(currentUser && { id: currentUser.id, name: currentUsername || metadata.display_name || metadata.full_name || 'You' });
    if (['public_view', 'public_edit'].includes(activeTrip.visibility)) {
      try {
        const publicTrip = await getPublicTripView(activeTrip.invite_code || activeTrip.id);
        (publicTrip?.public_members || []).forEach(person => addPerson(person));
      } catch (error) { console.warn('Could not load public members for expense split.', error); }
    }
    (members || []).forEach(row => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      if (profile) addPerson({ id: profile.id, name: String(profile.id) === String(currentUser?.id) ? currentUsername || profile.username : profile.username });
      else if (row.user_id) addPerson({ id: row.user_id, name: String(row.user_id) === String(currentUser?.id) ? currentUsername || 'You' : 'Trip member' });
    });
    tripUsers = people;
  }
  (activeTrip.workspace_data?.departed_members || []).forEach(person => {
    const id = String(person.user_id || person.id || '');
    if (id && !tripUsers.some(user => String(user.id) === id)) tripUsers.push({ id, name: person.name || 'Former member', left: true });
    else { const existing = tripUsers.find(user => String(user.id) === id); if (existing) { existing.left = true; existing.name ||= person.name || 'Former member'; } }
  });
  (activeTrip.workspace_data?.people || []).forEach((person,index)=>{
    const id=String(person.id||`guest-${index}-${person.name}`);
    if(!tripUsers.some(user=>String(user.id)===id))tripUsers.push({id,name:person.name||'Guest'});
  });

  renderDebts();
  
  DOM.expensesList.innerHTML = '';
  if (activeTrip.expenses.length === 0) {
    DOM.expensesList.innerHTML = '<div class="empty-note">No expenses yet.</div>';
    return;
  }

  activeTrip.expenses.forEach(exp => {
    const card = document.createElement('div');
    card.className = 'expense-card p-4 mb-3 flex justify-between items-center';
    const payer = tripUsers.find(u => String(u.id) === String(exp.payer_id));
    const payerName = `${payer?.name || 'Someone'}${payer?.left ? ' (left)' : ''}`;
    const departedShares = (Array.isArray(exp.split_between) ? exp.split_between : []).map(id => tripUsers.find(user => String(user.id) === String(id))).filter(user => user?.left).map(user => user.name);
    
    card.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-xl font-bold text-[#ce82ff]">💸</div>
        <div>
          <h3 class="font-extrabold text-lg text-[#4b4b4b] leading-tight">${exp.title}</h3>
          <p class="text-xs font-bold text-gray-400 mt-1">Paid by ${payerName}${departedShares.length ? ` · includes former member${departedShares.length > 1 ? 's' : ''}: ${departedShares.join(', ')}` : ''}</p>
          ${exp.shopping_location ? `<p class="shopping-expense-detail">Shopping trip · ${exp.shopping_location}${Array.isArray(exp.shopping_items) && exp.shopping_items.length ? ` · ${exp.shopping_items.join(', ')}` : ''}</p>` : ''}
        </div>
      </div>
      <div class="text-right">
        <span class="font-extrabold text-[#ce82ff] text-lg">${formatCurrency(exp.amount)}</span>
      </div>
    `;
    if (canManageExpenses) {
      card.onclick = () => { playClick(); openModal(exp.id); };
    }
    DOM.expensesList.appendChild(card);
  });

}

function renderDebts() {
  const balances = {};
  tripUsers.forEach(u => balances[u.id] = 0);

  activeTrip.expenses.forEach(exp => {
    const splitters = (Array.isArray(exp.split_between) ? exp.split_between : []).filter(id => !tripUsers.some(user => String(user.id) === String(id) && user.left));
    if (splitters.length === 0) return;
    const splitAmount = Number(exp.amount || 0) / splitters.length;
    if (balances[exp.payer_id] !== undefined) balances[exp.payer_id] += Number(exp.amount || 0);
    splitters.forEach(userId => {
      if (balances[userId] !== undefined) balances[userId] -= splitAmount;
    });
  });

  (activeTrip.workspace_data?.payments || []).forEach(payment => {
    const from = tripUsers.find(user => payment.from_id && String(user.id) === String(payment.from_id))
      || tripUsers.find(user => user.name.toLowerCase() === String(payment.from || '').toLowerCase());
    const to = tripUsers.find(user => payment.to_id && String(user.id) === String(payment.to_id))
      || tripUsers.find(user => user.name.toLowerCase() === String(payment.to || '').toLowerCase());
    const amount = Math.max(0, Number(payment.amount) || 0);
    if (from && to && from.id !== to.id && balances[from.id] !== undefined && balances[to.id] !== undefined) {
      balances[from.id] += amount;
      balances[to.id] -= amount;
    }
  });

  const creditors = []; const debtors = [];
  for (const [id, bal] of Object.entries(balances)) {
    if (bal > 0.01) creditors.push({ id, bal });
    else if (bal < -0.01) debtors.push({ id, bal: Math.abs(bal) });
  }

  const transactions = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]; const creditor = creditors[j];
    const amount = Math.min(debtor.bal, creditor.bal);
    transactions.push({ from: debtor.id, to: creditor.id, amount });
    debtor.bal -= amount; creditor.bal -= amount;
    if (debtor.bal < 0.01) i++;
    if (creditor.bal < 0.01) j++;
  }

  DOM.debtsContainer.innerHTML = '';
  if (transactions.length === 0) {
    DOM.debtsContainer.innerHTML = `<p class="text-sm font-bold text-[#58cc02]">You're all settled up! ✅</p>`;
    return;
  }

  transactions.forEach(t => {
    const fromPerson = tripUsers.find(u => String(u.id) === String(t.from));
    const toPerson = tripUsers.find(u => String(u.id) === String(t.to));
    const fromName = `${fromPerson?.name || 'Someone'}${fromPerson?.left ? ' (left)' : ''}`;
    const toName = `${toPerson?.name || 'Someone'}${toPerson?.left ? ' (left)' : ''}`;
    DOM.debtsContainer.innerHTML += `
      <div class="flex items-center justify-between text-sm">
        <span class="font-bold text-gray-500">${fromName} <span class="text-gray-300 mx-1">owes</span> ${toName}</span>
        <span class="font-extrabold text-[#ff9600]">${formatCurrency(t.amount)}</span>
      </div>
    `;
  });
}

export function initSplitter() {
  document.addEventListener('lakbay:payment-updated', () => { void renderSplitter(); });
  document.addEventListener('lakbay:auth-changed', () => { void renderSplitter(); });
  DOM.selectAll.onclick = () => { DOM.splitList.querySelectorAll('.split-checkbox').forEach(box => { box.checked = true; }); updateExpenseSaveState(); };
  DOM.clearAll.onclick = () => { DOM.splitList.querySelectorAll('.split-checkbox').forEach(box => { box.checked = false; }); updateExpenseSaveState(); };
  DOM.splitList.addEventListener('change', event => { if (event.target.matches('.split-checkbox')) updateExpenseSaveState(); });
  DOM.addBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    playClick(); editingExpenseId = null;
    DOM.deleteBtn.classList.add('hidden');
    DOM.title.value = ''; DOM.amount.value = '';
    await renderSplitter();
    populateUsers(); openModal();
  };

  DOM.saveBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    if (editingExpenseId && activeUserRole !== 'owner') return alert('Only the trip owner can edit logged expenses.');
    const title = DOM.title.value.trim();
    const amount = parseFloat(DOM.amount.value);
    if (!title || !amount || amount <= 0) return alert("Valid title and amount required.");
    
    const payer_id = DOM.payer.value;
    const split_between = Array.from(document.querySelectorAll('.split-checkbox:checked')).map(cb => cb.value);
    if (!split_between.length) { updateExpenseSaveState(); DOM.splitList.focus(); return; }
    if (!payer_id) return alert('Select who paid for this expense.');

    if (editingExpenseId) {
      const exp = activeTrip.expenses.find(e => e.id === editingExpenseId);
      exp.title = title; exp.amount = amount; exp.payer_id = payer_id; exp.split_between = split_between;
    } else {
      activeTrip.expenses.push({ id: 'exp-' + Date.now(), title, amount, payer_id, split_between });
    }
    
    playSuccess(); await updateTrip(activeTrip); closeModal(); renderSplitter();
  };

  DOM.deleteBtn.onclick = async () => {
    if (activeUserRole !== 'owner') return alert('Only the trip owner can delete logged expenses.');
    if (confirm("Delete this expense?")) {
      playClick(); activeTrip.expenses = activeTrip.expenses.filter(e => e.id !== editingExpenseId);
      await updateTrip(activeTrip); closeModal(); renderSplitter();
    }
  };
  DOM.closeBtn.onclick = () => { playClick(); closeModal(); };
}

function populateUsers(selectedPayer = null, selectedSplitters = null) {
  DOM.payer.innerHTML = ''; DOM.splitList.innerHTML = '';
  tripUsers.forEach(u => {
    const opt = document.createElement('option'); opt.value = u.id; opt.textContent = u.name;
    if (selectedPayer != null ? String(selectedPayer) === String(u.id) : String(u.id) === String(currentUser?.id || 'me')) opt.selected = true;
    DOM.payer.appendChild(opt);

    const isChecked = selectedSplitters ? selectedSplitters.map(String).includes(String(u.id)) : true;
    DOM.splitList.innerHTML += `
      <label class="flex items-center gap-3 p-1 cursor-pointer">
        <input type="checkbox" value="${escapeHtml(u.id)}" class="split-checkbox w-5 h-5 accent-[#58cc02]" ${isChecked ? 'checked' : ''}>
        <span class="font-bold text-sm">${escapeHtml(u.name)}</span>
      </label>
    `;
  });
  updateExpenseSaveState();
}

function updateExpenseSaveState() {
  const hasSelectedPeople = !!DOM.splitList.querySelector('.split-checkbox:checked');
  DOM.saveBtn.disabled = !hasSelectedPeople;
  DOM.saveBtn.setAttribute('aria-disabled', String(!hasSelectedPeople));
  DOM.saveBtn.title = hasSelectedPeople ? '' : 'Select at least one person to split this expense.';
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

function openModal(id = null) {
  if (id) {
    if (activeUserRole !== 'owner') return;
    editingExpenseId = id; const exp = activeTrip.expenses.find(e => e.id === id);
    DOM.title.value = exp.title; DOM.amount.value = exp.amount;
    DOM.deleteBtn.classList.remove('hidden'); populateUsers(exp.payer_id, exp.split_between);
  }
  DOM.bg.classList.remove('hidden'); setTimeout(() => DOM.modal.classList.remove('translate-y-full'), 10);
}
function closeModal() { DOM.modal.classList.add('translate-y-full'); setTimeout(() => DOM.bg.classList.add('hidden'), 300); }
