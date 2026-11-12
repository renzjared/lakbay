import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// PASTE YOUR KEYS HERE WHEN READY
const SUPABASE_URL = 'https://abkkzgoehplnslmsakbu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_C_VPEGIUJspwLIyD3EtvmQ_qhYPdgIa';

export const useSupabase = SUPABASE_URL !== 'YOUR_SUPABASE_URL';
export let supabase = null;

if (useSupabase) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

const DB_KEY = 'travel_app_trips';

export function initStorage() {
  if (!useSupabase) {
    const existing = localStorage.getItem(DB_KEY);
    if (!existing) localStorage.setItem(DB_KEY, JSON.stringify([]));
  }
}

export async function getTrips() {
  if (useSupabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return []; 
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
    
    const { data: ownedTrips } = await supabase.from('trips').select('*').eq('owner_id', user.id);
    let memberQuery = `user_id.eq.${user.id}`;
    if (profile && profile.username) memberQuery += `,pending_username.ilike.${profile.username}`;

    const { data: sharedData } = await supabase.from('trip_members').select('trips(*)').or(memberQuery);
    const sharedTrips = (sharedData || []).map(row => row.trips).filter(trip => trip !== null);

    const allTrips = [...(ownedTrips || []), ...sharedTrips];
    return Array.from(new Map(allTrips.map(item => [item.id, item])).values()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else {
    const data = localStorage.getItem(DB_KEY);
    return data ? JSON.parse(data) : [];
  }
}

export async function getTrip(id) {
  if (useSupabase) {
    const { data } = await supabase.from('trips').select('*').eq('id', id).single();
    return data;
  }
  const trips = await getTrips();
  return trips.find(t => t.id === id);
}

export async function updateTrip(updatedTrip) {
  if (useSupabase) {
    const values = {
      emoji: updatedTrip.emoji,
      destination: updatedTrip.destination,
      days: updatedTrip.days,
      notes: updatedTrip.notes,
      expenses: updatedTrip.expenses, // Ensure expenses are saved
      visibility: updatedTrip.visibility
    };
    if (updatedTrip.workspace_data !== undefined) values.workspace_data = updatedTrip.workspace_data;
    let { error } = await supabase.from('trips').update(values).eq('id', updatedTrip.id);

    // Keep core trip actions working on existing databases before the optional
    // workspace_data migration is applied. New workspace data is cached locally.
    if (error && updatedTrip.workspace_data !== undefined && /workspace_data/i.test(error.message || '')) {
      const { workspace_data, ...legacyValues } = values;
      const retry = await supabase.from('trips').update(legacyValues).eq('id', updatedTrip.id);
      error = retry.error;
      if (!error) localStorage.setItem(`lakbay_${updatedTrip.id}_workspace_data`, JSON.stringify(updatedTrip.workspace_data));
    }
    
    if (error) {
      alert("Action denied: You don't have permission to edit this.");
      window.location.reload(); 
      return false;
    }
    return true;
  } else {
    const trips = await getTrips();
    const index = trips.findIndex(t => t.id === updatedTrip.id);
    if (index !== -1) {
      trips[index] = updatedTrip;
      localStorage.setItem(DB_KEY, JSON.stringify(trips));
    }
    return true;
  }
}

export async function createTrip(emoji, destination) {
  if (useSupabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const newTrip = { 
      emoji: emoji || '📍', destination, days: [], notes: [], expenses: [],
      owner_id: user.id, visibility: 'private'
    };
    const { data } = await supabase.from('trips').insert([newTrip]).select();
    if (data?.[0]) data[0].workspace_data ||= {};
    return data ? data[0] : null;
  } else {
    const newTrip = { emoji: emoji || '📍', destination, days: [], notes: [], expenses: [], workspace_data: {} };
    const trips = await getTrips();
    newTrip.id = 'trip-' + Date.now().toString();
    trips.push(newTrip);
    localStorage.setItem(DB_KEY, JSON.stringify(trips));
    return newTrip;
  }
}

export async function deleteTrip(id) {
  if (useSupabase) {
    await supabase.from('trips').delete().eq('id', id);
  } else {
    const trips = await getTrips();
    localStorage.setItem(DB_KEY, JSON.stringify(trips.filter(trip => trip.id !== id)));
  }
}
