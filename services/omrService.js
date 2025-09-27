const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class OMRService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
            Each question has multiple choice options (A, B, C, D, E).
            
            CRITICAL DETECTION INSTRUCTIONS:
            1. Look for ANY type of marking that indicates selection:
               - FILLED/SHADED circles or bubbles
               - Checkmarks ✓ or crosses ✗ 
               - Marks ABOVE the option letters (A, B, C, D, E)
               - Marks to the RIGHT of option letters
               - Underlined option letters
               - Any clear intentional marking
            
            2. MULTIPLE ANSWERS PER QUESTION ARE ALLOWED:
               - Some questions may have multiple correct options selected
               - Report ALL selected options for each question
               - Example: Question 2 might have both A and C selected
            
            3. Detection criteria:
               - Look carefully for subtle marks, not just filled circles
               - Check above, below, left, and right of each option letter
               - Consider any intentional marking as a selection
               - Be thorough but accurate
            
            Expected questions: ${questionNumbers.join(', ')}
            
            Return your analysis in this exact JSON format:
            {
              "detected_answers": [
                {
                  "question": 1,
                  "selected_options": ["A"],
                  "confidence": "high",
                  "marking_type": "filled_circle"
                },
                {
                  "question": 2,
                  "selected_options": ["A", "C"],
                  "confidence": "high",
                  "marking_type": "marks_above"
                }
              ],
              "total_questions_found": 0,
              "image_quality": "good/fair/poor",
              "processing_notes": "any observations about detection"
            }
            
            IMPORTANT RULES:
            - selected_options is ALWAYS an array, even for single answers
            - Include ALL selected options for each question
            - Use marking_type to describe how answers were marked: "filled_circle", "checkmark", "marks_above", "marks_right", "underlined", "other"
            - Use confidence levels: "high", "medium", "low"
            - If no clear selection found for a question, omit it entirely
            - Be thorough in detecting various marking styles
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
     * Evaluate OMR answers against correct answers (supports multiple correct answers)
     * @param {Array} detectedAnswers - Answers detected from OMR
     * @param {Array} questions - Question objects with correct_option(s)
     * @returns {Object} Evaluation results
     */
    evaluateOMRAnswers(detectedAnswers, questions) {
        try {
            const results = [];
            let totalScore = 0;
            let totalQuestions = questions.length;
            let maxPossibleScore = 0;
            let answeredQuestions = 0;
            let correctAnswers = 0;

            // Create a map of questions for quick lookup
            const questionMap = {};
            questions.forEach(q => {
                questionMap[q.question_number] = q;
                // Calculate max possible score
                const maxPoints = q.points_per_blank || q.max_points || 1;
                maxPossibleScore += maxPoints;
            });

            // Evaluate each detected answer
            detectedAnswers.forEach(detected => {
                const question = questionMap[detected.question];
                if (!question) {
                    console.warn(`⚠️ Detected answer for non-existent question ${detected.question}`);
                    return;
                }

                answeredQuestions++;

                // Get correct answers (support both single and multiple correct answers)
                let correctOptions = [];
                let weightages = {};
                let maxPoints = 1;
                
                if (question.correct_option) {
                    // Single correct answer - check if it's a label or content
                    if (question.options && question.options[question.correct_option]) {
                        // It's a label, convert to content
                        correctOptions = [question.options[question.correct_option].trim()];
                    } else {
                        // It's already content or no options mapping available
                        correctOptions = [question.correct_option.trim()];
                    }
                } else if (question.correct_options && Array.isArray(question.correct_options)) {
                    // Multiple correct answers - check if they're labels or content
                    correctOptions = question.correct_options.map(opt => {
                        if (question.options && question.options[opt]) {
                            // It's a label, convert to content
                            return question.options[opt].trim();
                        } else {
                            // It's already content or no options mapping available
                            return opt.trim();
                        }
                    });
                }
                
                // Extract weightages and maxPoints if available
                if (question.weightages && typeof question.weightages === 'object') {
                    // Convert weightages to use content as keys if needed
                    if (question.options) {
                        Object.keys(question.weightages).forEach(key => {
                            if (question.options[key]) {
                                // Convert label-based weightage to content-based
                                weightages[question.options[key].trim()] = question.weightages[key];
                            } else {
                                // Already content-based or direct mapping
                                weightages[key] = question.weightages[key];
                            }
                        });
                    } else {
                        weightages = question.weightages;
                    }
                }
                if (question.points_per_blank && question.points_per_blank > 0) {
                    maxPoints = question.points_per_blank;
                } else if (question.max_points && question.max_points > 0) {
                    maxPoints = question.max_points;
                }
                
                if (correctOptions.length === 0) {
                    console.warn(`⚠️ No correct answer defined for question ${detected.question}`);
                    return;
                }

                // Get student answers and convert labels to content
                let studentOptions = [];
                if (detected.selected_options && Array.isArray(detected.selected_options)) {
                    // New format with multiple options - convert labels to content
                    studentOptions = detected.selected_options.map(opt => {
                        // Try case-insensitive match for option labels
                        const upperOpt = opt.toString().toUpperCase();
                        if (question.options && question.options[upperOpt]) {
                            // It's a label, convert to content
                            return question.options[upperOpt].trim();
                        } else {
                            // Check case-insensitive match
                            const matchedKey = Object.keys(question.options || {}).find(key => 
                                key.toUpperCase() === upperOpt
                            );
                            if (matchedKey && question.options[matchedKey]) {
                                return question.options[matchedKey].trim();
                            }
                            // It's already content or no options mapping available
                            return opt.toString().trim();
                        }
                    });
                } else if (detected.selected_option) {
                    // Old format with single option - convert label to content
                    const upperOpt = detected.selected_option.toString().toUpperCase();
                    if (question.options && question.options[upperOpt]) {
                        // It's a label, convert to content
                        studentOptions = [question.options[upperOpt].trim()];
                    } else {
                        // Check case-insensitive match
                        const matchedKey = Object.keys(question.options || {}).find(key => 
                            key.toUpperCase() === upperOpt
                        );
                        if (matchedKey && question.options[matchedKey]) {
                            studentOptions = [question.options[matchedKey].trim()];
                        } else {
                            // It's already content or no options mapping available
                            studentOptions = [detected.selected_option.toString().trim()];
                        }
                    }
                }

                // Calculate score based on matching with weightages support
                const { score, isCorrect, details, weightageBreakdown } = this.calculateMultipleChoiceScore(
                    studentOptions, 
                    correctOptions,
                    weightages,
                    maxPoints
                );

                if (isCorrect || score > 0) {
                    correctAnswers++;
                    totalScore += score;
                }

                results.push({
                    question_number: detected.question,
                    student_answers: studentOptions,
                    correct_answers: correctOptions,
                    is_correct: isCorrect,
                    partial_score: score,
                    max_points: maxPoints,
                    confidence: detected.confidence,
                    marking_type: detected.marking_type || 'unknown',
                    evaluation_details: details,
                    weightage_breakdown: weightageBreakdown || []
                });
            });

            // Check for unanswered questions
            questions.forEach(q => {
                const wasAnswered = detectedAnswers.some(d => d.question === q.question_number);
                if (!wasAnswered) {
                    let correctOptions = [];
                    if (q.correct_option) {
                        correctOptions = [q.correct_option.toUpperCase()];
                    } else if (q.correct_options && Array.isArray(q.correct_options)) {
                        correctOptions = q.correct_options.map(opt => opt.toUpperCase());
                    }
                    
                    const maxPoints = q.points_per_blank || q.max_points || 1;

                    results.push({
                        question_number: q.question_number,
                        student_answers: [],
                        correct_answers: correctOptions,
                        is_correct: false,
                        partial_score: 0,
                        max_points: maxPoints,
                        confidence: null,
                        marking_type: 'none',
                        evaluation_details: 'No answer detected'
                    });
                }
            });

            const percentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

            return {
                results,
                summary: {
                    total_questions: totalQuestions,
                    answered_questions: answeredQuestions,
                    correct_answers: correctAnswers,
                    total_score: totalScore,
                    max_score: maxPossibleScore,
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
     * Calculate score for multiple choice questions with multiple correct answers
     * NEW: Supports weightage-based scoring where wrong options result in zero marks
     * @param {Array} studentAnswers - Array of student selected options
     * @param {Array} correctAnswers - Array of correct options
     * @param {Object} weightages - Weightage mapping for correct options (optional)
     * @param {number} maxPoints - Maximum points for this question (default: 1)
     * @returns {Object} Score calculation result
     */
    calculateMultipleChoiceScore(studentAnswers, correctAnswers, weightages = {}, maxPoints = 1) {
        // Handle empty arrays
        if (studentAnswers.length === 0) {
            return {
                score: 0,
                isCorrect: false,
                details: 'No answers selected'
            };
        }

        if (correctAnswers.length === 0) {
            return {
                score: 0,
                isCorrect: false,
                details: 'No correct answers defined'
            };
        }

        // 🔄 CASE-INSENSITIVE COMPARISON: Normalize all options
        const normalizeOption = (opt) => opt.toString().trim().toLowerCase();
        
        const normalizedStudentAnswers = studentAnswers.map(normalizeOption);
        const normalizedCorrectAnswers = correctAnswers.map(normalizeOption);
        
        // Convert to sets for easier comparison
        const studentSet = new Set(normalizedStudentAnswers);
        const correctSet = new Set(normalizedCorrectAnswers);

        // Calculate matches using normalized versions
        const correctSelections = [...studentSet].filter(ans => correctSet.has(ans));
        const incorrectSelections = [...studentSet].filter(ans => !correctSet.has(ans));

        // NEW LOGIC: If any wrong option is selected, score is 0
        if (incorrectSelections.length > 0) {
            return {
                score: 0,
                isCorrect: false,
                details: `Wrong option(s) selected: ${incorrectSelections.join(', ')}. No partial marking.`,
                weightageBreakdown: []
            };
        }

        // Only correct options selected - calculate score using original options for weightage lookup
        let questionScore = 0;
        const breakdown = [];

        // Check if we have weightages defined
        const hasWeightages = Object.keys(weightages).length > 0;

        if (hasWeightages) {
            // Use weightage-based scoring - map back to original options for weightage lookup
            questionScore = studentAnswers.reduce((sum, originalOption) => {
                const normalizedOption = normalizeOption(originalOption);
                if (correctSet.has(normalizedOption)) {
                    // Find case-insensitive match in weightages
                    let weight = 0;
                    if (weightages[originalOption]) {
                        weight = weightages[originalOption];
                    } else {
                        // Try case-insensitive match
                        const matchedKey = Object.keys(weightages).find(key => 
                            normalizeOption(key) === normalizedOption
                        );
                        if (matchedKey) {
                            weight = weightages[matchedKey];
                        }
                    }
                    breakdown.push({ option: originalOption, weight });
                    return sum + weight;
                } else {
                    return sum;
                }
            }, 0);
            
            // Round to 2 decimal places
            questionScore = Math.round(questionScore * 100) / 100;
            
            const isCorrect = (correctSelections.length === correctAnswers.length) && (questionScore === maxPoints);
            
            return {
                score: questionScore,
                isCorrect: isCorrect,
                details: correctSelections.length === correctAnswers.length ? 
                    `All correct options selected. Score: ${questionScore}/${maxPoints}` :
                    `Partial correct options: ${correctSelections.join(', ')}. Score: ${questionScore}/${maxPoints}`,
                weightageBreakdown: breakdown
            };
        } else {
            // Traditional scoring logic (backward compatibility)
            if (correctAnswers.length === 1) {
                // Single correct answer
                const isExactMatch = correctSelections.length === 1 && incorrectSelections.length === 0;
                return {
                    score: isExactMatch ? maxPoints : 0,
                    isCorrect: isExactMatch,
                    details: isExactMatch ? 'Correct' : 'Wrong answer'
                };
            } else {
                // Multiple correct answers - proportional scoring
                const totalCorrect = correctAnswers.length;
                const correctlySelected = correctSelections.length;

                // Perfect match gets full score
                if (correctlySelected === totalCorrect) {
                    return {
                        score: maxPoints,
                        isCorrect: true,
                        details: 'All correct answers selected'
                    };
                }

                // Partial credit based on correct selections
                let partialScore = 0;
                if (correctlySelected > 0) {
                    partialScore = (correctlySelected / totalCorrect) * maxPoints;
                    partialScore = Math.round(partialScore * 100) / 100;
                }

                return {
                    score: partialScore,
                    isCorrect: partialScore >= (0.8 * maxPoints), // Consider 80%+ as "correct"
                    details: `Partial credit: ${correctlySelected}/${totalCorrect} correct`
                };
            }
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
            
            Look for ANY of these OMR indicators:
            1. Multiple choice questions with circular bubbles/circles to fill
            2. Grid-like layout with options A, B, C, D, E
            3. Question numbers arranged in rows
            4. Standardized answer sheet format
            5. Answer markings that could be:
               - Filled/shaded circles
               - Checkmarks above or beside options
               - Marks to the right of option letters
               - Any systematic marking pattern for multiple choice
            
            vs Non-OMR formats:
            1. Written text answers or essays
            2. Fill-in-the-blank questions with lines
            3. Mathematical equations to solve
            4. Diagram-based questions
            5. Free-form response areas
            
            Return JSON:
            {
              "is_omr_style": true/false,
              "confidence": "high/medium/low",
              "detected_features": ["circles", "grid_layout", "multiple_choice", "systematic_marking"],
              "question_type": "omr/traditional/mixed",
              "marking_patterns": ["filled_circles", "checkmarks", "marks_above", "marks_right"],
              "estimated_questions": 5
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
                    question_type: "traditional",
                    marking_patterns: [],
                    estimated_questions: 0
                };
            }

        } catch (error) {
            console.error('❌ OMR Style Detection failed:', error.message);
            return {
                is_omr_style: false,
                confidence: "low",
                detected_features: [],
                question_type: "traditional",
                marking_patterns: [],
                estimated_questions: 0
            };
        }
    }
}

module.exports = OMRService;
