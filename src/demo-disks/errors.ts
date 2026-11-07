// Build failure of one demo disk. The message comes from our own writers and
// never contains text read from a disk.

export class DemoBuildError extends Error {
  readonly diskFile: string;

  constructor(diskFile: string, message: string) {
    super(message);
    this.name = 'DemoBuildError';
    this.diskFile = diskFile;
  }
}
