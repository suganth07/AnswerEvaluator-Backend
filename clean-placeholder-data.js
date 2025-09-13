const pool = require('./src/db');

async function cleanPlaceholderData() {
  try {
    console.log('🧹 Cleaning placeholder data from database...\n');
    
    // First, show what we're about to remove
    const currentData = await pool.query(`
      SELECT p.id, p.name, COUNT(q.id) as question_count
      FROM papers p 
      LEFT JOIN questions q ON p.id = q.paper_id 
      GROUP BY p.id, p.name
      ORDER BY p.id DESC
    `);
    
    console.log('📋 Current papers in database:');
    currentData.rows.forEach(paper => {
      console.log(`- Paper ${paper.id}: "${paper.name}" (${paper.question_count} questions)`);
    });
    
    if (currentData.rows.length === 0) {
      console.log('✅ Database is already clean - no papers found');
      return;
    }
    
    console.log('\n🗑️ Removing all placeholder data...');
    
    // Delete in correct order due to foreign key constraints
    
    // 1. Delete student answers
    const answersResult = await pool.query('DELETE FROM student_answers RETURNING id');
    console.log(`✓ Deleted ${answersResult.rows.length} student answers`);
    
    // 2. Delete student submissions  
    const submissionsResult = await pool.query('DELETE FROM student_submissions RETURNING id');
    console.log(`✓ Deleted ${submissionsResult.rows.length} student submissions`);
    
    // 3. Delete questions
    const questionsResult = await pool.query('DELETE FROM questions RETURNING id');
    console.log(`✓ Deleted ${questionsResult.rows.length} questions`);
    
    // 4. Delete papers
    const papersResult = await pool.query('DELETE FROM papers RETURNING id');
    console.log(`✓ Deleted ${papersResult.rows.length} papers`);
    
    console.log('\n🎉 Database cleaned successfully!');
    console.log('Ready for fresh uploads with real extracted option text.');
    
  } catch (error) {
    console.error('❌ Error cleaning database:', error.message);
  } finally {
    await pool.end();
  }
}

cleanPlaceholderData();