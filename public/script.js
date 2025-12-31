let currentPath = '';
let selectedFiles = new Set();

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadFiles();
    setupDragAndDrop();
    setupFolderUpload();
});

// Load files from current directory
async function loadFiles(path = '') {
    try {
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        
        if (data.success) {
            currentPath = data.currentPath;
            displayFiles(data.files);
            updateBreadcrumb();
            updateUploadLocation();
        } else {
            alert('Error loading files: ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to load files');
    }
}

// Display files in the UI
function displayFiles(files) {
    const filesList = document.getElementById('filesList');
    
    if (files.length === 0) {
        filesList.innerHTML = '<div class="loading">No files or folders found</div>';
        return;
    }
    
    filesList.innerHTML = '';
    
    files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = `file-item ${file.isDirectory ? 'folder-item' : ''}`;
        fileItem.dataset.path = file.path;
        
        const size = file.isDirectory ? '--' : formatFileSize(file.size);
        const date = new Date(file.created).toLocaleDateString();
        
        fileItem.innerHTML = `
            <div class="file-checkbox">
                <input type="checkbox" onchange="toggleFileSelection('${file.path}', this.checked)">
            </div>
            <div class="file-name" ${file.isDirectory ? `onclick="navigateToFolder('${file.path}')"` : ''}>
                <i class="fas ${file.isDirectory ? 'fa-folder' : getFileIcon(file.name)} file-icon"></i>
                <span>${escapeHtml(file.name)}</span>
            </div>
            <div class="file-size">${size}</div>
            <div class="file-date">${date}</div>
            <div class="file-actions">
                ${!file.isDirectory ? 
                    `<button class="action-btn" onclick="downloadFile('${file.path}')" title="Download">
                        <i class="fas fa-download"></i>
                    </button>` : 
                    `<button class="action-btn" onclick="downloadFolder('${file.path}')" title="Download Folder">
                        <i class="fas fa-download"></i>
                    </button>`
                }
                <button class="action-btn" onclick="deleteFile('${file.path}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        filesList.appendChild(fileItem);
    });
}

// Setup drag and drop
function setupDragAndDrop() {
    const dropArea = document.querySelector('.files-container');
    
    dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('drag-over');
    });
    
    dropArea.addEventListener('dragleave', () => {
        dropArea.classList.remove('drag-over');
    });
    
    dropArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropArea.classList.remove('drag-over');
        
        const items = e.dataTransfer.items;
        const files = [];
        const folders = [];
        
        // Process dropped items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry && entry.isDirectory) {
                    folders.push(entry);
                } else {
                    files.push(item.getAsFile());
                }
            }
        }
        
        // Upload files
        if (files.length > 0) {
            await uploadFiles(files);
        }
        
        // Upload folders
        if (folders.length > 0) {
            for (const folder of folders) {
                await uploadFolder(folder);
            }
        }
    });
}

// Setup folder upload button
function setupFolderUpload() {
    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.id = 'folderInput';
    folderInput.webkitdirectory = true;
    folderInput.multiple = true;
    folderInput.style.display = 'none';
    folderInput.addEventListener('change', handleFolderUpload);
    document.body.appendChild(folderInput);
    
    // Add folder upload button to UI
    const uploadSection = document.querySelector('.upload-section');
    const folderUploadBtn = document.createElement('button');
    folderUploadBtn.className = 'btn btn-secondary';
    folderUploadBtn.innerHTML = '<i class="fas fa-folder"></i> Upload Folder';
    folderUploadBtn.onclick = () => folderInput.click();
    uploadSection.appendChild(folderUploadBtn);
}

// Handle folder upload
async function handleFolderUpload(e) {
    const entries = Array.from(e.target.files);
    
    if (entries.length === 0) return;
    
    // Get the folder name from the first file's path
    const firstFile = entries[0];
    const folderName = firstFile.webkitRelativePath.split('/')[0];
    
    // Group files by their relative paths
    const folderStructure = {
        name: folderName,
        files: [],
        folders: []
    };
    
    // For now, we'll upload files individually
    // In a real implementation, you'd create a zip or process recursively
    await uploadFiles(entries);
    
    // Clear the input
    e.target.value = '';
}

// Upload files (now includes current path)
async function uploadFiles(fileList) {
    if (fileList.length === 0) return;
    
    const progressDiv = document.getElementById('uploadProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    progressDiv.style.display = 'block';
    
    const formData = new FormData();
    formData.append('currentPath', currentPath);
    
    // Add all files to formData
    for (let i = 0; i < fileList.length; i++) {
        formData.append('files', fileList[i]);
    }
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            progressBar.style.width = '100%';
            progressText.textContent = `100% (${data.count} files uploaded)`;
            
            setTimeout(() => {
                progressDiv.style.display = 'none';
                progressBar.style.width = '0%';
                progressText.textContent = '0%';
                loadFiles(currentPath);
            }, 1500);
        } else {
            alert('Upload failed: ' + data.message);
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Error uploading files');
    }
}

// Upload folder recursively
async function uploadFolder(folderEntry) {
    const folderData = await readFolderEntries(folderEntry);
    
    try {
        const response = await fetch('/api/upload-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                folderData: folderData,
                currentPath: currentPath
            })
        });
        
        const data = await response.json();
        if (data.success) {
            loadFiles(currentPath);
        } else {
            alert('Error uploading folder: ' + data.message);
        }
    } catch (error) {
        console.error('Folder upload error:', error);
        alert('Failed to upload folder');
    }
}

// Read folder entries recursively
async function readFolderEntries(entry) {
    const result = {
        name: entry.name,
        files: [],
        folders: []
    };
    
    const reader = entry.createReader();
    
    return new Promise((resolve) => {
        reader.readEntries(async (entries) => {
            for (const childEntry of entries) {
                if (childEntry.isFile) {
                    // For files, we'd need to read them
                    // This is complex for large folders
                } else if (childEntry.isDirectory) {
                    const subfolder = await readFolderEntries(childEntry);
                    result.folders.push(subfolder);
                }
            }
            resolve(result);
        });
    });
}

// Update upload location display
function updateUploadLocation() {
    const locationElement = document.getElementById('uploadLocation');
    if (!locationElement) {
        // Create it if it doesn't exist
        const uploadSection = document.querySelector('.upload-section');
        const locationDiv = document.createElement('div');
        locationDiv.className = 'upload-location';
        locationDiv.id = 'uploadLocation';
        uploadSection.appendChild(locationDiv);
    }
    
    const locationText = currentPath ? `Uploading to: /${currentPath}` : 'Uploading to: Root';
    document.getElementById('uploadLocation').innerHTML = `
        <div class="location-info">
            <i class="fas fa-folder-open"></i>
            <span>${locationText}</span>
        </div>
    `;
}

// Navigate to folder
function navigateToFolder(folderPath) {
    loadFiles(folderPath);
}

// Update breadcrumb navigation
function updateBreadcrumb() {
    const pathNav = document.getElementById('pathNavigation');
    const parts = currentPath.split('/').filter(part => part !== '');
    
    let breadcrumb = '<div class="path-item" onclick="loadFiles(\'\')">Root</div>';
    
    let current = '';
    parts.forEach((part, index) => {
        current += (current ? '/' : '') + part;
        breadcrumb += `<span class="path-separator">/</span>
                      <div class="path-item" onclick="loadFiles('${current}')">${part}</div>`;
    });
    
    pathNav.innerHTML = breadcrumb;
}

// Create new folder
async function createFolder() {
    const folderName = prompt('Enter folder name:');
    if (!folderName || !folderName.trim()) return;
    
    try {
        const response = await fetch('/api/folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                folderName: folderName.trim(),
                currentPath: currentPath
            })
        });
        
        const data = await response.json();
        if (data.success) {
            loadFiles(currentPath);
        } else {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        alert('Failed to create folder');
    }
}

// Download file
function downloadFile(filePath) {
    window.open(`/api/download?path=${encodeURIComponent(filePath)}`, '_blank');
}

// Download folder
async function downloadFolder(folderPath) {
    try {
        const response = await fetch(`/api/download-folder?path=${encodeURIComponent(folderPath)}`);
        const data = await response.json();
        
        if (data.success) {
            // For now, show a message
            alert('Folder download feature requires additional setup. For now, you can navigate into the folder and download files individually.');
        }
    } catch (error) {
        alert('Failed to prepare folder download');
    }
}

// Delete file or folder
async function deleteFile(filePath) {
    if (!confirm('Are you sure you want to delete this?')) return;
    
    try {
        const response = await fetch('/api/delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filePath })
        });
        
        const data = await response.json();
        if (data.success) {
            loadFiles(currentPath);
            selectedFiles.delete(filePath);
            updateDeleteButton();
        } else {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        alert('Failed to delete');
    }
}

// Delete selected files
async function deleteSelected() {
    if (selectedFiles.size === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${selectedFiles.size} item(s)?`)) return;
    
    for (const filePath of selectedFiles) {
        try {
            await fetch('/api/delete', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filePath })
            });
        } catch (error) {
            console.error('Delete error:', error);
        }
    }
    
    selectedFiles.clear();
    loadFiles(currentPath);
    updateDeleteButton();
}

// File selection management
function toggleFileSelection(filePath, isSelected) {
    if (isSelected) {
        selectedFiles.add(filePath);
    } else {
        selectedFiles.delete(filePath);
        document.getElementById('selectAll').checked = false;
    }
    updateFileItemsSelection();
    updateDeleteButton();
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.file-item input[type="checkbox"]');
    
    if (selectAll.checked) {
        selectedFiles.clear();
        checkboxes.forEach(checkbox => {
            const filePath = checkbox.closest('.file-item').dataset.path;
            selectedFiles.add(filePath);
            checkbox.checked = true;
        });
    } else {
        selectedFiles.clear();
        checkboxes.forEach(checkbox => checkbox.checked = false);
    }
    
    updateFileItemsSelection();
    updateDeleteButton();
}

function updateFileItemsSelection() {
    document.querySelectorAll('.file-item').forEach(item => {
        const filePath = item.dataset.path;
        if (selectedFiles.has(filePath)) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

function updateDeleteButton() {
    const deleteBtn = document.getElementById('deleteBtn');
    deleteBtn.disabled = selectedFiles.size === 0;
    deleteBtn.innerHTML = `<i class="fas fa-trash"></i> Delete Selected (${selectedFiles.size})`;
}

// Refresh files
function refreshFiles() {
    loadFiles(currentPath);
}

// Helper functions
function formatFileSize(bytes) {
    if (bytes === 0 || !bytes) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'txt': 'fa-file-alt',
        'jpg': 'fa-file-image',
        'jpeg': 'fa-file-image',
        'png': 'fa-file-image',
        'gif': 'fa-file-image',
        'mp4': 'fa-file-video',
        'mp3': 'fa-file-audio',
        'zip': 'fa-file-archive',
        'rar': 'fa-file-archive'
    };
    
    return icons[ext] || 'fa-file';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}