const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');
const prisma = require('../prisma');
const { GeminiService } = require('../../services/geminiService');
const MinIOService = require('../../services/minioService');
const OMRService = require('../../services/omrService');
const { FillBlanksService } = require('../../services/fillBlanksService');

const router = express.Router();
const geminiService = new GeminiService();
const minioService = new MinIOService();
const omrService = new OMRService();
const fillBlanksService = require('../../services/fillBlanksService');

// Configure multer for memory storage (student uploads - save to MinIO only)
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
        correct_options: q.correct_options || ["A"],
        weightages: q.weightages || {},
        points_per_blank: q.points_per_blank || 1,
        options: q.options || {} // ✅ ADDED: Include options mapping for label-to-content conversion
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
          maxPoints: result.max_points || 1,
          details: result.evaluation_details
        }))
      };
    } catch (omrError) {
      console.error('❌ OMR evaluation failed, falling back to traditional:', omrError.message);
      // Fall back to traditional evaluation
    }
  }

  // Use weightage-based evaluation for manual tests, traditional for others
  if (evaluationMethod === 'manual_test' || (correctAnswers.length > 0 && correctAnswers[0].weightages)) {
    return evaluateAnswersWithWeightages(correctAnswers, studentAnswers);
  }

  // Traditional multiple choice evaluation (backward compatibility)
  return evaluateAnswersTraditional(correctAnswers, studentAnswers);
};

// Helper function to convert option labels (A, B, C, D) to actual option text content
function convertOptionLabelsToContent(studentOptionLabels, questionOptions) {
  if (!questionOptions || typeof questionOptions !== 'object') {
    return studentOptionLabels; // Return as-is if no options mapping available
  }
  
  return studentOptionLabels.map(label => {
    // First try exact match, then try case-insensitive match
    let matchedKey = null;
    
    // Try exact match first
    if (questionOptions[label]) {
      matchedKey = label;
    } else {
      // Try case-insensitive match
      matchedKey = Object.keys(questionOptions).find(key => 
        key.toUpperCase() === label.toUpperCase()
      );
    }
    
    if (matchedKey && questionOptions[matchedKey]) {
      return questionOptions[matchedKey].trim();
    }
    
    // Otherwise, assume it's already the content (backward compatibility)
    return label.trim();
  });
}

// Helper function to detect if correctOptions contain option labels vs actual content  
function isUsingOptionLabels(correctOptions, questionOptions) {
  if (!correctOptions || !questionOptions || typeof questionOptions !== 'object') {
    return false;
  }
  
  // Check if any correct option matches an option key (A, B, C, D) - case insensitive
  return correctOptions.some(option => {
    return Object.keys(questionOptions).some(key => 
      key.toUpperCase() === option.toUpperCase()
    );
  });
}

// Helper function to convert correct options from labels to content if needed
function normalizeCorrectOptions(correctOptions, questionOptions) {
  if (isUsingOptionLabels(correctOptions, questionOptions)) {
    console.log(`🔄 Converting correct options from labels to content: [${correctOptions.join(',')}]`);
    return convertOptionLabelsToContent(correctOptions, questionOptions);
  }
  return correctOptions; // Already using content format
}

// Helper function to normalize options for case-insensitive comparison
function normalizeOptionsForComparison(options) {
  return options.map(opt => opt.toString().trim().toLowerCase());
}

// New weightage-based evaluation function
const evaluateAnswersWithWeightages = (correctAnswers, studentAnswers) => {
  console.log('🎯 Using weightage-based evaluation');
  
  const totalQuestions = correctAnswers.length;
  let totalScore = 0;
  let maxPossibleScore = 0;
  const answerResults = [];

  console.log('🔍 Debug - Raw correctAnswers:', correctAnswers);
  console.log('🔍 Debug - Raw studentAnswers:', studentAnswers);

  // Create a map of correct answers for quick lookup
  const correctAnswerMap = {};
  correctAnswers.forEach(q => {
    const questionNum = q.questionNumber || q.question_number;
    const correctOptions = q.correctOptions || q.correct_options;
    const weightages = q.weightages || {};
    const maxPoints = q.pointsPerBlank || q.points_per_blank || 1;
    const options = q.options || {}; // Include options mapping for conversion
    
    if (correctOptions && Array.isArray(correctOptions)) {
      correctAnswerMap[questionNum] = {
        correctOptions: correctOptions, // 🔄 REMOVED: Don't force uppercase - preserve actual content
        weightages: weightages,
        maxPoints: maxPoints,
        options: options // ✅ ADDED: Include options mapping for label-to-content conversion
      };
    }
    maxPossibleScore += maxPoints;
  });

  console.log('🔍 Debug - correctAnswerMap:', correctAnswerMap);

  // Create a map of student answers for quick lookup
  const studentAnswerMap = {};
  console.log('🔍 Debug - Processing student answers for weightage mapping:', studentAnswers);
  
  studentAnswers.forEach(a => {
    // Handle all possible field name formats
    const questionNum = a.question_number || a.question || a.questionNumber;
    console.log(`🔍 Mapping weightage answer for Q${questionNum}:`, a);
    
    if (a.selected_options && Array.isArray(a.selected_options)) {
      studentAnswerMap[questionNum] = a.selected_options; // Preserve case for weightage conversion
    } else if (a.selectedOptions && Array.isArray(a.selectedOptions)) {
      studentAnswerMap[questionNum] = a.selectedOptions;
    } else if (a.selected_option) {
      studentAnswerMap[questionNum] = [a.selected_option];
    } else if (a.selectedOption) {
      studentAnswerMap[questionNum] = [a.selectedOption];
    } else {
      console.log(`⚠️ No valid answer found for Q${questionNum} in weightage evaluation`);
      studentAnswerMap[questionNum] = [];
    }
  });

  console.log('🔍 Debug - studentAnswerMap:', studentAnswerMap);

  // Evaluate each question using the new weightage-based logic
  for (const correctAnswer of correctAnswers) {
    const questionNumber = correctAnswer.questionNumber || correctAnswer.question_number;
    const questionData = correctAnswerMap[questionNumber];
    let studentOptions = studentAnswerMap[questionNumber] || [];
    
    if (!questionData) {
      console.warn(`⚠️ No question data found for question ${questionNumber}`);
      continue;
    }
    
    let { correctOptions, weightages, maxPoints, options } = questionData;
    
    console.log(`🔍 Debug - Q${questionNumber} [BEFORE]: Correct=[${correctOptions.join(',')}] Student=[${studentOptions.join(',')}]`);
    
    // 🔄 NORMALIZE OPTIONS: Convert both student answers and correct answers to same format
    
    // Step 1: Normalize correct options (convert labels to content if needed)
    correctOptions = normalizeCorrectOptions(correctOptions, options);
    
    // Step 2: Convert student option labels to actual content
    if (options && typeof options === 'object') {
      studentOptions = convertOptionLabelsToContent(studentOptions, options);
    }
    
    // Step 3: Normalize weightages to use content as keys (not labels)
    let normalizedWeightages = {};
    if (weightages && options) {
      Object.keys(weightages).forEach(key => {
        if (options[key]) {
          // Convert label-based weightage to content-based
          normalizedWeightages[options[key].trim()] = weightages[key];
        } else {
          // Already content-based or direct mapping
          normalizedWeightages[key] = weightages[key];
        }
      });
      weightages = normalizedWeightages;
    }
    
    console.log(`🔍 Debug - Q${questionNumber} [AFTER]: Correct=[${correctOptions.join(',')}] Student=[${studentOptions.join(',')}] Weightages=${JSON.stringify(weightages)} MaxPoints=${maxPoints}`);
    
    // 🔄 CASE-INSENSITIVE COMPARISON: Normalize both sets for comparison
    const normalizedCorrectOptions = normalizeOptionsForComparison(correctOptions);
    const normalizedStudentOptions = normalizeOptionsForComparison(studentOptions);
    
    console.log(`🔍 Debug - Q${questionNumber} [NORMALIZED]: Correct=[${normalizedCorrectOptions.join(',')}] Student=[${normalizedStudentOptions.join(',')}]`);
    
    // NEW EVALUATION LOGIC: If any wrong option is selected, score is 0
    const correctSet = new Set(normalizedCorrectOptions);
    const studentSet = new Set(normalizedStudentOptions);
    
    // Check if any wrong option is selected
    const wrongOptions = [...studentSet].filter(ans => !correctSet.has(ans));
    let questionScore = 0;
    let isCorrect = false;
    let details = '';
    
    if (wrongOptions.length > 0) {
      // Case 5: Any wrong option selected = 0 marks
      questionScore = 0;
      isCorrect = false;
      details = `Wrong option(s) selected: ${wrongOptions.join(', ')}. No partial marking.`;
      console.log(`🔍 Debug - Q${questionNumber}: Wrong options detected - score=0`);
    } else if (studentOptions.length === 0) {
      // No options selected
      questionScore = 0;
      isCorrect = false;
      details = 'No options selected';
      console.log(`🔍 Debug - Q${questionNumber}: No options selected - score=0`);
    } else {
      // Only correct options selected - calculate weightage sum
      // Match original options with normalized ones for weightage calculation
      const correctSelections = studentOptions.filter(studentOpt => {
        const normalizedStudentOpt = studentOpt.toString().trim().toLowerCase();
        return correctSet.has(normalizedStudentOpt);
      });
      
      questionScore = correctSelections.reduce((sum, option) => {
        // Try exact match first, then case-insensitive match for weightages
        let weightageKey = option;
        if (!weightages[option]) {
          // Try to find case-insensitive match in weightages
          const matchedKey = Object.keys(weightages).find(key => 
            key.toLowerCase() === option.toLowerCase()
          );
          if (matchedKey) {
            weightageKey = matchedKey;
          }
        }
        return sum + (weightages[weightageKey] || 0);
      }, 0);
      
      // Round to 2 decimal places
      questionScore = Math.round(questionScore * 100) / 100;
      
      // Check if this is a perfect match
      isCorrect = (correctSelections.length === correctOptions.length) && (questionScore === maxPoints);
      
      if (correctSelections.length === correctOptions.length) {
        details = `All correct options selected. Score: ${questionScore}/${maxPoints}`;
      } else {
        details = `Partial correct options: ${correctSelections.join(', ')}. Score: ${questionScore}/${maxPoints}`;
      }
      
      console.log(`🔍 Debug - Q${questionNumber}: Only correct options - score=${questionScore}/${maxPoints}`);
    }
    
    totalScore += questionScore;

    answerResults.push({
      questionNumber,
      correctOption: correctOptions.join(','),
      studentOption: studentOptions.join(','),
      selectedOptions: studentOptions, // Add the array for proper storage
      isCorrect,
      partialScore: questionScore,
      maxPoints: maxPoints,
      details: details,
      weightageBreakdown: studentOptions.length > 0 && wrongOptions.length === 0 ? 
        studentOptions.map(opt => ({ option: opt, weight: weightages[opt] || 0 })) : []
    });
  }

  const percentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

  console.log(`🔍 Debug - Final weightage evaluation: score=${totalScore}, maxPossible=${maxPossibleScore}, percentage=${percentage}`);

  return {
    score: totalScore,
    totalQuestions,
    maxPossibleScore,
    percentage,
    results: answerResults,
    answerResults,
    evaluationMethod: 'weightage_based'
  };
};

// Traditional evaluation function (kept for backward compatibility)
const evaluateAnswersTraditional = (correctAnswers, studentAnswers) => {
  console.log('📚 Using traditional evaluation');
  
  const totalQuestions = correctAnswers.length;
  let score = 0;
  const answerResults = [];

  console.log('🔍 Debug - Raw correctAnswers:', correctAnswers);
  console.log('🔍 Debug - Raw studentAnswers:', studentAnswers);

  // Create a map of correct answers for quick lookup
  const correctAnswerMap = {};
  correctAnswers.forEach(q => {
    // Handle both database field names (questionNumber/correctOptions) and API field names (question_number/correct_options)
    const questionNum = q.questionNumber || q.question_number;
    const correctOptions = q.correctOptions || q.correct_options;
    
    if (correctOptions && Array.isArray(correctOptions)) {
      correctAnswerMap[questionNum] = correctOptions.map(opt => opt.toUpperCase());
    } else {
      // Default fallback
      correctAnswerMap[questionNum] = ["A"];
    }
  });

  console.log('🔍 Debug - correctAnswerMap:', correctAnswerMap);

  // Create a map of student answers for quick lookup
  const studentAnswerMap = {};
  console.log('🔍 Debug - Processing student answers for mapping:', studentAnswers);
  
  studentAnswers.forEach(a => {
    // Handle all possible field name formats
    const questionNum = a.question_number || a.question || a.questionNumber;
    console.log(`🔍 Mapping answer for Q${questionNum}:`, a);
    
    if (a.selected_options && Array.isArray(a.selected_options)) {
      studentAnswerMap[questionNum] = a.selected_options.map(opt => opt.toUpperCase());
    } else if (a.selectedOptions && Array.isArray(a.selectedOptions)) {
      studentAnswerMap[questionNum] = a.selectedOptions.map(opt => opt.toUpperCase());
    } else if (a.selected_option) {
      studentAnswerMap[questionNum] = [a.selected_option.toUpperCase()];
    } else if (a.selectedOption) {
      studentAnswerMap[questionNum] = [a.selectedOption.toUpperCase()];
    } else {
      console.log(`⚠️ No valid answer found for Q${questionNum}`);
      studentAnswerMap[questionNum] = [];
    }
  });

  console.log('🔍 Debug - studentAnswerMap:', studentAnswerMap);

  // Evaluate each question
  for (const correctAnswer of correctAnswers) {
    const questionNumber = correctAnswer.questionNumber || correctAnswer.question_number;
    const correctOptions = correctAnswerMap[questionNumber] || [];
    const studentOptions = studentAnswerMap[questionNumber] || [];
    
    console.log(`🔍 Debug - Q${questionNumber}: Correct=[${correctOptions.join(',')}] Student=[${studentOptions.join(',')}]`);
    
    // Calculate if answer is correct based on array comparison
    let isCorrect = false;
    let partialScore = 0;

    // NEW STRICT EVALUATION LOGIC: If any wrong option is selected, score is 0
    const correctSet = new Set(correctOptions);
    const studentSet = new Set(studentOptions);
    
    // Check if any wrong option is selected
    const wrongOptions = [...studentSet].filter(ans => !correctSet.has(ans));
    
    if (wrongOptions.length > 0) {
      // Case: Any wrong option selected = 0 marks (STRICT RULE)
      isCorrect = false;
      partialScore = 0;
      console.log(`🔍 Debug - Q${questionNumber}: Wrong option(s) [${wrongOptions.join(',')}] selected - score=0`);
    } else if (studentOptions.length === 0) {
      // Case: No options selected
      isCorrect = false;
      partialScore = 0;
      console.log(`🔍 Debug - Q${questionNumber}: No options selected - score=0`);
    } else {
      // Case: Only correct options selected - calculate score
      if (correctOptions.length === 1) {
        // Single correct answer - exact match required
        isCorrect = studentOptions.length === 1 && studentOptions[0] === correctOptions[0];
        partialScore = isCorrect ? 1 : (studentOptions.includes(correctOptions[0]) ? 1 : 0);
      } else {
        // Multiple correct answers - proportional scoring for correct selections only
        const correctSelections = [...studentSet].filter(ans => correctSet.has(ans)).length;
        
        if (correctSelections === correctOptions.length) {
          // All correct options selected
          isCorrect = true;
          partialScore = 1;
        } else if (correctSelections > 0) {
          // Partial correct options selected (but no wrong options)
          partialScore = correctSelections / correctOptions.length;
          partialScore = Math.round(partialScore * 100) / 100;
          isCorrect = partialScore >= 0.8; // Consider 80%+ as correct
        }
      }
      console.log(`🔍 Debug - Q${questionNumber}: Only correct options - score=${partialScore}`);
    }

    if (isCorrect || partialScore > 0) score += partialScore;

    answerResults.push({
      questionNumber,
      correctOption: correctOptions.join(','),
      studentOption: studentOptions.join(','),
      selectedOptions: studentOptions, // Add the array for proper storage
      isCorrect,
      partialScore
    });
  }

  // Calculate maximum possible score from questions
  let maxPossibleScore = 0;
  correctAnswers.forEach(q => {
    const maxPoints = q.pointsPerBlank || q.points_per_blank || 1;
    maxPossibleScore += maxPoints;
  });

  const percentage = maxPossibleScore > 0 ? (score / maxPossibleScore) * 100 : 0;

  console.log(`🔍 Debug - Final evaluation: score=${score}, maxPossible=${maxPossibleScore}, percentage=${percentage}`);

  return {
    score,
    totalQuestions,
    maxPossibleScore,
    percentage,
    results: answerResults,
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
      where: { id: parseInt(paperId) },
      include: {
        questions: {
          select: { pageNumber: true }
        }
      }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    // Calculate actual page count from questions
    const pageNumbers = paper.questions.map(q => q.pageNumber).filter(Boolean);
    const expectedPages = pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
    const questionType = paper.questionType || 'traditional';
    
    console.log(`📋 Paper info: ${paper.name} (${questionType} type, ${expectedPages} pages)`);
    
    // Validate page count
    if (files.length !== expectedPages) {
      return res.status(400).json({ 
        error: `Page count mismatch: Expected ${expectedPages} page(s) but received ${files.length} file(s)` 
      });
    }

    console.log(`✓ Page count validation passed: ${files.length}/${expectedPages} pages`);

    // Step 1: Upload all answer sheets to MinIO with roll number naming
    console.log('📤 Step 1: Uploading answer sheets to MinIO...');
    const uploadedImages = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const pageNumber = i + 1;
        // Use exact format: {pending}_{name}_{rollno}_{testname}_{pageno}.png
        const cleanName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanRollNo = rollNo.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanTestName = paper.name.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `pending_${cleanName}_${cleanRollNo}_${cleanTestName}_${pageNumber}.png`;
        
        console.log(`📤 Uploading page ${pageNumber}: ${fileName}`);
        
        const uploadResult = await minioService.uploadTempAnswerSheet(
          file.buffer,
          fileName,
          `${studentName} - Roll: ${rollNo}`,
          rollNo
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
      
    } catch (minioError) {
      console.error('❌ Failed to upload to MinIO:', minioError);
      return res.status(500).json({ 
        error: 'Failed to upload answer sheet to MinIO: ' + minioError.message 
      });
    }

    // Step 2: Store submission in database WITHOUT evaluation (pending status)
    console.log('� Step 2: Storing submission in database (pending evaluation)...');
    
    // Create image URLs string from uploaded images (store object names, not presigned URLs)
    const imageUrls = uploadedImages.map(img => img.objectName).join(',');
    
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
        minioInfo: {
          uploadedToMinIO: true,
          processSteps: [
            '✓ Uploaded to MinIO',
            '✓ Stored in database with pending status',
            '✓ Awaiting admin evaluation'
          ]
        },
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
    
    // Step 1: Download images from MinIO and process each one
    let allStudentAnswers = [];
    let rollNoFromPaper = null;
    
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      const pageNumber = i + 1;
      
      console.log(`📄 Processing page ${pageNumber}...`);
      
      try {
        // Download image from MinIO
        const imageBuffer = await minioService.downloadImage(imageUrl);
        
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
    
    // Detect if this is a manual test with weightages
    const hasWeightages = questions.some(q => q.weightages && Object.keys(q.weightages).length > 0);
    const evaluationMethod = hasWeightages ? 'manual_test' : 'gemini_vision';
    
    console.log(`🎯 Using evaluation method: ${evaluationMethod}${hasWeightages ? ' (weightage-based)' : ' (traditional)'}`);
    
    const evaluationResult = evaluateAnswers(questions, allStudentAnswers, 'multiple_choice', evaluationMethod);
    
    // Step 4: Store results in database
    await prisma.$transaction(async (tx) => {
      // Update submission with appropriate max score
      const maxScore = evaluationResult.maxPossibleScore || evaluationResult.totalQuestions;
      
      await tx.studentSubmission.update({
        where: { id: submissionId },
        data: {
          score: evaluationResult.score,
          totalQuestions: evaluationResult.totalQuestions,
          percentage: evaluationResult.percentage,
          evaluationStatus: 'evaluated',
          evaluationMethod: `admin_triggered_${evaluationResult.evaluationMethod || 'traditional'}`,
          answerTypes: evaluationResult.answerTypes || {}
        }
      });

      // Store individual answers
      for (const result of evaluationResult.results) {
        const answerData = {
          submissionId: submissionId,
          questionNumber: result.questionNumber,
          selectedOption: result.selectedOption || (result.studentOption ? result.studentOption.split(',')[0] : null),
          selectedOptions: result.selectedOptions || (result.studentOption ? result.studentOption.split(',') : []),
          isCorrect: result.isCorrect,
          textAnswer: result.textAnswer,
          answerType: result.answerType || 'mcq',
          // NEW: Store weightage-based scoring details
          partialScore: result.partialScore || (result.isCorrect ? 1 : 0),
          maxPoints: result.maxPoints || 1,
          details: result.details,
          weightageBreakdown: result.weightageBreakdown || []
        };
        
        console.log(`💾 Storing answer for Q${result.questionNumber}: score=${answerData.partialScore}/${answerData.maxPoints}`);
        
        await tx.studentAnswer.create({
          data: answerData
        });
      }
    });

    console.log(`✅ Evaluation completed for ${submission.studentName} (Roll: ${submission.rollNo})`);
    console.log(`📊 Score: ${evaluationResult.score}/${evaluationResult.maxPossibleScore || evaluationResult.totalQuestions} (${evaluationResult.percentage}%)`);

    res.json({
      success: true,
      message: 'Evaluation completed successfully',
      studentName: submission.studentName,
      rollNo: submission.rollNo,
      score: evaluationResult.score,
      totalQuestions: evaluationResult.totalQuestions,
      maxPossibleScore: evaluationResult.maxPossibleScore || evaluationResult.totalQuestions,
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

    // Transform the data to ensure proper types and consistent field names
    const transformedSubmissions = submissions.map(submission => ({
      id: submission.id,
      paperId: submission.paperId,
      studentName: submission.studentName,
      rollNo: submission.rollNo,
      imageUrl: submission.imageUrl,
      score: parseFloat(submission.score.toString()), // Convert Decimal to number
      totalQuestions: submission.totalQuestions,
      percentage: parseFloat(submission.percentage.toString()), // Convert Decimal to number
      submittedAt: submission.submittedAt,
      evaluationStatus: submission.evaluationStatus,
      evaluationMethod: submission.evaluationMethod,
      paperName: submission.paper.name
    }));

    console.log(`📊 Returning ${transformedSubmissions.length} evaluated submissions for paper ${paperId}`);
    console.log('Sample submission data:', transformedSubmissions[0] || 'No submissions');

    res.json({
      status: status,
      count: transformedSubmissions.length,
      submissions: transformedSubmissions
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

    // Parse evaluation details to get maxPossibleScore if available
    let maxPossibleScore = null;
    if (submission.evaluationDetails) {
      try {
        const details = JSON.parse(submission.evaluationDetails);
        maxPossibleScore = details.maxPossibleScore || details.maxScore;
      } catch (e) {
        console.log('Could not parse evaluation details for maxPossibleScore');
      }
    }

    res.json({
      ...submission,
      paper_name: submission.paper.name,
      maxPossibleScore: maxPossibleScore,
      answers: answersWithQuestions
    });
  } catch (error) {
    console.error('Error fetching submission details:', error);
    res.status(500).json({ error: 'Failed to fetch submission details' });
  }
});

// Get pending files from MinIO (for new PENDING_ workflow)
router.get('/pending-files/:paperId', async (req, res) => {
  try {
    const paperId = parseInt(req.params.paperId);
    
    // Get paper details to validate
    const paper = await prisma.paper.findUnique({
      where: { id: paperId }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    let pendingSubmissions = [];
    
    try {
      // Get all PENDING_ files from MinIO
      const pendingFiles = await minioService.listPendingFiles();
      console.log(`📋 Found ${pendingFiles.length} total pending files in MinIO`);
      console.log(`🔍 Filtering for paper: "${paper.name}" (cleaned: "${paper.name.replace(/[^a-zA-Z0-9]/g, '_')}")`);
      
      // Parse file names to extract student info and filter by current paper
      const pendingFromMinIO = pendingFiles
        .map(file => {
          // Extract info from pending_{name}_{rollno}_{testname}_{pageno}.png format
          const match = file.name.match(/^pending_(.+?)_(.+?)_(.+?)_(\d+)\.png$/i);
          if (match) {
            const [, name, rollNo, testName, pageNo] = match;
            
            // Clean the current paper name the same way it's cleaned during upload
            const cleanCurrentPaperName = paper.name.replace(/[^a-zA-Z0-9]/g, '_');
            
            // Compare the cleaned test names
            if (testName.toLowerCase() !== cleanCurrentPaperName.toLowerCase()) {
              console.log(`📋 Filtering out ${file.name} - test name '${testName}' doesn't match current paper cleaned name '${cleanCurrentPaperName}'`);
              return null;
            }
            
            return {
              fileId: file.id,
              fileName: file.name,
              studentName: name.replace(/_/g, ' '),
              rollNo: rollNo.replace(/_/g, ' '),
              testName: testName.replace(/_/g, ' '),
              pageNumber: parseInt(pageNo),
              uploadedAt: file.createdTime,
              paperName: paper.name,
              source: 'minio'
            };
          }
          return null;
        })
        .filter(Boolean);
      
      console.log(`📊 After filtering: ${pendingFromMinIO.length} files match paper "${paper.name}"`);
      pendingSubmissions = pendingFromMinIO;
    } catch (minioError) {
      console.error('⚠️ MinIO error (continuing with database only):', minioError.message);
    }
    
    // Also get pending submissions from database for this specific paper
    try {
      console.log(`🗄️  Checking database for pending submissions for paper ID: ${paperId}`);
      const pendingFromDB = await prisma.studentSubmission.findMany({
        where: {
          paperId: paperId,
          evaluationStatus: 'pending'
        },
        orderBy: { submittedAt: 'desc' }
      });
      
      console.log(`📊 Found ${pendingFromDB.length} pending database submissions for this paper`);
      
      // Convert database submissions to the same format, but filter out duplicates
      const pendingFromDatabase = pendingFromDB
        .filter(submission => {
          // Check if this submission already exists in MinIO PENDING_ files
          const existsInDrive = pendingSubmissions.some(driveSubmission => 
            driveSubmission.studentName === submission.studentName && 
            driveSubmission.rollNo === submission.rollNo
          );
          return !existsInDrive; // Only include if not already in Google Drive
        })
        .map(submission => ({
          submissionId: submission.id,
          fileName: `DB_Submission_${submission.id}`,
          studentName: submission.studentName,
          rollNo: submission.rollNo,
          uploadedAt: submission.submittedAt.toISOString(),
          paperName: paper.name,
          source: 'database',
          imageUrl: submission.imageUrl
        }));
      
      // Combine both sources
      pendingSubmissions = [...pendingSubmissions, ...pendingFromDatabase];
    } catch (dbError) {
      console.error('⚠️ Database error:', dbError.message);
    }
    
    // Group multi-page submissions by student (rollNo + studentName)
    const groupedSubmissions = new Map();
    
    pendingSubmissions.forEach(submission => {
      const studentKey = `${submission.rollNo}_${submission.studentName}`;
      
      if (!groupedSubmissions.has(studentKey)) {
        groupedSubmissions.set(studentKey, {
          studentName: submission.studentName,
          rollNo: submission.rollNo,
          paperName: submission.paperName,
          source: submission.source,
          pages: [],
          totalPages: 0,
          uploadedAt: submission.uploadedAt, // Will be updated to latest
          // For single page or database submissions
          fileName: submission.fileName,
          fileId: submission.fileId,
          submissionId: submission.submissionId,
          imageUrl: submission.imageUrl
        });
      }
      
      const group = groupedSubmissions.get(studentKey);
      
      // Add page information
      if (submission.pageNumber) {
        group.pages.push({
          pageNumber: submission.pageNumber,
          fileId: submission.fileId,
          fileName: submission.fileName,
          uploadedAt: submission.uploadedAt
        });
        group.totalPages = Math.max(group.totalPages, submission.pageNumber);
        // Update uploadedAt to most recent page
        if (new Date(submission.uploadedAt) > new Date(group.uploadedAt)) {
          group.uploadedAt = submission.uploadedAt;
        }
      } else {
        // Single page submission or database submission
        group.totalPages = 1;
        group.pages.push({
          pageNumber: 1,
          fileId: submission.fileId,
          fileName: submission.fileName,
          submissionId: submission.submissionId,
          imageUrl: submission.imageUrl,
          uploadedAt: submission.uploadedAt
        });
      }
    });
    
    // Convert back to array and sort pages within each group
    const consolidatedSubmissions = Array.from(groupedSubmissions.values()).map(group => {
      // Sort pages by page number
      group.pages.sort((a, b) => (a.pageNumber || 1) - (b.pageNumber || 1));
      
      return {
        studentName: group.studentName,
        rollNo: group.rollNo,
        paperName: group.paperName,
        uploadedAt: group.uploadedAt,
        source: group.source,
        totalPages: group.totalPages,
        pages: group.pages,
        // For backward compatibility with single page
        fileName: group.totalPages === 1 ? group.fileName : `${group.studentName}_${group.totalPages}_pages`,
        fileId: group.totalPages === 1 ? group.fileId : null,
        submissionId: group.totalPages === 1 ? group.submissionId : null,
        imageUrl: group.totalPages === 1 ? group.imageUrl : null
      };
    });
    
    // Sort by uploaded date
    consolidatedSubmissions.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    
    console.log(`✅ Final result: ${consolidatedSubmissions.length} unique students with pending submissions for paper "${paper.name}"`);
    if (consolidatedSubmissions.length > 0) {
      console.log('📋 Students:', consolidatedSubmissions.map(s => `${s.studentName} (${s.rollNo})`).join(', '));
    }
    
    res.json({
      paperId: paperId,
      paperName: paper.name,
      count: consolidatedSubmissions.length,
      pendingSubmissions: consolidatedSubmissions
    });
    
  } catch (error) {
    console.error('Error fetching pending files:', error);
    res.status(500).json({ error: 'Failed to fetch pending files' });
  }
});

// Helper function to retry database operations
const retryDatabaseOperation = async (operation, maxRetries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`❌ Database operation attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying, with exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
};

// Evaluate a PENDING_ file (new workflow) - now supports multi-page submissions
router.post('/evaluate-pending', async (req, res) => {
  try {
    const { fileId, fileName, studentName, rollNo, paperId, submissionId, source, pages } = req.body;
    
    if (!studentName || !rollNo || !paperId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log(`🎓 Starting evaluation for ${source || 'PENDING'} submission: ${studentName} (${rollNo})`);
    console.log(`📄 Processing ${pages ? pages.length : 1} page(s)`);
    
    // Get paper and questions
    const paper = await prisma.paper.findUnique({
      where: { id: parseInt(paperId) }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    const questions = await prisma.question.findMany({
      where: { paperId: parseInt(paperId) },
      orderBy: { questionNumber: 'asc' }
    });
    
    // Check if submission already exists for this student and paper
    let existingSubmission = await prisma.studentSubmission.findFirst({
      where: {
        paperId: parseInt(paperId),
        rollNo: rollNo,
        studentName: studentName
      }
    });
    
    if (existingSubmission && existingSubmission.evaluationStatus === 'evaluated') {
      return res.status(400).json({ error: 'Student already has an evaluated submission for this paper' });
    }
    
    // Handle multi-page or single page submission
    const pagesToProcess = pages || [{
      pageNumber: 1,
      fileId: fileId,
      fileName: fileName,
      submissionId: submissionId,
      imageUrl: source === 'database' ? req.body.imageUrl : null
    }];
    
    let allStudentAnswers = [];
    let processedPages = 0;
    
    // Process each page
    for (const page of pagesToProcess) {
      console.log(`📄 Processing page ${page.pageNumber}/${pagesToProcess.length}`);
      
      let imageBuffer;
      
      // Handle different sources for each page
      if (source === 'database' && page.submissionId) {
        // Get submission from database
        const dbSubmission = await prisma.studentSubmission.findUnique({
          where: { id: parseInt(page.submissionId) }
        });
        
        if (!dbSubmission) {
          console.error(`❌ Database submission not found for page ${page.pageNumber}`);
          continue;
        }
        
        // Download image from MinIO using the stored URL
        console.log(`📄 Downloading file from database submission: ${dbSubmission.imageUrl}`);
        imageBuffer = await minioService.downloadImage(dbSubmission.imageUrl);
        if (page.pageNumber === 1) existingSubmission = dbSubmission;
      } else {
        // Handle Google Drive PENDING_ file
        if (!page.fileId) {
          console.error(`❌ Missing fileId for page ${page.pageNumber}`);
          continue;
        }
        
        console.log(`📄 Downloading file from MinIO: ${page.fileName}`);
        imageBuffer = await minioService.downloadImage(page.fileId);
      }
      
      // Extract roll number from the first page only
      if (page.pageNumber === 1) {
        console.log('🔍 Extracting roll number from question paper...');
        let rollNoFromPaper = null;
        
        try {
          const rollNoResult = await geminiService.extractRollNumberFromImage(imageBuffer);
          if (rollNoResult.success) {
            rollNoFromPaper = rollNoResult.rollNumber;
            console.log(`📋 Roll number from paper: ${rollNoFromPaper}`);
          }
        } catch (rollError) {
          console.error('⚠️ Roll number extraction failed:', rollError.message);
          // Continue without roll number validation
        }
        
        // Validate roll number
        if (rollNoFromPaper && rollNoFromPaper !== rollNo) {
          console.log(`❌ Roll number mismatch: Paper shows ${rollNoFromPaper}, but file indicates ${rollNo}`);
          
          return res.status(400).json({ 
            error: 'Roll number mismatch',
            message: `The roll number in the question paper (${rollNoFromPaper}) does not match the roll number in the file name (${rollNo})`,
            paperRollNo: rollNoFromPaper,
            fileRollNo: rollNo
          });
        }
      }
      
      // Get questions for this specific page
      const pageQuestions = questions.filter(q => q.pageNumber === page.pageNumber);
      console.log(`📊 Found ${pageQuestions.length} questions on page ${page.pageNumber}`);
      
      if (pageQuestions.length === 0) {
        console.log(`⚠️ No questions found for page ${page.pageNumber}, skipping...`);
        continue;
      }
      
      // Extract answers for this page using Gemini
      console.log(`🤖 Extracting answers from page ${page.pageNumber} using Gemini...`);
      let pageAnswers = [];
      
      // Process based on question type
      const questionType = paper.questionType || 'traditional';
      console.log(`📋 Paper question type: ${questionType}`);
      console.log(`📋 Page questions:`, pageQuestions.map(q => ({ 
        questionNumber: q.questionNumber, 
        pageNumber: q.pageNumber,
        questionType: q.questionType 
      })));
      
      if (questionType === 'omr' || questionType === 'mixed') {
        // Use OMR detection
        console.log(`🤖 Using OMR detection for page ${page.pageNumber}...`);
        const omrResult = await omrService.detectOMRAnswers(imageBuffer, pageQuestions);
        console.log(`📊 OMR result:`, omrResult);
        
        if (omrResult && omrResult.detected_answers) {
          console.log(`✅ OMR detected ${omrResult.detected_answers.length} answers`);
          pageAnswers = omrResult.detected_answers.map(answer => ({
            question_number: answer.question,
            selected_option: answer.selected_options && answer.selected_options.length > 0 
              ? answer.selected_options[0].toUpperCase() : '',
            selected_options: answer.selected_options ? answer.selected_options.map(opt => opt.toUpperCase()) : [],
            confidence: answer.confidence || 'medium'
          }));
          console.log(`🔍 Converted OMR answers:`, pageAnswers);
        } else {
          console.log(`❌ OMR detection failed, falling back to Gemini`);
        }
      }
      
      if (pageAnswers.length === 0) {
        // Fall back to traditional Gemini extraction
        console.log(`🤖 Gemini extraction for page ${page.pageNumber}...`);
        const geminiResult = await geminiService.extractStudentAnswersFromBuffer(imageBuffer);
        if (geminiResult.success && geminiResult.answers) {
          console.log(`📄 Gemini extracted ${geminiResult.answers.length} answers from page ${page.pageNumber}`);
          console.log('🔍 Raw Gemini answers:', geminiResult.answers);
          
          // Convert Gemini format to expected format and filter by page questions
          pageAnswers = geminiResult.answers
            .filter(answer => pageQuestions.some(q => q.questionNumber === answer.question))
            .map(answer => ({
              question_number: answer.question,
              selected_option: answer.selectedOption ? answer.selectedOption.toUpperCase() : '',
              selected_options: answer.selectedOptions ? answer.selectedOptions.map(opt => opt.toUpperCase()) : [],
              confidence: answer.confidence || 'medium'
            }));
          
          console.log(`✅ Filtered and converted ${pageAnswers.length} answers for page ${page.pageNumber}`);
          console.log('🔍 Converted answers:', pageAnswers);
        } else {
          console.error(`❌ Gemini extraction failed for page ${page.pageNumber}:`, geminiResult.error || 'Unknown error');
        }
      }
      
      // Add page-specific answers to the total
      allStudentAnswers.push(...pageAnswers);
      processedPages++;
      
      console.log(`✅ Page ${page.pageNumber} processed - found ${pageAnswers.length} answers`);
    }
    
    if (processedPages === 0) {
      return res.status(400).json({ error: 'No pages could be processed successfully' });
    }
    
    console.log(`📊 Total answers extracted from ${processedPages} pages: ${allStudentAnswers.length}`);
    
    // Evaluate answers
    console.log('📊 Evaluating answers...');
    
    // Detect if this is a manual test with weightages
    const hasWeightages = questions.some(q => q.weightages && Object.keys(q.weightages).length > 0);
    const evaluationMethod = hasWeightages ? 'manual_test' : 'gemini_vision';
    
    console.log(`🎯 Using evaluation method: ${evaluationMethod}${hasWeightages ? ' (weightage-based)' : ' (traditional)'}`);
    console.log('🔍 Debug - Questions structure:', questions.map(q => ({ 
      question_number: q.questionNumber, 
      correct_options: q.correctOptions,
      weightages: q.weightages || {}
    })));
    console.log('🔍 Debug - Student answers:', allStudentAnswers);
    
    const evaluationResult = evaluateAnswers(questions, allStudentAnswers, 'multiple_choice', evaluationMethod);
    console.log('🔍 Debug - Evaluation result:', evaluationResult);
    console.log('📊 Score breakdown:', {
      totalScore: evaluationResult.score || evaluationResult.totalScore,
      maxScore: evaluationResult.maxPossibleScore || evaluationResult.totalQuestions,
      resultsCount: evaluationResult.results?.length || 0
    });
    
    // Debug: Log first few results to understand scoring structure
    if (evaluationResult.results && evaluationResult.results.length > 0) {
      console.log('🔍 Sample question results:');
      evaluationResult.results.slice(0, 3).forEach((result, i) => {
        console.log(`  Q${result.questionNumber}: score=${result.partialScore || (result.isCorrect ? 1 : 0)}, max=${result.maxPoints || 1}, correct=${result.isCorrect}`);
      });
    }
    
    // Create or update submission in database
    const maxScore = evaluationResult.maxPossibleScore || evaluationResult.totalQuestions;
    
    const submissionData = {
      paperId: parseInt(paperId),
      studentName: studentName,
      rollNo: rollNo,
      score: evaluationResult.score,
      totalQuestions: evaluationResult.totalQuestions,
      percentage: evaluationResult.percentage,
      evaluationStatus: 'evaluated',
      evaluationMethod: `pending_file_${evaluationResult.evaluationMethod || 'traditional'}`,
      imageUrl: source === 'database' ? existingSubmission.imageUrl : fileId,
      answerTypes: evaluationResult.answerTypes || {},
      submittedAt: existingSubmission ? existingSubmission.submittedAt : new Date()
    };
    
    let submission;
    try {
      submission = await retryDatabaseOperation(async () => {
        return await prisma.$transaction(async (tx) => {
          let txSubmission;
          
          if (existingSubmission) {
            // Update existing submission
            txSubmission = await tx.studentSubmission.update({
              where: { id: existingSubmission.id },
              data: submissionData
            });
            
            // Delete old answers
            await tx.studentAnswer.deleteMany({
              where: { submissionId: existingSubmission.id }
            });
          } else {
            // Create new submission
            txSubmission = await tx.studentSubmission.create({
              data: submissionData
            });
          }
          
          // Store individual answers in batch
          if (evaluationResult.results && evaluationResult.results.length > 0) {
            const answerData = evaluationResult.results.map(result => ({
              submissionId: txSubmission.id,
              questionNumber: result.questionNumber || 0,
              selectedOption: result.selectedOption || (result.studentOption ? result.studentOption.split(',')[0] : ''),
              selectedOptions: result.selectedOptions && result.selectedOptions.length > 0 
                ? result.selectedOptions 
                : (result.studentOption ? result.studentOption.split(',') : [result.selectedOption || '']),
              isCorrect: result.isCorrect || false,
              textAnswer: result.details || result.textAnswer || null,
              blankAnswers: result.blankAnswers || {},
              answerType: result.answerType || 'multiple_choice',
              // NEW: Store detailed scoring information
              partialScore: result.partialScore ?? (result.isCorrect ? 1 : 0),
              maxPoints: result.maxPoints ?? 1,
              details: result.details || null,
              weightageBreakdown: result.weightageBreakdown || []
            }));
            
            console.log(`📊 Storing ${answerData.length} answers with scoring details`);
            answerData.forEach((answer, i) => {
              console.log(`  Q${answer.questionNumber}: ${answer.partialScore}/${answer.maxPoints} points (${answer.isCorrect ? '✓' : '✗'})`);
            });
            
            // Use createMany for better performance
            await tx.studentAnswer.createMany({
              data: answerData
            });
          }
          
          return txSubmission;
        }, {
          timeout: 30000, // 30 seconds timeout
          maxWait: 5000   // 5 seconds max wait for transaction to start
        });
      }, 3, 2000); // 3 retries with 2 second delay
    } catch (transactionError) {
      console.error('❌ PENDING file evaluation transaction error:', transactionError);
      throw new Error(`Database transaction failed: ${transactionError.message}`);
    }
    
    // Rename file from PENDING_ to final format (only for Google Drive files)
    console.log(`🔍 Rename check - Source: ${source}, FileId: ${fileId}, Source check: ${source !== 'database'}, FileId check: ${!!fileId}`);
    if (source !== 'database' && fileId) {
      try {
        console.log(`🔄 Attempting to rename file - Source: ${source}, FileId: ${fileId}`);
        console.log(`📝 Student: ${studentName}, Roll: ${rollNo}, Paper: ${paper.name}`);
        
        // Clean up the filename to avoid special characters
        const cleanStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanRollNo = rollNo.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanPaperName = paper.name.replace(/[^a-zA-Z0-9]/g, '_');
        const score = evaluationResult.score;
        const total = evaluationResult.totalQuestions;
        const percentage = Math.round(evaluationResult.percentage);
        
        // Extract page number from the original filename if it exists
        let pageNumber = '1'; // default page
        if (fileName) {
          const pageMatch = fileName.match(/pending_.+_.+_.+_(\d+)\.png$/i);
          if (pageMatch) {
            pageNumber = pageMatch[1];
          }
        }
        
        // Use exact format: {evaluated}_{name}_{rollno}_{testname}_{pageno}_{score%}.png
        const finalFileName = `evaluated_${cleanStudentName}_${cleanRollNo}_${cleanPaperName}_${pageNumber}_${percentage}%.png`;
        console.log(`📝 Final filename: ${finalFileName}`);
        
        await minioService.renameFile(fileId, finalFileName);
        console.log(`✅ Successfully renamed file to: ${finalFileName}`);
      } catch (renameError) {
        console.error('❌ Failed to rename file:', renameError);
        console.error('❌ Rename error details:', {
          source,
           fileId,
          studentName,
          rollNo,
          paperName: paper.name,
          error: renameError.message
        });
        // Don't fail the evaluation if renaming fails
      }
    } else {
      console.log(`ℹ️ Skipping file rename - Source: ${source}, FileId: ${fileId}`);
    }
    
    console.log(`✅ Evaluation completed for ${studentName} (Roll: ${rollNo})`);
    console.log(`📊 Score: ${evaluationResult.score}/${evaluationResult.maxPossibleScore || evaluationResult.totalQuestions} (${evaluationResult.percentage}%)`);
    
    // Clean up PENDING_ files by renaming them to EVALUATED_
    if (pagesToProcess.some(page => page.fileId)) {
      console.log(`🧹 Cleaning up ${pagesToProcess.filter(p => p.fileId).length} pending files...`);
      
      for (const page of pagesToProcess) {
        if (page.fileId && page.fileName && page.fileName.startsWith('pending_')) {
          try {
            const evaluatedFileName = page.fileName.replace('pending_', 'evaluated_');
            await minioService.renameFile(page.fileId, evaluatedFileName);
            console.log(`✅ Renamed ${page.fileName} to ${evaluatedFileName}`);
          } catch (renameError) {
            console.error(`⚠️ Failed to rename file ${page.fileName}:`, renameError.message);
            // Continue with evaluation even if rename fails
          }
        }
      }
    }
    
    res.json({
      success: true,
      message: 'Evaluation completed successfully',
      submissionId: submission.id,
      studentName: studentName,
      rollNo: rollNo,
      score: evaluationResult.score,
      totalQuestions: evaluationResult.totalQuestions,
      maxPossibleScore: evaluationResult.maxPossibleScore,
      percentage: evaluationResult.percentage,
      evaluationStatus: 'evaluated',
      fileName: pagesToProcess.length > 1 
        ? `${studentName}_${pagesToProcess.length}_pages_evaluated` 
        : (fileName || `DB_Submission_${submissionId}`)
    });
    
  } catch (error) {
    console.error('❌ PENDING file evaluation error:', error);
    
    // Provide more specific error messages based on error type
    let errorMessage = 'Failed to evaluate pending file';
    let statusCode = 500;
    
    if (error.message.includes('Transaction not found')) {
      errorMessage = 'Database transaction timeout. Please try again.';
      statusCode = 408; // Request Timeout
    } else if (error.message.includes('toLowerCase is not a function')) {
      errorMessage = 'File processing error. Invalid file format.';
      statusCode = 400; // Bad Request
    } else if (error.message.includes('Roll number')) {
      errorMessage = 'Could not extract roll number from submission.';
      statusCode = 422; // Unprocessable Entity
    } else if (error.message.includes('Gemini')) {
      errorMessage = 'AI evaluation service error. Please try again.';
      statusCode = 503; // Service Unavailable
    } else if (error.message.includes('Database transaction failed')) {
      errorMessage = 'Database operation failed. Please try again.';
      statusCode = 503; // Service Unavailable
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Debug endpoint: Reset submission to pending status for testing
router.post('/reset-to-pending/:submissionId', async (req, res) => {
  try {
    const submissionId = parseInt(req.params.submissionId);
    
    await prisma.studentSubmission.update({
      where: { id: submissionId },
      data: {
        evaluationStatus: 'pending',
        score: 0,
        totalQuestions: 0,
        percentage: 0
      }
    });
    
    // Delete existing answers
    await prisma.studentAnswer.deleteMany({
      where: { submissionId: submissionId }
    });
    
    res.json({ success: true, message: 'Submission reset to pending status' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export submissions to Excel
router.get('/export-excel/:paperId', async (req, res) => {
  try {
    const paperId = parseInt(req.params.paperId);
    
    // Get paper details
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: { name: true }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    // Get all submissions for this paper
    const submissions = await prisma.studentSubmission.findMany({
      where: { paperId: paperId },
      select: {
        rollNo: true,
        studentName: true,
        score: true,
        totalQuestions: true,
        evaluationStatus: true,
        submittedAt: true
      },
      orderBy: { rollNo: 'asc' }
    });

    // Get paper details for total marks
    const paperDetails = await prisma.paper.findUnique({
      where: { id: paperId },
      select: { totalMarks: true }
    });

    const totalMarks = paperDetails?.totalMarks || null;
    
    // Prepare Excel data
    const excelData = submissions.map(submission => {
      let scoreStatus;
      
      if (submission.evaluationStatus === 'evaluated') {
        // Use totalMarks from paper if available, otherwise fall back to totalQuestions
        const maxScore = totalMarks || submission.totalQuestions;
        scoreStatus = `${submission.score}/${maxScore}`;
      } else {
        scoreStatus = 'not evaluated';
      }
      
      return {
        'Roll No': submission.rollNo,
        'Name': submission.studentName,
        [paper.name]: scoreStatus
      };
    });
    
    // Create workbook and worksheet
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(excelData);
    
    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Submissions');
    
    // Generate Excel buffer
    const excelBuffer = xlsx.write(workbook, { 
      bookType: 'xlsx', 
      type: 'buffer' 
    });
    
    // Set headers for file download
    const fileName = `${paper.name.replace(/[^a-zA-Z0-9]/g, '_')}_submissions.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    // Send the Excel file
    res.send(excelBuffer);
    
  } catch (error) {
    console.error('Error exporting submissions to Excel:', error);
    res.status(500).json({ error: 'Failed to export submissions to Excel' });
  }
});

module.exports = router;
