const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
require('dotenv').config();

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
                  "correctAnswer": "a"
                }
              ]
            }

            Rules:
            - Extract ALL questions you can see in the image
            - Include ALL answer options (a, b, c, d, etc.)
            - For correctAnswer, put "unknown" if no correct answer is marked or indicated
            - Ensure the JSON is valid and properly formatted
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API...');
            const result = await this.model.generateContent([prompt, imagePart]);
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
            
            Return ONLY valid JSON with this exact structure:
            {
              "answers": [
                {
                  "question": 1,
                  "selectedOption": "a",
                  "confidence": "high"
                },
                {
                  "question": 2,
                  "selectedOption": "b", 
                  "confidence": "medium"
                }
              ]
            }

            Rules:
            - Only include questions where you can clearly see a marked answer
            - Use confidence levels: "high", "medium", "low" based on how clear the marking is
            - selectedOption should be lowercase (a, b, c, d)
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API...');
            const result = await this.model.generateContent([prompt, imagePart]);
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
                  "correctAnswer": "a"
                }
              ]
            }

            Rules:
            - Extract ALL questions you can see in the image
            - Include ALL answer options (a, b, c, d, etc.)
            - For correctAnswer, put "unknown" if no correct answer is marked or indicated
            - Ensure the JSON is valid and properly formatted
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API...');
            const result = await this.model.generateContent([prompt, imagePart]);
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

    async extractStudentAnswersFromBuffer(imageBuffer, mimeType = 'image/jpeg') {
        try {
            console.log('=== Processing Student Answer Sheet with Gemini (from buffer) ===');

            const imageBase64 = imageBuffer.toString('base64');

            const prompt = `
            Analyze this student answer sheet image and identify which answers have been marked/selected.
            
            Look for:
            - Checkmarks (✓, ✔, √)
            - Circles around options
            - Filled bubbles or checkboxes
            - Any other markings that indicate a selected answer
            
            Return ONLY valid JSON with this exact structure:
            {
              "answers": [
                {
                  "question": 1,
                  "selectedOption": "a",
                  "confidence": "high"
                },
                {
                  "question": 2,
                  "selectedOption": "b", 
                  "confidence": "medium"
                }
              ]
            }

            Rules:
            - Only include questions where you can clearly see a marked answer
            - Use confidence levels: "high", "medium", "low" based on how clear the marking is
            - selectedOption should be lowercase (a, b, c, d)
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending request to Gemini API...');
            const result = await this.model.generateContent([prompt, imagePart]);
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

    getMimeType(filePath) {
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
}

module.exports = { GeminiService };
