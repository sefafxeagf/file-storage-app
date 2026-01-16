const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const archiver = require('archiver');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Configure upload directory for Railway
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const folderPath = req.body.currentPath || '';
      const fullPath = path.join(uploadDir, folderPath);
      fs.ensureDirSync(fullPath);
      cb(null, fullPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    try {
      const folderPath = req.body.currentPath || '';
      const fullPath = path.join(uploadDir, folderPath);
      
      // Sanitize filename
      const originalName = path.parse(file.originalname).name;
      const ext = path.parse(file.originalname).ext;
      const sanitizedOriginalName = originalName.replace(/[<>:"/\\|?*]/g, '_');
      let filename = sanitizedOriginalName + ext;
      let counter = 1;
      
      // Handle duplicate filenames
      while (fs.existsSync(path.join(fullPath, filename))) {
        filename = `${sanitizedOriginalName} (${counter})${ext}`;
        counter++;
      }
      
      cb(null, filename);
    } catch (error) {
      cb(error);
    }
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
    files: 50 // Maximum 50 files at once
  },
  fileFilter: (req, file, cb) => {
    // Optional: Add file type filtering
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'application/pdf',
      'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'video/mp4', 'audio/mpeg', 'application/zip', 'application/x-rar-compressed'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

// Improved error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 100MB' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: 'Too many files. Maximum is 50 files' });
    }
  }
  console.error('Server error:', error);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Routes

// Get files with improved error handling and search capabilities
app.get('/api/files', (req, res) => {
  try {
    const basePath = req.query.path || '';
    const fullPath = path.join(uploadDir, basePath);
    
    // Security check: prevent directory traversal
    const normalizedBasePath = path.normalize(basePath);
    if (normalizedBasePath.startsWith('..') || path.isAbsolute(normalizedBasePath)) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return res.json({ success: true, files: [], currentPath: basePath, parentPath: getParentPath(basePath) });
    }
    
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, message: 'Path is not a directory' });
    }
    
    const items = fs.readdirSync(fullPath);
    const result = items.map(item => {
      const itemPath = path.join(fullPath, item);
      try {
        const stat = fs.statSync(itemPath);
        const isDirectory = stat.isDirectory();
        
        return {
          name: item,
          path: path.join(basePath, item).replace(/\\/g, '/'),
          isDirectory: isDirectory,
          size: isDirectory ? null : stat.size,
          formattedSize: isDirectory ? null : formatBytes(stat.size),
          mimeType: isDirectory ? null : mime.lookup(item) || 'application/octet-stream',
          created: stat.birthtime,
          modified: stat.mtime,
          canRead: true,
          canWrite: true
        };
      } catch (error) {
        console.error(`Error reading ${itemPath}:`, error);
        return null;
      }
    }).filter(item => item !== null);
    
    // Sort: folders first, then files
    result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    
    res.json({ 
      success: true, 
      files: result, 
      currentPath: basePath,
      parentPath: getParentPath(basePath),
      totalItems: result.length,
      totalSize: result.reduce((sum, item) => sum + (item.size || 0), 0)
    });
  } catch (error) {
    console.error('Error reading files:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper function to get parent path
function getParentPath(currentPath) {
  if (!currentPath) return null;
  const normalized = path.normalize(currentPath);
  const parent = path.dirname(normalized);
  return parent === '.' ? '' : parent.replace(/\\/g, '/');
}

// Helper function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Upload single or multiple files with progress tracking support
app.post('/api/upload', upload.array('files'), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No files uploaded' 
      });
    }
    
    const uploadedFiles = req.files.map(file => ({
      originalName: file.originalname,
      savedName: file.filename,
      size: file.size,
      path: path.relative(uploadDir, file.path).replace(/\\/g, '/'),
      mimetype: file.mimetype,
      url: `/uploads/${path.relative(uploadDir, file.path).replace(/\\/g, '/')}`
    }));
    
    res.json({ 
      success: true, 
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      files: uploadedFiles,
      count: uploadedFiles.length,
      totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0)
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upload folder with its structure
app.post('/api/upload-folder', async (req, res) => {
  try {
    const { folderData, currentPath } = req.body;
    
    if (!folderData || !folderData.name) {
      return res.status(400).json({ success: false, message: 'Invalid folder data' });
    }
    
    // Sanitize folder name
    const sanitizedName = folderData.name.replace(/[<>:"/\\|?*]/g, '_');
    const targetPath = path.join(uploadDir, currentPath || '', sanitizedName);
    
    // Check if folder already exists
    if (fs.existsSync(targetPath)) {
      return res.status(409).json({ success: false, message: 'Folder already exists' });
    }
    
    // Create the main folder
    fs.ensureDirSync(targetPath);
    
    // Process folder contents recursively
    await processFolderContents(folderData, targetPath);
    
    res.json({ 
      success: true, 
      message: 'Folder uploaded successfully',
      path: path.relative(uploadDir, targetPath).replace(/\\/g, '/'),
      name: sanitizedName
    });
  } catch (error) {
    console.error('Error uploading folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

async function processFolderContents(folderData, targetPath) {
  // Process files in the folder
  if (folderData.files && Array.isArray(folderData.files)) {
    for (const file of folderData.files) {
      if (file.name && file.content) {
        try {
          // Sanitize filename
          const sanitizedName = file.name.replace(/[<>:"/\\|?*]/g, '_');
          const filePath = path.join(targetPath, sanitizedName);
          
          // Handle duplicate filenames
          let finalName = sanitizedName;
          let counter = 1;
          while (fs.existsSync(path.join(targetPath, finalName))) {
            const ext = path.parse(sanitizedName).ext;
            const name = path.parse(sanitizedName).name;
            finalName = `${name} (${counter})${ext}`;
            counter++;
          }
          
          const finalPath = path.join(targetPath, finalName);
          const buffer = Buffer.from(file.content, 'base64');
          await fs.writeFile(finalPath, buffer);
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          // Continue with other files
        }
      }
    }
  }
  
  // Process subfolders recursively
  if (folderData.folders && Array.isArray(folderData.folders)) {
    for (const subfolder of folderData.folders) {
      if (subfolder.name) {
        try {
          // Sanitize folder name
          const sanitizedName = subfolder.name.replace(/[<>:"/\\|?*]/g, '_');
          const subfolderPath = path.join(targetPath, sanitizedName);
          
          // Handle duplicate folder names
          let finalFolderName = sanitizedName;
          let counter = 1;
          while (fs.existsSync(path.join(targetPath, finalFolderName))) {
            finalFolderName = `${sanitizedName} (${counter})`;
            counter++;
          }
          
          const finalFolderPath = path.join(targetPath, finalFolderName);
          fs.ensureDirSync(finalFolderPath);
          await processFolderContents(subfolder, finalFolderPath);
        } catch (error) {
          console.error(`Error processing folder ${subfolder.name}:`, error);
          // Continue with other folders
        }
      }
    }
  }
}

// Create folder
app.post('/api/folder', (req, res) => {
  try {
    const { folderName, currentPath } = req.body;
    
    if (!folderName || folderName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Folder name is required' });
    }
    
    // Sanitize folder name
    const sanitizedName = folderName.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (sanitizedName === '') {
      return res.status(400).json({ success: false, message: 'Invalid folder name' });
    }
    
    const folderPath = path.join(uploadDir, currentPath || '', sanitizedName);
    
    if (fs.existsSync(folderPath)) {
      return res.status(409).json({ success: false, message: 'Folder already exists' });
    }
    
    fs.ensureDirSync(folderPath);
    res.json({ 
      success: true, 
      message: 'Folder created successfully',
      name: sanitizedName,
      path: path.relative(uploadDir, folderPath).replace(/\\/g, '/')
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete file or folder
app.delete('/api/delete', (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'File path is required' });
    }
    
    const fullPath = path.join(uploadDir, filePath);
    
    // Security check
    if (!fullPath.startsWith(uploadDir)) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: 'File/folder not found' });
    }
    
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Check if directory is empty
      const items = fs.readdirSync(fullPath);
      if (items.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Folder is not empty. Delete contents first or use force delete.',
          isEmpty: false
        });
      }
      fs.removeSync(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
    
    res.json({ 
      success: true, 
      message: 'Deleted successfully',
      path: filePath
    });
  } catch (error) {
    console.error('Error deleting:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Force delete (including non-empty folders)
app.delete('/api/delete-force', (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'File path is required' });
    }
    
    const fullPath = path.join(uploadDir, filePath);
    
    // Security check
    if (!fullPath.startsWith(uploadDir)) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: 'File/folder not found' });
    }
    
    fs.removeSync(fullPath);
    
    res.json({ 
      success: true, 
      message: 'Deleted successfully',
      path: filePath
    });
  } catch (error) {
    console.error('Error force deleting:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Download file
app.get('/api/download', (req, res) => {
  try {
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).send('File path is required');
    }
    
    const fullPath = path.join(uploadDir, filePath);
    
    // Security check
    if (!fullPath.startsWith(uploadDir)) {
      return res.status(400).send('Invalid path');
    }
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('File not found');
    }
    
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      return res.status(400).send('Cannot download folder directly. Use /api/download-folder instead.');
    }
    
    // Set appropriate headers
    const filename = path.basename(fullPath);
    const mimeType = mime.lookup(filename) || 'application/octet-stream';
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', stat.size);
    
    // Stream the file
    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).send('Error streaming file');
      }
    });
  } catch (error) {
    console.error('Error downloading:', error);
    if (!res.headersSent) {
      res.status(500).send('Error downloading file');
    }
  }
});

// Download folder as zip
app.get('/api/download-folder', async (req, res) => {
  try {
    const folderPath = req.query.path;
    
    if (!folderPath) {
      return res.status(400).send('Folder path is required');
    }
    
    const fullPath = path.join(uploadDir, folderPath);
    
    // Security check
    if (!fullPath.startsWith(uploadDir)) {
      return res.status(400).send('Invalid path');
    }
    
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      return res.status(404).send('Folder not found');
    }
    
    const folderName = path.basename(fullPath) || 'download';
    const zipFilename = `${folderName}.zip`;
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFilename)}"`);
    
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });
    
    archive.on('error', (error) => {
      console.error('Error creating zip:', error);
      if (!res.headersSent) {
        res.status(500).send('Error creating zip file');
      }
    });
    
    // Pipe archive to response
    archive.pipe(res);
    
    // Add directory to archive
    archive.directory(fullPath, folderName);
    
    // Finalize archive
    await archive.finalize();
    
  } catch (error) {
    console.error('Error preparing folder download:', error);
    if (!res.headersSent) {
      res.status(500).send('Error preparing folder download');
    }
  }
});

// Rename file or folder
app.put('/api/rename', (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    
    if (!oldPath || !newName || newName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Old path and new name are required' });
    }
    
    // Sanitize new name
    const sanitizedNewName = newName.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (sanitizedNewName === '') {
      return res.status(400).json({ success: false, message: 'Invalid new name' });
    }
    
    const oldFullPath = path.join(uploadDir, oldPath);
    const newFullPath = path.join(path.dirname(oldFullPath), sanitizedNewName);
    
    // Security checks
    if (!oldFullPath.startsWith(uploadDir) || !newFullPath.startsWith(uploadDir)) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }
    
    if (!fs.existsSync(oldFullPath)) {
      return res.status(404).json({ success: false, message: 'File/folder not found' });
    }
    
    if (fs.existsSync(newFullPath)) {
      return res.status(409).json({ success: false, message: 'A file/folder with the new name already exists' });
    }
    
    fs.renameSync(oldFullPath, newFullPath);
    
    res.json({ 
      success: true, 
      message: 'Renamed successfully',
      oldPath: oldPath,
      newPath: path.relative(uploadDir, newFullPath).replace(/\\/g, '/'),
      newName: sanitizedNewName
    });
  } catch (error) {
    console.error('Error renaming:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get file info
app.get('/api/file-info', (req, res) => {
  try {
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'File path is required' });
    }
    
    const fullPath = path.join(uploadDir, filePath);
    
    // Security check
    if (!fullPath.startsWith(uploadDir)) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: 'File/folder not found' });
    }
    
    const stat = fs.statSync(fullPath);
    const isDirectory = stat.isDirectory();
    
    const info = {
      name: path.basename(fullPath),
      path: filePath,
      isDirectory: isDirectory,
      size: isDirectory ? null : stat.size,
      formattedSize: isDirectory ? null : formatBytes(stat.size),
      created: stat.birthtime,
      modified: stat.mtime,
      accessed: stat.atime,
      mimeType: isDirectory ? null : mime.lookup(fullPath) || 'application/octet-stream',
      permissions: {
        canRead: true,
        canWrite: true,
        canExecute: false
      }
    };
    
    if (isDirectory) {
      const items = fs.readdirSync(fullPath);
      info.itemCount = items.length;
      info.containsFiles = items.some(item => {
        const itemPath = path.join(fullPath, item);
        return fs.statSync(itemPath).isFile();
      });
      info.containsFolders = items.some(item => {
        const itemPath = path.join(fullPath, item);
        return fs.statSync(itemPath).isDirectory();
      });
    }
    
    res.json({ success: true, info: info });
  } catch (error) {
    console.error('Error getting file info:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    uploadDir: uploadDir,
    exists: fs.existsSync(uploadDir),
    writable: (() => {
      try {
        const testFile = path.join(uploadDir, '.healthcheck');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
      } catch {
        return false;
      }
    })(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    }
  };
  
  res.json(health);
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log(` File Storage App is running!`);
  console.log(`Port: ${PORT}`);
  console.log(`Upload directory: ${uploadDir}`);
  console.log(`Server time: ${new Date().toLocaleString()}`);
  console.log('='.repeat(60));
});