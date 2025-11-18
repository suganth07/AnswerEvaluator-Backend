const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanupDuplicateSubmissions() {
  try {
    console.log('🧹 Starting cleanup of duplicate submissions...');
    
    // Find all submissions for each paper
    const allSubmissions = await prisma.studentSubmission.findMany({
      orderBy: [
        { paperId: 'asc' },
        { submittedAt: 'desc' }
      ]
    });
    
    console.log(`📊 Found ${allSubmissions.length} total submissions`);
    
    // Group by paper and student
    const groups = {};
    allSubmissions.forEach(submission => {
      const key = `${submission.paperId}_${submission.studentName}_${submission.rollNo}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(submission);
    });
    
    let duplicatesRemoved = 0;
    
    for (const [key, submissions] of Object.entries(groups)) {
      if (submissions.length > 1) {
        console.log(`🔍 Found ${submissions.length} submissions for ${key}`);
        
        // Keep the evaluated one if it exists, otherwise keep the most recent
        const evaluatedSubmissions = submissions.filter(s => s.evaluationStatus === 'evaluated');
        const pendingSubmissions = submissions.filter(s => s.evaluationStatus === 'pending');
        
        let toKeep;
        let toDelete = [];
        
        if (evaluatedSubmissions.length > 0) {
          // Keep the most recent evaluated submission
          toKeep = evaluatedSubmissions[0];
          toDelete = [...evaluatedSubmissions.slice(1), ...pendingSubmissions];
        } else {
          // Keep the most recent pending submission
          toKeep = submissions[0];
          toDelete = submissions.slice(1);
        }
        
        console.log(`✅ Keeping submission ID: ${toKeep.id} (${toKeep.evaluationStatus})`);
        
        for (const submission of toDelete) {
          console.log(`❌ Deleting duplicate submission ID: ${submission.id} (${submission.evaluationStatus})`);
          
          // Delete related answers first
          await prisma.studentAnswer.deleteMany({
            where: { submissionId: submission.id }
          });
          
          // Delete the submission
          await prisma.studentSubmission.delete({
            where: { id: submission.id }
          });
          
          duplicatesRemoved++;
        }
      }
    }
    
    console.log(`🎉 Cleanup completed! Removed ${duplicatesRemoved} duplicate submissions`);
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupDuplicateSubmissions();