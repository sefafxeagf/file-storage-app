let currentPath = '';
let selectedFiles = new Set();

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadFiles();
    calculateStorage();
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
                    </button>` : ''
                }
                <button class="action-btn" onclick="deleteFile('${file.path}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        filesList.appendChild(fileItem);
    });
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

// Upload files
async function uploadFiles() {
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;
    
    if (files.length === 0) return;
    
    const progressDiv = document.getElementById('uploadProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    progressDiv.style.display = 'block';
    
    for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('file', files[i]);
        formData.append('folderPath', currentPath);
        
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            // Update progress
            const progress = Math.round(((i + 1) / files.length) * 100);
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}% (${i + 1}/${files.length})`;
            
        } catch (error) {
            console.error('Upload error:', error);
            alert(`Error uploading ${files[i].name}`);
        }
    }
    
    // Hide progress bar after 2 seconds and refresh files
    setTimeout(() => {
        progressDiv.style.display = 'none';
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        loadFiles(currentPath);
        calculateStorage();
        fileInput.value = ''; // Reset file input
    }, 2000);
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
            calculateStorage();
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
    calculateStorage();
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

// Calculate storage usage
async function calculateStorage() {
    try {
        const response = await fetch('/api/files');
        const data = await response.json();
        
        if (data.success) {
            const totalSize = calculateFolderSize(data.files);
            const storageFill = document.getElementById('storageFill');
            const storageText = document.getElementById('storageText');
            
            // For demo purposes, using 10GB as max storage
            const maxStorage = 10 * 1024 * 1024 * 1024; // 10GB in bytes
            const percentage = Math.min((totalSize / maxStorage) * 100, 100);
            
            storageFill.style.width = `${percentage}%`;
            storageText.textContent = `${formatFileSize(totalSize)} / 10 GB`;
        }
    } catch (error) {
        console.error('Error calculating storage:', error);
    }
}

function calculateFolderSize(files) {
    let totalSize = 0;
    
    files.forEach(file => {
        if (!file.isDirectory && file.size) {
            totalSize += file.size;
        }
    });
    
    return totalSize;
}

// Helper functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
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