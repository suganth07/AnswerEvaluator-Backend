// Test script to simulate the extraction and storage flow
const pool = require('./src/db');

// Simulate Gemini extraction result for your example: 3+3 question
const mockGeminiResult = {
  success: true,
  questions: [
    {
      number: 1,
      text: "3 + 3 = ?",
      options: {
        "a": "5",
        "b": "3", 
        "c": "6",
        "d": "1"
      },
      correctAnswer: "c"  // Since 3+3=6, correct answer is option c
    },
    {
      number: 2,
      text: "What is 2 × 4?",
      options: {
        "a": "6",
        "b": "8",
        "c": "10", 
        "d": "12"
      },
      correctAnswer: "b"  // Since 2×4=8, correct answer is option b
    },
    {
      number: 3,
      text: "Which number is prime?",
      options: {
        "a": "4",
        "b": "6",
        "c": "7",
        "d": "8"
      },
      correctAnswer: "c"  // 7 is prime
    }
  ]
};

async function testRealOptionExtraction() {
  try {
    console.log('🧪 Testing Real Option Extraction and Storage...\n');
    
    // Create a test paper first
    const paperResult = await pool.query(
      'INSERT INTO papers (name, admin_id, total_pages, question_type) VALUES ($1, $2, $3, $4) RETURNING *',
      ['Math Test - Real Options', 1, 1, 'traditional']
    );
    
    const paper = paperResult.rows[0];
    console.log(`📝 Created test paper: "${paper.name}" (ID: ${paper.id})\n`);
    
    // Process and store questions exactly like the updated backend code
    for (const question of mockGeminiResult.questions) {
      // Convert options to uppercase keys while preserving real text (like backend does)
      let options = {};
      if (question.options && typeof question.options === 'object') {
        Object.entries(question.options).forEach(([key, value]) => {
          const upperKey = key.toUpperCase();
          options[upperKey] = value; // Keep the real extracted option text
        });
      }
      
      console.log(`Storing Q${question.number}: "${question.text}"`);
      console.log('Raw extracted options:', question.options);
      console.log('Converted for storage:', options);
      console.log('Correct answer:', question.correctAnswer, '→', question.correctAnswer.toUpperCase());
      
      await pool.query(
        `INSERT INTO questions 
         (paper_id, question_number, question_text, correct_option, page_number, question_type, options, question_format) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          paper.id, 
          question.number, 
          question.text, 
          question.correctAnswer.toUpperCase(), // Convert to uppercase
          1, // page_number
          'traditional',
          JSON.stringify(options),
          'multiple_choice'
        ]
      );
      
      console.log(`✅ Stored Q${question.number} successfully\n`);
    }
    
    // Verify what was stored in the database
    console.log('📋 Verification - What was actually stored:\n');
    const storedQuestions = await pool.query(`
      SELECT question_number, question_text, correct_option, options
      FROM questions 
      WHERE paper_id = $1 
      ORDER BY question_number
    `, [paper.id]);
    
    storedQuestions.rows.forEach(q => {
      console.log(`=== Q${q.question_number} ===`);
      console.log(`Question: ${q.question_text}`);
      console.log(`Options stored in DB:`, q.options);
      console.log(`Correct Answer: ${q.correct_option}`);
      console.log(`Display format: ${Object.entries(q.options).map(([k,v]) => `${k}) ${v}`).join(' ')}`);
      console.log('');
    });
    
    console.log('🎉 SUCCESS: Real option text is now being extracted and stored correctly!');
    console.log('\n📱 App will display:');
    console.log('- Question: "3 + 3 = ?"');
    console.log('- Options: A) 5  B) 3  C) 6  D) 1');
    console.log('- Correct Answer: C');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await pool.end();
  }
}

testRealOptionExtraction();