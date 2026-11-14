const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PRINT_JOBS_DIR = path.join(__dirname, '..', 'print_jobs');
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const UNCOMMITTED_CUTOFF_MS = 15 * 60 * 1000; // 15 mins for unsubmitted staged files

/**
 * Delete a single uploaded file by filename
 */
function deleteSingleUploadedFile(filename) {
  if (!filename) return false;
  const safeName = path.basename(filename);
  const fullPath = path.join(UPLOADS_DIR, safeName);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log(`[CleanupService] Single file removed from server: ${safeName}`);
      return true;
    } catch (e) {
      console.warn(`[CleanupService] Error removing file ${safeName}:`, e.message);
    }
  }
  return false;
}

/**
 * Purge abandoned files on window close / page refresh
 * Only deletes files if they do NOT belong to any submitted order
 */
function deleteAbandonedFiles(filenames = []) {
  if (!Array.isArray(filenames) || filenames.length === 0) {
    return { deletedCount: 0 };
  }

  const db = storage.getDb();
  const submittedSet = new Set();
  if (db && Array.isArray(db.orders)) {
    for (const o of db.orders) {
      if (o.documents) {
        for (const d of o.documents) {
          if (d.filePath) submittedSet.add(path.basename(d.filePath));
          if (d.filename) submittedSet.add(path.basename(d.filename));
        }
      }
    }
  }

  let deletedCount = 0;
  for (const fn of filenames) {
    const safeName = path.basename(fn);
    if (!submittedSet.has(safeName)) {
      const fullPath = path.join(UPLOADS_DIR, safeName);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`[CleanupService] Purged unsubmitted file on tab close/refresh: ${safeName}`);
          deletedCount++;
        } catch (e) {}
      }
    }
  }
  return { deletedCount };
}

/**
 * Delete physical files associated with a specific order
 */
function deleteOrderFiles(order) {
  let deletedCount = 0;
  if (!order) return { deletedCount };

  // 1. Delete original uploaded files
  if (order.documents && Array.isArray(order.documents)) {
    for (const doc of order.documents) {
      if (doc.filePath && fs.existsSync(doc.filePath)) {
        try {
          fs.unlinkSync(doc.filePath);
          console.log(`[CleanupService] Deleted uploaded file for order ${order.id}: ${doc.filePath}`);
          deletedCount++;
        } catch (err) {
          console.warn(`[CleanupService] Could not delete ${doc.filePath}:`, err.message);
        }
      }
    }
  }

  // 2. Delete generated print job PDFs for this order
  if (fs.existsSync(PRINT_JOBS_DIR)) {
    try {
      const jobFiles = fs.readdirSync(PRINT_JOBS_DIR);
      for (const file of jobFiles) {
        if (file.includes(`_${order.id}_`)) {
          const fullPath = path.join(PRINT_JOBS_DIR, file);
          try {
            fs.unlinkSync(fullPath);
            console.log(`[CleanupService] Deleted print job file for order ${order.id}: ${fullPath}`);
            deletedCount++;
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn(`[CleanupService] Error scanning print_jobs dir:`, err.message);
    }
  }

  return { deletedCount };
}

/**
 * Automatically clean up files older than 24 hours from uploads/ and print_jobs/
 * And clean unsubmitted orphan uploads older than 15 minutes
 */
function cleanupFilesOlderThan24Hours(maxAgeMs = TWENTY_FOUR_HOURS_MS) {
  const now = Date.now();
  let deletedFilesCount = 0;
  let deletedOrdersCount = 0;

  console.log(`[CleanupService] Running cleanup scan (Cutoff: ${new Date(now - maxAgeMs).toISOString()})...`);

  // Build set of all active file basenames across all database orders
  const db = storage.getDb();
  const submittedSet = new Set();
  if (db && Array.isArray(db.orders)) {
    for (const o of db.orders) {
      if (o.documents) {
        for (const d of o.documents) {
          if (d.filePath) submittedSet.add(path.basename(d.filePath));
          if (d.filename) submittedSet.add(path.basename(d.filename));
        }
      }
    }
  }

  // 1. Scan uploads directory
  if (fs.existsSync(UPLOADS_DIR)) {
    try {
      const files = fs.readdirSync(UPLOADS_DIR);
      for (const file of files) {
        const fullPath = path.join(UPLOADS_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          const age = now - stats.mtimeMs;

          // Delete if older than 24 hours
          // OR delete if older than 15 minutes and NOT part of any submitted order (abandoned upload)
          const isOlderThan24h = age > maxAgeMs;
          const isAbandonedStagedFile = !submittedSet.has(file) && age > UNCOMMITTED_CUTOFF_MS;

          if (isOlderThan24h || isAbandonedStagedFile) {
            fs.unlinkSync(fullPath);
            console.log(`[CleanupService] Purged file (${isOlderThan24h ? '24h+ old' : 'abandoned unsubmitted'}): ${file}`);
            deletedFilesCount++;
          }
        } catch (e) {}
      }
    } catch (err) {
      console.warn(`[CleanupService] Error scanning uploads directory:`, err.message);
    }
  }

  // 2. Scan print_jobs directory
  if (fs.existsSync(PRINT_JOBS_DIR)) {
    try {
      const files = fs.readdirSync(PRINT_JOBS_DIR);
      for (const file of files) {
        const fullPath = path.join(PRINT_JOBS_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
            console.log(`[CleanupService] Purged 24h+ old print job: ${file}`);
            deletedFilesCount++;
          }
        } catch (e) {}
      }
    } catch (err) {
      console.warn(`[CleanupService] Error scanning print_jobs directory:`, err.message);
    }
  }

  // 3. Clean up database orders older than 24 hours that are completed or cancelled
  try {
    if (db && Array.isArray(db.orders)) {
      const originalLen = db.orders.length;
      db.orders = db.orders.filter(order => {
        const orderTime = new Date(order.createdAt).getTime();
        const isOld = now - orderTime > maxAgeMs;
        if (isOld && (order.status === 'completed' || order.status === 'cancelled')) {
          deletedOrdersCount++;
          return false;
        }
        return true;
      });

      if (db.orders.length !== originalLen) {
        storage.saveDb(db);
        console.log(`[CleanupService] Purged ${deletedOrdersCount} completed/cancelled orders older than 24 hours from database.`);
      }
    }
  } catch (dbErr) {
    console.warn(`[CleanupService] Error cleaning old DB records:`, dbErr.message);
  }

  console.log(`[CleanupService] Cleanup scan complete. Deleted ${deletedFilesCount} file(s), ${deletedOrdersCount} old order(s).`);
  return { deletedFilesCount, deletedOrdersCount };
}

/**
 * Start periodic background hourly cleanup timer
 */
function startAutoCleanupSchedule(intervalMs = 60 * 60 * 1000) {
  try {
    cleanupFilesOlderThan24Hours();
  } catch (e) {
    console.warn('[CleanupService] Startup cleanup warning:', e.message);
  }

  const timer = setInterval(() => {
    try {
      cleanupFilesOlderThan24Hours();
    } catch (err) {
      console.error('[CleanupService] Interval cleanup error:', err.message);
    }
  }, intervalMs);

  return timer;
}

module.exports = {
  deleteSingleUploadedFile,
  deleteAbandonedFiles,
  deleteOrderFiles,
  cleanupFilesOlderThan24Hours,
  startAutoCleanupSchedule,
  UPLOADS_DIR,
  PRINT_JOBS_DIR
};
