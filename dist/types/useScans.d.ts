import type { Worker as TesseractWorker } from 'tesseract.js';
import React from 'react';
import { PSM } from 'tesseract.js';
import Webcam from 'react-webcam';
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
export declare function extractFieldsV2(text: string): {
    success: boolean;
    matches: FieldMatches;
};
export type FieldWithLock = {
    value: string;
    locked: boolean;
};
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
export declare const LOCALE = "en-NZ";
export declare const CONFIG: {
    readonly storage: {
        readonly maxItems: 20;
        readonly retentionDays: 30;
    };
    readonly image: {
        readonly maxSize: number;
        readonly maxStoredSize: number;
        readonly compressedWidth: 800;
        readonly jpegQuality: 1;
    };
    readonly scanModes: readonly [{
        readonly id: "auto";
        readonly name: "Auto Mode";
        readonly description: "Best for detecting titles and values";
        readonly tesseractConfig: {
            readonly tessedit_pageseg_mode: PSM.AUTO;
        };
    }, {
        readonly id: "auto-whitelist";
        readonly name: "Auto Mode - with whitelist";
        readonly description: "Best for detecting titles and values";
        readonly tesseractConfig: {
            readonly tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ";
            readonly tessedit_pageseg_mode: PSM.AUTO;
        };
    }, {
        readonly id: "sparse_text_osd";
        readonly name: "Sparse Text OSD Mode";
        readonly description: "Sparse Text OSD Mode";
        readonly tesseractConfig: {
            readonly tessedit_pageseg_mode: PSM.SPARSE_TEXT_OSD;
        };
    }, {
        readonly id: "single_block";
        readonly name: "(legacy) Single Block";
        readonly description: "Single block of text";
        readonly tesseractConfig: {
            readonly tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:-.,@ ";
            readonly tessedit_pageseg_mode: PSM.SINGLE_BLOCK;
            readonly preserve_interword_spaces: "1";
        };
    }, {
        readonly id: "auto-extended";
        readonly name: "Auto Mode - get rich data";
        readonly description: "Best for detecting titles and values";
        readonly tesseractConfig: {
            readonly tessedit_pageseg_mode: PSM.AUTO;
        };
    }];
};
type UseScansProps = {
    showNotification: (msg: string, type?: 'success' | 'warning' | 'danger' | 'info' | undefined) => void;
    startSelectedScanMode: string | null;
    videoRef: React.RefObject<Webcam> | null;
};
export declare function useScans(props: UseScansProps): {
    worker: TesseractWorker | null;
    scans: Scan[];
    addScan: (scan: Scan) => void;
    clearScans: () => void;
    clearScan: (id: string) => void;
    activeScanId: string | null;
    setActiveScanId: React.Dispatch<React.SetStateAction<string | null>>;
    lockField: (scanId: string, fieldKey: keyof Omit<LicenceFieldsWithLock, "createdAt">) => void;
    mergeFieldsToActiveScan: (newFields: Partial<Omit<LicenceFieldsWithLock, "createdAt">>) => void;
    orcStrength: number;
    clearAllScans: () => void;
    isProcessing: boolean;
    processImage: (scan: Scan, selectedScanMode: string, showNotification?: (msg: string, type?: "success" | "warning" | "danger" | "info" | undefined) => void) => Promise<{
        success: boolean;
        matches: FieldMatches;
        createdAt: number;
        ocrText: string;
    } | null>;
    handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>, showNotification?: (msg: string, type?: "success" | "warning" | "danger" | "info" | undefined) => void) => Promise<void>;
    takePhoto: (videoRef: React.RefObject<Webcam>, orientation?: number) => Promise<void>;
    lockActivePhotoField: (fieldName: keyof LicenceFieldsWithLock) => void;
    selectedScanMode: string;
    setSelectedScanMode: React.Dispatch<React.SetStateAction<string>>;
    debugImages: {
        label: string;
        dataUrl: string;
        subtitle?: string;
    }[];
    setDebugImages: React.Dispatch<React.SetStateAction<{
        label: string;
        dataUrl: string;
        subtitle?: string;
    }[]>>;
};
export {};
