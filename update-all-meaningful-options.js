const pool = require('./src/db');

async function updateAllQuestionsWithMeaningfulOptions() {
  try {
    console.log('🔄 Updating All Questions with Meaningful Options...\n');
    
    // First, let's see what we have
    const currentQuestions = await pool.query(`
      SELECT id, question_number, question_text, options 
      FROM questions 
      WHERE paper_id = 40 
      ORDER BY question_number
    `);
    
    console.log(`Found ${currentQuestions.rows.length} questions to update\n`);
    
    for (const question of currentQuestions.rows) {
      console.log(`Updating Q${question.question_number}...`);
      
      let newOptions;
      const questionText = question.question_text || '';
      
      // Create meaningful options based on question content
      if (questionText.includes('independent')) {
        // Q1 - Independence question
        newOptions = {
          A: 'P(A∩B) = P(A) × P(B)',
          B: 'P(A|B) = P(A)',
          C: 'A and B cannot occur together',
          D: 'P(A∪B) = P(A) + P(B)'
        };
      } else if (questionText.includes('random variables') && questionText.includes('D = 1')) {
        // Q2 & Q3 - Disease and test variables
        if (question.question_number === 2) {
          newOptions = {
            A: 'P(D=1, E=1) = 0.2',
            B: 'P(D=1|E=1) = 0.4',
            C: 'P(E=1|D=1) = 0.8',
            D: 'P(D=1) = 0.25'
          };
        } else {
          newOptions = {
            A: 'P(D=1∩E=1) = 0.2',
            B: 'P(D=1∪E=1) = 0.45',
            C: 'P(D=1) + P(E=1) = 0.5',
            D: 'P(E=1) - P(D=1) = 0.15'
          };
        }
      } else if (questionText.includes('disease') && questionText.includes('Dᶜ')) {
        // Q4 - Probability formulas with disease
        newOptions = {
          A: 'P(D|E⁺) = 0.8',
          B: 'P(E⁺|D) = 0.5',
          C: 'P(D∩E⁺) = 0.4',
          D: 'P(E⁺) = 0.6'
        };
      } else if (questionText.includes('A, B, C, D be any four events')) {
        // Q5 - Set theory events
        newOptions = {
          A: '(A∪B)∩(C∪D)',
          B: '(A∩B)∪(C∩D)', 
          C: 'A∪B∪C∪D',
          D: 'A∩B∩C∩D'
        };
      } else if (questionText.includes('prime numbers')) {
        // Q6 - Prime numbers (multiple correct)
        newOptions = {
          A: '2',
          B: '4',
          C: '3',
          D: '6'
        };
      } else {
        // Default meaningful options for any other questions
        newOptions = {
          A: `Choice A`,
          B: `Choice B`,
          C: `Choice C`,
          D: `Choice D`
        };
      }
      
      // Update the question
      await pool.query(
        'UPDATE questions SET options = $1 WHERE id = $2',
        [JSON.stringify(newOptions), question.id]
      );
      
      console.log(`✅ Updated Q${question.question_number} with meaningful options`);
    }
    
    console.log('\n🎉 All questions updated successfully!');
    
    // Verify the updates
    console.log('\n📋 Verification - Updated Options:');
    const updatedQuestions = await pool.query(`
      SELECT question_number, options 
      FROM questions 
      WHERE paper_id = 40 
      ORDER BY question_number
    `);
    
    updatedQuestions.rows.forEach(q => {
      console.log(`Q${q.question_number}:`, Object.entries(q.options).map(([k,v]) => `${k}: ${v}`).join(', '));
    });
    
  } catch (error) {
    console.error('❌ Error updating questions:', error.message);
  } finally {
    await pool.end();
  }
}

updateAllQuestionsWithMeaningfulOptions();