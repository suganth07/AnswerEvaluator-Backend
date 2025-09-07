const axios = require('axios');
const fs = require('fs');

class AzureOCRService {
    constructor() {
        // You'll need to set these environment variables
        this.endpoint = process.env.AZURE_COMPUTER_VISION_ENDPOINT;
        this.apiKey = process.env.AZURE_COMPUTER_VISION_KEY;
        
        if (!this.endpoint || !this.apiKey) {
            console.warn('Azure Computer Vision credentials not configured. Please set AZURE_COMPUTER_VISION_ENDPOINT and AZURE_COMPUTER_VISION_KEY environment variables.');
        }
    }

    async extractTextFromImage(imagePath) {
        try {
            if (!this.endpoint || !this.apiKey) {
                throw new Error('Azure Computer Vision not configured');
            }

            console.log(`Processing image with Azure OCR: ${imagePath}`);
            
            // Read image file
            const imageBuffer = fs.readFileSync(imagePath);
            
            // Azure Computer Vision Read API
            const readUrl = `${this.endpoint}/vision/v3.2/read/analyze`;
            
            // Submit image for processing
            const submitResponse = await axios.post(readUrl, imageBuffer, {
                headers: {
                    'Ocp-Apim-Subscription-Key': this.apiKey,
                    'Content-Type': 'application/octet-stream'
                },
                params: {
                    language: 'en'
                }
            });
            
            // Get operation location from response headers
            const operationLocation = submitResponse.headers['operation-location'];
            if (!operationLocation) {
                throw new Error('No operation location returned from Azure');
            }
            
            console.log('Image submitted to Azure, waiting for processing...');
            
            // Poll for results
            let result;
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds max wait
            
            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                
                const resultResponse = await axios.get(operationLocation, {
                    headers: {
                        'Ocp-Apim-Subscription-Key': this.apiKey
                    }
                });
                
                result = resultResponse.data;
                console.log(`Processing status: ${result.status}`);
                
                if (result.status === 'succeeded') {
                    break;
                } else if (result.status === 'failed') {
                    throw new Error('Azure OCR processing failed');
                }
                
                attempts++;
            }
            
            if (result.status !== 'succeeded') {
                throw new Error('Azure OCR processing timed out');
            }
            
            // Extract text from results
            let fullText = '';
            const words = [];
            const lines = [];
            
            if (result.analyzeResult && result.analyzeResult.readResults) {
                for (const page of result.analyzeResult.readResults) {
                    for (const line of page.lines) {
                        fullText += line.text + '\n';
                        lines.push({
                            text: line.text,
                            boundingBox: line.boundingBox
                        });
                        
                        // Extract words if available
                        if (line.words) {
                            for (const word of line.words) {
                                words.push({
                                    text: word.text,
                                    boundingBox: word.boundingBox,
                                    confidence: word.confidence || 0.9 // Azure doesn't always provide confidence
                                });
                            }
                        }
                    }
                }
            }
            
            console.log(`Azure OCR completed. Extracted ${fullText.length} characters.`);
            
            return {
                text: fullText.trim(),
                confidence: 85, // Azure typically has high confidence
                words: words,
                lines: lines,
                method: 'azure'
            };
            
        } catch (error) {
            console.error('Azure OCR Error:', error.message);
            throw error;
        }
    }

    // Enhanced answer parsing specifically for handwritten answer sheets
    processAnswerSheet(ocrResult) {
        const { text, lines } = ocrResult;
        console.log('\n=== Azure OCR Answer Processing ===');
        console.log(`Input text length: ${text.length} characters`);
        console.log(`Number of lines detected: ${lines?.length || 0}`);
        
        const answers = [];
        const detectedAnswers = new Set();
        let currentQuestion = null;

        // Process line by line for better accuracy
        const textLines = lines && lines.length > 0 
            ? lines.map(line => line.text) 
            : text.split('\n');

        for (let i = 0; i < textLines.length; i++) {
            const line = textLines[i].trim();
            if (!line) continue;

            console.log(`Processing line ${i + 1}: "${line}"`);

            // Look for question numbers - more strict pattern
            const questionPatterns = [
                /^(\d+)\.[\s\d+\-×\+\*\/\(\)]*$/,      // "1." or "1.3+3" or "2.1×5"
                /^(\d+)\.[\s]*[\d+\-×\+\*\/\(\)\s]+$/,  // Question with math expression
            ];

            let foundQuestion = false;
            for (const pattern of questionPatterns) {
                const match = line.match(pattern);
                if (match) {
                    currentQuestion = parseInt(match[1]);
                    console.log(`  → Found question: ${currentQuestion}`);
                    foundQuestion = true;
                    break;
                }
            }

            if (foundQuestion) continue;

            // Look for ONLY MARKED answers - be very strict about markings
            const markedAnswerPatterns = [
                // Only detect answers with clear markings
                /([a-d])\)\s*([^)]*?)?\s*[✓✔vV\/]/i,     // a) text ✓ or a) text V or a) text /
                /([a-d])\)\s*\d+\s*[✓✔vV\/]/i,          // a) number ✓ or a) number /
            ];

            for (const pattern of markedAnswerPatterns) {
                const match = line.match(pattern);
                if (match && currentQuestion) {
                    const option = match[1].toLowerCase();
                    
                    // Only high confidence for clearly marked answers
                    const confidence = 'high';
                    
                    const answerKey = `${currentQuestion}-${option}`;
                    
                    if (!detectedAnswers.has(answerKey)) {
                        answers.push({
                            question: currentQuestion,
                            answer: option,
                            line: line,
                            confidence: confidence,
                            pattern: 'marked_answer'
                        });
                        detectedAnswers.add(answerKey);
                        console.log(`  → Found MARKED answer: Q${currentQuestion} = ${option.toUpperCase()} from: "${line}"`);
                    }
                    break;
                }
            }
        }

        // Remove the additional pattern matching section that was causing duplicates
        console.log('\n--- Final Results ---');

        // Sort answers by question number
        answers.sort((a, b) => a.question - b.question);
        
        console.log(`Total MARKED answers found: ${answers.length}`);
        return answers;
    }

    async processAnswerSheetFromImage(imagePath) {
        try {
            console.log('=== Processing Answer Sheet with Azure OCR ===');
            
            const ocrResult = await this.extractTextFromImage(imagePath);
            console.log(`\nAzure OCR Results:`);
            console.log(`- Confidence: ${ocrResult.confidence}%`);
            console.log(`- Text length: ${ocrResult.text.length} characters`);
            console.log(`- Lines detected: ${ocrResult.lines?.length || 0}`);
            
            const answers = this.processAnswerSheet(ocrResult);
            
            return {
                success: true,
                confidence: ocrResult.confidence,
                text: ocrResult.text,
                answers: answers,
                totalQuestions: answers.length,
                method: 'azure'
            };
            
        } catch (error) {
            console.error('Azure OCR Process Error:', error.message);
            return {
                success: false,
                error: error.message,
                answers: [],
                totalQuestions: 0,
                method: 'azure'
            };
        }
    }
}

module.exports = { AzureOCRService };
