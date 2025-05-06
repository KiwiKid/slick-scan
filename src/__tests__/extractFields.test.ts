import { describe, it, expect } from '@jest/globals';
import { extractFields } from '../index.js';

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
      type: 'family_season_licence',
      id: '',
      name: 'John Smith',
      dor: '01/01/1990',
      issue: '01/01/2024',
      valid: '01/01/2025',
      spousePartner: 'Jane Smith',
      other: ['Child 1', 'Child 2']
    };

    expect(extractFields(input)).toEqual(expected);
  });

  it('should handle missing fields gracefully', () => {
    const input = `
      NAME John Smith
      DOR 01/01/1990
      Licence
    `;

    const expected = {
      type: 'family_season_licence',
      id: '',
      name: 'John Smith',
      dor: '01/01/1990',
      issue: '',
      valid: '',
      spousePartner: '',
      other: []
    };

    expect(extractFields(input)).toEqual(expected);
  });

  it('should extract licence ID when present', () => {
    const input = `
      ID: 12345678
      NAME John Smith
      DOR 01/01/1990
      Licence
    `;

    const result = extractFields(input);
    expect(result.id).toBe('12345678');
  });

  it('should handle empty input', () => {
    const expected = {
      type: 'family_season_licence',
      id: '',
      name: '',
      dor: '',
      issue: '',
      valid: '',
      spousePartner: '',
      other: []
    };

    expect(extractFields('')).toEqual(expected);
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
      type: 'family_season_licence',
      id: '',
      name: '',
      dor: '',
      issue: '',
      valid: '',
      spousePartner: '',
      other: []
    };

    expect(extractFields(input)).toEqual(expected);
  });
}); 