import { describe, it, expect } from '@jest/globals';
import { extractFieldsV2 } from '../index.js';

describe('extractFields', () => {
  it('should extract all fields from a valid licence text', () => {
    const input = `
      NAME John Smith
      DOR 01/01/1990
      ISSUE 01/01/2024
      VALID 01/01/2025
      SPOUSE/PARTNER Jane Smith
      OTHER
      Child 1
      Child 2
      Licence
    `;

    const expected = {
      fields: {
        type: 'family_season_licence',
        id: '',
        name: 'John Smith',
        dor: '01/01/1990',
        issue: '01/01/2024',
        valid: '01/01/2025',
        spousePartner: 'Jane Smith',
        other: 'Child 1, Child 2',
        createdAt: expect.any(Number)
      },
      matches: expect.any(Object),
      success: true
    };

    expect(extractFieldsV2(input)).toEqual(expected);
  });

  it('should handle missing fields gracefully', () => {
    const input = `
      NAME John Smith
      DOR 01/01/1990
      Licence
    `;

    const expected = {
      fields: {
        type: 'family_season_licence',
        id: '',
        name: 'John Smith',
        dor: '01/01/1990',
        issue: '',
        valid: '',
        spousePartner: '',
        other: '',
        createdAt: expect.any(Number)
      },
      matches: expect.any(Object),
      success: false
    };

    expect(extractFieldsV2(input)).toEqual(expected);
  });

  it('should extract licence ID when present', () => {
    const input = `
      12345678
      NAME John Smith
      DOR 01/01/1990
      Licence
    `;

    const result = extractFieldsV2(input);
    expect(result.fields.id).toBe('12345678');
  });

  it('should handle empty input', () => {
    const expected = {
      fields: {
        type: 'family_season_licence',
        id: '',
        name: '',
        dor: '',
        issue: '',
        valid: '',
        spousePartner: '',
        other: '',
        createdAt: expect.any(Number)
      },
      matches: expect.any(Object),
      success: false
    };

    expect(extractFieldsV2('')).toEqual(expected);
  });

  it('should handle malformed input', () => {
    const input = `
      NAME
      DOR
      ISSUE
      VALID
      SPOUSE/PARTNER
      OTHER
      Licence
    `;

    const expected = {
      fields: {
        type: 'family_season_licence',
        id: '',
        name: '',
        dor: '',
        issue: '',
        valid: '',
        spousePartner: '',
        other: '',
        createdAt: expect.any(Number)
      },
      matches: expect.any(Object),
      success: false
    };

    expect(extractFieldsV2(input)).toEqual(expected);
  });

  it('should handle multiple children', () => {
    const input = `
      FAMILY SEASON LICENCE

      wae
      Jason Van Beers 6486549
      01/01/1982 22/08/2024 01/10/2024 - 30/09/2025
      srouserasmen 165 Keen Road

      Becky Talbot-Van Beers Rd 21, Geraldine 7991

      Mack Rangatira

      Jock Tarahaoa

      cance ust be cried vie sing and fs not va or Taupo Fishing district, Only the Primary
      Comin Wan can we 1 1h Independant.

      ets amin Ager ESL. Managing Director A/C
    `;

    const expected = {
      fields: {
        type: 'family_season_licence',
        id: '6486549',
        name: 'Jason Van Beers',
        dor: '01/01/1982',
        issue: '22/08/2024',
        valid: '01/10/2024 - 30/09/2025',
        spousePartner: 'Becky Talbot-Van Beers',
        other: 'Mack Rangatira, Jock Tarahaoa',
        createdAt: expect.any(Number)
      },
      matches: expect.any(Object),
      success: true
    };

    expect(extractFieldsV2(input)).toEqual(expected);
  });

  it('should handle different ordering of fields', () => {
    const input = `
      FAMILY SEASON LICENCE

      6486549

      NAME
      Jason Van Beers 
      01/01/1982 22/08/2024 01/10/2024 - 30/09/2025
      srouserasmen 165 Keen Road

      Becky Talbot-Van Beers Rd 21, Geraldine 7991

      OTHER 

      Mack Rangatira

      Jock Tarahaoa

      cance ust be cried vie sing and fs not va or Taupo Fishing district, Only the Primary
      Comin Wan can we 1 1h Independant.

      ets amin Ager ESL. Managing Director A/C
    `;

    const expected = {
      fields: {
        type: 'family_season_licence',
        id: '6486549',
        name: 'Jason Van Beers',
        dor: '01/01/1982',
        issue: '22/08/2024',
        valid: '01/10/2024 - 30/09/2025',
        spousePartner: 'Becky Talbot-Van Beers',
        other: 'Mack Rangatira, Jock Tarahaoa',
        createdAt: expect.any(Number)
      },
      matches: expect.any(Object),
      success: true
    };

    expect(extractFieldsV2(input)).toEqual(expected);
  });
}); 