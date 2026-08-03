import { getBaghdadToday, addDays, formatDate } from '../utils/baghdad-time.js';

/**
 * Deterministic, hallucination-free interpretation layer.
 * Everything here maps EXPLICIT user text (however misspelled/short) to concrete
 * booking facts. Nothing is invented: if the text doesn't say it, we don't set it.
 */

export interface TimeRange {
  startMinute: number;
  endMinute: number;
  term?: string;
}

export interface ExactTime {
  hh: number;
  mm: number;
}

export type InterpretedTime =
  | { kind: 'exact'; value: ExactTime }
  | { kind: 'range'; value: TimeRange }
  | null;

export interface InterpretedDay {
  term: string;
  offset: number; // days from today; 0 = today (engine treats as tomorrow politely)
}

/**
 * Normalize Arabic text for fuzzy matching:
 * strips diacritics, unifies أ/إ/آ->ا, ة->ه, ى->ي, collapses doubled letters
 * (تبييض -> تبيض), collapses whitespace.
 */
export function normalizeArabicText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
};
const PERSIAN_DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
};

/** Convert any Arabic/Persian/English digit string to plain ASCII digits */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, ch => ARABIC_DIGITS[ch] ?? PERSIAN_DIGITS[ch] ?? ch);
}

const NUMBER_WORDS: Record<string, number> = {
  'صفر': 0, 'واحد': 1, 'وحده': 1, 'اثنان': 2, 'اثنين': 2, 'اثن': 2, 'ثنين': 2, 'ثلاثه': 3, 'ثلاثة': 3, 'ثلاث': 3,
  'اربعه': 4, 'اربعة': 4, 'اربع': 4, 'خمسه': 5, 'خمسة': 5, 'خمس': 5,
  'سته': 6, 'ستة': 6, 'ست': 6, 'سبعه': 7, 'سبعة': 7, 'سبع': 7,
  'ثمانيه': 8, 'ثمانية': 8, 'ثمان': 8, 'تسعه': 9, 'تسعة': 9, 'تسع': 9,
  'عشره': 10, 'عشرة': 10, 'عشر': 10,
  'نص': 30, 'نصف': 30, 'ربع': 15, 'عشرين': 20, 'خمسين': 50
};

const WEEKDAYS: Record<string, number> = {
  'احد': 0, 'الاحد': 0, 'الأحد': 0,
  'اثنين': 1, 'اثن': 1, 'الاثنين': 1, 'الإثنين': 1,
  'ثلاثاء': 2, 'الثلاثاء': 2,
  'اربعاء': 3, 'أربعاء': 3, 'الاربعاء': 3, 'الأربعاء': 3,
  'خميس': 4, 'الخميس': 4,
  'جمعه': 5, 'جمعة': 5, 'الجمعه': 5, 'الجمعة': 5,
  'سبت': 6, 'السبت': 6
};

const DAY_NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS)
  .filter(k => !['نص', 'نصف', 'ربع', 'عشرين', 'خمسين'].includes(k))
  .sort((a, b) => b.length - a.length)
  .join('|');

const DAY_TERMS: Array<{ regex: RegExp; offset: number; term: string }> = [
  // Specific "the day after tomorrow" phrases first (before plain "باجر")
  { regex: /(?:عكب|عقبا|بعد)\s*(باجر|بكره|بكرا|غدا|غداً)(?=\s|$)/, offset: 2, term: 'عكب باجر' },
  { regex: /بعد\s*غد(?=\s|$)/, offset: 2, term: 'بعد غد' },
  { regex: /(?:باجر|بكره|بكرا|غدا|غداً)(?=\s|$)/, offset: 1, term: 'باجر' },
  { regex: /(اليوم|هذا اليوم)(?=\s|$)/, offset: 0, term: 'اليوم' },
  { regex: new RegExp(`(بعد|على|علا|علي)\\s*(?:)([٠-٩۰-۹0-9]|${DAY_NUMBER_WORD_PATTERN})\\s*(ايام|أيام|يوم|يم)?(?=\\s|$)`), offset: -1, term: 'عدد أيام' },
  { regex: /(بعد|على|علا|علي)\s*(اسبوع|أسبوع)(?=\s|$)/, offset: 7, term: 'بعد أسبوع' }
];

/**
 * Interpret a relative day term from the user's text.
 * Returns the offset (days from today) for: باجر(+1), عكب باجر(+2), بعد أسبوع(+7),
 * عدد أيام (+N), weekday names (next occurrence), اليوم(0 -> engine asks politely).
 */
export function interpretDayTerm(text: string): InterpretedDay | null {
  if (!text) return null;
  const norm = normalizeArabicText(toAsciiDigits(text));

  for (const { regex, offset, term } of DAY_TERMS) {
    const m = norm.match(regex);
    if (!m) continue;
    if (offset === -1) {
      // "على 3 أيام" / "بعد ثلاثة ايام" -> numeric offset
      const numTok = m[2];
      const n = /^\d+$/.test(numTok) ? parseInt(numTok, 10) : (NUMBER_WORDS[numTok] ?? 0);
      if (n >= 1 && n <= 30) return { term: `بعد ${n} أيام`, offset: n };
      continue;
    }
    return { term, offset };
  }

  // Bare weekday name -> next occurrence strictly after today
  for (const [key, dayNum] of Object.entries(WEEKDAYS)) {
    const regex = new RegExp(`(^|\\s|يوم|بوم)${key}($|\\s)`);
    if (regex.test(norm)) {
      const today = new Date(getBaghdadToday()).getDay();
      let offset = (dayNum - today + 7) % 7;
      if (offset === 0) offset = 7;
      return { term: key, offset };
    }
  }

  return null;
}

const TIME_OF_DAY: Array<{ regex: RegExp; range: TimeRange; term: string }> = [
  { regex: /(الصبح|الصبحية|الصباح|بكرا الصبح)(?=\s|$)/, range: { startMinute: 8 * 60, endMinute: 11 * 60 }, term: 'الصبح' },
  { regex: /(الضحى|الضحة)(?=\s|$)/, range: { startMinute: 9 * 60, endMinute: 12 * 60 }, term: 'الضحى' },
  { regex: /(الظهر|نص النهار|ظهيرة)(?=\s|$)/, range: { startMinute: 12 * 60, endMinute: 15 * 60 }, term: 'الظهر' },
  { regex: /(العصر|بعد الظهر)(?=\s|$)/, range: { startMinute: 15 * 60, endMinute: 18 * 60 }, term: 'العصر' },
  { regex: /(المغرب|بعد العصر)(?=\s|$)/, range: { startMinute: 18 * 60, endMinute: 20 * 60 }, term: 'المغرب' },
  { regex: /(الليل|ليلا|بليل)(?=\s|$)/, range: { startMinute: 19 * 60, endMinute: 23 * 60 }, term: 'الليل' }
];

/**
 * Interpret a time from user text:
 *  - exact: "5:30" / "٥:٣٠" / "الساعة خمسة" / "خمسة ونص" / "5" (hour only)
 *  - range: time-of-day terms (العصر، الظهر، ...)
 */
export function interpretTimeTerm(text: string): InterpretedTime {
  if (!text) return null;
  const norm = normalizeArabicText(toAsciiDigits(text));

  // Exact "H:MM" with any digit system
  const hhmm = norm.match(/(?:الساعه|ساعه|ب\s*)?(\d{1,2})\s*[:.،]\s*(\d{2})\b/);
  if (hhmm) {
    const hh = parseInt(hhmm[1], 10);
    const mm = parseInt(hhmm[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return { kind: 'exact', value: { hh, mm } };
  }

  // Exact "الساعة خمسة" or "خمسة" (hour) / "خمسة ونص" (5:30)
  const numberHour = norm.match(/الساعه\s+(\S+)/);
  if (numberHour) {
    const word = numberHour[1].replace(/[،.]+$/, '');
    if (NUMBER_WORDS[word] !== undefined) {
      const mmMatch = norm.match(/(ونص|ونصف|نص|نصف|وربع)/);
      const mm = mmMatch ? (mmMatch[1].includes('ربع') ? 15 : 30) : 0;
      return { kind: 'exact', value: { hh: NUMBER_WORDS[word], mm } };
    }
  }

  const plainHour = norm.match(/^(\d{1,2})\s*(ونص|ونصف|نص|نصف)?$/);
  if (plainHour) {
    const hh = parseInt(plainHour[1], 10);
    if (hh >= 0 && hh <= 23) {
      const mm = plainHour[2] ? 30 : 0;
      return { kind: 'exact', value: { hh, mm } };
    }
  }

  for (const { regex, range, term } of TIME_OF_DAY) {
    if (regex.test(norm)) return { kind: 'range', value: { ...range, term } };
  }

  return null;
}

/** Multiset (bag of letters) similarity between two normalized strings */
export function bagSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const count = (s: string) => {
    const map = new Map<string, number>();
    for (const ch of s) map.set(ch, (map.get(ch) || 0) + 1);
    return map;
  };
  const ma = count(a);
  const mb = count(b);
  let common = 0;
  for (const [ch, n] of ma) common += Math.min(n, mb.get(ch) || 0);
  return common / Math.max(a.length, b.length);
}

/**
 * Fraction of the SHORTER word's bigrams that also appear in the longer word.
 * Scrambled-by-typo words keep most consecutive letter pairs in place;
 * look-alike words with shuffled letters (زراعة vs جزائر) share almost none.
 */
function digramOverlap(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 1;
  const digrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const sa = digrams(a);
  const sb = digrams(b);
  const smaller = sa.size <= sb.size ? sa : sb;
  const larger = sa.size <= sb.size ? sb : sa;
  let common = 0;
  for (const d of smaller) if (larger.has(d)) common++;
  return common / smaller.size;
}

/**
 * Word-level fuzzy score between a user word and a candidate word:
 * exact / prefix / bag+bigram similarity (handles scrambled or misspelled words).
 * The Arabic definite article (ال/وال) is ignored when comparing.
 */
export function wordFuzzyScore(userWord: string, candWord: string): number {
  if (!userWord || !candWord) return 0;
  if (userWord === candWord) return 1;
  const stripArticle = (s: string) => s.replace(/^(?:وال|ال)/, '');
  const [u, c] = [stripArticle(userWord), stripArticle(candWord)];
  if (u === c) return 1;
  if (u.length >= 3 && c.startsWith(u)) return 0.95;
  if (c.length >= 3 && u.startsWith(c)) return 0.85;
  const bag = bagSimilarity(u || userWord, c || candWord);
  const dig = digramOverlap(u || userWord, c || candWord);
  if (bag >= 0.6 && dig >= 0.3) return bag;
  if (bag >= 0.55 && Math.max(u.length, c.length) >= 4 && dig >= 0.3) return bag;
  return 0;
}

/**
 * Fuzzy-match a multi-word entity name against the user text.
 * Requires EVERY candidate word to be evidenced in the text (explicit mention),
 * but allows typos/scrambling/shortening per word.
 * Returns a confidence score 0..1.
 */
export function entityMentionScore(name: string, text: string): number {
  const candWords = normalizeArabicText(name).split(/\s+/).filter(w => w.length >= 2);
  if (candWords.length === 0) return 0;
  const textWords = normalizeArabicText(text).split(/\s+/).filter(w => w.length >= 1);
  if (textWords.length === 0) return 0;

  let matchedWords = 0;
  const used = new Set<number>();
  for (const cw of candWords) {
    let best = 0;
    let bestIdx = -1;
    for (let i = 0; i < textWords.length; i++) {
      if (used.has(i)) continue;
      const score = wordFuzzyScore(cw, textWords[i]);
      if (score > best) { best = score; bestIdx = i; }
    }
    if (best >= 0.55 && bestIdx >= 0) {
      matchedWords++;
      used.add(bestIdx);
    }
  }
  const ratio = matchedWords / candWords.length;
  // Require ALL words matched, unless the entity is long (>= 3 words) where 2/3 strong evidence is fine
  if (candWords.length >= 3) return ratio >= 2 / 3 ? ratio : 0;
  return ratio >= 1 ? 1 : 0;
}

/** Short answer = at most 3 whitespace-separated tokens */
export function isShortAnswer(text: string): boolean {
  if (!text) return false;
  return normalizeArabicText(text).split(/\s+/).filter(Boolean).length <= 3;
}

/** Convert an offset to an absolute YYYY-MM-DD string */
export function dateFromOffset(offset: number): string {
  return formatDate(addDays(new Date(getBaghdadToday()), offset));
}
