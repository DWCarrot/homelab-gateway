/* eslint-disable @stylistic/quotes */
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


export interface FileInfo {
    name: string;
    lastModified: number;
    webkitRelativePath: string;
    size: number;
    type: string;
}

export interface IFileWriter {

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
     * @returns number of bytes written
     */
    write(chunk: Blob, index: number): Promise<number>;

    /**
     * flush file
     */
    flush(): Promise<void>;

    /**
     * check file status and find missing chunk
     * @returns array of chunk index that is missing
     */
    check(): Promise<Array<number>>;
}


export type FileDownloadCallback = (fileInfo: FileInfo, blob: Blob) => Promise<void>;

export class BasicFileWriter implements IFileWriter {

    private _info?: FileInfo;
    private _cache: Array<Blob>;
    private _chunk: number; // chunk size
    private _last: number; // last chunk size
    private _onDownload: FileDownloadCallback;

    constructor(onDownload: FileDownloadCallback) {
        this._info = undefined;
        this._cache = [];
        this._chunk = 0;
        this._last = 0;
        this._onDownload = onDownload;
    }

    open(fileInfo: FileInfo, chunkSize: number): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this._info = fileInfo;
            this._chunk = chunkSize;
            const [count, last] = calcChunkInfo(this._info.size, chunkSize);
            this._last = last;
            this._cache = new Array(count);
            resolve(true);
        });
    }

    write(chunk: Blob, index: number): Promise<number> {
        return new Promise((resolve, reject) => {
            if (index < 0 || index >= this._cache.length) {
                return reject(new Error(`index out of range: ${index}`));
            }
            if (index === this._cache.length - 1) {
                if (chunk.size !== this._last) {
                    return reject(new Error(`last chunk size mismatch: ${chunk.size} != ${this._last}`));
                }
                
            } else {
                if (chunk.size !== this._chunk) {
                    return reject(new Error(`chunk size mismatch: ${chunk.size} != ${this._chunk}`));
                }
            }
            const filled = this._cache[index] !== undefined;
            this._cache[index] = chunk;
            return resolve(filled ? 0 : chunk.size);
        });
    }

    flush(): Promise<void> {
        if (this._cache.some((chunk) => chunk === undefined)) {
            return Promise.reject(new Error("missing chunk"));
        }
        const info = this._info!;
        const total = new Blob(this._cache, { type: "application/octet-stream" });
        this._info = undefined;
        this._cache = [];
        this._chunk = 0;
        this._last = 0;
        return this._onDownload(info, total);
    }

    check(): Promise<Array<number>> {
        return new Promise((resolve, reject) => {
            const missing: Array<number> = [];
            for (let i = 0; i < this._cache.length; i++) {
                if (this._cache[i] === undefined) {
                    missing.push(i);
                }
            }
            resolve(missing);
        });
    }
}


async function sleep(timeout: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, timeout));    
}

interface Protocol {
    uuid: string;
    type: "send" | "recv" | "missing" | "finish";
}

interface ProtocolHandshakeSend extends Protocol {
    type: "send";
    info: FileInfo;
    chunkSize: number;
}

interface ProtocolHandshakeRecv extends Protocol {
    type: "recv";
    accept: boolean;
    chunkSize?: number;
}

interface ProtocolHandshakeMissing extends Protocol {
    type: "missing";
    indices: number[];
}


const MAGIC = 0xC09FE7AD;

function encode(index: number, data: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(data.byteLength + 32);
    const view = new DataView(buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, index, true);
    view.setBigUint64(8, BigInt(data.byteLength), true);
    const dst = new Uint8Array(buffer, 32);
    dst.set(data);
    return buffer;
}

function decode(data: ArrayBuffer): [number, Uint8Array] {
    const view = new DataView(data);
    const magic = view.getUint32(0, true);
    if (magic !== MAGIC) {
        throw new Error(`invalid magic number: ${magic}`);
    }
    const index = view.getUint32(4, true);
    const size = Number(view.getBigUint64(8, true));
    if (size !== data.byteLength - 32) {
        throw new Error(`invalid data size: ${size} != ${data.byteLength - 32}`);
    }
    const chunk = new Uint8Array(data, 32, size);
    return [index, chunk];
}


class RangeIterator implements IterableIterator<number> {
    private current: number = 0;
    private readonly end: number;

    constructor(end: number) {
        this.end = end;
    }

    public next(): IteratorResult<number> {
        if (this.current < this.end) {
            return { value: this.current++, done: false };
        } else {
            return { value: undefined, done: true };
        }
    }

    [Symbol.iterator](): IterableIterator<number> {
        return this;
    }
}

export type ProgressStep = "handshake" | "send" | "recv" | "finish" | "cancel";
export type ProgressCallback = (step: ProgressStep, round: number, acc: number, total: number) => void;

export class FileSend {

    private _dc: RTCDataChannel;
    private _limit: number;
    private _file: File;
    private _uuid: string;
    private _info: FileInfo;
    private _count: number;
    private _chunkSize: number;
    private _lastChunkSize: number;
    private _status: 0 | 1 | 2 | 3 | -1; // 0: idle, 1: handshaking, 2: sending, 3: finished
    private _cb?: {
        resolve: (value: boolean) => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reject: (reason?: any) => void;
        progress: ProgressCallback;
    };
    private _round: number;

    constructor(file: File, uuid: string, dc: RTCDataChannel, limit?: number) {
        dc.binaryType = "arraybuffer";
        this._dc = dc;
        this._limit = limit || (16 * 1024);
        this._file = file;
        this._uuid = uuid;
        this._info = {
            name: file.name,
            lastModified: file.lastModified,
            webkitRelativePath: file.webkitRelativePath,
            size: file.size,
            type: file.type
        };
        this._count = 0;
        this._chunkSize = this._limit - 32;
        this._lastChunkSize = 0;
        this._status = 0;
        this._cb = undefined;
        this._round = 0;
        this.bind(dc);
    }

    send(progress: ProgressCallback): Promise<boolean> {
        if (this._status !== 0) {
            return Promise.reject(new Error(`invalid status: ${this._status}`));
        }
        this._status = 1;
        return new Promise((resolve, reject) => {
            this._cb = { resolve, reject, progress };
            this.sendHandshake();
        });
    }

    drop() {
        this.unbind(this._dc);
    }

    private sendHandshake() {
        console.debug("FileSend::sendHandshake");
        try {
            const data: ProtocolHandshakeSend = {
                uuid: this._uuid,
                type: "send",
                info: this._info,
                chunkSize: this._chunkSize
            };
            const raw = JSON.stringify(data);
            this._dc.send(raw);
            this._cb!.progress("handshake", 0, 0, this._info.size);
        } catch (e) {
            this._status = -1;
            this._cb!.reject(e);
            this._cb = undefined;
        }
    }

    private recvHandshake(raw: string) {
        console.debug("FileSend::recvHandshake");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (data.uuid !== this._uuid) {
                throw new Error(`uuid mismatch: ${data.uuid} != ${this._uuid}`);
            }
            if (!(data.type === "recv")) {
                throw new Error(`invalid handshake type: ${data.type}`);
            }
            const recv = data as ProtocolHandshakeRecv;
            if (recv.accept) {
                if (recv.chunkSize !== undefined) {
                    if (recv.chunkSize > 0 && recv.chunkSize < this._chunkSize) {
                        this._chunkSize = recv.chunkSize;
                    }
                }
                const [count, last] = calcChunkInfo(this._info.size, this._chunkSize);
                this._lastChunkSize = last;
                this._count = count;
                this._status = 2;
                this.send0(this._round++)
                    .catch((e) => {
                        if (this._cb) {
                            this._status = -1;
                            this._cb.reject(e);
                            this._cb = undefined;
                        }
                    });
            } else {
                this._status = 0;
                this._cb!.progress("cancel", 0, 0, this._info.size);
                this._cb!.resolve(false);
                this._cb = undefined;
            }
        } catch (e) {
            this._status = -1;
            this._cb!.reject(e);
            this._cb = undefined;
        }
    }

    private recvMissingOrFinish(raw: string) {
        console.debug("FileSend::recvMissingOrFinish");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (data.uuid !== this._uuid) {
                throw new Error(`uuid mismatch: ${data.uuid} != ${this._uuid}`);
            }
            if (data.type === "finish") {
                this._status = 3;
                this._cb!.progress("finish", 0, this._info.size, this._info.size);
                this._cb!.resolve(true);
                this._cb = undefined;
            } else if (data.type === "missing") {
                const missing = data as ProtocolHandshakeMissing;
                this.send0(this._round++, missing.indices)
                    .catch((e) => {
                        if (this._cb) {
                            this._status = -1;
                            this._cb.reject(e);
                            this._cb = undefined;
                        }
                    });
            } else {
                throw new Error(`invalid protocol type: ${data.type}`);
            }
        } catch (e) {
            this._status = -1;
            this._cb!.reject(e);
            this._cb = undefined;
        }
    }

    private async send0(round: number, indices?: Array<number>) {
        console.debug("FileSend::send0", round);
        let total = this._info.size;
        if (indices) {
            if (indices.lastIndexOf(this._count - 1) < 0) {
                total = indices.length * this._chunkSize;
            } else {
                total = (indices.length - 1) * this._chunkSize + this._lastChunkSize;
            }
        }
        let acc = 0;
        for (const i of (indices || new RangeIterator(this._count))) {
            const start = i * this._chunkSize;
            const end = Math.min(start + this._chunkSize, this._info.size);
            const chunk = this._file.slice(start, end);
            const data = await chunk.arrayBuffer();
            const buffer = encode(i, new Uint8Array(data));
            this._dc.send(buffer);
            acc += chunk.size;
            this._cb!.progress("send", round, acc, total);
        }
        const finish: Protocol = {
            type: "finish",
            uuid: this._uuid
        };
        const raw = JSON.stringify(finish);
        this._dc.send(raw);
    }

    private bind(dc: RTCDataChannel) {
        dc.onclose = this.onClose.bind(this);
        dc.onclosing = this.onClosing.bind(this);
        dc.onerror = this.onError.bind(this);
        dc.onmessage = this.onMessage.bind(this);
    }

    private unbind(dc: RTCDataChannel) {
        dc.onclose = null;
        dc.onclosing = null;
        dc.onerror = null;
        dc.onmessage = null;
    }

    private onMessage(e: MessageEvent) {
        const data = e.data;
        if (this._status === 1) {
            if (typeof data === "string") {
                this.recvHandshake(data);
            } else {
                console.warn("unexpected data type for handshake");
            }
        } else if (this._status === 2) {
            if (typeof data === "string") {
                this.recvMissingOrFinish(data);
            } else {
                console.warn("unexpected data type for sending");
            }
        }
    }

    private onClose(e: Event) {
        this.unbind(this._dc);
    }

    private onClosing(e: Event) {
        this.unbind(this._dc);
    }

    private onError(e: Event) {

    }
}

export type FileSaveCallback = (fileInfo: FileInfo) => Promise<[IFileWriter, ProgressCallback ] | undefined>;

export class FileReceiveService {

    private _dc: RTCDataChannel;
    private _limit: number;
    private _onSave: FileSaveCallback;
    private _uuid?: string;
    private _info?: FileInfo;
    private _writer?: IFileWriter;
    private _progress?: ProgressCallback;
    private _round: number = 0;
    private _acc: number = 0;
    private _status: 0 | 1 | 2 | -1; // 0: idle, 1. handshaking, 2: receiving


    constructor(onSave: FileSaveCallback, dc: RTCDataChannel, limit?: number) {
        dc.binaryType = "arraybuffer";
        this._onSave = onSave;
        this._dc = dc;
        this._limit = limit || (16 * 1024);
        this._status = 0;
        this.bind(dc);
    }

    private recvHandshake(raw: string) {
        console.debug("FileReceiveService::recvHandshake");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (!(data.type === "send")) {
                throw new Error(`invalid handshake type: ${data.type}`);
            }
            this._status = 1;
            this.checkSave(data as ProtocolHandshakeSend)
                .catch((e) => {
                    console.error(e);
                    this._status = -1;
                });
        } catch (e) {
            this._status = 0; // still waiting for handshake
            console.error(e);
        }
    }

    private async checkSave(data: ProtocolHandshakeSend) {
        console.debug("FileReceiveService::checkSave");
        const t = await this._onSave(data.info);
        if (t) {
            this._uuid = data.uuid;
            this._info = data.info;
            this._writer = t[0];
            this._progress = t[1];
            this._round = 0;
            this._acc = 0;
            const chunkSize = Math.min(this._limit - 32, data.chunkSize);
            await this._writer.open(this._info, chunkSize);
            const accept: ProtocolHandshakeRecv = {
                uuid: this._uuid,
                type: "recv",
                accept: true,
                chunkSize
            };
            const raw = JSON.stringify(accept);
            this._dc.send(raw);
            this._status = 2;
            console.debug("FileReceiveService::checkSave: accept", "chunksize=", chunkSize);
        } else {
            const reject: ProtocolHandshakeRecv = {
                uuid: data.uuid,
                type: "recv",
                accept: false
            };
            const raw = JSON.stringify(reject);
            this._dc.send(raw);
            this._status = 0;
            console.debug("FileReceiveService::checkSave: reject");
        }
    }

    private recvData(raw: ArrayBuffer) {
        try {
            const [index, chunk] = decode(raw);
            const data = new Blob([chunk]);
            this.writeData(this._round, index, data)
                .catch((e) => {
                    console.error(e);
                });
        } catch (e) {
            console.error(e);
        }
    }

    private async writeData(round: number, index: number, chunk: Blob) {
        const n = await this._writer!.write(chunk, index);
        this._acc += n;
        if (n > 0) {
            this._progress!("recv", round, this._acc, this._info!.size);
        }
    }

    private recvFinish(raw: string) {
        console.debug("FileReceiveService::recvFinish");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (!(data.type === "finish")) {
                throw new Error(`invalid protocol type: ${data.type}`);
            }
            this.checkMissing();
        } catch (e) {
            console.error(e);
        }
    }

    private async checkMissing() {
        console.debug("FileReceiveService::checkMissing");
        const missing = await this._writer!.check();
        if (missing.length > 0) {
            console.debug("FileReceiveService::checkMissing: missing [", missing.length, "]");
            const data: ProtocolHandshakeMissing = {
                uuid: this._uuid!,
                type: "missing",
                indices: missing
            };
            const raw = JSON.stringify(data);
            this._dc.send(raw);
            this._round++;
        } else {
            console.debug("FileReceiveService::checkMissing: finish");
            await this._writer!.flush();
            console.log("FileReceiveService::checkMissing: done");
            const finish: Protocol = {
                uuid: this._uuid!,
                type: "finish"
            };
            const raw = JSON.stringify(finish);
            this._dc.send(raw);
            this._progress!("finish", this._round, this._info!.size, this._info!.size);
            this._status = 0;
            this._info = undefined;
            this._writer = undefined;
            this._progress = undefined;
            this._round = 0;
            this._acc = 0;
        }
    }

    private bind(dc: RTCDataChannel) {
        dc.onclose = this.onClose.bind(this);
        dc.onclosing = this.onClosing.bind(this);
        dc.onerror = this.onError.bind(this);
        dc.onmessage = this.onMessage.bind(this);
    }

    private unbind(dc: RTCDataChannel) {
        dc.onclose = null;
        dc.onclosing = null;
        dc.onerror = null;
        dc.onmessage = null;
    }

    private onMessage(e: MessageEvent) {
        const data = e.data;
        if (this._status === 0) {
            if (typeof data === "string") {
                this.recvHandshake(data);
            } else {
                console.warn("unexpected data type for handshake");
            }
        } else if (this._status === 2) {
            if (data instanceof ArrayBuffer) {
                this.recvData(data);
            } else if (typeof data === "string") {
                this.recvFinish(data);
            } else {
                console.warn("unexpected data type for receiving");
            }
        }
    }

    private onClose(e: Event) {
        this.unbind(this._dc);
    }

    private onClosing(e: Event) {
        this.unbind(this._dc);
    }

    private onError(e: Event) {

    }
}