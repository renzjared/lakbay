import { activeTrip } from './itinerary.js';

const DOM = {
  container: document.getElementById('hub-container')
};

// Static fallbacks for essentials (since free APIs don't provide these)
const EMERGENCY_DATA = {
  'japan': { num: '110 (Police), 119 (Ambulance)', plug: 'Type A/B (100V)' },
  'philippines': { num: '911', plug: 'Type A/B/C (220V)' },
  'united states': { num: '911', plug: 'Type A/B (120V)' },
  'korea': { num: '110 (Police), 119 (Ambulance)', plug: 'Type C/F (220V)' },
  'thailand': { num: '112', plug: 'Type C/F (220V)' }
};

export async function renderHub() {
  if (!activeTrip) return;
  DOM.container.innerHTML = `<div class="text-center py-12 text-gray-400 font-bold animate-pulse">Scanning destination...</div>`;

  // Try to extract country from "City, Country" format
  let searchStr = activeTrip.destination.split(',').pop().trim();
  
  let countryData = null;
  try {
    const res = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(searchStr)}?fullText=false`);
    if (res.ok) {
      const data = await res.json();
      countryData = data[0]; // Take best match
    }
  } catch(e) { console.warn("Could not fetch country API"); }

  const cNameLower = searchStr.toLowerCase();
  const staticData = EMERGENCY_DATA[cNameLower] || Object.values(EMERGENCY_DATA).find((_, idx) => Object.keys(EMERGENCY_DATA)[idx].includes(cNameLower)) || { num: 'Check Local', plug: 'Check Local' };

  let currencyStr = 'Unknown';
  let langStr = 'Unknown';
  if (countryData) {
    if (countryData.currencies) currencyStr = Object.values(countryData.currencies).map(c => `${c.name} (${c.symbol})`).join(', ');
    if (countryData.languages) langStr = Object.values(countryData.languages).join(', ');
  }

  DOM.container.innerHTML = `
    <!-- General Info -->
    <div class="bg-white rounded-2xl p-5 border-2 border-[#e5e5e5]">
      <h3 class="font-extrabold text-xl text-[#4b4b4b] mb-4 flex items-center gap-2"><span class="text-2xl">🌍</span> Local Intel</h3>
      <div class="space-y-3 text-sm">
        <div class="flex justify-between border-b-2 border-gray-50 pb-2">
          <span class="font-bold text-gray-400 uppercase">Currency</span>
          <span class="font-extrabold text-[#4b4b4b] text-right">${currencyStr}</span>
        </div>
        <div class="flex justify-between border-b-2 border-gray-50 pb-2">
          <span class="font-bold text-gray-400 uppercase">Languages</span>
          <span class="font-extrabold text-[#4b4b4b] text-right">${langStr}</span>
        </div>
        ${countryData ? `
        <div class="flex justify-between pb-1">
          <span class="font-bold text-gray-400 uppercase">Region</span>
          <span class="font-extrabold text-[#4b4b4b] text-right">${countryData.subregion || countryData.region}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Survival Essentials -->
    <div class="grid grid-cols-2 gap-4">
      <div class="bg-[#fff2f2] rounded-2xl p-4 border-2 border-[#ffb3b3]">
        <span class="text-2xl block mb-2">🚨</span>
        <h4 class="font-bold text-[#ff4b4b] text-xs uppercase mb-1">Emergency</h4>
        <span class="font-extrabold text-[#4b4b4b]">${staticData.num}</span>
      </div>
      <div class="bg-[#f0f9ff] rounded-2xl p-4 border-2 border-[#1cb0f6]">
        <span class="text-2xl block mb-2">🔌</span>
        <h4 class="font-bold text-[#1899d6] text-xs uppercase mb-1">Plugs / Power</h4>
        <span class="font-extrabold text-[#4b4b4b]">${staticData.plug}</span>
      </div>
    </div>
  `;
}