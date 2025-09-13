const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { GeminiService } = require('../../services/geminiService');
const OMRService = require('../../services/omrService');
const { FillBlanksService } = require('../../services/fillBlanksService');

const router = express.Router();

// Initialize services
const geminiService = new GeminiService();
const omrService = new OMRService();
const fillBlanksService = require('../../services/fillBlanksService');

// Configure multer for memory storage (admin uploads - no local storage)
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit per file
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

// Support multiple files (up to 10 pages)
const uploadMultiple = upload.array('papers', 10);

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
      GROUP BY p.id, p.name, p.admin_id, p.uploaded_at, p.total_pages, p.question_type
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
      SELECT p.id, p.name, p.uploaded_at, p.total_pages, p.question_type, COUNT(q.id) as question_count 
      FROM papers p 
      LEFT JOIN questions q ON p.id = q.paper_id 
      GROUP BY p.id, p.name, p.uploaded_at, p.total_pages, p.question_type
      ORDER BY p.uploaded_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching public papers:', error);
    res.status(500).json({ error: 'Failed to fetch papers' });
  }
});

// Upload new paper
router.post('/upload', verifyToken, uploadMultiple, async (req, res) => {
  try {
    const { name } = req.body;
    const files = req.files;

    if (!name) {
      return res.status(400).json({ error: 'Paper name is required' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'At least one paper image is required' });
    }

    console.log(`Starting multi-page paper upload and processing... (${files.length} pages)`);
    console.log('Processing files from memory buffers');

    let allQuestions = [];
    let totalQuestionsFound = 0;
    let questionTypes = []; // Track question type for each page

    // Process each page
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`📄 Processing page ${i + 1}/${files.length}...`);

      // First, detect question format (OMR, traditional, fill-blanks)
      const omrStyleDetection = await omrService.detectOMRStyle(file.buffer);
      const fillBlanksDetection = await fillBlanksService.detectFillBlanksStyle(file.buffer);
      
      let pageQuestionType = 'traditional';
      if (fillBlanksDetection.hasFillBlanks && fillBlanksDetection.confidence > 0.7) {
        pageQuestionType = 'fill_blanks';
      } else if (omrStyleDetection.question_type === 'omr') {
        pageQuestionType = 'omr';
      }
      
      questionTypes.push(pageQuestionType);
      
      console.log(`🔍 Page ${i + 1} detected as: ${pageQuestionType} (OMR confidence: ${omrStyleDetection.confidence}, Fill-blanks confidence: ${fillBlanksDetection.confidence || 0})`);

      let pageQuestions = [];

      // Extract questions based on detected type
      if (pageQuestionType === 'fill_blanks') {
        // Extract fill-in-the-blanks questions
        const fillBlanksResult = await fillBlanksService.extractFillBlanksFromBuffer(file.buffer);
        if (fillBlanksResult.success && fillBlanksResult.questions.length > 0) {
          pageQuestions = fillBlanksResult.questions.map(q => ({
            number: q.number,
            text: q.text,
            correctAnswer: null, // Fill-blanks don't have single correct answers
            options: null, // Fill-blanks don't have options
            questionFormat: 'fill_blanks',
            blankPositions: q.blankPositions,
            totalPoints: q.totalPoints || 1
          }));
        }
      } else {
        // Extract traditional/OMR questions using existing Gemini service
        const geminiResult = await geminiService.extractQuestionPaperFromBuffer(file.buffer);
        if (geminiResult.success && geminiResult.questions.length > 0) {
          pageQuestions = geminiResult.questions.map(q => ({
            number: q.number,
            text: q.text,
            correctAnswer: q.correctAnswer,
            options: q.options, // Always use the real extracted options from Gemini
            questionFormat: 'multiple_choice',
            blankPositions: null,
            totalPoints: 1
          }));
        }
      }

      if (pageQuestions.length > 0) {
        // Adjust question numbers to continue from previous pages
        const adjustedQuestions = pageQuestions.map(q => ({
          ...q,
          number: q.number + totalQuestionsFound,
          page: i + 1, // Track which page this question came from
          questionType: pageQuestionType // Add question type
        }));

        allQuestions = [...allQuestions, ...adjustedQuestions];
        totalQuestionsFound += pageQuestions.length;
        
        console.log(`✓ Page ${i + 1}: Found ${pageQuestions.length} questions (${pageQuestionType})`);
      } else {
        console.log(`⚠️ Page ${i + 1}: No questions found`);
      }
    }

    if (allQuestions.length === 0) {
      return res.status(400).json({ 
        error: 'No questions found in any of the uploaded pages. Please ensure the question papers are clear and contain multiple choice questions with marked correct answers.' 
      });
    }

    console.log(`📊 Total questions found across all pages: ${allQuestions.length}`);

    // Determine overall question type for the paper
    const hasOMR = questionTypes.includes('omr');
    const hasTraditional = questionTypes.includes('traditional');
    const hasFillBlanks = questionTypes.includes('fill_blanks');
    let overallQuestionType = 'traditional';
    
    if ((hasOMR && hasTraditional) || (hasOMR && hasFillBlanks) || (hasTraditional && hasFillBlanks)) {
      overallQuestionType = 'mixed';
    } else if (hasOMR) {
      overallQuestionType = 'omr';
    } else if (hasFillBlanks) {
      overallQuestionType = 'fill_blanks';
    }

    console.log(`📝 Overall question type determined: ${overallQuestionType}`);

    // Insert paper into database with question type
    const paperResult = await pool.query(
      'INSERT INTO papers (name, admin_id, total_pages, question_type) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, req.admin.id, files.length, overallQuestionType]
    );

    const paper = paperResult.rows[0];

    // Insert extracted questions and correct answers
    for (const question of allQuestions) {
      // Set options based on question format
      let options = null;
      if (question.questionFormat === 'multiple_choice') {
        // Use the real extracted options from Gemini, converting to uppercase keys
        if (question.options && typeof question.options === 'object') {
          // Convert lowercase keys (a, b, c, d) to uppercase (A, B, C, D) while preserving the real text
          options = {};
          Object.entries(question.options).forEach(([key, value]) => {
            const upperKey = key.toUpperCase();
            options[upperKey] = value; // Keep the real extracted option text
          });
        }
      }
      
      await pool.query(
        `INSERT INTO questions 
         (paper_id, question_number, question_text, correct_option, page_number, question_type, options, question_format, blank_positions, points_per_blank) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          paper.id, 
          question.number, 
          question.text, 
          question.correctAnswer ? question.correctAnswer.toUpperCase() : null, // Convert to uppercase
          question.page, 
          question.questionType,
          JSON.stringify(options),
          question.questionFormat || 'multiple_choice',
          question.blankPositions ? JSON.stringify(question.blankPositions) : null,
          question.totalPoints || 1
        ]
      );
    }

    console.log(`Paper uploaded successfully with ${allQuestions.length} questions across ${files.length} pages`);

    res.json({
      message: 'Multi-page paper uploaded and processed successfully',
      paper: paper,
      totalPages: files.length,
      extractedQuestions: allQuestions.length,
      questionType: overallQuestionType,
      questionTypeByPage: questionTypes,
      questionsPerPage: files.map((_, index) => {
        const pageQuestions = allQuestions.filter(q => q.page === index + 1);
        return {
          page: index + 1,
          questions: pageQuestions.length,
          type: questionTypes[index],
          preview: pageQuestions.slice(0, 2).map(q => ({
            question: q.number,
            text: q.text.substring(0, 100) + '...',
            correctAnswer: q.correctAnswer,
            type: q.questionType
          }))
        };
      })
    });

  } catch (error) {
    console.error('Error uploading multi-page paper:', error);
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

// Delete paper (admin only - requires authentication)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const paperId = req.params.id;

    // Check if paper exists
    const paperResult = await pool.query('SELECT * FROM papers WHERE id = $1', [paperId]);
    
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    // Delete related data in the correct order (due to foreign key constraints)
    
    // First, delete student answers that reference the submissions
    await pool.query(`
      DELETE FROM student_answers 
      WHERE submission_id IN (
        SELECT id FROM student_submissions WHERE paper_id = $1
      )
    `, [paperId]);
    
    // Then delete student submissions
    await pool.query('DELETE FROM student_submissions WHERE paper_id = $1', [paperId]);
    
    // Then delete questions
    await pool.query('DELETE FROM questions WHERE paper_id = $1', [paperId]);
    
    // Finally delete the paper
    await pool.query('DELETE FROM papers WHERE id = $1', [paperId]);

    console.log(`Paper with ID ${paperId} deleted successfully`);
    res.json({ message: 'Paper and all related data deleted successfully' });
  } catch (error) {
    console.error('Error deleting paper:', error);
    res.status(500).json({ error: 'Failed to delete paper' });
  }
});

module.exports = router;