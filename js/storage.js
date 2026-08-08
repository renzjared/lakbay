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

    // 1. Fetch trips where you are the owner
    const { data: ownedTrips, error: error1 } = await supabase
      .from('trips')
      .select('*')
      .eq('owner_id', user.id);
      
    if (error1) console.error("Error fetching owned trips:", error1);

    // 2. Fetch trips where you are a collaborator (member)
    const { data: sharedData, error: error2 } = await supabase
      .from('trip_members')
      .select('trips(*)')
      .eq('user_id', user.id);

    if (error2) console.error("Error fetching shared trips:", error2);

    // Extract the nested trip objects from the shared data
    const sharedTrips = (sharedData || [])
      .map(row => row.trips)
      .filter(trip => trip !== null); // Filter out any nulls if a trip was deleted

    // 3. Combine, remove any duplicates, and sort by date created
    const allTrips = [...(ownedTrips || []), ...sharedTrips];
    const uniqueTrips = Array.from(new Map(allTrips.map(item => [item.id, item])).values());
    
    return uniqueTrips.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
  } else {
    // LocalStorage fallback
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