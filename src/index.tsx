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
};

function extractFields(text: string): LicenceFields {
  const idMatch = text.match(/\b\d{6,8}\b/);
  const nameMatch = text.match(/NAME\s*([A-Za-z .-]+)/i);
  const dorMatch = text.match(/DOR\s*([0-9\/]+)/i);
  const issueMatch = text.match(/ISSUE\s*([0-9\/]+)/i);
  const validMatch = text.match(/VALID\s*([0-9\/\- ]+)/i);
  const spouseMatch = text.match(/SPOUSE\/PARTNER\s*([A-Za-z .-]+)/i);
  const otherMatch = text.match(/OTHER\s*([\s\S]+?)(?:\n\s*Licence|$)/i);

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
  };
}

interface Scan {
    id: string;
    image: string;
    ocrText: string;
    fields: LicenceFields;
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

function useScans() {
  const [scans, setScans] = React.useState<Scan[]>(() => {
    const raw = localStorage.getItem('scans');
    return raw ? JSON.parse(raw) : [];
  });

  React.useEffect(() => {
    localStorage.setItem('scans', JSON.stringify(scans));
  }, [scans]);

  const addScan = React.useCallback((scan: Scan) => {
    setScans(prev => [scan, ...prev].slice(0, 20));
  }, []);

  return { scans, addScan };
}

const App = (): JSX.Element => {
    const [photos, setPhotos] = useState<PhotoItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [worker, setWorker] = useState<TesseractWorker | null>(null);
    const [notifications, setNotifications] = useState<Array<{ id: string; message: string; type: string }>>([]);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const { scans, addScan } = useScans();

    const MAX_STORAGE_ITEMS = 20;
    const MAX_IMAGE_SIZE = 1024 * 1024;
    const MAX_STORED_IMAGE_SIZE = 200 * 1024;
    const COMPRESSED_WIDTH = 800;
    const JPEG_QUALITY = 0.6;

    const showNotification = useCallback((message: string, type: 'success' | 'warning' | 'danger' | 'info' = 'info') => {
        const id = Date.now().toString();
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
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

    const processQueue = useCallback(async () => {
        if (isProcessing || photos.length === 0 || !worker) return;

        setIsProcessing(true);
        const photo = photos.find(p => p.status === 'queued');
        
        if (photo) {
            const updatedPhotos = photos.map(p => 
                p.id === photo.id ? { ...p, status: 'processing' as const } : p
            );
            setPhotos(updatedPhotos);

            try {
                await worker.setParameters({
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ',
                    tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
                    preserve_interword_spaces: '1',
                });
                const result = await worker.recognize(photo.data);
                setPhotos(prev => prev.map(p =>
                    p.id === photo.id ? { ...p, status: 'completed' as const, text: result.data.text } : p
                ));
                // Extract fields and save scan
                const fields = extractFields(result.data.text);
                addScan({
                  id: photo.id,
                  image: photo.data,
                  ocrText: result.data.text,
                  fields,
                  createdAt: Date.now(),
                });
                showNotification('Image processed successfully', 'success');
            } catch (error) {
                setPhotos(prev => prev.map(p =>
                    p.id === photo.id ? { ...p, status: 'error' as const } : p
                ));
                showNotification('Failed to process image', 'danger');
            }
        }

        setIsProcessing(false);
    }, [isProcessing, photos, worker, showNotification, addScan]);

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
            </div>
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
                            <th>ID</th>
                            <th>Name</th>
                            <th>DOR</th>
                            <th>Issue</th>
                            <th>Valid</th>
                            <th>Spouse/Partner</th>
                            <th>Other</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scans.map(scan => (
                            <tr key={scan.id}>
                                <td>{scan.fields.id}</td>
                                <td>{scan.fields.name}</td>
                                <td>{scan.fields.dor}</td>
                                <td>{scan.fields.issue}</td>
                                <td>{scan.fields.valid}</td>
                                <td>{scan.fields.spousePartner}</td>
                                <td>{scan.fields.other.join('; ')}</td>
                                <td>{new Date(scan.createdAt).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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