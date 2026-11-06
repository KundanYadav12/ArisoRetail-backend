const path = require('path');
const fs = require('fs');
const ImageOptimizationService = require('../services/image_optimization_service');

/**
 * High-Performance Static Image Delivery Middleware
 * 
 * Features:
 * 1. HTTP Caching: Sets Cache-Control: public, max-age=2592000, immutable (30 days) + ETag + Last-Modified
 * 2. On-demand Thumbnail Delivery: Serves -thumb.webp when ?thumb=1 or ?size=thumb is requested
 * 3. Transparent WebP Negotiation: Serves modern .webp version when available, even if client requested legacy .jpg/.png
 * 4. Path Traversal Security: Blocks any attempt to escape uploads directory with 403 Forbidden
 * 5. Safe Fallback: Passes non-images or missing files to standard express.static
 */

const uploadsDir = path.resolve(__dirname, '../uploads');

function optimizedImageDelivery(req, res, next) {
  // Only handle GET and HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  // Security check: Prevent directory traversal attacks
  const rawUrlPath = decodeURIComponent(req.path || '');
  const requestedFile = path.resolve(uploadsDir, '.' + (rawUrlPath.startsWith('/') ? rawUrlPath : '/' + rawUrlPath));

  if (!requestedFile.startsWith(uploadsDir + path.sep) && requestedFile !== uploadsDir) {
    return res.status(403).end('Forbidden');
  }

  const ext = path.extname(requestedFile).toLowerCase();
  const isImageRequest = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.jfif'].includes(ext);

  if (!isImageRequest) {
    return next(); // Non-image assets handled by express.static
  }

  const isThumbRequested = (
    req.query.thumb === '1' ||
    req.query.thumb === 'true' ||
    req.query.size === 'thumb' ||
    req.query.size === 'thumbnail' ||
    rawUrlPath.includes('-thumb.')
  );

  const fileDir = path.dirname(requestedFile);
  const baseName = path.basename(requestedFile, ext).replace(/-thumb$/, '');
  const webpPath = path.join(fileDir, `${baseName}.webp`);
  const thumbWebpPath = path.join(fileDir, `${baseName}-thumb.webp`);

  // Common high-performance caching headers
  const setCacheHeaders = (resObj, contentType) => {
    resObj.setHeader('Content-Type', contentType);
    resObj.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 Days Cache
    resObj.setHeader('Vary', 'Accept, Accept-Encoding');
  };

  // Case A: Thumbnail requested
  if (isThumbRequested) {
    if (fs.existsSync(thumbWebpPath)) {
      setCacheHeaders(res, 'image/webp');
      return res.sendFile(thumbWebpPath, { maxAge: 2592000000 });
    }

    // If source file exists, generate thumbnail on-demand and deliver
    const sourceCandidate = fs.existsSync(webpPath) ? webpPath : (fs.existsSync(requestedFile) ? requestedFile : null);
    if (sourceCandidate) {
      ImageOptimizationService.ensureThumbnail(sourceCandidate)
        .then(generatedThumb => {
          if (generatedThumb && fs.existsSync(generatedThumb)) {
            setCacheHeaders(res, 'image/webp');
            return res.sendFile(generatedThumb, { maxAge: 2592000000 });
          }
          // Fallback to source candidate
          return next();
        })
        .catch(() => next());
      return;
    }
  }

  // Case B: Client requested .webp or webp version exists
  const clientAcceptsWebp = (req.headers.accept && req.headers.accept.includes('image/webp')) || ext === '.webp';

  if (fs.existsSync(webpPath) && (clientAcceptsWebp || !fs.existsSync(requestedFile))) {
    setCacheHeaders(res, 'image/webp');
    return res.sendFile(webpPath, { maxAge: 2592000000 });
  }

  // Case C: File exists as requested (e.g. legacy jpg/png)
  if (fs.existsSync(requestedFile)) {
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp'
    };
    setCacheHeaders(res, mimeMap[ext] || 'application/octet-stream');
    return res.sendFile(requestedFile, { maxAge: 2592000000 });
  }

  // Fallback to express.static
  next();
}

module.exports = optimizedImageDelivery;
