const pool = require('./src/db.js');

async function checkDatabaseStructure() {
  try {
    console.log('🔍 Checking current database structure...\n');
    
    // Check papers table structure
    const papersResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'papers' 
      ORDER BY ordinal_position;
    `);
    
    console.log('📄 PAPERS TABLE STRUCTURE:');
    console.table(papersResult.rows);
    
    // Check questions table structure
    const questionsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'questions' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\n❓ QUESTIONS TABLE STRUCTURE:');
    console.table(questionsResult.rows);
    
    // Check submissions table structure
    const submissionsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\n📝 SUBMISSIONS TABLE STRUCTURE:');
    console.table(submissionsResult.rows);
    
    await pool.end();
    console.log('\n✅ Database structure check completed');
    
  } catch (error) {
    console.error('❌ Error checking database:', error.message);
    await pool.end();
  }
}

checkDatabaseStructure();
