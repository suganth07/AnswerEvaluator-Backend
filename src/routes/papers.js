const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../prisma');
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
    const papers = await prisma.paper.findMany({
      include: {
        questions: true,
        _count: {
          select: { questions: true }
        }
      },
      orderBy: {
        uploadedAt: 'desc'
      }
    });
    
    const papersWithCount = papers.map(paper => ({
      ...paper,
      question_count: paper._count.questions
    }));
    
    res.json(papersWithCount);
  } catch (error) {
    console.error('Error fetching papers:', error);
    res.status(500).json({ error: 'Failed to fetch papers' });
  }
});

// Get all papers for students (public - no authentication required)
router.get('/public', async (req, res) => {
  try {
    const papers = await prisma.paper.findMany({
      select: {
        id: true,
        name: true,
        uploadedAt: true,
        totalPages: true,
        questionType: true,
        _count: {
          select: { questions: true }
        }
      },
      orderBy: {
        uploadedAt: 'desc'
      }
    });
    
    const papersWithCount = papers.map(paper => ({
      ...paper,
      question_count: paper._count.questions
    }));
    
    res.json(papersWithCount);
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
            correctAnswers: q.correctAnswers || (q.correctAnswer && q.correctAnswer !== 'unknown' ? [q.correctAnswer] : []), // Handle multiple correct answers
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
    const paper = await prisma.paper.create({
      data: {
        name,
        adminId: req.admin.id,
        totalPages: files.length,
        questionType: overallQuestionType
      }
    });

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
      
      // Determine correct answers - use only correctOptions array
      let correctOptions = [];

      if (question.correctAnswers && Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0) {
        correctOptions = question.correctAnswers.map(a => a.toUpperCase());
      } else if (question.correctAnswer && question.correctAnswer !== 'unknown') {
        correctOptions = [question.correctAnswer.toUpperCase()];
      }

      // Ensure at least one correct answer
      if (correctOptions.length === 0) {
        console.warn(`No correct answer detected for question ${question.number}, defaulting to 'A'`);
        correctOptions = ['A'];
      }
      
      await prisma.question.create({
        data: {
          paperId: paper.id,
          questionNumber: question.number,
          questionText: question.text,
          correctOptions: correctOptions,
          pageNumber: question.page,
          questionType: question.questionType,
          options: options,
          questionFormat: question.questionFormat || 'multiple_choice',
          blankPositions: question.blankPositions || {},
          pointsPerBlank: question.totalPoints || 1
        }
      });
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
    const paperId = parseInt(req.params.id);

    // Get paper details with questions
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        questions: {
          orderBy: { questionNumber: 'asc' }
        }
      }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    res.json(paper);
  } catch (error) {
    console.error('Error fetching paper details:', error);
    res.status(500).json({ error: 'Failed to fetch paper details' });
  }
});

// Delete paper (admin only - requires authentication)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const paperId = parseInt(req.params.id);

    // Check if paper exists
    const paper = await prisma.paper.findUnique({
      where: { id: paperId }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    // Delete the paper (cascade deletes will handle related data)
    await prisma.paper.delete({
      where: { id: paperId }
    });

    console.log(`Paper with ID ${paperId} deleted successfully`);
    res.json({ message: 'Paper and all related data deleted successfully' });
  } catch (error) {
    console.error('Error deleting paper:', error);
    res.status(500).json({ error: 'Failed to delete paper' });
  }
});

module.exports = router;