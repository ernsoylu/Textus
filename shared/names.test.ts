import { describe, it, expect } from 'vitest';
import { formatByline, fold, isOrganization, isJunk, parseName, splitNames, compareGiven, type Credit } from './names';

function credit(role: string, position: number, display_name: string, credited_as: string | null = null): Credit {
  return { role, position, credited_as, display_name };
}

describe('formatByline (FR-CONTRIB-4)', () => {
  it('joins two authors with an ampersand', () => {
    expect(formatByline([credit('author', 0, 'Ann'), credit('author', 1, 'Bea')])).toBe('Ann & Bea');
  });
  it('joins three or more with commas and a final ampersand', () => {
    expect(formatByline([credit('author', 0, 'Ann'), credit('author', 1, 'Bea'), credit('author', 2, 'Cid')])).toBe('Ann, Bea & Cid');
  });
  it('prefers credited_as over the contributor display name', () => {
    expect(formatByline([credit('author', 0, 'J. R. R. Tolkien', 'Tolkien')])).toBe('Tolkien');
  });
  it('falls back to editors when there are no authors', () => {
    expect(formatByline([credit('editor', 0, 'Ed One')])).toBe('Ed One (ed.)');
  });
  it('falls back to compilers, then translators, in that order', () => {
    expect(formatByline([credit('translator', 0, 'Trans'), credit('compiler', 0, 'Comp')])).toBe('Comp (comp.)');
    expect(formatByline([credit('translator', 0, 'Trans')])).toBe('Trans (trans.)');
  });
  it('ignores roles below the highest present in the fallback order', () => {
    expect(formatByline([credit('author', 0, 'Ann'), credit('editor', 0, 'Ed')])).toBe('Ann');
  });
  it('returns an empty string with no credits', () => {
    expect(formatByline([])).toBe('');
  });
});

describe('fold()', () => {
  it('lowercases, strips diacritics via NFKD, and keeps letters only', () => {
    expect(fold('Çengel')).toBe('cengel');
    expect(fold('Kanoğlu')).toBe('kanoglu');
  });
  it('uses the explicit map for letters NFKD does not decompose', () => {
    expect(fold('Özışık')).toBe('ozisik');
    expect(fold('Sadık')).toBe('sadik');
  });
  it('drops apostrophes and primes', () => {
    expect(fold('Idelʹchik')).toBe('idelchik');
    expect(fold("Pis'mennyi")).toBe('pismennyi');
    expect(fold("Ó'Brógáin")).toBe('obrogain');
  });
});

describe('isOrganization()', () => {
  it('matches Calibre copywords and the §6.3 additions', () => {
    expect(isOrganization('"ETAS GmbH"'.replace(/"/g, ''))).toBe(true);
    expect(isOrganization('Siemens PLM Software')).toBe(true);
    expect(isOrganization('National Council of Examiners for Engineering and Surveying')).toBe(true);
  });
  it('matches a single all-caps token', () => {
    expect(isOrganization('OECD')).toBe(true);
  });
  it('does not flag an ordinary person name', () => {
    expect(isOrganization('Robin Le Poidevin')).toBe(false);
  });
});

describe('isJunk()', () => {
  it('rejects known app names, usernames, paths, and long digit runs', () => {
    expect(isJunk('CamScanner')).toBe(true);
    expect(isJunk('anand')).toBe(true);
    expect(isJunk('dynstab2/ThePirateBay')).toBe(true);
    expect(isJunk('isbn13 9780367904258')).toBe(true);
  });
  it('accepts an ordinary name', () => {
    expect(isJunk('Robin Le Poidevin')).toBe(false);
  });
});

describe('compareGiven()', () => {
  it('is incompatible when any token pair differs', () => {
    expect(compareGiven('Mehmet', 'Nurdan Demirci')).toBe('incompatible');
  });
  it('is initials-only when a token only matches via a lone initial', () => {
    expect(compareGiven('C. T.', 'Clayton T.')).toBe('initials');
  });
  it('is full when the first token is spelled out and equal, with one side shorter', () => {
    expect(compareGiven('Carl', 'Carl F.')).toBe('full');
  });
});

describe('parseName() — golden cases (§6.3)', () => {
  it('Le Poidevin, Robin', () => {
    const { parts } = parseName('Le Poidevin, Robin');
    expect(parts).toMatchObject({ kind: 'person', familyName: 'Poidevin', particle: 'Le', givenNames: 'Robin', matchKey: 'poidevin' });
  });
  it('Kreider, Jan F., 1942-', () => {
    const { parts } = parseName('Kreider, Jan F., 1942-');
    expect(parts).toMatchObject({ kind: 'person', familyName: 'Kreider', givenNames: 'Jan F.', birthYear: 1942 });
  });
  it('Professor Dr. Karl Stephan (auth.) — honorifics stripped, role extracted', () => {
    const { parts, extraRoles } = parseName('Professor Dr. Karl Stephan (auth.)');
    expect(parts).toMatchObject({ kind: 'person', familyName: 'Stephan', givenNames: 'Karl' });
    expect(extraRoles).toEqual(['author']);
  });
  it('M. Necati Özışık — match key folds Turkish letters', () => {
    const { parts } = parseName('M. Necati Özışık');
    expect(parts.matchKey).toBe('ozisik');
  });
  it('BILLOWS, RICHARD — all-caps title-cased for display', () => {
    const { parts } = parseName('BILLOWS, RICHARD');
    expect(parts).toMatchObject({ kind: 'person', familyName: 'Billows', givenNames: 'Richard', displayName: 'Richard Billows' });
  });
  it('"ETAS GmbH", OECD, Siemens PLM Software — organizations', () => {
    expect(parseName('ETAS GmbH').parts.kind).toBe('organization');
    expect(parseName('OECD').parts.kind).toBe('organization');
    expect(parseName('Siemens PLM Software').parts.kind).toBe('organization');
  });
});

describe('splitNames() — golden cases (§6.3)', () => {
  it('Crowe, Clayton T_ ;Schwarzkopf, John D_ ;Sommerfeld, Martin', () => {
    const credits = splitNames('Crowe, Clayton T_ ;Schwarzkopf, John D_ ;Sommerfeld, Martin');
    expect(credits).toHaveLength(3);
    expect(credits.map((c) => [c.parts?.kind === 'person' && c.parts.familyName, c.parts?.kind === 'person' && c.parts.givenNames])).toEqual([
      ['Crowe', 'Clayton T.'],
      ['Schwarzkopf', 'John D.'],
      ['Sommerfeld', 'Martin'],
    ]);
  });

  it('Krishan Arora, Suman Lata Tripathi and Himanshu Sharma', () => {
    const credits = splitNames('Krishan Arora, Suman Lata Tripathi and Himanshu Sharma');
    expect(credits).toHaveLength(3);
    const tripathi = credits.find((c) => c.parts?.kind === 'person' && c.parts.familyName === 'Tripathi');
    expect(tripathi?.parts).toMatchObject({ givenNames: 'Suman Lata' });
  });

  it('Idelʹchik, I_ E, Steinberg, M_ O', () => {
    const credits = splitNames('Idelʹchik, I_ E, Steinberg, M_ O');
    expect(credits).toHaveLength(2);
    expect(credits[0].parts).toMatchObject({ familyName: 'Idelʹchik', givenNames: 'I. E' });
    expect(credits[1].parts).toMatchObject({ familyName: 'Steinberg', givenNames: 'M. O' });
  });

  it('Bergman T_L_, Lavine A_S_, Incropera F_P_, DeWitt D_P_ — family-first initials', () => {
    const credits = splitNames('Bergman T_L_, Lavine A_S_, Incropera F_P_, DeWitt D_P_');
    expect(credits).toHaveLength(4);
    expect(credits.map((c) => c.parts?.kind === 'person' && [c.parts.familyName, c.parts.givenNames])).toEqual([
      ['Bergman', 'T.L.'],
      ['Lavine', 'A.S.'],
      ['Incropera', 'F.P.'],
      ['DeWitt', 'D.P.'],
    ]);
  });

  it('Avadhanulu M_N_ & Choubey S_R_ — no suffix "Sr"', () => {
    const credits = splitNames('Avadhanulu M_N_ & Choubey S_R_');
    expect(credits).toHaveLength(2);
    expect(credits[1].parts).toMatchObject({ familyName: 'Choubey', givenNames: 'S.R.', suffix: null });
  });

  it('Sadik Kakaç, Hongtan Liu, Anchasa Pramuanjaroenkij, S_ — truncated initial dropped', () => {
    const credits = splitNames('Sadik Kakaç, Hongtan Liu, Anchasa Pramuanjaroenkij, S_');
    expect(credits).toHaveLength(3);
    expect(credits.map((c) => c.parts?.kind === 'person' && c.parts.familyName)).toEqual(['Kakaç', 'Liu', 'Pramuanjaroenkij']);
  });

  it('Le Poidevin, Robin', () => {
    const credits = splitNames('Le Poidevin, Robin');
    expect(credits).toHaveLength(1);
    expect(credits[0].parts).toMatchObject({ familyName: 'Poidevin', particle: 'Le', givenNames: 'Robin', matchKey: 'poidevin' });
  });

  it('Rutkowski, Hank, Air Conditioning Contractors of America — trailing org peeled off', () => {
    const credits = splitNames('Rutkowski, Hank, Air Conditioning Contractors of America');
    expect(credits).toHaveLength(2);
    expect(credits[0].parts).toMatchObject({ kind: 'person', familyName: 'Rutkowski', givenNames: 'Hank' });
    expect(credits[1].parts).toMatchObject({ kind: 'organization', displayName: 'Air Conditioning Contractors of America' });
  });

  it('National Council of Examiners for Engineering and Surveying — not split on "and"', () => {
    const credits = splitNames('National Council of Examiners for Engineering and Surveying');
    expect(credits).toHaveLength(1);
    expect(credits[0].parts?.kind).toBe('organization');
  });

  it('edited and with an introduction by Sander L_ Gilman', () => {
    const credits = splitNames('edited and with an introduction by Sander L_ Gilman');
    expect(credits).toHaveLength(1);
    expect(credits[0].parts).toMatchObject({ familyName: 'Gilman', givenNames: 'Sander L.' });
    expect(credits[0].roles.sort()).toEqual(['editor', 'introduction']);
  });

  it('Alawad, Suhaib M_ (author);Mansour, Ridha Ben', () => {
    const credits = splitNames('Alawad, Suhaib M_ (author);Mansour, Ridha Ben');
    expect(credits).toHaveLength(2);
    expect(credits[0].parts).toMatchObject({ familyName: 'Alawad', givenNames: 'Suhaib M.' });
    expect(credits[0].roles).toEqual(['author']);
    expect(credits[1].parts).toMatchObject({ familyName: 'Mansour', givenNames: 'Ridha Ben' });
  });

  it('Claudia Alves & Alexander Aronowitz [Alves, Claudia] — sort hint removed', () => {
    const credits = splitNames('Claudia Alves & Alexander Aronowitz [Alves, Claudia]');
    expect(credits).toHaveLength(2);
    expect(credits.map((c) => c.parts?.kind === 'person' && c.parts.familyName)).toEqual(['Alves', 'Aronowitz']);
  });

  it('Miller, Donald S_, Donald S_ Miller — dedupes to one person', () => {
    const credits = splitNames('Miller, Donald S_, Donald S_ Miller');
    expect(credits).toHaveLength(1);
    expect(credits[0].parts).toMatchObject({ familyName: 'Miller', givenNames: 'Donald S.' });
  });

  it('CamScanner, anand, dynstab2/ThePirateBay, isbn13 9780367904258 — all rejected as junk', () => {
    for (const raw of ['CamScanner', 'anand', 'dynstab2/ThePirateBay', 'isbn13 9780367904258']) {
      const credits = splitNames(raw);
      expect(credits).toHaveLength(1);
      expect(credits[0].rejected).toBe(true);
    }
  });
});
