// Manual Answer Entry Service - Alternative to OCR
class ManualAnswerService {
    
    // Create a simple answer entry interface
    createAnswerEntryForm(imagePath, totalQuestions = 10) {
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Manual Answer Entry</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .image-section { float: left; width: 60%; }
                .entry-section { float: right; width: 35%; background: #f5f5f5; padding: 20px; }
                .question-row { margin: 10px 0; padding: 10px; background: white; border-radius: 5px; }
                .options { display: flex; gap: 10px; margin-top: 5px; }
                .option { padding: 5px 15px; background: #e9e9e9; border: none; cursor: pointer; border-radius: 3px; }
                .option.selected { background: #4CAF50; color: white; }
                img { max-width: 100%; height: auto; }
                .submit-btn { background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-top: 20px; }
                .clear { clear: both; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Manual Answer Entry</h2>
                
                <div class="image-section">
                    <h3>Question Paper</h3>
                    <img src="/uploads/${imagePath}" alt="Question Paper" />
                </div>
                
                <div class="entry-section">
                    <h3>Enter Answers</h3>
                    <form id="answerForm">
                        ${this.generateQuestionRows(totalQuestions)}
                        <button type="submit" class="submit-btn">Submit Answers</button>
                    </form>
                </div>
                
                <div class="clear"></div>
            </div>
            
            <script>
                // Handle option selection
                document.addEventListener('click', function(e) {
                    if (e.target.classList.contains('option')) {
                        const questionRow = e.target.closest('.question-row');
                        const options = questionRow.querySelectorAll('.option');
                        options.forEach(opt => opt.classList.remove('selected'));
                        e.target.classList.add('selected');
                    }
                });
                
                // Handle form submission
                document.getElementById('answerForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    const answers = {};
                    
                    for (let i = 1; i <= ${totalQuestions}; i++) {
                        const selected = document.querySelector('#q' + i + ' .option.selected');
                        if (selected) {
                            answers[i] = selected.textContent.toLowerCase();
                        }
                    }
                    
                    // Send answers to backend
                    fetch('/api/submit-manual-answers', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ answers, imagePath: '${imagePath}' })
                    })
                    .then(response => response.json())
                    .then(data => {
                        alert('Answers submitted successfully!');
                        window.location.href = '/dashboard';
                    })
                    .catch(error => {
                        alert('Error submitting answers: ' + error.message);
                    });
                });
            </script>
        </body>
        </html>`;
        
        return html;
    }
    
    generateQuestionRows(totalQuestions) {
        let rows = '';
        for (let i = 1; i <= totalQuestions; i++) {
            rows += `
                <div class="question-row" id="q${i}">
                    <strong>Question ${i}:</strong>
                    <div class="options">
                        <button type="button" class="option">A</button>
                        <button type="button" class="option">B</button>
                        <button type="button" class="option">C</button>
                        <button type="button" class="option">D</button>
                    </div>
                </div>
            `;
        }
        return rows;
    }
    
    // Process manually entered answers
    processManualAnswers(answers) {
        const processedAnswers = [];
        
        Object.keys(answers).forEach(questionNum => {
            processedAnswers.push({
                question: parseInt(questionNum),
                answer: answers[questionNum],
                confidence: 'high', // Manual entry is always high confidence
                method: 'manual'
            });
        });
        
        return {
            success: true,
            answers: processedAnswers,
            totalQuestions: processedAnswers.length,
            method: 'manual_entry'
        };
    }
}

module.exports = { ManualAnswerService };
