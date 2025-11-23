const { PrismaClient } = require('@prisma/client');

async function checkSystemStatus() {
  const prisma = new PrismaClient();
  
  try {
    // Ensure connection is established
    await prisma.$connect();
    
    console.log('🔍 System Status Check');
    console.log('='.repeat(50));
    
    // Check all submissions
    const submissions = await prisma.submission.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`📊 Total submissions: ${submissions.length}`);
    
    submissions.forEach((sub, index) => {
      console.log(`${index + 1}. ID: ${sub.id}, Roll: ${sub.rollNo}, Status: ${sub.evaluationStatus}, Test: ${sub.testPaperId}`);
    });
    
    // Check for duplicates by grouping
    const duplicateCheck = await prisma.submission.findMany({
      select: { 
        id: true, 
        testPaperId: true, 
        rollNo: true, 
        evaluationStatus: true,
        createdAt: true
      },
      orderBy: [
        { testPaperId: 'asc' },
        { rollNo: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    // Manual duplicate detection
    const seen = new Set();
    const duplicates = [];
    
    duplicateCheck.forEach(sub => {
      const key = `${sub.testPaperId}-${sub.rollNo}`;
      if (seen.has(key)) {
        duplicates.push(sub);
      } else {
        seen.add(key);
      }
    });
    
    console.log(`\n⚠️ Duplicate submissions found: ${duplicates.length}`);
    if (duplicates.length > 0) {
      duplicates.forEach(dup => {
        console.log(`   - ID: ${dup.id}, Roll: ${dup.rollNo}, Test: ${dup.testPaperId}`);
      });
    }
    
    console.log('\n✅ System Status Check Complete');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
checkSystemStatus().catch(console.error);