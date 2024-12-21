/**
 * 
 * @param size 
 * @param chunkSize 
 * @returns [chunkCount, lastChunkSize]
 */
export function calcChunkInfo(size: number, chunkSize: number): [number, number] {
    const chunkCount = Math.ceil(size / chunkSize);
    const lastChunkSize = size % chunkSize;
    return [chunkCount >> 0, lastChunkSize >> 0];
}

/**
 * 
 */
export interface FileInfo {
    name: string;
    lastModified: number;
    webkitRelativePath: string;
    size: number;
    type: string;
}

/**
 * 
 */
export interface IFileReader {

    chunkSize: number;

    readonly lastChunkSize: number;

    readonly chunkCount: number;

    readonly fileSize: number;

    /**
     * open a file for reading
     * @param fileInfo file information
     * @param chunkSize chunk size
     * @returns 
     */
    open(file: File): Promise<FileInfo>;

    /**
     * read data from file
     * @param index chunk index
     * @returns chunk data
     */
    read(index: number): Promise<Uint8Array>;

    /**
     * close file
     */
    close(): Promise<void>;
}


/**
 * 
 */
export interface IFileWriter {

    readonly chunkSize: number;

    readonly lastChunkSize: number;

    readonly chunkCount: number;

    readonly fileSize: number;

    /**
     * open a file for writing
     * @param size file size
     * @returns
     */
    open(fileInfo: FileInfo, chunkSize: number): Promise<boolean>;

    /**
     * write data to file
     * @param chunk  chunk data to write. must be `chunkSize` length or less if it is the last chunk
     * @param offset start position to write
     * @returns number of bytes written totally
     */
    write(chunk: Uint8Array, index: number): Promise<number>;

    /**
     * flush file writing
     */
    flush(): Promise<void>;

    /**
     * close file writing
     * @returns true if all chunks are written
     */
    close(): Promise<boolean>;

    /**
     * check file status and find missing chunk
     * @returns array of chunk index that is missing
     */
    check(): Promise<Array<number>>;
}



export class BasicFileReader implements IFileReader {

    static readParts: (blob: Blob, start: number, end: number) => Promise<Uint8Array> = Promise.reject;
    
    private _info?: FileInfo;
    private _ifile?: File;
    private _chunkSize: number;
    private _lastChunkSize: number;
    private _chunkCount: number;

    get chunkSize(): number {
        return this._chunkSize;
    }
    
    set chunkSize(value: number) {
        this._chunkSize = value;
        if (this._info) {
            [this._chunkCount, this._lastChunkSize] = calcChunkInfo(this._info.size, this._chunkSize);
        }
    }

    get lastChunkSize(): number {
        return this._lastChunkSize;
    }

    get chunkCount(): number {
        return this._chunkCount;
    }

    get fileSize(): number {
        return this._info ? this._info.size : 0;
    }

    constructor() {
        this._info = undefined;
        this._ifile = undefined;
        this._chunkSize = -1;
        this._lastChunkSize = -1;
        this._chunkCount = -1;
    }

    open(file: File): Promise<FileInfo> {
        if (this._ifile) {
            return Promise.reject(new Error("file already opened"));
        }
        this._ifile = file;
        this._info = {
            name: file.name,
            lastModified: file.lastModified,
            webkitRelativePath: file.webkitRelativePath,
            size: file.size,
            type: file.type
        };
        if (this._chunkSize < 0) {
            this._chunkSize = -1;
            this._lastChunkSize = -1;
            this._chunkCount = -1;
        } else {
            [this._chunkCount, this._lastChunkSize] = calcChunkInfo(this._info.size, this._chunkSize);
        }
        return Promise.resolve(this._info);
    }

    read(index: number): Promise<Uint8Array> {
        if (!this._ifile) {
            return Promise.reject(new Error("file not opened"));
        }
        if (this._chunkSize < 0) {
            const empty = new Uint8Array(0);
            return Promise.resolve(empty);
        }
        if (index < 0 || index >= this.chunkCount) {
            return Promise.reject(new Error(`index out of range: ${index}`));
        }
        const start = index * this._chunkSize;
        const end = index === (this.chunkCount - 1) ? (start + this._lastChunkSize) : (start + this._chunkSize);
        return BasicFileReader.readParts(this._ifile, start, end);
    }

    close(): Promise<void> {
        this._info = undefined;
        this._ifile = undefined;
        this._chunkSize = -1;
        this._lastChunkSize = -1;
        this._chunkCount = -1;
        return Promise.resolve();
    }
}

{
    const testBlob = new Blob();
    if ("bytes" in testBlob) {
        BasicFileReader.readParts = (blob: Blob, start: number, end: number) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (blob.slice(start, end) as any).bytes();
        };
    } else if ("arrayBuffer" in testBlob) {
        BasicFileReader.readParts = (blob: Blob, start: number, end: number) => {
            return blob.slice(start, end).arrayBuffer().then((buffer) => new Uint8Array(buffer));
        };
    }
}


export type FileDownloadCallback = (fileInfo: FileInfo, blob: Blob) => void;

export class BasicFileWriter implements IFileWriter {

    private _info?: FileInfo;
    private _cache: Array<Blob>;
    private _acc: number;
    private _chunkSize: number;
    private _lastChunkSize: number;
    private _onDownload: FileDownloadCallback;

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

    constructor(onDownload: FileDownloadCallback) {
        this._info = undefined;
        this._cache = [];
        this._acc = 0;
        this._chunkSize = 0;
        this._lastChunkSize = 0;
        this._onDownload = onDownload;
    }

    open(fileInfo: FileInfo, chunkSize: number): Promise<boolean> {
        if (this._info) {
            return Promise.reject(new Error("file already opened"));
        }
        this._info = fileInfo;
        this._chunkSize = chunkSize;
        const [chunkCount, lastChunkSize] = calcChunkInfo(this._info.size, chunkSize);
        this._lastChunkSize = lastChunkSize;
        this._cache = new Array(chunkCount);
        this._acc = 0;
        return Promise.resolve(true);
    }

    write(chunk: Uint8Array, index: number): Promise<number> {
        if (!this._info) {
            return Promise.reject(new Error("file not opened"));
        }
        if (index < 0 || index >= this._cache.length) {
            return Promise.reject(new Error(`index out of range: ${index}`));
        }
        if (index === this._cache.length - 1) {
            if (chunk.length !== this._lastChunkSize) {
                return Promise.reject(new Error(`last chunk size mismatch: ${chunk.length} != ${this._lastChunkSize}`));
            }
        } else {
            if (chunk.length !== this._chunkSize) {
                return Promise.reject(new Error(`chunk size mismatch: ${chunk.length} != ${this._chunkSize}`));
            }
        }
        const filled = this._cache[index] !== undefined;
        this._cache[index] = new Blob([chunk]);
        if (!filled) {
            this._acc += chunk.length;
        }
        return Promise.resolve(this._acc);
    }

    flush(): Promise<void> {
        return Promise.resolve();
    }

    close(): Promise<boolean> {
        const info = this._info;
        if (info) {
            const filled = this._cache.every((chunk) => chunk !== undefined);
            const total = new Blob(this._cache, { type: "application/octet-stream" });
            this._info = undefined;
            this._cache = [];
            this._acc = 0;
            this._chunkSize = 0;
            this._lastChunkSize = 0;
            this._onDownload(info, total);
            return Promise.resolve(filled);
        } else {
            return Promise.reject(new Error("file not opened"));
        }
    }

    check(): Promise<Array<number>> {
        if (this._info) {
            const missing: Array<number> = [];
            for (let i = 0; i < this._cache.length; i++) {
                if (this._cache[i] === undefined) {
                    missing.push(i);
                }
            }
            return Promise.resolve(missing);
        } else {
            return Promise.reject(new Error("file not opened"));
        }
    }
}