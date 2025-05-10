import type { Worker as TesseractWorker } from 'tesseract.js';
import cv, { Mat, MatVector, Point, Size } from 'opencv-ts';

import React, { useCallback, useEffect, useState } from 'react';
import { createWorker, PSM } from 'tesseract.js';


interface FieldMatch {
  value: string;
  confidence: number;
  line: number;
  pattern: string;
  position?: number;
}

export interface FieldMatches {
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

export function extractFieldsV2(text: string): { success: boolean; matches: FieldMatches } {
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

  return { success: true, matches: matches };
}

export type FieldWithLock = { value: string; locked: boolean };
export type LicenceFieldsWithLock = {
  id: FieldWithLock;
  name: FieldWithLock;
  dor: FieldWithLock;
  issue: FieldWithLock;
  valid: FieldWithLock;
  spousePartner: FieldWithLock;
  other: FieldWithLock;
  createdAt: number;
};

export interface Scan {
    id: string;
    image: string;
    ocrText: string;
    fields: LicenceFieldsWithLock;
    matches: FieldMatches;
    createdAt: number;
    status?: 'queued' | 'processing' | 'completed' | 'error';
}

export const LOCALE = 'en-NZ'

export const CONFIG = {
  storage: {
    maxItems: 20,
    retentionDays: 30,
  },
  image: {
    maxSize: 1024 * 1024, // 1MB
    maxStoredSize: 200 * 1024, // 200KB
    compressedWidth: 800,
    jpegQuality: 1,
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
     /*tessedit_create_box: '1',
      tessedit_create_unlv: '1',
      tessedit_create_osd: '1',*/
    },
  }]
} as const;

/*
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
*/

type UseScansProps = {
  showNotification: (msg: string, type?: 'success' | 'warning' | 'danger' | 'info' | undefined) => void;
  startSelectedScanMode: string | null
  videoRef: React.RefObject<HTMLVideoElement> | null
}
export function useScans(props: UseScansProps) {
  const [selectedScanMode, setSelectedScanMode] = useState<string>(props.startSelectedScanMode ?? CONFIG.scanModes[0].id);

  const [isProcessing, setIsProcessing] = React.useState(false);
  // Compress image utility
  const compressImage = React.useCallback(async (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
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
  const [worker, setWorker] = useState<TesseractWorker | null>(null);

  const [orcStrength, setOrcStrength] = useState(0);
  const [scans, setScans] = React.useState<Array<Scan>>(() => {
    try {
      console.log('Initializing scans from localStorage...');
      const raw = localStorage.getItem('scanData');
      console.log('Raw data from localStorage:', raw ? 'Data exists' : 'No data found');
        
        if (!raw) {
          console.log('No scan data found in localStorage, initializing empty object');
          return []
        }
        
        console.log('Parsing scan data...');
        const parsed = JSON.parse(raw);
        console.log('Parsed data structure:', {
          isObject: typeof parsed === 'object',
          keys: Object.keys(parsed),
          sampleDate: Object.keys(parsed)[0],
          sampleScans: parsed[Object.keys(parsed)[0]]?.scans?.length
        });
        /*
        if (!validateDailyScans(parsed)) {
          console.error('Invalid scan data structure:', {
            data: parsed,
            validationFailed: true
          });
          localStorage.removeItem('scanData');
          return {};
        }
  */
        // Clean up old scans
        const now = Date.now();
        const retentionPeriod = CONFIG.storage.retentionDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
        const cleanedScans: Array<Scan> = [];
        
        Object.entries(parsed).forEach(([date, dayData]) => {
          const validScans = scans.filter((scan: Scan) => {
            const scanAge = now - scan.createdAt;
            return scanAge <= retentionPeriod;
          });
         
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
        return []
      }
    });

    const preSaveProcessing = async (scan: Scan):Promise<Scan> => {
      return {
        ...scan,
        image: await compressImage(scan.image)
      }
    }
  
    React.useEffect(() => {
      try {

        const scanToSave = Promise.all((scans.map(preSaveProcessing)))

        console.log('Saving scans to localStorage...', {
          scans: scanToSave,
          totalScans: scans.length
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

    useEffect(() => {
      const initWorker = async () => {
          try {
              const newWorker = await createWorker();
              await newWorker.reinitialize('eng');
              setWorker(newWorker);
          } catch (error) {
              console.error('Failed to initialize OCR engine', error);
              props?.showNotification('Failed to initialize OCR engine', 'danger');
          }
      };
      void initWorker();
  }, []);
  
    const addScan = useCallback((scan: Scan) => {
      console.log('Adding/updating scan:', {
        id: scan.id,
        createdAt: new Date(scan.createdAt).toISOString(),
        fields: scan.fields
      });
      
      setScans(prev => {
        
  
        
        return prev.concat(scan);
      });
    }, []);

  
    const clearScans = React.useCallback(() => {
      console.log('Clearing all scans');
      setScans([]);
      localStorage.removeItem('scanData');
    }, []);
  
    const clearScan = React.useCallback((id: string) => {
      console.log('Clearing scan:', id);
      
      setScans(prev => {
        return prev.filter((s) => s.id == id);
      });
    }, []);
  
    // Add activeScanId state
    const [activeScanId, setActiveScanId] = React.useState<string | null>(null);
  
    // Lock a field in a scan
    const lockField = React.useCallback((scanId: string, fieldKey: keyof Omit<LicenceFieldsWithLock, 'createdAt'>) => {
      setScans(prev => {
        const newScans = { ...prev };
        for (const day of Object.values(newScans)) {
          const scan = scans.find(s => s.id === scanId);
          if (scan) {
            scan.fields[fieldKey].locked = true;
          }
        }
        return newScans;
      });
    }, []);
  
    // Merge new fields into the active scan (only for unlocked fields)
    const mergeFieldsToActiveScan = React.useCallback((newFields: Partial<Omit<LicenceFieldsWithLock, 'createdAt'>>) => {
      if (!activeScanId) return;
      setScans(prev => {
        const newScans = { ...prev };
        for (const day of Object.values(newScans)) {
          const scan = scans.find(s => s.id === activeScanId);
          if (scan) {
            for (const key of Object.keys(newFields) as (keyof Omit<LicenceFieldsWithLock, 'createdAt'>)[]) {
              if (!scan.fields[key].locked && newFields[key]) {
                scan.fields[key].value = newFields[key]!.value;
              }
            }
          }
        }
        return newScans;
      });
    }, [activeScanId]);

    // Add scan to queue (for new photo)
    const addScanToQueue = React.useCallback((imageData: string) => {
      setScans(prev => {
        const newScan: Scan = {
          id: Date.now() + Math.random().toString(),
          image: imageData,
          ocrText: '',
          fields: {
            id: { value: '', locked: false },
            name: { value: '', locked: false },
            dor: { value: '', locked: false },
            issue: { value: '', locked: false },
            valid: { value: '', locked: false },
            spousePartner: { value: '', locked: false },
            other: { value: '', locked: false },
            createdAt: Date.now()
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
          status: 'queued'
        };
        const updated = [...prev, newScan];
        if (updated.length > CONFIG.storage.maxItems) updated.shift();
        return updated;
      });
    }, []);

    // Clear all scans (queue and processed)
    const clearAllScans = React.useCallback(() => {
      setScans([]);
      localStorage.removeItem('scanData');
    }, []);

    // Process image (OCR)
    type ProcessImageResult = {
      success: boolean;
      matches: FieldMatches;
      createdAt: number;
      ocrText: string;
    };

    const processImage = React.useCallback(async (scan: Scan, selectedScanMode: string, showNotification?: (msg: string, type?: 'success' | 'warning' | 'danger' | 'info' | undefined) => void): Promise<ProcessImageResult | null> => {
      if (!worker) {
        console.error('[processImage] No worker available');
        return null;
      }
      try {
        console.log('[processImage] Starting OCR for scan:', scan.id, 'mode:', selectedScanMode);
        const selectedMode = CONFIG.scanModes.find(mode => mode.id === selectedScanMode);
        if (!selectedMode) throw new Error('Invalid scan mode selected');
        await worker.setParameters(selectedMode.tesseractConfig);
        const result = await worker.recognize(scan.image);
        setOrcStrength(result.data.confidence)
        const ocrText = result.data.text;
        console.log('[processImage] OCR result:', { confidence: result.data.confidence, text: ocrText });
        const { matches } = extractFieldsV2(ocrText);
        console.log('[processImage] Extracted matches:', matches);
        setScans(prev => prev.map(s => {
          if (s.id !== scan.id) return s;
          const prevFields = s.fields;
          const newFields = { ...prevFields };
          (['id', 'name', 'dor', 'issue', 'valid', 'spousePartner', 'other'] as const).forEach(fieldKey => {
            if (!prevFields[fieldKey].locked) {
              const bestMatch = matches[fieldKey] && matches[fieldKey][0] ? matches[fieldKey][0].value : '';
              newFields[fieldKey] = { value: bestMatch, locked: false };
            }
          });
          newFields.createdAt = prevFields.createdAt;
          return {
            ...s,
            ocrText,
            fields: newFields,
            matches,
            status: 'completed'
          };
        }));
        if (showNotification) showNotification('Image processed successfully', 'success');
        return { success: true, ocrText, matches, createdAt: Date.now() };
      } catch (error) {
        console.error('[processImage] Error during OCR:', error);
        setScans(prev => prev.map(s => s.id === scan.id ? { ...s, status: 'error' } : s));
        if (showNotification) showNotification('Failed to process image', 'danger');
        return null;
      }
    }, [worker]);

    const lockActivePhotoField = React.useCallback((fieldName: keyof LicenceFieldsWithLock) => {
      if(!activeScanId){
        props.showNotification('no active scan for locking fields')
      }

      let newScans = scans.map((s) => {
        if (s.id == activeScanId){
          const newScan:Scan =  {
            ...s,
            fields: {
              [fieldName]: {
                locked: true,
                value:  s.fields[fieldName]
              },
              ...s.fields
            }
          }
          return newScan;
        }else{
          return s
        }
      })

      setScans(newScans)

    }, [])

    // Process queue
    const processQueue = useCallback(async (selectedScanMode: string, showNotification?: (msg: string, type?: 'success' | 'warning' | 'danger' | 'info' | undefined) => void) => {
      console.log('[processQueue] Called. isProcessing:', isProcessing, 'worker:', !!worker, 'scans.length:', scans.length);
      if (isProcessing ) return;
 
      if(!worker) {
        console.warn('[processQueue] Queue processing attempted with no worker');
        return
      }
 
      if(scans.length === 0 ) {
        console.log('[processQueue] No scans to process.');
        return
      }
      setIsProcessing(true);
      const scan = scans.find(s => s.status === 'queued');
      if (scan) {
        console.log('[processQueue] Processing scan:', scan.id);
        setScans(prev => prev.map(s => s.id === scan.id ? { ...s, status: 'processing' } : s));
        await processImage(scan, selectedScanMode, showNotification);
      } else {
        console.log('[processQueue] No queued scan found.');
      }
      setIsProcessing(false);
      console.log('[processQueue] Done.');
    }, [isProcessing, scans, worker, processImage]);


    // Use effect to process queue when scans change
    React.useEffect(() => {
      if (!isProcessing && scans.some(s => s.status === 'queued')) {
          void processQueue(selectedScanMode);
      }
  }, [isProcessing, scans, processQueue, selectedScanMode]);

    // Deskew the image so the card/text is horizontal
    function deskewImage(src: any): any {
      // Convert to grayscale
      let gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

      // Binarize
      let bin = new cv.Mat();
      cv.adaptiveThreshold(
        gray, bin, 255,
        cv.ADAPTIVE_THRESH_MEAN_C,
        cv.THRESH_BINARY_INV,
        15, 10
      );

      // Use Canny edge detection (with destination Mat)
      let edges = new cv.Mat();
      cv.Canny(bin, edges, 50, 150);

      // Morphological closing to connect lines and remove small noise
      let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5), new cv.Point(-1, -1));
      let closed = new cv.Mat();
      cv.morphologyEx(
        edges,
        closed,
        cv.MORPH_CLOSE,
        kernel,
        new cv.Point(-1, -1),
        1,
        cv.BORDER_CONSTANT,
        cv.morphologyDefaultBorderValue()
      );

      // Find contours
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Filter contours by area and aspect ratio
      let maxArea = 0;
      let maxContour: any = null;
      let imgArea = src.cols * src.rows;
      for (let i = 0; i < contours.size(); i++) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area < imgArea * 0.1) continue; // Ignore very small contours
        let rect = cv.boundingRect(cnt);
        let aspect = rect.width / rect.height;
        if (aspect < 1.0 || aspect > 2.5) continue; // Ignore unlikely aspect ratios (tweak as needed)
        if (area > maxArea) {
          maxArea = area;
          maxContour = cnt;
        }
      }

      let rotated = src.clone();
      if (maxContour) {
        // Get min area rect
        let rotatedRect = cv.minAreaRect(maxContour);
        let angle = rotatedRect.angle;
        const width = rotatedRect.size.width;
        const height = rotatedRect.size.height;
        if (width < height) {
     //     angle += 90;
        }
        const originalAngle = angle;
        angle = Math.max(-30, Math.min(30, angle));
        console.log('[deskewImage] Largest contour area:', maxArea);
        console.log('[deskewImage] RotatedRect width:', width, 'height:', height);
        console.log('[deskewImage] Original angle:', originalAngle);
        console.log('[deskewImage] Clamped angle:', angle);
        if (Math.abs(angle) > 10) {
          let center = new cv.Point(src.cols / 2, src.rows / 2);
          let M = cv.getRotationMatrix2D(center, angle, 1);
          cv.warpAffine(src, rotated, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
          M.delete();
          console.log('[deskewImage] Deskewing applied.');
        } else {
          console.log('[deskewImage] Angle below threshold, skipping deskew.');
        }
      } else {
        console.log('[deskewImage] No suitable contour found for deskewing.');
      }

      gray.delete(); bin.delete(); edges.delete(); closed.delete(); kernel.delete(); contours.delete(); hierarchy.delete();
      return rotated;
    }

    // Preprocess image using OpenCV.js (opencv-ts): deskew + grayscale + adaptive threshold
    async function preprocessImage(imageDataUrl: string): Promise<string> {
      return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          // Get image data from canvas
          let src = cv.imread(canvas);
          // Deskew the image
          let deskewed = deskewImage(src);
          let gray = new cv.Mat();
          let bin = new cv.Mat();
          // Convert to grayscale
          cv.cvtColor(deskewed, gray, cv.COLOR_RGBA2GRAY, 0);
          // Adaptive threshold (binarization)
          cv.adaptiveThreshold(
            gray, bin, 255,
            cv.ADAPTIVE_THRESH_MEAN_C, // or cv.ADAPTIVE_THRESH_GAUSSIAN_C
            cv.THRESH_BINARY_INV,      // Invert: black text on white
            15, 10                     // Block size, C (tweak as needed)
          );
          // Show result on canvas and export
          cv.imshow(canvas, bin);
          // Clean up
          src.delete(); deskewed.delete(); gray.delete(); bin.delete();
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = imageDataUrl;
      });
    }

    // Handle file upload
    const handleFileUpload = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>, showNotification?: (msg: string, type?: 'success' | 'warning' | 'danger' | 'info' | undefined) => void) => {
      const files = Array.from(event.target.files || []);
      for (const file of files) {
        if (file.size > CONFIG.image.maxSize) {
          if (showNotification) showNotification(`Image ${file.name} is too large and will be skipped`, 'warning');
          continue;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            try {
              // Preprocess image for better OCR
              const processed = await preprocessImage(result);
              addScanToQueue(processed);
              if (showNotification) showNotification(`Added ${file.name} to queue`, 'success');
            } catch (error) {
              if (showNotification) showNotification(`Failed to process ${file.name}`, 'danger');
            }
          }
        };
        reader.readAsDataURL(file);
      }
    }, [addScanToQueue]);

    // Lightweight OCR score: count of recognized text characters
    const getORCScore = React.useCallback(async (videoRef: React.RefObject<HTMLVideoElement>): Promise<number> => {
      if (!videoRef || !videoRef.current) {
        return 0;
      }
      if (!worker) {
        return 0;
      }
      const selectedMode = CONFIG.scanModes.find(mode => mode.id === selectedScanMode);
      if (!selectedMode) throw new Error('Invalid scan mode selected');
/*  const videoWidth = videoRef.current.videoWidth;
  const videoHeight = videoRef.current.videoHeight;
  let canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  if (videoHeight > videoWidth) {
    // Portrait: rotate to landscape
    canvas.width = videoHeight;
    canvas.height = videoWidth;
    if (ctx) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(90 * Math.PI / 180);
      ctx.drawImage(videoRef.current, 0 - videoWidth / 2, 0 - videoHeight / 2, videoWidth, videoHeight);
      ctx.restore();
    }
  } else {
    // Already landscape
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    ctx?.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);
  }*/
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(videoRef.current, 0, 0, videoRef.current.videoWidth, videoRef.current.videoHeight);
      const dataUrl = canvas.toDataURL('image/jpeg');
      await worker.setParameters({
        ...selectedMode.tesseractConfig
    });
      // Use a lightweight Tesseract call (no layout, just text)
      const result = await worker.recognize(dataUrl);
      // Score: number of non-whitespace characters detected
      const text = result.data.text || '';
      return text.replace(/\s/g, '').length;
    }, [worker, selectedScanMode]);

    // Live OCR score polling effect
    useEffect(() => {
      let interval: NodeJS.Timeout | null = null;
      if (props.videoRef && props.videoRef.current) {
        const poll = async () => {
          if (props.videoRef && props.videoRef.current) {
            const res = await getORCScore(props.videoRef);
            console.log('[getORCScore] OCR score:', res);
            setOrcStrength(res);
          }
        };
        poll(); // initial
        interval = setInterval(poll, 1000); // poll every 1s
      }
      return () => {
        if (interval) clearInterval(interval);
      };
    }, [props.videoRef, getORCScore]);
/*
    const captureFrame = React.useCallback(async (videoRef: React.RefObject<HTMLVideoElement>):Promise<string | null>  => {
      if (!canvas) return null;
      const ctx:CanvasRenderingContext2D | null = canvas.getContext('2d');
      if (!ctx) return null;

      const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
      const isLandscape = window.innerWidth > window.innerHeight;

      if (isLandscape) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      } else {
        // rotate 90 degrees for portrait orientation
        canvas.width = video.videoHeight;
        canvas.height = video.videoWidth;
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
        ctx.restore();
      }

      return canvas.toDataURL("image/jpeg");
    }, []);*/

    // Take photo from camera
    const takePhoto = React.useCallback(async (videoRef: React.RefObject<HTMLVideoElement>)  => {
      if (!videoRef.current) return;
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;
      let canvas = document.createElement('canvas');
      let ctx = canvas.getContext('2d');
     /*if (videoHeight > videoWidth) {
        // Portrait: rotate to landscape
        canvas.width = videoHeight;
        canvas.height = videoWidth;
        if (ctx) {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(90 * Math.PI / 180);
          ctx.drawImage(videoRef.current, 0 - videoWidth / 2, 0 - videoHeight / 2, videoWidth, videoHeight);
          ctx.restore();
        }
      } else {
        // Already landscape
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        ctx?.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);
      }*/
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        ctx?.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);
      const dataUrl = canvas.toDataURL('image/jpeg');
      try {
        // Preprocess image for better OCR
        const processed = await preprocessImage(dataUrl);
        addScanToQueue(processed);
        props.showNotification('Photo captured successfully', 'success');
      } catch (error) {
        props.showNotification('Failed to process photo', 'danger');
      }
    }, [addScanToQueue]);

    return {
      worker, scans, addScan, clearScans, clearScan, activeScanId, setActiveScanId, lockField, mergeFieldsToActiveScan, orcStrength,
       clearAllScans, isProcessing, processImage, handleFileUpload, takePhoto, lockActivePhotoField, selectedScanMode, setSelectedScanMode
    };
  }
