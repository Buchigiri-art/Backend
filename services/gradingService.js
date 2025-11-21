const { GoogleGenerativeAI } = require('@google/generative-ai');

class GradingService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not set. Auto-grading will not work.');
    }
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  }

  async gradeQuizAttempt(questions, studentAnswers) {
    if (!this.genAI) {
      throw new Error('Gemini API not configured');
    }

    const gradedAnswers = [];
    let totalMarks = 0;
    const maxMarks = questions.length;

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const studentAnswer = studentAnswers[i];

      const gradedAnswer = {
        questionId: question.id,
        question: question.question,
        type: question.type,
        options: question.options || [],
        studentAnswer: studentAnswer,
        correctAnswer: question.answer,
        explanation: question.explanation || ''
      };

      if (question.type === 'mcq') {
        // MCQ grading is straightforward
        const isCorrect = this.normalizeMCQAnswer(studentAnswer) === this.normalizeMCQAnswer(question.answer);
        gradedAnswer.isCorrect = isCorrect;
        gradedAnswer.marks = isCorrect ? 1 : 0;
        totalMarks += gradedAnswer.marks;
      } else if (question.type === 'short-answer') {
        // Use Gemini to grade short answers
        try {
          const grading = await this.gradeShortAnswer(
            question.question,
            question.answer,
            studentAnswer
          );
          gradedAnswer.isCorrect = grading.isCorrect;
          gradedAnswer.marks = grading.marks;
          gradedAnswer.explanation = grading.feedback;
          totalMarks += gradedAnswer.marks;
        } catch (error) {
          console.error('Error grading short answer:', error);
          gradedAnswer.isCorrect = false;
          gradedAnswer.marks = 0;
          gradedAnswer.explanation = 'Error in auto-grading. Manual review needed.';
        }
      }

      gradedAnswers.push(gradedAnswer);
    }

    const percentage = maxMarks > 0 ? (totalMarks / maxMarks) * 100 : 0;

    return {
      gradedAnswers,
      totalMarks,
      maxMarks,
      percentage: Math.round(percentage * 100) / 100
    };
  }

  async gradeShortAnswer(question, correctAnswer, studentAnswer) {
    if (!studentAnswer || studentAnswer.trim() === '') {
      return {
        isCorrect: false,
        marks: 0,
        feedback: 'No answer provided.'
      };
    }

    const model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `You are an expert teacher grading a student's answer. Be fair and objective.

QUESTION: ${question}

EXPECTED ANSWER (Model Answer): ${correctAnswer}

STUDENT'S ANSWER: ${studentAnswer}

Evaluate the student's answer and provide:
1. Whether the answer is correct (true/false) - Be lenient if key concepts are present
2. Marks (0 to 1, can be 0.5 for partial credit)
3. Brief feedback

Respond ONLY with valid JSON in this exact format:
{
  "isCorrect": true or false,
  "marks": 0, 0.5, or 1,
  "feedback": "Brief feedback explaining the marks"
}`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let responseText = response.text().trim();

      // Clean up response
      if (responseText.startsWith('```json')) {
        responseText = responseText.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (responseText.startsWith('```')) {
        responseText = responseText.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      const grading = JSON.parse(responseText);
      
      // Validate response
      if (typeof grading.isCorrect !== 'boolean' || 
          typeof grading.marks !== 'number' ||
          !grading.feedback) {
        throw new Error('Invalid grading format');
      }

      // Ensure marks are in valid range
      grading.marks = Math.max(0, Math.min(1, grading.marks));

      return grading;
    } catch (error) {
      console.error('Gemini grading error:', error);
      // Fallback: simple string matching
      const similarity = this.calculateSimilarity(
        correctAnswer.toLowerCase(),
        studentAnswer.toLowerCase()
      );
      
      if (similarity > 0.7) {
        return { isCorrect: true, marks: 1, feedback: 'Answer matches expected response.' };
      } else if (similarity > 0.4) {
        return { isCorrect: false, marks: 0.5, feedback: 'Partially correct answer.' };
      } else {
        return { isCorrect: false, marks: 0, feedback: 'Answer does not match expected response.' };
      }
    }
  }

  normalizeMCQAnswer(answer) {
    if (!answer) return '';
    // Handle "A", "Option A", "A)", etc.
    const match = answer.trim().toUpperCase().match(/^([A-D])/);
    return match ? match[1] : answer.trim().toUpperCase();
  }

  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

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
}

module.exports = new GradingService();
