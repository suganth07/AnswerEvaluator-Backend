
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
    const uploadDir = path.join(__dirname, '../../uploads/submissions');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'submission-' + uniqueSuffix + path.extname(file.originalname));
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

// Function to evaluate student answers against correct answers
const evaluateAnswers = (correctAnswers, studentAnswers) => {
  console.log('\n=== EVALUATION DEBUG ===');
  console.log('Correct answers received:', correctAnswers);
  console.log('Student answers received:', studentAnswers);
  
  const totalQuestions = correctAnswers.length;
  let score = 0;
  const answerResults = [];

  // Create a map of correct answers for quick lookup
  const correctAnswerMap = {};
  correctAnswers.forEach(q => {
    correctAnswerMap[q.question_number] = q.correct_option;
  });
  console.log('Correct answer map:', correctAnswerMap);

  // Create a map of student answers for quick lookup
  const studentAnswerMap = {};
  studentAnswers.forEach(a => {
    studentAnswerMap[a.question] = a.answer; // Changed from a.questionNumber and a.selectedOption
  });
  console.log('Student answer map:', studentAnswerMap);

  // Evaluate each question
  for (const correctAnswer of correctAnswers) {
    const questionNumber = correctAnswer.question_number;
    const correctOption = correctAnswer.correct_option;
    const studentOption = studentAnswerMap[questionNumber] || null;
    
    console.log(`Q${questionNumber}: Correct='${correctOption}', Student='${studentOption}'`);
    
    const isCorrect = studentOption && studentOption.toUpperCase() === correctOption.toUpperCase();
    if (isCorrect) score++;

    answerResults.push({
      questionNumber,
      correctOption,
      studentOption,
      isCorrect
    });
  }

  const percentage = (score / totalQuestions) * 100;
  console.log(`Final evaluation: ${score}/${totalQuestions} (${percentage}%)`);
  console.log('=== END EVALUATION DEBUG ===\n');

  return {
    score,
    totalQuestions,
    percentage,
    answerResults
  };
};

// Submit student answer sheet
router.post('/submit', upload.single('answerSheet'), async (req, res) => {
  try {
    const { paperId, studentName } = req.body;
    const file = req.file;

    if (!paperId || !studentName) {
      return res.status(400).json({ error: 'Paper ID and student name are required' });
    }

    if (!file) {
      return res.status(400).json({ error: 'Answer sheet image is required' });
    }

    console.log('Starting student answer sheet evaluation...');
    console.log('File saved to:', file.path);

    // Check if paper exists
    const paperResult = await pool.query('SELECT * FROM papers WHERE id = $1', [paperId]);
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    // Extract text from student's answer sheet using Azure Computer Vision OCR
    console.log('Processing student answer sheet with Azure OCR...');
    const ocrResult = await azureOCR.processAnswerSheetFromImage(file.path);
    
    if (!ocrResult.success) {
      return res.status(500).json({ 
        error: 'Failed to process answer sheet: ' + ocrResult.error 
      });
    }
    
    // Process the extracted text to find student's answers
    const studentAnswers = ocrResult.answers;

    // Get correct answers from database
    const questionsResult = await pool.query(
      'SELECT question_number, correct_option FROM questions WHERE paper_id = $1 ORDER BY question_number',
      [paperId]
    );

    const correctAnswers = questionsResult.rows;

    if (correctAnswers.length === 0) {
      return res.status(400).json({ error: 'No questions found for this paper' });
    }

    // Evaluate student answers against correct answers
    const evaluation = evaluateAnswers(correctAnswers, studentAnswers);

    // Insert submission into database
    const submissionResult = await pool.query(`
      INSERT INTO student_submissions (paper_id, student_name, image_url, score, total_questions, percentage) 
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [paperId, studentName, file.path, evaluation.score, evaluation.totalQuestions, evaluation.percentage]);

    const submission = submissionResult.rows[0];

    // Insert individual student answers
    for (const answerResult of evaluation.answerResults) {
      await pool.query(`
        INSERT INTO student_answers (submission_id, question_number, selected_option, is_correct) 
        VALUES ($1, $2, $3, $4)
      `, [submission.id, answerResult.questionNumber, answerResult.studentOption, answerResult.isCorrect]);
    }

    console.log(`Answer sheet evaluated: ${evaluation.score}/${evaluation.totalQuestions} (${evaluation.percentage.toFixed(2)}%)`);

    res.json({
      message: 'Answer sheet evaluated successfully',
      result: {
        submissionId: submission.id,
        studentName: submission.student_name,
        score: submission.score,
        totalQuestions: submission.total_questions,
        percentage: submission.percentage,
        submittedAt: submission.submitted_at,
        extractedText: ocrResult.text.substring(0, 500) + (ocrResult.text.length > 500 ? '...' : '') // First 500 chars for debugging
      }
    });

  } catch (error) {
    console.error('Error submitting answer sheet:', error);
    res.status(500).json({ 
      error: 'Failed to submit answer sheet: ' + error.message 
    });
  }
});

// Get all submissions for a paper
router.get('/paper/:paperId', async (req, res) => {
  try {
    const paperId = req.params.paperId;

    const result = await pool.query(`
      SELECT * FROM student_submissions 
      WHERE paper_id = $1 
      ORDER BY submitted_at DESC
    `, [paperId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Get submission details
router.get('/:id', async (req, res) => {
  try {
    const submissionId = req.params.id;

    // Get submission details
    const submissionResult = await pool.query(`
      SELECT s.*, p.name as paper_name 
      FROM student_submissions s 
      JOIN papers p ON s.paper_id = p.id 
      WHERE s.id = $1
    `, [submissionId]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Get student answers
    const answersResult = await pool.query(`
      SELECT 
        sa.question_number,
        sa.selected_option as extracted_answer,
        sa.is_correct,
        q.correct_option as correct_answer,
        q.question_text
      FROM student_answers sa 
      JOIN questions q ON sa.question_number = q.question_number AND q.paper_id = (
        SELECT paper_id FROM student_submissions WHERE id = $1
      )
      WHERE sa.submission_id = $1 
      ORDER BY sa.question_number
    `, [submissionId]);

    const submission = submissionResult.rows[0];
    submission.answers = answersResult.rows;

    res.json(submission);
  } catch (error) {
    console.error('Error fetching submission details:', error);
    res.status(500).json({ error: 'Failed to fetch submission details' });
  }
});

module.exports = router;
