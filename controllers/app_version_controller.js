const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Robust SemVer comparison helper
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 */
function compareSemver(v1, v2) {
  const parse = (v) => {
    if (!v) return [0, 0, 0];
    const clean = String(v).trim().replace(/^v/i, '').split('-')[0];
    return clean.split('.').map(part => parseInt(part, 10) || 0);
  };

  const p1 = parse(v1);
  const p2 = parse(v2);
  const maxLen = Math.max(p1.length, p2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] !== undefined ? p1[i] : 0;
    const num2 = p2[i] !== undefined ? p2[i] : 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Helper to generate numeric version code from SemVer string
 * e.g., "1.0.6" -> 10006, "2.14.3" -> 21403
 */
function generateVersionCode(v) {
  if (!v) return 1;
  const clean = String(v).trim().replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  return major * 1000000 + minor * 1000 + patch;
}

/**
 * Resolve full absolute download URL
 */
function resolveFullUrl(req, urlPath) {
  if (!urlPath) return '';
  if (urlPath.startsWith('http://') || urlPath.startsWith('https://')) {
    return urlPath;
  }
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const cleanPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  return `${protocol}://${host}${cleanPath}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Version Checking & Download APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/app-versions/check
 * Query: platform ('windows' | 'mobile' | 'android' | 'ios'), current_version ('1.0.0')
 */
exports.checkUpdate = async (req, res) => {
  try {
    let platform = (req.query.platform || req.body.platform || 'windows').toLowerCase().trim();
    if (platform === 'android' || platform === 'ios') platform = 'mobile';

    const currentVersion = (req.query.current_version || req.query.version || '1.0.0').trim();

    // Fetch the latest active published version for this specific platform
    const [rows] = await pool.query(
      `SELECT * FROM app_versions 
       WHERE platform = ? AND is_active = 1 
       ORDER BY version_code DESC, id DESC 
       LIMIT 1`,
      [platform]
    );

    if (rows.length === 0) {
      return res.json({
        update_available: false,
        platform,
        current_version: currentVersion,
        message: 'No published versions found for this platform.'
      });
    }

    const latest = rows[0];
    const isNewer = compareSemver(latest.version, currentVersion) > 0;

    if (!isNewer) {
      return res.json({
        update_available: false,
        platform,
        current_version: currentVersion,
        latest_version: latest.version,
        message: 'Application is running the latest published version.'
      });
    }

    // Determine if update is mandatory (explicit flag or current version is below minimum supported)
    const isBelowMin = latest.min_supported_version
      ? compareSemver(currentVersion, latest.min_supported_version) < 0
      : false;
    const isMandatory = Boolean(latest.is_mandatory === 1 || isBelowMin);

    const resolvedDownloadUrl = resolveFullUrl(req, latest.download_url);
    const resolvedDirectApi = resolveFullUrl(req, `/api/app-versions/download/${latest.id}`);

    return res.json({
      update_available: true,
      platform: latest.platform,
      latest_version: latest.version,
      version_code: latest.version_code,
      current_version: currentVersion,
      min_supported_version: latest.min_supported_version,
      is_mandatory: isMandatory,
      title: latest.title,
      release_notes: latest.release_notes || '',
      update_instructions: latest.update_instructions || '',
      download_url: resolvedDownloadUrl,
      direct_api_url: resolvedDirectApi,
      file_name: latest.file_name,
      file_size: Number(latest.file_size) || 0,
      checksum_sha256: latest.checksum_sha256 || '',
      package_type: latest.package_type,
      published_at: latest.published_at
    });

  } catch (err) {
    console.error('[AppVersionController.checkUpdate Error]', err);
    return res.status(500).json({ error: 'Failed to verify application version updates.' });
  }
};

/**
 * GET /api/app-versions/download/:id
 * Streams package file or redirects to store/CDN, and increments download analytics
 */
exports.downloadPackage = async (req, res) => {
  try {
    const versionId = parseInt(req.params.id, 10);
    if (!versionId || isNaN(versionId)) {
      return res.status(400).json({ error: 'Valid Version ID is required.' });
    }

    const [rows] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Requested version package does not exist.' });
    }

    const version = rows[0];

    // Increment download analytics
    await pool.query('UPDATE app_versions SET download_count = download_count + 1 WHERE id = ?', [versionId]);

    // Check if it's a local file in uploads/updates
    if (version.download_url && version.download_url.startsWith('/uploads/updates/')) {
      const relativePath = version.download_url.replace('/uploads/updates/', '');
      const localFilePath = path.join(__dirname, '../uploads/updates', relativePath);

      if (fs.existsSync(localFilePath)) {
        return res.download(localFilePath, version.file_name || path.basename(localFilePath));
      }
    }

    // External URL or store redirect
    if (version.download_url && (version.download_url.startsWith('http://') || version.download_url.startsWith('https://'))) {
      return res.redirect(version.download_url);
    }

    return res.status(404).json({ error: 'Package file not found on server.' });

  } catch (err) {
    console.error('[AppVersionController.downloadPackage Error]', err);
    return res.status(500).json({ error: 'Failed to stream update package.' });
  }
};

/**
 * GET /api/app-versions/:platform/latest or GET /api/version/:platform/latest
 * Fetch latest published version details for a specific platform
 */
exports.getLatestVersion = async (req, res) => {
  try {
    let platform = (req.params.platform || req.query.platform || 'windows').toLowerCase().trim();
    if (platform === 'android' || platform === 'ios') platform = 'mobile';

    const currentVersion = (req.query.current_version || req.query.version || '').trim();

    const [rows] = await pool.query(
      `SELECT * FROM app_versions 
       WHERE platform = ? AND is_active = 1 
       ORDER BY version_code DESC, id DESC 
       LIMIT 1`,
      [platform]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        platform,
        message: `No active published version found for ${platform}.`
      });
    }

    const latest = rows[0];
    const isNewer = currentVersion ? compareSemver(latest.version, currentVersion) > 0 : null;
    const isBelowMin = (currentVersion && latest.min_supported_version)
      ? compareSemver(currentVersion, latest.min_supported_version) < 0
      : false;
    const isMandatory = Boolean(latest.is_mandatory === 1 || isBelowMin);

    return res.json({
      platform: latest.platform,
      latest_version: latest.version,
      version_code: latest.version_code,
      min_supported_version: latest.min_supported_version,
      is_mandatory: isMandatory,
      update_available: isNewer !== null ? isNewer : true,
      current_version: currentVersion || null,
      title: latest.title,
      release_notes: latest.release_notes || '',
      update_instructions: latest.update_instructions || '',
      download_url: resolveFullUrl(req, latest.download_url),
      direct_api_url: resolveFullUrl(req, `/api/app-versions/download/${latest.id}`),
      file_name: latest.file_name,
      file_size: Number(latest.file_size) || 0,
      checksum_sha256: latest.checksum_sha256 || '',
      package_type: latest.package_type,
      published_at: latest.published_at
    });
  } catch (err) {
    console.error('[AppVersionController.getLatestVersion Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve latest version.' });
  }
};

/**
 * GET /api/app-versions/:platform/latest.yml or GET /api/version/:platform/latest.yml
 * Generates an electron-updater compatible latest.yml feed for Windows Desktop
 */
exports.getLatestYml = async (req, res) => {
  try {
    let platform = (req.params.platform || 'windows').toLowerCase().trim();
    if (platform === 'android' || platform === 'ios') platform = 'mobile';

    const [rows] = await pool.query(
      `SELECT * FROM app_versions 
       WHERE platform = ? AND is_active = 1 
       ORDER BY version_code DESC, id DESC 
       LIMIT 1`,
      [platform]
    );

    if (rows.length === 0) {
      return res.status(404).send('No published version found.');
    }

    const latest = rows[0];
    const downloadUrl = resolveFullUrl(req, latest.download_url);
    const fileName = latest.file_name || path.basename(latest.download_url || 'installer.exe');
    const sha512 = latest.checksum_sha256 ? Buffer.from(latest.checksum_sha256).toString('base64') : '';

    const yml = [
      `version: ${latest.version}`,
      `files:`,
      `  - url: ${downloadUrl}`,
      sha512 ? `    sha512: ${sha512}` : null,
      latest.file_size ? `    size: ${latest.file_size}` : null,
      `path: ${downloadUrl}`,
      sha512 ? `sha512: ${sha512}` : null,
      `releaseDate: ${new Date(latest.published_at || latest.created_at).toISOString()}`,
      `releaseNotes: |`,
      ...(latest.release_notes ? latest.release_notes.split('\n').map(l => `  ${l}`) : ['  General improvements and bug fixes.'])
    ].filter(Boolean).join('\n');

    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    return res.send(yml);
  } catch (err) {
    console.error('[AppVersionController.getLatestYml Error]', err);
    return res.status(500).send('Failed to generate latest.yml');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SuperAdmin Version Management APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/superadmin/app-versions
 * List all versions & platform summary
 */
exports.getSuperAdminVersions = async (req, res) => {
  try {
    const [allVersions] = await pool.query(
      `SELECT * FROM app_versions 
       ORDER BY platform ASC, version_code DESC, id DESC`
    );

    // Compute platform summary matrix
    const [summaryRows] = await pool.query(`
      SELECT 
        platform,
        COUNT(*) AS total_releases,
        COALESCE(SUM(download_count), 0) AS total_downloads,
        MAX(CASE WHEN is_active = 1 THEN version ELSE NULL END) AS latest_published_version,
        MAX(CASE WHEN is_active = 1 THEN is_mandatory ELSE 0 END) AS latest_is_mandatory,
        MAX(CASE WHEN is_active = 1 THEN min_supported_version ELSE '1.0.0' END) AS min_supported_version,
        MAX(CASE WHEN is_active = 1 THEN published_at ELSE NULL END) AS latest_published_at
      FROM app_versions
      GROUP BY platform
    `);

    // Fetch full active version details for Windows & Mobile
    const [activeWindows] = await pool.query(
      'SELECT * FROM app_versions WHERE platform = "windows" AND is_active = 1 ORDER BY version_code DESC, id DESC LIMIT 1'
    );
    const [activeMobile] = await pool.query(
      'SELECT * FROM app_versions WHERE platform = "mobile" AND is_active = 1 ORDER BY version_code DESC, id DESC LIMIT 1'
    );

    // Fetch newest registered releases (whether active or draft)
    const [newestWindows] = await pool.query(
      'SELECT * FROM app_versions WHERE platform = "windows" ORDER BY version_code DESC, id DESC LIMIT 1'
    );
    const [newestMobile] = await pool.query(
      'SELECT * FROM app_versions WHERE platform = "mobile" ORDER BY version_code DESC, id DESC LIMIT 1'
    );

    return res.json({
      versions: allVersions.map(v => ({
        ...v,
        download_url: resolveFullUrl(req, v.download_url)
      })),
      active: {
        windows: activeWindows[0] ? { ...activeWindows[0], download_url: resolveFullUrl(req, activeWindows[0].download_url) } : null,
        mobile: activeMobile[0] ? { ...activeMobile[0], download_url: resolveFullUrl(req, activeMobile[0].download_url) } : null
      },
      newest: {
        windows: newestWindows[0] ? { ...newestWindows[0], download_url: resolveFullUrl(req, newestWindows[0].download_url) } : null,
        mobile: newestMobile[0] ? { ...newestMobile[0], download_url: resolveFullUrl(req, newestMobile[0].download_url) } : null
      },
      summary: summaryRows
    });

  } catch (err) {
    console.error('[AppVersionController.getSuperAdminVersions Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve application version records.' });
  }
};

/**
 * POST /api/superadmin/app-versions
 * Create or publish new version package
 */
exports.createVersion = async (req, res) => {
  try {
    let {
      platform,
      version,
      title,
      release_notes,
      update_instructions,
      is_active,
      is_mandatory,
      min_supported_version,
      download_url,
      checksum_sha256,
      package_type
    } = req.body;

    platform = (platform || 'windows').toLowerCase().trim();
    if (!['windows', 'mobile'].includes(platform)) {
      return res.status(400).json({ error: 'Platform must be either "windows" or "mobile".' });
    }

    if (!version || !version.trim()) {
      return res.status(400).json({ error: 'Version string (e.g., 1.0.6) is required.' });
    }
    version = version.trim().replace(/^v/i, '');

    // Validate SemVer syntax (e.g. 1.0.6 or 1.0.6.1)
    if (!/^\d+(\.\d+)+$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version format. Use standard SemVer format like "1.0.6".' });
    }

    // Check if platform + version already exists
    const [existing] = await pool.query(
      'SELECT id FROM app_versions WHERE platform = ? AND version = ?',
      [platform, version]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: `Version ${version} for ${platform} already exists. Please choose a new version number or edit the existing release.` });
    }

    let fileName = null;
    let fileSize = 0;
    let calculatedChecksum = checksum_sha256 ? checksum_sha256.trim() : null;

    // Handle physical file upload if provided
    if (req.file) {
      fileName = req.file.originalname;
      fileSize = req.file.size;
      download_url = `/uploads/updates/${req.file.filename}`;

      // Calculate SHA-256 integrity hash
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        calculatedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      } catch (hashErr) {
        console.warn('[Hash Calculation Warning]', hashErr.message);
      }

      if (!package_type) {
        package_type = platform === 'windows' ? 'installer_exe' : 'apk';
      }
    }

    if (!download_url) {
      return res.status(400).json({ error: 'Please provide either an uploaded package file or a package/store URL.' });
    }

    const versionCode = generateVersionCode(version);
    const activeFlag = is_active === true || is_active === 'true' || is_active === 1 || is_active === '1' ? 1 : 0;
    const mandatoryFlag = is_mandatory === true || is_mandatory === 'true' || is_mandatory === 1 || is_mandatory === '1' ? 1 : 0;
    const minVersion = (min_supported_version || '1.0.0').trim().replace(/^v/i, '');
    const releaseTitle = title || `Ariso Retail POS v${version} (${platform === 'windows' ? 'Windows' : 'Mobile'})`;

    const [result] = await pool.query(
      `INSERT INTO app_versions (
        platform, version, version_code, title, release_notes,
        update_instructions, is_active, is_mandatory, min_supported_version,
        download_url, file_name, file_size, checksum_sha256,
        package_type, created_by, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        platform,
        version,
        versionCode,
        releaseTitle,
        release_notes || '',
        update_instructions || '',
        activeFlag,
        mandatoryFlag,
        minVersion,
        download_url,
        fileName,
        fileSize,
        calculatedChecksum,
        package_type || (platform === 'windows' ? 'installer_exe' : 'apk'),
        req.user && req.user.id ? req.user.id : null
      ]
    );

    const [newRow] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [result.insertId]);

    // Broadcast update event in real-time if published immediately
    if (activeFlag === 1) {
      try {
        const realtime = require('../services/realtime_service');
        realtime.notify.appVersionPublished(platform, version);
      } catch (rtErr) {
        console.warn('[Realtime Notification Warning]', rtErr.message);
      }
    }

    return res.status(201).json({
      message: `Successfully created and published ${platform} version v${version}.`,
      version: {
        ...newRow[0],
        download_url: resolveFullUrl(req, newRow[0].download_url)
      }
    });

  } catch (err) {
    console.error('[AppVersionController.createVersion Error]', err);
    return res.status(500).json({ error: 'Failed to create application version.' });
  }
};

/**
 * PUT /api/superadmin/app-versions/:id
 * Update version metadata, notes, mandatory flag, or publish status
 */
exports.updateVersion = async (req, res) => {
  try {
    const versionId = parseInt(req.params.id, 10);
    if (!versionId || isNaN(versionId)) {
      return res.status(400).json({ error: 'Valid Version ID is required.' });
    }

    const [existing] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Version record not found.' });
    }

    const current = existing[0];
    const {
      title,
      release_notes,
      update_instructions,
      is_active,
      is_mandatory,
      min_supported_version,
      download_url,
      package_type
    } = req.body;

    const activeFlag = is_active !== undefined
      ? (is_active === true || is_active === 'true' || is_active === 1 || is_active === '1' ? 1 : 0)
      : current.is_active;

    const mandatoryFlag = is_mandatory !== undefined
      ? (is_mandatory === true || is_mandatory === 'true' || is_mandatory === 1 || is_mandatory === '1' ? 1 : 0)
      : current.is_mandatory;

    let finalDownloadUrl = download_url !== undefined ? download_url : current.download_url;
    let finalFileName = current.file_name;
    let finalFileSize = current.file_size;
    let finalChecksum = current.checksum_sha256;

    if (req.file) {
      finalFileName = req.file.originalname;
      finalFileSize = req.file.size;
      finalDownloadUrl = `/uploads/updates/${req.file.filename}`;
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        finalChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      } catch (hErr) {
        console.warn('[Hash Warning]', hErr.message);
      }
    }

    await pool.query(
      `UPDATE app_versions SET
        title = COALESCE(?, title),
        release_notes = COALESCE(?, release_notes),
        update_instructions = COALESCE(?, update_instructions),
        is_active = ?,
        is_mandatory = ?,
        min_supported_version = COALESCE(?, min_supported_version),
        download_url = ?,
        file_name = ?,
        file_size = ?,
        checksum_sha256 = ?,
        package_type = COALESCE(?, package_type)
      WHERE id = ?`,
      [
        title,
        release_notes,
        update_instructions,
        activeFlag,
        mandatoryFlag,
        min_supported_version,
        finalDownloadUrl,
        finalFileName,
        finalFileSize,
        finalChecksum,
        package_type,
        versionId
      ]
    );

    const [updatedRow] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);

    // Broadcast update if active
    if (activeFlag === 1) {
      try {
        const realtime = require('../services/realtime_service');
        realtime.notify.appVersionPublished(current.platform, current.version);
      } catch (_) {}
    }

    return res.json({
      message: 'Version updated successfully.',
      version: {
        ...updatedRow[0],
        download_url: resolveFullUrl(req, updatedRow[0].download_url)
      }
    });

  } catch (err) {
    console.error('[AppVersionController.updateVersion Error]', err);
    return res.status(500).json({ error: 'Failed to update application version.' });
  }
};

/**
 * PATCH /api/superadmin/app-versions/:id/publish
 * Toggle publish status or set as active version
 */
exports.togglePublish = async (req, res) => {
  try {
    const versionId = parseInt(req.params.id, 10);
    const [existing] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Version not found.' });
    }

    const current = existing[0];
    const newStatus = current.is_active === 1 ? 0 : 1;

    await pool.query(
      'UPDATE app_versions SET is_active = ?, published_at = NOW() WHERE id = ?',
      [newStatus, versionId]
    );

    if (newStatus === 1) {
      try {
        const realtime = require('../services/realtime_service');
        realtime.notify.appVersionPublished(current.platform, current.version);
      } catch (_) {}
    }

    return res.json({
      message: `Version v${current.version} is now ${newStatus === 1 ? 'Published' : 'Unpublished / Disabled'}.`,
      is_active: newStatus
    });

  } catch (err) {
    console.error('[AppVersionController.togglePublish Error]', err);
    return res.status(500).json({ error: 'Failed to toggle publication status.' });
  }
};

/**
 * PATCH /api/superadmin/app-versions/:id/toggle-mandatory
 * Toggle mandatory requirement flag
 */
exports.toggleMandatory = async (req, res) => {
  try {
    const versionId = parseInt(req.params.id, 10);
    const [existing] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Version not found.' });
    }

    const current = existing[0];
    const newMandatory = current.is_mandatory === 1 ? 0 : 1;

    await pool.query(
      'UPDATE app_versions SET is_mandatory = ? WHERE id = ?',
      [newMandatory, versionId]
    );

    return res.json({
      message: `Version v${current.version} update is now ${newMandatory === 1 ? 'Mandatory' : 'Optional'}.`,
      is_mandatory: newMandatory
    });

  } catch (err) {
    console.error('[AppVersionController.toggleMandatory Error]', err);
    return res.status(500).json({ error: 'Failed to toggle mandatory flag.' });
  }
};

/**
 * PATCH /api/superadmin/app-versions/:id/set-latest
 * Designates a specific version as the active latest version for its platform.
 * If this version is older than other active versions, it deactivates any higher ones.
 */
exports.setLatestVersion = async (req, res) => {
  try {
    const versionId = parseInt(req.params.id, 10);
    const [existing] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Version not found.' });
    }

    const target = existing[0];

    // Deactivate any version for the same platform that has a higher version_code
    await pool.query(
      'UPDATE app_versions SET is_active = 0 WHERE platform = ? AND version_code > ?',
      [target.platform, target.version_code]
    );

    // Ensure the target version is active and marked with current publication timestamp
    await pool.query(
      'UPDATE app_versions SET is_active = 1, published_at = NOW() WHERE id = ?',
      [versionId]
    );

    // Notify connected terminals in real time
    try {
      const realtime = require('../services/realtime_service');
      realtime.notify.appVersionPublished(target.platform, target.version);
    } catch (_) {}

    return res.json({
      message: `Version v${target.version} is now the active latest version for ${target.platform.toUpperCase()}.`,
      platform: target.platform,
      latest_version: target.version
    });
  } catch (err) {
    console.error('[AppVersionController.setLatestVersion Error]', err);
    return res.status(500).json({ error: 'Failed to set active latest version.' });
  }
};

/**
 * DELETE /api/superadmin/app-versions/:id
 * Delete version and purge local file if stored locally
 */
exports.deleteVersion = async (req, res) => {
  try {
    const versionId = parseInt(req.params.id, 10);
    const [existing] = await pool.query('SELECT * FROM app_versions WHERE id = ?', [versionId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Version not found.' });
    }

    const version = existing[0];

    // Safely delete physical file if stored in uploads/updates
    if (version.download_url && version.download_url.startsWith('/uploads/updates/')) {
      const filename = path.basename(version.download_url);
      const filePath = path.join(__dirname, '../uploads/updates', filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[AppVersionController] Purged physical package file: ${filePath}`);
        } catch (unlinkErr) {
          console.warn('[Unlink Warning]', unlinkErr.message);
        }
      }
    }

    await pool.query('DELETE FROM app_versions WHERE id = ?', [versionId]);

    return res.json({ message: `Version v${version.version} for ${version.platform} deleted successfully.` });

  } catch (err) {
    console.error('[AppVersionController.deleteVersion Error]', err);
    return res.status(500).json({ error: 'Failed to delete application version.' });
  }
};
