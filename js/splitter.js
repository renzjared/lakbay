import { activeTrip, activeUserRole } from './itinerary.js';
import { updateTrip, supabase, useSupabase } from './storage.js';
import { playClick, playSuccess } from './audio.js';
import { formatCurrency } from './timeUtils.js';

let editingExpenseId = null;
let tripUsers = []; // Cache of collaborators

const DOM = {
  view: document.getElementById('splitter-view'), addBtn: document.getElementById('add-expense-btn'),
  bg: document.getElementById('expense-backdrop'), modal: document.getElementById('expense-modal'),
  title: document.getElementById('expense-title'), amount: document.getElementById('expense-amount'),
  payer: document.getElementById('expense-payer'), splitList: document.getElementById('expense-split-list'),
  saveBtn: document.getElementById('save-expense-btn'), deleteBtn: document.getElementById('delete-expense-btn'),
  closeBtn: document.getElementById('close-expense-btn'), expensesList: document.getElementById('expenses-list'),
  debtsContainer: document.getElementById('debts-container')
};

function ensureExpensesExist() { if (!activeTrip.expenses) activeTrip.expenses = []; }

export async function renderSplitter() {
  ensureExpensesExist();
  const canEdit = activeUserRole !== 'viewer';
  DOM.addBtn.style.display = canEdit ? 'block' : 'none';

  // Fetch all users involved in this trip
  tripUsers = [{ id: 'me', name: 'Me (Local)' }]; 
  if (useSupabase) {
    const { data: owner } = await supabase.from('profiles').select('id, username').eq('id', activeTrip.owner_id).single();
    const { data: members } = await supabase.from('trip_members').select('profiles(id, username)').eq('trip_id', activeTrip.id);
    tripUsers = [];
    if (owner) tripUsers.push({ id: owner.id, name: owner.username });
    if (members) members.forEach(m => { if (m.profiles) tripUsers.push({ id: m.profiles.id, name: m.profiles.username }); });
  }

  renderDebts();
  
  DOM.expensesList.innerHTML = '';
  if (activeTrip.expenses.length === 0) {
    DOM.expensesList.innerHTML = `<div class="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl"><p class="font-bold text-gray-400">No expenses yet.</p></div>`;
    return;
  }

  activeTrip.expenses.forEach(exp => {
    const card = document.createElement('div');
    card.className = 'expense-card p-4 mb-3 flex justify-between items-center';
    const payerName = tripUsers.find(u => u.id === exp.payer_id)?.name || 'Someone';
    
    card.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-xl font-bold text-[#ce82ff]">💸</div>
        <div>
          <h3 class="font-extrabold text-lg text-[#4b4b4b] leading-tight">${exp.title}</h3>
          <p class="text-xs font-bold text-gray-400 mt-1">Paid by ${payerName}</p>
        </div>
      </div>
      <div class="text-right">
        <span class="font-extrabold text-[#ce82ff] text-lg">${formatCurrency(exp.amount)}</span>
      </div>
    `;
    if (canEdit) {
      card.onclick = () => { playClick(); openModal(exp.id); };
    }
    DOM.expensesList.appendChild(card);
  });
}

function renderDebts() {
  const balances = {};
  tripUsers.forEach(u => balances[u.id] = 0);

  activeTrip.expenses.forEach(exp => {
    const splitCount = exp.split_between.length;
    if (splitCount === 0) return;
    const splitAmount = exp.amount / splitCount;
    if (balances[exp.payer_id] !== undefined) balances[exp.payer_id] += exp.amount; // They paid it
    exp.split_between.forEach(userId => {
      if (balances[userId] !== undefined) balances[userId] -= splitAmount; // They owe it
    });
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
    const fromName = tripUsers.find(u => u.id === t.from)?.name || 'Someone';
    const toName = tripUsers.find(u => u.id === t.to)?.name || 'Someone';
    DOM.debtsContainer.innerHTML += `
      <div class="flex items-center justify-between text-sm">
        <span class="font-bold text-gray-500">${fromName} <span class="text-gray-300 mx-1">owes</span> ${toName}</span>
        <span class="font-extrabold text-[#ff9600]">${formatCurrency(t.amount)}</span>
      </div>
    `;
  });
}

export function initSplitter() {
  DOM.addBtn.onclick = () => {
    if (activeUserRole === 'viewer') return;
    playClick(); editingExpenseId = null;
    DOM.deleteBtn.classList.add('hidden');
    DOM.title.value = ''; DOM.amount.value = '';
    populateUsers(); openModal();
  };

  DOM.saveBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    const title = DOM.title.value.trim();
    const amount = parseFloat(DOM.amount.value);
    if (!title || !amount || amount <= 0) return alert("Valid title and amount required.");
    
    const payer_id = DOM.payer.value;
    const split_between = Array.from(document.querySelectorAll('.split-checkbox:checked')).map(cb => cb.value);
    if (split_between.length === 0) return alert("Must split with at least 1 person.");

    if (editingExpenseId) {
      const exp = activeTrip.expenses.find(e => e.id === editingExpenseId);
      exp.title = title; exp.amount = amount; exp.payer_id = payer_id; exp.split_between = split_between;
    } else {
      activeTrip.expenses.push({ id: 'exp-' + Date.now(), title, amount, payer_id, split_between });
    }
    
    playSuccess(); await updateTrip(activeTrip); closeModal(); renderSplitter();
  };

  DOM.deleteBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
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
    if (selectedPayer === u.id) opt.selected = true;
    DOM.payer.appendChild(opt);

    const isChecked = selectedSplitters ? selectedSplitters.includes(u.id) : true;
    DOM.splitList.innerHTML += `
      <label class="flex items-center gap-3 p-1 cursor-pointer">
        <input type="checkbox" value="${u.id}" class="split-checkbox w-5 h-5 accent-[#ce82ff]" ${isChecked ? 'checked' : ''}>
        <span class="font-bold text-[#4b4b4b] text-sm">${u.name}</span>
      </label>
    `;
  });
}

function openModal(id = null) {
  if (id) {
    editingExpenseId = id; const exp = activeTrip.expenses.find(e => e.id === id);
    DOM.title.value = exp.title; DOM.amount.value = exp.amount;
    DOM.deleteBtn.classList.remove('hidden'); populateUsers(exp.payer_id, exp.split_between);
  }
  DOM.bg.classList.remove('hidden'); setTimeout(() => DOM.modal.classList.remove('translate-y-full'), 10);
}
function closeModal() { DOM.modal.classList.add('translate-y-full'); setTimeout(() => DOM.bg.classList.add('hidden'), 300); }