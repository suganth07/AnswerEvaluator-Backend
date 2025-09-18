const prisma = require('./src/prisma');

async function testPrismaConnection() {
  try {
    console.log('🔍 Testing Prisma connection...');
    
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Prisma client connected successfully');
    
    // Test admin count
    const adminCount = await prisma.admin.count();
    console.log(`👤 Admin users in database: ${adminCount}`);
    
    // Test papers count
    const papersCount = await prisma.paper.count();
    console.log(`📄 Papers in database: ${papersCount}`);
    
    // Test questions count
    const questionsCount = await prisma.question.count();
    console.log(`❓ Questions in database: ${questionsCount}`);
    
    // Test submissions count
    const submissionsCount = await prisma.studentSubmission.count();
    console.log(`📋 Submissions in database: ${submissionsCount}`);
    
    console.log('✅ All Prisma operations completed successfully!');
    
  } catch (error) {
    console.error('❌ Prisma connection test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPrismaConnection();