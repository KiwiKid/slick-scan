class SlickScan extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.photoQueue = [];
        this.isProcessing = false;
        this.worker = null;
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
                        <span></span>
                    </button>
                </div>
                <div id="photoList" class="mt-4"></div>
            </div>
        `;

        this.setupEventListeners();
    }

    setupEventListeners() {
        const fileInput = this.shadowRoot.querySelector('.file-input');
        const cameraButton = this.shadowRoot.querySelector('#cameraButton');

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

    updatePhotoList() {
        const photoList = this.shadowRoot.querySelector('#photoList');
        photoList.innerHTML = this.photoQueue.map(photo => `
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
                        ${photo.text ? `
                            <div class="ocr-result">
                                <strong>OCR Result:</strong>
                                <pre>${photo.text}</pre>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');
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