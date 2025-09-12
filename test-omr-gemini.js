const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class OMRGeminiTest {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    }

    async testOMRAnswerDetection(imagePath) {
        try {
            console.log('=== OMR Answer Detection Test with Gemini ===');
            console.log('Image path:', imagePath);

            if (!fs.existsSync(imagePath)) {
                throw new Error(`Image file not found: ${imagePath}`);
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');
            const mimeType = this.getMimeType(imagePath);

            console.log(`📄 Processing ${path.basename(imagePath)} (${imageBuffer.length} bytes)`);

            // Test 1: General OMR Detection
            await this.testGeneralOMRDetection(imageBase64, mimeType);
            
            // Test 2: Specific Circle Detection
            await this.testCircleDetection(imageBase64, mimeType);
            
            // Test 3: Question-Answer Mapping
            await this.testQuestionAnswerMapping(imageBase64, mimeType);
            
            // Test 4: Different Prompt Variations
            await this.testPromptVariations(imageBase64, mimeType);

        } catch (error) {
            console.error('❌ OMR Test failed:', error);
        }
    }

    async testGeneralOMRDetection(imageBase64, mimeType) {
        console.log('\n🔍 Test 1: General OMR Detection');
        console.log('=' .repeat(50));

        const prompt = `
        Analyze this OMR (Optical Mark Recognition) answer sheet image.

        Look for:
        - Filled/shaded circles or bubbles
        - Question numbers (1, 2, 3, etc.)
        - Answer options (A, B, C, D)
        - Any marked/selected answers

        Return your analysis in JSON format:
        {
          "detected_answers": [
            {
              "question": 1,
              "selected_option": "A",
              "confidence": "high"
            }
          ],
          "total_questions_found": 0,
          "image_quality": "good/fair/poor",
          "notes": "any observations about the image"
        }

        Be very careful to identify only clearly filled/shaded circles.
        `;

        try {
            const result = await this.callGemini(prompt, imageBase64, mimeType);
            console.log('📊 General OMR Detection Result:');
            console.log(result);
        } catch (error) {
            console.error('❌ General OMR Detection failed:', error.message);
        }
    }

    async testCircleDetection(imageBase64, mimeType) {
        console.log('\n🎯 Test 2: Specific Circle Detection');
        console.log('=' .repeat(50));

        const prompt = `
        Focus specifically on detecting filled/shaded circles in this OMR sheet.

        Instructions:
        1. Look for circles that are completely or mostly filled with dark marks
        2. Ignore empty or lightly marked circles
        3. For each filled circle, identify its position relative to question numbers and options

        Return JSON:
        {
          "filled_circles": [
            {
              "question_number": 1,
              "option_letter": "A",
              "fill_confidence": "high/medium/low",
              "description": "completely filled circle"
            }
          ],
          "scanning_notes": "observations about circle detection"
        }

        Only report circles that are clearly and intentionally filled.
        `;

        try {
            const result = await this.callGemini(prompt, imageBase64, mimeType);
            console.log('🎯 Circle Detection Result:');
            console.log(result);
        } catch (error) {
            console.error('❌ Circle Detection failed:', error.message);
        }
    }

    async testQuestionAnswerMapping(imageBase64, mimeType) {
        console.log('\n🗺️ Test 3: Question-Answer Mapping');
        console.log('=' .repeat(50));

        const prompt = `
        Analyze this OMR sheet to create a complete question-answer mapping.

        Process:
        1. Identify all question numbers visible
        2. For each question, identify available options (A, B, C, D, etc.)
        3. Determine which option is selected (filled circle)
        4. Map the selection to the question

        Return JSON:
        {
          "answer_sheet": [
            {
              "question": 1,
              "available_options": ["A", "B", "C", "D"],
              "selected_answer": "A",
              "selection_clarity": "clear/unclear/no_selection"
            }
          ],
          "summary": {
            "total_questions": 0,
            "answered_questions": 0,
            "unanswered_questions": 0,
            "unclear_selections": 0
          }
        }

        Be thorough and accurate in mapping questions to their selected answers.
        `;

        try {
            const result = await this.callGemini(prompt, imageBase64, mimeType);
            console.log('🗺️ Question-Answer Mapping Result:');
            console.log(result);
        } catch (error) {
            console.error('❌ Question-Answer Mapping failed:', error.message);
        }
    }

    async testPromptVariations(imageBase64, mimeType) {
        console.log('\n🔄 Test 4: Different Prompt Variations');
        console.log('=' .repeat(50));

        const prompts = [
            {
                name: "Simple Detection",
                prompt: `Look at this OMR sheet. Which circles are filled? Return as JSON with question numbers and selected options.`
            },
            {
                name: "Detailed Analysis",
                prompt: `This is an OMR answer sheet where students fill circles to indicate their answers. 
                Carefully examine each row and identify:
                - Question numbers (1, 2, 3, etc.)
                - Filled/darkened circles
                - The letter (A, B, C, D) corresponding to each filled circle
                
                Return JSON format: {"answers": [{"q": 1, "ans": "A"}]}`
            },
            {
                name: "Vision-Focused",
                prompt: `Using your vision capabilities, scan this image for:
                1. Dark/shaded circular marks
                2. Their position relative to question numbers and answer choices
                3. Return only confident detections
                
                JSON: {"detections": [{"question": number, "option": "letter", "confidence": "level"}]}`
            }
        ];

        for (const test of prompts) {
            console.log(`\n📝 Testing: ${test.name}`);
            try {
                const result = await this.callGemini(test.prompt, imageBase64, mimeType);
                console.log(`✅ ${test.name} Result:`);
                console.log(result);
            } catch (error) {
                console.error(`❌ ${test.name} failed:`, error.message);
            }
        }
    }

    async callGemini(prompt, imageBase64, mimeType) {
        const imagePart = {
            inlineData: {
                data: imageBase64,
                mimeType: mimeType
            }
        };

        console.log('🤖 Sending request to Gemini API...');
        const result = await this.model.generateContent([prompt, imagePart]);
        const response = await result.response;
        let text = response.text();

        // Clean up the response to extract JSON if present
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            // Try to parse as JSON
            const parsedData = JSON.parse(text);
            return parsedData;
        } catch (parseError) {
            // If not valid JSON, return as text
            console.log('⚠️ Response is not valid JSON, returning as text');
            return { raw_response: text };
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

// Run the test
async function runOMRTest() {
    const tester = new OMRGeminiTest();
    
    // Test with the provided OMR image
    const imagePath = path.join(__dirname, 'smp.jpg');
    
    console.log('🚀 Starting OMR Detection Test with Gemini');
    console.log('📅 Test Date:', new Date().toLocaleString());
    console.log('🖼️ Test Image: omr.png');
    console.log('=' .repeat(60));
    
    await tester.testOMRAnswerDetection(imagePath);
    
    console.log('\n🏁 OMR Test Completed');
    console.log('=' .repeat(60));
}

// Execute the test
if (require.main === module) {
    runOMRTest().catch(console.error);
}

module.exports = OMRGeminiTest;
