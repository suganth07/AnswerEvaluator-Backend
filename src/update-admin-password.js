const bcrypt = require('bcrypt');
const prisma = require('./prisma');

async function updateAdminPassword() {
  try {
    console.log('Updating admin password...');
    
    // Hash the new password "123"
    const newPassword = '123';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update or create admin using upsert
    const admin = await prisma.admin.upsert({
      where: { username: 'admin' },
      update: { passwordHash: hashedPassword },
      create: {
        username: 'admin',
        passwordHash: hashedPassword
      }
    });
    
    console.log('✅ Password updated successfully for admin:', admin.username);
    
    // Verify the password
    const verifyAdmin = await prisma.admin.findUnique({
      where: { username: 'admin' }
    });
    
    const isValid = await bcrypt.compare(newPassword, verifyAdmin.passwordHash);
    console.log('🔐 Password verification:', isValid ? 'SUCCESS' : 'FAILED');
    
  } catch (error) {
    console.error('❌ Error updating admin password:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

updateAdminPassword();
