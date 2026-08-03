const dayMap: Record<string, number> = {
  'أحد': 0, 'الاحد': 0, 'الأحد': 0, 'sun': 0,
  'إثنين': 1, 'اثنين': 1, 'الإثنين': 1, 'mon': 1,
  'ثلاثاء': 2, 'الثلاثاء': 2, 'tue': 2,
  'أربعاء': 3, 'اربعاء': 3, 'الأربعاء': 3, 'wed': 3,
  'خميس': 4, 'الخميس': 4, 'thu': 4,
  'جمعة': 5, 'الجمعة': 5, 'fri': 5,
  'سبت': 6, 'السبت': 6, 'sat': 6
};

function parseWorkingDays(daysStr: string): number[] {
  if (!daysStr) return [0, 1, 2, 3, 4, 6];
  const text = daysStr.trim().toLowerCase();
  if (text.includes('كل الأيام') || text.includes('يوميا')) return [0, 1, 2, 3, 4, 5, 6];
  if (text.includes('-') || text.includes('إلى') || text.includes('لـ')) {
    const parts = text.split(/[-–—ىلـ]/).map(p => p.trim());
    let startDay = -1;
    let endDay = -1;
    for (const [key, num] of Object.entries(dayMap)) {
      if (parts[0]?.includes(key)) startDay = num;
      if (parts[1]?.includes(key)) endDay = num;
    }
    if (startDay !== -1 && endDay !== -1) {
      const days: number[] = [];
      let curr = startDay;
      while (true) {
        days.push(curr);
        if (curr === endDay) break;
        curr = (curr + 1) % 7;
      }
      return days;
    }
  }
  const days: number[] = [];
  for (const [key, num] of Object.entries(dayMap)) {
    if (text.includes(key) && !days.includes(num)) days.push(num);
  }
  return days.length > 0 ? days : [0, 1, 2, 3, 4, 6];
}

// Note: heavy lowercase of Arabic does not alter letters; but `.toLowerCase()` on Arabic
// hari is fine. Test with the raw cell values:
for (const s of ['السبت - الخميس', 'الأحد - الخميس', 'الخميس والجمعة', 'السبت - الأربعاء', 'الجمعة والسبت']) {
  console.log(JSON.stringify(s), '->', JSON.stringify(parseWorkingDays(s)));
}