import type { Worker as TesseractWorker } from 'tesseract.js';
import { createWorker, PSM } from 'tesseract.js';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, QueryClient, QueryClientProvider } from 'react-query';
import ReactDOM from 'react-dom/client';

interface PhotoItem {
    id: string;
    data: string;
    status: 'queued' | 'processing' | 'completed' | 'error';
    text?: string;
}

interface NotificationProps {
    message: string;
    type: 'success' | 'warning' | 'danger' | 'info';
    onDismiss: () => void;
}

const Notification = ({ message, type, onDismiss }: NotificationProps): JSX.Element => {
    return (
        <div className={`notification is-${type}`}>
            <button className="delete" onClick={(e) => {
                e.preventDefault();
                onDismiss();
            }} />
            {message}
        </div>
    );
};

interface PhotoListProps {
    photos: PhotoItem[];
}

const PhotoList = ({ photos }: PhotoListProps): JSX.Element => {
    const getStatusClass = (status: string): string => {
        switch (status) {
            case 'queued': return 'is-warning';
            case 'processing': return 'is-info';
            case 'completed': return 'is-success';
            case 'error': return 'is-danger';
            default: return 'is-light';
        }
    };

    return (
        <div id="photoList" className="mt-4">
            {[...photos].reverse().map(photo => (
                <div key={photo.id} className="photo-item">
                    <div className="columns">
                        <div className="column is-one-third">
                            <img src={photo.data} className="photo-preview" alt="Scanned" />
                        </div>
                        <div className="column">
                            <div className="status">
                                Status:{' '}
                                <span className={`tag ${getStatusClass(photo.status)}`}>
                                    {photo.status}
                                </span>
                            </div>
                            {photo.status === 'processing' && (
                                <progress className="progress is-small is-primary" max={100}>
                                    Processing...
                                </progress>
                            )}
                            {photo.text && (
                                <div className="ocr-result">
                                    <strong>OCR Result:</strong>
                                    <pre>{photo.text}</pre>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

type LicenceFields = {
  type: 'family_season_licence';
  id: string;
  name: string;
  dor: string;
  issue: string;
  valid: string;
  spousePartner: string;
  other: string;
  createdAt: number;
};

export function extractFields(text: string): LicenceFields {
  const idMatch = text.match(/\b\d{6,8}\b/);
  const nameMatch = text.match(/NAME[\s:]+([A-Za-z .-]+)(?:\n|$)/i);
  const dorMatch = text.match(/DOR[\s:]+([0-9\/]+)(?:\n|$)/i);
  const issueMatch = text.match(/ISSUE[\s:]+([0-9\/]+)(?:\n|$)/i);
  const validMatch = text.match(/VALID[\s:]+([0-9\/\- ]+)(?:\n|$)/i);
  const spouseMatch = text.match(/SPOUSE\/PARTNER[\s:]+([A-Za-z .-]+)(?:\n|$)/i);
  const otherMatch = text.match(/OTHER[\s]*\n([\s\S]+?)(?:\n\s*Licence|$)/i);

  return {
    type: 'family_season_licence',
    id: idMatch?.[0] ?? '',
    name: nameMatch?.[1]?.trim() ?? '',
    dor: dorMatch?.[1]?.trim() ?? '',
    issue: issueMatch?.[1]?.trim() ?? '',
    valid: validMatch?.[1]?.trim() ?? '',
    spousePartner: spouseMatch?.[1]?.trim() ?? '',
    other: otherMatch
      ? otherMatch[1]
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .join(', ')
      : '',
    createdAt: Date.now()
  };
}

interface FieldMatch {
  value: string;
  confidence: number;
  line: number;
  pattern: string;
  position?: number;
}

interface FieldMatches {
  id: FieldMatch[];
  name: FieldMatch[];
  dor: FieldMatch[];
  issue: FieldMatch[];
  valid: FieldMatch[];
  spousePartner: FieldMatch[];
  other: FieldMatch[];
}

function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function normalizeDate(dateStr: string): string {
  // Handle various date formats and normalize to DD/MM/YYYY
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length === 3) {
    const [day, month, year] = parts;
    // Handle single digit days/months and remove any non-digit characters
    const normalizedDay = day.replace(/[^\d]/g, '').padStart(2, '0');
    const normalizedMonth = month.padStart(2, '0');
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${normalizedDay}/${normalizedMonth}/${fullYear}`;
  }
  return dateStr;
}

function calculatePositionConfidence(position: number, expectedPosition: number): number {
  const distance = Math.abs(position - expectedPosition);
  return Math.max(0, 1 - (distance * 0.1)); // Decrease confidence by 0.1 for each position away
}

export function extractFieldsV2(text: string): { success: boolean; fields: LicenceFields; matches: FieldMatches } {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const matches: FieldMatches = {
    id: [],
    name: [],
    dor: [],
    issue: [],
    valid: [],
    spousePartner: [],
    other: []
  };

  // First pass: Find all potential matches
  lines.forEach((line, lineNum) => {
    // Handle ID
    const idMatch = line.match(/\b\d{6,8}\b/);
    if (idMatch) {
      matches.id.push({
        value: idMatch[0],
        confidence: 1.0,
        line: lineNum,
        pattern: 'id-pattern',
        position: lineNum
      });
    }

    // Handle Name
    const nameMatch = line.match(/NAME[\s:]+([A-Za-z .-]+)(?:\n|$)/i) ||
                     line.match(/^([A-Za-z .-]+)\s+\d{6,8}$/);
    if (nameMatch && !line.match(/^(NAME|DOR|ISSUE|VALID|SPOUSE\/PARTNER|OTHER|Licence)\s*$/i)) {
      matches.name.push({
        value: nameMatch[1]?.trim() ?? nameMatch[0],
        confidence: nameMatch[0].startsWith('NAME') ? 1.0 : 0.9,
        line: lineNum,
        pattern: 'name-pattern',
        position: lineNum
      });
    }

    // Check for name on next line after NAME label
    if (line.match(/^NAME\s*$/i) && lineNum + 1 < lines.length) {
      const nextLine = lines[lineNum + 1];
      const nameOnNextLine = nextLine.match(/^([A-Za-z .-]+)(?:\s+\d{6,8})?$/);
      if (nameOnNextLine && !nextLine.match(/^(NAME|DOR|ISSUE|VALID|SPOUSE\/PARTNER|OTHER|Licence)\s*$/i)) {
        matches.name.push({
          value: nameOnNextLine[1].trim(),
          confidence: 0.95,
          line: lineNum + 1,
          pattern: 'name-next-line',
          position: lineNum + 1
        });
      }
    }

    // Handle Spouse/Partner
    const spouseMatch = line.match(/SPOUSE\/PARTNER[\s:]+([A-Za-z .-]+)(?:\n|$)/i) ||
                       line.match(/^([A-Za-z .-]+)(?:\s+Rd|\s+Street|\s+Avenue|\s+Road)/i);
    if (spouseMatch) {
      matches.spousePartner.push({
        value: spouseMatch[1]?.trim() ?? spouseMatch[0],
        confidence: spouseMatch[0].toLowerCase().includes('spouse') ? 1.0 : 0.8,
        line: lineNum,
        pattern: 'spouse-pattern',
        position: lineNum
      });
    }

    // Handle labeled dates first
    if (line.match(/\bDOR\b/i)) {
      const dateMatch = line.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
      if (dateMatch) {
        matches.dor.push({
          value: normalizeDate(dateMatch[0]),
          confidence: 1.0,
          line: lineNum,
          pattern: 'dor-labeled',
          position: lineNum
        });
      }
    }
    if (line.match(/\bISSUE[D]?\b/i)) {
      const dateMatch = line.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
      if (dateMatch) {
        matches.issue.push({
          value: normalizeDate(dateMatch[0]),
          confidence: 1.0,
          line: lineNum,
          pattern: 'issue-labeled',
          position: lineNum
        });
      }
    }
    if (line.match(/\bVALID\b/i)) {
      const dateMatch = line.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
      if (dateMatch) {
        matches.valid.push({
          value: normalizeDate(dateMatch[0]),
          confidence: 1.0,
          line: lineNum,
          pattern: 'valid-labeled',
          position: lineNum
        });
      }
    }

    // Handle unlabeled dates
    const dates = line.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g);
    if (dates) {
      // First check for a range pattern
      const rangeMatch = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[-–]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
      let validValue = '';
      
      if (rangeMatch) {
        validValue = `${normalizeDate(rangeMatch[1])} - ${normalizeDate(rangeMatch[2])}`;
        matches.valid.push({
          value: validValue,
          confidence: 0.95,
          line: lineNum,
          pattern: 'valid-range',
          position: lineNum
        });
        // Remove the range dates from the array
        const rangeDates = [rangeMatch[1], rangeMatch[2]];
        const remainingDates = dates.filter(d => !rangeDates.includes(d));
        
        // If we have exactly 2 remaining dates, they are likely DOR and ISSUE
        if (remainingDates.length === 2) {
          const sortedDates = remainingDates
            .map(d => ({ date: d, timestamp: new Date(normalizeDate(d)).getTime() }))
            .sort((a, b) => a.timestamp - b.timestamp);
          
          matches.dor.push({
            value: normalizeDate(sortedDates[0].date),
            confidence: 0.9,
            line: lineNum,
            pattern: 'dor-with-range',
            position: lineNum
          });
          
          matches.issue.push({
            value: normalizeDate(sortedDates[1].date),
            confidence: 0.85,
            line: lineNum,
            pattern: 'issue-with-range',
            position: lineNum
          });
        }
      } else if (dates.length === 3) {
        // If no range pattern but we have 3 dates, handle as before
        const sortedDates = dates
          .map(d => ({ date: d, timestamp: new Date(normalizeDate(d)).getTime() }))
          .sort((a, b) => a.timestamp - b.timestamp);
        
        matches.dor.push({
          value: normalizeDate(sortedDates[0].date),
          confidence: 0.9,
          line: lineNum,
          pattern: 'dor-position-oldest',
          position: lineNum
        });
        
        matches.issue.push({
          value: normalizeDate(sortedDates[1].date),
          confidence: 0.85,
          line: lineNum,
          pattern: 'issue-position-middle',
          position: lineNum
        });
        
        if (!validValue) {
          matches.valid.push({
            value: normalizeDate(sortedDates[2].date),
            confidence: 0.8,
            line: lineNum,
            pattern: 'valid-position-newest',
            position: lineNum
          });
        }
      } else if (dates.length === 1) {
        // Single unlabeled date - check if it's near name or ID
        const dateValue = normalizeDate(dates[0]);
        const dateTimestamp = new Date(dateValue).getTime();
        const now = Date.now();
        const yearsDiff = (now - dateTimestamp) / (1000 * 60 * 60 * 24 * 365);
        
        if (yearsDiff > 18 && yearsDiff < 100) {
          // Likely a DOR if it's a reasonable age
          matches.dor.push({
            value: dateValue,
            confidence: 0.8,
            line: lineNum,
            pattern: 'dor-age-range',
            position: lineNum
          });
        }
      }
    }
  });

  // Handle other fields (children)
  let inOtherSection = false;
  const otherLines: string[] = [];
  let foundSpousePartner = false;
  let foundOtherSection = false;
  
  console.log('Input text:', text);
  console.log('Split lines:', lines);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    console.log(`Line ${i}: "${line}"`);
    
    if (line.match(/^OTHER\s*$/i)) {
      console.log('Found OTHER section');
      inOtherSection = true;
      foundOtherSection = true;
      // Look ahead for children names until we hit Licence or another section
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        console.log(`  Checking next line ${j}: "${nextLine}"`);
        if (nextLine.match(/^(NAME|DOR|ISSUE|VALID|SPOUSE\/PARTNER|OTHER|Licence|FAMILY SEASON LICENCE)\s*$/i)) {
          console.log('  Found section end');
          break;
        }
        // If it's a simple name (letters, spaces, hyphens, and numbers)
        if (nextLine.length > 0 && 
            /^[A-Za-z][A-Za-z\s\d-]*[A-Za-z\d]$/.test(nextLine) && // Must start with a letter, can end with letter or number
            !nextLine.match(/^(NAME|DOR|ISSUE|VALID|SPOUSE\/PARTNER|OTHER|Licence|FAMILY SEASON LICENCE|wae|srouserasmen|cance|Comin|ets)\b/i) && // Not a section header
            !matches.name.some(m => m.value === nextLine) && // Don't include the main name
            !matches.spousePartner.some(m => m.value === nextLine) // Don't include spouse/partner
        ) {
          console.log('  Found child name:', nextLine);
          otherLines.push(nextLine);
        } else {
          console.log('  Line did not match child name pattern:', nextLine);
          console.log('    Length > 0:', nextLine.length > 0);
          console.log('    Name pattern:', /^[A-Za-z][A-Za-z\s\d-]*[A-Za-z\d]$/.test(nextLine));
          console.log('    Not section header:', !nextLine.match(/^(NAME|DOR|ISSUE|VALID|SPOUSE\/PARTNER|OTHER|Licence|FAMILY SEASON LICENCE|wae|srouserasmen|cance|Comin|ets)\b/i));
          console.log('    Not main name:', !matches.name.some(m => m.value === nextLine));
          console.log('    Not spouse/partner:', !matches.spousePartner.some(m => m.value === nextLine));
        }
        j++;
      }
      i = j - 1; // Skip processed lines
    } else if (line.match(/^SPOUSE\/PARTNER/i) || matches.spousePartner.some(m => m.line === i)) {
      foundSpousePartner = true;
    } else if (!foundOtherSection && foundSpousePartner && 
      !/^(NAME|DOR|ISSUE|VALID|SPOUSE\/PARTNER|OTHER|Licence|FAMILY SEASON LICENCE|wae|srouserasmen|cance|Comin|ets)\b/i.test(line) &&
      !/\d{6,8}/.test(line) &&
      !/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(line) &&
      !/(?:\s+Rd|\s+Street|\s+Avenue|\s+Road)/i.test(line) &&
      line.length > 0 &&
      /^[A-Za-z][A-Za-z\s\d-]*[A-Za-z\d]$/.test(line) && // Must start with a letter, can end with letter or number
      !matches.name.some(m => m.value === line) && // Don't include the main name
      !matches.spousePartner.some(m => m.value === line) // Don't include spouse/partner
    ) {
      otherLines.push(line);
    }
  }

  console.log('Found other lines:', otherLines);

  if (otherLines.length > 0) {
    matches.other.push({
      value: otherLines.join(', '),
      confidence: foundOtherSection ? 1.0 : 0.8,
      line: foundOtherSection ? 
        lines.findIndex(l => l.trim().match(/^OTHER\s*$/i)) :
        lines.findIndex(l => l.trim() === otherLines[0]),
      pattern: foundOtherSection ? 'other-section' : 'other-implicit',
      position: foundOtherSection ? 
        lines.findIndex(l => l.trim().match(/^OTHER\s*$/i)) :
        lines.findIndex(l => l.trim() === otherLines[0])
    });
  }

  // Get best matches by confidence
  const bestMatches = {
    id: matches.id.sort((a, b) => b.confidence - a.confidence)[0]?.value ?? '',
    name: matches.name.sort((a, b) => b.confidence - a.confidence)[0]?.value ?? '',
    dor: matches.dor.sort((a, b) => b.confidence - a.confidence)[0]?.value ?? '',
    issue: matches.issue.sort((a, b) => b.confidence - a.confidence)[0]?.value ?? '',
    valid: matches.valid.sort((a, b) => b.confidence - a.confidence)[0]?.value ?? '',
    spousePartner: matches.spousePartner.sort((a, b) => b.confidence - a.confidence)[0]?.value ?? '',
    other: matches.other
      .sort((a, b) => b.confidence - a.confidence)
      .map(m => m.value)
      .filter(Boolean)
      .join(', ')
  };

  return {
    success: bestMatches.name !== '' && bestMatches.dor !== '' && bestMatches.issue !== '' && bestMatches.valid !== '',
    fields: {
      type: 'family_season_licence',
      ...bestMatches,
      createdAt: Date.now()
    },
    matches
  };
}

interface Scan {
    id: string;
    image: string;
    ocrText: string;
    fields: LicenceFields;
    matches: FieldMatches;
    createdAt: number;
    status?: 'queued' | 'processing' | 'completed' | 'error';
}

type DailyScans = {
    [date: string]: {
        scans: Scan[];
    };
};


function validateDailyScans(data: unknown): data is DailyScans {
  if (!data || typeof data !== 'object') return false;
  
  return Object.entries(data).every(([date, dayData]) => {
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    
    // Validate day data structure
    if (!dayData || typeof dayData !== 'object') return false;
    if (!('scans' in dayData) || !Array.isArray(dayData.scans)) return false;
    
    // Validate each scan in the array
    return dayData.scans.every((scan: unknown) => {
      return (
        scan &&
        typeof scan === 'object' &&
        'id' in scan &&
        'image' in scan &&
        'ocrText' in scan &&
        'fields' in scan &&
        'createdAt' in scan &&
        typeof scan.createdAt === 'number'
      );
    });
  });
}

const LOCALE = 'en-NZ'

const CONFIG = {
  storage: {
    maxItems: 20,
    retentionDays: 30,
  },
  image: {
    maxSize: 1024 * 1024, // 1MB
    maxStoredSize: 200 * 1024, // 200KB
    compressedWidth: 800,
    jpegQuality: 10,
  },
  scanModes: [{
    id: 'auto',
    name: 'Auto Mode',
    description: 'Best for detecting titles and values',
    tesseractConfig: {
      tessedit_pageseg_mode: PSM.AUTO,
    },
  }, {
    id: 'auto-whitelist',
    name: 'Auto Mode - with whitelist',
    description: 'Best for detecting titles and values',
    tesseractConfig: {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ',
      tessedit_pageseg_mode: PSM.AUTO,
    },
  }, {
    id: 'sparse_text_osd',
    name: 'Sparse Text OSD Mode',
    description: 'Sparse Text OSD Mode',
    tesseractConfig: {
      tessedit_pageseg_mode: PSM.SPARSE_TEXT_OSD,
    },
  }, {
    id: 'single_block',
    name: '(legacy) Single Block',
    description: 'Single block of text',
    tesseractConfig: {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    },
  }, {
    id: 'auto-extended',
    name: 'Auto Mode - get rich data',
    description: 'Best for detecting titles and values',
    tesseractConfig: {
      tessedit_pageseg_mode: PSM.AUTO,
      tessedit_create_box: '1',
      tessedit_create_unlv: '1',
      tessedit_create_osd: '1',
    },
  }]
} as const;

interface ScanDetailsProps {
    scan: Scan;
}

const SummaryDetails = (obj: any) => {
    if(typeof obj !== 'object') {
        return <div>{obj}</div>;
    }
    return Object.keys(obj).map(key => {
        return <details key={key}><summary>{key}</summary><SummaryDetails key={key}>{obj[key]}</SummaryDetails></details>
    });
}

function useScans() {
  const [scans, setScans] = React.useState<DailyScans>(() => {
    try {
      console.log('Initializing scans from localStorage...');
      const raw = localStorage.getItem('scanData');
      console.log('Raw data from localStorage:', raw ? 'Data exists' : 'No data found');
      
      if (!raw) {
        console.log('No scan data found in localStorage, initializing empty object');
        return {};
      }
      
      console.log('Parsing scan data...');
      const parsed = JSON.parse(raw);
      console.log('Parsed data structure:', {
        isObject: typeof parsed === 'object',
        keys: Object.keys(parsed),
        sampleDate: Object.keys(parsed)[0],
        sampleScans: parsed[Object.keys(parsed)[0]]?.scans?.length
      });
      
      if (!validateDailyScans(parsed)) {
        console.error('Invalid scan data structure:', {
          data: parsed,
          validationFailed: true
        });
        localStorage.removeItem('scanData');
        return {};
      }

      // Clean up old scans
      const now = Date.now();
      const retentionPeriod = CONFIG.storage.retentionDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
      const cleanedScans: DailyScans = {};
      
      Object.entries(parsed).forEach(([date, dayData]) => {
        const validScans = dayData.scans.filter((scan: Scan) => {
          const scanAge = now - scan.createdAt;
          return scanAge <= retentionPeriod;
        });
        
        if (validScans.length > 0) {
          cleanedScans[date] = { scans: validScans };
        }
      });

      // If we cleaned up any scans, save the cleaned data
      if (Object.keys(cleanedScans).length !== Object.keys(parsed).length) {
        console.log('Cleaned up old scans:', {
          before: Object.keys(parsed).length,
          after: Object.keys(cleanedScans).length
        });
        localStorage.setItem('scanData', JSON.stringify(cleanedScans));
      }
      
      return cleanedScans;
    } catch (error) {
      console.error('Error loading scans from localStorage:', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      return {};
    }
  });

  React.useEffect(() => {
    try {
      console.log('Saving scans to localStorage...', {
        dates: Object.keys(scans),
        totalScans: Object.values(scans).reduce((acc, day) => acc + day.scans.length, 0)
      });

      const serialized = JSON.stringify(scans);
      console.log('Serialized data size:', serialized.length);
      localStorage.setItem('scanData', serialized);
      console.log('Scans saved successfully');
    } catch (error) {
      console.error('Error saving scans to localStorage:', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        scans: scans
      });
    }
  }, [scans]);

  const addScan = React.useCallback((scan: Scan) => {
    console.log('Adding/updating scan:', {
      id: scan.id,
      createdAt: new Date(scan.createdAt).toISOString(),
      fields: scan.fields
    });
    
    setScans(prev => {
      const date = new Date(scan.createdAt).toISOString().split('T')[0];
      const newScans = { ...prev };
      
      if (!newScans[date]) {
        newScans[date] = { scans: [] };
      }

      // Find if we already have a scan with this ID
      const existingIndex = newScans[date].scans.findIndex(s => s.id === scan.id);
      
      if (existingIndex >= 0) {
        // Update existing scan
        newScans[date].scans[existingIndex] = scan;
      } else {
        // Add new scan
        newScans[date].scans.unshift(scan);
        
        // Keep only the most recent scans per day
        if (newScans[date].scans.length > CONFIG.storage.maxItems) {
          newScans[date].scans = newScans[date].scans.slice(0, CONFIG.storage.maxItems);
        }
      }
      
      return newScans;
    });
  }, []);

  const clearScans = React.useCallback(() => {
    console.log('Clearing all scans');
    setScans({});
    localStorage.removeItem('scanData');
  }, []);

  const clearScan = React.useCallback((id: string) => {
    console.log('Clearing scan:', id);
    
    setScans(prev => {
      const newScans = { ...prev };
      
      // Find the date that contains this scan
      for (const [date, dayData] of Object.entries(newScans)) {
        const scanIndex = dayData.scans.findIndex(s => s.id === id);
        if (scanIndex !== -1) {
          // Remove the scan from the array
          dayData.scans.splice(scanIndex, 1);
          
          // If this was the last scan for this date, remove the date entry
          if (dayData.scans.length === 0) {
            delete newScans[date];
          }
          
          break;
        }
      }
      
      return newScans;
    });
  }, []);

  return { scans, addScan, clearScans, clearScan };
}

const App = (): JSX.Element => {
    const query = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => {
            const params = new URLSearchParams(window.location.search);
            return {
                isCameraActive: params.get('camera') === 'true',
                selectedScanMode: params.get('mode') || CONFIG.scanModes[0].id
            }
        }
    });
    const [photos, setPhotos] = useState<PhotoItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [worker, setWorker] = useState<TesseractWorker | null>(null);
    const [notifications, setNotifications] = useState<Array<{ id: string; message: string; type: string }>>([]);
    const [isCameraActive, setIsCameraActive] = useState(query.data?.isCameraActive ?? false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const { scans, addScan, clearScans, clearScan } = useScans();
    const [selectedScanMode, setSelectedScanMode] = useState<string>(query.data?.selectedScanMode ?? CONFIG.scanModes[0].id);

    const [isDeleteMode, setIsDeleteMode] = useState(false);

    const handleClearScan = (id: string) => {
        if(!isDeleteMode){
            if(!window.confirm('Are you sure you want to delete this scan?')){
                return;
            }
        }
        
        clearScan(id);
        showNotification('Scan cleared', 'success');
    }

    const showNotification = useCallback((message: string, type: 'success' | 'warning' | 'danger' | 'info' = 'info', onClick?: () => void) => {
        const id = Date.now().toString();
        setNotifications(prev => [...prev, { id, message, type, onClick }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
            if (onClick) {
                onClick();
            }
        }, 3000);
    }, []);

    const ScanDetails: React.FC<ScanDetailsProps> = ({ scan }) => {

        const getClassName = (status?: string) => {
            if(!status) {
                return 'is-warning';
            }
            return status === 'processing' ? 'is-info' : 
                status === 'completed' ? 'is-success' : 
                status === 'error' ? 'is-danger' : 'is-warning';
        }
        return (
            <div className="scan-details">
                <div className="is-flex is-flex-direction-column is-align-items-center gap-3">
                    {scan.status === 'processing' && (
                        <progress className="progress is-small is-primary" max={100}>
                            Processing...
                        </progress>
                    )}
                       
                            
                    <div className="is-flex is-flex-direction-column is-align-items-center gap-3">
                        <button
                            className="button is-small is-info"
                            style={{ borderRadius: '4px' }}
                            onClick={() => {
                                copyCSV([scan]);
                                showNotification(`Copied scan to clipboard - Paste into Excel`, 'success');
                            }}>
                            Copy Scan
                        </button>
                    </div>
                   
                    <details className="w-100 py-2">
                        <summary>Advance</summary>
                        <pre className="mt-2"><code>{JSON.stringify(scan, null, 4)}</code>
                        
                        </pre>

                        <button 
                            className="button is-small is-info"
                            style={{ borderRadius: '4px' }}
                            onClick={() => {
                                navigator.clipboard.writeText(scan.ocrText);
                            }}>
                            Copy OCR Text
                        </button>
                    </details>
                    <span className={`tag ${getClassName(scan.status)} is-italic`}>
                        {scan.status || 'completed'}
                    </span>   
                    <p className={`tag ${getClassName(scan.status)} is-italic`}>{new Date(scan.createdAt).toLocaleDateString(LOCALE, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                        hour12: true
                    })}</p>    
                    <div className="mt-3 is-flex is-flex-direction-column is-align-items-center gap-3">
                        <button
                            className="button is-small is-danger"
                            onClick={() => handleClearScan(scan.id)}
                            
                            >
                            
                            Clear
                        </button>
                    </div>
                </div>
            </div>
        );
    };



    const copyCSV = (scans: Scan[], includeHeader: boolean = false) => {
        const header = 'id\tname\tdor\tissue\tvalid\tspousePartner\tother\tcreatedAt';
        const rows = scans.map(scan => [
        scan.fields.id,
        scan.fields.name,
        scan.fields.dor,
        scan.fields.issue,
        scan.fields.valid,
        scan.fields.spousePartner,
        scan.fields.other,
        scan.createdAt
        ].map(val => (val ?? '').toString().replace(/\t/g, ' ')).join('\t'));
        let csv;
        if(includeHeader){
            csv = [header, ...rows].join('\n');
        }else{
            csv = rows.join('\n');
        }
        navigator.clipboard.writeText(csv);

    };

    const compressImage = useCallback(async (dataUrl: string): Promise<string> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > CONFIG.image.compressedWidth) {
                    height = (CONFIG.image.compressedWidth * height) / width;
                    width = CONFIG.image.compressedWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                
                const compressedData = canvas.toDataURL('image/jpeg', CONFIG.image.jpegQuality);
                
                if (compressedData.length > CONFIG.image.maxStoredSize) {
                    const lowerQuality = CONFIG.image.jpegQuality * 0.8;
                    resolve(canvas.toDataURL('image/jpeg', lowerQuality));
                } else {
                    resolve(compressedData);
                }
            };
            img.src = dataUrl;
        });
    }, []);

    type ProcessImageResult = {
        success: boolean;
        fields: LicenceFields;
        matches: FieldMatches;
        createdAt: number;
        ocrText: string;
    }

    const processImage = useCallback(async (photo: PhotoItem): Promise<ProcessImageResult | null> => {
        if (!worker) return null;

        try {
            const selectedMode = CONFIG.scanModes.find(mode => mode.id === selectedScanMode);
            if (!selectedMode) {
                throw new Error('Invalid scan mode selected');
            }

            await worker.setParameters(selectedMode.tesseractConfig);
            const result = await worker.recognize(photo.data);
            const ocrText = result.data.text;
            console.log('Tesseract Result:', ocrText);
            setPhotos(prev => prev.map(p =>
                p.id === photo.id ? { ...p, status: 'completed' as const, text: ocrText } : p
            ));
            // Extract fields and save scan
            const { fields, matches } = extractFieldsV2(ocrText);
            
            // Log full scan details to console instead of storing
            console.log('Full scan details:', {
                id: photo.id,
                fullScanDetails: result.data
            });
            
            addScan({
                id: photo.id,
                image: photo.data,
                ocrText: ocrText,
                fields,
                matches,
                createdAt: Date.now(),
                status: 'completed'
            });
            showNotification('Image processed successfully', 'success');
            return { success: true, ocrText, fields, matches, createdAt: Date.now() };
        } catch (error) {
            setPhotos(prev => prev.map(p =>
                p.id === photo.id ? { ...p, status: 'error' as const } : p
            ));
            showNotification('Failed to process image', 'danger');
            return null;
        }
    }, [worker, addScan, showNotification, selectedScanMode]);

    const processQueue = useCallback(async () => {
        if (isProcessing || photos.length === 0 || !worker) return;

        setIsProcessing(true);
        const photo = photos.find(p => p.status === 'queued');
        
        if (photo) {
            const updatedPhotos = photos.map(p => 
                p.id === photo.id ? { ...p, status: 'processing' as const } : p
            );
            setPhotos(updatedPhotos);
            addScan({
                id: photo.id,
                image: photo.data,
                ocrText: '',
                fields: {
                    type: 'family_season_licence',
                    id: '',
                    name: '',
                    dor: '',
                    issue: '',
                    valid: '',
                    spousePartner: '',
                    other: '',
                    createdAt: Date.now(),
                },
                matches: {
                    id: [],
                    name: [],
                    dor: [],
                    issue: [],
                    valid: [],
                    spousePartner: [],
                    other: [],
                },
                createdAt: Date.now(),
                status: 'processing',
            });


            const result = await processImage(photo);
            console.log('Process image result:', result);
            if (result) {
                addScan({
                    id: photo.id,
                    image: photo.data,
                    ocrText: result.ocrText,
                    fields: result.fields,
                    matches: result.matches,
                    createdAt: result.createdAt,
                });
            }
        }

        setIsProcessing(false);
    }, [isProcessing, photos, worker, processImage, addScan]);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        
        for (const file of files) {
            if (file.size > CONFIG.image.maxSize) {
                showNotification(`Image ${file.name} is too large and will be skipped`, 'warning');
                continue;
            }
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                const result = e.target?.result;
                if (typeof result === 'string') {
                    try {
                        const compressedData = await compressImage(result);
                        const newPhoto: PhotoItem = {
                            id: Date.now() + Math.random().toString(),
                            data: compressedData,
                            status: 'queued'
                        };
                        setPhotos(prev => {
                            const updated = [...prev, newPhoto];
                            if (updated.length > CONFIG.storage.maxItems) {
                                updated.shift();
                            }
                            return updated;
                        });
                        showNotification(`Added ${file.name} to queue`, 'success');
                    } catch (error) {
                        console.error('Failed to process image', error);
                        showNotification(`Failed to process ${file.name}`, 'danger');
                    }
                }
            };
            reader.readAsDataURL(file);
        }
    }, [compressImage, showNotification]);

    const startCamera = useCallback(async () => {
        try {
            console.log('Starting camera...');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            console.log('Got stream:', stream);
            setCameraStream(stream);
            setIsCameraActive(true);
        } catch (error) {
            console.error('Error accessing camera:', error);
            showNotification('Failed to access camera', 'danger');
        }
    }, [showNotification]);

    useEffect(() => {
        if (cameraStream && videoRef.current) {
            console.log('Setting video source');
            videoRef.current.srcObject = cameraStream;
            videoRef.current.onloadedmetadata = () => {
                console.log('Video metadata loaded');
                videoRef.current?.play().catch(err => {
                    console.error('Error playing video:', err);
                });
            };
            streamRef.current = cameraStream;
        }
    }, [cameraStream]);

    const stopCamera = useCallback(() => {
        console.log('Stopping camera...');
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => {
                console.log('Stopping track:', track.kind);
                track.stop();
            });
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setCameraStream(null);
        setIsCameraActive(false);
    }, []);

    const takePhoto = useCallback(async () => {
        if (!videoRef.current) return;

        const canvas = document.createElement('canvas');
        const videoWidth = videoRef.current.videoWidth;
        const videoHeight = videoRef.current.videoHeight;
        
        // Calculate dimensions to maintain card aspect ratio (1.586:1)
        let width = videoWidth;
        let height = videoWidth / 1.586;
        
        // If the calculated height is too tall, scale based on height instead
        if (height > videoHeight) {
            height = videoHeight;
            width = videoHeight * 1.586;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        // Center the crop
        const x = (videoWidth - width) / 2;
        const y = (videoHeight - height) / 2;
        ctx?.drawImage(videoRef.current, x, y, width, height, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg');
        try {
            const compressedData = await compressImage(dataUrl);
            const newPhoto: PhotoItem = {
                id: Date.now() + Math.random().toString(),
                data: compressedData,
                status: 'queued'
            };
            setPhotos(prev => {
                const updated = [...prev, newPhoto];
                if (updated.length > CONFIG.storage.maxItems) {
                    updated.shift();
                }
                return updated;
            });
            console.log('Photo captured successfully')
        } catch (error) {
            console.error('Failed to process photo', error);
            showNotification('Failed to process photo', 'danger');
        }
    }, [compressImage, showNotification]);

    useEffect(() => {
        const initWorker = async () => {
            try {
                const newWorker = await createWorker();
                await newWorker.reinitialize('eng');
                setWorker(newWorker);
            } catch (error) {
                console.error('Failed to initialize OCR engine', error);
                showNotification('Failed to initialize OCR engine', 'danger');
            }
        };
        void initWorker();
    }, []);

    useEffect(() => {
        if (!isProcessing && photos.some(p => p.status === 'queued')) {
            void processQueue();
        }
    }, [isProcessing, photos, processQueue]);

    // Add effect to start camera when URL parameter changes
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const shouldBeActive = params.get('camera') === 'true';
        
        if (shouldBeActive && !isCameraActive) {
            startCamera();
        } else if (!shouldBeActive && isCameraActive) {
            stopCamera();
        }
    }, [query.data?.isCameraActive]);

    // Add effect to update URL when settings change
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (isCameraActive) {
            params.set('camera', 'true');
        } else {
            params.delete('camera');
        }
        if (selectedScanMode !== CONFIG.scanModes[0].id) {
            params.set('mode', selectedScanMode);
        } else {
            params.delete('mode');
        }
        const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
        window.history.replaceState({}, '', newUrl);
    }, [isCameraActive, selectedScanMode]);

    return (
        
            <div>
            {isCameraActive && (
                <div className="camera-container">
                    <video
                        ref={(el: HTMLVideoElement | null) => {
                            if (el) {
                                (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                            }
                        }}
                        autoPlay
                        playsInline
                        muted
                    />
                    <div className="camera-overlay">
                        <div className="card-guide" />
                    </div>
                </div>
            )}
                    {isCameraActive && (
                        <div className="has-text-centered is-flex is-justify-content-center">
                            <button
                                className="button is-primary is-large camera-button image"
                                onClick={takePhoto}
                            >
                                Take Photo
                            </button>
                        </div>
                        )}

           
            {/* <PhotoList photos={photos} />*/}
            <div className="notification-container">
                {notifications.map(({ id, message, type }) => (
                    <Notification
                        key={id}
                        message={message}
                        type={type as 'success' | 'warning' | 'danger' | 'info'}
                        onDismiss={() => setNotifications(prev => prev.filter(n => n.id !== id))}
                    />
                ))}
            </div>
            {/* Bulma Table of Scans */}
            <div className="table-container" style={{ marginTop: '2rem' }}>
                <div className="is-hidden-mobile">
                    {Object.entries(scans).length > 0 && <table className="table is-striped is-fullwidth is-hoverable">
                        <thead>
                            <tr className="is-italic">
                                <th>Image</th>
                                <th>Results</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(scans).flatMap(([date, dayData]) => 
                                dayData.scans.map(scan => (
                                    <tr key={scan.id}>
                                        <td>
                                            <a style={{width: '5rem', height: '3rem'}} href={scan.image} target="_blank" rel="noopener noreferrer">
                                                <img src={scan.image} alt="Scanned" />
                                            </a>
                                        </td>
                                        <td>
                                            <div className="box p-2">
                                                <div className="columns is-multiline is-mobile is-gapless">
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>ID</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.id}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Name</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.name}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>DOR</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.dor}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Issue</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.issue}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Valid</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.valid}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Partner</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.spousePartner}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {scan.fields.other && (
                                                        <div className="column is-12">
                                                            <div className="field has-addons mb-1">
                                                                <div className="control is-narrow">
                                                                    <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Other</span>
                                                                </div>
                                                                <div className="control is-expanded">
                                                                    <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.other}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td><ScanDetails scan={scan} /></td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>}
                </div>
                <div className="is-hidden-tablet">
                    <div className="columns is-multiline is-gapless">
                        {Object.entries(scans).flatMap(([date, dayData]) => 
                            dayData.scans.map(scan => (
                                <div key={scan.id} className="column is-12 mb-4 px-2">
                                    <div className="box p-2">
                                        <div className="columns is-mobile is-multiline is-gapless">
                                            <div className="column is-12 mb-2">
                                                <a href={scan.image} target="_blank" rel="noopener noreferrer">
                                                    <img src={scan.image} alt="Scanned" style={{ width: '100%', height: 'auto', maxHeight: '200px', objectFit: 'contain' }} />
                                                </a>
                                            </div>
                                            <div className="column is-12">
                                                <div className="content">
                                                    <div className="box p-2">
                                                        <div className="columns is-multiline is-mobile is-gapless">
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>ID</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.id}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Name</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.name}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>DOR</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.dor}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Issue</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.issue}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Valid</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.valid}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Partner</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.spousePartner}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {scan.fields.other && (
                                                                <div className="column is-12">
                                                                    <div className="field has-addons mb-1">
                                                                        <div className="control is-narrow">
                                                                            <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Other</span>
                                                                        </div>
                                                                        <div className="control is-expanded">
                                                                            <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.other}</div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <ScanDetails scan={scan} />
                                                    
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="fixed-bottom-nav">
                <div className="container">
                    <div className="buttons is-centered has-addons">
                        {!isCameraActive ? (
                            <button
                                className="button is-info"
                                onClick={startCamera}
                            >
                                Open Camera
                            </button>
                        ) : (
                            <button
                                className="button is-info"
                                onClick={stopCamera}
                            >
                                Close Camera
                            </button>
                        )}
                        {!isCameraActive && (
                            <div className="file is-boxed">
                                <label className="file-label">
                                    <input
                                        className="file-input"
                                        type="file"
                                        accept="image/*"
                                        multiple
                                    onChange={handleFileUpload}
                                />
                                <span className="file-cta">
                                    <span className="file-label">Upload photos</span>
                                </span>
                            </label>
                        </div>
                        )}
                        {Object.values(scans).length > 0 && (
                            <>
                                <button
                                    className="button is-info"
                                    onClick={() => {
                                        copyCSV(Object.values(scans).flatMap(day => day.scans), true);
                                        showNotification(`Copied ${Object.values(scans).reduce((acc, day) => acc + day.scans.length, 0) > 1 ? `all ${Object.values(scans).reduce((acc, day) => acc + day.scans.length, 0)} scans` : 'one scan'} as CSV to clipboard - Paste into Excel`, 'success');
                                    }}
                                >
                                    Copy {Object.values(scans).reduce((acc, day) => acc + day.scans.length, 0)} Scans 
                                </button>
                            </>
                        )}
                        <details className="has-text-black">
                            <summary>Advanced</summary>
                            <div className="field mt-2">
                                <p>This tools uses on device OCR to extract the data from the image. It does not send any data to third-parties or the cloud - export the data via the "Copy Scans" buttons.</p>
                            <label className="label">Scan Mode</label>
                            <p className="text-sm i">(Configure the different 'modes' used to process the image)</p>
                            <div className="control">
                                <div className="select is-fullwidth">
                                    <select 
                                        value={selectedScanMode}
                                        onChange={(e) => setSelectedScanMode(e.target.value)}
                                    >
                                        {CONFIG.scanModes.map(mode => (
                                            <option key={mode.id} value={mode.id}>
                                                {mode.name} - {mode.description}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                            <button
                                className="button is-danger"
                                onClick={() => {
                                    const result = confirm('Are you sure you want to clear all scans?');
                                    if (result) {
                                        clearScans();
                                        showNotification('Cleared all scans', 'success');
                                    }
                                }}
                            >
                                Clear Scans
                            </button>
                        </details>
                    </div>
                </div>
            </div>
            
        </div>
    );
};

class SlickScan extends HTMLElement {
    private shadow: ShadowRoot;
    private queryClient: QueryClient;

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });
        this.queryClient = new QueryClient();
    }

    connectedCallback() {
        const styles = document.createElement('link');
        styles.rel = 'stylesheet';
        styles.href = 'https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css';
        this.shadow.appendChild(styles);

        const customStyles = document.createElement('link');
        customStyles.rel = 'stylesheet';
        customStyles.href = 'styles.css';
        this.shadow.appendChild(customStyles);

        // Add custom styles for fixed bottom nav
        const style = document.createElement('style');
        style.textContent = `
            :host {
                display: block;
                min-height: 100vh;
                position: relative;
                padding-bottom: 80px; /* Space for the fixed nav */
            }
            
            .fixed-bottom-nav {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: white;
                padding: 1rem;
                box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
                z-index: 1000;
                /* Add safe-area-inset-bottom for iOS devices */
                padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0));
            }
            
            .fixed-bottom-nav .container {
                max-width: 100%;
                padding: 0 1rem;
            }
            
            .fixed-bottom-nav .buttons {
                margin-bottom: 0;
            }
            
            /* Ensure content doesn't get hidden behind the nav */
            .box {
                margin-bottom: 1rem;
            }
        `;
        this.shadow.appendChild(style);

        const container = document.createElement('div');
        this.shadow.appendChild(container);

        ReactDOM.createRoot(container).render(
            React.createElement(QueryClientProvider, { client: this.queryClient },
                React.createElement(App)
            )
        );
    }
}

customElements.define('slick-scan', SlickScan);