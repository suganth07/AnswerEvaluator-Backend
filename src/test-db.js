const pool = require('./db');

async function testConnection() {
  try {
    console.log('Testing database connection...');
    
    const client = await pool.connect();
    console.log('✅ Successfully connected to Neon PostgreSQL database!');
    
    // Test query
    const result = await client.query('SELECT NOW() as current_time');
    console.log('📅 Current time from database:', result.rows[0].current_time);
    
    // Test if tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log('📋 Available tables:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    client.release();
    console.log('🔌 Connection closed successfully');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
