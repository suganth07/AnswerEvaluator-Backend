const express = require('express');
const multer = require('multer');
const pool = require('../db');

const router = express.Router();

// Create manual test
router.post('/create-manual', async (req, res) => {
  try {
    const { testName, questions } = req.body;
    
    if (!testName || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Test name and questions are required' });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert paper
      const paperResult = await client.query(`
        INSERT INTO papers (name, uploaded_at, total_pages, question_type, admin_id) 
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [testName, new Date(), 1, 'traditional', 1]);

      const paperId = paperResult.rows[0].id;

      // Insert questions
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        
        console.log(`📝 Processing question ${question.questionNumber}: isMultipleChoice = ${question.isMultipleChoice}, hasOptions = ${question.options ? question.options.length : 0}, singleCorrectAnswer = "${question.singleCorrectAnswer}"`);
        
        // Prepare question data
        let correctOption = null;
        let correctOptions = [];
        let options = {};
        let weightages = {};

        if (question.isMultipleChoice) {
          // Build options object
          question.options.forEach(opt => {
            options[opt.id] = opt.text;
            if (opt.isCorrect) {
              correctOptions.push(opt.id);
              weightages[opt.id] = opt.weight;
            }
          });

          // Set correct_option for single correct answer (backward compatibility)
          if (correctOptions.length === 1) {
            correctOption = correctOptions[0];
          } else if (correctOptions.length > 1) {
            correctOption = correctOptions.join(','); // Multiple options as comma-separated
          }
        } else {
          // For non-multiple choice questions, use singleCorrectAnswer
          correctOption = question.singleCorrectAnswer || null;
          console.log(`🔍 Non-multiple choice question ${question.questionNumber}: singleCorrectAnswer = "${question.singleCorrectAnswer}", stored as: "${correctOption}"`);
          
          if (!correctOption) {
            throw new Error(`Question ${question.questionNumber}: Non-multiple choice questions must have a correct answer`);
          }
        }

        // Insert question
        const questionResult = await client.query(`
          INSERT INTO questions (
            paper_id, 
            question_number, 
            question_text, 
            question_format, 
            options, 
            correct_option, 
            correct_options,
            points_per_blank,
            weightages
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
        `, [
          paperId,
          question.questionNumber,
          question.questionText,
          question.isMultipleChoice ? 'multiple_choice' : 'text',
          JSON.stringify(options),
          correctOption,
          JSON.stringify(correctOptions),
          question.totalMarks,
          JSON.stringify(weightages)
        ]);

        console.log(`✅ Inserted question ${question.questionNumber}: ${questionResult.rows[0].id}`);
      }

      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Manual test created successfully',
        paperId: paperId,
        questionsCount: questions.length
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error creating manual test:', error);
    res.status(500).json({ 
      error: 'Failed to create manual test',
      details: error.message 
    });
  }
});

// Get manual test details
router.get('/manual/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get paper details
    const paperResult = await pool.query(
      'SELECT * FROM papers WHERE id = $1',
      [id]
    );

    if (paperResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const paper = paperResult.rows[0];

    // Get questions
    const questionsResult = await pool.query(
      'SELECT * FROM questions WHERE paper_id = $1 ORDER BY question_number',
      [id]
    );

    const questions = questionsResult.rows.map(q => ({
      id: q.id,
      questionNumber: q.question_number,
      questionText: q.question_text,
      isMultipleChoice: q.question_format === 'multiple_choice',
      options: q.options || {},
      correctOptions: q.correct_options || [],
      totalMarks: q.points_per_blank || 1,
      weightages: q.weightages || {}
    }));

    res.json({
      paper,
      questions
    });

  } catch (error) {
    console.error('Error fetching manual test:', error);
    res.status(500).json({ 
      error: 'Failed to fetch test details',
      details: error.message 
    });
  }
});

// Update manual test
router.put('/manual/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { testName, questions } = req.body;

    if (!testName || !questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Test name and questions are required' });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update paper
      await client.query(`
        UPDATE papers 
        SET name = $1, question_count = $2
        WHERE id = $3
      `, [testName, questions.length, id]);

      // Delete existing questions
      await client.query('DELETE FROM questions WHERE paper_id = $1', [id]);

      // Insert updated questions
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        
        let correctOption = null;
        let correctOptions = [];
        let options = {};
        let weightages = {};

        if (question.isMultipleChoice) {
          question.options.forEach(opt => {
            options[opt.id] = opt.text;
            if (opt.isCorrect) {
              correctOptions.push(opt.id);
              weightages[opt.id] = opt.weight;
            }
          });

          if (correctOptions.length === 1) {
            correctOption = correctOptions[0];
          } else if (correctOptions.length > 1) {
            correctOption = correctOptions.join(',');
          }
        }

        await client.query(`
          INSERT INTO questions (
            paper_id, 
            question_number, 
            question_text, 
            question_format, 
            options, 
            correct_option, 
            correct_options,
            points_per_blank,
            weightages
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          id,
          question.questionNumber,
          question.questionText,
          question.isMultipleChoice ? 'multiple_choice' : 'text',
          JSON.stringify(options),
          correctOption,
          JSON.stringify(correctOptions),
          question.totalMarks,
          JSON.stringify(weightages)
        ]);
      }

      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Manual test updated successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error updating manual test:', error);
    res.status(500).json({ 
      error: 'Failed to update manual test',
      details: error.message 
    });
  }
});

module.exports = router;