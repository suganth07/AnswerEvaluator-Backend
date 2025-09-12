const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class OMRService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    }

    /**
     * Detect OMR answers from answer sheet image
     * @param {Buffer} imageBuffer - The image buffer
     * @param {Array} questions - Array of question objects with question_number and options
     * @returns {Object} Detected answers and confidence
     */
    async detectOMRAnswers(imageBuffer, questions) {
        try {
            const imageBase64 = imageBuffer.toString('base64');
            const mimeType = 'image/jpeg'; // Assuming JPEG, can be enhanced
            
            const questionNumbers = questions.map(q => q.question_number).sort((a, b) => a - b);
            const maxQuestion = Math.max(...questionNumbers);
            
            const prompt = `
            Analyze this OMR (Optical Mark Recognition) answer sheet image.
            
            This answer sheet contains questions numbered from 1 to ${maxQuestion}.
            Each question has multiple choice options (A, B, C, D).
            
            Instructions:
            1. Look for FILLED/SHADED circles or bubbles
            2. Ignore empty, lightly marked, or unclear circles
            3. For each question, identify which option (A, B, C, D) has the filled circle
            4. Only report answers where you are confident about the selection
            
            Expected questions: ${questionNumbers.join(', ')}
            
            Return your analysis in this exact JSON format:
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
              "processing_notes": "any observations about detection"
            }
            
            IMPORTANT:
            - Only include answers where the circle is clearly and intentionally filled
            - Use confidence levels: "high", "medium", "low"
            - If a question has no clear selection or multiple selections, omit it
            - Be conservative - it's better to miss an unclear answer than report a wrong one
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('🔍 Analyzing OMR answer sheet with Gemini...');
            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✅ OMR Detection completed: ${parsedData.detected_answers?.length || 0} answers found`);
                return parsedData;
            } catch (parseError) {
                console.error('❌ Failed to parse OMR response as JSON:', parseError.message);
                throw new Error('Invalid response format from OMR detection');
            }

        } catch (error) {
            console.error('❌ OMR Detection failed:', error.message);
            throw error;
        }
    }

    /**
     * Evaluate OMR answers against correct answers
     * @param {Array} detectedAnswers - Answers detected from OMR
     * @param {Array} questions - Question objects with correct_option
     * @returns {Object} Evaluation results
     */
    evaluateOMRAnswers(detectedAnswers, questions) {
        try {
            const results = [];
            let totalScore = 0;
            let totalQuestions = questions.length;
            let answeredQuestions = 0;
            let correctAnswers = 0;

            // Create a map of questions for quick lookup
            const questionMap = {};
            questions.forEach(q => {
                questionMap[q.question_number] = q;
            });

            // Evaluate each detected answer
            detectedAnswers.forEach(detected => {
                const question = questionMap[detected.question];
                if (!question) {
                    console.warn(`⚠️ Detected answer for non-existent question ${detected.question}`);
                    return;
                }

                answeredQuestions++;
                const isCorrect = detected.selected_option?.toUpperCase() === question.correct_option?.toUpperCase();
                if (isCorrect) {
                    correctAnswers++;
                    totalScore += 1; // 1 point per correct answer
                }

                results.push({
                    question_number: detected.question,
                    student_answer: detected.selected_option?.toUpperCase(),
                    correct_answer: question.correct_option?.toUpperCase(),
                    is_correct: isCorrect,
                    confidence: detected.confidence,
                    points: isCorrect ? 1 : 0
                });
            });

            // Check for unanswered questions
            questions.forEach(q => {
                const wasAnswered = detectedAnswers.some(d => d.question === q.question_number);
                if (!wasAnswered) {
                    results.push({
                        question_number: q.question_number,
                        student_answer: null,
                        correct_answer: q.correct_option,
                        is_correct: false,
                        confidence: null,
                        points: 0
                    });
                }
            });

            const percentage = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

            return {
                results,
                summary: {
                    total_questions: totalQuestions,
                    answered_questions: answeredQuestions,
                    correct_answers: correctAnswers,
                    total_score: totalScore,
                    max_score: totalQuestions,
                    percentage: Math.round(percentage * 100) / 100,
                    grade: this.calculateGrade(percentage)
                }
            };

        } catch (error) {
            console.error('❌ OMR Evaluation failed:', error.message);
            throw error;
        }
    }

    /**
     * Calculate grade based on percentage
     * @param {number} percentage - Score percentage
     * @returns {string} Grade letter
     */
    calculateGrade(percentage) {
        if (percentage >= 90) return 'A+';
        if (percentage >= 80) return 'A';
        if (percentage >= 70) return 'B+';
        if (percentage >= 60) return 'B';
        if (percentage >= 50) return 'C';
        if (percentage >= 40) return 'D';
        return 'F';
    }

    /**
     * Check if an image contains OMR-style content
     * @param {Buffer} imageBuffer - The image buffer
     * @returns {Object} Analysis of whether image is OMR-style
     */
    async detectOMRStyle(imageBuffer) {
        try {
            const imageBase64 = imageBuffer.toString('base64');
            const mimeType = 'image/jpeg';

            const prompt = `
            Analyze this image to determine if it contains OMR (Optical Mark Recognition) style content.
            
            Look for:
            1. Multiple choice questions with circular bubbles/circles to fill
            2. Grid-like layout with options A, B, C, D
            3. Question numbers arranged in rows
            4. Standardized answer sheet format
            
            vs Traditional format:
            1. Written text answers
            2. Checkboxes instead of circles
            3. Free-form text responses
            4. Mathematical equations or diagrams
            
            Return JSON:
            {
              "is_omr_style": true/false,
              "confidence": "high/medium/low",
              "detected_features": ["circles", "grid_layout", "multiple_choice"],
              "question_type": "omr/traditional/mixed"
            }
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();

            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                return JSON.parse(text);
            } catch (parseError) {
                console.error('Failed to parse OMR style detection response');
                return {
                    is_omr_style: false,
                    confidence: "low",
                    detected_features: [],
                    question_type: "traditional"
                };
            }

        } catch (error) {
            console.error('❌ OMR Style Detection failed:', error.message);
            return {
                is_omr_style: false,
                confidence: "low",
                detected_features: [],
                question_type: "traditional"
            };
        }
    }
}

module.exports = OMRService;
