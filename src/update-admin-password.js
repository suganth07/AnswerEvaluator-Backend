const bcrypt = require('bcrypt');
const pool = require('./db');

async function updateAdminPassword() {
  try {
    console.log('Updating admin password...');
    
    // Hash the new password "123"
    const newPassword = '123';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update admin password
    const result = await pool.query(
      'UPDATE admins SET password_hash = $1 WHERE username = $2 RETURNING id, username',
      [hashedPassword, 'admin']
    );
    
    if (result.rows.length > 0) {
      console.log('✅ Password updated successfully for admin:', result.rows[0].username);
    } else {
      console.log('❌ Admin user not found, creating new admin...');
      
      // Create new admin user
      const insertResult = await pool.query(
        'INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        ['admin', hashedPassword]
      );
      
      console.log('✅ New admin created:', insertResult.rows[0].username);
    }
    
    // Verify the password
    const verifyResult = await pool.query('SELECT password_hash FROM admins WHERE username = $1', ['admin']);
    const isValid = await bcrypt.compare(newPassword, verifyResult.rows[0].password_hash);
    
    console.log('🔐 Password verification:', isValid ? 'SUCCESS' : 'FAILED');
    
    await pool.end();
    
  } catch (error) {
    console.error('❌ Error updating admin password:', error.message);
    process.exit(1);
  }
}

updateAdminPassword();
