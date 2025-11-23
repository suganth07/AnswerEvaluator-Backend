const fs = require('fs');
const path = require('path');

// Test script for Gemini-based PDF extraction
async function testGeminiPDFExtraction() {
  try {
    console.log('🤖 Starting Gemini PDF extraction test...');
    
    // Check if sample PDF exists
    const pdfPath = path.join(__dirname, '..', 'sample.pdf');
    
    if (!fs.existsSync(pdfPath)) {
      console.error('❌ Sample PDF not found at:', pdfPath);
      return;
    }
    
    console.log('✅ Found sample PDF at:', pdfPath);
    
    // Read the PDF file
    const pdfBuffer = fs.readFileSync(pdfPath);
    console.log('📄 PDF file size:', (pdfBuffer.length / 1024).toFixed(2), 'KB');
    
    // Test the updated PDF service with Gemini
    const pdfService = require('./services/pdfService.js');
    
    console.log('\n🔍 Testing Gemini-based PDF extraction...');
    const extractResult = await pdfService.extractTextFromPDF(pdfBuffer);
    
    console.log('\n📋 Extraction Results:');
    console.log('======================');
    console.log('Extraction method:', extractResult.extractionMethod);
    console.log('Pages:', extractResult.pages);
    console.log('Word count:', extractResult.wordCount);
    console.log('Line count:', extractResult.lineCount);
    
    if (extractResult.rollNumber) {
      console.log('🎯 Roll Number:', extractResult.rollNumber);
    }
    
    if (extractResult.answers) {
      console.log('📝 Extracted Answers:');
      const answerCount = Object.keys(extractResult.answers).length;
      console.log(`   Found ${answerCount} answers:`);
      
      Object.entries(extractResult.answers).forEach(([qNum, answer]) => {
        console.log(`   Question ${qNum}: ${answer}`);
      });
    }
    
    console.log('\n📄 Extracted Content:');
    console.log('---------------------');
    console.log(extractResult.text);
    console.log('---------------------');
    
    if (extractResult.geminiAnalysis) {
      console.log('\n🤖 Gemini Analysis Details:');
      console.log('Confidence:', extractResult.geminiAnalysis.confidence);
      console.log('Question Count:', extractResult.geminiAnalysis.questionCount);
      
      if (extractResult.geminiAnalysis.rawResponse) {
        console.log('\n🔍 Raw Gemini Response:');
        console.log('------------------------');
        console.log(extractResult.geminiAnalysis.rawResponse.substring(0, 500));
        if (extractResult.geminiAnalysis.rawResponse.length > 500) {
          console.log('... (truncated)');
        }
      }
    }
    
    // Test the complete PDF processing for evaluation
    console.log('\n🔬 Testing complete PDF processing...');
    try {
      const processResult = await pdfService.processPDFForEvaluation(pdfBuffer);
      
      console.log('\n📊 Processing Results:');
      console.log('Success:', processResult.success);
      console.log('Total Pages:', processResult.totalPages);
      
      if (processResult.success && processResult.pages.length > 0) {
        const firstPage = processResult.pages[0];
        console.log('First page processing time:', firstPage.processingTime);
        console.log('Image size (optimized):', firstPage.imageSize?.optimized || 'N/A');
      }
      
      if (!processResult.success) {
        console.log('❌ Processing error:', processResult.error);
      }
      
    } catch (processError) {
      console.log('⚠️ PDF processing failed (expected if no ImageMagick):', processError.message);
      console.log('💡 This is normal - Gemini extraction still works!');
    }
    
    // Test how this would work with Test1 paper (ID: 2)
    console.log('\n🎯 Testing for Test1 evaluation...');
    
    if (extractResult.answers && Object.keys(extractResult.answers).length > 0) {
      console.log('✅ Ready for evaluation!');
      
      // Format for submission
      const submissionData = {
        paperId: 2, // Test1 from database
        studentName: 'Test Student',
        rollNo: extractResult.rollNumber || '12345',
        extractedAnswers: extractResult.answers,
        extractionMethod: extractResult.extractionMethod,
        confidence: extractResult.geminiAnalysis?.confidence || 'unknown',
        totalExtractedAnswers: Object.keys(extractResult.answers).length
      };
      
      console.log('\n📤 Submission Data Ready:');
      console.log(JSON.stringify(submissionData, null, 2));
      
      // Check coverage for Test1 (which has ~20 questions based on database)
      const expectedQuestions = 20;
      const actualAnswers = Object.keys(extractResult.answers).length;
      const coverage = actualAnswers > 0 ? (actualAnswers / expectedQuestions * 100).toFixed(1) : 0;
      
      console.log(`\n📈 Test Coverage: ${actualAnswers}/${expectedQuestions} questions (${coverage}%)`);
      
      if (actualAnswers === expectedQuestions) {
        console.log('🎉 Perfect! All questions covered');
      } else if (actualAnswers > 0) {
        console.log('⚠️ Partial coverage - some questions may be missing');
      } else {
        console.log('❌ No answers extracted - check PDF format');
      }
      
    } else {
      console.log('❌ No answers extracted');
      console.log('💡 Check if the PDF contains visible answer markings');
      console.log('💡 Ensure answers are clearly marked (circled, filled bubbles, etc.)');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run the test
testGeminiPDFExtraction().catch(console.error);