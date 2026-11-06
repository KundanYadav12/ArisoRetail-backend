const ImageOptimizationService = require('../services/image_optimization_service');
const path = require('path');

/**
 * Express Middleware to automatically compress and optimize uploaded images.
 * Runs seamlessly right after Multer upload middleware.
 * 
 * @param {string} [preset='product'] - Optimization preset: 'product', 'logo', 'profile', 'category', 'attachment'
 * @returns {Function} Express middleware function
 */
function optimizeUploadedImage(preset = 'product') {
  return async (req, res, next) => {
    // If no files were uploaded in this request, continue
    if (!req.file && (!req.files || (Array.isArray(req.files) && req.files.length === 0))) {
      return next();
    }

    const processFile = async (file) => {
      if (!file || !file.path) return;

      const isImage = ImageOptimizationService.isOptimizableImage(file.path, file.mimetype);
      if (!isImage) {
        return; // Leave non-images (like PDFs or spreadsheets) untouched
      }

      try {
        const result = await ImageOptimizationService.optimizeImageFile(file.path, {
          preset,
          outputDir: file.destination || path.dirname(file.path),
          keepOriginal: false // replace unoptimized upload with optimized webp
        });

        if (result.success && !result.skipped) {
          // Update Multer file metadata with optimized file details
          file.filename = result.optimizedFilename;
          file.path = result.optimizedPath;
          file.mimetype = 'image/webp';
          file.size = result.optimizedSize;
          file.thumbnail = result.thumbnailFilename;
          file.thumbnailPath = result.thumbnailPath;
          file.optimization = {
            originalSize: result.originalSize,
            optimizedSize: result.optimizedSize,
            savingsBytes: result.savingsBytes,
            savingsPercent: result.savingsPercent
          };
        }
      } catch (err) {
        console.warn(`[ImageOptimizerMiddleware] Warning during upload compression of "${file.originalname}":`, err.message);
        // Do not fail request; fallback to original file
      }
    };

    try {
      if (req.file) {
        await processFile(req.file);
      }

      if (req.files) {
        if (Array.isArray(req.files)) {
          for (const file of req.files) {
            await processFile(file);
          }
        } else if (typeof req.files === 'object') {
          for (const key of Object.keys(req.files)) {
            const fileList = req.files[key];
            if (Array.isArray(fileList)) {
              for (const file of fileList) {
                await processFile(file);
              }
            } else {
              await processFile(fileList);
            }
          }
        }
      }

      next();
    } catch (middlewareErr) {
      console.error('[ImageOptimizerMiddleware Error]:', middlewareErr);
      next(); // Always proceed gracefully
    }
  };
}

module.exports = {
  optimizeUploadedImage,
  optimizeProductImage: optimizeUploadedImage('product'),
  optimizeLogoImage: optimizeUploadedImage('logo'),
  optimizeProfileImage: optimizeUploadedImage('profile'),
  optimizeCategoryImage: optimizeUploadedImage('category'),
  optimizeAttachment: optimizeUploadedImage('attachment')
};

