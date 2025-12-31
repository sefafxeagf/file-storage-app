const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure upload directory for Railway
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Use the current path from the request body
    const folderPath = req.body.currentPath || '';
    const fullPath = path.join(uploadDir, folderPath);
    fs.ensureDirSync(fullPath);
    cb(null, fullPath);
  },
  filename: function (req, file, cb) {
    const folderPath = req.body.currentPath || '';
    const fullPath = path.join(uploadDir, folderPath);
    
    // Handle duplicate filenames
    const originalName = path.parse(file.originalname).name;
    const ext = path.parse(file.originalname).ext;
    let filename = file.originalname;
    let counter = 1;
    
    while (fs.existsSync(path.join(fullPath, filename))) {
      filename = `${originalName} (${counter})${ext}`;
      counter++;
    }
    
    cb(null, filename);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit per file
});

// Routes
app.get('/api/files', (req, res) => {
  const basePath = req.query.path || '';
  const fullPath = path.join(uploadDir, basePath);
  
  try {
    if (!fs.existsSync(fullPath)) {
      return res.json({ success: false, message: 'Path not found' });
    }
    
    const items = fs.readdirSync(fullPath);
    const result = items.map(item => {
      const itemPath = path.join(fullPath, item);
      const isDirectory = fs.statSync(itemPath).isDirectory();
      
      return {
        name: item,
        path: path.join(basePath, item).replace(/\\/g, '/'),
        isDirectory: isDirectory,
        size: isDirectory ? null : fs.statSync(itemPath).size,
        created: fs.statSync(itemPath).birthtime
      };
    });
    
    // Sort: folders first, then files
    result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({ success: true, files: result, currentPath: basePath });
  } catch (error) {
    console.error('Error reading files:', error);
    res.json({ success: false, message: error.message });
  }
});

// Upload single or multiple files
app.post('/api/upload', upload.array('files'), (req, res) => {
  console.log('Uploaded files:', req.files);
  console.log('Current path:', req.body.currentPath);
  
  res.json({ 
    success: true, 
    message: 'Files uploaded successfully',
    files: req.files,
    count: req.files.length
  });
});

// Upload folder with its structure
app.post('/api/upload-folder', async (req, res) => {
  try {
    const { folderData, currentPath } = req.body;
    
    if (!folderData || !folderData.name) {
      return res.json({ success: false, message: 'Invalid folder data' });
    }
    
    const targetPath = path.join(uploadDir, currentPath || '', folderData.name);
    
    // Create the main folder
    fs.ensureDirSync(targetPath);
    
    // Process folder contents recursively
    await processFolderContents(folderData, targetPath);
    
    res.json({ 
      success: true, 
      message: 'Folder uploaded successfully',
      path: targetPath
    });
  } catch (error) {
    console.error('Error uploading folder:', error);
    res.json({ success: false, message: error.message });
  }
});

async function processFolderContents(folderData, targetPath) {
  // Process files in the folder
  if (folderData.files && folderData.files.length > 0) {
    for (const file of folderData.files) {
      if (file.content) {
        // For demo: base64 encoded files
        const filePath = path.join(targetPath, file.name);
        const buffer = Buffer.from(file.content, 'base64');
        await fs.writeFile(filePath, buffer);
      }
    }
  }
  
  // Process subfolders recursively
  if (folderData.folders && folderData.folders.length > 0) {
    for (const subfolder of folderData.folders) {
      const subfolderPath = path.join(targetPath, subfolder.name);
      fs.ensureDirSync(subfolderPath);
      await processFolderContents(subfolder, subfolderPath);
    }
  }
}

// Create folder
app.post('/api/folder', (req, res) => {
  try {
    const { folderName, currentPath } = req.body;
    const folderPath = path.join(uploadDir, currentPath || '', folderName);
    
    if (fs.existsSync(folderPath)) {
      return res.json({ success: false, message: 'Folder already exists' });
    }
    
    fs.ensureDirSync(folderPath);
    res.json({ success: true, message: 'Folder created successfully' });
  } catch (error) {
    console.error('Error creating folder:', error);
    res.json({ success: false, message: error.message });
  }
});

// Delete file or folder
app.delete('/api/delete', (req, res) => {
  try {
    const { filePath } = req.body;
    const fullPath = path.join(uploadDir, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.json({ success: false, message: 'File/folder not found' });
    }
    
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      fs.removeSync(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
    
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    console.error('Error deleting:', error);
    res.json({ success: false, message: error.message });
  }
});

// Download file
app.get('/api/download', (req, res) => {
  try {
    const filePath = req.query.path;
    const fullPath = path.join(uploadDir, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('File not found');
    }
    
    if (fs.statSync(fullPath).isDirectory()) {
      return res.status(400).send('Cannot download folder directly');
    }
    
    res.download(fullPath);
  } catch (error) {
    console.error('Error downloading:', error);
    res.status(500).send('Error downloading file');
  }
});

// Download folder as zip
app.get('/api/download-folder', async (req, res) => {
  try {
    const folderPath = req.query.path;
    const fullPath = path.join(uploadDir, folderPath);
    
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      return res.status(404).send('Folder not found');
    }
    
    // For now, we'll just redirect to a message
    // In a real implementation, you'd use archiver or similar
    res.json({ 
      success: true, 
      message: 'Folder download requires additional setup',
      path: folderPath 
    });
  } catch (error) {
    console.error('Error preparing folder download:', error);
    res.status(500).send('Error preparing folder download');
  }
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    uploadDir: uploadDir
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log(` File Storage App is running!`);
  console.log(`Port: ${PORT}`);
  console.log(`Upload directory: ${uploadDir}`);
});