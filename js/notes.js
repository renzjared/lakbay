import { activeTrip, activeUserRole } from './itinerary.js';
import { updateTrip } from './storage.js';
import { playClick, playSuccess } from './audio.js';

let editingNoteId = null;

const DOM = {
  list: document.getElementById('notes-list'),
  addBtn: document.getElementById('add-note-btn'),
  bg: document.getElementById('note-backdrop'),
  modal: document.getElementById('note-modal'),
  title: document.getElementById('note-title'),
  content: document.getElementById('note-content'),
  saveBtn: document.getElementById('save-note-btn'),
  deleteBtn: document.getElementById('delete-note-btn'),
  closeBtn: document.getElementById('close-note-btn')
};

function ensureNotesExist() { if (!activeTrip.notes) activeTrip.notes = []; }

export function initNotes() {
  DOM.addBtn.onclick = () => {
    if (activeUserRole === 'viewer') return;
    ensureNotesExist();
    if (activeTrip.notes.length >= 5) return alert("Maximum 5 notes allowed per trip.");
    playClick(); editingNoteId = null;
    DOM.deleteBtn.classList.add('hidden');
    DOM.title.value = ''; DOM.content.value = '';
    openModal();
  };

  DOM.saveBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    ensureNotesExist();
    const title = DOM.title.value.trim() || 'Untitled Note';
    const content = DOM.content.value.trim();
    if(!content) return alert("Note content is required.");

    if(editingNoteId) {
      const note = activeTrip.notes.find(n => n.id === editingNoteId);
      note.title = title; note.content = content;
    } else {
      activeTrip.notes.push({ id: 'note-' + Date.now(), title, content });
    }
    
    playSuccess(); await updateTrip(activeTrip); closeModal(); renderNotes();
  };

  DOM.deleteBtn.onclick = async () => {
    if (activeUserRole === 'viewer') return;
    ensureNotesExist();
    if(confirm("Delete this note?")) {
      playClick();
      activeTrip.notes = activeTrip.notes.filter(n => n.id !== editingNoteId);
      await updateTrip(activeTrip); closeModal(); renderNotes();
    }
  };

  DOM.closeBtn.onclick = () => { playClick(); closeModal(); };
}

export function renderNotes() {
  ensureNotesExist();
  DOM.list.innerHTML = '';
  
  // Enforce permissions for the Add button
  const canEdit = activeUserRole !== 'viewer';
  DOM.addBtn.style.display = canEdit ? 'block' : 'none';

  if (activeTrip.notes.length === 0) {
    DOM.list.innerHTML = `<div class="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl"><h3 class="font-bold text-gray-400">No notes yet.</h3></div>`;
    return;
  }

  activeTrip.notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card p-5 mb-4 relative';
    
    // Custom replacer for -# small text to work with marked
    const preProcessed = note.content.replace(/-# (.*)/g, '<small>$1</small>');
    const htmlContent = marked.parse(preProcessed);

    // Only render the Edit button if authorized
    const editBtnHtml = canEdit ? `<button class="edit-note-btn text-gray-300 hover:text-[#1cb0f6] font-bold px-2 py-1 bg-gray-50 rounded-lg">Edit</button>` : '';

    card.innerHTML = `
      <div class="flex justify-between items-center mb-3 border-b-2 border-gray-100 pb-2">
        <h3 class="font-extrabold text-xl text-[#ff9600]">${note.title}</h3>
        ${editBtnHtml}
      </div>
      <div class="md-content">${htmlContent}</div>
    `;
    
    if (canEdit) {
      card.querySelector('.edit-note-btn').onclick = (e) => {
        e.stopPropagation(); playClick(); editingNoteId = note.id;
        DOM.title.value = note.title; DOM.content.value = note.content;
        DOM.deleteBtn.classList.remove('hidden'); openModal();
      };
    }
    
    DOM.list.appendChild(card);
  });
}

function openModal() { DOM.bg.classList.remove('hidden'); setTimeout(() => DOM.modal.classList.remove('translate-y-full'), 10); }
function closeModal() { DOM.modal.classList.add('translate-y-full'); setTimeout(() => DOM.bg.classList.add('hidden'), 300); }