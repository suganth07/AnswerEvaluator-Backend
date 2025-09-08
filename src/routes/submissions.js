const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { GeminiService } = require('../../services/geminiService');
const googleDriveService = require('../../services/googleDriveService');

const router = express.Router();
const geminiService = new GeminiService();

// Configure multer for memory storage (student uploads - save to Drive only)
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

// Function to evaluate student answers against correct answers
const evaluateAnswers = (correctAnswers, studentAnswers) => {
  const totalQuestions = correctAnswers.length;
  let score = 0;
  const answerResults = [];

  // Create a map of correct answers for quick lookup
  const correctAnswerMap = {};
  correctAnswers.forEach(q => {
    correctAnswerMap[q.question_number] = q.correct_option;
  });

  // Create a map of student answers for quick lookup
  const studentAnswerMap = {};
  studentAnswers.forEach(a => {
    studentAnswerMap[a.question] = a.selectedOption; // Gemini format: {question: 1, selectedOption: "a"}
  });

  // Evaluate each question
  for (const correctAnswer of correctAnswers) {
    const questionNumber = correctAnswer.question_number;
    const correctOption = correctAnswer.correct_option;
    const studentOption = studentAnswerMap[questionNumber] || null;
    
    const isCorrect = studentOption === correctOption;
    if (isCorrect) score++;

    answerResults.push({
      questionNumber,
      correctOption,
      studentOption,
      isCorrect
    });
  }

  const percentage = (score / totalQuestions) * 100;

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
    console.log('Processing file from memory buffer');

    // Check if paper exists
    const paperResult = await pool.query('SELECT * FROM papers WHERE id = $1', [paperId]);
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    const paper = paperResult.rows[0];

    // Step 1: Upload answer sheet to Google Drive with temporary name
    console.log('📤 Step 1: Uploading answer sheet to Google Drive...');
    let driveFileId = null;
    try {
      // Set a timeout for the upload operation (30 seconds)
      const uploadPromise = googleDriveService.uploadTempAnswerSheet(
        file.buffer,
        file.originalname,
        studentName
      );
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upload timeout after 30 seconds')), 30000);
      });
      
      const tempUploadResult = await Promise.race([uploadPromise, timeoutPromise]);
      
      driveFileId = tempUploadResult.fileId;
      console.log(`✓ Temporary file uploaded with ID: ${driveFileId}`);
    } catch (driveError) {
      console.error('❌ Failed to upload to Google Drive:', driveError);
      
      // Check if it's a timeout error
      if (driveError.message.includes('timeout')) {
        return res.status(408).json({ 
          error: 'Upload timeout. Please try again with a smaller image or check your internet connection.',
          errorType: 'UPLOAD_TIMEOUT',
          userMessage: 'Upload took too long - please try again'
        });
      }
      
      // Check if it's an authentication error
      if (driveError.message.includes('Authentication session expired') || 
          driveError.message.includes('Token refresh failed')) {
        return res.status(401).json({ 
          error: 'Your session has expired. Please try submitting your answer sheet again.',
          errorType: 'AUTH_EXPIRED',
          userMessage: 'Session expired - please try again'
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to upload answer sheet to Google Drive: ' + driveError.message,
        errorType: 'UPLOAD_FAILED',
        userMessage: 'Upload failed - please try again'
      });
    }

    // Step 2: Extract student answers using Gemini API (from memory buffer)
    console.log('🔍 Step 2: Processing student answer sheet with Gemini...');
    const geminiResult = await geminiService.extractStudentAnswersFromBuffer(file.buffer);
    
    if (!geminiResult.success) {
      // Clean up the uploaded file if Gemini processing fails
      console.log('❌ Gemini processing failed, cleaning up uploaded file...');
      // Note: We could add a delete method to clean up, but for now we'll leave the temp file
      return res.status(500).json({ 
        error: 'Failed to process answer sheet: ' + geminiResult.error 
      });
    }
    
    const studentAnswers = geminiResult.answers;

    // Get correct answers from database
    const questionsResult = await pool.query(
      'SELECT question_number, correct_option FROM questions WHERE paper_id = $1 ORDER BY question_number',
      [paperId]
    );

    const correctAnswers = questionsResult.rows;

    if (correctAnswers.length === 0) {
      return res.status(400).json({ error: 'No questions found for this paper' });
    }

    // Step 3: Evaluate student answers against correct answers
    console.log('📊 Step 3: Evaluating answers...');
    const evaluation = evaluateAnswers(correctAnswers, studentAnswers);

    // Step 4: Rename file in Google Drive with final name including marks
    console.log('🏷️ Step 4: Renaming file with final name...');
    const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedPaperName = paper.name.replace(/[^a-zA-Z0-9]/g, '_');
    const fileExtension = path.extname(file.originalname) || '.jpg';
    const finalFileName = `${sanitizedStudentName}-${sanitizedPaperName}-${evaluation.score}of${evaluation.totalQuestions}${fileExtension}`;

    try {
      await googleDriveService.renameFileInDrive(driveFileId, finalFileName);
      console.log(`✓ File renamed to: ${finalFileName}`);
    } catch (renameError) {
      console.error('❌ Failed to rename file in Drive:', renameError);
      // Continue with the process even if rename fails
    }

    // Step 5: Insert submission into database (store drive_file_id for reference)
    console.log('💾 Step 5: Saving submission to database...');
    const submissionResult = await pool.query(`
      INSERT INTO student_submissions (paper_id, student_name, score, total_questions, percentage) 
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [paperId, studentName, evaluation.score, evaluation.totalQuestions, evaluation.percentage]);

    const submission = submissionResult.rows[0];

    // Insert individual student answers
    for (const answerResult of evaluation.answerResults) {
      await pool.query(`
        INSERT INTO student_answers (submission_id, question_number, selected_option, is_correct) 
        VALUES ($1, $2, $3, $4)
      `, [submission.id, answerResult.questionNumber, answerResult.studentOption, answerResult.isCorrect]);
    }

    console.log(`Answer sheet evaluated: ${evaluation.score}/${evaluation.totalQuestions} (${evaluation.percentage.toFixed(2)}%)`);

    console.log('✅ Process completed successfully!');
    res.json({
      message: 'Answer sheet submitted and stored successfully',
      success: true,
      submissionId: submission.id,  // Add the submission ID
      studentName: studentName,
      paperName: paper.name,
      score: `${evaluation.score}/${evaluation.totalQuestions}`,
      percentage: `${evaluation.percentage.toFixed(2)}%`,
      driveInfo: {
        fileName: finalFileName,
        fileId: driveFileId,
        uploadedToDrive: true,
        processSteps: [
          '✓ Uploaded to Google Drive',
          '✓ Processed with Gemini AI',
          '✓ Evaluated answers',
          '✓ Renamed with final score',
          '✓ Saved to database'
        ]
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
      SELECT sa.*, q.question_text, q.correct_option 
      FROM student_answers sa 
      JOIN questions q ON sa.question_number = q.question_number 
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
