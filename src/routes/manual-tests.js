const express = require('express');
const multer = require('multer');
const prisma = require('../prisma');

const router = express.Router();

// Create manual test
router.post('/create-manual', async (req, res) => {
  try {
    const { testName, questions } = req.body;
    
    if (!testName || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Test name and questions are required' });
    }

    // Use Prisma transaction
    const result = await prisma.$transaction(async (tx) => {
      // Insert paper
      const paper = await tx.paper.create({
        data: {
          name: testName,
          uploadedAt: new Date(),
          totalPages: 1,
          questionType: 'traditional',
          adminId: 1
        }
      });

      // Insert questions
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        
        console.log(`📝 Processing question ${question.questionNumber}: isMultipleChoice = ${question.isMultipleChoice}, hasOptions = ${question.options ? question.options.length : 0}, singleCorrectAnswer = "${question.singleCorrectAnswer}"`);
        
        // Prepare question data
        let correctOptions = [];
        let options = {};
        let weightages = {};

        if (question.isMultipleChoice) {
          // Build options object
          question.options.forEach(opt => {
            options[opt.id] = opt.text;
            if (opt.isCorrect) {
              correctOptions.push(opt.id);
              // Handle weightage - allow 0 and decimal values
              const weight = parseFloat(opt.weight);
              if (!isNaN(weight) && weight >= 0) {
                weightages[opt.id] = weight;
              } else {
                // Default to 1 if invalid weight
                weightages[opt.id] = 1;
              }
              console.log(`  Option ${opt.id}: weight = ${opt.weight} → parsed as ${weightages[opt.id]}`);
            }
          });
        } else {
          // For non-multiple choice questions, use singleCorrectAnswer
          if (question.singleCorrectAnswer) {
            correctOptions = [question.singleCorrectAnswer];
          }
          
          console.log(`🔍 Non-multiple choice question ${question.questionNumber}: singleCorrectAnswer = "${question.singleCorrectAnswer}", stored as: ${JSON.stringify(correctOptions)}`);
        }

        // Ensure at least one correct answer
        if (correctOptions.length === 0) {
          throw new Error(`Question ${question.questionNumber}: Questions must have at least one correct answer`);
        }

        // Validate and parse total marks
        const totalMarks = parseFloat(question.totalMarks);
        const pointsPerBlank = !isNaN(totalMarks) && totalMarks >= 0 ? totalMarks : 1;
        
        console.log(`  Total marks: ${question.totalMarks} → parsed as ${pointsPerBlank}`);
        console.log(`  Weightages: ${JSON.stringify(weightages)}`);

        // Insert question
        const questionResult = await tx.question.create({
          data: {
            paperId: paper.id,
            questionNumber: question.questionNumber,
            questionText: question.questionText,
            questionFormat: question.isMultipleChoice ? 'multiple_choice' : 'text',
            options: options,
            correctOptions: correctOptions,
            pointsPerBlank: pointsPerBlank,
            weightages: weightages
          }
        });

        console.log(`✅ Inserted question ${question.questionNumber}: ${questionResult.id}`);
      }

      return paper;
    });
    
    res.json({
      success: true,
      message: 'Manual test created successfully',
      paperId: result.id,
      questionsCount: questions.length
    });

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

    // Get paper details with questions
    const paper = await prisma.paper.findUnique({
      where: { id: parseInt(id) },
      include: {
        questions: {
          orderBy: { questionNumber: 'asc' }
        }
      }
    });

    if (!paper) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const questions = paper.questions.map(q => ({
      id: q.id,
      questionNumber: q.questionNumber,
      questionText: q.questionText,
      isMultipleChoice: q.questionFormat === 'multiple_choice',
      options: q.options || {},
      correctOptions: q.correctOptions || [],
      totalMarks: q.pointsPerBlank || 1,
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

    // Use Prisma transaction
    await prisma.$transaction(async (tx) => {
      // Update paper
      await tx.paper.update({
        where: { id: parseInt(id) },
        data: {
          name: testName
        }
      });

      // Delete existing questions
      await tx.question.deleteMany({
        where: { paperId: parseInt(id) }
      });

      // Insert updated questions
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        
        let correctOptions = [];
        let options = {};
        let weightages = {};

        if (question.isMultipleChoice) {
          question.options.forEach(opt => {
            options[opt.id] = opt.text;
            if (opt.isCorrect) {
              correctOptions.push(opt.id);
              // Handle weightage - allow 0 and decimal values
              const weight = parseFloat(opt.weight);
              if (!isNaN(weight) && weight >= 0) {
                weightages[opt.id] = weight;
              } else {
                // Default to 1 if invalid weight
                weightages[opt.id] = 1;
              }
            }
          });
        } else if (question.singleCorrectAnswer) {
          correctOptions = [question.singleCorrectAnswer];
        }

        // Ensure at least one correct answer
        if (correctOptions.length === 0) {
          correctOptions = ['A']; // Default fallback
        }

        await tx.question.create({
          data: {
            paperId: parseInt(id),
            questionNumber: question.questionNumber,
            questionText: question.questionText,
            questionFormat: question.isMultipleChoice ? 'multiple_choice' : 'text',
            options: options,
            correctOptions: correctOptions,
            pointsPerBlank: question.totalMarks,
            weightages: weightages
          }
        });
      }
    });
    
    res.json({
      success: true,
      message: 'Manual test updated successfully'
    });

  } catch (error) {
    console.error('Error updating manual test:', error);
    res.status(500).json({ 
      error: 'Failed to update manual test',
      details: error.message 
    });
  }
});

module.exports = router;