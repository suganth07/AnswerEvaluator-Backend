const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixPendingSubmissions() {
  try {
    console.log('🔍 Checking for pending submissions that should be evaluated...');
    
    // Find all pending submissions
    const pendingSubmissions = await prisma.studentSubmission.findMany({
      where: {
        evaluationStatus: 'pending'
      },
      include: {
        answers: true
      }
    });
    
    console.log(`📊 Found ${pendingSubmissions.length} pending submissions`);
    
    for (const submission of pendingSubmissions) {
      console.log(`\n📋 Checking submission ID: ${submission.id}`);
      console.log(`   Student: ${submission.studentName}, Roll: ${submission.rollNo}`);
      console.log(`   Paper: ${submission.paperId}, Score: ${submission.score}`);
      console.log(`   Answers: ${submission.answers.length}`);
      
      // Check if there's already an evaluated submission for the same student/paper
      const evaluatedVersion = await prisma.studentSubmission.findFirst({
        where: {
          paperId: submission.paperId,
          rollNo: submission.rollNo,
          evaluationStatus: 'evaluated',
          NOT: {
            id: submission.id
          }
        }
      });
      
      if (evaluatedVersion) {
        console.log(`   ✅ Found evaluated version: ID ${evaluatedVersion.id}`);
        console.log(`   ❌ Deleting duplicate pending submission...`);
        
        // Delete the pending submission
        await prisma.studentAnswer.deleteMany({
          where: { submissionId: submission.id }
        });
        
        await prisma.studentSubmission.delete({
          where: { id: submission.id }
        });
        
        console.log(`   ✅ Deleted pending submission ID: ${submission.id}`);
        
      } else if (submission.answers.length > 0 && submission.score > 0) {
        // This submission has answers and a score but is still marked as pending
        console.log(`   🔄 This submission appears to be evaluated but marked as pending`);
        console.log(`   🔄 Updating status to evaluated...`);
        
        await prisma.studentSubmission.update({
          where: { id: submission.id },
          data: {
            evaluationStatus: 'evaluated'
          }
        });
        
        console.log(`   ✅ Updated submission ID: ${submission.id} to evaluated status`);
        
      } else {
        console.log(`   ℹ️ Submission appears to be legitimately pending`);
      }
    }
    
    console.log('\n🎉 Fix completed!');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixPendingSubmissions();