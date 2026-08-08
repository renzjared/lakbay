export function minutesToStr(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function strToMinutes(timeStr) {
  if(!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60) + m;
}

export function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '';
  return `¥${amount.toLocaleString()}`; 
}