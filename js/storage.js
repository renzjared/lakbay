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
    const { error } = await supabase.from('trips').update({
      emoji: updatedTrip.emoji,
      destination: updatedTrip.destination,
      days: updatedTrip.days,
      notes: updatedTrip.notes,
      expenses: updatedTrip.expenses, // Ensure expenses are saved
      visibility: updatedTrip.visibility
    }).eq('id', updatedTrip.id);
    
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
    return data ? data[0] : null;
  } else {
    const newTrip = { emoji: emoji || '📍', destination, days: [], notes: [], expenses: [] };
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