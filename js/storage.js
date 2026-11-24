import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// PASTE YOUR KEYS HERE WHEN READY
const SUPABASE_URL = 'https://abkkzgoehplnslmsakbu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_C_VPEGIUJspwLIyD3EtvmQ_qhYPdgIa';

export const useSupabase = SUPABASE_URL !== 'YOUR_SUPABASE_URL';
export let supabase = null;

if (useSupabase) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
  });
}

const DB_KEY = 'travel_app_trips';

function getLocalWorkspaceData(tripId) {
  let workspace={};
  try { workspace=JSON.parse(localStorage.getItem(`lakbay_${tripId}_workspace_data`) || '{}'); }
  catch { workspace={}; }
  // Older app builds kept some modules in per-feature keys before they were
  // consolidated into trips.workspace_data. Preserve those values for migration.
  for(const name of ['food','people','groups','methods','payments','forum','expenses']){
    if(workspace[name]!==undefined)continue;
    try{const value=localStorage.getItem(`lakbay_${tripId}_${name}`);if(value!==null)workspace[name]=JSON.parse(value)}catch{}
  }
  return workspace;
}

function isWorkspaceValueEmpty(value){if(value==null)return true;if(Array.isArray(value))return value.length===0||value.every(isWorkspaceValueEmpty);if(typeof value==='object')return Object.keys(value).length===0||Object.values(value).every(isWorkspaceValueEmpty);return false}

async function restoreOwnerLocalWorkspace(trip, remoteWorkspace){
  const localWorkspace=getLocalWorkspaceData(trip.id);
  const merged={...(remoteWorkspace||{})};let changed=false;
  for(const [name,value] of Object.entries(localWorkspace)){
    if(isWorkspaceValueEmpty(merged[name])&&!isWorkspaceValueEmpty(value)){merged[name]=value;changed=true}
  }
  if(!changed)return trip;
  try{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user||String(user.id)!==String(trip.owner_id))return trip;
    const {error}=await supabase.from('trips').update({workspace_data:merged}).eq('id',trip.id);
    if(error){console.warn('Could not restore locally cached trip data to Supabase.',error);return trip}
    trip.workspace_data=merged;
    trip.expenses=Array.isArray(merged.expenses)?merged.expenses:(trip.expenses||[]);
  }catch(error){console.warn('Could not restore locally cached trip data to Supabase.',error)}
  return trip;
}

function hydrateTrip(trip) {
  if (!trip) return trip;
  const workspace = {
    ...getLocalWorkspaceData(trip.id),
    ...(trip.workspace_data && typeof trip.workspace_data === 'object' ? trip.workspace_data : {})
  };
  trip.workspace_data = workspace;
  if (!Array.isArray(trip.expenses)) trip.expenses = Array.isArray(workspace.expenses) ? workspace.expenses : [];
  return trip;
}

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

    const allTrips = [...(ownedTrips || []), ...sharedTrips].map(hydrateTrip);
    return Array.from(new Map(allTrips.map(item => [item.id, item])).values()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else {
    const data = localStorage.getItem(DB_KEY);
    return data ? JSON.parse(data) : [];
  }
}

export async function getTrip(id) {
  if (useSupabase) {
    const { data, error } = await supabase.from('trips').select('*').eq('id', id).single();
    if (error) throw error;
    const trip=hydrateTrip(data);
    await restoreOwnerLocalWorkspace(trip,data.workspace_data||{});
    return trip;
  }
  const trips = await getTrips();
  return trips.find(t => t.id === id);
}

export async function getTripLinkPreview(code) {
  if (useSupabase) {
    const { data, error } = await supabase.rpc('get_trip_link_preview', { p_code: String(code || '') });
    if (error) throw error;
    return data;
  }
  const trip = await getTrip(code);
  if (!trip) return null;
  return {
    id: trip.id,
    invite_code: trip.invite_code || String(trip.id),
    destination: trip.destination,
    emoji: trip.emoji,
    owner_name: trip.owner_name || 'Trip organizer',
    visibility: trip.visibility || 'private',
    start_date: trip.workspace_data?.start_date || null,
    end_date: trip.workspace_data?.end_date || null,
    day_count: trip.days?.length || 0,
    workspace_data: trip.workspace_data || {},
    pending_people: (trip.workspace_data?.people || []).filter(person => person && person.guest !== false && !person.linked_user_id).map(({id,name}) => ({id,name}))
  };
}

export async function getPublicTripView(code) {
  if (useSupabase) {
    const { data, error } = await supabase.rpc('get_public_trip_view', { p_code: String(code || '') });
    if (error) throw error;
    if(data&&(!Number.isFinite(Number(data.public_view_version))||Number(data.public_view_version)<2))throw new Error('Public trip preview data is outdated. Run the latest supabase-overhaul.sql migration, then reload this invite.');
    if(data?.workspace_data){data.expenses=Array.isArray(data.workspace_data.expenses)?data.workspace_data.expenses:[];data.days=Array.isArray(data.days)?data.days:[];data.public_members=Array.isArray(data.members)?data.members:[];}
    return data;
  }
  const trip = await getTrip(code);
  if (!trip || !['public_view', 'public_edit'].includes(trip.visibility)) return null;
  return {
    id: trip.id,
    destination: trip.destination,
    emoji: trip.emoji,
    owner_id: trip.owner_id,
    visibility: trip.visibility,
    days: trip.days || [],
    workspace_data: { ...trip.workspace_data, start_date: trip.workspace_data?.start_date || null, end_date: trip.workspace_data?.end_date || null }
  };
}

export async function updateTrip(updatedTrip) {
  if (useSupabase) {
    const workspaceData = {
      ...(updatedTrip.workspace_data || getLocalWorkspaceData(updatedTrip.id)),
      expenses: Array.isArray(updatedTrip.expenses) ? updatedTrip.expenses : []
    };
    const values = {
      emoji: updatedTrip.emoji,
      destination: updatedTrip.destination,
      days: updatedTrip.days,
      notes: updatedTrip.notes,
      visibility: updatedTrip.visibility,
      workspace_data: workspaceData
    };
    const { workspace_data, ...legacyValues } = values;
    let { error } = await supabase.from('trips').update(values).eq('id', updatedTrip.id);

    // Keep older databases usable if the workspace_data migration has not been applied.
    if (error && /workspace_data/i.test(error.message || '')) {
      const retry = await supabase.from('trips').update(legacyValues).eq('id', updatedTrip.id);
      error = retry.error;
      if (!error) localStorage.setItem(`lakbay_${updatedTrip.id}_workspace_data`, JSON.stringify(workspace_data));
    }
    
    if (error) {
      console.error('Could not save trip.', error);
      alert(`Could not save this trip. ${error.message || 'Please try again.'}`);
      return false;
    }
    updatedTrip.workspace_data = workspaceData;
    updatedTrip.expenses = workspaceData.expenses;
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

export async function createTrip(emoji, destination, options = {}) {
  if (useSupabase) {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Please sign in with Discord before creating a trip.');
    const newTrip = {
      emoji: emoji || '📍', destination, days: [], notes: [],
      workspace_data: {
        expenses: [], icon_url: options.iconUrl || '', start_date: options.startDate || null, end_date: options.endDate || null
      },
      owner_id: user.id, visibility: ['private', 'public_view', 'public_edit'].includes(options.visibility) ? options.visibility : 'private'
    };
    let { data, error } = await supabase.from('trips').insert(newTrip).select('*').single();
    if (error && /workspace_data/i.test(error.message || '')) {
      const { workspace_data, ...legacyTrip } = newTrip;
      const retry = await supabase.from('trips').insert(legacyTrip).select('*').single();
      data = retry.data;
      error = retry.error;
      if (data) localStorage.setItem(`lakbay_${data.id}_workspace_data`, JSON.stringify(workspace_data));
    }
    if (error) throw new Error(error.message || 'Supabase could not create the trip.');
    if (!data) throw new Error('Supabase did not return the created trip.');
    return hydrateTrip(data);
  } else {
    const newTrip = {
      emoji: emoji || '📍', destination, days: [], notes: [], expenses: [],
      visibility: ['private', 'public_view', 'public_edit'].includes(options.visibility) ? options.visibility : 'private',
      workspace_data: { expenses: [], icon_url: options.iconUrl || '', start_date: options.startDate || null, end_date: options.endDate || null }
    };
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
