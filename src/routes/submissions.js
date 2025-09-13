const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { GeminiService } = require('../../services/geminiService');
const GoogleDriveService = require('../../services/googleDriveService');
const OMRService = require('../../services/omrService');
const { FillBlanksService } = require('../../services/fillBlanksService');

const router = express.Router();
const geminiService = new GeminiService();
const googleDriveService = new GoogleDriveService();
const omrService = new OMRService();
const fillBlanksService = require('../../services/fillBlanksService');

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

// Function to evaluate student answers against correct answers (enhanced for multiple correct answers)
const evaluateAnswers = (correctAnswers, studentAnswers, questionFormat = 'multiple_choice', evaluationMethod = 'traditional') => {
  if (questionFormat === 'fill_blanks') {
    // Use fill-blanks specific evaluation
    return fillBlanksService.evaluateFillBlanks(correctAnswers, studentAnswers);
  }

  // For OMR detection, use the enhanced OMR evaluation
  if (evaluationMethod === 'omr_detection') {
    try {
      // Prepare questions for OMR evaluation
      const omrQuestions = correctAnswers.map(q => ({
        question_number: q.question_number,
        correct_option: q.correct_option,
        correct_options: q.correct_options ? JSON.parse(q.correct_options) : null
      }));

      // Convert student answers to OMR format
      const omrStudentAnswers = studentAnswers.map(a => ({
        question: a.question,
        selected_options: a.selectedOptions || (a.selectedOption ? [a.selectedOption] : []),
        confidence: a.confidence || 'medium',
        marking_type: a.marking_type || 'unknown'
      }));

      // Use OMR service evaluation
      const omrEvaluation = omrService.evaluateOMRAnswers(omrStudentAnswers, omrQuestions);
      
      // Convert to expected format
      return {
        score: omrEvaluation.summary.total_score,
        totalQuestions: omrEvaluation.summary.total_questions,
        percentage: omrEvaluation.summary.percentage,
        answerResults: omrEvaluation.results.map(result => ({
          questionNumber: result.question_number,
          correctOption: result.correct_answers.join(','),
          studentOption: result.student_answers.join(','),
          isCorrect: result.is_correct,
          partialScore: result.partial_score,
          details: result.evaluation_details
        }))
      };
    } catch (omrError) {
      console.error('❌ OMR evaluation failed, falling back to traditional:', omrError.message);
      // Fall back to traditional evaluation
    }
  }

  // Traditional multiple choice evaluation (backward compatibility)
  const totalQuestions = correctAnswers.length;
  let score = 0;
  const answerResults = [];

  // Create a map of correct answers for quick lookup
  const correctAnswerMap = {};
  correctAnswers.forEach(q => {
    // Support both single and multiple correct answers
    if (q.correct_options && q.correct_options !== null) {
      try {
        const correctOptions = JSON.parse(q.correct_options);
        correctAnswerMap[q.question_number] = Array.isArray(correctOptions) ? correctOptions : [q.correct_option];
      } catch (e) {
        correctAnswerMap[q.question_number] = [q.correct_option];
      }
    } else {
      correctAnswerMap[q.question_number] = [q.correct_option];
    }
  });

  // Create a map of student answers for quick lookup
  const studentAnswerMap = {};
  studentAnswers.forEach(a => {
    // Handle both single and multiple answers
    if (a.selectedOptions && Array.isArray(a.selectedOptions)) {
      studentAnswerMap[a.question] = a.selectedOptions.map(opt => opt.toUpperCase());
    } else {
      studentAnswerMap[a.question] = a.selectedOption ? [a.selectedOption.toUpperCase()] : [];
    }
  });

  // Evaluate each question
  for (const correctAnswer of correctAnswers) {
    const questionNumber = correctAnswer.question_number;
    const correctOptions = correctAnswerMap[questionNumber] || [];
    const studentOptions = studentAnswerMap[questionNumber] || [];
    
    // Calculate if answer is correct based on array comparison
    let isCorrect = false;
    let partialScore = 0;

    if (correctOptions.length === 1) {
      // Single correct answer
      isCorrect = studentOptions.length === 1 && studentOptions[0] === correctOptions[0].toUpperCase();
      partialScore = isCorrect ? 1 : 0;
    } else {
      // Multiple correct answers - use proportional scoring
      const correctSet = new Set(correctOptions.map(opt => opt.toUpperCase()));
      const studentSet = new Set(studentOptions);
      
      const correctSelections = [...studentSet].filter(ans => correctSet.has(ans)).length;
      const incorrectSelections = [...studentSet].filter(ans => !correctSet.has(ans)).length;
      
      if (correctSelections === correctOptions.length && incorrectSelections === 0) {
        isCorrect = true;
        partialScore = 1;
      } else if (correctSelections > 0) {
        partialScore = Math.max(0, (correctSelections - incorrectSelections * 0.5) / correctOptions.length);
        partialScore = Math.round(partialScore * 100) / 100;
        isCorrect = partialScore >= 0.8; // Consider 80%+ as correct
      }
    }

    if (isCorrect || partialScore > 0) score += partialScore;

    answerResults.push({
      questionNumber,
      correctOption: correctOptions.join(','),
      studentOption: studentOptions.join(','),
      isCorrect,
      partialScore
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

// Configure upload middleware to support both single and multiple files
const uploadAnswer = (req, res, next) => {
  // Check if this is a multi-page submission
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    // Use multer.any() to handle both single and multiple files dynamically
    const dynamicUpload = multer({ 
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
    }).any();
    
    dynamicUpload(req, res, next);
  } else {
    next();
  }
};

// Submit student answer sheet
router.post('/submit', uploadAnswer, async (req, res) => {
  try {
    const { paperId, studentName } = req.body;
    const files = req.files || [];

    if (!paperId || !studentName) {
      return res.status(400).json({ error: 'Paper ID and student name are required' });
    }

    if (files.length === 0) {
      return res.status(400).json({ error: 'Answer sheet image(s) are required' });
    }

    console.log(`Starting student answer sheet evaluation... (${files.length} file(s))`);
    console.log('Processing files from memory buffer');

    // Check if paper exists and get its page count and question type
    const paperResult = await pool.query('SELECT * FROM papers WHERE id = $1', [paperId]);
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    const paper = paperResult.rows[0];
    const expectedPages = paper.total_pages || 1;
    const questionType = paper.question_type || 'traditional';
    
    console.log(`📋 Paper info: ${paper.name} (${questionType} type, ${expectedPages} pages)`);
    
    // Validate page count
    if (files.length !== expectedPages) {
      return res.status(400).json({ 
        error: `Page count mismatch: Expected ${expectedPages} page(s) but received ${files.length} file(s)` 
      });
    }

    console.log(`✓ Page count validation passed: ${files.length}/${expectedPages} pages`);

    // For now, process only the first file (single-page logic)
    // TODO: Implement multi-page processing
    const file = files[0];

    // Step 1: Upload answer sheet to Google Drive with temporary name
    console.log('📤 Step 1: Uploading answer sheet to Google Drive...');
    let driveFileId = null;
    try {
      const tempUploadResult = await googleDriveService.uploadTempAnswerSheet(
        file.buffer,
        `temp-${studentName}-${Date.now()}.png`,
        studentName
      );
      driveFileId = tempUploadResult.fileId;
      console.log(`✓ Temporary file uploaded with ID: ${driveFileId}`);
    } catch (driveError) {
      console.error('❌ Failed to upload to Google Drive:', driveError);
      return res.status(500).json({ 
        error: 'Failed to upload answer sheet to Google Drive: ' + driveError.message 
      });
    }

    // Step 2: Extract student answers using appropriate method based on question type
    console.log(`🔍 Step 2: Processing ${questionType} answer sheet with Gemini...`);
    
    let studentAnswers = [];
    let geminiResult = { success: false };
    let evaluationMethod = 'traditional';

    // Get questions for context
    const questionsResult = await pool.query(
      'SELECT question_number, question_text, correct_option, options, question_format, blank_positions FROM questions WHERE paper_id = $1 ORDER BY question_number',
      [paperId]
    );
    const questions = questionsResult.rows;

    // Check if this is a fill-in-the-blanks paper
    const hasFillBlanks = questions.some(q => q.question_format === 'fill_blanks');
    
    if (hasFillBlanks) {
      // Use fill-in-the-blanks processing
      try {
        const fillBlanksResult = await fillBlanksService.extractStudentFillBlanksFromBuffer(file.buffer, questions);
        if (fillBlanksResult.success && fillBlanksResult.answers.length > 0) {
          studentAnswers = fillBlanksResult.answers;
          geminiResult = { success: true, answers: studentAnswers };
          evaluationMethod = 'fill_blanks_ai';
          console.log(`✓ Fill-blanks extraction found ${studentAnswers.length} answers`);
        }
      } catch (fillBlanksError) {
        console.error('❌ Fill-blanks extraction failed:', fillBlanksError.message);
      }
    }
    
    if (!geminiResult.success && (questionType === 'omr' || questionType === 'mixed')) {
      // Use OMR detection for OMR-type papers
      try {
        const omrResult = await omrService.detectOMRAnswers(file.buffer, questions);
        if (omrResult && omrResult.detected_answers && omrResult.detected_answers.length > 0) {
          // Convert new OMR format to standard format
          studentAnswers = omrResult.detected_answers.map(answer => ({
            question: answer.question,
            // Handle both old (selected_option) and new (selected_options) formats
            selectedOption: answer.selected_options ? answer.selected_options.join(',').toUpperCase() : 
                           (answer.selected_option ? answer.selected_option.toUpperCase() : null),
            selectedOptions: answer.selected_options ? answer.selected_options.map(opt => opt.toUpperCase()) : 
                            (answer.selected_option ? [answer.selected_option.toUpperCase()] : []),
            confidence: answer.confidence,
            marking_type: answer.marking_type
          }));
          geminiResult = { success: true, answers: studentAnswers };
          evaluationMethod = 'omr_detection';
          console.log(`✓ OMR Detection found ${studentAnswers.length} answers`);
        } else {
          console.log('⚠️ OMR detection found no answers, falling back to traditional extraction');
        }
      } catch (omrError) {
        console.error('❌ OMR detection failed, falling back to traditional:', omrError.message);
      }
    }

    // Fall back to traditional extraction if other methods failed
    if (!geminiResult.success) {
      geminiResult = await geminiService.extractStudentAnswersFromBuffer(file.buffer);
      if (geminiResult.success) {
        // Normalize case for traditional extraction results
        studentAnswers = geminiResult.answers.map(answer => ({
          question: answer.question,
          selectedOption: answer.selectedOption?.toUpperCase() || null
        }));
        evaluationMethod = 'gemini_vision';
        console.log(`✓ Traditional extraction found ${studentAnswers.length} answers`);
      }
    }

    if (!geminiResult.success) {
      console.log('❌ Answer extraction failed');
      return res.status(500).json({ 
        error: 'Failed to process answer sheet: ' + (geminiResult.error || 'No answers detected') 
      });
    }

    // Get correct answers from database (including multiple correct answers support)
    const correctAnswersResult = await pool.query(
      'SELECT question_number, correct_option, correct_options, question_format, blank_positions FROM questions WHERE paper_id = $1 ORDER BY question_number',
      [paperId]
    );

    const correctAnswers = correctAnswersResult.rows;

    if (correctAnswers.length === 0) {
      return res.status(400).json({ error: 'No questions found for this paper' });
    }

    // Step 3: Evaluate student answers against correct answers
    console.log('📊 Step 3: Evaluating answers...');
    
    // Determine the primary question format for evaluation
    const questionFormats = correctAnswers.map(q => q.question_format || 'multiple_choice');
    const hasFillBlanksQuestions = questionFormats.includes('fill_blanks');
    const primaryFormat = hasFillBlanksQuestions ? 'fill_blanks' : 'multiple_choice';
    
    const evaluation = evaluateAnswers(correctAnswers, studentAnswers, primaryFormat, evaluationMethod);

    // Step 4: Rename the temporary file with score information
    console.log('🏷️ Step 4: Renaming file with score information...');
    const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedPaperName = paper.name.replace(/[^a-zA-Z0-9]/g, '_');
    const percentage = Math.round((evaluation.score / evaluation.totalQuestions) * 100);
    const finalFileName = `${sanitizedStudentName}_${sanitizedPaperName}_Score${evaluation.score}of${evaluation.totalQuestions}(${percentage}%).jpg`;
    
    try {
      await googleDriveService.renameFileInDrive(driveFileId, finalFileName);
      console.log(`✓ File renamed to: ${finalFileName}`);
    } catch (renameError) {
      console.error('❌ Failed to rename file:', renameError);
      // Continue with the process even if rename fails
    }

    // Step 5: Insert submission into database
    console.log('💾 Step 5: Saving submission to database...');
    const submissionResult = await pool.query(`
      INSERT INTO student_submissions (paper_id, student_name, score, total_questions, percentage, evaluation_method) 
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [paperId, studentName, evaluation.score, evaluation.totalQuestions, evaluation.percentage, evaluationMethod]);

    const submission = submissionResult.rows[0];

    // Insert individual student answers
    if (primaryFormat === 'fill_blanks' && evaluation.results) {
      // Handle fill-in-the-blanks answers
      for (const result of evaluation.results) {
        const studentAnswer = studentAnswers.find(a => a.question === result.questionNumber);
        await pool.query(`
          INSERT INTO student_answers (submission_id, question_number, selected_option, is_correct, text_answer, blank_answers) 
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          submission.id, 
          result.questionNumber, 
          null, // No selected option for fill-blanks
          result.score > 0,
          null, // Legacy field
          JSON.stringify(studentAnswer?.blankAnswers || [])
        ]);
      }
    } else {
      // Handle multiple choice answers
      for (const answerResult of evaluation.answerResults) {
        await pool.query(`
          INSERT INTO student_answers (submission_id, question_number, selected_option, is_correct) 
          VALUES ($1, $2, $3, $4)
        `, [submission.id, answerResult.questionNumber, answerResult.studentOption?.toUpperCase() || null, answerResult.isCorrect]);
      }
    }

    console.log(`Answer sheet evaluated: ${evaluation.score}/${evaluation.totalQuestions} (${evaluation.percentage.toFixed(2)}%) - ${questionType} type`);

    console.log('✅ Process completed successfully!');
    res.json({
      message: 'Answer sheet submitted and stored successfully',
      success: true,
      submissionId: submission.id,  // Include the submission ID
      studentName: studentName,
      paperName: paper.name,
      questionType: questionType,
      evaluationMethod: evaluationMethod,
      score: `${evaluation.score}/${evaluation.totalQuestions}`,
      percentage: `${evaluation.percentage.toFixed(2)}%`,
      driveInfo: {
        uploadedToDrive: true,
        processSteps: [
          '✓ Uploaded to Google Drive',
          `✓ Processed with ${questionType === 'omr' ? 'OMR Detection' : 'Traditional Gemini AI'}`,
          '✓ Evaluated answers',
          '✓ Final file uploaded with score',
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
      SELECT sa.*, q.question_text, q.correct_option, q.options, q.question_format
      FROM student_answers sa 
      JOIN questions q ON sa.question_number = q.question_number 
      JOIN student_submissions s ON sa.submission_id = s.id
      WHERE sa.submission_id = $1 AND q.paper_id = s.paper_id
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
