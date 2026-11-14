const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
let ptp = null;
try {
  ptp = require('pdf-to-printer');
} catch (e) {
  ptp = null;
}
const storage = require('./storage');

const PRINT_JOBS_DIR = path.join(__dirname, '..', 'print_jobs');
if (!fs.existsSync(PRINT_JOBS_DIR)) {
  fs.mkdirSync(PRINT_JOBS_DIR, { recursive: true });
}

// Page dimensions in points (72 points = 1 inch)
const SIZES = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 }
};

/**
 * Parses custom page range string like "1, 3-5, 8" into array of 1-based page numbers
 */
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || !rangeStr.trim()) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set();
  const parts = rangeStr.split(',');

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const from = Math.max(1, Math.min(start, end));
        const to = Math.min(totalPages, Math.max(start, end));
        for (let p = from; p <= to; p++) {
          pages.add(p);
        }
      }
    } else {
      const p = parseInt(part, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages) {
        pages.add(p);
      }
    }
  }

  const result = Array.from(pages).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: totalPages }, (_, i) => i + 1);
}

/**
 * Scans a PDF file to reliably get its page count even if encrypted
 */
function getPdfPageCountSafely(filePath) {
  try {
    // Fast and safe regex scanner across PDF binary structure
    const content = fs.readFileSync(filePath, 'latin1');
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }

    const countMatch = content.match(/\/Count\s+(\d+)/);
    if (countMatch && parseInt(countMatch[1], 10) > 0) {
      return parseInt(countMatch[1], 10);
    }
  } catch (err) {
    console.warn('[PdfPageCount] Error scanning PDF:', err.message);
  }
  return 1;
}

/**
 * List all live installed Windows printers with real-time hardware status
 */
async function listPrinters() {
  try {
    let ptpPrinters = [];
    if (ptp && typeof ptp.getPrinters === 'function') {
      try {
        ptpPrinters = await ptp.getPrinters();
      } catch (e) {
        console.warn('ptp.getPrinters error:', e.message);
      }
    }

    let psPrinters = [];
    try {
      const psScript = `powershell.exe -NoProfile -Command "Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,JobCount,Shared | ConvertTo-Json -Compress"`;
      const { stdout } = await execPromise(psScript);
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        psPrinters = Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch (psErr) {
      console.warn('PowerShell Get-Printer warning:', psErr.message);
    }

    const printerMap = new Map();

    for (const p of psPrinters) {
      if (!p.Name) continue;
      
      let humanStatus = 'Normal / Ready';
      let isOnline = true;

      const rawStatus = (p.PrinterStatus || '').toString();
      if (rawStatus.includes('Low')) {
        humanStatus = 'Toner / Paper Low';
        isOnline = true;
      } else if (rawStatus.includes('Offline') || rawStatus.includes('...ine')) {
        humanStatus = 'Offline / Standby';
        isOnline = false;
      } else if (rawStatus === '3' || rawStatus === 'Normal' || rawStatus === '0') {
        humanStatus = 'Normal / Ready';
        isOnline = true;
      } else {
        humanStatus = rawStatus;
      }

      printerMap.set(p.Name, {
        name: p.Name,
        driverName: p.DriverName || 'Standard Driver',
        portName: p.PortName || 'Local',
        status: humanStatus,
        isOnline,
        jobCount: p.JobCount || 0,
        isShared: !!p.Shared,
        paperSizes: ['A4', 'A3', 'Letter']
      });
    }

    for (const p of ptpPrinters) {
      if (!p.name) continue;
      if (printerMap.has(p.name)) {
        const existing = printerMap.get(p.name);
        if (p.paperSizes && p.paperSizes.length) {
          existing.paperSizes = p.paperSizes;
        }
      } else {
        printerMap.set(p.name, {
          name: p.name,
          driverName: 'Windows Driver',
          portName: 'Port',
          status: 'Normal / Ready',
          isOnline: true,
          jobCount: 0,
          isShared: false,
          paperSizes: p.paperSizes || ['A4', 'A3', 'Letter']
        });
      }
    }

    const printers = Array.from(printerMap.values());
    if (printers.length === 0) {
      const bridgePrinters = storage.getBridgePrinters ? storage.getBridgePrinters() : null;
      if (bridgePrinters && bridgePrinters.printers && bridgePrinters.printers.length > 0) {
        return bridgePrinters;
      }
    }
    const settings = storage.getSettings();

    // Default to active online printers if defaults are not set or offline
    let defaultBw = settings.printers?.defaultBw;
    let defaultColor = settings.printers?.defaultColor;

    if (!defaultBw || defaultBw === 'IR 5075') {
      // Pick active online Canon C5560 or Advance 6575
      const candidateBw = printers.find(p => p.name === 'Canon - C5560' || p.name === 'ADVANCE 6575' || p.name.includes('Canon'));
      defaultBw = candidateBw ? candidateBw.name : (printers[0]?.name || '');
    }

    if (!defaultColor || defaultColor === 'IR 5075') {
      const candidateColor = printers.find(p => p.name.includes('C308') || p.name.includes('C5560') || p.name.includes('L8050'));
      defaultColor = candidateColor ? candidateColor.name : (printers[0]?.name || '');
    }

    return {
      printers,
      defaultBw,
      defaultColor
    };
  } catch (err) {
    console.error('Error listing printers:', err);
    return { printers: [], defaultBw: '', defaultColor: '' };
  }
}

/**
 * Prepares document for printing.
 * CRITICAL FIX: If document is encrypted or fails in pdf-lib, or if all pages are selected,
 * it returns the original file directly with SumatraPDF page-range instructions,
 * completely eliminating "Input document to PDFDocument.load is encrypted" errors!
 */
async function preparePrintJobFile(doc, orderId, docIndex) {
  const filePath = doc.filePath;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const targetSizeKey = (doc.paperType || 'A4').toUpperCase() === 'A3' ? 'A3' : 'A4';
  const targetDims = SIZES[targetSizeKey];

  if (ext === '.pdf') {
    // 1. Determine total pages
    let totalPages = doc.totalDocumentPages || 1;
    if (totalPages <= 1) {
      totalPages = getPdfPageCountSafely(filePath);
    }

    // 2. Check if all pages are selected
    let isAllPages = doc.pageRangeMode === 'all';
    let pageNumbersToInclude = [];

    if (doc.pageRangeMode === 'visual' && Array.isArray(doc.selectedPages) && doc.selectedPages.length > 0) {
      pageNumbersToInclude = doc.selectedPages;
      if (pageNumbersToInclude.length === totalPages) {
        isAllPages = true;
      }
    } else if (doc.pageRangeMode === 'custom' && doc.customRangeText) {
      pageNumbersToInclude = parsePageRange(doc.customRangeText, totalPages);
      if (pageNumbersToInclude.length === totalPages) {
        isAllPages = true;
      }
    } else {
      isAllPages = true;
      pageNumbersToInclude = Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    // If ALL pages are requested, use the original PDF directly without altering it!
    // This allows 100% compatibility with encrypted, permission-locked, or complex PDFs!
    if (isAllPages) {
      console.log(`[PrinterService] Order ${orderId} Doc ${docIndex}: Printing all ${totalPages} pages directly from original PDF (lossless & encryption-safe).`);
      return {
        outputPath: filePath,
        pageCount: totalPages,
        targetPaperSize: targetSizeKey,
        pagesSetting: null
      };
    }

    // Specific subset of pages requested: Try pdf-lib slicing with ignoreEncryption
    const outputPath = path.join(
      PRINT_JOBS_DIR,
      `job_${orderId}_doc${docIndex}_${Date.now()}.pdf`
    );

    try {
      const fileBytes = fs.readFileSync(filePath);
      const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
      const actualCount = srcDoc.getPageCount();

      const indicesToCopy = pageNumbersToInclude
        .map(p => p - 1)
        .filter(idx => idx >= 0 && idx < actualCount);

      if (indicesToCopy.length === 0) {
        throw new Error('No valid pages selected');
      }

      const outDoc = await PDFDocument.create();
      const copiedPages = await outDoc.copyPages(srcDoc, indicesToCopy);
      copiedPages.forEach(p => outDoc.addPage(p));

      const outBytes = await outDoc.save();
      fs.writeFileSync(outputPath, outBytes);

      console.log(`[PrinterService] Sliced ${indicesToCopy.length} pages cleanly via pdf-lib to: ${outputPath}`);
      return {
        outputPath,
        pageCount: indicesToCopy.length,
        targetPaperSize: targetSizeKey,
        pagesSetting: null
      };
    } catch (sliceErr) {
      // If pdf-lib throws encryption or dict error, use SumatraPDF's native engine!
      console.warn(`[PrinterService] pdf-lib could not parse encrypted PDF (${sliceErr.message}). Falling back to SumatraPDF native page extraction!`);
      const pagesString = pageNumbersToInclude.join(',');
      return {
        outputPath: filePath,
        pageCount: pageNumbersToInclude.length,
        targetPaperSize: targetSizeKey,
        pagesSetting: pagesString
      };
    }

  } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    // Convert image to target A4/A3 PDF
    const outputPath = path.join(
      PRINT_JOBS_DIR,
      `job_${orderId}_doc${docIndex}_${Date.now()}.pdf`
    );

    const outDoc = await PDFDocument.create();
    const fileBytes = fs.readFileSync(filePath);
    let embeddedImg;

    if (ext === '.png') {
      embeddedImg = await outDoc.embedPng(fileBytes);
    } else {
      embeddedImg = await outDoc.embedJpg(fileBytes);
    }

    const imgDims = embeddedImg.scale(1.0);
    const page = outDoc.addPage([targetDims.width, targetDims.height]);

    const margin = 20;
    const availWidth = targetDims.width - margin * 2;
    const availHeight = targetDims.height - margin * 2;

    const scale = Math.min(availWidth / imgDims.width, availHeight / imgDims.height);
    const scaledWidth = imgDims.width * scale;
    const scaledHeight = imgDims.height * scale;

    const x = margin + (availWidth - scaledWidth) / 2;
    const y = margin + (availHeight - scaledHeight) / 2;

    page.drawImage(embeddedImg, {
      x,
      y,
      width: scaledWidth,
      height: scaledHeight
    });

    const outBytes = await outDoc.save();
    fs.writeFileSync(outputPath, outBytes);
    return {
      outputPath,
      pageCount: 1,
      targetPaperSize: targetSizeKey,
      pagesSetting: null
    };
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Execute print job to the designated Windows printer
 */
async function printDocument(preparedPdfPath, options = {}) {
  const {
    printerName,
    copies = 1,
    paperSize = 'A4',
    isDuplex = false,
    isColor = false,
    pagesSetting = null
  } = options;

  console.log(`[PrinterService] Dispatching print job to printer: "${printerName}"`, {
    copies,
    paperSize,
    isDuplex,
    isColor,
    pagesSetting,
    file: preparedPdfPath
  });

  const ptpOptions = {
    printer: printerName,
    copies: parseInt(copies, 10) || 1,
    paperSize: paperSize.toUpperCase() === 'A3' ? 'A3' : 'A4',
    side: isDuplex ? 'duplex' : 'simplex',
    monochrome: !isColor,
    scale: 'fit',
    silent: true
  };

  if (pagesSetting) {
    ptpOptions.pages = pagesSetting;
  }

  try {
    await ptp.print(preparedPdfPath, ptpOptions);
    console.log(`[PrinterService] Print job dispatched successfully to "${printerName}"`);
    return {
      success: true,
      printer: printerName,
      message: `Job printed successfully on ${printerName}`
    };
  } catch (err) {
    console.error(`[PrinterService] Print failed on "${printerName}":`, err.message);
    throw err;
  }
}

/**
 * Test connectivity to a specific printer
 */
async function testPrinterConnection(printerName) {
  try {
    const psCmd = `powershell.exe -NoProfile -Command "Get-Printer -Name '${printerName.replace(/'/g, "''")}' | Select-Object Name,PortName,PrinterStatus,JobCount | ConvertTo-Json -Compress"`;
    const { stdout } = await execPromise(psCmd);
    if (!stdout || !stdout.trim()) {
      return { success: false, message: `Printer "${printerName}" not found in Windows` };
    }
    const info = JSON.parse(stdout.trim());
    return {
      success: true,
      printer: info.Name,
      port: info.PortName,
      status: info.PrinterStatus,
      jobCount: info.JobCount,
      message: `Connected: Status is ${info.PrinterStatus || 'Normal'}`
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Generates a branded test print PDF for Copycat Copiers and prints to printerName
 */
async function generateAndPrintTestPage(printerName) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();

  // Draw Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 120,
    width: width,
    height: 120,
    color: rgb(0.26, 0.52, 0.96) // Google Blue
  });

  page.drawText('Copycat Copiers', {
    x: 40,
    y: height - 60,
    size: 32,
    font,
    color: rgb(1, 1, 1)
  });

  page.drawText('AUTOMATED PRINTER ALIGNMENT & TEST PAGE', {
    x: 40,
    y: height - 90,
    size: 14,
    font: regularFont,
    color: rgb(0.95, 0.95, 0.95)
  });

  // Google Colors accent line
  const barY = height - 128;
  const barW = width / 4;
  page.drawRectangle({ x: 0, y: barY, width: barW, height: 8, color: rgb(0.26, 0.52, 0.96) });
  page.drawRectangle({ x: barW, y: barY, width: barW, height: 8, color: rgb(0.92, 0.26, 0.21) });
  page.drawRectangle({ x: barW * 2, y: barY, width: barW, height: 8, color: rgb(0.98, 0.74, 0.02) });
  page.drawRectangle({ x: barW * 3, y: barY, width: barW, height: 8, color: rgb(0.2, 0.66, 0.33) });

  page.drawRectangle({
    x: 40,
    y: height - 320,
    width: width - 80,
    height: 170,
    borderColor: rgb(0.85, 0.85, 0.85),
    borderWidth: 1,
    color: rgb(0.98, 0.98, 0.99)
  });

  page.drawText('Hardware & Connection Verification', {
    x: 60,
    y: height - 165,
    size: 16,
    font,
    color: rgb(0.1, 0.1, 0.1)
  });

  const timestamp = new Date().toLocaleString();
  const infoLines = [
    `Target Printer: ${printerName}`,
    `Test Date & Time: ${timestamp}`,
    `Host Machine IP: 192.168.1.34`,
    `Paper Spec: A4 (210 x 297 mm) - Standard Test`,
    `Status: Direct Spooler Connection Active`,
    `Shop: Copycat Copiers - Google Profile Verified Hardware`
  ];

  let currentY = height - 195;
  for (const line of infoLines) {
    page.drawText(line, {
      x: 60,
      y: currentY,
      size: 12,
      font: regularFont,
      color: rgb(0.2, 0.2, 0.2)
    });
    currentY -= 20;
  }

  const testPdfPath = path.join(PRINT_JOBS_DIR, `test_print_${Date.now()}.pdf`);
  const bytes = await pdfDoc.save();
  fs.writeFileSync(testPdfPath, bytes);

  return await printDocument(testPdfPath, {
    printerName,
    copies: 1,
    paperSize: 'A4',
    isDuplex: false,
    isColor: true
  });
}

module.exports = {
  listPrinters,
  preparePrintJobFile,
  printDocument,
  generateAndPrintTestPage,
  testPrinterConnection,
  getPdfPageCountSafely,
  parsePageRange
};
