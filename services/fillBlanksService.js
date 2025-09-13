const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

class FillBlanksService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    }

    /**
     * Extract fill-in-the-blanks questions from question paper image
     */
    async extractFillBlanksFromBuffer(imageBuffer, mimeType = 'image/jpeg') {
        try {
            console.log('=== Processing Fill-in-the-Blanks Question Paper ===');

            const imageBase64 = imageBuffer.toString('base64');

            const prompt = `
            Analyze this question paper image and identify fill-in-the-blank questions.
            Look for questions with blank spaces (_____, _______, or similar) that need to be filled.
            
            Return ONLY valid JSON with this exact structure:
            {
              "questions": [
                {
                  "number": 1,
                  "text": "The capital of France is _____ and it has a population of _____.",
                  "questionFormat": "fill_blanks",
                  "blankPositions": [
                    {
                      "position": 1,
                      "expectedAnswers": ["Paris", "paris"],
                      "points": 2,
                      "matchType": "fuzzy"
                    },
                    {
                      "position": 2,
                      "expectedAnswers": ["2.1 million", "2100000", "over 2 million"],
                      "points": 1,
                      "matchType": "fuzzy"
                    }
                  ],
                  "totalPoints": 3
                }
              ]
            }

            Rules:
            - Only extract questions that have fill-in-the-blank format (with _____ or blank spaces)
            - Identify all blank positions in each question
            - If you can see answer keys or correct answers, include them in expectedAnswers
            - Use matchType: "exact" for precise matches, "fuzzy" for flexible matching, "contains" for partial matches
            - If no correct answers are visible, put ["unknown"] in expectedAnswers
            - Ensure the JSON is valid and properly formatted
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending fill-blanks extraction request to Gemini API...');
            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✓ Successfully extracted ${parsedData.questions.length} fill-in-the-blanks questions`);
                
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
            console.error('Error extracting fill-blanks questions:', error);
            return {
                success: false,
                error: error.message,
                questions: [],
                totalQuestions: 0
            };
        }
    }

    /**
     * Extract student answers from fill-in-the-blanks answer sheet
     */
    async extractStudentFillBlanksFromBuffer(imageBuffer, questions, mimeType = 'image/jpeg') {
        try {
            console.log('=== Processing Fill-in-the-Blanks Student Answer Sheet ===');

            const imageBase64 = imageBuffer.toString('base64');

            // Create question context for better accuracy
            const questionContext = questions.map(q => ({
                number: q.question_number,
                text: q.question_text,
                blanks: q.blank_positions ? q.blank_positions.length : 1
            }));

            const prompt = `
            Analyze this student answer sheet for fill-in-the-blank questions.
            Look for handwritten or typed text that fills in blank spaces.
            
            Here are the questions for context:
            ${JSON.stringify(questionContext, null, 2)}
            
            Return ONLY valid JSON with this exact structure:
            {
              "answers": [
                {
                  "question": 1,
                  "blankAnswers": [
                    {
                      "position": 1,
                      "answer": "student's written answer",
                      "confidence": "high"
                    },
                    {
                      "position": 2,
                      "answer": "another answer",
                      "confidence": "medium"
                    }
                  ]
                }
              ]
            }

            Rules:
            - Extract text from all visible blank spaces in the answer sheet
            - Use confidence levels: "high", "medium", "low" based on text clarity
            - If text is unclear or illegible, use "illegible" as the answer
            - Only include questions where you can see student answers
            - Preserve original text formatting and spelling
            - Do not include any explanatory text, only the JSON
            `;

            const imagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType
                }
            };

            console.log('Sending student fill-blanks extraction request to Gemini API...');
            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();

            // Clean up the response to extract JSON
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsedData = JSON.parse(text);
                console.log(`✓ Successfully extracted ${parsedData.answers.length} fill-blanks student answers`);
                
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
            console.error('Error extracting student fill-blanks answers:', error);
            return {
                success: false,
                error: error.message,
                answers: [],
                totalAnswers: 0
            };
        }
    }

    /**
     * Evaluate fill-in-the-blanks answers with fuzzy matching
     */
    evaluateFillBlanks(correctAnswers, studentAnswers) {
        const results = [];
        let totalScore = 0;
        let totalPossibleScore = 0;

        for (const correctAnswer of correctAnswers) {
            const questionNumber = correctAnswer.question_number;
            const studentAnswer = studentAnswers.find(a => a.question === questionNumber);
            
            if (!studentAnswer) {
                // No student answer found
                const questionResult = {
                    questionNumber,
                    score: 0,
                    totalPoints: this.calculateQuestionPoints(correctAnswer),
                    blankResults: []
                };
                results.push(questionResult);
                totalPossibleScore += questionResult.totalPoints;
                continue;
            }

            let questionScore = 0;
            const blankResults = [];
            const blankPositions = correctAnswer.blank_positions || [];

            for (const blankPos of blankPositions) {
                const studentBlank = studentAnswer.blankAnswers?.find(b => b.position === blankPos.position);
                const studentText = studentBlank?.answer?.trim() || '';
                
                const blankResult = this.evaluateBlankAnswer(
                    studentText, 
                    blankPos.expectedAnswers, 
                    blankPos.matchType || 'fuzzy',
                    blankPos.points || 1
                );
                
                blankResults.push({
                    position: blankPos.position,
                    studentAnswer: studentText,
                    expectedAnswers: blankPos.expectedAnswers,
                    isCorrect: blankResult.isCorrect,
                    score: blankResult.score,
                    maxPoints: blankPos.points || 1,
                    matchType: blankPos.matchType || 'fuzzy',
                    confidence: studentBlank?.confidence || 'unknown'
                });
                
                questionScore += blankResult.score;
            }

            const questionTotalPoints = this.calculateQuestionPoints(correctAnswer);
            
            results.push({
                questionNumber,
                score: questionScore,
                totalPoints: questionTotalPoints,
                blankResults
            });

            totalScore += questionScore;
            totalPossibleScore += questionTotalPoints;
        }

        const percentage = totalPossibleScore > 0 ? (totalScore / totalPossibleScore) * 100 : 0;

        return {
            score: totalScore,
            totalQuestions: correctAnswers.length,
            totalPossibleScore,
            percentage,
            results
        };
    }

    /**
     * Evaluate a single blank answer
     */
    evaluateBlankAnswer(studentAnswer, expectedAnswers, matchType = 'fuzzy', points = 1) {
        if (!studentAnswer || studentAnswer === 'illegible') {
            return { isCorrect: false, score: 0 };
        }

        const normalizedStudent = studentAnswer.toLowerCase().trim();

        for (const expected of expectedAnswers) {
            if (expected.toLowerCase() === 'unknown') {
                // If answer is unknown, give partial credit for any reasonable attempt
                return { isCorrect: true, score: Math.floor(points * 0.5) };
            }

            const normalizedExpected = expected.toLowerCase().trim();
            let isMatch = false;

            switch (matchType) {
                case 'exact':
                    isMatch = normalizedStudent === normalizedExpected;
                    break;
                case 'contains':
                    isMatch = normalizedStudent.includes(normalizedExpected) || 
                             normalizedExpected.includes(normalizedStudent);
                    break;
                case 'fuzzy':
                default:
                    // Fuzzy matching with Levenshtein distance
                    const similarity = this.calculateSimilarity(normalizedStudent, normalizedExpected);
                    isMatch = similarity >= 0.8; // 80% similarity threshold
                    if (!isMatch && similarity >= 0.6) {
                        // Partial credit for close matches
                        return { isCorrect: true, score: Math.floor(points * 0.7) };
                    }
                    break;
            }

            if (isMatch) {
                return { isCorrect: true, score: points };
            }
        }

        return { isCorrect: false, score: 0 };
    }

    /**
     * Calculate total points for a question
     */
    calculateQuestionPoints(question) {
        if (question.blank_positions && Array.isArray(question.blank_positions)) {
            return question.blank_positions.reduce((sum, blank) => sum + (blank.points || 1), 0);
        }
        return question.points_per_blank || 1;
    }

    /**
     * Calculate similarity between two strings using Levenshtein distance
     */
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) {
            return 1.0;
        }
        
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Detect if a question paper contains fill-in-the-blanks questions
     */
    async detectFillBlanksStyle(imageBuffer, mimeType = 'image/jpeg') {
        try {
            const imageBase64 = imageBuffer.toString('base64');

            const prompt = `
            Analyze this image and determine if it contains fill-in-the-blank questions.
            Look for:
            - Blank spaces represented by underscores (_____, ______)
            - Empty lines or boxes for filling in answers
            - Text like "Fill in the blanks" or similar instructions
            - Questions with missing words that need to be completed
            
            Return ONLY valid JSON:
            {
              "hasFillBlanks": true/false,
              "confidence": 0.9,
              "questionFormat": "fill_blanks" or "mixed" or "multiple_choice",
              "estimatedBlanks": 10
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
                const parsedData = JSON.parse(text);
                return parsedData;
            } catch (parseError) {
                return {
                    hasFillBlanks: false,
                    confidence: 0.0,
                    questionFormat: "multiple_choice",
                    estimatedBlanks: 0
                };
            }

        } catch (error) {
            console.error('Error detecting fill-blanks style:', error);
            return {
                hasFillBlanks: false,
                confidence: 0.0,
                questionFormat: "multiple_choice",
                estimatedBlanks: 0
            };
        }
    }
}

module.exports = new FillBlanksService();