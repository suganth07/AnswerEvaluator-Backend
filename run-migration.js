const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const runMigration = async () => {
  try {
    console.log('Starting database migration for multi-page support...');

    // Add total_pages column to papers table
    await pool.query(`
      ALTER TABLE papers 
      ADD COLUMN IF NOT EXISTS total_pages INTEGER DEFAULT 1
    `);
    console.log('✓ Added total_pages column to papers table');

    // Add page_number column to questions table  
    await pool.query(`
      ALTER TABLE questions 
      ADD COLUMN IF NOT EXISTS page_number INTEGER DEFAULT 1
    `);
    console.log('✓ Added page_number column to questions table');

    // Update existing data to have default values
    await pool.query(`UPDATE papers SET total_pages = 1 WHERE total_pages IS NULL`);
    await pool.query(`UPDATE questions SET page_number = 1 WHERE page_number IS NULL`);
    console.log('✓ Updated existing records with default values');

    // Create indexes for better performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_page_number ON questions(page_number)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_paper_page ON questions(paper_id, page_number)`);
    console.log('✓ Created performance indexes');

    console.log('\n🎉 Database migration completed successfully!');
    console.log('\nYour database now supports:');
    console.log('- Multi-page question papers');
    console.log('- Page number tracking for questions');
    console.log('- Performance optimized queries');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

runMigration();