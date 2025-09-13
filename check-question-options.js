const pool = require('./src/db');

async function checkQuestionOptions() {
  try {
    console.log('🔍 Checking Question Options in Database...\n');
    
    const result = await pool.query(`
      SELECT id, question_number, question_text, options 
      FROM questions 
      WHERE paper_id = 39 
      ORDER BY question_number 
      LIMIT 4
    `);
    
    result.rows.forEach(question => {
      console.log(`=== Q${question.question_number} ===`);
      console.log(`Question: ${(question.question_text || '').substring(0, 50)}...`);
      console.log(`Options:`, question.options);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkQuestionOptions();