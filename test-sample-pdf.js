const fs = require('fs');
const path = require('path');

// Test script to upload and process the sample PDF
async function testSamplePDF() {
  try {
    console.log('🧪 Starting sample PDF test...');
    
    // Check if sample PDF exists in the parent directory
    const pdfPath = path.join(__dirname, '..', 'sample.pdf');
    
    if (!fs.existsSync(pdfPath)) {
      console.error('❌ Sample PDF not found at:', pdfPath);
      console.log('💡 Please ensure sample.pdf is in the maths-gemini directory');
      return;
    }
    
    console.log('✅ Found sample PDF at:', pdfPath);
    
    // Read the PDF file
    const pdfBuffer = fs.readFileSync(pdfPath);
    console.log('📄 PDF file size:', (pdfBuffer.length / 1024).toFixed(2), 'KB');
    
    // Test the PDF service directly
    const pdfService = require('./services/pdfService.js');
    
    console.log('\n🔍 Testing PDF text extraction...');
    const textResult = await pdfService.extractTextFromPDF(pdfBuffer);
    console.log('📝 Extracted text:');
    console.log('-------------------');
    console.log(textResult.text);
    console.log('-------------------');
    console.log(`📊 Stats: ${textResult.wordCount} words, ${textResult.lineCount} lines, ${textResult.pages} pages\n`);
    
    // Test answer extraction patterns
    console.log('🔍 Testing answer pattern detection...');
    const text = textResult.text;
    
    // Look for roll number pattern
    const rollPattern = /(?:roll\s*(?:no|number)?|student\s*id|roll)\s*[:=]?\s*(\d+)/i;
    const rollMatch = text.match(rollPattern);
    
    if (rollMatch) {
      console.log('🎯 Found Roll Number:', rollMatch[1]);
    } else {
      console.log('❌ Roll number not found in standard pattern');
      console.log('📝 Raw text for inspection:', JSON.stringify(text, null, 2));
      
      // Try to find any numbers that might be roll numbers
      const numbers = text.match(/\d+/g);
      if (numbers) {
        console.log('🔢 Found numbers in text:', numbers);
        console.log('💡 First number might be roll number:', numbers[0]);
      }
    }
    
    // Look for answer patterns (common formats)
    const answerPatterns = [
      /(\d+)\s*[.)]\s*([A-Da-d])/g,  // 1. A, 2) B, etc.
      /Q\s*(\d+)\s*[:.]?\s*([A-Da-d])/gi,  // Q1: A, Q2. B, etc.
      /(\d+)\s*[:.]?\s*([A-Da-d])/g,  // 1: A, 2. B, etc.
      /ans\s*(\d+)\s*[:.]?\s*([A-Da-d])/gi,  // ans1: A, ans2. B, etc.
    ];
    
    let foundAnswers = [];
    
    for (let i = 0; i < answerPatterns.length; i++) {
      const pattern = answerPatterns[i];
      let match;
      const patternAnswers = [];
      
      while ((match = pattern.exec(text)) !== null) {
        patternAnswers.push({
          questionNo: parseInt(match[1]),
          answer: match[2].toUpperCase()
        });
      }
      
      if (patternAnswers.length > 0) {
        console.log(`✅ Pattern ${i + 1} found ${patternAnswers.length} answers:`);
        patternAnswers.forEach(ans => {
          console.log(`   Q${ans.questionNo}: ${ans.answer}`);
        });
        foundAnswers = foundAnswers.concat(patternAnswers);
      }
    }
    
    if (foundAnswers.length === 0) {
      console.log('❌ No answers found with standard patterns');
      console.log('🔍 Let me check for any alphabetic characters that might be answers...');
      
      // Look for any single letters that might be answers
      const letterPattern = /[A-Da-d]/g;
      const letters = text.match(letterPattern);
      if (letters) {
        console.log('📝 Found letters in text:', letters.join(', '));
      }
      
      // Try to find answers in different formats
      const lines = text.split('\n');
      console.log('📄 Analyzing line by line:');
      lines.forEach((line, index) => {
        if (line.trim()) {
          console.log(`Line ${index + 1}: "${line.trim()}"`);
        }
      });
    } else {
      console.log(`\n🎯 Total answers found: ${foundAnswers.length}`);
      
      // Remove duplicates and sort by question number
      const uniqueAnswers = foundAnswers.reduce((acc, curr) => {
        if (!acc.find(a => a.questionNo === curr.questionNo)) {
          acc.push(curr);
        }
        return acc;
      }, []).sort((a, b) => a.questionNo - b.questionNo);
      
      console.log('\n📋 Final extracted answers:');
      uniqueAnswers.forEach(ans => {
        console.log(`   Question ${ans.questionNo}: ${ans.answer}`);
      });
      
      // Format answers for Test1 (which should have 20 questions based on database)
      console.log('\n🎯 Formatted for Test1 evaluation:');
      const answerObject = {};
      uniqueAnswers.forEach(ans => {
        answerObject[`q${ans.questionNo}`] = ans.answer;
      });
      console.log('Answer object:', JSON.stringify(answerObject, null, 2));
    }
    
    // Test basic PDF info
    console.log('\n📋 Testing PDF info extraction...');
    const pdfInfo = await pdfService.getPDFInfo(pdfBuffer);
    console.log('PDF Info:', JSON.stringify(pdfInfo, null, 2));
    
    // Test with a simulated API call to see how it would be processed
    console.log('\n🔬 Testing answer processing simulation...');
    const testSubmissionData = {
      paperId: 2, // Test1 from database
      studentName: 'Test Student',
      rollNo: rollMatch ? rollMatch[1] : '12345',
      answers: foundAnswers.reduce((acc, curr) => {
        acc[`q${curr.questionNo}`] = curr.answer;
        return acc;
      }, {}),
      extractedText: text,
      totalAnswers: foundAnswers.length
    };
    
    console.log('Submission simulation:', JSON.stringify(testSubmissionData, null, 2));
    
    // Check if we have the expected number of answers for Test1
    const expectedQuestions = 20; // Based on database
    if (foundAnswers.length > 0) {
      console.log(`\n📊 Coverage: ${foundAnswers.length}/${expectedQuestions} questions answered`);
      if (foundAnswers.length === expectedQuestions) {
        console.log('✅ Perfect! All questions answered');
      } else if (foundAnswers.length < expectedQuestions) {
        console.log('⚠️ Some questions missing - might need better parsing');
      } else {
        console.log('❓ More answers than expected - might have duplicate detection');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run the test
testSamplePDF().catch(console.error);