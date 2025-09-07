const Tesseract = require('tesseract.js');

const extractTextFromImage = async (imagePath) => {
  try {
    console.log('Starting OCR extraction for:', imagePath);
    
    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
      logger: info => {
        if (info.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(info.progress * 100)}%`);
        }
      },
      // Enhanced OCR settings for handwritten text
      tessedit_ocr_engine_mode: 1, // Use LSTM OCR Engine mode
      tessedit_pageseg_mode: 6, // Assume uniform block of text
      preserve_interword_spaces: 1
    });
    
    console.log('OCR extraction completed');
    console.log('Raw extracted text:', JSON.stringify(text));
    console.log('Extracted text length:', text.length);
    
    return text;
  } catch (error) {
    console.error('Tesseract OCR Error:', error);
    throw new Error('Failed to extract text from image');
  }
};

// Enhanced function to process answer sheet text and extract questions/answers
const processAnswerSheet = (text) => {
  try {
    console.log('Processing answer sheet text...');
    console.log('Full text to process:', JSON.stringify(text));
    
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log('Lines after splitting:', lines);
    
    const answers = [];
    
    // More flexible pattern matching for handwritten text
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      console.log(`Processing line ${i}: "${line}"`);
      
      // Look for various question number patterns
      // Patterns: "1.", "1)", "1 .", "Q1", etc.
      const questionMatches = [
        line.match(/^(\d+)[\.\)\s]/),  // 1. or 1) or 1 
        line.match(/^Q\s*(\d+)/i),    // Q1 or Q 1
        line.match(/(\d+)\s*[\.\)]/), // More flexible number matching
      ];
      
      let questionNumber = null;
      for (const match of questionMatches) {
        if (match) {
          questionNumber = parseInt(match[1]);
          console.log(`Found question number: ${questionNumber}`);
          break;
        }
      }
      
      if (questionNumber) {
        // Look for answer options in the same line or next few lines
        const searchLines = [line, ...lines.slice(i + 1, i + 5)]; // Check current + next 4 lines
        
        for (const searchLine of searchLines) {
          console.log(`Searching for answers in: "${searchLine}"`);
          
          // Look for answer patterns with various markers
          const answerPatterns = [
            // a) option ✓ or a) option √
            /([a-d])\s*[\)\]\.\:]\s*([^✓√\*\n]*)\s*[✓√\*]/i,
            // ✓ a) option or √ a) option  
            /[✓√\*]\s*([a-d])\s*[\)\]\.\:]\s*([^✓√\*\n]*)/i,
            // a ✓ or a √ (simple format)
            /([a-d])\s*[✓√\*]/i,
            // ✓ a or √ a
            /[✓√\*]\s*([a-d])/i,
            // Look for circled letters or parentheses around letters
            /\(([a-d])\)/i,
            // Any line with a letter and check mark nearby
            /([a-d]).*[✓√\*]|[✓√\*].*([a-d])/i
          ];
          
          for (const pattern of answerPatterns) {
            const match = searchLine.match(pattern);
            if (match) {
              const option = (match[1] || match[2] || match[3] || match[4]).toLowerCase();
              if (option >= 'a' && option <= 'd') {
                answers.push({
                  questionNumber: questionNumber,
                  selectedOption: option,
                  correctText: searchLine,
                  extractedFrom: `Line: "${searchLine}"`
                });
                console.log(`Found answer for Q${questionNumber}: ${option} from "${searchLine}"`);
                break; // Found answer for this question, move to next
              }
            }
          }
        }
      }
    }
    
    // If no structured answers found, try a more lenient approach
    if (answers.length === 0) {
      console.log('No structured answers found, trying lenient approach...');
      
      // Look for any check marks or symbols with letters
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for any combination of numbers, letters, and symbols
        const checkMarks = /[✓√\*\(\)]/g;
        const letters = /[a-d]/gi;
        const numbers = /\d+/g;
        
        if (checkMarks.test(line) && letters.test(line)) {
          const letterMatch = line.match(/([a-d])/i);
          const numberMatch = line.match(/(\d+)/);
          
          if (letterMatch && numberMatch) {
            const questionNum = parseInt(numberMatch[1]);
            const option = letterMatch[1].toLowerCase();
            
            answers.push({
              questionNumber: questionNum,
              selectedOption: option,
              correctText: line,
              extractedFrom: `Lenient match: "${line}"`
            });
            console.log(`Lenient match - Q${questionNum}: ${option} from "${line}"`);
          }
        }
      }
    }
    
    console.log(`Processed ${answers.length} answers from text`);
    if (answers.length > 0) {
      console.log('Found answers:', answers);
    }
    
    return answers;
  } catch (error) {
    console.error('Error processing answer sheet:', error);
    return [];
  }
};

module.exports = { 
  extractTextFromImage, 
  processAnswerSheet 
};