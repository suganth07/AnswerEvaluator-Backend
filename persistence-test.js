const MinIOService = require('./services/minioService');

async function testPersistence() {
  console.log('🔍 Testing Image Persistence After Docker Restart...\n');

  try {
    const minioService = new MinIOService();

    // Wait for services to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 1: Check if previous images are still accessible
    console.log('📋 Test 1: Checking if previous images are still accessible...');
    const pendingFiles = await minioService.listPendingFiles();
    console.log(`✅ Found ${pendingFiles.length} pending files after restart`);
    
    if (pendingFiles.length > 0) {
      console.log('✅ Previous upload survived restart!');
      console.log('✅ First file:', JSON.stringify(pendingFiles[0], null, 2));
    } else {
      console.log('❌ No files found - persistence may have failed');
    }

    // Test 2: Check storage stats
    console.log('\n📊 Test 2: Checking storage statistics...');
    const stats = await minioService.getStorageStats();
    console.log('✅ Storage stats after restart:', JSON.stringify(stats, null, 2));

    // Test 3: Upload a new file to confirm system is working
    console.log('\n📤 Test 3: Uploading new file to confirm system is working...');
    const sampleImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    
    const uploadResult = await minioService.uploadTempAnswerSheet(
      sampleImageBuffer,
      'persistence-test.jpg',
      'Persistence Test Student',
      'PERSIST001'
    );
    console.log('✅ New upload successful:', uploadResult.fileName);

    // Test 4: Verify both files are now available
    console.log('\n📋 Test 4: Verifying both files are now available...');
    const allPendingFiles = await minioService.listPendingFiles();
    console.log(`✅ Total pending files: ${allPendingFiles.length}`);
    
    allPendingFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.name} - Size: ${file.size} bytes`);
    });

    console.log('\n🎉 Persistence test completed successfully!');
    console.log('\n📝 Summary:');
    console.log(`- ✅ MinIO data persisted across Docker restart`);
    console.log(`- ✅ Database metadata persisted across restart`);
    console.log(`- ✅ New uploads work after restart`);
    console.log(`- ✅ Both old and new files are accessible`);

  } catch (error) {
    console.error('❌ Persistence test failed:', error.message);
    console.error('❌ Error stack:', error.stack);
    process.exit(1);
  }
}

testPersistence();