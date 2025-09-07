const vision = require('@google-cloud/vision');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Initialize the Vision API client
const client = new vision.ImageAnnotatorClient({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE ? path.join(__dirname, '../../', process.env.GOOGLE_CLOUD_KEY_FILE) : undefined
});

const extractTextFromImage = async (imageBuffer) => {
  try {
    console.log('Starting OCR text extraction...');
    
    // Use the image buffer directly
    const [result] = await client.textDetection(imageBuffer);
    const detections = result.textAnnotations;
    
    if (detections && detections.length > 0) {
      const extractedText = detections[0].description;
      console.log('OCR Text extracted:', extractedText);
      return extractedText;
    }
    
    console.log('No text detected in image');
    return '';
  } catch (error) {
    console.error('OCR Error:', error);
    throw new Error('Failed to extract text from image: ' + error.message);
  }
};

const processQuestionPaper = (extractedText) => {
  console.log('Processing question paper text...');
  
  // Extract questions and correct answers from admin's marked paper
  // Look for patterns like:
  // 1. A ✓ (marked correct answer)
  // 1) A ✓ 
  // Question 1: A (circled/marked)
  
  const questions = [];
  const lines = extractedText.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Pattern 1: "1. A ✓" or "1) A ✓" - marked correct answers
    let match = line.match(/(\d+)[\.\)\s]+([A-D])\s*[✓✔]/i);
    if (match) {
      questions.push({
        questionNumber: parseInt(match[1]),
        correctOption: match[2].toUpperCase()
      });
      continue;
    }
    
    // Pattern 2: Multi-line pattern - look for answer followed by checkmark
    match = line.match(/([A-D])\)\s*.*[✓✔]/i);
    if (match) {
      // Look backwards to find the question number
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prevLine = lines[j].trim();
        const qMatch = prevLine.match(/(\d+)[\.\)]/);
        if (qMatch) {
          const questionNum = parseInt(qMatch[1]);
          // Check if we already have this question
          if (!questions.find(q => q.questionNumber === questionNum)) {
            questions.push({
              questionNumber: questionNum,
              correctOption: match[1].toUpperCase()
            });
          }
          break;
        }
      }
      continue;
    }
    
    // Pattern 3: "A) option text ✓" or "B) option text ✓"
    match = line.match(/([A-D])\).*[✓✔]/i);
    if (match) {
      // Look backwards to find the question number
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prevLine = lines[j].trim();
        const qMatch = prevLine.match(/(\d+)[\.\)]/);
        if (qMatch) {
          const questionNum = parseInt(qMatch[1]);
          if (!questions.find(q => q.questionNumber === questionNum)) {
            questions.push({
              questionNumber: questionNum,
              correctOption: match[1].toUpperCase()
            });
          }
          break;
        }
      }
      continue;
    }
    
    // Pattern 4: Simple pattern for testing - "B) 4 ✓"
    match = line.match(/([A-D])\)\s*.*✓/i);
    if (match) {
      // Look for question number in nearby lines
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 1); j++) {
        const checkLine = lines[j].trim();
        const qMatch = checkLine.match(/(\d+)\./);
        if (qMatch) {
          const questionNum = parseInt(qMatch[1]);
          if (!questions.find(q => q.questionNumber === questionNum)) {
            questions.push({
              questionNumber: questionNum,
              correctOption: match[1].toUpperCase()
            });
          }
          break;
        }
      }
    }
  }
  
  console.log('Extracted questions:', questions);
  return questions;
};

const processAnswerSheet = (extractedText) => {
  console.log('Processing student answer sheet...');
  
  // Extract student's selected answers
  // Look for patterns like "1. A", "2. B", etc.
  const answers = [];
  const lines = extractedText.split('\n');
  
  for (const line of lines) {
    // Match patterns like "1. A", "1) B", "1 C", etc.
    const match = line.match(/(\d+)[\.\)\s]+([A-D])/i);
    if (match) {
      const questionNumber = parseInt(match[1]);
      const selectedOption = match[2].toUpperCase();
      
      // Avoid duplicates - take the first occurrence
      if (!answers.find(a => a.questionNumber === questionNumber)) {
        answers.push({
          questionNumber,
          selectedOption
        });
      }
    }
  }
  
  console.log('Extracted student answers:', answers);
  return answers;
};

const evaluateAnswers = (correctAnswers, studentAnswers) => {
  console.log('Evaluating answers...');
  
  let score = 0;
  const totalQuestions = correctAnswers.length;
  const answerResults = [];

  for (const correct of correctAnswers) {
    const studentAnswer = studentAnswers.find(
      ans => ans.questionNumber === correct.questionNumber
    );
    
    const isCorrect = studentAnswer && 
      studentAnswer.selectedOption === correct.correctOption;
    
    if (isCorrect) score++;
    
    answerResults.push({
      questionNumber: correct.questionNumber,
      correctOption: correct.correctOption,
      studentOption: studentAnswer ? studentAnswer.selectedOption : 'Not answered',
      isCorrect
    });
  }

  const percentage = totalQuestions > 0 ? (score / totalQuestions) * 100 : 0;
  
  console.log(`Evaluation complete: ${score}/${totalQuestions} (${percentage.toFixed(2)}%)`);
  
  return {
    score,
    totalQuestions,
    percentage,
    answerResults
  };
};

module.exports = {
  extractTextFromImage,
  processQuestionPaper,
  processAnswerSheet,
  evaluateAnswers
};
