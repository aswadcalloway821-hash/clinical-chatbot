import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  normalizeArabicText, toAsciiDigits, interpretDayTerm, interpretTimeTerm,
  entityMentionScore, wordFuzzyScore, bagSimilarity
} from '../core/interpretation.js';

describe('Interpretation Layer (explicit, hallucination-free)', () => {
  it('should normalize Arabic: unify أ/ة/ى and collapse doubled letters (تبييض -> تبيض)', () => {
    assert.strictEqual(normalizeArabicText('تبييض أسنان'), 'تبيض اسنان');
    assert.strictEqual(normalizeArabicText('العيادة'), 'العياده');
    assert.strictEqual(normalizeArabicText('عمليات إزالة التقويم'), 'عمليات ازاله التقويم');
  });

  it('should convert Arabic/Persian digits to ASCII', () => {
    assert.strictEqual(toAsciiDigits('٥:٣٠'), '5:30');
    assert.strictEqual(toAsciiDigits('۰۵:۳۰'), '05:30');
    assert.strictEqual(toAsciiDigits('5:30'), '5:30');
  });

  it('should interpret relative day terms', () => {
    assert.strictEqual(interpretDayTerm('باجر')?.offset, 1);
    assert.strictEqual(interpretDayTerm('بكرة')?.offset, 1);
    assert.strictEqual(interpretDayTerm('غداً')?.offset, 1);
    assert.strictEqual(interpretDayTerm('عكب باجر')?.offset, 2);
    assert.strictEqual(interpretDayTerm('بعد غد')?.offset, 2);
    assert.strictEqual(interpretDayTerm('اليوم')?.offset, 0);
    assert.strictEqual(interpretDayTerm('بعد أسبوع')?.offset, 7);
    assert.strictEqual(interpretDayTerm('على 3 أيام')?.offset, 3);
    assert.strictEqual(interpretDayTerm('بعد خمسة ايام')?.offset, 5);
  });

  it('should interpret weekday names to the next occurrence', () => {
    const mon = interpretDayTerm('يوم الاثنين');
    assert.ok(mon, 'Monday must be interpretable');
    assert.ok(mon!.offset >= 1 && mon!.offset <= 7, `offset=${mon!.offset}`);
    const fri = interpretDayTerm('الجمعة');
    assert.ok(fri && fri.offset >= 1 && fri.offset <= 7);
  });

  it('should interpret time-of-day terms as ranges (العصر -> 15:00-18:00)', () => {
    const t = interpretTimeTerm('أريد العصر');
    assert.strictEqual(t?.kind, 'range');
    if (t?.kind === 'range') {
      assert.strictEqual(t.value.startMinute, 15 * 60);
      assert.strictEqual(t.value.endMinute, 18 * 60);
    }
    const noon = interpretTimeTerm('الظهر');
    assert.strictEqual(noon?.kind, 'range');
    if (noon?.kind === 'range') assert.strictEqual(noon.value.startMinute, 12 * 60);
  });

  it('should interpret exact times incl. Arabic digits and number words', () => {
    const t1 = interpretTimeTerm('الساعة 5:30');
    assert.deepStrictEqual(t1, { kind: 'exact', value: { hh: 5, mm: 30 } });

    const t2 = interpretTimeTerm('٥:٣٠');
    assert.deepStrictEqual(t2, { kind: 'exact', value: { hh: 5, mm: 30 } });

    const t3 = interpretTimeTerm('الساعة خمسة');
    assert.deepStrictEqual(t3, { kind: 'exact', value: { hh: 5, mm: 0 } });

    const t4 = interpretTimeTerm('الساعة خمسة ونص');
    assert.deepStrictEqual(t4, { kind: 'exact', value: { hh: 5, mm: 30 } });
  });

  it('should fuzzy-match misspelled/scrambled entity words (forgiving like a human)', () => {
    assert.strictEqual(entityMentionScore('تبييض أسنان', 'أريد تبيض اسنان'), 1, 'تبيض matches تبييض after normalize');
    assert.strictEqual(entityMentionScore('ابتسامة هوليود', 'ابتسا هوليود'), 1, 'shortened word must match (prefix)');
    assert.strictEqual(entityMentionScore('تركيبات الزيركون', 'أريد تربي تزيركون'), 1, 'scrambled-by-typo words must still resolve');
    assert.strictEqual(entityMentionScore('كشفية', 'كشفيه'), 1, 'ة/ه unification');
    assert.strictEqual(entityMentionScore('ابتسامة هوليود', 'موعد فقط لا غير'), 0, 'no word evidence -> no match');
    assert.strictEqual(entityMentionScore('علاج عصب أطفال', 'علاج لثة'), 0, 'missing words -> no match');
    assert.strictEqual(wordFuzzyScore('الجزائر', 'جزائر'), 1, 'باجر بدون أل التعريف');
    assert.ok(bagSimilarity('الجزائر', 'جزائر') >= 0.6, 'bag similarity handles missing أل');
  });

  it('should NOT treat a bare entity word as evidence for a multi-word entity', () => {
    // "اسنان" alone must not select "تبييض أسنان" (needs BOTH words)
    assert.strictEqual(entityMentionScore('تبييض أسنان', 'اسنان'), 0);
    // "الجزائر" alone must not match the full branch name "فرع الجزائر"
    assert.strictEqual(entityMentionScore('فرع الجزائر', 'جزائر'), 0);
  });
});
