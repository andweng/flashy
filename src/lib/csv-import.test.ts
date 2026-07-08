// Locks parseCSVImport: header handling, quoted fields, grading-mode aliases,
// pipe-separated alternates/choices, bucket parsing, and per-mode validation.

import { parseCSVImport } from '@/lib/csv-import';

describe('parseCSVImport — structure & headers', () => {
  it('parses a basic header + rows into cards', () => {
    const cards = parseCSVImport('front,back\nhola,hello\ngato,cat', 'self_grade');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ front: 'hola', back: 'hello', grading_mode: 'self_grade' });
    expect(cards[1].front).toBe('gato');
  });

  it('matches headers case-insensitively and ignores unknown columns', () => {
    const cards = parseCSVImport('FRONT,Extra,Back\na,junk,b', 'self_grade');
    expect(cards[0]).toMatchObject({ front: 'a', back: 'b' });
  });

  it('skips blank lines and rows with a blank front', () => {
    const cards = parseCSVImport('front,back\n\na,1\n,2\nb,3', 'self_grade');
    expect(cards.map((c) => c.front)).toEqual(['a', 'b']);
  });

  it('throws on empty input', () => {
    expect(() => parseCSVImport('   ', 'self_grade')).toThrow(/empty/i);
  });

  it('throws when the front column is missing', () => {
    expect(() => parseCSVImport('back,note\nhello,x', 'self_grade')).toThrow(/"front" column/i);
  });

  it('throws when there are no card rows', () => {
    expect(() => parseCSVImport('front,back', 'self_grade')).toThrow(/no card rows/i);
  });
});

describe('parseCSVImport — quoting', () => {
  it('handles quoted commas and escaped double-quotes', () => {
    const cards = parseCSVImport('front,back\n"a, b","he said ""hi"""', 'self_grade');
    expect(cards[0].front).toBe('a, b');
    expect(cards[0].back).toBe('he said "hi"');
  });
});

describe('parseCSVImport — grading mode', () => {
  it('applies the default mode when no grading_mode column is present', () => {
    expect(parseCSVImport('front,back\nhi,hello', 'typed')[0].grading_mode).toBe('typed');
  });

  it('accepts typed / self-grade / mc aliases (punctuation-insensitive)', () => {
    const text = 'front,back,grading_mode,choices\n' +
      'a,1,Typed,\n' +
      'b,2,self-grade,\n' +
      'c,3,Self,\n' +
      'd,3,MC,3|4';
    const cards = parseCSVImport(text, 'self_grade');
    expect(cards.map((c) => c.grading_mode)).toEqual([
      'typed',
      'self_grade',
      'self_grade',
      'multiple_choice',
    ]);
  });

  it('throws on an unrecognized grading_mode', () => {
    expect(() => parseCSVImport('front,grading_mode\na,bogus', 'self_grade')).toThrow(
      /grading_mode "bogus" is not recognized/i,
    );
  });
});

describe('parseCSVImport — alternates & choices', () => {
  it('splits pipe-separated typed_alternates, trimming and dropping empties', () => {
    const cards = parseCSVImport('front,back,typed_alternates\nhi,hello, hey | howdy |', 'typed');
    expect(cards[0].typed_alternates).toEqual(['hey', 'howdy']);
  });

  it('defaults alternates/choices to empty arrays when the columns are absent', () => {
    const cards = parseCSVImport('front,back\nhi,hello', 'self_grade');
    expect(cards[0].typed_alternates).toEqual([]);
    expect(cards[0].choices).toEqual([]);
  });
});

describe('parseCSVImport — bucket parsing', () => {
  it('maps letters A–Z to 0-indexed buckets (case-insensitive)', () => {
    const cards = parseCSVImport('front,bucket\na,A\nb,c\nz,Z', 'self_grade');
    expect(cards.map((c) => c.bucket)).toEqual([0, 2, 25]);
  });

  it('accepts non-negative integers', () => {
    expect(parseCSVImport('front,bucket\na,3', 'self_grade')[0].bucket).toBe(3);
  });

  it('leaves bucket undefined when blank', () => {
    expect(parseCSVImport('front,bucket\na,', 'self_grade')[0].bucket).toBeUndefined();
  });

  it('throws on an invalid bucket value', () => {
    expect(() => parseCSVImport('front,bucket\na,-1', 'self_grade')).toThrow(/bucket "-1"/i);
    expect(() => parseCSVImport('front,bucket\na,AB', 'self_grade')).toThrow(/bucket "AB"/i);
  });
});

describe('parseCSVImport — per-mode validation', () => {
  it('requires a back for typed cards', () => {
    expect(() => parseCSVImport('front,grading_mode\na,typed', 'self_grade')).toThrow(
      /typed cards require a back/i,
    );
  });

  it('requires a back, ≥2 choices, and the back among the choices for multiple_choice', () => {
    expect(() => parseCSVImport('front,grading_mode,choices\na,mc,1|2', 'self_grade')).toThrow(
      /require a back/i,
    );
    expect(() => parseCSVImport('front,back,grading_mode,choices\na,1,mc,1', 'self_grade')).toThrow(
      /at least 2 choices/i,
    );
    expect(() =>
      parseCSVImport('front,back,grading_mode,choices\na,9,mc,1|2', 'self_grade'),
    ).toThrow(/must include the back/i);
  });

  it('accepts a well-formed multiple_choice row', () => {
    const cards = parseCSVImport('front,back,grading_mode,choices\na,2,mc,1|2|3', 'self_grade');
    expect(cards[0]).toMatchObject({ grading_mode: 'multiple_choice', back: '2', choices: ['1', '2', '3'] });
  });
});
