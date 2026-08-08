import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// PASTE YOUR KEYS HERE WHEN READY
const SUPABASE_URL = 'https://abkkzgoehplnslmsakbu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_C_VPEGIUJspwLIyD3EtvmQ_qhYPdgIa';

export const useSupabase = SUPABASE_URL !== 'YOUR_SUPABASE_URL';
export let supabase = null;

if (useSupabase) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("☁️ Connected to Supabase");
} else {
  console.log("💾 Running in LocalStorage mode");
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

    const { data, error } = await supabase
      .from('trips')
      .select(`*, trip_members!inner(user_id)`)
      .or(`owner_id.eq.${user.id},trip_members.user_id.eq.${user.id}`)
      .order('created_at', { ascending: true });
      
    if (error && error.code !== 'PGRST116') console.error("Fetch Error:", error);
    const cleanData = (data || []).map(t => { delete t.trip_members; return t; });
    return Array.from(new Map(cleanData.map(item => [item.id, item])).values());
  } else {
    const data = localStorage.getItem(DB_KEY);
    return data ? JSON.parse(data) : [];
  }
}

export async function getTrip(id) {
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
      visibility: updatedTrip.visibility
    }).eq('id', updatedTrip.id);
    if (error) console.error("Update Error:", error);
  } else {
    const trips = await getTrips();
    const index = trips.findIndex(t => t.id === updatedTrip.id);
    if (index !== -1) {
      trips[index] = updatedTrip;
      localStorage.setItem(DB_KEY, JSON.stringify(trips));
    }
  }
}

export async function createTrip(emoji, destination) {
  if (useSupabase) {
    // 1. Get the currently logged-in user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      alert("You must be logged in to create a trip.");
      return null;
    }

    // 2. Explicitly attach the owner_id and default visibility
    const newTrip = { 
      emoji: emoji || '📍', 
      destination, 
      days: [], 
      notes: [],
      owner_id: user.id,          // <--- This fixes the RLS blocking issue
      visibility: 'private'       // <--- Sets default sharing status
    };

    const { data, error } = await supabase.from('trips').insert([newTrip]).select();
    
    // 3. Surface the error to the screen if it fails!
    if (error) {
      console.error("Insert Error:", error);
      alert("Failed to save trip: " + error.message); 
      return null;
    }
    
    return data ? data[0] : null;
    
  } else {
    // LocalStorage fallback (unchanged)
    const newTrip = { emoji: emoji || '📍', destination, days: [], notes: [] };
    const trips = await getTrips();
    newTrip.id = 'trip-' + Date.now().toString();
    trips.push(newTrip);
    localStorage.setItem('travel_app_trips', JSON.stringify(trips));
    return newTrip;
  }
}

export async function deleteTrip(id) {
  if (useSupabase) {
    const { error } = await supabase.from('trips').delete().eq('id', id);
    if (error) console.error("Delete Error:", error);
  } else {
    const trips = await getTrips();
    localStorage.setItem(DB_KEY, JSON.stringify(trips.filter(trip => trip.id !== id)));
  }
}