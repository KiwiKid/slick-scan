import type { Worker as TesseractWorker } from 'tesseract.js';
import { createWorker } from 'tesseract.js';
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
    return React.createElement('div', { className: `notification is-${type}` },
        React.createElement('button', { className: 'delete', onClick: onDismiss }),
        message
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

    return React.createElement('div', { id: 'photoList', className: 'mt-4' },
        [...photos].reverse().map(photo => 
            React.createElement('div', { key: photo.id, className: 'photo-item' },
                React.createElement('div', { className: 'columns' },
                    React.createElement('div', { className: 'column is-one-third' },
                        React.createElement('img', { src: photo.data, className: 'photo-preview', alt: 'Scanned' })
                    ),
                    React.createElement('div', { className: 'column' },
                        React.createElement('div', { className: 'status' },
                            'Status: ',
                            React.createElement('span', { className: `tag ${getStatusClass(photo.status)}` },
                                photo.status
                            )
                        ),
                        photo.status === 'processing' && React.createElement('progress', {
                            className: 'progress is-small is-primary',
                            max: 100
                        }, 'Processing...'),
                        photo.text && React.createElement('div', { className: 'ocr-result' },
                            React.createElement('strong', null, 'OCR Result:'),
                            React.createElement('pre', null, photo.text)
                        )
                    )
                )
            )
        )
    );
};

const App = (): JSX.Element => {
    const [photos, setPhotos] = useState<PhotoItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [worker, setWorker] = useState<TesseractWorker | null>(null);
    const [notifications, setNotifications] = useState<Array<{ id: string; message: string; type: string }>>([]);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

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
                const result = await worker.recognize(photo.data);
                setPhotos(prev => prev.map(p =>
                    p.id === photo.id ? { ...p, status: 'completed' as const, text: result.data.text } : p
                ));
                showNotification('Image processed successfully', 'success');
            } catch (error) {
                setPhotos(prev => prev.map(p =>
                    p.id === photo.id ? { ...p, status: 'error' as const } : p
                ));
                showNotification('Failed to process image', 'danger');
            }
        }

        setIsProcessing(false);
    }, [isProcessing, photos, worker, showNotification]);

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

    return React.createElement('div', { className: 'box' },
        React.createElement('div', { className: 'field' },
            React.createElement('div', { className: 'buttons is-centered' },
                React.createElement('div', { className: 'file is-boxed' },
                    React.createElement('label', { className: 'file-label' },
                        React.createElement('input', {
                            className: 'file-input',
                            type: 'file',
                            accept: 'image/*',
                            multiple: true,
                            onChange: handleFileUpload
                        }),
                        React.createElement('span', { className: 'file-cta' },
                            React.createElement('span', { className: 'file-icon' },
                                React.createElement('i', { className: 'fas fa-upload' })
                            ),
                            React.createElement('span', { className: 'file-label' }, 'Choose photos...')
                        )
                    )
                ),
                !isCameraActive ? 
                    React.createElement('button', {
                        className: 'button is-primary',
                        onClick: startCamera
                    }, 'Open Camera') :
                    React.createElement('button', {
                        className: 'button is-danger',
                        onClick: stopCamera
                    }, 'Close Camera')
            )
        ),
        isCameraActive && React.createElement('div', { className: 'camera-container' },
            React.createElement('video', {
                ref: (el: HTMLVideoElement | null) => {
                    if (el) {
                        (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                    }
                },
                autoPlay: true,
                playsInline: true,
                muted: true
            }),
            React.createElement('div', { className: 'camera-overlay' },
                React.createElement('div', { className: 'card-guide' })
            ),
            React.createElement('button', {
                className: 'button is-primary is-large camera-button',
                onClick: takePhoto
            }, 'Take Photo')
        ),
        React.createElement(PhotoList, { photos }),
        React.createElement('div', { className: 'notification-container' },
            notifications.map(({ id, message, type }) =>
                React.createElement(Notification, {
                    key: id,
                    message,
                    type: type as 'success' | 'warning' | 'danger' | 'info',
                    onDismiss: () => setNotifications(prev => prev.filter(n => n.id !== id))
                })
            )
        )
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