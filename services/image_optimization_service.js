const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * Enterprise Image Optimization & Compression Service for Ariso Retail
 * 
 * Features:
 * - Native WebP conversion with visual quality preservation
 * - Smart resizing based on actual display requirements
 * - Automated thumbnail generation for grids, lists, and previews
 * - Metadata stripping (EXIF/GPS removal) for privacy and file size reduction
 * - Auto-rotation based on EXIF orientation
 * - Transparent fallback and failure-safe operation
 */

const PRESETS = {
  // POS & Catalog Product Items
  product: {
    maxWidth: 1000,
    maxHeight: 1000,
    quality: 80,
    thumbWidth: 250,
    thumbHeight: 250,
    thumbQuality: 75,
    fit: 'inside'
  },
  // Store / Restaurant Logos & QR codes (high fidelity, alpha transparency preserved)
  logo: {
    maxWidth: 600,
    maxHeight: 600,
    quality: 85,
    thumbWidth: 160,
    thumbHeight: 160,
    thumbQuality: 80,
    fit: 'inside'
  },
  // Profile / Avatar Pictures
  profile: {
    maxWidth: 400,
    maxHeight: 400,
    quality: 80,
    thumbWidth: 120,
    thumbHeight: 120,
    thumbQuality: 75,
    fit: 'cover'
  },
  // Category Images
  category: {
    maxWidth: 600,
    maxHeight: 600,
    quality: 80,
    thumbWidth: 200,
    thumbHeight: 200,
    thumbQuality: 75,
    fit: 'inside'
  },
  // Receipts, Expense Bills & Invoices (optimized for text legibility)
  attachment: {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 82,
    thumbWidth: 300,
    thumbHeight: 300,
    thumbQuality: 75,
    fit: 'inside'
  },
  // Default / General
  default: {
    maxWidth: 1000,
    maxHeight: 1000,
    quality: 80,
    thumbWidth: 250,
    thumbHeight: 250,
    thumbQuality: 75,
    fit: 'inside'
  }
};

const SUPPORTED_INPUT_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp', '.gif', '.jfif', '.heic', '.heif'
]);

class ImageOptimizationService {
  /**
   * Check whether a file is an optimizable image
   */
  static isOptimizableImage(filePathOrName, mimetype = '') {
    if (mimetype && (mimetype.startsWith('image/svg') || mimetype === 'application/pdf')) {
      return false; // Vector SVG and PDFs remain untouched
    }
    if (mimetype && mimetype.startsWith('image/')) {
      return true;
    }
    const ext = path.extname(filePathOrName || '').toLowerCase();
    return SUPPORTED_INPUT_EXTENSIONS.has(ext);
  }

  /**
   * Get preset configuration
   */
  static getPreset(presetName = 'default') {
    return PRESETS[presetName] || PRESETS.default;
  }

  /**
   * Optimize an image file in-place or to a target output path.
   * Produces an optimized modern WebP primary image AND an optimized WebP thumbnail.
   * 
   * @param {string} inputPath - Full path to source file
   * @param {Object} options
   * @param {string} [options.preset='product'] - Preset name: 'product', 'logo', 'profile', 'category', 'attachment'
   * @param {string} [options.outputDir] - Directory for output files (defaults to input file's directory)
   * @param {string} [options.baseName] - Base filename without extension
   * @param {boolean} [options.generateThumbnail=true] - Whether to generate thumbnail
   * @param {boolean} [options.keepOriginal=false] - Whether to keep original input file
   * @returns {Promise<Object>} Optimization results with file paths, sizes, and savings
   */
  static async optimizeImageFile(inputPath, options = {}) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Source image does not exist: ${inputPath}`);
    }

    const originalStats = fs.statSync(inputPath);
    const originalSize = originalStats.size;
    const ext = path.extname(inputPath).toLowerCase();

    // If file is SVG or PDF, do not transform with sharp
    if (ext === '.svg' || ext === '.pdf') {
      return {
        success: true,
        skipped: true,
        reason: 'Vector SVG or PDF document',
        optimizedPath: inputPath,
        optimizedFilename: path.basename(inputPath),
        originalSize,
        optimizedSize: originalSize,
        savingsPercent: 0
      };
    }

    const preset = this.getPreset(options.preset || 'default');
    const outputDir = options.outputDir || path.dirname(inputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = options.baseName || path.basename(inputPath, ext).replace(/-thumb$/, '');
    const optimizedFilename = `${baseName}.webp`;
    const optimizedPath = path.join(outputDir, optimizedFilename);
    const thumbnailFilename = `${baseName}-thumb.webp`;
    const thumbnailPath = path.join(outputDir, thumbnailFilename);

    try {
      // 1. Process and write primary optimized WebP
      const primaryPipeline = sharp(inputPath, { failOnError: false })
        .rotate() // Auto-orient based on EXIF orientation
        .resize({
          width: preset.maxWidth,
          height: preset.maxHeight,
          fit: preset.fit || 'inside',
          withoutEnlargement: true
        })
        .webp({
          quality: preset.quality,
          effort: 4
        });

      await primaryPipeline.toFile(optimizedPath);
      const optimizedStats = fs.statSync(optimizedPath);
      const optimizedSize = optimizedStats.size;

      // 2. Generate optimized thumbnail
      let thumbnailSize = 0;
      if (options.generateThumbnail !== false) {
        const thumbPipeline = sharp(inputPath, { failOnError: false })
          .rotate()
          .resize({
            width: preset.thumbWidth,
            height: preset.thumbHeight,
            fit: preset.fit || 'inside',
            withoutEnlargement: true
          })
          .webp({
            quality: preset.thumbQuality,
            effort: 4
          });

        await thumbPipeline.toFile(thumbnailPath);
        thumbnailSize = fs.statSync(thumbnailPath).size;
      }

      const savingsBytes = Math.max(0, originalSize - optimizedSize);
      const savingsPercent = originalSize > 0 ? ((savingsBytes / originalSize) * 100).toFixed(1) : '0.0';

      // 3. Clean up original if requested and different from optimizedPath
      if (!options.keepOriginal && path.resolve(inputPath) !== path.resolve(optimizedPath)) {
        try {
          fs.unlinkSync(inputPath);
        } catch (_) {}
      }

      return {
        success: true,
        optimizedPath,
        optimizedFilename,
        thumbnailPath: options.generateThumbnail !== false ? thumbnailPath : null,
        thumbnailFilename: options.generateThumbnail !== false ? thumbnailFilename : null,
        originalSize,
        optimizedSize,
        thumbnailSize,
        savingsBytes,
        savingsPercent: parseFloat(savingsPercent)
      };
    } catch (err) {
      console.error(`[ImageOptimizationService] Failed to optimize image "${inputPath}":`, err.message);
      // Fallback: If conversion failed, keep original file so upload never breaks
      return {
        success: false,
        error: err.message,
        optimizedPath: inputPath,
        optimizedFilename: path.basename(inputPath),
        originalSize,
        optimizedSize: originalSize,
        savingsPercent: 0
      };
    }
  }

  /**
   * Generate an on-demand thumbnail for an existing image if not present
   */
  static async ensureThumbnail(sourcePath, presetName = 'default') {
    if (!fs.existsSync(sourcePath)) return null;

    const dir = path.dirname(sourcePath);
    const ext = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, ext).replace(/-thumb$/, '');
    const thumbPath = path.join(dir, `${baseName}-thumb.webp`);

    if (fs.existsSync(thumbPath)) {
      return thumbPath;
    }

    try {
      const preset = this.getPreset(presetName);
      await sharp(sourcePath, { failOnError: false })
        .rotate()
        .resize({
          width: preset.thumbWidth,
          height: preset.thumbHeight,
          fit: preset.fit || 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: preset.thumbQuality, effort: 4 })
        .toFile(thumbPath);

      return thumbPath;
    } catch (err) {
      console.warn(`[ImageOptimizationService] Could not generate on-demand thumbnail for "${sourcePath}":`, err.message);
      return null;
    }
  }
}

module.exports = ImageOptimizationService;

