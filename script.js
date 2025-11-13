const API_URL = 'https://protube-server.onrender.com';
const socket = io(API_URL, {
    transports: ['websocket', 'polling']
});

let socketId = null; 

const activeDownloads = new Map();

socket.on('connect', () => {
    socketId = socket.id;
    console.log('Socket connected with ID:', socketId);
});

socket.on('disconnect', () => {
    console.warn('Socket disconnected. Real-time progress updates are paused.');
    socketId = null;
});

socket.on('progress_update', (data) => {
    const card = activeDownloads.get(data.filename);
    if (!card) return;

    const progressBar = card.querySelector('.progress-bar');
    const progressText = card.querySelector('.progress-text');

    const progress = data.progress;
    
    progressBar.style.width = `${progress}%`;
    
    if (progress < 100) {
        progressText.innerHTML = `${progress}% - Downloading... 
            <span style="font-size:0.8em; color: #a0c4ff;">(${data.speed || 'N/A'} | ETA: ${data.eta || 'N/A'})</span>`;
    } else {
        progressText.innerHTML = `100% - **Processing Complete!** Waiting for file transfer...`;
        card.classList.remove('failed');
    }
});

socket.on('progress_error', (data) => {
    const card = activeDownloads.get(data.filename);
    if (!card) return;
    
    const errorMessage = data.error || 'Server-side download failed.';
    updateDownloadCardError(card, errorMessage);
    displayMessage(`Download failed for ${data.filename}: ${errorMessage}`);
    activeDownloads.delete(data.filename);
});


function autoAdjustTextarea(element) {
    element.style.height = 'auto';
    element.style.height = (element.scrollHeight) + 'px';
}

function displayMessage(message, type = 'error', linkElement = null) {
    const statusArea = document.getElementById('notification-area') || document.getElementById('playlist-status');
    if (!statusArea) {
        console.error("Display Message Error:", message);
        return;
    }

    const msgCard = document.createElement('div');
    msgCard.className = `download-card glass-effect ${type}-message`;
    msgCard.style.padding = '15px';
    msgCard.style.backgroundColor = type === 'error' ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.5)';
    msgCard.style.borderColor = type === 'error' ? 'red' : 'green';

    if (linkElement) {
        msgCard.innerHTML = `<p class="title" style="margin: 0; color: #fff;">${message}</p>`;
        msgCard.appendChild(linkElement);
    } else {
        msgCard.innerHTML = `<p class="title" style="margin: 0; color: #fff;">${message}</p>`;
    }

    statusArea.prepend(msgCard);
    setTimeout(() => msgCard.remove(), 8000);
}


async function startDownload() {
    const textarea = document.getElementById('video-links');
    const links = textarea.value.trim().split('\n').filter(l => l.length > 0);
    const resolution = document.getElementById('resolution-select').value;
    const format = document.getElementById('format-select').value;
    const statusArea = document.getElementById('download-status');

    if (links.length === 0) {
        displayMessage("Please paste at least one link.");
        return;
    }

    textarea.value = '';
    autoAdjustTextarea(textarea);

    if (!socketId) {
        displayMessage("Socket connection not ready. Please wait a moment and try again.");
        return;
    }

    for (const link of links) {
        const card = createDownloadCard(link, resolution, format);
        const heading = statusArea.querySelector('h3');
        if (heading) {
            heading.after(card);
        } else {
            statusArea.prepend(card);
        }

        let downloadFilename = null;

        try {
            const infoResponse = await fetch(`${API_URL}/api/video_info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ link })
            });

            const infoData = await infoResponse.json();

            if (infoResponse.ok && infoData.status === 'ready') {
                updateDownloadCardInfo(card, infoData.title, infoData.thumbnail_url);
                const ext = (format === 'mp3') ? 'mp3' : 'mp4';
                const safeTitle = infoData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                
                if (format === 'mp3') {
                     downloadFilename = `${safeTitle}.${ext}`;
                } else if (resolution === 'best') {
                     downloadFilename = `${safeTitle}_best.${ext}`;
                } else {
                     downloadFilename = `${safeTitle}_${resolution}.${ext}`;
                }

                activeDownloads.set(downloadFilename, card);
                
                await startRealDownload(card, link, resolution, format, downloadFilename);
                
            } else {
                const errorMessage = infoData.error || `Unknown Error (Status: ${infoResponse.status})`;
                updateDownloadCardError(card, errorMessage);
                displayMessage(`Download failed for link starting with "${link.substring(0, 30)}...": ${errorMessage}`);
            }

        } catch (error) {
            updateDownloadCardError(card, `Network error or server unreachable during info fetch. Check your console.`);
            displayMessage(`Network error during info fetch: ${error.message}`);
            console.error('Download info fetch critical error:', error);
        } finally {
            if (downloadFilename) {
                activeDownloads.delete(downloadFilename);
            }
        }
    }
}

async function startRealDownload(card, link, resolution, format, downloadFilename) {
    const progressBar = card.querySelector('.progress-bar');
    const progressText = card.querySelector('.progress-text');

    progressText.textContent = `0% - Connecting to server...`;
    progressBar.style.width = '0%';
    card.classList.remove('failed', 'completed');

    try {
        const response = await fetch(`${API_URL}/api/download`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Socket-ID': socketId 
            },
            body: JSON.stringify({ link, resolution, format })
        });
        
        if (response.ok) {
            const contentDisposition = response.headers.get('Content-Disposition');
            const match = contentDisposition && contentDisposition.match(/filename=["']?(.+?)["']?$/i);
            const filename = match ? match[1] : downloadFilename;

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();

            window.URL.revokeObjectURL(url);

            progressBar.style.width = '100%';
            card.classList.add('completed');
            progressText.innerHTML = `100% - **Download Complete!** (${filename}) - Auto-download started.`;

        } else {
            const errorData = await response.json();
            const errorMessage = errorData.error || response.statusText;
            updateDownloadCardError(card, `Download Error: ${errorMessage}`);
            displayMessage(`Download failed: ${errorMessage}`);
        }

    } catch (error) {
        updateDownloadCardError(card, `A critical network error occurred: ${error.message}`);
        displayMessage(`Critical download error: ${error.message}`);
        console.error('Critical Download error:', error);
    }
}

function createDownloadCard(link, resolution, format) {
    const card = document.createElement('div');
    card.className = 'download-card glass-effect';

    card.innerHTML = `
        <div class="card-header">
            <img class="thumbnail" src="https://placehold.co/120x68/203a43/ffffff?text=Loading..." alt="Video Thumbnail">
            <div class="info-group">
                <p class="title loading-text">Fetching video details...</p>
                <p class="resolution-info">
                    Resolution: <strong>${resolution.toUpperCase()}</strong>, 
                    Format: <strong>${format.toUpperCase()}</strong>
                </p>
            </div>
        </div>
        <div class="progress-container">
            <div class="progress-bar" style="width: 0%;"></div>
        </div>
        <p class="progress-text">0% - Initializing task...</p>
    `;
    return card;
}

function updateDownloadCardInfo(card, title, thumbnailUrl) {
    card.querySelector('.title').textContent = title;
    card.querySelector('.title').classList.remove('loading-text');
    card.querySelector('.thumbnail').src = thumbnailUrl;
    card.querySelector('.thumbnail').alt = title;
}

function updateDownloadCardError(card, message) {
    card.classList.add('failed');
    card.querySelector('.progress-bar').style.width = '100%';
    card.querySelector('.progress-text').innerHTML = `**Error:** ${message}`;
    card.querySelector('.title').textContent = 'Download Failed';
    card.querySelector('.thumbnail').src = 'https://placehold.co/120x68/cc0000/ffffff?text=ERROR';
}


async function startPlaylistDownload() {
    const playlistLink = document.getElementById('playlist-link').value.trim();
    const resolution = document.getElementById('playlist-resolution-select').value;
    const format = document.getElementById('playlist-format-select').value;
    const statusArea = document.getElementById('playlist-status');
    const API_URL = 'https://protube-server.onrender.com'; 

    if (playlistLink.length === 0) {
        displayMessage("Please paste a playlist link.");
        return;
    }

    const card = document.createElement('div');
    card.className = 'download-card glass-effect playlist-card';
    card.innerHTML = `
        <div class="card-header" style="align-items: center;">
            <i class="fas fa-list-ul" style="font-size: 2em; color: #4dcfff; flex-shrink: 0;"></i>
            <div class="info-group">
                <p class="title loading-text">Processing Playlist (Fetching Info)...</p>
                <p class="resolution-info">Target: <strong>${resolution.toUpperCase()} / ${format.toUpperCase()}</strong></p>
            </div>
        </div>
        <div class="progress-container">
            <div class="progress-bar" style="width: 5%;"></div>
        </div>
        <p class="progress-text">5% - Analyzing playlist content...</p>
        <p class="note" id="playlist-note">Communicating with the server to queue links.</p>
    `;
    if (statusArea.querySelector('.playlist-card')) {
        statusArea.querySelector('.playlist-card').remove();
    }
    statusArea.appendChild(card);

    try {
        const response = await fetch(`${API_URL}/api/download/playlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: playlistLink, resolution, format })
        });

        const data = await response.json();

        if (response.ok) {
            card.querySelector('.title').textContent = `Playlist: ${data.playlist_title}`;
            card.querySelector('.progress-text').textContent = `10% - Server accepted task. Queuing ${data.videos_queued} videos.`;
            card.querySelector('.progress-bar').style.width = '10%';

            mockPlaylistDownload(card, data.videos_queued);
        } else {
            card.classList.add('failed');
            card.querySelector('.progress-bar').style.width = '100%';
            card.querySelector('.progress-text').innerHTML = `**Error:** ${data.error || 'Unknown Server Error'}`;
            card.querySelector('.note').textContent = 'Please check the link and try again.';
            displayMessage(`Playlist download failed: ${data.error || response.statusText}`);
        }

    } catch (error) {
        card.classList.add('failed');
        card.querySelector('.progress-bar').style.width = '100%';
        card.querySelector('.progress-text').innerHTML = `**Critical Error:** Network connection failed.`;
        card.querySelector('.note').textContent = 'Please ensure the Python server is running.';
        displayMessage(`Playlist download critical error: ${error.message}`);
        console.error('Playlist download error:', error);
    }
}

function mockPlaylistDownload(card, totalVideos) {
    const progressBar = card.querySelector('.progress-bar');
    const progressText = card.querySelector('.progress-text');
    const note = card.querySelector('#playlist-note');
    let progress = 10;
    let downloadedCount = 0;

    const interval = setInterval(() => {

        if (downloadedCount < totalVideos) {
            downloadedCount++;
            progress = 10 + Math.floor((downloadedCount / totalVideos) * 80);

            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}% - Downloading Video ${downloadedCount} of ${totalVideos}...`;
            note.textContent = `Processing video ${downloadedCount} (Simulated)`;
        } else if (progress < 100) {
            progress += 5;
            if (progress >= 100) progress = 100;

            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}% - Finalizing and packaging files...`;
            note.textContent = `Finalizing ${totalVideos} video files.`;
        }

        if (progress >= 100) {
            clearInterval(interval);
            card.classList.add('completed');
            progressText.innerHTML = `100% - **Playlist Download Complete!** <a href="#" style="color:#38c172;">Click to Download Zip File (Simulated)</a>`;
            if (note) note.textContent = 'Ready for simulated download.';
        }
    }, 1500);
}


document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('video-links');
    if (textarea) {
        autoAdjustTextarea(textarea);
    }
});
