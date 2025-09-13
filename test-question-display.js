const pool = require('./src/db');

async function testQuestionDisplay() {
  try {
    console.log('🧪 Testing Question Display Logic...\n');
    
    // Simulate what the React Native app will receive
    const questionsResult = await pool.query(`
      SELECT id, question_number, question_text, correct_option, correct_options, options
      FROM questions 
      WHERE paper_id = 38 
      ORDER BY question_number
    `);
    
    console.log('📱 Simulating React Native App Display:\n');
    
    questionsResult.rows.forEach(question => {
      console.log(`=== Q${question.question_number} ===`);
      console.log(`Question: ${(question.question_text || '').substring(0, 60)}...`);
      
      // Simulate correct answer display logic
      const correctAnswers = question.correct_options || (question.correct_option ? [question.correct_option] : []);
      console.log(`Correct Answer(s): ${correctAnswers.map(a => a.toUpperCase()).join(', ')}`);
      
      // Simulate options display logic
      if (question.options) {
        console.log('Options:');
        Object.entries(question.options).forEach(([key, value]) => {
          const isGenericText = value === `Option ${key}` || value === `Choice ${key}`;
          const displayText = isGenericText ? key : `${key}: ${value}`;
          console.log(`  • ${displayText}`);
        });
      }
      
      console.log('');
    });
    
    console.log('✅ All questions should display correctly in the app!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await pool.end();
  }
}

testQuestionDisplay();