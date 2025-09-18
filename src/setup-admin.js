const bcrypt = require('bcrypt');
const prisma = require('./prisma');

async function createOrUpdateAdmin() {
  try {
    // Hash new password
    const hashedPassword = await bcrypt.hash('123', 10);

    // Upsert ensures admin is created if not found, or updated if it exists
    const admin = await prisma.admin.upsert({
      where: { username: 'admin' },
      update: { passwordHash: hashedPassword },
      create: {
        username: 'admin',
        passwordHash: hashedPassword
      }
    });

    console.log('✅ Admin user is ready:');
    console.log('Username: admin');
    console.log('Password: 123');
    console.log('Please change the password after first login!');
  } catch (error) {
    console.error('Error setting admin password:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  createOrUpdateAdmin();
}

module.exports = createOrUpdateAdmin;
