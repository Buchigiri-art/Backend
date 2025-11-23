const { GoogleGenerativeAI } = require('@google/generative-ai');

class GradingService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.genAI = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;
    this.isEnabled = !!this.apiKey;

    // Grading configuration
    this.config = {
      maxRetries: 3,
      timeout: 30000, // 30 seconds
      fallbackSimilarityThreshold: 0.7,
      partialCreditThreshold: 0.4,
      maxTokens: 1000
    };

    // Metrics tracking
    this.metrics = {
      totalGraded: 0,
      successfulGradings: 0,
      failedGradings: 0,
      fallbackUsed: 0,
      averageResponseTime: 0
    };

    if (!this.isEnabled) {
      console.warn('🚫 GEMINI_API_KEY not set. Auto-grading will use fallback methods only.');
    } else {
      console.log('✅ GradingService initialized with Gemini AI');
    }
  }

  async gradeQuizAttempt(questions, studentAnswers, options = {}) {
    const startTime = Date.now();
    
    try {
      // Input validation
      if (!Array.isArray(questions) || !Array.isArray(studentAnswers)) {
        throw new Error('Questions and studentAnswers must be arrays');
      }

      if (questions.length !== studentAnswers.length) {
        throw new Error('Questions and answers arrays must have the same length');
      }

      const gradedAnswers = [];
      let totalMarks = 0;
      const maxMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);

      // Process questions in parallel where possible
      const gradingPromises = questions.map(async (question, index) => {
        const studentAnswer = studentAnswers[index] || '';
        
        const gradedAnswer = {
          questionId: question.id || question._id,
          question: question.question || question.questionText,
          type: question.type || 'mcq',
          options: question.options || [],
          studentAnswer: studentAnswer,
          correctAnswer: question.answer,
          explanation: question.explanation || '',
          marks: 0,
          isCorrect: false
        };

        try {
          let gradingResult;
          
          if (question.type === 'mcq' || question.type === 'multiple-choice') {
            gradingResult = this.gradeMCQ(question, studentAnswer);
          } else if (question.type === 'short-answer' || question.type === 'descriptive') {
            gradingResult = await this.gradeDescriptiveAnswer(question, studentAnswer, options);
          } else {
            // Default to MCQ grading for unknown types
            gradingResult = this.gradeMCQ(question, studentAnswer);
          }

          Object.assign(gradedAnswer, gradingResult);
        } catch (error) {
          console.error(`Error grading question ${index}:`, error);
          gradedAnswer.marks = 0;
          gradedAnswer.isCorrect = false;
          gradedAnswer.explanation = 'Auto-grading failed. Manual review required.';
        }

        return gradedAnswer;
      });

      // Wait for all questions to be graded
      const results = await Promise.allSettled(gradingPromises);
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const gradedAnswer = result.value;
          gradedAnswers.push(gradedAnswer);
          totalMarks += gradedAnswer.marks;
        } else {
          // Fallback for failed grading
          const question = questions[index];
          gradedAnswers.push({
            questionId: question.id || question._id,
            question: question.question || question.questionText,
            type: question.type || 'mcq',
            options: question.options || [],
            studentAnswer: studentAnswers[index] || '',
            correctAnswer: question.answer,
            explanation: 'Grading failed. Using fallback evaluation.',
            marks: 0,
            isCorrect: false
          });
        }
      });

      const percentage = maxMarks > 0 ? (totalMarks / maxMarks) * 100 : 0;

      // Update metrics
      this.metrics.totalGraded++;
      this.metrics.successfulGradings++;
      this.metrics.averageResponseTime = this._calculateAverageResponseTime(Date.now() - startTime);

      return {
        success: true,
        gradedAnswers,
        totalMarks: Math.round(totalMarks * 100) / 100,
        maxMarks,
        percentage: Math.round(percentage * 100) / 100,
        metrics: {
          processingTime: Date.now() - startTime,
          totalQuestions: questions.length
        }
      };

    } catch (error) {
      this.metrics.totalGraded++;
      this.metrics.failedGradings++;
      
      console.error('Quiz grading failed:', error);
      throw new Error(`Grading failed: ${error.message}`);
    }
  }

  gradeMCQ(question, studentAnswer) {
    const normalizedStudent = this._normalizeMCQAnswer(studentAnswer);
    const normalizedCorrect = this._normalizeMCQAnswer(question.answer);
    const isCorrect = normalizedStudent === normalizedCorrect;
    const marks = isCorrect ? (question.marks || 1) : 0;

    return {
      isCorrect,
      marks,
      explanation: isCorrect 
        ? 'Correct answer selected.' 
        : `Incorrect. Expected: ${question.answer}, Got: ${studentAnswer}`
    };
  }

  async gradeDescriptiveAnswer(question, studentAnswer, options = {}) {
    const startTime = Date.now();
    
    // Handle empty answers
    if (!studentAnswer || studentAnswer.trim() === '') {
      return {
        isCorrect: false,
        marks: 0,
        explanation: 'No answer provided.'
      };
    }

    // Try AI grading if enabled
    if (this.isEnabled && options.useAI !== false) {
      try {
        const aiGrading = await this._gradeWithAI(question, studentAnswer);
        this.metrics.successfulGradings++;
        return aiGrading;
      } catch (aiError) {
        console.warn('AI grading failed, using fallback:', aiError.message);
        this.metrics.fallbackUsed++;
      }
    }

    // Fallback to similarity-based grading
    return this._gradeWithSimilarity(question, studentAnswer);
  }

  async _gradeWithAI(question, studentAnswer, retryCount = 0) {
    const model = this.genAI.getGenerativeModel({ 
      model: 'gemini-pro',
      generationConfig: {
        maxOutputTokens: this.config.maxTokens,
        temperature: 0.1 // Low temperature for consistent grading
      }
    });

    const prompt = `You are an expert educational evaluator. Grade the student's answer objectively and fairly.

CONTEXT:
Question: "${question.question || question.questionText}"
Expected Answer: "${question.answer}"
Student's Answer: "${studentAnswer}"
${question.explanation ? `Explanation: ${question.explanation}` : ''}

GRADING CRITERIA:
- Accuracy: Does the answer contain key concepts from the expected answer?
- Completeness: Are all important points addressed?
- Relevance: Is the answer directly related to the question?
- Be lenient with phrasing but strict with conceptual accuracy.

INSTRUCTIONS:
Respond with ONLY valid JSON in this exact format:
{
  "isCorrect": boolean,
  "marks": number (between 0 and ${question.marks || 1}),
  "confidence": number (0-1),
  "feedback": "brief constructive feedback",
  "keyPointsFound": ["list", "of", "key", "points", "found"],
  "keyPointsMissing": ["list", "of", "missing", "points"]
}

Important: Marks can be fractional for partial credit.`;

    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI grading timeout')), this.config.timeout)
        )
      ]);

      const response = await result.response;
      let responseText = response.text().trim();

      // Clean JSON response
      responseText = responseText.replace(/```json\s?/g, '').replace(/```\s?/g, '').trim();

      const grading = JSON.parse(responseText);
      
      // Validate response structure
      this._validateAIGrading(grading, question.marks || 1);

      return {
        isCorrect: grading.isCorrect,
        marks: Math.min(grading.marks, question.marks || 1),
        explanation: grading.feedback || 'AI-graded response',
        confidence: grading.confidence || 0.5,
        keyPointsFound: grading.keyPointsFound || [],
        keyPointsMissing: grading.keyPointsMissing || []
      };

    } catch (error) {
      if (retryCount < this.config.maxRetries) {
        console.log(`Retrying AI grading (attempt ${retryCount + 1})...`);
        await this._sleep(1000 * (retryCount + 1)); // Exponential backoff
        return this._gradeWithAI(question, studentAnswer, retryCount + 1);
      }
      throw error;
    }
  }

  _gradeWithSimilarity(question, studentAnswer) {
    const similarity = this._calculateSimilarity(
      String(question.answer).toLowerCase(),
      String(studentAnswer).toLowerCase()
    );

    const maxMarks = question.marks || 1;
    let marks = 0;
    let isCorrect = false;
    let explanation = '';

    if (similarity >= this.config.fallbackSimilarityThreshold) {
      marks = maxMarks;
      isCorrect = true;
      explanation = 'Answer closely matches expected response.';
    } else if (similarity >= this.config.partialCreditThreshold) {
      marks = maxMarks * 0.5;
      isCorrect = false;
      explanation = 'Partially correct answer.';
    } else {
      marks = 0;
      isCorrect = false;
      explanation = 'Answer does not match expected response.';
    }

    return {
      isCorrect,
      marks,
      explanation,
      confidence: similarity,
      similarityScore: similarity
    };
  }

  _validateAIGrading(grading, maxMarks) {
    if (typeof grading.isCorrect !== 'boolean') {
      throw new Error('Invalid isCorrect field in AI response');
    }
    if (typeof grading.marks !== 'number' || grading.marks < 0 || grading.marks > maxMarks) {
      throw new Error(`Invalid marks field in AI response: ${grading.marks}`);
    }
    if (!grading.feedback || typeof grading.feedback !== 'string') {
      throw new Error('Invalid feedback field in AI response');
    }
  }

  _normalizeMCQAnswer(answer) {
    if (!answer) return '';
    
    // Handle various MCQ answer formats
    const normalized = String(answer).trim().toUpperCase();
    
    // Extract first letter for "A", "Option A", "A)", etc.
    const letterMatch = normalized.match(/^([A-D])/);
    if (letterMatch) return letterMatch[1];
    
    // Handle numeric options "1", "2", etc.
    const numberMatch = normalized.match(/^(\d+)/);
    if (numberMatch) return numberMatch[1];
    
    return normalized;
  }

  _calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    // Simple word overlap similarity
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  _calculateAverageResponseTime(newTime) {
    return (this.metrics.averageResponseTime * (this.metrics.totalGraded - 1) + newTime) / this.metrics.totalGraded;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public methods for monitoring
  getStatus() {
    return {
      enabled: this.isEnabled,
      metrics: { ...this.metrics },
      config: { ...this.config }
    };
  }

  resetMetrics() {
    this.metrics = {
      totalGraded: 0,
      successfulGradings: 0,
      failedGradings: 0,
      fallbackUsed: 0,
      averageResponseTime: 0
    };
  }
}

// Create singleton instance
const gradingService = new GradingService();

module.exports = gradingService;