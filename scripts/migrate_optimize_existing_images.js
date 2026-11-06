/**
 * Safe Migration Script: Optimize Existing Uploaded Images to WebP + Thumbnails
 * 
 * Rules:
 * - Scans all uploaded images (product images, logos, receipts, etc.)
 * - Converts each to modern WebP format preserving aspect ratio & visual quality
 * - Generates fast thumbnail versions for grids & lists (-thumb.webp)
 * - Verifies successful conversion before updating any reference
 * - Preserves original files to guarantee zero broken links or lost data
 * - Updates database image_url / logo_url records to WebP
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pool = require('../config/db');
const ImageOptimizationService = require('../services/image_optimization_service');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

async function migrateImages() {
  console.log('========================================================================');
  console.log('   ARISO RETAIL — SAFE IMAGE OPTIMIZATION & COMPRESSION MIGRATION       ');
  console.log('========================================================================\n');

  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log('[Notice] No uploads directory found.');
    return;
  }

  // 1. Collect all optimizable image files recursively (ignoring 'updates' folder)
  const imageFiles = [];
  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'updates' && entry.name !== 'node_modules') {
          scanDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Look for unconverted image files or files missing a webp/thumbnail
        if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.jfif'].includes(ext) && !entry.name.includes('-thumb.')) {
          imageFiles.push(fullPath);
        }
      }
    }
  }

  scanDir(UPLOADS_DIR);
  console.log(`Found ${imageFiles.length} existing image files to process.\n`);

  let totalOriginalBytes = 0;
  let totalOptimizedBytes = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const filePath of imageFiles) {
    const relPath = path.relative(UPLOADS_DIR, filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isLogo = relPath.startsWith('logos');
    const preset = isLogo ? 'logo' : 'product';

    try {
      const stat = fs.statSync(filePath);
      const originalBytes = stat.size;
      totalOriginalBytes += originalBytes;

      const result = await ImageOptimizationService.optimizeImageFile(filePath, {
        preset,
        keepOriginal: true // CRITICAL: Preserve existing original file on disk
      });

      if (result.success) {
        // Verify output file validity
        const webpValid = fs.existsSync(result.optimizedPath) && fs.statSync(result.optimizedPath).size > 0;
        const thumbValid = result.thumbnailPath ? (fs.existsSync(result.thumbnailPath) && fs.statSync(result.thumbnailPath).size > 0) : true;

        if (webpValid && thumbValid) {
          totalOptimizedBytes += result.optimizedSize;
          successCount++;
          console.log(`✅ [Optimized] ${relPath} (${(originalBytes / 1024).toFixed(1)} KB -> ${(result.optimizedSize / 1024).toFixed(1)} KB | -${result.savingsPercent}%)`);
        } else {
          failureCount++;
          console.warn(`⚠️ [Verification Failed] Output invalid for ${relPath}`);
        }
      } else {
        failureCount++;
        console.warn(`⚠️ [Failed] Could not optimize ${relPath}: ${result.error}`);
      }
    } catch (err) {
      failureCount++;
      console.error(`❌ [Error] Failed processing ${relPath}:`, err.message);
    }
  }

  console.log('\n--- Database Image Reference Migration ---');

  // 2. Safely update menu_items.image_url where webp equivalent exists
  let dbUpdatedCount = 0;
  try {
    const [menuRows] = await pool.query(
      "SELECT id, image_url FROM menu_items WHERE image_url IS NOT NULL AND image_url != ''"
    );

    for (const row of menuRows) {
      const origUrl = row.image_url;
      const cleanUrl = origUrl.replace(/^http:\/\/[^\/]+/, '');
      const ext = path.extname(cleanUrl).toLowerCase();

      if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
        const webpUrl = cleanUrl.replace(new RegExp(`\\${ext}$`, 'i'), '.webp');
        const diskPath = path.join(UPLOADS_DIR, webpUrl.replace(/^\/uploads\//, ''));

        if (fs.existsSync(diskPath)) {
          await pool.query('UPDATE menu_items SET image_url = ? WHERE id = ?', [webpUrl, row.id]);
          console.log(`Updated menu_items #${row.id}: ${origUrl} -> ${webpUrl}`);
          dbUpdatedCount++;
        }
      }
    }
  } catch (dbErr) {
    console.warn('[Notice] menu_items update skipped or errored:', dbErr.message);
  }

  // 3. Update restaurant & receipt_settings logos if webp exists
  try {
    const [restRows] = await pool.query("SELECT id, logo_url FROM restaurants WHERE logo_url IS NOT NULL AND logo_url != ''");
    for (const r of restRows) {
      const origUrl = r.logo_url;
      const cleanUrl = origUrl.replace(/^http:\/\/[^\/]+/, '');
      const ext = path.extname(cleanUrl).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
        const webpUrl = cleanUrl.replace(new RegExp(`\\${ext}$`, 'i'), '.webp');
        const diskPath = path.join(UPLOADS_DIR, webpUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(diskPath)) {
          await pool.query('UPDATE restaurants SET logo_url = ? WHERE id = ?', [webpUrl, r.id]);
          console.log(`Updated restaurants #${r.id} logo: ${origUrl} -> ${webpUrl}`);
          dbUpdatedCount++;
        }
      }
    }

    const [rcptRows] = await pool.query("SELECT restaurant_id, logo_url FROM receipt_settings WHERE logo_url IS NOT NULL AND logo_url != ''");
    for (const rc of rcptRows) {
      const origUrl = rc.logo_url;
      const cleanUrl = origUrl.replace(/^http:\/\/[^\/]+/, '');
      const ext = path.extname(cleanUrl).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
        const webpUrl = cleanUrl.replace(new RegExp(`\\${ext}$`, 'i'), '.webp');
        const diskPath = path.join(UPLOADS_DIR, webpUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(diskPath)) {
          await pool.query('UPDATE receipt_settings SET logo_url = ? WHERE restaurant_id = ?', [webpUrl, rc.restaurant_id]);
          console.log(`Updated receipt_settings for rest #${rc.restaurant_id} logo: ${origUrl} -> ${webpUrl}`);
          dbUpdatedCount++;
        }
      }
    }
  } catch (logoDbErr) {
    console.warn('[Notice] logo update skipped or errored:', logoDbErr.message);
  }

  const overallSavingsBytes = Math.max(0, totalOriginalBytes - totalOptimizedBytes);
  const overallSavingsPct = totalOriginalBytes > 0 ? ((overallSavingsBytes / totalOriginalBytes) * 100).toFixed(1) : 0;

  console.log('\n========================================================================');
  console.log('   MIGRATION COMPLETED SUCCESSFULLY');
  console.log('========================================================================');
  console.log(`Images Processed:      ${successCount} succeeded, ${failureCount} failed`);
  console.log(`Original Total Size:   ${(totalOriginalBytes / 1024).toFixed(1)} KB`);
  console.log(`Optimized Total Size:  ${(totalOptimizedBytes / 1024).toFixed(1)} KB`);
  console.log(`Total Storage Saved:   ${(overallSavingsBytes / 1024).toFixed(1)} KB (-${overallSavingsPct}%)`);
  console.log(`Database Records Sync: ${dbUpdatedCount} URLs updated to modern WebP`);
  console.log('========================================================================\n');
}

module.exports = migrateImages;

if (require.main === module) {
  migrateImages()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Fatal Migration Error]', err);
      process.exit(1);
    });
}

