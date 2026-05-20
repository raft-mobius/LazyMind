import fs from 'fs';
import path from 'path';
import { LOG_CONFIG } from '../../shared/constants';

export class RotatingFileWriter {
  private fd: number | null = null;
  private currentSize = 0;
  private readonly filePath: string;
  private readonly maxSize: number;
  private readonly maxFiles: number;

  constructor(
    filePath: string,
    maxSize = LOG_CONFIG.maxFileSizeBytes,
    maxFiles = LOG_CONFIG.maxFiles
  ) {
    this.filePath = filePath;
    this.maxSize = maxSize;
    this.maxFiles = maxFiles;
  }

  open(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this.filePath)) {
      this.currentSize = fs.statSync(this.filePath).size;
    }

    this.fd = fs.openSync(this.filePath, 'a');
  }

  write(data: string): void {
    if (this.fd === null) this.open();

    const buffer = Buffer.from(data, 'utf-8');
    if (this.currentSize + buffer.length > this.maxSize) {
      this.rotate();
    }

    fs.writeSync(this.fd!, buffer);
    this.currentSize += buffer.length;
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
      this.currentSize = 0;
    }
  }

  private rotate(): void {
    this.close();

    // Shift existing files: .4 → .5, .3 → .4, etc.
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      const dst = `${this.filePath}.${i}`;
      if (fs.existsSync(src)) {
        if (fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.renameSync(src, dst);
      }
    }

    // Delete the oldest if it exceeds maxFiles
    const oldest = `${this.filePath}.${this.maxFiles}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    this.open();
  }
}
