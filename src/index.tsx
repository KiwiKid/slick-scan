import type { Worker as TesseractWorker } from 'tesseract.js';
import { createWorker, PSM } from 'tesseract.js';
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
            <button className="delete" onClick={onDismiss} />
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
  other: string[];
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
      : [],
    createdAt: Date.now(),
  };
}

interface FieldMatch {
  value: string;
  confidence: number;
  line: number;
  pattern: string;
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

export function extractFieldsV2(text: string): { fields: LicenceFields; matches: FieldMatches } {
  const lines = text.split('\n');
  const matches: FieldMatches = {
    id: [],
    name: [],
    dor: [],
    issue: [],
    valid: [],
    spousePartner: [],
    other: []
  };

  // Define patterns for each field with their confidence scores
  const patterns: Array<{
    field: keyof FieldMatches;
    pattern: RegExp;
    confidence: number;
  }> = [
    { field: 'id', pattern: /\b\d{6,8}\b/g, confidence: 1.0 },
    { field: 'name', pattern: /NAME[\s:]+([A-Za-z .-]+)(?:\n|$)/i, confidence: 0.9 },
    { field: 'dor', pattern: /DOR[\s:]+([0-9\/]+)(?:\n|$)/i, confidence: 0.9 },
    { field: 'issue', pattern: /ISSUE[\s:]+([0-9\/]+)(?:\n|$)/i, confidence: 0.9 },
    { field: 'valid', pattern: /VALID[\s:]+([0-9\/\- ]+)(?:\n|$)/i, confidence: 0.9 },
    { field: 'spousePartner', pattern: /SPOUSE\/PARTNER[\s:]+([A-Za-z .-]+)(?:\n|$)/i, confidence: 0.8 },
    { field: 'other', pattern: /OTHER[\s]*\n([\s\S]+?)(?:\n\s*Licence|$)/i, confidence: 0.7 }
  ];

  // First pass: Find all potential matches
  lines.forEach((line, lineNum) => {
    patterns.forEach(({ field, pattern, confidence }) => {
      if (field === 'id') {
        const idMatches = line.match(pattern);
        if (idMatches) {
          idMatches.forEach(match => {
            matches[field as keyof FieldMatches].push({
              value: match,
              confidence,
              line: lineNum,
              pattern: pattern.toString()
            });
          });
        }
      } else {
        const match = line.match(pattern);
        if (match) {
          matches[field as keyof FieldMatches].push({
            value: match[1]?.trim() ?? match[0],
            confidence,
            line: lineNum,
            pattern: pattern.toString()
          });
        }
      }
    });
  });

  // Second pass: Look for contextual matches
  // For example, if we find a date near a "DOR" label, increase its confidence
  lines.forEach((line, lineNum) => {
    if (line.includes('DOR') && !matches.dor.some(m => m.line === lineNum)) {
      const dateMatch = line.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
      if (dateMatch) {
        matches.dor.push({
          value: dateMatch[0],
          confidence: 0.7,
          line: lineNum,
          pattern: 'contextual'
        });
      }
    }
  });

  // Select the best matches based on confidence and position
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
  };

  return {
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
  }

const copyCSV = (scans: Scan[]) => {
  const header = 'id|name|dor|issue|valid|spousePartner|other|createdAt';
  const rows = scans.map(scan => [
    scan.fields.id,
    scan.fields.name,
    scan.fields.dor,
    scan.fields.issue,
    scan.fields.valid,
    scan.fields.spousePartner,
    scan.fields.other.join(';'),
    scan.createdAt
  ].map(val => (val ?? '').toString().replace(/\|/g, ' ')).join('|'));
  const csv = [header, ...rows].join('\n');
  navigator.clipboard.writeText(csv);
};

interface DailyScans {
  [date: string]: {
    scans: Scan[];
  };
}

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

function useScans() {
  const [scans, setScans] = React.useState<Scan[]>(() => {
    try {
      console.log('Initializing scans from localStorage...');
      const raw = localStorage.getItem('scanData');
      console.log('Raw data from localStorage:', raw ? 'Data exists' : 'No data found');
      
      if (!raw) {
        console.log('No scan data found in localStorage, initializing empty array');
        return [];
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
        return [];
      }
      
      const dailyScans: DailyScans = parsed;
      console.log('Processing daily scans...');
      const flattenedScans = Object.values(dailyScans)
        .flatMap(day => day.scans)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20);
      
      console.log('Scans loaded successfully:', {
        totalDays: Object.keys(dailyScans).length,
        totalScans: flattenedScans.length,
        dateRange: {
          oldest: new Date(flattenedScans[flattenedScans.length - 1]?.createdAt).toISOString(),
          newest: new Date(flattenedScans[0]?.createdAt).toISOString()
        }
      });
      
      return flattenedScans;
    } catch (error) {
      console.error('Error loading scans from localStorage:', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      return [];
    }
  });

  React.useEffect(() => {
    try {
      console.log('Saving scans to localStorage...', {
        scanCount: scans.length,
        dates: scans.map(s => new Date(s.createdAt).toISOString().split('T')[0])
      });

      // Group scans by date
      const dailyScans: DailyScans = scans.reduce((acc, scan) => {
        const date = new Date(scan.createdAt).toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { scans: [] };
        }
        acc[date].scans.push(scan);
        return acc;
      }, {} as DailyScans);

      console.log('Grouped scans by date:', {
        dates: Object.keys(dailyScans),
        scansPerDate: Object.entries(dailyScans).map(([date, data]) => ({
          date,
          count: data.scans.length
        }))
      });

      const serialized = JSON.stringify(dailyScans);
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
    console.log('Adding new scan:', {
      id: scan.id,
      createdAt: new Date(scan.createdAt).toISOString(),
      fields: scan.fields
    });
    setScans(prev => [scan, ...prev].slice(0, 20));
  }, []);

  const clearScans = React.useCallback(() => {
    console.log('Clearing all scans');
    setScans([]);
    localStorage.removeItem('scanData');
  }, []);

  return { scans, addScan, clearScans };
}

const SCAN_MODES = [{
    id: 'auto',
    name: 'Auto Mode',
    description: 'Best for detecting titles and values',
    tesseractConfig: {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ',
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        textord_min_linesize: '2.5',  // Helps detect smaller text
        textord_max_linesize: '3.5',  // Helps with larger text
    },
},
{
    id: 'single_block',
    name: '(legacy) Single Block',
    description: 'Single block of text',
    tesseractConfig: {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ',
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
    },
}];

const App = (): JSX.Element => {
    const [photos, setPhotos] = useState<PhotoItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [worker, setWorker] = useState<TesseractWorker | null>(null);
    const [notifications, setNotifications] = useState<Array<{ id: string; message: string; type: string }>>([]);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const { scans, addScan, clearScans } = useScans();
    const [selectedScanMode, setSelectedScanMode] = useState<string>(SCAN_MODES[0].id);

    const MAX_STORAGE_ITEMS = 20;
    const MAX_IMAGE_SIZE = 1024 * 1024;
    const MAX_STORED_IMAGE_SIZE = 200 * 1024;
    const COMPRESSED_WIDTH = 800;
    const JPEG_QUALITY = 0.6;

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

    const compressImage = useCallback(async (dataUrl: string): Promise<string> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > COMPRESSED_WIDTH) {
                    height = (COMPRESSED_WIDTH * height) / width;
                    width = COMPRESSED_WIDTH;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                
                const compressedData = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                
                if (compressedData.length > MAX_STORED_IMAGE_SIZE) {
                    const lowerQuality = JPEG_QUALITY * 0.8;
                    resolve(canvas.toDataURL('image/jpeg', lowerQuality));
                } else {
                    resolve(compressedData);
                }
            };
            img.src = dataUrl;
        });
    }, []);

    const processImage = useCallback(async (photo: PhotoItem): Promise<void> => {
        if (!worker) return;

        try {
            const selectedMode = SCAN_MODES.find(mode => mode.id === selectedScanMode);
            if (!selectedMode) {
                throw new Error('Invalid scan mode selected');
            }

            await worker.setParameters(selectedMode.tesseractConfig);
            const result = await worker.recognize(photo.data);
            console.log('Tesseract Result:', result.data.text);
            setPhotos(prev => prev.map(p =>
                p.id === photo.id ? { ...p, status: 'completed' as const, text: result.data.text } : p
            ));
            // Extract fields and save scan
            const { fields, matches } = extractFieldsV2(result.data.text);
            addScan({
                id: photo.id,
                image: photo.data,
                ocrText: result.data.text,
                fields,
                matches,
                createdAt: Date.now(),
            });
            showNotification('Image processed successfully', 'success', () => {
                const scanElement = document.querySelector(`#scan-${photo.id}`);
                if (scanElement) {
                    scanElement.scrollIntoView({ behavior: 'smooth' });
                }else {
                    console.warn('No scan element found for photo: - not scrolling to it', photo.id);
                }
            });

        } catch (error) {
            setPhotos(prev => prev.map(p =>
                p.id === photo.id ? { ...p, status: 'error' as const } : p
            ));
            showNotification('Failed to process image', 'danger');
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
            await processImage(photo);
        }

        setIsProcessing(false);
    }, [isProcessing, photos, worker, processImage]);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        
        for (const file of files) {
            if (file.size > MAX_IMAGE_SIZE) {
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
                            if (updated.length > MAX_STORAGE_ITEMS) {
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
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(videoRef.current, 0, 0);
        
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
                if (updated.length > MAX_STORAGE_ITEMS) {
                    updated.shift();
                }
                return updated;
            });
            showNotification('Photo captured successfully', 'success');
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
                    <button
                        className="button is-primary is-large camera-button"
                        onClick={takePhoto}
                    >
                        Take Photo
                    </button>
                </div>
            )}
        <div className="box">
            <div className="field">
                <div className="buttons is-centered">
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
                                <span className="file-icon">
                                    <i className="fas fa-upload" />
                                </span>
                                <span className="file-label">Choose photos...</span>
                            </span>
                        </label>
                    </div>
                    {!isCameraActive ? (
                        <button
                            className="button is-primary"
                            onClick={startCamera}
                        >
                            Open Camera
                        </button>
                    ) : (
                        <button
                            className="button is-danger"
                            onClick={stopCamera}
                        >
                            Close Camera
                        </button>
                    )}
                </div>
                <button
                    className="button is-info"
                    onClick={() => {
                        copyCSV(scans);
                        showNotification('Copied all scans as CSV to clipboard', 'success');
                    }}
                >
                    Copy CSV ({scans.length})
                </button>
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
            </div>
            <PhotoList photos={photos} />
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
                <table className="table is-striped is-fullwidth is-hoverable">
                    <thead>
                        <tr>
                            <th>Created At</th>
                            <th>Fields</th>
                            <th>OCR Text</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scans.map(scan => (
                            <tr key={scan.id}>
                                <td><a style={{width: '5rem', height: '3rem'}} href={scan.image} target="_blank" rel="noopener noreferrer"><img src={scan.image} alt="Scanned" /></a></td>
                                <td>{new Date(scan.createdAt).toLocaleString()}
                                    <ul>
                                <li>ID:{scan.fields.id}</li>
                                <li>NAME:{scan.fields.name}</li>
                                <li>DOR:{scan.fields.dor}</li>
                                <li>ISSUE:{scan.fields.issue}</li>
                                <li>VALID:{scan.fields.valid}</li>
                                <li>SPOUSE/PARTNER:{scan.fields.spousePartner}</li>
                                <li>OTHER:{scan.fields.other.join('; ')}</li>
                                
                                </ul>
                                </td>
                                <td><details><summary>OCR Text</summary>{scan.ocrText}</details></td>                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="field">
                    <label className="label">Scan Mode</label>
                    <div className="control">
                        <div className="select is-fullwidth">
                            <select 
                                value={selectedScanMode}
                                onChange={(e) => setSelectedScanMode(e.target.value)}
                            >
                                {SCAN_MODES.map(mode => (
                                    <option key={mode.id} value={mode.id}>
                                        {mode.name} - {mode.description}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

class SlickScan extends HTMLElement {
    private shadow: ShadowRoot;

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });
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

        const container = document.createElement('div');
        this.shadow.appendChild(container);

        ReactDOM.createRoot(container).render(
            React.createElement(App)
        );
    }
}

customElements.define('slick-scan', SlickScan);