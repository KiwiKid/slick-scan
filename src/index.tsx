import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, QueryClient, QueryClientProvider } from 'react-query';
import ReactDOM from 'react-dom/client';
import { CONFIG, FieldMatches, LOCALE, Scan, useScans } from './useScans';
import Webcam from "react-webcam";

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
/*
export type LicenceFields = {
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
*/

const CopyButton = ({ title, text }: { title: string, text: string }) => {
    return (
        <button className="button is-small is-info" onClick={() => navigator.clipboard.writeText(text)}>
            Copy {title}
        </button>
    );
}

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

function getScanStrengthColor(strength: number, min = 100, max = 300) {
    // Clamp strength to [min, max]
    const s = Math.max(min, Math.min(max, strength));
    // Normalize to [0, 1]
    const t = (s - min) / (max - min);

    // Red to yellow to green
    // Red:   #ff3860 (255, 56, 96)
    // Yellow:#ffdd57 (255, 221, 87)
    // Green: #23d160 (35, 209, 96)

    let r, g, b;
    if (t < 0.5) {
        // Red to yellow
        const localT = t / 0.5;
        r = 255;
        g = 56 + (221 - 56) * localT;
        b = 96 + (87 - 96) * localT;
    } else {
        // Yellow to green
        const localT = (t - 0.5) / 0.5;
        r = 255 + (35 - 255) * localT;
        g = 221 + (209 - 221) * localT;
        b = 87 + (96 - 87) * localT;
    }
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
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
    const params = new URLSearchParams(window.location.search);

    const webcamRef = useRef<Webcam | null>(null);

    const {
        scans, addScan, clearScans, clearScan, activeScanId, setActiveScanId, lockField, mergeFieldsToActiveScan, worker,
        clearAllScans, isProcessing, setSelectedScanMode, processImage, handleFileUpload, takePhoto, orcStrength, selectedScanMode, debugImages
    } = useScans({
        videoRef: webcamRef,
        showNotification: showNotification,
        startSelectedScanMode: params.get('mode') || CONFIG.scanModes[0].id
    });
    const [notifications, setNotifications] = useState<Array<{ id: string; message: string; type: string }>>([]);
    const [isCameraActive, setIsCameraActive] = useState(query.data?.isCameraActive ?? false);

    const [isDeleteMode, setIsDeleteMode] = useState(false);

    const [orientation, setOrientation] = useState<number>(window.screen.orientation?.angle || window.orientation || 0);
    const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    const handleClearScan = (id: string) => {
        if(!isDeleteMode){
            if(!window.confirm('Are you sure you want to delete this scan?')){
                return;
            }
        }
        
        clearScan(id);
        showNotification('Scan cleared', 'success');
    }



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
                        <CopyButton title="OCR Text" text={JSON.stringify(scan.ocrText, null, 4)} />
                        <pre className="mt-2"><code>{JSON.stringify(scan.ocrText, null, 4)}</code></pre>
                        <pre className="mt-2"><code>{JSON.stringify(scan.fields, null, 4)}</code></pre>
                        <pre className="mt-2"><code>{JSON.stringify(scan.matches, null, 4)}</code></pre>

                        

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
        scan.fields.id.value,
        scan.fields.name.value,
        scan.fields.dor.value,
        scan.fields.issue.value,
        scan.fields.valid.value,
        scan.fields.spousePartner.value,
        scan.fields.other.value,
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



    const getORCClassName = (orcStrength: number):string => {
        if(orcStrength < 100){
            return 'is-primary';
        }
        if(orcStrength < 200){
            return 'is-info';
        }
        return 'is-success';
    }

    // Update video dimensions when metadata loads
    useEffect(() => {
        const video = webcamRef.current?.video;
        if (!video) return;
        const handleLoadedMetadata = () => {
            setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
        };
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        // If already loaded
        if (video.readyState >= 1) {
            setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
        }
        return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    }, [webcamRef.current]);

    // Device orientation
    useEffect(() => {
        const handleOrientationChange = () => {
            setOrientation(window.screen.orientation?.angle || window.orientation || 0);
        };
        window.addEventListener('orientationchange', handleOrientationChange);
        return () => window.removeEventListener('orientationchange', handleOrientationChange);
    }, []);

    // Determine if device is portrait
    const isDevicePortrait = window.innerHeight > window.innerWidth;
    // Determine if video is landscape
    const isVideoLandscape = videoDimensions.width > videoDimensions.height;
    // Only rotate if device is portrait and video is landscape
    const videoRotation = isDevicePortrait && isVideoLandscape ? 'rotate(90deg)' : 'none';

    return (
        
            <div>
            {isCameraActive && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    zIndex: 1,
                    background: 'black',
                }}>
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{
                            facingMode: "environment",
                            width: { ideal: 1920 },
                            height: { ideal: 1080 }
                        }}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                        mirrored={false}
                    />
                </div>
            )}
            {/* Optionally, show a queue of scans being processed */}
            {scans.some(s => s.status === 'queued' || s.status === 'processing') && (
                <div className="box mt-4">
                    <h4 className="title is-6">Processing Queue [{orientation} {videoRotation}]</h4>
                    {scans.filter(s => s.status === 'queued' || s.status === 'processing').map(scan => (
                        <div key={scan.id} className="mb-2">
                            <div className="columns is-mobile is-vcentered">
                                <div className="column is-narrow">
                                    <img src={scan.image} alt="Queued" style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                                </div>
                                <div className="column">
                                    <span className={`tag is-${scan.status === 'processing' ? 'info' : 'warning'}`}>{scan.status}</span>
                                    {scan.status === 'processing' && <span className="ml-2">Processing...</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
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
                    {scans.filter(s => s.status === 'completed').length > 0 && <table className="table is-striped is-fullwidth is-hoverable">
                        <thead>
                            <tr className="is-italic">
                                <th>Image</th>
                                <th>Results</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {scans.filter(s => s.status === 'completed').map(scan => (
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
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.id.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Name</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.name.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>DOR</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.dor.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Issue</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.issue.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Valid</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.valid.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="column is-12-mobile is-6-tablet">
                                                        <div className="field has-addons mb-1">
                                                            <div className="control is-narrow">
                                                                <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Partner</span>
                                                            </div>
                                                            <div className="control is-expanded">
                                                                <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.spousePartner.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {scan.fields.other.value && (
                                                        <div className="column is-12">
                                                            <div className="field has-addons mb-1">
                                                                <div className="control is-narrow">
                                                                    <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Other</span>
                                                                </div>
                                                                <div className="control is-expanded">
                                                                    <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.other.value}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td><ScanDetails scan={scan} /></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>}
                </div>
                <div className="is-hidden-tablet">
                    <div className="columns is-multiline is-gapless">
                        {scans.filter(s => s.status === 'completed').map(scan => (
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
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.id.value}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Name</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.name.value}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>DOR</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.dor.value}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Issue</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.issue.value}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Valid</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.valid.value}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="column is-12-mobile is-6-tablet">
                                                                <div className="field has-addons mb-1">
                                                                    <div className="control is-narrow">
                                                                        <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Partner</span>
                                                                    </div>
                                                                    <div className="control is-expanded">
                                                                        <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.spousePartner.value}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {scan.fields.other.value && (
                                                                <div className="column is-12">
                                                                    <div className="field has-addons mb-1">
                                                                        <div className="control is-narrow">
                                                                            <span className="button is-static is-small py-1 px-2 has-text-italic" style={{ minWidth: '60px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Other</span>
                                                                        </div>
                                                                        <div className="control is-expanded">
                                                                            <div className="input is-static is-small py-1 has-text-weight-bold" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scan.fields.other.value}</div>
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
                            ))}
                    </div>
                </div>
                {debugImages && (
                    <div className="py-6">
                        <div className="columns is-multiline is-gapless text-is-white">
                            {debugImages.map((image, index) => (
                                <div key={index} className="column is-12 mb-4 px-2">
                                    <h1 className="title is-6">{image.label}</h1>
                                    <h2 className="subtitle is-6">{image.subtitle}</h2>
                                    <img src={image.dataUrl} alt={image.label} style={{ width: '100%', height: 'auto', maxHeight: '200px', objectFit: 'contain' }} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="py-6">
                </div>
                <div className="py-6">
                </div>
            </div>

            

            <div className="fixed-bottom-nav">
                <div className="container">
                    <div className="buttons is-centered has-addons">
                    {isCameraActive && (
                        <div className="has-text-centered is-flex is-justify-content-center">
                            <button
                                className={`button ${getScanStrengthColor(orcStrength)} is-large camera-button image`}
                                onClick={() => takePhoto(webcamRef, orientation)}
                            >
                                Take Photo {orcStrength}
                            </button>
                        </div>
                        )}
                        {!isCameraActive ? (
                            <button
                                className="button is-info"
                                onClick={() => setIsCameraActive(true)}
                            >
                                Open Camera
                            </button>
                        ) : (
                            <button
                                className="button is-info"
                                onClick={() => setIsCameraActive(false)}
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
                                        onChange={e => handleFileUpload(e, showNotification)}
                                    />
                                    <span className="file-cta">
                                        <span className="file-label">Upload photos</span>
                                    </span>
                                </label>
                            </div>
                        )}
                        {scans.filter(s => s.status === 'completed').length > 0 && (
                            <>
                                <button
                                    className="button is-info"
                                    onClick={() => {
                                        copyCSV(scans.filter(s => s.status === 'completed'), true);
                                        showNotification(`Copied ${scans.filter(s => s.status === 'completed').length > 1 ? `all ${scans.filter(s => s.status === 'completed').length} scans` : 'one scan'} as CSV to clipboard - Paste into Excel`, 'success');
                                    }}
                                >
                                    Copy {scans.filter(s => s.status === 'completed').length} Scans 
                                </button>
                            </>
                        )}
                        <details className="has-text-black">
                            <summary>Advanced</summary>
                            [v0.2]
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
                                        clearAllScans();
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