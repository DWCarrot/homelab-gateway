import { calcChunkInfo, FileInfo, IFileReader, IFileWriter } from "./fileoperate";

async function sleep(timeout: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, timeout));    
}

interface Protocol {
    uuid: string;
    type: "send" | "recv" | "missing" | "checkpoint" | "finish";
}

interface ProtocolHandshakeSend extends Protocol {
    type: "send";
    info: FileInfo;
    chunkSize: number;
}

interface ProtocolHandshakeRecv extends Protocol {
    type: "recv";
    accept: boolean;
    chunkSize: number;
}

interface ProtocolHandshakeMissing extends Protocol {
    type: "missing";
    indices: number[];
}

interface ProtocolCheckpoint extends Protocol {
    type: "checkpoint";
    round: number;
    count: number;  // received chunks since last checkpoint
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

export type ProgressStep = "handshake" | "send" | "recv" | "pause" | "finish" | "cancel";
export type ProgressCallback = (step: ProgressStep, round: number, acc: number, total: number) => void;
export type FileReaderFactory = () => IFileReader;

export interface TransferOptions {
    limit?: number; // webrtc data channel packet limit
    checkInterval?: number; // check interval for receiving; count chunks
    pauseThreshold?: [number, number]; // pause threshold; [low, high]; when send_count - recv_count > high, pause; when send_count - recv_count <= low, resume
}

interface TransferOptionsImpl extends TransferOptions {
    limit: number;
    checkInterval: number;
    pauseThreshold: [number, number];
}

function getTransferOptions(options: TransferOptions): TransferOptionsImpl {
    options.limit = options.limit || (16 * 1024);
    options.checkInterval = options.checkInterval || 10;
    options.pauseThreshold = options.pauseThreshold || [options.checkInterval * 2, options.checkInterval * 4];
    return options as TransferOptionsImpl;
}

export class FileSend {

    private _options: TransferOptionsImpl;
    private _dc: RTCDataChannel;
    private _status: 0 | 1 | 2 | 3 | -1; // 0: idle, 1: handshaking, 2: sending, 3: finished

    private _uuid: string;
    private _file: File;
    private _reader: IFileReader;
    private _info?: FileInfo;
    private _round: number;

    private _sendCount: number;
    private _recvCount: number;
    private _pauseCb?: {
        resolve: () => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reject: (reason?: any) => void;
    };

    private _cb?: {
        resolve: (value: boolean) => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reject: (reason?: any) => void;
        progress: ProgressCallback;
    };

    constructor(file: File, reader: IFileReader, uuid: string, dc: RTCDataChannel, options?: TransferOptions) {
        dc.binaryType = "arraybuffer";
        this._options = getTransferOptions(options || {});
        this._dc = dc;
        this._status = 0;
        this._uuid = uuid;
        this._file = file;
        this._reader = reader;
        this._round = 0;
        this._sendCount = 0;
        this._recvCount = 0;
        this._pauseCb = undefined;
        this._cb = undefined;
        this.bind(dc);
        this._reader.chunkSize = this._options.limit - 32;
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

    private async sendHandshake() {
        console.debug("FileSend::sendHandshake");
        try {
            this._info = await this._reader.open(this._file);
            const data: ProtocolHandshakeSend = {
                uuid: this._uuid,
                type: "send",
                info: this._info,
                chunkSize: this._reader.chunkSize
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

    private async recvHandshake(raw: string) {
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
                    if (recv.chunkSize > 0 && recv.chunkSize < this._reader.chunkSize) {
                        this._reader.chunkSize = recv.chunkSize;
                    }
                }
                this._status = 2;
                await this.send0(this._round);
            } else {
                this._status = 0;
                this._cb!.progress("cancel", 0, 0, this._info!.size);
                this._cb!.resolve(false);
                this._cb = undefined;
            }
        } catch (e) {
            if (this._cb) {
                this._status = -1;
                this._cb.reject(e);
                this._cb = undefined;
            }
        }
    }

    private async recvInSending(raw: string) {
        console.debug("FileSend::recvMissingOrFinish");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (data.uuid !== this._uuid) {
                throw new Error(`uuid mismatch: ${data.uuid} != ${this._uuid}`);
            }
            if (data.type === "finish") {
                await this._reader.close();
                this._status = 3;
                this._cb!.progress("finish", 0, this._reader.chunkSize, this._reader.chunkSize);
                this._cb!.resolve(true);
                this._cb = undefined;
            } else if (data.type === "missing") {
                const missing = data as ProtocolHandshakeMissing;
                this._round++;
                await this.send0(this._round, missing.indices);
            } else if (data.type === "checkpoint") {
                const checkpoint = data as ProtocolCheckpoint;
                if (this._round === checkpoint.round) {
                    this._recvCount += checkpoint.count;
                    if (this._pauseCb && (this._sendCount - this._recvCount) <= this._options.pauseThreshold[0]) {
                        console.debug(`FileSend::recvInSending: resume  @${this._round} send=${this._sendCount} recv=${this._recvCount}`);
                        this._pauseCb.resolve();
                        this._pauseCb = undefined;
                    }
                }
            } else {
                throw new Error(`invalid protocol type: ${data.type}`);
            }
        } catch (e) {
            if (this._cb) {
                this._status = -1;
                this._cb.reject(e);
                this._cb = undefined;
            }
        }
    }

    private async send0(round: number, indices?: Array<number>) {
        console.debug("FileSend::send0", round);
        let total = this._info!.size;
        if (indices) {
            if (indices.lastIndexOf(this._reader.chunkCount - 1) < 0) {
                total = indices.length * this._reader.chunkSize;
            } else {
                total = (indices.length - 1) * this._reader.chunkSize + this._reader.lastChunkSize;
            }
        }
        let acc = 0;
        this._sendCount = 0;
        for (const i of (indices || new RangeIterator(this._reader.chunkCount))) {
            const data = await this._reader.read(i);
            const buffer = encode(i, data);
            this._dc.send(buffer);
            acc += data.length;
            this._cb!.progress("send", round, acc, total);
            this._sendCount++;
            if (this._sendCount - this._recvCount > this._options.pauseThreshold[1]) {
                await this.makePausePromise();
            }
        }
        const finish: Protocol = {
            type: "finish",
            uuid: this._uuid
        };
        const raw = JSON.stringify(finish);
        this._dc.send(raw);
    }

    private makePausePromise(): Promise<void> {
        console.debug(`FileSend::makePausePromise @${this._round} send=${this._sendCount} recv=${this._recvCount}`);
        return new Promise((resolve, reject) => {
            this._pauseCb = { resolve, reject };
        });
    }

    private bind(dc: RTCDataChannel) {
        dc.onclose = this.onClose.bind(this);
        dc.onclosing = this.onClosing.bind(this);
        dc.onerror = this.onError.bind(this);
        dc.onmessage = this.onMessage.bind(this);
    }

    private unbind(dc: RTCDataChannel) {
        if (this._reader) {
            this._reader.close();
        }
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
                this.recvInSending(data);
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
    private _options: TransferOptionsImpl;
    private _onSave: FileSaveCallback;
    private _status: 0 | 1 | 2 | -1; // 0: idle, 1. handshaking, 2: receiving

    private _uuid?: string;
    private _info?: FileInfo;
    private _writer?: IFileWriter;
    private _progress?: ProgressCallback;
    private _round: number = 0;
    private _recvCount: number = 0;
    private _lastRecvCount: number = 0;

    constructor(onSave: FileSaveCallback, dc: RTCDataChannel, options?: TransferOptions) {
        dc.binaryType = "arraybuffer";
        this._onSave = onSave;
        this._dc = dc;
        this._options = getTransferOptions(options || {});
        this._status = 0;
        this.bind(dc);
    }

    private resetRecv() {
        this._uuid = undefined;
        this._info = undefined;
        this._writer = undefined;
        this._progress = undefined;
        this._round = 0;
        this._recvCount = 0;
        this._lastRecvCount = 0;
    }

    private async recvHandshake(raw: string) {
        console.debug("FileReceiveService::recvHandshake");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (!(data.type === "send")) {
                throw new Error(`invalid handshake type: ${data.type}`);
            }
            this._status = 1;
            try {
                await this.checkSave(data as ProtocolHandshakeSend);
            } catch (e) {
                console.error(e);
                this._status = -1;
            };
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
            const chunkSize = Math.min(this._options.limit - 32, data.chunkSize);
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
            this._recvCount = 0;
            this._lastRecvCount = 0;
            console.debug("FileReceiveService::checkSave: accept", "chunksize=", chunkSize);
        } else {
            const reject: ProtocolHandshakeRecv = {
                uuid: data.uuid,
                type: "recv",
                accept: false,
                chunkSize: -1
            };
            const raw = JSON.stringify(reject);
            this._dc.send(raw);
            this._status = 0;
            console.debug("FileReceiveService::checkSave: reject");
        }
    }

    private async recvData(raw: ArrayBuffer) {
        try {
            const [index, chunk] = decode(raw);
            await this.writeData(this._round, index, chunk);
        } catch (e) {
            console.error(e);
        }
    }

    private sendCheckpoint(recvCount: number) {
        console.debug(`FileReceiveService::sendCheckpoint @${this._round} recv=${recvCount} / ${this._lastRecvCount}`);
        const checkpoint: ProtocolCheckpoint = {
            uuid: this._uuid!,
            type: "checkpoint",
            count: recvCount - this._lastRecvCount,
            round: this._round,
        };
        this._lastRecvCount = recvCount;
        const raw = JSON.stringify(checkpoint);
        this._dc.send(raw);
    }

    private async writeData(round: number, index: number, chunk: Uint8Array) {
        const n = await this._writer!.write(chunk, index);
        this._progress!("recv", round, n, this._writer!.fileSize);
        const recvCount = ++this._recvCount;
        if (recvCount % this._options.checkInterval === 0) {
            await this._writer!.flush();
            this.sendCheckpoint(recvCount);
        }
    }

    private async recvFinish(raw: string) {
        console.debug("FileReceiveService::recvFinish");
        try {
            const data = JSON.parse(raw) as Protocol;
            if (!(data.type === "finish")) {
                throw new Error(`invalid protocol type: ${data.type}`);
            }
            await this._writer!.flush();
            this.sendCheckpoint(this._recvCount);
            await this.checkMissing();
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
            await this._writer!.close();
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