const XLSX = require('xlsx');

class ExcelService {
  generateQuizResultsExcel(quizTitle, attempts) {
    // Create worksheet data
    const wsData = [
      ['Quiz Results Report'],
      ['Quiz Title:', quizTitle],
      ['Generated on:', new Date().toLocaleString()],
      ['Total Students:', attempts.length],
      [],
      ['Name', 'USN', 'Email', 'Branch', 'Year', 'Semester', 'Total Marks', 'Max Marks', 'Percentage (%)', 'Status', 'Submitted At']
    ];

    // Add student data
    attempts.forEach(attempt => {
      wsData.push([
        attempt.studentName,
        attempt.studentUSN,
        attempt.studentEmail,
        attempt.studentBranch,
        attempt.studentYear,
        attempt.studentSemester,
        attempt.totalMarks,
        attempt.maxMarks,
        attempt.percentage,
        attempt.status,
        attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : 'Not submitted'
      ]);
    });

    // Calculate statistics
    if (attempts.length > 0) {
      const avgMarks = attempts.reduce((sum, a) => sum + a.totalMarks, 0) / attempts.length;
      const avgPercentage = attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length;
      const maxScore = Math.max(...attempts.map(a => a.totalMarks));
      const minScore = Math.min(...attempts.map(a => a.totalMarks));

      wsData.push([]);
      wsData.push(['Statistics']);
      wsData.push(['Average Marks:', avgMarks.toFixed(2)]);
      wsData.push(['Average Percentage:', avgPercentage.toFixed(2) + '%']);
      wsData.push(['Highest Score:', maxScore]);
      wsData.push(['Lowest Score:', minScore]);
      wsData.push(['Pass Rate (>40%):', attempts.filter(a => a.percentage >= 40).length + '/' + attempts.length]);
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
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
      { wch: 20 }  // Submitted At
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Results');

    // Generate buffer
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return excelBuffer;
  }

  generateDetailedQuizResultsExcel(quizTitle, quiz, attempts) {
    const wb = XLSX.utils.book_new();

    // Summary Sheet
    const summaryData = [
      ['Quiz Results - Detailed Report'],
      ['Quiz Title:', quizTitle],
      ['Generated on:', new Date().toLocaleString()],
      ['Total Questions:', quiz.questions.length],
      ['Total Students:', attempts.length],
      [],
      ['Name', 'USN', 'Email', 'Branch', 'Year', 'Semester', 'Total Marks', 'Max Marks', 'Percentage (%)', 'Status']
    ];

    attempts.forEach(attempt => {
      summaryData.push([
        attempt.studentName,
        attempt.studentUSN,
        attempt.studentEmail,
        attempt.studentBranch,
        attempt.studentYear,
        attempt.studentSemester,
        attempt.totalMarks,
        attempt.maxMarks,
        attempt.percentage,
        attempt.status
      ]);
    });

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 15 }, 
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, 
      { wch: 15 }, { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Individual student sheets (limit to first 10 for performance)
    attempts.slice(0, 10).forEach((attempt, index) => {
      const studentData = [
        ['Student Details'],
        ['Name:', attempt.studentName],
        ['USN:', attempt.studentUSN],
        ['Email:', attempt.studentEmail],
        ['Branch:', attempt.studentBranch],
        ['Year:', attempt.studentYear],
        ['Semester:', attempt.studentSemester],
        [],
        ['Score:', `${attempt.totalMarks}/${attempt.maxMarks} (${attempt.percentage}%)`],
        [],
        ['Question', 'Type', 'Student Answer', 'Correct Answer', 'Result', 'Marks']
      ];

      attempt.answers.forEach((ans, qNum) => {
        studentData.push([
          `Q${qNum + 1}: ${ans.question}`,
          ans.type,
          ans.studentAnswer || 'Not answered',
          ans.correctAnswer,
          ans.isCorrect ? 'Correct' : 'Incorrect',
          ans.marks
        ]);
      });

      const wsStudent = XLSX.utils.aoa_to_sheet(studentData);
      wsStudent['!cols'] = [
        { wch: 50 }, { wch: 15 }, { wch: 30 }, 
        { wch: 30 }, { wch: 12 }, { wch: 10 }
      ];
      
      const sheetName = `${attempt.studentUSN}`.substring(0, 31); // Excel sheet name limit
      XLSX.utils.book_append_sheet(wb, wsStudent, sheetName);
    });

    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return excelBuffer;
  }
}

module.exports = new ExcelService();
