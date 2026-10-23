const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const PrinterRepository = require('../repositories/printer_repository');
const PrintQueueRepository = require('../repositories/print_queue_repository');
const OrderRepository = require('../repositories/order_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const ReceiptRepository = require('../repositories/receipt_repository');
const DeviceRepository = require('../repositories/device_repository');
const Jimp = require('jimp');
const SerialNumberService = require('./serial_number_service');

// Low-level ESC/POS Commands
const ESC = '\x1B';
const GS = '\x1D';
const CMD_INIT = ESC + '@';
const CMD_ALIGN_LEFT = ESC + 'a\x00';
const CMD_ALIGN_CENTER = ESC + 'a\x01';
const CMD_ALIGN_RIGHT = ESC + 'a\x02';
const CMD_FONT_NORMAL = GS + '!\x00';
const CMD_FONT_DOUBLE = GS + '!\x11';
const CMD_BOLD_ON = ESC + 'E\x01';
const CMD_BOLD_OFF = ESC + 'E\x00';
const CMD_CUT = GS + 'V\x41\x03'; // Auto paper cut
const CMD_CASH_DRAWER = ESC + 'p\x00\x19\xFA'; // Cash drawer kick pulse

function formatReceiptDateTime(dateVal) {
  const d = dateVal ? new Date(dateVal) : new Date();
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  return `${day}/${month}/${year}, ${timeStr}`;
}

class PrinterService {
  /**
   * Tests socket reachability for an IP & port
   */
  static testSocketReachability(ip, port = 9100, timeoutMs = 800) {
    if (!ip) return Promise.resolve(false);
    if (ip === '127.0.0.1' || ip === 'localhost') return Promise.resolve(true);

    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(timeoutMs);
      sock.connect(port, ip, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    });
  }

  /**
   * Automatically discovers thermal printers across all active IPv4 local network subnets on port 9100
   */
  static async discoverNetworkPrinters() {
    const ifaces = os.networkInterfaces();
    const subnets = new Set();

    for (const name in ifaces) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            subnets.add(parts.slice(0, 3).join('.'));
          }
        }
      }
    }

    const discovered = [];
    const scanHost = (ip, port = 9100) => {
      return new Promise((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(600);
        sock.connect(port, ip, () => {
          sock.setTimeout(800);
          let modelName = 'LAN Thermal Printer';
          try {
            sock.write(Buffer.from([0x1D, 0x49, 0x43])); // Query device model via ESC/POS GS I 67
          } catch (e) {}

          sock.on('data', (data) => {
            const raw = data.toString('utf-8').replace(/[\x00-\x1F\x7F_]/g, '').trim();
            if (raw) modelName = raw;
            sock.destroy();
            discovered.push({
              ip,
              port,
              name: modelName,
              model: modelName,
              type: 'lan',
              paper_width: '80',
              status: 'online'
            });
            resolve(true);
          });

          sock.on('timeout', () => {
            sock.destroy();
            discovered.push({
              ip,
              port,
              name: modelName,
              model: modelName,
              type: 'lan',
              paper_width: '80',
              status: 'online'
            });
            resolve(true);
          });
        });

        sock.on('error', () => { sock.destroy(); resolve(false); });
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
      });
    };

    const scanTasks = [];
    for (const prefix of subnets) {
      for (let i = 1; i <= 254; i++) {
        scanTasks.push(scanHost(`${prefix}.${i}`, 9100));
      }
    }

    await Promise.all(scanTasks);
    return discovered;
  }

  /**
   * Dynamically enumerates all installed local/USB Windows printers
   * Detects protocol (TSPL, ZPL, ESC/POS), role (label vs receipt), and online status.
   */
  static getSystemPrinters() {
    if (process.platform !== 'win32') return Promise.resolve([]);
    return new Promise((resolve) => {
      const psCmd = `Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus, @{Name='WorkOffline';Expression={[bool]($_.PrinterState -band 0x400 -or $_.WorkOffline)}}, JobCount | ConvertTo-Json -Compress`;
      exec(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { timeout: 4000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          return resolve([]);
        }
        try {
          const raw = JSON.parse(stdout.trim());
          const list = Array.isArray(raw) ? raw : [raw];
          const printers = list.map(p => {
            const name = p.Name || '';
            const driver = p.DriverName || '';
            const port = p.PortName || '';
            const isVirtual = /pdf|onenote|xps|fax|microsoft print to|nul:|portprompt/i.test(`${name} ${driver} ${port}`);
            const isUsb = /^usb/i.test(port);
            const isLabel = /tsc|te244|te200|da210|ttp|label|barcode|gprinter|argox|xprinter|hprt|zebra|zpl|godex|datamax/i.test(`${name} ${driver}`);
            const protocol = isLabel ? (/zebra|zpl/i.test(`${name} ${driver}`) ? 'zpl' : 'tspl') : 'escpos';
            const isOnline = !p.WorkOffline && (p.PrinterStatus === 0 || p.PrinterStatus === 3 || p.PrinterStatus === 'Normal' || p.PrinterStatus === 'Printing');

            return {
              name,
              driver_name: driver,
              port_name: port,
              type: isUsb ? 'usb' : (/^\d+\.\d+\.\d+\.\d+/.test(port) ? 'lan' : 'local'),
              protocol,
              role: isLabel ? 'label' : 'receipt',
              is_label: isLabel,
              is_virtual: isVirtual,
              is_online: isOnline,
              status: isOnline ? 'online' : 'offline',
              job_count: p.JobCount || 0
            };
          });
          resolve(printers);
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  /**
   * Unified dynamic discovery combining both local Windows hardware (USB) and subnet LAN socket printers
   */
  static async discoverAllPrinters() {
    const [networkPrinters, systemPrinters] = await Promise.all([
      this.discoverNetworkPrinters().catch(() => []),
      this.getSystemPrinters().catch(() => [])
    ]);

    const physicalSystem = systemPrinters.filter(p => !p.is_virtual);
    const merged = [];
    const seenNames = new Set();

    for (const p of physicalSystem) {
      seenNames.add(p.name.toLowerCase());
      merged.push({
        name: p.name,
        type: p.type || 'usb',
        port_name: p.port_name,
        driver_name: p.driver_name,
        protocol: p.protocol,
        role: p.role,
        is_label: p.is_label,
        status: p.status,
        paper_width: p.is_label ? '50' : '80'
      });
    }

    for (const p of networkPrinters) {
      if (!seenNames.has(p.name.toLowerCase())) {
        merged.push(p);
      }
    }

    return merged;
  }

  /**
   * Auto-resolves printer for an outlet:
   * 1. Checks existing DB printer reachability.
   * 2. If unreachable (IP change / DHCP renewal), scans local network to find new printer IP and updates DB.
   * 3. If no printer in DB, auto-discovers and registers the printer as default.
   */
  static async autoResolveAndSyncPrinter(restaurantId = 1) {
    try {
      const existingPrinters = await PrinterRepository.getAll(restaurantId);
      let defaultPrinter = existingPrinters.find(p => (p.is_default_receipt === 1 || p.role === 'receipt') && (p.type === 'lan' || p.type === 'network' || !!p.ip_address))
        || existingPrinters.find(p => p.type === 'lan' || p.type === 'network' || !!p.ip_address)
        || existingPrinters[0]
        || null;

      if (defaultPrinter && defaultPrinter.ip_address) {
        // Test reachability of current configured IP
        const isReachable = await this.testSocketReachability(defaultPrinter.ip_address, defaultPrinter.port || 9100, 1000);
        if (isReachable) {
          if (defaultPrinter.status !== 'online') {
            await PrinterRepository.updateStatus(defaultPrinter.id, restaurantId, 'online').catch(() => {});
            defaultPrinter.status = 'online';
          }
          return defaultPrinter;
        }

        console.log(`[Printer Auto-Sync] Configured printer IP ${defaultPrinter.ip_address} unreachable. Scanning local Wi-Fi/LAN for dynamic IP changes...`);
      }

      // Run network auto-discovery across local Wi-Fi / subnet
      const discoveredPrinters = await this.discoverNetworkPrinters();
      if (discoveredPrinters.length > 0) {
        const found = discoveredPrinters[0];
        console.log(`[Printer Auto-Sync] Discovered dynamic LAN printer at ${found.ip}:${found.port} (${found.name})`);

        if (defaultPrinter) {
          // Dynamic IP change detected! Update printer record with new IP & name
          await PrinterRepository.update(defaultPrinter.id, restaurantId, {
            name: defaultPrinter.name && defaultPrinter.name !== 'LAN Thermal Printer' ? defaultPrinter.name : found.name,
            type: 'lan',
            ip_address: found.ip,
            port: found.port || 9100,
            paper_width: defaultPrinter.paper_width || '80',
            character_encoding: defaultPrinter.character_encoding || 'UTF-8',
            role: defaultPrinter.role || 'receipt',
            is_default_receipt: 1,
            is_default_kot: defaultPrinter.is_default_kot !== undefined ? defaultPrinter.is_default_kot : 1,
            auto_cut: defaultPrinter.auto_cut !== undefined ? defaultPrinter.auto_cut : 1,
            cash_drawer: defaultPrinter.cash_drawer !== undefined ? defaultPrinter.cash_drawer : 1,
            is_active: 1,
            status: 'online'
          });
          defaultPrinter = await PrinterRepository.getById(defaultPrinter.id, restaurantId);
          return defaultPrinter;
        } else {
          // Register brand new auto-detected printer in database
          const newPrinterId = await PrinterRepository.create(restaurantId, {
            name: found.name || 'LAN Thermal Printer',
            type: 'lan',
            ip_address: found.ip,
            port: found.port || 9100,
            paper_width: '80',
            character_encoding: 'UTF-8',
            role: 'receipt',
            is_default_receipt: 1,
            is_default_kot: 1,
            auto_cut: 1,
            cash_drawer: 1
          });
          defaultPrinter = await PrinterRepository.getById(newPrinterId, restaurantId);
          return defaultPrinter;
        }
      }

      return defaultPrinter;
    } catch (err) {
      console.error('[Printer Auto-Sync Error]', err.message);
      return null;
    }
  }

  /**
   * Sends a raw in-memory Buffer payload directly to a network thermal printer TCP socket
   */
  static sendToPrinterSocket(ip, port, buffer) {
    const tConnectionStarted = Date.now();
    return new Promise((resolve, reject) => {
      const isMock = !ip || ip === '127.0.0.1' || ip.startsWith('192.168.99') || ip === 'localhost';

      if (isMock) {
        // Development / Mock Virtual Printer Mode (In-memory execution, no physical socket & NO disk text files created)
        const tConnected = Date.now();
        const tSent = Date.now() + 5;
        const tCompleted = Date.now() + 8;
        console.log(`[Dynamic Printer Engine - In-Memory Execution] Simulated socket print stream to ${ip || 'virtual'}:${port || 9100} (${buffer.length} bytes payload)`);
        return resolve({
          success: true,
          method: 'virtual_in_memory',
          timing: {
            tConnectionStarted,
            tConnected,
            tSent,
            tCompleted,
            durationMs: tCompleted - tConnectionStarted
          }
        });
      }

      const client = new net.Socket();
      client.setTimeout(3000); // 3.0 second TCP connection timeout for local LAN

      let tConnected = null;
      let tSent = null;

      client.connect(port || 9100, ip, () => {
        tConnected = Date.now();
        client.write(buffer, () => {
          tSent = Date.now();
          client.end();
          const tCompleted = Date.now();
          resolve({
            success: true,
            method: 'tcp_socket',
            timing: {
              tConnectionStarted,
              tConnected,
              tSent,
              tCompleted,
              durationMs: tCompleted - tConnectionStarted
            }
          });
        });
      });

      client.on('error', (err) => {
        client.destroy();
        const customErr = new Error(`Socket connection error (${err.code || err.message}) at ${ip}:${port || 9100}`);
        reject(Object.assign(customErr, { code: err.code, tConnectionStarted, tFailed: Date.now() }));
      });

      client.on('timeout', () => {
        client.destroy();
        const err = new Error(`Connection timed out after 3.0s connecting to thermal printer at ${ip}:${port || 9100}`);
        reject(Object.assign(err, { code: 'ETIMEDOUT', tConnectionStarted, tFailed: Date.now() }));
      });
    });
  }

  /**
   * Sends raw binary bytes (TSPL, ZPL, or ESC/POS) directly to Windows Spooler for USB or local printers
   */
  static sendToWindowsSpooler(printerName, payloadStringOrBuffer, docTitle = 'Ariso Retail Print Job') {
    if (process.platform !== 'win32') {
      return Promise.reject(new Error('Windows spooler printing is only supported on Windows OS.'));
    }
    return new Promise((resolve, reject) => {
      try {
        const buffer = Buffer.isBuffer(payloadStringOrBuffer) ? payloadStringOrBuffer : Buffer.from(payloadStringOrBuffer, 'utf8');
        const tempPayload = path.join(os.tmpdir(), `ariso_spool_${Date.now()}_${Math.random().toString(36).substring(7)}.bin`);
        fs.writeFileSync(tempPayload, buffer);

        const b64PayloadPath = Buffer.from(tempPayload, 'utf8').toString('base64');
        const b64TargetPrinter = Buffer.from(printerName, 'utf8').toString('base64');
        const safeDocTitle = String(docTitle || 'Ariso Retail Print Job').replace(/"/g, '');

        const psScript = `
$ErrorActionPreference = 'Stop'
$typeDef = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern Int32 StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static string Send(string szPrinterName, string szFileName, string szDocTitle) {
        if (!File.Exists(szFileName)) return "ERROR: Payload file not found.";
        byte[] bytes = File.ReadAllBytes(szFileName);
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOW di = new DOCINFOW();
        di.pDocName = string.IsNullOrEmpty(szDocTitle) ? "Ariso Print Job" : szDocTitle;
        di.pDataType = "RAW";
        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            int err = Marshal.GetLastWin32Error();
            string msg = "ERROR: Unable to open printer '" + szPrinterName + "'. ";
            if (err == 5) msg += "Access Denied (Win32 Code 5).";
            else if (err == 1801) msg += "Printer name is invalid or disconnected (Win32 Code 1801).";
            else msg += "Win32 Error Code: " + err + ".";
            return msg;
        }
        try {
            int jobId = StartDocPrinter(hPrinter, 1, di);
            if (jobId <= 0) {
                int err = Marshal.GetLastWin32Error();
                return "ERROR: StartDocPrinter failed for '" + szPrinterName + "' (Win32 Code: " + err + "). Printer may be offline or busy.";
            }
            try {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten = 0;
                    bool bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                    if (!bSuccess || dwWritten != bytes.Length) {
                        return "ERROR: WritePrinter failed for '" + szPrinterName + "'. Written " + dwWritten + " of " + bytes.Length + " bytes.";
                    }
                    return "SUCCESS: " + szPrinterName;
                }
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
        return "ERROR: Spooler transaction failed.";
    }
}
'@
Add-Type -TypeDefinition $typeDef
$payloadFilePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${b64PayloadPath}"))
$targetPrinterName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${b64TargetPrinter}"))
$res = [RawPrinterHelper]::Send($targetPrinterName, $payloadFilePath, "${safeDocTitle}")
Write-Output $res
`;

        const psScriptFile = path.join(os.tmpdir(), `ariso_spool_${Date.now()}_${Math.random().toString(36).substring(7)}.ps1`);
        fs.writeFileSync(psScriptFile, psScript, 'utf8');

        exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psScriptFile}"`, { timeout: 6000 }, (error, stdout, stderr) => {
          try { fs.unlinkSync(tempPayload); } catch (e) {}
          try { fs.unlinkSync(psScriptFile); } catch (e) {}

          const outStr = (stdout || '').trim();
          const errStr = (stderr || '').trim();

          if (outStr.startsWith('SUCCESS:')) {
            resolve({ success: true, method: 'winspool_raw', printer: printerName, message: outStr });
          } else if (outStr.startsWith('ERROR:')) {
            reject(new Error(outStr.replace(/^ERROR:\s*/, '')));
          } else if (error || errStr) {
            const cleanMsg = errStr.replace(/^.*?:\s*/, '') || error?.message || 'Print dispatch failed.';
            reject(new Error(cleanMsg));
          } else {
            reject(new Error(outStr || 'Unknown print spooler status'));
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates native TSPL commands for label stickers (TSC, Gprinter, HPRT, Xprinter, etc.)
   * Fully responsive across 50x25mm, 38x38mm, 38x50mm in both 1-Row and 2-Row (twin side-by-side) roll formats.
   * All fields are centered within die-cut boundaries with zero rotation (upright).
   */
  /**
   * Generates native TSPL commands for label stickers (TSC, Gprinter, HPRT, Xprinter, etc.)
   * Ported from ScanGo's proven TSPL architecture.
   * Fully responsive across 50x25mm, 38x38mm, 38x50mm in both 1-Row and 2-Row (twin side-by-side) roll formats.
   * All fields are centered within die-cut boundaries with DIRECTION 1 (upright, zero rotation).
   */
  static buildTsplLabel({
    storeName = 'ARISO RETAIL',
    productName = '',
    name = '',
    item_name = '',
    barcode = '',
    sku = '',
    serialNumber = '',
    price = null,
    mrp = null,
    widthMm = 38,
    heightMm = 50,
    rows = 2,
    gapMm = 3,
    spacingMm = 3,
    dpi = 203,
    copies = 1,
    showShopName = true,
    showProductName = true,
    localProductName = '',
    showAddress = false,
    address = '',
    showWeight = false,
    printWeight = false,
    weight = '',
    weightValue = '',
    weightUnit = 'g',
    showSize = false,
    size = '',
    showColor = false,
    color = '',
    showMrp = true,
    showSellingPrice = true,
    showMfgDate = true,
    mfgDate = '',
    showExpDate = false,
    expDate = '',
    showBarcode = true,
    direction = 0,
    offsetXmm = 0,
    offsetYmm = 0,
    speed = 4,
    density = 8
  }) {
    const sanitizeAscii = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-')
        .replace(/₹/g, 'Rs.')
        .replace(/[^\x20-\x7E]/g, '')
        .trim();
    };

    const w = parseInt(widthMm, 10) || 38;
    const h = parseInt(heightMm, 10) || 50;
    const is2Row = parseInt(rows, 10) === 2;
    const g = parseFloat(gapMm || spacingMm) || 3;
    const totalCopies = Math.max(1, parseInt(copies, 10) || 1);
    const tsplDir = direction !== undefined ? parseInt(direction, 10) : 0;
    const prnDpi = parseInt(dpi, 10) === 300 ? 300 : 203;
    const dpmm = prnDpi === 300 ? (300 / 25.4) : 8;

    const rollWidthMm = is2Row ? (w * 2 + g) : w;
    const cellWidthDots = Math.round(w * dpmm);
    const cellHeightDots = Math.round(h * dpmm);
    const gapDots = Math.round(g * dpmm);

    // Safe inner margin: 2mm (16 dots at 203 DPI, 24 dots at 300 DPI)
    const marginDots = Math.max(Math.round(2 * dpmm), 16);
    const usableDots = cellWidthDots - (marginDots * 2);
    const usableHeightDots = cellHeightDots - (marginDots * 2);

    const offXDots = Math.round((parseFloat(offsetXmm) || 0) * dpmm);
    const offYDots = Math.round((parseFloat(offsetYmm) || 0) * dpmm);

    // Column X cell origins
    const cell1X = offXDots;
    const cell2X = offXDots + cellWidthDots + gapDots;

    const headerLines = [
      `SIZE ${rollWidthMm} mm, ${h} mm`,
      `GAP ${g} mm, 0 mm`,
      `SPEED ${speed || 4}`,
      `DENSITY ${density || 8}`,
      `DIRECTION ${tsplDir}`,
      `REFERENCE 0,0`,
      `OFFSET 0 mm`,
      `SET PEEL OFF`,
      `SET CUTTER OFF`,
      `SET TEAR ON`,
      `SET PAUSE OFF`
    ];

    const fonts = prnDpi === 300 ? {
      small: { id: '1', charW: 10, charH: 14, lineH: 18 },
      regular: { id: '2', charW: 16, charH: 22, lineH: 26 },
      large: { id: '3', charW: 24, charH: 30, lineH: 34 }
    } : {
      small: { id: '1', charW: 8, charH: 12, lineH: 16 },
      regular: { id: '2', charW: 12, charH: 20, lineH: 24 },
      large: { id: '3', charW: 16, charH: 24, lineH: 28 }
    };

    const cleanStore = sanitizeAscii(storeName || 'ARISO RETAIL');
    const cleanName = sanitizeAscii(localProductName || productName || name || item_name || '');
    const cleanAddress = sanitizeAscii(address || '');
    const cleanCode = sanitizeAscii(barcode || serialNumber || sku || '00000000');

    // Variant summary
    const variantParts = [];
    if (showWeight && weight) variantParts.push(/^net\s*wt:\s*/i.test(weight) ? sanitizeAscii(weight) : `Net Wt: ${sanitizeAscii(weight)}`);
    if (showSize && size) variantParts.push(/^size:\s*/i.test(size) ? sanitizeAscii(size) : `Size: ${sanitizeAscii(size)}`);
    if (showColor && color) variantParts.push(/^color:\s*/i.test(color) ? sanitizeAscii(color) : `Color: ${sanitizeAscii(color)}`);
    const variantLine = variantParts.join(' - ');

    // Date summary
    const dateParts = [];
    if (showMfgDate && mfgDate) dateParts.push(`Mfg: ${sanitizeAscii(mfgDate)}`);
    if (showExpDate && expDate) dateParts.push(`Exp: ${sanitizeAscii(expDate)}`);
    const dateLine = dateParts.join('  ');

    // Price summary with mutual fallback
    let numPrice = price !== null && price !== undefined && !isNaN(Number(price)) ? Number(price) : null;
    let numMrp = mrp !== null && mrp !== undefined && !isNaN(Number(mrp)) ? Number(mrp) : null;
    if ((numPrice === null || numPrice <= 0) && numMrp !== null && numMrp > 0) {
      numPrice = numMrp;
    }
    if ((numMrp === null || numMrp <= 0) && numPrice !== null && numPrice > 0) {
      numMrp = numPrice;
    }
    const hasMrp = showMrp && numMrp !== null && numMrp > 0;
    const hasPrice = showSellingPrice && numPrice !== null && numPrice > 0;

    // Helper to auto-fit text into 1 or 2 lines centered within usableDots
    const fitText = (text, prefFontKey, maxLines = 2) => {
      if (!text) return null;
      const prefFont = fonts[prefFontKey] || fonts.regular;
      const smFont = fonts.small;

      if (text.length * prefFont.charW <= usableDots) {
        return { font: prefFont, lines: [text] };
      }

      if (prefFontKey !== 'small' && text.length * smFont.charW <= usableDots && maxLines === 1) {
        return { font: smFont, lines: [text] };
      }

      const wrapWords = (f, maxL) => {
        const words = text.split(/\s+/);
        const lines = [];
        let curLine = '';
        for (const word of words) {
          const testLine = curLine ? curLine + ' ' + word : word;
          if (testLine.length * f.charW <= usableDots) {
            curLine = testLine;
          } else {
            if (curLine) lines.push(curLine);
            curLine = word;
            if (lines.length === maxL - 1) break;
          }
        }
        if (curLine && lines.length < maxL) {
          let lastLine = curLine;
          if (lastLine.length * f.charW > usableDots) {
            const maxChars = Math.floor(usableDots / f.charW);
            lastLine = lastLine.slice(0, Math.max(1, maxChars - 3)).trim() + '...';
          }
          lines.push(lastLine);
        }
        return lines;
      };

      if (maxLines >= 2) {
        const prefLines = wrapWords(prefFont, 2);
        const joined = prefLines.join(' ');
        if (joined.length >= text.length - 3) {
          return { font: prefFont, lines: prefLines };
        }
        const smLines = wrapWords(smFont, 2);
        return { font: smFont, lines: smLines };
      }

      const maxChars = Math.floor(usableDots / prefFont.charW);
      const trunc = text.slice(0, Math.max(1, maxChars - 3)).trim() + '...';
      return { font: prefFont, lines: [trunc] };
    };

    // Code128 barcode math: guarantee full fit in usableDots with quiet zones
    const dataChars = cleanCode.length;
    const modules = 11 * (dataChars + 2) + 13;
    let narrow = 1;
    const minQuietZone = Math.round(2 * dpmm);
    if ((modules * 3) + (2 * minQuietZone) <= usableDots) {
      narrow = 3;
    } else if ((modules * 2) + (2 * minQuietZone) <= usableDots) {
      narrow = 2;
    } else {
      narrow = 1;
    }
    const barcodeW = modules * narrow;

    const buildSingleLabelCommands = (cellOriginX) => {
      const cmds = [];
      const elements = [];

      // 1. Shop Name
      if (showShopName && cleanStore) {
        const fitted = fitText(cleanStore, h < 30 ? 'small' : 'regular', 1);
        if (fitted) {
          elements.push({
            type: 'text',
            font: fitted.font,
            lines: fitted.lines,
            isBold: true,
            height: fitted.lines.length * fitted.font.lineH
          });
        }
      }

      // 2. Shop Address (if enabled and label is tall)
      if (showAddress && cleanAddress && h >= 45) {
        const fitted = fitText(cleanAddress, 'small', 1);
        if (fitted) {
          elements.push({
            type: 'text',
            font: fitted.font,
            lines: fitted.lines,
            isBold: false,
            height: fitted.lines.length * fitted.font.lineH
          });
        }
      }

      // 3. Product Name (1 line for <=25mm, up to 2 lines for >=38mm)
      if (showProductName && cleanName) {
        const fitted = fitText(cleanName, h < 30 ? 'small' : 'regular', h < 30 ? 1 : 2);
        if (fitted) {
          elements.push({
            type: 'text',
            font: fitted.font,
            lines: fitted.lines,
            isBold: true,
            height: fitted.lines.length * fitted.font.lineH
          });
        }
      }

      // 3b. Weight Option (dedicated line between product name and MRP)
      if (printWeight && weightValue) {
        const wStr = `Wt: ${weightValue} ${weightUnit || 'g'}`;
        const fittedWeight = fitText(wStr, 'small', 1);
        if (fittedWeight) {
          elements.push({
            type: 'text',
            font: fittedWeight.font,
            lines: fittedWeight.lines,
            isBold: true,
            height: fittedWeight.lines.length * fittedWeight.font.lineH
          });
        }
      }

      // 4. Variant Info
      if (variantLine && h >= 45 && !printWeight) {
        const fitted = fitText(variantLine, 'small', 1);
        if (fitted) {
          elements.push({
            type: 'text',
            font: fitted.font,
            lines: fitted.lines,
            isBold: false,
            height: fitted.lines.length * fitted.font.lineH
          });
        }
      }

      // 5. MRP & Price
      if (h >= 35) {
        if (hasMrp && hasPrice && numMrp > numPrice) {
          elements.push({
            type: 'mrp',
            font: fonts.small,
            text: `MRP: Rs.${numMrp.toFixed(2)}`,
            height: fonts.small.lineH
          });
          elements.push({
            type: 'text',
            font: fonts.regular,
            lines: [`Our Price: Rs.${numPrice.toFixed(2)}`],
            isBold: true,
            height: fonts.regular.lineH
          });
        } else if (hasPrice) {
          elements.push({
            type: 'text',
            font: fonts.regular,
            lines: [`Price: Rs.${numPrice.toFixed(2)}`],
            isBold: true,
            height: fonts.regular.lineH
          });
        } else if (hasMrp) {
          elements.push({
            type: 'text',
            font: fonts.regular,
            lines: [`MRP: Rs.${numMrp.toFixed(2)}`],
            isBold: true,
            height: fonts.regular.lineH
          });
        }

        // 6. Mfg / Exp Date
        if (dateLine) {
          elements.push({
            type: 'text',
            font: fonts.small,
            lines: [dateLine],
            isBold: false,
            height: fonts.small.lineH
          });
        }
      } else {
        // Compact (50x25 mm): Combined Price and Mfg line
        let compactLine = '';
        if (hasPrice) compactLine += `Price: Rs.${numPrice.toFixed(0)}`;
        else if (hasMrp) compactLine += `MRP: Rs.${numMrp.toFixed(0)}`;
        if (showMfgDate && mfgDate) compactLine += (compactLine ? '  ' : '') + `Mfg: ${sanitizeAscii(mfgDate)}`;
        if (compactLine) {
          elements.push({
            type: 'text',
            font: fonts.small,
            lines: [compactLine],
            isBold: true,
            height: fonts.small.lineH
          });
        }
      }

      // 7. Code128 Barcode & Centered Human-Readable Text
      if (showBarcode && cleanCode) {
        let barH = Math.round(4.5 * dpmm);
        if (h >= 45) barH = Math.round(9 * dpmm);
        else if (h >= 35) barH = Math.round(6.5 * dpmm);
        else barH = Math.round(3.5 * dpmm);

        const textFit = fitText(cleanCode, h < 30 ? 'small' : 'regular', 1) || { font: fonts.small, lines: [cleanCode] };
        elements.push({
          type: 'barcode',
          barcodeValue: cleanCode,
          barcodeW,
          barH,
          narrow,
          wide: narrow * 2,
          font: textFit.font,
          textLine: cleanCode,
          height: barH + Math.round(1 * dpmm) + textFit.font.lineH
        });
      }

      // Height compression if total exceeds usableHeightDots
      let totalElH = elements.reduce((sum, el) => sum + el.height, 0);
      if (totalElH > usableHeightDots) {
        elements.forEach(el => {
          if (el.type === 'barcode') {
            el.barH = Math.max(Math.round(3 * dpmm), el.barH - (totalElH - usableHeightDots));
            el.height = el.barH + Math.round(1 * dpmm) + el.font.lineH;
          }
        });
        totalElH = elements.reduce((sum, el) => sum + el.height, 0);
      }

      const remainingH = usableHeightDots - totalElH;
      const spacing = Math.max(1, Math.floor(remainingH / (elements.length + 1)));

      let curY = Math.max(0, offYDots + marginDots + spacing);

      elements.forEach((el) => {
        if (el.type === 'text') {
          el.lines.forEach((line) => {
            const textW = line.length * el.font.charW;
            const textX = Math.max(0, cellOriginX + marginDots + Math.max(0, Math.round((usableDots - textW) / 2)));
            cmds.push(`TEXT ${textX},${curY},"${el.font.id}",0,1,1,"${line}"`);
            if (el.isBold) {
              cmds.push(`TEXT ${textX + 1},${curY},"${el.font.id}",0,1,1,"${line}"`);
            }
            curY += el.font.lineH;
          });
          curY += spacing;
        } else if (el.type === 'mrp') {
          const textW = el.text.length * el.font.charW;
          const textX = Math.max(0, cellOriginX + marginDots + Math.max(0, Math.round((usableDots - textW) / 2)));
          cmds.push(`TEXT ${textX},${curY},"${el.font.id}",0,1,1,"${el.text}"`);
          const barY = curY + Math.round(el.font.charH / 2);
          const barThick = prnDpi === 300 ? 3 : 2;
          cmds.push(`BAR ${textX},${barY},${textW},${barThick}`);
          curY += el.font.lineH + spacing;
        } else if (el.type === 'barcode') {
          const barX = Math.max(0, cellOriginX + marginDots + Math.max(0, Math.round((usableDots - el.barcodeW) / 2)));
          cmds.push(`BARCODE ${barX},${curY},"128",${el.barH},0,0,${el.narrow},${el.wide},"${el.barcodeValue}"`);
          curY += el.barH + Math.round(1 * dpmm);

          const textW = el.textLine.length * el.font.charW;
          const textX = Math.max(0, cellOriginX + marginDots + Math.max(0, Math.round((usableDots - textW) / 2)));
          cmds.push(`TEXT ${textX},${curY},"${el.font.id}",0,1,1,"${el.textLine}"`);
          curY += el.font.lineH + spacing;
        }
      });

      return cmds;
    };

    // Body streaming: Header sent once, CLS ... PRINT 1,1 for each physical row
    const allLines = [...headerLines];

    if (is2Row) {
      const physicalRows = Math.ceil(totalCopies / 2);
      for (let r = 0; r < physicalRows; r++) {
        allLines.push('CLS');
        allLines.push(...buildSingleLabelCommands(cell1X));
        if ((r * 2 + 1) < totalCopies) {
          allLines.push(...buildSingleLabelCommands(cell2X));
        }
        allLines.push('PRINT 1,1');
      }
    } else {
      for (let r = 0; r < totalCopies; r++) {
        allLines.push('CLS');
        allLines.push(...buildSingleLabelCommands(cell1X));
        allLines.push('PRINT 1,1');
      }
    }

    return allLines.join('\r\n') + '\r\n';
  }

  /**
   * Generates native TSPL calibration payload for diagnostic border and margin verification
   */
  static buildCalibrationTsplLabel({
    widthMm = 38,
    heightMm = 50,
    rows = 2,
    gapMm = 3,
    spacingMm = 3,
    dpi = 203,
    direction = 0,
    offsetXmm = 0,
    offsetYmm = 0
  }) {
    const w = parseInt(widthMm, 10) || 38;
    const h = parseInt(heightMm, 10) || 50;
    const is2Row = parseInt(rows, 10) === 2;
    const g = parseFloat(gapMm || spacingMm) || 3;
    const prnDpi = parseInt(dpi, 10) === 300 ? 300 : 203;
    const dpmm = prnDpi === 300 ? (300 / 25.4) : 8;

    const rollWidthMm = is2Row ? (w * 2 + g) : w;
    const cellWidthDots = Math.round(w * dpmm);
    const cellHeightDots = Math.round(h * dpmm);
    const gapDots = Math.round(g * dpmm);

    const marginDots = Math.max(Math.round(2 * dpmm), 16);
    const usableDots = cellWidthDots - (marginDots * 2);
    const usableHeightDots = cellHeightDots - (marginDots * 2);

    const tsplDir = direction !== undefined ? parseInt(direction, 10) : 0;
    const offXDots = Math.round((parseFloat(offsetXmm) || 0) * dpmm);
    const offYDots = Math.round((parseFloat(offsetYmm) || 0) * dpmm);

    const cell1X = offXDots;
    const cell2X = offXDots + cellWidthDots + gapDots;

    const headerLines = [
      `SIZE ${rollWidthMm} mm, ${h} mm`,
      `GAP ${g} mm, 0 mm`,
      `SPEED 4`,
      `DENSITY 8`,
      `DIRECTION ${tsplDir}`,
      `REFERENCE 0,0`,
      `OFFSET 0 mm`,
      `SET PEEL OFF`,
      `SET CUTTER OFF`,
      `SET TEAR ON`,
      `SET PAUSE OFF`,
      `GAPDETECT`
    ];

    const font = prnDpi === 300 ? {
      small: { id: '1', charW: 10, charH: 14, lineH: 18 },
      regular: { id: '2', charW: 16, charH: 22, lineH: 26 }
    } : {
      small: { id: '1', charW: 8, charH: 12, lineH: 16 },
      regular: { id: '2', charW: 12, charH: 20, lineH: 24 }
    };

    const centerTextX = (str, charWidth, cellOriginX) => {
      const textLen = (str || '').length;
      const textWidth = textLen * charWidth;
      return Math.max(0, cellOriginX + marginDots + Math.max(0, Math.round((usableDots - textWidth) / 2)));
    };

    const buildCellCalibration = (labelTag, cellOriginX) => {
      const cmds = [];
      const x0 = Math.max(0, cellOriginX);
      const x1 = Math.max(0, cellOriginX + cellWidthDots - 1);
      const y0 = Math.max(0, offYDots);
      const y1 = Math.max(0, offYDots + cellHeightDots - 1);

      cmds.push(`BOX ${x0},${y0},${x1},${y1},2`);

      const mX0 = Math.max(0, cellOriginX + marginDots);
      const mX1 = Math.max(0, cellOriginX + cellWidthDots - marginDots);
      const mY0 = Math.max(0, offYDots + marginDots);
      const mY1 = Math.max(0, offYDots + cellHeightDots - marginDots);
      cmds.push(`BOX ${mX0},${mY0},${mX1},${mY1},1`);

      let curY = mY0 + Math.round(2 * dpmm);
      const topStr = '▲▲ TOP OF LABEL ▲▲';
      cmds.push(`TEXT ${centerTextX(topStr, font.small.charW, cellOriginX)},${curY},"${font.small.id}",0,1,1,"${topStr}"`);
      curY += font.small.lineH + 4;

      const tagStr = `[ ${labelTag} ]`;
      cmds.push(`TEXT ${centerTextX(tagStr, font.regular.charW, cellOriginX)},${curY},"${font.regular.id}",0,1,1,"${tagStr}"`);
      curY += font.regular.lineH;

      const szStr = `${w}x${h} mm | ${prnDpi} DPI | X:${offsetXmm || 0} Y:${offsetYmm || 0}mm`;
      cmds.push(`TEXT ${centerTextX(szStr, font.small.charW, cellOriginX)},${curY},"${font.small.id}",0,1,1,"${szStr}"`);
      curY += font.small.lineH;

      const guide1 = 'Outer Box: Die-Cut Edge';
      const guide2 = 'Inner Box: 2mm Safe Area';
      cmds.push(`TEXT ${centerTextX(guide1, font.small.charW, cellOriginX)},${curY},"${font.small.id}",0,1,1,"${guide1}"`);
      curY += font.small.lineH;
      cmds.push(`TEXT ${centerTextX(guide2, font.small.charW, cellOriginX)},${curY},"${font.small.id}",0,1,1,"${guide2}"`);

      const midX = cellOriginX + Math.round(cellWidthDots / 2);
      const midY = offYDots + Math.round(cellHeightDots / 2);
      cmds.push(`BAR ${mX0},${midY},${usableDots},1`);
      cmds.push(`BAR ${midX},${mY0},1,${usableHeightDots}`);

      const btmStr = '▼▼ FEED DIRECTION ▼▼';
      const btmY = mY1 - font.small.charH - 2;
      cmds.push(`TEXT ${centerTextX(btmStr, font.small.charW, cellOriginX)},${btmY},"${font.small.id}",0,1,1,"${btmStr}"`);

      return cmds;
    };

    const allLines = [...headerLines];
    allLines.push('CLS');
    allLines.push(...buildCellCalibration(is2Row ? 'LEFT LABEL' : 'LABEL 1', cell1X));
    if (is2Row) {
      allLines.push(...buildCellCalibration('RIGHT LABEL', cell2X));
    }
    allLines.push('PRINT 1,1');

    return allLines.join('\r\n') + '\r\n';
  }

  /**
   * Generates native ZPL commands for Zebra label printers
   */
  static buildZplLabel({
    storeName = 'ARISO RETAIL',
    productName = 'Product Label',
    barcode = '',
    price = null,
    copies = 1
  }) {
    const cleanStore = String(storeName || 'ARISO RETAIL').replace(/[\^~]/g, '');
    const cleanName = String(productName || 'Product').replace(/[\^~]/g, '').slice(0, 30);
    const cleanCode = String(barcode || '00000000').trim().replace(/[\^~]/g, '');
    const c = Math.max(1, parseInt(copies, 10) || 1);

    let priceText = '';
    if (price) priceText = `Rs. ${parseFloat(price).toFixed(2)}`;

    let zpl = `^XA\n^PW400\n^LL200\n`;
    zpl += `^FO20,15^A0N,20,20^FD${cleanStore}^FS\n`;
    zpl += `^FO20,40^A0N,22,22^FD${cleanName}^FS\n`;
    if (priceText) {
      zpl += `^FO20,65^A0N,20,20^FD${priceText}^FS\n`;
    }
    zpl += `^FO20,95^BY2,2,45^BCN,45,Y,N,N^FD${cleanCode}^FS\n`;
    zpl += `^PQ${c}\n^XZ\n`;
    return zpl;
  }

  /**
   * Universal Barcode/Label Printer Engine: Dynamically detects connected printer protocol,
   * creates correct payload (TSPL/ZPL/ESCPOS), and dispatches via Windows spooler or LAN socket.
   */
  static async printBarcodeLabel(restaurantId, { printer_id, printer_name, label_data = {}, copies = 1 }) {
    let targetPrinter = null;

    if (printer_id) {
      targetPrinter = await PrinterRepository.getById(printer_id, restaurantId);
    }

    if (!targetPrinter && printer_name) {
      const sysPrinters = await this.getSystemPrinters();
      targetPrinter = sysPrinters.find(p => p.name.toLowerCase() === printer_name.toLowerCase()) || null;
    }

    if (!targetPrinter) {
      const allDb = await PrinterRepository.getAll(restaurantId);
      targetPrinter = allDb.find(p => p.role === 'label' || p.role === 'barcode') || null;
    }

    if (!targetPrinter) {
      const sysPrinters = await this.getSystemPrinters();
      targetPrinter = sysPrinters.find(p => !p.is_virtual && p.is_label) || sysPrinters.find(p => !p.is_virtual && p.type === 'usb') || null;
    }

    if (!targetPrinter) {
      throw new Error('No physical barcode/label printer detected. Please connect your USB barcode printer.');
    }

    const sysPrinters = await this.getSystemPrinters();
    const matchingSys = sysPrinters.find(p => p.name.toLowerCase() === (targetPrinter.name || '').toLowerCase());
    if (matchingSys) {
      targetPrinter = { ...matchingSys, ...targetPrinter, driver_name: matchingSys.driver_name, port_name: matchingSys.port_name };
    }

    const pName = (targetPrinter.name || '').toLowerCase();
    const dName = (targetPrinter.driver_name || '').toLowerCase();
    const isZebra = /zebra|zpl/i.test(`${pName} ${dName}`);
    const isTsc = /tsc|te244|te200|da210|ttp|gprinter|hprt|xprinter|godex|argox|label|barcode/i.test(`${pName} ${dName}`) || targetPrinter.protocol === 'tspl' || (matchingSys && matchingSys.is_label);

    const mergedCopies = Math.max(1, parseInt(copies || label_data.copies, 10) || 1);
    const payloadData = { ...label_data, copies: mergedCopies };

    let payloadString = '';
    let protocol = 'tspl';

    if (isZebra) {
      protocol = 'zpl';
      payloadString = this.buildZplLabel(payloadData);
    } else if (isTsc || targetPrinter.type === 'usb' || !targetPrinter.ip_address) {
      protocol = 'tspl';
      payloadString = this.buildTsplLabel(payloadData);
    } else {
      protocol = 'escpos';
      payloadString = SerialNumberService.buildEscposSerialBarcode({
        serialNumber: payloadData.barcode || payloadData.serialNumber,
        productName: payloadData.productName,
        sku: payloadData.sku,
        storeName: payloadData.storeName
      });
    }

    const payloadBuffer = Buffer.from(payloadString, 'utf8');

    if (targetPrinter.type === 'usb' || (!targetPrinter.ip_address && process.platform === 'win32')) {
      const result = await this.sendToWindowsSpooler(targetPrinter.name, payloadBuffer, `Barcode Label: ${payloadData.productName || payloadData.barcode}`);
      return {
        success: true,
        protocol,
        printer: {
          name: targetPrinter.name,
          type: 'usb',
          driver_name: targetPrinter.driver_name,
          port_name: targetPrinter.port_name
        },
        message: `Successfully printed barcode label on "${targetPrinter.name}" (${protocol.toUpperCase()})!`,
        details: result
      };
    } else if (targetPrinter.ip_address) {
      const result = await this.sendToPrinterSocket(targetPrinter.ip_address, targetPrinter.port || 9100, payloadBuffer);
      return {
        success: true,
        protocol,
        printer: {
          name: targetPrinter.name,
          type: 'lan',
          ip: targetPrinter.ip_address,
          port: targetPrinter.port || 9100
        },
        message: `Successfully dispatched barcode label to LAN printer "${targetPrinter.name}"!`,
        details: result
      };
    } else {
      throw new Error(`Unsupported printer connection configuration for "${targetPrinter.name}".`);
    }
  }
  /**
   * Format line width dynamically according to printer paper width (58mm = 32 cols, 80mm = 48 cols)
   */
  static getWidthCols(paperWidth) {
    return paperWidth === '58' || paperWidth === 58 ? 32 : 48;
  }

  /**
   * Helper to safely format two columns (left-aligned label, right-aligned value)
   * guaranteed to fit exact width without wrapping or clipping the right value.
   */
  static formatTwoColumns(leftText, rightText, lineWidth) {
    const left = String(leftText || '');
    const right = String(rightText || '');
    const rightLen = right.length;
    
    if (rightLen >= lineWidth) {
      return right.substring(0, lineWidth);
    }

    const maxLeftLen = lineWidth - rightLen - 1; // leave at least 1 space
    const truncatedLeft = left.length > maxLeftLen ? left.substring(0, maxLeftLen) : left;
    const padLength = lineWidth - rightLen;

    return truncatedLeft.padEnd(padLength, ' ') + right;
  }

  /**
   * Helper to download, resize, and convert a logo image URL to ESC/POS binary bitmap bytes
   */
  static async getLogoEscPosBytes(logoUrl, paperWidth) {
    try {
      if (!logoUrl) return Buffer.alloc(0);
      
      let fullUrl = logoUrl;
      if (logoUrl.startsWith('/')) {
        const path = require('path');
        const fs = require('fs');
        const localPath = path.join(__dirname, '..', logoUrl);
        if (fs.existsSync(localPath)) {
          fullUrl = localPath;
        } else {
          fullUrl = `http://localhost:5005${logoUrl}`;
        }
      }
      
      const image = await Jimp.read(fullUrl);
      
      const targetWidth = paperWidth === '58' ? 256 : 384; 
      image.resize(targetWidth, Jimp.AUTO);
      image.greyscale();
      
      const width = image.bitmap.width;
      const height = image.bitmap.height;
      
      const widthBytes = Math.ceil(width / 8);
      const escposData = [];
      
      // GS v 0 m xL xH yL yH
      escposData.push(0x1D, 0x76, 0x30, 0x00);
      escposData.push(widthBytes % 256, Math.floor(widthBytes / 256));
      escposData.push(height % 256, Math.floor(height / 256));
      
      for (let y = 0; y < height; y++) {
        for (let xByte = 0; xByte < widthBytes; xByte++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = xByte * 8 + bit;
            let pixelVal = 0xFF;
            if (x < width) {
              const color = image.getPixelColor(x, y);
              const rgba = Jimp.intToRGBA(color);
              const brightness = (rgba.r + rgba.g + rgba.b) / 3;
              if (brightness < 128 && rgba.a > 50) {
                pixelVal = 0x00;
              }
            }
            if (pixelVal === 0x00) {
              byteVal |= (1 << (7 - bit));
            }
          }
          escposData.push(byteVal);
        }
      }
      
      return Buffer.concat([
        Buffer.from('\x1Ba\x01'), 
        Buffer.from(escposData),
        Buffer.from('\n\x1Ba\x00')
      ]);
    } catch (err) {
      console.warn('[Printer Logo Error] Failed to generate logo bytes:', err.message);
      return Buffer.alloc(0);
    }
  }

  /**
   * Build dynamic in-memory ESC/POS payload for Order Receipt
   */
  static async buildReceiptPayload(order, items, restaurant, printer, receiptSettings = null) {
    const s = receiptSettings || {};
    const paperWidth = s.paper_size === '58mm' ? '58' : (printer ? printer.paper_width : '80');
    const cols = this.getWidthCols(paperWidth);
    const is58mm = cols === 32;
    const divider = '-'.repeat(cols) + '\n';
    const doubleDivider = '='.repeat(cols) + '\n';

    let cmds = '';
    cmds += CMD_INIT;

    // Set balanced left & right margins for centered alignment on 80mm thermal receipt roll
    if (!is58mm) {
      cmds += GS + 'L\x24\x00'; // 36 dots (~4.5mm) left margin: 36 left + 504 text + 36 right = 576 dots total
    }
    
    // Align header
    const alignCmd = s.header_alignment === 'left' ? CMD_ALIGN_LEFT : (s.header_alignment === 'right' ? CMD_ALIGN_RIGHT : CMD_ALIGN_CENTER);
    cmds += alignCmd;

    const restName = s.restaurant_name || restaurant.name || 'RESTAURANT POS';
    cmds += CMD_BOLD_ON;
    if (!is58mm) {
      cmds += CMD_FONT_DOUBLE;
    }
    cmds += restName.toUpperCase() + '\n' + CMD_FONT_NORMAL + CMD_BOLD_OFF;

    if (s.branch_name && s.branch_name.trim()) {
      cmds += s.branch_name.trim() + '\n';
    }
    const addr = s.address !== undefined ? s.address : restaurant.address;
    if (addr) cmds += addr + '\n';
    
    const phone = s.phone !== undefined ? s.phone : restaurant.phone;
    if (phone) cmds += 'Ph: ' + phone + '\n';
    if (s.whatsapp) cmds += 'WA: ' + s.whatsapp + '\n';
    if (s.email) cmds += 'Email: ' + s.email + '\n';
    if (s.website) cmds += 'Web: ' + s.website + '\n';

    const gst = s.gst_number !== undefined ? s.gst_number : restaurant.gst_number;
    if (gst) cmds += 'GSTIN: ' + gst + '\n';
    if (s.fssai_number) cmds += 'FSSAI Lic No: ' + s.fssai_number + '\n';

    if (s.header_message) cmds += `\n* ${s.header_message} *\n`;
    cmds += doubleDivider;

    // Order Metadata (Payment method line removed, Date in dd/mm/yy format)
    cmds += CMD_ALIGN_LEFT;
    cmds += `Bill No : #${order.unique_order_number}\n`;
    if (s.show_cashier_name !== 0) {
      cmds += `Cashier : ${order.cashier_name || 'Staff'}\n`;
    }
    cmds += `Date    : ${formatReceiptDateTime(order.created_at)}\n`;

    if (s.show_customer_details !== 0 && order.notes) {
      cmds += `Customer: ${order.notes}\n`;
    }

    if (order.reprint_count && order.reprint_count > 0) {
      cmds += CMD_BOLD_ON + `*** REPRINT (${order.reprint_count}) ***\n` + CMD_BOLD_OFF;
    }
    cmds += divider;

    const showMrpSavings = s.show_mrp_savings !== 0 && s.show_mrp_savings !== false && s.show_mrp_savings !== '0' && s.show_mrp_savings !== 'false';

    let itemsSavingSum = 0;
    (items || []).forEach((item) => {
      const price = parseFloat(item.price || item.unit_price || 0);
      const qty = item.is_weight_based ? (parseFloat(item.item_weight) || 1) : (parseFloat(item.quantity ?? item.qty ?? 1) || 1);
      const rawMrp = item.mrp !== undefined && item.mrp !== null ? parseFloat(item.mrp) : price;
      const effectiveMrp = (!isNaN(rawMrp) && rawMrp > price) ? rawMrp : price;
      itemsSavingSum += Math.max(0, effectiveMrp - price) * qty;
    });
    const totalYouSaved = itemsSavingSum + (parseFloat(order.discount_amount || 0) || 0);

    // Items List
    if (is58mm) {
      cmds += CMD_BOLD_ON + `ITEM NAME         QTY/WT    AMOUNT\n` + CMD_BOLD_OFF;
      cmds += divider;
      items.forEach(item => {
        const isWeight = !!item.is_weight_based;
        const rawName = item.name || '';
        let name = '';
        if (rawName.length <= 32) {
          name = rawName;
        } else {
          const firstLine = rawName.substring(0, 32);
          const secondLine = rawName.substring(32, 64);
          name = `${firstLine}\n${secondLine}`;
        }
        const price = parseFloat(item.price || item.unit_price || 0);
        const rawMrp = item.mrp !== undefined && item.mrp !== null ? parseFloat(item.mrp) : price;
        const mrpVal = (!isNaN(rawMrp) && rawMrp > price) ? rawMrp : price;
        const total = parseFloat(item.total_price || (price * (item.quantity || item.item_weight || 1))).toFixed(2);
        
        let qtyWtStr = '';
        if (isWeight) {
          const wt = parseFloat(item.item_weight || item.quantity || 1).toFixed(3);
          const unit = (item.weight_unit === 'pcs' || item.base_unit === 'pcs') ? 'kg' : (item.weight_unit || item.base_unit || 'kg');
          qtyWtStr = `${wt}${unit}@Rs.${price.toFixed(2)}/${unit}`;
        } else {
          const qty = parseInt(item.quantity || 1, 10);
          const unit = item.base_unit || 'pcs';
          qtyWtStr = `${qty}${unit}@Rs.${price.toFixed(2)}`;
        }

        if (showMrpSavings && mrpVal > price) {
          cmds += `${name}\n  ${qtyWtStr.padEnd(14, ' ')} [MRP ${mrpVal.toFixed(2)}] Rs.${total.padStart(7, ' ')}\n`;
        } else {
          cmds += `${name}\n  ${qtyWtStr.padEnd(18, ' ')} Rs.${total.padStart(8, ' ')}\n`;
        }
        if (item.serial_number) cmds += `  SN: ${item.serial_number}\n`;
        if (item.notes) cmds += `  * ${item.notes}\n`;
      });
    } else if (showMrpSavings) {
      cmds += CMD_BOLD_ON + `SN ITEM         QTY    MRP  PRICE AMOUNT\n` + CMD_BOLD_OFF;
      cmds += divider;
      items.forEach((item, idx) => {
        const isWeight = !!item.is_weight_based;
        const qtyStr = isWeight ? `${item.item_weight} ${item.weight_unit || 'kg'}` : `${item.quantity || 1}`;
        const priceVal = parseFloat(item.price || item.unit_price || 0);
        const rawMrp = item.mrp !== undefined && item.mrp !== null ? parseFloat(item.mrp) : priceVal;
        const mrpVal = (!isNaN(rawMrp) && rawMrp > priceVal) ? rawMrp : priceVal;
        const totalVal = parseFloat(item.total_price || (priceVal * (item.quantity || 1)));

        const rateStr = priceVal.toFixed(2);
        const mrpStr = mrpVal.toFixed(2);
        const totalStr = totalVal.toFixed(2);

        const snStr = String(idx + 1).padEnd(3, ' ');
        const rawName = item.name || 'Item';
        if (rawName.length > 12) {
          cmds += `${snStr}${rawName}\n`;
          cmds += `   `.padEnd(16, ' ') +
                  `${qtyStr.padStart(4, ' ')} ` +
                  `${mrpStr.padStart(6, ' ')} ` +
                  `${rateStr.padStart(6, ' ')} ` +
                  `${totalStr.padStart(7, ' ')}\n`;
        } else {
          const namePart = rawName.padEnd(13, ' ');
          cmds += `${snStr}${namePart}${qtyStr.padStart(4, ' ')} ${mrpStr.padStart(6, ' ')} ${rateStr.padStart(6, ' ')} ${totalStr.padStart(7, ' ')}\n`;
        }
        if (item.serial_number) cmds += `  SN: ${item.serial_number}\n`;
        if (item.notes) cmds += `  * Notes: ${item.notes}\n`;
      });
    } else {
      cmds += CMD_BOLD_ON + `ITEM NAME               QTY/WT     RATE       TOTAL\n` + CMD_BOLD_OFF;
      cmds += divider;
      items.forEach(item => {
        const isWeight = !!item.is_weight_based;
        const name = (item.name || '').substring(0, 22).padEnd(22, ' ');
        const price = parseFloat(item.price || item.unit_price || 0);
        const total = parseFloat(item.total_price || (price * (item.quantity || item.item_weight || 1))).toFixed(2);

        let qtyWtStr = '';
        let rateStr = '';
        if (isWeight) {
          const wt = parseFloat(item.item_weight || item.quantity || 1).toFixed(3);
          const unit = (item.weight_unit === 'pcs' || item.base_unit === 'pcs') ? 'kg' : (item.weight_unit || item.base_unit || 'kg');
          qtyWtStr = `${wt} ${unit}`;
          rateStr = `Rs.${price.toFixed(2)}/${unit}`;
        } else {
          const qty = parseInt(item.quantity || 1, 10);
          const unit = item.base_unit || 'pcs';
          qtyWtStr = `${qty} ${unit}`;
          rateStr = `Rs.${price.toFixed(2)}`;
        }

        cmds += `${name} ${qtyWtStr.padEnd(10, ' ')} ${rateStr.padEnd(10, ' ')} Rs.${total.padStart(8, ' ')}\n`;
        if (item.serial_number) cmds += `  SN: ${item.serial_number}\n`;
        if (s.show_tax_details !== 0 && item.gst_rate !== undefined && item.gst_rate !== null) {
          const itemGst = parseFloat(item.gst_rate);
          const itemTax = parseFloat(item.tax_amount || 0).toFixed(2);
          const itemDisc = parseFloat(item.discount_amount || 0).toFixed(2);
          cmds += `  [GST: ${itemGst}% | Tax: Rs.${itemTax}${itemDisc > 0 ? ` | Disc: -Rs.${itemDisc}` : ''}]\n`;
        }
        if (item.notes) cmds += `  * Notes: ${item.notes}\n`;
      });
    }

    cmds += divider;

    // Financial Totals
    const subtotalVal = isNaN(parseFloat(order.subtotal)) ? 0 : parseFloat(order.subtotal);
    const discountVal = isNaN(parseFloat(order.discount_amount)) ? 0 : parseFloat(order.discount_amount);
    
    let taxVal = parseFloat(
      order.tax_amount ?? order.taxAmount ?? order.tax ?? order.gst_amount ?? order.gstAmount ?? 0
    );
    if (taxVal === 0 && subtotalVal > 0 && (s.gst_enabled === 1 || s.gst_enabled === true || s.gst_enabled === 'true')) {
      const rate = parseFloat(s.gst_percentage || s.gst_rate || order.tax_rate || 5);
      taxVal = parseFloat((subtotalVal * (rate / 100)).toFixed(2));
    }

    const totalVal = isNaN(parseFloat(order.total_amount)) ? 0 : parseFloat(order.total_amount);

    const totalItemsCount = items ? items.length : 0;
    const totalQtySum = (items || []).reduce((acc, it) => acc + (it.is_weight_based ? parseFloat(it.item_weight || 1) : (parseFloat(it.quantity ?? it.qty ?? 1) || 1)), 0);
    const formattedQty = totalQtySum % 1 === 0 ? totalQtySum : parseFloat(totalQtySum.toFixed(3));
    cmds += `Total Items: ${totalItemsCount} | Total Qty: ${formattedQty}\n`;

    cmds += PrinterService.formatTwoColumns('Subtotal:', `Rs. ${subtotalVal.toFixed(2)}`, cols) + '\n';
    if (discountVal > 0) {
      const discLabel = order.discount_type === 'percentage' ? `Discount (${order.discount_value}%):` : 'Discount:';
      cmds += PrinterService.formatTwoColumns(discLabel, `-Rs. ${discountVal.toFixed(2)}`, cols) + '\n';
    }
    
    if (s.show_tax_details !== 0 && taxVal > 0) {
      if (order.tax_type === 'inter') {
        cmds += PrinterService.formatTwoColumns('IGST Tax:', `Rs. ${taxVal.toFixed(2)}`, cols) + '\n';
      } else {
        const cgstVal = order.cgst_amount !== undefined && order.cgst_amount !== null
          ? parseFloat(order.cgst_amount).toFixed(2)
          : (taxVal / 2).toFixed(2);
        const sgstVal = order.sgst_amount !== undefined && order.sgst_amount !== null
          ? parseFloat(order.sgst_amount).toFixed(2)
          : (taxVal / 2).toFixed(2);
        cmds += PrinterService.formatTwoColumns('CGST Tax:', `Rs. ${cgstVal}`, cols) + '\n';
        cmds += PrinterService.formatTwoColumns('SGST Tax:', `Rs. ${sgstVal}`, cols) + '\n';
        cmds += PrinterService.formatTwoColumns('Total Tax:', `Rs. ${taxVal.toFixed(2)}`, cols) + '\n';
      }
    }

    cmds += divider;
    cmds += CMD_BOLD_ON;
    if (!is58mm) {
      cmds += CMD_FONT_DOUBLE;
    }
    cmds += PrinterService.formatTwoColumns('TOTAL:', `Rs. ${totalVal.toFixed(2)}`, cols) + '\n' + CMD_FONT_NORMAL + CMD_BOLD_OFF;

    if (showMrpSavings && totalYouSaved > 0) {
      cmds += doubleDivider;
      cmds += CMD_BOLD_ON;
      cmds += PrinterService.formatTwoColumns('You Saved (Rs.):', `${totalYouSaved.toFixed(2)}`, cols) + '\n';
      cmds += CMD_BOLD_OFF;
    }
    cmds += doubleDivider;

    // GST Slabs Summary
    if (s.show_tax_details !== 0 && items && items.length > 0) {
      cmds += '\n-- GST TAX SLABS SUMMARY --\n';
      const gstGroups = {};
      items.forEach(item => {
        const rate = parseFloat(item.gst_rate !== undefined && item.gst_rate !== null ? item.gst_rate : 5);
        if (!gstGroups[rate]) {
          gstGroups[rate] = { taxable: 0, tax: 0 };
        }
        
        const price = parseFloat(item.price || item.unit_price || 0);
        const qty = parseFloat(item.item_weight || item.quantity || 1);
        const disc = parseFloat(item.discount_amount || 0);
        const tax = parseFloat(item.tax_amount || 0);
        
        let taxable = price * qty - disc;
        if (s.gst_mode === 'included') {
          taxable = taxable - tax;
        }
        
        gstGroups[rate].taxable += taxable;
        gstGroups[rate].tax += tax;
      });
      
      cmds += 'Rate   TaxableAmt    TaxAmt    Total\n';
      Object.keys(gstGroups).sort((a,b) => parseFloat(a) - parseFloat(b)).forEach(rate => {
        const group = gstGroups[rate];
        const rStr = `${rate}%`.padEnd(6, ' ');
        const txblStr = `Rs.${group.taxable.toFixed(2)}`.padEnd(13, ' ');
        const taxStr = `Rs.${group.tax.toFixed(2)}`.padEnd(10, ' ');
        const totStr = `Rs.${(group.taxable + group.tax).toFixed(2)}`;
        cmds += `${rStr}${txblStr}${taxStr}${totStr}\n`;
      });
      cmds += doubleDivider;
    }

    // Footer
    cmds += CMD_ALIGN_CENTER;
    const thankYou = (s.thank_you_message !== undefined ? s.thank_you_message : (restaurant.thank_you_message || 'Thank You! Visit Again.') || '').trim();
    if (thankYou) cmds += thankYou + '\n';
    const footerMsg = (s.footer_message || restaurant.footer_message || '').trim();
    if (footerMsg) cmds += `${footerMsg}\n`;
    
    const rawTerms = s.terms_conditions !== undefined ? s.terms_conditions : (s.terms_and_conditions !== undefined ? s.terms_and_conditions : (restaurant.terms_conditions || ''));
    const terms = (rawTerms || '').trim();
    if (terms) {
      cmds += divider;
      cmds += `T&C: ${terms}\n`;
    }
    cmds += '\n\n\n\n\n';

    // Cash Drawer Kick
    if (printer && printer.cash_drawer === 1 && (order.payment_mode === 'cash' || order.payment_mode === 'CASH')) {
      cmds += CMD_CASH_DRAWER;
    }
    // Only cut here if no QR code image will be appended after
    if ((s.show_qr_code === 0 || !s.qr_code_url) && (!printer || printer.auto_cut !== 0)) {
      cmds += CMD_CUT;
    }

    const textBuffer = Buffer.from(cmds, printer && printer.character_encoding === 'PC437' ? 'ascii' : 'utf-8');

    // Fetch and prepend logo ESC/POS bytes if enabled
    let logoBuffer = Buffer.alloc(0);
    if (s.show_logo !== 0 && s.logo_url) {
      logoBuffer = await this.getLogoEscPosBytes(s.logo_url, paperWidth);
    }

    // Fetch QR Code ESC/POS bytes if enabled
    let qrBuffer = Buffer.alloc(0);
    if (s.show_qr_code !== 0 && s.qr_code_url) {
      qrBuffer = await this.getLogoEscPosBytes(s.qr_code_url, paperWidth);
    }

    let postQrBuffer = Buffer.alloc(0);
    if (qrBuffer.length > 0) {
      postQrBuffer = Buffer.from('\n\n\n\n\n' + ((!printer || printer.auto_cut !== 0) ? CMD_CUT : ''), printer && printer.character_encoding === 'PC437' ? 'ascii' : 'utf-8');
    }

    return Buffer.concat([logoBuffer, textBuffer, qrBuffer, postQrBuffer]);
  }

  /**
   * Build dynamic in-memory ESC/POS payload for Kitchen Order Ticket (KOT)
   * Note: KOT never displays prices or payment information.
   */
  static buildKOTPayload(order, items, printer, kotSettings = null) {
    const s = kotSettings || {};
    const paperWidth = s.paper_size === '58mm' ? '58' : (printer ? printer.paper_width : '80');
    const cols = this.getWidthCols(paperWidth);
    const divider = '-'.repeat(cols) + '\n';
    const doubleDivider = '='.repeat(cols) + '\n';

    let cmds = '';
    cmds += CMD_INIT;
    
    // Header
    const kotTitle = s.kot_header || 'KITCHEN ORDER TICKET';
    cmds += CMD_ALIGN_CENTER + CMD_BOLD_ON;
    if (cols === 48) {
      cmds += CMD_FONT_DOUBLE;
    }
    cmds += kotTitle.toUpperCase() + '\n';
    if (cols === 48) {
      cmds += CMD_FONT_NORMAL;
    }
    cmds += CMD_BOLD_OFF;
    if (s.kitchen_name) cmds += `[ ${s.kitchen_name.toUpperCase()} ]\n`;
    cmds += `Order #${order.unique_order_number} | ${order.table_number_or_takeaway || 'Takeaway'}\n`;
    
    if (s.show_kot_time !== 0) {
      cmds += `Time: ${new Date(order.created_at || Date.now()).toLocaleTimeString()}\n`;
    }
    cmds += doubleDivider;

    // Items
    cmds += CMD_ALIGN_LEFT + CMD_BOLD_ON;
    items.forEach(item => {
      const prefix = `${item.quantity || 1} x `;
      const maxNameLen = cols - prefix.length;
      const name = (item.name || '').toUpperCase();
      
      let formattedName = '';
      if (name.length <= maxNameLen) {
        formattedName = name;
      } else {
        const firstLine = name.substring(0, maxNameLen);
        const secondLine = name.substring(maxNameLen, maxNameLen * 2);
        formattedName = `${firstLine}\n${' '.repeat(prefix.length)}${secondLine}`;
      }
      cmds += `${prefix}${formattedName}\n`;
      if (item.notes) {
        cmds += `   >>> NOTE: ${item.notes.toUpperCase()}\n`;
      }
    });
    cmds += CMD_BOLD_OFF + divider;

    if (s.show_kot_order_notes !== 0 && order.notes) {
      cmds += CMD_BOLD_ON + `ORDER NOTE: ${order.notes.toUpperCase()}\n` + CMD_BOLD_OFF + divider;
    }

    const kotNote = s.kot_footer_note || 'Prepare with priority';
    cmds += CMD_ALIGN_CENTER + `* ${kotNote} *\n`;
    cmds += `[ KOT END ]\n\n\n`;

    if (!printer || printer.auto_cut !== 0) {
      cmds += CMD_CUT;
    }

    return Buffer.from(cmds, 'utf-8');
  }

  static async enqueueOrderPrintJobs(restaurantId, orderId, printActions = null) {
    const tEnqueueStart = Date.now();
    try {
      let finalActions = [];

      if (Array.isArray(printActions)) {
        finalActions = printActions;
      } else {
        // Resolve print settings configuration
        const settings = await ReceiptRepository.getByRestaurantId(restaurantId);
        
        // Find order status to see which stage we are at (Stage 1 = pending/confirmed, Stage 2 = completed)
        const orderRes = await OrderRepository.getById(orderId, restaurantId);
        const status = orderRes?.order?.order_status || 'completed';

        const stageMode = (status === 'completed') ? settings.print_stage2_mode : settings.print_stage1_mode;
        
        if (stageMode === 'print_kot_only') {
          finalActions = ['KOT'];
        } else if (stageMode === 'print_receipt_only') {
          finalActions = ['RECEIPT'];
        } else if (stageMode === 'print_kot_receipt') {
          finalActions = ['KOT', 'RECEIPT'];
        } else {
          finalActions = []; // save_only or show_popup (and no explicit override was passed)
        }
      }

      // Fetch order details for payload generation
      const orderRes = await OrderRepository.getById(orderId, restaurantId);
      const order = orderRes ? (orderRes.order || orderRes) : null;
      const items = orderRes && orderRes.items ? orderRes.items : (await OrderRepository.getOrderItems(orderId));
      const restaurant = await SuperAdminRepository.getRestaurantById(restaurantId);
      const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);

      const createdJobIds = [];

      if (finalActions.includes('RECEIPT') && order && restaurant) {
        let receiptPrinter = await PrinterRepository.getDefaultReceiptPrinter(restaurantId);
        if (!receiptPrinter || (receiptPrinter.ip_address && !(await this.testSocketReachability(receiptPrinter.ip_address, receiptPrinter.port || 9100, 500)))) {
          const autoPrn = await this.autoResolveAndSyncPrinter(restaurantId).catch(() => null);
          if (autoPrn) receiptPrinter = autoPrn;
        }
        const receiptBuffer = await this.buildReceiptPayload(order, items, restaurant, receiptPrinter, receiptSettings);
        
        const jobId = await PrintQueueRepository.enqueue({
          restaurant_id: restaurantId,
          order_id: orderId,
          printer_id: receiptPrinter ? receiptPrinter.id : null,
          print_type: 'RECEIPT',
          payload_base64: receiptBuffer ? receiptBuffer.toString('base64') : null,
          backend_received_at: tEnqueueStart
        });
        createdJobIds.push(jobId);
      }

      if (finalActions.includes('KOT') && order && restaurant) {
        const kotPrinter = await PrinterRepository.getDefaultKOTPrinter(restaurantId);
        const kotBuffer = this.buildKOTPayload(order, items, kotPrinter, receiptSettings);

        const jobId = await PrintQueueRepository.enqueue({
          restaurant_id: restaurantId,
          order_id: orderId,
          printer_id: kotPrinter ? kotPrinter.id : null,
          print_type: 'KOT',
          payload_base64: kotBuffer ? kotBuffer.toString('base64') : null,
          backend_received_at: tEnqueueStart
        });
        createdJobIds.push(jobId);
      }

      console.log(`[Printer Engine] Enqueued ${createdJobIds.length} print job(s) for Order #${order?.unique_order_number || orderId} in ${Date.now() - tEnqueueStart}ms (Job IDs: ${createdJobIds.join(', ') || 'None'})`);

      // FAST PATH EXECUTION: Trigger queue processor immediately without waiting 1s for setInterval!
      if (createdJobIds.length > 0) {
        setImmediate(() => {
          this.processPendingQueue().catch(err => console.error('[Fast Path Queue Error]', err));
        });
      }
    } catch (err) {
      console.error('[Printer Queue Enqueue Error]', err);
    }
  }

  /**
   * Process a single print job asynchronously (Parallel Non-Blocking Job Engine)
   */
  static async processSingleJob(job) {
    const tJobStart = Date.now();
    
    try {
      // Prevent cloud backend from socket printing when Desktop Print Gateway is active for the outlet
      const hasGateway = await DeviceRepository.hasActiveGatewayDevice(job.restaurant_id);
      if (hasGateway) {
        // Job is reserved for Desktop Print Gateway polling via /api/agent/print-jobs/poll
        return;
      }

      // Atomically claim job to ensure no duplicate worker execution
      const claimed = await PrintQueueRepository.claimJob(job.id);
      if (!claimed) return; // Another worker or poller tick already claimed this job!

      // Only attempt direct socket printing if IP is non-private or virtual mock
      const targetIp = job.ip_address || '';
      const isPrivateLanIp = targetIp.startsWith('192.168.') || targetIp.startsWith('10.') || targetIp.startsWith('172.');
      if (process.env.NODE_ENV === 'production' && isPrivateLanIp) {
        // Cloud backend cannot reach local LAN IP directly; leave in queue for gateway agent
        return;
      }

      const orderRes = await OrderRepository.getById(job.order_id, job.restaurant_id);
      const order = orderRes ? (orderRes.order || orderRes) : null;
      const items = orderRes && orderRes.items ? orderRes.items : (await OrderRepository.getOrderItems(job.order_id));
      const restaurant = await SuperAdminRepository.getRestaurantById(job.restaurant_id);
      const receiptSettings = await ReceiptRepository.getByRestaurantId(job.restaurant_id);

      if (!order || !restaurant) {
        await PrintQueueRepository.updateJobStatus(job.id, 'FAILED', 'Order or Restaurant data not found in DB.');
        return;
      }

      let bufferPayload;
      if (job.print_type === 'KOT') {
        bufferPayload = this.buildKOTPayload(order, items, job, receiptSettings);
      } else {
        bufferPayload = await this.buildReceiptPayload(order, items, restaurant, job, receiptSettings);
      }

      // Send to thermal printer socket
      const printResult = await this.sendToPrinterSocket(job.ip_address || '127.0.0.1', job.port || 9100, bufferPayload);
      
      const tCompleted = Date.now();
      const totalDurationMs = tCompleted - tJobStart;

      await PrintQueueRepository.updateJobTiming(job.id, {
        connected_at: printResult.timing?.tConnected,
        data_sent_at: printResult.timing?.tSent,
        completed_at: tCompleted,
        total_duration_ms: totalDurationMs
      });

      await PrintQueueRepository.updateJobStatus(job.id, 'SUCCESS');

      const backendTime = job.backend_received_at ? new Date(job.backend_received_at).toISOString() : 'N/A';
      const createdTime = job.created_at ? new Date(job.created_at).toISOString() : 'N/A';
      const connDelay = printResult.timing?.tConnected ? `+${printResult.timing.tConnected - printResult.timing.tConnectionStarted}ms` : 'N/A';
      const sendDelay = printResult.timing?.tSent ? `+${printResult.timing.tSent - printResult.timing.tConnected}ms` : 'N/A';

      console.log(`[PRINT TIMELINE] Job #${job.id} (${job.print_type}) | Rest #${job.restaurant_id} | Printer: ${job.printer_name || 'Thermal'} (${job.ip_address || '127.0.0.1'}:${job.port || 9100})
  • Backend Received : ${backendTime}
  • Job Created      : ${createdTime}
  • Socket Connection: ${connDelay}
  • Print Data Sent  : ${sendDelay}
  • Print Completed  : ${totalDurationMs}ms (SUCCESS)`);
    } catch (jobErr) {
      const totalDurationMs = Date.now() - tJobStart;
      console.error(`[PRINT TIMELINE] Job #${job.id} (${job.print_type}) FAILED after ${totalDurationMs}ms:`, jobErr.message);
      
      await PrintQueueRepository.updateJobTiming(job.id, {
        completed_at: Date.now(),
        total_duration_ms: totalDurationMs
      });

      if ((job.retry_count || 0) >= 2) {
        await PrintQueueRepository.updateJobStatus(job.id, 'FAILED', jobErr.message);
      } else {
        await PrintQueueRepository.incrementRetry(job.id, jobErr.message);
      }
    }
  }

  /**
   * Continuous Database Print Queue Processor (Parallel Non-Blocking Job Engine)
   */
  static async processPendingQueue() {
    try {
      const pendingJobs = await PrintQueueRepository.getPendingJobs(20);
      if (!pendingJobs || pendingJobs.length === 0) return;

      // Process all pending jobs IN PARALLEL per printer/tenant so one failed job never blocks others!
      await Promise.allSettled(pendingJobs.map(job => this.processSingleJob(job)));
    } catch (err) {
      console.error('[Process Pending Queue Error]', err);
    }
  }

  /**
   * Dynamic In-Memory Order Reprint
   */
  static async reprintOrder(restaurantId, orderId, printType = 'RECEIPT') {
    await OrderRepository.incrementReprintCount(orderId, restaurantId);
    await this.enqueueOrderPrintJobs(restaurantId, orderId, [printType]);
    return { message: 'Reprint job enqueued successfully.' };
  }
}

// Continuous background print queue poller safety tick (every 1 second)
setInterval(() => {
  PrinterService.processPendingQueue().catch(err => console.error('[Poller Error]', err));
}, 1000);

module.exports = PrinterService;
