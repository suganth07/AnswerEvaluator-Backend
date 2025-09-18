const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');
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
        correct_options: q.correct_options || ["A"]
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
    // Use correct_options JSON column
    if (q.correct_options && Array.isArray(q.correct_options)) {
      correctAnswerMap[q.question_number] = q.correct_options;
    } else {
      // Default fallback
      correctAnswerMap[q.question_number] = ["A"];
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
    const { paperId, studentName, rollNo } = req.body;
    const files = req.files || [];

    if (!paperId || !studentName || !rollNo) {
      return res.status(400).json({ error: 'Paper ID, student name, and roll number are required' });
    }

    if (files.length === 0) {
      return res.status(400).json({ error: 'Answer sheet image(s) are required' });
    }

    console.log(`🎓 Student submission: ${studentName} (Roll: ${rollNo}) - ${files.length} file(s)`);

    // Check if paper exists and get its page count and question type
    const paper = await prisma.paper.findUnique({
      where: { id: parseInt(paperId) }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    const expectedPages = paper.totalPages || 1;
    const questionType = paper.questionType || 'traditional';
    
    console.log(`📋 Paper info: ${paper.name} (${questionType} type, ${expectedPages} pages)`);
    
    // Validate page count
    if (files.length !== expectedPages) {
      return res.status(400).json({ 
        error: `Page count mismatch: Expected ${expectedPages} page(s) but received ${files.length} file(s)` 
      });
    }

    console.log(`✓ Page count validation passed: ${files.length}/${expectedPages} pages`);

    // Step 1: Upload all answer sheets to Google Drive with roll number naming
    console.log('📤 Step 1: Uploading answer sheets to Google Drive...');
    const uploadedImages = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const pageNumber = i + 1;
        const fileName = `${studentName}_${rollNo}_page${pageNumber}.png`;
        
        console.log(`📤 Uploading page ${pageNumber}: ${fileName}`);
        
        const uploadResult = await googleDriveService.uploadTempAnswerSheet(
          file.buffer,
          fileName,
          `${studentName} - Roll: ${rollNo}`
        );
        
        uploadedImages.push({
          pageNumber: pageNumber,
          fileName: fileName,
          fileId: uploadResult.fileId,
          webViewLink: uploadResult.webViewLink
        });
        
        console.log(`✓ Page ${pageNumber} uploaded with ID: ${uploadResult.fileId}`);
      }
      
      console.log(`✓ All ${files.length} pages uploaded successfully`);
      
    } catch (driveError) {
      console.error('❌ Failed to upload to Google Drive:', driveError);
      return res.status(500).json({ 
        error: 'Failed to upload answer sheet to Google Drive: ' + driveError.message 
      });
    }

    // Step 2: Store submission in database WITHOUT evaluation (pending status)
    console.log('� Step 2: Storing submission in database (pending evaluation)...');
    
    // Create image URLs string from uploaded images
    const imageUrls = uploadedImages.map(img => img.webViewLink).join(',');
    
    try {
      const submission = await prisma.studentSubmission.create({
        data: {
          paperId: parseInt(paperId),
          studentName: studentName,
          rollNo: rollNo,
          imageUrl: imageUrls,
          score: 0,
          totalQuestions: 0,
          percentage: 0,
          submittedAt: new Date(),
          answerTypes: {},
          evaluationMethod: 'pending',
          evaluationStatus: 'pending'
        }
      });

      console.log(`✅ Submission stored successfully with ID: ${submission.id}`);
      
      // Return success response without evaluation results
      res.json({
        success: true,
        message: 'Answer sheet submitted successfully and is pending evaluation',
        submissionId: submission.id,
        studentName: studentName,
        rollNo: rollNo,
        submittedAt: submission.submittedAt,
        status: 'pending',
        uploadedPages: uploadedImages.length,
        note: 'Your submission will be evaluated by the admin. Results will be available after evaluation.'
      });

    } catch (dbError) {
      console.error('❌ Database error:', dbError);
      return res.status(500).json({ 
        error: 'Failed to store submission in database: ' + dbError.message 
      });
    }

  } catch (error) {
    console.error('❌ Submission error:', error);
    res.status(500).json({ 
      error: 'Failed to process submission: ' + error.message 
    });
  }
});

// Get all submissions for a paper
router.get('/paper/:paperId', async (req, res) => {
  try {
    const paperId = parseInt(req.params.paperId);

    const submissions = await prisma.studentSubmission.findMany({
      where: { paperId: paperId },
      include: {
        paper: {
          select: { name: true }
        }
      },
      orderBy: { submittedAt: 'desc' }
    });

    res.json(submissions);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Admin endpoint to evaluate a specific submission
router.post('/evaluate/:submissionId', async (req, res) => {
  try {
    const submissionId = parseInt(req.params.submissionId);

    // Get submission details
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        paper: true
      }
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.evaluationStatus === 'evaluated') {
      return res.status(400).json({ error: 'Submission already evaluated' });
    }

    console.log(`🎓 Starting evaluation for ${submission.studentName} (Roll: ${submission.rollNo})`);

    // Get questions for this paper
    const questions = await prisma.question.findMany({
      where: { paperId: submission.paperId },
      orderBy: { questionNumber: 'asc' }
    });

    // Get image URLs from submission
    const imageUrls = submission.imageUrl.split(',');
    
    // Step 1: Download images from Google Drive and process each one
    let allStudentAnswers = [];
    let rollNoFromPaper = null;
    
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      const pageNumber = i + 1;
      
      console.log(`📄 Processing page ${pageNumber}...`);
      
      try {
        // Download image from Google Drive
        const imageBuffer = await googleDriveService.downloadImage(imageUrl);
        
        // Extract roll number from first page if not already extracted
        if (pageNumber === 1) {
          console.log('🔍 Extracting roll number from question paper...');
          const rollNoResult = await geminiService.extractRollNumberFromImage(imageBuffer);
          if (rollNoResult.success) {
            rollNoFromPaper = rollNoResult.rollNumber;
            console.log(`📋 Roll number from paper: ${rollNoFromPaper}`);
          }
        }
        
        // Process answers based on question type
        const questionType = submission.paper.questionType || 'traditional';
        let pageAnswers = [];
        
        if (questionType === 'omr' || questionType === 'mixed') {
          // Use OMR detection
          const omrResult = await omrService.detectOMRAnswers(imageBuffer, questions);
          if (omrResult && omrResult.detected_answers) {
            pageAnswers = omrResult.detected_answers;
          }
        }
        
        if (pageAnswers.length === 0) {
          // Fall back to traditional Gemini extraction
          const geminiResult = await geminiService.extractStudentAnswersFromBuffer(imageBuffer);
          if (geminiResult.success) {
            pageAnswers = geminiResult.answers;
          }
        }
        
        allStudentAnswers = allStudentAnswers.concat(pageAnswers);
        
      } catch (imageError) {
        console.error(`❌ Failed to process page ${pageNumber}:`, imageError);
      }
    }

    // Step 2: Validate roll number
    if (rollNoFromPaper && rollNoFromPaper !== submission.rollNo) {
      console.log(`❌ Roll number mismatch: Paper shows ${rollNoFromPaper}, but student entered ${submission.rollNo}`);
      
      await prisma.studentSubmission.update({
        where: { id: submissionId },
        data: {
          evaluationStatus: 'error',
          evaluationMethod: 'roll_number_mismatch'
        }
      });
      
      return res.status(400).json({ 
        error: 'Roll number mismatch',
        message: `The roll number in the question paper (${rollNoFromPaper}) does not match the roll number you entered (${submission.rollNo})`,
        paperRollNo: rollNoFromPaper,
        enteredRollNo: submission.rollNo
      });
    }

    // Step 3: Evaluate answers
    console.log('📊 Evaluating answers...');
    
    const evaluationResult = evaluateAnswers(questions, allStudentAnswers, 'multiple_choice', 'gemini_vision');
    
    // Step 4: Store results in database
    await prisma.$transaction(async (tx) => {
      // Update submission
      await tx.studentSubmission.update({
        where: { id: submissionId },
        data: {
          score: evaluationResult.score,
          totalQuestions: evaluationResult.totalQuestions,
          percentage: evaluationResult.percentage,
          evaluationStatus: 'evaluated',
          evaluationMethod: 'admin_triggered',
          answerTypes: evaluationResult.answerTypes || {}
        }
      });

      // Store individual answers
      for (const result of evaluationResult.results) {
        await tx.studentAnswer.create({
          data: {
            submissionId: submissionId,
            questionNumber: result.questionNumber,
            selectedOption: result.selectedOption,
            selectedOptions: result.selectedOptions || [result.selectedOption],
            isCorrect: result.isCorrect,
            textAnswer: result.textAnswer,
            answerType: result.answerType || 'mcq'
          }
        });
      }
    });

    console.log(`✅ Evaluation completed for ${submission.studentName} (Roll: ${submission.rollNo})`);
    console.log(`📊 Score: ${evaluationResult.score}/${evaluationResult.totalQuestions} (${evaluationResult.percentage}%)`);

    res.json({
      success: true,
      message: 'Evaluation completed successfully',
      studentName: submission.studentName,
      rollNo: submission.rollNo,
      score: evaluationResult.score,
      totalQuestions: evaluationResult.totalQuestions,
      percentage: evaluationResult.percentage,
      evaluationStatus: 'evaluated'
    });

  } catch (error) {
    console.error('❌ Evaluation error:', error);
    
    // Update submission status to error
    try {
      await prisma.studentSubmission.update({
        where: { id: parseInt(req.params.submissionId) },
        data: {
          evaluationStatus: 'error',
          evaluationMethod: 'evaluation_failed'
        }
      });
    } catch (updateError) {
      console.error('Failed to update submission status:', updateError);
    }
    
    res.status(500).json({ 
      error: 'Failed to evaluate submission: ' + error.message 
    });
  }
});

// Get submissions by evaluation status
router.get('/paper/:paperId/status/:status', async (req, res) => {
  try {
    const paperId = parseInt(req.params.paperId);
    const status = req.params.status; // 'pending' or 'evaluated'
    const { search } = req.query; // Optional roll number search

    let whereClause = { 
      paperId: paperId,
      evaluationStatus: status
    };

    // Add roll number search if provided
    if (search) {
      whereClause.rollNo = {
        contains: search,
        mode: 'insensitive'
      };
    }

    const submissions = await prisma.studentSubmission.findMany({
      where: whereClause,
      include: {
        paper: {
          select: { name: true }
        }
      },
      orderBy: { submittedAt: 'desc' }
    });

    res.json({
      status: status,
      count: submissions.length,
      submissions: submissions
    });
  } catch (error) {
    console.error('Error fetching submissions by status:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Get submission details
router.get('/:id', async (req, res) => {
  try {
    const submissionId = parseInt(req.params.id);

    // Get submission details with paper name
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        paper: {
          select: { name: true }
        },
        answers: {
          orderBy: { questionNumber: 'asc' }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Get question details for the answers
    const questions = await prisma.question.findMany({
      where: { paperId: submission.paperId },
      select: {
        questionNumber: true,
        questionText: true,
        correctOptions: true,
        options: true,
        questionFormat: true
      }
    });

    // Merge question details with answers
    const answersWithQuestions = submission.answers.map(answer => {
      const question = questions.find(q => q.questionNumber === answer.questionNumber);
      return {
        ...answer,
        questionText: question?.questionText,
        correctOptions: question?.correctOptions,
        options: question?.options,
        questionFormat: question?.questionFormat
      };
    });

    res.json({
      ...submission,
      paper_name: submission.paper.name,
      answers: answersWithQuestions
    });
  } catch (error) {
    console.error('Error fetching submission details:', error);
    res.status(500).json({ error: 'Failed to fetch submission details' });
  }
});

module.exports = router;
