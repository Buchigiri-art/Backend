// backend/services/excelService.js
const XLSX = require('xlsx');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Excel sheet name sanitization + uniqueness helper
function makeUniqueSheetName(rawName, usedNames, fallbackBase) {
  // Excel sheet name rules:
  // - Max 31 chars
  // - Cannot contain: : \ / ? * [ ]
  // - Cannot be empty
  const invalidChars = /[:\\\/\?\*\[\]]/g;

  let base = String(rawName || fallbackBase || 'Sheet')
    .replace(invalidChars, '_')
    .trim();

  if (!base) {
    base = fallbackBase || 'Sheet';
  }

  // Leave room for suffixes like "_2", "_3"
  base = base.substring(0, 25);

  let name = base;
  let suffix = 1;

  while (usedNames.has(name)) {
    const sfx = `_${suffix++}`;
    name = (base + sfx).substring(0, 31);
  }

  usedNames.add(name);
  return name;
}

class ExcelService {
  generateQuizResultsExcel(quizTitle, attempts) {
    const safeTitle = quizTitle || 'Quiz';
    const safeAttempts = Array.isArray(attempts) ? attempts : [];

    // Header / meta info
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

    // Student rows
    safeAttempts.forEach((attempt) => {
      const totalMarks = toNumber(attempt.totalMarks, 0);
      const maxMarks = toNumber(attempt.maxMarks, 0);
      const percentage = toNumber(attempt.percentage, 0);

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

    // Statistics
    if (safeAttempts.length > 0) {
      const totalMarksArr = safeAttempts.map((a) => toNumber(a.totalMarks, 0));
      const percentageArr = safeAttempts.map((a) => toNumber(a.percentage, 0));

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

    // Column widths
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

    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return excelBuffer;
  }

  generateDetailedQuizResultsExcel(quizTitle, quiz, attempts) {
    const safeTitle = quizTitle || 'Quiz';
    const safeQuiz = quiz || {};
    const safeAttempts = Array.isArray(attempts) ? attempts : [];

    const questionCount = Array.isArray(safeQuiz.questions)
      ? safeQuiz.questions.length
      : 0;

    const wb = XLSX.utils.book_new();
    const usedNames = new Set();

    // Summary sheet
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
      const totalMarks = toNumber(attempt.totalMarks, 0);
      const maxMarks = toNumber(attempt.maxMarks, 0);
      const percentage = toNumber(attempt.percentage, 0);

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
    XLSX.utils.book_append_sheet(wb, wsSummary, makeUniqueSheetName('Summary', usedNames, 'Summary'));

    // Individual student sheets (limit to first 10 for performance)
    safeAttempts.slice(0, 10).forEach((attempt, i) => {
      const answers = Array.isArray(attempt.answers) ? attempt.answers : [];

      const totalMarks = toNumber(attempt.totalMarks, 0);
      const maxMarks = toNumber(attempt.maxMarks, 0);
      const percentage = toNumber(attempt.percentage, 0);

      const studentData = [
        ['Student Details'],
        ['Name:', attempt.studentName || ''],
        ['USN:', attempt.studentUSN || ''],
        ['Email:', attempt.studentEmail || ''],
        ['Branch:', attempt.studentBranch || ''],
        ['Year:', attempt.studentYear || ''],
        ['Semester:', attempt.studentSemester || ''],
        [],
        [
          'Score:',
          `${totalMarks}/${maxMarks} (${percentage.toFixed(2)}%)`,
        ],
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
          toNumber(ans.marks, ''),
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
      const sheetName = makeUniqueSheetName(rawName, usedNames, `Student${i + 1}`);

      XLSX.utils.book_append_sheet(wb, wsStudent, sheetName);
    });

    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return excelBuffer;
  }
}

module.exports = new ExcelService();
