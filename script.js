// --- Auto-Adjust Textarea Function ---
function autoAdjustTextarea(element) {
    element.style.height = 'auto';
    element.style.height = (element.scrollHeight) + 'px';
}

// --- Display Message Function (Replaces alert()) ---
function displayMessage(message, type = 'error', linkElement = null) {
    const statusArea = document.getElementById('download-status') || document.getElementById('playlist-status');
    // If the element doesn't exist (e.g., on playlist page for single error) just log it
    if (!statusArea) {
        console.error("Display Message Error:", message);
        return;
    }

    const msgCard = document.createElement('div');
    msgCard.className = `download-card glass-effect ${type}-message`;
    msgCard.style.padding = '15px';
    // Use clear visibility for error/success messages outside the main card flow
    msgCard.style.backgroundColor = type === 'error' ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.5)';
    msgCard.style.borderColor = type === 'error' ? 'red' : 'green';

    if (linkElement) {
        msgCard.innerHTML = `<p class="title" style="margin: 0; color: #fff;">${message}</p>`;
        msgCard.appendChild(linkElement);
    } else {
        msgCard.innerHTML = `<p class="title" style="margin: 0; color: #fff;">${message}</p>`;
    }

    // Prepend to status area and automatically remove after 8 seconds
    statusArea.prepend(msgCard);
    setTimeout(() => msgCard.remove(), 8000);
}


// --- Main Download Function (Single/Multi) ---
async function startDownload() {
    const textarea = document.getElementById('video-links');
    const links = textarea.value.trim().split('\n').filter(l => l.length > 0);
    const resolution = document.getElementById('resolution-select').value;
    const format = document.getElementById('format-select').value;
    const statusArea = document.getElementById('download-status');
    const API_URL = 'https://protube-server.onrender.com'; // Flask server address

    if (links.length === 0) {
        displayMessage("Please paste at least one link.");
        return;
    }

    // Clear the input area and adjust height
    textarea.value = '';
    autoAdjustTextarea(textarea);

    // Process each link sequentially
    for (const link of links) {
        const card = createDownloadCard(link, resolution, format);
        statusArea.prepend(card);

        // 1. Fetch Video Info
        try {
            const infoResponse = await fetch(`${API_URL}/api/video_info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ link })
            });

            // Always parse JSON data, even if the status is not ok (e.g., 400 contains error message)
            const infoData = await infoResponse.json();

            if (infoResponse.ok && infoData.status === 'ready') {
                updateDownloadCardInfo(card, infoData.title, infoData.thumbnail_url);
                // 2. Start Real Download
                await startRealDownload(card, link, resolution, format);
            } else {
                // Handle status codes like 400, 404, 500 explicitly for info fetch
                // infoData.error will contain the detailed message from the Python server (e.g., "YouTube refused...")
                const errorMessage = infoData.error || `Unknown Error (Status: ${infoResponse.status})`;
                updateDownloadCardError(card, errorMessage);
                displayMessage(`Download failed for link starting with "${link.substring(0, 30)}...": ${errorMessage}`);
            }

        } catch (error) {
            updateDownloadCardError(card, `Network error or server unreachable during info fetch. Check your console.`);
            displayMessage(`Network error during info fetch: ${error.message}`);
            console.error('Download info fetch critical error:', error);
        }
    }
}

// --- Real Download Function ---
async function startRealDownload(card, link, resolution, format) {
    const API_URL = 'http://127.0.0.1:5000';
    const progressBar = card.querySelector('.progress-bar');
    const progressText = card.querySelector('.progress-text');

    // Visually set to downloading state
    progressText.textContent = `20% - Connecting to stream...`;
    progressBar.style.width = '20%';
    card.classList.remove('failed', 'completed');

    try {
        // Since Flask downloads synchronously, the progress bar won't update in real-time.
        const downloadSim = setTimeout(() => {
            if (!card.classList.contains('completed') && !card.classList.contains('failed')) {
                progressText.textContent = `50% - Downloading file from server (this may take a minute)...`;
                progressBar.style.width = '50%';
            }
        }, 1000);

        // 1. Call the API
        const response = await fetch(`${API_URL}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link, resolution, format })
        });

        clearTimeout(downloadSim); // Clear simulation once download response starts

        if (response.ok) {
            // 2. Extract filename from headers for the browser
            const contentDisposition = response.headers.get('Content-Disposition');
            const match = contentDisposition && contentDisposition.match(/filename="(.+?)"/);
            const filename = match ? match[1] : `download_${Date.now()}.${format}`;

            // 3. Create a blob from the response and trigger download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();

            window.URL.revokeObjectURL(url);

            // 4. Update UI to completion
            progressBar.style.width = '100%';
            card.classList.add('completed');
            progressText.innerHTML = `100% - **Download Complete!** (${filename}) - Auto-download started.`;

        } else {
            // Handle server-side errors (400, 404, 500)
            const errorData = await response.json();
            const errorMessage = errorData.error || response.statusText;
            updateDownloadCardError(card, `Download Error: ${errorMessage}`);
            displayMessage(`Download failed: ${errorMessage}`);
        }

    } catch (error) {
        updateDownloadCardError(card, `A critical error occurred: ${error.message}`);
        displayMessage(`Critical download error: ${error.message}`);
        console.error('Critical Download error:', error);
    }
}

// --- Helper function to create the Glass Card ---
function createDownloadCard(link, resolution, format) {
    const card = document.createElement('div');
    card.className = 'download-card glass-effect';

    // Initial structure without title/thumbnail
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
            <div class="progress-bar" style="width: 5%;"></div>
        </div>
        <p class="progress-text">5% - Initializing task...</p>
    `;
    return card;
}

// --- Helper function to update card with fetched info ---
function updateDownloadCardInfo(card, title, thumbnailUrl) {
    card.querySelector('.title').textContent = title;
    card.querySelector('.title').classList.remove('loading-text');
    card.querySelector('.thumbnail').src = thumbnailUrl;
    card.querySelector('.thumbnail').alt = title;
}

// --- Helper function to update card on error ---
function updateDownloadCardError(card, message) {
    card.classList.add('failed');
    card.querySelector('.progress-bar').style.width = '100%';
    card.querySelector('.progress-text').innerHTML = `**Error:** ${message}`;
    card.querySelector('.title').textContent = 'Download Failed';
    card.querySelector('.thumbnail').src = 'https://placehold.co/120x68/cc0000/ffffff?text=ERROR';
}


// --- Playlist Download Function ---
async function startPlaylistDownload() {
    const playlistLink = document.getElementById('playlist-link').value.trim();
    const resolution = document.getElementById('playlist-resolution-select').value;
    const format = document.getElementById('playlist-format-select').value;
    const statusArea = document.getElementById('playlist-status');
    const API_URL = 'http://127.0.0.1:5000';

    if (playlistLink.length === 0) {
        displayMessage("Please paste a playlist link.");
        return;
    }

    // 1. Create the initial status card
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
    // Clear previous status and add new card
    if (statusArea.querySelector('.playlist-card')) {
        statusArea.querySelector('.playlist-card').remove();
    }
    statusArea.appendChild(card);

    try {
        // 2. Call the API
        const response = await fetch(`${API_URL}/api/download/playlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: playlistLink, resolution, format })
        });

        const data = await response.json();

        if (response.ok) {
            // Update card with real info
            card.querySelector('.title').textContent = `Playlist: ${data.playlist_title}`;
            card.querySelector('.progress-text').textContent = `10% - Server accepted task. Queuing ${data.videos_queued} videos.`;
            card.querySelector('.progress-bar').style.width = '10%';

            // Start Mock Playlist Progress
            mockPlaylistDownload(card, data.videos_queued);
        } else {
            // Handle error response (e.g., if link is invalid or server-side error)
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

// --- Mock Playlist Progress Bar Function (Updated to use dynamic count) ---
function mockPlaylistDownload(card, totalVideos) {
    const progressBar = card.querySelector('.progress-bar');
    const progressText = card.querySelector('.progress-text');
    const note = card.querySelector('#playlist-note');
    let progress = 10; // Start at 10% after queuing
    let downloadedCount = 0;

    const interval = setInterval(() => {

        if (downloadedCount < totalVideos) {
            downloadedCount++;
            // Calculate progress based on video count, leaving 10% for zipping
            progress = 10 + Math.floor((downloadedCount / totalVideos) * 80);

            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}% - Downloading Video ${downloadedCount} of ${totalVideos}...`;
            note.textContent = `Processing video ${downloadedCount} (Simulated)`;
        } else if (progress < 100) {
            // Simulate zipping/finalizing step
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
    }, 1500); // Slower interval for playlist simulation
}


// Ensure textarea adjusts on page load if content exists (for robustness)
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('video-links');
    if (textarea) {
        autoAdjustTextarea(textarea);
    }
});
