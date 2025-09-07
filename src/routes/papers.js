const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { AzureOCRService } = require('../../services/azureOcrService');

const router = express.Router();

// Initialize Azure OCR service
const azureOCR = new AzureOCRService();

// Configure multer for file uploads (save to disk for Tesseract)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'paper-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'));
    }
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// Get all papers
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, COUNT(q.id)::integer as question_count 
      FROM papers p 
      LEFT JOIN questions q ON p.id = q.paper_id 
      GROUP BY p.id 
      ORDER BY p.uploaded_at DESC
    `);
    
    console.log('Papers API called - returning:', JSON.stringify(result.rows, null, 2));
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching papers:', error);
    res.status(500).json({ error: 'Failed to fetch papers' });
  }
});

// Upload new paper
router.post('/upload', verifyToken, upload.single('paper'), async (req, res) => {
  try {
    const { name } = req.body;
    const file = req.file;

    if (!name) {
      return res.status(400).json({ error: 'Paper name is required' });
    }

    if (!file) {
      return res.status(400).json({ error: 'Paper image is required' });
    }

    console.log('Starting paper upload and Azure OCR processing...');
    console.log('File saved to:', file.path);

    // Extract text using Azure Computer Vision OCR
    const ocrResult = await azureOCR.processAnswerSheetFromImage(file.path);
    
    if (!ocrResult.success) {
      return res.status(500).json({ 
        error: 'OCR processing failed: ' + ocrResult.error 
      });
    }

    const questions = ocrResult.answers;
    const extractedText = ocrResult.text;

    // Check OCR effectiveness (Azure is generally much more effective)
    const ocrWasEffective = questions.length > 0 && ocrResult.confidence > 70;
    
    if (!ocrWasEffective) {
      console.log('Azure OCR had low confidence, may require manual verification...');
      console.log('OCR Confidence:', ocrResult.confidence + '%');
      console.log('Questions found:', questions.length);
      console.log('Text length:', extractedText.length);
    }

    // Insert paper into database
    const paperResult = await pool.query(
      'INSERT INTO papers (name, image_url, admin_id) VALUES ($1, $2, $3) RETURNING *',
      [name, file.path, req.admin.id]
    );

    const paper = paperResult.rows[0];

    // Only insert questions if OCR found answers
    if (ocrWasEffective && questions.length > 0) {
      for (const question of questions) {
        await pool.query(
          'INSERT INTO questions (paper_id, question_number, question_text, correct_option) VALUES ($1, $2, $3, $4)',
          [paper.id, question.question, `Question ${question.question}`, question.answer.toUpperCase()]
        );
      }
      
      console.log(`Paper uploaded successfully with ${questions.length} questions extracted via Azure OCR`);
      
      res.json({
        message: 'Paper uploaded and processed successfully with Azure OCR',
        paper: paper,
        extractedQuestions: questions.length,
        confidence: ocrResult.confidence,
        method: 'azure_ocr',
        ocrEffective: true
      });
    } else {
      console.log('Paper uploaded, OCR completed but may need manual verification');
      
      res.json({
        message: `Paper uploaded. Azure OCR processed with ${ocrResult.confidence}% confidence. ${questions.length} answers detected.`,
        paper: paper,
        extractedQuestions: questions.length,
        confidence: ocrResult.confidence,
        method: 'azure_ocr',
        ocrEffective: ocrWasEffective,
        extractedText: extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : '')
      });
    }

  } catch (error) {
    console.error('Error uploading paper:', error);
    res.status(500).json({ 
      error: 'Failed to upload paper: ' + error.message 
    });
  }
});

// Get paper details with questions
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const paperId = req.params.id;

    // Get paper details
    const paperResult = await pool.query('SELECT * FROM papers WHERE id = $1', [paperId]);
    
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    // Get questions for this paper
    const questionsResult = await pool.query(
      'SELECT * FROM questions WHERE paper_id = $1 ORDER BY question_number',
      [paperId]
    );

    const paper = paperResult.rows[0];
    paper.questions = questionsResult.rows;

    res.json(paper);
  } catch (error) {
    console.error('Error fetching paper details:', error);
    res.status(500).json({ error: 'Failed to fetch paper details' });
  }
});

module.exports = router;