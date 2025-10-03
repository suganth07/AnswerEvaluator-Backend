const fs = require('fs');

// Create a script that will be executed inside the Docker container
const testScript = `
const MinIOService = require('./services/minioService');
const ImageMetadataService = require('./services/imageMetadataService');

async function testImagePersistence() {
  console.log('🧪 Testing Image Persistence System from Docker container...\\n');

  try {
    const minioService = new MinIOService();
    const imageMetadataService = new ImageMetadataService();

    // Wait a moment for MinIO to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 1: Create a sample image buffer
    console.log('📝 Test 1: Creating sample image...');
    const sampleImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    console.log('✅ Sample image buffer created\\n');

    // Test 2: Upload image with metadata
    console.log('📤 Test 2: Uploading image with metadata...');
    const uploadResult = await minioService.uploadTempAnswerSheet(
      sampleImageBuffer,
      'docker-test-image.jpg',
      'Docker Test Student',
      'DOCKER001'
    );
    console.log('✅ Upload result:', JSON.stringify(uploadResult, null, 2));
    console.log('✅ Image uploaded successfully\\n');

    // Test 3: List pending files
    console.log('📋 Test 3: Listing pending files...');
    const pendingFiles = await minioService.listPendingFiles();
    console.log('✅ Pending files count:', pendingFiles.length);
    if (pendingFiles.length > 0) {
      console.log('✅ First pending file:', JSON.stringify(pendingFiles[0], null, 2));
    }
    console.log('✅ File listing test completed\\n');

    // Test 4: Get storage stats
    console.log('📊 Test 4: Getting storage statistics...');
    const stats = await minioService.getStorageStats();
    console.log('✅ Storage stats:', JSON.stringify(stats, null, 2));
    console.log('✅ Statistics retrieved successfully\\n');

    console.log('🎉 All tests completed successfully from Docker container!');

  } catch (error) {
    console.error('❌ Docker test failed:', error.message);
    console.error('❌ Error stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
testImagePersistence();
`;

// Write the script to a temporary file
fs.writeFileSync('./docker-test.js', testScript);
console.log('✅ Docker test script created');