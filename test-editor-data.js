const pool = require('./src/db');

async function testQuestionEditorData() {
  try {
    console.log('🧪 Testing Question Editor Data Loading...\n');
    
    // Simulate what the question editor will receive
    const result = await pool.query(`
      SELECT id, question_number, question_text, correct_option, correct_options, options
      FROM questions 
      WHERE paper_id = 40 
      ORDER BY question_number
    `);
    
    console.log('📝 Simulating Question Editor Loading:\n');
    
    result.rows.forEach(question => {
      console.log(`=== Editing Q${question.question_number} ===`);
      console.log(`Question: ${(question.question_text || '').substring(0, 50)}...`);
      
      // Simulate the editor's option processing
      const options = question.options;
      console.log('Raw options from DB:', options);
      
      // This is what the editor will show in the input fields
      console.log('Editor will display:');
      Object.entries(options).forEach(([key, value]) => {
        console.log(`  ${key}: "${value}"`);
      });
      
      console.log(`Correct Answer: ${question.correct_option || 'None'}`);
      console.log('');
    });
    
    console.log('✅ Question editor should now show meaningful extracted text!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await pool.end();
  }
}

testQuestionEditorData();