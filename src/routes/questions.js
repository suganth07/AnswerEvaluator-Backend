const express = require("express");
const pool = require("../db");

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
    const paperId = req.params.paperId;

    // Verify paper exists
    const paperResult = await pool.query(
      "SELECT id, name FROM papers WHERE id = $1",
      [paperId]
    );
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: "Paper not found" });
    }

    // Get questions for this paper
    const questionsResult = await pool.query(
      "SELECT * FROM questions WHERE paper_id = $1 ORDER BY question_number",
      [paperId]
    );

    const paper = paperResult.rows[0];
    const questions = questionsResult.rows;

    res.json({
      paper: paper,
      questions: questions,
      totalQuestions: questions.length,
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// Get a specific question by ID
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const questionId = req.params.id;

    const result = await pool.query("SELECT * FROM questions WHERE id = $1", [
      questionId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json(result.rows[0]);
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
      correct_option,
      correct_options, // Support for multiple correct answers
      page_number = 1,
      question_type = "traditional",
      options,
    } = req.body;

    // Validate required fields - either correct_option or correct_options must be provided
    if (!paper_id || !question_number || (!correct_option && !correct_options)) {
      return res.status(400).json({
        error:
          "Missing required fields: paper_id, question_number, and either correct_option or correct_options",
      });
    }

    // Validate correct_options if provided
    if (correct_options && (!Array.isArray(correct_options) || correct_options.length === 0)) {
      return res.status(400).json({
        error: "correct_options must be a non-empty array",
      });
    }

    // Verify paper exists
    const paperResult = await pool.query(
      "SELECT id FROM papers WHERE id = $1",
      [paper_id]
    );
    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: "Paper not found" });
    }

    // Check if question number already exists for this paper
    const existingQuestion = await pool.query(
      "SELECT id FROM questions WHERE paper_id = $1 AND question_number = $2",
      [paper_id, question_number]
    );

    if (existingQuestion.rows.length > 0) {
      return res.status(400).json({
        error: `Question number ${question_number} already exists for this paper`,
      });
    }

    // Insert new question with support for multiple correct answers
    const result = await pool.query(
      `INSERT INTO questions 
       (paper_id, question_number, question_text, correct_option, correct_options, page_number, question_type, options) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        paper_id,
        question_number,
        question_text,
        correct_option,
        correct_options ? JSON.stringify(correct_options) : null,
        page_number,
        question_type,
        options,
      ]
    );

    res.status(201).json({
      message: "Question created successfully",
      question: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating question:", error);
    res.status(500).json({ error: "Failed to create question" });
  }
});

// Update a question
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const questionId = req.params.id;
    const {
      question_number,
      question_text,
      correct_option,
      correct_options, // Support for multiple correct answers
      page_number,
      question_type,
      options,
    } = req.body;

    // Check if question exists
    const existingQuestion = await pool.query(
      "SELECT * FROM questions WHERE id = $1",
      [questionId]
    );
    if (existingQuestion.rows.length === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    const currentQuestion = existingQuestion.rows[0];

    // If question_number is being changed, check for duplicates
    if (
      question_number &&
      question_number !== currentQuestion.question_number
    ) {
      const duplicateCheck = await pool.query(
        "SELECT id FROM questions WHERE paper_id = $1 AND question_number = $2 AND id != $3",
        [currentQuestion.paper_id, question_number, questionId]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          error: `Question number ${question_number} already exists for this paper`,
        });
      }
    }

    // Validate correct_options if provided
    if (correct_options !== undefined && correct_options !== null) {
      if (!Array.isArray(correct_options) || correct_options.length === 0) {
        return res.status(400).json({
          error: "correct_options must be a non-empty array",
        });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (question_number !== undefined) {
      updates.push(`question_number = $${paramCount++}`);
      values.push(question_number);
    }
    if (question_text !== undefined) {
      updates.push(`question_text = $${paramCount++}`);
      values.push(question_text);
    }
    if (correct_option !== undefined) {
      updates.push(`correct_option = $${paramCount++}`);
      values.push(correct_option);
    }
    if (correct_options !== undefined) {
      updates.push(`correct_options = $${paramCount++}`);
      values.push(correct_options ? JSON.stringify(correct_options) : null);
    }
    if (page_number !== undefined) {
      updates.push(`page_number = $${paramCount++}`);
      values.push(page_number);
    }
    if (question_type !== undefined) {
      updates.push(`question_type = $${paramCount++}`);
      values.push(question_type);
    }
    if (options !== undefined) {
      updates.push(`options = $${paramCount++}`);
      values.push(options);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(questionId);
    const query = `UPDATE questions SET ${updates.join(
      ", "
    )} WHERE id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, values);

    res.json({
      message: "Question updated successfully",
      question: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating question:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

// Delete a question
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const questionId = req.params.id;

    // Get question details before deletion for paper_id
    const questionResult = await pool.query(
      "SELECT paper_id FROM questions WHERE id = $1",
      [questionId]
    );

    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    // Delete the question
    await pool.query("DELETE FROM questions WHERE id = $1", [questionId]);

    // No need to update question_count as it's calculated dynamically in papers route

    res.json({ message: "Question deleted successfully" });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

module.exports = router;
