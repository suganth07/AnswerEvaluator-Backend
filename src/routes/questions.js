const express = require("express");
const prisma = require("../prisma");

const router = express.Router();

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(400).json({ error: "Invalid token" });
  }
};

// Get all questions for a specific paper
router.get("/paper/:paperId", verifyToken, async (req, res) => {
  try {
    const paperId = parseInt(req.params.paperId);

    // Verify paper exists and get questions
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        questions: {
          orderBy: { questionNumber: 'asc' }
        }
      }
    });

    if (!paper) {
      return res.status(404).json({ error: "Paper not found" });
    }

    const questions = paper.questions;

    // Transform questions to ensure frontend compatibility
    const transformedQuestions = questions.map(q => ({
      ...q,
      // Add backward compatibility fields
      correct_option: q.correctOptions && q.correctOptions.length > 0 && q.options 
        ? q.options[q.correctOptions[0]] || q.correctOptions[0] 
        : null,
      correct_options: q.correctOptions,
      // Ensure proper field naming for frontend
      question_number: q.questionNumber,
      question_text: q.questionText,
      page_number: q.pageNumber,
      question_type: q.questionType,
      question_format: q.questionFormat,
      points_per_blank: q.pointsPerBlank,
      blank_positions: q.blankPositions,
      expected_answers: q.expectedAnswers
    }));

    // Debug: log what we're returning
    console.log(`📊 Returning ${transformedQuestions.length} questions for paper ${paperId}:`);
    transformedQuestions.forEach(q => {
      console.log(`  Q${q.question_number}: format=${q.question_format}, correct_option="${q.correct_option}", correct_options=${JSON.stringify(q.correct_options)}`);
    });

    res.json({
      paper: { id: paper.id, name: paper.name },
      questions: transformedQuestions,
      totalQuestions: transformedQuestions.length,
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// Get a specific question by ID
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);

    const question = await prisma.question.findUnique({
      where: { id: questionId }
    });

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    // Transform question for frontend compatibility
    const transformedQuestion = {
      ...question,
      correct_option: question.correctOptions && question.correctOptions.length > 0 && question.options 
        ? question.options[question.correctOptions[0]] || question.correctOptions[0] 
        : null,
      correct_options: question.correctOptions,
      question_number: question.questionNumber,
      question_text: question.questionText,
      page_number: question.pageNumber,
      question_type: question.questionType,
      question_format: question.questionFormat,
      points_per_blank: question.pointsPerBlank,
      blank_positions: question.blankPositions,
      expected_answers: question.expectedAnswers
    };

    res.json(transformedQuestion);
  } catch (error) {
    console.error("Error fetching question:", error);
    res.status(500).json({ error: "Failed to fetch question" });
  }
});

// Create a new question
router.post("/", verifyToken, async (req, res) => {
  try {
    const {
      paper_id,
      question_number,
      question_text,
      correct_options, // Only use correct_options array
      correct_option, // Also accept correct_option for single-answer mode
      page_number = 1,
      question_type = "traditional",
      options,
      weightages, // Add weightages support
      points_per_blank = 1, // Add points support
    } = req.body;

    // Validate required fields
    if (!paper_id || !question_number) {
      return res.status(400).json({
        error: "Missing required fields: paper_id and question_number",
      });
    }

    // Validate correct_options OR correct_option
    if (!correct_options && !correct_option) {
      return res.status(400).json({
        error: "Either correct_options (array) or correct_option (string) is required",
      });
    }

    // If correct_options is provided, validate it
    if (correct_options) {
      if (!Array.isArray(correct_options) || correct_options.length === 0) {
        return res.status(400).json({
          error: "correct_options must be a non-empty array",
        });
      }
    }

    // Verify paper exists
    const paper = await prisma.paper.findUnique({
      where: { id: parseInt(paper_id) }
    });
    
    if (!paper) {
      return res.status(404).json({ error: "Paper not found" });
    }

    // Check if question number already exists for this paper
    const existingQuestion = await prisma.question.findFirst({
      where: {
        paperId: parseInt(paper_id),
        questionNumber: question_number
      }
    });

    if (existingQuestion) {
      return res.status(400).json({
        error: `Question number ${question_number} already exists for this paper`,
      });
    }

    // Insert new question
    const question = await prisma.question.create({
      data: {
        paperId: parseInt(paper_id),
        questionNumber: question_number,
        questionText: question_text,
        correctOptions: correct_options || (correct_option ? [correct_option] : []),
        pageNumber: page_number,
        questionType: question_type,
        options: options || undefined,
        weightages: weightages || undefined,
        pointsPerBlank: points_per_blank
      }
    });

    // Transform response for frontend compatibility
    const transformedQuestion = {
      ...question,
      correct_option: question.correctOptions && question.correctOptions.length > 0 && question.options 
        ? question.options[question.correctOptions[0]] || question.correctOptions[0] 
        : null,
      correct_options: question.correctOptions,
      question_number: question.questionNumber,
      question_text: question.questionText,
      page_number: question.pageNumber,
      question_type: question.questionType,
      question_format: question.questionFormat,
      points_per_blank: question.pointsPerBlank
    };

    res.status(201).json({
      message: "Question created successfully",
      question: transformedQuestion,
    });
  } catch (error) {
    console.error("Error creating question:", error);
    res.status(500).json({ error: "Failed to create question" });
  }
});

// Update a question
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const {
      question_number,
      question_text,
      correct_options, // Only use correct_options array
      correct_option, // Also accept correct_option for single-answer mode
      page_number,
      question_type,
      options,
      weightages, // Add weightages support
      points_per_blank, // Add points support
    } = req.body;

    // Debug logging to see what data we're receiving
    console.log(`📝 Updating question ${questionId} with data:`, {
      question_number,
      question_text: question_text ? question_text.substring(0, 50) + '...' : question_text,
      correct_options,
      correct_option,
      page_number,
      question_type,
      options,
      weightages,
      points_per_blank
    });

    // Check if question exists
    const existingQuestion = await prisma.question.findUnique({
      where: { id: questionId }
    });
    
    if (!existingQuestion) {
      return res.status(404).json({ error: "Question not found" });
    }

    // If question_number is being changed, check for duplicates
    if (question_number && question_number !== existingQuestion.questionNumber) {
      const duplicateCheck = await prisma.question.findFirst({
        where: {
          paperId: existingQuestion.paperId,
          questionNumber: question_number,
          id: { not: questionId }
        }
      });

      if (duplicateCheck) {
        return res.status(400).json({
          error: `Question number ${question_number} already exists for this paper`,
        });
      }
    }

    // Validate correct_options if provided
    if (correct_options !== undefined && correct_options !== null) {
      if (!Array.isArray(correct_options)) {
        return res.status(400).json({
          error: "correct_options must be an array",
        });
      }
      // Allow empty array for clearing correct options
    }

    // Build update data object
    const updateData = {};
    if (question_number !== undefined) updateData.questionNumber = question_number;
    if (question_text !== undefined) updateData.questionText = question_text;
    if (correct_options !== undefined) updateData.correctOptions = correct_options;
    if (page_number !== undefined) updateData.pageNumber = page_number;
    if (question_type !== undefined) updateData.questionType = question_type;
    if (options !== undefined) updateData.options = options;
    if (weightages !== undefined) updateData.weightages = weightages;
    if (points_per_blank !== undefined) updateData.pointsPerBlank = points_per_blank;

    console.log(`📊 Final update data for question ${questionId}:`, updateData);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const question = await prisma.question.update({
      where: { id: questionId },
      data: updateData
    });

    // Transform response for frontend compatibility
    const transformedQuestion = {
      ...question,
      correct_option: question.correctOptions && question.correctOptions.length > 0 && question.options 
        ? question.options[question.correctOptions[0]] || question.correctOptions[0] 
        : null,
      correct_options: question.correctOptions,
      question_number: question.questionNumber,
      question_text: question.questionText,
      page_number: question.pageNumber,
      question_type: question.questionType,
      question_format: question.questionFormat,
      points_per_blank: question.pointsPerBlank
    };

    res.json({
      message: "Question updated successfully",
      question: transformedQuestion,
    });
  } catch (error) {
    console.error("Error updating question:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

// Delete a question
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);

    // Check if question exists
    const question = await prisma.question.findUnique({
      where: { id: questionId }
    });

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    // Delete the question
    await prisma.question.delete({
      where: { id: questionId }
    });

    res.json({ message: "Question deleted successfully" });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

module.exports = router;
