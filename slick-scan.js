class SlickScan extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.photoQueue = [];
        this.isProcessing = false;
        this.worker = null;
        this.isVideoScanning = false;
        this.videoStream = null;
        this.matchedFields = new Set(); // Track unique matched fields
        this.activeFilters = new Set(); // Track which fields are being filtered
    }

    connectedCallback() {
        this.render();
        this.initializeWorker();
        this.loadStoredPhotos();
    }

    initializeWorker() {
        this.worker = Tesseract.createWorker();
        this.worker.load();
        this.worker.loadLanguage('eng');
        this.worker.initialize('eng');
    }

    async loadStoredPhotos() {
        const storedPhotos = JSON.parse(localStorage.getItem('slickScanPhotos') || '[]');
        for (const photo of storedPhotos) {
            this.addPhotoToQueue(photo);
        }
        this.processQueue();
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                .tag.is-clickable {
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .tag.is-clickable:hover {
                    transform: scale(1.05);
                }
                /* Font Awesome Icons */
                .icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 1.5em;
                    height: 1.5em;
                }
                .icon i {
                    font-size: 1em;
                }
                /* Simple icon replacements for Font Awesome */
                .fa-upload:before { content: "📤"; }
                .fa-camera:before { content: "📷"; }
                .fa-video:before { content: "🎥"; }
                .fa-stop:before { content: "⏹"; }
                .fa-check:before { content: "✓"; }
                .fa-filter:before { content: "🔍"; }
                .fa-check-circle:before { content: "✅"; }
            </style>
            <div class="box">
                <div class="field">
                    <div class="file is-boxed is-centered">
                        <label class="file-label">
                            <input class="file-input" type="file" accept="image/*" multiple>
                            <span class="file-cta">
                                <span class="file-icon">
                                    <i class="fas fa-upload"></i>
                                </span>
                                <span class="file-label">
                                    Choose photos...
                                </span>
                            </span>
                        </label>
                    </div>
                </div>
                <div class="camera-controls">
                    <button class="button is-primary is-fullwidth" id="cameraButton">
                        <span class="icon">
                            <i class="fas fa-camera"></i>
                        </span>
                        <span>Take Photo HERE?</span>
                    </button>
                    <button class="button is-info is-fullwidth mt-2" id="videoScanButton">
                        <span class="icon">
                            <i class="fas fa-video"></i>
                        </span>
                        <span>Start Video Scan</span>
                    </button>
                </div>
                <div id="videoPreview" class="mt-4" style="display: none;">
                    <video id="videoElement" autoplay playsinline style="width: 100%; max-width: 640px;"></video>
                    <div class="mt-2">
                        <progress class="progress is-small is-info" id="scanProgress" max="100">0%</progress>
                    </div>
                </div>
                <div id="photoList" class="mt-4"></div>
            </div>
        `;

        this.setupEventListeners();
    }

    setupEventListeners() {
        const fileInput = this.shadowRoot.querySelector('.file-input');
        const cameraButton = this.shadowRoot.querySelector('#cameraButton');
        const videoScanButton = this.shadowRoot.querySelector('#videoScanButton');

        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    this.addPhotoToQueue({
                        id: Date.now() + Math.random(),
                        data: event.target.result,
                        status: 'queued',
                        text: ''
                    });
                };
                reader.readAsDataURL(file);
            });
            this.processQueue();
        });

        cameraButton.addEventListener('click', () => {
            this.startCamera();
        });

        videoScanButton.addEventListener('click', () => {
            if (!this.isVideoScanning) {
                this.startVideoScan();
            } else {
                this.stopVideoScan();
            }
        });
    }

    async startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            video.addEventListener('loadedmetadata', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0);
                const photoData = canvas.toDataURL('image/jpeg');

                this.addPhotoToQueue({
                    id: Date.now() + Math.random(),
                    data: photoData,
                    status: 'queued',
                    text: ''
                });

                stream.getTracks().forEach(track => track.stop());
                this.processQueue();
            });
        } catch (err) {
            console.error('Error accessing camera:', err);
        }
    }

    async startVideoScan() {
        try {
            this.videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoElement = this.shadowRoot.querySelector('#videoElement');
            const videoPreview = this.shadowRoot.querySelector('#videoPreview');
            const videoScanButton = this.shadowRoot.querySelector('#videoScanButton');
            
            videoElement.srcObject = this.videoStream;
            videoPreview.style.display = 'block';
            this.isVideoScanning = true;
            videoScanButton.innerHTML = `
                <span class="icon">
                    <i class="fas fa-stop"></i>
                </span>
                <span>Stop Video Scan</span>
            `;

            // Start capturing frames
            this.captureVideoFrames();
        } catch (err) {
            console.error('Error accessing camera:', err);
        }
    }

    stopVideoScan() {
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        
        const videoPreview = this.shadowRoot.querySelector('#videoPreview');
        const videoScanButton = this.shadowRoot.querySelector('#videoScanButton');
        
        videoPreview.style.display = 'none';
        this.isVideoScanning = false;
        videoScanButton.innerHTML = `
            <span class="icon">
                <i class="fas fa-video"></i>
            </span>
            <span>Start Video Scan</span>
        `;
    }

    async captureVideoFrames() {
        if (!this.isVideoScanning) return;

        const videoElement = this.shadowRoot.querySelector('#videoElement');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        context.drawImage(videoElement, 0, 0);
        
        const photoData = canvas.toDataURL('image/jpeg');
        
        // Add frame to queue
        this.addPhotoToQueue({
            id: Date.now() + Math.random(),
            data: photoData,
            status: 'queued',
            text: ''
        });

        // Process the queue
        this.processQueue();

        // Schedule next frame capture
        setTimeout(() => this.captureVideoFrames(), 1000); // Capture a frame every second
    }

    addPhotoToQueue(photo) {
        this.photoQueue.push(photo);
        this.updatePhotoList();
        this.savePhotos();
    }

    async processQueue() {
        if (this.isProcessing || this.photoQueue.length === 0) return;

        this.isProcessing = true;
        const photo = this.photoQueue.find(p => p.status === 'queued');
        
        if (photo) {
            photo.status = 'processing';
            this.updatePhotoList();

            try {
                const result = await this.worker.recognize(photo.data);
                photo.text = result.data.text;
                
                // Check for matched fields in the OCR result
                const matches = this.findMatchedFields(photo.text);
                if (matches.length > 0) {
                    photo.matchedFields = matches;
                    matches.forEach(field => this.matchedFields.add(field));
                }
                
                photo.status = 'completed';
            } catch (error) {
                console.error('OCR processing error:', error);
                photo.status = 'error';
            }

            this.updatePhotoList();
            this.savePhotos();
            this.processQueue();
        }

        this.isProcessing = false;
    }

    findMatchedFields(text) {
        // Define patterns to match (you can customize these)
        const patterns = [
            { name: 'Email', regex: /[\w.-]+@[\w.-]+\.\w+/ },
            { name: 'Phone', regex: /\+?[\d\s-()]{10,}/ },
            { name: 'Date', regex: /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/ },
            { name: 'URL', regex: /https?:\/\/[\w.-]+\.[\w.-]+/ },
            { name: 'Price', regex: /\$\d+(\.\d{2})?/ },
            { name: 'License Plate', regex: /[A-Z0-9]{2,3}\s*[-]?\s*[A-Z0-9]{2,3}/ }
        ];

        const matches = [];
        patterns.forEach(pattern => {
            if (pattern.regex.test(text)) {
                matches.push(pattern.name);
            }
        });

        return matches;
    }

    updatePhotoList() {
        const photoList = this.shadowRoot.querySelector('#photoList');
        photoList.innerHTML = `
            <div class="matched-fields-summary mb-4">
                <h4 class="title is-6">Matched Fields:</h4>
                <div class="tags">
                    ${Array.from(this.matchedFields).map(field => `
                        <span class="tag ${this.activeFilters.has(field) ? 'is-success' : 'is-light'} is-clickable" 
                              data-field="${field}">
                            <span class="icon">
                                <i class="fas ${this.activeFilters.has(field) ? 'fa-check' : 'fa-filter'}"></i>
                            </span>
                            <span>${field}</span>
                        </span>
                    `).join('')}
                </div>
            </div>
            ${this.photoQueue
                .filter(photo => {
                    // If no filters are active, show all photos
                    if (this.activeFilters.size === 0) return true;
                    // Show photo if it has any of the active filter fields
                    return photo.matchedFields?.some(field => this.activeFilters.has(field));
                })
                .map(photo => `
                    <div class="photo-item">
                        <div class="columns">
                            <div class="column is-one-third">
                                <img src="${photo.data}" class="photo-preview">
                            </div>
                            <div class="column">
                                <div class="status">
                                    Status: <span class="tag is-${this.getStatusClass(photo.status)}">${photo.status}</span>
                                </div>
                                ${photo.status === 'processing' ? `
                                    <progress class="progress is-small is-primary" max="100">Processing...</progress>
                                ` : ''}
                                ${photo.matchedFields ? `
                                    <div class="matched-fields mt-2">
                                        <span class="icon has-text-success">
                                            <i class="fas fa-check-circle"></i>
                                        </span>
                                        <span class="is-size-7">Found: ${photo.matchedFields.join(', ')}</span>
                                    </div>
                                ` : ''}
                                ${photo.text ? `
                                    <div class="ocr-result mt-2">
                                        <strong>OCR Result:</strong>
                                        <pre>${photo.text}</pre>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
        `;

        // Add click handlers for the field tags
        const fieldTags = photoList.querySelectorAll('.tag[data-field]');
        fieldTags.forEach(tag => {
            tag.addEventListener('click', () => {
                const field = tag.dataset.field;
                if (this.activeFilters.has(field)) {
                    this.activeFilters.delete(field);
                } else {
                    this.activeFilters.add(field);
                }
                this.updatePhotoList(); // Re-render with new filters
            });
        });
    }

    getStatusClass(status) {
        switch (status) {
            case 'queued': return 'is-warning';
            case 'processing': return 'is-info';
            case 'completed': return 'is-success';
            case 'error': return 'is-danger';
            default: return 'is-light';
        }
    }

    savePhotos() {
        localStorage.setItem('slickScanPhotos', JSON.stringify(this.photoQueue));
    }
}

customElements.define('slick-scan', SlickScan); 