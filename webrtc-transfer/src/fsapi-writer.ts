import { calcChunkInfo, FileInfo, IFileWriter } from "./fileoperate";

export class FileSystemAPIWriter implements IFileWriter {

    static isSupported(): boolean {
        return "showSaveFilePicker" in window;
    }

    private _ofstream?: FileSystemWritableFileStream;
    private _info?: FileInfo;
    private _cache: Uint8Array;
    private _acc: number;
    private _chunkSize: number;
    private _lastChunkSize: number;
    private _writing: number;
    private _wait?: {
        resolve: () => void,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reject: (reason?: any) => void,
    };

    get chunkSize(): number {
        return this._chunkSize;
    }

    get lastChunkSize(): number {
        return this._lastChunkSize;
    }

    get chunkCount(): number {
        return this._cache.length;
    }

    get fileSize(): number {
        return this._info ? this._info.size : 0;
    }

    constructor() {
        this._ofstream = undefined;
        this._info = undefined;
        this._cache = new Uint8Array();
        this._acc = 0;
        this._chunkSize = 0;
        this._lastChunkSize = 0;
        this._writing = 0;
        this._wait = undefined;
    }

    async open(fileInfo: FileInfo, chunkSize: number): Promise<boolean> {
        if (this._ofstream) {
            throw new Error("File already opened");
        }
        this._info = fileInfo;
        this._chunkSize = chunkSize;
        const [chunkCount, lastChunkSize] = calcChunkInfo(fileInfo.size, chunkSize);
        this._lastChunkSize = lastChunkSize;
        this._cache = new Uint8Array(chunkCount);
        this._acc = 0;
        const optionsPick: SaveFilePickerOptions = {
            suggestedName: fileInfo.name,
        };
        let handle: FileSystemFileHandle;
        try {
            handle = await window.showSaveFilePicker(optionsPick);
        } catch (e) {
            console.debug(e);
            return false;
        }
        const optionsOpen: FileSystemCreateWritableOptions = {
            keepExistingData: false,
        };
        this._ofstream = await handle.createWritable(optionsOpen);
        this._writing = 0;
        return true;
    }

    async write(chunk: Uint8Array, index: number): Promise<number> {
        const ofile = this._ofstream;
        if (ofile) {
            try {
                ++this._writing;
                if (index < 0 || index >= this._cache.length) {
                    throw new Error("Index out of range");
                }
                if (index === this._cache.length - 1) {
                    if (chunk.length !== this._lastChunkSize) {
                        throw new Error("Chunk size mismatch");
                    }
                } else {
                    if (chunk.length !== this._chunkSize) {
                        throw new Error("Chunk size mismatch");
                    }
                }
                const filled = this._cache[index] > 0;
                this._cache[index] = 1;
                const writeParams: WriteParams = {
                    type: "write",
                    position: index * this._chunkSize,
                    data: chunk,
                    size: chunk.length,
                };
                await ofile.write(writeParams);
                if (!filled) {
                    this._acc += chunk.length;
                }
                return this._acc;
            } finally {
                if (--this._writing === 0 && this._wait) {
                    this._wait.resolve();
                    this._wait = undefined;
                }
            }
        } else {
            throw new Error("File not opened");
        }
    }

    flush(): Promise<void> {
        const ofile = this._ofstream;
        if (ofile) {
            if (this._writing === 0) {
                return Promise.resolve();
            } else {
                return this.waitWrite();
            }
        } else {
            return Promise.reject(new Error("File not opened"));
        }
    }

    private waitWrite(): Promise<void> {
        return new Promise((resolve, reject) => {
            this._wait = { resolve, reject };
        });
    }

    async close(): Promise<boolean> {
        const ofile = this._ofstream;
        if (ofile) {
            if (this._writing > 0) {
                await this.waitWrite();
            }
            const filled = this._cache.some((chunk) => !(chunk > 0));
            this._ofstream = undefined;
            this._info = undefined;
            this._cache = new Uint8Array();
            this._acc = 0;
            this._chunkSize = 0;
            this._lastChunkSize = 0;
            await ofile.close();
            return filled;
        } else {
            throw new Error("File not opened");
        }
    }

    async check(): Promise<Array<number>> {
        if (this._ofstream) {
            if (this._writing > 0) {
                await this.waitWrite();
            }
            const missing: Array<number> = [];
            for (let i = 0; i < this._cache.length; i++) {
                if (!(this._cache[i] > 0)) {
                    missing.push(i);
                }
            }
            return missing;
        } else {
            throw new Error("File not opened");
        }
    }
}