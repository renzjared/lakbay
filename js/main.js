import { initStorage } from './storage.js';
import { initAuth } from './auth.js';
import { initUI } from './ui.js';
import { initNotes } from './notes.js';
import { initShareUI } from './share.js';
import { initWorkspace } from './workspace.js';

document.addEventListener('DOMContentLoaded', async () => {
  initStorage(); 
  await initAuth(); 
  initNotes();
  initShareUI();
  await initUI(); 
  initWorkspace();
});
