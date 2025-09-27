const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
require('dotenv').config();

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        // Add retry configuration
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 seconds
    }

    // Helper method to add retry logic with exponential backoff
    async withRetry(operation, context = '') {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const isRetryable = error.status === 503 || 
                                  error.status === 429 || 
                                  error.message.includes('overloaded') ||
                                  error.message.includes('rate limit') ||
                                  error.message.includes('Service Unavailable');
                
                console.log(`⚠️ ${context} - Attempt ${attempt}/${this.maxRetries} failed: ${error.message}`);
                
                if (isRetryable && attempt < this.maxRetries) {
                    const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                    console.log(`⏳ Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                } else {
                    console.error(`❌ ${context} - Max retries reached or non-retryable error`);
                    throw error;
                }
            }
        }
    }

    async extractQuestionPaper(imagePath) {
        try {
            console.log('=== Processing Question Paper with Gemini ===');
            console.log('Image path:', imagePath);

            if (!fs.existsSync(imagePath)) {
                throw new Error(`Image file not found: ${imagePath}`);
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');
            const mimeType = this.getMimeType(imagePath);

            const prompt = `
            Analyze this question paper image and extract all the content in a structured JSON format.
            
            Look for questions with marked correct answers. Multiple answers may be marked for a single question.
            
            Please return ONLY valid JSON with this exact structure:
            {
              "questions": [
                {
                  "number": 1,
                  "text": "question text here",
                  "options": {
                    "a": "option a text",
                    "b": "option b text", 
                    "c": "option c text",
                    "d": "option d text"
                  },
                  "correctAnswer": "a",
                  "correctAnswers": ["a"]
                }
              ]
            }

            Rules:
            - Extract ALL questions you can see in the image
            - Include ALL answer options (a, b, c, d, etc.)
            - For correctAnswer, put the first correct answer or "unknown" if none marked
            - For correctAnswers, put an array of ALL marked correct answers (e.g., ["a", "c"] for multiple correct)
            - If only one correct answer, correctAnswers should be ["a"] (single item array)
            - If no correct answers are marked, use "unknown" for correctAnswer and [] for correctAnswers  
            - Look for checkmarks (✓), circles, highlights, or any markings indicating correct answers
            - Ensure the JSON is valid and properly formatted
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API with retry mechanism...');
            
            const result = await this.withRetry(async () => {
                return await this.model.generateContent([prompt, imagePart]);
            }, 'Question Paper Extraction');

            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✓ Successfully extracted ${parsedData.questions.length} questions`);
                
                return {
                    success: true,
                    questions: parsedData.questions,
                    totalQuestions: parsedData.questions.length,
                    rawResponse: text
                };
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
                console.log('Raw response:', text);
                throw new Error('Failed to parse Gemini response as JSON');
            }

        } catch (error) {
            console.error('Error extracting question paper:', error);
            return {
                success: false,
                error: error.message,
                questions: [],
                totalQuestions: 0
            };
        }
    }

    async extractStudentAnswers(imagePath) {
        try {
            console.log('=== Processing Student Answer Sheet with Gemini ===');
            console.log('Image path:', imagePath);

            if (!fs.existsSync(imagePath)) {
                throw new Error(`Image file not found: ${imagePath}`);
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');
            const mimeType = this.getMimeType(imagePath);

            const prompt = `
            Analyze this student answer sheet image and identify which answers have been marked/selected.
            
            Look for:
            - Checkmarks (✓, ✔, √)
            - Circles around options
            - Filled bubbles or checkboxes
            - Any other markings that indicate a selected answer
            - MULTIPLE selections for the same question (students may mark multiple options)
            
            Return ONLY valid JSON with this exact structure:
            {
              "answers": [
                {
                  "question": 1,
                  "selectedOption": "a",
                  "selectedOptions": ["a"],
                  "confidence": "high"
                },
                {
                  "question": 2,
                  "selectedOption": "b",
                  "selectedOptions": ["b", "c"], 
                  "confidence": "medium"
                }
              ]
            }

            Rules:
            - Only include questions where you can clearly see a marked answer
            - Use confidence levels: "high", "medium", "low" based on how clear the marking is
            - selectedOption should be the first/primary selected option (lowercase a, b, c, d)
            - selectedOptions should be an array of ALL marked options for that question
            - If only one option is marked, selectedOptions should be ["a"] (single item array)
            - If multiple options are marked, include all of them: ["a", "c", "d"]
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API with retry mechanism...');
            
            const result = await this.withRetry(async () => {
                return await this.model.generateContent([prompt, imagePart]);
            }, 'Student Answer Extraction');

            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✓ Successfully extracted ${parsedData.answers.length} marked answers`);
                
                return {
                    success: true,
                    answers: parsedData.answers,
                    totalAnswers: parsedData.answers.length,
                    rawResponse: text
                };
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
                console.log('Raw response:', text);
                throw new Error('Failed to parse Gemini response as JSON');
            }

        } catch (error) {
            console.error('Error extracting student answers:', error);
            return {
                success: false,
                error: error.message,
                answers: [],
                totalAnswers: 0
            };
        }
    }

    async extractQuestionPaperFromBuffer(imageBuffer, mimeType = 'image/jpeg') {
        try {
            console.log('=== Processing Question Paper with Gemini (from buffer) ===');

            const imageBase64 = imageBuffer.toString('base64');

            const prompt = `
            Analyze this question paper image and extract all the content in a structured JSON format.
            
            Look for questions with marked correct answers. Multiple answers may be marked for a single question.
            
            Please return ONLY valid JSON with this exact structure:
            {
              "questions": [
                {
                  "number": 1,
                  "text": "question text here",
                  "options": {
                    "a": "option a text",
                    "b": "option b text", 
                    "c": "option c text",
                    "d": "option d text"
                  },
                  "correctAnswer": "a",
                  "correctAnswers": ["a"]
                }
              ]
            }

            Rules:
            - Extract ALL questions you can see in the image
            - Include ALL answer options (a, b, c, d, etc.)
            - For correctAnswer, put the first correct answer or "unknown" if none marked
            - For correctAnswers, put an array of ALL marked correct answers (e.g., ["a", "c"] for multiple correct)
            - If only one correct answer, correctAnswers should be ["a"] (single item array)
            - If no correct answers are marked, use "unknown" for correctAnswer and [] for correctAnswers
            - Look for checkmarks (✓), circles, highlights, or any markings indicating correct answers
            - Ensure the JSON is valid and properly formatted
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API with retry mechanism...');
            
            const result = await this.withRetry(async () => {
                return await this.model.generateContent([prompt, imagePart]);
            }, 'Question Paper Extraction (Buffer)');

            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✓ Successfully extracted ${parsedData.questions.length} questions from buffer`);
                
                return {
                    success: true,
                    questions: parsedData.questions,
                    totalQuestions: parsedData.questions.length,
                    rawResponse: text
                };
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
                console.log('Raw response:', text);
                throw new Error('Failed to parse Gemini response as JSON');
            }

        } catch (error) {
            console.error('Error extracting question paper from buffer:', error);
            return {
                success: false,
                error: error.message,
                questions: [],
                totalQuestions: 0
            };
        }
    }

    async extractStudentAnswersFromBuffer(imageBuffer, mimeType = 'image/jpeg') {
        try {
            console.log('=== Processing Student Answer Sheet with Gemini (from buffer) ===');

            const imageBase64 = imageBuffer.toString('base64');

            const prompt = `
            You are an expert at analyzing student answer sheets. Examine this image very carefully to identify ALL marked answers.

            WHAT TO LOOK FOR:
            - Dark marks, checkmarks (✓, ✔, √), crosses (✗), or circles around options
            - Filled or shaded bubbles/circles
            - Any pen or pencil marks that clearly indicate a selected answer
            - Options that are highlighted, underlined, or emphasized
            - Look at EVERY question number and its corresponding options (a, b, c, d, etc.)
            
            INSTRUCTIONS:
            1. Scan the entire image systematically from top to bottom
            2. For each question number you see, check if any option (a, b, c, d) has been marked
            3. Be very thorough - even faint marks or partial marks count as selections
            4. If you see multiple marks for the same question, include ALL of them
            5. Only skip questions where you see absolutely NO marks at all
            
            Return ONLY this JSON structure:
            {
              "answers": [
                {
                  "question": 1,
                  "selectedOption": "a",
                  "selectedOptions": ["a"],
                  "confidence": "high",
                  "markType": "checkmark"
                },
                {
                  "question": 2,
                  "selectedOption": "b", 
                  "selectedOptions": ["b", "c"],
                  "confidence": "medium",
                  "markType": "filled_circle"
                }
              ]
            }

            CONFIDENCE LEVELS:
            - "high": Clear, dark, unmistakable mark
            - "medium": Visible mark but might be faint
            - "low": Barely visible or questionable mark
            
            MARK TYPES: checkmark, cross, filled_circle, outlined_circle, underline, highlight, scribble
            
            CRITICAL: Include EVERY question where you see ANY kind of mark, even if faint. Do not be overly conservative.
            Return ONLY the JSON, no other text.
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API with retry mechanism...');
            
            const result = await this.withRetry(async () => {
                return await this.model.generateContent([prompt, imagePart]);
            }, 'Student Answer Extraction (Buffer)');

            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✓ Successfully extracted ${parsedData.answers.length} marked answers from buffer`);
                
                return {
                    success: true,
                    answers: parsedData.answers,
                    totalAnswers: parsedData.answers.length,
                    rawResponse: text
                };
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
                console.log('Raw response:', text);
                throw new Error('Failed to parse Gemini response as JSON');
            }

        } catch (error) {
            console.error('Error extracting student answers from buffer:', error);
            return {
                success: false,
                error: error.message,
                answers: [],
                totalAnswers: 0
            };
        }
    }

    getMimeType(filePath) {
        // Handle case where filePath might not be a string (e.g., Buffer object)
        if (typeof filePath !== 'string') {
            console.warn('⚠️ getMimeType received non-string input:', typeof filePath);
            return 'image/jpeg'; // Default fallback
        }
        
        const ext = filePath.toLowerCase().split('.').pop();
        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'webp':
                return 'image/webp';
            default:
                return 'image/jpeg'; // fallback
        }
    }

    // Extract roll number from question paper image
    async extractRollNumberFromImage(imageBuffer) {
        try {
            console.log('🔍 Extracting roll number from question paper...');
            
            const operation = async () => {
                const imagePart = {
                    inlineData: {
                        data: imageBuffer.toString('base64'),
                        mimeType: 'image/jpeg' // Default mime type for buffer images
                    }
                };

                const prompt = `
                Analyze this question paper image and extract the student's roll number.

                The roll number is typically found at the top of the page in boxes or fields labeled "Roll No", "Roll Number", "Student ID", or similar.
                It may be written in separate boxes (one digit per box) or in a single field.

                Look for:
                1. Boxes at the top of the page with digits
                2. Fields labeled "Roll No", "Roll Number", "Student ID"
                3. Student information section at the top
                4. Any numeric identifier that appears to be a roll number

                Return ONLY a JSON object with this exact format:
                {
                    "rollNumber": "XX",
                    "confidence": "high/medium/low",
                    "location": "description of where found"
                }

                If no roll number is found, return:
                {
                    "rollNumber": null,
                    "confidence": "none",
                    "location": "not found"
                }

                Extract only the actual digits/numbers, without any labels.
                `;

                const result = await this.model.generateContent([prompt, imagePart]);
                const response = await result.response;
                const text = response.text();

                console.log('🤖 Gemini roll number response:', text);

                // Parse JSON response
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return {
                        success: true,
                        rollNumber: parsed.rollNumber,
                        confidence: parsed.confidence,
                        location: parsed.location
                    };
                }

                return {
                    success: false,
                    error: 'Could not parse roll number from response'
                };
            };

            return await this.withRetry(operation, 'Roll number extraction');

        } catch (error) {
            console.error('❌ Error extracting roll number:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = { GeminiService };