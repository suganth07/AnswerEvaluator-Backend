const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function setupDatabase() {
  try {
    console.log('🔄 Setting up database...');
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connection established');
    
    // Check if admin exists
    const existingAdmin = await prisma.admin.findFirst();
    
    if (!existingAdmin) {
      console.log('👤 Creating default admin user...');
      const hashedPassword = await bcrypt.hash('123', 10);
      
      await prisma.admin.create({
        data: {
          username: 'admin',
          passwordHash: hashedPassword
        }
      });
      
      console.log('✅ Default admin created (username: admin, password: 123)');
    } else {
      console.log('✅ Admin user already exists');
    }
    
    // Verify all tables exist
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE';
    `;
    
    console.log('📊 Database tables:', tables.map(t => t.table_name).join(', '));
    
    console.log('🎉 Database setup completed successfully!');
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };