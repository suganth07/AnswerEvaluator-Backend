const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { GeminiService } = require('../../services/geminiService');

const router = express.Router();

// Initialize Gemini service
const geminiService = new GeminiService();

// Configure multer for memory storage (admin uploads - no local storage)
const storage = multer.memoryStorage();

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

// Get all papers (admin only - requires authentication)
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, COUNT(q.id) as question_count 
      FROM papers p 
      LEFT JOIN questions q ON p.id = q.paper_id 
      GROUP BY p.id 
      ORDER BY p.uploaded_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching papers:', error);
    res.status(500).json({ error: 'Failed to fetch papers' });
  }
});

// Get all papers for students (public - no authentication required)
router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.uploaded_at, COUNT(q.id) as question_count 
      FROM papers p 
      LEFT JOIN questions q ON p.id = q.paper_id 
      GROUP BY p.id, p.name, p.uploaded_at 
      ORDER BY p.uploaded_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching public papers:', error);
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

    console.log('Starting paper upload and processing...');
    console.log('Processing file from memory buffer');

    // Extract questions using Gemini (from memory buffer)
    const geminiResult = await geminiService.extractQuestionPaperFromBuffer(file.buffer);

    if (!geminiResult.success || !geminiResult.questions || geminiResult.questions.length === 0) {
      return res.status(400).json({ 
        error: 'No questions found in the image. Please ensure the question paper is clear and contains multiple choice questions with marked correct answers.' 
      });
    }

    const questions = geminiResult.questions;

    // Insert paper into database (no image_url stored locally)
    const paperResult = await pool.query(
      'INSERT INTO papers (name, admin_id) VALUES ($1, $2) RETURNING *',
      [name, req.admin.id]
    );

    const paper = paperResult.rows[0];

    // Insert extracted questions and correct answers
    for (const question of questions) {
      await pool.query(
        'INSERT INTO questions (paper_id, question_number, question_text, correct_option) VALUES ($1, $2, $3, $4)',
        [paper.id, question.number, question.text, question.correctAnswer]
      );
    }

    console.log(`Paper uploaded successfully with ${questions.length} questions extracted`);

    res.json({
      message: 'Paper uploaded and processed successfully',
      paper: paper,
      extractedQuestions: questions.length,
      questionsPreview: questions.map(q => ({
        question: q.question,
        text: q.text.substring(0, 100) + '...',
        correctAnswer: q.correctAnswer
      }))
    });

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