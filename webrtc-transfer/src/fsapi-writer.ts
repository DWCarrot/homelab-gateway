import { calcChunkInfo, FileInfo, IFileWriter } from "./filetransfer";

export class FileSystemAPIWriter implements IFileWriter {

    static isSupported(): boolean {
        return "showSaveFilePicker" in window;
    }

    private ofile?: FileSystemWritableFileStream;
    private _info?: FileInfo;
    private _cache?: Uint8Array;
    private _chunk: number = 0; // chunk size
    private _last: number = 0; // last chunk size

    constructor() {
    
    }

    async open(fileInfo: FileInfo, chunkSize: number): Promise<boolean> {
        this._info = fileInfo;
        this._chunk = chunkSize;
        const [chunkCount, lastChunkSize] = calcChunkInfo(fileInfo.size, chunkSize);
        this._last = lastChunkSize;
        this._cache = new Uint8Array(chunkCount);
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
        this.ofile = await handle.createWritable(optionsOpen);
        return true;
    }

    async write(chunk: Blob, index: number): Promise<number> {
        const cache = this._cache!;
        if (index < 0 || index >= cache.length) {
            throw new Error("Index out of range");
        }
        const ofile = this.ofile!;
        if (index === cache.length - 1) {
            if (chunk.size !== this._last) {
                throw new Error("Chunk size mismatch");
            }
        } else {
            if (chunk.size !== this._chunk) {
                throw new Error("Chunk size mismatch");
            }
        }
        const filled = cache[index] > 0;
        cache[index] = 1;
        const writeParams: WriteParams = {
            type: "write",
            position: index * this._chunk,
            data: chunk,
            size: chunk.size,
        };
        await ofile.write(writeParams);
        return filled ? 0 : chunk.size;
    }

    async flush(): Promise<void> {
        if (this._cache!.some((chunk) => !(chunk > 0))) {
            throw new Error("missing chunk");
        }
        return this.ofile!.close();
    }

    check(): Promise<Array<number>> {
        return new Promise((resolve, reject) => {
            const missing: Array<number> = [];
            const cache = this._cache!;
            for (let i = 0; i < cache.length; i++) {
                if (!(cache[i] > 0)) {
                    missing.push(i);
                }
            }
            resolve(missing);
        });
    }

}