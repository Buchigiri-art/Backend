// backend/services/excelService.js

// Handle both CJS and ESM builds of xlsx
let XLSXLib = require('xlsx');
const XLSX = XLSXLib && XLSXLib.default ? XLSXLib.default : XLSXLib;

class ExcelService {
  // Helper: workbook → Node Buffer
  _workbookToBuffer(workbook) {
    // Write workbook as binary string
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'binary' });
    // Convert binary string to Buffer
    return Buffer.from(wbout, 'binary');
  }

  generateQuizResultsExcel(quizTitle, attempts) {
    const safeTitle = quizTitle || 'Quiz';
    const safeAttempts = Array.isArray(attempts) ? attempts : [];

    const wsData = [
      ['Quiz Results Report'],
      ['Quiz Title:', safeTitle],
      ['Generated on:', new Date().toLocaleString()],
      ['Total Students:', safeAttempts.length],
      [],
      [
        'Name',
        'USN',
        'Email',
        'Branch',
        'Year',
        'Semester',
        'Total Marks',
        'Max Marks',
        'Percentage (%)',
        'Status',
        'Submitted At',
      ],
    ];

    safeAttempts.forEach((attempt) => {
      const totalMarks = Number.isFinite(Number(attempt.totalMarks))
        ? Number(attempt.totalMarks)
        : 0;
      const maxMarks = Number.isFinite(Number(attempt.maxMarks))
        ? Number(attempt.maxMarks)
        : 0;
      const percentage = Number.isFinite(Number(attempt.percentage))
        ? Number(attempt.percentage)
        : 0;

      wsData.push([
        attempt.studentName || '',
        attempt.studentUSN || '',
        attempt.studentEmail || '',
        attempt.studentBranch || '',
        attempt.studentYear || '',
        attempt.studentSemester || '',
        totalMarks,
        maxMarks,
        percentage,
        attempt.status || '',
        attempt.submittedAt
          ? new Date(attempt.submittedAt).toLocaleString()
          : 'Not submitted',
      ]);
    });

    if (safeAttempts.length > 0) {
      const totalMarksArr = safeAttempts.map((a) =>
        Number.isFinite(Number(a.totalMarks)) ? Number(a.totalMarks) : 0,
      );
      const percentageArr = safeAttempts.map((a) =>
        Number.isFinite(Number(a.percentage)) ? Number(a.percentage) : 0,
      );

      const avgMarks =
        totalMarksArr.reduce((sum, v) => sum + v, 0) / safeAttempts.length;
      const avgPercentage =
        percentageArr.reduce((sum, v) => sum + v, 0) / safeAttempts.length;

      const maxScore = Math.max(...totalMarksArr);
      const minScore = Math.min(...totalMarksArr);
      const passCount = percentageArr.filter((p) => p >= 40).length;

      wsData.push([]);
      wsData.push(['Statistics']);
      wsData.push(['Average Marks:', avgMarks.toFixed(2)]);
      wsData.push(['Average Percentage:', `${avgPercentage.toFixed(2)}%`]);
      wsData.push(['Highest Score:', maxScore]);
      wsData.push(['Lowest Score:', minScore]);
      wsData.push([
        'Pass Rate (≥40%):',
        `${passCount}/${safeAttempts.length}`,
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [
      { wch: 20 }, // Name
      { wch: 15 }, // USN
      { wch: 25 }, // Email
      { wch: 15 }, // Branch
      { wch: 10 }, // Year
      { wch: 10 }, // Semester
      { wch: 12 }, // Total Marks
      { wch: 12 }, // Max Marks
      { wch: 15 }, // Percentage
      { wch: 12 }, // Status
      { wch: 20 }, // Submitted At
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Results');

    // ✅ Return Buffer
    return this._workbookToBuffer(wb);
  }

  generateDetailedQuizResultsExcel(quizTitle, quiz, attempts) {
    const safeTitle = quizTitle || 'Quiz';
    const safeQuiz = quiz || {};
    const safeAttempts = Array.isArray(attempts) ? attempts : [];

    const questionCount = Array.isArray(safeQuiz.questions)
      ? safeQuiz.questions.length
      : 0;

    const wb = XLSX.utils.book_new();

    const summaryData = [
      ['Quiz Results - Detailed Report'],
      ['Quiz Title:', safeTitle],
      ['Generated on:', new Date().toLocaleString()],
      ['Total Questions:', questionCount],
      ['Total Students:', safeAttempts.length],
      [],
      [
        'Name',
        'USN',
        'Email',
        'Branch',
        'Year',
        'Semester',
        'Total Marks',
        'Max Marks',
        'Percentage (%)',
        'Status',
      ],
    ];

    safeAttempts.forEach((attempt) => {
      const totalMarks = Number.isFinite(Number(attempt.totalMarks))
        ? Number(attempt.totalMarks)
        : 0;
      const maxMarks = Number.isFinite(Number(attempt.maxMarks))
        ? Number(attempt.maxMarks)
        : 0;
      const percentage = Number.isFinite(Number(attempt.percentage))
        ? Number(attempt.percentage)
        : 0;

      summaryData.push([
        attempt.studentName || '',
        attempt.studentUSN || '',
        attempt.studentEmail || '',
        attempt.studentBranch || '',
        attempt.studentYear || '',
        attempt.studentSemester || '',
        totalMarks,
        maxMarks,
        percentage,
        attempt.status || '',
      ]);
    });

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 20 },
      { wch: 15 },
      { wch: 25 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Individual student sheets (limit to first 10)
    safeAttempts.slice(0, 10).forEach((attempt, i) => {
      const answers = Array.isArray(attempt.answers) ? attempt.answers : [];

      const totalMarks = Number.isFinite(Number(attempt.totalMarks))
        ? Number(attempt.totalMarks)
        : 0;
      const maxMarks = Number.isFinite(Number(attempt.maxMarks))
        ? Number(attempt.maxMarks)
        : 0;
      const percentage = Number.isFinite(Number(attempt.percentage))
        ? Number(attempt.percentage)
        : 0;

      const studentData = [
        ['Student Details'],
        ['Name:', attempt.studentName || ''],
        ['USN:', attempt.studentUSN || ''],
        ['Email:', attempt.studentEmail || ''],
        ['Branch:', attempt.studentBranch || ''],
        ['Year:', attempt.studentYear || ''],
        ['Semester:', attempt.studentSemester || ''],
        [],
        ['Score:', `${totalMarks}/${maxMarks} (${percentage.toFixed(2)}%)`],
        [],
        ['Question', 'Type', 'Student Answer', 'Correct Answer', 'Result', 'Marks'],
      ];

      answers.forEach((ans, qNum) => {
        const isCorrect = !!ans.isCorrect;
        studentData.push([
          `Q${qNum + 1}: ${ans.question || ''}`,
          ans.type || '',
          ans.studentAnswer || 'Not answered',
          ans.correctAnswer || '',
          isCorrect ? 'Correct' : 'Incorrect',
          Number.isFinite(Number(ans.marks)) ? Number(ans.marks) : '',
        ]);
      });

      const wsStudent = XLSX.utils.aoa_to_sheet(studentData);
      wsStudent['!cols'] = [
        { wch: 50 },
        { wch: 15 },
        { wch: 30 },
        { wch: 30 },
        { wch: 12 },
        { wch: 10 },
      ];

      const rawName =
        attempt.studentUSN || attempt.studentName || `Student${i + 1}`;
      const sheetName = String(rawName).substring(0, 31);

      XLSX.utils.book_append_sheet(wb, wsStudent, sheetName);
    });

    // ✅ Return Buffer
    return this._workbookToBuffer(wb);
  }
}

module.exports = new ExcelService();
